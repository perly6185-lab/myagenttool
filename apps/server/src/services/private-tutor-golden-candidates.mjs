import { createHash } from "node:crypto";

import {
  privateTutorEvaluationMigrations,
  samePrivateTutorEvaluationVersion,
} from "./private-tutor-evaluation-migrations.mjs";

export const PRIVATE_TUTOR_GOLDEN_CANDIDATE_SCHEMA_VERSION = 1;
export const PRIVATE_TUTOR_GOLDEN_CANDIDATE_REQUIRED_APPROVALS = 2;

const CLASSIFICATIONS = new Set([
  "evaluator_defect",
  "rubric_defect",
  "content_defect",
  "transcription_issue",
  "one_off_exception",
]);
const PROMOTABLE_CLASSIFICATIONS = new Set(["evaluator_defect", "rubric_defect", "content_defect"]);
const MIGRATION_CLASSIFICATIONS = new Set(["evaluator_defect", "rubric_defect"]);
const REVIEW_DECISIONS = new Set(["approved", "rejected"]);
const SCORE_BANDS = new Set(["insufficient", "developing", "proficient"]);
const SUBJECT_SUITES = Object.freeze({
  math: "math-step",
  language: "language-semantic",
  language_learning: "language-semantic",
  conceptual: "conceptual-rubric",
  conceptual_studies: "conceptual-rubric",
});

export function createPrivateTutorGoldenCandidate(state, input, {
  actor,
  now,
  nextId,
} = {}) {
  const evaluationReviewId = String(input?.evaluationReviewId ?? "").trim();
  const classification = String(input?.classification ?? "").trim();
  const deidentifiedAnswer = String(input?.deidentifiedAnswer ?? "").trim();
  const rationale = String(input?.rationale ?? "").trim();
  if (!evaluationReviewId || !CLASSIFICATIONS.has(classification)
    || !deidentifiedAnswer || deidentifiedAnswer.length > 2_000
    || rationale.length < 8 || rationale.length > 1_000) {
    return invalid("invalid_private_tutor_golden_candidate");
  }

  const sourceReview = state.privateTutorEvaluationReviews.find((row) =>
    row.id === evaluationReviewId && row.ownerTeamId === actor?.teamId);
  if (!sourceReview) return notFound();
  const attempt = state.privateTutorAttempts.find((row) =>
    row.id === sourceReview.attemptId
    && row.learnerId === sourceReview.learnerId
    && row.ownerTeamId === actor?.teamId);
  if (!attempt || attempt.evaluation?.reviewStatus !== "completed") {
    return conflict("private_tutor_golden_candidate_source_not_final");
  }
  const learner = state.privateTutorLearners.find((row) => row.id === sourceReview.learnerId);
  const deidentification = inspectDeidentification({
    deidentifiedAnswer,
    rationale,
    learnerDisplayName: learner?.displayName,
  });
  if (!deidentification.passed) {
    return {
      ok: false,
      status: 422,
      error: "private_tutor_golden_candidate_not_deidentified",
      detected: deidentification.detected,
    };
  }

  const score = optionalScore(input?.expectedScore);
  const scoreBand = input?.expectedScoreBand == null ? null : String(input.expectedScoreBand).trim();
  if (score === undefined || (scoreBand !== null && !SCORE_BANDS.has(scoreBand))) {
    return invalid("invalid_private_tutor_golden_candidate_expectation");
  }
  const suite = SUBJECT_SUITES[attempt.subjectId ?? attempt.evaluation?.subjectId];
  if (!suite) return conflict("private_tutor_golden_candidate_subject_not_supported");
  const createdAt = now();
  const sourceVersions = evaluationVersionDescriptor(attempt);
  const proposedExpected = {
    correct: sourceReview.finalCorrect,
    evidenceEligible: sourceReview.finalEvidenceEligible,
    requiresReview: input?.expectedRequiresReview === true,
    score: score ?? null,
    scoreBand,
  };
  const goldenArtifact = {
    schemaVersion: PRIVATE_TUTOR_GOLDEN_CANDIDATE_SCHEMA_VERSION,
    suite,
    subjectId: attempt.subjectId ?? attempt.evaluation?.subjectId,
    questionRevisionId: attempt.questionRevisionId,
    versions: sourceVersions,
    input: {
      rawAnswer: deidentifiedAnswer,
      responseKind: attempt.responseKind,
      source: attempt.source,
      recognitionConfidence: attempt.recognitionConfidence ?? null,
    },
    expected: proposedExpected,
  };
  const candidateFingerprint = fingerprint({ classification, goldenArtifact });
  if (state.privateTutorGoldenCandidates.some((row) =>
    row.ownerTeamId === actor.teamId && row.candidateFingerprint === candidateFingerprint)) {
    return conflict("private_tutor_golden_candidate_duplicate");
  }
  const candidate = {
    id: nextId("ptgc"),
    schemaVersion: PRIVATE_TUTOR_GOLDEN_CANDIDATE_SCHEMA_VERSION,
    ownerTeamId: actor.teamId,
    learnerId: sourceReview.learnerId,
    sourceEvaluationReviewId: sourceReview.id,
    sourceAttemptId: attempt.id,
    sourceAnswerFingerprint: fingerprint(attempt.normalizedAnswer ?? ""),
    sourceDecisionFingerprint: sourceReview.automated.decisionFingerprint,
    classification,
    targetChange: targetChangeFor(classification),
    promotionEligible: PROMOTABLE_CLASSIFICATIONS.has(classification),
    migrationRequired: MIGRATION_CLASSIFICATIONS.has(classification),
    suite,
    rationale,
    proposedExpected,
    goldenArtifact,
    candidateFingerprint,
    deidentification,
    createdBy: actor.userId,
    createdAt,
  };
  state.privateTutorGoldenCandidates.unshift(candidate);
  state.privateTutorGoldenCandidateEvents.unshift({
    id: nextId("ptge"),
    ownerTeamId: candidate.ownerTeamId,
    learnerId: candidate.learnerId,
    candidateId: candidate.id,
    type: "candidate_created",
    actorId: actor.userId,
    details: { classification, candidateFingerprint },
    at: createdAt,
  });
  return { ok: true, candidate: privateTutorGoldenCandidateView(state, candidate) };
}

