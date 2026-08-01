# Home Workbench Information Architecture Plan

Status: implemented, pending review

Tracking issue: #1593

## Decision

Home is the personal workbench, not a run-detail page. It answers three questions:

1. What work needs attention?
2. What will run today or tomorrow?
3. What can I start or continue now?

Run history, transcripts, failure diagnosis, approvals, and evidence remain available,
but their canonical owners are the dedicated Run records, Approvals, and Evidence
views. Home exposes counts and contextual links to those views instead of rendering
their full content.

## Capability ownership

| Capability | Canonical owner | Home representation |
| --- | --- | --- |
| Describe and start work | Home composer and Workspace composer | Compact primary action |
| Continue a previous session | Workspace session history plus composer resume context | Resume banner only after the user chooses Continue |
| Active progress and cancellation | Run records | Compact active-run summary with View progress and Cancel |
| Historical status, transcript, result, and failure diagnosis | Run records | Counts and a link; no historical transcript |
| Approval, rejection, and resume-after-approval | Approvals | Attention count and direct link |
| Evidence, review findings, and verification | Evidence / Review | Attention count and direct link |
| Today, tomorrow, and unscheduled work | Three-day workbench | Primary Home content |
| Safety, data recording, cost, and cancellation explanations | Run-before-you-start disclosure | Collapsed help, not a persistent Home panel |

## Proposed Home hierarchy

```text
Overview
├─ Header: project context + task statistics + available capacity
├─ Getting started (first-use or incomplete setup only; takes precedence because it blocks execution)
├─ Start or continue work
│  ├─ compact task input
│  ├─ primary Run / Continue action
│  └─ collapsed "Before running" permissions and cost disclosure
├─ Three-day workbench
│  ├─ Yesterday: outcomes and rollover
│  ├─ Today: active and planned work
│  ├─ Tomorrow: planned work
│  ├─ My unscheduled
│  └─ Unassigned local issues
└─ Active runs (only while at least one run is active)
```

Home must not render:

- the four-step `EntryJourney` navigation;
- a historical run transcript or terminal result card;
- a persistent task-history rail;
- the full approval or evidence interaction surface;
- a large empty activity placeholder when no run is active.

## State design

### First use

- Show the compact composer and incomplete setup guidance.
- Show the three-day workbench with an actionable empty state.
- Do not show run-history or activity placeholders.

### Idle with planned work

- Emphasize Today and Unscheduled.
- Task statistics link to filtered destinations: running/failed to Run records,
  approvals to Approvals, and evidence attention to Evidence.
- The composer remains available but does not dominate the board.

### Running

- Show the active-runs section immediately below the composer or workbench header.
- Each row contains task name, agent, status, elapsed time, and the relevant action.
- View progress opens Run records for that invocation. Cancellation remains available
  without requiring a historical transcript on Home.

### Waiting for attention

- Show a warning in task statistics and on the affected work item.
- Approval opens Approvals; evidence or review attention opens Evidence / Review.
- Do not route these actions through Home merely to reconstruct a run.

### Terminal success or failure

- Update task statistics and the relevant workbench item.
- Optionally show a transient completion notification with View result.
- View result and View failure reason open Run records.
- Do not keep the completed invocation expanded on Home after refresh.

### Continuing a session

- Continue from session history restores project, worktree, and agent context.
- It opens the Home or Workspace composer with an explicit resume banner.
- Opening a session for inspection is different: it opens Run records and must not
  switch to Home.

## Required navigation corrections

These changes are prerequisites for removing the historical detail from Home:

1. `SessionHistory.open` selects the invocation and opens `invocations`.
2. `SessionHistory.resume` continues to restore context and opens an execution
   composer; this is the only history action that should return to Home/Workspace.
3. `InvocationsView.viewApproval` opens `approvals`, preserving the selected
   invocation as context.
4. Active-run rows select the invocation and open `invocations`; they no longer rely
   on scrolling to the Home transcript.
5. `view_progress` opens `invocations` for the active invocation.
6. Run records provide a Reuse task action for terminal failures. The action restores
   the task and execution context in the composer; it must be labelled as reuse unless
   the backend performs a true retry.

## Component boundary

`DashboardView` is shared by Overview and Workspace, so removal must be scoped by
surface instead of deleting transcript support globally:

- Overview renders the composer, workbench, conditional active-run summary, and
  conditional setup guidance.
- Workspace keeps the composer and transcript because it is the focused execution
  surface.
- Run records keeps `RunTranscriptSection`, result summary, explanation, request
  context, rounds, and timeline as the historical inspection surface.
- `EntryJourney` can be deleted after its tests and translations have no consumers.

Prefer extracting the composer and active-run summary into reusable components before
further conditional branches are added to `DashboardView`.

## Task statistics behavior

Statistics are navigation, not decoration:

| Statistic | Click target |
| --- | --- |
| Pending / planned | Three-day workbench, Today or Unscheduled |
| Running | Run records filtered to active runs |
| Completed | Run records filtered to successful terminal runs |
| Failed | Run records filtered to failed/timed-out/rejected runs |
| Approval required | Approvals |
| Evidence attention | Evidence |
| Available capacity | Local scheduling preview or capacity explanation |

The existing Safety, Data, Cost, and Cancellation explanations do not belong in task
statistics because they describe execution policy rather than work state. They belong
under a collapsed Before running disclosure near the Run action.

## Delivery sequence

1. Correct cross-section navigation and add Reuse task to Run records.
2. Make active progress and cancellation independent of the Home transcript.
3. Gate transcript/result rendering to the Workspace surface.
4. Remove `EntryJourney` from Overview and delete its unused code and translations.
5. Make task statistics actionable and add approval/evidence attention counts.
6. Verify first-use, idle, running, attention, terminal, and resume states at desktop
   and narrow widths.

## Acceptance criteria

- Home contains no historical transcript, terminal result panel, four-step journey,
  or task-history rail.
- A user can still start, cancel, inspect, approve, verify, reuse, and continue work.
- Opening a historical session lands on Run records; continuing it lands on a composer.
- Clicking every task statistic leads to the corresponding filtered work surface.
- Active work is visible on Home only while active and never depends on a stale
  selected invocation.
- Refreshing Home after a terminal run does not resurrect historical detail.
- Workspace still supports focused execution and transcript viewing.
- Existing deep links to invocations, approvals, evidence, and resumed sessions remain
  valid.
