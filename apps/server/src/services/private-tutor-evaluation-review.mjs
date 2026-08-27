import { createHash } from "node:crypto";

import { buildDiagnosticResult } from "./private-tutor-assessment.mjs";
import { privateTutorPackageRegistryFromState } from "./private-tutor-package-registry.mjs";

const REVIEW_DECISIONS = new Set(["confirmed_correct", "confirmed_incorrect"]);
const REVIEW_REASON_CODES = new Set([
  "transcription_verified",
  "semantic_interpretation",
  "rubric_interpretation",
  "source_verified",
  "automated_false_positive",
  "automated_false_negative",
  "other",
]);
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_NOTE_LENGTH = 1_000;

export function listPrivateTutorEvaluationReviewQueue(state, {
  ownerTeamId,
  status = "required",
  limit = 50,
} = {}) {
  const normalizedStatus = status === "completed" ? "completed" : "required";
  const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  return state.privateTutorAttempts
    .filter((attempt) => attempt.ownerTeamId === ownerTeamId)
    .filter((attempt) => normalizedStatus === "required"
      ? attempt.evaluation?.reviewStatus === "required"
      : attempt.evaluation?.reviewStatus === "completed")
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
    .slice(0, boundedLimit)
    .map((attempt) => privateTutorEvaluationReviewQueueItem(state, attempt));
}

export function resolvePrivateTutorEvaluationReview(state, attemptId, input, {
  actor,
  now,
  nextId,
} = {}) {
  const validation = validateReviewInput(input);
  if (!validation.ok) return validation;
  const actorId = actor?.userId;
  const ownerTeamId = actor?.teamId;
  const requestHash = stableHash(validation.value);
  const existing = state.privateTutorEvaluationReviews.find((review) =>
    review.ownerTeamId === ownerTeamId
    && review.reviewerId === actorId
    && review.idempotencyKey === validation.value.idempotencyKey);
  if (existing) {
    if (existing.attemptId !== attemptId || existing.requestHash !== requestHash) {
      return { ok: false, status: 409, error: "private_tutor_evaluation_review_idempotency_conflict" };
    }
    const attempt = state.privateTutorAttempts.find((row) => row.id === existing.attemptId);
    return { ok: true, review: privateTutorEvaluationReviewView(existing), attempt, replayed: true };
  }

  const attempt = state.privateTutorAttempts.find((row) => row.id === attemptId && row.ownerTeamId === ownerTeamId);
  if (!attempt) return { ok: false, status: 404, error: "private_tutor_evaluation_review_not_found" };
  if (attempt.evaluation?.reviewStatus === "completed") {
    return { ok: false, status: 409, error: "private_tutor_evaluation_review_already_completed" };
  }
  if (attempt.evaluation?.reviewStatus !== "required" || !attempt.evaluation?.decisionFingerprint) {
    return { ok: false, status: 409, error: "private_tutor_evaluation_review_not_required" };
  }
  if (attempt.evaluation.decisionFingerprint !== validation.value.decisionFingerprint) {
    return {
      ok: false,
      status: 409,
      error: "private_tutor_evaluation_review_stale_decision",
      decisionFingerprint: attempt.evaluation.decisionFingerprint,
    };
  }

  const reviewedAt = now();
  const finalCorrect = validation.value.decision === "confirmed_correct";
  const finalEvidenceEligible = finalCorrect
    && attempt.independent === true
    && attempt.usedHint !== true
    && attempt.responseKind === "answer";
  const automated = {
    correct: attempt.correct,
    evidenceEligible: attempt.evidenceEligible !== false,
    judgementReason: attempt.judgementReason,
    evidenceTier: attempt.evidenceTier,
    decisionFingerprint: attempt.evaluation.decisionFingerprint,
  };
  const review = {
    id: nextId("pter"),
    ownerTeamId,
    learnerId: attempt.learnerId,
    attemptId: attempt.id,
    reviewerId: actorId,
    idempotencyKey: validation.value.idempotencyKey,
    requestHash,
    automated,
    decision: validation.value.decision,
    reasonCode: validation.value.reasonCode,
    note: validation.value.note,
    finalCorrect,
    finalEvidenceEligible,
    createdAt: reviewedAt,
  };
  state.privateTutorEvaluationReviews.unshift(review);

  attempt.correct = finalCorrect;
  attempt.evidenceEligible = finalEvidenceEligible;
  attempt.evidenceTier = finalEvidenceEligible ? "human_reviewed" : "practice_only";
  attempt.judgementReason = finalCorrect
    ? "human_review_confirmed_correct"
    : "human_review_confirmed_incorrect";
  attempt.evaluation = {
    ...attempt.evaluation,
    reviewStatus: "completed",
    requiresReview: false,
    humanReviewId: review.id,
    humanReviewDecision: review.decision,
    humanReviewReasonCode: review.reasonCode,
    reviewedAt,
    finalCorrect,
    finalEvidenceEligible,
  };
  return { ok: true, review: privateTutorEvaluationReviewView(review), attempt, replayed: false };
}

