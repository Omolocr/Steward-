#!/usr/bin/env bash
# Put a backup back.     ./restore.sh backups/snapshot-2026-11-05-03-00-00
# The server is stopped, the backup is checked, and the data that is there now is kept aside (never deleted) in the data volume
# under before-restore-<time>/, so a wrong restore can be undone. Then the server is started again.
set -euo pipefail
cd "$(dirname "$0")"
SNAP="${1:-}"
if [ -z "$SNAP" ] || [ ! -d "$SNAP" ]; then echo "Usage: ./restore.sh backups/snapshot-YYYY-MM-DD-HH-MM-SS"; echo "Available:"; ls -1 backups 2>/dev/null | grep '^snapshot-' | tail -10; exit 1; fi
SNAP="$(cd "$SNAP" && pwd)"; BACKUPS="$(dirname "$SNAP")"
read -r -p "This puts the data back as it was at $(basename "$SNAP"). Anything entered since then is kept aside, not deleted. Continue? (yes/no) " A
[ "$A" = yes ] || { echo "Cancelled."; exit 0; }
docker compose stop app
docker compose run --rm --no-deps -v "$BACKUPS":/backups --entrypoint node app --no-warnings restore.mjs "/backups/$(basename "$SNAP")"
docker compose start app
echo "Restored. Check:  docker compose logs --tail 20 app"
