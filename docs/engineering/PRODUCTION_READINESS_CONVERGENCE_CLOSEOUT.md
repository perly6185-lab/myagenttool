# Production Readiness Convergence — Closeout (#889)

Status: closed · 2026-07-15 · Milestone M4

Epic [#889](https://github.com/perly6185-lab/myagenttool/issues/889) delivered the
four post-M3 production foundations as independently reviewable lines. All six
child tasks are closed with per-issue criterion→evidence closeouts; this document
is the epic-level record: what shipped, where the evidence lives, and — honestly —
what was deferred and remains a known boundary.

## Delivered foundations → evidence

| Phase | Child | Outcome | Evidence anchor |
| --- | --- | --- | --- |
| P0 durable core | #890 transactional store + budget reservations | closed | subsumed by the #1000 cutover line: every durable write through `store.transaction`, frozen by `store-write-guard.test.mjs`; budget holds released on completion |
| P0 durable core | #891 persisted multi-tenant isolation | closed | `seedTwoTeams` + shared `normalizeLoadedState` — scoping identical across JSON restore and SQLite hydrate; `tenancy-persistence` suite |
| P0 (execution) | #1000 read-through-store cutover (epic) | closed | SQLite is the default durable backing; JSON retired to export/backup; criterion→evidence closeout on #1000; `PERSISTENT_STORAGE_DESIGN.md` §7–§9 |
| P2 platformization | #897 immutable descriptor replacement + lineage | closed | fingerprint/revision/predecessor-successor lineage, no silent migration; 41/41 descriptor suites (closeout on #897) |
| P2 platformization | #894 per-device binary readiness + badges | closed | `application-binary-readiness` (desktop) + readiness surfaces; extended by external-credential readiness (#977 / ADR 0010) |
| P3 economics | #892 versioned pricing + reproducible cost evidence | closed | pricing version derived from configured rates; invalid rates fail fast (`model-pricing` suite) |
| P4 release candidate | #895 cross-platform E2E + fault-injection gate | closed | `pnpm release:candidate` — machine-readable per-platform evidence, 3-OS matrix in the Release workflow; release docs block on missing/stale/failed platform evidence |

Adjacent lines that converged alongside the epic (same window, own issues):
the Claude governed capability expansion P2–P4 (#912/#913/#914 — read-only
analysis, immutable proposal artifacts with integrity bindings, approval-bound
apply/rollback), the governed Application install flow (#950), and mail intake
phase 1–3 under ADR 0011 (#979 line, ongoing).

## Epic acceptance → where each is proven

1. **Child tasks have verified acceptance evidence** — each child issue closed
   with a criterion→evidence table or delivery/verification comment (links above).
2. **Invocations/approvals/audit/ledger/budget consistent across restart and
   concurrency** — `invocation-durability` (accept/completion crash model, no
   double charge), dispatch-lease semantics, single-use grants; all green on the
   SQLite-only path.
3. **Persisted read models prove tenant isolation after restore** — seedTwoTeams
   restart suites; fail-closed project filter runs identically on hydrate.
4. **Pricing and readiness never silently degrade** — versioned pricing fails
   fast on invalid rates (never NaN evidence); binary/credential readiness is
   proactive per device, and install/spawn failures are explicit, classified
   refusals — never opaque.
5. **Release-candidate matrix validates the full loop on supported platforms** —
   `release:candidate` gates + per-platform JSON evidence; CI matrix on
   ubuntu/macos/windows.
6. **Residual risks recorded honestly** — this section, below.

## Residual risks and deferred boundaries

Storage (`PERSISTENT_STORAGE_DESIGN.md` §9, restated):

1. **No true O(delta) commit** — the incremental mirror's disk I/O is O(delta)
   but CPU still serializes the whole state per commit; per-record dirty tracking
   is the deferred read-through step. Fine at single-node scale.
2. **Single-writer / single-process** — multi-instance needs the Postgres
   adapter, a separate initiative.
3. **JSON export can go stale** — written on clean shutdown + on demand, not per
   commit; SQLite (WAL) is the durable substrate.
4. **Reverting to `memory` is lossy** — recovery is from the last JSON export.

Execution and platform:

5. **Apply verification occupies the single-lane bridge** — a slow post-apply
   verify head-of-line-blocks unrelated dispatches. Deferred by design to reuse
   durable dispatch/lease semantics; tracked as
   [#1052](https://github.com/perly6185-lab/myagenttool/issues/1052) (now
   unblocked by the store line).
6. **Linux Git installation fails closed** — no reviewed elevation broker yet;
   tracked as #994. Promoted provider versions not yet pinned — #995.
7. **Pre-generation approval for broad-scope proposals** was deliberately
   re-worded (owner decision 2026-07-15, on #913): generation is read-only and
   bounded; the approval boundary is the apply step.

Out of scope, unchanged from the epic's non-goals: marketplace publishing,
payment/tax, silent remediation, arbitrary device command probes, unsupervised
merge.

## Verification commands

```text
node --test apps/server/test/*.test.mjs        # run from apps/server
node --test apps/desktop/test/*.test.mjs       # run from apps/desktop
pnpm release:candidate:check
pnpm docs:check
```
