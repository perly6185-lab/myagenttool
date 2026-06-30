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

function registerAgent(body) {
  const type = body.type ?? body.adapter?.type;
  if (!["cli", "http"].includes(type)) {
    throw new Error("M0 supports manual cli and http agent registration only.");
  }

  const agent = type === "cli" ? createCliAgent(body) : createHttpAgent(body);
  const existingIndex = state.agents.findIndex((item) => item.id === agent.id);
  if (existingIndex >= 0) {
    const existing = state.agents[existingIndex];
    const merged = {
      ...existing,
      ...agent,
      health: existing.health ?? agent.health,
      updatedAt: now()
    };
    if (isAgentDisabled(existing)) {
      merged.lifecycle = { ...agent.lifecycle, state: "disabled" };
      merged.status = "disabled";
    }
    state.agents[existingIndex] = merged;
    return merged;
  } else {
    state.agents.push(agent);
    return agent;
  }
}

function createCliAgent(body) {
  const id = sanitizeAgentId(body.id ?? nextId("agt_cli"));
  const command = String(body.command ?? body.adapter?.command ?? "").trim();
  if (!command) {
    throw new Error("CLI agent command is required.");
  }
  const args = Array.isArray(body.args ?? body.adapter?.args) ? (body.args ?? body.adapter.args).map(String) : [];
  const codexCommand = isCodexCliCommand(command);
  const normalizedArgs = args.length > 0 ? args : codexCommand ? codexCliArgs() : [];
  return baseAgent({
    id,
    type: "cli",
    name: body.name ?? "Manual CLI Agent",
    description: body.description ?? "Manually registered CLI agent.",
    location: { type: "local_device", deviceId: state.device.id },
    adapter: {
      type: "cli",
      command,
      args: normalizedArgs,
      workingDirectory: body.workingDirectory ?? null,
      workingDirectoryPolicy: body.workingDirectory ? "explicit" : "bridge_default",
      environmentPolicy: body.env ? "explicit_only" : "inherit_safe",
      env: normalizeEnv(body.env),
      timeoutSeconds: Number(body.timeoutSeconds ?? (codexCommand ? 120 : 30)),
      cancellation: "supported",
      outputFormat: normalizeCliOutputFormat(body.outputFormat ?? body.adapter?.outputFormat, command),
      sandbox: body.sandbox ?? body.adapter?.sandbox ?? null
    },
    capabilities: [
      {
        name: body.capabilityName ?? "manual_cli_task",
        description: body.capabilityDescription ?? "Runs a manually registered local CLI command.",
        riskLevel: normalizeRiskLevel(body.riskLevel, codexCommand ? "high" : "medium"),
        riskTags: normalizeRiskTags(body.riskTags ?? body.capabilityRiskTags, codexCommand ? codexRiskTags() : ["read_local", "shell_exec"])
      }
    ],
    status: state.device.status === "online" ? "available" : "unavailable",
    registrationNotes: codexCommand ? codexRegistrationNotes() : {
      risk: "Runs a local command with structured argv. Review the command, arguments, working directory, and environment before invoking.",
      data: "Task input and command output are streamed to the local demo server as invocation events.",
      cost: "Cost is external or unknown unless the registered command reports it.",
      cancellation: "The Desktop Bridge attempts to terminate the process tree when cancellation is requested."
    },
    economics: normalizeAgentEconomics(body)
  });
}

function createHttpAgent(body) {
  const id = sanitizeAgentId(body.id ?? nextId("agt_http"));
  const baseUrl = String(body.baseUrl ?? body.adapter?.baseUrl ?? "").trim();
  if (!baseUrl) {
    throw new Error("HTTP agent baseUrl is required.");
  }
  const requestPath = String(body.requestPath ?? body.adapter?.requestPath ?? "/invoke");
  const healthPath = String(body.healthPath ?? body.adapter?.healthPath ?? "/health");
  return baseAgent({
    id,
    type: "http",
    name: body.name ?? "Manual HTTP Agent",
    description: body.description ?? "Manually registered HTTP agent.",
    location: { type: "remote_http", baseUrl },
    adapter: {
      type: "http",
      baseUrl,
      authMode: body.authMode ?? body.adapter?.authMode ?? "none",
      requestPath,
      healthPath,
      method: "POST",
      payloadShape: body.payloadShape ?? { task: "string" },
      timeoutSeconds: Number(body.timeoutSeconds ?? 30),
      streaming: Boolean(body.streaming ?? false),
      cancellation: body.cancellation ?? "supported"
    },
    capabilities: [
      {
        name: body.capabilityName ?? "manual_http_task",
        description: body.capabilityDescription ?? "Runs a manually registered HTTP endpoint.",
        riskLevel: normalizeRiskLevel(body.riskLevel, "medium"),
        riskTags: normalizeRiskTags(body.riskTags ?? body.capabilityRiskTags, ["network_access", "external_data_transfer"])
      }
    ],
    status: "available",
    registrationNotes: {
      risk: "Sends invocation input to the configured HTTP endpoint.",
      data: "Task input leaves the local demo server and endpoint response is stored as the result.",
      cost: "Cost is external or unknown unless the endpoint reports it.",
      cancellation: "The server aborts the HTTP request when supported; otherwise cancellation is recorded as not supported or unknown."
    },
    economics: normalizeAgentEconomics(body)
  });
}

function baseAgent({ id, name, description, location, adapter, capabilities, status, registrationNotes, economics = {} }) {
  const createdAt = now();
  return {
    id,
    name: String(name),
    description: String(description),
    ownerUserId: "usr_local",
    location,
    adapter,
    lifecycle: {
      state: "enabled",
      installState: "installed",
      version: "0.0.0",
      managedBy: adapter.type === "http" ? "external" : adapter.type === "platform" ? "platform" : "bridge"
    },
    economics: {
      model: normalizeEconomicModel(economics.model, "unknown"),
      pricingDimensions: normalizeStringArray(economics.pricingDimensions),
      currency: String(economics.currency ?? "USD"),
      costOwner: String(economics.costOwner ?? "usr_local"),
      budgetPoolId: economics.budgetPoolId ?? null,
      revenueOwner: economics.revenueOwner ?? null,
      unknownCostPolicy: normalizeUnknownCostPolicy(economics.unknownCostPolicy, "warn")
    },
    capabilities,
    status,
    health: {
      status: "unknown",
      checkedAt: null,
      message: "Health has not been checked yet.",
      nextAction: "Run a health check before relying on this agent."
    },
    registrationNotes,
    createdAt,
    updatedAt: createdAt
  };
}

function disableAgent(agent) {
  const operation = createLifecycleOperation(agent, "disable", "Disabled from Web Console.");
  startLifecycleOperation(operation, `Disabling ${agent.name}.`);
  agent.lifecycle = { ...agent.lifecycle, state: "disabled" };
  agent.status = "disabled";
  agent.updatedAt = now();
  finishLifecycleOperation(operation, "succeeded", `${agent.name} is disabled. New invocations are blocked.`);
  return operation;
}

function enableAgent(agent) {
  const operation = createLifecycleOperation(agent, "enable", "Enabled from Web Console.");
  startLifecycleOperation(operation, `Enabling ${agent.name}.`);
  agent.lifecycle = { ...agent.lifecycle, state: "enabled" };
  agent.status = enabledAgentStatus(agent);
  agent.updatedAt = now();
  finishLifecycleOperation(operation, "succeeded", `${agent.name} is enabled.`);
  return operation;
}

function createAgentHealthCheck(agent) {
  const operation = createLifecycleOperation(agent, "health_check", "Health check requested from Web Console.");
  state.healthChecks.unshift(operation);
  state.healthChecks = state.healthChecks.slice(0, 50);
  agent.health = {
    status: "checking",
    checkedAt: null,
    message: "Health check requested.",
    nextAction: "Wait for the health result."
  };
  agent.updatedAt = now();

  if (agent.adapter.type === "http" && agent.location.type === "remote_http") {
    queueMicrotask(() => runHttpHealthCheck(operation, agent).catch((error) => {
      completeHealthCheck(operation, {
        status: "unhealthy",
        message: `HTTP health check failed: ${error instanceof Error ? error.message : String(error)}`,
        nextAction: "Verify the HTTP agent health endpoint."
      });
    }));
    return operation;
  }

  if (agent.adapter.type === "cli" && agent.location.type === "local_device") {
    if (state.device.status !== "online" || state.device.unlinkState !== "linked") {
      completeHealthCheck(operation, {
        status: "unhealthy",
        message: "Desktop Bridge is not online for this local agent.",
        nextAction: "Start Desktop Bridge and retry the health check."
      });
    }
    return operation;
  }

  completeHealthCheck(operation, {
    status: "unhealthy",
    message: "This demo cannot health-check the selected adapter type yet.",
    nextAction: "Use a CLI or HTTP demo agent."
  });
  return operation;
}

