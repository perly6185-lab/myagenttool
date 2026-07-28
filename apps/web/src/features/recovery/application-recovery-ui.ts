import type {
  ApplicationOrchestrationRecovery,
  ApplicationRecoveryActionRequest,
  ApplicationRecoveryExplanation,
  ApprovalSnapshot,
  ConsoleSnapshot,
  InvocationSnapshot,
} from "@/lib/console-state";

export type RecoveryTone = "neutral" | "success" | "warning" | "danger" | "running";

export function readableRecoveryCategory(category: string): string {
  return category
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ") || "Unknown";
}

export function recoveryTone(category: string): RecoveryTone {
  if (category === "none") return "success";
  if (["validation_failed", "policy_blocked", "approval_timeout", "device_unlinked"].includes(category)) return "warning";
  if (["runtime_error", "unknown_failure"].includes(category)) return "danger";
  if (["dispatch_timeout", "execution_timeout", "agent_unavailable", "cancelled"].includes(category)) return "running";
  return "neutral";
}

export function isExecutableRecoveryAction(actionType: string): boolean {
  return actionType === "rerun" || actionType === "select_agent";
}

export function latestRecoveryActionRequest(
  requests: ApplicationRecoveryActionRequest[],
  actionType?: string,
): ApplicationRecoveryActionRequest | null {
  return sortedRecoveryActionRequests(requests)
    .filter((request) => !actionType || request.actionType === actionType)[0] ?? null;
}

export function sortedRecoveryActionRequests(requests: ApplicationRecoveryActionRequest[]): ApplicationRecoveryActionRequest[] {
  return [...requests].sort(
    (left, right) => Date.parse(right.updatedAt ?? right.createdAt) - Date.parse(left.updatedAt ?? left.createdAt),
  );
}

export function recoveryActionRequestTone(status: string): RecoveryTone {
  if (status === "executed" || status === "approval_approved" || status === "noop") return "success";
  if (status === "executing") return "running";
  if (status === "approval_pending" || status === "requested") return "warning";
  if (status === "failed" || status === "unsupported" || status === "approval_denied" || status === "approval_timed_out") return "danger";
  return "neutral";
}

export function readableRecoveryActionRequestStatus(status: string): string {
  return readableRecoveryActionStatus(status, "badge");
}

export function readableRecoveryActionStatus(status: string, style: "badge" | "inline" = "badge"): string {
  const badgeLabels: Record<string, string> = {
    approval_approved: "Approved",
    approval_denied: "Denied",
    approval_pending: "Pending",
    approval_timed_out: "Timed out",
    executing: "Executing",
    executed: "Executed",
    failed: "Failed",
    noop: "Viewed",
    pending: "Pending",
    requested: "Requested",
    unsupported: "Unsupported",
  };
  if (style === "badge") return badgeLabels[status] ?? status;
  const inlineLabels: Record<string, string> = {
    approval_approved: "approved",
    approval_denied: "denied",
    approval_pending: "pending approval",
    approval_timed_out: "timed out",
    executing: "executing",
    executed: "executed",
    failed: "failed",
    noop: "viewed",
    pending: "pending",
    requested: "requested",
    unsupported: "unsupported",
  };
  return inlineLabels[status] ?? status;
}

export function recoveryOutcomeTone(state: string): RecoveryTone {
  if (state === "recovered") return "success";
  if (state === "pending") return "running";
  if (state === "still_failed") return "danger";
  if (state === "needs_attention") return "warning";
  return "neutral";
}

export function recoveryOutcomeSeverityTone(severity?: string | null): RecoveryTone {
  if (severity === "success") return "success";
  if (severity === "info") return "running";
  if (severity === "warning") return "warning";
  if (severity === "danger") return "danger";
  return "neutral";
}

export function recoveryExplanationTone(state: string): RecoveryTone {
  if (state === "executed" || state === "no_result_expected") return "success";
  if (state === "approval_pending" || state === "executing" || state === "requested") return "running";
  if (state === "blocked" || state === "approval_denied" || state === "approval_timed_out" || state === "unsupported") return "warning";
  if (state === "failed" || state === "rejected") return "danger";
  return "neutral";
}

export function recoveryExplanationReasonTone(reason: string): RecoveryTone {
  if (reason === "execution_completed" || reason === "result_succeeded" || reason === "no_result_expected") return "success";
  if (reason === "approval_pending" || reason === "execution_in_progress" || reason === "recovery_requested") return "running";
  if (reason.startsWith("result_") || reason.includes("failed") || reason === "healthy_agent_not_found") return "danger";
  if (reason.includes("blocked") || reason.includes("pending") || reason.includes("unsupported")) return "warning";
  return "neutral";
}

