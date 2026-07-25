import test from "node:test";
import assert from "node:assert/strict";
import { summarizeApplicationResolution } from "../src/services/application-resolution-metrics.mjs";

test("application resolution reports bounded latency and waiting rate", () => {
  const summary = summarizeApplicationResolution([
    { durationMs: 10, state: "ready" },
    { durationMs: 20, state: "waiting_approval" },
    { durationMs: 900, state: "waiting_capacity" },
  ]);
  assert.equal(summary.sampleCount, 3);
  assert.equal(summary.p50Ms, 20);
  assert.equal(summary.p95Ms, 900);
  assert.equal(summary.waitingRate, 66.67);
  assert.equal(summary.alerting, true);
});

test("application resolution has honest nulls without samples", () => {
  assert.deepEqual(summarizeApplicationResolution(), {
    sampleCount: 0, p50Ms: null, p95Ms: null, waitingRate: null,
    alerting: false, thresholdMs: 500,
  });
});
