import { createHash } from "node:crypto";

export const PRIVATE_TUTOR_EVALUATION_SCHEMA_VERSION = 1;

/**
 * Turn a subject-plugin result into the durable, versioned evaluation contract.
 * The wrapper is deliberately fail-closed: incomplete plugin output throws and
 * the caller converts it to private_tutor_subject_plugin_failed.
 */
export function finalizePrivateTutorEvaluation({ result, plugin, question }) {
  if (!result || typeof result !== "object" || typeof result.accepted !== "boolean") {
    throw new Error("invalid_private_tutor_evaluation_result");
  }
  if (!result.accepted) return result;
  if (typeof result.correct !== "boolean" || !result.responseKind || !result.reason) {
    throw new Error("invalid_private_tutor_evaluation_decision");
  }

  const subjectId = String(plugin?.subjectId ?? question?.subjectId ?? "").trim();
  const evaluatorVersion = String(plugin?.version ?? "").trim();
  if (!subjectId || !evaluatorVersion) throw new Error("invalid_private_tutor_evaluator_identity");

  const evidenceTier = String(result.evidenceTier ?? "deterministic");
  const details = result.evaluation && typeof result.evaluation === "object"
    ? structuredClone(result.evaluation)
    : {};
  const confidence = normalizedConfidence(
    result.confidence ?? details.confidence ?? defaultConfidence(evidenceTier, result.evidenceEligible),
  );
  const reviewRequired = details.requiresReview === true
    || result.reviewStatus === "required"
    || (result.evidenceEligible !== false && confidence === null);
  const evidenceEligible = result.evidenceEligible !== false && !reviewRequired;
  const reviewStatus = reviewRequired ? "required" : result.reviewStatus === "completed" ? "completed" : "not_required";
  const contentRevisionId = String(question?.id ?? question?.revisionId ?? "") || null;
  const contentPackageId = question?.contentPackageId ?? null;
  const contentPackageVersion = question?.contentPackageVersion ?? null;
  const rubricVersion = question?.rubric?.version ?? question?.mathContract?.version ?? null;
  const evaluatorId = `private-tutor:${subjectId}`;
  const decisionFingerprint = fingerprint({
    schemaVersion: PRIVATE_TUTOR_EVALUATION_SCHEMA_VERSION,
    evaluatorId,
    evaluatorVersion,
    contentRevisionId,
    contentPackageId,
    contentPackageVersion,
    rubricVersion,
    correct: result.correct,
    reason: result.reason,
    evidenceEligible,
    evidenceTier,
    confidence,
    reviewStatus,
  });

  return {
    ...result,
    evidenceEligible,
    evidenceTier,
    evaluation: {
      ...details,
      schemaVersion: PRIVATE_TUTOR_EVALUATION_SCHEMA_VERSION,
      evaluatorId,
      evaluatorVersion,
      subjectId,
      contentRevisionId,
      contentPackageId,
      contentPackageVersion,
      rubricVersion,
      confidence,
      reviewStatus,
      requiresReview: reviewRequired,
      decisionFingerprint,
    },
  };
}

function defaultConfidence(evidenceTier, evidenceEligible) {
  if (evidenceEligible === false || evidenceTier === "practice_only") return 0;
  if (evidenceTier.startsWith("deterministic") || evidenceTier === "rubric_high_confidence") return 1;
  return null;
}

function normalizedConfidence(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? Number(number.toFixed(4)) : null;
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
