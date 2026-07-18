/**
 * #1251 — the shared cancellation watcher. Hermetic: `request` is a fake that
 * returns a controllable cancel-requested set; no HTTP, no timers (we drive
 * pollOnce directly).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createCancellationWatcher } from "../src/cancellation-watcher.mjs";

const tick = () => new Promise((r) => setTimeout(r, 0));

test("no HTTP when nothing is watched", async () => {
  let calls = 0;
  const watcher = createCancellationWatcher({ request: async () => { calls += 1; return { invocationIds: [] }; } });
  await watcher.pollOnce();
  assert.equal(calls, 0, "an idle bridge makes zero cancellation calls");
});

test("fires a run's handler once when its id appears in the set", async () => {
  let requested = [];
  const fired = [];
  const watcher = createCancellationWatcher({
    request: async () => ({ invocationIds: requested }),
  });
  watcher.watch("inv_a", () => { fired.push("inv_a"); });
  watcher.watch("inv_b", () => { fired.push("inv_b"); });

  await watcher.pollOnce();
  await tick();
  assert.deepEqual(fired, [], "no cancellation yet");

  requested = ["inv_b"];
  await watcher.pollOnce();
  await tick();
  assert.deepEqual(fired, ["inv_b"], "only the cancelled run fires");

  // Still cancel-requested on the next poll, but it must not fire twice.
  await watcher.pollOnce();
  await tick();
  assert.deepEqual(fired, ["inv_b"], "fires at most once per run");
});

test("one poll covers many concurrent runs (O(1) HTTP)", async () => {
  let calls = 0;
  const watcher = createCancellationWatcher({
    request: async () => { calls += 1; return { invocationIds: ["inv_2", "inv_4"] }; },
  });
  const fired = [];
  for (const id of ["inv_1", "inv_2", "inv_3", "inv_4", "inv_5"]) {
    watcher.watch(id, () => fired.push(id));
  }
  await watcher.pollOnce();
  await tick();
  assert.equal(calls, 1, "a single GET serves all five runs");
  assert.deepEqual(fired.sort(), ["inv_2", "inv_4"]);
});

test("unsubscribe stops a run from ever firing", async () => {
  let requested = [];
  const fired = [];
  const watcher = createCancellationWatcher({ request: async () => ({ invocationIds: requested }) });
  const stop = watcher.watch("inv_a", () => fired.push("inv_a"));
  stop();
  assert.equal(watcher.size(), 0);
  requested = ["inv_a"];
  await watcher.pollOnce();
  await tick();
  assert.deepEqual(fired, [], "an unsubscribed (terminal) run never fires");
});

test("a transient GET failure is swallowed and reported, not thrown", async () => {
  const errors = [];
  let mode = "throw";
  const watcher = createCancellationWatcher({
    request: async () => {
      if (mode === "throw") throw new Error("ECONNRESET");
      return { invocationIds: ["inv_a"] };
    },
    onError: (error) => errors.push(error.message),
  });
  const fired = [];
  watcher.watch("inv_a", () => fired.push("inv_a"));

  await watcher.pollOnce(); // throws internally
  await tick();
  assert.deepEqual(errors, ["ECONNRESET"]);
  assert.deepEqual(fired, [], "no handler fired on a failed poll");

  mode = "ok";
  await watcher.pollOnce(); // recovers on the next tick
  await tick();
  assert.deepEqual(fired, ["inv_a"], "the next poll recovers");
});

test("a handler that rejects is isolated via onError", async () => {
  const errors = [];
  const watcher = createCancellationWatcher({
    request: async () => ({ invocationIds: ["inv_a", "inv_b"] }),
    onError: (error, id) => errors.push(`${id}:${error.message}`),
  });
  const fired = [];
  watcher.watch("inv_a", async () => { throw new Error("boom"); });
  watcher.watch("inv_b", () => fired.push("inv_b"));

  await watcher.pollOnce();
  await tick();
  assert.deepEqual(fired, ["inv_b"], "a sibling handler still fires");
  assert.deepEqual(errors, ["inv_a:boom"]);
});
