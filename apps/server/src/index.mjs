import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const namespace = "com.myagenttool";
const protocolVersion = "0.0.0";
const host = process.env.SERVER_HOST ?? "127.0.0.1";
const port = Number(process.env.SERVER_PORT ?? 3001);
const dispatchLeaseMs = Number(process.env.SERVER_DISPATCH_LEASE_MS ?? 30_000);

// JSON snapshot persistence (orca-style flat file + schema version). SQLite is a
// P1+ concern; for now durability matters most for projects/ledger/budgets.
const PERSIST_VERSION = 2;
const PERSIST_FILE = process.env.SERVER_STATE_FILE
  ? path.resolve(process.env.SERVER_STATE_FILE)
  : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "state.json");
const PERSIST_KEYS = ["projects", "projectTargets", "worktrees", "agents", "invocations", "ledgerEntries", "budgets", "quotaDecisionRecords"];
let persistTimer = null;

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
  projects: [
    {
      id: "prj_default",
      name: "Default Project",
      color: "#6366f1",
      ownerTeamId: "team_local",
      budgetPoolId: null,
      defaultAgentId: "agt_demo_cli",
      status: "active",
      isolation: "shared",
      createdAt: now()
    }
  ],
  projectTargets: [],
  worktrees: [],
  agents: [
    {
      id: "agt_demo_cli",
      projectId: "prj_default",
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
      id: "agt_platform_troubleshooter",
      projectId: "prj_default",
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
  ledgerEntries: [],
  budgets: []
};

let idCounter = 1;
const directHttpRuns = new Map();

// Token price book (USD per 1M tokens) for estimating cost when an agent reports
// no billed amount (e.g. Codex). Declared before the module-load self-check so
// estimateCostUsd can reference it without a const TDZ.
const TOKEN_PRICING = {
  codex: { inputPerMTok: 1.25, outputPerMTok: 10 },
  claude: { inputPerMTok: 3, outputPerMTok: 15 }
};
// Best-effort hold per in-flight run for budget admission; the true per-run cost
// is unknown until completion, so this only bounds concurrent bursts.
const BUDGET_RESERVATION_USD = 0.05;

// One descriptor per first-class coding agent collapses the Codex/Claude special
// cases (id, mode key, default args, timeout, risk tags, notes) into a single
// entry. Adding a provider = one entry here (+ a TOKEN_PRICING row). Declared
// before the self-check; the values only reference hoisted functions.
const CODING_AGENTS = {
  codex: {
    matches: (command) => isCodexCliCommand(command),
    idPrefix: "agt_codex_",
    modeKey: "sandbox",
    normalizeMode: (value) => normalizeCodexSandbox(value),
    defaultArgs: (mode) => codexCliArgs(mode),
    timeoutSeconds: 120,
    riskTags: () => codexRiskTags(),
    notes: () => codexRegistrationNotes()
  },
  claude: {
    matches: (command) => isClaudeCliCommand(command),
    idPrefix: "agt_claude_",
    modeKey: "permissionMode",
    normalizeMode: (value) => normalizeClaudePermissionMode(value),
    defaultArgs: (mode) => claudeCliArgs(mode),
    timeoutSeconds: 180,
    riskTags: () => claudeRiskTags(),
    notes: () => claudeRegistrationNotes()
  }
};
function codingAgentProfile(command) {
  for (const profile of Object.values(CODING_AGENTS)) {
    if (profile.matches(command)) return profile;
  }
  return null;
}

if (process.argv.includes("--check")) {
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
      sendJson(res, 200, publicState());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/bridge/register") {
      const body = await readJson(req);
      if (state.device.unlinkState !== "linked") {
        sendJson(res, 403, { error: "device_credentials_revoked" });
        return;
      }
      state.device.status = "online";
      state.device.lastSeenAt = now();
      state.device.bridgeVersion = String(body.bridgeVersion ?? "0.0.0");
      state.device.registeredCapabilities = Array.isArray(body.capabilities) ? body.capabilities.map(String) : [];
      state.device.updatedAt = now();
      for (const agent of state.agents.filter((item) => item.location.type === "local_device")) {
        if (isAgentDisabled(agent)) {
          agent.updatedAt = now();
          continue;
        }
        agent.status = "available";
        agent.updatedAt = now();
        // Local CLI agents have no health endpoint; probe them once the bridge
        // is online so a fresh/restarted agent doesn't sit at "Not checked".
        // Only when health is unknown, so reconnects don't re-probe endlessly.
        if (agent.adapter?.type === "cli" && (!agent.health || agent.health.status === "unknown")) {
          createAgentHealthCheck(agent);
        }
      }
      redeliverExpiredDispatches();
      appendEvent({
        invocationId: null,
        type: "heartbeat",
        level: "info",
        message: "Desktop Bridge registered local demo device."
      });
      sendJson(res, 200, { ok: true, device: state.device, agents: state.agents });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/agents") {
      const body = await readJson(req);
      let agent;
      try {
        agent = registerAgent(body);
      } catch (error) {
        sendJson(res, 400, {
          error: "invalid_agent_registration",
          message: error instanceof Error ? error.message : String(error)
        });
        return;
      }
      // Coding agents have no health endpoint, so auto-run the restricted CLI
      // probe (codex exec --help / claude --version) on manual registration —
      // a fresh agent reports Healthy/Needs attention instead of "Not checked".
      if (agent.adapter?.type === "cli" && (isCodexCliCommand(agent.adapter.command) || isClaudeCliCommand(agent.adapter.command))) {
        createAgentHealthCheck(agent);
      }
      sendJson(res, 201, { agent });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/discovery") {
      const body = await readJson(req);
      const discoveryRun = createDiscoveryRun(body);
      sendJson(res, 202, { discoveryRun });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/projects") {
      sendJson(res, 200, { projects: state.projects });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/projects") {
      const body = await readJson(req);
      try {
        if (body.repoUrl || body.repoPath) {
          const result = createProjectWithRepo(body);
          sendJson(res, 201, result);
          return;
        }
        sendJson(res, 201, { project: createProject(body) });
      } catch (error) {
        sendJson(res, 400, { error: "invalid_project", message: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (req.method === "PATCH" && projectMatch) {
      const body = await readJson(req);
      let project;
      try {
        project = updateProject(decodeURIComponent(projectMatch[1]), body);
      } catch (error) {
        sendJson(res, 404, { error: "project_not_found", message: error instanceof Error ? error.message : String(error) });
        return;
      }
      sendJson(res, 200, { project });
      return;
    }

    if ((req.method === "PUT" || req.method === "POST") && url.pathname === "/api/budgets") {
      const body = await readJson(req);
      let budget;
      try {
        budget = upsertBudget(body);
      } catch (error) {
        sendJson(res, 400, { error: "invalid_budget", message: error instanceof Error ? error.message : String(error) });
        return;
      }
      sendJson(res, 200, { budget, status: budgetStatusFor(budget.projectId) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/integration-artifacts") {
      const body = await readJson(req);
      let artifact;
      try {
        artifact = createIntegrationArtifact(body);
      } catch (error) {
        sendJson(res, 400, {
          error: "invalid_integration_artifact",
          message: error instanceof Error ? error.message : String(error)
        });
        return;
      }
      sendJson(res, artifact.reviewState === "draft" ? 201 : 202, { artifact });
      return;
    }

    const artifactReviewMatch = url.pathname.match(/^\/api\/integration-artifacts\/([^/]+)\/(generate|approve|reject|archive|review|probe|register)$/);
    if (req.method === "POST" && artifactReviewMatch) {
      const artifact = findIntegrationArtifact(decodeURIComponent(artifactReviewMatch[1]));
      if (!artifact) {
        sendJson(res, 404, { error: "integration_artifact_not_found" });
        return;
      }

      const action = artifactReviewMatch[2];
      if (action === "generate") {
        const artifacts = generateIntegrationArtifacts(artifact);
        sendJson(res, 201, { sourceArtifact: artifact, artifacts });
        return;
      }
      if (action === "probe") {
        let probeRun;
        try {
          probeRun = createIntegrationProbeRun(artifact);
        } catch (error) {
          sendJson(res, 409, {
            error: "probe_not_available",
            message: error instanceof Error ? error.message : String(error)
          });
          return;
        }
        sendJson(res, 202, { artifact, probeRun });
        return;
      }
      if (action === "register") {
        let agent;
        try {
          agent = registerIntegrationArtifact(artifact);
        } catch (error) {
          sendJson(res, 409, {
            error: "integration_artifact_not_registerable",
            message: error instanceof Error ? error.message : String(error)
          });
          return;
        }
        sendJson(res, 201, { artifact, agent });
        return;
      }

      const updated = transitionIntegrationArtifact(artifact, action);
      sendJson(res, 200, { artifact: updated });
      return;
    }

    if (req.method === "PATCH" && url.pathname === "/api/integration-retention") {
      const body = await readJson(req);
      const retentionSettings = updateIntegrationRetentionSettings(body);
      sendJson(res, 200, { retentionSettings });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/integration-builder/draft") {
      const body = await readJson(req);
      let result;
      try {
        result = draftIntegrationWithPlatformAgent(body);
      } catch (error) {
        sendJson(res, 400, {
          error: "invalid_integration_builder_request",
          message: error instanceof Error ? error.message : String(error)
        });
        return;
      }
      sendJson(res, 201, result);
      return;
    }

    const discoveryRegisterMatch = url.pathname.match(/^\/api\/discovery\/([^/]+)\/candidates\/([^/]+)\/register$/);
    if (req.method === "POST" && discoveryRegisterMatch) {
      const discoveryRun = findDiscoveryRun(decodeURIComponent(discoveryRegisterMatch[1]));
      if (!discoveryRun) {
        sendJson(res, 404, { error: "discovery_run_not_found" });
        return;
      }

      const candidate = discoveryRun.candidates.find((item) => item.id === decodeURIComponent(discoveryRegisterMatch[2]));
      if (!candidate) {
        sendJson(res, 404, { error: "discovery_candidate_not_found" });
        return;
      }

      const agent = registerDiscoveredCandidate(discoveryRun, candidate);
      sendJson(res, 201, { agent, discoveryRun, candidate });
      return;
    }

    const agentActionMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/(enable|disable|health-check)$/);
    if (req.method === "POST" && agentActionMatch) {
      const agent = findAgent(decodeURIComponent(agentActionMatch[1]));
      if (!agent) {
        sendJson(res, 404, { error: "agent_not_found" });
        return;
      }

      if (agentActionMatch[2] === "disable") {
        const operation = disableAgent(agent);
        sendJson(res, 200, { agent, operation });
        return;
      }

      if (agentActionMatch[2] === "enable") {
        const operation = enableAgent(agent);
        sendJson(res, 200, { agent, operation });
        return;
      }

      const operation = createAgentHealthCheck(agent);
      sendJson(res, 202, { agent, operation });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/device/unlink") {
      unlinkDevice();
      sendJson(res, 200, { device: state.device });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/bridge/next") {
      state.device.lastSeenAt = now();
      if (state.device.unlinkState !== "linked") {
        sendJson(res, 204, null);
        return;
      }
      redeliverExpiredDispatches();
      const invocation = nextDispatchableInvocation();

      if (!invocation) {
        sendJson(res, 204, null);
        return;
      }

      markDispatched(invocation);

      // Run the agent in the project's worktree when repo-backed: override the
      // adapter's cwd for this dispatch only (the stored agent is untouched).
      const baseAdapter = findAgent(invocation.agentId)?.adapter ?? null;
      const adapter = baseAdapter && invocation.workingDirectory
        ? { ...baseAdapter, workingDirectory: invocation.workingDirectory, workingDirectoryPolicy: "explicit" }
        : baseAdapter;

      sendJson(res, 200, {
        namespace,
        protocolVersion,
        invocationId: invocation.id,
        agentId: invocation.agentId,
        adapter,
        workingDirectory: invocation.workingDirectory ?? null,
        input: invocation.input,
        options: invocation.options
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/bridge/health-next") {
      state.device.lastSeenAt = now();
      if (state.device.unlinkState !== "linked") {
        sendJson(res, 204, null);
        return;
      }

      const operation = nextBridgeHealthCheck();
      if (!operation) {
        sendJson(res, 204, null);
        return;
      }

      markHealthCheckStarted(operation);
      sendJson(res, 200, {
        namespace,
        protocolVersion,
        checkId: operation.id,
        agentId: operation.agentId,
        adapter: findAgent(operation.agentId)?.adapter ?? null
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/bridge/health-complete") {
      const body = await readJson(req);
      const operation = state.healthChecks.find((item) => item.id === body.checkId && item.agentId === body.agentId);
      if (!operation) {
        sendJson(res, 404, { error: "health_check_not_found" });
        return;
      }

      completeHealthCheck(operation, {
        status: body.status,
        message: body.message,
        nextAction: body.nextAction
      });
      sendJson(res, 200, { ok: true, operation, agent: findAgent(operation.agentId) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/bridge/discovery-next") {
      state.device.lastSeenAt = now();
      if (state.device.unlinkState !== "linked") {
        sendJson(res, 204, null);
        return;
      }

      const discoveryRun = nextBridgeDiscoveryRun();
      if (!discoveryRun) {
        sendJson(res, 204, null);
        return;
      }

      markDiscoveryStarted(discoveryRun);
      sendJson(res, 200, {
        namespace,
        protocolVersion,
        discoveryRunId: discoveryRun.id,
        deviceId: discoveryRun.deviceId,
        scope: discoveryRun.scope,
        knownCommands: ["demo-agent"],
        knownLocalEndpoints: [
          {
            name: "Smoke HTTP Agent",
            baseUrl: "http://127.0.0.1:3212",
            requestPath: "/invoke",
            healthPath: "/health"
          }
        ],
        userProvidedPaths: normalizeStringArray(discoveryRun.options?.userProvidedPaths),
        userProvidedEndpoints: normalizeStringArray(discoveryRun.options?.userProvidedEndpoints)
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/bridge/discovery-complete") {
      const body = await readJson(req);
      const discoveryRun = findDiscoveryRun(body.discoveryRunId);
      if (!discoveryRun) {
        sendJson(res, 404, { error: "discovery_run_not_found" });
        return;
      }

      completeDiscoveryRun(discoveryRun, body);
      sendJson(res, 200, { ok: true, discoveryRun });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/bridge/probe-next") {
      state.device.lastSeenAt = now();
      if (state.device.unlinkState !== "linked") {
        sendJson(res, 204, null);
        return;
      }

      const probeRun = nextBridgeProbeRun();
      if (!probeRun) {
        sendJson(res, 204, null);
        return;
      }

      markIntegrationProbeStarted(probeRun);
      sendJson(res, 200, {
        namespace,
        protocolVersion,
        probeRunId: probeRun.id,
        artifactId: probeRun.artifactId,
        deviceId: probeRun.deviceId,
        adapter: probeRun.adapter
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/bridge/probe-complete") {
      const body = await readJson(req);
      const probeRun = findIntegrationProbeRun(body.probeRunId);
      if (!probeRun) {
        sendJson(res, 404, { error: "probe_run_not_found" });
        return;
      }
      completeIntegrationProbeRun(probeRun, body);
      sendJson(res, 200, { ok: true, probeRun, artifact: findIntegrationArtifact(probeRun.artifactId) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/bridge/cancel-status") {
      const invocation = findInvocation(url.searchParams.get("invocationId"));
      sendJson(res, 200, {
        cancelRequested: invocation?.cancellation.state === "requested"
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/bridge/ack") {
      const body = await readJson(req);
      const invocation = findInvocation(body.invocationId);
      if (!invocation) {
        sendJson(res, 404, { error: "invocation_not_found" });
        return;
      }

      acknowledgeInvocation(invocation);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/bridge/events") {
      const body = await readJson(req);
      const invocation = findInvocation(body.invocationId);
      if (!invocation) {
        sendJson(res, 404, { error: "invocation_not_found" });
        return;
      }
      appendEvent({
        invocationId: invocation.id,
        type: body.type ?? "log",
        level: body.level ?? "info",
        message: body.message ?? "",
        data: body.data
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/bridge/complete") {
      const body = await readJson(req);
      const invocation = findInvocation(body.invocationId);
      if (!invocation) {
        sendJson(res, 404, { error: "invocation_not_found" });
        return;
      }

      completeInvocation(invocation, body);
      sendJson(res, 200, { ok: true, invocation });
      return;
    }

    const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|deny)$/);
    if (req.method === "POST" && approvalMatch) {
      const approval = findApprovalRequest(decodeURIComponent(approvalMatch[1]));
      if (!approval) {
        sendJson(res, 404, { error: "approval_not_found" });
        return;
      }
      const invocation = findInvocation(approval.invocationId);
      if (!invocation) {
        sendJson(res, 404, { error: "invocation_not_found" });
        return;
      }

      if (approvalMatch[2] === "approve") {
        approveInvocation(approval, invocation);
      } else {
        denyInvocation(approval, invocation);
      }
      sendJson(res, 200, { approval, invocation });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/invocations") {
      const body = await readJson(req);
      const task = String(body.task ?? "").trim();
      if (!task) {
        sendJson(res, 400, { error: "task_required" });
        return;
      }
      const agent = body.agentId ? findAgent(body.agentId) : defaultAgent();
      if (!agent) {
        sendJson(res, 404, { error: "agent_not_found" });
        return;
      }
      if (agent.status === "disabled") {
        sendJson(res, 409, { error: "agent_disabled" });
        return;
      }
      if (agent.health?.status === "unhealthy") {
        sendJson(res, 409, {
          error: "agent_unhealthy",
          message: agent.health.message
        });
        return;
      }
      if (agent.location.type === "local_device" && state.device.unlinkState !== "linked") {
        sendJson(res, 409, { error: "device_unlinked" });
        return;
      }
      const projectId = resolveProjectId(body.projectId ?? agent.projectId);
      const budget = enforceBudgetForProject(projectId);
      if (budget.action === "block") {
        sendJson(res, 409, { error: "budget_exceeded", message: budget.reason, budget: budget.status });
        return;
      }
      const invocationOptions = { ...(body.options ?? {}), projectId };
      if (budget.action === "require_approval") {
        invocationOptions.requireLocalApproval = true;
        invocationOptions.metadata = {
          ...(invocationOptions.metadata && typeof invocationOptions.metadata === "object" ? invocationOptions.metadata : {}),
          budgetApprovalReason: budget.reason
        };
      }
      const invocation = createInvocation(task, agent, invocationOptions);
      startInvocationIfAllowed(invocation, agent);
      sendJson(res, 201, { invocation });
      return;
    }

    const cancelMatch = url.pathname.match(/^\/api\/invocations\/([^/]+)\/cancel$/);
    if (req.method === "POST" && cancelMatch) {
      const invocation = findInvocation(cancelMatch[1]);
      if (!invocation) {
        sendJson(res, 404, { error: "invocation_not_found" });
        return;
      }
      cancelInvocation(invocation);
      sendJson(res, 200, { invocation });
      return;
    }

    const troubleshootMatch = url.pathname.match(/^\/api\/invocations\/([^/]+)\/troubleshoot$/);
    if (req.method === "POST" && troubleshootMatch) {
      const invocation = findInvocation(troubleshootMatch[1]);
      if (!invocation) {
        sendJson(res, 404, { error: "invocation_not_found" });
        return;
      }
      if (!["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation.status)) {
        sendJson(res, 409, { error: "invocation_not_troubleshootable" });
        return;
      }

      const report = createTroubleshootingReport(invocation);
      sendJson(res, 201, { report });
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

loadPersistedState();

server.listen(port, host, () => {
  console.log(`[server] http://${host}:${port}`);
});

function now() {
  return new Date().toISOString();
}

// Restore persisted slices on boot. A version mismatch drops the file wholesale
// (e.g. pre-project budgets keyed by costOwner) so the seed state takes over.
function loadPersistedState() {
  try {
    if (!fs.existsSync(PERSIST_FILE)) return;
    const snapshot = JSON.parse(fs.readFileSync(PERSIST_FILE, "utf8"));
    if (!snapshot || snapshot.version !== PERSIST_VERSION) {
      console.warn(`[server] ignoring incompatible state snapshot (version ${snapshot?.version})`);
      return;
    }
    for (const key of PERSIST_KEYS) {
      if (Array.isArray(snapshot[key])) state[key] = snapshot[key];
    }
    // Drop ephemeral worktree records whose directories no longer exist (a prior
    // run's isolated worktrees do not survive a restart).
    state.worktrees = state.worktrees.filter((w) => !w.ephemeral || fs.existsSync(w.path));
    if (Number.isFinite(snapshot.idCounter)) idCounter = snapshot.idCounter;
    console.log(`[server] restored state from ${PERSIST_FILE}`);
  } catch (error) {
    console.warn(`[server] failed to load state snapshot: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Debounced write so a burst of mutations coalesces into one disk write.
function persistState() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      fs.mkdirSync(path.dirname(PERSIST_FILE), { recursive: true });
      const snapshot = { version: PERSIST_VERSION, savedAt: now(), idCounter };
      for (const key of PERSIST_KEYS) snapshot[key] = state[key];
      fs.writeFileSync(PERSIST_FILE, JSON.stringify(snapshot, null, 2));
    } catch (error) {
      console.warn(`[server] failed to persist state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, 500);
  if (typeof persistTimer.unref === "function") persistTimer.unref();
}

function nextId(prefix) {
  const id = `${prefix}_${String(idCounter).padStart(4, "0")}`;
  idCounter += 1;
  return id;
}

// --- Projects ------------------------------------------------------------
// A Project is the attribution floor every invocation rolls up to. Resolve any
// caller-supplied id to a known project, falling back to the default so headless
// and bridge runs always have a valid owner.
function findProject(projectId) {
  return state.projects.find((item) => item.id === projectId) ?? null;
}

function resolveProjectId(projectId) {
  return findProject(projectId) ? projectId : "prj_default";
}

function createProject(body) {
  const name = String(body.name ?? "").trim();
  if (!name) throw new Error("Project name is required.");
  const project = {
    id: nextId("prj"),
    name,
    color: String(body.color ?? "#6366f1"),
    ownerTeamId: String(body.ownerTeamId ?? "team_local"),
    budgetPoolId: body.budgetPoolId ?? null,
    defaultAgentId: body.defaultAgentId ?? null,
    status: "active",
    isolation: body.isolation === "worktree" ? "worktree" : "shared",
    createdAt: now(),
    updatedAt: now()
  };
  state.projects.push(project);
  persistState();
  return project;
}

function updateProject(projectId, patch) {
  const project = findProject(projectId);
  if (!project) throw new Error("Project not found.");
  if (patch.name !== undefined) project.name = String(patch.name).trim() || project.name;
  if (patch.color !== undefined) project.color = String(patch.color);
  if (patch.defaultAgentId !== undefined) project.defaultAgentId = patch.defaultAgentId ?? null;
  if (patch.budgetPoolId !== undefined) project.budgetPoolId = patch.budgetPoolId ?? null;
  if (patch.status !== undefined && ["active", "archived"].includes(patch.status)) project.status = patch.status;
  if (patch.isolation !== undefined && ["shared", "worktree"].includes(patch.isolation)) project.isolation = patch.isolation;
  project.updatedAt = now();
  persistState();
  return project;
}

// --- Project repositories (targets) + worktrees --------------------------
// A ProjectTarget materializes a project on a device at a real git checkout
// (the "where it runs" axis). A clone runs async with progress; a local bind
// links an existing repo. The main worktree mirrors orca's project → worktree.
function repoNameFromUrl(url) {
  const last = String(url).split(/[\\/]/).filter(Boolean).pop() || "repo";
  return last.replace(/\.git$/i, "") || "repo";
}

function detectDefaultBranch(repoPath) {
  try {
    const head = execFileSync("git", ["-C", repoPath, "symbolic-ref", "--short", "HEAD"], { encoding: "utf8" });
    return head.trim() || "main";
  } catch {
    return "main";
  }
}

// The directory an invocation runs in: a repo-backed project's ready main
// worktree. Null when the project is logical-only (falls back to the agent
// adapter's own cwd policy).
function projectWorkingDirectory(projectId) {
  const ready = state.projectTargets.some((t) => t.projectId === projectId && t.state === "ready");
  if (!ready) return null;
  const main = state.worktrees.find((w) => w.projectId === projectId && w.isMain);
  return main?.path ?? null;
}

// Per-invocation isolation: add a dedicated git worktree on a fresh branch so
// concurrent runs on the same repo never collide. Returns the worktree record
// or null (no ready repo / git failed — caller falls back to the shared cwd).
function createEphemeralWorktree(project, invocationId) {
  const target = state.projectTargets.find((t) => t.projectId === project.id && t.state === "ready");
  if (!target) return null;
  const base = path.join(path.dirname(target.rootPath), `.${path.basename(target.rootPath)}.worktrees`);
  const wtPath = path.join(base, invocationId);
  const branch = `agent/${invocationId}`;
  try {
    fs.mkdirSync(base, { recursive: true });
    execFileSync("git", ["-C", target.rootPath, "worktree", "add", "-b", branch, wtPath, target.defaultBranch ?? "HEAD"], {
      stdio: "ignore"
    });
  } catch (error) {
    console.warn(`[server] worktree add failed for ${invocationId}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const worktree = {
    id: nextId("wkt"),
    projectId: project.id,
    targetId: target.id,
    invocationId,
    branch,
    path: wtPath,
    isMain: false,
    ephemeral: true,
    createdAt: now()
  };
  state.worktrees.push(worktree);
  return worktree;
}

// Tear down an invocation's ephemeral worktree (directory + branch + record).
// Idempotent: a no-op when the invocation had no isolated worktree.
function cleanupEphemeralWorktree(invocation) {
  const worktree = state.worktrees.find((w) => w.ephemeral && w.invocationId === invocation.id);
  if (!worktree) return;
  const target = state.projectTargets.find((t) => t.id === worktree.targetId);
  if (target) {
    try {
      execFileSync("git", ["-C", target.rootPath, "worktree", "remove", "--force", worktree.path], { stdio: "ignore" });
    } catch {
      // Directory may already be gone; prune below reconciles git's metadata.
    }
    try {
      execFileSync("git", ["-C", target.rootPath, "worktree", "prune"], { stdio: "ignore" });
      execFileSync("git", ["-C", target.rootPath, "branch", "-D", worktree.branch], { stdio: "ignore" });
    } catch {
      // Branch may carry no unique commits or already be deleted — best effort.
    }
  }
  state.worktrees = state.worktrees.filter((w) => w.id !== worktree.id);
  appendEvent({
    invocationId: invocation.id,
    type: "log",
    level: "info",
    message: `Isolated worktree removed: ${worktree.path}`,
    data: { worktreeId: worktree.id, branch: worktree.branch }
  });
  persistState();
}

function createMainWorktree(target) {
  // One project keeps one main worktree for now; replace any prior one.
  state.worktrees = state.worktrees.filter((w) => w.targetId !== target.id);
  const worktree = {
    id: nextId("wkt"),
    projectId: target.projectId,
    targetId: target.id,
    branch: target.defaultBranch ?? "main",
    path: target.rootPath,
    isMain: true,
    createdAt: now()
  };
  state.worktrees.push(worktree);
  return worktree;
}

function startClone(target) {
  const child = spawn("git", ["clone", "--progress", target.remoteUrl, target.rootPath]);
  const apply = (chunk) => {
    const text = chunk.toString();
    // Prefer "Receiving objects: NN%"; fall back to any trailing percentage.
    const recv = [...text.matchAll(/Receiving objects:\s+(\d+)%/g)].pop();
    const any = recv ?? [...text.matchAll(/(\d+)%/g)].pop();
    if (any) {
      target.progress = Math.min(99, Number(any[1]));
      target.message = recv ? `Receiving objects ${target.progress}%` : `Cloning ${target.progress}%`;
      target.updatedAt = now();
    }
  };
  child.stderr.on("data", apply);
  child.stdout.on("data", apply);
  child.on("error", (err) => {
    target.state = "failed";
    target.message = `git clone failed: ${err instanceof Error ? err.message : String(err)}`;
    target.updatedAt = now();
    persistState();
  });
  child.on("close", (code) => {
    if (code === 0) {
      target.state = "ready";
      target.progress = 100;
      target.defaultBranch = detectDefaultBranch(target.rootPath);
      target.message = "Clone complete.";
      createMainWorktree(target);
    } else {
      target.state = "failed";
      target.message = `git clone exited with code ${code}.`;
    }
    target.updatedAt = now();
    persistState();
  });
}

function cloneProjectRepo(project, repoUrl, parentDir) {
  const base = path.resolve(String(parentDir || "").trim() || process.cwd());
  const rootPath = path.join(base, repoNameFromUrl(repoUrl));
  if (fs.existsSync(rootPath)) throw new Error(`Destination already exists: ${rootPath}`);
  const target = {
    id: nextId("tgt"),
    projectId: project.id,
    deviceId: state.device.id,
    kind: "clone",
    remoteUrl: String(repoUrl),
    rootPath,
    defaultBranch: null,
    state: "cloning",
    progress: 0,
    message: "Starting clone…",
    createdAt: now(),
    updatedAt: now()
  };
  state.projectTargets.push(target);
  startClone(target);
  return target;
}

function bindLocalRepo(project, repoPath) {
  const rootPath = path.resolve(String(repoPath).trim());
  if (!fs.existsSync(rootPath) || !fs.existsSync(path.join(rootPath, ".git"))) {
    throw new Error(`Not a git repository: ${rootPath}`);
  }
  const target = {
    id: nextId("tgt"),
    projectId: project.id,
    deviceId: state.device.id,
    kind: "local",
    remoteUrl: null,
    rootPath,
    defaultBranch: detectDefaultBranch(rootPath),
    state: "ready",
    progress: 100,
    message: "Local repository linked.",
    createdAt: now(),
    updatedAt: now()
  };
  state.projectTargets.push(target);
  createMainWorktree(target);
  return target;
}

// Register a repository-backed project: clone a remote URL (async) or bind an
// existing local checkout. The project is the logical owner; the target is the
// materialization. Throws synchronously on bad input.
function createProjectWithRepo(body) {
  const isClone = Boolean(body.repoUrl);
  const derived = isClone
    ? repoNameFromUrl(body.repoUrl)
    : path.basename(path.resolve(String(body.repoPath ?? "").trim() || "."));
  const project = createProject({ name: String(body.name ?? "").trim() || derived, color: body.color });
  let target;
  try {
    target = isClone
      ? cloneProjectRepo(project, String(body.repoUrl), body.parentDir)
      : bindLocalRepo(project, String(body.repoPath));
  } catch (error) {
    // Roll back the logical project so a bad path/URL leaves no orphan.
    state.projects = state.projects.filter((p) => p.id !== project.id);
    persistState();
    throw error;
  }
  persistState();
  return { project, target };
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
  const command = String(body.command ?? body.adapter?.command ?? "").trim();
  if (!command) {
    throw new Error("CLI agent command is required.");
  }
  const args = Array.isArray(body.args ?? body.adapter?.args) ? (body.args ?? body.adapter.args).map(String) : [];
  const profile = codingAgentProfile(command);
  // A coding agent's "mode" is its sandbox (Codex) or permission mode (Claude);
  // accept the profile's key, the adapter copy, or a generic `sandbox`.
  const mode = profile
    ? profile.normalizeMode(body[profile.modeKey] ?? body.adapter?.[profile.modeKey] ?? body.sandbox)
    : null;
  // Deterministic id per (coding command + mode) so re-registering the same
  // config upserts in place instead of piling up duplicates; a different mode is
  // a distinct agent. Non-coding CLI agents get a generated id; explicit body.id wins.
  const id = sanitizeAgentId(body.id ?? (profile ? `${profile.idPrefix}${mode}` : nextId("agt_cli")));
  const normalizedArgs = args.length > 0 ? args : profile ? profile.defaultArgs(mode) : [];
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
      timeoutSeconds: Number(body.timeoutSeconds ?? profile?.timeoutSeconds ?? 30),
      cancellation: "supported",
      outputFormat: normalizeCliOutputFormat(body.outputFormat ?? body.adapter?.outputFormat, command),
      sandbox: profile?.modeKey === "sandbox" ? mode : (body.sandbox ?? body.adapter?.sandbox ?? null),
      permissionMode: profile?.modeKey === "permissionMode" ? mode : null
    },
    capabilities: [
      {
        name: body.capabilityName ?? "manual_cli_task",
        description: body.capabilityDescription ?? "Runs a manually registered local CLI command.",
        riskLevel: normalizeRiskLevel(body.riskLevel, profile ? "high" : "medium"),
        riskTags: normalizeRiskTags(
          body.riskTags ?? body.capabilityRiskTags,
          profile ? profile.riskTags() : ["read_local", "shell_exec"]
        )
      }
    ],
    status: state.device.status === "online" ? "available" : "unavailable",
    projectId: body.projectId,
    registrationNotes: profile
      ? profile.notes()
      : {
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
    projectId: body.projectId,
    registrationNotes: {
      risk: "Sends invocation input to the configured HTTP endpoint.",
      data: "Task input leaves the local demo server and endpoint response is stored as the result.",
      cost: "Cost is external or unknown unless the endpoint reports it.",
      cancellation: "The server aborts the HTTP request when supported; otherwise cancellation is recorded as not supported or unknown."
    },
    economics: normalizeAgentEconomics(body)
  });
}

function baseAgent({ id, name, description, location, adapter, capabilities, status, registrationNotes, economics = {}, projectId }) {
  const createdAt = now();
  return {
    id,
    projectId: resolveProjectId(projectId),
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
        sandbox: candidate.adapter?.sandbox ?? (codexCommand ? "read-only" : null)
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
  disableAgent(agent);
  candidate.registration.status = "registered";
  candidate.registration.registeredAgentId = agent.id;
  discoveryRun.updatedAt = now();
  appendEvent({
    invocationId: null,
    type: "lifecycle_completed",
    level: "info",
    message: `${candidate.name} was registered from discovery and left disabled for review.`,
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
      sandbox: body.sandbox ?? body.adapter?.sandbox ?? (isCodexCliCommand(command) ? "read-only" : null),
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
  disableAgent(agent);
  artifact.reviewState = "enabled";
  artifact.enabledAgentId = agent.id;
  artifact.updatedAt = now();
  appendEvent({
    invocationId: null,
    type: "integration_enabled",
    level: "info",
    message: `${agent.name} registered from tested artifact and left disabled.`,
    data: { artifactId: artifact.id, agentId: agent.id, disabled: true }
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
    sandbox: adapter?.sandbox ?? (isCodexCliCommand(adapter?.command ?? artifact.payload?.structuredHints?.command) ? "read-only" : null)
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
      sandbox: "read-only"
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
    return "Codex CLI can inspect repository context and may propose code changes. It must run through codex exec, read-only sandbox by default, JSONL evidence, local approval, and explicit enablement.";
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

function codexCliArgs(sandbox = "read-only") {
  return ["exec", "--json", "--sandbox", normalizeCodexSandbox(sandbox), "--ephemeral", "{{task}}"];
}

// Codex sandbox modes, safest first. read-only stays the default everywhere a
// sandbox is not explicitly chosen, so conservative discovery/builder paths are
// unchanged; writable modes are opt-in and remain high-risk (approval-gated).
function normalizeCodexSandbox(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["read-only", "workspace-write", "danger-full-access"].includes(normalized)
    ? normalized
    : "read-only";
}

function codexRiskTags() {
  return ["read_local", "write_local", "shell_exec", "network_access", "repo_context", "code_change"];
}

function normalizeCliOutputFormat(value, command) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "codex_jsonl") return "codex_jsonl";
  if (normalized === "claude_jsonl") return "claude_jsonl";
  if (isCodexCliCommand(command)) return "codex_jsonl";
  if (isClaudeCliCommand(command)) return "claude_jsonl";
  return "plain_result";
}

function codexRegistrationNotes() {
  return {
    risk: "Runs Codex CLI in non-interactive mode. Review repository access, sandbox, model output, and proposed file changes before invoking.",
    data: "Task input, Codex JSONL events, command output, trace, and result summary are recorded by the local demo server.",
    cost: "Codex cost is external or unknown to the demo server and remains visible for review.",
    cancellation: "The Desktop Bridge attempts to terminate the Codex process tree when cancellation is requested."
  };
}

function isClaudeCliCommand(command) {
  const normalized = String(command ?? "").trim().toLowerCase();
  return ["claude", "claude.cmd", "claude.exe"].some((name) => normalized === name || normalized.endsWith(`/${name}`) || normalized.endsWith(`\\${name}`));
}

// Claude Code runs non-interactively via `claude -p` with stream-json events.
// plan is the safe default (no edits); acceptEdits and bypassPermissions are
// writable opt-ins. "default"/"auto" are excluded because they block on
// interactive prompts in a headless bridge.
function normalizeClaudePermissionMode(value) {
  const normalized = String(value ?? "").trim();
  return ["plan", "acceptEdits", "bypassPermissions"].includes(normalized) ? normalized : "plan";
}

function claudeCliArgs(permissionMode = "plan") {
  return ["-p", "{{task}}", "--output-format", "stream-json", "--verbose", "--permission-mode", normalizeClaudePermissionMode(permissionMode)];
}

function claudeRiskTags() {
  return ["read_local", "write_local", "shell_exec", "network_access", "repo_context", "code_change"];
}

function claudeRegistrationNotes() {
  return {
    risk: "Runs Claude Code non-interactively (claude -p). Review repository access, permission mode, tool use, and proposed file changes before invoking.",
    data: "Task input, Claude stream-json events, result text, trace, and result summary are recorded by the local demo server.",
    cost: "Claude cost is external or unknown to the demo server and remains visible for review.",
    cancellation: "The Desktop Bridge attempts to terminate the Claude process tree when cancellation is requested."
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
  const projectId = resolveProjectId(options.projectId ?? agent.projectId);
  const project = findProject(projectId);
  // Default to the project's shared worktree; an isolated project gets a fresh
  // ephemeral worktree per CLI run (the only adapter that uses a cwd).
  let workingDirectory = projectWorkingDirectory(projectId);
  if (project?.isolation === "worktree" && agent.adapter?.type === "cli") {
    const ephemeral = createEphemeralWorktree(project, id);
    if (ephemeral) workingDirectory = ephemeral.path;
  }
  const invocation = {
    id,
    ideaSessionId: null,
    projectId,
    workingDirectory,
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
      metadata: { demo: true, ...(options.metadata && typeof options.metadata === "object" && !Array.isArray(options.metadata) ? options.metadata : {}) }
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
  const policyRecord = createPolicyDecisionRecord(invocation, agent, policy);
  invocation.policyDecisionId = policyRecord.id;
  appendEvent({
    invocationId: invocation.id,
    type: "invocation_created",
    level: "info",
    message: "Invocation created from Web Console."
  });
  if (workingDirectory) {
    const isolated = project?.isolation === "worktree" && agent.adapter?.type === "cli";
    appendEvent({
      invocationId: invocation.id,
      type: "log",
      level: "info",
      message: `${isolated ? "Runs in isolated worktree" : "Runs in project worktree"}: ${workingDirectory}`,
      data: { workingDirectory, projectId, isolated }
    });
  }
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
  persistState();
  return invocation;
}

function evaluateInvocationPolicy(agent, options = {}) {
  const capabilities = Array.isArray(agent.capabilities) ? agent.capabilities : [];
  const riskLevel = highestRiskLevel(capabilities.map((capability) => capability.riskLevel));
  const riskTags = uniqueStrings(capabilities.flatMap((capability) => capability.riskTags ?? []));
  const requiresApproval = Boolean(options.requireLocalApproval) || ["high", "critical"].includes(riskLevel);
  return {
    decision: requiresApproval ? "requires_local_approval" : "allowed",
    reason: requiresApproval
      ? `${agent.name} has ${riskLevel} risk capability tags and needs local approval before running.`
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
  recordLedgerEntry(invocation, terminalStatus);
  cleanupEphemeralWorktree(invocation);
}

// One finalized economic ledger entry per completed invocation, derived from the
// cost the agent reported (Claude returns real total_cost_usd; Codex/demo report
// unknown). This is the spine of the agent-economics differentiator: every run is
// attributable to a cost owner and rolls up through one ledger.
function recordLedgerEntry(invocation, terminalStatus) {
  const agent = findAgent(invocation.agentId);
  const cost = invocation.result?.cost ?? {};
  const inputTokens = Number(cost.inputTokens ?? 0) || 0;
  const outputTokens = Number(cost.outputTokens ?? 0) || 0;
  const reported = finiteUsd(cost.amountUsd);
  // No provider-reported amount? Estimate from tokens x the price book (Codex).
  const estimate = reported === null ? estimateCostUsd(cost.model, inputTokens, outputTokens) : null;
  const effective = reported ?? estimate;
  const amountSource = reported !== null ? "reported" : estimate !== null ? "estimated" : "unknown";
  const economicModel = agent?.economics?.model ?? "unknown";
  const ledgerStatus = terminalStatus === "cancelled" ? "voided" : reported !== null ? "finalized" : "estimated";
  const entry = {
    id: nextId("led_demo"),
    invocationId: invocation.id,
    projectId: invocation.projectId ?? "prj_default",
    agentId: invocation.agentId,
    agentName: agent?.name ?? invocation.agentId,
    deviceId: invocation.delivery?.deviceId ?? state.device.id,
    userId: agent?.economics?.costOwner ?? "unknown",
    sourceType: TOKEN_PRICING[String(cost.model ?? "").toLowerCase()] ? "ai_usage" : "agent_invocation",
    entryType: "cost",
    economicModel,
    meterName: amountSource === "estimated" ? "per_token" : "per_invocation",
    provider: cost.model ?? "unknown",
    quantity: 1,
    inputTokens,
    outputTokens,
    currency: agent?.economics?.currency ?? "USD",
    amountUsd: effective,
    amountSource,
    amountText: reported !== null ? `$${reported.toFixed(4)}` : estimate !== null ? `~$${estimate.toFixed(4)}` : "unknown",
    amountDirection: cost.billable ? "payable" : "informational",
    costOwner: agent?.economics?.costOwner ?? "unknown",
    billable: Boolean(cost.billable),
    status: ledgerStatus,
    invocationStatus: terminalStatus,
    createdAt: now(),
    finalizedAt: reported !== null ? now() : null
  };
  state.ledgerEntries.unshift(entry);
  state.ledgerEntries = state.ledgerEntries.slice(0, 200);
  persistState();
  return entry;
}

// Estimate cost from tokens x the price book, used only when an agent reports no
// billed amount (e.g. Codex). Estimates are tracked separately from finalized
// (reported) spend, but DO count toward budget caps (see ledgerEntrySpend).
function estimateCostUsd(model, inputTokens, outputTokens) {
  const price = TOKEN_PRICING[String(model ?? "").toLowerCase()];
  if (!price || (inputTokens <= 0 && outputTokens <= 0)) return null;
  const amount = (inputTokens / 1_000_000) * price.inputPerMTok + (outputTokens / 1_000_000) * price.outputPerMTok;
  return Number(amount.toFixed(6));
}

// A finite, non-negative USD number, or null. Guards spend totals and budget
// comparisons against NaN / Infinity / negative amounts from an agent.
function finiteUsd(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

// What a ledger entry contributes to spend and budgets: voided (cancelled)
// entries contribute nothing; reported and estimated amounts both count. This is
// the single spend rule shared by the ledger summary and budget enforcement.
function ledgerEntrySpend(entry) {
  if (entry.status === "voided") return 0;
  return finiteUsd(entry.amountUsd) ?? 0;
}

function recordAgentUsage(invocation, terminalStatus) {
  const agent = findAgent(invocation.agentId);
  const summary = getAgentUsageSummary(invocation.agentId);
  const cost = invocation.result?.cost ?? {};
  const reported = finiteUsd(cost.amountUsd);
  // Cancelled runs are voided — they do not add to billed spend.
  if (terminalStatus !== "cancelled") {
    if (reported !== null) {
      summary.totalCostUsd = Number((Number(summary.totalCostUsd ?? 0) + reported).toFixed(6));
      summary.billableInvocations = (summary.billableInvocations ?? 0) + 1;
    } else {
      summary.unknownCostInvocations = (summary.unknownCostInvocations ?? 0) + 1;
    }
  }
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
      totalCostUsd: 0,
      billableInvocations: 0,
      unknownCostInvocations: 0,
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
    cleanupEphemeralWorktree(invocation);
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
    costSummary: costSummaryForInvocation(invocation),
    metadata: { namespace, protocolVersion }
  };
}

// Keep the word "unknown" when there is no metered amount; surface the real
// figure when an agent (e.g. Claude) reports one.
function costSummaryForInvocation(invocation) {
  const cost = invocation.result?.cost ?? {};
  if (typeof cost.amountUsd === "number") {
    return `Metered $${cost.amountUsd.toFixed(4)} via ${cost.model ?? "agent"}${cost.billable ? " (billable)" : ""}.`;
  }
  return "Cost is unknown; no billing was performed.";
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
  state.events.unshift({
    id: nextId("evt_demo"),
    invocationId: event.invocationId,
    type: event.type,
    level: event.level,
    message: event.message,
    data: event.data ?? null,
    createdAt: now()
  });
  state.events = state.events.slice(0, 200);
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
    cleanupEphemeralWorktree(invocation);
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

function publicState() {
  const ledgerSummary = summarizeLedger();
  return {
    namespace,
    protocolVersion,
    device: state.device,
    projects: state.projects,
    projectTargets: state.projectTargets,
    worktrees: state.worktrees,
    agent: defaultAgent(),
    agents: state.agents,
    invocations: state.invocations,
    events: state.events,
    traces: state.traces,
    spans: state.spans,
    auditSummaries: state.auditSummaries,
    healthChecks: state.healthChecks,
    lifecycleAuditRecords: state.lifecycleAuditRecords,
    discoveryRuns: state.discoveryRuns,
    integrationArtifacts: state.integrationArtifacts,
    integrationProbeRuns: state.integrationProbeRuns,
    quotaDecisionRecords: state.quotaDecisionRecords,
    retentionSettings: state.retentionSettings,
    approvalRequests: state.approvalRequests,
    policyDecisionRecords: state.policyDecisionRecords,
    troubleshootingReports: state.troubleshootingReports,
    agentUsageSummaries: state.agentUsageSummaries,
    ledgerEntries: state.ledgerEntries,
    ledgerSummary,
    budgets: state.budgets,
    budgetStatuses: budgetStatuses(ledgerSummary)
  };
}

// Roll the per-invocation ledger up into the views the console shows: a total,
// and breakdowns by cost owner and by agent. Known USD amounts sum; unmetered
// runs are surfaced as a visible count, never hidden.
function summarizeLedger() {
  const entries = state.ledgerEntries;
  const byOwner = new Map();
  const byAgent = new Map();
  const byProject = new Map();
  let finalizedUsd = 0;
  let estimatedUsd = 0;
  let knownEntries = 0;
  let estimatedEntries = 0;
  let unknownEntries = 0;
  let voidedEntries = 0;
  let billableEntries = 0;

  for (const entry of entries) {
    // Voided (cancelled) entries stay visible in the ledger but contribute no
    // spend — same rule budget enforcement uses (ledgerEntrySpend).
    if (entry.status === "voided") {
      voidedEntries += 1;
      continue;
    }
    const amount = ledgerEntrySpend(entry);
    if (entry.amountSource === "reported") {
      finalizedUsd += amount;
      knownEntries += 1;
    } else if (entry.amountSource === "estimated") {
      estimatedUsd += amount;
      estimatedEntries += 1;
    } else {
      unknownEntries += 1;
    }
    if (entry.billable) billableEntries += 1;

    const owner = byOwner.get(entry.costOwner) ?? { costOwner: entry.costOwner, entries: 0, knownCostUsd: 0, estimatedCostUsd: 0, unknownEntries: 0 };
    owner.entries += 1;
    if (entry.amountSource === "reported") owner.knownCostUsd += amount;
    else if (entry.amountSource === "estimated") owner.estimatedCostUsd += amount;
    else owner.unknownEntries += 1;
    byOwner.set(entry.costOwner, owner);

    const projectId = entry.projectId ?? "prj_default";
    const project = byProject.get(projectId) ?? { projectId, projectName: findProject(projectId)?.name ?? projectId, entries: 0, knownCostUsd: 0, estimatedCostUsd: 0, unknownEntries: 0 };
    project.entries += 1;
    if (entry.amountSource === "reported") project.knownCostUsd += amount;
    else if (entry.amountSource === "estimated") project.estimatedCostUsd += amount;
    else project.unknownEntries += 1;
    byProject.set(projectId, project);

    const agent = byAgent.get(entry.agentId) ?? { agentId: entry.agentId, agentName: entry.agentName, provider: entry.provider, entries: 0, knownCostUsd: 0, estimatedCostUsd: 0, unknownEntries: 0 };
    agent.entries += 1;
    if (entry.amountSource === "reported") agent.knownCostUsd += amount;
    else if (entry.amountSource === "estimated") agent.estimatedCostUsd += amount;
    else agent.unknownEntries += 1;
    byAgent.set(entry.agentId, agent);
  }

  const round = (value) => Number(value.toFixed(6));
  const roundOwner = (o) => ({ ...o, knownCostUsd: round(o.knownCostUsd), estimatedCostUsd: round(o.estimatedCostUsd) });
  return {
    currency: "USD",
    totalCostUsd: round(finalizedUsd + estimatedUsd),
    finalizedUsd: round(finalizedUsd),
    estimatedUsd: round(estimatedUsd),
    entryCount: entries.length,
    knownEntries,
    estimatedEntries,
    unknownEntries,
    voidedEntries,
    billableEntries,
    byCostOwner: [...byOwner.values()].map(roundOwner),
    byProject: [...byProject.values()].map(roundOwner),
    byAgent: [...byAgent.values()].map(roundOwner)
  };
}

// --- Budgets and quota enforcement ---------------------------------------
// A budget pool caps a cost owner's metered spend. When spend reaches the
// limit, the owner's policy decides: warn (allow), require_approval (force the
// approval gate), or block (refuse new invocations). No budgets are seeded, so
// enforcement is opt-in and existing flows are unaffected until one is set.

function normalizeBudgetPolicy(value) {
  const normalized = String(value ?? "").trim();
  return ["warn", "require_approval", "block"].includes(normalized) ? normalized : "warn";
}

function upsertBudget(body) {
  const projectId = String(body.projectId ?? "").trim();
  if (!projectId) throw new Error("Budget projectId is required.");
  if (!findProject(projectId)) throw new Error("Budget projectId must reference a known project.");
  const limitUsd = Number(body.limitUsd);
  if (!Number.isFinite(limitUsd) || limitUsd < 0) throw new Error("Budget limitUsd must be a non-negative number.");
  const policy = normalizeBudgetPolicy(body.policy);
  const existing = state.budgets.find((item) => item.projectId === projectId);
  if (existing) {
    existing.limitUsd = limitUsd;
    existing.policy = policy;
    existing.updatedAt = now();
    persistState();
    return existing;
  }
  const budget = {
    id: nextId("bgt_demo"),
    projectId,
    limitUsd,
    policy,
    currency: "USD",
    createdAt: now(),
    updatedAt: now()
  };
  state.budgets.push(budget);
  persistState();
  return budget;
}

// Committed spend for a project (reported + estimated, excluding voided),
// split so the UI can show the breakdown. This is the budget basis.
function projectSpend(projectId) {
  let finalizedUsd = 0;
  let estimatedUsd = 0;
  for (const entry of state.ledgerEntries) {
    if ((entry.projectId ?? "prj_default") !== projectId || entry.status === "voided") continue;
    const amount = ledgerEntrySpend(entry);
    if (entry.amountSource === "reported") finalizedUsd += amount;
    else if (entry.amountSource === "estimated") estimatedUsd += amount;
  }
  const round = (v) => Number(v.toFixed(6));
  return { finalizedUsd: round(finalizedUsd), estimatedUsd: round(estimatedUsd), spentUsd: round(finalizedUsd + estimatedUsd) };
}

// Best-effort reservation against concurrent bursts: each in-flight (non-terminal)
// run for this project holds a nominal amount, since the real per-run cost is not
// known until completion.
function projectInFlightReservation(projectId) {
  let active = 0;
  for (const inv of state.invocations) {
    if (!["queued", "dispatching", "running", "waiting_for_local_approval", "cancelling"].includes(inv.status)) continue;
    if ((inv.projectId ?? "prj_default") === projectId) active += 1;
  }
  return Number((active * BUDGET_RESERVATION_USD).toFixed(6));
}

function budgetStatusFor(projectId, spend = projectSpend(projectId)) {
  const budget = state.budgets.find((item) => item.projectId === projectId);
  const base = {
    projectId,
    projectName: findProject(projectId)?.name ?? projectId,
    spentUsd: spend.spentUsd,
    finalizedUsd: spend.finalizedUsd,
    estimatedUsd: spend.estimatedUsd
  };
  if (!budget) {
    return { ...base, exists: false, limitUsd: null, policy: "warn", remainingUsd: null, over: false };
  }
  // A limit of 0 is a deliberate "freeze" (block every run): spend >= 0 is always
  // true. For limit > 0, at-or-over the cap is over-budget.
  const over = spend.spentUsd >= budget.limitUsd;
  return {
    ...base,
    exists: true,
    budgetId: budget.id,
    limitUsd: budget.limitUsd,
    policy: budget.policy,
    currency: budget.currency,
    remainingUsd: Number((budget.limitUsd - spend.spentUsd).toFixed(6)),
    over
  };
}

// Derive every budget's status from the ledger summary's per-project rollup so the
// hot /api/state path scans the ledger once (via summarizeLedger) instead of
// re-scanning per budget.
function budgetStatuses(summary = summarizeLedger()) {
  const spendByProject = new Map(
    (summary.byProject ?? []).map((p) => [
      p.projectId,
      {
        finalizedUsd: p.knownCostUsd,
        estimatedUsd: p.estimatedCostUsd,
        spentUsd: Number((p.knownCostUsd + p.estimatedCostUsd).toFixed(6))
      }
    ])
  );
  return state.budgets.map((budget) =>
    budgetStatusFor(budget.projectId, spendByProject.get(budget.projectId) ?? { finalizedUsd: 0, estimatedUsd: 0, spentUsd: 0 })
  );
}

function recordBudgetQuotaDecision(status, decision, reason) {
  const record = {
    id: nextId("qd_demo"),
    subjectType: "team",
    subjectId: status.projectId,
    resourceType: "budget_pool",
    resourceId: status.budgetId ?? status.projectId,
    decision,
    reason,
    createdAt: now()
  };
  state.quotaDecisionRecords.unshift(record);
  state.quotaDecisionRecords = state.quotaDecisionRecords.slice(0, 100);
  return record;
}

// Evaluate the project's budget before an invocation is created. Returns the
// action to take; only an over-budget project with a budget set is affected.
function enforceBudgetForProject(projectId) {
  const status = budgetStatusFor(projectId);
  const label = status.projectName ?? projectId;
  if (!status.exists) {
    return { action: "allow", status };
  }
  // Project committed spend plus a hold for in-flight runs, so a burst of
  // concurrent invocations cannot all slip through on the same pre-completion
  // snapshot.
  const reservation = projectInFlightReservation(projectId);
  const projectedUsd = Number((status.spentUsd + reservation).toFixed(6));
  if (projectedUsd < status.limitUsd) {
    return { action: "allow", status };
  }
  const projected = `$${projectedUsd.toFixed(4)}`;
  const limit = `$${Number(status.limitUsd).toFixed(2)}`;
  if (status.policy === "block") {
    recordBudgetQuotaDecision(status, "blocked_quota_exceeded", `${label} projected ${projected} against ${limit} budget; new runs are blocked.`);
    return { action: "block", status, reason: `Budget exceeded for ${label}: ${projected} of ${limit}.` };
  }
  if (status.policy === "require_approval") {
    recordBudgetQuotaDecision(status, "allowed", `${label} is over budget (${projected} of ${limit}); local approval required.`);
    return { action: "require_approval", status, reason: `Over budget for ${label}: ${projected} of ${limit}.` };
  }
  recordBudgetQuotaDecision(status, "allowed", `${label} is over budget (${projected} of ${limit}); allowed with warning.`);
  return { action: "warn", status };
}

function runProtocolSelfCheck() {
  resetDemoStateForCheck();
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
  assert(codexDiscovery.candidates[0].adapter.args.includes("read-only"), "Codex discovery should default to read-only sandbox");
  assert(codexDiscovery.candidates[0].adapter.outputFormat === "codex_jsonl", "Codex discovery should mark JSONL output");
  assert(codexDiscovery.candidates[0].riskTags.includes("repo_context"), "Codex discovery should include repository context risk");
  const codexAgent = registerDiscoveredCandidate(codexDiscovery, codexDiscovery.candidates[0]);
  assert(codexAgent.status === "disabled", "explicit Codex discovery registration should stay disabled");
  assert(codexAgent.adapter.outputFormat === "codex_jsonl", "registered Codex candidate should preserve JSONL output config");

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
  assert(codexAdapterArtifact.payload.adapterConfig.args.includes("read-only"), "Codex adapter config should default to read-only sandbox");
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
  state.agents = state.agents.filter((agent) => ["agt_demo_cli", "agt_platform_troubleshooter", "agt_platform_integration_builder"].includes(agent.id));
  state.projects = state.projects.filter((project) => project.id === "prj_default");
  state.projectTargets = [];
  state.worktrees = [];
  const demoAgent = defaultAgent();
  if (demoAgent) {
    demoAgent.status = "unavailable";
    demoAgent.updatedAt = now();
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
  state.ledgerEntries = [];
  state.budgets = [];
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
