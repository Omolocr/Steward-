# Church Connect (React Native / Expo, Android + iOS)

> **Hosting on Chajio Cloud from GitHub:** read [`deploy/CHAJIO.md`](deploy/CHAJIO.md) first. The `Dockerfile` at the top level is what Chajio builds. The server refuses to start in production until you confirm where its data is kept (`PERSISTENT_STORAGE=yes`, or `ALLOW_EPHEMERAL=yes` for a trial), because Chajio app hosting wipes local disk on every update.


Archive-only church app: nothing can be deleted, only archived (and restored). Every add/update/archive is written to an audit trail.

## Run it
```
npm install
npx expo start        # scan the QR code with Expo Go (Android/iOS)
npm run typecheck
```
`church-app-preview.html` is a standalone clickable preview (open in any browser).

## What is built
| Area | Where |
|---|---|
| Sign-up (name, role dropdown, old positions, ID, membership no., church, district, station, conference, county) | `src/screens/Auth.tsx` |
| One dashboard per role; former leaders get the Advisor dashboard | `src/screens/Home.tsx` |
| M-Pesa giving: code + name + purpose + amount + % split, auto-calculated, sent to Treasurer; Treasurer taps Received and the receipt is issued to the member | `src/screens/Money.tsx`, `src/services/payments.ts` |
| Notice boards: Church-wide, Group (approval workflow), Camp Meeting | `src/screens/Boards.tsx` |
| Membership (baptism / transfer with Church Board decision), Welfare funds, Church Building project, Minute Vault, Archive & Audit | `src/screens/Records.tsx` |
| Pastoral Care: daily/weekly messages with Listen (text-to-speech), sermon recorder, general + kids summaries | `src/screens/Care.tsx`, `src/services/sermon.ts` |
| Who may do what | `src/services/permissions.ts` |
| Archive-only store + audit log | `src/store/db.tsx` |
| **Church number sign-in, Church Admin console (members, settings, activities), Change church, 💬 chat to the app developer** | `src/screens/Auth.tsx`, `src/screens/Admin.tsx` |
| **App Developer Console** (up to 10 developers; create/clone churches; church numbers; support inbox), served by the server at `/console` | `server/console.html`, `server/console-api.mjs`, `server/platform.mjs` |

| **Office tools:** Sabbath School attendance register, Building Committee pledge tracker, Camp Meeting registration | `src/screens/Tools.tsx`, server `office` and `campreg` collections |
| **Push notifications** (receipts, notices, approvals, chat replies, role decisions) | `src/push.ts`, `server/providers.mjs` |

| **Church Admin bulk tools:** members to a spreadsheet, import a list (with a safe preview), printable directory | `src/screens/Admin.tsx`, `server/bulk.mjs` |
| **Developer Reports:** church health and monthly usage (counts only) | `server/console.html`, `server/console-api.mjs` |
| **First-run guide per role** (English and Kiswahili), also under **How this works** | `src/screens/Guide.tsx`, `src/data/guides.ts` |

## Church Admin tools for setting up a church
In **Church Admin → Export, import & directory**: download all members as a spreadsheet (CSV); import many members from a spreadsheet (you see a preview first, with problems flagged row by row, and nothing is saved until you confirm; up to 500 rows); print a **directory** (with or without phone numbers). Spreadsheet cells that start with `=`, `+`, `-` or `@` are made safe so they cannot run as formulas. Nothing is deleted: a member left out of an import is not touched.

## Developer Reports
In the developer console, **Reports** shows every church's health: *active* (activity in the last 2 weeks), *quiet*, *dormant* (over 2 months), *setup* (the Church Admin has not signed in yet), *paused* or *archived*, with last activity, members, payments counted and support messages waiting. You can pick a month and download the usage summary as CSV. It shows **counts only**: developers never see a church's money amounts, minutes, notices or member names there.

## First-run guide
The first time someone opens the app with a role (and again when their role changes, for example after the Secretary verifies their position), a short step-by-step guide for that role opens once. It can be skipped, and is always available from the **How this works** tile. It follows the EN | SW switch.

