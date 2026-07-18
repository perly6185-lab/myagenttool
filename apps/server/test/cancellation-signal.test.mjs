/**
 * #1302 long-poll — the per-device cancellation wakeup. Hermetic; a short
 * maxWaitMs keeps the timeout path fast.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCancellationSignal } from "../src/services/cancellation-signal.mjs";

test("notify wakes a waiter for that device only", async () => {
  const signal = createCancellationSignal({ maxWaitMs: 10_000 });
  let awoke = false;
  const w = signal.wait("dev_a");
  w.promise.then(() => { awoke = true; });

  signal.notify("dev_b"); // different device — no effect
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(awoke, false);
  assert.equal(signal.waiterCount("dev_a"), 1);

  signal.notify("dev_a");
  await w.promise;
  assert.equal(awoke, true);
  assert.equal(signal.waiterCount("dev_a"), 0, "the waiter is cleaned up after firing");
});

test("wait resolves on the max-wait timeout when nothing is notified", async () => {
  const signal = createCancellationSignal({ maxWaitMs: 20 });
  const started = Date.now();
  await signal.wait("dev_a").promise;
  assert.ok(Date.now() - started >= 15, "resolved via the timeout, not instantly");
  assert.equal(signal.waiterCount("dev_a"), 0);
});

test("cancel() resolves the wait early and cleans up (client disconnect)", async () => {
  const signal = createCancellationSignal({ maxWaitMs: 10_000 });
  const w = signal.wait("dev_a");
  assert.equal(signal.waiterCount("dev_a"), 1);
  w.cancel();
  await w.promise; // resolves promptly
  assert.equal(signal.waiterCount("dev_a"), 0);
});

test("notify wakes every waiter on the device", async () => {
  const signal = createCancellationSignal({ maxWaitMs: 10_000 });
  const a = signal.wait("dev_a");
  const b = signal.wait("dev_a");
  assert.equal(signal.waiterCount("dev_a"), 2);
  signal.notify("dev_a");
  await Promise.all([a.promise, b.promise]);
  assert.equal(signal.waiterCount("dev_a"), 0);
});

test("notify with no waiters is a no-op", () => {
  const signal = createCancellationSignal();
  assert.doesNotThrow(() => signal.notify("nobody"));
  assert.equal(signal.waiterCount(), 0);
});

test("double settle (notify then timeout, or notify twice) is safe", async () => {
  const signal = createCancellationSignal({ maxWaitMs: 15 });
  const w = signal.wait("dev_a");
  signal.notify("dev_a");
  signal.notify("dev_a"); // second notify — already settled
  await w.promise;
  await new Promise((r) => setTimeout(r, 25)); // let the timeout fire too
  assert.equal(signal.waiterCount("dev_a"), 0);
});
