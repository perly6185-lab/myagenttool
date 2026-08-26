import assert from "node:assert/strict";
import test from "node:test";

import {
  listPrivateTutorEvaluationReviewQueue,
  recomputePrivateTutorMasteryEvidence,
  resolvePrivateTutorEvaluationReview,
} from "../src/services/private-tutor-evaluation-review.mjs";

const FINGERPRINT = "a".repeat(64);
const ACTOR = { userId: "usr_reviewer", teamId: "team_a", role: "admin" };

test("evaluation review queue is team-scoped and exposes automated provenance", () => {
  const state = fixture();
  state.privateTutorAttempts.push(reviewableAttempt({ id: "pta_other", ownerTeamId: "team_b", learnerId: "lrn_other" }));
  const queue = listPrivateTutorEvaluationReviewQueue(state, { ownerTeamId: "team_a" });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].attemptId, "pta_review");
  assert.equal(queue[0].automatedCorrect, true);
  assert.equal(queue[0].automatedEvidenceEligible, false);
  assert.equal(queue[0].evaluation.decisionFingerprint, FINGERPRINT);
});

test("a correct human resolution is idempotent and becomes mastery evidence exactly once", () => {
  const state = fixture();
  let counter = 0;
  const options = { actor: ACTOR, now: () => "2026-08-26T10:00:00.000Z", nextId: (prefix) => `${prefix}_${++counter}` };
  const input = {
    idempotencyKey: "review-once",
    decisionFingerprint: FINGERPRINT,
    decision: "confirmed_correct",
    reasonCode: "transcription_verified",
    note: "The recording and transcript express the complete causal relation.",
  };
  const resolved = resolvePrivateTutorEvaluationReview(state, "pta_review", input, options);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.review.finalEvidenceEligible, true);
  assert.equal(resolved.attempt.evaluation.reviewStatus, "completed");
  assert.equal(resolved.attempt.evidenceTier, "human_reviewed");

  const recomputed = recomputePrivateTutorMasteryEvidence(state, state.privateTutorLearners[0], {
    contentPackageId: "language-causal-explanations-v1",
    reviewId: resolved.review.id,
    now: options.now,
  });
  assert.equal(recomputed.changed, true);
  assert.deepEqual(recomputed.snapshot.knowledge[0], {
    id: "language-cause-effect",
    mastery: 0.62,
    level: "learning",
    evidenceCount: 1,
  });

  const replayed = resolvePrivateTutorEvaluationReview(state, "pta_review", input, options);
  assert.equal(replayed.ok, true);
  assert.equal(replayed.replayed, true);
  assert.equal(state.privateTutorEvaluationReviews.length, 1);
});

test("review conflicts fail closed and an incorrect conclusion remains practice-only", () => {
  const state = fixture();
  const options = { actor: ACTOR, now: () => "2026-08-26T10:00:00.000Z", nextId: () => "pter_1" };
  const stale = resolvePrivateTutorEvaluationReview(state, "pta_review", {
    idempotencyKey: "stale",
    decisionFingerprint: "b".repeat(64),
    decision: "confirmed_correct",
    reasonCode: "semantic_interpretation",
  }, options);
  assert.equal(stale.status, 409);
  assert.equal(stale.error, "private_tutor_evaluation_review_stale_decision");

  const resolved = resolvePrivateTutorEvaluationReview(state, "pta_review", {
    idempotencyKey: "incorrect",
    decisionFingerprint: FINGERPRINT,
    decision: "confirmed_incorrect",
    reasonCode: "semantic_interpretation",
  }, options);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.attempt.correct, false);
  assert.equal(resolved.attempt.evidenceEligible, false);
  const recomputed = recomputePrivateTutorMasteryEvidence(state, state.privateTutorLearners[0], {
    contentPackageId: "language-causal-explanations-v1",
    reviewId: resolved.review.id,
    now: options.now,
  });
  assert.equal(recomputed.snapshot.knowledge[0].mastery, null);
  assert.equal(recomputed.snapshot.knowledge[0].evidenceCount, 0);
});

