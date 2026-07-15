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
 * #966). Real per-column indexing (owner/tenant, idempotency key) is #969; this
 * slice is the adapter + JSON→SQLite importer + a boot migration runner, delivered
 * as a standalone capability (not yet the live backing — that cutover needs the
 * services to READ through the store, a later step).
 *
 * Transaction semantics match the contract: a single connection runs
 * BEGIN → fn(tx) → COMMIT (ROLLBACK on throw); reads inside the tx see the tx's own
 * uncommitted writes (read-your-writes), because SQLite reads its own connection's
 * pending changes.
 */

const SCHEMA_VERSION = 1;

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

  const parse = (row) => (row ? JSON.parse(row.json) : null);

  function get(collection, id) {
    return parse(selectOne.get(collection, String(id)));
  }
  function query(collection, predicate) {
    const rows = selectColl.all(collection).map((r) => JSON.parse(r.json));
    return typeof predicate === "function" ? rows.filter(predicate) : rows;
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
    db.exec("BEGIN");
    let result;
    try {
      result = fn(tx);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    db.exec("COMMIT");
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

  function close() {
    db.close();
  }

  return { get, query, transaction, importSnapshot, replaceSnapshot, readSnapshot, close, schemaVersion: SCHEMA_VERSION };
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
