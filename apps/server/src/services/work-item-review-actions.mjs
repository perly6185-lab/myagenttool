const ACTION_LOCK_STATUSES = new Set(["accepted", "running", "unknown"]);
const REVERIFIABLE_STATUSES = new Set(["done", "pr_open", "blocked", "cancelled"]);
const REPAIRABLE_STATUSES = new Set(["failed", "blocked", "done", "report_posted", "plan_proposed", "pr_open"]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function action(kind, {
  enabled,
  requiresConfirmation = false,
  nextOwner = "me",
  blockedReasonCodes = [],
} = {}) {
  return {
    kind,
    visible: true,
    enabled: Boolean(enabled),
    requiresConfirmation,
    nextOwner,
    blockedReasonCodes: unique(enabled ? [] : blockedReasonCodes),
  };
}

// Pure action-availability projection. Command services remain authoritative and
// re-check every precondition; this model explains those same stable gates before
// the user clicks, including an uncertain in-flight exactly-once request.
export function projectWorkItemReviewActions({
  state,
  attentionCode = null,
  targetStatus = null,
  executionKind = null,
  verification = null,
  deliveryEvidence = null,
  actionReceipt = null,
  recommendedAction = null,
  hasWorktree = false,
} = {}) {
  const actions = [];
  const locked = ACTION_LOCK_STATUSES.has(actionReceipt?.status);
  const lockReasons = locked ? ["execution_action_in_flight_or_unknown"] : [];
  const hasAutoRun = executionKind === "auto_run";
  const preview = deliveryEvidence?.actionPreview ?? null;
  const development = deliveryEvidence?.domain === "development";
  const office = deliveryEvidence?.domain === "office";

  if (development && preview) {
    const hasChanges = Number(preview.changedFileCount ?? 0) > 0;
    actions.push(action("view_changes", {
      enabled: hasChanges,
      requiresConfirmation: false,
      blockedReasonCodes: ["changes_unavailable"],
    }));

    const reverifiable = hasAutoRun && REVERIFIABLE_STATUSES.has(targetStatus) && hasWorktree && !locked;
    actions.push(action("rerun_verification", {
      enabled: reverifiable,
      nextOwner: "system",
      blockedReasonCodes: [
        ...lockReasons,
        !hasAutoRun && "auto_run_required",
        !REVERIFIABLE_STATUSES.has(targetStatus) && "target_status_not_reverifiable",
        !hasWorktree && "worktree_unavailable",
      ],
    }));

    const needsRepair = ["changes_requested", "verification_failed"].includes(deliveryEvidence.status)
      || deliveryEvidence.review?.verdict === "changes_requested"
      || verification?.status === "failed"
      || ["failed", "blocked"].includes(targetStatus);
    if (needsRepair) {
      const repairable = hasAutoRun && REPAIRABLE_STATUSES.has(targetStatus) && hasWorktree && !locked;
      actions.push(action("fix_with_ai", {
        enabled: repairable,
        nextOwner: "ai",
        blockedReasonCodes: [
          ...lockReasons,
          !hasAutoRun && "auto_run_required",
          !REPAIRABLE_STATUSES.has(targetStatus) && "target_status_not_repairable",
          !hasWorktree && "worktree_unavailable",
        ],
      }));
    }
  }

  if (office && preview?.officeDetails?.batch) {
    actions.push(action("view_batch_details", { enabled: true }));
  }

  if (preview?.operation) {
    const rollback = preview.officeDetails?.batch?.rollback ?? null;
    const deliveryBlockedReasons = unique([
      ...(preview.blockedReasonCodes ?? deliveryEvidence?.blockingReasonCodes ?? []),
      rollback?.status === "partial" && "office_rollback_incomplete",
      ...lockReasons,
    ]);
    const deliveryEnabled = preview.canProceed === true && !locked;
    const deliveryActionOptions = {
      enabled: deliveryEnabled,
      requiresConfirmation: preview.requiresConfirmation !== false,
      blockedReasonCodes: deliveryBlockedReasons.length ? deliveryBlockedReasons : ["delivery_evidence_not_ready"],
    };
    actions.push(action(preview.operation, deliveryActionOptions));
    // `review_result` is the compatibility action rendered by today's review
    // card; retain the concrete operation alongside it for the next UI slice.
    if (recommendedAction?.kind === "review_result" && preview.operation !== "review_result") {
      const blockedOnlyByNoDeliveryIntent = deliveryEvidence?.status === "ready"
        && deliveryBlockedReasons.length === 1
        && deliveryBlockedReasons[0] === "delivery_action_forbidden_by_intent"
        && !locked;
      actions.push(action("review_result", blockedOnlyByNoDeliveryIntent
        ? { enabled: true, requiresConfirmation: true, nextOwner: "me" }
        : deliveryActionOptions));
    }
  }

  if (state === "failed" && !actions.some((candidate) => candidate.kind === "fix_with_ai")) {
    const legacyRestartable = executionKind === "application_invocation" && targetStatus === "failed";
    const retryable = !locked && (legacyRestartable
      || (hasAutoRun && ["failed", "blocked"].includes(targetStatus) && hasWorktree));
    actions.push(action("retry_execution", {
      enabled: retryable,
      requiresConfirmation: true,
      nextOwner: "ai",
      blockedReasonCodes: [
        ...lockReasons,
        !hasAutoRun && !legacyRestartable && "auto_run_required",
        !["failed", "blocked"].includes(targetStatus) && "target_status_not_retryable",
        !hasWorktree && !legacyRestartable && "worktree_unavailable",
      ],
    }));
  }
  if (state === "waiting" && attentionCode === "waiting_for_user") {
    actions.push(action("answer_ai", {
      enabled: hasAutoRun && targetStatus === "needs_input" && !locked,
      nextOwner: "me",
      blockedReasonCodes: [...lockReasons, !hasAutoRun && "auto_run_required", targetStatus !== "needs_input" && "input_no_longer_required"],
    }));
  }
  if (state === "waiting" && attentionCode === "waiting_for_approval") {
    actions.push(action("review_approval", {
      enabled: targetStatus === "awaiting_approval",
      requiresConfirmation: true,
      blockedReasonCodes: ["approval_no_longer_pending"],
    }));
  }

  return {
    schemaVersion: 1,
    primaryActionKind: recommendedAction?.kind ?? null,
    locked,
    actions,
  };
}
