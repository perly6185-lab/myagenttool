export declare const deliveryEvidenceStatuses: readonly [
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
export type DeliveryEvidenceStatus = (typeof deliveryEvidenceStatuses)[number];

export declare const deliveryEvidenceRisks: readonly ["low", "medium", "high", "unknown"];
export type DeliveryEvidenceRisk = (typeof deliveryEvidenceRisks)[number];

export declare const deliveryEvidenceDomains: readonly ["development", "office", "other"];
export type DeliveryEvidenceDomain = (typeof deliveryEvidenceDomains)[number];

export declare const officeBatchStates: readonly [
  "pending", "waiting", "committing", "partial", "committed", "rolled_back",
  "needs_attention", "invalidated", "expired", "unknown",
];
export type OfficeBatchState = (typeof officeBatchStates)[number];

export declare const officeBatchAnomalyCodes: readonly [
  "operation_count_mismatch",
  "duplicate_detail_id",
  "unknown_detail_state",
  "target_count_mismatch",
  "rollback_count_mismatch",
  "terminal_state_mismatch",
];
export type OfficeBatchAnomalyCode = (typeof officeBatchAnomalyCodes)[number];

export declare const workItemReviewBlockedReasonCodes: readonly [
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
export type WorkItemReviewBlockedReasonCode = (typeof workItemReviewBlockedReasonCodes)[number];

export declare function normalizeDeliveryEvidenceStatus(value: unknown): DeliveryEvidenceStatus;
export declare function normalizeDeliveryEvidenceRisk(value: unknown): DeliveryEvidenceRisk;
export declare function normalizeDeliveryEvidenceDomain(value: unknown): DeliveryEvidenceDomain;
export declare function normalizeWorkItemReviewBlockedReasonCodes(values: unknown): WorkItemReviewBlockedReasonCode[];

export type OfficeBatchEvidence = {
  schemaVersion: 1;
  state: OfficeBatchState;
  targetCount: number;
  operationCount: number;
  successCount: number;
  restoredCount: number;
  failedCount: number;
  pendingCount: number;
  unknownCount: number;
  accountedCount: number;
  countConsistent: boolean;
  anomalyCodes: OfficeBatchAnomalyCode[];
  rollback: {
    status: "prepared" | "partial" | "rolled_back" | "not_available";
    protectedTargets: number;
    restoredTargets: number;
    blockedTargets: number;
    unknownTargets: number;
    countConsistent: boolean;
  };
  detailCount: number;
  detailsTruncated: boolean;
  details: Array<{
    id: string | null;
    businessKey: string | null;
    action: string | null;
    rowNumber: number | null;
    state: string;
    changedFields: string[];
  }>;
};

export declare function projectOfficeBatchEvidence(input?: {
  state?: unknown;
  targetCount?: unknown;
  operationCount?: unknown;
  failedPreviewId?: unknown;
  children?: unknown[];
  journal?: unknown;
}): OfficeBatchEvidence;
