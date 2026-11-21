require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { DatabaseSync } = require('node:sqlite');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_ID = process.env.ADMIN_ID || 'EPL-ADMIN-CHANGE-ME';
const SESSION_SECRET = process.env.SESSION_SECRET || 'development-secret-change-before-deploy';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'elevate.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
// Compatibility wrapper for synchronous transactions using Node's built-in SQLite.
db.transaction = (fn) => () => { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (err) { db.exec('ROLLBACK'); throw err; } };
db.exec(`
CREATE TABLE IF NOT EXISTS athletes (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, athlete_id TEXT UNIQUE NOT NULL,
 phone TEXT DEFAULT '', email TEXT DEFAULT '', sport TEXT DEFAULT 'Athletics',
 goal TEXT DEFAULT '', active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, session_no TEXT NOT NULL, title TEXT NOT NULL,
 description TEXT DEFAULT '', visibility TEXT NOT NULL DEFAULT 'assigned',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS session_assignments (
 session_id INTEGER NOT NULL, athlete_id INTEGER NOT NULL,
 PRIMARY KEY(session_id, athlete_id),
 FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
 FOREIGN KEY(athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS fields (
 id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL,
 label TEXT NOT NULL, field_type TEXT NOT NULL DEFAULT 'text', unit TEXT DEFAULT '',
 required INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0,
 FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS submissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, athlete_id INTEGER NOT NULL, session_id INTEGER NOT NULL,
 submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(athlete_id) REFERENCES athletes(id) ON DELETE CASCADE,
 FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS answers (
 id INTEGER PRIMARY KEY AUTOINCREMENT, submission_id INTEGER NOT NULL, field_id INTEGER NOT NULL,
 answer TEXT DEFAULT '',
 FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
 FOREIGN KEY(field_id) REFERENCES fields(id) ON DELETE CASCADE
);
`);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000*60*60*12 } }));
app.use(express.static(path.join(__dirname, 'public')));

const requireAdmin = (req,res,next) => req.session?.role === 'admin' ? next() : res.status(401).json({error:'Admin login required'});
const requireAthlete = (req,res,next) => req.session?.role === 'athlete' && req.session.athleteId ? next() : res.status(401).json({error:'Athlete login required'});
const safeAthlete = (a) => ({id:a.id,name:a.name,athleteId:a.athlete_id,phone:a.phone,email:a.email,sport:a.sport,goal:a.goal,active:!!a.active,createdAt:a.created_at});

app.post('/api/login', (req,res)=>{
 const id = String(req.body.id||'').trim();
 if (!id) return res.status(400).json({error:'Enter your unique ID'});
 if (id === ADMIN_ID) { req.session.role='admin'; req.session.athleteId=null; return res.json({role:'admin'}); }
 const athlete = db.prepare('SELECT * FROM athletes WHERE athlete_id=? AND active=1').get(id);
 if (!athlete) return res.status(401).json({error:'ID not found or inactive. Please contact your coach.'});
 req.session.role='athlete'; req.session.athleteId=athlete.id;
 res.json({role:'athlete',athlete:safeAthlete(athlete)});
});
app.get('/api/me',(req,res)=>{
 if(req.session.role==='admin') return res.json({role:'admin'});
 if(req.session.role==='athlete') { const a=db.prepare('SELECT * FROM athletes WHERE id=?').get(req.session.athleteId); if(a) return res.json({role:'athlete',athlete:safeAthlete(a)}); }
 res.json({role:null});
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));

// Admin athlete management
app.get('/api/admin/athletes', requireAdmin,(req,res)=>res.json(db.prepare('SELECT * FROM athletes ORDER BY active DESC, name COLLATE NOCASE').all().map(safeAthlete)));
app.post('/api/admin/athletes', requireAdmin,(req,res)=>{
 const {name,athleteId,phone='',email='',sport='Athletics',goal=''}=req.body;
 if(!name?.trim() || !athleteId?.trim()) return res.status(400).json({error:'Name and unique ID are required'});
 try { const r=db.prepare('INSERT INTO athletes(name,athlete_id,phone,email,sport,goal) VALUES(?,?,?,?,?,?)').run(name.trim(),athleteId.trim(),phone,email,sport,goal); res.json(safeAthlete(db.prepare('SELECT * FROM athletes WHERE id=?').get(r.lastInsertRowid))); }
 catch(e){res.status(400).json({error:'That unique ID already exists. Choose another.'});}
});
app.patch('/api/admin/athletes/:id',requireAdmin,(req,res)=>{
 const a=db.prepare('SELECT * FROM athletes WHERE id=?').get(req.params.id); if(!a)return res.status(404).json({error:'Athlete not found'});
 const active=req.body.active===undefined?a.active:(req.body.active?1:0);
 db.prepare('UPDATE athletes SET active=? WHERE id=?').run(active,a.id); res.json({ok:true});
});
app.delete('/api/admin/athletes/:id',requireAdmin,(req,res)=>{
 db.prepare('DELETE FROM athletes WHERE id=?').run(req.params.id); res.json({ok:true});
});

