import { teamOf } from "../runtime/auth.mjs";

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
  actor = null,
}) {
  // Tenancy scoping. With no actor (or one whose team owns everything, i.e.
  // single-team local dev) this is a pass-through; it only filters once a
  // second team exists. A row is visible when it carries no owning key (global)
  // or its project/invocation belongs to the actor's team.
  const teamId = actor?.teamId ?? null;
  const projectTeam = new Map((state.projects ?? []).map((p) => [p.id, teamOf(p)]));
  const projectVisible = (projectId) =>
    teamId == null || !projectId || (projectTeam.get(projectId) ?? teamId) === teamId;
  const projects = (state.projects ?? []).filter((p) => projectVisible(p.id));
  const invocations = (state.invocations ?? []).filter((inv) => projectVisible(inv.projectId));
  const visibleInvIds = new Set(invocations.map((inv) => inv.id));
  const invVisible = (invocationId) =>
    teamId == null || !invocationId || visibleInvIds.has(invocationId);
  const byInvocation = (rows) => (rows ?? []).filter((r) => invVisible(r?.invocationId));
  const byProject = (rows) => (rows ?? []).filter((r) => projectVisible(r?.projectId));

  return {
    namespace,
    protocolVersion,
    defaults: {
      cloneParentDir: defaultProjectPath,
    },
    device: state.device,
    users: state.users ?? [],
    teams: state.teams ?? [],
    projects,
    projectTargets: byProject(state.projectTargets),
    currentProjectId: state.currentProjectId,
    currentProject: currentProject(),
    loopRoutines: loopRoutineReadModel(),
    worktrees: byProject(state.worktrees),
    agent: defaultAgent(),
    agents: state.agents,
    invocations,
    compareRuns: state.compareRuns,
    events: byInvocation(state.events),
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
    quotaDecisionRecords: state.quotaDecisionRecords,
    quotaPolicies: state.quotaPolicies,
    aiUsageRecords: state.aiUsageRecords,
    ledgerEntries: byProject(state.ledgerEntries),
    ledgerSummary: typeof ledgerSummary === "function" ? ledgerSummary() : null,
    budgets: byProject(state.budgets),
    budgetStatuses: byProject(typeof budgetStatuses === "function" ? budgetStatuses() : []),
    automations: byProject(state.automations),
    agentSkills: state.agentSkills ?? [],
    privateDeploymentConfig: state.privateDeploymentConfig,
    auditExportRequests: state.auditExportRequests,
    retentionSettings: state.retentionSettings,
    approvalRequests: byInvocation(state.approvalRequests),
    policyDecisionRecords: byInvocation(state.policyDecisionRecords),
    troubleshootingReports: byInvocation(state.troubleshootingReports),
    agentUsageSummaries: state.agentUsageSummaries,
    codexSessions: state.codexSessions,
    codexWorkspaces: state.codexWorkspaces,
    codexEvidenceRecords: state.codexEvidenceRecords,
    codexChangeReviews: state.codexChangeReviews,
    codexHookEvents: state.codexHookEvents,
    codexApprovalQueue: codexApprovalQueue(),
    evidenceCenterRecords: evidenceCenterRecords(),
    codexApprovalBrokerRequests: state.codexApprovalBrokerRequests,
    codexImportedEvidenceRecords: state.codexImportedEvidenceRecords,
    terminalRuntimeCapability: state.terminalRuntimeCapability,
    terminalSessions: state.terminalSessions,
    terminalEvidenceRecords: state.terminalEvidenceRecords,
    terminalBridgeActions: state.terminalBridgeActions,
    sshTargets: state.sshTargets,
    sshConnectionTests: state.sshConnectionTests,
  };
}
