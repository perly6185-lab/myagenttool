import { createEventLogRuntime } from "./event-log.mjs";
import { createPersistenceRuntime } from "./persistence.mjs";
import { createReadModelRuntime } from "./read-models.mjs";
import {
  createAgentService,
  isAgentDisabled,
  normalizeStringArray,
} from "../services/agents.mjs";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { createAgentSkillService } from "../services/agent-skills.mjs";
import { createApplicationService, validateApplicationRoutineDraft } from "../services/applications.mjs";
import { createCapabilityService } from "../services/capabilities.mjs";
import { createCcusageImportService } from "../services/ccusage-imports.mjs";
import { createClaudeReviewImportService } from "../services/claude-review-imports.mjs";
import { createCodexReviewImportService } from "../services/codex-review-imports.mjs";
import { createCodexService } from "../services/codex.mjs";
import { createIntegrationService } from "../services/integrations.mjs";
import { createInvocationService } from "../services/invocations.mjs";
import { createM3Service } from "../services/m3.mjs";
import { createProjectService, sameProjectPath } from "../services/projects.mjs";
import { createTerminalService } from "../services/terminal.mjs";
import { createToolService } from "../services/tools.mjs";

export function createServerRuntimeServices({
  namespace,
  protocolVersion,
  state,
  defaultProject,
  defaultProjectPath,
  persistenceEnabled,
  stateStorePath,
  stateSchemaVersion,
  dispatchLeaseMs,
  now,
}) {
  let idCounter = 1;
  let invocationService = null;
  let codexEventHandlers = {
    createCodexEvidenceRecord: () => null,
    updateCodexSessionFromEvent: () => null,
  };

  const {
    persistStateSoon,
    restorePersistentState,
    savePersistentState,
  } = createPersistenceRuntime({
    state,
    enabled: persistenceEnabled,
    stateStorePath,
    schemaVersion: stateSchemaVersion,
    now,
    defaultProject,
    sameProjectPath,
  });
  restorePersistentState();

  const { appendEvent } = createEventLogRuntime({
    state,
    now,
    nextId,
    persistStateSoon,
    getCodexEventHandlers: () => codexEventHandlers,
  });

  const {
    addProject,
    cloneProject,
    createBlankProject,
    createWorktree,
    currentProject,
    gitProjectSummary,
    worktreeDiff,
    projectGithubItems,
    projectForInvocation,
    readProjectTree,
    removeProject,
    removeWorktree,
    searchProjectContent,
    selectProject,
    updateProject,
    worktreeForProject,
  } = createProjectService({ state, now, nextId, appendEvent, persistStateSoon });

  const {
    createAgentSkill,
    updateAgentSkill,
    deleteAgentSkill,
  } = createAgentSkillService({ state, now, nextId, persistStateSoon });

  const {
    findApplication,
    invokeApplicationCapability,
    listApplicationCapabilities,
    listApplications,
    probeApplication,
    registerApplication,
    transitionApplication,
  } = createApplicationService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    addProject,
    cloneProject,
    defaultProjectPath,
  });

  const {
    completeHealthCheck,
    createAgentHealthCheck,
    disableAgent,
    enableAgent,
    findAgent,
    markHealthCheckStarted,
    nextBridgeHealthCheck,
    registerAgent,
  } = createAgentService({ state, now, nextId, appendEvent });

  const {
    closeCodexSession,
    codexApprovalQueue,
    codexSessionForInvocation,
    createCodexChangeReview,
    createCodexEvidenceRecord,
    createCodexImportedEvidenceRecord,
    createManagedCodexSession,
    createManagedCodexWorkspace,
    expireCodexApprovalBrokerRequests,
    normalizeCodexApprovalMode,
    normalizeCodexSessionMode,
    normalizeCodexWorkspacePolicy,
    recordCodexHookEvent,
    repoPathForEvidence,
    resolveCodexApprovalBrokerRequest,
    updateCodexSessionFromEvent,
  } = createCodexService({
    state,
    now,
    nextId,
    appendEvent,
    currentProject,
    findInvocation,
    persistStateSoon,
    uniqueStrings,
    worktreeForProject,
  });
  codexEventHandlers = {
    createCodexEvidenceRecord,
    updateCodexSessionFromEvent,
  };

  const {
    createManagedTerminalSession,
    createSshConnectionTest,
    createSshTarget,
    nextTerminalBridgeAction,
    queueTerminalBridgeAction,
    recordTerminalBridgeEvent,
    recordTerminalEvidence,
  } = createTerminalService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    summarizeText,
    uniqueStrings,
    codexSessionForInvocation,
  });

  const {
    chargebackExport,
    completeLifecycleAction,
    createAuditExportRequest,
    createPrivateCatalogEntry,
    createSignedBundleManifest,
    createLifecycleRecipe,
    createQuotaPolicy,
    decideLifecycleLocalApproval,
    evaluateLifecyclePolicy,
    enforcePlatformAiQuota,
    budgetStatusFor,
    budgetStatuses,
    budgetGateForProject,
    findLifecycleLocalApproval,
    findLifecycleRollbackRequest,
    findLifecycleRecipe,
    findPrivateCatalogEntry,
    ledgerSummary,
    markLifecycleActionStarted,
    nextBridgeLifecycleAction,
    queueLifecycleAction,
    queueRollbackAction,
    recordAiUsage,
    recordInvocationLedgerEntry,
    requestLifecycleLocalApproval,
    transitionLifecycleRecipe,
    updatePrivateDeploymentConfig,
    upsertBudget,
  } = createM3Service({
    state,
    now,
    nextId,
    appendEvent,
    findAgent,
  });
  const { recordCcusageImportedEstimates } = createCcusageImportService({
    state,
    now,
    nextId,
    appendEvent,
  });
  const { recordCodexReviewFindings } = createCodexReviewImportService({
    state,
    now,
    nextId,
    appendEvent,
  });
  const { recordClaudeReviewFindings } = createClaudeReviewImportService({
    state,
    now,
    nextId,
    appendEvent,
  });

  invocationService = createInvocationService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    dispatchLeaseMs,
    namespace,
    protocolVersion,
    findAgent,
    enforcePlatformAiQuota,
    recordInvocationLedgerEntry,
    recordCcusageImportedEstimates,
    recordCodexReviewFindings,
    recordClaudeReviewFindings,
    currentProject,
    worktreeForProject,
    uniqueStrings,
    normalizeCodexApprovalMode,
    normalizeCodexSessionMode,
    normalizeCodexWorkspacePolicy,
    createManagedCodexWorkspace,
    createManagedCodexSession,
    closeCodexSession,
    budgetGateForProject,
  });

  const {
    acknowledgeInvocation,
    approveInvocation,
    cancelInvocation,
    cancelInvocationsForDeviceUnlink,
    completeInvocation,
    createCompareRun,
    createInvocation,
    createTroubleshootingReport,
    denyInvocation,
    getAgentUsageSummary,
    markDispatched,
    nextDispatchableInvocation,
    redeliverExpiredDispatches,
    startInvocationIfAllowed,
  } = invocationService;

  const {
    completeDiscoveryRun,
    completeIntegrationProbeRun,
    createDiscoveryRun,
    createIntegrationArtifact,
    createIntegrationProbeRun,
    draftIntegrationWithPlatformAgent,
    findDiscoveryRun,
    findIntegrationArtifact,
    findIntegrationProbeRun,
    generateIntegrationArtifacts,
    markDiscoveryStarted,
    markIntegrationProbeStarted,
    nextBridgeDiscoveryRun,
    nextBridgeProbeRun,
    registerDiscoveredCandidate,
    registerIntegrationArtifact,
    transitionIntegrationArtifact,
    updateIntegrationRetentionSettings,
  } = createIntegrationService({
    state,
    now,
    nextId,
    appendEvent,
    completeInvocation,
    createInvocation,
    disableAgent,
    findAgent,
    registerAgent,
  });

  const {
    currentLoopRoutineProjectContext,
    evidenceCenterRecords,
    publicState,
  } = createReadModelRuntime({
    namespace,
    protocolVersion,
    state,
    defaultProjectPath,
    currentProject,
    defaultAgent,
    codexApprovalQueue,
    codexSessionForInvocation,
    findInvocation,
    repoPathForEvidence,
    ledgerSummary,
    budgetStatuses,
    expireCodexApprovalBrokerRequests,
  });

  const {
    createToolInvocation,
    getTool,
    listTools,
  } = createToolService({
    state,
    now,
    appendEvent,
    createInvocation,
    startInvocationIfAllowed,
  });

  const {
    createCapabilityInvocation,
    getCapability,
    listCapabilities,
  } = createCapabilityService({
    state,
    listTools,
    getTool,
    createToolInvocation,
    createInvocation,
    completeInvocation,
    findAgent,
    listApplications,
    listApplicationCapabilities,
    invokeApplicationCapability,
  });

  function runApplicationOrchestration(applicationId, routineId, body = {}, actor = null) {
    const application = findApplication(applicationId);
    if (!application) {
      return { status: 404, body: { error: "application_not_found" } };
    }
    const orchestration = (application.orchestrations ?? []).find((item) => item?.routineId === routineId);
    if (!orchestration) {
      return { status: 404, body: { error: "orchestration_not_found", applicationId, routineId } };
    }
    if (application.status === "archived") {
      return { status: 409, body: { error: "application_archived", applicationId } };
    }
    if (application.status !== "active") {
      return { status: 409, body: { error: "application_not_active", applicationId, status: application.status } };
    }
    if (orchestration.status === "invalid" || orchestration.validation?.ok === false) {
      return {
        status: 422,
        body: {
          error: "invalid_application_routine",
          applicationId,
          routineId,
          validation: orchestration.validation ?? null,
        },
      };
    }
    if (!orchestration.path || !isManagedApplicationRoutinePath(application, orchestration.path)) {
      return { status: 422, body: { error: "invalid_orchestration_path", applicationId, routineId } };
    }
    if (!existsSync(orchestration.path)) {
      return { status: 404, body: { error: "orchestration_file_not_found", applicationId, routineId } };
    }

    let routine = null;
    try {
      routine = JSON.parse(readFileSync(orchestration.path, "utf8"));
    } catch (error) {
      return {
        status: 422,
        body: {
          error: "invalid_application_routine",
          message: error instanceof Error ? error.message : String(error),
          applicationId,
          routineId,
        },
      };
    }
    const validation = validateApplicationRoutineDraft(routine, {
      root: dirname(orchestration.path),
      application,
    });
    if (!validation.ok) {
      return {
        status: 422,
        body: {
          error: "invalid_application_routine",
          applicationId,
          routineId,
          validation,
        },
      };
    }

    const agentId = typeof body?.agentId === "string" && body.agentId.trim()
      ? body.agentId.trim()
      : null;
    const agent = agentId ? findAgent(agentId) : defaultAgent();
    if (!agent) {
      return { status: 404, body: { error: "agent_not_found" } };
    }
    if (agent.status === "disabled") {
      return { status: 409, body: { error: "agent_disabled", agentId: agent.id } };
    }
    if (agent.health?.status === "unhealthy") {
      return {
        status: 409,
        body: { error: "agent_unhealthy", agentId: agent.id, message: agent.health.message },
      };
    }
    if (agent.location?.type === "local_device" && state.device.unlinkState !== "linked") {
      return { status: 409, body: { error: "device_unlinked", agentId: agent.id } };
    }
    const invocation = createInvocation(applicationRoutineTask({ application, orchestration, routine, validation }), agent, {
      actor,
      requestedBy: actor?.userId,
      metadata: {
        source: "application_orchestration",
        applicationId: application.id,
        applicationName: application.name,
        routineId,
        routineName: routine.metadata?.name ?? null,
        orchestrationPath: orchestration.path ?? null,
        orchestrationRelativePath: orchestration.relativePath ?? null,
        projectId: application.projectId ?? null,
        routineValidationOk: validation.ok,
      },
      timeoutSeconds: Number(body?.timeoutSeconds ?? 30),
    });
    startInvocationIfAllowed(invocation, agent);
    appendEvent({
      invocationId: invocation.id,
      type: "application_orchestration_run_requested",
      level: "info",
      message: `${application.name} application orchestration ${routineId} run requested.`,
      data: { applicationId: application.id, routineId },
    });
    return {
      status: 201,
      body: {
        applicationId: application.id,
        routineId,
        invocationId: invocation.id,
        agentId: agent.id,
        status: invocation.status,
        invocation,
      },
    };
  }

  function listApplicationOrchestrationRuns(applicationId, routineId, searchParams = new URLSearchParams()) {
    const scope = applicationOrchestrationScope(applicationId, routineId);
    if (scope.status !== 200) return scope;
    const limit = clampNumber(searchParams?.get?.("limit") ?? 10, 1, 50);
    const runs = state.invocations
      .filter((invocation) => isApplicationOrchestrationRun(invocation, applicationId, routineId))
      .sort((left, right) => Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? ""))
      .slice(0, limit)
      .map(applicationOrchestrationRunSummary);
    return {
      status: 200,
      body: {
        applicationId,
        routineId,
        runs,
      },
    };
  }

  function getApplicationOrchestrationRun(applicationId, routineId, invocationId) {
    const scope = applicationOrchestrationScope(applicationId, routineId);
    if (scope.status !== 200) return scope;
    const invocation = findInvocation(invocationId);
    if (!invocation || !isApplicationOrchestrationRun(invocation, applicationId, routineId)) {
      return { status: 404, body: { error: "orchestration_run_not_found", applicationId, routineId, invocationId } };
    }
    return {
      status: 200,
      body: {
        applicationId,
        routineId,
        run: applicationOrchestrationRunDetail(invocation),
      },
    };
  }

  function nextId(prefix) {
    const id = `${prefix}_${String(idCounter).padStart(4, "0")}`;
    idCounter += 1;
    return id;
  }

  function findInvocation(id) {
    return invocationService?.findInvocation(id) ?? state.invocations.find((item) => item.id === id);
  }

  function findApprovalRequest(id) {
    return invocationService?.findApprovalRequest(id) ?? state.approvalRequests.find((item) => item.id === id);
  }

  function defaultAgent() {
    return invocationService?.defaultAgent() ?? state.agents.find((item) => item.id === "agt_demo_cli") ?? state.agents.find((item) => item.adapter.type !== "platform") ?? state.agents[0] ?? null;
  }

  function uniqueStrings(values) {
    return [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))];
  }

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, Math.floor(number)));
  }

  function summarizeText(value, maxLength = 160) {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }
    return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  function applicationRoutineTask({ application, orchestration, routine, validation }) {
    const location = orchestration.relativePath ?? orchestration.path ?? `routine ${orchestration.routineId}`;
    return [
      `Run application orchestration ${orchestration.routineId} for ${application.name}.`,
      `Use ${location} as the validated LoopRoutine draft.`,
      `Routine name: ${routine.metadata?.name ?? orchestration.routineId}.`,
      `Goal: ${routine.goal?.summary ?? "Inspect the registered application and report findings."}`,
      `Safety policy: remoteWrites=${validation.policy.remoteWrites}, githubWrites=${validation.policy.githubWrites}, fanout.apply=${validation.policy.fanoutApply}.`,
      "Execute only allowed steps, keep all side effects under the platform approval policy, and report audit-friendly evidence.",
    ].join("\n");
  }

  function applicationOrchestrationRunSummary(invocation) {
    const metadata = invocation.options?.metadata ?? {};
    const auditSummary = state.auditSummaries.find((item) => item.invocationId === invocation.id);
    return {
      invocationId: invocation.id,
      status: invocation.status,
      agentId: invocation.agentId,
      projectId: invocation.projectId ?? metadata.projectId ?? null,
      worktreeId: invocation.worktreeId ?? metadata.worktreeId ?? null,
      deliveryState: invocation.delivery?.state ?? null,
      cancellationState: invocation.cancellation?.state ?? null,
      resultSummary: invocation.result?.summary ?? null,
      errorSummary: auditSummary?.errorSummary ?? null,
      createdAt: invocation.createdAt ?? null,
      updatedAt: invocation.updatedAt ?? null,
      completedAt: invocation.completedAt ?? null,
      metadata: {
        source: metadata.source ?? null,
        applicationId: metadata.applicationId ?? null,
        applicationName: metadata.applicationName ?? null,
        routineId: metadata.routineId ?? null,
        routineName: metadata.routineName ?? null,
        orchestrationRelativePath: metadata.orchestrationRelativePath ?? null,
      },
    };
  }

  function applicationOrchestrationRunDetail(invocation) {
    const summary = applicationOrchestrationRunSummary(invocation);
    const auditSummary = state.auditSummaries.find((item) => item.invocationId === invocation.id);
    return {
      ...summary,
      traceId: invocation.traceId ?? auditSummary?.traceId ?? null,
      rootSpanId: invocation.rootSpanId ?? null,
      approvalRequestId: invocation.approvalRequestId ?? null,
      policyDecisionId: invocation.policyDecisionId ?? null,
      delivery: invocation.delivery ?? null,
      cancellation: invocation.cancellation ?? null,
      result: invocation.result ?? null,
      audit: auditSummary ? {
        permissionDecision: auditSummary.permissionDecision ?? null,
        errorSummary: auditSummary.errorSummary ?? null,
        traceId: auditSummary.traceId ?? null,
        costSummary: auditSummary.costSummary ?? null,
      } : null,
      metadata: invocation.options?.metadata ?? summary.metadata,
    };
  }

  function applicationOrchestrationScope(applicationId, routineId) {
    const application = findApplication(applicationId);
    if (!application) {
      return { status: 404, body: { error: "application_not_found" } };
    }
    const orchestration = (application.orchestrations ?? []).find((item) => item?.routineId === routineId);
    if (!orchestration) {
      return { status: 404, body: { error: "orchestration_not_found", applicationId, routineId } };
    }
    return { status: 200, application, orchestration };
  }

  function isApplicationOrchestrationRun(invocation, applicationId, routineId) {
    const metadata = invocation?.options?.metadata;
    return metadata?.source === "application_orchestration"
      && metadata.applicationId === applicationId
      && metadata.routineId === routineId;
  }

  function isManagedApplicationRoutinePath(application, path) {
    const applicationSegment = String(application.id ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72);
    if (!applicationSegment) return false;
    const routinesRoot = resolve(defaultProjectPath || process.cwd(), ".myagenttool", "applications", applicationSegment, "routines");
    const target = resolve(path);
    return target === routinesRoot || target.startsWith(routinesRoot + sep);
  }

  function unlinkDevice() {
    state.device.status = "offline";
    state.device.unlinkState = "unlinked";
    state.device.credentialRevokedAt = now();
    state.device.updatedAt = now();
    for (const agent of state.agents.filter((item) => item.location.type === "local_device")) {
      if (isAgentDisabled(agent)) {
        agent.updatedAt = now();
        continue;
      }
      agent.status = "unavailable";
      agent.updatedAt = now();
    }
    cancelInvocationsForDeviceUnlink();
    appendEvent({
      invocationId: null,
      type: "device_unlinked",
      level: "info",
      message: "Desktop Bridge device credentials were revoked for unlink."
    });
  }

  const selfCheckDependencies = {
    acknowledgeInvocation,
    appendEvent,
    approveInvocation,
    cancelInvocation,
    codexSessionForInvocation,
    completeDiscoveryRun,
    completeHealthCheck,
    completeIntegrationProbeRun,
    completeInvocation,
    createAgentHealthCheck,
    createCapabilityInvocation,
    findApplication,
    getApplicationOrchestrationRun,
    invokeApplicationCapability,
    getCapability,
    listApplicationCapabilities,
    listCapabilities,
    listApplications,
    listApplicationOrchestrationRuns,
    probeApplication,
    registerApplication,
    runApplicationOrchestration,
    transitionApplication,
    createCodexChangeReview,
    createCodexImportedEvidenceRecord,
    createCompareRun,
    createDiscoveryRun,
    createIntegrationArtifact,
    createIntegrationProbeRun,
    createInvocation,
    createManagedCodexSession,
    createManagedCodexWorkspace,
    createManagedTerminalSession,
    createSshConnectionTest,
    createSshTarget,
    createTroubleshootingReport,
    createToolInvocation,
    defaultAgent,
    disableAgent,
    denyInvocation,
    enableAgent,
    evidenceCenterRecords,
    expireCodexApprovalBrokerRequests,
    findAgent,
    findApprovalRequest,
    findInvocation,
    generateIntegrationArtifacts,
    getAgentUsageSummary,
    getTool,
    chargebackExport,
    completeLifecycleAction,
    createAuditExportRequest,
    markDispatched,
    markDiscoveryStarted,
    markHealthCheckStarted,
    markIntegrationProbeStarted,
    nextBridgeDiscoveryRun,
    nextBridgeHealthCheck,
    nextDispatchableInvocation,
    nextTerminalBridgeAction,
    queueTerminalBridgeAction,
    recordCcusageImportedEstimates,
    recordCodexHookEvent,
    recordTerminalBridgeEvent,
    redeliverExpiredDispatches,
    registerAgent,
    registerDiscoveredCandidate,
    registerIntegrationArtifact,
    createLifecycleRecipe,
    createPrivateCatalogEntry,
    createSignedBundleManifest,
    createQuotaPolicy,
    decideLifecycleLocalApproval,
    evaluateLifecyclePolicy,
    enforcePlatformAiQuota,
    findLifecycleLocalApproval,
    findLifecycleRollbackRequest,
    findLifecycleRecipe,
    findPrivateCatalogEntry,
    markLifecycleActionStarted,
    nextBridgeLifecycleAction,
    queueLifecycleAction,
    queueRollbackAction,
    recordAiUsage,
    requestLifecycleLocalApproval,
    resetIdCounter: () => {
      idCounter = 1;
    },
    resolveCodexApprovalBrokerRequest,
    startInvocationIfAllowed,
    state,
    transitionIntegrationArtifact,
    transitionLifecycleRecipe,
    updatePrivateDeploymentConfig,
    unlinkDevice,
    listTools,
    now,
  };

  const httpDependencies = {
    state,
    now,
    publicState,
    currentLoopRoutineProjectContext,
    currentProject,
    addProject,
    cloneProject,
    createBlankProject,
    createWorktree,
    selectProject,
    removeProject,
    removeWorktree,
    updateProject,
    readProjectTree,
    searchProjectContent,
    gitProjectSummary,
    worktreeDiff,
    projectGithubItems,
    createAgentSkill,
    updateAgentSkill,
    deleteAgentSkill,
    createCapabilityInvocation,
    findApplication,
    getApplicationOrchestrationRun,
    invokeApplicationCapability,
    getCapability,
    listApplicationCapabilities,
    listCapabilities,
    listApplications,
    listApplicationOrchestrationRuns,
    probeApplication,
    registerApplication,
    runApplicationOrchestration,
    transitionApplication,
    createSshTarget,
    createSshConnectionTest,
    createManagedTerminalSession,
    queueTerminalBridgeAction,
    nextTerminalBridgeAction,
    recordTerminalBridgeEvent,
    recordTerminalEvidence,
    summarizeText,
    appendEvent,
    isAgentDisabled,
    redeliverExpiredDispatches,
    registerAgent,
    findAgent,
    disableAgent,
    enableAgent,
    createAgentHealthCheck,
    unlinkDevice,
    recordCodexHookEvent,
    expireCodexApprovalBrokerRequests,
    resolveCodexApprovalBrokerRequest,
    createCodexImportedEvidenceRecord,
    createCodexChangeReview,
    createDiscoveryRun,
    createIntegrationArtifact,
    createLifecycleRecipe,
    createPrivateCatalogEntry,
    createSignedBundleManifest,
    createQuotaPolicy,
    findIntegrationArtifact,
    findLifecycleLocalApproval,
    findLifecycleRollbackRequest,
    findLifecycleRecipe,
    findPrivateCatalogEntry,
    generateIntegrationArtifacts,
    chargebackExport,
    completeLifecycleAction,
    createAuditExportRequest,
    decideLifecycleLocalApproval,
    evaluateLifecyclePolicy,
    enforcePlatformAiQuota,
    queueLifecycleAction,
    queueRollbackAction,
    recordAiUsage,
    requestLifecycleLocalApproval,
    transitionLifecycleRecipe,
    updatePrivateDeploymentConfig,
    createIntegrationProbeRun,
    registerIntegrationArtifact,
    transitionIntegrationArtifact,
    updateIntegrationRetentionSettings,
    draftIntegrationWithPlatformAgent,
    findDiscoveryRun,
    registerDiscoveredCandidate,
    nextDispatchableInvocation,
    markDispatched,
    projectForInvocation,
    nextBridgeHealthCheck,
    markHealthCheckStarted,
    completeHealthCheck,
    nextBridgeDiscoveryRun,
    markDiscoveryStarted,
    normalizeStringArray,
    completeDiscoveryRun,
    nextBridgeProbeRun,
    markLifecycleActionStarted,
    nextBridgeLifecycleAction,
    markIntegrationProbeStarted,
    findIntegrationProbeRun,
    completeIntegrationProbeRun,
    findInvocation,
    acknowledgeInvocation,
    completeInvocation,
    findApprovalRequest,
    approveInvocation,
    denyInvocation,
    defaultAgent,
    createInvocation,
    startInvocationIfAllowed,
    createCompareRun,
    cancelInvocation,
    createTroubleshootingReport,
    createToolInvocation,
    getTool,
    listTools,
    nextId,
    persistStateSoon,
    budgetStatusFor,
    upsertBudget,
  };

  return {
    httpDependencies,
    savePersistentState,
    selfCheckDependencies,
  };
}
