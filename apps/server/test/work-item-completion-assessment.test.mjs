import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessWorkItemCompletion,
  taskCompletionMetrics,
  taskCompletionQualityMetrics,
} from "../src/services/work-item-completion-assessment.mjs";

function check(key, status = "matched", reasonCode = `${key}_${status}`) {
  return { key, status, reasonCode };
}

function matchedPlan() {
  return {
    status: "matched",
    checks: ["method", "materials", "output", "action", "verification", "delivery"].map((key) => check(key)),
  };
}

test("a development task is complete only after its execution receipts match and the lifecycle is closed", () => {
  const ready = assessWorkItemCompletion({
    item: { id: "wi_dev", status: "review", state: "open" },
    latestRun: { id: "aur_dev", status: "pr_open" },
    planActual: matchedPlan(),
  });
  assert.equal(ready.status, "ready_to_complete");
  assert.equal(ready.evidenceComplete, true);
  assert.equal(ready.requiresUserAction, true);

  const completed = assessWorkItemCompletion({
    item: { id: "wi_dev", status: "done", state: "closed" },
    latestRun: { id: "aur_dev", status: "pr_open" },
    planActual: matchedPlan(),
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.falseCompletion, false);
});

test("a rolled-back office batch cannot be counted as completed even if the task says done", () => {
  const planActual = matchedPlan();
  planActual.status = "attention";
  planActual.checks = planActual.checks.map((entry) => entry.key === "action"
    ? check("action", "mismatch", "planned_write_rolled_back")
    : entry);
  const result = assessWorkItemCompletion({
    item: { id: "wi_office", status: "done", state: "closed" },
    latestRun: { id: "aur_office", status: "done" },
    planActual,
  });
  assert.equal(result.status, "needs_attention");
  assert.equal(result.falseCompletion, true);
  assert.deepEqual(result.reasonCodes, ["planned_write_rolled_back"]);
  assert.equal(result.stages.execution.status, "mismatch");
});

test("a terminal material task with missing source receipts remains explicitly unverified", () => {
  const planActual = matchedPlan();
  planActual.status = "unverified";
  planActual.checks = planActual.checks.map((entry) => entry.key === "materials"
    ? check("materials", "unknown", "material_use_not_proven")
    : entry);
  const result = assessWorkItemCompletion({
    item: { id: "wi_material", status: "done", state: "closed" },
    latestRun: { id: "aur_material", status: "done" },
    planActual,
  });
  assert.equal(result.status, "unverified");
  assert.equal(result.falseCompletion, true);
  assert.deepEqual(result.stages.materials.reasonCodes, ["material_use_not_proven"]);
});

test("stopping delivery is an ended task, not a successful completion", () => {
  const result = assessWorkItemCompletion({
    item: { id: "wi_stopped", status: "done", state: "closed" },
    latestRun: { id: "aur_stopped", status: "done", deliveryStopped: { stoppedAt: "2026-08-28T00:00:00.000Z" } },
    planActual: matchedPlan(),
  });
  assert.equal(result.status, "stopped");
  assert.equal(result.falseCompletion, false, "the evidence is still truthful even though the user chose not to deliver it");
  assert.deepEqual(result.reasonCodes, ["delivery_stopped_by_user"]);
});

test("manual work uses the structured completion gate instead of being treated as unverified", () => {
  const result = assessWorkItemCompletion({
    item: { id: "wi_manual", status: "done", state: "closed" },
    completionGate: { ready: true, missingCriteria: [], verificationRequired: false, resultVerificationRequired: false },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.evidenceComplete, true);
});

test("completion metrics separate genuine completion from false lifecycle completion", () => {
  const completed = assessWorkItemCompletion({
    item: { status: "done", state: "closed" }, latestRun: { status: "done" }, planActual: matchedPlan(),
  });
  const unverified = assessWorkItemCompletion({
    item: { status: "done", state: "closed" }, latestRun: { status: "done" }, planActual: { status: "unverified", checks: [] },
  });
  assert.deepEqual(taskCompletionMetrics([completed, unverified]), {
    tracked: 2, settled: 2, completed: 1, falseCompletions: 1, requiringUserAction: 1,
    completionRate: 0.5, falseCompletionRate: 0.5,
  });
});

test("quality metrics quantify truthful completion, recovery, intervention, and duplicate external effects", () => {
  const completed = assessWorkItemCompletion({
    item: { status: "done", state: "closed" }, latestRun: { status: "done" }, planActual: matchedPlan(),
  });
  const unverified = assessWorkItemCompletion({
    item: { status: "done", state: "closed" }, latestRun: { status: "done" }, planActual: { status: "unverified", checks: [] },
  });
  const readyForNormalSignoff = assessWorkItemCompletion({
    item: { status: "review", state: "open" }, latestRun: { status: "done" }, planActual: matchedPlan(),
  });
  const metrics = taskCompletionQualityMetrics({
    assessments: [completed, unverified, readyForNormalSignoff],
    receipts: [
      {
        id: "ear_recovered", status: "succeeded", externalActionAttemptCount: 1,
        deliveryCheckpoint: { operationId: "wdo_1" },
        deliveryRecovery: { requiredAt: "2026-08-28T00:00:00.000Z", recoveredAt: "2026-08-28T00:01:00.000Z" },
      },
      {
        id: "ear_pending", status: "unknown", externalActionAttemptCount: 2,
        deliveryCheckpoint: { operationId: "wdo_2" },
        deliveryRecovery: { requiredAt: "2026-08-28T00:00:00.000Z", recoveredAt: null },
      },
      { id: "ear_retry", kind: "retry_execution", status: "succeeded" },
      // The durable copy and recent display copy must not double-count.
      {
        id: "ear_recovered", status: "succeeded", externalActionAttemptCount: 1,
        deliveryCheckpoint: { operationId: "wdo_1" },
        deliveryRecovery: { requiredAt: "2026-08-28T00:00:00.000Z", recoveredAt: "2026-08-28T00:01:00.000Z" },
      },
    ],
  });

  assert.equal(metrics.completion.completionRate, 0.5);
  assert.equal(metrics.recovery.required, 3);
  assert.equal(metrics.recovery.successRate, 2 / 3);
  assert.equal(metrics.humanIntervention.count, 1, "normal final sign-off is not an intervention");
  assert.equal(metrics.humanIntervention.rate, 1 / 3);
  assert.equal(metrics.externalActions.attempts, 3);
  assert.equal(metrics.externalActions.duplicateCount, 1);
  assert.equal(metrics.externalActions.unresolvedCount, 1);
  assert.equal(metrics.acceptance.status, "attention");
});
