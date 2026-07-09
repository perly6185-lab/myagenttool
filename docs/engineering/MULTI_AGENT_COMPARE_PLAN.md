# Multi-agent compare (#128 Phase 4) — plan

Run the same task on 2+ agents and compare their results side by side — Orca's
signature capability, on the Agent Workspace.

## Current state — the SERVER is already built (UI is the gap)
- `services/invocations/compare.mjs` `createCompareRun(task, agents)` fans out one
  invocation per agent (each tagged `compareRunId`), starts them, tracks the group.
- `completion.mjs updateCompareRun` rolls up status as children finish and picks a
  `preferredInvocationId` (first success).
- `POST /api/compare-runs {task, agentIds, options}` (tenancy-guarded, ≥2 ready agents).
- `state.compareRuns` persisted + in the read-model; `invocation.compareRunId` set.
- **Gap:** no api-client method, no UI (only a "Compare run" label in invocations).

## Slices
- **P4.1 (this) — Compare UI.** api-client `startCompareRun`; a `compare` section:
  a composer (task + multi-select ≥2 agents) → start → side-by-side panels, one per
  child invocation, each showing the agent, status, and its transcript (events
  filtered by invocation id), with the preferred child highlighted. Reads
  compareRuns + invocations + events from state. Composition over the existing
  server + Transcript component.
- **P4.2 — isolated worktrees + diff compare + promote.** Each agent runs in its OWN
  worktree so code-editing tasks don't collide; compare their diffs; a human sets the
  preferred and promotes it (open its PR). (createCompareRun today shares context —
  fine for read-only/answer tasks; edit-compare needs per-agent worktrees.)

## Non-goals (P4.1)
- Per-agent worktree isolation (P4.2) — P4.1 targets read-only/answer compares.
- Human-set preferred + promote (P4.2).
