# Definition of Done

This document defines when work can be considered complete.

Where a quantitative gate exists, "done" means the gate is **measured, not
asserted**: maturity-level gates and their thresholds live in
[MATURITY_CALIBRATION.md](MATURITY_CALIBRATION.md), and the current counters are
`pnpm github:dora` (delivery health), `pnpm github:backlog` (backlog/evidence
coverage), and `pnpm ai:eval-heldout` (AI coding capability).

## Issue Done

An issue can move to `done` when:

- Acceptance criteria are satisfied or explicitly revised.
- The relevant PR is merged, or the issue is closed as not planned with a clear
  reason.
- Tests or manual verification evidence are recorded.
- Relevant docs are updated.
- Project fields are current.
- Follow-up risks, ADRs, or tasks are filed for deferred work.

## Pull Request Done

A PR is ready to merge when:

- It links to one or more issues.
- It explains the user-visible outcome.
- It lists tests run.
- It states security, data, cost, audit, and UX implications when relevant.
- It avoids unrelated refactors.
- It does not silently expand milestone scope.
- Review comments are resolved.

## Documentation Done

Documentation work is done when:

- It has a clear source of truth.
- It links to related docs.
- It avoids contradiction with vision and engineering docs.
- Markdown links pass validation.
- The text distinguishes current behavior from future vision.

## Code Done

Code work is done when:

- It satisfies acceptance criteria.
- It has tests proportional to risk.
- It handles failure paths.
- It uses structured data and typed schemas where practical.
- It is observable enough to debug.
- It does not expose internal terminology to non-professional users unless in an
  advanced view.

## M0 Specific Done

M0 work is done only when it supports the remote invocation loop.

For M0, every implementation issue should answer:

- Does this help a user link a device, register an agent, invoke it, observe it,
  cancel it, or audit it?
- Does it preserve offline queue and reconnect semantics?
- Does it respect device unlink behavior?
- Does it make risk, data handling, and cost understandable?

## Security Done

Security-sensitive work is done when:

- Permissions are explicit.
- Credentials are not logged.
- Dangerous local execution requires local approval or a documented M0
  limitation.
- Audit evidence is recorded.
- Failure modes are visible.

## Billing Done

Billing or economics work is done when:

- Usage is attributable.
- Unknown cost is surfaced.
- Quotas, budgets, or chargeback behavior are documented.
- Settlement or revenue logic is not implied before it exists.

## Release Done

A release is done when:

- Version notes are written.
- Migration or rollback notes exist when needed.
- Known limitations are listed.
- Production-impacting risks have an owner.
- The Project reflects shipped and deferred work.