function createLifecycleOperation(agent, operation, reason) {
  const createdAt = now();
  const record = {
    id: nextId("lco_demo"),
    agentId: agent.id,
    deviceId: agent.location.type === "local_device" ? agent.location.deviceId : undefined,
    requestedBy: "usr_local",
    operation,
    status: "queued",
    reason,
    message: `${operation.replaceAll("_", " ")} queued for ${agent.name}.`,
    createdAt,
    completedAt: null
  };
  state.lifecycleAuditRecords.unshift(record);
  state.lifecycleAuditRecords = state.lifecycleAuditRecords.slice(0, 100);
  appendEvent({
    invocationId: null,
    type: "lifecycle_requested",
    level: "info",
    message: record.message,
    data: { operationId: record.id, agentId: agent.id, operation }
  });
  return record;
}

function startLifecycleOperation(operation, message) {
  if (operation.status !== "queued") {
    return;
  }
  operation.status = "running";
  operation.message = message;
  appendEvent({
    invocationId: null,
    type: "lifecycle_started",
    level: "info",
    message,
    data: { operationId: operation.id, agentId: operation.agentId, operation: operation.operation }
  });
}

function finishLifecycleOperation(operation, status, message) {
  operation.status = status;
  operation.message = message;
  operation.completedAt = now();
  appendEvent({
    invocationId: null,
    type: status === "succeeded" ? "lifecycle_completed" : "lifecycle_failed",
    level: status === "succeeded" ? "info" : "warn",
    message,
    data: { operationId: operation.id, agentId: operation.agentId, operation: operation.operation }
  });
}

function nextBridgeHealthCheck() {
  return state.healthChecks.find((operation) => {
    if (operation.status !== "queued") {
      return false;
    }
    const agent = findAgent(operation.agentId);
    return agent?.adapter.type === "cli" && agent.location.type === "local_device";
  });
}

function markHealthCheckStarted(operation) {
  const agent = findAgent(operation.agentId);
  if (agent) {
    agent.health = {
      status: "checking",
      checkedAt: null,
      message: "Desktop Bridge is checking this agent.",
      nextAction: "Wait for the health result."
    };
    agent.updatedAt = now();
  }
  startLifecycleOperation(operation, `Health check started for ${agent?.name ?? operation.agentId}.`);
}

async function runHttpHealthCheck(operation, agent) {
  markHealthCheckStarted(operation);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(agent.adapter.timeoutSeconds ?? 10) * 1000);
  try {
    const url = new URL(agent.adapter.healthPath ?? "/health", agent.adapter.baseUrl);
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { message: text };
    }
    completeHealthCheck(operation, {
      status: response.ok ? "healthy" : "unhealthy",
      message: payload?.message ?? payload?.status ?? `HTTP health endpoint returned ${response.status}.`,
      nextAction: response.ok ? null : "Inspect the HTTP agent health endpoint."
    });
  } catch (error) {
    completeHealthCheck(operation, {
      status: "unhealthy",
      message: `HTTP health check failed: ${error instanceof Error ? error.message : String(error)}`,
      nextAction: "Verify that the HTTP agent is reachable."
    });
  } finally {
    clearTimeout(timeout);
  }
}

function completeHealthCheck(operation, result) {
  const agent = findAgent(operation.agentId);
  const healthy = result.status === "healthy" || result.status === "ok" || result.status === "succeeded";
  const message = String(result.message ?? (healthy ? "Agent health check passed." : "Agent health check failed."));
  const nextAction = result.nextAction === undefined
    ? healthy ? null : "Review the agent setup, then run another health check."
    : result.nextAction;

  finishLifecycleOperation(operation, healthy ? "succeeded" : "failed", message);
  if (!agent) {
    return;
  }

  agent.health = {
    status: healthy ? "healthy" : "unhealthy",
    checkedAt: now(),
    message,
    nextAction
  };
  agent.updatedAt = now();
}

function enabledAgentStatus(agent) {
  if (agent.location.type === "local_device") {
    return state.device.status === "online" && state.device.unlinkState === "linked" ? "available" : "unavailable";
  }
  if (agent.location.type === "remote_http") {
    return "available";
  }
  return "unknown";
}

function isAgentDisabled(agent) {
  return agent?.status === "disabled" || agent?.lifecycle?.state === "disabled";
}

function createDiscoveryRun(body = {}) {
  const allowedScope = [
    "known_command_allowlist",
    "user_provided_path",
    "known_local_endpoint",
    "user_provided_endpoint",
    "bridge_managed_config"
  ];
  const scope = Array.isArray(body.scope)
    ? body.scope.filter((item) => allowedScope.includes(item))
    : allowedScope;
  const createdAt = now();
  const discoveryRun = {
    id: nextId("lco_demo"),
    deviceId: state.device.id,
    requestedBy: "usr_local",
    status: state.device.status === "online" && state.device.unlinkState === "linked" ? "queued" : "failed",
    scope,
    options: {
      userProvidedPaths: normalizeStringArray(body.userProvidedPaths),
      userProvidedEndpoints: normalizeStringArray(body.userProvidedEndpoints)
    },
    message: "Conservative discovery checks known commands, known endpoints, user-provided entries, and bridge-managed config only.",
    candidates: [],
    createdAt,
    completedAt: state.device.status === "online" && state.device.unlinkState === "linked" ? null : createdAt
  };
  if (discoveryRun.status === "failed") {
    discoveryRun.message = "Desktop Bridge is offline. Start the bridge before discovery.";
  }
  state.discoveryRuns.unshift(discoveryRun);
  state.discoveryRuns = state.discoveryRuns.slice(0, 20);
  state.lifecycleAuditRecords.unshift({
    id: discoveryRun.id,
    agentId: "agt_demo_cli",
    deviceId: state.device.id,
    requestedBy: "usr_local",
    operation: "discover",
    status: discoveryRun.status,
    reason: "Conservative local agent discovery requested.",
    message: discoveryRun.message,
    createdAt,
    completedAt: discoveryRun.completedAt
  });
  state.lifecycleAuditRecords = state.lifecycleAuditRecords.slice(0, 100);
  appendEvent({
    invocationId: null,
    type: "lifecycle_requested",
    level: discoveryRun.status === "failed" ? "warn" : "info",
    message: discoveryRun.message,
    data: { operationId: discoveryRun.id, operation: "discover", deviceId: state.device.id }
  });
  return discoveryRun;
}

function nextBridgeDiscoveryRun() {
  return state.discoveryRuns.find((item) => item.status === "queued");
}

function markDiscoveryStarted(discoveryRun) {
  if (discoveryRun.status !== "queued") {
    return;
  }
  discoveryRun.status = "running";
  discoveryRun.message = "Desktop Bridge is checking conservative discovery sources.";
  updateLifecycleAudit(discoveryRun.id, {
    status: "running",
    message: discoveryRun.message
  });
  appendEvent({
    invocationId: null,
    type: "lifecycle_started",
    level: "info",
    message: discoveryRun.message,
    data: { operationId: discoveryRun.id, operation: "discover", deviceId: discoveryRun.deviceId }
  });
}

function completeDiscoveryRun(discoveryRun, body) {
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  discoveryRun.candidates = candidates.map((candidate, index) => normalizeDiscoveryCandidate(candidate, index));
  discoveryRun.status = body.status === "failed" ? "failed" : "succeeded";
  discoveryRun.message = body.message ?? `Discovery found ${discoveryRun.candidates.length} conservative candidate(s).`;
  discoveryRun.completedAt = now();
  updateLifecycleAudit(discoveryRun.id, {
    status: discoveryRun.status,
    message: discoveryRun.message,
    completedAt: discoveryRun.completedAt
  });
  appendEvent({
    invocationId: null,
    type: discoveryRun.status === "succeeded" ? "lifecycle_completed" : "lifecycle_failed",
    level: discoveryRun.status === "succeeded" ? "info" : "warn",
    message: discoveryRun.message,
    data: {
      operationId: discoveryRun.id,
      operation: "discover",
      deviceId: discoveryRun.deviceId,
      candidateCount: discoveryRun.candidates.length
    }
  });
}

