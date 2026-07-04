import { LOCAL_TEAM_ID, teamOf } from "../runtime/auth.mjs";
import { publicDeviceView } from "../runtime/bridge-auth.mjs";

export function buildPublicState({
  namespace,
  protocolVersion,
  state,
  defaultProjectPath,
  currentProject,
  defaultAgent,
  loopRoutineReadModel,
  codexApprovalQueue,
  evidenceCenterRecords,
  ledgerSummary,
  budgetStatuses,
  teamBudgetStatuses,
  actor = null,
}) {
  // Tenancy scoping. With no actor (or one whose team owns everything, i.e.
  // single-team local dev) this is a pass-through; it only filters once a
  // second team exists. A row is visible when it carries no owning key (global)
  // or its project/invocation belongs to the actor's team.
  const teamId = actor?.teamId ?? null;
  const projectTeam = new Map((state.projects ?? []).map((p) => [p.id, teamOf(p)]));
  const projectVisible = (projectId) => {
    if (teamId == null || !projectId) return true; // unscoped, or a global/unowned row
    const owner = projectTeam.get(projectId);
    // An unknown/dangling projectId is NOT visible when scoped — defaulting to
    // the viewer's own team would leak every orphaned row to every team.
    return owner !== undefined && owner === teamId;
  };
  const projects = (state.projects ?? []).filter((p) => projectVisible(p.id));
  const invocations = (state.invocations ?? []).filter((inv) => projectVisible(inv.projectId));
  const visibleInvIds = new Set(invocations.map((inv) => inv.id));
  const visibleInvocationsById = new Map(invocations.map((invocation) => [invocation.id, invocation]));
  const invVisible = (invocationId) =>
    teamId == null || !invocationId || visibleInvIds.has(invocationId);
  const byInvocation = (rows) => (rows ?? []).filter((r) => invVisible(r?.invocationId));
  const byProject = (rows) => (rows ?? []).filter((r) => projectVisible(r?.projectId));
  const visibleEvents = byInvocation(state.events);
  const recoveryEventsByRequestId = groupRecoveryEventsByRequestId(visibleEvents);
  const applications = (state.applications ?? []).filter((application) => {
    if (application?.projectId) return projectVisible(application.projectId);
    return teamId == null || (application?.ownerTeamId ?? LOCAL_TEAM_ID) === teamId;
  });
  const importedUsagePublic = (rows) => byInvocation(rows).map(({ raw, ...row }) => row);
  const codexReviewFindings = byInvocation(state.codexReviewFindings).map(({ raw, ...row }) => row);
  const claudeReviewFindings = byInvocation(state.claudeReviewFindings).map(({ raw, ...row }) => row);
  const reviewFindings = [...codexReviewFindings, ...claudeReviewFindings].sort(compareReviewFindings);
  // Imported evidence has no invocation, so it can't ride byInvocation (a null
  // invocationId reads as globally visible). Scope it by its stamped owning team
  // instead; rows written before that stamp existed belong to the local team.
  const importedVisible = (r) => teamId == null || (r?.teamId ?? LOCAL_TEAM_ID) === teamId;
  const visibleImported = (state.codexImportedEvidenceRecords ?? []).filter(importedVisible);
  const visibleImportedIds = new Set(visibleImported.map((r) => r.id));
  // A compare run is visible when it spans at least one invocation the team can
  // see; unscoped mode passes everything through.
  const byCompareRun = (rows) =>
    (rows ?? []).filter(
      (r) => teamId == null || (r?.childInvocationIds ?? []).some((id) => visibleInvIds.has(id)),
    );

  return {
    namespace,
    protocolVersion,
    defaults: {
      cloneParentDir: defaultProjectPath,
    },
    device: publicDeviceView(state.device),
    // Never expose password hashes to any client.
    users: (state.users ?? []).map(({ passwordHash, ...user }) => user),
    teams: state.teams ?? [],
    projects,
    applications,
    applicationRecoveryActions: byInvocation(state.applicationRecoveryActions)
      .map((request) => applicationRecoveryActionReadModel(
        request,
        visibleInvocationsById,
        recoveryEventsByRequestId.get(request.id) ?? [],
      )),
    projectTargets: byProject(state.projectTargets),
    currentProjectId: state.currentProjectId,
    currentProject: currentProject(),
    loopRoutines: loopRoutineReadModel(),
    worktrees: byProject(state.worktrees),
    agent: defaultAgent(),
    agents: state.agents,
    invocations,
    compareRuns: byCompareRun(state.compareRuns),
    events: visibleEvents,
    traces: byInvocation(state.traces),
    spans: byInvocation(state.spans),
    auditSummaries: byInvocation(state.auditSummaries),
    healthChecks: state.healthChecks,
    lifecycleAuditRecords: state.lifecycleAuditRecords,
    lifecycleRecipes: state.lifecycleRecipes,
    lifecyclePolicyDecisions: state.lifecyclePolicyDecisions,
    lifecycleLocalApprovals: state.lifecycleLocalApprovals,
    lifecycleQueuedActions: state.lifecycleQueuedActions,
    lifecycleRollbackRequests: state.lifecycleRollbackRequests,
    privateCatalogEntries: state.privateCatalogEntries,
    signedBundleManifests: state.signedBundleManifests,
    discoveryRuns: state.discoveryRuns,
    integrationArtifacts: state.integrationArtifacts,
    integrationProbeRuns: state.integrationProbeRuns,
    quotaDecisionRecords: byInvocation(state.quotaDecisionRecords),
    quotaPolicies: state.quotaPolicies,
    aiUsageRecords: byInvocation(state.aiUsageRecords),
    ledgerEntries: byProject(state.ledgerEntries),
    importedUsageEstimates: importedUsagePublic(state.importedUsageEstimates),
    codexReviewFindings,
    claudeReviewFindings,
    reviewFindings,
    ledgerSummary: typeof ledgerSummary === "function" ? ledgerSummary() : null,
    // Project budgets scope by project; team pools (rows with teamId, no
    // projectId) scope by the viewer's team — byProject alone would treat them
    // as global and leak every team's pool to every viewer.
    budgets: (state.budgets ?? []).filter((b) =>
      b?.teamId ? teamId == null || b.teamId === teamId : projectVisible(b?.projectId),
    ),
    budgetStatuses: byProject(typeof budgetStatuses === "function" ? budgetStatuses() : []),
    // Team cost rollup — a team sees only its own row (unscoped mode sees all).
    teamBudgetStatuses: (typeof teamBudgetStatuses === "function" ? teamBudgetStatuses() : []).filter(
      (row) => teamId == null || row.teamId === teamId,
    ),
    automations: byProject(state.automations),
    agentSkills: state.agentSkills ?? [],
    privateDeploymentConfig: state.privateDeploymentConfig,
    auditExportRequests: state.auditExportRequests,
    retentionSettings: state.retentionSettings,
    approvalRequests: byInvocation(state.approvalRequests),
    policyDecisionRecords: byInvocation(state.policyDecisionRecords),
    troubleshootingReports: byInvocation(state.troubleshootingReports),
    agentUsageSummaries: state.agentUsageSummaries,
    codexSessions: byInvocation(state.codexSessions),
    codexWorkspaces: byInvocation(state.codexWorkspaces),
    codexEvidenceRecords: byInvocation(state.codexEvidenceRecords),
    codexChangeReviews: byInvocation(state.codexChangeReviews),
    codexHookEvents: byInvocation(state.codexHookEvents),
    codexApprovalQueue: codexApprovalQueue().filter((q) => invVisible(q?.invocationId)),
    // The evidence center aggregates raw codex state, so re-apply scoping here:
    // invocation-linked rows by invVisible, imported rows by their owning team.
    // (Rows with a null invocationId that aren't imported — e.g. manual terminal
    // surface evidence — stay visible; those are device-scoped by design.)
    evidenceCenterRecords: evidenceCenterRecords().filter((r) =>
      r?.type === "imported_evidence" ? visibleImportedIds.has(r.id) : invVisible(r?.invocationId),
    ),
    codexApprovalBrokerRequests: byInvocation(state.codexApprovalBrokerRequests),
    codexImportedEvidenceRecords: visibleImported,
    terminalRuntimeCapability: state.terminalRuntimeCapability,
    terminalSessions: state.terminalSessions,
    terminalEvidenceRecords: state.terminalEvidenceRecords,
    terminalBridgeActions: state.terminalBridgeActions,
    sshTargets: state.sshTargets,
    sshConnectionTests: state.sshConnectionTests,
  };
}