export function recoveryTimelineTone(status: string): RecoveryTone {
  if (status === "executed" || status === "approval_approved") return "success";
  if (status === "executing") return "running";
  if (status === "requested" || status === "approval_pending") return "warning";
  if (status === "failed" || status === "rejected" || status === "approval_denied" || status === "approval_timed_out") return "danger";
  return "neutral";
}

export function readableRecoveryOutcome(state: string): string {
  const labels: Record<string, string> = {
    needs_attention: "Needs attention",
    pending: "Pending",
    recovered: "Recovered",
    still_failed: "Still failed",
  };
  return labels[state] ?? state;
}

export function readableRecoveryOutcomeReason(reason: string): string {
  const labels: Record<string, string> = {
    approval_approved: "Approval approved",
    approval_denied: "Approval denied",
    approval_pending: "Approval pending",
    approval_timed_out: "Approval timed out",
    execution_failed_before_result: "Failed before result",
    missing_result_invocation: "Missing result",
    no_result_expected: "No result expected",
    recovery_executing: "Executing",
    recovery_requested: "Requested",
    result_cancelled: "Result cancelled",
    result_denied: "Result denied",
    result_failed: "Result failed",
    result_in_progress: "Result in progress",
    result_invocation_not_visible: "Result not visible",
    result_succeeded: "Result succeeded",
  };
  return labels[reason] ?? reason;
}

export function readableRecoveryExplanationState(state: string): string {
  const labels: Record<string, string> = {
    approval_denied: "Approval denied",
    approval_pending: "Waiting for approval",
    approval_timed_out: "Approval timed out",
    blocked: "Blocked",
    executed: "Executed",
    executing: "Executing",
    failed: "Failed",
    no_result_expected: "View only",
    rejected: "Rejected",
    requested: "Requested",
    unsupported: "Unsupported",
  };
  return labels[state] ?? state;
}

export function readableRecoveryExplanationReason(reason: string): string {
  const labels: Record<string, string> = {
    action_not_suggested: "Action not suggested",
    approval_pending: "Approval pending",
    execution_completed: "Execution completed",
    execution_failed: "Execution failed",
    execution_in_progress: "Execution in progress",
    healthy_agent_not_found: "Healthy agent not found",
    no_result_expected: "No result expected",
    recovery_requested: "Recovery requested",
    same_action_approval_pending: "Duplicate approval pending",
    same_action_in_progress: "Duplicate action in progress",
  };
  return labels[reason] ?? readableRecoveryOutcomeReason(reason);
}

export function readableRecoveryActionType(actionType: string): string {
  const labels: Record<string, string> = {
    regenerate_orchestration: "Regenerate orchestration",
    rerun: "Re-run",
    select_agent: "Select agent",
    view_invocation: "View invocation",
  };
  return labels[actionType] ?? actionType;
}

export function readableRecoveryActionAvailabilityReason(reason: string): string {
  const labels: Record<string, string> = {
    same_action_approval_pending: "Already pending approval",
    same_action_in_progress: "Already in progress",
    same_action_recently_failed: "Recently failed",
  };
  return labels[reason] ?? reason;
}

export function readableRecoveryTimelineStatus(status: string): string {
  const labels: Record<string, string> = {
    approval_approved: "Approved",
    approval_denied: "Denied",
    approval_pending: "Approval pending",
    approval_resolved: "Approval resolved",
    approval_timed_out: "Timed out",
    executed: "Executed",
    executing: "Executing",
    failed: "Failed",
    recorded: "Recorded",
    rejected: "Rejected",
    requested: "Requested",
  };
  return labels[status] ?? status;
}

export function readableRecoveryAgentReason(reason: string): string {
  const labels: Record<string, string> = {
    agent_disabled: "disabled",
    agent_not_found: "not found",
    agent_unavailable: "unavailable",
    agent_unhealthy: "unhealthy",
    application_control_missing: "missing application control",
    device_unlinked: "device unlinked",
  };
  return labels[reason] ?? reason;
}

export function recoveryResultInvocationId(
  explanation: ApplicationRecoveryExplanation | null,
  request: ApplicationRecoveryActionRequest | null,
): string | null {
  return explanation?.resultInvocationId
    ?? request?.resultInvocation?.id
    ?? request?.resultInvocationId
    ?? null;
}

export function recoveryResultOrchestrationLabel(explanation: ApplicationRecoveryExplanation | null): string | null {
  if (!explanation) return null;
  return explanation.resultOrchestrationRelativePath
    ? `${explanation.resultOrchestrationId ?? "orchestration"} (${explanation.resultOrchestrationRelativePath})`
    : explanation.resultOrchestrationId ?? null;
}

