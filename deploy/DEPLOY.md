# Putting Church Connect online

This guide takes you from nothing to a running church server with: SMS login codes and receipts, sermon summaries, automatic HTTPS, and daily backups. Set aside an afternoon. The steps are written so a careful non-programmer can follow them, but it helps to have a technical member nearby.

## What you need

| Item | Why | Notes |
|---|---|---|
| A small cloud server ("VPS") | Runs the church server | Ubuntu 24.04, **at least 2 GB memory** and 25 GB disk. Pick the data centre nearest Kenya that your provider offers. |
| A web address (domain) | So phones can find the server | For example `api.yourchurch.org`. Any domain registrar works. |
| An **Africa's Talking** account | Sends SMS login codes and receipts | Needs airtime/credit. |
| An **OpenAI** API key | Turns sermon recordings into text | Used only for sermon recordings. |
| An **Anthropic** API key | Writes the sermon summaries | Used only for sermon text. |

Prices change, so check each provider's pricing page and **set a monthly spending limit** in each dashboard before you start.

> **Privacy:** sermon audio and text are sent to OpenAI and Anthropic to make the summaries. Member records, payments and phone numbers are **not**. Tell the church board this before you switch it on.

## Step 1: Get your keys

**Africa's Talking (SMS)**
1. Create an account and an application.
2. Note your **username** and create an **API key** (Settings → API Key).
3. Top up your account so messages can be sent.
4. A custom sender name (such as your church name) may need to be registered first. Ask Africa's Talking. You can leave `AT_SENDER_ID` empty to start.
5. To practise first, use the username `sandbox` with a sandbox key. Sandbox messages appear in their simulator, not on real phones.

**OpenAI** → create an API key. **Anthropic** → create an API key. Keep all keys private.

## The short way: one script

On a fresh Ubuntu or Debian server (a VPS with an ordinary disk), with your domain already pointing at it (Step 3) and your SMS keys ready (Step 1):

```bash
git clone https://github.com/YOUR-NAME/church-connect.git ~/church-app
cd ~/church-app/deploy && sudo ./setup-vps.sh
```

It installs Docker, opens only the web and remote-login ports, asks a few questions (domain, one church or many, phone numbers, SMS keys), writes your `.env`, starts everything and runs the safety check. The steps below explain what it does, for doing it by hand or fixing something.

## Step 2: Prepare the server

Connect to the server (your provider shows you how), then:

```bash
# install Docker
curl -fsSL https://get.docker.com | sh

# only allow the web and remote-login ports
sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable
```

## Step 3: Point your domain at the server

At your domain registrar, add an **A record**: name `api` (for `api.yourchurch.org`), value = your server's IP address. It can take from a few minutes to a few hours to start working. Check with `ping api.yourchurch.org`.

## Step 4: Copy the project and fill in your settings

Copy the `church-app` folder to the server (for example with `scp -r church-app you@SERVER_IP:~/`), then:

```bash
cd ~/church-app/deploy
cp .env.example .env
nano .env            # fill in every line, see the comments in the file
```

Make the secret with `openssl rand -hex 32` and paste it after `TOKEN_SECRET=`.
**Choose how many churches this server will run** (see `DEVELOPER-GUIDE.md`):
- **Many churches (you are the app developer):** keep `DEVELOPERS=` with up to 10 developer phone numbers. After Step 5, open `https://api.yourchurch.org/console`, sign in, and create each church there. Each church gets its own special church number.
- **One church only:** comment out `DEVELOPERS=`, set `DEFAULT_CHURCH=` to the church's name, and put the **first Secretary's and Pastor's phone numbers** in `BOOTSTRAP=`. These two are trusted automatically when they first sign up. Everyone else needs one of them to verify their leader position.

Create the backup folder:

```bash
mkdir backups && sudo chown 1000:1000 backups
```

## Step 5: Start it

```bash
docker compose up -d --build
docker compose ps                 # all three should say "running" / "healthy"
curl https://api.yourchurch.org/health
```

You should see something like `{"ok":true,"sms":true,"ai":true,"mpesa":false}`. The first start can take a few minutes while the HTTPS certificate is issued. If `ai` is `false`, the Anthropic key is missing.

Then run the safety check. It changes nothing and explains anything that is wrong in plain words:

```bash
docker compose run --rm app node smoke-test.mjs https://api.yourchurch.org
```

It must end with **LOOKS GOOD**. Add `--phone 07XXXXXXXX` to also test a real SMS login code (this sends one SMS, and the number must already have an account). Add `--mpesa-secret <your secret>` once M-Pesa checking is on (Step 8).

