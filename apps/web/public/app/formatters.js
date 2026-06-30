export function readableStatus(status) {
  const map = {
    queued: "Queued",
    dispatching: "Sending",
    waiting_for_local_approval: "Needs approval",
    running: "Running",
    cancelling: "Stopping",
    succeeded: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
    timed_out: "Timed out",
    expired: "Expired"
  };
  return map[status] ?? "Waiting";
}

export function activityTitle(status) {
  const map = {
    queued: "Task is waiting for the local agent",
    dispatching: "Task is being sent to the computer",
    waiting_for_local_approval: "Task needs local approval",
    running: "The local agent is working",
    cancelling: "Stop request sent",
    succeeded: "Task finished",
    failed: "Task could not finish",
    cancelled: "Task was cancelled",
    timed_out: "Task timed out",
    expired: "Task expired"
  };
  return map[status] ?? "Ready to run";
}

export function readableDeviceStatus(status) {
  if (status === "online") return "Online and ready";
  if (status === "offline") return "Offline";
  return status ?? "-";
}

export function readableAgentStatus(status) {
  if (status === "available") return "Ready";
  if (status === "unavailable") return "Waiting for computer";
  if (status === "disabled") return "Disabled";
  return status ?? "-";
}

export function readableHealth(health) {
  if (!health) return "Not checked";
  const checkedAt = health.checkedAt ? ` at ${shortTime(health.checkedAt)}` : "";
  if (health.status === "healthy") return `Healthy${checkedAt} - ${health.message}`;
  if (health.status === "unhealthy") return `Needs attention${checkedAt} - ${health.message}`;
  if (health.status === "checking") return "Checking health";
  return "Not checked";
}

export function readableHealthLabel(health) {
  if (health?.status === "healthy") return "Healthy";
  if (health?.status === "unhealthy") return "Needs attention";
  if (health?.status === "checking") return "Checking health";
  return "Not checked";
}

export function lifecycleText(agent) {
  if (!agent) return "-";
  return `${agent.lifecycle?.state ?? "unknown"} / ${agent.lifecycle?.installState ?? "unknown"}`;
}

export function highestRiskLevel(agent) {
  const riskOrder = { low: 1, medium: 2, high: 3, critical: 4 };
  return agent?.capabilities?.reduce((highest, capability) => {
    return (riskOrder[capability.riskLevel] ?? 0) > (riskOrder[highest] ?? 0) ? capability.riskLevel : highest;
  }, "low") ?? "low";
}

export function costText(economics) {
  if (!economics) return "Unknown";
  if (economics.model === "unknown") return "No billing in demo";
  return `${economics.model} (${economics.unknownCostPolicy})`;
}

export function costOwnerText(economics, usage) {
  const owner = usage?.costOwner ?? economics?.costOwner ?? "unknown";
  const model = usage?.economicModel ?? economics?.model ?? "unknown";
  if (owner === "unknown") return `Unknown owner (${model})`;
  return `${owner} (${model})`;
}

export function usageText(usage) {
  if (!usage) return "No completed invocations yet";
  return `${usage.invocationCount} completed: ${usage.succeededCount} succeeded, ${usage.failedCount} failed, ${usage.cancelledCount} cancelled`;
}

export function readableDelivery(state) {
  const map = {
    not_required: "Runs without computer delivery",
    queued: "Waiting",
    dispatching: "Sending to computer",
    delivered: "Sent to computer",
    acknowledged: "Received by computer",
    redelivering: "Trying again",
    delivery_failed: "Delivery failed",
    expired: "Expired"
  };
  return map[state] ?? "Not delivered";
}

export function readableCancellation(state) {
  const map = {
    none: "No stop request",
    requested: "Stop requested",
    queued_cancelled: "Cancelled before running",
    dispatched: "Stop sent",
    acknowledged: "Stop acknowledged",
    applied: "Stopped",
    failed: "Stop failed",
    not_supported: "Stop not supported"
  };
  return map[state] ?? "No stop request";
}

export function resultTitle(status) {
  if (status === "succeeded") return "Answer returned";
  if (status === "failed") return "Needs attention";
  if (status === "cancelled") return "Stopped";
  if (status === "timed_out") return "Timed out";
  if (status === "expired") return "Expired";
  if (status === "rejected") return "Rejected";
  if (status === "running") return "Working locally";
  if (status === "waiting_for_local_approval") return "Needs approval";
  if (status === "queued") return "Waiting";
  return "No result yet";
}

