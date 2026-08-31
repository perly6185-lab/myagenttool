import assert from "node:assert/strict";
import test from "node:test";

import { summarizeHostOperationsMetrics } from "../src/services/host-operations-metrics.mjs";

test("summarizes host operations without exposing raw operational data", () => {
  const metrics = summarizeHostOperationsMetrics({
    generatedAt: "2026-08-31T08:00:00.000Z",
    cases: [
      { id: "case-1", status: "recovered", deviceChanged: true, nextStep: "case_complete", createdAt: "2026-08-31T07:00:00.000Z", updatedAt: "2026-08-31T07:02:30.000Z", input: "网站打不开", address: "10.0.0.5" },
      { id: "case-2", status: "needs_help", deviceChanged: false, nextStep: "review_manual_handoff", createdAt: "2026-08-31T07:10:00.000Z", updatedAt: "2026-08-31T07:11:00.000Z", command: "docker kill" },
      { id: "case-3", status: "diagnosed", deviceChanged: false, nextStep: "check_managed_website", createdAt: "2026-08-31T07:20:00.000Z", updatedAt: "2026-08-31T07:20:10.000Z" },
    ],
    remediationPlans: [
      { status: "completed", result: { changeAttempted: true } },
      { status: "failed", result: { changeAttempted: false } },
      { status: "outcome_unknown", result: { changeAttempted: true } },
    ],
  });

  assert.deepEqual(metrics.cases, {
    total: 3,
    active: 1,
    terminal: 2,
    recovered: 1,
    unresolved: 1,
    changed: 1,
    manualHandoff: 1,
    recoveryRate: 0.5,
    changeRate: 0.3333,
  });
  assert.deepEqual(metrics.remediation, {
    total: 3,
    terminal: 3,
    safeAbort: 1,
    unknownOutcome: 1,
    completed: 1,
    noChangeNeeded: 0,
  });
  assert.deepEqual(metrics.timing, {
    completedCaseCount: 2,
    averageCaseSeconds: 105,
    latestCaseUpdatedAt: "2026-08-31T07:20:10.000Z",
  });
  assert.equal(JSON.stringify(metrics).includes("网站打不开"), false);
  assert.equal(JSON.stringify(metrics).includes("10.0.0.5"), false);
  assert.equal(JSON.stringify(metrics).includes("docker kill"), false);
});

test("returns null rates when there is no observation sample", () => {
  const metrics = summarizeHostOperationsMetrics({ cases: [], remediationPlans: [] });
  assert.equal(metrics.cases.recoveryRate, null);
  assert.equal(metrics.cases.changeRate, null);
  assert.equal(metrics.timing.averageCaseSeconds, null);
});
