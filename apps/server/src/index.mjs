import http from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { buildLoopRoutineStateSummary } from "./read-models/loop-routines.mjs";
import { buildPublicState } from "./read-models/state.mjs";
import { handleAgentRoutes } from "./routes/agents.mjs";
import { handleBridgeRoutes } from "./routes/bridge.mjs";
import { handleCodexRoutes } from "./routes/codex.mjs";
import { handleIntegrationRoutes } from "./routes/integrations.mjs";
import { handleInvocationRoutes } from "./routes/invocations.mjs";
import { handleLoopRoutineRoutes } from "./routes/loop-routines.mjs";
import { handleProjectRoutes } from "./routes/projects.mjs";
import { handleTerminalRoutes } from "./routes/terminal.mjs";
import {
  cancellationTextForAdapter,
  codexCliArgs,
  codexCliResumeArgs,
  codexRegistrationNotes,
  codexRiskTags,
  createAgentService,
  isAgentDisabled,
  isCodexCliCommand,
  normalizeAgentEconomics,
  normalizeCliOutputFormat,
  normalizeStringArray,
} from "./services/agents.mjs";
import { createCodexService } from "./services/codex.mjs";
import { createIntegrationService } from "./services/integrations.mjs";
import { createProjectRecord, createProjectService, sameProjectPath } from "./services/projects.mjs";
import { createTerminalRuntimeCapability, createTerminalService } from "./services/terminal.mjs";

const namespace = "com.myagenttool";
const protocolVersion = "0.0.0";
const host = process.env.SERVER_HOST ?? "127.0.0.1";
const port = Number(process.env.SERVER_PORT ?? 5001);
const dispatchLeaseMs = Number(process.env.SERVER_DISPATCH_LEASE_MS ?? 30_000);
const isSelfCheck = process.argv.includes("--check");
const persistenceEnabled = !isSelfCheck && process.env.MYAGENTTOOL_STATE_DISABLED !== "1";
const stateStorePath = resolve(process.env.MYAGENTTOOL_STATE_PATH ?? ".myagenttool/state/local-demo-state.json");
const stateSchemaVersion = 1;
const defaultProjectPath = resolve(process.env.MYAGENTTOOL_PROJECT_PATH ?? process.cwd());
const defaultProject = createProjectRecord({
  id: "prj_myagenttool",
  name: basename(defaultProjectPath) || "myagenttool",
  path: defaultProjectPath,
  source: "default"
});

const state = {
  device: {
    id: "dev_local_001",
    ownerUserId: "usr_local",
    name: "Local Demo Device",
    platform: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",
    architecture: process.arch === "arm64" ? "arm64" : "x64",
    defaultShell: process.platform === "win32" ? "powershell" : "bash",
    pathFormat: process.platform === "win32" ? "windows" : "posix",
    bridgeVersion: "0.0.0",
    status: "offline",
    unlinkState: "linked",
    lastSeenAt: null,
    registeredCapabilities: [],
    credentialRevokedAt: null,
    createdAt: now()
  },
  projects: [defaultProject],
  currentProjectId: defaultProject.id,
  worktrees: [],
  agents: [
    {
      id: "agt_demo_cli",
      name: "Demo CLI Agent",
      description: "Safe local demo agent for M0 smoke tests.",
      ownerUserId: "usr_local",
      location: { type: "local_device", deviceId: "dev_local_001" },
      adapter: {
        type: "cli",
        command: "demo-agent",
        args: ["{{payloadJson}}"],
        workingDirectoryPolicy: "bridge_default",
        environmentPolicy: "inherit_safe",
        timeoutSeconds: 30,
        cancellation: "supported"
      },
      lifecycle: {
        state: "enabled",
        installState: "installed",
        version: "0.0.0",
        managedBy: "bridge"
      },
      economics: {
        model: "unknown",
        pricingDimensions: [],
        currency: "USD",
        costOwner: "usr_local",
        budgetPoolId: null,
        unknownCostPolicy: "warn"
      },
      capabilities: [
        {
          name: "demo_task",
          description: "Runs a harmless local demonstration task.",
          riskLevel: "low",
          riskTags: ["read_only"]
        }
      ],
      status: "unavailable",
      health: {
        status: "unknown",
        checkedAt: null,
        message: "Health has not been checked yet.",
        nextAction: "Run a health check before relying on this agent."
      },
      registrationNotes: {
        risk: "Low risk demo command. It does not read or write user files.",
        data: "Task text, logs, trace, and final result are stored in the local demo server.",
        cost: "Cost is unknown and no billing is performed.",
        cancellation: "The bridge forwards cancellation to the local demo process."
      },
      createdAt: now()
    },
    {
      id: "agt_codex_cli",
      name: "Codex CLI",
      description: "Runs Codex CLI non-interactively through a reviewed local adapter config.",
      ownerUserId: "usr_local",
      location: { type: "local_device", deviceId: "dev_local_001" },
      adapter: {
        type: "cli",
        command: "codex",
        args: codexCliArgs(),
        workingDirectoryPolicy: "bridge_default",
        environmentPolicy: "inherit_safe",
        timeoutSeconds: 120,
        cancellation: "supported",
        outputFormat: "codex_jsonl",
        sandbox: null
      },
      lifecycle: {
        state: "enabled",
        installState: "installed",
        version: "0.0.0",
        managedBy: "bridge"
      },
      economics: {
        model: "unknown",
        pricingDimensions: [],
        currency: "USD",
        costOwner: "usr_local",
        budgetPoolId: null,
        unknownCostPolicy: "warn"
      },
      capabilities: [
        {
          name: "codex_repo_task",
          description: "Runs Codex CLI repository tasks using Codex CLI native permissions.",
          riskLevel: "high",
          riskTags: codexRiskTags()
        }
      ],
      status: "unavailable",
      health: {
        status: "unknown",
        checkedAt: null,
        message: "Codex CLI setup has not been checked yet.",
        nextAction: "Run a health check before the first Codex task."
      },
      registrationNotes: codexRegistrationNotes(),
      discovery: {
        source: "default_registered",
        confidence: "high"
      },
      createdAt: now()
    },
    {
      id: "agt_platform_troubleshooter",
      name: "Invocation Troubleshooter",
      description: "Platform-owned agent that explains failed invocations and suggested fixes.",
      ownerUserId: "system",
      location: { type: "platform_agent" },
      adapter: { type: "platform", name: "invocation_troubleshooter_agent" },
      lifecycle: {
        state: "enabled",
        installState: "installed",
        version: "0.0.0",
        managedBy: "platform"
      },
      economics: {
        model: "free",
        pricingDimensions: ["per_invocation"],
        currency: "USD",
        costOwner: "usr_local",
        budgetPoolId: null,
        unknownCostPolicy: "warn"
      },
      capabilities: [
        {
          name: "troubleshoot_invocation",
          description: "Summarizes failed invocation state, logs, bridge status, adapter errors, and suggested fixes.",
          riskLevel: "low",
          riskTags: ["read_only"]
        }
      ],
      status: "available",
      health: {
        status: "healthy",
        checkedAt: now(),
        message: "Platform troubleshooting agent is available.",
        nextAction: null
      },
      registrationNotes: {
        risk: "Read-only platform agent. It explains recorded state and cannot remediate without approval.",
        data: "Reads invocation status, related events, bridge state, adapter metadata, trace, and audit records from the local demo server.",
        cost: "Free platform demo helper. No billing automation is performed.",
        cancellation: "Runs synchronously in the local demo server."
      },
      createdAt: now(),
      updatedAt: now()
    },
    {
      id: "agt_platform_integration_builder",
      name: "Integration Builder",
      description: "Platform-owned agent that drafts unsupported-agent integration plans for review.",
      ownerUserId: "system",
      location: { type: "platform_agent" },
      adapter: { type: "platform", name: "integration_builder_agent" },
      lifecycle: {
        state: "enabled",
        installState: "installed",
        version: "0.0.0",
        managedBy: "platform"
      },
      economics: {
        model: "free",
        pricingDimensions: ["per_artifact"],
        currency: "USD",
        costOwner: "usr_local",
        budgetPoolId: null,
        unknownCostPolicy: "warn"
      },
      capabilities: [
        {
          name: "draft_integration_plan",
          description: "Drafts reviewable integration plans without enabling adapters.",
          riskLevel: "low",
          riskTags: ["read_only", "generated_code"]
        }
      ],
      status: "available",
      health: {
        status: "healthy",
        checkedAt: now(),
        message: "Platform integration builder is available for advisory drafts.",
        nextAction: null
      },
      registrationNotes: {
        risk: "Advisory platform agent. It can draft plans and artifact suggestions but cannot approve, test, register, or enable integrations.",
        data: "Reads user-provided integration intent and writes reviewable draft artifacts.",
        cost: "Free platform demo helper. No billing automation is performed.",
        cancellation: "Runs synchronously in the local demo server."
      },
      createdAt: now(),
      updatedAt: now()
    }
  ],
  invocations: [],
  compareRuns: [],
  events: [],
  traces: [],
  spans: [],
  auditSummaries: [],
  healthChecks: [],
  lifecycleAuditRecords: [],
  discoveryRuns: [],
  integrationArtifacts: [],
  integrationProbeRuns: [],
  quotaDecisionRecords: [],
  retentionSettings: {
    id: "ret_demo_integration_data",
    subjectType: "integration_data",
    logsDays: 14,
    promptsDays: 30,
    responsesDays: 30,
    artifactsDays: 90,
    updatedAt: now()
  },
  approvalRequests: [],
  policyDecisionRecords: [],
  troubleshootingReports: [],
  agentUsageSummaries: [],
  codexSessions: [],
  codexWorkspaces: [],
  codexEvidenceRecords: [],
  codexChangeReviews: [],
  codexHookEvents: [],
  codexApprovalBrokerRequests: [],
  codexImportedEvidenceRecords: [],
  terminalRuntimeCapability: createTerminalRuntimeCapability(),
  terminalSessions: [],
  terminalEvidenceRecords: [],
  terminalBridgeActions: [],
  sshTargets: [],
  sshConnectionTests: []
};

let idCounter = 1;
const directHttpRuns = new Map();
let saveStateTimer = null;
restorePersistentState();

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
  closeCodexSession,
  codexApprovalQueue,
  codexSessionForInvocation,
  codexWorkspaceForSession,
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

if (isSelfCheck) {
  runProtocolSelfCheck();
  console.log("[server:check] local demo server check OK");
  process.exit(0);
}