export function linkPrivateTutorGoldenCandidateMigration(state, candidateId, input, {
  actor,
  now,
  nextId,
  migrations = privateTutorEvaluationMigrations,
} = {}) {
  const candidate = findCandidate(state, candidateId, actor?.teamId);
  if (!candidate) return notFound();
  if (!candidate.migrationRequired) return conflict("private_tutor_golden_candidate_migration_not_required");
  if (linkedMigrationEvent(state, candidate.id)) return conflict("private_tutor_golden_candidate_migration_already_linked");
  if (candidateReviews(state, candidate.id).length) return conflict("private_tutor_golden_candidate_review_already_started");
  const migrationId = String(input?.migrationId ?? "").trim();
  const migration = migrations.find((row) => row.id === migrationId);
  if (!migration || migration.suite !== candidate.suite
    || !samePrivateTutorEvaluationVersion(migration.from, candidate.goldenArtifact.versions)
    || migration.status !== "completed") {
    return conflict("private_tutor_golden_candidate_migration_mismatch");
  }
  const event = {
    id: nextId("ptge"),
    ownerTeamId: candidate.ownerTeamId,
    learnerId: candidate.learnerId,
    candidateId: candidate.id,
    type: "migration_linked",
    actorId: actor.userId,
    details: {
      migrationId: migration.id,
      to: structuredClone(migration.to),
      compatibility: migration.compatibility,
    },
    at: now(),
  };
  state.privateTutorGoldenCandidateEvents.unshift(event);
  return { ok: true, candidate: privateTutorGoldenCandidateView(state, candidate) };
}