## Tools that save the Treasurer, Secretary and Clerk time
**Treasurer**
- **Confirm all verified:** in *Payments*, one tap receipts every payment M-Pesa has already confirmed (same code, same amount) and sends each member their receipt. Payments that are not verified or do not match are left for you to check. Needs M-Pesa checking switched on (`deploy/DEPLOY.md`, Step 8).
- **Reconciliation & Cash-up:** pick Today, Last 7 days, This month or Last month: what was receipted (by purpose), what reached the Pay Bill, payments nobody has reported yet, and what is still waiting. Download it as a spreadsheet.
- **Every member's giving statement for a year** in one spreadsheet (from *Monthly Report*).

**Secretary and Clerk**
- **Keep the roll:** on each member, *Roll actions and letters*: mark someone inactive, moved to another church (with where), deceased, or back to active. Every change keeps its history and the date; nobody is deleted.
- **Membership Roll:** members on the roll, by status, with baptisms, transfers received, moves out and deaths by year, and the whole roll as a spreadsheet.
- **Letters and certificates** with their own reference numbers (LTR-2026-0001), in English or Kiswahili, written to the audit trail: baptism certificate, letter of membership, transfer letter.
- **Minutes Builder (Secretary):** fill a few fields (date, venue, chair, present, agenda, resolutions, action items, next meeting) and get properly numbered minutes for the Minute Vault, or a notice of a meeting posted to the church board, in one tap.

**Everyone who waits on others:** gentle **reminders** (push) when something has waited over 2 days: payments for the Treasurer, people waiting to join for the Church Admin, leader positions for the Secretary, Pastor and Church Admin, transfer applications (3 days) for the Pastor. At most one per kind per day, daytime only (Kenya time), counts only. Set `REMINDERS=off` to switch them off (`REMINDER_AFTER_HOURS`, `REMINDER_EVERY_HOURS` change the timing).

**Pastor and Church Board:** **Annual Church Report** (giving by purpose and month, membership, Sabbath School, welfare, building and pledges, camp, church life) in English or Kiswahili. Totals only; no member's own giving is shown.

## Office tools (who can use them)
- **Sabbath School attendance:** the Sabbath School Department records each Sabbath (classes, roll, present, visitors, lesson); Pastor and Secretary can read it. One record per Sabbath; to correct one, archive it and record again.
- **Building pledges:** the Building Committee records pledges and payments against them (balance shown); Pastor and Secretary can read.
- **Camp meeting registration:** any member registers themselves (or family); the camp officers register others, set fees and cancel (archive); the Pastor sees everyone; a member sees only their own.

