# Your original request, point by point

"Server" = built and automatically tested. "App" = written and type-checked, **not yet run on a phone**. "Preview" = you can try it in `church-app-preview.html`.

| # | You asked for | Where it is | Status |
|---|---|---|---|
| 1 | No deleting, only archiving | Database refuses deletes; no delete button anywhere; audit log of every change | Server + App + Preview |
| 2 | Receive and record church money collections via M-Pesa Pay Bill | Give screen, Payments Inbox, optional automatic M-Pesa checking | Server + App + Preview (M-Pesa itself untested with Safaricom) |
| 3 | Member sends code, M-Pesa name, purpose, amount, percentage split | Give screen; server recalculates the split and requires 100% | Server + App + Preview |
| 4 | Treasurer taps Received, receipt goes back automatically | Receipt in the member's app + SMS | Server + App + Preview (SMS untested with the real provider) |
| 5 | Church-wide notice board: all leaders post, only Secretary archives | Church Notice Board | Server + App + Preview |
| 6 | Group boards: leader posts freely; leaders and members post after the group leader approves; group leader or Secretary archives | Each group's board | Server + App + Preview |
| 7 | Camp meeting board: camp leaders and Pastor post | Camp Meeting Board | Server + App + Preview |
| 8 | Membership by baptism or transfer; kept by Secretary and Clerk; transfers go to the Church Board led by the Pastor | Membership, Join by Transfer | Server + App + Preview |
| 9 | Welfare: Burial and Benevolent Fund, funeral, hospital/sickness, special situations, Pastor appreciation | Welfare (every leader can read; Treasurer, Secretary, Pastor, Dorcas Leader add) | Server + App + Preview |
| 10 | Church Building project | Building Project (everyone reads; Building Committee and Treasurer add) | Server + App + Preview |
| 11 | Minutes kept by the Secretary in the Minute Vault | Minute Vault (Secretary writes; Pastor, Clerk, Elders read) | Server + App + Preview |
| 12 | Dashboards for all church groups (Dorcas, Men, Youth, Pathfinders, Adventurers, Choir) | Board + Activities for members; plus Members list for the leader | Server + App + Preview |
| 13 | Dashboards for all leaders (Treasurer, Secretary, Clerk, Sabbath School, Education, Pastor, Elders 1-4, Camp Secretary/Chair/Clerk, Building Committee, Special Groups) | Each has its own dashboard, activity calendar and Office Records | App + Preview |
| 14 | Sign-up: name, role (leader dropdown or member), old positions, ID, optional membership no., church, district, station, conference, county | Sign-up after the SMS code | Server + App + Preview |
| 15 | A dashboard strictly for the chosen role | Leader positions are verified by the Secretary or Pastor first; until then the person sees the member dashboard | Server + App + Preview |
| 16 | Former leaders get advisory/assisting roles | Former Leader (Advisor) dashboard: read access, Welfare, Archive library | Server + App + Preview |
| 17 | Pastoral Care: daily/weekly motivation from the Pastor and leaders, with audio | Pastoral Care, Listen button | App + Preview |
| 18 | Sermon summary the moment recording stops: quick summary, then 20-30 minute summaries for the general church and for kids | Sermon Recorder: quick, full and kids summaries | Server (tested with stand-in AI) + App (never recorded on a real phone) |
| 19 | (Added by me) Kiswahili/English switch, giving statements, Treasurer's monthly spreadsheet, Office Records | EN/SW switch on every screen, Giving Statement, Monthly Report, Office Records | Server + App + Preview |
| 20 | App Developer's console, up to 10 users | `/console`: sign in by SMS code, Team capped at 10 active (archive frees a place) | Server + browser page (88 server checks; page tested in a browser) |
| 21 | Clone the client console and write the church's name on it; every client independent | New church = its own database file and settings copied from a template or another church; the church name appears on its console, receipts and dashboard | Server + App + Preview |
| 22 | Each client linked to its church by a special church number assigned by the developer | 7-digit number with a check digit, entered at sign-up | Server + App + Preview |
| 23 | A user can move church; afterwards activity is linked only to the new church | *Change church*: new number + fresh SMS code; old membership archived, leader position re-verified | Server + App + Preview |
| 24 | Church App Admin console: add or delete members and activities | Members (add, change position, **archive = delete, restorable**), approve people who joined, church settings, activities. Delete means archive to keep the no-deleting rule | Server + App + Preview |
| 25 | Direct line to the app developer via a widget | 💬 chat in the Church Admin's app; Support inbox in the developer console, shared by all developers | Server + App + Preview |

| 26 | Server messages, SMS and receipts in Kiswahili | Each person's language is kept on the server; errors, SMS codes, receipts and notifications arrive in it | Server + App (38 checks) |
| 27 | Office tools: Sabbath School register, building pledges, camp registration | Per-office screens with their own permission rules | Server + App + Preview (45 checks) |
| 28 | Push notifications | Receipts, notices, approvals, chat replies, role decisions; works with a stand-in push service | Server + App (not yet on a real phone) |
| 29 | Church Admin bulk tools | Members to CSV, import with preview (max 500, formula-safe), printable directory | Server + App + Preview (35 checks) |
| 30 | Developer reports | Church health and monthly usage, counts only, CSV | Server + Console (19 checks) |
| 31 | First-run guide per role (EN/SW) | Shown once per role, skippable, always under *How this works* | Server + App + Preview (9 + 9 checks) |
| 32 | Treasurer tools: confirm all verified, reconciliation and cash-up, all members' statements | Server + App + Preview (66 checks shared with 33-34) |
| 33 | Secretary and Clerk tools: roll status with history, roll statistics and export, letters and certificates with reference numbers | Server + App + Preview |
| 34 | Minutes Builder (minutes or meeting notice from a few fields) | App + Preview (9 + 31 checks) |
| 35 | Reminders when something has waited too long | Server (21 checks) |
| 36 | Annual Church Report for the Pastor and Church Board | Server + App + Preview (29 checks) |
| 37 | Offline mode: write minutes, notices, activities, office records and care messages without internet; the Treasurer's "Received" too (re-checked against M-Pesa when sent); refused items kept with the reason | App + Preview (25 + 33 checks) |
| 38 | Printable quick-start card per role (EN/SW) | App + Preview (12 + 8 checks) |
| 39 | Team quick entry: reserved test numbers (10 developers, Church Admin, 21 leaders, 5 members) sign in with no code on a sandbox server only; refused with real-data mode | Server + App + Console + Preview (16 + 9 checks) |
| 40 | VPS deployment: one-command setup (`setup-vps.sh`), update with safety backup (`update.sh`), tested restore tool (`restore.sh`: checks the backup first, keeps old data aside, never deletes) | Server (test-ops 30 checks) + scripts |
| 41 | Audit fixes: permission-parity test works with any TypeScript version; reminder notification taps open Membership / Leader approvals / Members (new test-routes); sermon recordings saved before upload and recoverable after restart; retry-limited follower with Try again; release check + configure scripts for EAS id and server address; `npm run test:all` | Server + App (test-routes 20, test-sermon 18) |

## Still to be checked by real use
- The app on real Android and iPhone devices.
- Safaricom M-Pesa, SMS and the AI summaries with your real accounts and keys (see `deploy/GO-LIVE-CHECKLIST.md`).
- Kiswahili wording, by a Kiswahili speaker at your church.
- Your real Pay Bill number in `src/data/constants.ts`.