const server = http.createServer(async (req, res) => {
  try {
    setCors(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        namespace,
        protocolVersion,
        status: "ok",
        service: "myagenttool-local-demo-server",
        time: now()
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      expireCodexApprovalBrokerRequests();
      sendJson(res, 200, publicState());
      return;
    }

    if (handleLoopRoutineRoutes({ req, res, url, sendJson, currentLoopRoutineProjectContext })) {
      return;
    }

    if (await handleProjectRoutes({
      req,
      res,
      url,
      sendJson,
      readJson,
      state,
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
    })) {
      return;
    }

    if (await handleTerminalRoutes({
      req,
      res,
      url,
      sendJson,
      readJson,
      state,
      createSshTarget,
      createSshConnectionTest,
      createManagedTerminalSession,
      queueTerminalBridgeAction,
      nextTerminalBridgeAction,
      recordTerminalBridgeEvent,
      recordTerminalEvidence,
      summarizeText,
    })) {
      return;
    }

    if (await handleAgentRoutes({
      req,
      res,
      url,
      sendJson,
      readJson,
      state,
      now,
      appendEvent,
      isAgentDisabled,
      redeliverExpiredDispatches,
      registerAgent,
      findAgent,
      disableAgent,
      enableAgent,
      createAgentHealthCheck,
      unlinkDevice,
    })) {
      return;
    }

    if (await handleCodexRoutes({
      req,
      res,
      url,
      sendJson,
      readJson,
      state,
      recordCodexHookEvent,
      expireCodexApprovalBrokerRequests,
      resolveCodexApprovalBrokerRequest,
      createCodexImportedEvidenceRecord,
      createCodexChangeReview,
    })) {
      return;
    }

    if (await handleIntegrationRoutes({
      req,
      res,
      url,
      sendJson,
      readJson,
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
    })) {
      return;
    }

    if (await handleBridgeRoutes({
      req,
      res,
      url,
      sendJson,
      readJson,
      state,
      namespace,
      protocolVersion,
      now,
      redeliverExpiredDispatches,
      nextDispatchableInvocation,
      markDispatched,
      findAgent,
      projectForInvocation,
      nextBridgeHealthCheck,
      markHealthCheckStarted,
      completeHealthCheck,
      nextBridgeDiscoveryRun,
      markDiscoveryStarted,
      normalizeStringArray,
      findDiscoveryRun,
      completeDiscoveryRun,
      nextBridgeProbeRun,
      markIntegrationProbeStarted,
      findIntegrationProbeRun,
      completeIntegrationProbeRun,
      findIntegrationArtifact,
      findInvocation,
      acknowledgeInvocation,
      appendEvent,
      completeInvocation,
    })) {
      return;
    }

    if (await handleInvocationRoutes({
      req,
      res,
      url,
      sendJson,
      readJson,
      state,
      findApprovalRequest,
      findInvocation,
      approveInvocation,
      denyInvocation,
      findAgent,
      defaultAgent,
      createInvocation,
      startInvocationIfAllowed,
      normalizeStringArray,
      createCompareRun,
      cancelInvocation,
      createTroubleshootingReport,
    })) {
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, host, () => {
  console.log(`[server] http://${host}:${port}`);
});

process.on("SIGINT", () => {
  savePersistentState();
  process.exit(0);
});
process.on("SIGTERM", () => {
  savePersistentState();
  process.exit(0);
});

function now() {
  return new Date().toISOString();
}

function nextId(prefix) {
  const id = `${prefix}_${String(idCounter).padStart(4, "0")}`;
  idCounter += 1;
  return id;
}

function persistStateSoon() {
  if (!persistenceEnabled) return;
  if (saveStateTimer) return;
  saveStateTimer = setTimeout(() => {
    saveStateTimer = null;
    savePersistentState();
  }, 20);
}

function savePersistentState() {
  if (!persistenceEnabled) return;
  const snapshot = {
    schemaVersion: stateSchemaVersion,
    savedAt: now(),
    projects: state.projects,
    currentProjectId: state.currentProjectId,
    worktrees: state.worktrees,
    invocations: state.invocations,
    compareRuns: state.compareRuns,
    events: state.events,
    traces: state.traces,
    spans: state.spans,
    auditSummaries: state.auditSummaries,
    approvalRequests: state.approvalRequests,
    policyDecisionRecords: state.policyDecisionRecords,
    troubleshootingReports: state.troubleshootingReports,
    agentUsageSummaries: state.agentUsageSummaries,
    codexSessions: state.codexSessions,
    codexWorkspaces: state.codexWorkspaces,
    codexEvidenceRecords: state.codexEvidenceRecords,
    codexChangeReviews: state.codexChangeReviews,
    codexHookEvents: state.codexHookEvents,
    codexApprovalBrokerRequests: state.codexApprovalBrokerRequests,
    codexImportedEvidenceRecords: state.codexImportedEvidenceRecords
  };
  mkdirSync(dirname(stateStorePath), { recursive: true });
  writeFileSync(stateStorePath, `${JSON.stringify(snapshot, null, 2)}\n`);
}

function restorePersistentState() {
  if (!persistenceEnabled || !existsSync(stateStorePath)) return;
  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(stateStorePath, "utf8"));
  } catch {
    return;
  }
  if (snapshot?.schemaVersion !== stateSchemaVersion) {
    return;
  }
  let restoredProjects = Array.isArray(snapshot.projects)
    ? snapshot.projects.filter((project) => project?.id && project?.path && existsSync(project.path))
    : [];
  restoredProjects = restoredProjects.filter((project) => project.id !== defaultProject.id || sameProjectPath(project.path, defaultProject.path));
  let defaultPathProject = restoredProjects.find((project) => sameProjectPath(project.path, defaultProject.path));
  if (!defaultPathProject) {
    restoredProjects.unshift(defaultProject);
    defaultPathProject = defaultProject;
  }
  if (restoredProjects.length) {
    state.projects = restoredProjects;
    state.currentProjectId = defaultPathProject.id;
  }
  for (const key of [
    "invocations",
    "worktrees",
    "compareRuns",
    "events",
    "traces",
    "spans",
    "auditSummaries",
    "approvalRequests",
    "policyDecisionRecords",
    "troubleshootingReports",
    "agentUsageSummaries",
    "codexSessions",
    "codexWorkspaces",
    "codexEvidenceRecords",
    "codexChangeReviews",
    "codexHookEvents",
    "codexApprovalBrokerRequests",
    "codexImportedEvidenceRecords"
  ]) {
    if (Array.isArray(snapshot[key])) {
      state[key] = snapshot[key];
    }
  }
}

function createInvocation(task, agent = defaultAgent(), options = {}) {
  if (!agent) {
    throw new Error("No agent is registered.");
  }
  const id = nextId("inv_demo");
  const createdAt = now();
  const trace = createTrace(id, agent);
  const policy = evaluateInvocationPolicy(agent, options);
  const directRun = runsWithoutBridge(agent);
  const codexSessionMode = normalizeCodexSessionMode(options.codexSessionMode, agent);
  const codexWorkspacePolicy = normalizeCodexWorkspacePolicy(options.codexWorkspacePolicy, agent);
  const managedCodexWorkspace = createManagedCodexWorkspace({ invocationId: id, agent, workspacePolicy: codexWorkspacePolicy });
  const managedCodexSession = createManagedCodexSession({ invocationId: id, agent, codexSessionMode, workspace: managedCodexWorkspace });
  const project = currentProject();
  const projectWorktree = worktreeForProject(project?.id);
  const invocation = {
    id,
    ideaSessionId: null,
    compareRunId: null,
    agentId: agent.id,
    requestedBy: "usr_local",
    status: policy.decision === "requires_local_approval" ? "waiting_for_local_approval" : directRun ? "running" : "queued",
    delivery: {
      deliveryId: nextId("del_demo"),
      deviceId: agent.location.type === "local_device" ? agent.location.deviceId : null,
      state: policy.decision === "requires_local_approval" ? "not_required" : directRun ? "not_required" : "queued",
      idempotencyKey: `idem_${id}`,
      leaseExpiresAt: null,
      dispatchAttempts: policy.decision === "requires_local_approval" ? 0 : directRun ? 1 : 0,
      lastDispatchAt: policy.decision === "requires_local_approval" ? null : directRun ? createdAt : null,
      acknowledgedAt: policy.decision === "requires_local_approval" ? null : directRun ? createdAt : null,
      bridgeCursor: null,
      expiresAt: null
    },
    cancellation: {
      state: "none",
      requestedBy: null,
      requestedAt: null,
      reason: null
    },
    input: { task },
    options: {
      timeoutSeconds: Number(options.timeoutSeconds ?? 30),
      requireLocalApproval: Boolean(options.requireLocalApproval ?? policy.decision === "requires_local_approval"),
      codexSessionMode,
      codexWorkspacePolicy,
      approvalMode: normalizeCodexApprovalMode(options.approvalMode ?? options.metadata?.permissionMode),
      metadata: {
        demo: true,
        ...(options.metadata && typeof options.metadata === "object" && !Array.isArray(options.metadata) ? options.metadata : {}),
        projectId: project?.id ?? null,
        projectName: project?.name ?? null,
        projectPath: project?.path ?? null,
        worktreeId: projectWorktree?.id ?? null,
        worktreeBranchName: projectWorktree?.branchName ?? null,
        worktreePath: projectWorktree?.worktreePath ?? null,
        ...(managedCodexSession ? {
          managedCodexSessionId: managedCodexSession.id,
          managedCodexWorkspaceId: managedCodexWorkspace?.id ?? null,
          managedLaunch: true
        } : {})
      }
    },
    result: null,
    policyDecisionId: null,
    approvalRequestId: null,
    traceId: trace.id,
    rootSpanId: trace.rootSpanId,
    createdAt,
    updatedAt: createdAt
  };
  state.invocations.unshift(invocation);
  persistStateSoon();
  if (managedCodexSession) {
    appendEvent({
      invocationId: invocation.id,
      type: "codex_session_registered",
      level: "info",
      message: "Managed Codex session registered for a MyAgentTool-launched invocation.",
      data: { codexSessionId: managedCodexSession.id, workspaceId: managedCodexWorkspace?.id ?? null, sessionMode: codexSessionMode, workspacePolicy: codexWorkspacePolicy }
    });
  }
  const policyRecord = createPolicyDecisionRecord(invocation, agent, policy);
  invocation.policyDecisionId = policyRecord.id;
  appendEvent({
    invocationId: invocation.id,
    type: "invocation_created",
    level: "info",
    message: "Invocation created from Web Console."
  });
  appendEvent({
    invocationId: invocation.id,
    type: "policy_decision_recorded",
    level: policy.decision === "requires_local_approval" ? "warn" : "info",
    message: policy.reason,
    data: { policyDecisionId: policyRecord.id, riskLevel: policy.riskLevel, riskTags: policy.riskTags, decision: policy.decision }
  });
  appendEvent({
    invocationId: invocation.id,
    type: "trace_created",
    level: "info",
    message: "Invocation trace created.",
    data: { traceId: trace.id, rootSpanId: trace.rootSpanId }
  });
  appendEvent({
    invocationId: invocation.id,
    type: policy.decision === "requires_local_approval" ? "local_approval_requested" : directRun ? "invocation_started" : "delivery_queued",
    level: "info",
    message: policy.decision === "requires_local_approval" ? "Local approval is required before this high-risk invocation can run." : directRun ? `${agent.name} invocation started.` : "Invocation queued for Desktop Bridge."
  });
  if (policy.decision === "requires_local_approval") {
    const approval = createApprovalRequest(invocation, agent, policy);
    invocation.approvalRequestId = approval.id;
    policyRecord.approvalRequestId = approval.id;
  } else {
    appendEvent({
      invocationId: invocation.id,
      type: "invocation_authorized",
      level: "info",
      message: `Demo invocation authorized for ${agent.name}.`
    });
  }
  return invocation;
}

function createCompareRun(task, agents, options = {}) {
  const createdAt = now();
  const compareRun = {
    id: nextId("cmp_demo"),
    task,
    requestedBy: "usr_local",
    status: "running",
    childInvocationIds: [],
    preferredInvocationId: null,
    summary: "Compare run started.",
    createdAt,
    updatedAt: createdAt
  };
  state.compareRuns.unshift(compareRun);
  for (const agent of agents) {
    const invocation = createInvocation(task, agent, {
      ...options,
      metadata: {
        ...(options.metadata && typeof options.metadata === "object" && !Array.isArray(options.metadata) ? options.metadata : {}),
        compareRunId: compareRun.id
      }
    });
    invocation.compareRunId = compareRun.id;
    compareRun.childInvocationIds.push(invocation.id);
    startInvocationIfAllowed(invocation, agent);
  }
  updateCompareRun(compareRun);
  return compareRun;
}

function evaluateInvocationPolicy(agent, options = {}) {
  const capabilities = Array.isArray(agent.capabilities) ? agent.capabilities : [];
  const riskLevel = highestRiskLevel(capabilities.map((capability) => capability.riskLevel));
  const riskTags = uniqueStrings(capabilities.flatMap((capability) => capability.riskTags ?? []));
  const codexNativeControls = isCodexCliCommand(agent.adapter?.command);
  const requiresApproval = !codexNativeControls && (Boolean(options.requireLocalApproval) || ["high", "critical"].includes(riskLevel));
  return {
    decision: requiresApproval ? "requires_local_approval" : "allowed",
    reason: requiresApproval
      ? `${agent.name} has ${riskLevel} risk capability tags and needs local approval before running.`
      : codexNativeControls
        ? `${agent.name} risk is ${riskLevel}; invocation is allowed and permissions are handled by Codex CLI native controls.`
      : `${agent.name} risk is ${riskLevel}; invocation is allowed by local policy.`,
    riskLevel,
    riskTags,
    summary: {
      risk: agent.registrationNotes?.risk ?? `${agent.name} reports ${riskLevel} risk for this capability.`,
      data: agent.registrationNotes?.data ?? "Task input, logs, trace, and result are recorded by the local demo server.",
      cost: agent.registrationNotes?.cost ?? costTextForAgent(agent),
      cancellation: agent.registrationNotes?.cancellation ?? cancellationTextForAdapter(agent.adapter)
    }
  };
}

function createPolicyDecisionRecord(invocation, agent, policy) {
  const record = {
    id: nextId("pdr_demo"),
    invocationId: invocation.id,
    agentId: agent.id,
    action: "invoke",
    riskLevel: policy.riskLevel,
    riskTags: policy.riskTags,
    decision: policy.decision,
    reason: policy.reason,
    approvalRequestId: null,
    approver: null,
    createdAt: now()
  };
  state.policyDecisionRecords.unshift(record);
  state.policyDecisionRecords = state.policyDecisionRecords.slice(0, 200);
  return record;
}

function createApprovalRequest(invocation, agent, policy) {
  const approval = {
    id: nextId("apr_demo"),
    invocationId: invocation.id,
    agentId: agent.id,
    requestedBy: invocation.requestedBy,
    status: "pending",
    riskLevel: policy.riskLevel,
    riskTags: policy.riskTags,
    summary: policy.summary,
    createdAt: now(),
    decidedAt: null,
    decidedBy: null
  };
  state.approvalRequests.unshift(approval);
  state.approvalRequests = state.approvalRequests.slice(0, 200);
  return approval;
}

function highestRiskLevel(levels) {
  const order = ["low", "medium", "high", "critical"];
  let highest = "low";
  for (const level of levels) {
    const normalized = order.includes(level) ? level : "medium";
    if (order.indexOf(normalized) > order.indexOf(highest)) {
      highest = normalized;
    }
  }
  return highest;
}

function uniqueStrings(values) {
  return [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))];
}

