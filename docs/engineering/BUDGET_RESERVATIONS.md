# Budget Reservations (#890)

The first slice of the #890 durable-core work: a **reservation** boundary for
concurrent USD budget admission. It does not yet introduce the full transactional
store (that is #890's later slice) — it closes the specific race where two
spend-bearing runs pass a budget check before either has recorded spend.

## The problem it fixes

`budgetStatusFor` re-sums only **finalized** ledger spend, and a run's spend is
recorded at completion (`recordInvocationLedgerEntry`). So N runs that start near
a limit all read the same pre-spend total, all pass, then all spend. A project
with a `$10` block budget and `$0` spent could admit unbounded concurrent runs.

## The mechanism

A **reservation** (`state.budgetReservations`) is a hold placed **synchronously**
at admission, before a run has spent anything. Node is single-threaded, so a
read-then-write done in one synchronous tick (no `await` in between) is atomic —
`reserveBudget` is that tick. A concurrent admission that runs later sees the hold.

- `reserveBudget({ projectId, amountUsd, autoRunId })` — atomically refuses (writes
  nothing) when finalized spend + existing active holds + this amount would exceed
  a **block** project budget or its **team pool**; otherwise writes an `active`
  hold and returns `{ ok: true, reservationId }`. A non-positive amount, or a
  project/team with no block budget, always succeeds (accounting-only) — it never
  invents a refusal a plain over-budget check wouldn't also raise.
- `releaseBudgetReservation(id, { outcome })` / `releaseReservationsForAutoRun(id)`
  — mark holds settled (idempotent). Called from `setAutoRunStatus` whenever a run
  reaches a settled status: the run's real ledger spend now gates the next
  admission, not the estimate.
- `reconcileBudgetReservations({ isSettled })` — releases any `active` hold whose
  owning auto-run is already settled or gone. Wired into the boot + 60s
  `reapStuckAutoRuns` sweep so a crash between reserve and settle can't leak a hold
  that blocks the budget forever.

`budgetStatusFor` gains `reservedUsd` (sum of active holds), `admissionUsd`
(`spentUsd + reservedUsd`), and `admissionOver`. The display fields `spentUsd` /
`over` keep their finalized-only meaning, so economics UI is unchanged.

## Enabling it

The per-run hold amount is the setting `autoRunSettings.reservationEstimateUsd`
(USD, clamped `[0, 1_000_000]`), settable via the auto-run config `PUT`.

- **Default `0` = disabled**: no holds are written; behaviour is byte-identical to
  before (accounting-only). This preserves the repo's default-off discipline — a
  block-budget project sees no new refusals until an operator arms the estimate.
- **`> 0` = armed**: each auto-run reserves that amount at admission. With a `$10`
  block budget and a `$6` estimate, at most one run is admitted at a time until it
  settles; a second concurrent start is refused with `budget would be exceeded`.

Pick an estimate near a typical run's cost. Too low under-protects (many runs
admit before the real spend catches up); too high over-throttles concurrency.

## Reset / migration

- `budgetReservations` is a new, additive collection (`persistedArrayKeys`). Old
  snapshots simply lack it and restore fine (the array defaults to empty).
- To clear all holds locally: stop the server and delete `budgetReservations`
  from the state snapshot, or just start the server — the boot reconcile releases
  every hold whose run is settled/gone. No migration step is required.

## Scope / follow-ups

- The manual invocation-creation path (`invocations/creation.mjs`) still uses the
  finalized-spend gate; extending reservations there is a small follow-up.
- The full transactional store boundary + dispatch-claim/idempotency consistency
  and crash-recovery of accepted invocations remain the rest of #890.