function groupRecoveryEventsByRequestId(events) {
  const grouped = new Map();
  for (const event of events ?? []) {
    const requestId = typeof event?.data?.recoveryActionRequestId === "string"
      ? event.data.recoveryActionRequestId
      : null;
    if (!requestId) continue;
    const items = grouped.get(requestId) ?? [];
    items.push(event);
    grouped.set(requestId, items);
  }
  return grouped;
}

function applicationRecoveryActionReadModel(request, invocationsById, events = []) {
  const sourceInvocation = invocationsById.get(request.invocationId) ?? null;
  const resultInvocation = request.resultInvocationId
    ? invocationsById.get(request.resultInvocationId) ?? null
    : null;
  const outcome = applicationRecoveryOutcome(request, resultInvocation);
  return {
    ...request,
    outcome,
    outcomeReason: outcome.reason,
    sourceInvocation: sourceInvocation ? invocationBrief(sourceInvocation) : null,
    resultInvocation: resultInvocation ? invocationBrief(resultInvocation) : null,
    timeline: applicationRecoveryTimeline(request, events),
  };
}

function applicationRecoveryTimeline(request, events) {
  const entries = (events ?? [])
    .map((event) => ({
      id: event.id,
      type: event.type,
      status: recoveryTimelineStatus(event, request),
      level: event.level ?? "info",
      message: event.message ?? "",
      createdAt: event.createdAt,
    }))
    .sort(compareTimelineEntries);
  if (entries.length > 0) return entries;
  return [{
    id: `${request.id}:created`,
    type: "application_orchestration_recovery_action_created",
    status: request.status ?? "requested",
    level: request.status === "failed" ? "warn" : "info",
    message: `Application orchestration recovery action ${request.actionType} recorded.`,
    createdAt: request.createdAt,
  }];
}

