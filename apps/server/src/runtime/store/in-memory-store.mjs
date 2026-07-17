/*
 * #966 (#124 follow-up 1) — the in-memory snapshot adapter behind the Store
 * interface (docs/engineering/PERSISTENT_STORAGE_DESIGN.md §2).
 *
 * The Store is the seam that lets services move off `state.<collection>.push` +
 * persistStateSoon onto a durable per-record store without a big-bang rewrite.
 * This adapter IS today's whole-file snapshot behind that interface: reads scan
 * the shared `state` arrays; a transaction STAGES its writes and applies them
 * atomically on commit (discarding them on throw = rollback), then flushes once
 * through the injected synchronous barrier (persistStateNow). Real transaction
 * semantics — read-your-writes inside the tx, rollback on throw — match what the
 * SQLite adapter (#967) will provide natively, so both pass the same contract
 * tests (#971).
 *
 * Interoperability during migration: an unmigrated service still writing
 * `state.<c>.push` directly mutates the same object, so migrated and unmigrated
 * code coexist; the unmigrated path simply doesn't get staging/rollback.
 *
 * The Store interface (the contract both adapters satisfy):
 *   get(collection, id)            -> record | null
 *   query(collection, predicate?)  -> record[]
 *   transaction(fn)                -> T   // fn(tx); commit on return, rollback on throw
 *     tx.get / tx.query            -> overlay-aware reads (see own staged writes)
 *     tx.insert(collection, record)
 *     tx.update(collection, id, patch)   -> shallow-merges patch onto the record
 *     tx.delete(collection, id)
 */

function collectionArray(state, collection) {
  const arr = state[collection];
  return Array.isArray(arr) ? arr : [];
}

/** Per-transaction staging for one collection. */
function newStage() {
  return { inserts: [], updates: new Map(), deletes: new Set() };
}

