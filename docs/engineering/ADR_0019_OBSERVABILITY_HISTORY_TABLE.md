# ADR 0019: Durable observability history is an indexed SQLite table OUTSIDE the state mirror, with the JSONL archive as the memory-backing / degraded fallback

Status: proposed · 2026-07-17

Date: 2026-07-17

Related issue: [#1182](https://github.com/perly6185-lab/myagenttool/issues/1182)

> **Production-path amendment (2026-08-31, #1618):** references below to a
> memory/Node-degraded server backing describe the original rollout and old
> binaries. The current persistence-enabled server is SQLite-only and fails
> startup if SQLite is unavailable or corrupt. JSON/JSONL remains an offline
> import/export and test compatibility format; it is not a live production
> fallback. Rollback therefore preserves/restores a known-good SQLite database
> or imports JSON into a new SQLite database instead of serving JSON directly.

## Context

Workstream 2 slices 1–5 gave the high-volume observability collections
(`events`, `invocationRounds`, `toolInvocationRecords`, `refusals`, `traces`,
`spans`) a durable over-cap archive: rows the in-memory cap evicts are appended to
`<stateDir>/archive/*.jsonl` (append-only, fsync per append), and per-invocation
read surfaces (`/events`, `/refusals`, `/trace`) merge the live snapshot with the
archived rows.

Two facts constrain what "long-window query" can be, discovered by reading the
store source (`docs/engineering/PERSISTENT_STORAGE_DESIGN.md` is the design of
record):

1. **`readArchive` reads the WHOLE JSONL file** and sorts it in memory
   (`retention-archive.mjs` — its own comment: "reading the full file is fine for
   now; archives outgrow memory → change to tail-read"). This does not scale to a
   large archive.
2. **The SQLite backing (`records(collection,id,json)`) is a whole-state MIRROR**:
   `replaceSnapshot` does `DELETE FROM records` then re-inserts the live state on
   every commit, so a row absent from `state` (cap eviction, retention reap) is
   deleted from SQLite too — a mirrored collection cannot hold more than the
   capped in-memory array.
3. **The in-memory adapter has no durable store beyond `state`**
   (`in-memory-store.mjs` returns only `{ get, query, transaction }`, reading the
   capped arrays). So there is **no clean "dual-adapter parity"** for a durable
   history: the memory backing genuinely cannot hold long history — the JSONL
   archive IS its durable store.

This ADR decides how to make the over-cap archive queryable at scale, given those
constraints, since it is a durable-storage decision.

## Decision

**Durable observability history is a dedicated, indexed SQLite table (`history`)
that lives OUTSIDE the mirrored `records` set; it exists only on the SQLite
backing, and the JSONL archive remains the durable store for the memory /
Node-degraded backing. The read surfaces prefer the store's paginated query when
present and fall back to the JSONL read otherwise.** Seven invariants:

1. **The `history` table is never mirrored.** It is a separate table, never in
   `replaceSnapshot`'s scope and never in `persistedArrayKeys`. If it were
   mirrored, every commit's `DELETE FROM records` (or an equivalent) would wipe
   history. This is the load-bearing invariant — a history row must survive a
   commit that no longer has it in `state`.

2. **SQLite-backing-only, with an honest JSONL fallback.** `appendHistory` /
   `queryHistory` exist on the SQLite adapter. On the memory backing (or
   Node < 22.13 where `node:sqlite` is absent and the server degrades to JSON —
   `index.mjs`), there is no history table; the JSONL archive + the existing
   `readArchive` remain the durable over-cap store. No API pretends the in-memory
   adapter has durable history.

3. **Dual-write during rollout; the store is preferred on read.** Over-cap
   eviction keeps writing the JSONL archive AND (when the SQLite store is present)
   appends to `history`. A read prefers `queryHistory` when the store is present,
   else `readArchive`. Dual-write means a rollback to a pre-history binary still
   finds the history in the JSONL, and a forward roll finds it in both.

4. **Append-only, deduped by (collection, id).** `appendHistory` inserts with
   `INSERT OR IGNORE` on a unique `(collection, id)` — a crash re-append is a
   no-op, matching the JSONL reader's "keep the first archived copy". The live
   snapshot still wins on overlap in the read merge (a post-hoc PII scrub #1206 is
   reflected).

5. **Indexed pagination.** `queryHistory(collection, { invocationId?, before?,
   limit })` uses SQL `WHERE collection = ? [AND invocation_id = ?] [AND rowid <
   ?] ORDER BY rowid DESC LIMIT ?`, backed by indexes on `(collection,
   invocation_id, rowid)` and `(collection, rowid)`. This replaces the whole-file
   JSONL scan for the SQLite path. `invocation_id` / `created_at` are extracted
   from the row at append time (`row.invocationId ?? row.subjectId ?? null`;
   `row.createdAt ?? row.at ?? row.startedAt`).

6. **Forward-only schema migration behind the existing version gate.**
   `SCHEMA_VERSION` 1 → 2 adds the `history` table + indexes as migration step 1;
   a v1 store auto-migrates on open, and the existing gate still refuses a store
   whose version is newer than the binary (no silent corruption). The migration is
   additive — it never touches `records`.

7. **No behavior change when the feature is inert.** With no SQLite store, or
   before any eviction, nothing changes: reads still work off the live snapshot +
   JSONL. Adding the table/methods does not alter `records`, the mirror, hydration,
   or `parity` (which compares only the mirrored snapshot).

## Impact assessment (改造评估)

| Area | Change | Risk | Mitigation |
|---|---|---|---|
| `store/sqlite-store.mjs` | +`history` table (migration v1→v2), +`appendHistory` / `queryHistory` | Medium — store core + a real schema migration | Additive migration (never touches `records`); the version gate already refuses a newer store; contract tests for the new methods |
| `store/in-memory-store.mjs` | No durable history; expose `appendHistory`/`queryHistory` as no-op / capped-state reads so callers have one shape | Low | Callers treat "no store history" as empty and fall back to JSONL; documented as backing-specific, not parity |
| `store/parity.mjs` | None (history is not mirrored) | Low | Explicitly assert parity ignores `history` |
| retention-archive / cap write path | Dual-write: also `appendHistory` when the store is present | Low-Medium — an extra write per eviction | Best-effort, never blocks the main write (like the JSONL append); JSONL stays authoritative on the fallback path |
| read services (`invocation-events/refusals/trace`) | Prefer `queryHistory` when present, else `readArchive` | Low | Same merge/dedupe/tenancy; the store path is a drop-in with pagination |
| `node:sqlite` experimental / Node < 22.13 | History table simply absent | Low | Already degrades to JSON backing loudly (`index.mjs`); JSONL archive covers the degraded path |
| Rollback | A pre-history binary opens a v2 store | Medium | The version gate REFUSES a v2 store on an old binary — so a rollback needs the JSON/JSONL fallback, which dual-write preserves. Documented as an operational note |

**Rollback story.** Because the version gate refuses a newer store, a rollback to
a pre-0019 binary cannot open the v2 SQLite file. The dual-write (invariant 3)
means the JSONL archive still holds the history, so the operator sets
`MYAGENTTOOL_STORE=memory` (JSON + JSONL) on the rolled-back binary, or restores
the pre-migration `.sqlite`. This is the same forward-only-migration tradeoff the
store already has (`runMigrations` gate).

## Consequences

- The over-cap archive becomes queryable at scale on the default (SQLite) backing
  without loading whole files; the read surfaces gain real pagination.
- The memory / degraded backing is explicitly a lesser tier (JSONL whole-file
  read) — honest, not a false parity claim.
- One forward migration + a rollback caveat is the cost, bounded by dual-write.
- Delivered in slices: B-1 (the `history` table + API + migration + contract),
  B-2 (dual-write wiring + the read surfaces preferring `queryHistory`).

## B-3 — history-table erasure + retention reap (RESOLVED)

The `history` table is OUTSIDE the mirrored snapshot, so the earlier state-only
per-subject deletion / Right-to-Erasure and the state-only retention reap did **not**
reach rows dual-written into `history` — a compliance gap (a deleted subject's
evicted rows survived) plus unbounded growth. B-3 closes both:

- **Store API (both adapters, contract-tested):** `deleteHistory(collection, scopeId)`
  removes a scope's rows; `redactHistory(collection, scopeId, redactRow)` scrubs
  SHIELDED rows in place; `reapHistory({ before })` deletes DATED rows past a cutoff
  (undated rows kept, mirroring the state reap).
- **Erasure wiring (`observability-deletion.mjs`):** `full` deletes the subject's
  `traces`/`events` (by invocation id) and `spans` (by trace id, gathering trace ids
  from BOTH the live snapshot and the archive so an evicted-only trace's spans are
  still erased); BOTH tiers PII-scrub shielded refusal rows in `history` with the
  same `scrubRefusalPii` helper the live scrub uses. The audit event's `counts`
  carry `historyDeleted` / `historyRedacted`. No-op on the memory backing.
- **Retention reap (`index.mjs` sweep):** reaps `history` rows past the same
  `logsDays` window as the state telemetry reap (self-durable DELETE).

Memory/degraded backing has no store `history`, so these are no-ops there (its
JSONL archive remains the durable tier and is covered by the existing state paths).

## Testable rules

- A history row survives a `replaceSnapshot`/commit that no longer has it in
  `state` (the not-mirrored invariant).
- `appendHistory` is idempotent on `(collection, id)`; `queryHistory` paginates
  by `(collection, invocationId?, before, limit)` newest-first, and both the
  SQLite and in-memory adapters satisfy the extended contract suite.
- Opening a v1 store migrates it to v2 (adds `history`); a v3 store is refused by
  a v2 binary.
- With no SQLite store, the read surfaces behave exactly as today (JSONL).
- `parity` still passes (history is not part of the mirrored snapshot).