// Session creation & management
app.get('/api/admin/sessions',requireAdmin,(req,res)=>{
 const sessions=db.prepare('SELECT * FROM sessions ORDER BY id DESC').all();
 res.json(sessions.map(s=>({...s,fields:db.prepare('SELECT * FROM fields WHERE session_id=? ORDER BY sort_order,id').all(s.id),assigned:db.prepare('SELECT athlete_id FROM session_assignments WHERE session_id=?').all(s.id).map(x=>x.athlete_id)})));
});
app.post('/api/admin/sessions',requireAdmin,(req,res)=>{
 const {sessionNo,title,description='',visibility='assigned',fields=[],assigned=[]}=req.body;
 if(!sessionNo || !title) return res.status(400).json({error:'Session number and title are required'});
 const tx=db.transaction(()=>{
  const s=db.prepare('INSERT INTO sessions(session_no,title,description,visibility) VALUES(?,?,?,?)').run(String(sessionNo),title,description,visibility==='everyone'?'everyone':'assigned');
  const sid=s.lastInsertRowid;
  const insertField=db.prepare('INSERT INTO fields(session_id,label,field_type,unit,required,sort_order) VALUES(?,?,?,?,?,?)');
  fields.forEach((f,i)=>{if(f.label?.trim()) insertField.run(sid,f.label.trim(),f.type||'text',f.unit||'',f.required?1:0,i);});
  if(visibility!=='everyone') { const insertAssign=db.prepare('INSERT OR IGNORE INTO session_assignments(session_id,athlete_id) VALUES(?,?)'); (assigned||[]).forEach(a=>insertAssign.run(sid,a)); }
  return sid;
 });
 const id=tx(); res.json({ok:true,id});
});
app.delete('/api/admin/sessions/:id',requireAdmin,(req,res)=>{db.prepare('DELETE FROM sessions WHERE id=?').run(req.params.id);res.json({ok:true});});

// Athlete view: sessions assigned to them + everyone sessions
app.get('/api/athlete/sessions',requireAthlete,(req,res)=>{
 const athleteId=req.session.athleteId;
 const sessions=db.prepare(`SELECT DISTINCT s.* FROM sessions s LEFT JOIN session_assignments a ON a.session_id=s.id WHERE s.visibility='everyone' OR a.athlete_id=? ORDER BY s.id DESC`).all(athleteId);
 res.json(sessions.map(s=>({...s,fields:db.prepare('SELECT * FROM fields WHERE session_id=? ORDER BY sort_order,id').all(s.id),submissions:db.prepare('SELECT COUNT(*) count FROM submissions WHERE athlete_id=? AND session_id=?').get(athleteId,s.id).count})));
});
app.post('/api/athlete/submit-batch',requireAthlete,(req,res)=>{
 const items=Array.isArray(req.body.items)?req.body.items:[];
 if(!items.length) return res.status(400).json({error:'Enter at least one session response before saving.'});
 const athleteId=req.session.athleteId;
 const tx=db.transaction(()=>{
  let count=0;
  for(const item of items){
   const sessionRow=db.prepare(`SELECT s.id FROM sessions s LEFT JOIN session_assignments a ON a.session_id=s.id WHERE s.id=? AND (s.visibility='everyone' OR a.athlete_id=?)`).get(item.sessionId,athleteId);
   if(!sessionRow) continue;
   const submission=db.prepare('INSERT INTO submissions(athlete_id,session_id) VALUES(?,?)').run(athleteId,item.sessionId);
   const allowed=db.prepare('SELECT id FROM fields WHERE session_id=?').all(item.sessionId).map(f=>f.id);
   const insert=db.prepare('INSERT INTO answers(submission_id,field_id,answer) VALUES(?,?,?)');
   Object.entries(item.answers||{}).forEach(([fid,val])=>{if(allowed.includes(Number(fid)))insert.run(submission.lastInsertRowid,Number(fid),Array.isArray(val)?val.join(', '):String(val??''));});
   count++;
  }
  return count;
 });
 const count=tx(); if(!count)return res.status(403).json({error:'No eligible sessions to save.'});res.json({ok:true,count});
});
app.post('/api/athlete/submit',requireAthlete,(req,res)=>{
 const {sessionId,answers}=req.body;
 const sessionRow=db.prepare(`SELECT s.id FROM sessions s LEFT JOIN session_assignments a ON a.session_id=s.id WHERE s.id=? AND (s.visibility='everyone' OR a.athlete_id=?)`).get(sessionId,req.session.athleteId);
 if(!sessionRow) return res.status(403).json({error:'This session is not assigned to you.'});
 const tx=db.transaction(()=>{
  const submission=db.prepare('INSERT INTO submissions(athlete_id,session_id) VALUES(?,?)').run(req.session.athleteId,sessionId);
  const insert=db.prepare('INSERT INTO answers(submission_id,field_id,answer) VALUES(?,?,?)');
  const allowed=db.prepare('SELECT id FROM fields WHERE session_id=?').all(sessionId).map(f=>f.id);
  Object.entries(answers||{}).forEach(([fid,val])=>{if(allowed.includes(Number(fid)))insert.run(submission.lastInsertRowid,Number(fid),Array.isArray(val)?val.join(', '):String(val??''));});
  return submission.lastInsertRowid;
 });
 res.json({ok:true,submissionId:tx()});
});

