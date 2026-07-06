import { LOCAL_TEAM_ID, agentVisibleToActor, teamOf } from "../runtime/auth.mjs";
import { publicDeviceView } from "../runtime/bridge-auth.mjs";
import { publicApplicationSnapshot } from "../services/applications.mjs";

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
  const sshTargetTeam = new Map((state.sshTargets ?? []).map((target) => [target.id, target.ownerTeamId ?? LOCAL_TEAM_ID]));
  const projectVisible = (projectId) => {
    if (teamId == null || !projectId) return true; // unscoped, or a global/unowned row
    const owner = projectTeam.get(projectId);
    // An unknown/dangling projectId is NOT visible when scoped — defaulting to
    // the viewer's own team would leak every orphaned row to every team.
    return owner !== undefined && owner === teamId;
  };
  const sshTargetVisible = (target) =>
    teamId == null || (target?.ownerTeamId ?? LOCAL_TEAM_ID) === teamId;
  const sshTargetIdVisible = (targetId) => {
    if (teamId == null || !targetId) return true;
    const owner = sshTargetTeam.get(targetId);
    return owner !== undefined && owner === teamId;
  };
  const eventVisible = (event) => {
    if (!String(event?.type ?? "").startsWith("ssh.target.")) return true;
    return sshTargetIdVisible(event?.data?.targetId);
  };
  const projects = (state.projects ?? []).filter((p) => projectVisible(p.id));
  const visibleInvocations = (state.invocations ?? []).filter((inv) => projectVisible(inv.projectId));
  const visibleInvIds = new Set(visibleInvocations.map((inv) => inv.id));
  const visibleInvocationsById = new Map(visibleInvocations.map((invocation) => [invocation.id, invocation]));
  const invVisible = (invocationId) =>
    teamId == null || !invocationId || visibleInvIds.has(invocationId);
  const byInvocation = (rows) => (rows ?? []).filter((r) => invVisible(r?.invocationId));
  const byProject = (rows) => (rows ?? []).filter((r) => projectVisible(r?.projectId));
  const visibleEvents = byInvocation(state.events).filter(eventVisible);
  const eventsByInvocationId = groupRowsByKey(visibleEvents, (event) => event?.invocationId);
  const recoveryEventsByRequestId = groupRecoveryEventsByRequestId(visibleEvents);
  const applications = (state.applications ?? []).filter((application) => {
    if (application?.projectId) return projectVisible(application.projectId);
    return teamId == null || (application?.ownerTeamId ?? LOCAL_TEAM_ID) === teamId;
  });
  const importedUsagePublic = (rows) => byInvocation(rows).map(({ raw, ...row }) => row);
  const codexReviewFindings = byInvocation(state.codexReviewFindings).map(({ raw, ...row }) => row);
  const codexChangePlans = byInvocation(state.codexChangePlans).map(({ raw, ...row }) => row);
  const codexPatchProposals = byInvocation(state.codexPatchProposals).map(({ raw, ...row }) => row);
  const claudeReviewFindings = byInvocation(state.claudeReviewFindings).map(({ raw, ...row }) => row);
  const reviewFindings = [...codexReviewFindings, ...claudeReviewFindings].sort(compareReviewFindings);
  // Imported evidence has no invocation, so it can't ride byInvocation (a null
  // invocationId reads as globally visible). Scope it by its stamped owning team
  // instead; rows written before that stamp existed belong to the local team.
  const importedVisible = (r) => teamId == null || (r?.teamId ?? LOCAL_TEAM_ID) === teamId;
  const visibleImported = (state.codexImportedEvidenceRecords ?? []).filter(importedVisible);
  const visibleImportedIds = new Set(visibleImported.map((r) => r.id));
  const terminalSessionTeamId = (session) => {
    if (session?.ownerTeamId) return session.ownerTeamId;
    const owner = (state.users ?? []).find((user) => user.id === session?.userId);
    return owner?.teamId ?? LOCAL_TEAM_ID;
  };
  const terminalSessionVisible = (session) =>
    teamId == null || terminalSessionTeamId(session) === teamId;
  const terminalSessions = (state.terminalSessions ?? []).filter(terminalSessionVisible);
  const visibleTerminalSessionIds = new Set(terminalSessions.map((session) => session.terminalSessionId));
  const terminalEvidenceRecords = (state.terminalEvidenceRecords ?? []).filter((evidence) =>
    teamId == null || visibleTerminalSessionIds.has(evidence?.terminalSessionId),
  );
  const visibleTerminalEvidenceIds = new Set(terminalEvidenceRecords.map((evidence) => evidence.id));
  const terminalBridgeActions = (state.terminalBridgeActions ?? []).filter((action) =>
    teamId == null || visibleTerminalSessionIds.has(action?.terminalSessionId),
  );
  const sshTargets = (state.sshTargets ?? []).filter(sshTargetVisible);
  const visibleSshTargetIds = new Set(sshTargets.map((target) => target.id));
  const sshConnectionTests = (state.sshConnectionTests ?? []).filter((test) =>
    teamId == null || visibleSshTargetIds.has(test?.targetId),
  );
  // A compare run is visible when it spans at least one invocation the team can
  // see; unscoped mode passes everything through.
  const byCompareRun = (rows) =>
    (rows ?? []).filter(
      (r) => teamId == null || (r?.childInvocationIds ?? []).some((id) => visibleInvIds.has(id)),
    );
  const compareRuns = byCompareRun(state.compareRuns);
  const compareRunsById = new Map(compareRuns.map((compareRun) => [compareRun.id, compareRun]));
  const applicationRecoveryActions = byInvocation(state.applicationRecoveryActions)
    .map((request) => applicationRecoveryActionReadModel(
      request,
      visibleInvocationsById,
      recoveryEventsByRequestId.get(request.id) ?? [],
    ));
  const applicationRecoveryActionsByInvocationId = groupRowsByKey(
    applicationRecoveryActions,
    (request) => request?.invocationId,
  );
  const applicationRecoveryActionsByResultInvocationId = groupRowsByKey(
    applicationRecoveryActions.filter((request) => request?.resultInvocationId),
    (request) => request?.resultInvocationId,
  );
  const approvalRequests = byInvocation(state.approvalRequests);
  const approvalRequestsById = new Map(approvalRequests.map((approval) => [approval.id, approval]));
  const approvalRequestsByInvocationId = groupRowsByKey(approvalRequests, (approval) => approval?.invocationId);
  const policyDecisionRecords = byInvocation(state.policyDecisionRecords);
  const policyDecisionRecordsById = new Map(policyDecisionRecords.map((record) => [record.id, record]));
  const policyDecisionRecordsByInvocationId = groupRowsByKey(policyDecisionRecords, (record) => record?.invocationId);
  const auditSummaries = byInvocation(state.auditSummaries);
  const auditSummariesByInvocationId = groupRowsByKey(auditSummaries, (audit) => audit?.invocationId);
  const troubleshootingReports = byInvocation(state.troubleshootingReports);
  const troubleshootingReportsByInvocationId = groupRowsByKey(
    troubleshootingReports,
    (report) => report?.invocationId,
  );
  const autoRuns = byProject(state.autoRuns);
  const autoRunsByInvocationId = groupRowsByKey(
    autoRuns.filter((autoRun) => visibleInvIds.has(autoRun?.invocationId)),
    (autoRun) => autoRun?.invocationId,
  );
  const invocations = visibleInvocations.map((invocation) => ({
    ...invocation,
    explanation: buildInvocationExplanation(invocation, {
      applicationRecoveryActionsByInvocationId,
      applicationRecoveryActionsByResultInvocationId,
      approvalRequestsById,
      approvalRequestsByInvocationId,
      auditSummariesByInvocationId,
      autoRunsByInvocationId,
      compareRunsById,
      eventsByInvocationId,
      invocationsById: visibleInvocationsById,
      policyDecisionRecordsById,
      policyDecisionRecordsByInvocationId,
      troubleshootingReportsByInvocationId,
    }),
  }));

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
    applications: applications.map(publicApplicationSnapshot),
    applicationRecoveryActions,
    projectTargets: byProject(state.projectTargets),
    currentProjectId: state.currentProjectId,
    currentProject: currentProject(),
    loopRoutines: loopRoutineReadModel(),
    worktrees: byProject(state.worktrees),
    agent: defaultAgent(),
    agents: (state.agents ?? []).filter((agent) => agentVisibleToActor(state, agent, actor)),
    invocations,
    compareRuns,
    events: visibleEvents,
    traces: byInvocation(state.traces),
    spans: byInvocation(state.spans),
    auditSummaries,
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
    codexChangePlans,
    codexPatchProposals,
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
    approvalRequests,
    policyDecisionRecords,
    troubleshootingReports,
    agentUsageSummaries: state.agentUsageSummaries,
    codexSessions: byInvocation(state.codexSessions),
    codexWorkspaces: byInvocation(state.codexWorkspaces),
    codexEvidenceRecords: byInvocation(state.codexEvidenceRecords),
    codexChangeReviews: byInvocation(state.codexChangeReviews),
    codexHookEvents: byInvocation(state.codexHookEvents),
    codexApprovalQueue: codexApprovalQueue().filter((q) => invVisible(q?.invocationId)),
    // The evidence center aggregates raw codex/terminal state, so re-apply
    // scoping here: invocation-linked rows by invVisible, imported rows by
    // owning team, and terminal rows by their owning terminal session.
    evidenceCenterRecords: evidenceCenterRecords().filter((r) =>
      r?.type === "imported_evidence"
        ? visibleImportedIds.has(r.id)
        : r?.source === "managed_terminal_runtime"
          ? visibleTerminalEvidenceIds.has(r.id)
          : invVisible(r?.invocationId),
    ),
    codexApprovalBrokerRequests: byInvocation(state.codexApprovalBrokerRequests),
    codexImportedEvidenceRecords: visibleImported,
    terminalRuntimeCapability: state.terminalRuntimeCapability,
    terminalSessions,
    terminalEvidenceRecords,
    terminalBridgeActions,
    sshTargets,
    sshConnectionTests,
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

