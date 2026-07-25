import test from "node:test";
import assert from "node:assert/strict";
import { applicationResolutionBudgetGate, summarizeApplicationResolution } from "../src/services/application-resolution-metrics.mjs";

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
  assert.equal(summary.budget.status, "insufficient_data");
});

test("application resolution has honest nulls without samples", () => {
  const summary = summarizeApplicationResolution();
  assert.equal(summary.sampleCount, 0);
  assert.equal(summary.p50Ms, null);
  assert.equal(summary.budget.status, "insufficient_data");
});

test("application resolution performance budget fails only with a representative sample", () => {
  assert.equal(applicationResolutionBudgetGate({ sampleCount: 20, p95Ms: 501, thresholdMs: 500 }).status, "fail");
  assert.equal(applicationResolutionBudgetGate({ sampleCount: 20, p95Ms: 500, thresholdMs: 500 }).status, "pass");
  assert.equal(applicationResolutionBudgetGate({ sampleCount: 19, p95Ms: 900, thresholdMs: 500 }).status, "insufficient_data");
});