## Many churches (the App Developer's console)
One server can run many churches. The app developer (up to 10 people) opens `/console`, creates a church (a fresh, independent copy of the church console with the church's name written on it) and gives it a **special church number**. Every church has its own database file, so churches cannot see each other. People join a church by entering its number, and can **move** to another church with that church's number: their old membership is archived and everything they do afterwards belongs only to the new church. Each church has a **Church Admin** who adds and archives ("deletes") members, sets up giving and has a direct 💬 chat widget to the developers. Read `DEVELOPER-GUIDE.md`.

## Running the whole system
- **Try it on your computer:** `cd server && node --no-warnings server.mjs` (test mode: the SMS code is shown on screen), then `EXPO_PUBLIC_API_URL=http://<your-computer-LAN-IP>:8080 npx expo start`.
- **Put it online for the church:** follow `deploy/DEPLOY.md` (Docker, automatic HTTPS, SMS, sermon summaries, M-Pesa checking, daily backups, building the phone apps), then the dry run in `deploy/GO-LIVE-CHECKLIST.md`.

## What is in the server
- Phone-number login with SMS codes (Africa's Talking); the Treasurer's confirmation also texts the receipt to the member.
- Sermon summaries: the phone records and uploads; the server cuts long recordings, converts speech to text (OpenAI), and Claude writes a quick summary, a full summary (up to about 30 minutes of listening) and a children's version. See `server/providers.mjs`.
- Daily verified backups (`server/backup.mjs`), production safety checks, graceful shutdown, rate limits.

## What is NOT production-ready yet
1. **M-Pesa checking needs your Daraja setup.** The server code and registration tool are built and tested against a fake Safaricom (`deploy/DEPLOY.md`, Step 8); the real Safaricom has not been called. Without it the Treasurer confirms by hand. Put your real Pay Bill in `src/data/constants.ts` (`PAYBILL`).
2. Push notifications are built and tested against a stand-in push service, but not on a real phone yet (see `deploy/DEPLOY.md`, Step 9). If a phone refuses permission, the app still works and refreshes every 20 seconds.
3. The Docker image, Caddy HTTPS and the live Daraja / Africa's Talking / OpenAI / Anthropic services were not run where this was built. Start in sandbox modes and test one real sermon.

## Verification status
- **Run everything with one command:** `cd server && npm run test:all` (or `npm test` from the top folder). It runs all 22 test suites (about 660 checks) and fails if any suite fails or if a test file is not in its list, so nothing is forgotten. The permission-parity test needs TypeScript (`npm install -g typescript@5.8.3`, the version the project pins); it works with newer versions too. The suites:
  - `test.mjs` (68 core checks), `test-services.mjs` (26, sermons and SMS against stand-in services), `test-ops.mjs` (30, production safety, backup, restore, Docker files), `test-mpesa.mjs` (38, automatic M-Pesa verification), `test-smoke.mjs` (7, the live-server safety check), `test-reports.mjs` (40, statements, the monthly report, who sees which dashboard, office records), `test-console.mjs` (88, developer console, church numbers, tenant isolation, moving church, Church Admin, support chat), `test-parity.mjs` (the app's permission rules compared with the server's, 1,702 questions), `test-lang-push.mjs` (38, Kiswahili server messages and push), `test-office-tools.mjs` (45), `test-admin-tools.mjs` (35), `test-dev-reports.mjs` (19), `test-guide.mjs` (9), `test-reminders.mjs` (21), `test-yearly.mjs` (29), `test-clerk-tools.mjs` (66, Treasurer/Secretary/Clerk tools and safe retries), `test-sandbox.mjs` (16, team quick entry) and `test-routes.mjs` (20, every notification opens a real screen).
  - Run with `--experimental-strip-types` because they test the phone app's own TypeScript logic: `test-minutes.mjs` (9), `test-outbox.mjs` (25, offline queue), `test-quickcard.mjs` (12) and `test-sermon.mjs` (18, unfinished sermon recordings and the retry-limited follower).
- Mobile app: type-checked only against stand-ins for React / React Native (the package registry was unreachable here), and never run on a device. Run `npm install && npm run typecheck`, then try it in Expo Go, and expect small fixes. Recording and uploading a long sermon from a real phone needs a test on both Android and iPhone.


## Kiswahili and English
Every screen has a small **EN | SW** switch at the top right. The choice is remembered on the phone. All app texts live in `src/sw.ts` (key = the English text, value = the Kiswahili). A text with no Kiswahili entry simply shows in English. Please have a Kiswahili speaker at your church read `src/sw.ts` once and correct anything that does not sound right. Messages that come from the server (errors, SMS codes, receipts, notifications) are sent in each person's own language (the EN | SW choice is remembered on the server). The developer console stays in English.

## Team quick entry (no sign-in, for the developer and development team)

On a **sandbox** server (made-up data) every console has a reserved phone number that signs in with one tap, with no SMS code.
They appear as buttons on the phone app's sign-in screen and on the developer console's sign-in page.

| Console | Numbers |
|---|---|
| App Developer console (web, `/console`), team of 10 | `0700 000 001` to `0700 000 010` |
| Church App Admin console | `0700 000 101` |
| Leader dashboards (21, in the order of the sign-up list: Pastor 201, Treasurer 202, Secretary 203, Clerk 204, Sabbath School 205, Education 206, Elders 1 to 4 = 207 to 210, Camp Secretary 211, Camp Chairperson 212, Camp Clerk 213, Building 214, Special Groups 215, Dorcas 216, Men 217, Youth 218, Pathfinders 219, Adventurers 220, Choir 221) | `0700 000 201` to `0700 000 221` |
| Plain members | `0700 000 301` to `0700 000 305` |

Turn it on with `SANDBOX_ACCESS=yes`. It is a door with no lock, so **the server refuses to start if it is combined with
`PERSISTENT_STORAGE=yes`** (real church data). Only these reserved numbers work; every other number still needs an SMS code.
Each entry is written to the platform audit trail. For real churches, developers keep signing in with a code
(`DEVELOPERS=...`). To give the team access to a real server, use a separate sandbox deployment: same repository, `ALLOW_EPHEMERAL=yes`
and `SANDBOX_ACCESS=yes`.

## Before you build the phone apps (release settings)
Two values must be real, or push notifications and the server connection will not work:
```bash
npx eas init                                   # creates your Expo project and prints its project id
node scripts/configure-app.mjs --api-url https://api.yourchurch.org --eas-project-id <the id>
node scripts/check-release.mjs                 # says exactly what is still an example value
```
`eas build --profile production` runs that check itself and stops if anything is still an example value. A copy of the app that points at a developer address shows a "Test address" warning on its sign-in screen. On a real phone during testing use your computer's address (`EXPO_PUBLIC_API_URL=http://192.168.x.x:8080 npx expo start`); `10.0.2.2` only works on the Android emulator.

## Sermon recordings are never lost
The recorder copies each recording into the app's own storage and lists it **before** uploading. If the connection drops, the app is closed, or the phone restarts, the Sermon Recorder (and a notice in Pastoral Care) lists the unfinished recording with *Send now* / *Check progress*. Waiting on screen stops with a clear message after about two minutes without a connection (or 90 minutes of processing) and *Try again* resumes the same server job. The phone's copy is removed only after the summaries are made.

## Working without internet
Minutes, notices, activities, office records and Pastoral Care messages written with no connection are saved on the phone (`src/outbox.ts`) and sent automatically when the connection returns, in the order they were written. Each is sent with a one-off key so a retry can never post it twice. A refused item is kept with the reason and can be hidden. The Treasurer can also tap "Received" offline: it waits on the phone and, when sent, the server checks M-Pesa again and refuses (with the reason, shown in the outbox) anything it cannot verify, so nothing is receipted unchecked. Other money actions (giving, camp fees, bulk confirm) are never queued.

**Quick-start card:** *How this works* has a Share / print button that gives a one-page card of the role's steps (English or Kiswahili), for the notice board or WhatsApp. The last information received stays readable offline; nothing from the audit trail or unclaimed payments is kept on the phone. Signing out warns if items are unsent; they stay on the phone for that person only.

## Giving statements and the Treasurer's monthly report
- **Giving Statement** (every member): the year's receipted giving, totals by purpose, in English or Kiswahili. Tap *Share / print* to send it by WhatsApp or email, or print it. The Treasurer and Pastor can choose any member who has been receipted.
- **Monthly Report** (Treasurer, Pastor): receipts for a month with a column for each purpose and a totals row. *Share spreadsheet (CSV)* opens in Excel or Google Sheets. Server: `GET /statements/:year` and `GET /reports/monthly/:YYYY-MM`. Both are read-only, and names in the spreadsheet are protected so they cannot run as formulas.


## Who sees which dashboard
Every one of the 21 leader positions, the 6 groups, ordinary members and former leaders has a dashboard. Everyone sees: Give, Giving Statement, My Receipts, Church Notice Board, Camp Meeting Board (read), Building Project (read), Pastoral Care, and a Board + Activities calendar for each group they belong to. On top of that:
- **Every leader and former leader:** Welfare (read; only Treasurer, Secretary, Pastor and Dorcas Leader can add). **Every active leader** also gets their own Activities calendar and **Office Records**: reports, plans and minutes for their own office, archive-only. Only the owner writes them; the Pastor and Secretary can read every office.
- **Treasurer:** Payments Inbox, Monthly Report. **Secretary:** Verify Leader Positions, Membership, Minute Vault, Sermon Recorder, Archive & Audit. **Clerk:** Membership, Minutes (read). **Pastor:** all oversight screens, Transfers, Payments Overview, Monthly Report, Sermon Recorder.
- **Elders 1-4:** Post Motivation, Sermon Recorder, Membership (view), Minutes (read).
- **Camp Secretary / Chairperson / Clerk:** post on the Camp Meeting Board. **Building Committee:** add to the Building Project. **Sabbath School, Education, Special Groups:** their own calendars and the church notice board.
- **Group leaders (Dorcas, Men, Youth, Pathfinders, Adventurers, Choir):** their group board (with approval of member posts), calendar and member list.
Ordinary members do not see Welfare entries (they can still give to the Welfare fund from the Give screen). To change who sees what, edit `src/screens/Home.tsx` (tiles) and the `policy` block in `server/server.mjs`.