function groupRowsByKey(rows, keyFor) {
  const grouped = new Map();
  for (const row of rows ?? []) {
    const key = keyFor(row);
    if (!key) continue;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  return grouped;
}

export function buildInvocationExplanation(invocation, context = {}) {
  const status = invocation?.status ?? "unknown";
  const metadata = objectValue(invocation?.options?.metadata);
  const recoveryRequest = latestRow([
    ...(context.applicationRecoveryActionsByInvocationId?.get(invocation.id) ?? []),
    ...(context.applicationRecoveryActionsByResultInvocationId?.get(invocation.id) ?? []),
  ]);
  const recovery = invocationRecoveryExplanation(recoveryRequest, invocation);
  const approval = invocationApprovalExplanation(invocation, context);
  const source = invocationSourceExplanation(invocation, context, metadata, recoveryRequest);
  const report = latestRow(context.troubleshootingReportsByInvocationId?.get(invocation.id) ?? []);
  const policy = invocationPolicyRecord(invocation, context);
  const audit = latestRow(context.auditSummariesByInvocationId?.get(invocation.id) ?? []);
  const event = latestOperatorEvent(context.eventsByInvocationId?.get(invocation.id) ?? []);

  const summary = recovery?.summary
    ?? statusSummary(invocation, { approval, audit, event, policy, report });
  const reason = recovery?.reasonText
    ?? statusReason(invocation, { approval, audit, event, policy, report });
  const reasonCode = recovery?.reasonCode
    ?? statusReasonCode(invocation, { approval, audit, event, policy, report });
  const waitingOn = recovery?.waitingOn
    ?? statusWaitingOn(invocation, { approval, source });
  const resultLocation = recovery?.resultLocation
    ?? statusResultLocation(invocation, { audit, report });
  const nextAction = recovery?.nextAction
    ?? statusNextAction(invocation, { approval, report });

  return {
    state: invocationExplanationState(status, recovery, approval),
    reason,
    reasonCode,
    summary,
    waitingOn,
    resultLocation,
    nextAction,
    recovery: recovery?.request ?? null,
    approval: approval?.request ?? null,
    source,
  };
}

function invocationRecoveryExplanation(request, invocation) {
  if (!request) return null;
  const explanation = request.explanation ?? {};
  const outcome = request.outcome ?? {};
  const isResultInvocation = request.resultInvocationId === invocation?.id;
  const actionLabel = request.actionType ?? explanation.selectedAction ?? "recovery";
  const requestSummary = explanation.summary ?? outcome.summary ?? request.reason ?? null;
  const summary = isResultInvocation
    ? `This invocation is the result of ${actionLabel} recovery for ${request.invocationId}.`
    : requestSummary ?? `Recovery action ${actionLabel} is ${request.status ?? "recorded"}.`;
  const reasonCode = explanation.reason ?? outcome.reason ?? request.error ?? request.status ?? null;
  const reasonText = recoveryReasonText(request, isResultInvocation, reasonCode);
  const waitingOn = request.status === "approval_pending" || request.approvalRequestId
    ? {
        type: "approval",
        id: request.approvalRequestId ?? null,
        status: request.status === "approval_pending" ? "pending" : request.status ?? null,
        label: request.approvalRequestId
          ? `${request.approvalRequestId} (${request.status === "approval_pending" ? "pending approval" : request.status ?? "recorded"})`
          : "Recovery approval",
      }
    : null;
  const resultLocation = request.resultInvocationId
    ? {
        type: "invocation",
        invocationId: request.resultInvocationId,
        label: request.resultInvocationId,
      }
    : request.resultOrchestrationId
      ? {
          type: "orchestration",
          orchestrationId: request.resultOrchestrationId,
          relativePath: request.resultOrchestrationRelativePath ?? null,
          label: request.resultOrchestrationRelativePath ?? request.resultOrchestrationId,
        }
      : null;
  return {
    reasonCode,
    reasonText,
    summary,
    waitingOn,
    resultLocation,
    nextAction: explanation.nextStep ?? outcome.nextStep ?? recoveryNextAction(request),
    request: {
      category: request.recoveryCategory ?? explanation.recoveryCategory ?? null,
      actionType: request.actionType ?? explanation.selectedAction ?? null,
      actionRequestId: request.id ?? explanation.recoveryActionRequestId ?? null,
      status: request.status ?? null,
      sourceInvocationId: request.invocationId ?? null,
      approvalRequestId: request.approvalRequestId ?? explanation.approvalRequestId ?? null,
      resultInvocationId: request.resultInvocationId ?? explanation.resultInvocationId ?? null,
      resultOrchestrationId: request.resultOrchestrationId ?? explanation.resultOrchestrationId ?? null,
      resultOrchestrationRelativePath: request.resultOrchestrationRelativePath ?? explanation.resultOrchestrationRelativePath ?? null,
    },
  };
}

function recoveryReasonText(request, isResultInvocation, reasonCode) {
  if (isResultInvocation) return `Recovery result for ${request.invocationId}.`;
  if (request.status === "approval_pending") return "Recovery action is waiting for approval.";
  if (request.status === "executing") return "Recovery action is executing.";
  if (request.status === "executed") return "Recovery action executed.";
  if (request.status === "failed") return request.error ?? "Recovery action failed.";
  if (request.status === "approval_denied") return "Recovery approval was denied.";
  if (request.status === "approval_timed_out") return "Recovery approval timed out.";
  return reasonCode ? String(reasonCode).replaceAll("_", " ") : "Recovery action recorded.";
}

function recoveryNextAction(request) {
  if (request.status === "approval_pending") return "Resolve the linked approval request before this recovery can execute.";
  if (request.resultInvocationId) return "Inspect the recovery result invocation.";
  if (request.status === "failed") return "Review the failure details and choose another recovery action.";
  return "Review the recovery action audit trail.";
}

function invocationApprovalExplanation(invocation, context) {
  const request = invocation?.approvalRequestId
    ? context.approvalRequestsById?.get(invocation.approvalRequestId) ?? null
    : latestRow(context.approvalRequestsByInvocationId?.get(invocation?.id) ?? []);
  if (!request) return null;
  return {
    request: {
      requestId: request.id,
      status: request.status ?? null,
      riskLevel: request.riskLevel ?? null,
      riskTags: request.riskTags ?? [],
      decidedBy: request.decidedBy ?? null,
      decidedAt: request.decidedAt ?? null,
    },
  };
}

function invocationPolicyRecord(invocation, context) {
  return invocation?.policyDecisionId
    ? context.policyDecisionRecordsById?.get(invocation.policyDecisionId) ?? null
    : latestRow(context.policyDecisionRecordsByInvocationId?.get(invocation?.id) ?? []);
}

function invocationSourceExplanation(invocation, context, metadata, recoveryRequest) {
  const compareRunId = invocation?.compareRunId ?? stringOrNull(metadata.compareRunId);
  const autoRun = latestRow(context.autoRunsByInvocationId?.get(invocation?.id) ?? []);
  if (recoveryRequest?.resultInvocationId === invocation?.id) {
    return {
      type: "recovery_result",
      invocationId: recoveryRequest.invocationId ?? null,
      recoveryActionRequestId: recoveryRequest.id ?? null,
      actionType: recoveryRequest.actionType ?? null,
    };
  }
  if (stringOrNull(metadata.targetInvocationId)) {
    return {
      type: "troubleshooting",
      targetInvocationId: stringOrNull(metadata.targetInvocationId),
    };
  }
  if (metadata.source === "application_orchestration" || stringOrNull(metadata.applicationId)) {
    return {
      type: "application_orchestration",
      applicationId: stringOrNull(metadata.applicationId),
      applicationName: stringOrNull(metadata.applicationName),
      routineId: stringOrNull(metadata.routineId),
      routineName: stringOrNull(metadata.routineName),
      orchestrationRelativePath: stringOrNull(metadata.orchestrationRelativePath),
      recoveryOfInvocationId: stringOrNull(metadata.recoveryOfInvocationId),
      recoveryActionType: stringOrNull(metadata.recoveryActionType),
    };
  }
  if (stringOrNull(metadata.automationId)) {
    return {
      type: "automation",
      automationId: stringOrNull(metadata.automationId),
      automationName: stringOrNull(metadata.automationName),
      scheduled: Boolean(metadata.scheduled),
    };
  }
  if (autoRun) {
    return {
      type: "auto_run",
      autoRunId: autoRun.id ?? null,
      status: autoRun.status ?? null,
      worktreeId: autoRun.worktreeId ?? null,
      link: autoRun.link ?? null,
    };
  }
  if (compareRunId) {
    const compareRun = context.compareRunsById?.get(compareRunId) ?? null;
    return {
      type: "compare_run",
      compareRunId,
      status: compareRun?.status ?? null,
      preferredInvocationId: compareRun?.preferredInvocationId ?? null,
      siblingInvocationIds: (compareRun?.childInvocationIds ?? []).filter((id) => id !== invocation?.id),
    };
  }
  if (metadata.source === "tool" || stringOrNull(metadata.toolName)) {
    return {
      type: "tool",
      toolName: stringOrNull(metadata.toolName),
      outputCollection: stringOrNull(metadata.outputCollection),
    };
  }
  return { type: "direct" };
}

function statusSummary(invocation, { approval, audit, event, policy, report }) {
  const status = invocation?.status;
  if (status === "waiting_for_local_approval") return policy?.reason ?? "Invocation is blocked until local approval is resolved.";
  if (status === "rejected") return audit?.errorSummary ?? policy?.reason ?? "Invocation was rejected before execution.";
  if (status === "failed" || status === "timed_out") {
    return audit?.errorSummary ?? invocation?.result?.summary ?? event?.message ?? `Invocation ${status}.`;
  }
  if (status === "cancelled") return invocation?.cancellation?.reason ?? audit?.errorSummary ?? "Invocation was cancelled.";
  if (status === "cancelling") return "Cancellation was requested and is waiting for the runner to stop.";
  if (status === "succeeded") return invocation?.result?.summary ?? "Invocation completed successfully.";
  if (status === "queued") return "Invocation is queued for execution.";
  if (status === "dispatching") return "Invocation is being dispatched to the runner.";
  if (status === "running") return "Invocation is running.";
  if (report?.summary) return report.summary;
  if (approval?.request?.status === "denied") return "Local approval was denied.";
  return `Invocation status is ${status ?? "unknown"}.`;
}

function statusReason(invocation, { approval, audit, event, policy }) {
  const status = invocation?.status;
  if (status === "waiting_for_local_approval") return policy?.reason ?? "Local approval is required before this invocation can run.";
  if (status === "rejected") {
    if (approval?.request?.status === "denied") return "Local approval was denied before execution.";
    return audit?.errorSummary ?? policy?.reason ?? "Invocation was rejected before execution.";
  }
  if (status === "failed" || status === "timed_out") return audit?.errorSummary ?? event?.message ?? `Invocation ${status}.`;
  if (status === "cancelled") return invocation?.cancellation?.reason ?? "Invocation was cancelled before completion.";
  if (status === "queued") return "Waiting for an eligible runner.";
  if (status === "running" || status === "dispatching" || status === "cancelling") return "Work is still in progress.";
  if (status === "succeeded") return "Invocation succeeded.";
  return "No blocking reason is recorded.";
}

function statusReasonCode(invocation, { approval }) {
  const status = invocation?.status;
  if (status === "waiting_for_local_approval") return "local_approval_pending";
  if (status === "rejected" && approval?.request?.status === "denied") return "local_approval_denied";
  if (status === "rejected") return "rejected";
  if (status === "failed") return "failed";
  if (status === "timed_out") return "timed_out";
  if (status === "cancelled") return "cancelled";
  if (status === "queued") return "queued";
  if (status === "running" || status === "dispatching") return "in_progress";
  if (status === "succeeded") return "succeeded";
  return status ?? "unknown";
}

function statusWaitingOn(invocation, { approval, source }) {
  if (invocation?.status === "waiting_for_local_approval" && approval?.request) {
    return {
      type: "approval",
      id: approval.request.requestId,
      status: approval.request.status,
      label: `${approval.request.requestId} (${approval.request.status ?? "pending"})`,
    };
  }
  if (invocation?.status === "queued") {
    return {
      type: "runner",
      id: invocation.delivery?.deviceId ?? null,
      status: invocation.delivery?.state ?? "queued",
      label: invocation.delivery?.deviceId
        ? `${invocation.delivery.deviceId} (${invocation.delivery?.state ?? "queued"})`
        : "eligible runner",
    };
  }
  if (invocation?.status === "cancelling") {
    return {
      type: "runner",
      id: invocation.delivery?.deviceId ?? null,
      status: invocation.cancellation?.state ?? "requested",
      label: "runner cancellation acknowledgement",
    };
  }
  if (source?.type === "compare_run" && source.status === "running") {
    return {
      type: "compare_run",
      id: source.compareRunId,
      status: source.status,
      label: `${source.compareRunId} sibling results`,
    };
  }
  return null;
}

function statusResultLocation(invocation, { audit, report }) {
  if (report?.id) {
    return {
      type: "troubleshooting_report",
      reportId: report.id,
      label: report.id,
    };
  }
  if (invocation?.result) {
    return {
      type: "invocation_result",
      invocationId: invocation.id,
      label: invocation.result?.summary ?? invocation.id,
    };
  }
  if (audit) {
    return {
      type: "audit_summary",
      invocationId: invocation.id,
      label: audit.errorSummary ?? audit.resultSummary ?? "audit summary",
    };
  }
  return null;
}

function statusNextAction(invocation, { approval, report }) {
  const status = invocation?.status;
  if (status === "waiting_for_local_approval") return "Approve or deny the local approval request.";
  if (status === "rejected") return "Review the policy or approval decision, then retry only if the risk is acceptable.";
  if (status === "failed" || status === "timed_out") {
    return report?.id
      ? "Open the troubleshooting report and choose an approved remediation path."
      : "Review the timeline, run troubleshooting, or retry with adjusted inputs.";
  }
  if (status === "cancelled") return "Retry the invocation only if the work is still needed.";
  if (status === "cancelling") return "Wait for cancellation acknowledgement before starting replacement work.";
  if (status === "queued") return "Keep the target runner available and wait for dispatch.";
  if (status === "dispatching" || status === "running") return "Wait for the invocation to finish, then inspect the result.";
  if (status === "succeeded") return "Review the result and any generated evidence.";
  if (approval?.request?.status === "pending") return "Resolve the pending approval request.";
  return "Review the invocation timeline for the latest operator action.";
}

function invocationExplanationState(status, recovery, approval) {
  if (recovery?.request?.status === "approval_pending") return "approval_pending";
  if (recovery?.request?.status) return `recovery_${recovery.request.status}`;
  if (status === "waiting_for_local_approval") return "approval_pending";
  if (status === "rejected" && approval?.request?.status === "denied") return "approval_denied";
  return status ?? "unknown";
}

function latestOperatorEvent(events) {
  return latestRow((events ?? []).filter((event) =>
    ["invocation_failed", "invocation_timed_out", "invocation_rejected", "local_approval_denied", "cancel_applied", "cancel_failed"].includes(event?.type),
  ));
}

function latestRow(rows) {
  const items = (rows ?? []).filter(Boolean);
  if (items.length === 0) return null;
  return items.slice().sort(compareUpdatedDesc)[0];
}

function compareUpdatedDesc(left, right) {
  const rightTime = Date.parse(right?.updatedAt ?? right?.createdAt ?? right?.completedAt ?? "");
  const leftTime = Date.parse(left?.updatedAt ?? left?.createdAt ?? left?.completedAt ?? "");
  if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) {
    return rightTime - leftTime;
  }
  return String(right?.id ?? "").localeCompare(String(left?.id ?? ""));
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function applicationRecoveryActionReadModel(request, invocationsById, events = []) {
  const sourceInvocation = invocationsById.get(request.invocationId) ?? null;
  const resultInvocation = request.resultInvocationId
    ? invocationsById.get(request.resultInvocationId) ?? null
    : null;
  const outcome = applicationRecoveryOutcome(request, resultInvocation);
  const explanation = applicationRecoveryExplanation(request, outcome);
  return {
    ...request,
    outcome,
    outcomeReason: outcome.reason,
    explanation,
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

function applicationRecoveryExplanation(request, outcome) {
  return {
    selectedAction: request.actionType ?? null,
    state: recoveryExplanationState(request),
    reason: request.error ?? outcome.reason,
    summary: outcome.summary,
    nextStep: outcome.nextStep,
    outcomeState: outcome.state,
    recoveryCategory: request.recoveryCategory ?? null,
    recoveryActionRequestId: request.id ?? null,
    approvalRequestId: request.approvalRequestId ?? null,
    requestedAgentId: request.requestedAgentId ?? null,
    selectedAgentId: request.selectedAgentId ?? null,
    resultInvocationId: request.resultInvocationId ?? null,
    resultOrchestrationId: request.resultOrchestrationId ?? null,
    resultOrchestrationRelativePath: request.resultOrchestrationRelativePath ?? null,
  };
}

function recoveryExplanationState(request) {
  if (request.status === "noop") return "no_result_expected";
  if (request.status === "approval_pending") return "approval_pending";
  if (request.status === "approval_denied" || request.status === "approval_timed_out") return request.status;
  if (request.status === "unsupported") return "unsupported";
  if (request.status === "failed") return "failed";
  if (request.status === "executed") return "executed";
  if (request.status === "executing") return "executing";
  return request.status ?? "requested";
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