function costTextForAgent(agent) {
  if (agent.economics?.model && agent.economics.model !== "unknown") {
    return `${agent.economics.model} cost policy: ${agent.economics.unknownCostPolicy ?? "unknown"}.`;
  }
  return "Cost is unknown and no billing is performed by the demo server.";
}

function startInvocationIfAllowed(invocation, agent = findAgent(invocation.agentId)) {
  if (!agent || invocation.status === "waiting_for_local_approval" || isTerminal(invocation.status)) {
    return;
  }
  if (agent.adapter.type === "http" && agent.location.type === "remote_http") {
    queueMicrotask(() => runHttpInvocation(invocation, agent).catch((error) => {
      completeInvocation(invocation, {
        status: "failed",
        summary: `HTTP Agent failed: ${error instanceof Error ? error.message : String(error)}`,
        result: null
      });
    }));
  }
}

function runsWithoutBridge(agent) {
  return agent.adapter.type === "platform" || (agent.adapter.type === "http" && agent.location.type === "remote_http");
}

function approveInvocation(approval, invocation) {
  if (approval.status !== "pending" || invocation.status !== "waiting_for_local_approval") {
    return;
  }
  const agent = findAgent(invocation.agentId);
  approval.status = "approved";
  approval.decidedAt = now();
  approval.decidedBy = "usr_local";
  invocation.status = agent?.adapter.type === "http" ? "running" : "queued";
  invocation.delivery.state = agent?.adapter.type === "http" ? "not_required" : "queued";
  invocation.delivery.dispatchAttempts = agent?.adapter.type === "http" ? 1 : 0;
  invocation.delivery.lastDispatchAt = agent?.adapter.type === "http" ? now() : null;
  invocation.delivery.acknowledgedAt = agent?.adapter.type === "http" ? now() : null;
  invocation.updatedAt = now();
  const policyRecord = state.policyDecisionRecords.find((item) => item.id === invocation.policyDecisionId);
  if (policyRecord) {
    policyRecord.decision = "allowed";
    policyRecord.approver = "usr_local";
    policyRecord.reason = "Local approval granted for high-risk invocation.";
  }
  appendEvent({
    invocationId: invocation.id,
    type: "local_approval_granted",
    level: "info",
    message: "Local approval granted. Invocation can run.",
    data: { approvalRequestId: approval.id }
  });
  appendEvent({
    invocationId: invocation.id,
    type: "invocation_authorized",
    level: "info",
    message: `Invocation authorized after local approval for ${agent?.name ?? invocation.agentId}.`
  });
  appendEvent({
    invocationId: invocation.id,
    type: agent?.adapter.type === "http" ? "invocation_started" : "delivery_queued",
    level: "info",
    message: agent?.adapter.type === "http" ? "HTTP Agent invocation started after approval." : "Invocation queued for Desktop Bridge after approval."
  });
  startInvocationIfAllowed(invocation, agent);
}

function denyInvocation(approval, invocation) {
  if (approval.status !== "pending" || invocation.status !== "waiting_for_local_approval") {
    return;
  }
  approval.status = "denied";
  approval.decidedAt = now();
  approval.decidedBy = "usr_local";
  invocation.status = "rejected";
  invocation.completedAt = now();
  invocation.updatedAt = now();
  completeRootSpan(invocation, "failed");
  const policyRecord = state.policyDecisionRecords.find((item) => item.id === invocation.policyDecisionId);
  if (policyRecord) {
    policyRecord.decision = "denied";
    policyRecord.approver = "usr_local";
    policyRecord.reason = "Local approval denied by user.";
  }
  appendEvent({
    invocationId: invocation.id,
    type: "local_approval_denied",
    level: "warn",
    message: "Local approval denied. Invocation was not executed.",
    data: { approvalRequestId: approval.id }
  });
  appendEvent({
    invocationId: invocation.id,
    type: "invocation_rejected",
    level: "warn",
    message: "Invocation rejected before execution."
  });
  state.auditSummaries.push(createAuditSummary(invocation, "Local approval denied before execution."));
  recordAgentUsage(invocation, "rejected");
}

function nextDispatchableInvocation() {
  return state.invocations.find((item) => {
    if (item.status !== "queued" || !["queued", "redelivering"].includes(item.delivery.state)) {
      return false;
    }
    const agent = findAgent(item.agentId);
    if (!agent) {
      return false;
    }
    return !isAgentDisabled(agent) && agent?.health?.status !== "unhealthy";
  });
}

function markDispatched(invocation) {
  invocation.status = "dispatching";
  invocation.delivery.state = "dispatching";
  invocation.delivery.dispatchAttempts += 1;
  invocation.delivery.lastDispatchAt = now();
  invocation.delivery.leaseExpiresAt = new Date(Date.now() + dispatchLeaseMs).toISOString();
  invocation.delivery.bridgeCursor = `cursor_${invocation.delivery.dispatchAttempts}_${invocation.id}`;
  invocation.updatedAt = now();
  appendEvent({
    invocationId: invocation.id,
    type: invocation.delivery.dispatchAttempts > 1 ? "delivery_redelivered" : "delivery_dispatched",
    level: "info",
    message: invocation.delivery.dispatchAttempts > 1 ? "Invocation redelivered to Desktop Bridge." : "Invocation dispatched to Desktop Bridge.",
    data: {
      dispatchAttempts: invocation.delivery.dispatchAttempts,
      leaseExpiresAt: invocation.delivery.leaseExpiresAt,
      bridgeCursor: invocation.delivery.bridgeCursor
    }
  });
}

function acknowledgeInvocation(invocation) {
  if (invocation.delivery.state === "acknowledged" || invocation.status === "running") {
    return;
  }
  invocation.delivery.state = "acknowledged";
  invocation.delivery.acknowledgedAt = now();
  invocation.delivery.leaseExpiresAt = null;
  invocation.status = "running";
  invocation.updatedAt = now();
  appendEvent({
    invocationId: invocation.id,
    type: "delivery_acknowledged",
    level: "info",
    message: "Desktop Bridge acknowledged durable receipt."
  });
  appendEvent({
    invocationId: invocation.id,
    type: "invocation_started",
    level: "info",
    message: "Demo CLI Agent started."
  });
}

