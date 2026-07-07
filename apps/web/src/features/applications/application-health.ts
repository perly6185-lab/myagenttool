import type { ApplicationProbeMcpServer, ApplicationRecoveryActionRequest, ApplicationSnapshot, ApplicationSource } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";

export type ApplicationOperationAction =
  | "probe"
  | "online"
  | "timeline"
  | "automation"
  | "recovery"
  | "descriptors"
  | "mcp_probe"
  | "mcp"
  | "orchestration"
  | "inspect";

export interface ApplicationOperationIssue {
  id: string;
  title: string;
  detail: string;
  tone: Tone;
  action: ApplicationOperationAction;
  actionLabel: string;
  eventLevel?: "error" | "warning" | "info";
  automationId?: string | null;
  invocationId?: string | null;
  routineId?: string | null;
  mcpCandidateId?: string | null;
}

export function sourceSummary(source: ApplicationSource): string {
  switch (source.type) {
    case "git":
      return source.url;
    case "local":
      return source.path;
    case "npm":
      return `${source.package}${source.version ? `@${source.version}` : ""}`;
    default:
      return source.uri ?? "manual manifest";
  }
}

export function applicationNextStep(app: ApplicationSnapshot): { title: string; detail: string; tone: Tone } {
  const issue = applicationOperationIssues(app)[0];
  if (issue) {
    return {
      title: issue.title,
      detail: issue.detail,
      tone: issue.tone,
    };
  }
  if (!app.orchestrationIds?.length) {
    return {
      title: "Ready for orchestration",
      detail: "Generate a governed orchestration draft when this application needs maintenance.",
      tone: "success",
    };
  }
  return {
    title: "Ready",
    detail: "Capabilities, probe evidence, and orchestration drafts are available.",
    tone: "success",
  };
}

