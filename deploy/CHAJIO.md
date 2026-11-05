# Deploying the Church Connect server on Chajio Cloud (from GitHub)

The server is the only part that runs on Chajio. The phone app is built separately with Expo (see the main README) and
only needs the server's web address.

## ⚠ Read this first: where the church's data is kept

Chajio's app hosting runs **two copies** of your app and **wipes the app's local disk on every update**. Church Connect keeps
its records (members, giving, receipts, minutes) in database files under `DATA_DIR`. On Chajio app hosting those files would be
lost at the next update, and each copy would hold its own different data.

So the server **refuses to start in production** unless you say what kind of disk it has:

| Setting | Meaning |
|---|---|
| `PERSISTENT_STORAGE=yes` | `DATA_DIR` is on a disk that survives updates and only ONE copy runs. Use this for real church data. |
| `ALLOW_EPHEMERAL=yes` | Throw-away trial. Everything is lost when the app restarts or updates; sign-in codes can fail because the two copies do not share data. **Never enter real church data.** |

**Recommended for real use:** run the same repository on a server with a normal persistent disk (a VPS) using
`deploy/docker-compose.yml`: one copy, a persistent volume, automatic HTTPS and daily backups. On a fresh Ubuntu/Debian server it is
one command, `sudo ./deploy/setup-vps.sh`; updates are `./deploy/update.sh`, restores `./deploy/restore.sh`. Details: `deploy/DEPLOY.md`.

**Chajio app hosting is fine for a trial** (to see the console and app working) with `ALLOW_EPHEMERAL=yes`.

Moving the data into Chajio's managed PostgreSQL (so app hosting is safe for real data) is possible but is a separate piece of
work: the server currently uses Node's built-in SQLite.

## Trial deployment from GitHub

1. Create a GitHub repository and upload the contents of this folder (keep `Dockerfile` at the top level).
2. In Chajio Cloud choose **App Hosting → Deploy from GitHub**, pick the repository and the `main` branch. Chajio builds from the
   `Dockerfile`.
3. In the **Configure** step set:
   - **Container port:** `8080`
   - **Health check path:** `/health`  (answers without sign-in)
4. On the **Environment** tab add these variables (see `.env.example` for the full list):

   | Variable | Value |
   |---|---|
   | `ALLOW_EPHEMERAL` | `yes` (trial only) |
   | `SANDBOX_ACCESS` | `yes` (optional: team quick entry, see the README. Never with real data) |
   | `TOKEN_SECRET` | a random string of 32+ characters (e.g. `openssl rand -hex 32`) |
   | `DEFAULT_CHURCH` | your church's name, e.g. `Nanyuki Central SDA Church` |
   | `DEVELOPERS` | `0712345678:Your Name` (phone numbers allowed into the developer console) |
   | `TRUST_PROXY` | `1` (so rate limits use each person's address, not Chajio's proxy) |
   | `SMS_PROVIDER`, `AT_USERNAME`, `AT_API_KEY` | your Africa's Talking details (SMS sign-in codes) |

   Production mode will not start without working SMS settings. Do not put these in GitHub: only on the Environment tab.
5. Click **Deploy**. When the health check turns green, open `https://<your-address>/console` for the developer console and
   `https://<your-address>/health` (it shows `"persistent": false` in trial mode).
6. Build the phone app with that address: `EXPO_PUBLIC_API_URL=https://<your-address> npx expo start` (see `src/config.ts`).
7. Only when you later connect M-Pesa: `PUBLIC_URL` is used by `mpesa-register.mjs` (see `deploy/DEPLOY.md`).

## If a deployment fails (Chajio's own causes, in order)

- *"The app did not become healthy"*: the health path must be `/health`; the container port must match (`8080`).
- *Exits straight away*: read the deploy log. The server prints exactly which setting is missing (`TOKEN_SECRET`, SMS, or the
  storage setting above).
- *"Daily deploy limit reached"*: wait until midnight UTC.

## Real use, step by step (recommended)

Use `deploy/DEPLOY.md` on a VPS. The compose file already sets `PERSISTENT_STORAGE=yes` because its `/data` volume survives
updates. Do not run more than one copy.