function completeInvocation(invocation, body) {
  if (isTerminal(invocation.status)) {
    return;
  }
  const terminalStatus =
    body.status === "cancelled"
      ? "cancelled"
      : body.status === "timed_out"
        ? "timed_out"
        : body.status === "failed"
          ? "failed"
          : "succeeded";
  invocation.status = terminalStatus;
  invocation.result = body.result ?? null;
  invocation.completedAt = now();
  invocation.updatedAt = now();
  completeRootSpan(invocation, terminalStatus);
  if (terminalStatus === "cancelled") {
    invocation.cancellation.state = "applied";
  }

  appendEvent({
    invocationId: invocation.id,
    type:
      terminalStatus === "succeeded"
        ? "invocation_succeeded"
        : terminalStatus === "cancelled"
          ? "cancel_applied"
          : terminalStatus === "timed_out"
            ? "invocation_timed_out"
            : "invocation_failed",
    level: terminalStatus === "succeeded" ? "info" : "warn",
    message: body.summary ?? `Invocation ${terminalStatus}.`,
    data: body.result ?? null
  });
  state.auditSummaries.push(createAuditSummary(invocation, body.summary ?? null));
  recordAgentUsage(invocation, terminalStatus);
  closeCodexSession(invocation, terminalStatus);
  updateCompareRunForInvocation(invocation);
  persistStateSoon();
}

function updateCompareRunForInvocation(invocation) {
  if (!invocation.compareRunId) {
    return;
  }
  const compareRun = state.compareRuns.find((item) => item.id === invocation.compareRunId);
  if (compareRun) {
    updateCompareRun(compareRun);
  }
}

function updateCompareRun(compareRun) {
  const children = compareRun.childInvocationIds.map((id) => findInvocation(id)).filter(Boolean);
  const terminal = children.filter((child) => isTerminal(child.status));
  compareRun.status = terminal.length === children.length
    ? children.some((child) => child.status === "succeeded") ? "completed" : "failed"
    : "running";
  compareRun.summary = `${terminal.length}/${children.length} agent run(s) finished.`;
  const firstSuccess = children.find((child) => child.status === "succeeded");
  compareRun.preferredInvocationId = compareRun.preferredInvocationId ?? firstSuccess?.id ?? null;
  compareRun.updatedAt = now();
  persistStateSoon();
}

function recordAgentUsage(invocation, terminalStatus) {
  const agent = findAgent(invocation.agentId);
  const summary = getAgentUsageSummary(invocation.agentId);
  summary.invocationCount += 1;
  if (terminalStatus === "succeeded") {
    summary.succeededCount += 1;
  } else if (terminalStatus === "failed" || terminalStatus === "timed_out" || terminalStatus === "expired" || terminalStatus === "rejected") {
    summary.failedCount += 1;
  } else if (terminalStatus === "cancelled") {
    summary.cancelledCount += 1;
  }
  summary.lastInvocationId = invocation.id;
  summary.lastInvocationStatus = terminalStatus;
  summary.costOwner = agent?.economics?.costOwner ?? "unknown";
  summary.economicModel = agent?.economics?.model ?? "unknown";
  summary.currency = agent?.economics?.currency ?? "USD";
  summary.unknownCostVisible = summary.economicModel === "unknown";
  summary.updatedAt = now();
  persistStateSoon();
}

function getAgentUsageSummary(agentId) {
  let summary = state.agentUsageSummaries.find((item) => item.agentId === agentId);
  if (!summary) {
    const agent = findAgent(agentId);
    summary = {
      agentId,
      invocationCount: 0,
      succeededCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      lastInvocationId: null,
      lastInvocationStatus: null,
      costOwner: agent?.economics?.costOwner ?? "unknown",
      economicModel: agent?.economics?.model ?? "unknown",
      currency: agent?.economics?.currency ?? "USD",
      unknownCostVisible: (agent?.economics?.model ?? "unknown") === "unknown",
      updatedAt: null
    };
    state.agentUsageSummaries.push(summary);
  }
  return summary;
}

function createTroubleshootingReport(targetInvocation) {
  const platformAgent = findAgent("agt_platform_troubleshooter");
  if (!platformAgent) {
    throw new Error("Platform troubleshooting agent is not registered.");
  }
  const platformInvocation = createInvocation(`Troubleshoot invocation ${targetInvocation.id}`, platformAgent, {
    metadata: { targetInvocationId: targetInvocation.id }
  });
  appendEvent({
    invocationId: platformInvocation.id,
    type: "platform_agent_started",
    level: "info",
    message: `Invocation Troubleshooter started for ${targetInvocation.id}.`,
    data: { targetInvocationId: targetInvocation.id }
  });

  const report = buildTroubleshootingReport(targetInvocation, platformAgent);
  state.troubleshootingReports.unshift(report);
  state.troubleshootingReports = state.troubleshootingReports.slice(0, 100);

  appendEvent({
    invocationId: platformInvocation.id,
    type: "platform_agent_recommended",
    level: "info",
    message: report.summary,
    data: {
      targetInvocationId: targetInvocation.id,
      reportId: report.id,
      suggestedFixes: report.suggestedFixes,
      remediationRequiresApproval: report.remediationRequiresApproval
    }
  });
  appendEvent({
    invocationId: platformInvocation.id,
    type: "platform_agent_action_requested",
    level: "info",
    message: "Suggested fixes are advisory only; remediation must be approved and run through normal workflows.",
    data: { targetInvocationId: targetInvocation.id, reportId: report.id }
  });
  completeInvocation(platformInvocation, {
    status: "succeeded",
    summary: report.summary,
    result: {
      summary: report.summary,
      output: report,
      touchedUserFiles: false,
      cost: { model: platformAgent.economics.model, billable: false }
    }
  });
  return report;
}

function buildTroubleshootingReport(invocation, platformAgent) {
  const agent = findAgent(invocation.agentId);
  const events = state.events.filter((item) => item.invocationId === invocation.id).reverse();
  const logEvents = events.filter((item) => item.type === "log" || item.type === "agent_output");
  const audit = state.auditSummaries.find((item) => item.invocationId === invocation.id);
  const adapterError = findAdapterError(invocation, events, audit);
  const bridgeState = bridgeStateSummary(invocation, agent);
  const suggestedFixes = troubleshootingFixes(invocation, agent, adapterError);
  return {
    id: nextId("trb_demo"),
    invocationId: invocation.id,
    platformAgentId: platformAgent.id,
    requestedBy: "usr_local",
    status: "generated",
    failedStatus: invocation.status,
    bridgeState,
    adapterError,
    logSummary: summarizeLogs(logEvents),
    suggestedFixes,
    remediationRequiresApproval: true,
    summary: `Troubleshooter reviewed ${invocation.id}: status ${invocation.status}; ${adapterError ?? "no adapter error text recorded"}.`,
    createdAt: now()
  };
}

function findAdapterError(invocation, events, audit) {
  if (audit?.errorSummary) {
    return audit.errorSummary;
  }
  const failedEvent = events.find((event) => ["invocation_failed", "cancel_failed", "local_approval_denied"].includes(event.type));
  if (failedEvent?.message) {
    return failedEvent.message;
  }
  if (invocation.status === "cancelled") {
    return invocation.cancellation?.reason ?? "Invocation was cancelled before completion.";
  }
  if (invocation.status === "rejected") {
    return "Invocation was rejected before execution.";
  }
  return null;
}

function bridgeStateSummary(invocation, agent) {
  if (agent?.location?.type !== "local_device") {
    return `No Desktop Bridge delivery required; delivery state is ${invocation.delivery?.state ?? "unknown"}.`;
  }
  return `Device ${state.device.status}; delivery state ${invocation.delivery?.state ?? "unknown"}; attempts ${invocation.delivery?.dispatchAttempts ?? 0}.`;
}

function summarizeLogs(logEvents) {
  if (logEvents.length === 0) {
    return "No agent log events were recorded.";
  }
  const latest = logEvents.slice(-3).map((event) => event.message).filter(Boolean);
  return `${logEvents.length} log event(s). Latest: ${latest.join(" | ")}`;
}

function troubleshootingFixes(invocation, agent, adapterError) {
  const fixes = [];
  if (agent?.location?.type === "local_device" && state.device.status !== "online") {
    fixes.push("Start or reconnect Desktop Bridge, then retry the task.");
  }
  if (invocation.delivery?.dispatchAttempts === 0 && invocation.delivery?.state === "queued") {
    fixes.push("Check whether the agent is disabled, unhealthy, or waiting for the bridge.");
  }
  if (agent?.health?.status === "unhealthy") {
    fixes.push("Run an agent health check after fixing the reported health issue.");
  }
  if (adapterError?.toLowerCase().includes("http")) {
    fixes.push("Verify the HTTP agent URL, request path, and local service logs.");
  }
  if (invocation.status === "rejected") {
    fixes.push("Review the local approval request before retrying high-risk work.");
  }
  if (fixes.length === 0) {
    fixes.push("Review the event timeline and retry after confirming the selected agent setup.");
  }
  fixes.push("Do not apply remediation automatically; use the normal approved workflow for changes.");
  return fixes;
}

async function runHttpInvocation(invocation, agent) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Number(agent.adapter.timeoutSeconds ?? invocation.options.timeoutSeconds ?? 30) * 1000);
  directHttpRuns.set(invocation.id, controller);
  appendEvent({
    invocationId: invocation.id,
    type: "log",
    level: "info",
    message: `HTTP Agent request started for ${agent.name}.`
  });

  try {
    const url = new URL(agent.adapter.requestPath ?? "/invoke", agent.adapter.baseUrl);
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invocationId: invocation.id,
        task: invocation.input.task,
        input: invocation.input,
        options: invocation.options
      })
    });

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { output: text };
    }

    if (!response.ok) {
      completeInvocation(invocation, {
        status: "failed",
        summary: payload?.summary ?? `HTTP Agent failed with status ${response.status}.`,
        result: payload
      });
      return;
    }

    completeInvocation(invocation, {
      status: "succeeded",
      summary: payload?.summary ?? "HTTP Agent completed.",
      result: payload
    });
  } catch (error) {
    if (timedOut) {
      completeInvocation(invocation, {
        status: "timed_out",
        summary: "HTTP Agent request timed out.",
        result: null
      });
      return;
    }
    if (controller.signal.aborted) {
      completeInvocation(invocation, {
        status: "cancelled",
        summary: "HTTP Agent request was cancelled.",
        result: null
      });
      return;
    }
    completeInvocation(invocation, {
      status: "failed",
      summary: `HTTP Agent request failed: ${error instanceof Error ? error.message : String(error)}`,
      result: null
    });
  } finally {
    clearTimeout(timeout);
    directHttpRuns.delete(invocation.id);
  }
}

function redeliverExpiredDispatches() {
  const current = Date.now();
  for (const invocation of state.invocations) {
    if (invocation.status !== "dispatching" || invocation.delivery.state !== "dispatching" || !invocation.delivery.leaseExpiresAt) {
      continue;
    }
    if (Date.parse(invocation.delivery.leaseExpiresAt) > current) {
      continue;
    }
    invocation.status = "queued";
    invocation.delivery.state = "redelivering";
    invocation.updatedAt = now();
    appendEvent({
      invocationId: invocation.id,
      type: "delivery_redelivered",
      level: "warn",
      message: "Dispatch lease expired; invocation returned to queue for redelivery.",
      data: { dispatchAttempts: invocation.delivery.dispatchAttempts }
    });
  }
}

