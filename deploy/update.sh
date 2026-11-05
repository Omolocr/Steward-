#!/usr/bin/env bash
# Update the server to the newest version from GitHub, with a safety backup first.
#     ./update.sh
# Your data lives in a Docker volume and is not touched by the update. If the new version does not start, the script says so
# and tells you how to go back (git checkout of the previous version).
set -euo pipefail
cd "$(dirname "$0")"
DOMAIN="$(grep -E '^DOMAIN=' .env | head -1 | cut -d= -f2-)"
PREV="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

echo "== Safety backup"
docker compose exec -T backup node --no-warnings backup.mjs

echo "== Getting the newest version"
if git rev-parse --git-dir >/dev/null 2>&1; then git pull --ff-only; else echo "  (not a git folder: copy the new files over the old ones first, then run this again)"; fi

echo "== Rebuilding and restarting"
docker compose up -d --build

for i in $(seq 1 40); do curl -fsS "https://$DOMAIN/health" >/dev/null 2>&1 && OK=1 && break; sleep 3; done
if [ "${OK:-0}" != 1 ]; then
  echo "The new version did not start. Look at:  docker compose logs --tail 100 app"
  [ "$PREV" != unknown ] && echo "To go back:  git checkout $PREV && docker compose up -d --build"
  exit 1
fi
curl -fsS "https://$DOMAIN/health"; echo
docker compose run --rm app node smoke-test.mjs "https://$DOMAIN" || true
echo "Updated (from $PREV)."
