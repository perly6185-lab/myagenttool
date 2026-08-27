import assert from "node:assert/strict";
import test from "node:test";

import {
  createPrivateTutorGoldenCandidate,
  linkPrivateTutorGoldenCandidateMigration,
  listPrivateTutorGoldenCandidates,
  reviewPrivateTutorGoldenCandidate,
} from "../src/services/private-tutor-golden-candidates.mjs";

const CREATOR = { userId: "usr_creator", teamId: "team_a", role: "admin" };
const REVIEWER_A = { userId: "usr_review_a", teamId: "team_a", role: "admin" };
const REVIEWER_B = { userId: "usr_review_b", teamId: "team_a", role: "owner" };

test("a completed human review creates an immutable deidentified golden candidate", () => {
  const fx = fixture();
  const input = candidateInput({ classification: "content_defect" });
  const created = createPrivateTutorGoldenCandidate(fx.state, input, fx.options(CREATOR));
  assert.equal(created.ok, true);
  assert.equal(created.candidate.status, "in_review");
  assert.equal(created.candidate.targetChange, "content");
  assert.equal(created.candidate.promotionEligible, true);
  assert.equal(created.candidate.deidentification.passed, true);
  assert.equal(created.candidate.goldenArtifact.input.rawAnswer, input.deidentifiedAnswer);
  assert.equal("learnerId" in created.candidate, false);
  assert.equal(JSON.stringify(created.candidate.goldenArtifact).includes("lrn_a"), false);
  assert.equal(JSON.stringify(created.candidate.goldenArtifact).includes("pta_review"), false);
  input.deidentifiedAnswer = "mutated externally";
  assert.notEqual(fx.state.privateTutorGoldenCandidates[0].goldenArtifact.input.rawAnswer, input.deidentifiedAnswer);
  assert.match(created.candidate.candidateFingerprint, /^[a-f0-9]{64}$/);
});

test("candidate creation rejects direct identifiers before anything is persisted", () => {
  const fx = fixture();
  const result = createPrivateTutorGoldenCandidate(fx.state, candidateInput({
    deidentifiedAnswer: "Alice Student can be reached at learner@example.com or usr_private_1.",
  }), fx.options(CREATOR));
  assert.equal(result.status, 422);
  assert.equal(result.error, "private_tutor_golden_candidate_not_deidentified");
  assert.deepEqual(result.detected.sort(), ["account_identifier", "email", "learner_name"]);
  assert.equal(fx.state.privateTutorGoldenCandidates.length, 0);
  assert.equal(fx.state.privateTutorGoldenCandidateEvents.length, 0);
});

test("evaluator and rubric changes stay blocked until a matching completed migration is linked", () => {
  const fx = fixture();
  const created = createPrivateTutorGoldenCandidate(fx.state, candidateInput({ classification: "evaluator_defect" }), fx.options(CREATOR));
  assert.equal(created.candidate.status, "migration_required");
  const earlyReview = reviewPrivateTutorGoldenCandidate(fx.state, created.candidate.id, {
    decision: "approved",
    evidence: "Independent evaluation behavior review passed.",
  }, fx.options(REVIEWER_A));
  assert.equal(earlyReview.error, "private_tutor_golden_candidate_migration_required");

  const mismatch = linkPrivateTutorGoldenCandidateMigration(fx.state, created.candidate.id, {
    migrationId: "wrong-migration",
  }, { ...fx.options(REVIEWER_A), migrations: [] });
  assert.equal(mismatch.error, "private_tutor_golden_candidate_migration_mismatch");

  const migration = {
    id: "language-semantic-v2-to-v3",
    suite: "language-semantic",
    from: { evaluatorVersion: "2.0.0", contentPackageVersion: "2.0.0", rubricVersion: "2.0.0", profile: "causal-semantic-v2" },
    to: { evaluatorVersion: "3.0.0", contentPackageVersion: "2.0.0", rubricVersion: "2.0.0", profile: "causal-semantic-v3" },
    compatibility: "breaking",
    status: "completed",
  };
  const linked = linkPrivateTutorGoldenCandidateMigration(fx.state, created.candidate.id, {
    migrationId: migration.id,
  }, { ...fx.options(REVIEWER_A), migrations: [migration] });
  assert.equal(linked.ok, true);
  assert.equal(linked.candidate.status, "in_review");
  assert.equal(linked.candidate.migration.migrationId, migration.id);
  assert.equal(fx.state.privateTutorGoldenCandidates[0].migrationId, undefined, "candidate row remains immutable; the link is an event");
});

