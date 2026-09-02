import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeWorkItemIntentEvaluationField,
  normalizeWorkItemIntentEvaluationThresholds,
  workItemIntentEvaluationDefaultThresholds,
  workItemIntentEvaluationFields,
  workItemIntentEvaluationSchemaVersion,
} from "../src/work-item-intent-evaluation.mjs";

test("work item intent evaluation keeps one closed five-field scoring vocabulary", () => {
  assert.equal(workItemIntentEvaluationSchemaVersion, 1);
  assert.deepEqual(workItemIntentEvaluationFields, ["goal", "action", "materials", "output", "delivery"]);
  assert.equal(normalizeWorkItemIntentEvaluationField("materials"), "materials");
  assert.equal(normalizeWorkItemIntentEvaluationField("provider_guess"), null);
});

test("work item intent evaluation thresholds are bounded and retain safe defaults", () => {
  assert.deepEqual(normalizeWorkItemIntentEvaluationThresholds(null), workItemIntentEvaluationDefaultThresholds);
  assert.deepEqual(normalizeWorkItemIntentEvaluationThresholds({
    goalAccuracy: 2,
    actionAccuracy: -1,
    minimumCaseCount: 12.9,
    macroFieldAccuracy: "0.97",
    unsafeActionExpansionRate: "invalid",
  }), {
    ...workItemIntentEvaluationDefaultThresholds,
    goalAccuracy: 1,
    actionAccuracy: 0,
    minimumCaseCount: 12,
    macroFieldAccuracy: 0.97,
  });
});
