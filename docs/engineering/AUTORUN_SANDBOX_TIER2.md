# B1b Tier 2 — Run-as-restricted-user (design for joint review)

Status: **DESIGN — not implemented.** Chosen over `sandbox-exec` (2026-07-11) to
sidestep keychain-under-seatbelt fragility. Follows AUTORUN_SANDBOX_REVIEW.md
(Tier 1 env-minimization shipped). A default-off opt-in slice follows sign-off + soak.

## Goal
Confine **T2** (agent reads the bridge user's secret files — `~/.ssh`, `~/.aws`,
other repos, outside-worktree `.env`) and **T4** (writes outside the worktree) by
running the coding agent as a **dedicated low-privilege macOS user**, not as you.
OS file permissions do the confining — no per-syscall profile. Network stays open
(Tier 3). Approval gate / auto-merge / Tier 1 unchanged.

## Mechanism
The bridge (as `$USER`) spawns the agent as `_myagentrunner` via
`sudo -n -u _myagentrunner -- <agent cmd>`. A different user with no read access
to `$USER`'s home **cannot** read `~/.ssh`, `~/.aws`, sibling repos, or
outside-worktree `.env` (T2), and cannot write `$USER`'s space (T4). It only
touches what it owns + the group/ACL-shared worktrees.

## The #1 question: agent auth as the runner user
claude/codex auth via the RUNNING user's login state. As `_myagentrunner` that is
absent → "Not logged in". Options (preferred first):
1. **Share only the agent auth dir, read-only** (`~/.claude`/`~/.codex` group-readable
   by the runner). The runner gets only the agent's own credential (which it needs);
   `$USER`'s OTHER secrets stay unreachable — that's the T2 win. **Recommended; soak
   first.** Risk: if the credential lives in `$USER`'s login *keychain* (not files),
   cross-user access is hard → option 2. (Tier 1 soak showed claude needs `USER` for
   a keychain lookup — prove, don't assume.)
2. **Runner has its own claude login** — cleanest isolation; a second credential; the
   existing eval/L6 login is never touched (HARD BAN safe).
3. **Keychain ACL grant** for the runner — finicky, last resort.

## Operator setup (admin — you run these once; I supply exact commands + runbook)
1. Service account, no admin/shell: `sudo sysadminctl -addUser _myagentrunner -shell /usr/bin/false`.
2. Scoped passwordless sudo — `/etc/sudoers.d/myagent`:
   `youruser ALL=(_myagentrunner) NOPASSWD: /path/to/claude, /path/to/git, /path/to/node` (least-priv, not ALL).
3. Worktree access: worktrees under a dir group-shared with the runner (group `agentruns`, `chmod g+rwxs`).
4. Auth: option (1) — `~/.claude`/`~/.codex` group-readable by the runner.
The privileged steps are yours (need admin); nothing is done autonomously.

## Bridge wiring (I build, default-off, after sign-off) — mirrors Tier 1
`apps/desktop/src/agent-runas.mjs` (pure/tested):
- `runAsUserEnabled(env)` — gate `MYAGENTTOOL_BRIDGE_RUN_AS_USER` (username; empty = OFF).
- `shouldRunAsUser(adapter,{user})` — real CLI coding agents only.
- `runAsSpawnPlan(spawnPlan,{user})` — wrap as `sudo -n -u user -- cmd …`; composes with Tier 1 + worktree cwd.
- Preflight on bridge start: `sudo -n -u <user> true` must pass, else warn + fall back to today's spawn (never a silent false confinement).

## Soak (before any default flip)
1. One develop run on devdemo, flag on.
2. Prove the loop still works: auth (option 1) + read/write worktree + git + toolchain + PR.
3. Prove confinement: plant `~/.ssh/id_probe` + `../secret.env` owned by `$USER`; the runner **cannot read them** (negative test).
4. Clean soak → then consider default flip.

## Decisions to confirm
1. Auth: start with (1) shared read-only `~/.claude`? (recommended)
2. sudoers: least-priv command allowlist vs `(_myagentrunner) NOPASSWD: ALL`?
3. Worktree sharing: group + setgid (proposed)?
4. Runner name `_myagentrunner` ok?
5. Rollout: opt-in + soak (+ negative secret-read test) before any flip.
