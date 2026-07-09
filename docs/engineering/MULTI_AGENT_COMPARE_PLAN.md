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
- **P4.1 (DONE, #621) — Compare UI.** api-client `startCompareRun`; a `compare` section:
  a composer (task + multi-select ≥2 agents) → start → side-by-side panels, one per
  child invocation, each showing the agent, status, and its transcript (events
  filtered by invocation id), with the preferred child highlighted. Reads
  compareRuns + invocations + events from state. Composition over the existing
  server + Transcript component.
- **P4.2 (DONE, #625) — isolated worktrees + diff compare + pick/promote.** `createCompareRun`
  materializes one worktree per agent when a `projectId` is given (`isolated`), so
  code-editing agents don't collide; each panel shows that agent's worktree diff
  (lazy, colorized). `setCompareRunPreferred` lets a human pick the winner; `promoteCompareRun`
  opens the winner's worktree PR (idempotent; refuses shared/answer compares). Routes
  `/api/compare-runs/:id/prefer` + `/promote`, tenancy-guarded. No project → shared
  context (answer compares), unchanged.

## Non-goals (now, post-P4.2)
- Diff annotation / inline review (Phase 5).
