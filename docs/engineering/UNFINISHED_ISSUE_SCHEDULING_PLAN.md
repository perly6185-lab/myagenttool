# Unfinished Issue Scheduling Plan

Status: in development

Parent capability: #1583 current-terminal three-day scheduling

Tracking issue: #1592

## Problem

The current-terminal scheduler plans durable local Work Items, while the Home
work board also contains unfinished GitHub Issue work represented by Auto-runs.
When an Auto-run has no local Work Item binding, it is visible as runtime state
but is absent from `/api/local-schedule/*`. The UI consequently places it in
Today without a planned date, schedule order, or bounded unscheduled reason.

## Product flow

```text
unfinished Issue / Auto-run
  -> current-terminal scheduling candidate
  -> deterministic preview
     -> Today or Tomorrow when executable and capacity fits
     -> Unscheduled when blocked, failed, awaiting a decision, or over capacity
  -> explicit Apply plan
  -> durable personal schedule assignment
  -> Home work board shows the persisted date, order, source, and reason
```

Unassigned local Issues follow a separate intake path:

```text
all open local Issues (cursor-complete)
  -> already assigned to me -> My unscheduled / Today / Tomorrow
  -> no assignee -> Unassigned
     -> explicit Assign to me
     -> personal scheduling candidate on the next refresh
  -> assigned to another user -> excluded from my workbench
```

The existing local Work Item flow remains authoritative when an Auto-run is
already bound to one. Runtime work is added only when it has no local binding,
so one Issue never appears as two scheduling candidates.

## Scope

- Current terminal and current actor only; no cross-terminal allocation.
- Unfinished Auto-runs that represent Issue work and are visible to the actor.
- Durable schedule assignments keyed by runtime work identity.
- A dedicated Unscheduled lane with bounded, translated reason codes.
- Cursor-complete loading of local Issues, split between My unscheduled and
  Unassigned; the latter does not consume personal terminal capacity.
- A revision-gated Assign to me action that cannot take work from another user.
- Preview remains non-mutating; Apply remains explicit and revision-gated.
- Running work is never interrupted by replanning.

## Non-scope

- Automatically retrying failed runs or resolving blocked/decision work.
- Treating human-attention work as terminal execution capacity.
- Creating duplicate local Work Items for existing Auto-runs.
- Multi-terminal routing, migration, or fleet scheduling.

## Acceptance

- [x] An unbound unfinished Issue/Auto-run appears in local schedule capacity.
- [x] Executable runtime work receives a deterministic Today/Tomorrow preview.
- [x] Applying a runtime placement persists date, order, source, and reason.
- [x] A stale preview is rejected before any assignment is written.
- [x] Failed, blocked, or decision-gated work is visible under Unscheduled with
      a bounded reason and does not consume terminal minutes.
- [x] Bound Auto-runs are represented only by their local Work Item.
- [x] The three-day board no longer labels unplanned runtime work as Today.
- [x] Tenant, actor, terminal, concurrency, and worktree boundaries remain
      unchanged.
- [x] Every open, unarchived, unfinished local Issue is classified from all
      cursor pages rather than only the first 100 records.
- [x] Unassigned local Issues appear under Unassigned and do not enter personal
      scheduling or terminal capacity before assignment.
- [x] Assign to me uses the authenticated server identity, rejects stale data,
      and never replaces another assignee.
- [x] After assignment, the item leaves Unassigned and is eligible for personal
      scheduling on refresh.

## Verification

- Server capacity, preview, apply, tenancy, and persistence tests.
- Work-board read-model and Web interaction tests.
- Web typecheck, build, bundle budget, and `git diff --check`.