export function recoveryAgentChoiceLabel(explanation: ApplicationRecoveryExplanation | null): string | null {
  if (!explanation) return null;
  return explanation.requestedAgentId && explanation.selectedAgentId && explanation.requestedAgentId !== explanation.selectedAgentId
    ? `${explanation.requestedAgentId} -> ${explanation.selectedAgentId}`
    : explanation.selectedAgentId ?? explanation.requestedAgentId ?? null;
}

export function recoveryApprovalRequestId(
  invocation: InvocationSnapshot,
  explanation: ApplicationRecoveryExplanation | null,
  request: ApplicationRecoveryActionRequest | null,
): string | null {
  return explanation?.approvalRequestId
    ?? request?.approvalRequestId
    ?? invocation.approvalRequestId
    ?? null;
}

export function recoveryWaitingOn({
  approvalRequestId,
  approval,
  latestRecoveryAction,
}: {
  approvalRequestId: string | null;
  approval: ApprovalSnapshot | null;
  latestRecoveryAction: ApplicationRecoveryActionRequest | null;
}): string {
  if (approvalRequestId) {
    const status = approval?.status === "pending"
      ? "approval_pending"
      : approval?.status ?? latestRecoveryAction?.status ?? "pending";
    return `${approvalRequestId} (${readableRecoveryActionStatus(status, "inline")})`;
  }
  if (latestRecoveryAction?.status === "executing") return "Recovery execution";
  return "No approval pending";
}

export function recoveryDefaultNextStep(
  invocation: InvocationSnapshot,
  recovery: ApplicationOrchestrationRecovery | null,
  latestRecoveryAction: ApplicationRecoveryActionRequest | null,
): string | null {
  if (latestRecoveryAction?.status === "approval_pending") return "Resolve the linked approval request before the recovery action can execute.";
  if (latestRecoveryAction?.resultInvocationId || latestRecoveryAction?.resultInvocation?.id) return "Inspect the recovery result invocation.";
  if (invocation.status === "waiting_for_local_approval") return "Approve or deny the pending local approval request.";
  if (invocation.status === "failed" && recovery?.actions.length) return "Choose a recommended recovery action from the application diagnostics.";
  if (invocation.status === "rejected") return "Review the policy decision and adjust the request before retrying.";
  if (invocation.status === "queued" || invocation.status === "running") return "Wait for the run to finish or cancel it if it is no longer needed.";
  if (invocation.status === "succeeded") return "Review the result and downstream records.";
  return null;
}

export function recoveryBlockedReason(invocation: InvocationSnapshot, reason: string | null): string {
  if (invocation.status === "waiting_for_local_approval") return "Local approval required";
  if (invocation.status === "rejected") return "Rejected before execution";
  if (reason) return readableRecoveryExplanationReason(reason);
  return "Not blocked";
}

export function recoveryResultLabel(invocation: InvocationSnapshot): string {
  if (invocation.status === "succeeded") return invocation.result?.summary ?? "Completed";
  if (invocation.status === "failed") return "No successful result";
  if (invocation.status === "rejected") return "No result";
  return "Pending";
}

export function invocationStatusRecoveryReason(invocation: InvocationSnapshot): string | null {
  if (invocation.status === "waiting_for_local_approval") return "approval_pending";
  if (invocation.status === "rejected") return "rejected";
  if (invocation.status === "failed") return "result_failed";
  if (invocation.status === "cancelled") return "result_cancelled";
  if (invocation.status === "succeeded") return "result_succeeded";
  return null;
}

export function defaultInvocationRecoverySummary(invocation: InvocationSnapshot): string {
  if (invocation.status === "waiting_for_local_approval") return "This run is paused until local approval is resolved.";
  if (invocation.status === "rejected") return "This run was rejected before execution.";
  if (invocation.status === "failed") return "This run failed before producing a successful result.";
  if (invocation.status === "succeeded") return "This run completed successfully.";
  if (invocation.status === "queued") return "This run is queued for delivery.";
  if (invocation.status === "running") return "This run is currently executing.";
  return "No additional explanation has been recorded for this run.";
}

export function latestInvocationRecoveryEventSummary(state: ConsoleSnapshot | null, invocationId: string): string | null {
  const event = (state?.events ?? [])
    .filter((item) => item.invocationId === invocationId && item.message)
    .find((item) => ["invocation_failed", "invocation_completed", "local_approval_requested", "local_approval_denied"].includes(item.type));
  return event?.message ?? null;
}
