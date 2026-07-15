/*
 * #1002 (Phase B, slice 2) — the SQLite-as-cache backing logic, as a pure unit
 * (no boot wiring; B1b-ii does that behind MYAGENTTOOL_STORE=sqlite).
 *
 * The cutover (Epic #1000) keeps the in-memory `state` object as the live
 * materialized VIEW; SQLite becomes the durable backing. This module bridges the
 * two:
 *   - seedOrHydrate: on boot, either SEED SQLite from the current (JSON-restored)
 *     state when SQLite is empty — the one-time migration from JSON backing to
 *     SQLite backing — or HYDRATE `state` from SQLite when it already holds data
 *     (SQLite is then authoritative, overriding the JSON restore).
 *   - mirrorState: the `commit` sink — a faithful whole-state mirror into SQLite
 *     (deletes propagate) run on every store transaction commit.
 *
 * Singletons: the persisted state is ~64 id-keyed collection arrays PLUS a handful
 * of object singletons (autoRunSettings, retentionSettings, …) that have no `.id`
 * and so cannot live in the generic (collection,id,json) record table directly.
 * Each singleton is stored as ONE row under a reserved id, wrapping the object in
 * `{ id: SINGLETON_ID, __value }`; hydration unwraps `.__value`. Arrays store as-is.
 */

// Reserved record id under which an object singleton (a non-array persisted key)
// is stored. Real record ids are prefixed slugs (agt_, prj_, …) and never collide.
export const SINGLETON_ID = "__singleton__";
// Reserved id under which a NATURAL-KEYED array collection (rows keyed by a field
// other than `id` — e.g. agentUsageSummaries by agentId, auditSummaries with no
// unique key) is stored as ONE blob. The generic (collection,id,json) table can't
// key such rows, so without this they'd be dropped from the SQLite backing entirely.
export const BLOB_ARRAY_ID = "__array__";

// Wrap an object singleton as the single row of its collection.
function singletonRows(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? [{ id: SINGLETON_ID, __value: value }]
    : [];
}

// An array collection whose rows are ALL id-less is natural-keyed — store it whole,
// as one blob row, so it round-trips durably (and in order).
function isBlobArray(rows) {
  return rows.length > 0 && rows.every((row) => row == null || row.id == null);
}

// Reserved collection + row that hold the top-level SCALAR state (currentProjectId,
// idCounter) — values that are neither arrays nor objects, so they have no natural
// home in the record table. Without a durable slot they'd be lost once the JSON
// snapshot is retired (currentProjectId → resets to default each boot; idCounter →
// falls back to the #832-risky records scan). #1040.
export const SCALAR_COLLECTION = "__store_meta__";
export const SCALAR_ID = "__meta__";

// One meta row carrying the defined scalar keys; null when there are none to store.
function scalarRows(state, scalarKeys) {
  if (!scalarKeys?.length) return null;
  const values = {};
  let any = false;
  for (const key of scalarKeys) {
    if (state[key] !== undefined) {
      values[key] = state[key];
      any = true;
    }
  }
  return any ? [{ id: SCALAR_ID, values }] : [];
}

// Build the { collection: rows[] } map a full mirror writes: an id-keyed array as-is,
// an all-id-less array as one blob row, every object key as one singleton row, and
// the top-level scalars as one reserved meta row.
function snapshotFor({ state, arrayKeys, objectKeys, scalarKeys = [] }) {
  const snapshot = {};
  for (const key of arrayKeys) {
    if (!Array.isArray(state[key])) continue;
    snapshot[key] = isBlobArray(state[key]) ? [{ id: BLOB_ARRAY_ID, __blobArray: state[key] }] : state[key];
  }
  for (const key of objectKeys) {
    if (state[key] !== undefined) snapshot[key] = singletonRows(state[key]);
  }
  const meta = scalarRows(state, scalarKeys);
  if (meta) snapshot[SCALAR_COLLECTION] = meta;
  return snapshot;
}