function normalizeDiscoveryCandidate(candidate, index) {
  const adapterType = candidate.adapter?.type === "http" ? "http" : "cli";
  const source = [
    "known_command_allowlist",
    "user_provided_path",
    "known_local_endpoint",
    "user_provided_endpoint",
    "bridge_managed_config"
  ].includes(candidate.source)
    ? candidate.source
    : "known_command_allowlist";
  const agentId = sanitizeAgentId(candidate.registration?.agentId ?? candidate.agentId ?? candidate.id ?? `discovered_${index + 1}`);
  const command = String(candidate.adapter?.command ?? candidate.command ?? "demo-agent");
  const codexCommand = adapterType === "cli" && isCodexCliCommand(command);
  const adapter = adapterType === "http"
    ? {
        type: "http",
        baseUrl: String(candidate.adapter?.baseUrl ?? candidate.baseUrl ?? "http://127.0.0.1:3212"),
        authMode: "none",
        requestPath: String(candidate.adapter?.requestPath ?? candidate.requestPath ?? "/invoke"),
        healthPath: String(candidate.adapter?.healthPath ?? candidate.healthPath ?? "/health"),
        method: "POST",
        payloadShape: { task: "string" },
        timeoutSeconds: Number(candidate.adapter?.timeoutSeconds ?? 30),
        streaming: false,
        cancellation: candidate.adapter?.cancellation ?? "supported"
      }
    : {
        type: "cli",
        command,
        args: Array.isArray(candidate.adapter?.args ?? candidate.args) ? (candidate.adapter?.args ?? candidate.args).map(String) : codexCommand ? codexCliArgs() : ["{{payloadJson}}"],
        workingDirectoryPolicy: "bridge_default",
        environmentPolicy: "inherit_safe",
        timeoutSeconds: Number(candidate.adapter?.timeoutSeconds ?? (codexCommand ? 120 : 30)),
        cancellation: candidate.adapter?.cancellation ?? "supported",
        outputFormat: normalizeCliOutputFormat(candidate.adapter?.outputFormat, command),
        sandbox: candidate.adapter?.sandbox ?? null
      };
  return {
    id: String(candidate.id ?? `cand_${index + 1}`),
    name: String(candidate.name ?? (adapterType === "http" ? "Discovered HTTP Agent" : "Discovered CLI Agent")),
    description: String(candidate.description ?? "Candidate found by conservative local discovery."),
    adapter,
    source,
    confidence: ["low", "medium", "high"].includes(candidate.confidence) ? candidate.confidence : "medium",
    riskLevel: ["low", "medium", "high", "critical"].includes(candidate.riskLevel) ? candidate.riskLevel : codexCommand ? "high" : adapterType === "http" ? "medium" : "low",
    riskTags: Array.isArray(candidate.riskTags) ? candidate.riskTags.map(String) : adapterType === "http" ? ["network_access", "external_data_transfer"] : codexCommand ? codexRiskTags() : ["read_only"],
    riskHints: Array.isArray(candidate.riskHints) ? candidate.riskHints.map(String) : conservativeRiskHints(source, adapterType),
    healthProbeAvailable: Boolean(candidate.healthProbeAvailable ?? true),
    healthPath: adapterType === "http" ? adapter.healthPath : null,
    registration: {
      agentId,
      status: "candidate",
      registeredAgentId: null
    },
    createdAt: now()
  };
}

function registerDiscoveredCandidate(discoveryRun, candidate) {
  const agent = registerAgent({
    id: candidate.registration.agentId,
    type: candidate.adapter.type,
    name: candidate.name,
    description: candidate.description,
    command: candidate.adapter.type === "cli" ? candidate.adapter.command : undefined,
    args: candidate.adapter.type === "cli" ? candidate.adapter.args : undefined,
    outputFormat: candidate.adapter.type === "cli" ? candidate.adapter.outputFormat : undefined,
    sandbox: candidate.adapter.type === "cli" ? candidate.adapter.sandbox : undefined,
    baseUrl: candidate.adapter.type === "http" ? candidate.adapter.baseUrl : undefined,
    requestPath: candidate.adapter.type === "http" ? candidate.adapter.requestPath : undefined,
    healthPath: candidate.adapter.type === "http" ? candidate.adapter.healthPath : undefined,
    timeoutSeconds: candidate.adapter.timeoutSeconds,
    cancellation: candidate.adapter.cancellation,
    capabilityName: "discovered_task",
    capabilityDescription: candidate.description,
    riskLevel: candidate.riskLevel
  });
  agent.capabilities[0].riskTags = candidate.riskTags;
  agent.registrationNotes = {
    risk: candidate.riskHints.join(" "),
    data: candidate.adapter.type === "http"
      ? "Task input may be sent to the configured local HTTP endpoint."
      : "Task input and command output are streamed through the Desktop Bridge.",
    cost: "Cost is unknown unless this discovered agent reports it.",
    cancellation: cancellationTextForAdapter(candidate.adapter)
  };
  agent.discovery = {
    runId: discoveryRun.id,
    candidateId: candidate.id,
    source: candidate.source,
    confidence: candidate.confidence
  };
  if (!isCodexCliCommand(agent.adapter?.command)) {
    disableAgent(agent);
  }
  candidate.registration.status = "registered";
  candidate.registration.registeredAgentId = agent.id;
  discoveryRun.updatedAt = now();
  appendEvent({
    invocationId: null,
    type: "lifecycle_completed",
    level: "info",
    message: isCodexCliCommand(agent.adapter?.command)
      ? `${candidate.name} was registered from discovery and is available through Codex CLI native controls.`
      : `${candidate.name} was registered from discovery and left disabled for review.`,
    data: { operationId: discoveryRun.id, operation: "discover", agentId: agent.id, candidateId: candidate.id }
  });
  return agent;
}

function createIntegrationArtifact(body = {}) {
  const targetType = normalizeTargetType(body.targetType ?? body.adapterType ?? guessAdapterType(body));
  const artifactType = normalizeIntegrationArtifactType(body.artifactType ?? "integration_plan");
  const reviewState = normalizeIntegrationReviewState(body.reviewState ?? (artifactType === "integration_plan" ? "draft" : "generated"), artifactType === "integration_plan" ? "draft" : "generated");
  const createdAt = now();
  const payload = buildIntegrationArtifactPayload({
    ...body,
    targetType,
    artifactType
  });
  const artifact = {
    id: nextId("itg_demo"),
    requestedBy: "usr_local",
    targetType,
    artifactType,
    reviewState,
    generatedByAi: Boolean(body.generatedByAi ?? artifactType !== "integration_plan"),
    summary: String(body.summary ?? integrationArtifactSummary(artifactType, targetType, payload)),
    sourceArtifactId: body.sourceArtifactId ?? null,
    payload,
    governance: buildIntegrationGovernance(body, payload),
    createdAt,
    updatedAt: createdAt
  };
  state.integrationArtifacts.unshift(artifact);
  state.integrationArtifacts = state.integrationArtifacts.slice(0, 100);
  recordQuotaDecision(artifact, "create_artifact");
  appendEvent({
    invocationId: null,
    type: artifactType === "integration_plan" ? "artifact_created" : "integration_generated",
    level: "info",
    message: `${artifact.summary} It is reviewable and not enabled.`,
    data: { artifactId: artifact.id, artifactType: artifact.artifactType, reviewState: artifact.reviewState }
  });
  return artifact;
}

function buildIntegrationArtifactPayload(body) {
  const targetType = body.targetType;
  const description = String(body.description ?? body.intent ?? "").trim();
  const command = String(body.command ?? body.adapter?.command ?? "").trim();
  const baseUrl = String(body.baseUrl ?? body.url ?? body.adapter?.baseUrl ?? "").trim();
  const requestPath = String(body.requestPath ?? body.adapter?.requestPath ?? "/invoke").trim() || "/invoke";
  const healthPath = String(body.healthPath ?? body.adapter?.healthPath ?? "/health").trim() || "/health";
  const args = normalizeStringArray(body.args).length > 0
    ? normalizeStringArray(body.args)
    : isCodexCliCommand(command)
      ? codexCliArgs()
      : command
        ? ["{{payloadJson}}"]
      : [];
  const payload = {
    title: String(body.title ?? body.name ?? "Unsupported agent integration"),
    description: description || "User described an unsupported agent for integration.",
    adapterGuidance: adapterGuidance(targetType),
    structuredHints: {
    command,
    baseUrl,
    requestPath,
    healthPath,
    workingDirectory: String(body.workingDirectory ?? "").trim(),
    environmentNeeds: String(body.environmentNeeds ?? "").trim(),
      outputFormat: normalizeCliOutputFormat(body.outputFormat ?? body.adapter?.outputFormat, command),
      sandbox: body.sandbox ?? body.adapter?.sandbox ?? null,
      streaming: Boolean(body.streaming ?? false),
      cancellation: normalizeCancellation(body.cancellation),
      args
    },
    adapterConfig: buildAdapterConfig(targetType, {
      command,
      args,
      workingDirectory: String(body.workingDirectory ?? "").trim(),
      baseUrl,
      requestPath,
      healthPath,
      streaming: Boolean(body.streaming ?? false),
      cancellation: normalizeCancellation(body.cancellation),
      timeoutSeconds: body.timeoutSeconds === undefined ? undefined : Number(body.timeoutSeconds),
      outputFormat: body.outputFormat ?? body.adapter?.outputFormat,
      sandbox: body.sandbox ?? body.adapter?.sandbox
    }),
    riskNotes: riskNotesForIntegration(targetType, body),
    dataNotes: dataNotesForIntegration(targetType),
    costNotes: costNotesForIntegration(body),
    cancellationNotes: cancellationNotesForIntegration(body),
    probe: {
      explicitUserActionRequired: true,
      installScriptsAllowed: false,
      broadScanningAllowed: false,
      summary: "Probe can be run only after explicit review action."
    }
  };
  if (body.artifactType === "schema") {
    payload.schema = {
      input: { task: "string" },
      output: { summary: "string", touchedUserFiles: "boolean", cost: "object?" }
    };
  }
  if (body.artifactType === "redaction_policy") {
    payload.redactionPolicy = {
      redactPatterns: ["api_key", "authorization", "password", "secret", "token"],
      appliesTo: ["logs", "prompts", "responses", "generated_artifacts"]
    };
  }
  if (body.artifactType === "test_case") {
    payload.testCase = {
      name: "basic safe task",
      input: { task: "Say hello and report readiness." },
      expected: ["non-empty summary", "no install scripts", "no automatic enablement"]
    };
  }
  if (body.artifactType === "health_check") {
    payload.healthCheck = targetType === "http"
      ? { method: "GET", path: healthPath, timeoutSeconds: Number(body.timeoutSeconds ?? 30) }
      : { command, args: ["--version"], timeoutSeconds: Number(body.timeoutSeconds ?? 30), shell: false };
  }
  return payload;
}

