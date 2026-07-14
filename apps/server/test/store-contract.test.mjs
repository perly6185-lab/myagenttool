/*
 * #966 — runs the shared Store contract (store-contract-suite.mjs) against the
 * in-memory snapshot adapter, plus adapter-specific checks (commit barrier +
 * interop with direct state writes). The SQLite adapter runs the same contract in
 * sqlite-store.test.mjs.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createInMemoryStore } from "../src/runtime/store/in-memory-store.mjs";
import { runStoreContract } from "./store-contract-suite.mjs";

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
  assert.equal(store.get("c", "legacy").v, 0);
  store.transaction((tx) => tx.insert("c", { id: "new", v: 1 }));
  assert.equal(store.query("c").length, 2, "store insert coexists with the legacy row");
  assert.equal(state.c.find((r) => r.id === "new").v, 1, "the store write landed on the same array");
});