function recoveryTimelineStatus(event, request) {
  const type = event?.type ?? "";
  const eventStatus = typeof event?.data?.status === "string" ? event.data.status : null;
  if (type === "application_orchestration_recovery_action_requested") {
    return eventStatus === "approval_pending" ? "approval_pending" : "requested";
  }
  if (type === "application_orchestration_recovery_approval_requested") return "approval_pending";
  if (type === "application_orchestration_recovery_approval_resolved") {
    return eventStatus ? `approval_${eventStatus}` : "approval_resolved";
  }
  if (type === "application_orchestration_recovery_action_executing") return "executing";
  if (type === "application_orchestration_recovery_action_executed") return "executed";
  if (type === "application_orchestration_recovery_action_failed") return "failed";
  if (type === "application_orchestration_recovery_action_rejected") return "rejected";
  return eventStatus ?? request.status ?? "recorded";
}

function compareTimelineEntries(left, right) {
  const leftTime = Date.parse(left?.createdAt ?? "");
  const rightTime = Date.parse(right?.createdAt ?? "");
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
}

function applicationRecoveryOutcome(request, resultInvocation) {
  if (request.status === "failed" || request.status === "unsupported") {
    return {
      state: "needs_attention",
      reason: request.error ?? "execution_failed_before_result",
      severity: "danger",
      summary: request.error ? `Recovery failed: ${request.error}.` : "Recovery failed before a result invocation was created.",
      nextStep: "Review the failure details and choose another recovery action.",
    };
  }
  if (["approval_pending", "approval_approved", "requested", "executing"].includes(request.status)) {
    return {
      state: "pending",
      reason: pendingRecoveryReason(request.status),
      severity: "info",
      summary: "Recovery is still pending or executing.",
      nextStep: request.status === "approval_pending"
        ? "Resolve the linked approval request before this recovery can execute."
        : "Wait for the recovery action to finish, then inspect the result invocation.",
    };
  }
  if (["approval_denied", "approval_timed_out"].includes(request.status)) {
    return {
      state: "needs_attention",
      reason: request.status,
      severity: "warning",
      summary: "Recovery approval did not complete.",
      nextStep: "Request approval again or choose a different recovery action.",
    };
  }
  if (!request.resultInvocationId) {
    const noop = request.status === "noop";
    return {
      state: noop ? "pending" : "needs_attention",
      reason: noop ? "no_result_expected" : "missing_result_invocation",
      severity: noop ? "info" : "warning",
      summary: noop ? "Recovery action did not create a new invocation." : "Recovery executed without a linked result invocation.",
      nextStep: noop ? "Inspect the source invocation evidence." : "Review the recovery action audit trail and retry if needed.",
    };
  }
  if (!resultInvocation) {
    return {
      state: "needs_attention",
      reason: "result_invocation_not_visible",
      severity: "warning",
      summary: "Recovery result invocation is no longer visible.",
      nextStep: "Check tenancy scope or retention before deciding whether to retry.",
    };
  }
  if (["succeeded", "completed"].includes(resultInvocation.status)) {
    return {
      state: "recovered",
      reason: "result_succeeded",
      severity: "success",
      summary: "Recovered invocation completed successfully.",
      nextStep: "No immediate action is required.",
    };
  }
  if (["failed", "cancelled", "denied"].includes(resultInvocation.status)) {
    return {
      state: "still_failed",
      reason: `result_${resultInvocation.status}`,
      severity: "danger",
      summary: `Recovered invocation ended as ${resultInvocation.status}.`,
      nextStep: "Open the recovered invocation, review the failure, and choose another recovery path.",
    };
  }
  return {
    state: "pending",
    reason: "result_in_progress",
    severity: "info",
    summary: `Recovered invocation is ${resultInvocation.status ?? "in progress"}.`,
    nextStep: "Wait for the recovered invocation to complete.",
  };
}

function pendingRecoveryReason(status) {
  if (status === "approval_pending") return "approval_pending";
  if (status === "approval_approved") return "approval_approved";
  if (status === "executing") return "recovery_executing";
  return "recovery_requested";
}

function invocationBrief(invocation) {
  return {
    id: invocation.id,
    status: invocation.status ?? null,
    agentId: invocation.agentId ?? null,
    createdAt: invocation.createdAt ?? null,
    updatedAt: invocation.updatedAt ?? null,
    completedAt: invocation.completedAt ?? null,
  };
}

function compareReviewFindings(left, right) {
  const rightTime = Date.parse(right?.createdAt ?? "");
  const leftTime = Date.parse(left?.createdAt ?? "");
  if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) {
    return rightTime - leftTime;
  }
  return String(right?.id ?? "").localeCompare(String(left?.id ?? ""));
}