// Admin progress report and individual athlete history
app.get('/api/admin/reports',requireAdmin,(req,res)=>{
 const q=String(req.query.q||'').trim();
 let rows=db.prepare(`SELECT sub.id submission_id, sub.submitted_at, a.name athlete_name, a.athlete_id,
 s.session_no, s.title session_title, f.label question, f.unit, ans.answer
 FROM submissions sub JOIN athletes a ON a.id=sub.athlete_id JOIN sessions s ON s.id=sub.session_id
 LEFT JOIN answers ans ON ans.submission_id=sub.id LEFT JOIN fields f ON f.id=ans.field_id
 ORDER BY sub.submitted_at DESC, sub.id DESC`).all();
 if(q) rows=rows.filter(r=>`${r.athlete_name} ${r.athlete_id} ${r.session_no} ${r.session_title} ${r.question} ${r.answer}`.toLowerCase().includes(q.toLowerCase()));
 res.json(rows);
});
app.get('/api/admin/athlete-history/:id',requireAdmin,(req,res)=>{
 const athlete=db.prepare('SELECT * FROM athletes WHERE id=?').get(req.params.id); if(!athlete)return res.status(404).json({error:'Athlete not found'});
 const submissions=db.prepare(`SELECT sub.id,sub.submitted_at,s.session_no,s.title FROM submissions sub JOIN sessions s ON s.id=sub.session_id WHERE sub.athlete_id=? ORDER BY sub.submitted_at DESC`).all(athlete.id);
 const history=submissions.map(s=>({...s,answers:db.prepare(`SELECT f.label,f.unit,ans.answer FROM answers ans JOIN fields f ON f.id=ans.field_id WHERE ans.submission_id=? ORDER BY f.sort_order,f.id`).all(s.id)}));
 res.json({athlete:safeAthlete(athlete),history});
});
app.get('/api/admin/export.xlsx',requireAdmin,(req,res)=>{
 const athletes=db.prepare('SELECT name,athlete_id,phone,email,sport,goal,active,created_at FROM athletes ORDER BY name').all();
 const report=db.prepare(`SELECT sub.submitted_at AS 'Submitted At',a.name AS 'Athlete Name',a.athlete_id AS 'Unique ID',s.session_no AS 'Session Number',s.title AS 'Session Title',f.label AS 'Question / Metric',f.unit AS 'Unit',ans.answer AS 'Response' FROM submissions sub JOIN athletes a ON a.id=sub.athlete_id JOIN sessions s ON s.id=sub.session_id LEFT JOIN answers ans ON ans.submission_id=sub.id LEFT JOIN fields f ON f.id=ans.field_id ORDER BY sub.submitted_at DESC`).all();
 const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(athletes),'Athletes'); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(report),'Performance Data');
 const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'}); res.setHeader('Content-Disposition','attachment; filename="Elevate_Performance_Report.xlsx"');res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.send(buf);
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Elevate Performance Lab running on port ${PORT}`));
