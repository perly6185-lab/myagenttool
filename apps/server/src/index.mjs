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
      registrationNotes: {
        risk: "Low risk demo command. It does not read or write user files.",
        data: "Task text, logs, trace, and final result are stored in the local demo server.",
        cost: "Cost is unknown and no billing is performed.",
        cancellation: "The bridge forwards cancellation to the local demo process."
      },
      createdAt: now()
    }
  ],
  invocations: [],
  events: [],
  traces: [],
  spans: [],
  auditSummaries: []
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
      if (agent.location.type === "local_device" && state.device.unlinkState !== "linked") {
        sendJson(res, 409, { error: "device_unlinked" });
        return;
      }
      const invocation = createInvocation(task, agent);
      if (agent.adapter.type === "http" && agent.location.type === "remote_http") {
        queueMicrotask(() => runHttpInvocation(invocation, agent).catch((error) => {
          completeInvocation(invocation, {
            status: "failed",
            summary: `HTTP Agent failed: ${error instanceof Error ? error.message : String(error)}`,
            result: null
          });
        }));
      }
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
    state.agents[existingIndex] = { ...state.agents[existingIndex], ...agent, updatedAt: now() };
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
        riskLevel: body.riskLevel ?? "medium",
        riskTags: ["read_local", "shell_exec"]
      }
    ],
    status: state.device.status === "online" ? "available" : "unavailable",
    registrationNotes: {
      risk: "Runs a local command with structured argv. Review the command, arguments, working directory, and environment before invoking.",
      data: "Task input and command output are streamed to the local demo server as invocation events.",
      cost: "Cost is external or unknown unless the registered command reports it.",
      cancellation: "The Desktop Bridge attempts to terminate the process tree when cancellation is requested."
    }
  });
}

function createHttpAgent(body) {
  const id = sanitizeAgentId(body.id ?? nextId("agt_http"));
  const baseUrl = String(body.baseUrl ?? body.adapter?.baseUrl ?? "").trim();
  if (!baseUrl) {
    throw new Error("HTTP agent baseUrl is required.");
  }
  const requestPath = String(body.requestPath ?? body.adapter?.requestPath ?? "/invoke");
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
        riskLevel: body.riskLevel ?? "medium",
        riskTags: ["network_access", "external_data_transfer"]
      }
    ],
    status: "available",
    registrationNotes: {
      risk: "Sends invocation input to the configured HTTP endpoint.",
      data: "Task input leaves the local demo server and endpoint response is stored as the result.",
      cost: "Cost is external or unknown unless the endpoint reports it.",
      cancellation: "The server aborts the HTTP request when supported; otherwise cancellation is recorded as not supported or unknown."
    }
  });
}

function baseAgent({ id, name, description, location, adapter, capabilities, status, registrationNotes }) {
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
      managedBy: adapter.type === "http" ? "external" : "bridge"
    },
    economics: {
      model: "unknown",
      pricingDimensions: [],
      currency: "USD",
      costOwner: "usr_local",
      budgetPoolId: null,
      unknownCostPolicy: "warn"
    },
    capabilities,
    status,
    registrationNotes,
    createdAt,
    updatedAt: createdAt
  };
}

function createInvocation(task, agent = defaultAgent()) {
  if (!agent) {
    throw new Error("No agent is registered.");
  }
  const id = nextId("inv_demo");
  const createdAt = now();
  const trace = createTrace(id, agent);
  const invocation = {
    id,
    ideaSessionId: null,
    agentId: agent.id,
    requestedBy: "usr_local",
    status: agent.adapter.type === "http" ? "running" : "queued",
    delivery: {
      deliveryId: nextId("del_demo"),
      deviceId: agent.location.type === "local_device" ? agent.location.deviceId : null,
      state: agent.adapter.type === "http" ? "not_required" : "queued",
      idempotencyKey: `idem_${id}`,
      leaseExpiresAt: null,
      dispatchAttempts: agent.adapter.type === "http" ? 1 : 0,
      lastDispatchAt: agent.adapter.type === "http" ? createdAt : null,
      acknowledgedAt: agent.adapter.type === "http" ? createdAt : null,
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
      timeoutSeconds: 30,
      requireLocalApproval: false,
      metadata: { demo: true }
    },
    result: null,
    traceId: trace.id,
    rootSpanId: trace.rootSpanId,
    createdAt,
    updatedAt: createdAt
  };
  state.invocations.unshift(invocation);
  appendEvent({
    invocationId: invocation.id,
    type: "invocation_created",
    level: "info",
    message: "Invocation created from Web Console."
  });
  appendEvent({
    invocationId: invocation.id,
    type: "invocation_authorized",
    level: "info",
    message: `Demo invocation authorized for ${agent.name}.`
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
    type: agent.adapter.type === "http" ? "invocation_started" : "delivery_queued",
    level: "info",
    message: agent.adapter.type === "http" ? "HTTP Agent invocation started." : "Invocation queued for Desktop Bridge."
  });
  return invocation;
}

function nextDispatchableInvocation() {
  return state.invocations.find((item) =>
    item.status === "queued" && ["queued", "redelivering"].includes(item.delivery.state)
  );
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

  if (invocation.status === "queued") {
    invocation.status = "cancelled";
    invocation.cancellation.state = "queued_cancelled";
    invocation.updatedAt = now();
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
      message: "Queued invocation cancelled before dispatch."
    });
    state.auditSummaries.push(createAuditSummary(invocation, "Cancelled before local execution."));
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
    permissionDecision: "allowed",
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

function defaultAgent() {
  return state.agents.find((item) => item.id === "agt_demo_cli") ?? state.agents[0] ?? null;
}

function findAgent(id) {
  return state.agents.find((item) => item.id === id);
}

function normalizeEnv(env) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return {};
  }
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [String(key), String(value)]));
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
    agent.status = "unavailable";
    agent.updatedAt = now();
  }
  for (const invocation of state.invocations.filter((item) => item.status === "queued")) {
    invocation.status = "cancelled";
    invocation.cancellation.state = "queued_cancelled";
    invocation.cancellation.requestedBy = "usr_local";
    invocation.cancellation.requestedAt = now();
    invocation.cancellation.reason = "Device unlinked before dispatch.";
    invocation.completedAt = now();
    invocation.updatedAt = now();
    appendEvent({
      invocationId: invocation.id,
      type: "device_queue_cancelled",
      level: "warn",
      message: "Queued invocation cancelled because the device was unlinked."
    });
    state.auditSummaries.push(createAuditSummary(invocation, "Device unlink cancelled queued local work."));
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
    auditSummaries: state.auditSummaries
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

  const invocation = createInvocation("self-check invocation", cliAgent);
  assert(invocation.status === "queued", "created invocation should be queued");
  assert(invocation.delivery.state === "queued", "created delivery should be queued");
  assert(invocation.agentId === cliAgent.id, "created invocation should reference selected CLI agent");
  assert(state.traces.length === 1 && state.spans.length === 1, "trace and root span should be created");

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
  state.agents = state.agents.filter((agent) => agent.id === "agt_demo_cli");
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
