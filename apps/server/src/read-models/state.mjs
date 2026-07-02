import { LOCAL_TEAM_ID, teamOf } from "../runtime/auth.mjs";

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
  const invVisible = (invocationId) =>
    teamId == null || !invocationId || visibleInvIds.has(invocationId);
  const byInvocation = (rows) => (rows ?? []).filter((r) => invVisible(r?.invocationId));
  const byProject = (rows) => (rows ?? []).filter((r) => projectVisible(r?.projectId));
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
    device: state.device,
    // Never expose password hashes to any client.
    users: (state.users ?? []).map(({ passwordHash, ...user }) => user),
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
    compareRuns: byCompareRun(state.compareRuns),
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
    quotaDecisionRecords: byInvocation(state.quotaDecisionRecords),
    quotaPolicies: state.quotaPolicies,
    aiUsageRecords: byInvocation(state.aiUsageRecords),
    ledgerEntries: byProject(state.ledgerEntries),
    ledgerSummary: typeof ledgerSummary === "function" ? ledgerSummary() : null,
    budgets: byProject(state.budgets),
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
