# Verification: Execution Cancellation and Process-Tree Termination

Date: 2026-06-23

Scope: the bridge cancellation/timeout hardening — `terminateProcessTree`
(process-group SIGTERM → grace → SIGKILL, with exit confirmation) and the
`cancel_force_killed` observability event. This record captures the manual
evidence behind those changes for review traceability.

## What is being verified

All CLI agents run through one generic path: `createCliSpawnPlan` → `spawn`
(detached, so the child leads its own process group on posix; `windowsHide` on
Windows) → on cancel/timeout, `terminateProcessTree`:

- posix: signal the **process group** (`process.kill(-pid, …)`), SIGTERM first,
  escalate to SIGKILL after a grace window, and confirm the child exited;
- Windows: `taskkill /pid <pid> /t /f`;
- already-gone groups (ESRCH) are treated as success; a forced SIGKILL emits a
  `cancel_force_killed` event.

No agent-specific code is involved, so Codex, Claude, and any other CLI agent
share the same behavior. The cases below confirm that empirically.

## Method

Live runs against the local M0 demo (`pnpm dev`). For real coding agents, the
agent's process tree was isolated with a **baseline diff**: snapshot matching
pids before the run, subtract them from the during-run snapshot to get exactly
the pids this invocation spawned, then confirm none survive after cancel + grace.
This isolates the run from any unrelated agent processes on the machine.

## Case 1 — Codex (`codex exec`, real run)

- Before cancel: **2** live processes — the `codex` node wrapper and its native
  `codex` binary child (a genuine multi-process tree).
- After cancel + grace: **0** — the whole group was terminated, no orphans.
- Invocation `cancelled`, cancellation state `applied`; events
  `cancel_requested → cancel_dispatched → cancel_applied`.

Proves group termination reaches a real parent+child tree (the old
SIGTERM-to-parent-only path could have orphaned the native child).

## Case 2 — Claude (`claude -p`, real run)

- Baseline-isolated process tree for this run: **1** process (`claude -p` talks
  to the API in-process in plan mode; it did not fork persistent children).
- After cancel + grace: **0 orphans** from this run.
- Cancelled in ~3.4s, state `applied`, **graceful** — Claude honored SIGTERM, so
  no SIGKILL escalation was needed (no `cancel_force_killed`).
- **6 unrelated ambient Claude processes on the machine were untouched** — the
  group-scoped kill targets only this invocation's process group, never other
  `claude` processes. This precision is a property of spawning detached
  (one group per invocation).

Proves the hardening applies to Claude via the shared path, and that group
targeting is precise (no collateral kills).

## Case 3 — Stubborn agent (ignores SIGTERM)

A CLI agent that traps and ignores SIGTERM, then loops forever.

- Cancel → SIGTERM (ignored) → ~2s grace → **SIGKILL**; cancelled in ~2.1s.
- Events: `cancel_requested → cancel_dispatched → cancel_force_killed →
  cancel_applied`. The `cancel_force_killed` event carries
  `{ signal: "SIGKILL", reason: "Process tree force-killed with SIGKILL after
  grace period." }`.

Proves the escalation path and that a hard kill is recorded distinctly from a
clean cooperative stop.

## Coverage summary

| Case | Tree size | Orphans after cancel | Stop signal | Force-kill event |
| ---- | --------- | -------------------- | ----------- | ---------------- |
| Codex (real) | 2 | 0 | SIGTERM | no |
| Claude (real) | 1 | 0 | SIGTERM | no |
| Stubborn (ignores SIGTERM) | 1 | 0 | SIGKILL (escalated) | yes |

Conclusion: cancellation cleanly terminates the agent's process group for
well-behaved agents (Codex, Claude) and for agents that ignore graceful stop
(SIGKILL escalation), with the forced kill made observable, and without touching
unrelated processes. HTTP-agent invocations enforce their own timeout via
`AbortController` (`timed_out`) and are out of scope for process-tree kill.

Related: ADR 0003 (Desktop Bridge Runtime), `REMOTE_EXECUTION_RESEARCH.md` (the
same cancellation contract must be reproduced for remote/SSH execution).