export function reviewPrivateTutorGoldenCandidate(state, candidateId, input, {
  actor,
  now,
  nextId,
} = {}) {
  const candidate = findCandidate(state, candidateId, actor?.teamId);
  if (!candidate) return notFound();
  const decision = String(input?.decision ?? "").trim();
  const evidence = String(input?.evidence ?? "").trim();
  if (!REVIEW_DECISIONS.has(decision) || evidence.length < 8 || evidence.length > 1_000) {
    return invalid("invalid_private_tutor_golden_candidate_review");
  }
  if (!candidate.promotionEligible) return conflict("private_tutor_golden_candidate_not_promotable");
  const status = candidateStatus(state, candidate);
  if (status === "migration_required") return conflict("private_tutor_golden_candidate_migration_required");
  if (status !== "in_review") return conflict("private_tutor_golden_candidate_not_reviewable");
  if (candidate.createdBy === actor.userId) return conflict("private_tutor_golden_candidate_self_review_forbidden");
  if (candidateReviews(state, candidate.id).some((row) => row.reviewerId === actor.userId)) {
    return conflict("private_tutor_golden_candidate_duplicate_review");
  }
  const learner = state.privateTutorLearners.find((row) => row.id === candidate.learnerId);
  const deidentification = inspectDeidentification({
    deidentifiedAnswer: evidence,
    rationale: "review evidence",
    learnerDisplayName: learner?.displayName,
  });
  if (!deidentification.passed) {
    return { ok: false, status: 422, error: "private_tutor_golden_candidate_review_not_deidentified", detected: deidentification.detected };
  }
  const reviewedAt = now();
  const review = {
    id: nextId("ptgr"),
    ownerTeamId: candidate.ownerTeamId,
    learnerId: candidate.learnerId,
    candidateId: candidate.id,
    reviewerId: actor.userId,
    decision,
    evidence,
    reviewedAt,
  };
  state.privateTutorGoldenCandidateReviews.unshift(review);
  state.privateTutorGoldenCandidateEvents.unshift({
    id: nextId("ptge"),
    ownerTeamId: candidate.ownerTeamId,
    learnerId: candidate.learnerId,
    candidateId: candidate.id,
    type: decision === "approved" ? "review_approved" : "review_rejected",
    actorId: actor.userId,
    details: { reviewId: review.id, evidenceFingerprint: fingerprint(evidence) },
    at: reviewedAt,
  });
  return {
    ok: true,
    review: goldenCandidateReviewView(review),
    candidate: privateTutorGoldenCandidateView(state, candidate),
  };
}

export function listPrivateTutorGoldenCandidates(state, {
  ownerTeamId,
  status = null,
  limit = 50,
} = {}) {
  const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  return state.privateTutorGoldenCandidates
    .filter((candidate) => candidate.ownerTeamId === ownerTeamId)
    .map((candidate) => privateTutorGoldenCandidateView(state, candidate))
    .filter((candidate) => !status || candidate.status === status)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, boundedLimit);
}

export function privateTutorGoldenCandidateView(state, candidate) {
  const reviews = candidateReviews(state, candidate.id).map(goldenCandidateReviewView);
  const migrationEvent = linkedMigrationEvent(state, candidate.id);
  return {
    id: candidate.id,
    schemaVersion: candidate.schemaVersion,
    sourceEvaluationReviewId: candidate.sourceEvaluationReviewId,
    classification: candidate.classification,
    targetChange: candidate.targetChange,
    promotionEligible: candidate.promotionEligible,
    migrationRequired: candidate.migrationRequired,
    migration: migrationEvent ? structuredClone(migrationEvent.details) : null,
    suite: candidate.suite,
    rationale: candidate.rationale,
    proposedExpected: structuredClone(candidate.proposedExpected),
    goldenArtifact: structuredClone(candidate.goldenArtifact),
    candidateFingerprint: candidate.candidateFingerprint,
    deidentification: structuredClone(candidate.deidentification),
    createdBy: candidate.createdBy,
    createdAt: candidate.createdAt,
    status: candidateStatus(state, candidate),
    approvals: reviews.filter((row) => row.decision === "approved").length,
    requiredApprovals: PRIVATE_TUTOR_GOLDEN_CANDIDATE_REQUIRED_APPROVALS,
    reviews,
  };
}