function generateIntegrationArtifacts(sourceArtifact) {
  if (!sourceArtifact || sourceArtifact.artifactType !== "integration_plan") {
    throw new Error("Only integration plan drafts can generate artifact sets.");
  }
  if (sourceArtifact.reviewState === "archived" || sourceArtifact.reviewState === "rejected") {
    throw new Error("Archived or rejected plans cannot generate artifacts.");
  }
  const hints = sourceArtifact.payload?.structuredHints ?? {};
  const generatedSpecs = [
    ["adapter_config", "needs_review"],
    ["health_check", "needs_review"],
    ["schema", "needs_review"],
    ["redaction_policy", "needs_review"],
    ["test_case", "needs_review"]
  ];
  const generated = generatedSpecs.map(([artifactType, reviewState]) => createIntegrationArtifact({
    artifactType,
    reviewState,
    targetType: sourceArtifact.targetType,
    generatedByAi: true,
    sourceArtifactId: sourceArtifact.id,
    title: sourceArtifact.payload?.title,
    description: sourceArtifact.payload?.description,
    command: hints.command,
    args: hints.args,
    baseUrl: hints.baseUrl,
    requestPath: hints.requestPath,
    healthPath: hints.healthPath,
    workingDirectory: hints.workingDirectory,
    environmentNeeds: hints.environmentNeeds,
    streaming: hints.streaming,
    cancellation: hints.cancellation,
    economicModel: sourceArtifact.governance?.economics?.model,
    costOwner: sourceArtifact.governance?.economics?.costOwner,
    unknownCostPolicy: sourceArtifact.governance?.economics?.unknownCostPolicy
  }));
  sourceArtifact.reviewState = "generated";
  sourceArtifact.updatedAt = now();
  appendEvent({
    invocationId: null,
    type: "integration_generated",
    level: "info",
    message: `Generated ${generated.length} reviewable integration artifact(s) from ${sourceArtifact.id}.`,
    data: { sourceArtifactId: sourceArtifact.id, artifactIds: generated.map((item) => item.id) }
  });
  return generated;
}

function transitionIntegrationArtifact(artifact, action) {
  const nextState = {
    approve: "approved",
    reject: "rejected",
    archive: "archived",
    review: "needs_review"
  }[action];
  if (!nextState) {
    throw new Error(`Unsupported artifact action: ${action}`);
  }
  artifact.reviewState = nextState;
  artifact.updatedAt = now();
  appendEvent({
    invocationId: null,
    type: "integration_reviewed",
    level: nextState === "rejected" ? "warn" : "info",
    message: `${artifact.summary} moved to ${nextState}. No integration was enabled automatically.`,
    data: { artifactId: artifact.id, reviewState: nextState }
  });
  return artifact;
}

function createIntegrationProbeRun(artifact) {
  if (artifact.artifactType !== "adapter_config") {
    throw new Error("Only adapter config artifacts can be probed.");
  }
  if (artifact.reviewState !== "approved" && artifact.reviewState !== "tested") {
    throw new Error("Approve the adapter config before probing.");
  }
  const adapter = adapterFromArtifact(artifact);
  if (adapter.type === "cli" && (state.device.status !== "online" || state.device.unlinkState !== "linked")) {
    throw new Error("Desktop Bridge must be online before CLI probe.");
  }
  const createdAt = now();
  const probeRun = {
    id: nextId("lco_demo"),
    artifactId: artifact.id,
    deviceId: adapter.type === "cli" ? state.device.id : null,
    requestedBy: "usr_local",
    status: adapter.type === "cli" ? "queued" : "running",
    adapter,
    summary: "Probe requested after explicit review action.",
    details: [
      "No install scripts are run.",
      "Probe uses the reviewed adapter config only.",
      "Passing probe marks the artifact tested but does not enable an agent."
    ],
    createdAt,
    completedAt: null
  };
  state.integrationProbeRuns.unshift(probeRun);
  state.integrationProbeRuns = state.integrationProbeRuns.slice(0, 100);
  appendEvent({
    invocationId: null,
    type: "integration_tested",
    level: "info",
    message: `Probe queued for ${artifact.summary}.`,
    data: { probeRunId: probeRun.id, artifactId: artifact.id }
  });
  if (adapter.type === "http") {
    queueMicrotask(() => runHttpIntegrationProbe(probeRun).catch((error) => {
      completeIntegrationProbeRun(probeRun, {
        status: "failed",
        summary: `HTTP probe failed: ${error instanceof Error ? error.message : String(error)}`,
        details: ["HTTP probe failed before completion."]
      });
    }));
  }
  return probeRun;
}

function nextBridgeProbeRun() {
  return state.integrationProbeRuns.find((item) => item.status === "queued" && item.adapter?.type === "cli");
}

function markIntegrationProbeStarted(probeRun) {
  if (probeRun.status !== "queued") {
    return;
  }
  probeRun.status = "running";
  probeRun.summary = "Desktop Bridge is running a restricted adapter probe.";
  probeRun.updatedAt = now();
  appendEvent({
    invocationId: null,
    type: "integration_tested",
    level: "info",
    message: probeRun.summary,
    data: { probeRunId: probeRun.id, artifactId: probeRun.artifactId }
  });
}

function completeIntegrationProbeRun(probeRun, body = {}) {
  const succeeded = ["ok", "healthy", "succeeded"].includes(body.status) || body.status === true;
  probeRun.status = body.status === "failed" || !succeeded ? "failed" : "succeeded";
  probeRun.summary = String(body.summary ?? body.message ?? (succeeded ? "Probe passed." : "Probe failed."));
  probeRun.details = normalizeStringArray(body.details).length > 0 ? normalizeStringArray(body.details) : probeRun.details;
  probeRun.completedAt = now();
  probeRun.updatedAt = probeRun.completedAt;
  const artifact = findIntegrationArtifact(probeRun.artifactId);
  if (artifact && probeRun.status === "succeeded") {
    artifact.reviewState = "tested";
    artifact.updatedAt = now();
  }
  appendEvent({
    invocationId: null,
    type: "integration_tested",
    level: probeRun.status === "succeeded" ? "info" : "warn",
    message: `${probeRun.summary} Registration remains explicit.`,
    data: { probeRunId: probeRun.id, artifactId: probeRun.artifactId, status: probeRun.status }
  });
}

async function runHttpIntegrationProbe(probeRun) {
  const adapter = probeRun.adapter;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(adapter.timeoutSeconds ?? 30) * 1000);
  try {
    const url = new URL(adapter.healthPath ?? "/health", adapter.baseUrl);
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    const text = await response.text();
    completeIntegrationProbeRun(probeRun, {
      status: response.ok ? "succeeded" : "failed",
      summary: response.ok ? "HTTP probe passed." : `HTTP probe returned ${response.status}.`,
      details: [
        `Checked ${url.toString()}`,
        text ? `Response: ${text.slice(0, 160)}` : "No response body recorded."
      ]
    });
  } finally {
    clearTimeout(timeout);
  }
}

function registerIntegrationArtifact(artifact) {
  if (artifact.artifactType !== "adapter_config") {
    throw new Error("Only adapter config artifacts can register an agent.");
  }
  if (artifact.reviewState !== "tested") {
    throw new Error("Run and pass a probe before registering this integration.");
  }
  const adapter = adapterFromArtifact(artifact);
  const agent = registerAgent({
    id: suggestedAgentId(artifact),
    type: adapter.type,
    name: artifact.payload?.title ?? "Generated Integration Agent",
    description: artifact.payload?.description ?? artifact.summary,
    command: adapter.type === "cli" ? adapter.command : undefined,
    args: adapter.type === "cli" ? adapter.args : undefined,
    outputFormat: adapter.type === "cli" ? adapter.outputFormat : undefined,
    sandbox: adapter.type === "cli" ? adapter.sandbox : undefined,
    baseUrl: adapter.type === "http" ? adapter.baseUrl : undefined,
    requestPath: adapter.type === "http" ? adapter.requestPath : undefined,
    healthPath: adapter.type === "http" ? adapter.healthPath : undefined,
    timeoutSeconds: adapter.timeoutSeconds,
    cancellation: adapter.cancellation,
    riskLevel: artifact.governance?.riskLevel ?? "medium",
    riskTags: artifact.governance?.riskTags ?? defaultRiskTags(adapter.type),
    economicModel: artifact.governance?.economics?.model ?? "unknown",
    costOwner: artifact.governance?.economics?.costOwner ?? "usr_local",
    unknownCostPolicy: artifact.governance?.economics?.unknownCostPolicy ?? "warn"
  });
  agent.registrationNotes = {
    risk: artifact.payload?.riskNotes ?? "Generated integration requires review before use.",
    data: artifact.payload?.dataNotes ?? dataNotesForIntegration(adapter.type),
    cost: artifact.payload?.costNotes ?? "Cost is unknown.",
    cancellation: artifact.payload?.cancellationNotes ?? cancellationTextForAdapter(adapter)
  };
  agent.integrationArtifactId = artifact.id;
  if (!isCodexCliCommand(agent.adapter?.command)) {
    disableAgent(agent);
  }
  artifact.reviewState = "enabled";
  artifact.enabledAgentId = agent.id;
  artifact.updatedAt = now();
  appendEvent({
    invocationId: null,
    type: "integration_enabled",
    level: "info",
    message: isCodexCliCommand(agent.adapter?.command)
      ? `${agent.name} registered from tested artifact and is available through Codex CLI native controls.`
      : `${agent.name} registered from tested artifact and left disabled.`,
    data: { artifactId: artifact.id, agentId: agent.id, disabled: isAgentDisabled(agent) }
  });
  return agent;
}