export function applicationOperationIssues(
  app: ApplicationSnapshot,
  recoveryActions: ApplicationRecoveryActionRequest[] = [],
): ApplicationOperationIssue[] {
  const issues: ApplicationOperationIssue[] = [];
  if (app.status === "failed") {
    issues.push({
      id: "lifecycle_failed",
      title: "Needs attention",
      detail: app.lifecycle?.error ?? "Inspect the failed lifecycle event and retry after fixing the source.",
      tone: "danger",
      action: "timeline",
      actionLabel: "View errors",
      eventLevel: "error",
    });
  }
  if (app.status === "probing") {
    issues.push({
      id: "source_probing",
      title: "Source setup running",
      detail: "Wait for the git clone or probe operation to finish before enabling execution.",
      tone: "warning",
      action: "inspect",
      actionLabel: "Inspect source",
    });
  }
  if (app.status === "archived") {
    issues.push({
      id: "archived",
      title: "Archived",
      detail: "Restore by registering a fresh application if this asset needs to run again.",
      tone: "danger",
      action: "inspect",
      actionLabel: "Inspect record",
    });
  }
  if (app.status === "offline") {
    issues.push({
      id: "offline",
      title: "Offline",
      detail: "Bring the application online to re-enable execution-like capabilities.",
      tone: "warning",
      action: "online",
      actionLabel: "Bring online",
    });
  }
  const automationCounts = app.healthSummary?.automationCounts;
  const automationAttention = app.healthSummary?.latestAutomationAttention;
  if ((automationCounts?.failing ?? 0) > 0) {
    issues.push({
      id: "automation_failing",
      title: "Schedule failing",
      detail: automationAttention?.lastErrorSummary
        ?? automationAttention?.nextAction
        ?? `${automationCounts?.failing ?? 0} ${pluralSchedule(automationCounts?.failing ?? 0)} failing.`,
      tone: "danger",
      action: "automation",
      actionLabel: automationAttention?.latestInvocationId ? "Open failing run" : "Inspect schedule",
      automationId: automationAttention?.automationId ?? null,
      invocationId: automationAttention?.latestInvocationId ?? null,
    });
  }
  if ((automationCounts?.waitingForApproval ?? 0) > 0) {
    issues.push({
      id: "automation_waiting_for_approval",
      title: "Schedule waiting for approval",
      detail: automationAttention?.nextAction
        ?? `${automationCounts?.waitingForApproval ?? 0} ${pluralSchedule(automationCounts?.waitingForApproval ?? 0)} waiting for approval.`,
      tone: "warning",
      action: "automation",
      actionLabel: automationAttention?.latestInvocationId ? "Review approval" : "Inspect schedule",
      automationId: automationAttention?.automationId ?? null,
      invocationId: automationAttention?.latestInvocationId ?? null,
    });
  }
  if ((automationCounts?.paused ?? 0) > 0) {
    issues.push({
      id: "automation_paused",
      title: "Schedule paused",
      detail: automationAttention?.nextAction
        ?? `${automationCounts?.paused ?? 0} ${pluralSchedule(automationCounts?.paused ?? 0)} paused.`,
      tone: "warning",
      action: "automation",
      actionLabel: "Resume schedule",
      automationId: automationAttention?.automationId ?? null,
      invocationId: automationAttention?.latestInvocationId ?? null,
    });
  }

  const latestEvent = app.healthSummary?.latestAttentionEvent;
  if (latestEvent) {
    const isError = latestEvent.level === "error";
    issues.push({
      id: `event_${latestEvent.id ?? latestEvent.type}`,
      title: isError ? "Timeline error" : "Timeline warning",
      detail: latestEvent.message ?? latestEvent.type ?? "Application timeline has an attention event.",
      tone: isError ? "danger" : "warning",
      action: "timeline",
      actionLabel: isError ? "View errors" : "View warnings",
      eventLevel: isError ? "error" : "warning",
    });
  }
  if (!app.probe) {
    issues.push({
      id: "probe_missing",
      title: "Probe recommended",
      detail: "Run a probe to discover capabilities, MCP candidates, and wrapper readiness.",
      tone: "warning",
      action: "probe",
      actionLabel: "Run probe",
    });
  }
  const wrapperReadinessProblem = applicationWrapperReadinessProblem(app);
  if (wrapperReadinessProblem) {
    issues.push({
      id: "wrapper_setup",
      title: "Wrapper setup needed",
      detail: wrapperReadinessProblem,
      tone: "warning",
      action: "descriptors",
      actionLabel: "Edit descriptors",
    });
  }
  const mcpCandidates = app.probe?.mcpServers ?? [];
  const httpMcpProbeCandidates = mcpCandidates
    .filter((server) => !server.autoRegister && server.status === "ready" && httpMcpLiveProbeNeeded(server));
  for (const candidate of httpMcpProbeCandidates) {
    const liveProbe = candidate.review?.liveProbe;
    const failed = liveProbe?.state === "failed";
    const blocked = liveProbe?.state === "blocked";
    issues.push({
      id: `mcp_http_probe_${candidate.id}`,
      title: blocked ? "HTTP MCP probe blocked" : failed ? "HTTP MCP probe failed" : "HTTP MCP probe needed",
      detail: liveProbe?.nextAction
        ?? liveProbe?.message
        ?? "Run a live endpoint probe before this HTTP MCP candidate can be confirmed.",
      tone: failed || blocked ? "danger" : "warning",
      action: "mcp_probe",
      actionLabel: failed || blocked ? "Retry endpoint probe" : "Probe endpoint",
      mcpCandidateId: candidate.id,
    });
  }
  const manualMcpCandidates = mcpCandidates
    .filter((server) => !server.autoRegister && server.status === "ready" && !httpMcpLiveProbeNeeded(server));
  if (manualMcpCandidates.length > 0 && !app.mcpAgent) {
    issues.push({
      id: "mcp_manual_confirm",
      title: "MCP review needed",
      detail: `${manualMcpCandidates.length} MCP candidate(s) are ready for manual review.`,
      tone: "warning",
      action: "mcp",
      actionLabel: "Review MCP",
    });
  }
  if (app.probe?.warnings?.length) {
    issues.push({
      id: "probe_warnings",
      title: "Probe warnings",
      detail: app.probe.warnings[0],
      tone: "warning",
      action: "timeline",
      actionLabel: "View timeline",
      eventLevel: "warning",
    });
  }
  const probeChangeCount = applicationProbeChangeCount(app);
  if (probeChangeCount > 0) {
    issues.push({
      id: "probe_changes",
      title: "Probe changes detected",
      detail: `${probeChangeCount} capability or MCP candidate change(s) since the previous probe.`,
      tone: "warning",
      action: "probe",
      actionLabel: "Re-run probe",
    });
  }
  if (app.wrapper?.mode === "installed-wrapper" && app.wrapper.installState !== "installed") {
    issues.push({
      id: "wrapper_not_installed",
      title: "Wrapper setup needed",
      detail: "Confirm the npm wrapper is installed before wrapper commands can execute.",
      tone: "warning",
      action: "descriptors",
      actionLabel: "Edit wrapper",
    });
  }

  const latestRecovery = app.healthSummary?.latestRecoveryAction ?? latestApplicationRecoveryAction(app.id, recoveryActions);
  if (latestRecovery && openRecoveryStatuses.has(latestRecovery.status ?? "")) {
    issues.push({
      id: `recovery_${latestRecovery.id}`,
      title: "Recovery action open",
      detail: latestRecovery.explanation?.nextStep
        ?? latestRecovery.outcome?.nextStep
        ?? latestRecovery.reason
        ?? "Inspect the recovery action and linked run.",
      tone: latestRecovery.status === "failed" ? "danger" : "warning",
      action: "recovery",
      actionLabel: "View recovery",
      routineId: latestRecovery.routineId,
      invocationId: latestRecovery.invocationId,
    });
  }

  if (!app.orchestrationIds?.length && issues.length === 0) {
    issues.push({
      id: "orchestration_missing",
      title: "Ready for orchestration",
      detail: "Generate a governed orchestration draft when this application needs maintenance.",
      tone: "success",
      action: "orchestration",
      actionLabel: "Generate orchestration",
    });
  }
  return issues.sort((left, right) => issueRank(left) - issueRank(right));
}

