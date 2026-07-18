/**
 * #1246 — spawnCapture: async, non-blocking replacement for spawnSync. Drives
 * real short-lived Node child processes (hermetic, no network, no fixtures).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnCapture } from "../src/spawn-capture.mjs";

const node = process.execPath;

test("captures stdout and a zero exit status", async () => {
  const result = await spawnCapture(node, ["-e", "process.stdout.write('hello')"]);
  assert.equal(result.status, 0);
  assert.equal(result.error, null);
  assert.equal(result.stdout, "hello");
  assert.equal(result.timedOut, false);
});

test("captures stderr and a non-zero exit status", async () => {
  const result = await spawnCapture(node, ["-e", "process.stderr.write('boom'); process.exit(3)"]);
  assert.equal(result.status, 3);
  assert.equal(result.error, null);
  assert.match(result.stderr, /boom/);
});

test("does not block the event loop while the child runs", async () => {
  let ticks = 0;
  const interval = setInterval(() => {
    ticks += 1;
  }, 10);
  await spawnCapture(node, ["-e", "setTimeout(() => {}, 120)"]);
  clearInterval(interval);
  // A synchronous spawnSync would have frozen the loop and fired zero timers.
  assert.ok(ticks > 0, `expected the interval to fire during the child; got ${ticks} ticks`);
});

test("timeout kills the child and reports ETIMEDOUT, never a success", async () => {
  const result = await spawnCapture(node, ["-e", "setTimeout(() => {}, 5000)"], { timeout: 100 });
  assert.equal(result.timedOut, true);
  assert.equal(result.error?.code, "ETIMEDOUT");
  assert.notEqual(result.status, 0, "a timed-out run must not look like a clean exit");
});

test("a missing command resolves as an error result, not a throw", async () => {
  const result = await spawnCapture("this-command-does-not-exist-xyz", ["--version"]);
  assert.ok(result.error, "a spawn error is reported on the result");
  assert.equal(result.status, null);
});