// Unwrap a hydrated array collection: a blob row → its stored array, else the rows.
function unwrapArray(rows) {
  const blob = (rows ?? []).find((row) => row?.id === BLOB_ARRAY_ID);
  return blob && Array.isArray(blob.__blobArray) ? blob.__blobArray : (Array.isArray(rows) ? rows : []);
}

/**
 * True when the SQLite store holds no persisted data yet (a fresh backing) — the
 * signal to SEED it from the current state rather than HYDRATE state from it.
 */
export function isStoreEmpty({ store, arrayKeys, objectKeys }) {
  for (const key of [...arrayKeys, ...objectKeys]) {
    if (store.query(key).length > 0) return false;
  }
  return true;
}

/**
 * Mirror the whole in-memory `state` view into SQLite (the commit sink). Faithful:
 * deletes propagate (replaceSnapshot clears then writes). Returns replaceSnapshot's
 * accounting ({ written, skipped, skippedCollections }) so the caller can assert no
 * id-less array row was silently dropped.
 */
export function mirrorState({ store, state, arrayKeys, objectKeys, scalarKeys = [] }) {
  return store.replaceSnapshot(snapshotFor({ state, arrayKeys, objectKeys, scalarKeys }));
}

const shadowKey = (collection, id) => `${collection} ${id}`;

// Serialize the current `state` view grouped BY collection, each collection's rows
// in array order (so the incremental sync can reason about a row's array POSITION,
// not just its content), and count id-less rows that can't be keyed (skipped).
function serializeState({ state, arrayKeys, objectKeys, scalarKeys = [] }) {
  const byCollection = new Map(); // collection → [{ key, id, json, row }] in array order
  let skipped = 0;
  const skippedCollections = new Set();
  for (const [collection, list] of Object.entries(snapshotFor({ state, arrayKeys, objectKeys, scalarKeys }))) {
    const rows = [];
    for (const row of list) {
      if (row && row.id != null) {
        rows.push({ key: shadowKey(collection, row.id), id: String(row.id), json: JSON.stringify(row), row });
      } else if (row !== undefined) {
        skipped += 1;
        skippedCollections.add(collection);
      }
    }
    byCollection.set(collection, rows);
  }
  return { byCollection, skipped, skippedCollections: [...skippedCollections] };
}

/**
 * Incremental commit sink (#1003, the perf caveat). A faithful whole-state mirror
 * (replaceSnapshot) rewrites the ENTIRE record table on every commit — O(all-rows)
 * disk writes even for a one-record change. This keeps a `shadow` of the last
 * serialized rows and, on each commit, writes only the DELTA: upsert rows whose JSON
 * changed (or are new), delete rows that left the state. SQLite stays byte-faithful;
 * disk I/O drops from O(all-rows) to O(changed-rows). (The whole state is still
 * serialized each commit to diff — same CPU as replaceSnapshot — but that's memory,
 * not disk; a truly O(delta) commit needs per-record dirty tracking, the deferred
 * read-through step.)
 *
 * `prime(state)` seeds the shadow to match what the store already holds (call right
 * after seed/hydrate). `sync(state)` applies the delta and returns
 * { upserts, deletes, skipped, skippedCollections }.
 */
