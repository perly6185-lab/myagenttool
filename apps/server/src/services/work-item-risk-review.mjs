// Pure task-risk read model. It consumes normalized execution facts rather than
// the mutable server state, so risk policy can evolve and be tested independently
// from execution lookup, timeline projection, and HTTP response composition.

function projectRiskReasons({ state, attentionCode, verification, impact, deliveryEvidence }) {
  const reasons = [];
  const add = (code, severity, scope) => {
    if (!reasons.some((reason) => reason.code === code)) reasons.push({ code, severity, scope });
  };
  if (state === "failed") add("execution_failed", "high", "execution");
  if (attentionCode === "waiting_for_user") add("user_input_required", "medium", "execution");
  if (attentionCode === "waiting_for_approval") add("approval_required", "medium", "approval");
  if (verification?.status === "failed") add("verification_failed", "high", "verification");
  if (verification?.status === "not_configured") add("verification_not_configured", "medium", "verification");
  if (verification?.status === "unavailable") add("verification_unavailable", "medium", "verification");
  const batchEvidenceInconsistent = deliveryEvidence?.actionPreview?.officeDetails?.batch?.countConsistent === false;
  if (batchEvidenceInconsistent) add("office_batch_evidence_inconsistent", "high", "external_impact");
  if (impact?.status === "unknown" && !batchEvidenceInconsistent) add("external_impact_unknown", "medium", "external_impact");
  if (impact?.status === "partial") add("office_batch_partial", "high", "external_impact");
  if (impact?.status === "rolled_back") add("office_batch_rolled_back", "medium", "external_impact");
  if (impact?.status === "proposed") add("pull_request_not_applied", "medium", "external_impact");
  return reasons.slice(0, 4);
}

function projectRecommendedAction({ state, attentionCode, verification, deliveryEvidence }) {
  if (state === "waiting") {
    if (attentionCode === "waiting_for_user") {
      return { kind: "answer_ai", reasonCode: "execution_waiting_for_user", requiresConfirmation: false, nextOwner: "me" };
    }
    if (attentionCode === "waiting_for_approval") {
      return { kind: "review_approval", reasonCode: "execution_waiting_for_approval", requiresConfirmation: true, nextOwner: "me" };
    }
    return { kind: "open_details", reasonCode: "execution_waiting", requiresConfirmation: false, nextOwner: "me" };
  }
  if (state === "failed") {
    return { kind: "retry_execution", reasonCode: "execution_failed", requiresConfirmation: true, nextOwner: "me" };
  }
  if (state === "cancelled") {
    return { kind: "open_details", reasonCode: "execution_cancelled", requiresConfirmation: false, nextOwner: "me" };
  }
  if (state === "review_ready") {
    if (deliveryEvidence?.domain === "development"
      && (deliveryEvidence.status === "changes_requested" || verification?.status === "failed")) {
      return { kind: "fix_with_ai", reasonCode: "review_requires_changes", requiresConfirmation: false, nextOwner: "ai" };
    }
    if (deliveryEvidence?.domain === "development" && verification?.status === "unavailable") {
      return { kind: "rerun_verification", reasonCode: "verification_unavailable", requiresConfirmation: false, nextOwner: "system" };
    }
    return { kind: "review_result", reasonCode: "result_ready_for_review", requiresConfirmation: false, nextOwner: "me" };
  }
  if (state === "completed") {
    return { kind: "view_result", reasonCode: "result_completed", requiresConfirmation: false, nextOwner: "none" };
  }
  return { kind: "open_details", reasonCode: "execution_in_progress", requiresConfirmation: false, nextOwner: "ai" };
}

export function projectWorkItemRiskReview({
  state,
  attentionCode = null,
  verification = null,
  impact = null,
  deliveryEvidence = null,
} = {}) {
  return {
    needsAttention: ["waiting", "failed", "cancelled"].includes(state),
    riskReasons: projectRiskReasons({ state, attentionCode, verification, impact, deliveryEvidence }),
    recommendedAction: projectRecommendedAction({ state, attentionCode, verification, deliveryEvidence }),
  };
}
