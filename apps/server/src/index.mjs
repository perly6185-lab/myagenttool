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
    createdAt: now()
  },
  agent: {
    id: "agt_demo_cli",
    name: "Demo CLI Agent",
    description: "Safe local demo agent for M0 smoke tests.",
    ownerUserId: "usr_local",
    location: { type: "local_device", deviceId: "dev_local_001" },
    adapter: { type: "cli", command: "demo-agent" },
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
    createdAt: now()
  },
  invocations: [],
  events: [],
  traces: [],
  spans: [],
  auditSummaries: []
};

let idCounter = 1;

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
      state.device.status = "online";
      state.device.lastSeenAt = now();
      state.device.bridgeVersion = String(body.bridgeVersion ?? "0.0.0");
      state.agent.status = "available";
      redeliverExpiredDispatches();
      appendEvent({
        invocationId: null,
        type: "heartbeat",
        level: "info",
        message: "Desktop Bridge registered local demo device."
      });
      sendJson(res, 200, { ok: true, device: state.device, agent: state.agent });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/bridge/next") {
      state.device.lastSeenAt = now();
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
      const invocation = createInvocation(task);
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

function createInvocation(task) {
  const id = nextId("inv_demo");
  const createdAt = now();
  const trace = createTrace(id);
  const invocation = {
    id,
    ideaSessionId: null,
    agentId: state.agent.id,
    requestedBy: "usr_local",
    status: "queued",
    delivery: {
      deliveryId: nextId("del_demo"),
      deviceId: state.device.id,
      state: "queued",
      idempotencyKey: `idem_${id}`,
      leaseExpiresAt: null,
      dispatchAttempts: 0,
      lastDispatchAt: null,
      acknowledgedAt: null,
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
    message: "Demo invocation authorized for local demo agent."
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
    type: "delivery_queued",
    level: "info",
    message: "Invocation queued for Desktop Bridge."
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
  const terminalStatus = body.status === "cancelled" ? "cancelled" : body.status === "failed" ? "failed" : "succeeded";
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
          : "invocation_failed",
    level: terminalStatus === "succeeded" ? "info" : "warn",
    message: body.summary ?? `Invocation ${terminalStatus}.`,
    data: body.result ?? null
  });
  state.auditSummaries.push(createAuditSummary(invocation, body.summary ?? null));
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

function createTrace(invocationId) {
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
      agentId: state.agent.id,
      transport: "polling-demo-websocket-baseline",
      queue: "server-owned"
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

function publicState() {
  return {
    namespace,
    protocolVersion,
    device: state.device,
    agent: state.agent,
    invocations: state.invocations,
    events: state.events,
    traces: state.traces,
    spans: state.spans,
    auditSummaries: state.auditSummaries
  };
}

function runProtocolSelfCheck() {
  resetDemoStateForCheck();
  const invocation = createInvocation("self-check invocation");
  assert(invocation.status === "queued", "created invocation should be queued");
  assert(invocation.delivery.state === "queued", "created delivery should be queued");
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
}

function resetDemoStateForCheck() {
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