function cancelInvocation(invocation) {
  if (isTerminal(invocation.status)) {
    return;
  }
  const agent = findAgent(invocation.agentId);
  invocation.cancellation.requestedBy = "usr_local";
  invocation.cancellation.requestedAt = now();
  invocation.cancellation.reason = "Requested from Web Console.";

  if (["queued", "waiting_for_local_approval"].includes(invocation.status)) {
    invocation.status = "cancelled";
    invocation.cancellation.state = "queued_cancelled";
    invocation.updatedAt = now();
    const pendingApproval = invocation.approvalRequestId ? findApprovalRequest(invocation.approvalRequestId) : null;
    if (pendingApproval?.status === "pending") {
      pendingApproval.status = "denied";
      pendingApproval.decidedAt = now();
      pendingApproval.decidedBy = "usr_local";
    }
    appendEvent({
      invocationId: invocation.id,
      type: "cancel_requested",
      level: "info",
      message: "Queued invocation cancellation requested."
    });
    appendEvent({
      invocationId: invocation.id,
      type: "cancel_applied",
      level: "info",
      message: "Invocation cancelled before execution."
    });
    state.auditSummaries.push(createAuditSummary(invocation, "Cancelled before local execution."));
    recordAgentUsage(invocation, "cancelled");
    return;
  }

  invocation.status = "cancelling";
  invocation.cancellation.state = "requested";
  invocation.updatedAt = now();
  appendEvent({
    invocationId: invocation.id,
    type: "cancel_requested",
    level: "info",
    message: "Running invocation cancellation requested."
  });

  if (agent?.adapter.type === "http") {
    const controller = directHttpRuns.get(invocation.id);
    if (controller) {
      appendEvent({
        invocationId: invocation.id,
        type: "cancel_dispatched",
        level: "info",
        message: "Server aborted the HTTP Agent request."
      });
      controller.abort();
      return;
    }
    if (agent.adapter.cancellation === "unsupported") {
      invocation.cancellation.state = "not_supported";
      appendEvent({
        invocationId: invocation.id,
        type: "cancel_failed",
        level: "warn",
        message: "HTTP Agent cancellation is not supported."
      });
      state.auditSummaries.push(createAuditSummary(invocation, "HTTP cancellation is not supported."));
    }
  }
}

function createAuditSummary(invocation, summary) {
  return {
    invocationId: invocation.id,
    requesterId: invocation.requestedBy,
    agentId: invocation.agentId,
    deviceId: invocation.delivery.deviceId,
    status: invocation.status,
    permissionDecision: invocation.status === "rejected" ? "denied" : "allowed",
    traceId: invocation.traceId ?? null,
    startedAt: invocation.createdAt,
    completedAt: invocation.completedAt ?? now(),
    resultSummary: invocation.status === "succeeded" ? summary : null,
    errorSummary: invocation.status === "succeeded" ? null : summary,
    dataStored: true,
    costSummary: "Demo agent cost is unknown; no billing was performed.",
    metadata: { namespace, protocolVersion }
  };
}

function createTrace(invocationId, agent = defaultAgent()) {
  const traceId = nextId("trc_demo");
  const spanId = nextId("spn_demo");
  const createdAt = now();
  const trace = {
    id: traceId,
    subjectType: "invocation",
    subjectId: invocationId,
    rootSpanId: spanId,
    createdAt
  };
  const span = {
    id: spanId,
    traceId,
    parentSpanId: null,
    name: "m0.remote_invocation",
    status: "started",
    startedAt: createdAt,
    endedAt: null,
    attributes: {
      deviceId: state.device.id,
      agentId: agent?.id ?? "unknown",
      adapterType: agent?.adapter.type ?? "unknown",
      transport: agent?.adapter.type === "http" ? "direct-http" : "polling-demo-websocket-baseline",
      queue: agent?.adapter.type === "http" ? "not-required" : "server-owned"
    }
  };
  state.traces.unshift(trace);
  state.spans.unshift(span);
  return { id: traceId, rootSpanId: spanId };
}

function completeRootSpan(invocation, terminalStatus) {
  const span = state.spans.find((item) => item.id === invocation.rootSpanId);
  if (!span || span.endedAt) {
    return;
  }
  span.status = terminalStatus === "succeeded" ? "succeeded" : terminalStatus === "cancelled" ? "cancelled" : "failed";
  span.endedAt = now();
}

function isTerminal(status) {
  return ["succeeded", "failed", "cancelled", "timed_out", "expired", "rejected"].includes(status);
}

function appendEvent(event) {
  const record = {
    id: nextId("evt_demo"),
    invocationId: event.invocationId,
    type: event.type,
    level: event.level,
    message: event.message,
    data: event.data ?? null,
    createdAt: now()
  };
  state.events.unshift(record);
  state.events = state.events.slice(0, 200);
  updateCodexSessionFromEvent(record);
  createCodexEvidenceRecord(record);
  persistStateSoon();
  return record;
}

function findInvocation(id) {
  return state.invocations.find((item) => item.id === id);
}

function findApprovalRequest(id) {
  return state.approvalRequests.find((item) => item.id === id);
}

function defaultAgent() {
  return state.agents.find((item) => item.id === "agt_demo_cli") ?? state.agents.find((item) => item.adapter.type !== "platform") ?? state.agents[0] ?? null;
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
  for (const invocation of state.invocations.filter((item) => ["queued", "waiting_for_local_approval"].includes(item.status))) {
    invocation.status = "cancelled";
    invocation.cancellation.state = "queued_cancelled";
    invocation.cancellation.requestedBy = "usr_local";
    invocation.cancellation.requestedAt = now();
    invocation.cancellation.reason = "Device unlinked before dispatch.";
    invocation.completedAt = now();
    invocation.updatedAt = now();
    const pendingApproval = invocation.approvalRequestId ? findApprovalRequest(invocation.approvalRequestId) : null;
    if (pendingApproval?.status === "pending") {
      pendingApproval.status = "denied";
      pendingApproval.decidedAt = now();
      pendingApproval.decidedBy = "usr_local";
    }
    appendEvent({
      invocationId: invocation.id,
      type: "device_queue_cancelled",
      level: "warn",
      message: "Queued invocation cancelled because the device was unlinked."
    });
    state.auditSummaries.push(createAuditSummary(invocation, "Device unlink cancelled queued local work."));
    recordAgentUsage(invocation, "cancelled");
  }
  for (const invocation of state.invocations.filter((item) => ["dispatching", "running"].includes(item.status))) {
    invocation.status = "cancelling";
    invocation.cancellation.state = "requested";
    invocation.cancellation.requestedBy = "usr_local";
    invocation.cancellation.requestedAt = now();
    invocation.cancellation.reason = "Device unlink requested cancellation for running local work.";
    invocation.updatedAt = now();
    appendEvent({
      invocationId: invocation.id,
      type: "cancel_requested",
      level: "warn",
      message: "Device unlink requested cancellation for running local work."
    });
  }
  appendEvent({
    invocationId: null,
    type: "device_unlinked",
    level: "info",
    message: "Desktop Bridge device credentials were revoked for unlink."
  });
}

function loopRoutineReadModelForCurrentProject() {
  return buildLoopRoutineStateSummary(currentLoopRoutineProjectContext());
}

function currentLoopRoutineProjectContext() {
  const project = currentProject();
  const root = project?.path ?? defaultProjectPath;
  return {
    root,
    projectId: project?.id ?? null,
    projectPath: root
  };
}

function publicState() {
  expireCodexApprovalBrokerRequests();
  return buildPublicState({
    namespace,
    protocolVersion,
    state,
    currentProject,
    defaultAgent,
    loopRoutineReadModel: loopRoutineReadModelForCurrentProject,
    codexApprovalQueue,
    evidenceCenterRecords,
  });
}

function evidenceCenterRecords() {
  const records = [];
  for (const evidence of state.codexEvidenceRecords) {
    records.push({
      id: evidence.id,
      type: evidence.fileChangeSummary ? "file_change" : evidence.commandSummary ? "command" : "jsonl_event",
      source: "managed_codex_jsonl",
      redactionState: evidence.redactionState,
      invocationId: evidence.invocationId,
      codexSessionRegistryId: evidence.codexSessionRegistryId,
      agentId: findInvocation(evidence.invocationId)?.agentId ?? null,
      repoPath: repoPathForEvidence(evidence.codexSessionRegistryId),
      summary: evidence.fileChangeSummary ?? evidence.commandSummary ?? evidence.summary,
      detail: evidence.diffPreview ?? evidence.summary,
      marker: "managed",
      createdAt: evidence.createdAt
    });
  }
  for (const hook of state.codexHookEvents) {
    records.push({
      id: hook.id,
      type: "hook_event",
      source: "managed_codex_hook",
      redactionState: hook.redactionState,
      invocationId: hook.invocationId,
      codexSessionRegistryId: hook.codexSessionRegistryId,
      agentId: findInvocation(hook.invocationId)?.agentId ?? null,
      repoPath: repoPathForEvidence(hook.codexSessionRegistryId),
      summary: `${hook.eventName}: ${hook.policyDecision}`,
      detail: hook.summary,
      marker: "managed",
      createdAt: hook.createdAt
    });
  }
  for (const request of state.codexApprovalBrokerRequests) {
    const session = request.codexSessionRegistryId ? state.codexSessions.find((item) => item.id === request.codexSessionRegistryId) : null;
    records.push({
      id: request.id,
      type: "approval",
      source: "managed_codex_approval_broker",
      redactionState: "summary_only",
      invocationId: request.invocationId,
      codexSessionRegistryId: request.codexSessionRegistryId,
      agentId: findInvocation(request.invocationId)?.agentId ?? null,
      repoPath: repoPathForEvidence(session?.id),
      summary: `${request.status}: ${request.toolName}`,
      detail: request.summary,
      marker: "managed",
      createdAt: request.createdAt
    });
  }
  for (const review of state.codexChangeReviews) {
    records.push({
      id: review.id,
      type: "change_review",
      source: "managed_codex_review",
      redactionState: "summary_only",
      invocationId: review.invocationId,
      codexSessionRegistryId: review.codexSessionRegistryId,
      agentId: findInvocation(review.invocationId)?.agentId ?? null,
      repoPath: repoPathForEvidence(review.codexSessionRegistryId),
      summary: `${review.decision}: ${review.fileChangeSummary}`,
      detail: review.comment || review.followUpPrompt || review.fileChangeSummary,
      marker: "managed",
      createdAt: review.createdAt
    });
  }
  for (const event of state.events.filter((item) => item.type === "codex_runtime_warning")) {
    records.push({
      id: event.id,
      type: "runtime_warning",
      source: "codex_stderr_summary",
      redactionState: "summary_only",
      invocationId: event.invocationId,
      codexSessionRegistryId: codexSessionForInvocation(event.invocationId)?.id ?? null,
      agentId: findInvocation(event.invocationId)?.agentId ?? null,
      repoPath: repoPathForEvidence(codexSessionForInvocation(event.invocationId)?.id),
      summary: event.message,
      detail: event.data?.summary ?? event.message,
      marker: "managed",
      createdAt: event.createdAt
    });
  }
  for (const evidence of state.terminalEvidenceRecords) {
    records.push({
      id: evidence.id,
      type: evidence.type,
      source: evidence.source,
      redactionState: evidence.redactionState,
      invocationId: evidence.ownerInvocationId === "manual_terminal_surface" ? null : evidence.ownerInvocationId,
      codexSessionRegistryId: evidence.ownerCodexSessionId,
      agentId: null,
      repoPath: evidence.repoPath,
      summary: evidence.summary,
      detail: evidence.detail,
      marker: evidence.marker,
      createdAt: evidence.createdAt
    });
  }
  for (const imported of state.codexImportedEvidenceRecords) {
    records.push({
      id: imported.id,
      type: "imported_evidence",
      source: imported.source,
      redactionState: imported.redactionState,
      invocationId: null,
      codexSessionRegistryId: imported.linkedManagedSessionId,
      agentId: null,
      repoPath: imported.repoPath,
      summary: imported.summary,
      detail: imported.summary,
      marker: imported.marker,
      createdAt: imported.createdAt
    });
  }
  return records.sort((a, b) => Date.parse(b.createdAt ?? 0) - Date.parse(a.createdAt ?? 0));
}

