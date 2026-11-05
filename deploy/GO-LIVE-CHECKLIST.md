# Go-live checklist: the dry run

Do this on your real server **before** inviting members, with Africa's Talking and Safaricom in **sandbox** mode. It takes about half a day, needs a few people, and is meant to find problems while they are cheap. Tick each box. If a step fails, stop and fix it before moving on.

**Who you need:** whoever sets up the server (the *admin*), the Secretary, the Pastor, the Treasurer, and two ordinary members, each with their own phone (ideally one Android and one iPhone).

> Sandbox note: in Africa's Talking sandbox mode, SMS messages appear in their **simulator** in your account, not on real phones. Read codes from there.

---

## 1. The server is safe (admin)

- [ ] `docker compose ps` shows `app`, `caddy` and `backup` running.
- [ ] `https://api.yourchurch.org/health` opens in a browser and shows `"ok":true`.
- [ ] `docker compose run --rm app node smoke-test.mjs https://api.yourchurch.org` ends with **LOOKS GOOD**.
- [ ] The server restarts by itself: run `sudo reboot`, wait 3 minutes, then check `/health` again.
- [ ] `.env` is saved somewhere safe (a password manager), and **two people** know where. If only one person has the keys, the church depends on that person.

## 2. Signing in and roles (Secretary, Pastor, members)

- [ ] The Secretary signs up with the `BOOTSTRAP` number. The SMS code arrives, and the home screen says **Church Secretary**.
- [ ] The Pastor does the same and sees **Pastor**.
- [ ] Member A signs up as a plain **Member**, joins the Dorcas group, and sees only the member dashboard.
- [ ] The Treasurer signs up choosing **Church Treasurer**. They see a yellow *"Position awaiting verification"* notice and a **member** dashboard, not the Payments Inbox.
- [ ] The Secretary opens **Verify Leader Positions** and approves the Treasurer. Within about 20 seconds the Treasurer's dashboard changes to the Treasurer's (Payments Inbox, Welfare, Building Project).
- [ ] A member who ticks an old position (for example "Church Elder 1") but chooses Member gets the **Former Leader (Advisor)** dashboard.
- [ ] Signing out and back in with the SMS code works; the app remembers the person after being closed and reopened.

## 3. Archive-only and permissions (spot checks)

- [ ] Nobody can find any "Delete" button anywhere in the app.
- [ ] The Pastor posts on the **Church Notice Board**. A plain member **cannot** post there.
- [ ] A Dorcas member posts on the **Dorcas board**: it shows *Submit for approval*. A Dorcas leader (create one and approve their position) approves it, and then other Dorcas members see it. A member of another group **cannot see** the Dorcas board.
- [ ] The Secretary **archives** a church notice. It disappears for members and appears under **Archive & Audit**, where the Secretary can restore it.
- [ ] The Treasurer **cannot** archive a church notice. A member cannot open the **Minute Vault** or **Membership**.
- [ ] The Secretary adds minutes to the Minute Vault; the Pastor can read them.

## 4. Giving, M-Pesa and receipts (Treasurer, members)

Turn on M-Pesa checking first (DEPLOY.md, Step 8), then run the smoke test again with `--mpesa-secret`. Use the Daraja **C2B simulator** to make test payments to your sandbox Pay Bill.

| Test | What to do | What should happen |
|---|---|---|
| **Matching payment** | Simulate a payment of 1,000. Member A reports its code with amount 1,000 and a 10 / 20 / 70 split. | Treasurer sees **✓ Verified by M-Pesa**. One tap on **Received** → Member A gets the receipt in the app (and an SMS). Numbers: Tithe 100, Offering 200, Church Budget 700. |
| **Wrong amount** | Simulate 500. Member B reports that code but says 5,000. | Treasurer sees **⚠ M-Pesa shows KSh 500, member said KSh 5,000**. Tapping Received shows a warning; **Cancel** leaves it pending. |
| **Made-up code** | Member B reports a code that does not exist. | **Not on the Pay Bill yet**. Receiving it warns the Treasurer. |
| **Reported late** | Simulate a payment but do not report it. | It appears in **Unclaimed M-Pesa payments**. Then a member reports it, and it leaves that list and shows Verified. |
| **Repeat** | Member B tries to report a code that was already used. | Refused: *"That M-Pesa code was already submitted."* |
| **Church Building share** | Report a payment with part to **Church Building**, then receive it. | The amount appears in the **Church Building Project** as a contribution. |

