# Elevate Performance Lab

A deployable website and athlete data portal for Elevate Athletics Academy.

## Included
- Premium landing page with animated logo intro (3.4 seconds)
- Athlete / admin unique-ID login
- Admin athlete management (create, deactivate, delete)
- Assigned training sessions and Everyone sessions
- Custom session fields (text, number, long answer, date, time) with optional units
- Athlete multi-session submissions
- Admin progress report search
- Athlete history lookup, including all prior submissions
- Excel export with Athletes and Performance Data sheets
- SQLite database with persistent storage when deployed to Render

## Run locally
1. Install Node.js 20+.
2. Open this folder in VS Code.
3. In Terminal run:
   ```bash
   npm install
   ```
4. Copy `.env.example` to `.env` and set `ADMIN_ID` to a unique secret ID. Set a long `SESSION_SECRET`.
5. Run:
   ```bash
   npm start
   ```
6. Visit http://localhost:3000

For local development, the default database path is `./data/elevate.db`. The `.env.example` currently shows Render's DB path; change DB_PATH locally to `./data/elevate.db` or remove it from `.env`.

## Deploy on Render
1. Push this folder to a GitHub repository.
2. In Render choose **New → Blueprint** and connect the repository. Render reads `render.yaml`.
3. When asked, set `ADMIN_ID` to a unique secret value that only the owner knows (example format: `EPL-OWNER-<random>`). Never give this ID to athletes.
4. Deploy. The service uses `/var/data/elevate.db` on a persistent disk so records survive restarts and redeploys.
5. Use the Render URL to access the site.

## Admin access
Admin is identified by the secret `ADMIN_ID` environment variable. Change it any time in Render Environment settings and redeploy/restart. Athlete IDs are created in the Admin → Athletes screen.

## Database & backups
SQLite lives at `DB_PATH`. On Render, it is stored on the mounted persistent disk. Export the Excel workbook regularly from the Admin dashboard. The Excel file is an export/backup—not the live database. For an additional backup, download the database file from the persistent disk or set up scheduled backups before production use.

## Custom social links
Instagram, Facebook, Reddit and LinkedIn links are placeholders in the footer. Replace the click handlers/anchors in `public/index.html` and `public/app.js` once official URLs are provided. YouTube and Google Business links are already connected to the available references.

## Important before public launch
- Change the admin ID and session secret.
- Share athlete IDs individually; they currently act as login credentials.
- Confirm privacy/consent wording for athletes and, where applicable, guardians.
- Add a backup routine and review access/security policies if storing sensitive athlete information.
- Social media URLs are not confirmed and remain placeholders.
