/*
 * #967 (#124 follow-up 2) — a durable SQLite adapter behind the Store interface
 * (docs/engineering/PERSISTENT_STORAGE_DESIGN.md §3). Uses the Node BUILTIN
 * `node:sqlite` (no npm dependency); it is experimental, so it is loaded LAZILY
 * via a dynamic import — nothing imports this module unless the operator opts into
 * the SQLite store, and its tests skip when the runtime lacks `node:sqlite`.
 *
 * Storage model: one generic `records(collection, id, json)` table — a row per
 * record, the record serialized as JSON. This mirrors the in-memory adapter's
 * "collections of records" shape so both pass one contract suite (runStoreContract,
 * #966). Collection-specific expression indexes enforce selected business keys
 * while the live in-memory view is incrementally mirrored to this durable backing.
 *
 * Transaction semantics match the contract: a single connection runs
 * BEGIN → fn(tx) → COMMIT (ROLLBACK on throw); reads inside the tx see the tx's own
 * uncommitted writes (read-your-writes), because SQLite reads its own connection's
 * pending changes.
 */

const SCHEMA_VERSION = 3;
// Upper bound on a single history page. Aligned with the largest history reader
// (invocation-trace's MAX_SPAN_LIMIT = 2000) so the SQLite path never silently
// returns fewer rows than the whole-file JSONL scan would for the same request.
const MAX_HISTORY_LIMIT = 2000;

/**
 * Async convenience: dynamically import the experimental `node:sqlite`, then open
 * a store. Throws a clear error if the runtime doesn't provide it.
 */
export async function openSqliteStore({ path = ":memory:" } = {}) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch (error) {
    throw new Error(
      `node:sqlite is unavailable (${error?.message ?? error}). Requires Node with flag-free node:sqlite (≥ 22.13 / 24), or run with --experimental-sqlite.`,
    );
  }
  return createSqliteStore({ DatabaseSync, path });
}

/**
 * Synchronous store factory over an injected `DatabaseSync` (from node:sqlite).
 * Split from the async loader so callers that already hold DatabaseSync — and the
 * contract tests, whose factory must be sync — can open fresh stores directly.
 */