- [ ] All six rows behaved as described.
- [ ] A member can see **only their own** payments and receipts, never another member's.
- [ ] The receipt SMS arrived in the sandbox simulator.

## 5. Sermon summaries (Pastor, on Android **and** iPhone)

- [ ] Record a **3-minute** test sermon in the Sermon Recorder (read a few paragraphs of Scripture aloud). Tap Stop.
- [ ] The progress card moves through *sent → converting speech to text → writing the summaries*.
- [ ] Within a few minutes **Quick summary**, **Full sermon summary** and **Kids' sermon** appear in Pastoral Care, with a **Listen** button that reads them aloud.
- [ ] The summaries only say what was actually said, and Bible references are right. (If the church uses Kiswahili, test a Kiswahili recording too.)
- [ ] Switch on airplane mode right after pressing Stop. The screen should offer **Try again**, and the recording must still be there. Turn the network back on and retry: it should complete.
- [ ] Record a **30-minute** sermon or longer once, on mobile data, with the screen locked part of the time. Note how long it takes and that nothing is lost. (Phone calls and low battery can interrupt recordings; tell the person recording to keep the phone charged and in Do Not Disturb.)
- [ ] A plain member cannot open the Sermon Recorder.

## 6. Backups and recovery (admin)

- [ ] Run a backup now: `docker compose run --rm --entrypoint node backup --no-warnings backup.mjs` ends with **Backup OK**, and a file appears in `deploy/backups/`. (The daily backups run by themselves; this just proves it works.)
- [ ] The backup is also **copied off the server** (provider snapshot, `BACKUP_HOOK`, or a manual download).
- [ ] **Practise a restore** on a spare copy of the server using the commands in DEPLOY.md, and check the test data is back.

## 6b. Many churches (only if you run the platform)
- [ ] `https://api.yourchurch.org/console` opens and a developer can sign in with an SMS code. A phone that is not on the team is refused.
- [ ] Create a test church. Its **church number** (like 482-7391) is shown. A number typed with one wrong digit is refused when a member enters it.
- [ ] The Church Admin signs up with that number and gets the **Church Admin Console** (not the member dashboard). A member who signs up with the number waits on *Almost there* until the Church Admin lets them in.
- [ ] Create a **second** test church. Add a member to each. Confirm the Church Admin of one **cannot see** the other's members, notices or payments.
- [ ] The Church Admin archives a member ("delete"): the person disappears from the list and can be restored from *Archived*.
- [ ] A member uses **Change church** with the second church's number: they now see only the new church, and the old church still lists them as archived.
- [ ] The Church Admin sends a message with the 💬 widget; the developer sees it in **Support** and replies; the Church Admin sees the reply.
- [ ] The team stops at **10** active developers; archiving one frees a place.
- [ ] The daily backup lists `platform.db` and one file per church (`Backup OK ... churches`).

## 6c. Push, Kiswahili messages and office tools
- [ ] With `PUSH_PROVIDER=expo`, a member's phone buzzes when the Treasurer confirms their payment, and the text is in the member's language (switch EN | SW and try again).
- [ ] Wrong code at sign-in on a Kiswahili phone shows the error in Kiswahili; the SMS code arrives in Kiswahili too.
- [ ] Sabbath School: record one Sabbath; recording the same date again is refused until the first is archived.
- [ ] Building Committee: record a pledge and a part payment; the balance is right.
- [ ] Camp meeting: a member registers themselves and cannot see anyone else's registration; a camp officer sees all.

## 6d. Setting up a church, reports and guide
- [ ] The Church Admin exports the member list, edits it in a spreadsheet, imports it back: the preview flags a bad row and nothing is saved until confirmed. The printed directory opens and prints.
- [ ] A phone number that already belongs to another church is flagged in the import preview, not silently moved.
- [ ] In the developer console, **Reports** shows the test church as *setup* before the Church Admin signs in and *active* after.
- [ ] A brand-new member sees the member guide once; after *Got it* it does not reopen, and **How this works** still shows it. Switching to Kiswahili translates it.

