# P1 Durable State Closeout

This document records the accepted durable-state hardening scope after the
July 2026 P1 slices. It closes the current local control-plane durability pass:
state is still a local snapshot runtime, not a production database, but the
records that support operator recovery, billing, review evidence, and audit
export are now covered by restart-focused regression tests.

## Accepted Scope

P1 accepted scope is the local file-backed persistence boundary in
`apps/server/src/runtime/persistence.mjs` plus the service/read-model contracts
that make restored records useful after a server restart.

- Snapshot restore remains schema-gated and reconciles the default project path.
- Control-plane array/object keys are persisted through `persistedArrayKeys` and
  `persistedObjectKeys`.
- Spend-bearing ledger rows are protected from display trimming, so restored
  budget totals cannot silently under-count spend.
- Critical lifecycle audit rows are protected from routine queue/running noise
  trimming, so old failure/result/rollback evidence survives.
- Restart tests now verify not only that rows reappear, but also that the
  restored rows still drive public read models, budget calculations, Evidence
  Center records, and audit export refs.
- Policy and approval evidence now restores through the same bar: invocation
  policy decisions, lifecycle policy decisions, invocation approvals, Codex
  approval-broker requests, and audit export requests remain readable and
  export-addressable after restart.

## Acceptance Matrix

| Durable surface | Accepted evidence | PR |
| --- | --- | --- |
| Active control-plane records | `persistence restores active control-plane records across runtime restart` restores agents, health checks, lifecycle records, discovery, integration artifacts/probes, terminal records, SSH targets, ledger rows, and retention settings. | Earlier persistence slice |
| Runtime id continuity | `runtime ids continue after restoring persisted state` proves new ids do not collide with restored invocation/approval ids. | Earlier persistence slice |
| Lifecycle audit retention | `capLifecycleAuditRecords` keeps completed, failed, result-bearing, and rollback lifecycle evidence while capping routine queued/running rows. | #410 |
| Lifecycle recovery after restart | `persistence restores lifecycle recovery evidence and ledger spend across runtime restart` writes lifecycle failure + rollback through M3, restores it, and verifies result, exit code, rollback metadata, queued action result, and audit export refs. | #412 |
| Ledger and budgets after restart | The same restart test verifies a spend-bearing ledger row still drives `budgetStatusFor`, `ledgerSummary`, and audit export refs after restore. | #412 |
| Imported usage after restart | `persistence restores imported usage and review evidence across runtime restart` restores ccusage imported estimates with cost/filter/raw server payload intact. | #413 |
| Public raw redaction after restart | The imported-evidence restart test verifies public `importedUsageEstimates` and unified `reviewFindings` still strip raw payloads after restore. | #413 |
| Review findings after restart | The imported-evidence restart test restores Codex and Claude review findings and verifies they remain available through public `reviewFindings`. | #413 |
| Imported usage audit export | The imported-evidence restart test verifies restored imported usage rows remain addressable by audit export manifest refs. | #413 |
| Codex sessions after restart | `persistence restores terminal and Codex evidence center linkage across runtime restart` restores provider session id, thread id, and managed session evidence ids. | #414 |
| Codex evidence and change reviews | The terminal/Codex restart test verifies Codex JSONL evidence and change reviews retain managed session linkage and Evidence Center reconstruction. | #414 |
| Managed terminal evidence | The terminal/Codex restart test verifies terminal session owner Codex linkage, evidence ids, completed bridge action, and Evidence Center terminal output after restore. | #414 |
| Policy and approval evidence after restart | `persistence restores policy and approval evidence across runtime restart` restores invocation policy decisions, denied approval requests, lifecycle policy decisions, pending Codex approval-broker requests, Evidence Center broker rows, and persisted audit export requests. | Current P1 follow-up |
| Approval and policy audit refs after restart | The policy/approval restart test verifies a new post-restore audit export includes invocation policy, lifecycle policy, invocation approval, Codex broker approval, and denied-invocation audit refs. | Current P1 follow-up |

## Verification Commands

The closeout slices used this local command set:

```text
pnpm --filter @myagenttool/server exec node --test test/persistence.test.mjs
pnpm --filter @myagenttool/server test -- test/persistence.test.mjs
pnpm typecheck
pnpm docs:check
pnpm repo:check
git diff --check
```

PR CI also reported `verify`, `desktop-smoke (ubuntu-latest)`, `eval-gates`,
and `pr-governance` passing for #410, #412, #413, and #414 before merge.

## Remaining Risks

- The accepted store is still a local JSON snapshot boundary. It is durable
  enough for local demo/control-plane continuity, but it is not transactional,
  append-only, or multi-process safe.
- Dispatch claim, budget admission, and idempotency races still need a real
  store/transaction boundary before this can be treated as production-grade.
- External audit sinks are represented in manifests and validation, but the
  demo path does not deliver to an external immutable sink.
- The P1 tests prove restore and read-model utility for the highest-value
  evidence surfaces, not every possible array key in `persistedArrayKeys`.
- Multi-tenant restore behavior is still primarily covered by scoped read/write
  tests with persistence disabled; a future pass can combine persisted snapshots
  with multi-user fixtures.

## Next Recommended Slice

If P1 continues, the best next slice is a focused multi-tenant persisted
snapshot test. The current tenancy tests primarily run with persistence
disabled; the next useful bar is to write scoped records for two teams, restore
from disk, then verify public read models, Evidence Center records, budgets, and
audit export refs still hide foreign-team evidence.