If it does not start, run `docker compose logs app`. The server refuses to start in production if the secret is too short or SMS is not set up, and tells you why.

Before opening the app to members, do the full dry run in `GO-LIVE-CHECKLIST.md` (same folder).

## Step 6: First sign-in

Build the phone app (Step 7) or open it in Expo Go with `EXPO_PUBLIC_API_URL=https://api.yourchurch.org`. **Many-church mode:** a developer opens `/console`, creates the church and gives its **church number** to the Church Admin. The Church Admin signs up with that number (they are made Church Admin automatically because their phone was named), lets the church's people in, and approves the Secretary and Pastor under *Verify Leader Positions*.

**One-church mode:** the Secretary signs up with the `BOOTSTRAP` number: a code arrives by SMS, then the account is created as Secretary automatically. Do the same for the Pastor. After both have signed in, **remove the `BOOTSTRAP=` line** from `.env` and run `docker compose up -d`.

Everyone else signs up the same way. If they pick a leader position, the Secretary or Pastor approves it under **Verify Leader Positions**.

## Step 7: Build the phone apps

On your computer (not the server), in the `church-app` folder:

```bash
npm install
npm install -g eas-cli
eas login
eas build:configure
```

Open `eas.json` and change both `EXPO_PUBLIC_API_URL` values to your real address. Then:

```bash
eas build --platform android --profile preview      # an APK you can share directly with members
eas build --platform android --profile production   # for the Google Play Store
eas build --platform ios --profile production       # for the Apple App Store
```

Sending the Android `preview` APK by WhatsApp or a download link is the quickest way to start. The Play Store and App Store need developer accounts, which have a fee, and an app review.

## Step 8 (recommended): automatic M-Pesa checking

Without this, the Treasurer confirms each payment by trusting the code a member typed. With it, Safaricom tells your server about every payment to your Pay Bill, and the Treasurer sees for each member payment:

- **✓ Verified by M-Pesa** (with the name on the M-Pesa record): the code exists and the amount matches.
- **⚠ Amount differs**: M-Pesa shows a different amount from what the member typed.
- **Not on the Pay Bill yet**: nothing found for that code (wait a few minutes, or the code is wrong).

Tapping **Received** on a verified payment works as before. For the other two the app warns the Treasurer and asks them to confirm only after checking the M-Pesa statement; that override is recorded in the audit trail. A new **Unclaimed M-Pesa payments** list shows money that arrived but that no member has reported yet.

1. Create a Safaricom **Daraja** developer account and an app (developer.safaricom.co.ke). Note the consumer key and secret. Start in the **sandbox**.
2. Put these in `.env`, then `docker compose up -d`: `MPESA_CALLBACK_SECRET` (make it with `openssl rand -hex 32`) and `MPESA_SHORTCODE` (your Pay Bill; in the sandbox use the test number Daraja gives you).
3. Tell Safaricom where to send the notices (once). Your keys are typed here instead of stored in `.env`:

```bash
cd ~/church-app/deploy
docker compose run --rm \
  -e MPESA_ENV=sandbox -e PUBLIC_URL=https://api.yourchurch.org \
  -e MPESA_CONSUMER_KEY=... -e MPESA_CONSUMER_SECRET=... \
  app node mpesa-register.mjs --dry-run      # check first: sends nothing
# then the same command without --dry-run
```

4. In the Daraja portal use the **C2B simulator** to send a test payment, then report that code in the app from a member account. It should show **Verified by M-Pesa**.
5. To go live, follow Safaricom's go-live process for your Pay Bill, then register again with `MPESA_ENV=production`. Their requirements and web addresses change from time to time, so follow the instructions in the Daraja portal; the script lets you override the addresses if needed.

Good to know:
- Safaricom hides most of the payer's phone number, so payments are matched on the **M-Pesa code and amount**, not on the phone.
- `MPESA_AUTO_RECEIPT=1` issues receipts without any human check. Because it trusts the first member who reports a code, keep it at `0` until you are comfortable, and use it only if the Treasurer reviews the names on the M-Pesa records.
- The secret in the notice address is the only thing protecting it. Never share it; if it leaks, make a new one and register again.
- If the server is down when Safaricom calls, that notice can be missed. The payment then shows "Not on the Pay Bill yet" and the Treasurer checks the M-Pesa statement and confirms by hand.

## Backups: do not skip this