## 6e. Treasurer, Secretary and Clerk tools
- [ ] With M-Pesa checking on, two members give; once M-Pesa shows both, the Treasurer sees *2 payments are verified* and **Confirm all** sends both receipts. A payment with a different amount stays pending.
- [ ] *Reconciliation & Cash-up* for *Today* matches the receipts just issued; a payment nobody reported shows as *not yet reported*.
- [ ] *Every member's giving statement* opens in a spreadsheet with each member's total.
- [ ] The Clerk marks a test member *moved to another church*: they leave the count on the roll but stay in the list, with the date and destination. *Back to active* restores them.
- [ ] A baptism certificate, a letter of membership and a transfer letter each get the next LTR- number, in English and in Kiswahili.
- [ ] The Secretary writes minutes in the *Minutes Builder*, saves them, and posts the notice of the next meeting; it appears on the church notice board.
- [ ] Leave a test payment unreceipted for 2 days (or set `REMINDER_AFTER_HOURS=0` on a test server): the Treasurer's phone gets one nudge, not a stream.

## 7. Switching from practice to real

- [ ] Replace the sandbox values in `.env`: real Africa's Talking username and key (and your approved sender name, if you have one), real Pay Bill in `MPESA_SHORTCODE`, then `docker compose up -d`.
- [ ] Register with Safaricom for production (DEPLOY.md, Step 8) once their go-live approval is complete. Make **one real** small payment and check it appears under *Unclaimed M-Pesa payments*.
- [ ] Remove the `BOOTSTRAP=` line from `.env` and run `docker compose up -d`.
- [ ] Spending limits are set at Africa's Talking, OpenAI and Anthropic, and the SMS balance is topped up.
- [ ] Put your real Pay Bill in the app (`src/data/constants.ts`, `PAYBILL`) and build the production app (DEPLOY.md, Step 7). Check the app really points to your real address.
- [ ] Run the smoke test once more, with `--phone` for a real SMS to your own phone.
- [ ] Clear out the test data? **No deleting is possible.** Archive the test notices, payments and members so they are hidden; they stay in the audit trail. For a cleaner start, restore a fresh empty server instead of using the one you tested on.

## 8. The first weeks

- [ ] Start with a **pilot**: invite 10–15 members for one Sabbath and fix what they find.
- [ ] Tell the Treasurer how to read the three M-Pesa marks and what *Confirm anyway* means. They should confirm anyway only after checking the M-Pesa statement.
- [ ] Decide who members call or message when they cannot sign in (a number is not shown in the app yet).
- [ ] Look at `docker compose logs --tail 100 app` and your provider dashboards once a week for the first month: SMS balance, failed messages, spending.
- [ ] Check that the daily backups are really being made and copied off the server.

## If you must stop

You can pause members from using the app without losing anything: `docker compose stop app`. Data stays safe in the Docker volume. Start again with `docker compose start app`.

## 6f. Offline mode (test on a real phone)
1. Sign in as the Secretary, switch the phone to aeroplane mode, and write minutes. You should see "Saved on this phone".
2. On the home screen a blue card says "1 waiting to be sent". Open it: the minutes are listed.
3. Switch aeroplane mode off. Within 20 seconds the card disappears and the minutes are in the Minute Vault, once only.
4. Repeat with a notice and an activity. Try to give by M-Pesa offline: it must refuse (money is never queued).
5. Write something offline, then sign out: the app warns that it is not sent yet.
6. As Treasurer, in aeroplane mode, tap "Received" on a payment: it shows "Waiting to be sent". Reconnect: a payment M-Pesa has verified is receipted; one it has not verified appears in the outbox as "Not accepted" with the reason.
7. Open *How this works* and tap Share / print quick-start card; check it reads well in Kiswahili.

## 6g. Before going live with real data
Make sure `SANDBOX_ACCESS` is NOT set on the real server (it cannot be together with `PERSISTENT_STORAGE=yes`: the server will not start). Open the phone app's sign-in screen: there must be no "Team quick entry" box.

## 6h. Sermon recording safety (real phone)
1. Record 1 minute in aeroplane mode, stop. You should see "No connection..." and the recording stays listed under *Unfinished sermons on this phone*.
2. Close the app completely and open it again: the recording is still listed. Switch the internet on and tap *Send now*. Summaries appear in Pastoral Care.
3. Before the production build run `node scripts/check-release.mjs`: it must say "Release settings look right".
