# Cricket Scoreboard — Hostinger Premium (PHP + MySQL)

This version is designed for Hostinger Premium Web Hosting. It uses PHP (PDO) and MySQL; it does not require Node.js, npm, SSH, or a background process.

## 1. Create the MySQL database
1. Sign in to Hostinger hPanel.
2. Open **Databases → Management** (the menu wording may vary).
3. Create a MySQL database and database user; assign the user to the database with full privileges.
4. Keep the database name, username, and password for the next step.

## 2. Configure the app
1. Upload the contents of this project into the website's `public_html` directory (or a subdirectory such as `public_html/score`).
2. Ensure PHP 8.0+ with PDO MySQL enabled.
3. In `config/`, copy `config.example.php` to `config.php`.
4. Edit `config.php`: enter the database name, database username, database password, and replace the admin password with a long unique password.
5. Do not upload `config.php` to a public repository. The `config/.htaccess` file blocks direct web access on Apache.

## 3. Create the table
1. In hPanel open **phpMyAdmin** for the database.
2. Select the database, open the **Import** tab, and import `schema.sql`.
3. If this is an existing installation, take a database backup before deploying. The first data API request after deployment migrates legacy `matches.state_json` records into match, roster, innings, and delivery rows, then removes the legacy JSON column. Keep the backup until you have verified saved matches and scorecards.

## 4. Open the app
Visit `https://your-domain.com/` (or the subdirectory where you uploaded it). Sign in with the admin password configured in `config.php`.

The app uses direct routes for `/matches`, `/matches/new`, `/matches/{id}`, `/matches/{id}/edit`, and `/login`. Apache's included `.htaccess` rewrites these routes to the app shell; older `#m={id}` match links are still supported. Frontend route definitions, navigation, and application code are organized under `assets/js/`.

The API is available under `/api/`: auth uses `/status`, `/login`, and `/logout`; matches use `/matches` and `/matches/{id}`; players use `/players` and `/players/{id}`; scoring actions use `/matches/{id}/{action}`. Legacy `api/index.php?action=...` requests remain supported. Every API response uses `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code": "...", "message": "..." } }`.

## Included
- Create matches with team names, player count, overs and batting-first selection.
- Player numbers instead of player names.
- Daily team-pair series summaries with completed win totals and series margins.
- Runs, wides, no-balls, byes, leg-byes and penalty extras.
- Wicket and dismissal type entry.
- Live innings total, wickets, overs, run rate, extras and legal-ball count.
- Basic batting and bowling tables, recent deliveries, live delivery editing and undo-last-delivery.
- Saved matches stored in MySQL.
- Match metadata, team rosters, innings, and deliveries stored in indexed relational tables; JSON is used only for the API request/response format.

## Important limitations
This is a starter scoring application, not a fully validated official scoring engine. It currently supports one innings per match and one admin login. Strike rotation, end changes, full bowling legality, run-outs involving non-strikers, retired hurt/retired out rules, partnerships, fall of wickets, second innings/target calculation, and match result are not fully implemented. Deliveries can be edited only while a match is live and unlocked. Validate the scoring logic before using it for an official match. Use HTTPS and a strong admin password. For multiple scorers or public live score viewing, add role-based authentication and a proper event/audit model.

## Troubleshooting
- **Setup required:** create `config/config.php` from `config.example.php`.
- **Database connection failed:** verify database host (usually `localhost` on Hostinger), database name, user and password.
- **Sign-in fails:** verify the configured admin password.
- **Blank page / HTTP 500:** enable PHP error logging in hPanel and inspect the domain's PHP error log. Do not expose PHP errors publicly on a live site.
