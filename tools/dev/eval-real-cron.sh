#!/bin/sh
# Cron wrapper for the real-agent eval runner (#248). Cron's environment is
# minimal — no user PATH, no shell profile — so this script pins everything.
# Install (crontab -e), maintainer machine only:
#
#   # nightly cheap run (subcap real, ~10 min)
#   30 2 * * *   /bin/sh <repo>/tools/dev/eval-real-cron.sh --subcap-only
#   # weekly full run (adds held-out real, ~1-2h)
#   30 3 * * 0   /bin/sh <repo>/tools/dev/eval-real-cron.sh
#
# macOS caveat: cron only fires while the machine is awake; if the Mac sleeps
# at night, either adjust the hour or migrate to launchd with StartInterval.

set -eu
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
LOG="$REPO/.myagenttool/evals/cron.log"
mkdir -p "$(dirname "$LOG")"

{
  echo "=== eval-real-cron $(date -u +%Y-%m-%dT%H:%M:%SZ) args: $* ==="
  cd "$REPO"
  node tools/dev/eval-real-run.mjs "$@"
  # L6: close the loop unattended — file tracked issues for any emitted events
  node tools/ai/src/index.mjs feedback-triage --apply
} >> "$LOG" 2>&1
