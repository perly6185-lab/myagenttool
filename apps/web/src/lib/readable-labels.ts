/*
 * Plain-language mappers: turn protocol enum values into the non-professional
 * wording the console shows. Ported from the M0 vanilla console so the product
 * voice ("Sending", "Needs approval", "Stopped") stays identical after the
 * React migration.
 */

import type {
  AgentAdapter,
  AgentEconomics,
  AgentSnapshot,
  AgentUsageSummary,
  AuditSnapshot,
  ConsoleSnapshot,
  InvocationSnapshot,
  LifecycleAuditSnapshot,
  RetentionSettings,
} from "@/lib/console-state";

export type Tone = "neutral" | "running" | "success" | "warning" | "danger";

export function readableStatus(status?: string): string {
  const map: Record<string, string> = {
    queued: "Queued",
    dispatching: "Sending",
    waiting_for_local_approval: "Needs approval",
    running: "Running",
    cancelling: "Stopping",
    succeeded: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
    timed_out: "Timed out",
    expired: "Expired",
    rejected: "Rejected",
  };
  return map[status ?? ""] ?? "Waiting";
}

export function statusTone(status?: string): Tone {
  if (status === "succeeded") return "success";
  if (["failed", "timed_out", "expired", "rejected"].includes(status ?? "")) return "danger";
  if (status === "cancelled" || status === "cancelling") return "warning";
  if (["queued", "dispatching", "running", "waiting_for_local_approval"].includes(status ?? ""))
    return "running";
  return "neutral";
}

export function activityTitle(status?: string): string {
  const map: Record<string, string> = {
    queued: "Task is waiting for the local agent",
    dispatching: "Task is being sent to the computer",
    waiting_for_local_approval: "Task needs local approval",
    running: "The local agent is working",
    cancelling: "Stop request sent",
    succeeded: "Task finished",
    failed: "Task could not finish",
    cancelled: "Task was cancelled",
    timed_out: "Task timed out",
    expired: "Task expired",
  };
  return map[status ?? ""] ?? "Ready to run";
}

export function readableDeviceStatus(status?: string): string {
  if (status === "online") return "Online and ready";
  if (status === "offline") return "Offline";
  return status ?? "-";
}

export function readableAgentStatus(status?: string): string {
  if (status === "available") return "Ready";
  if (status === "unavailable") return "Waiting for computer";
  if (status === "disabled") return "Disabled";
  return status ?? "-";
}

export function readableHealth(health?: AgentSnapshot["health"]): string {
  if (!health) return "Not checked";
  const checkedAt = health.checkedAt ? ` at ${shortTime(health.checkedAt)}` : "";
  if (health.status === "healthy") return `Healthy${checkedAt} - ${health.message ?? ""}`.trim();
  if (health.status === "unhealthy")
    return `Needs attention${checkedAt} - ${health.message ?? ""}`.trim();
  if (health.status === "checking") return "Checking health";
  return "Not checked";
}

export function readableHealthLabel(health?: AgentSnapshot["health"]): string {
  if (health?.status === "healthy") return "Healthy";
  if (health?.status === "unhealthy") return "Needs attention";
  if (health?.status === "checking") return "Checking health";
  return "Not checked";
}

export function healthTone(health?: AgentSnapshot["health"]): Tone {
  if (health?.status === "healthy") return "success";
  if (health?.status === "unhealthy") return "danger";
  if (health?.status === "checking") return "running";
  return "neutral";
}

export function agentNextAction(
  agent: AgentSnapshot | null,
  state: ConsoleSnapshot | null | undefined,
): string {
  if (!agent) return "-";
  if (agent.status === "disabled") return "Enable the agent before running a task.";
  if (agent.health?.status === "unhealthy")
    return agent.health.nextAction ?? "Run another health check after fixing the agent.";
  if (agent.health?.status === "unknown" || !agent.health)
    return "Run a health check when setup changes.";
  if (agent.location?.type === "local_device" && state?.device?.status !== "online")
    return "Start Desktop Bridge to run local work.";
  return "Ready for tasks.";
}

export function lifecycleText(agent: AgentSnapshot | null): string {
  if (!agent) return "-";
  return `${agent.lifecycle?.state ?? "unknown"} / ${agent.lifecycle?.installState ?? "unknown"}`;
}

export function costText(economics?: AgentEconomics): string {
  if (!economics) return "Unknown";
  if (economics.model === "unknown") return "No billing in demo";
  return `${economics.model} (${economics.unknownCostPolicy})`;
}

export function costOwnerText(economics?: AgentEconomics, usage?: AgentUsageSummary): string {
  const owner = usage?.costOwner ?? economics?.costOwner ?? "unknown";
  const model = usage?.economicModel ?? economics?.model ?? "unknown";
  if (owner === "unknown") return `Unknown owner (${model})`;
  return `${owner} (${model})`;
}

export function usageText(usage?: AgentUsageSummary): string {
  if (!usage) return "No completed invocations yet";
  return `${usage.invocationCount} completed: ${usage.succeededCount} succeeded, ${usage.failedCount} failed, ${usage.cancelledCount} cancelled`;
}

export function readableDelivery(state?: string): string {
  const map: Record<string, string> = {
    not_required: "Runs without computer delivery",
    queued: "Waiting",
    dispatching: "Sending to computer",
    delivered: "Sent to computer",
    acknowledged: "Received by computer",
    redelivering: "Trying again",
    delivery_failed: "Delivery failed",
    expired: "Expired",
  };
  return map[state ?? ""] ?? "Not delivered";
}

export function readableCancellation(state?: string): string {
  const map: Record<string, string> = {
    none: "No stop request",
    requested: "Stop requested",
    queued_cancelled: "Cancelled before running",
    dispatched: "Stop sent",
    acknowledged: "Stop acknowledged",
    applied: "Stopped",
    failed: "Stop failed",
    not_supported: "Stop not supported",
  };
  return map[state ?? ""] ?? "No stop request";
}