function adapterFromArtifact(artifact) {
  const adapter = artifact.payload?.adapterConfig;
  if (adapter?.type === "http") {
    return {
      type: "http",
      baseUrl: String(adapter.baseUrl ?? "http://127.0.0.1:3212"),
      authMode: "none",
      requestPath: String(adapter.requestPath ?? "/invoke"),
      healthPath: String(adapter.healthPath ?? "/health"),
      method: "POST",
      payloadShape: { task: "string" },
      timeoutSeconds: Number(adapter.timeoutSeconds ?? 30),
      streaming: Boolean(adapter.streaming ?? false),
      cancellation: normalizeCancellation(adapter.cancellation)
    };
  }
  return {
    type: "cli",
    command: String(adapter?.command ?? artifact.payload?.structuredHints?.command ?? "demo-agent"),
    args: normalizeStringArray(adapter?.args).length > 0 ? normalizeStringArray(adapter.args) : isCodexCliCommand(adapter?.command ?? artifact.payload?.structuredHints?.command) ? codexCliArgs() : ["{{payloadJson}}"],
    workingDirectory: adapter?.workingDirectory ?? null,
    workingDirectoryPolicy: adapter?.workingDirectory ? "explicit" : "bridge_default",
    environmentPolicy: "inherit_safe",
    timeoutSeconds: Number(adapter?.timeoutSeconds ?? 30),
    cancellation: normalizeCancellation(adapter?.cancellation),
    outputFormat: normalizeCliOutputFormat(adapter?.outputFormat, adapter?.command ?? artifact.payload?.structuredHints?.command),
    sandbox: adapter?.sandbox ?? null
  };
}

function updateIntegrationRetentionSettings(body = {}) {
  state.retentionSettings = {
    ...state.retentionSettings,
    logsDays: normalizeRetentionDays(body.logsDays, state.retentionSettings.logsDays),
    promptsDays: normalizeRetentionDays(body.promptsDays, state.retentionSettings.promptsDays),
    responsesDays: normalizeRetentionDays(body.responsesDays, state.retentionSettings.responsesDays),
    artifactsDays: normalizeRetentionDays(body.artifactsDays, state.retentionSettings.artifactsDays),
    updatedAt: now()
  };
  appendEvent({
    invocationId: null,
    type: "integration_reviewed",
    level: "info",
    message: "Integration data retention settings updated.",
    data: state.retentionSettings
  });
  return state.retentionSettings;
}

function draftIntegrationWithPlatformAgent(body = {}) {
  const platformAgent = findAgent("agt_platform_integration_builder");
  if (!platformAgent) {
    throw new Error("Integration Builder platform agent is not registered.");
  }
  const description = String(body.description ?? body.intent ?? "").trim();
  if (!description) {
    throw new Error("Integration intent is required.");
  }
  const platformInvocation = createInvocation(`Draft integration plan: ${description}`, platformAgent, {
    metadata: { integrationBuilder: true, advisoryOnly: true }
  });
  appendEvent({
    invocationId: platformInvocation.id,
    type: "platform_agent_started",
    level: "info",
    message: "Integration Builder started an advisory draft.",
    data: { advisoryOnly: true }
  });
  const artifact = createIntegrationArtifact({
    ...body,
    artifactType: "integration_plan",
    reviewState: "draft",
    generatedByAi: true,
    description,
    summary: "Integration Builder draft plan"
  });
  appendEvent({
    invocationId: platformInvocation.id,
    type: "platform_agent_recommended",
    level: "info",
    message: "Integration Builder drafted a reviewable plan. It cannot enable the integration.",
    data: { artifactId: artifact.id, advisoryOnly: true }
  });
  appendEvent({
    invocationId: platformInvocation.id,
    type: "platform_agent_action_requested",
    level: "info",
    message: "Review, approve, probe, and registration remain explicit user actions.",
    data: { artifactId: artifact.id }
  });
  completeInvocation(platformInvocation, {
    status: "succeeded",
    summary: "Integration Builder drafted a reviewable integration plan.",
    result: {
      summary: "Integration Builder drafted a reviewable integration plan.",
      output: { artifactId: artifact.id, advisoryOnly: true },
      touchedUserFiles: false,
      cost: { model: platformAgent.economics.model, billable: false }
    }
  });
  return { invocation: platformInvocation, artifact };
}

function buildIntegrationGovernance(body, payload) {
  const targetType = payload.adapterConfig?.type ?? body.targetType ?? "cli";
  const command = payload.adapterConfig?.command ?? body.command ?? body.adapter?.command;
  return {
    riskLevel: normalizeRiskLevel(body.riskLevel, targetType === "cli" ? "high" : "medium"),
    riskTags: normalizeRiskTags(body.riskTags, defaultRiskTags(targetType, command)),
    economics: {
      model: normalizeEconomicModel(body.economicModel ?? body.economics?.model, "unknown"),
      costOwner: String(body.costOwner ?? body.economics?.costOwner ?? "usr_local"),
      currency: String(body.currency ?? body.economics?.currency ?? "USD"),
      unknownCostPolicy: normalizeUnknownCostPolicy(body.unknownCostPolicy ?? body.economics?.unknownCostPolicy, "warn")
    },
    quota: {
      decision: "record_only",
      limit: Number(body.quotaLimit ?? 0),
      period: String(body.quotaPeriod ?? "unset"),
      enforcement: "placeholder"
    },
    retention: { ...state.retentionSettings },
    platformAgentAdvisoryOnly: true
  };
}

function recordQuotaDecision(artifact, action) {
  const record = {
    id: nextId("qtd_demo"),
    artifactId: artifact.id,
    action,
    decision: "record_only",
    reason: "M2 records quota decisions without enterprise policy enforcement.",
    createdAt: now()
  };
  state.quotaDecisionRecords.unshift(record);
  state.quotaDecisionRecords = state.quotaDecisionRecords.slice(0, 100);
  appendEvent({
    invocationId: null,
    type: "quota_checked",
    level: "info",
    message: "Quota decision recorded for integration artifact.",
    data: record
  });
  return record;
}

function guessAdapterType(body = {}) {
  if (body.targetType === "http" || body.adapterType === "http" || body.baseUrl || body.url) {
    return "http";
  }
  return "cli";
}

function normalizeTargetType(value) {
  return value === "http" ? "http" : "cli";
}

function normalizeIntegrationArtifactType(value) {
  const allowed = [
    "integration_plan",
    "adapter_config",
    "install_recipe",
    "health_check",
    "schema",
    "redaction_policy",
    "permission_policy",
    "test_case",
    "adapter_plugin"
  ];
  const normalized = String(value ?? "integration_plan");
  return allowed.includes(normalized) ? normalized : "integration_plan";
}

function normalizeIntegrationReviewState(value, fallback = "draft") {
  const normalized = String(value ?? fallback);
  return ["draft", "generated", "needs_review", "approved", "tested", "enabled", "rejected", "archived"].includes(normalized) ? normalized : fallback;
}

function normalizeCancellation(value) {
  const normalized = String(value ?? "unknown");
  return ["supported", "unsupported", "unknown"].includes(normalized) ? normalized : "unknown";
}

function normalizeRetentionDays(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1 || number > 3650) {
    return fallback;
  }
  return Math.round(number);
}

function buildAdapterConfig(targetType, options) {
  if (targetType === "http") {
    return {
      type: "http",
      baseUrl: options.baseUrl || "http://127.0.0.1:3212",
      requestPath: options.requestPath || "/invoke",
      healthPath: options.healthPath || "/health",
      method: "POST",
      payloadShape: { task: "string" },
      timeoutSeconds: options.timeoutSeconds,
      streaming: Boolean(options.streaming),
      cancellation: options.cancellation
    };
  }
  if (isCodexCliCommand(options.command)) {
    return {
      type: "cli",
      command: options.command || "codex",
      args: options.args?.length ? options.args : codexCliArgs(),
      workingDirectory: options.workingDirectory || null,
      workingDirectoryPolicy: options.workingDirectory ? "explicit" : "bridge_default",
      environmentPolicy: "inherit_safe",
      timeoutSeconds: Number(options.timeoutSeconds ?? 120),
      cancellation: options.cancellation,
      outputFormat: "codex_jsonl",
      sandbox: options.sandbox ?? null
    };
  }
  return {
    type: "cli",
    command: options.command || "demo-agent",
    args: options.args?.length ? options.args : ["{{payloadJson}}"],
    workingDirectory: options.workingDirectory || null,
    workingDirectoryPolicy: options.workingDirectory ? "explicit" : "bridge_default",
    environmentPolicy: "inherit_safe",
    timeoutSeconds: options.timeoutSeconds,
    cancellation: options.cancellation,
    outputFormat: normalizeCliOutputFormat(options.outputFormat, options.command),
    sandbox: options.sandbox ?? null
  };
}

