import { spawn } from "node:child_process";
import http from "node:http";

const serverPort = 3211;
const httpAgentPort = 3212;
const serverUrl = `http://127.0.0.1:${serverPort}`;
const httpAgentUrl = `http://127.0.0.1:${httpAgentPort}`;
const children = [];
let httpAgentServer = null;

try {
  httpAgentServer = await startHttpAgent();
  start("server", process.execPath, ["apps/server/src/index.mjs"], {
    SERVER_PORT: String(serverPort)
  });

  await waitFor(async () => {
    const health = await request("GET", "/health");
    return health.status === "ok";
  }, "server health");

  const offlineCreated = await request("POST", "/api/invocations", {
    task: "Run the M0 offline queue smoke test."
  });
  const offlineInvocationId = offlineCreated.invocation.id;
  const queuedState = await request("GET", "/api/state");
  const queuedInvocation = queuedState.invocations.find((item) => item.id === offlineInvocationId);
  assert(queuedInvocation?.status === "queued", "offline invocation should be queued before bridge registration");
  assert(queuedInvocation?.delivery.state === "queued", "offline delivery should be queued before bridge registration");

  start("desktop", process.execPath, ["apps/desktop/src/index.mjs"], {
    BRIDGE_SERVER_URL: serverUrl,
    BRIDGE_POLL_INTERVAL_MS: "100"
  });

  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.device.status === "online" && state.agent.status === "available" && state.agents.length >= 1;
  }, "desktop bridge registration");

  const discoveryCreated = await request("POST", "/api/discovery", {
    scope: [
      "known_command_allowlist",
      "known_local_endpoint",
      "user_provided_path",
      "user_provided_endpoint",
      "bridge_managed_config"
    ],
    userProvidedPaths: ["demo-agent"],
    userProvidedEndpoints: [httpAgentUrl]
  });
  const discoveryRunId = discoveryCreated.discoveryRun.id;
  const discoveryState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const run = state.discoveryRuns.find((item) => item.id === discoveryRunId);
    return run?.status === "succeeded" ? state : false;
  }, "conservative agent discovery");
  const discoveryRun = discoveryState.discoveryRuns.find((item) => item.id === discoveryRunId);
  assert(discoveryRun.candidates.length >= 2, "discovery should return conservative candidates");
  assert(discoveryRun.candidates.some((item) => item.source === "known_command_allowlist"), "discovery should include known command allowlist candidate");
  assert(discoveryRun.candidates.some((item) => item.source === "user_provided_endpoint"), "discovery should include user-provided endpoint candidate");
  assert(discoveryRun.candidates.every((item) => item.registration.status === "candidate"), "discovery candidates should not auto-register");
  assert(!discoveryState.agents.some((agent) => agent.discovery?.runId === discoveryRunId), "discovery should not auto-register agents");

  const candidateToRegister = discoveryRun.candidates.find((item) => item.source === "known_command_allowlist") ?? discoveryRun.candidates[0];
  const registeredDiscovered = await request("POST", `/api/discovery/${discoveryRunId}/candidates/${candidateToRegister.id}/register`);
  assert(registeredDiscovered.agent.status === "disabled", "registered discovery candidate should stay disabled");
  assert(registeredDiscovered.candidate.registration.status === "registered", "registered discovery candidate should update candidate status");

  const registeredCli = await request("POST", "/api/agents", {
    id: "agt_smoke_cli",
    type: "cli",
    name: "Smoke CLI Agent",
    command: "demo-agent",
    args: ["{{payloadJson}}"],
    timeoutSeconds: 30
  });
  assert(registeredCli.agent.adapter.command === "demo-agent", "registered CLI agent should keep command");
  assert(registeredCli.agent.adapter.args[0] === "{{payloadJson}}", "registered CLI agent should keep structured argv");

  const registeredHttp = await request("POST", "/api/agents", {
    id: "agt_smoke_http",
    type: "http",
    name: "Smoke HTTP Agent",
    baseUrl: httpAgentUrl,
    requestPath: "/invoke",
    healthPath: "/health",
    timeoutSeconds: 5,
    cancellation: "supported"
  });
  assert(registeredHttp.agent.adapter.baseUrl === httpAgentUrl, "registered HTTP agent should keep baseUrl");

  await request("POST", "/api/agents/agt_smoke_cli/health-check");
  const cliHealthState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const agent = state.agents.find((item) => item.id === "agt_smoke_cli");
    return agent?.health?.status === "healthy" ? state : false;
  }, "healthy CLI agent check");
  assert(cliHealthState.lifecycleAuditRecords.some((item) => item.agentId === "agt_smoke_cli" && item.operation === "health_check" && item.status === "succeeded"), "CLI health check should record lifecycle audit");

  await request("POST", "/api/agents/agt_smoke_http/health-check");
  const httpHealthState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const agent = state.agents.find((item) => item.id === "agt_smoke_http");
    return agent?.health?.status === "healthy" ? state : false;
  }, "healthy HTTP agent check");
  assert(httpHealthState.lifecycleAuditRecords.some((item) => item.agentId === "agt_smoke_http" && item.operation === "health_check" && item.status === "succeeded"), "HTTP health check should record lifecycle audit");

  const disabled = await request("POST", "/api/agents/agt_smoke_cli/disable");
  assert(disabled.agent.status === "disabled", "disabled agent should report disabled");
  assert(disabled.operation.status === "succeeded", "disable operation should succeed");

  const disabledRun = await requestAllowError("POST", "/api/invocations", {
    task: "This should not run while disabled.",
    agentId: "agt_smoke_cli"
  });
  assert(disabledRun.status === 409 && disabledRun.data.error === "agent_disabled", "disabled agent should block new invocations");

  const enabled = await request("POST", "/api/agents/agt_smoke_cli/enable");
  assert(enabled.agent.status === "available", "enabled online CLI agent should become available");
  assert(enabled.operation.status === "succeeded", "enable operation should succeed");

  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === offlineInvocationId);
    if (invocation?.status === "succeeded") {
      return state;
    }
    if (["failed", "cancelled", "timed_out", "expired"].includes(invocation?.status)) {
      throw new Error(`Offline invocation ended unexpectedly: ${invocation.status}`);
    }
    return false;
  }, "offline queued invocation dispatch after reconnect");

  const created = await request("POST", "/api/invocations", {
    task: "Run the M0 local smoke test.",
    agentId: "agt_smoke_cli"
  });
  const invocationId = created.invocation.id;

  const finalState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === invocationId);
    if (invocation?.status === "succeeded") {
      return state;
    }
    if (["failed", "cancelled", "timed_out", "expired"].includes(invocation?.status)) {
      throw new Error(`Invocation ended unexpectedly: ${invocation.status}`);
    }
    return false;
  }, "successful invocation");

  const invocation = finalState.invocations.find((item) => item.id === invocationId);
  const audit = finalState.auditSummaries.find((item) => item.invocationId === invocationId);
  const logEvents = finalState.events.filter((item) => item.invocationId === invocationId && item.type === "log");
  const trace = finalState.traces.find((item) => item.id === invocation.traceId);
  const span = finalState.spans.find((item) => item.id === invocation.rootSpanId);

  assert(invocation.result?.touchedUserFiles === false, "demo agent must not touch user files");
  assert(invocation.delivery.state === "acknowledged", "expected acknowledged delivery");
  assert(invocation.delivery.dispatchAttempts >= 1, "expected dispatch attempts");
  assert(logEvents.length >= 5, "expected progress log events");
  assert(audit?.permissionDecision === "allowed", "expected allowed audit summary");
  assert(audit?.traceId === invocation.traceId, "expected audit summary to reference trace");
  assert(trace?.subjectId === invocationId, "expected invocation trace");
  assert(span?.status === "succeeded", "expected completed root span");
  assert(audit?.costSummary?.includes("unknown"), "expected unknown cost summary");

  const httpCreated = await request("POST", "/api/invocations", {
    task: "Run the M0 HTTP smoke test.",
    agentId: "agt_smoke_http"
  });
  const httpInvocationId = httpCreated.invocation.id;
  const httpFinalState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === httpInvocationId);
    if (invocation?.status === "succeeded") {
      return state;
    }
    if (["failed", "cancelled", "timed_out", "expired"].includes(invocation?.status)) {
      throw new Error(`HTTP invocation ended unexpectedly: ${invocation.status}`);
    }
    return false;
  }, "successful HTTP invocation");
  const httpInvocation = httpFinalState.invocations.find((item) => item.id === httpInvocationId);
  assert(httpInvocation.delivery.state === "not_required", "HTTP agent should not require bridge delivery");
  assert(httpInvocation.result?.summary?.includes("HTTP Agent completed"), "HTTP agent should return result summary");

  const httpFailureCreated = await request("POST", "/api/invocations", {
    task: "fail-http",
    agentId: "agt_smoke_http"
  });
  const httpFailureInvocationId = httpFailureCreated.invocation.id;
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === httpFailureInvocationId);
    return invocation?.status === "failed" ? state : false;
  }, "failed HTTP invocation");

  const cancelCreated = await request("POST", "/api/invocations", {
    task: "Run the M0 cancellation smoke test.",
    agentId: "agt_smoke_cli"
  });
  const cancelInvocationId = cancelCreated.invocation.id;
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === cancelInvocationId);
    return invocation?.status === "running";
  }, "running invocation before cancellation");
  await request("POST", `/api/invocations/${cancelInvocationId}/cancel`);
  const cancelledState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === cancelInvocationId);
    if (invocation?.status === "cancelled") {
      return state;
    }
    if (["failed", "succeeded", "timed_out", "expired"].includes(invocation?.status)) {
      throw new Error(`Cancellation invocation ended unexpectedly: ${invocation.status}`);
    }
    return false;
  }, "running CLI cancellation");
  const cancelledInvocation = cancelledState.invocations.find((item) => item.id === cancelInvocationId);
  const cancelEvents = cancelledState.events.filter((item) => item.invocationId === cancelInvocationId);
  assert(cancelledInvocation.cancellation.state === "applied", "running cancellation should be applied");
  assert(cancelEvents.some((item) => item.type === "cancel_dispatched"), "running cancellation should dispatch to bridge");
  assert(cancelEvents.some((item) => item.type === "cancel_applied"), "running cancellation should be visible as applied");

  console.log("[smoke] M0 local invocation loop OK");
  console.log(`[smoke] offlineInvocation=${offlineInvocationId} cliInvocation=${invocationId} httpInvocation=${httpInvocationId} cancelledInvocation=${cancelInvocationId} logs=${logEvents.length} status=${invocation.status}`);
} finally {
  stopChildren();
  if (httpAgentServer) {
    await new Promise((resolve) => httpAgentServer.close(resolve));
  }
}

function startHttpAgent() {
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", message: "Smoke HTTP Agent healthy." }));
      return;
    }

    if (req.method !== "POST" || req.url !== "/invoke") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const body = await readRequestJson(req);
    if (body.task === "fail-http") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ summary: "HTTP Agent failed by request." }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      summary: `HTTP Agent completed: ${body.task}`,
      touchedUserFiles: false,
      cost: { model: "unknown", billable: false }
    }));
  });

  return new Promise((resolve) => {
    server.listen(httpAgentPort, "127.0.0.1", () => resolve(server));
  });
}

function start(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);
  child.stdout.on("data", (chunk) => prefix(name, chunk));
  child.stderr.on("data", (chunk) => prefix(name, chunk));
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
  });
}

async function waitFor(check, label) {
  let lastError = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const result = await check();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError?.message ?? "no result"}`);
}

async function request(method, path, body) {
  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.status === 204) {
    return null;
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${JSON.stringify(data)}`);
  }
  return data;
}

async function requestAllowError(method, path, body) {
  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data };
}

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function prefix(name, chunk) {
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    if (line.trim()) {
      console.log(`[${name}] ${line}`);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopChildren() {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}
