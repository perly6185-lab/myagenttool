import { spawn } from "node:child_process";
import http from "node:http";

const serverPort = 3221;
const webPort = 3220;
const httpAgentPort = 3222;
const serverUrl = `http://127.0.0.1:${serverPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const httpAgentUrl = `http://127.0.0.1:${httpAgentPort}`;
const children = [];
let httpAgentServer = null;

try {
  httpAgentServer = await startHttpAgent();

  start("server", process.execPath, ["apps/server/src/index.mjs"], {
    SERVER_PORT: String(serverPort),
  });
  start("web", process.execPath, ["apps/web/src/index.mjs"], {
    WEB_PORT: String(webPort),
  });

  await waitFor(async () => {
    const health = await request("GET", "/health");
    return health.status === "ok";
  }, "server health");

  // The console is a built single-page app: product affordances live in the JS
  // bundle the shell loads, not the initial HTML. Fetch shell + linked assets
  // (the web server may build dist on first start), then assert the M0
  // affordances survived the React migration.
  const consoleSource = await waitFor(async () => {
    const source = await fetchConsoleSource(webUrl);
    return source.includes("What should your computer do?") ? source : false;
  }, "web console bundle");
  assert(consoleSource.includes("Run on this computer"), "web console should offer a plain-language run action");
  assert(
    ["Safety", "Data", "Cost", "Cancellation"].every((label) => consoleSource.includes(label)),
    "web console should show pre-run review categories",
  );
  assert(consoleSource.includes("Technical details"), "web console should hide advanced details behind disclosure");

  const offlineCreated = await request("POST", "/api/invocations", {
    task: "Run the M0 acceptance offline queue test.",
  });
  const offlineInvocationId = offlineCreated.invocation.id;
  const queuedState = await request("GET", "/api/state");
  assert(queuedState.device.status === "offline", "device should be offline before bridge registration");
  assert(queuedState.invocations.find((item) => item.id === offlineInvocationId)?.delivery.state === "queued", "offline invocation should queue");

  start("desktop", process.execPath, ["apps/desktop/src/index.mjs"], {
    BRIDGE_SERVER_URL: serverUrl,
    BRIDGE_POLL_INTERVAL_MS: "100",
  });

  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.device.status === "online" && state.agent.status === "available";
  }, "desktop bridge link");

  const cliAgent = await request("POST", "/api/agents", {
    id: "agt_acceptance_cli",
    type: "cli",
    name: "Acceptance CLI Agent",
    command: "demo-agent",
    args: ["{{payloadJson}}"],
    timeoutSeconds: 30,
  });
  assert(cliAgent.agent.economics.model === "unknown", "CLI agent economics should default to unknown");
  assert(cliAgent.agent.registrationNotes.cost.includes("unknown"), "unknown cost should be visible before invocation");

  const httpAgent = await request("POST", "/api/agents", {
    id: "agt_acceptance_http",
    type: "http",
    name: "Acceptance HTTP Agent",
    baseUrl: httpAgentUrl,
    requestPath: "/invoke",
    timeoutSeconds: 5,
    cancellation: "supported",
  });
  assert(httpAgent.agent.adapter.type === "http", "HTTP agent should register");

  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === offlineInvocationId);
    return invocation?.status === "succeeded" ? state : false;
  }, "offline dispatch after reconnect");

  const cliRun = await request("POST", "/api/invocations", {
    task: "Run the M0 acceptance CLI task.",
    agentId: cliAgent.agent.id,
  });
  const cliInvocationId = cliRun.invocation.id;
  const cliState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === cliInvocationId);
    return invocation?.status === "succeeded" ? state : false;
  }, "CLI invocation success");
  assertTraceAuditAndLogs(cliState, cliInvocationId, "CLI invocation");

  const httpRun = await request("POST", "/api/invocations", {
    task: "Run the M0 acceptance HTTP task.",
    agentId: httpAgent.agent.id,
  });
  const httpInvocationId = httpRun.invocation.id;
  const httpState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === httpInvocationId);
    return invocation?.status === "succeeded" ? state : false;
  }, "HTTP invocation success");
  assertTraceAuditAndLogs(httpState, httpInvocationId, "HTTP invocation", { requireLogs: false });

  const cancelRun = await request("POST", "/api/invocations", {
    task: "Run the M0 acceptance cancellation task.",
    agentId: cliAgent.agent.id,
  });
  const cancelInvocationId = cancelRun.invocation.id;
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === cancelInvocationId);
    return invocation?.status === "running";
  }, "running invocation before cancellation");
  await request("POST", `/api/invocations/${cancelInvocationId}/cancel`);
  const cancelState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === cancelInvocationId);
    return invocation?.status === "cancelled" ? state : false;
  }, "visible running cancellation");
  const cancelled = cancelState.invocations.find((item) => item.id === cancelInvocationId);
  assert(cancelled.cancellation.state === "applied", "cancellation should be applied");
  assert(cancelState.auditSummaries.some((item) => item.invocationId === cancelInvocationId), "cancellation should be audited");

  await stopChildByName("desktop");
  const unlinkQueued = await request("POST", "/api/invocations", {
    task: "Run the M0 acceptance unlink queued task.",
    agentId: cliAgent.agent.id,
  });
  const unlinkInvocationId = unlinkQueued.invocation.id;
  await request("POST", "/api/device/unlink");
  const unlinkState = await request("GET", "/api/state");
  const unlinkInvocation = unlinkState.invocations.find((item) => item.id === unlinkInvocationId);
  assert(unlinkState.device.unlinkState === "unlinked", "device unlink should be visible");
  assert(Boolean(unlinkState.device.credentialRevokedAt), "device unlink should revoke credentials");
  assert(unlinkInvocation.status === "cancelled", "device unlink should cancel queued local work");
  assert(unlinkState.auditSummaries.some((item) => item.invocationId === unlinkInvocationId), "device unlink cleanup should be audited");

  console.log("[acceptance] M0 manual acceptance evidence OK");
  console.log(`[acceptance] web=${webUrl} offline=${offlineInvocationId} cli=${cliInvocationId} http=${httpInvocationId} cancelled=${cancelInvocationId} unlinked=${unlinkInvocationId}`);
} finally {
  stopChildren();
  if (httpAgentServer) {
    await new Promise((resolve) => httpAgentServer.close(resolve));
  }
}

