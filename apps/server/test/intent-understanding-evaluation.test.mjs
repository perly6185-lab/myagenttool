import test from "node:test";
import assert from "node:assert/strict";
import { evaluateIntentUnderstanding } from "../src/services/intent-understanding-evaluation.mjs";

test("ordinary-user intent replay set stays green across creator, software, and business work", () => {
  const evaluation = evaluateIntentUnderstanding();
  assert.equal(evaluation.total, 240);
  assert.equal(evaluation.failed.length, 0, JSON.stringify(evaluation.failed, null, 2));
  assert.equal(evaluation.passed, evaluation.total);
  assert.equal(evaluation.metrics.taskBoundaryAccuracy, 1);
  assert.equal(evaluation.metrics.unintendedTaskRate, 0);
  assert.equal(evaluation.metrics.clarificationAccuracy, 1);
  assert.ok(evaluation.metrics.distinctUtteranceCount >= 54);
  assert.ok(evaluation.metrics.taskKindCoverage >= 29);
  assert.equal(evaluation.metrics.negationAccuracy, 1);
  assert.equal(evaluation.metrics.crossDomainAccuracy, 1);
  assert.equal(evaluation.metrics.naturalExpressionAccuracy, 1);
  assert.equal(evaluation.metrics.heldOutProfessionalAccuracy, 1);
  assert.equal(evaluation.releaseReady, true);
});
