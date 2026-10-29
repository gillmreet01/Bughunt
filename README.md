# BugHunt

BugHunt is a dark, responsive debugging practice platform for Python, Java and C++. Users inspect intentionally broken snippets, select a correction, request hints, and review explanations after submission. The app uses a vanilla HTML/CSS/JavaScript client, Express REST API, MongoDB/Mongoose persistence, and JWT authentication.

## College project abstract

BugHunt supports practical programming learning through short debugging exercises and progress feedback. It combines topic and difficulty based challenge discovery with server checked answers, persistent attempts, experience points, achievements, analytics and a leaderboard. A secured administrator interface supports challenge management.

## Problem statement and objectives

New programmers often learn syntax and concepts separately from the process of diagnosing mistakes. BugHunt gives learners repeated, explainable practice with realistic errors. Its objectives are to provide multi-language exercises, give immediate feedback, record progress, encourage consistent practice, and help instructors maintain content.

## Scope and requirements

The current scope includes account registration/login, challenge exploration, single choice submissions, hints, solution explanations, profile and password management, XP, streaks, achievements, progress summaries, leaderboard and admin challenge CRUD. Functional requirements include server-side answer checking and persisted attempt history. Non-functional requirements include responsive accessible controls, hashed passwords, authorization, validation, security headers, and environment based configuration. No arbitrary code is executed.

## Technology and architecture

- Client: HTML5, CSS3, vanilla JavaScript, Chart.js (CDN)
- Server: Node.js, Express, REST API
- Data: MongoDB and Mongoose
- Security: bcryptjs password hashing, JWT auth, Helmet, CORS allowlist and login rate limits

The client is served by Express. Protected API routes use bearer JWTs. Mongoose models separate users, challenges, attempts, achievements and user achievement unlocks. Challenge answer keys and solution details are excluded from public list/detail results and are returned only after a submission.

## Structure

```text
bughunt/
  client/          index.html, css/app.css, js/app.js
  server/          app.js, server.js, models.js
    seeds/          challenges.js, seed.js
  tests/            api.test.js
  .env.example
  package.json
```

## Database and scoring

Users store a bcrypt hash, role, XP, profile and activity streak. Challenges store language/topic/difficulty, four options, server-only answer index and solution, hints and reward. Attempts record every answer and correctness. XP is awarded once per user/challenge on the first correct answer: beginner 10, intermediate 20 and advanced 30. Wrong answers award zero. Hint requests are stored per user/challenge and copied into each submission attempt; they do not reduce XP. The streak uses calendar dates in `TZ` (default `Asia/Kolkata`) and advances at most once each local day. Achievements are evaluated on successful submissions.

## Prerequisites and setup

Install Node.js 18+ and either MongoDB Community Server or a MongoDB Atlas database. The app and seed command load `bughunt/.env` by resolving it from the config module, so the file is found even if the command is launched with a different current directory.

No `.env` file was present when this configuration was updated. Create one without replacing existing settings:

```sh
npm install
cp .env.example .env
# Edit .env and set MONGODB_URI and JWT_SECRET before running the app.
npm run seed
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env`. If `.env` already exists when you follow these steps, do not copy over it; edit only the missing settings. Open `http://localhost:3000` after the server starts.

### Configure MongoDB

- **Local MongoDB:** Install and start MongoDB Community Server, then set `MONGODB_URI` in `.env` to your local database URI. A typical local URI uses `mongodb://127.0.0.1:27017/bughunt`.
- **MongoDB Atlas:** Create a cluster and database user in Atlas, allow your current IP address in Network Access, choose **Connect → Drivers**, copy the URI Atlas provides, and put it in `.env`. Replace the username, password, and database name placeholders in that copied URI with your own values. Do not share or commit this URI.

Required variables are `MONGODB_URI` and `JWT_SECRET`. Set `JWT_SECRET` to a long, random secret used only by this app. Optional variables are `PORT` (defaults to `3000`), `CLIENT_ORIGIN` (defaults to `http://localhost:3000`), and `TZ` (defaults to `Asia/Kolkata`). `MONGODB_DNS_SERVERS` is an optional local workaround; it is blank by default and the application uses system DNS unless you configure it. The example file contains only safe placeholders. Missing required settings are reported before Mongoose is called. A refused or unavailable database produces a safe connection message without printing the URI. `.env` and other environment-specific secret files are excluded by `.gitignore`.

### MongoDB connection troubleshooting

Startup diagnostics classify invalid URIs, authentication failures, DNS/SRV lookup errors, explicit network access denials, timeouts, and unreachable hosts without displaying the URI or credentials. A `querySrv ECONNREFUSED` diagnostic means the configured DNS resolver refused the SRV lookup; BugHunt does not select public resolvers unless the optional local setting is provided.

For an Atlas DNS/SRV issue, verify the cluster hostname by copying a fresh driver URI from Atlas. The durable fix is to set DNS on the Windows network adapter using a resolver approved for your network. In **Settings → Network & internet → Wi-Fi or Ethernet → DNS server assignment → Edit**, select Manual and configure IPv4. If your network policy permits it, the public DNS servers tested for this setup are `1.1.1.1` and `8.8.8.8`. This changes DNS for Windows generally, and those DNS providers will receive your DNS queries; use your organization or VPN's approved DNS on managed networks. You can also configure an adapter from an elevated PowerShell window after checking the correct interface index:

