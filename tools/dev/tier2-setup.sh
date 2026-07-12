#!/usr/bin/env bash
# Tier 2 sandbox setup — run the coding agent as a dedicated low-priv user, so it
# cannot read the bridge user's secrets (~/.ssh, ~/.aws, other repos) or write
# outside its worktree. Design + rationale: docs/engineering/AUTORUN_SANDBOX_TIER2.md.
#
# RUN THIS YOURSELF, in an interactive terminal — it needs your sudo password, which
# the agent cannot (and must not) supply. Idempotent; the sudoers file is syntax-
# validated BEFORE install, so a typo can't lock you out of sudo.
#
# STEP 4 (agent auth) is intentionally NOT automated — it's the one place that
# touches a claude login/credential, which the agent is hard-banned from doing.
#
# Toolchain paths below are the world-executable ones set up for the runner
# (system node + a /Users/Shared claude); adjust if your install differs.
set -euo pipefail

RUNNER=_myagentrunner
OPERATOR="$(whoami)"
CLAUDE_BIN="${TIER2_CLAUDE_BIN:-/Users/Shared/agent-toolchain/bin/claude}"  # world-exec install
NODE_BIN="${TIER2_NODE_BIN:-/usr/local/bin/node}"                          # system node (not nvm)
GIT_BIN="${TIER2_GIT_BIN:-/usr/bin/git}"
WORKTREE_BASE="${TIER2_WORKTREE_BASE:-$HOME/projects}"                     # your project clone-parent dir

echo "== 0. Preconditions (toolchain must be world-executable, not under a 0700 home) =="
for b in "$CLAUDE_BIN" "$NODE_BIN" "$GIT_BIN"; do
  [ -x "$b" ] && echo "  ok  $b" || { echo "  MISSING $b — install a system-wide copy first"; exit 1; }
done

echo "== 1. Service account: $RUNNER (no shell, no admin) =="
if dscl . -read "/Users/$RUNNER" >/dev/null 2>&1; then
  echo "  exists — skipping"
else
  sudo sysadminctl -addUser "$RUNNER" -shell /usr/bin/false
fi

echo "== 2. Scoped passwordless sudo (least-priv allowlist, validated first) =="
TMP="$(mktemp)"
printf '%s ALL=(%s) NOPASSWD: %s, %s, %s\n' "$OPERATOR" "$RUNNER" "$CLAUDE_BIN" "$GIT_BIN" "$NODE_BIN" > "$TMP"
sudo visudo -cf "$TMP"                                    # abort on any syntax error → no lockout
sudo install -m 0440 -o root -g wheel "$TMP" /etc/sudoers.d/myagent
rm -f "$TMP"
echo "  installed /etc/sudoers.d/myagent"

echo "== 3. Worktree write access (share a group with the runner) =="
sudo dseditgroup -o create agentruns 2>/dev/null || true
sudo dseditgroup -o edit -a "$OPERATOR" -t user agentruns
sudo dseditgroup -o edit -a "$RUNNER"   -t user agentruns
sudo chgrp -R agentruns "$WORKTREE_BASE"
sudo chmod -R g+rwXs "$WORKTREE_BASE"
echo "  $WORKTREE_BASE now group-shared with $RUNNER"

echo "== 4. AGENT AUTH — MANUAL (this script will NOT touch a claude login) =="
cat <<'NOTE'
  The runner has no claude login yet. Pick ONE — do it yourself:
   (2) RECOMMENDED — the runner's own login (your eval login stays untouched):
         sudo -u _myagentrunner -H /Users/Shared/agent-toolchain/bin/claude
         # then run /login inside it, as the runner
   (1) NOT recommended — share your ~/.claude read-only (exposes YOUR eval credential
       to the runner):  chmod -R g+rX ~/.claude
NOTE

echo "== 5. Preflight (the bridge runs this; must pass or it falls back to unsandboxed) =="
if sudo -n -u "$RUNNER" -- /usr/bin/true; then echo "  preflight OK"; else echo "  preflight FAILED — recheck sudoers"; fi

cat <<NEXT

== NEXT (you drive) ==
  1) enable:  export MYAGENTTOOL_BRIDGE_RUN_AS_USER=$RUNNER   # then restart the bridge
  2) point the agent adapter's command at the ABSOLUTE path (the runner's PATH
     won't find a bare 'claude'):   $CLAUDE_BIN
  3) soak — one develop run on devdemo; confirm the loop still works end to end
  4) isolation negative test (must FAIL to read):
       printf secret > ~/.ssh/id_probe
       sudo -u $RUNNER cat ~/.ssh/id_probe    # expect: Permission denied
NEXT
echo "done."
