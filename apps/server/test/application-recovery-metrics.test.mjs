import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeOrchestrationRecovery } from "../src/services/application-recovery-metrics.mjs";

const base = Date.parse("2026-07-01T00:00:00Z");
const t = (ms) => new Date(base + ms).toISOString();
const run = (status, atMs, { app = "app_1", routine = "rt_1", meta = {} } = {}) => ({
  id: `inv_${status}_${atMs}`,
  status,
  completedAt: t(atMs),
  options: { metadata: { source: "application_orchestration", applicationId: app, routineId: routine, ...meta } },
});

test("failure recovered by the first later success on the same stream (median hours)", () => {
  const summary = summarizeOrchestrationRecovery([
    run("failed", 0),
    run("succeeded", 1_800_000), // +0.5h — the recovery
    run("succeeded", 7_200_000), // later success is NOT the recovery
  ]);
  assert.deepEqual(summary, { total: 3, failed: 1, recoveryHours: { median: 0.5, count: 1 } });
});

test("streams are isolated — a success in routine B never recovers routine A", () => {
  const summary = summarizeOrchestrationRecovery([
    run("failed", 0, { routine: "rt_a" }),
    run("succeeded", 1_800_000, { routine: "rt_b" }),
  ]);
  assert.equal(summary.failed, 1);
  assert.deepEqual(summary.recoveryHours, { median: null, count: 0 });
});

test("median across multiple recovered failures", () => {
  const summary = summarizeOrchestrationRecovery([
    run("failed", 0),
    run("succeeded", 3_600_000), // 1h
    run("failed", 10_000_000),
    run("succeeded", 10_000_000 + 10_800_000), // 3h
  ]);
  assert.deepEqual(summary.recoveryHours, { median: 2, count: 2 });
});

test("non-orchestration, non-terminal, and timestamp-less runs are ignored", () => {
  const summary = summarizeOrchestrationRecovery([
    { id: "plain", status: "failed", completedAt: t(0), options: { metadata: { source: "automation" } } },
    { ...run("failed", 0), status: "running" },
    { ...run("failed", 0), completedAt: null },
    run("failed", 0),
  ]);
  assert.equal(summary.total, 1);
  assert.equal(summary.failed, 1);
});

test("empty / missing input → honest nulls, no throw", () => {
  assert.deepEqual(summarizeOrchestrationRecovery(), { total: 0, failed: 0, recoveryHours: { median: null, count: 0 } });
  assert.deepEqual(summarizeOrchestrationRecovery([]).recoveryHours, { median: null, count: 0 });
});

test("consecutive failures on a stream are ONE incident recovered once (no double-count)", () => {
  const summary = summarizeOrchestrationRecovery([
    run("failed", 0),
    run("failed", 0.9 * 3_600_000),
    run("succeeded", 1.1 * 3_600_000),
  ]);
  assert.equal(summary.recoveryHours.count, 1);
  assert.equal(summary.recoveryHours.median, 1.1, "success − the incident's FIRST failure, not once per failed run");
});