```powershell
Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object Name, InterfaceIndex
Set-DnsClientServerAddress -InterfaceIndex <IFINDEX> -ServerAddresses ('1.1.1.1', '8.8.8.8')
ipconfig /flushdns
```

To restore DNS supplied by DHCP later, use `Set-DnsClientServerAddress -InterfaceIndex <IFINDEX> -ResetServerAddresses`. For Atlas access denials/timeouts, add the current public IP in Network Access and check outbound firewall rules. For authentication failures, confirm the database user and URL-encode reserved characters in its password.

If Windows will not allow an adapter DNS change, a **temporary local workaround** is available. Set `MONGODB_DNS_SERVERS` in `.env` to comma-separated resolver IPs you have verified and are allowed to use. This setting changes DNS resolution for the Node.js process, may bypass VPN or split-DNS policy, and sends queried hostnames to those resolvers; deployment must configure its own approved value. Remove the setting once system DNS works. Do not set public resolvers as a production default.

Verify that both Windows and Node.js can resolve the Atlas SRV record, then seed from the BugHunt project directory:

```powershell
Resolve-DnsName -Type SRV _mongodb._tcp.cluster0.kce92b5.mongodb.net
node -e "require('node:dns').promises.resolveSrv('_mongodb._tcp.cluster0.kce92b5.mongodb.net').then(rows => console.log('SRV records:', rows.length)).catch(error => { console.error('SRV lookup failed:', error.code); process.exitCode = 1; })"
npm run seed
```

The Node command prints the record count or an error code, not the targets. Do not paste or print `.env` values when troubleshooting.

## Seed and create an administrator

`npm run seed` idempotently inserts 30 challenges (10 per language) and achievement definitions without resetting user data. Register a local account, then promote it from the MongoDB shell:

```javascript
use bughunt
db.users.updateOne({ email: "your-local-email@example.com" }, { $set: { role: "admin" } })
```

Sign out and back in so the new role is present in the JWT. Registration never accepts a role from the client.

## API summary

- Auth: `POST /api/auth/register`, `/login`, `/logout`; `GET /api/auth/me`
- Challenges: `GET /api/challenges`, `GET /api/challenges/:id`, `POST /api/challenges/:id/hint`, `/submit`
- User: `GET /api/dashboard`, `/api/progress`, `/api/leaderboard`, `/api/achievements`, `/api/achievements/me`, `/api/profile`; `PATCH /api/profile`, `/api/profile/password`
- Admin: `GET /api/admin/stats`, `/analytics`, `/users`, `/users/:id`, `/challenges`, `/challenges/:id`, `/achievements`; `POST /api/admin/challenges`, `/achievements`; `PATCH` and `DELETE` `/api/admin/challenges/:id`; `PATCH` and `DELETE` `/api/admin/achievements/:id`

Protected endpoints require `Authorization: Bearer <token>`. Pagination and filters are accepted by `GET /api/challenges` (`language`, `difficulty`, `topic`, `search`, `solved`, `page`, `limit`).

## Tests and verification

Run `npm test` for the Node built-in test runner. The included tests cover startup configuration from an unrelated working directory, safe failure when MongoDB is unavailable, health/static routes, access guards, seed content, and XP rules. Database backed auth and browser flows require a configured MongoDB instance and have not been verified in this workspace. Manual browser checks: register, log in, filter challenges, request a hint, submit correct/incorrect options, inspect dashboard/progress/leaderboard, then promote an account and check admin CRUD.

## Screenshots

No screenshots are included yet.

## Limitations and future enhancements

There is no email verification, refresh token rotation, daily XP history chart, or automated Mongo-backed integration suite. Chart.js is loaded from a CDN. Future work can add isolated code execution, instructor cohorts, additional languages, and database integration/end-to-end tests. Arbitrary code execution is intentionally absent.

## Admin dashboard

Start the app with `npm run dev`, sign in with an account whose role is `admin`, then choose **Admin** in the top navigation. The dashboard is served by the existing single-page client. Each admin API request validates the signed JWT and rechecks the account role in MongoDB; editing browser storage cannot grant access. Public registration does not accept a role.

The dashboard provides database-backed summary counts, daily registration and submission trends, correct-versus-incorrect submissions, language activity, most-attempted challenges with unique-learner completion rates, XP distribution, recent submissions, and recent registrations. Challenge management supports search, language/difficulty/status filters, pagination, view/edit/create, and deactivation. Deactivation preserves attempts and progress. Users can be searched, sorted and paginated; administrators can inspect XP, streak, registration date and attempt history. User records are read-only because the existing model has no account suspension or deletion lifecycle. Achievement definitions can be listed, created, and edited; deletion is blocked when any user award references the definition. The current Achievement schema has no editable reward criteria, so the dashboard leaves award rules unchanged.

To promote the first administrator, use the existing trusted local database procedure above, then sign out and back in so the new signed token contains the assigned role. Do not add a public promotion route or expose a database URI. The dashboard does not provide role editing, account deletion or account suspension.

Run `npm test` to execute the API authorization, dashboard, management and existing regression tests. Admin dashboard data requires the configured MongoDB connection; automated admin route tests stub model queries and do not claim a live database connection.
