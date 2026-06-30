import { createEventLogRuntime } from "./event-log.mjs";
import { createPersistenceRuntime } from "./persistence.mjs";
import { createReadModelRuntime } from "./read-models.mjs";
import {
  createAgentService,
  isAgentDisabled,
  normalizeStringArray,
} from "../services/agents.mjs";
import { createCodexService } from "../services/codex.mjs";
import { createIntegrationService } from "../services/integrations.mjs";
import { createInvocationService } from "../services/invocations.mjs";
import { createProjectService, sameProjectPath } from "../services/projects.mjs";
import { createTerminalService } from "../services/terminal.mjs";

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
    projectForInvocation,
    readProjectTree,
    removeProject,
    searchProjectContent,
    selectProject,
    worktreeForProject,
  } = createProjectService({ state, now, nextId, appendEvent, persistStateSoon });

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
    currentProject,
    worktreeForProject,
    uniqueStrings,
    normalizeCodexApprovalMode,
    normalizeCodexSessionMode,
    normalizeCodexWorkspacePolicy,
    createManagedCodexWorkspace,
    createManagedCodexSession,
    closeCodexSession,
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
    expireCodexApprovalBrokerRequests,
  });

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

  function summarizeText(value, maxLength = 160) {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }
    return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
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
    markDispatched,
    markDiscoveryStarted,
    markHealthCheckStarted,
    markIntegrationProbeStarted,
    nextBridgeDiscoveryRun,
    nextBridgeHealthCheck,
    nextDispatchableInvocation,
    nextTerminalBridgeAction,
    queueTerminalBridgeAction,
    recordCodexHookEvent,
    recordTerminalBridgeEvent,
    redeliverExpiredDispatches,
    registerAgent,
    registerDiscoveredCandidate,
    registerIntegrationArtifact,
    resetIdCounter: () => {
      idCounter = 1;
    },
    resolveCodexApprovalBrokerRequest,
    startInvocationIfAllowed,
    state,
    transitionIntegrationArtifact,
    unlinkDevice,
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
    readProjectTree,
    searchProjectContent,
    gitProjectSummary,
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
    findIntegrationArtifact,
    generateIntegrationArtifacts,
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
  };

  return {
    httpDependencies,
    savePersistentState,
    selfCheckDependencies,
  };
}
