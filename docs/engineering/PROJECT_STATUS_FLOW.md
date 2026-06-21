# Project Status Flow

This document defines how Product Flow, GitHub issues, Project status, Code
Flow, and PR evidence move together. The Project board should reflect verified
delivery state, not optimism.

## Relationship

```text
Product Flow -> Issue -> Project Status -> Code Plan -> PR Evidence -> Done
```

For product-facing UI work that begins as an ASCII sketch, insert Prototype
Canvas before Code Plan:

```text
Product Flow -> Issue -> Project Status -> ASCII Sketch -> Prototype Canvas
-> HTML Prototype -> Visual QA -> Code Plan -> PR Evidence -> Done
```

- Product Flow defines who the work serves, which surface owns it, which states
  must be proven, and what must stay hidden.
- The issue is the implementation contract.
- The Project item is the management state for that contract.
- Code Flow is downstream of the issue and Product Flow.
- PR evidence proves that the issue can move forward.

## Status Gates

### Backlog

Use for ideas, scoped work, and follow-ups that are not ready to implement.

Required:

- Issue exists.
- Milestone, area, type, risk, platform, agent target, priority, and source doc
  are present or intentionally marked.

Cannot move to `ready` until:

- Acceptance criteria are defined.
- Product Flow is concrete for UI, workflow, or user-facing work.
- Security, data, cost, lifecycle, and UX impact are considered.
- Blocking ADRs or risks are linked.

### Ready

Use when work is ready for implementation.

Required:

- `Acceptance = defined`.
- `Status = ready`.
- `## Project Fields` matches labels.
- UI/workflow work has concrete `## Product Flow` values:
  role flow, scenario, frequency, owner surface, usability task, what not to
  show, and partial acceptance or follow-up.

Cannot move to `in progress` until:

- A code plan exists or the task is trivial enough to explain inline.
- Product-facing code plans include `productFlow`, `affectedSurfaces`,
  `prototypeStates`, `acceptanceSignals`, `whatNotToShow`, and `visualQaTasks`.
- ASCII-derived UI work has a planned Prototype Canvas artifact and HTML
  prototype output, or the issue explains why the canvas step is not applicable.

### In Progress

Use while implementation is active.

Required:

- Work stays inside the issue scope.
- Scope drift is recorded through code plan or a follow-up issue.
- Product Flow drift is resolved before PR review.

Cannot move to `review` until:

- PR is open and linked to the issue.
- Verification evidence is listed.
- Product-facing work includes Visual QA and Product Flow evidence.
- ASCII-derived UI work links the Prototype Canvas artifact, exported HTML
  prototype, and generated Visual QA checklist.

### Review

Use when the PR and evidence are ready for human review.

Required:

- PR links or closes the issue.
- PR body includes Product Flow for UI/workflow work.
- Automated checks are run or explicitly marked as not run with a reason.
- Risk gates are addressed.

Cannot move to `done` until:

- PR is merged or the issue is explicitly closed as not planned.
- Acceptance criteria are verified.
- Residual risks or follow-up tasks are filed.
- Project sync can set `Status = done` and `Acceptance = verified`.

### Blocked

Use when work cannot proceed without a decision or external change.

Required:

- Blocker is named in the issue.
- Next unblock action is stated.
- Owner or decision point is identified.

### Done

Use only after evidence is complete.

Required:

- `Acceptance = verified`.
- PR evidence or closeout evidence exists.
- Product Flow acceptance signals are satisfied or residual gaps are linked.
- Project sync has been run or the final handoff states why it was not run.

## Automation Expectations

- `github:check:issues` should fail ready UI/workflow issues with missing or
  placeholder Product Flow.
- `github:check:issues` should warn when review issues are not verified.
- `github:sync-project --done` should only be used after acceptance evidence is
  verified.
- AI final handoff should name touched issue IDs and Project sync result.
- Prototype Canvas Phase 1 work should not move to done unless its closeout
  links the ASCII source, scene graph or canvas artifact, HTML export, and
  Visual QA checklist.
