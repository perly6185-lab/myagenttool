export const deliveryEvidenceStatuses = [
  "ready",
  "review_pending",
  "evidence_incomplete",
  "review_inconsistent",
  "changes_requested",
  "verification_failed",
  "verification_missing",
  "office_batch_attention",
  "office_batch_rolled_back",
  "office_batch_in_progress",
];

export const deliveryEvidenceRisks = ["low", "medium", "high", "unknown"];
export const deliveryEvidenceDomains = ["development", "office", "other"];

export const officeBatchStates = [
  "pending", "waiting", "committing", "partial", "committed", "rolled_back",
  "needs_attention", "invalidated", "expired", "unknown",
];
export const officeBatchAnomalyCodes = [
  "operation_count_mismatch",
  "duplicate_detail_id",
  "unknown_detail_state",
  "target_count_mismatch",
  "rollback_count_mismatch",
  "terminal_state_mismatch",
];

export const workItemReviewBlockedReasonCodes = [
  "changes_unavailable",
  "execution_action_in_flight_or_unknown",
  "auto_run_required",
  "target_status_not_reverifiable",
  "target_status_not_repairable",
  "target_status_not_retryable",
  "worktree_unavailable",
  "review_inconsistent",
  "review_required",
  "structured_review_required",
  "review_changes_requested",
  "verification_failed",
  "verification_required",
  "office_batch_attention",
  "office_batch_rolled_back",
  "office_batch_in_progress",
  "office_batch_evidence_inconsistent",
  "office_rollback_incomplete",
  "delivery_evidence_not_ready",
  "input_no_longer_required",
  "approval_no_longer_pending",
  "delivery_action_forbidden_by_intent",
];

const statusSet = new Set(deliveryEvidenceStatuses);
const riskSet = new Set(deliveryEvidenceRisks);
const domainSet = new Set(deliveryEvidenceDomains);
const blockedReasonCodeSet = new Set(workItemReviewBlockedReasonCodes);

export function normalizeDeliveryEvidenceStatus(value) {
  return statusSet.has(value) ? value : "evidence_incomplete";
}

export function normalizeDeliveryEvidenceRisk(value) {
  return riskSet.has(value) ? value : "unknown";
}

export function normalizeDeliveryEvidenceDomain(value) {
  return domainSet.has(value) ? value : "other";
}

export function normalizeWorkItemReviewBlockedReasonCodes(values) {
  if (!Array.isArray(values)) return [];
  const normalized = [];
  let hasUnknownCode = false;
  for (const value of values) {
    if (blockedReasonCodeSet.has(value)) normalized.push(value);
    else if (value != null && value !== false && String(value).trim()) hasUnknownCode = true;
  }
  if (hasUnknownCode) normalized.push("delivery_evidence_not_ready");
  return [...new Set(normalized)];
}

