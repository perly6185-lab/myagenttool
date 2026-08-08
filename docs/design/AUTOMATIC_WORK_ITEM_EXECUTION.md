# Automatic Work Item Execution

Status: implemented · 2026-08-08

## Outcome

An ordinary user can create a task, choose **Create and let AI work**, and leave. The system keeps selecting executable work while resources are available. It considers overdue, current, newly created, and future-planned tasks in one queue. The user is interrupted only for a decision, approval, missing input, or result review.

The planned date is guidance, not a reservation. Future work may be pulled forward when the project allows it. `notBefore` is the only hard time boundary.

## Controls users need to understand

- Project: **AI automatically processes tasks**. Existing projects default to off; a project must opt in.
- Project: **Pull future work forward when idle**. Defaults on after project opt-in.
- Task: automatic, manual, or paused. New **let AI work** tasks explicitly select automatic mode.
- Task: **Mark urgent** maps to `p0`; **Pause future AI work** never forcibly cancels an active run.

Capacity waits, internal retries, queue rank, and shadow decisions are operator details. They do not create user attention items.

## Eligibility and ordering

A task is eligible when all of the following hold:

1. Project and task policy resolve to automatic execution.
2. The task is open and in `ready` or `in_progress` planning state.
3. It is not waiting on the user, requester, or another internal decision.
4. It has no active execution, start operation, or unresolved dependency.
5. `notBefore`, when present, has passed.
6. A future planned date is allowed by the project pull-forward setting.

Eligible tasks are ordered by:

1. urgent `p0` override;
2. deadline risk: overdue, due today, due in two days, due this week, later/no deadline;
3. task priority `p0` through `p3`;
4. plan position: missed, today, future, unscheduled;
5. due date, planned date, update/create age, stable task ID.

The same urgency score is used by the real invocation selector, so priority survives admission and affects execution rather than only the UI.

## Reliability and safety

- Admission is serialized by the work item's execution operation and an active Run check.
- A Run is reserved before the durable binding is written. A later sweep repairs a missing binding and re-enqueues understanding if the process stopped in that gap.
- Capacity refusal aborts the temporary admission quietly and retries on the next sweep even when the queue signature is unchanged.
- Active runs prevent duplicate admission. Paused tasks stop future automatic admission.
- The global autonomy kill switch forces scheduler mode to `off`.
- Completion, external writeback, approvals, and delivery review keep their existing gates. Scheduling does not approve or publish work.

## Rollout and rollback

The internal scheduler mode is `off`, `shadow`, or `enabled`.

- `shadow`: records the task that would be selected without creating execution state.
- `enabled`: admits work only for projects with `autoExecutionEnabled: true`.
- `off`: stops new automatic admissions. Existing runs retain their ordinary cancel/review controls.

The application default is `enabled`, while existing projects remain safe because project opt-in defaults to false. For a conservative rollout, set the internal mode to `shadow`, inspect the preview endpoint, enable selected projects, then move to `enabled`. Rollback is immediate: set mode to `off` or activate the global autonomy kill switch. No data migration rollback is required because the added fields are optional and backward compatible.

## Observability

`GET /api/work-item-auto-scheduler` returns a tenant-scoped queue preview and in-process metrics:

- sweep count, last sweep time, eligible count, and current decision-reason counts;
- shadow selections and real starts;
- capacity deferrals and start failures;
- recovered bindings, isolated recovery failures, and duplicate-start prevention observations;
- future tasks pulled forward and the last start time.

Audit events cover decisions, starts, failures, and recovered bindings. Suggested rollout checks are: no duplicate Run for one task, capacity deferrals later convert to starts, `waiting_for_user` tasks never start, and future pull-forwards occur only where the project allows them.

## PR sequence

1. Scheduling policy and priority rules.
2. Work-item/project fields and compatibility defaults.
3. Shadow queue and preview endpoint.
4. Automatic admission, binding, and triggers.
5. Priority-aware real invocation dispatch.
6. Ordinary-user controls and automatic handoff.
7. Recovery, rollout metrics, documentation, and full CI.
