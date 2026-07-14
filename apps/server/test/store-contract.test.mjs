/*
 * #966 — the Store contract both adapters must satisfy (in-memory snapshot now,
 * SQLite #967 later). `runStoreContract(makeStore)` is exported so #967 reuses it
 * verbatim; this file runs it against the in-memory adapter and adds
 * adapter-specific checks (commit barrier + interop with direct state writes).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createInMemoryStore } from "../src/runtime/store/in-memory-store.mjs";

/** Contract: every store must behave identically here, regardless of backing. */
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
}

// ── Run the contract against the in-memory snapshot adapter ──────────────────
function makeInMemory() {
  const state = {};
  let commits = 0;
  const store = createInMemoryStore({ state, commit: () => { commits += 1; } });
  return { store, state, commitCount: () => commits };
}

runStoreContract("in-memory", makeInMemory);

// ── Adapter-specific: the durable barrier + interop with direct state writes ──
test("in-memory: a committed transaction flushes exactly once through the barrier", () => {
  const { store, commitCount } = makeInMemory();
  store.transaction((tx) => { tx.insert("c", { id: "a" }); tx.insert("c", { id: "b" }); });
  assert.equal(commitCount(), 1, "one flush per transaction, not per write");
});

test("in-memory: a rolled-back transaction does not flush", () => {
  const { store, commitCount } = makeInMemory();
  assert.throws(() => store.transaction(() => { throw new Error("x"); }), /x/);
  assert.equal(commitCount(), 0, "no flush when the tx throws");
});

test("in-memory: interoperates with unmigrated direct state writes", () => {
  const { store, state } = makeInMemory();
  // An unmigrated service pushes straight onto the shared state array.
  state.c = [{ id: "legacy", v: 0 }];
  // The store sees it, and a tx composes with it.
  assert.equal(store.get("c", "legacy").v, 0);
  store.transaction((tx) => tx.insert("c", { id: "new", v: 1 }));
  assert.equal(store.query("c").length, 2, "store insert coexists with the legacy row");
  assert.equal(state.c.find((r) => r.id === "new").v, 1, "the store write landed on the same array");
});