export function recomputePrivateTutorMasteryEvidence(state, learner, {
  contentPackageId,
  contentPackageVersion = null,
  reviewId = null,
  now,
} = {}) {
  const pkg = privateTutorPackageRegistryFromState(state).getPackage(contentPackageId);
  const snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
  if (!pkg || !snapshot) return { changed: false, snapshot: snapshot ?? null, activePackage: false };

  const targetVersion = contentPackageVersion ?? pkg.version;
  const activePackage = samePackageVersion(
    snapshot.contentPackageId,
    snapshot.contentPackageVersion,
    contentPackageId,
    targetVersion,
  );
  const storedPackageState = activePackage ? null : snapshot.packageStates?.find((row) =>
    samePackageVersion(row.packageId, row.packageVersion, contentPackageId, targetVersion));
  if (!activePackage && !storedPackageState) return { changed: false, snapshot, activePackage: false };

  const assessment = state.privateTutorAssessments.find((row) =>
    row.learnerId === learner.id
    && row.status === "completed"
    && samePackageVersion(row.contentPackageId, row.contentPackageVersion, contentPackageId, targetVersion));
  const diagnosticResult = assessment
    ? recomputeDiagnosticResult(state, assessment, contentPackageId)
    : null;
  if (assessment && diagnosticResult) {
    assessment.result = diagnosticResult;
    assessment.resultRecomputedAt = now();
    assessment.resultRecomputedByReviewId = reviewId;
  }

  const knowledge = pkg.knowledgeComponents.map((definition) => {
    const baseline = diagnosticResult?.knowledge?.find((row) => row.knowledgeId === definition.id);
    return baseline
      ? { id: definition.id, mastery: baseline.mastery, level: baseline.level, evidenceCount: baseline.evidenceCount }
      : { id: definition.id, mastery: null, level: "unknown", evidenceCount: 0 };
  });
  const after = assessment?.completedAt ?? null;
  const attempts = state.privateTutorAttempts
    .filter((attempt) => attempt.learnerId === learner.id
      && samePackageVersion(attempt.contentPackageId, attempt.contentPackageVersion, contentPackageId, targetVersion)
      && !attempt.assessmentId
      && attempt.evidenceEligible !== false
      && (!after || String(attempt.createdAt).localeCompare(String(after)) > 0))
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  for (const attempt of attempts) applyAttemptToKnowledge(knowledge, attempt);

  const recomputedAt = now();
  if (activePackage) {
    snapshot.knowledge = knowledge;
    snapshot.revision += 1;
    snapshot.updatedAt = recomputedAt;
  } else {
    storedPackageState.knowledge = knowledge;
    storedPackageState.updatedAt = recomputedAt;
  }
  return {
    changed: true,
    snapshot,
    activePackage,
    contentPackageId,
    contentPackageVersion: targetVersion,
    evidenceAttemptCount: attempts.length + Number(diagnosticResult?.answeredCount ?? 0),
    recomputedAt,
  };
}