function adapterGuidance(targetType) {
  return targetType === "http"
    ? "This looks like an agent exposed through a local or remote HTTP endpoint. Review the URL, request path, health path, data sent, and cost owner before enabling."
    : "This looks like a local command-line agent. Review the command, arguments, working directory, data access, and cancellation behavior before enabling.";
}

function riskNotesForIntegration(targetType, body = {}) {
  if (targetType === "cli" && isCodexCliCommand(body.command ?? body.adapter?.command)) {
    return "Codex CLI can inspect repository context and may propose code changes. MyAgentTool records JSONL evidence and defers execution permissions to Codex CLI native controls.";
  }
  return targetType === "http"
    ? "HTTP integrations can send task data to the configured endpoint. Keep the endpoint local or trusted before enabling."
    : "CLI integrations can execute local commands. This is high risk until reviewed, probed, and explicitly enabled.";
}

function dataNotesForIntegration(targetType) {
  return targetType === "http"
    ? "Task input, endpoint response, logs, generated artifacts, and review events are recorded."
    : "Task input, command output, logs, generated artifacts, and review events are recorded.";
}

function costNotesForIntegration(body = {}) {
  const model = normalizeEconomicModel(body.economicModel ?? body.economics?.model, "unknown");
  const owner = String(body.costOwner ?? body.economics?.costOwner ?? "usr_local");
  return model === "unknown"
    ? `Cost is unknown and remains visible for ${owner}.`
    : `Economic model ${model} is assigned to ${owner}.`;
}

function cancellationNotesForIntegration(body = {}) {
  const cancellation = normalizeCancellation(body.cancellation);
  if (cancellation === "supported") return "The adapter declares cancellation support, but behavior must be verified by probe or real invocation.";
  if (cancellation === "unsupported") return "The adapter declares cancellation is unsupported.";
  return "Cancellation behavior is unknown until reviewed or tested.";
}

function integrationArtifactSummary(artifactType, targetType, payload) {
  const title = payload?.title ? `${payload.title}: ` : "";
  return `${title}${artifactType.replaceAll("_", " ")} for ${targetType.toUpperCase()} integration`;
}

function defaultRiskTags(targetType, command) {
  if (targetType === "cli" && isCodexCliCommand(command)) {
    return codexRiskTags();
  }
  return targetType === "http" ? ["network_access", "external_data_transfer"] : ["read_local", "shell_exec", "generated_code"];
}

function isCodexCliCommand(command) {
  const normalized = String(command ?? "").trim().toLowerCase();
  return ["codex", "codex.cmd", "codex.ps1", "codex.exe"].some((name) => normalized === name || normalized.endsWith(`/${name}`) || normalized.endsWith(`\\${name}`));
}

function codexCliArgs() {
  return ["exec", "--skip-git-repo-check", "--json", "{{task}}"];
}

function codexCliResumeArgs() {
  return ["exec", "resume", "--last", "--skip-git-repo-check", "--json", "{{task}}"];
}

function codexRiskTags() {
  return ["read_local", "write_local", "shell_exec", "network_access", "repo_context", "code_change"];
}

function normalizeCliOutputFormat(value, command) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "codex_jsonl") return "codex_jsonl";
  return isCodexCliCommand(command) ? "codex_jsonl" : "plain_result";
}

function codexRegistrationNotes() {
  return {
    risk: "Runs Codex CLI in non-interactive mode. Repository access, sandbox, approvals, and file-change permissions are governed by Codex CLI native controls.",
    data: "Task input, Codex JSONL events, command output, trace, and result summary are recorded by the local demo server.",
    cost: "Codex cost is external or unknown to the demo server and remains visible for review.",
    cancellation: "The Desktop Bridge attempts to terminate the Codex process tree when cancellation is requested."
  };
}

function suggestedAgentId(artifact) {
  const title = String(artifact.payload?.title ?? artifact.id).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitizeAgentId(title || artifact.id);
}

function conservativeRiskHints(source, adapterType) {
  const hints = ["Discovery is conservative and did not scan the full operating system."];
  if (source === "known_command_allowlist") {
    hints.push("Candidate came from a known command allowlist.");
  }
  if (source === "known_local_endpoint") {
    hints.push("Candidate came from a known local endpoint.");
  }
  if (source === "user_provided_path" || source === "user_provided_endpoint") {
    hints.push("Candidate came from user-provided input.");
  }
  hints.push(adapterType === "http" ? "Review data sent to this endpoint before enabling." : "Review the command before enabling.");
  return hints;
}

function cancellationTextForAdapter(adapter) {
  if (adapter.cancellation === "supported") {
    return "Can request stop.";
  }
  if (adapter.cancellation === "unsupported") {
    return "Stop is not supported by this agent.";
  }
  return "Stop behavior is unknown.";
}

