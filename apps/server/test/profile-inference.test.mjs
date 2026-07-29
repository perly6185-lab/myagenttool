import assert from "node:assert/strict";
import test from "node:test";

import {
  PROFILE_CLASSIFICATION_VOCABULARY,
  PROFILE_INFERENCE_LIMITS,
  ProfileInferenceInputError,
  autoApplicableProfileCandidates,
  inferProfileCandidates,
} from "../src/services/profile-inference.mjs";

const sanitizedInput = (features) => ({
  schema: "local-sanitized-profile-features/v1",
  sanitized: true,
  features,
});

test("infers bounded candidates with confidence and generated reasons", () => {
  const result = inferProfileCandidates(sanitizedInput([
    { key: "technical_activity", score: 0.9, observations: 8 },
    { key: "planning_workflow", score: 0.7, observations: 5 },
  ]));

  assert.equal(result.schema, "explainable-profile-candidates/v1");
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates[0], {
    classification: "interest.technology",
    confidence: 0.9,
    confidenceLevel: "high",
    reason: "本地聚合特征显示技术主题活动占比较高（8 次聚合观测）",
    evidence: {
      feature: "technical_activity",
      score: 0.9,
      observations: 8,
    },
    autoApplyEligible: true,
    status: "auto_applicable",
  });
  assert.equal(typeof result.candidates[1].reason, "string");
  assert.ok(result.candidates[1].reason.length > 0);
  assert.ok(result.candidates.every((candidate) =>
    PROFILE_CLASSIFICATION_VOCABULARY.includes(candidate.classification)));
});

test("never reads unauthorized original text", () => {
  let originalRead = false;
  const input = sanitizedInput([
    { key: "product_activity", score: 0.8, observations: 6 },
  ]);
  Object.defineProperty(input, "rawText", {
    enumerable: true,
    get() {
      originalRead = true;
      throw new Error("raw original must not be read");
    },
  });

  assert.throws(
    () => inferProfileCandidates(input),
    (error) => error instanceof ProfileInferenceInputError
      && error.code === "unauthorized_input_field",
  );
  assert.equal(originalRead, false);

  let excerptRead = false;
  const feature = { key: "product_activity", score: 0.8, observations: 6 };
  Object.defineProperty(feature, "rawExcerpt", {
    enumerable: true,
    get() {
      excerptRead = true;
      throw new Error("raw excerpt must not be read");
    },
  });
  assert.throws(
    () => inferProfileCandidates(sanitizedInput([feature])),
    (error) => error instanceof ProfileInferenceInputError
      && error.code === "unauthorized_feature_field",
  );
  assert.equal(excerptRead, false);
});

test("rejects unsanitized inputs and features outside the closed vocabulary", () => {
  assert.throws(
    () => inferProfileCandidates({
      schema: "local-sanitized-profile-features/v1",
      sanitized: false,
      features: [],
    }),
    (error) => error instanceof ProfileInferenceInputError
      && error.code === "unsanitized_input",
  );
  assert.throws(
    () => inferProfileCandidates(sanitizedInput([
      { key: "political_belief", score: 0.9, observations: 10 },
    ])),
    (error) => error instanceof ProfileInferenceInputError
      && error.code === "unknown_feature",
  );
});

test("caps output size even when a caller asks for more candidates", () => {
  const features = [
    "technical_activity",
    "product_activity",
    "content_creation_activity",
    "planning_workflow",
    "collaboration_workflow",
    "concise_response_preference",
    "detailed_response_preference",
  ].map((key, index) => ({ key, score: 1 - index * 0.05, observations: 10 }));

  const result = inferProfileCandidates(sanitizedInput(features), { maxCandidates: 100 });

  assert.equal(result.candidates.length, PROFILE_INFERENCE_LIMITS.maxCandidates);
  assert.equal(result.truncated, true);
});

test("low-confidence conclusions require review and cannot pass the auto-apply gate", () => {
  const result = inferProfileCandidates(sanitizedInput([
    { key: "collaboration_workflow", score: 0.95, observations: 2 },
    { key: "detailed_response_preference", score: 0.8, observations: 5 },
  ]));
  const low = result.candidates.find((candidate) =>
    candidate.classification === "work_style.collaboration");

  assert.equal(low.confidence, 0.38);
  assert.equal(low.confidenceLevel, "low");
  assert.equal(low.autoApplyEligible, false);
  assert.equal(low.status, "needs_review");
  assert.deepEqual(
    autoApplicableProfileCandidates(result).map((candidate) => candidate.classification),
    ["communication.detailed"],
  );
  assert.deepEqual(autoApplicableProfileCandidates({
    schema: result.schema,
    autoApplyThreshold: 0.1,
    candidates: [{
      classification: "work_style.collaboration",
      confidence: 0.38,
      autoApplyEligible: true,
    }],
  }), [], "the consumer gate independently enforces the confidence floor");
  assert.throws(
    () => inferProfileCandidates(sanitizedInput([]), { autoApplyThreshold: 0.5 }),
    (error) => error instanceof ProfileInferenceInputError
      && error.code === "invalid_auto_apply_threshold",
  );
});
