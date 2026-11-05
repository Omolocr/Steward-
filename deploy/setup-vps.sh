#!/usr/bin/env bash
# One-command setup for a fresh Ubuntu/Debian server (a VPS with a normal disk). Run as root from this folder:
#     sudo ./setup-vps.sh
# It installs Docker, opens only the web and remote-login ports, writes your .env (asking a few questions), starts everything
# and runs the safety check. Safe to run again: it never overwrites an existing .env unless you say so.
set -euo pipefail
cd "$(dirname "$0")"
[ "$(id -u)" = 0 ] || { echo "Please run as root:  sudo ./setup-vps.sh"; exit 1; }

ask() { local v; read -r -p "$1${2:+ [$2]}: " v; echo "${v:-${2:-}}"; }
need() { local v; while :; do v="$(ask "$1" "${2:-}")"; [ -n "$v" ] && { echo "$v"; return; }; echo "  This one is needed." >&2; done; }
phone_ok() { [[ "$1" =~ ^0[0-9]{9}$ ]]; }

echo "== 1/6  Docker"
if ! command -v docker >/dev/null 2>&1; then curl -fsSL https://get.docker.com | sh; fi
docker compose version >/dev/null 2>&1 || { echo "Docker Compose is missing. Install the 'docker-compose-plugin' package and run this again."; exit 1; }

echo "== 2/6  Firewall (only SSH, web and secure web)"
if command -v ufw >/dev/null 2>&1; then ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null; ufw status | head -8
else echo "  ufw is not installed: make sure your provider's firewall allows only ports 22, 80 and 443."; fi

echo "== 3/6  Your settings (.env)"
WRITE=1
if [ -f .env ]; then
  [ "$(ask ".env already exists. Replace it? (yes/no)" no)" = yes ] && cp .env ".env.backup-$(date +%Y%m%d-%H%M%S)" || WRITE=0
fi
if [ "$WRITE" = 1 ]; then
  DOMAIN="$(need "Web address of this server (already pointing here), e.g. api.yourchurch.org")"
  MODE="$(ask "Many churches (you are the app developer) or one church only? (many/one)" many)"
  {
    echo "DOMAIN=$DOMAIN"
    echo "TOKEN_SECRET=$(openssl rand -hex 32)"
    if [ "$MODE" = one ]; then
      echo "DEFAULT_CHURCH=$(need "Church name")"
      SEC="$(need "Church Secretary's phone (07XXXXXXXX)")"; phone_ok "$SEC" || { echo "Not a valid phone number."; exit 1; }
      PAS="$(need "Pastor's phone (07XXXXXXXX)")"; phone_ok "$PAS" || { echo "Not a valid phone number."; exit 1; }
      echo "BOOTSTRAP=$SEC:secretary,$PAS:pastor"
    else
      DEV="$(need "Your phone number as app developer (07XXXXXXXX)")"; phone_ok "$DEV" || { echo "Not a valid phone number."; exit 1; }
      echo "DEVELOPERS=$DEV:$(need "Your name")"
    fi
    echo "SMS_PROVIDER=africastalking"
    echo "AT_USERNAME=$(need "Africa's Talking username")"
    echo "AT_API_KEY=$(need "Africa's Talking API key")"
    echo "AT_SENDER_ID=$(ask "Africa's Talking sender ID (optional)")"
    echo "SMS_RECEIPTS=1"
    K="$(ask "Anthropic API key for sermon summaries (optional, press Enter to skip)")"; [ -n "$K" ] && echo "ANTHROPIC_API_KEY=$K"
    K="$(ask "OpenAI API key for sermon transcription (optional, press Enter to skip)")"; [ -n "$K" ] && echo "OPENAI_API_KEY=$K"
    echo "BACKUP_KEEP=60"
  } > .env.new
  mv .env.new .env; chmod 600 .env
  echo "  Written to $(pwd)/.env (readable by root only)."
fi
# shellcheck disable=SC1091
DOMAIN="$(grep -E '^DOMAIN=' .env | head -1 | cut -d= -f2-)"
grep -qE '^SANDBOX_ACCESS=' .env && { echo "SANDBOX_ACCESS is set in .env: the server will refuse to start with real data. Remove that line."; exit 1; }

echo "== 4/6  Backup folder"
mkdir -p backups && chown 1000:1000 backups

echo "== 5/6  Starting (the first start builds the image and gets the HTTPS certificate: a few minutes)"
docker compose up -d --build
for i in $(seq 1 60); do
  if curl -fsS "https://$DOMAIN/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 5
done
[ "${OK:-0}" = 1 ] || { echo "The server did not answer at https://$DOMAIN/health yet."; echo "Check that $DOMAIN points to this server, then run:  docker compose logs --tail 100 app caddy"; exit 1; }
curl -fsS "https://$DOMAIN/health"; echo

echo "== 6/6  Safety check"
docker compose run --rm app node smoke-test.mjs "https://$DOMAIN" || true

cat <<MSG

Done. Next:
  * Many churches: open https://$DOMAIN/console, sign in with the developer phone, and create the first church.
  * Keep backups safe off this server: see "Backups" in DEPLOY.md (BACKUP_HOOK or provider snapshots).
  * To update later:  ./update.sh        To restore a backup:  ./restore.sh backups/snapshot-...
MSG