export function createInMemoryStore({ state, commit }) {
  if (!state || typeof state !== "object") throw new Error("createInMemoryStore requires a state object.");

  function get(collection, id) {
    return collectionArray(state, collection).find((row) => row?.id === id) ?? null;
  }

  function query(collection, predicate) {
    const rows = collectionArray(state, collection);
    return typeof predicate === "function" ? rows.filter(predicate) : [...rows];
  }

  // Reentrancy: a service composite op (A calls B, both runTx-wrapped) nests
  // transactions. A nested call applies its writes DIRECTLY to `state` and does
  // NOT commit — the outermost transaction's commit flushes everything as one
  // unit. Matches how the SQLite adapter will nest (a SAVEPOINT under the outer
  // BEGIN). Note: a nested call's writes are not independently rolled back, but
  // services mutate `state` in place anyway (the store is their commit boundary),
  // so this is faithful to how they're used.
  let active = false;
  const directTx = {
    get,
    query,
    insert(collection, record) {
      if (!record || record.id == null) throw new Error("insert requires a record with an id.");
      if (!Array.isArray(state[collection])) state[collection] = [];
      state[collection] = state[collection].filter((row) => row?.id !== record.id);
      state[collection].unshift(record);
      return record;
    },
    update(collection, id, patch) {
      const row = get(collection, id);
      if (row) Object.assign(row, patch);
      return row ?? { id, ...patch };
    },
    delete(collection, id) {
      if (Array.isArray(state[collection])) state[collection] = state[collection].filter((row) => row?.id !== id);
    },
  };

  function transaction(fn) {
    if (typeof fn !== "function") throw new Error("transaction(fn) requires a function.");
    if (active) return fn(directTx); // reentrant — apply inline, the outer commits
    active = true;
    try {
      return runOuterTransaction(fn);
    } finally {
      active = false;
    }
  }

  function runOuterTransaction(fn) {
    // Staged writes per collection; nothing touches `state` until commit.
    const staged = new Map();
    const stageFor = (collection) => {
      let s = staged.get(collection);
      if (!s) { s = newStage(); staged.set(collection, s); }
      return s;
    };

    // Overlay-aware effective rows for a collection: base minus deletes, patched
    // by updates, plus staged inserts (staged first = newest, matching unshift).
    const effectiveRows = (collection) => {
      const s = staged.get(collection);
      const base = collectionArray(state, collection);
      if (!s) return [...base];
      const kept = base
        .filter((row) => !s.deletes.has(row?.id))
        .map((row) => (s.updates.has(row?.id) ? { ...row, ...s.updates.get(row.id) } : row));
      return [...s.inserts, ...kept];
    };

    const tx = {
      get(collection, id) {
        const s = staged.get(collection);
        if (s?.deletes.has(id)) return null;
        const inserted = s?.inserts.find((row) => row?.id === id);
        if (inserted) return inserted;
        const base = get(collection, id);
        if (base && s?.updates.has(id)) return { ...base, ...s.updates.get(id) };
        return base;
      },
      query(collection, predicate) {
        const rows = effectiveRows(collection);
        return typeof predicate === "function" ? rows.filter(predicate) : rows;
      },
      insert(collection, record) {
        if (!record || record.id == null) throw new Error("insert requires a record with an id.");
        const s = stageFor(collection);
        s.deletes.delete(record.id);
        s.inserts.push(record);
        return record;
      },
      update(collection, id, patch) {
        const s = stageFor(collection);
        // Merge onto any prior staged update or the insert, else stage a patch.
        const stagedInsert = s.inserts.find((row) => row?.id === id);
        if (stagedInsert) {
          Object.assign(stagedInsert, patch);
          return stagedInsert;
        }
        s.updates.set(id, { ...(s.updates.get(id) ?? {}), ...patch });
        return { ...(get(collection, id) ?? { id }), ...s.updates.get(id) };
      },
      delete(collection, id) {
        const s = stageFor(collection);
        s.inserts = s.inserts.filter((row) => row?.id !== id);
        s.updates.delete(id);
        s.deletes.add(id);
      },
    };

    let result;
    try {
      result = fn(tx);
    } catch (error) {
      // Rollback: staged writes are discarded, `state` was never touched.
      throw error;
    }

    // Commit: apply staged writes to `state` atomically (synchronous — no await
    // between here and the flush, so no concurrent read sees a half-applied tx),
    // then flush once through the durable barrier.
    for (const [collection, s] of staged) {
      if (!Array.isArray(state[collection])) state[collection] = [];
      if (s.deletes.size > 0) {
        state[collection] = state[collection].filter((row) => !s.deletes.has(row?.id));
      }
      if (s.updates.size > 0) {
        for (const row of state[collection]) {
          if (row && s.updates.has(row.id)) Object.assign(row, s.updates.get(row.id));
        }
      }
      // Newest-first, matching the existing unshift convention.
      for (let i = s.inserts.length - 1; i >= 0; i -= 1) {
        state[collection].unshift(s.inserts[i]);
      }
    }
    if (typeof commit === "function") commit();
    return result;
  }

  // ADR 0019: history API for contract parity. The memory backing has no durable
  // store beyond `state`, so this is an in-PROCESS history (not persisted across
  // restart — the JSONL archive is the memory-backing's durable long store). It
  // gives callers ONE shape: append + paginated query behave identically to the
  // SQLite adapter within a run; only durability differs.
  let historySeq = 0;
  const history = [];
  const historyKeys = new Set();
  function appendHistory(collection, rows) {
    if (!Array.isArray(rows)) return { appended: 0 };
    let appended = 0;
    for (const row of rows) {
      if (!row || row.id == null) continue;
      const key = `${collection}:${row.id}`;
      if (historyKeys.has(key)) continue; // dedup by (collection,id), like OR IGNORE
      historyKeys.add(key);
      history.push({ seq: (historySeq += 1), collection, invocationId: row.invocationId ?? row.subjectId ?? row.traceId ?? null, row });
      appended += 1;
    }
    return { appended };
  }
  // Parity with the SQLite adapter's queryHistory: `order` selects which end of
  // the seq range the cap covers ("desc" = newest cap, "asc" = earliest cap incl.
  // the lowest-seq root), and the cap upper bound matches the largest reader.
  function queryHistory(collection, { invocationId = null, before = null, limit = 100, order = "desc" } = {}) {
    const cap = Math.min(2000, Math.max(1, Number.parseInt(limit, 10) || 100));
    const asc = order === "asc";
    const matches = history
      .filter((h) => h.collection === collection
        && (invocationId == null || String(h.invocationId) === String(invocationId))
        && (before == null || !Number.isFinite(Number(before)) || (asc ? h.seq > Number(before) : h.seq < Number(before))))
      .sort((a, b) => (asc ? a.seq - b.seq : b.seq - a.seq));
    const hasMore = matches.length > cap;
    const page = matches.slice(0, cap);
    return { rows: page.map((h) => h.row), nextBefore: hasMore && page.length > 0 ? page[page.length - 1].seq : null };
  }

  return { get, query, transaction, appendHistory, queryHistory };
}
