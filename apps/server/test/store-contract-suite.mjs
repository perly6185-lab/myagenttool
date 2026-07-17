/*
 * The Store contract both adapters must satisfy (in-memory #966, SQLite #967).
 * A plain helper (NOT a *.test.mjs, so `node --test` doesn't auto-run it) —
 * store-contract.test.mjs and sqlite-store.test.mjs both import runStoreContract
 * and invoke it against their adapter, so the two stores are provably
 * interchangeable from one source of truth.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

/** @param label test-name prefix @param makeStore () => { store } factory */
export function runStoreContract(label, makeStore) {
  test(`${label}: get/query read committed rows`, () => {
    const { store } = makeStore();
    store.transaction((tx) => {
      tx.insert("things", { id: "t1", v: 1 });
      tx.insert("things", { id: "t2", v: 2 });
    });
    assert.equal(store.get("things", "t1").v, 1);
    assert.equal(store.get("things", "missing"), null);
    assert.equal(store.query("things").length, 2);
    assert.equal(store.query("things", (r) => r.v > 1).length, 1);
    assert.equal(store.query("empty").length, 0);
  });

  test(`${label}: insert / update / delete commit atomically`, () => {
    const { store } = makeStore();
    store.transaction((tx) => tx.insert("c", { id: "a", v: 1, keep: "x" }));
    store.transaction((tx) => {
      tx.insert("c", { id: "b", v: 2 });
      tx.update("c", "a", { v: 10 });
      tx.delete("c", "a"); // delete wins over the update in the same tx
    });
    assert.equal(store.get("c", "a"), null, "a was deleted");
    assert.equal(store.get("c", "b").v, 2, "b was inserted");
  });

  test(`${label}: update shallow-merges a patch onto the record`, () => {
    const { store } = makeStore();
    store.transaction((tx) => tx.insert("c", { id: "a", v: 1, keep: "x" }));
    store.transaction((tx) => tx.update("c", "a", { v: 2 }));
    const a = store.get("c", "a");
    assert.equal(a.v, 2, "patched field updated");
    assert.equal(a.keep, "x", "unpatched field preserved");
  });

  test(`${label}: read-your-writes inside a transaction`, () => {
    const { store } = makeStore();
    store.transaction((tx) => {
      tx.insert("c", { id: "a", v: 1 });
      assert.equal(tx.get("c", "a").v, 1, "sees its own insert");
      tx.update("c", "a", { v: 2 });
      assert.equal(tx.get("c", "a").v, 2, "sees its own update");
      assert.equal(tx.query("c").length, 1);
      tx.delete("c", "a");
      assert.equal(tx.get("c", "a"), null, "sees its own delete");
      assert.equal(tx.query("c").length, 0);
    });
    assert.equal(store.query("c").length, 0, "net effect (insert then delete) committed nothing");
  });

  test(`${label}: rollback on throw leaves no partial write`, () => {
    const { store } = makeStore();
    store.transaction((tx) => tx.insert("c", { id: "keep", v: 1 }));
    assert.throws(
      () => store.transaction((tx) => {
        tx.insert("c", { id: "x", v: 9 });
        tx.update("c", "keep", { v: 99 });
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(store.get("c", "x"), null, "the throwing tx inserted nothing");
    assert.equal(store.get("c", "keep").v, 1, "the throwing tx's update rolled back; prior data intact");
  });

  test(`${label}: a returning transaction propagates its result`, () => {
    const { store } = makeStore();
    const out = store.transaction((tx) => {
      tx.insert("c", { id: "a", v: 1 });
      return "done";
    });
    assert.equal(out, "done");
  });

  // ADR 0019: durable observability history — append + paginated newest-first read.
  test(`${label}: appendHistory / queryHistory — append, dedup, scope, paginate newest-first`, () => {
    const { store } = makeStore();
    // Two invocations' rows into one collection.
    store.appendHistory("refusals", [
      { id: "r1", invocationId: "inv_1", at: "t1", summary: "one" },
      { id: "r2", invocationId: "inv_1", at: "t2", summary: "two" },
      { id: "rx", invocationId: "inv_2", at: "tx", summary: "other" },
    ]);
    // Dedup by (collection,id): a re-append of r1 is ignored.
    const dup = store.appendHistory("refusals", [{ id: "r1", invocationId: "inv_1", at: "t1", summary: "one" }]);
    assert.equal(dup.appended, 0, "re-append of an existing (collection,id) is ignored");
    store.appendHistory("refusals", [{ id: "r3", invocationId: "inv_1", at: "t3", summary: "three" }]);

    // Scoped to inv_1, newest-first (r3, r2, r1).
    const all = store.queryHistory("refusals", { invocationId: "inv_1" });
    assert.deepEqual(all.rows.map((r) => r.id), ["r3", "r2", "r1"]);
    assert.equal(all.nextBefore, null, "no more pages");

    // A different collection is empty.
    assert.equal(store.queryHistory("traces").rows.length, 0);

    // Pagination: first page of 2, then the rest via the cursor.
    const page1 = store.queryHistory("refusals", { invocationId: "inv_1", limit: 2 });
    assert.deepEqual(page1.rows.map((r) => r.id), ["r3", "r2"]);
    assert.ok(page1.nextBefore != null, "more pages → a cursor");
    const page2 = store.queryHistory("refusals", { invocationId: "inv_1", limit: 2, before: page1.nextBefore });
    assert.deepEqual(page2.rows.map((r) => r.id), ["r1"]);
    assert.equal(page2.nextBefore, null);
  });

  // ADR 0019 fix: order: "asc" returns the EARLIEST cap rows (the span-tree read
  // needs the lowest-seq root span to survive the cap, not the newest window).
  test(`${label}: queryHistory order "asc" returns the earliest cap, not the newest`, () => {
    const { store } = makeStore();
    store.appendHistory("spans", [
      { id: "root", traceId: "trc_1", startedAt: "t0" },
      { id: "s1", traceId: "trc_1", startedAt: "t1" },
      { id: "s2", traceId: "trc_1", startedAt: "t2" },
    ]);
    const desc = store.queryHistory("spans", { invocationId: "trc_1", limit: 2 });
    assert.deepEqual(desc.rows.map((r) => r.id), ["s2", "s1"], "desc: newest cap");
    const asc = store.queryHistory("spans", { invocationId: "trc_1", limit: 2, order: "asc" });
    assert.deepEqual(asc.rows.map((r) => r.id), ["root", "s1"], "asc: earliest cap keeps the root");
    assert.ok(asc.nextBefore != null, "asc still paginates (more rows remain)");
  });

  // ADR 0019 fix (H): appendHistory must be callable inside an outer store
  // transaction — a non-reentrant BEGIN would throw and a best-effort dual-write
  // caller would silently drop the history. Both adapters must join the outer tx.
  test(`${label}: appendHistory inside an outer transaction does not throw and persists`, () => {
    const { store } = makeStore();
    assert.doesNotThrow(() => {
      store.transaction((tx) => {
        tx.insert("c", { id: "rec_1", v: 1 });
        store.appendHistory("refusals", [{ id: "r1", invocationId: "inv_1", at: "t1", summary: "one" }]);
      });
    });
    assert.deepEqual(store.queryHistory("refusals", { invocationId: "inv_1" }).rows.map((r) => r.id), ["r1"]);
  });

  // ADR 0019 B-3: erasure reaches history — deleteHistory removes a scope's rows.
  test(`${label}: deleteHistory removes a scope's rows (and only that scope) + re-append works after`, () => {
    const { store } = makeStore();
    store.appendHistory("spans", [
      { id: "s1", traceId: "trc_1", startedAt: "t1" },
      { id: "s2", traceId: "trc_1", startedAt: "t2" },
      { id: "sx", traceId: "trc_2", startedAt: "tx" },
    ]);
    const del = store.deleteHistory("spans", "trc_1");
    assert.equal(del.deleted, 2);
    assert.deepEqual(store.queryHistory("spans", { invocationId: "trc_1" }).rows, [], "scope trc_1 erased");
    assert.deepEqual(store.queryHistory("spans", { invocationId: "trc_2" }).rows.map((r) => r.id), ["sx"], "other scope untouched");
    assert.equal(store.deleteHistory("spans", null).deleted, 0, "null scope is a no-op");
    // Dedup key was released, so a fresh append of the same id is honoured (not swallowed).
    assert.equal(store.appendHistory("spans", [{ id: "s1", traceId: "trc_1", startedAt: "t1" }]).appended, 1);
  });

  // ADR 0019 B-3: shielded rows are redacted in place, not dropped.
  test(`${label}: redactHistory mutates a scope's rows in place and counts only real changes`, () => {
    const { store } = makeStore();
    store.appendHistory("refusals", [
      { id: "r1", invocationId: "inv_1", at: "t1", summary: "call 555-1234" },
      { id: "r2", invocationId: "inv_1", at: "t2", summary: "clean" },
      { id: "rx", invocationId: "inv_2", at: "tx", summary: "call 555-9999" },
    ]);
    const redactor = (row) => { if (typeof row.summary === "string" && row.summary.includes("555")) { row.summary = "[redacted]"; row.piiRedacted = true; } };
    const res = store.redactHistory("refusals", "inv_1", redactor);
    assert.equal(res.redacted, 1, "only the row that actually changed is counted");
    const rows = store.queryHistory("refusals", { invocationId: "inv_1" }).rows;
    assert.ok(rows.find((r) => r.id === "r1").piiRedacted, "r1 scrubbed + marked");
    assert.equal(rows.find((r) => r.id === "r2").summary, "clean", "clean row untouched");
    assert.equal(store.queryHistory("refusals", { invocationId: "inv_2" }).rows[0].summary, "call 555-9999", "other scope untouched");
    assert.equal(store.redactHistory("refusals", "inv_1", null).redacted, 0, "no redactor → no-op");
  });

  // ADR 0019 B-3: time-based retention reap bounds the unmirrored history table.
  test(`${label}: reapHistory deletes dated rows older than the cutoff, keeps undated + in-window`, () => {
    const { store } = makeStore();
    store.appendHistory("events", [
      { id: "old", invocationId: "inv_1", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "new", invocationId: "inv_1", createdAt: "2026-07-01T00:00:00.000Z" },
      { id: "undated", invocationId: "inv_1" },
    ]);
    const res = store.reapHistory({ before: "2026-06-01T00:00:00.000Z" });
    assert.equal(res.reaped, 1, "only the pre-cutoff dated row is reaped");
    const remaining = store.queryHistory("events", { invocationId: "inv_1" }).rows.map((r) => r.id).sort();
    assert.deepEqual(remaining, ["new", "undated"], "in-window and undated rows survive");
    assert.equal(store.reapHistory({}).reaped, 0, "no cutoff → no-op");
  });
}
