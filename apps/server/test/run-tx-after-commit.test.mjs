import assert from "node:assert/strict";
import { test } from "node:test";

import { makeRunTx } from "../src/runtime/store/run-tx.mjs";

test("afterCommit runs only after a successful transaction", () => {
  const order = [];
  const store = {
    transaction(fn) {
      order.push("begin");
      const result = fn();
      order.push("commit");
      return result;
    },
  };
  const runTx = makeRunTx({ store });
  runTx(() => {
    order.push("mutate");
    runTx.afterCommit(() => order.push("effect"));
  });
  assert.deepEqual(order, ["begin", "mutate", "commit", "effect"]);
});

test("afterCommit drops external effects when the transaction rolls back", () => {
  const effects = [];
  const store = { transaction: (fn) => fn() };
  const runTx = makeRunTx({ store });
  assert.throws(() => runTx(() => {
    runTx.afterCommit(() => effects.push("sent"));
    throw new Error("rollback");
  }), /rollback/);
  assert.deepEqual(effects, []);
});

test("nested transactions flush their effects once after the outer commit", () => {
  const effects = [];
  const runTx = makeRunTx({ persistStateSoon: () => effects.push("persist") });
  runTx(() => {
    runTx.afterCommit(() => effects.push("outer"));
    runTx(() => runTx.afterCommit(() => effects.push("inner")));
  });
  assert.deepEqual(effects, ["persist", "outer", "inner"]);
});
