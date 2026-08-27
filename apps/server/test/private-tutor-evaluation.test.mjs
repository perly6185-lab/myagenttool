import assert from "node:assert/strict";
import test from "node:test";
import { finalizePrivateTutorEvaluation, PRIVATE_TUTOR_EVALUATION_SCHEMA_VERSION } from "../src/services/private-tutor-evaluation-contract.mjs";
import { runConceptualRubricConsistencyReplay, runLanguageCausalSemanticGoldenReplay, runMathLinearStepsGoldenReplay } from "../src/services/private-tutor-evaluation-replay.mjs";
import { judgePrivateTutorAnswer } from "../src/services/private-tutor-assessment.mjs";
import { createPrivateTutorPackageRegistry, seedPrivateTutorContentPackages } from "../src/services/private-tutor-package-registry.mjs";
import { mathSubjectPlugin, MATH_STEP_EVALUATOR_VERSION } from "../src/services/plugins/math-plugin.mjs";

test("the versioned evaluation contract records provenance and produces stable fingerprints", () => {
  const state = {};
  seedPrivateTutorContentPackages(state, "2026-08-26T00:00:00.000Z");
  const registry = createPrivateTutorPackageRegistry();
  const question = registry.getPackage("demo-math-foundations-v1").knowledgeComponents
    .find((item) => item.id === "balance").dailyQuestions.find((item) => item.kind === "math_steps");
  const input = { rawAnswer: "x=8-3\nx=5", responseKind: "answer", source: "screen" };
  const first = judgePrivateTutorAnswer(question.id, input, state, "demo-math-foundations-v1");
  const second = judgePrivateTutorAnswer(question.id, input, state, "demo-math-foundations-v1");

  assert.equal(first.correct, true);
  assert.equal(first.evidenceEligible, true);
  assert.equal(first.evaluation.schemaVersion, PRIVATE_TUTOR_EVALUATION_SCHEMA_VERSION);
  assert.equal(first.evaluation.evaluatorId, "private-tutor:math");
  assert.equal(first.evaluation.evaluatorVersion, "2.0.0");
  assert.equal(first.evaluation.rubricVersion, "1.0.0");
  assert.equal(first.evaluation.contentRevisionId, question.id);
  assert.equal(first.evaluation.confidence, 1);
  assert.equal(first.evaluation.reviewStatus, "not_required");
  assert.match(first.evaluation.decisionFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.evaluation.decisionFingerprint, second.evaluation.decisionFingerprint);
});

test("an uncalibrated evaluator result fails closed into review-only feedback", () => {
  const finalized = finalizePrivateTutorEvaluation({
    plugin: { subjectId: "language_learning", version: "2.0.0" },
    question: { id: "semantic-v1", contentPackageId: "language-v1", contentPackageVersion: "1.0.0" },
    result: {
      accepted: true,
      correct: true,
      responseKind: "answer",
      normalizedAnswer: "answer",
      reason: "semantic_model_match",
      evidenceEligible: true,
      evidenceTier: "semantic_model_uncalibrated",
    },
  });
  assert.equal(finalized.evidenceEligible, false);
  assert.equal(finalized.evaluation.confidence, null);
  assert.equal(finalized.evaluation.requiresReview, true);
  assert.equal(finalized.evaluation.reviewStatus, "required");
});

test("math step v2 accepts equivalent paths and identifies the first invalid transformation", () => {
  const registry = createPrivateTutorPackageRegistry();
  const question = registry.getPackage("demo-math-foundations-v1").knowledgeComponents
    .find((item) => item.id === "balance").dailyQuestions.find((item) => item.kind === "math_steps");
  assert.equal(question.mathContract.profile, MATH_STEP_EVALUATOR_VERSION);

  const alternative = mathSubjectPlugin.evaluator({ rawAnswer: "x=8-3\nx=5", responseKind: "answer" }, question);
  assert.equal(alternative.correct, true);
  assert.equal(alternative.evaluation.steps[0].matchedAuthoredForm, false);
  assert.equal(alternative.evaluation.steps[0].classification, "solution_reached");

  const invalid = mathSubjectPlugin.evaluator({ rawAnswer: "x+3-3=8\nx=5", responseKind: "answer" }, question);
  assert.equal(invalid.correct, false);
  assert.equal(invalid.evidenceEligible, true);
  assert.equal(invalid.evaluation.firstIncorrectStep, 0);
  assert.equal(invalid.evaluation.steps[0].classification, "single_side_change");
  assert.match(invalid.evaluation.explanation, /只改变等式一边/);

  const unsupported = mathSubjectPlugin.evaluator({ rawAnswer: "x*x=25\nx=5", responseKind: "answer" }, question);
  assert.equal(unsupported.correct, false);
  assert.equal(unsupported.evidenceEligible, false);
  assert.equal(unsupported.evidenceTier, "practice_only");
  assert.equal(unsupported.evaluation.steps[0].classification, "nonlinear_expression");
});