function nonNegativeInteger(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function boundedText(value, max = 300) {
  if (value == null) return null;
  return String(value).trim().slice(0, max) || null;
}

function normalizeBatchState(value) {
  return officeBatchStates.includes(value) ? value : "unknown";
}

function detailBucket(state) {
  if (state === "committed") return "successCount";
  if (state === "rolled_back") return "restoredCount";
  if (["invalidated", "expired", "failed"].includes(state)) return "failedCount";
  if (["pending", "waiting", "committing"].includes(state)) return "pendingCount";
  return "unknownCount";
}

// Normalizes two independent dimensions: record operations and rollback file
// targets. Operation buckets always conserve operationCount; rollback targets
// never inflate record-operation success or failure counts.
export function projectOfficeBatchEvidence({
  state = null,
  targetCount = null,
  operationCount = null,
  failedPreviewId = null,
  children = [],
  journal = null,
} = {}) {
  const normalizedState = normalizeBatchState(state);
  const anomalies = [];
  const addAnomaly = (code) => {
    if (!anomalies.includes(code)) anomalies.push(code);
  };
  if (normalizedState === "unknown" && state != null) addAnomaly("terminal_state_mismatch");

  const rawChildren = Array.isArray(children) ? children : [];
  const seenIds = new Set();
  const normalizedChildren = [];
  for (const [index, child] of rawChildren.entries()) {
    const id = boundedText(child?.id, 200);
    if (id && seenIds.has(id)) {
      addAnomaly("duplicate_detail_id");
      continue;
    }
    if (id) seenIds.add(id);
    const rawState = boundedText(child?.state, 40) ?? "pending";
    const normalizedChildState = ["committed", "rolled_back", "invalidated", "expired", "failed", "pending", "waiting", "committing", "unknown"].includes(rawState)
      ? rawState
      : "unknown";
    if (normalizedChildState === "unknown") addAnomaly("unknown_detail_state");
    normalizedChildren.push({
      id,
      businessKey: boundedText(child?.businessKey, 300),
      action: boundedText(child?.action, 40),
      rowNumber: Number.isInteger(child?.rowNumber) ? child.rowNumber : null,
      state: normalizedChildState,
      changedFields: Array.isArray(child?.changedCells)
        ? [...new Set(child.changedCells.map((cell) => boundedText(cell?.field, 120)).filter(Boolean))].slice(0, 20)
        : [],
      _index: index,
    });
  }

  const declaredOperationCount = nonNegativeInteger(operationCount, normalizedChildren.length);
  const effectiveOperationCount = Math.max(declaredOperationCount, normalizedChildren.length);
  if (declaredOperationCount < normalizedChildren.length) addAnomaly("operation_count_mismatch");
  const declaredTargetCount = nonNegativeInteger(targetCount, 0);
  if (effectiveOperationCount > 0 && declaredTargetCount === 0) addAnomaly("target_count_mismatch");
  if (declaredTargetCount > effectiveOperationCount && effectiveOperationCount > 0) addAnomaly("target_count_mismatch");

  const counts = { successCount: 0, restoredCount: 0, failedCount: 0, pendingCount: 0, unknownCount: 0 };
  for (const detail of normalizedChildren) counts[detailBucket(detail.state)] += 1;

  const failedId = boundedText(failedPreviewId ?? journal?.failedPreviewId, 200);
  if (failedId) {
    const failedDetail = normalizedChildren.find((detail) => detail.id === failedId);
    if (failedDetail && !["invalidated", "expired", "failed"].includes(failedDetail.state)) {
      counts[detailBucket(failedDetail.state)] -= 1;
      counts.failedCount += 1;
      failedDetail.state = "failed";
    } else if (!failedDetail && normalizedChildren.length < effectiveOperationCount) {
      counts.failedCount += 1;
    }
  }

  let missingOperations = effectiveOperationCount
    - counts.successCount - counts.restoredCount - counts.failedCount - counts.pendingCount - counts.unknownCount;
  if (missingOperations > 0) {
    if (["pending", "waiting", "committing"].includes(normalizedState)) counts.pendingCount += missingOperations;
    else if (normalizedState === "committed" && nonNegativeInteger(journal?.appliedCount, journal?.appliedPreviewIds?.length ?? 0) >= effectiveOperationCount) counts.successCount += missingOperations;
    else counts.unknownCount += missingOperations;
  }

  const operationSum = counts.successCount + counts.restoredCount + counts.failedCount + counts.pendingCount + counts.unknownCount;
  if (operationSum !== effectiveOperationCount) addAnomaly("operation_count_mismatch");
  if (["committed", "rolled_back", "invalidated", "expired"].includes(normalizedState)
    && normalizedChildren.length !== effectiveOperationCount) addAnomaly("operation_count_mismatch");
  if (normalizedState === "committed" && (counts.successCount !== effectiveOperationCount || counts.failedCount + counts.restoredCount + counts.pendingCount + counts.unknownCount > 0)) {
    addAnomaly("terminal_state_mismatch");
  }
  if (normalizedState === "rolled_back" && counts.successCount > 0) addAnomaly("terminal_state_mismatch");

  const rollback = journal?.rollback && typeof journal.rollback === "object" ? journal.rollback : null;
  const protectedTargets = nonNegativeInteger(
    journal?.snapshotCount,
    Array.isArray(journal?.snapshots) ? journal.snapshots.length : 0,
  );
  const restoredTargets = nonNegativeInteger(rollback?.restoredTargets, 0);
  const blockedTargets = nonNegativeInteger(rollback?.blockedTargets, 0);
  const attemptedTargets = restoredTargets + blockedTargets;
  const rollbackUnknownTargets = rollback ? Math.max(0, protectedTargets - attemptedTargets) : 0;
  if (rollback && (attemptedTargets > protectedTargets || (protectedTargets > 0 && attemptedTargets !== protectedTargets))) {
    addAnomaly("rollback_count_mismatch");
  }
  if (protectedTargets > declaredTargetCount && declaredTargetCount > 0) addAnomaly("target_count_mismatch");
  const rollbackStatus = rollback
    ? blockedTargets > 0 || rollbackUnknownTargets > 0 ? "partial" : "rolled_back"
    : protectedTargets > 0 ? "prepared" : "not_available";

  return {
    schemaVersion: 1,
    state: normalizedState,
    targetCount: declaredTargetCount,
    operationCount: effectiveOperationCount,
    ...counts,
    accountedCount: effectiveOperationCount - counts.unknownCount,
    countConsistent: anomalies.length === 0 && counts.unknownCount === 0,
    anomalyCodes: anomalies,
    rollback: {
      status: rollbackStatus,
      protectedTargets,
      restoredTargets,
      blockedTargets,
      unknownTargets: rollbackUnknownTargets,
      countConsistent: !anomalies.includes("rollback_count_mismatch"),
    },
    detailCount: normalizedChildren.length,
    detailsTruncated: normalizedChildren.length > 20,
    details: normalizedChildren.slice(0, 20).map(({ _index, ...detail }) => detail),
  };
}