test("diagnostic mastery is rebuilt from eligible final decisions before later practice", () => {
  const state = fixture();
  state.privateTutorAttempts[0] = {
    ...state.privateTutorAttempts[0],
    assessmentId: "pas_1",
    context: "diagnostic",
    correct: true,
    evidenceEligible: true,
    evaluation: { ...state.privateTutorAttempts[0].evaluation, reviewStatus: "completed", requiresReview: false },
  };
  state.privateTutorAssessments.push({
    id: "pas_1",
    learnerId: "lrn_a",
    contentPackageId: "language-causal-explanations-v1",
    status: "completed",
    completedAt: "2026-08-26T09:01:00.000Z",
    answerSummaries: [{
      attemptId: "pta_review",
      questionRevisionId: "diag-language-cause-001-v1",
      knowledgeId: "language-cause-effect",
      difficulty: 2,
      correct: false,
      responseKind: "answer",
    }],
    result: { knowledge: [] },
  });
  state.privateTutorAttempts.push({
    ...reviewableAttempt({ id: "pta_practice" }),
    evaluation: { reviewStatus: "not_required" },
    correct: false,
    evidenceEligible: true,
    createdAt: "2026-08-26T09:02:00.000Z",
  });
  const recomputed = recomputePrivateTutorMasteryEvidence(state, state.privateTutorLearners[0], {
    contentPackageId: "language-causal-explanations-v1",
    reviewId: "pter_1",
    now: () => "2026-08-26T10:00:00.000Z",
  });
  assert.equal(state.privateTutorAssessments[0].result.knowledge[0].mastery, 0.85);
  assert.equal(recomputed.snapshot.knowledge[0].mastery, 0.8);
  assert.equal(recomputed.snapshot.knowledge[0].evidenceCount, 2);
});

function fixture() {
  return {
    privateTutorLearners: [{
      id: "lrn_a",
      ownerTeamId: "team_a",
      displayName: "Learner A",
      status: "active",
      activePackageId: "language-causal-explanations-v1",
    }],
    privateTutorAttempts: [reviewableAttempt()],
    privateTutorEvaluationReviews: [],
    privateTutorAssessments: [],
    privateTutorSnapshots: [{
      id: "pts_1",
      learnerId: "lrn_a",
      contentPackageId: "language-causal-explanations-v1",
      contentPackageVersion: "2.0.0",
      packageStates: [],
      revision: 1,
      knowledge: [{ id: "language-cause-effect", mastery: null, level: "unknown", evidenceCount: 0 }],
      updatedAt: "2026-08-26T09:00:00.000Z",
    }],
    privateTutorContentPackages: [],
    privateTutorModules: [],
    privateTutorTopics: [],
    privateTutorKnowledgeComponents: [],
    privateTutorSubjectPlugins: [],
  };
}

function reviewableAttempt(overrides = {}) {
  return {
    id: "pta_review",
    ownerTeamId: "team_a",
    learnerId: "lrn_a",
    contentPackageId: "language-causal-explanations-v1",
    contentPackageVersion: "2.0.0",
    subjectId: "language",
    knowledgeId: "language-cause-effect",
    questionRevisionId: "practice-language-cause-001-v2",
    correct: true,
    independent: true,
    usedHint: false,
    source: "voice_confirmed",
    recognitionConfidence: 0.8,
    responseKind: "answer",
    normalizedAnswer: "plants grow because sunlight supplies energy",
    judgementReason: "semantic_speech_review_required",
    evidenceEligible: false,
    evidenceTier: "practice_only",
    evaluation: {
      reviewStatus: "required",
      requiresReview: true,
      decisionFingerprint: FINGERPRINT,
    },
    durationSeconds: 20,
    createdAt: "2026-08-26T09:00:00.000Z",
    ...overrides,
  };
}
