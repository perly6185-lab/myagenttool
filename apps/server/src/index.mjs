import http from "node:http";

const namespace = "com.myagenttool";
const protocolVersion = "0.0.0";
const host = process.env.SERVER_HOST ?? "127.0.0.1";
const port = Number(process.env.SERVER_PORT ?? 3001);

if (process.argv.includes("--check")) {
  console.log("[server:check] local demo server check OK");
  process.exit(0);
}

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
  auditSummaries: []
};

let idCounter = 1;

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
      const invocation = state.invocations.find(
        (item) => item.status === "queued" && item.delivery.state === "queued"
      );

      if (!invocation) {
        sendJson(res, 204, null);
        return;
      }

      invocation.status = "dispatching";
      invocation.delivery.state = "dispatching";
      invocation.delivery.dispatchAttempts += 1;
      invocation.delivery.lastDispatchAt = now();
      invocation.updatedAt = now();
      appendEvent({
        invocationId: invocation.id,
        type: "delivery_dispatched",
        level: "info",
        message: "Invocation dispatched to Desktop Bridge."
      });

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

      invocation.delivery.state = "acknowledged";
      invocation.delivery.acknowledgedAt = now();
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

      const terminalStatus = body.status === "cancelled" ? "cancelled" : body.status === "failed" ? "failed" : "succeeded";
      invocation.status = terminalStatus;
      invocation.result = body.result ?? null;
      invocation.completedAt = now();
      invocation.updatedAt = now();
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
        type: "delivery_queued",
        level: "info",
        message: "Invocation queued for Desktop Bridge."
      });
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
  return {
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
    createdAt,
    updatedAt: createdAt
  };
}

function cancelInvocation(invocation) {
  if (["succeeded", "failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation.status)) {
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
    traceId: null,
    startedAt: invocation.createdAt,
    completedAt: invocation.completedAt ?? now(),
    resultSummary: invocation.status === "succeeded" ? summary : null,
    errorSummary: invocation.status === "succeeded" ? null : summary,
    dataStored: true,
    costSummary: "Demo agent cost is unknown; no billing was performed.",
    metadata: { namespace, protocolVersion }
  };
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
    auditSummaries: state.auditSummaries
  };
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