function pluralSchedule(count: number): string {
  return count === 1 ? "schedule is" : "schedules are";
}

const openRecoveryStatuses = new Set(["requested", "pending", "approval_pending", "approval_approved", "executing", "failed"]);

function issueRank(issue: ApplicationOperationIssue): number {
  if (issue.tone === "danger") return 0;
  if (issue.action === "recovery") return 1;
  if (issue.action === "automation") return 2;
  if (issue.action === "descriptors" || issue.action === "mcp") return 3;
  if (issue.action === "timeline") return 4;
  if (issue.action === "probe") return 5;
  if (issue.tone === "warning") return 6;
  return 7;
}

function applicationWrapperReadinessProblem(app: ApplicationSnapshot): string | null {
  const readiness = app.wrapper?.readiness;
  if (!readiness || readiness.state === "ready") return null;
  const blocked = readiness.blockedCommandIds?.length ?? 0;
  if (blocked > 0) {
    return `${blocked} wrapper command(s) need setup: ${readiness.reason ?? "wrapper_static_check_failed"}.`;
  }
  return readiness.reason ? `Wrapper static check needs setup: ${readiness.reason}.` : "Wrapper static check needs setup.";
}

function applicationProbeChangeCount(app: ApplicationSnapshot): number {
  const diff = app.probe?.diff;
  if (!diff) return 0;
  return [
    diff.addedCapabilityNames,
    diff.removedCapabilityNames,
    diff.changedCapabilityNames,
    diff.addedMcpServerIds,
    diff.removedMcpServerIds,
    diff.changedMcpServerIds,
  ].reduce((count, values) => count + (values?.length ?? 0), 0);
}

function httpMcpLiveProbeNeeded(server: ApplicationProbeMcpServer): boolean {
  const liveProbe = server.review?.liveProbe;
  return server.transport === "http"
    && liveProbe?.requiredBeforeExecution === true
    && liveProbe.state !== "succeeded";
}

export type ApplicationTriageFilter = "all" | "attention" | "warning" | "ready";

export function applicationTriageBucket(app: ApplicationSnapshot): Exclude<ApplicationTriageFilter, "all"> {
  const tone = applicationNextStep(app).tone;
  if (tone === "danger") return "attention";
  if (tone === "warning") return "warning";
  return "ready";
}

export function applicationTriageCounts(applications: ApplicationSnapshot[]): Record<Exclude<ApplicationTriageFilter, "all">, number> {
  return applications.reduce(
    (counts, app) => {
      counts[applicationTriageBucket(app)] += 1;
      return counts;
    },
    { attention: 0, warning: 0, ready: 0 },
  );
}

export function applicationMatchesSearch(app: ApplicationSnapshot, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const nextStep = applicationNextStep(app);
  const operationIssues = applicationOperationIssues(app);
  const haystack = [
    app.id,
    app.name,
    app.kind,
    app.status,
    sourceSummary(app.source),
    app.path,
    app.projectId,
    app.ownerTeamId,
    app.lifecycle?.lastOperation,
    app.lifecycle?.error,
    nextStep.title,
    nextStep.detail,
    ...operationIssues.flatMap((issue) => [issue.title, issue.detail, issue.actionLabel]),
  ].filter(Boolean).join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function sortApplicationsForTriage(applications: ApplicationSnapshot[]): ApplicationSnapshot[] {
  const triageRank: Record<ReturnType<typeof applicationTriageBucket>, number> = {
    attention: 0,
    warning: 1,
    ready: 2,
  };
  return [...applications].sort((left, right) => {
    const triageDelta = triageRank[applicationTriageBucket(left)] - triageRank[applicationTriageBucket(right)];
    if (triageDelta !== 0) return triageDelta;

    const leftUpdated = Date.parse(left.updatedAt ?? left.createdAt ?? "");
    const rightUpdated = Date.parse(right.updatedAt ?? right.createdAt ?? "");
    const timeDelta = (Number.isNaN(rightUpdated) ? 0 : rightUpdated) - (Number.isNaN(leftUpdated) ? 0 : leftUpdated);
    if (timeDelta !== 0) return timeDelta;

    return left.name.localeCompare(right.name);
  });
}

export function latestApplicationRecoveryAction(
  applicationId: string,
  requests: ApplicationRecoveryActionRequest[],
): ApplicationRecoveryActionRequest | null {
  return requests
    .filter((request) => request.applicationId === applicationId)
    .sort((left, right) => timestampValue(right.updatedAt ?? right.createdAt) - timestampValue(left.updatedAt ?? left.createdAt))[0] ?? null;
}

function timestampValue(value?: string | null): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