function candidateStatus(state, candidate) {
  if (!candidate.promotionEligible) return "exception_only";
  if (candidate.migrationRequired && !linkedMigrationEvent(state, candidate.id)) return "migration_required";
  const reviews = candidateReviews(state, candidate.id);
  if (reviews.some((row) => row.decision === "rejected")) return "rejected";
  if (reviews.filter((row) => row.decision === "approved").length >= PRIVATE_TUTOR_GOLDEN_CANDIDATE_REQUIRED_APPROVALS) return "approved";
  return "in_review";
}

function inspectDeidentification({ deidentifiedAnswer, rationale, learnerDisplayName }) {
  const text = `${deidentifiedAnswer}\n${rationale}`;
  const detected = [];
  if (learnerDisplayName && String(learnerDisplayName).trim().length >= 2
    && text.toLocaleLowerCase().includes(String(learnerDisplayName).trim().toLocaleLowerCase())) detected.push("learner_name");
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) detected.push("email");
  if (/(?:\+?\d[\d\s-]{6,}\d)/.test(text)) detected.push("phone_or_long_number");
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(text)) detected.push("url");
  if (/(?:[A-Za-z]:\\|\/(?:Users|home)\/)/.test(text)) detected.push("local_path");
  if (/\b(?:usr|lrn|team|pta|pter)_[a-z0-9_-]+\b/i.test(text)) detected.push("account_identifier");
  if (/\b(?:bearer|api[_-]?key|access[_-]?token|password)\b/i.test(text)) detected.push("credential_marker");
  return {
    passed: detected.length === 0,
    policyVersion: 1,
    detected: [...new Set(detected)],
  };
}

function evaluationVersionDescriptor(attempt) {
  return {
    evaluatorVersion: attempt.evaluation?.evaluatorVersion ?? null,
    contentPackageVersion: attempt.evaluation?.contentPackageVersion ?? attempt.contentPackageVersion ?? null,
    rubricVersion: attempt.evaluation?.rubricVersion ?? null,
    profile: attempt.evaluation?.profile ?? null,
  };
}

function targetChangeFor(classification) {
  if (classification === "evaluator_defect") return "evaluator";
  if (classification === "rubric_defect") return "rubric";
  if (classification === "content_defect") return "content";
  return "none";
}

function optionalScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= 1 ? Number(score.toFixed(4)) : undefined;
}

function findCandidate(state, candidateId, ownerTeamId) {
  return state.privateTutorGoldenCandidates.find((row) => row.id === candidateId && row.ownerTeamId === ownerTeamId) ?? null;
}

function candidateReviews(state, candidateId) {
  return state.privateTutorGoldenCandidateReviews
    .filter((row) => row.candidateId === candidateId)
    .sort((left, right) => String(left.reviewedAt).localeCompare(String(right.reviewedAt)));
}

function linkedMigrationEvent(state, candidateId) {
  return state.privateTutorGoldenCandidateEvents.find((row) => row.candidateId === candidateId && row.type === "migration_linked") ?? null;
}

function goldenCandidateReviewView(review) {
  return {
    id: review.id,
    candidateId: review.candidateId,
    reviewerId: review.reviewerId,
    decision: review.decision,
    evidence: review.evidence,
    reviewedAt: review.reviewedAt,
  };
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function invalid(error) {
  return { ok: false, status: 400, error };
}

function notFound() {
  return { ok: false, status: 404, error: "private_tutor_golden_candidate_not_found" };
}

function conflict(error) {
  return { ok: false, status: 409, error };
}