- A backup runs **every day** and is saved in `deploy/backups/`. Each one is checked after it is made. The sermon recordings are copied too.
- Backups on the same server are **not safe on their own**: if the server is lost, so are they. Do at least one of these:
  - Turn on your provider's full-server snapshots.
  - Copy backups elsewhere automatically: set `BACKUP_HOOK` in `.env`, for example `rclone copy "$BACKUP_FILE" myremote:church-backups/`.
  - Download `deploy/backups/` to a computer every week.
- **Practise a restore once**, before you need it. Each backup is a folder `backups/snapshot-<date>-<time>/` holding every church's database. To put one back:

```bash
./restore.sh backups/snapshot-2026-11-05-03-00-00
```

It stops the server, checks the backup (a damaged one is refused and nothing changes), puts it back, and starts the server. The data that was there before is **kept aside, never deleted**, in the data volume under `before-restore-<time>/`, so a wrong restore can be undone. Anything entered after the backup was made is not in the restored copy: that is why backups run daily.

Only old database snapshots beyond `BACKUP_KEEP` are removed. Church records and sermon recordings are never deleted by the app or the backup.

## Updating the server

If you put the project on the server with `git clone` from your GitHub repository:

```bash
cd ~/church-app/deploy && ./update.sh
```

It takes a safety backup, pulls the newest version, rebuilds, waits for the server to answer, and runs the safety check. If the new version does not start, it tells you the command to go back. If you copied the files by hand instead, copy the new files over the old ones, then run `docker compose up -d --build`. Your data lives in a Docker volume and is not touched by updates.

## Keeping an eye on it

- Add `https://api.yourchurch.org/health` to a free uptime monitor so you get an email if it stops.
- `docker compose ps` shows what is running; `docker compose logs --tail 100 app` shows recent messages.

## Security checklist

- Long random `TOKEN_SECRET`, and `.env` kept private (never emailed or posted).
- Log in to the server with an SSH key, not a password.
- Only the Secretary and Pastor can approve leader positions. Be careful who is given those two roles.
- Spending limits set at Africa's Talking, OpenAI and Anthropic.
- Remove `BOOTSTRAP=` after the first two sign-ups.

## If something goes wrong

| Problem | What to check |
|---|---|
| "We could not send the SMS code" | Africa's Talking balance; `AT_USERNAME` and `AT_API_KEY`; `docker compose logs app` shows the reason. |
| Phones cannot connect | `curl https://api.yourchurch.org/health` from your own computer. If it fails, check the DNS record and that ports 80 and 443 are open. |
| HTTPS certificate not issued | The domain must already point at the server; check `docker compose logs caddy`. |
| Sermon summary "failed" | The screen shows the reason. Common ones: wrong API key, no credit at the provider, or a recording with almost no speech. Use **Try again**. |
| Receipt SMS did not arrive | The receipt is still in the app. Check the Africa's Talking balance. |

## What has and has not been tested

Tested automatically against stand-ins for the outside services: SMS login, SMS receipts, M-Pesa checking (verified, amount mismatch, waiting, repeated notices, unclaimed payments, automatic receipts, the registration tool), the sermon pipeline (including long recordings cut into pieces, failures and retry), the server's refusal to start with unsafe settings, backups, restore, and clean shutdown.

**Not tested** (it could not be run where this was built): building the Docker image, the Caddy HTTPS setup, and the real Safaricom Daraja, Africa's Talking, OpenAI and Anthropic services with real keys. The exact message layout and web addresses Safaricom uses today should be checked against the Daraja portal when you test in the sandbox. Run through the steps above with Africa's Talking in `sandbox` mode first, and send one real test sermon before relying on it.

## Step 9 (recommended): push notifications
Push alerts tell people at once about a receipt, a new notice, a post waiting for approval, a verified position, or a reply from the app developer. They arrive in each person's own language (English or Kiswahili).
1. Create a free Expo account and an EAS project (`npx eas init`). Put the project id in `app.json` at `extra.eas.projectId` (replace `REPLACE-WITH-YOUR-EAS-PROJECT-ID`).
2. For Android, add your Firebase (FCM) key in the EAS dashboard (Credentials). For iPhone, `eas build` sets up the Apple push key for you (needs an Apple developer account).
3. In `.env` set `PUSH_PROVIDER=expo`, then restart the server.
4. Build the app (Step 7) and sign in. The phone asks permission once. Test: confirm a payment as Treasurer; the member's phone should buzz.
Push does not work in Expo Go on a simulator. Without it the app still refreshes every 20 seconds, and nothing is lost.