test("two independent reviewers approve a candidate while its creator and duplicate reviewers are blocked", () => {
  const fx = fixture();
  const created = createPrivateTutorGoldenCandidate(fx.state, candidateInput({ classification: "content_defect" }), fx.options(CREATOR));
  const selfReview = reviewPrivateTutorGoldenCandidate(fx.state, created.candidate.id, {
    decision: "approved",
    evidence: "Creator should not approve the candidate.",
  }, fx.options(CREATOR));
  assert.equal(selfReview.error, "private_tutor_golden_candidate_self_review_forbidden");

  const first = reviewPrivateTutorGoldenCandidate(fx.state, created.candidate.id, {
    decision: "approved",
    evidence: "The deidentified example and expected decision are correct.",
  }, fx.options(REVIEWER_A));
  assert.equal(first.candidate.status, "in_review");
  assert.equal(first.candidate.approvals, 1);
  const duplicate = reviewPrivateTutorGoldenCandidate(fx.state, created.candidate.id, {
    decision: "approved",
    evidence: "A repeated review must not count twice.",
  }, fx.options(REVIEWER_A));
  assert.equal(duplicate.error, "private_tutor_golden_candidate_duplicate_review");

  const second = reviewPrivateTutorGoldenCandidate(fx.state, created.candidate.id, {
    decision: "approved",
    evidence: "Second independent approval confirms the candidate.",
  }, fx.options(REVIEWER_B));
  assert.equal(second.candidate.status, "approved");
  assert.equal(second.candidate.approvals, 2);
  assert.equal(fx.state.privateTutorGoldenCandidateReviews.length, 2);
  assert.equal(fx.state.privateTutorGoldenCandidateEvents.filter((row) => row.type === "review_approved").length, 2);
});

test("exceptions are audit-only and candidate lists remain team-scoped", () => {
  const fx = fixture();
  const exception = createPrivateTutorGoldenCandidate(fx.state, candidateInput({ classification: "one_off_exception" }), fx.options(CREATOR));
  assert.equal(exception.candidate.status, "exception_only");
  assert.equal(exception.candidate.promotionEligible, false);
  const attemptedReview = reviewPrivateTutorGoldenCandidate(fx.state, exception.candidate.id, {
    decision: "approved",
    evidence: "Exceptions must not enter the golden set.",
  }, fx.options(REVIEWER_A));
  assert.equal(attemptedReview.error, "private_tutor_golden_candidate_not_promotable");
  assert.equal(listPrivateTutorGoldenCandidates(fx.state, { ownerTeamId: "team_a" }).length, 1);
  assert.equal(listPrivateTutorGoldenCandidates(fx.state, { ownerTeamId: "team_b" }).length, 0);
  assert.equal(listPrivateTutorGoldenCandidates(fx.state, { ownerTeamId: "team_a", status: "exception_only" }).length, 1);
});

function fixture() {
  let id = 0;
  let tick = 0;
  const state = {
    privateTutorLearners: [{ id: "lrn_a", ownerTeamId: "team_a", displayName: "Alice Student", status: "active" }],
    privateTutorAttempts: [{
      id: "pta_review",
      ownerTeamId: "team_a",
      learnerId: "lrn_a",
      contentPackageId: "language-causal-explanations-v1",
      contentPackageVersion: "2.0.0",
      subjectId: "language",
      questionRevisionId: "practice-language-cause-001-v2",
      responseKind: "answer",
      source: "screen",
      recognitionConfidence: null,
      normalizedAnswer: "plants grow because sunlight supplies energy",
      evaluation: {
        reviewStatus: "completed",
        evaluatorVersion: "2.0.0",
        contentPackageVersion: "2.0.0",
        rubricVersion: "2.0.0",
        profile: "causal-semantic-v2",
      },
    }],
    privateTutorEvaluationReviews: [{
      id: "pter_review",
      ownerTeamId: "team_a",
      learnerId: "lrn_a",
      attemptId: "pta_review",
      reviewerId: "usr_human_reviewer",
      automated: {
        correct: false,
        evidenceEligible: false,
        judgementReason: "semantic_review_required",
        evidenceTier: "practice_only",
        decisionFingerprint: "a".repeat(64),
      },
      decision: "confirmed_correct",
      finalCorrect: true,
      finalEvidenceEligible: true,
    }],
    privateTutorGoldenCandidates: [],
    privateTutorGoldenCandidateReviews: [],
    privateTutorGoldenCandidateEvents: [],
  };
  const now = () => new Date(Date.UTC(2026, 7, 27, 0, 0, tick++)).toISOString();
  const nextId = (prefix) => `${prefix}_${++id}`;
  return { state, options: (actor) => ({ actor, now, nextId }) };
}

function candidateInput(overrides = {}) {
  return {
    evaluationReviewId: "pter_review",
    classification: "content_defect",
    deidentifiedAnswer: "Plants grow because sunlight supplies energy.",
    rationale: "The reviewed answer should become a regression candidate without learner identifiers.",
    expectedRequiresReview: false,
    ...overrides,
  };
}
