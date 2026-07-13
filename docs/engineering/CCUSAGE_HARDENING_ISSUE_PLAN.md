# ccusage Application Hardening — Review & Issue Plan

A four-lens review (global / local / observability / automation) of the ccusage
application — the governed path that runs the external `ccusage` CLI and imports
its Claude Code token-usage estimates as **non-authoritative** rows. The
non-authoritative boundary is solid (estimates never touch the metered ledger);
these tasks fix correctness, observability, and automation-safety gaps found
around it.

## The keystone finding

The import is **not idempotent**. `recordCcusageImportedEstimates`
([ccusage-imports.mjs:33-79](../../apps/server/src/services/ccusage-imports.mjs))
stores `reportId` and `rowIndex` but never uses them to look up existing rows, so
every re-run of a report re-imports duplicate rows and the economics
"estimated (external)" total inflates linearly. A scheduled `daily` capability
automation amplifies this on every fire until the 1000-row cap evicts real
history. The material for an idempotency key (`reportId` + `rowIndex` +
`periodStart`) is already in hand.

## Issue Tree

| Order | Issue | Priority | Area |
| --- | --- | --- | --- |
| 1 | ccusage Hardening Issue Plan (this doc) | — | docs |
| 2 | Idempotent ccusage import (dedup) | P0 | server |
| 3 | Empty-import event + last-imported freshness | P1 | server / web |
| 4 | ccusage tenancy review + audit of the platform-context tool path | P1 | server / security |
| 5 | Health probe for the ccusage npm binary | P2 | server |
| 6 | Robust import: drop malformed rows, surface droppedRowCount, bound raw | P2 | server |
| 7 | Cleanup: retire dead ccusage-wrapper, capture cache tokens/currency | P3 | server |

## Tasks

### PR 2 — Idempotent ccusage import (P0)

Build an idempotency key from `reportId` + `rowIndex` + `periodStart` (all
already extracted) and upsert instead of blind `unshift`, so re-running a report
(manually or on a schedule) replaces its rows rather than duplicating them.

- Accepted: a second import of the same report leaves the row count and the
  economics external total unchanged; a changed row updates in place.
- Tests: re-import is a no-op on totals; a new period adds rows; a changed value updates.

### PR 3 — Empty-import event + freshness (P1)

- Emit `ccusage_imported_estimates_recorded` (with `importedRecordCount: 0`) even
  when a report imports zero rows, so "ran and found nothing" is distinguishable
  from "never ran".
- Surface a "last imported at" timestamp on the economics imported-usage card so
  stale data does not look fresh.

### PR 4 — Tenancy review (P1)

The tool facade runs platform-wide with `actor: null` by design, while the
capability path is grant-scoped — two authz models for the same command. Either
grant-scope the tool path or keep it platform-shared but record the real caller
in an audit trail and document the boundary; ensure imported rows carry the
requesting subject for scoped display.

### PR 5 — npm binary health probe (P2)

The periodic app health probe only checks local/git source-path existence, so it
cannot tell that the ccusage npm binary is missing/broken. Add a periodic probe
(reuse the existing `ccusage_version` check) that gives a real status.

### PR 6 — Robust import (P2)

- Drop an unrecognized/malformed report shape instead of storing a single
  all-null phantom row (`normalizeReportRows` fallback `[report]`).
- Persist `droppedRowCount` onto a record / surface it, so silent truncation of a
  >1000-row report is observable.
- Bound the per-row `raw` blob before it is persisted to the snapshot.

### PR 7 — Cleanup (P3)

- Retire the dead `tools/agents/ccusage-wrapper.mjs` (the live path is
  `application-wrapper.mjs`), or fold its date/timezone validation + richer
  output into the live path.
- Capture cache tokens and honor the row currency.

## Non-Goals

- Changing the non-authoritative boundary (estimates must never enter the ledger).
- Shipping a default ccusage schedule (operators create capability automations).

## Verification Baseline

```text
pnpm --filter @myagenttool/server test
pnpm typecheck
pnpm test
git diff --check
```