function assertTraceAuditAndLogs(state, invocationId, label, options = {}) {
  const invocation = state.invocations.find((item) => item.id === invocationId);
  const audit = state.auditSummaries.find((item) => item.invocationId === invocationId);
  const trace = state.traces.find((item) => item.id === invocation.traceId);
  const span = state.spans.find((item) => item.id === invocation.rootSpanId);
  const logs = state.events.filter((item) => item.invocationId === invocationId && item.type === "log");

  assert(invocation.result?.touchedUserFiles === false, `${label} should report no user-file touch`);
  assert(audit?.permissionDecision === "allowed", `${label} should have allowed audit`);
  assert(audit?.traceId === invocation.traceId, `${label} audit should reference trace`);
  assert(trace?.subjectId === invocationId, `${label} should have trace`);
  assert(span?.status === "succeeded", `${label} root span should succeed`);
  assert(audit?.costSummary?.includes("unknown"), `${label} should expose unknown cost`);
  if (options.requireLogs !== false) {
    assert(logs.length >= 5, `${label} should stream logs`);
  }
}

function start(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push({ name, child });
  child.stdout.on("data", (chunk) => prefix(name, chunk));
  child.stderr.on("data", (chunk) => prefix(name, chunk));
}

async function stopChildByName(name) {
  const entry = children.find((item) => item.name === name && !item.child.killed);
  if (!entry) {
    return;
  }
  entry.child.kill("SIGTERM");
  await sleep(500);
}

async function waitFor(check, label) {
  let lastError = null;
  for (let attempt = 0; attempt < 160; attempt += 1) {
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
    body: body ? JSON.stringify(body) : undefined,
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

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status}`);
  }
  return response.text();
}

// Fetch the SPA shell plus the JS/CSS assets it references, so assertions can
// inspect the bundled product strings instead of the near-empty index.html.
async function fetchConsoleSource(baseUrl) {
  const html = await fetchText(baseUrl);
  const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1]);
  const assets = await Promise.all(
    assetPaths.map((path) => fetchText(new URL(path, baseUrl).toString()).catch(() => "")),
  );
  return html + assets.join("");
}

function startHttpAgent() {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/invoke") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const body = await readRequestJson(req);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      summary: `Acceptance HTTP Agent completed: ${body.task}`,
      touchedUserFiles: false,
      cost: { model: "unknown", billable: false },
    }));
  });

  return new Promise((resolve) => {
    server.listen(httpAgentPort, "127.0.0.1", () => resolve(server));
  });
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
  for (const { child } of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}
