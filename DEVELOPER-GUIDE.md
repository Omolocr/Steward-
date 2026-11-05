# App Developer's guide: running Church Connect for many churches

This is for **you, the app developer**. Each church that uses the app is a *client*. Every client gets its own independent copy of the church console, with the church's name written on it, and is linked to your platform only through a **special church number** that you assign.

## The picture in one minute
```
            App Developer console  (/console, up to 10 developers)
        create church · assign church number · appoint admin · pause/archive · answer support chat
                                 │
      ┌──────────────────────────┼──────────────────────────┐
 Church A (482-7391)       Church B (731-5046)         Church C ...
 own database file         own database file           own database file
 own members, money,       own members, money,         (nothing is shared:
 minutes, boards           minutes, boards              no church can see another)
 Church Admin console      Church Admin console
 + 💬 chat to you          + 💬 chat to you
```
- **Independent:** each church has its own database file (`data/churches/<id>.db`). A request opens exactly one church, so a bug or a wrong click cannot show one church's data in another.
- **Linked by the church number:** 7 digits, written like `482-7391`. The last digit is a check digit, so a mistyped number is caught before the server is even asked. The number identifies the church; it is **not a password**: new people still need the Church Admin to let them in (switchable in the church's settings).
- **Archive-only everywhere:** churches, developers, members, bindings and chat messages can be archived and restored, never deleted.

## 1. Open the Developer Console
Start the server with the first developers' phone numbers:
```
DEVELOPERS="0711111111:Amina,0722222222:Brian"
```
then open `https://your-address/console` and sign in with an SMS code. **Up to 10 developers can be active at once.** Add or archive people under **Team**. (Archiving frees a place; nobody is deleted. You cannot archive yourself.)

You can try everything without a server: open `server/console.html` straight from the folder; it runs in **DEMO** mode with sample data (phone `0700000001`, code `123456`).

## 2. Create a church ("clone the client console")
**New church** → write the **church name** (this is what is written on that church's console and receipts), the Church Admin's phone, district, station, conference, county. Choose what to copy settings from (the standard template, or an existing church: Pay Bill format, giving categories, language). Leave the number empty to have one generated, or type your own (it is checked).
You get the **special church number**. Give it to the Church Admin (and the church secretary can tell members).

What the new church starts with: its own empty database, the standard roles and dashboards, your settings template. What it never gets: any other church's data.

## 3. The Church Admin
The phone you gave as the admin becomes the **Church Admin** the first time it signs in with the church number. The Church Admin console lets them:
- see the **church number**, member counts, people waiting to join, positions to verify;
- **add members**, change their position, and **"delete" = archive** (restorable) members; approve or decline people who joined with the church number;
- **verify leader positions** (so the church's first Secretary and Pastor can be approved without you);
- set the church's **Pay Bill, account name, giving categories, language, motto**;
- plan and archive church activities and post/archive on the church notice board;
- open the **💬 chat widget**: a direct line to you.
The Church Admin deliberately does **not** see the Treasurer's money screens, the Minute Vault or welfare entries. Those stay with their offices.

> You asked for admins to "delete" members and activities. To keep the church's "nothing is ever deleted" rule, **delete means archive**: the person or activity disappears from daily lists, the history stays, and it can be restored. If you ever truly need data removed (for example a legal request), do it deliberately on the server, not from the app.

## 4. Members: joining and moving
- **Joining:** at sign-up a new person enters the church number, sees the church name to confirm, then fills the usual profile. They wait on an *Almost there* page until the Church Admin lets them in.
- **Moving:** *Change church* on the dashboard: enter the new church's number, confirm with a fresh SMS code. The old membership is **archived** (the old church keeps its history), the phone is bound to the new church only, and from then on everything the person does is linked **only** to the new church. A leader position must be **verified again** at the new church. A Church Admin cannot move away until you appoint another admin (ask via chat).
- A phone belongs to **one church at a time**. If a church admin tries to add a number that belongs to another church, they are told to ask the person to move with the church number.

## 5. Support chat
Each church has one thread with the developer team. In **Support** you see every church with an unread count; open one to read and reply. All 10 developers see the same thread. Messages cannot be edited or deleted. The church's admin sees a numbered badge on the 💬 button.

## 5b. Reports: is each church alive?
Open **Reports** in the console. Each church shows a health label: *setup* (the Church Admin has not signed in yet: nudge them by chat), *active*, *quiet* (no activity for 2 weeks), *dormant* (2 months), *paused* or *archived*. Pick a month for the usage counts and download them as CSV. The reports show **counts only**; you never see a church's money, minutes, notices or member names.

## 5c. Helping a new church get started
Tell the Church Admin about **Export, import & directory** (Church Admin → Members): they can upload their existing member list as a spreadsheet (a preview shows any problems before anything is saved) and print a directory. Everyone sees a short guide for their role on first sign-in, in English or Kiswahili.

## 6. Pausing and archiving a church
**Pause** blocks sign-in (people see *This church account is paused*); **Resume** brings it back. **Archive** hides the church; **Restore** returns it. Data is never deleted.

## 7. Two ways to run it
| Mode | Set | What happens |
|---|---|---|
| **Platform** (many churches) | `DEVELOPERS=...` (no `DEFAULT_CHURCH`) | Everyone enters a church number. You create churches in the console. |
| **One church** | `DEFAULT_CHURCH="Your Church Name"` (and `BOOTSTRAP=...`) | No church-number step. An older single-church database is adopted automatically as that church. You can still add more churches later. |

In platform mode `BOOTSTRAP` does nothing: a church's first Secretary and Pastor sign up, then the Church Admin approves their positions.

## 8. Money and Pay Bills
Each church sets its own Pay Bill in its settings, and members see that number on the Give page. Automatic M-Pesa checking matches an incoming Daraja payment to the church whose Pay Bill is that shortcode, so **each church's Pay Bill must be different**. Remember Safaricom needs its own Daraja registration for each Pay Bill (see `deploy/DEPLOY.md`, Step 8).

## 9. Backups
`server/backup.mjs` copies `platform.db`, **every** church database and the sermon recordings, checks each copy, and keeps the last `BACKUP_KEEP` snapshots. One snapshot restores the whole platform.

## What has been tested, honestly
Server: tenant isolation, church numbers (including bad check digits), the 10-developer limit, creating/cloning churches, binding and moving, join approval, Church Admin permissions, the support chat, and that nothing can be deleted: `node --no-warnings test-console.mjs` (88 checks). The app's permission rules and the server's rules are compared question by question (`test-parity.mjs`). The app has only been type-checked against stand-ins, never run on a phone.
