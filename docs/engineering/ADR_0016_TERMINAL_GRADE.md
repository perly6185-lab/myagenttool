# ADR 0016: A run's terminal grade is a derived read-model field first; a stored `finalStatus` is an additive column, never a replacement for `status`

Status: proposed · 2026-07-17

Date: 2026-07-17

Related issue: [#1182](https://github.com/perly6185-lab/myagenttool/issues/1182)

## Context

An auto-run's lifecycle `status` is a closed enum on the state machine
(`materializing / running / awaiting_approval / verifying / publishing /
pr_open / report_posted / done / blocked / failed / needs_input / decomposed`,
`apps/server/src/services/auto-run.mjs`). Every terminal outcome collapses to a
binary read: a run either reached a success terminal or it did not. The
observability assessment (#1179) found this hides the important middle — the
article calls out that "failed then recovered", "failed then terminated", and
"failed then the model hallucinated a plausible answer" must be distinguishable,
and that the last is the most dangerous.

Phase 1 (#1183) already ships a **derived** grade: `deriveFinalStatus(run)` in
`apps/server/src/services/auto-run-metrics.mjs` computes `clean_success /
degraded_success / unverified_success / failed` from signals already on the run
(`verification.verified`, `repairAttempts`, terminal status), with no
status-machine change. This ADR decides whether the grade should ever become a
**stored** field, and if so under what constraints — because adding a first-class
terminal enum touches persistence, read-models, UI badges, metrics, and the
protocol invariants (`toolInvocationStatuses ⊆ roundStatuses`, etc.).

## Decision

**The terminal grade is a derived read-model field by default. A stored
`finalStatus` may be added only as an ADDITIVE column alongside — never in place
of — the lifecycle `status`.** Five invariants:

1. **`status` remains the single source of truth for the state machine.** No
   grade value is ever written into `status`; no transition, guard, scheduler,
   or read-model gate keys off a grade. A grade is an interpretation of a
   terminal `status`, not a state.

2. **Derived-first.** The grade is computed by the one pure function
   `deriveFinalStatus(run)`. Both the aggregate (`summarizeAutoRuns().finalStatuses`)
   and any per-run badge call it — they never re-derive independently, so the
   distribution and the badge can never disagree.

3. **A stored `finalStatus` is a cache of the derivation, stamped only at a
   terminal transition, and reconciled from the derivation on read.** If
   persistence is added (e.g. to grade runs whose inputs are later reaped by
   retention), the stored value must equal `deriveFinalStatus(run)` at stamp
   time; a divergence is a bug, and the derived value wins on read. Older
   snapshots without the column grade lazily from their surviving signals.

4. **The grade taxonomy is a closed, documented enum, extended only by ADR.**
   Today: `clean_success`, `degraded_success`, `unverified_success`, `failed`,
   and `null` (not yet at a gradable terminal). A new grade — e.g. a
   `suspicious_success` for "a success terminal whose acceptance judge said
   *not solved*" — is a taxonomy change and amends this ADR.

5. **Grades are derived from evidence already recorded, never from new content
   capture.** `verification`, `repairAttempts`, `judgment.solved`, recovery
   signals — all already on the run. Grading must not require storing prompts,
   tool output, or any new PII.

## Consequences

- The operator sees a clean/degraded/unverified/failed split instead of one
  undifferentiated "success", and can catch an `unverified_success` (a PR opened
  with no check ever run) before merging it — the article's headline case.
- No migration and no protocol break for the derived form (already shipped). A
  stored column, if pursued, is backward compatible because it is additive and
  reconciles from the derivation.
- The grade cannot drift from the state machine, because it never participates in
  it and is always reconcilable from `status` + evidence.
- Cost: a stored column adds one persisted field and a stamp point at terminal
  transition; the derived form has zero storage cost but cannot grade a run whose
  inputs retention later reaps (accepted — grade at terminal time if durability
  is needed).

## Testable rules

- `deriveFinalStatus` returns `null` for every non-terminal status and for a
  missing/!string status; `failed` for `failed`/`blocked`; `unverified_success`
  when a success terminal has `verification.verified === false`;
  `degraded_success` when a success terminal has `repairAttempts > 0` and a check
  ran; `clean_success` otherwise. (Covered in `auto-run-metrics.test.mjs`.)
- `summarizeAutoRuns().finalStatuses` counts equal the per-run `deriveFinalStatus`
  applied across the same input.
- If a stored `finalStatus` is added: for any terminal run, the stored value
  equals `deriveFinalStatus(run)` at stamp time; a snapshot missing the column
  restores and grades without error.