function updateLifecycleAudit(id, patch) {
  const record = state.lifecycleAuditRecords.find((item) => item.id === id);
  if (record) {
    Object.assign(record, patch);
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

function normalizeCodexSessionMode(value, agent) {
  if (!isCodexCliCommand(agent?.adapter?.command)) {
    return "not_applicable";
  }
  return value === "continue_last" ? "continue_last" : "new";
}

function normalizeCodexWorkspacePolicy(value, agent) {
  if (!isCodexCliCommand(agent?.adapter?.command)) {
    return "not_applicable";
  }
  return ["current_repo", "new_worktree", "existing_worktree"].includes(value) ? value : "current_repo";
}

function createManagedCodexWorkspace({ invocationId, agent, workspacePolicy }) {
  if (!isCodexCliCommand(agent?.adapter?.command)) {
    return null;
  }
  const createdAt = now();
  const project = currentProject();
  const projectWorktree = worktreeForProject(project?.id);
  const workspace = {
    id: nextId("cdx_ws"),
    invocationId,
    policy: workspacePolicy,
    repoPath: project?.path ?? (agent.adapter?.workingDirectoryPolicy === "bridge_default" ? "bridge_default" : agent.adapter?.workingDirectory ?? null),
    worktreePath: projectWorktree?.worktreePath ?? (workspacePolicy === "current_repo" ? null : "pending_explicit_worktree"),
    baseBranch: projectWorktree?.baseBranch ?? null,
    branchName: projectWorktree?.branchName ?? null,
    dirtyState: "unknown",
    lastCommit: null,
    status: projectWorktree ? "registered_worktree" : workspacePolicy === "new_worktree" ? "pending_explicit_creation" : "registered",
    projectId: project?.id ?? null,
    worktreeId: projectWorktree?.id ?? null,
    sessionIds: [],
    createdAt,
    lastSeenAt: createdAt
  };
  state.codexWorkspaces.unshift(workspace);
  persistStateSoon();
  return workspace;
}

function createManagedCodexSession({ invocationId, agent, codexSessionMode, workspace }) {
  if (!isCodexCliCommand(agent?.adapter?.command)) {
    return null;
  }
  const createdAt = now();
  const project = currentProject();
  const session = {
    id: nextId("cdx_sess"),
    codexSessionId: null,
    codexThreadId: null,
    invocationId,
    userId: "usr_local",
    deviceId: agent.location?.deviceId ?? null,
    repoPath: project?.path ?? (agent.adapter?.workingDirectoryPolicy === "bridge_default" ? "bridge_default" : null),
    workspaceId: workspace?.id ?? null,
    agentId: agent.id,
    sessionMode: codexSessionMode,
    startedAt: createdAt,
    lastSeenAt: createdAt,
    status: "registered",
    policyProfile: "codex_native_controls",
    retentionProfile: "local_demo_retention",
    evidenceIds: []
  };
  state.codexSessions.unshift(session);
  persistStateSoon();
  if (workspace) {
    workspace.sessionIds = uniqueStrings([...workspace.sessionIds, session.id]);
  }
  return session;
}

function codexSessionForInvocation(invocationId) {
  return state.codexSessions.find((session) => session.invocationId === invocationId) ?? null;
}

function updateCodexSessionFromEvent(record) {
  const session = codexSessionForInvocation(record.invocationId);
  if (!session) {
    return;
  }
  session.lastSeenAt = record.createdAt;
  const workspace = codexWorkspaceForSession(session);
  if (workspace) {
    workspace.lastSeenAt = record.createdAt;
  }
  if (record.type === "execution_preview" && record.data) {
    updateCodexWorkspaceFromPreview(workspace, record.data);
  }
  if (record.type === "agent_output" && record.data?.source === "codex_jsonl") {
    session.status = "observing";
    if (record.data.threadId) {
      session.codexThreadId = record.data.threadId;
    }
    if (record.data.sessionId) {
      session.codexSessionId = record.data.sessionId;
    }
  }
  persistStateSoon();
}

function codexWorkspaceForSession(session) {
  if (!session?.workspaceId) {
    return null;
  }
  return state.codexWorkspaces.find((workspace) => workspace.id === session.workspaceId) ?? null;
}

function updateCodexWorkspaceFromPreview(workspace, data) {
  if (!workspace) {
    return;
  }
  workspace.repoPath = data.workspace?.repoPath ?? data.cwd ?? workspace.repoPath;
  workspace.worktreePath = data.workspace?.worktreePath ?? (workspace.policy === "current_repo" ? null : workspace.worktreePath);
  workspace.baseBranch = data.workspace?.baseBranch ?? workspace.baseBranch;
  workspace.branchName = data.workspace?.branchName ?? workspace.branchName;
  workspace.dirtyState = data.workspace?.dirtyState ?? workspace.dirtyState;
  workspace.lastCommit = data.workspace?.lastCommit ?? workspace.lastCommit;
  workspace.status = data.workspace?.status ?? (workspace.policy === "new_worktree" ? "pending_explicit_creation" : "observed");
  persistStateSoon();
}

function createCodexEvidenceRecord(record) {
  if (record.type !== "agent_output" || record.data?.source !== "codex_jsonl") {
    return null;
  }
  const session = codexSessionForInvocation(record.invocationId);
  const evidence = {
    id: nextId("cdx_ev"),
    invocationId: record.invocationId,
    codexSessionRegistryId: session?.id ?? null,
    sourceEventId: record.id,
    source: "codex_jsonl",
    eventType: record.data.eventType ?? "unknown",
    itemType: record.data.itemType ?? null,
    threadId: record.data.threadId ?? null,
    sessionId: record.data.sessionId ?? null,
    summary: record.message,
    commandSummary: record.data.commandSummary ?? null,
    fileChangeSummary: record.data.fileChangeSummary ?? null,
    fileChangePath: record.data.fileChangePath ?? null,
    fileChangeAction: record.data.fileChangeAction ?? null,
    diffPreview: record.data.diffPreview ?? null,
    changeRisk: record.data.changeRisk ?? null,
    redactionState: "summary_only",
    createdAt: record.createdAt
  };
  state.codexEvidenceRecords.unshift(evidence);
  persistStateSoon();
  if (session) {
    session.evidenceIds = uniqueStrings([...session.evidenceIds, evidence.id]);
  }
  return evidence;
}

function createCodexChangeReview(body) {
  const evidenceId = String(body.evidenceId ?? "").trim();
  const evidence = state.codexEvidenceRecords.find((item) => item.id === evidenceId);
  if (!evidence) {
    throw new Error("evidenceId must reference a Codex evidence record.");
  }
  if (!evidence.fileChangeSummary) {
    throw new Error("evidenceId must reference a file-change evidence record.");
  }
  const decision = normalizeCodexChangeDecision(body.decision);
  const comment = String(body.comment ?? "").trim();
  if (decision === "feedback" && !comment) {
    throw new Error("comment is required when sending feedback.");
  }
  const session = evidence.codexSessionRegistryId
    ? state.codexSessions.find((item) => item.id === evidence.codexSessionRegistryId)
    : codexSessionForInvocation(evidence.invocationId);
  const createdAt = now();
  const review = {
    id: nextId("cdx_change_review"),
    evidenceId: evidence.id,
    invocationId: evidence.invocationId,
    codexSessionRegistryId: evidence.codexSessionRegistryId ?? session?.id ?? null,
    fileChangeSummary: evidence.fileChangeSummary,
    fileChangePath: evidence.fileChangePath,
    fileChangeAction: evidence.fileChangeAction,
    diffPreview: evidence.diffPreview,
    changeRisk: evidence.changeRisk ?? "unknown",
    decision,
    comment: comment.length <= 1000 ? comment : `${comment.slice(0, 997)}...`,
    followUpPrompt: decision === "feedback" ? codexChangeFollowUpPrompt(evidence, comment) : null,
    reviewedBy: "usr_local",
    auditState: "recorded",
    createdAt
  };
  state.codexChangeReviews.unshift(review);
  persistStateSoon();
  appendEvent({
    invocationId: evidence.invocationId,
    type: decision === "feedback" ? "codex_change_feedback_requested" : "codex_change_reviewed",
    level: decision === "rejected" ? "warn" : "info",
    message: codexChangeReviewMessage(review),
    data: {
      codexChangeReviewId: review.id,
      evidenceId: evidence.id,
      decision,
      fileChangeSummary: evidence.fileChangeSummary,
      followUpPrompt: review.followUpPrompt
    }
  });
  return review;
}

function normalizeCodexChangeDecision(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["approved", "rejected", "feedback"].includes(normalized) ? normalized : "feedback";
}

function codexChangeReviewMessage(review) {
  if (review.decision === "approved") {
    return `Codex change approved: ${review.fileChangeSummary}.`;
  }
  if (review.decision === "rejected") {
    return `Codex change rejected: ${review.fileChangeSummary}.`;
  }
  return `Codex change feedback recorded for ${review.fileChangeSummary}.`;
}

function codexChangeFollowUpPrompt(evidence, comment) {
  const trimmed = String(comment ?? "").replace(/\s+/g, " ").trim();
  const boundedComment = trimmed.length <= 500 ? trimmed : `${trimmed.slice(0, 497)}...`;
  return [
    "Follow up on reviewed Codex change.",
    `Evidence: ${evidence.id}`,
    `Change: ${evidence.fileChangeSummary}`,
    `Reviewer comment: ${boundedComment}`
  ].join("\n");
}

function closeCodexSession(invocation, status) {
  const session = codexSessionForInvocation(invocation.id);
  if (!session) {
    return;
  }
  session.lastSeenAt = now();
  session.status = status === "succeeded" ? "completed" : status === "cancelled" ? "cancelled" : "failed";
  persistStateSoon();
}

function recordCodexHookEvent(body) {
  const invocationId = String(body.invocationId ?? "");
  if (!invocationId) {
    throw new Error("invocationId is required.");
  }
  const invocation = findInvocation(invocationId);
  if (!invocation) {
    throw new Error("invocation was not found.");
  }
  const eventName = normalizeCodexHookEventName(body.eventName);
  const policy = evaluateCodexHookPolicy(eventName, body);
  const session = codexSessionForInvocation(invocationId);
  const record = {
    id: nextId("cdx_hook"),
    invocationId,
    codexSessionRegistryId: session?.id ?? null,
    eventName,
    toolName: body.toolName ? String(body.toolName) : null,
    policyDecision: policy.decision,
    policyReason: policy.reason,
    summary: String(body.summary ?? policy.summary),
    redactionState: "summary_only",
    createdAt: now()
  };
  state.codexHookEvents.unshift(record);
  persistStateSoon();
  if (session) {
    session.lastSeenAt = record.createdAt;
  }
  const brokerRequest = eventName === "PermissionRequest"
    ? createCodexApprovalBrokerRequest({ invocation, session, hookEvent: record, body, policy })
    : null;
  appendEvent({
    invocationId,
    type: "codex_hook_event",
    level: policy.decision === "blocked" ? "warn" : "info",
    message: `${eventName}: ${policy.reason}`,
    data: {
      hookEventId: record.id,
      brokerRequestId: brokerRequest?.id ?? null,
      eventName,
      toolName: record.toolName,
      policyDecision: policy.decision
    }
  });
  return {
    hookEvent: record,
    brokerRequest,
    policyDecision: policy.decision
  };
}

function createCodexApprovalBrokerRequest({ invocation, session, hookEvent, body, policy }) {
  const createdAt = now();
  const approvalMode = normalizeCodexApprovalMode(invocation.options?.approvalMode ?? invocation.options?.metadata?.permissionMode);
  const autoApproved = policy.decision !== "blocked" && (approvalMode === "full" || (approvalMode === "auto" && !codexApprovalRequiresManualReview({ invocation, body, policy })));
  const request = {
    id: nextId("cdx_appr"),
    invocationId: invocation.id,
    codexSessionRegistryId: session?.id ?? null,
    hookEventId: hookEvent.id,
    toolName: body.toolName ? String(body.toolName) : "unknown",
    summary: String(body.summary ?? "Codex permission request"),
    riskLevel: "high",
    status: policy.decision === "blocked" ? "denied" : autoApproved ? "approved" : "pending",
    timeoutAt: new Date(Date.now() + codexApprovalTimeoutMs(body)).toISOString(),
    decision: policy.decision === "blocked" ? "deny" : autoApproved ? "allow" : null,
    decidedAt: policy.decision === "blocked" || autoApproved ? createdAt : null,
    notificationState: policy.decision === "blocked" || autoApproved ? "resolved" : "queued",
    approvalMode,
    createdAt,
    updatedAt: createdAt
  };
  state.codexApprovalBrokerRequests.unshift(request);
  persistStateSoon();
  appendEvent({
    invocationId: invocation.id,
    type: "codex_approval_requested",
    level: request.status === "pending" ? "warn" : "info",
    message: request.status === "pending"
      ? `Codex approval broker is waiting on ${request.toolName}.`
      : request.status === "approved"
        ? `Codex approval broker approved ${request.toolName} by ${approvalMode} mode.`
        : `Codex approval broker denied ${request.toolName}.`,
    data: { approvalBrokerRequestId: request.id, status: request.status }
  });
  if (autoApproved) {
    appendEvent({
      invocationId: invocation.id,
      type: "codex_approval_granted",
      level: "info",
      message: `Codex approval broker auto-approved the request in ${approvalMode} mode.`,
      data: { approvalBrokerRequestId: request.id, decision: request.decision, approvalMode }
    });
  }
  return request;
}

function normalizeCodexApprovalMode(value) {
  const normalized = String(value ?? "ask").trim().toLowerCase();
  return ["ask", "auto", "full"].includes(normalized) ? normalized : "ask";
}

function codexApprovalRequiresManualReview({ invocation, body, policy }) {
  const text = [
    invocation?.input?.task,
    body?.summary,
    body?.toolName,
    policy?.reason
  ].map((item) => String(item ?? "").toLowerCase()).join(" ");
  return [
    "auth.json",
    "private key",
    "password",
    "secret",
    "token",
    "credential",
    "rm -rf",
    "delete",
    "remove-item",
    "format",
    "registry",
    "full access",
    "dangerously"
  ].some((pattern) => text.includes(pattern));
}

function codexApprovalTimeoutMs(body) {
  const seconds = Number(body.timeoutSeconds);
  if (Number.isFinite(seconds) && seconds >= 1 && seconds <= 300) {
    return seconds * 1000;
  }
  return 5 * 60 * 1000;
}

function expireCodexApprovalBrokerRequests() {
  const nowMs = Date.now();
  for (const request of state.codexApprovalBrokerRequests) {
    if (request.status !== "pending" || !request.timeoutAt) {
      continue;
    }
    if (Date.parse(request.timeoutAt) > nowMs) {
      continue;
    }
    resolveCodexApprovalBrokerRequest(request, "timeout");
  }
}

function resolveCodexApprovalBrokerRequest(request, action) {
  if (request.status !== "pending") {
    return request;
  }
  const timedOut = action === "timeout";
  request.status = action === "approve" ? "approved" : timedOut ? "timed_out" : "denied";
  request.decision = action === "approve" ? "allow" : timedOut ? "timeout_deny" : "deny";
  request.decidedAt = now();
  request.updatedAt = request.decidedAt;
  request.notificationState = "resolved";
  persistStateSoon();
  appendEvent({
    invocationId: request.invocationId,
    type: action === "approve" ? "codex_approval_granted" : timedOut ? "codex_approval_timed_out" : "codex_approval_denied",
    level: action === "approve" ? "info" : "warn",
    message: action === "approve"
      ? "Codex approval broker approved the request."
      : timedOut ? "Codex approval broker timed out and denied the request." : "Codex approval broker denied the request.",
    data: { approvalBrokerRequestId: request.id, decision: request.decision }
  });
  return request;
}

function createCodexImportedEvidenceRecord(body) {
  const source = String(body.source ?? "user_selected_local_evidence").trim();
  const summary = String(body.summary ?? "").trim();
  if (!summary) {
    throw new Error("summary is required.");
  }
  const createdAt = now();
  const record = {
    id: nextId("cdx_import"),
    source,
    userId: "usr_local",
    repoPath: body.repoPath ? String(body.repoPath) : null,
    marker: "imported_after_the_fact",
    status: "imported",
    redactionState: "preview_confirmed_summary_only",
    summary: summary.length <= 500 ? summary : `${summary.slice(0, 497)}...`,
    retentionProfile: "local_demo_retention",
    linkedManagedSessionId: null,
    createdAt,
    updatedAt: createdAt
  };
  state.codexImportedEvidenceRecords.unshift(record);
  persistStateSoon();
  appendEvent({
    invocationId: null,
    type: "codex_imported_evidence_recorded",
    level: "info",
    message: "Imported Codex evidence was recorded after explicit preview and confirmation.",
    data: {
      importedEvidenceId: record.id,
      marker: record.marker,
      redactionState: record.redactionState
    }
  });
  return record;
}

function normalizeCodexHookEventName(value) {
  const normalized = String(value ?? "");
  const allowed = new Set(["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop", "PreCompact", "PostCompact"]);
  return allowed.has(normalized) ? normalized : "Unknown";
}

function evaluateCodexHookPolicy(eventName, body) {
  const summary = String(body.summary ?? "");
  if (eventName === "UserPromptSubmit" && /(~\/\.codex\/auth\.json|auth\.json|api[_-]?key|secret)/i.test(summary)) {
    return {
      decision: "blocked",
      reason: "Prompt needs review because it appears to reference credentials or secrets.",
      summary: "Prompt policy check"
    };
  }
  if (eventName === "PreToolUse") {
    return {
      decision: "review_required",
      reason: `Tool use observed for ${body.toolName ?? "unknown tool"}.`,
      summary: "Tool policy check"
    };
  }
  if (eventName === "PermissionRequest") {
    return {
      decision: "review_required",
      reason: `Permission request observed for ${body.toolName ?? "unknown tool"}.`,
      summary: "Permission policy check"
    };
  }
  return {
    decision: "allowed",
    reason: `${eventName} recorded.`,
    summary: "Hook event recorded"
  };
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

function findAgent(id) {
  return state.agents.find((item) => item.id === id);
}

function findDiscoveryRun(id) {
  return state.discoveryRuns.find((item) => item.id === id);
}

function findIntegrationArtifact(id) {
  return state.integrationArtifacts.find((item) => item.id === id);
}

function findIntegrationProbeRun(id) {
  return state.integrationProbeRuns.find((item) => item.id === id);
}

function normalizeEnv(env) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return {};
  }
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [String(key), String(value)]));
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function summarizeText(value, maxLength = 160) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function normalizeRiskLevel(value, fallback = "medium") {
  const normalized = String(value ?? fallback).trim();
  return ["low", "medium", "high", "critical"].includes(normalized) ? normalized : fallback;
}

