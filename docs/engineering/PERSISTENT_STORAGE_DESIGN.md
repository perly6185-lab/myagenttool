# Persistent Storage Design (#124)

Design for the control-plane persistence boundary: what is durable today, the
seam that lets services move off the single-file snapshot without a rewrite, the
production store options + recommendation, and the migration / retention /
redaction rules. This is the DESIGN task; the implementation lands as the
follow-up tasks listed at the end (and the rest of #890's store work).

Scope is the server control plane (`apps/server`): agents, devices, invocations,
events, traces, spans, policy/approval records, audit summaries, integration
artifacts/probe runs, quota/usage/ledger records, budgets + budget reservations,
retention settings, worktrees/auto-runs/deployments, and Codex session/evidence
metadata. It deliberately reuses the durability work already merged rather than
redesigning it.

## 1. What is durable today

Persistence is a **single-file atomic JSON snapshot**, not a per-record store.

- **Store**: the whole `state` object is serialized to one file
  (`.myagenttool/state/local-demo-state.json`, override `MYAGENTTOOL_STATE_PATH`)
  by `runtime/persistence.mjs`. `durableWriteFileSync` writes a temp file →
  `fsync` → atomic `rename` → dir `fsync`, so the target is always a complete
  snapshot (never torn). A flush is therefore **all-or-nothing across every
  collection**.
- **Barriers**: `persistStateSoon()` (20 ms debounce, coalescing, lossy on a
  crash in the window) and `persistStateNow()` (synchronous flush, cancels the
  debounce). The debounce window was the only real loss surface.
- **Whitelist**: `persistedArrayKeys` (64) + `persistedObjectKeys` (6) +
  explicit fields (`projects`, `currentProjectId`, `worktrees`, `devices`,
  `device`, `idCounter`). A completeness test asserts every state-factory key is
  classified durable-or-transient (`tenancy-persistence.test.mjs`), so a new
  owner-scoped collection can't silently fall out of the snapshot.
- **Restore**: schema-gated (`schemaVersion === 1`; a bump → `quarantineSnapshot`
  moves the file aside and starts fresh — no in-place loss), projects filtered to
  on-disk paths, per-collection duplicate-id repair (#832), devices forced
  offline, id counter travels with the state it minted.
- **Integrity + safety already merged**:
  - Single-writer lock (`runtime/state-lock.mjs`, #951) — a second live process
    on the same host refuses to start; stale locks reclaimed.
  - Unit-of-work boundary (`runtime/state-transaction.mjs`, #957) — invocation
    accept + completion (incl. the ledger entry) commit synchronously on every
    exit; no lost run, no double charge.
  - Budget reservations (#946/#963) — a durable `budgetReservations` collection
    holds spend at admission so concurrent runs can't exceed a block budget.
  - Ownership-inconsistency scan on restore (`detectOwnershipInconsistencies`,
    #891) + persisted multi-tenant isolation proof.
- **Tenancy**: scope is derived at read time from the owning project's team
  (`teamOf`) in `read-models/state.mjs` + route guards (`denyForeignProject`);
  most records carry no `teamId` column.
- **Idempotency**: a client key is a field on the invocation record
  (`invocation.idempotencyKey`), deduped by a linear scan; durable with the record.

### Remaining limitations (the reason for this design)

1. **Not multi-process / not horizontally scalable.** One writer per state file
   (now enforced by the lock). Two app instances need a shared store.
2. **Whole-file rewrite is O(total state) per flush.** Fine for a local control
   plane; a scaling wall as collections grow.
3. **No per-record transactions beyond the two UoW call sites.** Most service
   writes are still `state.<collection>.push` + `persistStateSoon`.
4. **Tenancy is derived, not stored.** Correct today (fail-closed), but a real
   multi-tenant store wants an owner column to index/partition on.
5. **Retention is by count caps, not time/space policy** (`retention.mjs`).

## 2. The persistence boundary (the seam)

The goal is a **store interface** that services depend on instead of reaching
into `state.<collection>` + `persistStateSoon`, so the snapshot implementation can
be swapped for a per-record durable store without touching call sites.

Two layers already point the way and should be generalized:

- **`runStateTransaction(commit, fn)`** (#957) is the unit-of-work primitive. A
  real store hooks `commit` to open/commit a transaction. Extend its use from the
  two invocation call sites to every logical operation (dispatch claim, approval,
  ledger, lifecycle action, deploy).
- **The whitelist** (`persistedArrayKeys`/`persistedObjectKeys`) is already the
  canonical registry of durable collections. A store adapter enumerates the same
  registry.

Proposed interface (implementation-agnostic; the in-memory snapshot is one
adapter, a durable store is another):

```
Store {
  // read
  get(collection, id)            -> record | null
  query(collection, predicate)   -> record[]
  // write — always inside a unit of work
  transaction(fn: (tx) => T)     -> T          // atomic; commit on return, rollback on throw
    tx.insert(collection, record)
    tx.update(collection, id, patch)
    tx.delete(collection, id)
  // lifecycle
  restore() / snapshot()         // migration + local reset
}
```

The **in-memory snapshot adapter** wraps today's behavior: `query` = array scan,
`transaction` = `runStateTransaction(persistStateNow, fn)` over the shared state
object. Services migrate to `store.transaction(...)` incrementally; until a
service is migrated it keeps its current `state.<c>.push` + barrier (both write
the same in-memory object, so they interoperate during the migration).

Key point: **no big-bang rewrite.** The snapshot adapter is the current code
behind the interface; a durable adapter is added later; services move over one at
a time, highest-risk-write first (invocation accept/completion already done).

## 3. Production store options

| Option | Pros | Cons | Fit |
| --- | --- | --- | --- |
| **Keep the snapshot** | zero new deps, atomic, simple, proven | single-process, O(state) writes, no indexes | local demo / single-node (today) |
| **Embedded SQLite (WAL)** | real transactions + indexes, single-file, no server, cheap migration from JSON | single-writer still (one process), needs a driver | **recommended first durable step** — single-node production |
| **Postgres** | multi-writer, HA, mature | ops weight, a server to run, biggest migration | multi-instance / hosted |

**Recommendation:** SQLite (WAL mode) as the first durable adapter behind the
Store interface. It keeps single-file simplicity and local-dev ergonomics, gives
real per-record transactions + indexes (owner/tenant columns, idempotency key,
dispatch lease), removes the O(state) whole-file rewrite, and the JSON snapshot
migrates into it row-by-row. Postgres becomes a later adapter only when a
multi-instance deployment is required — the Store interface makes it a drop-in.

The single-writer lock (#951) stays relevant for SQLite (one writer process);
Postgres would relax it.

## 4. Migration, reset, and developer workflow

- **Schema/version**: keep `schemaVersion`. Moving JSON → SQLite is a one-time
  importer: read the last snapshot, `insert` every whitelisted collection inside
  one transaction, stamp the new store version. Idempotent + re-runnable.
- **Forward migrations** (durable store): numbered migration scripts applied in a
  transaction at boot; the store records its applied version. A version ahead of
  the binary refuses to start (like the current schema gate), rather than
  corrupting data.
- **Local reset** stays trivial: delete the store file (JSON today, `.sqlite`
  later) → next boot seeds fresh default state. Document both paths.
- **Quarantine on unreadable/incompatible** state is preserved (move aside +
  start fresh + loud log), the same forensic move `quarantineSnapshot` makes.
- **Hermetic tests**: the in-memory snapshot adapter remains the test store (no
  disk, no driver), exactly as the current tests use `createServerState` +
  `createPersistenceRuntime` on a tmp path. The durable adapter gets its own
  focused adapter tests + the reusable `seedTwoTeams` fixtures (#891) for
  cross-restart isolation.

## 5. Retention & redaction

Codex JSONL evidence and free-text task input are the sensitive surfaces (#124
calls these out). Rules the store must preserve:

- **Public read-model already strips raw payloads**: `importedUsageEstimates`,
  `reviewFindings`, `codexExecChanges` drop `raw` before leaving the server;
  `applicationResults.text` is trimmed to a preview. A durable store keeps the
  raw server-side and applies the same strip at the read-model boundary — the
  redaction lives in `read-models/state.mjs`, not the store.
- **Retention is count-capped today** (`capLedgerEntries`, `capLifecycleAudit
  Records`, `retentionSettings`), with spend-bearing ledger rows + critical
  lifecycle evidence shielded from trimming. A durable store should express these
  as **time + space policies** (e.g. keep N days of events, keep all
  spend/audit), enforced by a periodic reap query rather than an in-memory slice.
- **Tenant scoping**: a durable store should carry an explicit owner/team column
  on owner-scoped collections (ledger `teamId` is hardcoded null today) so
  scoping is an indexed `WHERE`, not a derived `teamOf` join — this also closes
  the "project row dropped on restore orphans its records" edge the read-model
  currently fail-closes.
- **Redaction on export**: audit export manifests already reference records by
  id; the store keeps that addressing so an export can redact-in-place.

## 6. Follow-up implementation tasks

The acceptance for #124 is a design + these tasks (create as children of #890 /
this issue):

1. **Extract the Store interface** + an in-memory snapshot adapter wrapping the
   current `state` + `runStateTransaction`. No behavior change; services still
   compile against `state` until migrated.
2. **SQLite (WAL) durable adapter** behind the interface + the JSON→SQLite
   importer (one-shot, idempotent) + boot migration runner.
3. **Migrate the highest-risk writes** to `store.transaction(...)` first —
   dispatch claim/lease, approval, ledger, lifecycle action (invocation
   accept/completion already atomic via #957).
4. **Owner/tenant columns** on owner-scoped collections + indexed tenant scoping
   (stamp ledger `teamId`; index idempotency key + dispatch lease).
5. **Time/space retention policies** replacing the count caps, with spend/audit
   shields preserved; reap as a store query.
6. **Adapter test suite** (both adapters pass the same contract tests) + reuse
   `seedTwoTeams` for cross-restart tenant isolation on the durable adapter.

Sequencing: 1 → 2 → 3 unblock the rest of #890 (the broader per-record store);
4–6 harden multi-tenant + retention. Each is independently reviewable and
default-safe (the snapshot adapter stays the default until the durable one soaks).

## 7. Read-through-store cutover (Epic #1000) — status

The six tasks above shipped the Store seam + a SQLite adapter as a *standalone*
capability (the JSON snapshot stayed the live backing). Epic #1000 makes the
durable store the actual backing, in three phases that keep the in-memory `state`
object as the live materialized **view** (not a full read rewrite):

- **Phase A (#1001) — DONE.** Every durable `state.<collection>` write across the
  services now commits through the Store's unit-of-work (`runTx` from
  `makeRunTx`); a crash between the `persistStateSoon` debounce and its flush no
  longer loses the write. Byte-identical under the default in-memory adapter. An
  anti-regression guard (`test/store-write-guard.test.mjs`) freezes it: any file
  importing `makeRunTx` must have zero bare `persistStateSoon()`.
- **Phase B (#1002) — DONE (opt-in).** `MYAGENTTOOL_STORE=sqlite` makes SQLite the
  durable backing: the Store's commit **mirrors** the whole `state` view into
  SQLite (`replaceSnapshot`, so deletes propagate), and boot **hydrates** `state`
  from SQLite (`seedOrHydrate` — seeds from the JSON-restored state on first run,
  hydrates thereafter). Reads are unchanged (still scan `state`). Object singletons
  (`autoRunSettings`, `retentionSettings`, …) store as one reserved-id row;
  natural-keyed (id-less) collections (`agentUsageSummaries`, `auditSummaries`) store
  as one blob row. The JSON snapshot stays current, so flipping the backing off loses
  nothing.
  - **Operator:** SQLite is the **default** (Phase C). Set `MYAGENTTOOL_STORE=memory`
    for the legacy JSON-only backing. The DB lands at
    `<MYAGENTTOOL_STATE_PATH without .json>.sqlite`. Requires flag-free `node:sqlite`
    (Node ≥ 22.13 / 24) — it degrades loudly to the JSON backing otherwise.
  - **Commit cost:** the commit sink writes only the DELTA (`createIncrementalMirror`)
    — a `shadow` of the last serialized rows diffs the current state and upserts
    only changed/new rows, deletes only removed ones. SQLite disk I/O is
    O(changed-rows), not O(all-rows). The whole state is still serialized each commit
    to diff (same CPU/memory as the JSON snapshot); a truly O(delta) commit that also
    avoids the re-serialize needs per-record dirty tracking (the deferred read-through
    step). The boot seed / a hydrate reconcile still do one full mirror.
- **Phase C (#1003) — default flipped to `sqlite`.** SQLite is now the default backing.
  Getting here beyond Phase B: shared `normalizeLoadedState` (hydrate ≡ JSON restore),
  the incremental commit sink, a fix for **array-order reversal** (`query` reads
  `ORDER BY rowid DESC`, so the mirror inserts oldest-first — otherwise a cap would
  drop the newest records), mirroring `projects`/`devices` (their own JSON paths), and
  the id-less blob storage above.
- **Phase C step 3 (#1042) — JSON retired as the backing.** On the default (SQLite)
  path a commit writes SQLite only; boot hydrates from SQLite and skips the JSON
  restore (which now runs only as a one-time JSON→SQLite migration when SQLite is
  empty). JSON becomes an **explicit export** (`exportJsonSnapshot`) written on clean
  shutdown as a rollback artifact and available on demand — so reverting to
  `MYAGENTTOOL_STORE=memory` recovers to the last shutdown, and is lossy for anything
  written since. The scalar meta row (#1040) + the unified `afterFlush` mirror (#1041)
  make this safe (every write is durable in SQLite, and `currentProjectId`/`idCounter`
  survive). JSON stays the live backing on exactly two paths: `MYAGENTTOOL_STORE=memory`
  (hermetic tests + opt-out) and the loud Node<22.13 degradation. `pnpm store:parity`
  (#1039) is the drift gate; the soak runbook is §8.

## 8. Soak runbook (before retiring JSON — #1042)

The SQLite backing is complete: unified flush (#1041, every durable write mirrors,
not only store commits), scalar meta row (#1040, `currentProjectId`/`idCounter`), and
the parity checker (#1039). Before retiring the JSON snapshot as the backing (#1042 —
which removes the per-commit JSON fallback, after which reverting to `memory` is
lossy), run a real soak on the default backing and confirm zero drift:

1. **Deploy on the default backing** (SQLite; no env change — it is the default). Let
   it run under real load for the soak window.
2. **Watch the logs** for `[store:sqlite] mirror dropped …` (a collection that isn't
   durable — must be zero) and `durable backing sync failed` (a mirror error). Both
   should never appear.
3. **Check parity** periodically. Against a STOPPED instance (or a copied state dir so
   the live writer's lock/WAL is undisturbed):
   ```
   pnpm store:parity <MYAGENTTOOL_STATE_PATH>          # e.g. .myagenttool/state/local-demo-state.json
   ```
   Expect `PASS — JSON and SQLite data surfaces agree across N collections` with no
   scalar NOTE. A `FAIL` means the two backings diverged — do NOT retire; investigate
   the reported collection (that is exactly the pre-flip bug class: order reversal,
   id-less drop, push/FIFO reversal).
4. **Exit criteria:** the soak window elapses with zero drop warnings, zero sync
   errors, and every parity check a clean PASS. Then #1042 (retirement) is safe: it
   is a single revert-friendly PR that keeps `savePersistentState` as an on-demand
   JSON export + a final-export-at-cutover rollback artifact, and keeps the JSON
   backing on the `MYAGENTTOOL_STORE=memory` and Node<22.13 degrade paths.

## 9. Cutover complete + residual risks (#1043)

The read-through-store cutover (Epic #1000) is **complete**: SQLite is the default
durable backing, JSON is retired as the backing (an export/rollback format only), and
the SQLite backing is drift-free (`pnpm store:parity` PASS across 75 collections; the
unified `afterFlush` mirror + the scalar meta row make every write durable and every
scalar survive). Phases A (#1001), B (#1002), C flip (#1036), and step 3 (#1042) are
merged; #1039/#1040/#1041 closed the gates.

**Reset / dev / export workflow** (see also LOCAL_DEV_ENV.md):
- Local reset: stop the server, delete `<state dir>/*.sqlite*` (and `*.json` if
  present). Next boot seeds a fresh SQLite from defaults.
- Export a rollback/backup snapshot: a clean shutdown (SIGINT/SIGTERM) writes the JSON
  export automatically; `MYAGENTTOOL_STORE=memory` runs entirely on JSON.
- Import / roll back: run with `MYAGENTTOOL_STORE=memory` against the exported JSON, or
  delete the `.sqlite` so the next SQLite boot migrates from that JSON.
- Drift check: `pnpm store:parity <MYAGENTTOOL_STATE_PATH>` against a stopped instance.

**Residual risks (honest, out of scope for #1000):**
1. **True O(delta) commit not yet reached.** The incremental mirror still serializes
   the whole state each commit to diff (disk I/O is O(delta), CPU is O(state)). A
   commit that also avoids the re-serialize needs per-record dirty tracking — the
   deferred read-through step, where services write via `tx.insert` and reads go
   through the store. Fine at the current single-node scale.
2. **Still single-writer / single-process.** The state-lock (#951) enforces one writer;
   multi-instance needs the Postgres adapter (§3), a separate initiative.
3. **JSON export can go stale.** It is written on clean shutdown + on demand, not per
   commit — a crash-only exit leaves the export as old as the last shutdown. SQLite
   (WAL) is the real durable substrate; the export is a rollback convenience.
4. **Reverting to `memory` is lossy.** After retirement, `MYAGENTTOOL_STORE=memory`
   recovers to the last JSON export, losing anything written to SQLite since.
