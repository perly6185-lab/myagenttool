#!/bin/sh
# Install the scheduled real-eval jobs as per-user LaunchAgents (#285).
#
#   sh tools/dev/install-eval-launchagent.sh --dry-run   # preview, touch nothing
#   sh tools/dev/install-eval-launchagent.sh             # install + load
#   sh tools/dev/install-eval-launchagent.sh --uninstall # remove
#
# Why LaunchAgents, not crontab: a raw crontab job runs in a detached session
# that does NOT inherit the user's login/keychain, so the Claude CLI runs
# logged-out (the 2026-07-02 40% infra failure). A per-user LaunchAgent runs in
# the Aqua/GUI session and sees the login. This script also pins the resolved
# node dir into the agent's PATH (nvm's PATH is set by the shell, not inherited
# by launchd), the second reason a bare cron job was fragile.
#
# Schedule: nightly 02:30 subcap-only, weekly Sun 03:30 full — same as the old
# crontab. The old crontab eval entries are removed so the two don't double-run.
#
# macOS caveat: like cron, a LaunchAgent StartCalendarInterval fires only while
# the Mac is awake. If it sleeps through the hour, run `pnpm eval:real` by hand
# or schedule a wake with `pmset repeat`.

set -eu

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || { echo "node not found on PATH; run inside your normal shell." >&2; exit 1; }
NODE_DIR="$(dirname "$NODE_BIN")"
UID_NUM="$(id -u)"
AGENTS="$HOME/Library/LaunchAgents"
NIGHTLY="com.myagenttool.eval-nightly"
WEEKLY="com.myagenttool.eval-weekly"

MODE="${1:-install}"

emit_plist() {
  # $1 label · $2 hour · $3 weekday-or-empty · $4 extra runner arg
  label="$1"; hour="$2"; weekday="$3"; extra="$4"
  cal="    <key>Hour</key><integer>${hour}</integer>
    <key>Minute</key><integer>30</integer>"
  [ -n "$weekday" ] && cal="${cal}
    <key>Weekday</key><integer>${weekday}</integer>"
  args="    <string>/bin/sh</string>
    <string>${REPO}/tools/dev/eval-real-cron.sh</string>"
  [ -n "$extra" ] && args="${args}
    <string>${extra}</string>"
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${NODE_DIR}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
${cal}
  </dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${REPO}/.myagenttool/evals/cron.log</string>
  <key>StandardErrorPath</key><string>${REPO}/.myagenttool/evals/cron.log</string>
</dict>
</plist>
PLIST
}

remove_crontab_entries() {
  if crontab -l 2>/dev/null | grep -q 'eval-real-cron.sh'; then
    crontab -l 2>/dev/null | grep -v 'eval-real-cron.sh' | crontab -
    echo "removed old crontab eval-real-cron entries"
  fi
}

case "$MODE" in
  --dry-run)
    echo "# DRY RUN — would write these LaunchAgents and remove crontab eval entries:"
    echo "#   ${AGENTS}/${NIGHTLY}.plist  (daily 02:30, --subcap-only)"
    echo "#   ${AGENTS}/${WEEKLY}.plist   (Sun 03:30, full)"
    echo "#   node dir pinned: ${NODE_DIR}"
    echo "# --- nightly plist preview ---"
    emit_plist "$NIGHTLY" 2 "" "--subcap-only"
    ;;
  --uninstall)
    for label in "$NIGHTLY" "$WEEKLY"; do
      launchctl bootout "gui/${UID_NUM}/${label}" 2>/dev/null || true
      rm -f "${AGENTS}/${label}.plist"
      echo "removed ${label}"
    done
    ;;
  install)
    mkdir -p "$AGENTS" "${REPO}/.myagenttool/evals"
    emit_plist "$NIGHTLY" 2 "" "--subcap-only" > "${AGENTS}/${NIGHTLY}.plist"
    emit_plist "$WEEKLY" 3 0 "" > "${AGENTS}/${WEEKLY}.plist"
    remove_crontab_entries
    for label in "$NIGHTLY" "$WEEKLY"; do
      launchctl bootout "gui/${UID_NUM}/${label}" 2>/dev/null || true
      launchctl bootstrap "gui/${UID_NUM}" "${AGENTS}/${label}.plist"
      echo "loaded ${label}"
    done
    echo ""
    echo "Installed. Verify:   launchctl print gui/${UID_NUM}/${NIGHTLY} | grep -E 'state|path'"
    echo "Smoke it now (real, paid):   launchctl kickstart -p gui/${UID_NUM}/${NIGHTLY}"
    echo "Logs:   ${REPO}/.myagenttool/evals/cron.log"
    ;;
  *)
    echo "usage: $0 [--dry-run | --uninstall]" >&2; exit 2 ;;
esac