function normalizeRiskTags(value, fallback) {
  const tags = normalizeStringArray(value);
  return tags.length > 0 ? tags : fallback;
}

function normalizeAgentEconomics(body = {}) {
  const economics = body.economics && typeof body.economics === "object" && !Array.isArray(body.economics)
    ? body.economics
    : {};
  return {
    model: normalizeEconomicModel(body.economicModel ?? economics.model, "unknown"),
    pricingDimensions: normalizeStringArray(body.pricingDimensions ?? economics.pricingDimensions),
    currency: String(body.currency ?? economics.currency ?? "USD"),
    costOwner: String(body.costOwner ?? economics.costOwner ?? "usr_local"),
    budgetPoolId: body.budgetPoolId ?? economics.budgetPoolId ?? null,
    revenueOwner: body.revenueOwner ?? economics.revenueOwner ?? null,
    unknownCostPolicy: normalizeUnknownCostPolicy(body.unknownCostPolicy ?? economics.unknownCostPolicy, "warn")
  };
}

function normalizeEconomicModel(value, fallback = "unknown") {
  const normalized = String(value ?? fallback).trim();
  return ["free", "external_billed", "platform_billed", "internal_chargeback", "revenue_generating", "rev_share", "unknown"].includes(normalized)
    ? normalized
    : fallback;
}

function normalizeUnknownCostPolicy(value, fallback = "warn") {
  const normalized = String(value ?? fallback).trim();
  return ["warn", "require_approval", "block"].includes(normalized) ? normalized : fallback;
}

function sanitizeAgentId(id) {
  const raw = String(id).trim();
  const withPrefix = raw.startsWith("agt_") ? raw : `agt_${raw}`;
  return withPrefix.replace(/[^a-zA-Z0-9_]/g, "_");
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

function codexApprovalQueue() {
  return state.codexApprovalBrokerRequests.map((request) => {
    const invocation = findInvocation(request.invocationId);
    const session = request.codexSessionRegistryId
      ? state.codexSessions.find((item) => item.id === request.codexSessionRegistryId)
      : codexSessionForInvocation(request.invocationId);
    const workspace = codexWorkspaceForSession(session);
    return {
      id: request.id,
      status: request.status,
      summary: request.summary,
      toolName: request.toolName,
      riskLevel: request.riskLevel,
      timeoutAt: request.timeoutAt,
      invocationId: request.invocationId,
      codexSessionRegistryId: session?.id ?? null,
      workspaceId: workspace?.id ?? null,
      repoPath: workspace?.repoPath ?? session?.repoPath ?? null,
      taskSummary: invocation?.input?.task ? summarizeText(invocation.input.task, 140) : null,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt
    };
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

function repoPathForEvidence(codexSessionRegistryId) {
  const session = codexSessionRegistryId ? state.codexSessions.find((item) => item.id === codexSessionRegistryId) : null;
  const workspace = codexWorkspaceForSession(session);
  return workspace?.repoPath ?? session?.repoPath ?? null;
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