function runProtocolSelfCheck() {
  resetDemoStateForCheck();
  const defaultCodexAgent = findAgent("agt_codex_cli");
  assert(defaultCodexAgent?.status === "unavailable", "default Codex CLI agent should be registered enabled but unavailable while bridge is offline");
  assert(defaultCodexAgent.lifecycle.state === "enabled", "default Codex CLI agent should use the local CLI's native authorization");
  assert(defaultCodexAgent.adapter.outputFormat === "codex_jsonl", "default Codex CLI agent should use JSONL output");
  assert(defaultCodexAgent.adapter.sandbox === null, "default Codex CLI agent should not impose a Web Console sandbox");
  assert(!defaultCodexAgent.adapter.args.includes("--ephemeral"), "default Codex CLI agent should persist sessions for optional resume");
  assert(codexCliResumeArgs().includes("resume"), "Codex CLI resume args should be available for continuation");
  assert(!defaultCodexAgent.adapter.args.includes("read-only"), "default Codex CLI agent should defer sandboxing to Codex CLI");
  assert(defaultCodexAgent.capabilities[0].riskLevel === "high", "default Codex CLI agent should stay high risk");
  assert(defaultCodexAgent.registrationNotes.risk.includes("Codex CLI"), "default Codex CLI agent should expose Codex review notes");
  assert(state.terminalRuntimeCapability.localPty.available === true, "terminal runtime should report local PTY support");
  assert(state.terminalRuntimeCapability.contract.includes("MANAGED_TERMINAL_JOIN_CONTRACT"), "terminal capability should reference the join contract");
  const terminalSession = createManagedTerminalSession({ shell: state.terminalRuntimeCapability.defaultShell });
  assert(terminalSession.terminalSessionId.startsWith("term_"), "terminal session registry should allocate terminal session ids");
  assert(terminalSession.cwd && terminalSession.shell, "terminal session registry should record cwd and shell");
  assert(terminalSession.status === "attaching", "terminal session should wait for Desktop Bridge attach event");
  assert(terminalSession.evidenceIds.length > 0, "terminal session registry should create summary evidence");
  const terminalAction = nextTerminalBridgeAction();
  assert(terminalAction?.actionType === "create", "terminal create action should be bridge-visible");
  assert(recordTerminalBridgeEvent({ terminalSessionId: terminalSession.terminalSessionId, actionId: terminalAction.id, type: "terminal.session.attached", summary: "self-check attached" }).ok, "terminal attach event should update session");
  assert(terminalSession.status === "attached", "terminal attach event should mark session attached");
  const inputAction = queueTerminalBridgeAction(terminalSession, "input", { input: "echo self-check\r" });
  assert(nextTerminalBridgeAction()?.id === inputAction.id, "terminal input action should be bridge-visible");
  assert(recordTerminalBridgeEvent({ terminalSessionId: terminalSession.terminalSessionId, actionId: inputAction.id, type: "terminal.output.chunk", output: "self-check", byteCount: 10, summary: "Terminal output: self-check" }).ok, "terminal output event should create evidence");
  const resizeAction = queueTerminalBridgeAction(terminalSession, "resize", { cols: 100, rows: 30 });
  assert(nextTerminalBridgeAction()?.id === resizeAction.id, "terminal resize action should be bridge-visible");
  assert(recordTerminalBridgeEvent({ terminalSessionId: terminalSession.terminalSessionId, actionId: resizeAction.id, type: "terminal.resize", cols: 100, rows: 30, summary: "self-check resized" }).ok, "terminal resize event should create evidence");
  assert(recordTerminalBridgeEvent({ terminalSessionId: terminalSession.terminalSessionId, type: "terminal.exit", exitCode: 0, summary: "self-check exited" }).ok, "terminal exit event should close lifecycle");
  assert(evidenceCenterRecords().some((record) => record.source === "managed_terminal_runtime"), "Evidence Center should include managed terminal evidence summaries");
  const codexWorkspace = createManagedCodexWorkspace({ invocationId: "inv_self_codex_terminal", agent: defaultCodexAgent, workspacePolicy: "current_repo" });
  const codexSession = createManagedCodexSession({ invocationId: "inv_self_codex_terminal", agent: defaultCodexAgent, codexSessionMode: "continue_last", workspace: codexWorkspace });
  const codexTerminal = createManagedTerminalSession({ ownerCodexSessionId: codexSession.id, ownerInvocationId: "inv_self_codex_terminal", shell: state.terminalRuntimeCapability.defaultShell });
  assert(codexTerminal.ownerCodexSessionId === codexSession.id, "Codex terminal session should link to managed Codex session registry");
  const codexTerminalAction = nextTerminalBridgeAction();
  assert(codexTerminalAction?.terminalSessionId === codexTerminal.terminalSessionId, "Codex terminal create action should be bridge-visible");
  assert(recordTerminalBridgeEvent({ terminalSessionId: codexTerminal.terminalSessionId, actionId: codexTerminalAction.id, type: "terminal.session.attached", summary: "self-check Codex terminal attached" }).ok, "Codex terminal attach event should update session");
  assert(evidenceCenterRecords().some((record) => record.source === "managed_terminal_runtime" && record.codexSessionRegistryId === codexSession.id), "Codex terminal evidence should preserve Codex session linkage");
  const sshTarget = createSshTarget({
    name: "Self-check SSH target",
    host: "example.internal",
    port: 22,
    user: "dev",
    authMethod: "private_key_ref",
    credentialRef: "external-secret:ssh/self-check",
    knownHostPolicy: "pinned_fingerprint",
    knownHostFingerprint: "SHA256:selfcheck",
    workspaceRoot: "/srv/myagenttool",
    platformHint: "linux",
    agentForwarding: false,
    keySelection: "explicit_key_ref"
  });
  assert(sshTarget.id.startsWith("ssh_target_"), "SSH target registry should allocate target ids");
  assert(sshTarget.credentialStorage === "external_reference_only", "SSH target should store credential references only");
  assert(sshTarget.remoteRelayEnabled === false, "SSH target design should not enable remote relay PTY");
  const sshTest = createSshConnectionTest(sshTarget);
  assert(sshTest.status === "ready_for_manual_test", "SSH preflight should pass with explicit credential and pinned host");
  assert(sshTest.auth.plaintextStored === false, "SSH test report should not store plaintext credentials");
  const remoteTerminal = createManagedTerminalSession({
    runtimeKind: "remote_ssh_relay",
    targetId: sshTarget.id,
    shell: "bash",
    cwd: "/srv/myagenttool"
  });
  assert(remoteTerminal.runtimeKind === "remote_ssh_relay", "remote relay terminal session should preserve runtime kind");
  assert(remoteTerminal.remoteHost === sshTarget.host, "remote relay terminal session should record remote host");
  const remoteAction = nextTerminalBridgeAction();
  assert(remoteAction?.session?.runtimeKind === "remote_ssh_relay", "remote relay create action should be bridge-visible");
  assert(recordTerminalBridgeEvent({ terminalSessionId: remoteTerminal.terminalSessionId, actionId: remoteAction.id, type: "terminal.session.attached", summary: "self-check remote relay attached" }).ok, "remote relay attach event should update session");
  assert(recordTerminalBridgeEvent({ terminalSessionId: remoteTerminal.terminalSessionId, type: "terminal.output.chunk", output: "remote self-check", byteCount: 17, summary: "Terminal output: remote self-check" }).ok, "remote relay output event should create evidence");
  assert(evidenceCenterRecords().some((record) => record.source === "managed_terminal_runtime" && record.detail.includes("remote self-check")), "Evidence Center should include remote relay terminal output summaries");
  const blockedSshTarget = createSshTarget({
    host: "blocked.example.internal",
    user: "dev",
    authMethod: "private_key_ref",
    knownHostPolicy: "manual_review",
    workspaceRoot: "/srv/myagenttool"
  });
  const blockedSshTest = createSshConnectionTest(blockedSshTarget);
  assert(blockedSshTest.status === "blocked", "SSH preflight should block missing external credential reference");
  const cliAgent = registerAgent({
    id: "agt_self_cli",
    type: "cli",
    name: "Self-check CLI",
    command: "demo-agent",
    args: ["{{payloadJson}}"],
    timeoutSeconds: 10
  });
  assert(cliAgent.adapter.type === "cli", "CLI agent should register");
  assert(cliAgent.adapter.args[0] === "{{payloadJson}}", "CLI agent should keep structured argv template");

  state.device.status = "online";
  const discoveryRun = createDiscoveryRun({
    scope: ["known_command_allowlist", "known_local_endpoint"],
    userProvidedPaths: ["demo-agent"],
    userProvidedEndpoints: ["http://127.0.0.1:3212"]
  });
  assert(discoveryRun.status === "queued", "online discovery should queue");
  assert(nextBridgeDiscoveryRun()?.id === discoveryRun.id, "queued discovery should be bridge-visible");
  markDiscoveryStarted(discoveryRun);
  completeDiscoveryRun(discoveryRun, {
    candidates: [
      {
        id: "cand_self_demo",
        name: "Self-check Discovered Demo Agent",
        adapter: { type: "cli", command: "demo-agent", args: ["{{payloadJson}}"] },
        source: "known_command_allowlist",
        confidence: "high",
        riskLevel: "low",
        riskTags: ["read_only"],
        healthProbeAvailable: true
      }
    ]
  });
  assert(discoveryRun.status === "succeeded", "discovery should complete");
  assert(discoveryRun.candidates.length === 1, "discovery should keep candidates");
  assert(!state.agents.some((agent) => agent.id === discoveryRun.candidates[0].registration.agentId), "discovery should not auto-register candidates");
  const discoveredAgent = registerDiscoveredCandidate(discoveryRun, discoveryRun.candidates[0]);
  assert(discoveredAgent.status === "disabled", "registered discovery candidate should stay disabled");
  assert(discoveryRun.candidates[0].registration.status === "registered", "candidate registration status should update");

  const codexDiscovery = createDiscoveryRun({
    scope: ["user_provided_path"],
    userProvidedPaths: ["codex"]
  });
  markDiscoveryStarted(codexDiscovery);
  completeDiscoveryRun(codexDiscovery, {
    candidates: [
      {
        id: "cand_self_codex",
        name: "Codex CLI",
        adapter: { type: "cli", command: "codex" },
        source: "user_provided_path",
        confidence: "medium",
        riskLevel: "high",
        healthProbeAvailable: true
      }
    ]
  });
  assert(codexDiscovery.candidates[0].adapter.command === "codex", "user-provided Codex CLI should be discoverable when explicit");
  assert(codexDiscovery.candidates[0].riskLevel === "high", "Codex-like CLI discovery should be high risk");
  assert(codexDiscovery.candidates[0].adapter.args.includes("--json"), "Codex discovery should use JSONL output");
  assert(!codexDiscovery.candidates[0].adapter.args.includes("read-only"), "Codex discovery should defer sandboxing to Codex CLI");
  assert(codexDiscovery.candidates[0].adapter.outputFormat === "codex_jsonl", "Codex discovery should mark JSONL output");
  assert(codexDiscovery.candidates[0].riskTags.includes("repo_context"), "Codex discovery should include repository context risk");
  const codexAgent = registerDiscoveredCandidate(codexDiscovery, codexDiscovery.candidates[0]);
  assert(codexAgent.status === "available", "explicit Codex discovery registration should be available when bridge is online");
  assert(codexAgent.adapter.outputFormat === "codex_jsonl", "registered Codex candidate should preserve JSONL output config");
  const managedCodexInvocation = createInvocation("self-check managed Codex session", codexAgent, { codexSessionMode: "continue_last" });
  const managedCodexSession = codexSessionForInvocation(managedCodexInvocation.id);
  assert(managedCodexInvocation.options.metadata.managedCodexSessionId === managedCodexSession?.id, "Codex invocation should link to managed session registry");
  assert(managedCodexSession.sessionMode === "continue_last", "managed Codex registry should record session mode");
  assert(managedCodexSession.workspaceId, "managed Codex registry should link a workspace registry record");
  const managedCodexWorkspace = state.codexWorkspaces.find((item) => item.id === managedCodexSession.workspaceId);
  assert(managedCodexWorkspace?.policy === "current_repo", "managed Codex workspace should default to current repo policy");
  appendEvent({
    invocationId: managedCodexInvocation.id,
    type: "execution_preview",
    level: "info",
    message: "Execution preview: codex exec --json <task>",
    data: {
      workspace: {
        repoPath: "/tmp/myagenttool",
        branchName: "main",
        dirtyState: "clean",
        lastCommit: "abc1234",
        status: "observed"
      }
    }
  });
  assert(managedCodexWorkspace.branchName === "main", "managed Codex workspace should learn branch from execution preview");
  assert(managedCodexWorkspace.dirtyState === "clean", "managed Codex workspace should learn dirty state from execution preview");
  appendEvent({
    invocationId: managedCodexInvocation.id,
    type: "agent_output",
    level: "info",
    message: "Codex thread started: self_check_thread.",
    data: { source: "codex_jsonl", eventType: "thread.started", threadId: "self_check_thread" }
  });
  appendEvent({
    invocationId: managedCodexInvocation.id,
    type: "agent_output",
    level: "info",
    message: "modified: docs/engineering/CODEX_FIXTURE_REVIEW.md",
    data: {
      source: "codex_jsonl",
      eventType: "item.completed",
      itemType: "file_change",
      fileChangeSummary: "modified: docs/engineering/CODEX_FIXTURE_REVIEW.md",
      fileChangePath: "docs/engineering/CODEX_FIXTURE_REVIEW.md",
      fileChangeAction: "modified",
      diffPreview: "diff --git a/docs/engineering/CODEX_FIXTURE_REVIEW.md b/docs/engineering/CODEX_FIXTURE_REVIEW.md",
      changeRisk: "medium"
    }
  });
  assert(managedCodexSession.codexThreadId === "self_check_thread", "managed Codex registry should learn thread id from JSONL events");
  assert(state.codexEvidenceRecords.some((item) => item.codexSessionRegistryId === managedCodexSession.id), "Codex JSONL events should create evidence records");
  const selfCheckChangeEvidence = state.codexEvidenceRecords.find((item) => item.codexSessionRegistryId === managedCodexSession.id && item.fileChangeSummary);
  assert(selfCheckChangeEvidence?.diffPreview, "Codex file-change evidence should retain a redacted diff preview");
  const selfCheckChangeReview = createCodexChangeReview({
    evidenceId: selfCheckChangeEvidence.id,
    decision: "feedback",
    comment: "Please tighten the wording before adopting this change."
  });
  assert(selfCheckChangeReview.followUpPrompt?.includes(selfCheckChangeEvidence.id), "Codex change feedback should preserve evidence linkage");
  const hookRecord = recordCodexHookEvent({
    invocationId: managedCodexInvocation.id,
    eventName: "UserPromptSubmit",
    summary: "Please do not paste ~/.codex/auth.json."
  });
  assert(hookRecord.policyDecision === "blocked", "Codex hook policy should flag credential-looking prompt content");
  recordCodexHookEvent({
    invocationId: managedCodexInvocation.id,
    eventName: "PermissionRequest",
    toolName: "Bash",
    summary: "Self-check permission request"
  });
  const brokerRequest = state.codexApprovalBrokerRequests.find((item) => item.invocationId === managedCodexInvocation.id);
  assert(brokerRequest?.status === "pending", "Codex PermissionRequest hook should create a broker request");
  resolveCodexApprovalBrokerRequest(brokerRequest, "approve");
  assert(brokerRequest.status === "approved", "Codex approval broker should resolve approval");
  recordCodexHookEvent({
    invocationId: managedCodexInvocation.id,
    eventName: "PermissionRequest",
    toolName: "Bash",
    summary: "Self-check expiring permission request",
    timeoutSeconds: 1
  });
  const expiringBrokerRequest = state.codexApprovalBrokerRequests.find((item) => item.summary === "Self-check expiring permission request");
  expiringBrokerRequest.timeoutAt = new Date(Date.now() - 1).toISOString();
  expireCodexApprovalBrokerRequests();
  assert(expiringBrokerRequest.status === "timed_out", "Codex approval broker should deterministically time out pending requests");
  assert(state.events.some((item) => item.type === "codex_approval_timed_out" && item.data?.approvalBrokerRequestId === expiringBrokerRequest.id), "Codex approval timeout should be audited");
  const importedEvidence = createCodexImportedEvidenceRecord({
    summary: "Self-check imported Codex evidence summary.",
    source: "user_selected_local_preview"
  });
  assert(importedEvidence.marker === "imported_after_the_fact", "imported Codex evidence should be marked after the fact");
  assert(!state.codexSessions.some((item) => item.id === importedEvidence.id), "imported evidence must not become a managed session");
  const compareRun = createCompareRun("self-check compare run", [cliAgent, codexAgent], { codexWorkspacePolicy: "current_repo" });
  assert(compareRun.childInvocationIds.length === 2, "compare run should create child invocations");
  assert(compareRun.childInvocationIds.every((id) => findInvocation(id)?.compareRunId === compareRun.id), "compare child invocations should link to parent compare run");

  const draftArtifact = createIntegrationArtifact({
    targetType: "cli",
    title: "Self-check integration",
    description: "I have an unsupported local CLI agent.",
    command: "demo-agent",
    cancellation: "supported",
    environmentNeeds: "No secrets required."
  });
  assert(draftArtifact.reviewState === "draft", "intake should record a draft integration artifact");
  assert(draftArtifact.generatedByAi === false, "intake draft should not be marked AI-generated");
  const generatedArtifacts = generateIntegrationArtifacts(draftArtifact);
  const adapterArtifact = generatedArtifacts.find((item) => item.artifactType === "adapter_config");
  assert(adapterArtifact?.generatedByAi === true, "generated adapter config should record AI metadata");
  assert(adapterArtifact.reviewState === "needs_review", "generated adapter config should need review");
  const codexDraftArtifact = createIntegrationArtifact({
    targetType: "cli",
    title: "Self-check Codex integration",
    description: "I want to connect Codex CLI for repository review tasks.",
    command: "codex",
    cancellation: "supported",
    environmentNeeds: "Use existing local Codex authentication."
  });
  const codexAdapterArtifact = generateIntegrationArtifacts(codexDraftArtifact).find((item) => item.artifactType === "adapter_config");
  assert(codexAdapterArtifact.payload.adapterConfig.args.includes("--json"), "Codex adapter config should request JSONL output");
  assert(!codexAdapterArtifact.payload.adapterConfig.args.includes("read-only"), "Codex adapter config should defer sandboxing to Codex CLI");
  assert(codexAdapterArtifact.payload.adapterConfig.outputFormat === "codex_jsonl", "Codex adapter config should declare JSONL output");
  assert(codexAdapterArtifact.governance.riskTags.includes("repo_context"), "Codex adapter config should record repo context risk");
  transitionIntegrationArtifact(adapterArtifact, "approve");
  const probeRun = createIntegrationProbeRun(adapterArtifact);
  assert(probeRun.status === "queued", "CLI probe should queue for Desktop Bridge");
  markIntegrationProbeStarted(probeRun);
  completeIntegrationProbeRun(probeRun, {
    status: "succeeded",
    summary: "Self-check probe passed.",
    details: ["Restricted CLI probe completed."]
  });
  assert(adapterArtifact.reviewState === "tested", "passing probe should mark adapter artifact tested");
  const generatedAgent = registerIntegrationArtifact(adapterArtifact);
  assert(generatedAgent.status === "disabled", "registered integration artifact should create disabled agent");
  assert(adapterArtifact.reviewState === "enabled", "explicit registration should record enabled artifact state");
  assert(state.quotaDecisionRecords.some((item) => item.artifactId === draftArtifact.id), "integration artifact should record quota decision");
  state.device.status = "offline";

  const httpAgent = registerAgent({
    id: "agt_self_http",
    type: "http",
    name: "Self-check HTTP",
    baseUrl: "http://127.0.0.1:1",
    requestPath: "/invoke",
    timeoutSeconds: 10,
    cancellation: "supported"
  });
  assert(httpAgent.adapter.type === "http", "HTTP agent should register");
  assert(httpAgent.adapter.baseUrl === "http://127.0.0.1:1", "HTTP agent should keep base URL");
  assert(httpAgent.adapter.healthPath === "/health", "HTTP agent should default health path");
  assert(findAgent("agt_platform_troubleshooter")?.adapter.type === "platform", "platform troubleshooter should be registered");

  const disableOperation = disableAgent(cliAgent);
  assert(cliAgent.status === "disabled", "disabled CLI agent should report disabled");
  assert(disableOperation.status === "succeeded", "disable operation should complete");

  const disabledInvocation = createInvocation("disabled dispatch should wait", cliAgent);
  assert(nextDispatchableInvocation()?.id !== disabledInvocation.id, "disabled agent work should not dispatch");

  const enableOperation = enableAgent(cliAgent);
  assert(enableOperation.status === "succeeded", "enable operation should complete");
  assert(cliAgent.status === "unavailable", "enabled offline CLI agent should be unavailable");

  state.device.status = "online";
  const healthOperation = createAgentHealthCheck(cliAgent);
  assert(healthOperation.status === "queued", "CLI health check should queue for Desktop Bridge");
  assert(nextBridgeHealthCheck()?.id === healthOperation.id, "queued CLI health check should be bridge-visible");
  markHealthCheckStarted(healthOperation);
  completeHealthCheck(healthOperation, {
    status: "healthy",
    message: "Self-check CLI health passed.",
    nextAction: null
  });
  assert(cliAgent.health?.status === "healthy", "completed CLI health should mark agent healthy");
  assert(state.lifecycleAuditRecords.some((item) => item.id === healthOperation.id && item.status === "succeeded"), "health should record lifecycle audit");
  state.device.status = "offline";

  const traceCountBeforeInvocation = state.traces.length;
  const spanCountBeforeInvocation = state.spans.length;
  const invocation = createInvocation("self-check invocation", cliAgent);
  assert(invocation.status === "queued", "created invocation should be queued");
  assert(invocation.delivery.state === "queued", "created delivery should be queued");
  assert(invocation.agentId === cliAgent.id, "created invocation should reference selected CLI agent");
  assert(state.traces.length === traceCountBeforeInvocation + 1 && state.spans.length === spanCountBeforeInvocation + 1, "trace and root span should be created");

  markDispatched(invocation);
  assert(invocation.status === "dispatching", "dispatched invocation should be dispatching");
  assert(invocation.delivery.state === "dispatching", "delivery should be dispatching");
  assert(invocation.delivery.dispatchAttempts === 1, "dispatch attempts should increment");

  invocation.delivery.leaseExpiresAt = new Date(Date.now() - 1000).toISOString();
  redeliverExpiredDispatches();
  assert(invocation.status === "queued", "expired dispatch lease should return invocation to queued");
  assert(invocation.delivery.state === "redelivering", "expired dispatch lease should mark redelivering");

  const redelivery = nextDispatchableInvocation();
  assert(redelivery?.id === invocation.id, "redelivering invocation should be dispatchable");
  markDispatched(invocation);
  assert(invocation.delivery.dispatchAttempts === 2, "redelivery should increment attempts");

  acknowledgeInvocation(invocation);
  acknowledgeInvocation(invocation);
  assert(invocation.status === "running", "acknowledged invocation should be running");
  assert(invocation.delivery.state === "acknowledged", "delivery should be acknowledged");
  assert(invocation.delivery.leaseExpiresAt === null, "acknowledgement should clear lease");

  completeInvocation(invocation, {
    status: "succeeded",
    summary: "Self-check completed.",
    result: { touchedUserFiles: false }
  });
  assert(invocation.status === "succeeded", "completed invocation should succeed");
  assert(state.auditSummaries.some((item) => item.invocationId === invocation.id && item.traceId === invocation.traceId), "audit summary should reference trace");
  assert(state.spans.find((item) => item.id === invocation.rootSpanId)?.status === "succeeded", "root span should complete");
  assert(getAgentUsageSummary(cliAgent.id).succeededCount === 1, "successful invocation should increment agent usage");

  const failedForTroubleshooting = createInvocation("self-check failed invocation", cliAgent);
  completeInvocation(failedForTroubleshooting, {
    status: "failed",
    summary: "Self-check adapter failure.",
    result: null
  });
  const report = createTroubleshootingReport(failedForTroubleshooting);
  assert(report.invocationId === failedForTroubleshooting.id, "troubleshooter report should target failed invocation");
  assert(report.adapterError?.includes("Self-check adapter failure"), "troubleshooter should summarize adapter error");
  assert(report.suggestedFixes.some((item) => item.includes("approved workflow")), "troubleshooter should not remediate automatically");
  assert(state.invocations.some((item) => item.agentId === "agt_platform_troubleshooter" && item.status === "succeeded"), "troubleshooter should use normal invocation path");
  assert(state.auditSummaries.some((item) => item.agentId === "agt_platform_troubleshooter"), "troubleshooter should write audit through invocation completion");
  assert(getAgentUsageSummary("agt_platform_troubleshooter").succeededCount === 1, "platform agent usage should be counted");

  const highRiskAgent = registerAgent({
    id: "agt_self_high_risk",
    type: "cli",
    name: "Self-check High Risk CLI",
    command: "demo-agent",
    args: ["{{payloadJson}}"],
    riskLevel: "high",
    riskTags: ["read_local", "shell_exec", "destructive"]
  });
  const approvalInvocation = createInvocation("high-risk invocation approval path", highRiskAgent);
  assert(approvalInvocation.status === "waiting_for_local_approval", "high-risk invocation should wait for local approval");
  assert(approvalInvocation.delivery.dispatchAttempts === 0, "approval-gated invocation should not dispatch");
  assert(nextDispatchableInvocation()?.id !== approvalInvocation.id, "approval-gated invocation should not be dispatchable");
  const approval = findApprovalRequest(approvalInvocation.approvalRequestId);
  assert(approval?.status === "pending", "approval request should be pending");
  assert(approval.summary.risk && approval.summary.data && approval.summary.cost && approval.summary.cancellation, "approval request should include plain-language summary");
  const policyRecord = state.policyDecisionRecords.find((item) => item.id === approvalInvocation.policyDecisionId);
  assert(policyRecord?.decision === "requires_local_approval", "policy should require approval");
  assert(policyRecord.riskTags.includes("destructive"), "policy should record risk tags");
  approveInvocation(approval, approvalInvocation);
  assert(approval.status === "approved", "approval should be granted");
  assert(approvalInvocation.status === "queued", "approved local invocation should enter queue");
  assert(nextDispatchableInvocation()?.id === approvalInvocation.id, "approved local invocation should become dispatchable");
  cancelInvocation(approvalInvocation);
  assert(approvalInvocation.status === "cancelled", "approved self-check invocation should be cancellable before dispatch");

  const deniedInvocation = createInvocation("high-risk invocation denial path", highRiskAgent);
  const deniedApproval = findApprovalRequest(deniedInvocation.approvalRequestId);
  denyInvocation(deniedApproval, deniedInvocation);
  assert(deniedApproval.status === "denied", "approval should be denied");
  assert(deniedInvocation.status === "rejected", "denied approval should reject invocation");
  assert(state.auditSummaries.some((item) => item.invocationId === deniedInvocation.id && item.permissionDecision === "denied"), "denied approval should be audited");
  assert(state.events.some((item) => item.invocationId === deniedInvocation.id && item.type === "local_approval_denied"), "denied approval should emit an event");
  assert(getAgentUsageSummary(highRiskAgent.id).failedCount >= 1, "denied invocation should increment failed usage count");

  const queuedCancel = createInvocation("queued cancellation");
  cancelInvocation(queuedCancel);
  assert(queuedCancel.status === "cancelled", "queued cancellation should cancel invocation");
  assert(queuedCancel.cancellation.state === "queued_cancelled", "queued cancellation state should be queued_cancelled");

  const unlinkQueued = createInvocation("unlink cancellation", cliAgent);
  unlinkDevice();
  assert(state.device.unlinkState === "unlinked", "unlink should mark device unlinked");
  assert(Boolean(state.device.credentialRevokedAt), "unlink should revoke device credentials");
  assert(unlinkQueued.status === "cancelled", "unlink should cancel queued local invocations");
  assert(state.auditSummaries.some((item) => item.invocationId === unlinkQueued.id && item.errorSummary?.includes("Device unlink")), "unlink should audit queued cleanup");

  resetDemoStateForCheck();
  const runningCancelAgent = registerAgent({
    id: "agt_running_cancel",
    type: "cli",
    name: "Running cancel CLI",
    command: "demo-agent"
  });
  const runningCancel = createInvocation("running unlink cancellation", runningCancelAgent);
  markDispatched(runningCancel);
  acknowledgeInvocation(runningCancel);
  unlinkDevice();
  assert(runningCancel.status === "cancelling", "unlink should request cancellation for running local invocations");
  assert(runningCancel.cancellation.state === "requested", "running unlink cancellation should be requested");
}