export function resultSummary(invocation, audit) {
  if (!invocation) return "Run a task to see the answer here.";
  if (invocation.result?.summary) return invocation.result.summary;
  if (invocation.status === "waiting_for_local_approval") return "Review the local approval request before this task can run.";
  if (invocation.status === "rejected") return audit?.errorSummary ?? "Local approval was denied, so the task did not run.";
  if (invocation.status === "running") return "The agent is still working on your computer.";
  if (invocation.status === "queued") return "The task is queued for the local bridge.";
  if (invocation.status === "dispatching") return "The task is being sent to your computer.";
  if (invocation.status === "cancelled") return "The task was stopped before it completed.";
  if (invocation.status === "failed") return audit?.errorSummary ?? "The task could not finish.";
  if (invocation.status === "timed_out") return "The task ran longer than its timeout.";
  if (audit?.permissionDecision) return `Audit recorded: ${readableAudit(audit)}.`;
  return "No final answer has been returned yet.";
}

export function readableEventType(type) {
  if (type === "codex_runtime_warning") {
    return "Codex note";
  }
  const map = {
    invocation_created: "Task created",
    invocation_authorized: "Task allowed",
    invocation_rejected: "Task rejected",
    policy_decision_recorded: "Policy checked",
    local_approval_requested: "Approval needed",
    local_approval_granted: "Approval granted",
    local_approval_denied: "Approval denied",
    delivery_queued: "Waiting for computer",
    delivery_dispatched: "Sent to computer",
    delivery_redelivered: "Delivery retried",
    delivery_acknowledged: "Computer received task",
    execution_preview: "Execution preview",
    invocation_started: "Agent started",
    log: "Agent update",
    agent_output: "Agent output",
    trace_created: "Trace started",
    span_completed: "Trace completed",
    heartbeat: "Computer connected",
    lifecycle_requested: "Agent action requested",
    lifecycle_started: "Agent action started",
    lifecycle_completed: "Agent action completed",
    lifecycle_failed: "Agent action failed",
    invocation_succeeded: "Task completed",
    invocation_failed: "Task failed",
    invocation_timed_out: "Task timed out",
    cancel_requested: "Stop requested",
    cancel_dispatched: "Stop sent",
    cancel_applied: "Stop completed",
    cancel_failed: "Stop failed"
  };
  return map[type] ?? type.replaceAll("_", " ");
}

export function taskSummary(task) {
  const normalized = String(task ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 117)}...`;
}

export function adapterText(adapter) {
  if (!adapter) return "-";
  if (adapter.type === "cli") return `CLI command: ${adapter.command}`;
  if (adapter.type === "http") return `HTTP endpoint: ${adapter.baseUrl}`;
  if (adapter.type === "platform") return `Platform agent: ${adapter.name ?? "built-in"}`;
  return adapter.type;
}

export function cancellationText(adapter) {
  if (!adapter) return "No agent selected";
  if (adapter.cancellation === "supported") return "Can request stop";
  if (adapter.cancellation === "unsupported") return "Stop is not supported";
  return "Stop behavior is unknown";
}

export function readableAudit(audit) {
  if (!audit) return "Nothing recorded";
  if (audit.permissionDecision === "allowed") return "Allowed and recorded";
  if (audit.permissionDecision === "denied") return "Denied and recorded";
  return "Recorded";
}

export function readableLifecycleAudit(audit) {
  if (!audit) return "Nothing recorded";
  if (audit.status === "succeeded") return `${audit.operation.replaceAll("_", " ")} completed`;
  if (audit.status === "failed") return `${audit.operation.replaceAll("_", " ")} needs attention`;
  return `${audit.operation.replaceAll("_", " ")} ${audit.status}`;
}

export function readableLifecycleRecipe(recipe) {
  if (!recipe) return "No lifecycle recipe selected";
  const action = String(recipe.action ?? "lifecycle").replaceAll("_", " ");
  const review = String(recipe.reviewState ?? "draft").replaceAll("_", " ");
  const queue = String(recipe.queueState ?? "not queued").replaceAll("_", " ");
  return `${action}: ${review}, ${queue}. ${recipe.summary?.risk ?? "Risk summary pending."}`;
}

export function readableQuotaDecision(decision) {
  if (!decision) return "No quota decision recorded";
  if (decision.decision === "allowed") return `Allowed: ${decision.reason}`;
  return `Blocked: ${decision.reason}`;
}

export function readableLedgerEntry(entry) {
  if (!entry) return "No ledger entry recorded";
  return `${entry.entryType} ${entry.amount} ${entry.currency} for ${entry.costOwner ?? "unknown owner"}`;
}

export function readableAuditExportRequest(request) {
  if (!request) return "No audit export dry run";
  const findings = request.validation?.findings?.length ?? 0;
  return `${request.status}: ${request.subjects?.join(", ") ?? "audit"} (${findings} finding${findings === 1 ? "" : "s"})`;
}

export function shortTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
