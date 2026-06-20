import http from "node:http";

const namespace = "com.myagenttool";
const protocolVersion = "0.0.0";
const host = process.env.SERVER_HOST ?? "127.0.0.1";
const port = Number(process.env.SERVER_PORT ?? 3001);
const dispatchLeaseMs = Number(process.env.SERVER_DISPATCH_LEASE_MS ?? 30_000);

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
  approvalRequests: [],
  policyDecisionRecords: [],
  troubleshootingReports: [],
  agentUsageSummaries: []
};

let idCounter = 1;
const directHttpRuns = new Map();

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
      sendJson(res, 201, { agent });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/discovery") {
      const body = await readJson(req);
      const discoveryRun = createDiscoveryRun(body);
      sendJson(res, 202, { discoveryRun });
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

      sendJson(res, 200, {
        namespace,
        protocolVersion,
        invocationId: invocation.id,
        agentId: invocation.agentId,
        adapter: findAgent(invocation.agentId)?.adapter ?? null,
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
      const invocation = createInvocation(task, agent, body.options ?? {});
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

server.listen(port, host, () => {
  console.log(`[server] http://${host}:${port}`);
});

function now() {
  return new Date().toISOString();
}

function nextId(prefix) {
  const id = `${prefix}_${String(idCounter).padStart(4, "0")}`;
  idCounter += 1;
  return id;
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
  } else {
    state.agents.push(agent);
  }
  return agent;
}

function createCliAgent(body) {
  const id = sanitizeAgentId(body.id ?? nextId("agt_cli"));
  const command = String(body.command ?? body.adapter?.command ?? "").trim();
  if (!command) {
    throw new Error("CLI agent command is required.");
  }
  const args = Array.isArray(body.args ?? body.adapter?.args) ? (body.args ?? body.adapter.args).map(String) : [];
  return baseAgent({
    id,
    type: "cli",
    name: body.name ?? "Manual CLI Agent",
    description: body.description ?? "Manually registered CLI agent.",
    location: { type: "local_device", deviceId: state.device.id },
    adapter: {
      type: "cli",
      command,
      args,
      workingDirectory: body.workingDirectory ?? null,
      workingDirectoryPolicy: body.workingDirectory ? "explicit" : "bridge_default",
      environmentPolicy: body.env ? "explicit_only" : "inherit_safe",
      env: normalizeEnv(body.env),
      timeoutSeconds: Number(body.timeoutSeconds ?? 30),
      cancellation: "supported"
    },
    capabilities: [
      {
        name: body.capabilityName ?? "manual_cli_task",
        description: body.capabilityDescription ?? "Runs a manually registered local CLI command.",
        riskLevel: normalizeRiskLevel(body.riskLevel, "medium"),
        riskTags: normalizeRiskTags(body.riskTags ?? body.capabilityRiskTags, ["read_local", "shell_exec"])
      }
    ],
    status: state.device.status === "online" ? "available" : "unavailable",
    registrationNotes: {
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
        command: String(candidate.adapter?.command ?? candidate.command ?? "demo-agent"),
        args: Array.isArray(candidate.adapter?.args ?? candidate.args) ? (candidate.adapter?.args ?? candidate.args).map(String) : ["{{payloadJson}}"],
        workingDirectoryPolicy: "bridge_default",
        environmentPolicy: "inherit_safe",
        timeoutSeconds: Number(candidate.adapter?.timeoutSeconds ?? 30),
        cancellation: candidate.adapter?.cancellation ?? "supported"
      };
  return {
    id: String(candidate.id ?? `cand_${index + 1}`),
    name: String(candidate.name ?? (adapterType === "http" ? "Discovered HTTP Agent" : "Discovered CLI Agent")),
    description: String(candidate.description ?? "Candidate found by conservative local discovery."),
    adapter,
    source,
    confidence: ["low", "medium", "high"].includes(candidate.confidence) ? candidate.confidence : "medium",
    riskLevel: ["low", "medium", "high", "critical"].includes(candidate.riskLevel) ? candidate.riskLevel : adapterType === "http" ? "medium" : "low",
    riskTags: Array.isArray(candidate.riskTags) ? candidate.riskTags.map(String) : adapterType === "http" ? ["network_access", "external_data_transfer"] : ["read_only"],
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
  const invocation = {
    id,
    ideaSessionId: null,
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
  return {
    namespace,
    protocolVersion,
    device: state.device,
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
    approvalRequests: state.approvalRequests,
    policyDecisionRecords: state.policyDecisionRecords,
    troubleshootingReports: state.troubleshootingReports,
    agentUsageSummaries: state.agentUsageSummaries
  };
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
  state.agents = state.agents.filter((agent) => agent.id === "agt_demo_cli" || agent.id === "agt_platform_troubleshooter");
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
  state.approvalRequests = [];
  state.policyDecisionRecords = [];
  state.troubleshootingReports = [];
  state.agentUsageSummaries = [];
  idCounter = 1;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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