export function privateTutorEvaluationReviewQueueItem(state, attempt) {
  const learner = state.privateTutorLearners.find((row) => row.id === attempt.learnerId);
  const review = state.privateTutorEvaluationReviews.find((row) => row.attemptId === attempt.id) ?? null;
  return {
    attemptId: attempt.id,
    learnerId: attempt.learnerId,
    learnerDisplayName: learner?.displayName ?? null,
    contentPackageId: attempt.contentPackageId ?? null,
    contentPackageVersion: attempt.contentPackageVersion ?? null,
    subjectId: attempt.subjectId ?? attempt.evaluation?.subjectId ?? null,
    knowledgeId: attempt.knowledgeId,
    questionRevisionId: attempt.questionRevisionId,
    responseKind: attempt.responseKind,
    normalizedAnswer: attempt.normalizedAnswer,
    source: attempt.source,
    recognitionConfidence: attempt.recognitionConfidence ?? null,
    independent: attempt.independent === true,
    usedHint: attempt.usedHint === true,
    automatedCorrect: review?.automated.correct ?? attempt.correct,
    automatedEvidenceEligible: review?.automated.evidenceEligible ?? (attempt.evidenceEligible !== false),
    evaluation: structuredClone(attempt.evaluation),
    review: review ? privateTutorEvaluationReviewView(review) : null,
    createdAt: attempt.createdAt,
  };
}

function privateTutorEvaluationReviewView(review) {
  return {
    id: review.id,
    learnerId: review.learnerId,
    attemptId: review.attemptId,
    reviewerId: review.reviewerId,
    automated: structuredClone(review.automated),
    decision: review.decision,
    reasonCode: review.reasonCode,
    note: review.note,
    finalCorrect: review.finalCorrect,
    finalEvidenceEligible: review.finalEvidenceEligible,
    createdAt: review.createdAt,
  };
}

function validateReviewInput(input) {
  const idempotencyKey = String(input?.idempotencyKey ?? "").trim();
  const decisionFingerprint = String(input?.decisionFingerprint ?? "").trim();
  const decision = String(input?.decision ?? "").trim();
  const reasonCode = String(input?.reasonCode ?? "").trim();
  const note = String(input?.note ?? "").trim();
  if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return { ok: false, status: 400, error: "invalid_private_tutor_evaluation_review_idempotency_key" };
  }
  if (!/^[a-f0-9]{64}$/.test(decisionFingerprint)) {
    return { ok: false, status: 400, error: "invalid_private_tutor_evaluation_review_fingerprint" };
  }
  if (!REVIEW_DECISIONS.has(decision) || !REVIEW_REASON_CODES.has(reasonCode) || note.length > MAX_NOTE_LENGTH) {
    return { ok: false, status: 400, error: "invalid_private_tutor_evaluation_review" };
  }
  return { ok: true, value: { idempotencyKey, decisionFingerprint, decision, reasonCode, note } };
}

function recomputeDiagnosticResult(state, assessment, contentPackageId) {
  const summaries = assessment.answerSummaries.flatMap((summary) => {
    const attempt = state.privateTutorAttempts.find((row) => row.id === summary.attemptId);
    if (!attempt || attempt.evidenceEligible === false) return [];
    return [{
      ...summary,
      correct: attempt.correct,
      responseKind: attempt.responseKind,
    }];
  });
  return buildDiagnosticResult(summaries, state, contentPackageId);
}

function applyAttemptToKnowledge(knowledge, attempt) {
  let row = knowledge.find((item) => item.id === attempt.knowledgeId);
  if (!row) {
    row = { id: attempt.knowledgeId, mastery: null, level: "unknown", evidenceCount: 0 };
    knowledge.push(row);
  }
  const startingMastery = row.mastery ?? 0.5;
  const delta = attempt.correct
    ? attempt.independent && !attempt.usedHint ? 0.12 : 0.04
    : -0.05;
  row.mastery = Math.max(0, Math.min(1, Number((startingMastery + delta).toFixed(2))));
  row.evidenceCount += 1;
  row.level = row.mastery >= 0.8 ? "mastered" : row.mastery >= 0.55 ? "learning" : "needs_support";
}

function samePackage(left, right) {
  return String(left ?? "demo-math-foundations-v1") === String(right ?? "demo-math-foundations-v1");
}

function samePackageVersion(leftId, leftVersion, rightId, rightVersion) {
  return samePackage(leftId, rightId)
    && (!leftVersion || !rightVersion || String(leftVersion) === String(rightVersion));
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