export function resultTitle(status?: string): string {
  const map: Record<string, string> = {
    succeeded: "Answer returned",
    failed: "Needs attention",
    cancelled: "Stopped",
    timed_out: "Timed out",
    expired: "Expired",
    rejected: "Rejected",
    running: "Working locally",
    waiting_for_local_approval: "Needs approval",
    queued: "Waiting",
  };
  return map[status ?? ""] ?? "No result yet";
}

export function resultSummary(invocation: InvocationSnapshot | null, audit?: AuditSnapshot | null): string {
  if (!invocation) return "Run a task to see the answer here.";
  if (invocation.result?.summary) return invocation.result.summary;
  switch (invocation.status) {
    case "waiting_for_local_approval":
      return "Review the local approval request before this task can run.";
    case "rejected":
      return audit?.errorSummary ?? "Local approval was denied, so the task did not run.";
    case "running":
      return "The agent is still working on your computer.";
    case "queued":
      return "The task is queued for the local bridge.";
    case "dispatching":
      return "The task is being sent to your computer.";
    case "cancelled":
      return "The task was stopped before it completed.";
    case "failed":
      return audit?.errorSummary ?? "The task could not finish.";
    case "timed_out":
      return "The task ran longer than its timeout.";
    default:
      if (audit?.permissionDecision) return `Audit recorded: ${readableAudit(audit)}.`;
      return "No final answer has been returned yet.";
  }
}

export function readableEventType(type: string): string {
  const map: Record<string, string> = {
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
    cancel_failed: "Stop failed",
    cancel_force_killed: "Force-stopped (SIGKILL)",
    // Auto-run pipeline lifecycle (issue → worktree → agent → verify → judge → PR → merge → deploy → heal).
    auto_run_decided: "Routed",
    auto_run_started: "Agent started",
    auto_run_status_changed: "Stage changed",
    auto_run_retried: "Retried",
    auto_run_repair_started: "Self-repair started",
    auto_run_auto_approved: "Auto-approved",
    auto_run_denied: "Denied",
    auto_run_design_approved: "Design approved",
    auto_run_design_rejected: "Design rejected",
    auto_run_clarify_answered: "Clarification answered",
    auto_run_pr_merged: "PR merged",
    auto_run_auto_merged: "Auto-merged",
    auto_run_rolled_back: "Deploy rolled back",
    auto_run_rollback_failed: "Rollback failed",
    auto_run_remediation_filed: "Remediation filed",
    auto_run_remediation_failed: "Remediation failed",
    auto_run_child_spawned: "Child issue spawned",
    auto_run_decomposition_rejected: "Decomposition rejected",
  };
  return map[type] ?? type.replaceAll("_", " ");
}

export function adapterText(adapter?: AgentAdapter): string {
  if (!adapter) return "-";
  if (adapter.type === "cli") return `CLI command: ${adapter.command}`;
  if (adapter.type === "http") return `HTTP endpoint: ${adapter.baseUrl}`;
  if (adapter.type === "mcp") {
    const target = adapter.transport === "http" ? adapter.url : adapter.command;
    return `MCP server (${adapter.transport ?? "stdio"}): ${target ?? "unset"}`;
  }
  if (adapter.type === "platform") return `Platform agent: ${adapter.name ?? "built-in"}`;
  return adapter.type ?? "-";
}

export function cancellationText(adapter?: AgentAdapter): string {
  if (!adapter) return "No agent selected";
  if (adapter.cancellation === "supported") return "Can request stop";
  if (adapter.cancellation === "unsupported") return "Stop is not supported";
  return "Stop behavior is unknown";
}

export function readableAudit(audit?: AuditSnapshot | null): string {
  if (!audit) return "Nothing recorded";
  if (audit.permissionDecision === "allowed") return "Allowed and recorded";
  if (audit.permissionDecision === "denied") return "Denied and recorded";
  return "Recorded";
}

export function readableLifecycleAudit(audit?: LifecycleAuditSnapshot | null): string {
  if (!audit) return "Nothing recorded";
  const op = audit.operation.replaceAll("_", " ");
  if (audit.status === "succeeded") return `${op} completed`;
  if (audit.status === "failed") return `${op} needs attention`;
  return `${op} ${audit.status}`;
}

export function readableReviewState(state?: string): string {
  const map: Record<string, string> = {
    draft: "draft",
    generated: "generated",
    needs_review: "needs review",
    approved: "approved",
    tested: "tested",
    enabled: "registered",
    rejected: "rejected",
    archived: "archived",
  };
  return map[state ?? ""] ?? state ?? "unknown";
}

export function readableDiscoverySource(source?: string): string {
  const map: Record<string, string> = {
    known_command_allowlist: "known command allowlist",
    user_provided_path: "user-provided path",
    known_local_endpoint: "known local endpoint",
    user_provided_endpoint: "user-provided endpoint",
    bridge_managed_config: "bridge-managed config",
  };
  return map[source ?? ""] ?? source ?? "unknown";
}

export function readableAdapterType(type?: string): string {
  if (type === "cli") return "CLI";
  if (type === "http") return "HTTP";
  if (type === "mcp") return "MCP";
  if (type === "a2a") return "A2A";
  if (type === "container") return "Container";
  return type ?? "Unknown";
}

export function retentionSummary(settings?: RetentionSettings): string {
  if (!settings) return "Retention is not configured";
  return `Logs ${settings.logsDays}d, prompts ${settings.promptsDays}d, responses ${settings.responsesDays}d, artifacts ${settings.artifactsDays}d`;
}

export function shortTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
