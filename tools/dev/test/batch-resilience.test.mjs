import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { parseArgs, parseTapSummary, percentile } from "../batch-resilience.mjs";

test("batch resilience options validate rounds, timeout, and report path", () => {
  const options = parseArgs([
    "--rounds", "20",
    "--timeout-ms", "45000",
    "--report", "tmp/resilience.json",
  ]);
  assert.equal(options.rounds, 20);
  assert.equal(options.timeoutMs, 45_000);
  assert.equal(
    options.reportPath,
    fileURLToPath(new URL("../../../tmp/resilience.json", import.meta.url)),
  );
  assert.throws(() => parseArgs(["--rounds", "0"]), /--rounds/);
  assert.throws(() => parseArgs(["--timeout-ms", "4999"]), /--timeout-ms/);
});

test("batch resilience TAP parser preserves terminal counts and subtest names", () => {
  const summary = parseTapSummary(`TAP version 13
# Subtest: durable work-item batch enforces concurrency and backfills the next slot
ok 1 - durable work-item batch enforces concurrency and backfills the next slot
1..1
# tests 1
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 12.5
`);
  assert.deepEqual(summary, {
    tests: 1,
    passed: 1,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    durationMs: 12.5,
    subtests: ["durable work-item batch enforces concurrency and backfills the next slot"],
  });
});

test("batch resilience percentile uses the nearest-rank method", () => {
  assert.equal(percentile([10, 50, 20, 40, 30], 95), 50);
  assert.equal(percentile([], 95), null);
});
