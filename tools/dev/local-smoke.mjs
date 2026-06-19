import { spawn } from "node:child_process";

const serverPort = 3211;
const serverUrl = `http://127.0.0.1:${serverPort}`;
const children = [];

try {
  start("server", process.execPath, ["apps/server/src/index.mjs"], {
    SERVER_PORT: String(serverPort)
  });
  start("desktop", process.execPath, ["apps/desktop/src/index.mjs"], {
    BRIDGE_SERVER_URL: serverUrl,
    BRIDGE_POLL_INTERVAL_MS: "100"
  });

  await waitFor(async () => {
    const health = await request("GET", "/health");
    return health.status === "ok";
  }, "server health");

  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.device.status === "online" && state.agent.status === "available";
  }, "desktop bridge registration");

  const created = await request("POST", "/api/invocations", {
    task: "Run the M0 local smoke test."
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

  assert(invocation.result?.touchedUserFiles === false, "demo agent must not touch user files");
  assert(logEvents.length >= 5, "expected progress log events");
  assert(audit?.permissionDecision === "allowed", "expected allowed audit summary");
  assert(audit?.costSummary?.includes("unknown"), "expected unknown cost summary");

  console.log("[smoke] M0 local invocation loop OK");
  console.log(`[smoke] invocation=${invocationId} logs=${logEvents.length} status=${invocation.status}`);
} finally {
  stopChildren();
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