test("the versioned math golden replay has zero false positives and zero evidence leaks", () => {
  const replay = runMathLinearStepsGoldenReplay();
  assert.equal(replay.setVersion, "1.0.0");
  assert.equal(replay.total, 14);
  assert.equal(replay.matchedCount, replay.total);
  assert.equal(replay.falsePositiveCount, 0);
  assert.equal(replay.falseNegativeCount, 0);
  assert.equal(replay.evidenceLeakCount, 0);
  assert.equal(replay.passed, true);
  assert.deepEqual(replay.failed, []);
});

test("the calibrated language golden replay rejects negation and reversed causality without leaking evidence", () => {
  const replay = runLanguageCausalSemanticGoldenReplay();
  assert.equal(replay.setVersion, "1.0.0");
  assert.equal(replay.total, 19);
  assert.equal(replay.matchedCount, replay.total);
  assert.equal(replay.falsePositiveCount, 0);
  assert.equal(replay.falseNegativeCount, 0);
  assert.equal(replay.evidenceLeakCount, 0);
  assert.equal(replay.passed, true);
  assert.deepEqual(replay.failed, []);
});

test("the anchored conceptual rubric is repeatable and agrees with every scoring anchor", () => {
  const replay = runConceptualRubricConsistencyReplay();
  assert.equal(replay.setVersion, "1.0.0");
  assert.equal(replay.total, 11);
  assert.equal(replay.matchedCount, replay.total);
  assert.equal(replay.falsePositiveCount, 0);
  assert.equal(replay.falseNegativeCount, 0);
  assert.equal(replay.evidenceLeakCount, 0);
  assert.equal(replay.anchorAgreementCount, replay.total);
  assert.equal(replay.anchorAgreementRate, 1);
  assert.equal(replay.repeatableCount, replay.total);
  assert.equal(replay.repeatabilityRate, 1);
  assert.equal(replay.passed, true);
  assert.deepEqual(replay.failed, []);
});

test("a malformed accepted plugin decision is rejected before it reaches evidence", () => {
  const state = {};
  seedPrivateTutorContentPackages(state, "2026-08-26T00:00:00.000Z");
  state.privateTutorContentPackages.push({
    id: "malformed-evaluator-package-v1",
    name: "Malformed evaluator fixture",
    subjectId: "malformed_evaluator",
    domain: "testing",
    sourceType: "professional_skill",
    version: "1.0.0",
    license: "internal-test",
    targetAudience: {},
    evaluationCapabilities: { deterministicGrading: true },
    modules: [],
    knowledgeComponents: [{
      id: "malformed-kc",
      name: "Malformed knowledge",
      prerequisiteKnowledgeIds: [],
      dailyQuestions: [{
        id: "malformed-question-v1",
        questionId: "malformed-question",
        knowledgeId: "malformed-kc",
        difficulty: 1,
        kind: "choice",
        prompt: "Malformed evaluator output",
        options: [{ id: "a", label: "A" }],
        expectedChoice: "a",
      }],
    }],
  });
  state.privateTutorSubjectPlugins.push({
    subjectId: "malformed_evaluator",
    version: "1.0.0",
    visualTemplates: [],
    getCapabilities: () => ({ deterministicGrading: true }),
    evaluator: () => ({ accepted: true, responseKind: "answer", reason: "missing_correct" }),
  });

  assert.deepEqual(
    judgePrivateTutorAnswer("malformed-question-v1", { rawAnswer: "a", responseKind: "answer" }, state, "malformed-evaluator-package-v1"),
    { accepted: false, error: "private_tutor_subject_plugin_failed" },
  );
});