export function createSqliteStore({ DatabaseSync, path = ":memory:" }) {
  if (typeof DatabaseSync !== "function") throw new Error("createSqliteStore requires DatabaseSync from node:sqlite.");
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    // Explicit erasure flows depend on SQLite overwriting deleted cells rather
    // than merely unlinking them from the b-tree. WAL frames are truncated by
    // compactForErasure after the logical delete has committed.
    db.exec("PRAGMA secure_delete = ON;");
    runMigrations(db);
  } catch (error) {
    try {
      db.close();
    } catch {
      /* best effort */
    }
    throw error;
  }

  const selectOne = db.prepare("SELECT json FROM records WHERE collection = ? AND id = ?");
  const selectColl = db.prepare("SELECT json FROM records WHERE collection = ? ORDER BY rowid DESC");
  const upsert = db.prepare("INSERT INTO records(collection, id, json) VALUES(?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET json = excluded.json");
  const del = db.prepare("DELETE FROM records WHERE collection = ? AND id = ?");
  // ADR 0019: append-only history. OR IGNORE dedupes a crash re-append by (collection,id).
  const insertHistory = db.prepare("INSERT OR IGNORE INTO history(collection, id, invocation_id, created_at, json) VALUES(?, ?, ?, ?, ?)");
  const selectMetadata = db.prepare("SELECT value FROM meta WHERE key = ?");
  const upsertMetadata = db.prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");

  const parse = (row) => (row ? JSON.parse(row.json) : null);
  // Reentrancy guard: node:sqlite's BEGIN cannot nest ("cannot start a
  // transaction within a transaction"). A nested transaction() call joins the
  // outer one (the outermost owns COMMIT/ROLLBACK) — mirroring the in-memory
  // adapter's `active` guard so appendHistory can run inside an outer store
  // transaction without throwing and being silently swallowed by a best-effort
  // dual-write caller.
  let active = false;

  function get(collection, id) {
    return parse(selectOne.get(collection, String(id)));
  }
  function query(collection, predicate) {
    const rows = selectColl.all(collection).map((r) => JSON.parse(r.json));
    return typeof predicate === "function" ? rows.filter(predicate) : rows;
  }

  // Application migrations use the same durable meta table as the numbered SQL
  // schema, but may not mutate the schema_version row. Values stay strings so
  // callers own their payload versioning and older binaries can inspect them.
  function getMetadata(key) {
    return selectMetadata.get(String(key))?.value ?? null;
  }
  function setMetadata(key, value) {
    const normalizedKey = String(key ?? "").trim();
    if (!normalizedKey) throw new Error("setMetadata requires a non-empty key.");
    if (normalizedKey === "schema_version") throw new Error("schema_version is managed by SQLite migrations.");
    upsertMetadata.run(normalizedKey, String(value));
    return String(value);
  }

  function transaction(fn) {
    if (typeof fn !== "function") throw new Error("transaction(fn) requires a function.");
    const tx = {
      get,
      query,
      insert(collection, record) {
        if (!record || record.id == null) throw new Error("insert requires a record with an id.");
        upsert.run(collection, String(record.id), JSON.stringify(record));
        return record;
      },
      update(collection, id, patch) {
        const current = get(collection, id) ?? { id };
        const next = { ...current, ...patch };
        upsert.run(collection, String(id), JSON.stringify(next));
        return next;
      },
      delete(collection, id) {
        del.run(collection, String(id));
      },
    };
    if (active) {
      // Reentrant call: the outermost transaction owns COMMIT/ROLLBACK.
      return fn(tx);
    }
    active = true;
    db.exec("BEGIN");
    let result;
    try {
      result = fn(tx);
    } catch (error) {
      db.exec("ROLLBACK");
      active = false;
      throw error;
    }
    db.exec("COMMIT");
    active = false;
    return result;
  }

  /**
   * JSON→SQLite import: insert every id-bearing row of each collection in one
   * transaction. Idempotent (upsert by (collection,id)), so re-running a partial
   * import converges. `collections` is a `{ collectionName: rows[] }` map (e.g. the
   * whitelisted keys off a restored snapshot).
   */
  function importSnapshot(collections) {
    let imported = 0;
    transaction((tx) => {
      for (const [collection, rows] of Object.entries(collections ?? {})) {
        if (!Array.isArray(rows)) continue;
        // Insert OLDEST-first (arrays are newest-first) so the newest row gets the
        // highest rowid — query() reads ORDER BY rowid DESC, so newest-first order
        // round-trips faithfully. See replaceSnapshot.
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          const row = rows[i];
          if (row && row.id != null) {
            tx.insert(collection, row);
            imported += 1;
          }
        }
      }
    });
    return { imported };
  }

  /**
   * Faithful whole-DB mirror of an in-memory `state` view → SQLite (#1002 Phase B).
   * Unlike importSnapshot (upsert-only), this REPLACES the entire durable store so
   * DELETES propagate: a record removed from a collection (removeProject, retention
   * reaping, cap-trimming) is gone from SQLite too, and hydration never resurrects
   * it. One transaction: clear every row, then insert the current rows. Because it
   * keys on `record.id`, id-less rows cannot be stored — they are counted in
   * `skipped` (with the collections that carried them) so the caller stays honest
   * rather than silently losing them.
   *
   * ORDER: collections are newest-first (services `unshift`), and query() reads
   * ORDER BY rowid DESC — so rows are inserted OLDEST-first (reverse the array),
   * giving the newest row the highest rowid. Otherwise a hydrate would return the
   * array REVERSED, and a cap that keeps the front N would drop the newest records.
   */
  function replaceSnapshot(collections) {
    let written = 0;
    let skipped = 0;
    const skippedCollections = new Set();
    transaction((tx) => {
      db.exec("DELETE FROM records");
      for (const [collection, rows] of Object.entries(collections ?? {})) {
        if (!Array.isArray(rows)) continue;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          const row = rows[i];
          if (row && row.id != null) {
            tx.insert(collection, row);
            written += 1;
          } else if (row !== undefined) {
            skipped += 1;
            skippedCollections.add(collection);
          }
        }
      }
    });
    return { written, skipped, skippedCollections: [...skippedCollections] };
  }

  /**
   * Read a set of collections back out for boot hydration (#1002 Phase B): returns
   * a `{ collection: rows[] }` map (newest-first, matching the array convention),
   * so the caller can rebuild the in-memory `state` view from the durable store.
   */
  function readSnapshot(collectionNames) {
    const out = {};
    for (const collection of collectionNames ?? []) {
      out[collection] = query(collection);
    }
    return out;
  }

  // ADR 0019: append over-cap-evicted rows to the durable history table. Best
  // effort by shape (the caller wraps it best-effort). invocation_id / created_at
  // are lifted from the row for the indexed reads; returns how many were newly
  // inserted (0 for a duplicate).
  function appendHistory(collection, rows) {
    if (!Array.isArray(rows) || rows.length === 0) return { appended: 0 };
    let appended = 0;
    transaction(() => {
      for (const row of rows) {
        if (!row || row.id == null) continue;
        const invocationId = row.invocationId ?? row.subjectId ?? row.traceId ?? null; // scope key: spans key by traceId
        const createdAt = row.createdAt ?? row.at ?? row.startedAt ?? null;
        const info = insertHistory.run(
          collection,
          String(row.id),
          invocationId != null ? String(invocationId) : null,
          createdAt != null ? String(createdAt) : null,
          JSON.stringify(row),
        );
        appended += Number(info?.changes ?? 0);
      }
    });
    return { appended };
  }

  // ADR 0019: paginated read of the history table, optionally scoped to one
  // invocation. `order` selects the end of the rowid range the cap covers:
  // "desc" (default) returns the NEWEST cap rows (for refusals — recency matters);
  // "asc" returns the EARLIEST cap rows (for a span tree — the root span has the
  // lowest rowid and must survive the cap, matching the whole-file JSONL scan).
  // `before` is the rowid cursor from a prior page's `nextBefore` (its comparison
  // direction follows `order`). Cap is aligned with the largest caller
  // (MAX_HISTORY_LIMIT) so the SQLite path never silently under-returns vs JSONL.
  function queryHistory(collection, { invocationId = null, before = null, limit = 100, order = "desc" } = {}) {
    const cap = Math.min(MAX_HISTORY_LIMIT, Math.max(1, Number.parseInt(limit, 10) || 100));
    const asc = order === "asc";
    const clauses = ["collection = ?"];
    const params = [collection];
    if (invocationId != null) { clauses.push("invocation_id = ?"); params.push(String(invocationId)); }
    if (before != null && Number.isFinite(Number(before))) { clauses.push(asc ? "rowid > ?" : "rowid < ?"); params.push(Number(before)); }
    const sql = `SELECT rowid AS rowid, json FROM history WHERE ${clauses.join(" AND ")} ORDER BY rowid ${asc ? "ASC" : "DESC"} LIMIT ?`;
    const rows = db.prepare(sql).all(...params, cap + 1);
    const hasMore = rows.length > cap;
    const page = rows.slice(0, cap);
    return {
      rows: page.map((r) => JSON.parse(r.json)),
      nextBefore: hasMore && page.length > 0 ? Number(page[page.length - 1].rowid) : null,
    };
  }

  // ADR 0019 B-3: Right-to-Erasure reaches the history table. Delete every history
  // row for a collection scoped to `scopeId` (the `invocation_id` column — the
  // subject/invocation/trace key). Returns how many rows were removed.
  function deleteHistory(collection, scopeId) {
    if (scopeId == null) return { deleted: 0 };
    const info = db.prepare("DELETE FROM history WHERE collection = ? AND invocation_id = ?").run(collection, String(scopeId));
    return { deleted: Number(info?.changes ?? 0) };
  }

  // ADR 0019 B-3: in-place redaction for SHIELDED history rows (refusals are
  // retained of record but must be PII-scrubbed on erasure). `redactRow` mutates a
  // parsed row in place; rows whose JSON actually changed are rewritten. Returns
  // how many rows were redacted. Runs in one transaction (reentrant-safe).
  function redactHistory(collection, scopeId, redactRow) {
    if (scopeId == null || typeof redactRow !== "function") return { redacted: 0 };
    const rows = db.prepare("SELECT rowid AS rowid, json FROM history WHERE collection = ? AND invocation_id = ?").all(collection, String(scopeId));
    if (rows.length === 0) return { redacted: 0 };
    const update = db.prepare("UPDATE history SET json = ? WHERE rowid = ?");
    let redacted = 0;
    transaction(() => {
      for (const r of rows) {
        const row = JSON.parse(r.json);
        redactRow(row);
        const next = JSON.stringify(row);
        if (next !== r.json) { update.run(next, r.rowid); redacted += 1; }
      }
    });
    return { redacted };
  }

  // ADR 0019 B-3: time-based retention reap over the history table (it is outside
  // the mirrored snapshot, so the count caps / state reap never bound it). Delete
  // DATED rows older than `before` (an ISO string; lexicographic compare is
  // chronological for the `now()` ISO-Z format). Undated rows are kept, mirroring
  // the state reap which never ages out an undated row.
  function reapHistory({ before } = {}) {
    if (before == null) return { reaped: 0 };
    const info = db.prepare("DELETE FROM history WHERE created_at IS NOT NULL AND created_at < ?").run(String(before));
    return { reaped: Number(info?.changes ?? 0) };
  }

  // Compliance-sensitive deletion barrier. Call only after the record deletes
  // have committed: VACUUM rewrites the main database, then the checkpoint
  // removes historical WAL frames that could otherwise retain deleted payloads.
  function compactForErasure() {
    db.exec("VACUUM;");
    const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    const checkpointBusy = Number(checkpoint?.busy ?? 0);
    const remainingLogFrames = Number(checkpoint?.log ?? 0);
    return {
      secureDelete: true,
      walCheckpointed: checkpointBusy === 0 && remainingLogFrames === 0,
      checkpointBusy,
      remainingLogFrames,
    };
  }

  function close() {
    db.close();
  }

  return { get, query, transaction, importSnapshot, replaceSnapshot, readSnapshot, getMetadata, setMetadata, appendHistory, queryHistory, deleteHistory, redactHistory, reapHistory, compactForErasure, close, schemaVersion: SCHEMA_VERSION };
}