function resetDemoStateForCheck() {
  state.device.status = "offline";
  state.device.unlinkState = "linked";
  state.device.credentialRevokedAt = null;
  state.agents = state.agents.filter((agent) => ["agt_demo_cli", "agt_codex_cli", "agt_platform_troubleshooter", "agt_platform_integration_builder"].includes(agent.id));
  const demoAgent = defaultAgent();
  if (demoAgent) {
    demoAgent.status = "unavailable";
    demoAgent.updatedAt = now();
  }
  const codexAgent = findAgent("agt_codex_cli");
  if (codexAgent) {
    codexAgent.lifecycle = { ...codexAgent.lifecycle, state: "enabled" };
    codexAgent.status = "unavailable";
    codexAgent.health = {
      status: "unknown",
      checkedAt: null,
      message: "Codex CLI setup has not been checked yet.",
      nextAction: "Run a health check before the first Codex task."
    };
    codexAgent.updatedAt = now();
  }
  state.invocations = [];
  state.events = [];
  state.traces = [];
  state.spans = [];
  state.auditSummaries = [];
  state.healthChecks = [];
  state.lifecycleAuditRecords = [];
  state.discoveryRuns = [];
  state.integrationArtifacts = [];
  state.integrationProbeRuns = [];
  state.quotaDecisionRecords = [];
  state.retentionSettings = {
    ...state.retentionSettings,
    logsDays: 14,
    promptsDays: 30,
    responsesDays: 30,
    artifactsDays: 90,
    updatedAt: now()
  };
  state.approvalRequests = [];
  state.policyDecisionRecords = [];
  state.troubleshootingReports = [];
  state.agentUsageSummaries = [];
  state.codexSessions = [];
  state.codexWorkspaces = [];
  state.codexEvidenceRecords = [];
  state.codexChangeReviews = [];
  state.codexHookEvents = [];
  state.codexApprovalBrokerRequests = [];
  state.codexImportedEvidenceRecords = [];
  state.terminalSessions = [];
  state.terminalEvidenceRecords = [];
  state.terminalBridgeActions = [];
  state.sshTargets = [];
  state.sshConnectionTests = [];
  state.terminalRuntimeCapability = createTerminalRuntimeCapability();
  idCounter = 1;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(res, status, body) {
  if (status === 204) {
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}