export function createIncrementalMirror({ store, arrayKeys, objectKeys, scalarKeys = [] }) {
  const shadow = new Map(); // shadowKey → json

  function rebuildShadow(byCollection) {
    shadow.clear();
    for (const rows of byCollection.values()) {
      for (const { key, json } of rows) shadow.set(key, json);
    }
  }

  function prime(state) {
    rebuildShadow(serializeState({ state, arrayKeys, objectKeys, scalarKeys }).byCollection);
  }

  function sync(state) {
    const { byCollection, skipped, skippedCollections } = serializeState({ state, arrayKeys, objectKeys, scalarKeys });
    const currentKeys = new Set();
    for (const rows of byCollection.values()) for (const { key } of rows) currentKeys.add(key);
    let upserts = 0;
    let deletes = 0;
    store.transaction((tx) => {
      for (const [collection, rows] of byCollection) {
        // A cheap append (tx.insert = highest rowid) preserves array order only when
        // new rows are a FRONT prefix (unshift); if a new row lands AFTER an existing
        // one (push/FIFO or a middle insert) its rowid outranks rows before it and the
        // hydrate reverses them. Then rewrite the whole collection oldest-first so
        // rowid order matches array order. Unshift/hot collections stay cheap.
        let firstExistingIdx = -1;
        let lastNewIdx = -1;
        for (let i = 0; i < rows.length; i += 1) {
          if (shadow.has(rows[i].key)) {
            if (firstExistingIdx === -1) firstExistingIdx = i;
          } else {
            lastNewIdx = i;
          }
        }
        const hasNew = lastNewIdx >= 0;
        const frontPrefix = !hasNew || firstExistingIdx === -1 || lastNewIdx < firstExistingIdx;
        if (hasNew && !frontPrefix) {
          for (const { id } of rows) tx.delete(collection, id);
          for (let i = rows.length - 1; i >= 0; i -= 1) {
            tx.insert(collection, rows[i].row);
            upserts += 1;
          }
        } else {
          for (let i = rows.length - 1; i >= 0; i -= 1) {
            const { key, row, json } = rows[i];
            if (shadow.get(key) !== json) {
              tx.insert(collection, row);
              upserts += 1;
            }
          }
        }
      }
      // Rows that left the state since the last mirror.
      for (const key of shadow.keys()) {
        if (!currentKeys.has(key)) {
          const sep = key.indexOf(" ");
          tx.delete(key.slice(0, sep), key.slice(sep + 1));
          deletes += 1;
        }
      }
    });
    rebuildShadow(byCollection);
    return { upserts, deletes, skipped, skippedCollections };
  }

  return { prime, sync };
}

/**
 * Boot bridge: seed SQLite from `state` if the store is empty, otherwise hydrate
 * `state` from SQLite (mutating the passed-in state object in place — SQLite wins).
 * Returns { mode: "seeded" | "hydrated", mirror? } — `mirror` (the seed's
 * accounting) is present on the seed path so the caller can verify fidelity.
 */
export function seedOrHydrate({ store, state, arrayKeys, objectKeys, scalarKeys = [] }) {
  if (isStoreEmpty({ store, arrayKeys, objectKeys })) {
    const mirror = mirrorState({ store, state, arrayKeys, objectKeys, scalarKeys });
    return { mode: "seeded", mirror };
  }
  const back = store.readSnapshot([...arrayKeys, ...objectKeys, SCALAR_COLLECTION]);
  for (const key of arrayKeys) {
    state[key] = unwrapArray(back[key]);
  }
  for (const key of objectKeys) {
    const row = (back[key] ?? []).find((r) => r?.id === SINGLETON_ID);
    // Only overwrite when SQLite actually carried the singleton — a key absent from
    // the durable store keeps its state-factory default rather than becoming null.
    if (row && "__value" in row) state[key] = row.__value;
  }
  if (scalarKeys.length) {
    const meta = (back[SCALAR_COLLECTION] ?? []).find((r) => r?.id === SCALAR_ID)?.values ?? {};
    for (const key of scalarKeys) {
      // Restore a scalar only when the store carried it — a key absent from an older
      // backing keeps whatever the restore/composer reconstructs.
      if (key in meta) state[key] = meta[key];
    }
  }
  return { mode: "hydrated" };
}
// Boot normalization (drop path-missing projects, merge new defaults, reset devices
// offline, …) is shared with the JSON restore — see normalizeLoadedState in
// persistence.mjs, which both the restore and the hydrate path call.