/**
 * Numbered forward migrations applied in a transaction. The store records its
 * applied version in `meta`; a store version AHEAD of this binary refuses to open
 * (like the snapshot schema gate) rather than corrupting rows.
 */
function runMigrations(db) {
  db.exec("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT)");
  const current = Number(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value ?? 0);
  if (current > SCHEMA_VERSION) {
    throw new Error(`SQLite store schema v${current} is newer than this binary (v${SCHEMA_VERSION}); refusing to open.`);
  }
  const migrations = [
    // v1: the generic record table.
    () => db.exec("CREATE TABLE IF NOT EXISTS records(collection TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(collection, id))"),
    // v2 (ADR 0019): the durable observability HISTORY table. Separate from
    // `records` and NEVER mirrored — replaceSnapshot only touches `records`, so a
    // history row survives a commit that no longer has it in `state`. Append-only,
    // deduped by (collection,id); rowid is the pagination cursor; indexed for the
    // "by invocation" and "by collection" reads.
    () => {
      db.exec("CREATE TABLE IF NOT EXISTS history(collection TEXT NOT NULL, id TEXT NOT NULL, invocation_id TEXT, created_at TEXT, json TEXT NOT NULL, PRIMARY KEY(collection, id))");
      // Order is by the implicit rowid (insertion order) — do NOT list rowid in an
      // index; these cover the WHERE, the rowid scan handles ORDER BY / the cursor.
      db.exec("CREATE INDEX IF NOT EXISTS history_by_invocation ON history(collection, invocation_id)");
      db.exec("CREATE INDEX IF NOT EXISTS history_by_collection ON history(collection)");
    },
    // v3: exactly-once execution actions need a business-key constraint in
    // addition to the generic (collection,id) primary key. The deterministic id
    // remains useful, but this partial expression index also rejects corrupted or
    // manually imported rows that reuse one (Auto-run, request key) pair under a
    // different id. A second index supports Auto-run-scoped ledger reads without
    // indexing unrelated JSON collections.
    () => {
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS execution_action_idempotency_key
        ON records(json_extract(json, '$.autoRunId'), json_extract(json, '$.idempotencyKey'))
        WHERE collection = 'executionActionIdempotencyRecords'`);
      db.exec(`CREATE INDEX IF NOT EXISTS execution_action_idempotency_by_auto_run
        ON records(json_extract(json, '$.autoRunId'))
        WHERE collection = 'executionActionIdempotencyRecords'`);
    },
  ];
  db.exec("BEGIN");
  try {
    for (let v = current; v < SCHEMA_VERSION; v += 1) {
      migrations[v]();
    }
    db.prepare("INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(SCHEMA_VERSION));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
