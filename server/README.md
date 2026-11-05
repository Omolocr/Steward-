# Church Connect API

Zero-dependency Node 22+ server with a built-in SQLite database.

```
BOOTSTRAP="0711111111:secretary,0722222222:pastor" TOKEN_SECRET="a-long-random-string" node --no-warnings server.mjs
node --no-warnings test.mjs     # 68 end-to-end checks
npm run test:all                # ALL test suites (about 660 checks); fails if any suite fails or a test file is not listed
```

## How the rules are enforced (on the server, not just in the app)
- **Archive-only:** no DELETE route (returns 405) and SQLite triggers refuse `DELETE` on records, users and the audit log; the audit log also refuses edits.
- **Login:** phone number + 6-digit SMS code, 10-minute expiry, 5 tries, signed 30-day token. In dev mode the code is returned in the response; in production set `NODE_ENV=production` and implement `sendSms()` (Africa's Talking / Twilio).
- **Role verification:** anyone can *ask* for a leader position, but they act as a plain member until the Secretary or Pastor approves (`POST /users/:id/role-decision`). Nobody can approve their own role. `BOOTSTRAP` pre-approves the first Secretary and Pastor.
- **Payments:** the server recomputes the split, rejects totals not equal to 100%, rejects duplicate M-Pesa codes, and forces owner/status. `POST /payments/:id/receive` (Treasurer only) issues the numbered receipt, and Church Building / Welfare shares are posted to those records, all in one transaction.
- **Boards:** church board (leaders post, Secretary archives), group boards (leader posts freely, others pending until the leader approves; non-members cannot see them), camp board (camp leaders + Pastor).
- **Visibility:** members only see their own payments and receipts; membership, minutes and welfare are limited to the roles that keep them.

## Endpoints
`POST /auth/request-otp` · `POST /auth/verify` · `GET /me` · `GET /users` · `GET /users/pending-roles` · `POST /users/:id/role-decision` · `POST /users/:id/archive` · `GET|POST /records/:collection` · `POST /records/:collection/:id/archive|restore` · `POST /payments/:id/receive` (body `{confirmAnyway: true}` to override an M-Pesa warning) · `POST /notices/:id/approve` · `POST /memberships/:id/decide` · `GET /finance/unclaimed` · `GET /audit` · `GET /health`
M-Pesa (called by Safaricom, protected by the secret in the address): `POST /hooks/c2b/:secret/validation` · `POST /hooks/c2b/:secret/confirmation`

Collections: notices, payments, receipts, memberships, welfare, projects, minutes, care, sermons, activities, office.

## Many churches: developer console and Church Admin (added)
`platform.db` holds the churches, church numbers, developers, phone-to-church bindings, support chat and the platform audit log; every church has its own database file under `churches/`. A request runs inside one church only.
- Developer (JWT with `dev`, up to 10 active): `POST /dev/login` · `GET /dev/me` · `GET|POST /dev/team` · `POST /dev/team/:id/archive|restore` · `GET|POST /dev/template` · `GET|POST /dev/churches` · `GET /dev/churches/:id` · `POST /dev/churches/:id/update|admin|status` · `GET /dev/audit` · `GET /dev/support` · `GET|POST /dev/support/:churchId` · `GET /console` (the web page).
- Church Admin: `GET /admin/overview` · `GET|POST /admin/members` · `POST /admin/members/:id/join|archive|restore|role` · `POST /admin/settings` · `GET|POST /admin/support`.
- Members: `POST /auth/lookup` (is this phone already bound? what is the church called?) · `POST /auth/verify` (new people send `churchNumber`) · `POST /me/move`.
- Env: `DEVELOPERS="phone:Name,..."`, or `DEFAULT_CHURCH="Name"` for a single-church install. `node --no-warnings test-console.mjs` (88 checks).

## Before going live
- Follow `../deploy/DEPLOY.md`, then the dry run in `../deploy/GO-LIVE-CHECKLIST.md`, using the Africa's Talking and Daraja sandboxes first.
- `node smoke-test.mjs https://your-address` checks a running server's safety settings (see DEPLOY.md, Step 5).

## Sermon summaries, SMS, backups (added)
- `POST /sermons/jobs` (audio body `audio/*` with `X-Title`/`X-Preacher` headers, or JSON `{title, preacher, transcript}`), `GET /sermons/jobs/:id`, `POST /sermons/jobs/:id/retry`, `GET /sermons/jobs/:id/transcript`.
- Settings are environment variables; see `../deploy/.env.example`.
- `node backup.mjs` makes a verified backup. `mpesa-register.mjs` tells Safaricom where to send payment notices (DEPLOY.md, Step 8).
- Test suites (all use stand-in services, no keys needed): `test.mjs`, `test-services.mjs`, `test-ops.mjs`, `test-mpesa.mjs`, `test-smoke.mjs`, `test-reports.mjs`; run each with `node --no-warnings <file>`.
- Hosting: see `../deploy/DEPLOY.md`.


## Statements and reports (read-only)
- `GET /statements/:year[?memberId=…][&lang=sw]` – a member sees their own; Treasurer/Pastor can see any member. Returns items, totals and printable text.
- `GET /reports/monthly/:YYYY-MM` – Treasurer/Pastor only. Returns totals and `csv` (opens in Excel; starts with a BOM so Kiswahili/accents display correctly).
- Tests: `node --no-warnings test-reports.mjs` (40 checks).
