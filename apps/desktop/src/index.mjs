import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverUrl = process.env.BRIDGE_SERVER_URL ?? "http://127.0.0.1:3001";
const pollIntervalMs = Number(process.env.BRIDGE_POLL_INTERVAL_MS ?? 700);
const demoAgentPath = resolve(__dirname, "demo-agent.mjs");

if (process.argv.includes("--check")) {
  console.log("[desktop:check] local demo bridge check OK");
  process.exit(0);
}

let busy = false;
let stopped = false;

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await waitForServer();
await request("POST", "/api/bridge/register", {
  bridgeVersion: "0.0.0",
  capabilities: ["demo_cli_agent"]
});
console.log(`[desktop] registered with ${serverUrl}`);

poll();
const timer = setInterval(poll, pollIntervalMs);

async function poll() {
  if (busy || stopped) {
    return;
  }

  const response = await request("GET", "/api/bridge/next");
  if (response) {
    busy = true;
    try {
      await runInvocation(response);
    } finally {
      busy = false;
    }
    return;
  }

  const healthWork = await request("GET", "/api/bridge/health-next");
  if (healthWork) {
    busy = true;
    try {
      await runHealthCheck(healthWork);
    } finally {
      busy = false;
    }
    return;
  }

  const discoveryWork = await request("GET", "/api/bridge/discovery-next");
  if (discoveryWork) {
    busy = true;
    try {
      await runDiscovery(discoveryWork);
    } finally {
      busy = false;
    }
  }
}

async function runInvocation(work) {
  const invocationId = work.invocationId;
  const task = String(work.input?.task ?? "");
  const adapter = work.adapter;
  console.log(`[desktop] running ${invocationId}: ${task}`);

  await request("POST", "/api/bridge/ack", { invocationId });

  let finalResult = null;
  let cancelled = false;
  let stdoutBuffer = "";
  let cancelResult = null;
  let timedOut = false;

  if (!adapter || adapter.type !== "cli") {
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: "failed",
      summary: `Desktop Bridge cannot execute adapter type ${adapter?.type ?? "unknown"}.`,
      result: null
    });
    return;
  }

  const spawnPlan = createCliSpawnPlan(adapter, { invocationId, task });
  const child = spawn(spawnPlan.command, spawnPlan.args, {
    cwd: spawnPlan.cwd,
    env: spawnPlan.env,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const timeoutMs = Number(adapter.timeoutSeconds ?? work.options?.timeoutSeconds ?? 30) * 1000;
  const timeoutTimer = setTimeout(async () => {
    if (child.exitCode !== null || child.killed || cancelled) {
      return;
    }
    timedOut = true;
    await request("POST", "/api/bridge/events", {
      invocationId,
      type: "invocation_timed_out",
      level: "warn",
      message: "CLI Agent exceeded its configured timeout."
    });
    cancelResult = await terminateProcessTree(child);
  }, timeoutMs);

  const cancelTimer = setInterval(async () => {
    const status = await request("GET", `/api/bridge/cancel-status?invocationId=${encodeURIComponent(invocationId)}`);
    if (status?.cancelRequested && !cancelled) {
      cancelled = true;
      await request("POST", "/api/bridge/events", {
        invocationId,
        type: "cancel_dispatched",
        level: "info",
        message: "Desktop Bridge sent cancellation to Demo CLI Agent."
      });
      cancelResult = await terminateProcessTree(child);
      if (!cancelResult.ok) {
        await request("POST", "/api/bridge/events", {
          invocationId,
          type: "cancel_failed",
          level: "warn",
          message: cancelResult.message
        });
      }
    }
  }, 250);

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      handleAgentLine(invocationId, line).then((result) => {
        if (result) {
          finalResult = result;
        }
      });
    }
  });

  child.stderr.on("data", (chunk) => {
    request("POST", "/api/bridge/events", {
      invocationId,
      type: "log",
      level: "warn",
      message: chunk.toString("utf8").trim()
    });
  });

  const exitCode = await new Promise((resolveExit) => {
    child.on("close", resolveExit);
  });
  clearInterval(cancelTimer);
  clearTimeout(timeoutTimer);

  if (stdoutBuffer.trim()) {
    const result = await handleAgentLine(invocationId, stdoutBuffer.trim());
    if (result) {
      finalResult = result;
    }
  }

  if (timedOut) {
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: "timed_out",
      summary: "CLI Agent exceeded its configured timeout.",
      result: finalResult
    });
    return;
  }

  if (cancelled) {
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: cancelResult?.ok === false ? "failed" : "cancelled",
      summary: cancelResult?.ok === false ? cancelResult.message : "CLI Agent was cancelled locally.",
      result: finalResult
    });
    return;
  }

  if (exitCode === 0) {
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: "succeeded",
      summary: finalResult?.summary ?? "Demo CLI Agent completed.",
      result: finalResult
    });
    return;
  }

  await request("POST", "/api/bridge/complete", {
    invocationId,
    status: "failed",
    summary: `Demo CLI Agent exited with code ${exitCode}.`,
    result: finalResult
  });
}

async function runHealthCheck(work) {
  const adapter = work.adapter;
  if (!adapter || adapter.type !== "cli") {
    await request("POST", "/api/bridge/health-complete", {
      checkId: work.checkId,
      agentId: work.agentId,
      status: "unhealthy",
      message: `Desktop Bridge cannot health-check adapter type ${adapter?.type ?? "unknown"}.`,
      nextAction: "Use a CLI demo agent for bridge health checks."
    });
    return;
  }

  const result = checkCliAgentHealth(adapter);
  await request("POST", "/api/bridge/health-complete", {
    checkId: work.checkId,
    agentId: work.agentId,
    status: result.ok ? "healthy" : "unhealthy",
    message: result.message,
    nextAction: result.ok ? null : result.nextAction
  });
}

function checkCliAgentHealth(adapter) {
  if (adapter.command === "demo-agent") {
    return {
      ok: true,
      message: "Demo CLI Agent is reachable through Desktop Bridge.",
      nextAction: null
    };
  }
  if (!adapter.command || typeof adapter.command !== "string") {
    return {
      ok: false,
      message: "CLI agent command is missing.",
      nextAction: "Register the agent with a command, then retry the health check."
    };
  }
  return {
    ok: true,
    message: `Desktop Bridge can attempt CLI command: ${adapter.command}.`,
    nextAction: null
  };
}

async function runDiscovery(work) {
  const candidates = [];
  const scope = Array.isArray(work.scope) ? work.scope : [];

  if (scope.includes("known_command_allowlist") && Array.isArray(work.knownCommands) && work.knownCommands.includes("demo-agent")) {
    candidates.push(cliCandidate({
      id: "cand_demo_cli",
      name: "Demo CLI Agent",
      command: "demo-agent",
      source: "known_command_allowlist",
      confidence: "high",
      riskLevel: "low",
      riskTags: ["read_only"],
      riskHints: [
        "Found from the built-in known command allowlist.",
        "Discovery did not scan the full operating system.",
        "Review the command before enabling."
      ]
    }));
  }

  if (scope.includes("user_provided_path")) {
    for (const path of normalizeStringArray(work.userProvidedPaths)) {
      candidates.push(cliCandidate({
        id: `cand_user_cli_${safeId(path)}`,
        name: `User-provided CLI: ${path}`,
        command: path,
        source: "user_provided_path",
        confidence: path === "demo-agent" ? "high" : "medium",
        riskLevel: "medium",
        riskTags: ["read_local", "shell_exec"],
        riskHints: [
          "Found from a user-provided command path.",
          "No broad filesystem scan was performed.",
          "Review shell execution risk before enabling."
        ]
      }));
    }
  }

  if (scope.includes("known_local_endpoint")) {
    for (const endpoint of Array.isArray(work.knownLocalEndpoints) ? work.knownLocalEndpoints : []) {
      candidates.push(httpCandidate({
        id: `cand_known_http_${safeId(endpoint.baseUrl)}`,
        name: endpoint.name ?? "Known Local HTTP Agent",
        baseUrl: endpoint.baseUrl,
        requestPath: endpoint.requestPath ?? "/invoke",
        healthPath: endpoint.healthPath ?? "/health",
        source: "known_local_endpoint",
        confidence: "medium"
      }));
    }
  }

  if (scope.includes("user_provided_endpoint")) {
    for (const endpoint of normalizeStringArray(work.userProvidedEndpoints)) {
      candidates.push(httpCandidate({
        id: `cand_user_http_${safeId(endpoint)}`,
        name: `User-provided HTTP Agent: ${endpoint}`,
        baseUrl: endpoint,
        requestPath: "/invoke",
        healthPath: "/health",
        source: "user_provided_endpoint",
        confidence: "medium"
      }));
    }
  }

  if (scope.includes("bridge_managed_config")) {
    candidates.push(cliCandidate({
      id: "cand_bridge_managed_demo",
      name: "Bridge-managed Demo CLI Agent",
      command: "demo-agent",
      source: "bridge_managed_config",
      confidence: "high",
      riskLevel: "low",
      riskTags: ["read_only"],
      riskHints: [
        "Found from bridge-managed demo configuration.",
        "Discovery stayed inside bridge-managed config.",
        "Review before enabling."
      ]
    }));
  }

  await request("POST", "/api/bridge/discovery-complete", {
    discoveryRunId: work.discoveryRunId,
    status: "succeeded",
    message: `Desktop Bridge returned ${candidates.length} conservative discovery candidate(s).`,
    candidates: uniqueCandidates(candidates)
  });
}

function cliCandidate({ id, name, command, source, confidence, riskLevel, riskTags, riskHints }) {
  return {
    id,
    name,
    description: "Runs a local CLI command discovered conservatively.",
    adapter: {
      type: "cli",
      command,
      args: ["{{payloadJson}}"],
      timeoutSeconds: 30,
      cancellation: "supported"
    },
    source,
    confidence,
    riskLevel,
    riskTags,
    riskHints,
    healthProbeAvailable: true
  };
}

function httpCandidate({ id, name, baseUrl, requestPath, healthPath, source, confidence }) {
  return {
    id,
    name,
    description: "Calls a local HTTP endpoint discovered conservatively.",
    adapter: {
      type: "http",
      baseUrl,
      requestPath,
      healthPath,
      timeoutSeconds: 30,
      cancellation: "supported"
    },
    source,
    confidence,
    riskLevel: "medium",
    riskTags: ["network_access", "external_data_transfer"],
    riskHints: [
      "Found from a known or user-provided local endpoint.",
      "Discovery did not scan the network.",
      "Review data sent to this endpoint before enabling."
    ],
    healthProbeAvailable: true
  };
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.adapter.type}:${candidate.adapter.command ?? candidate.adapter.baseUrl}:${candidate.source}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function createCliSpawnPlan(adapter, payload) {
  const payloadJson = JSON.stringify(payload);
  const command = adapter.command === "demo-agent" ? process.execPath : String(adapter.command);
  const argsTemplate = Array.isArray(adapter.args) && adapter.args.length > 0 ? adapter.args : ["{{payloadJson}}"];
  const args = adapter.command === "demo-agent"
    ? [demoAgentPath, ...renderArgs(argsTemplate, payloadJson, payload)]
    : renderArgs(argsTemplate, payloadJson, payload);
  const env = buildEnv(adapter);
  const cwd = adapter.workingDirectoryPolicy === "explicit" && adapter.workingDirectory
    ? String(adapter.workingDirectory)
    : process.cwd();
  return { command, args, env, cwd };
}

function renderArgs(args, payloadJson, payload) {
  return args.map((arg) => String(arg).replaceAll("{{payloadJson}}", payloadJson).replaceAll("{{task}}", String(payload.task ?? "")));
}

function buildEnv(adapter) {
  if (adapter.environmentPolicy === "none") {
    return {};
  }
  if (adapter.environmentPolicy === "explicit_only") {
    return normalizeEnv(adapter.env);
  }
  return { ...process.env, ...normalizeEnv(adapter.env) };
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

function safeId(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 48) || "candidate";
}

async function terminateProcessTree(child) {
  if (!child.pid) {
    return { ok: false, message: "Cannot cancel CLI process because no process id was assigned." };
  }
  if (child.exitCode !== null || child.killed) {
    return { ok: true, message: "Process already exited." };
  }

  if (process.platform === "win32") {
    return new Promise((resolveResult) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stderr = "";
      killer.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      killer.on("close", (code) => {
        resolveResult({
          ok: code === 0,
          message: code === 0 ? "Windows process tree terminated." : `Windows process-tree cancellation failed: ${stderr.trim() || `taskkill exited ${code}`}`
        });
      });
    });
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    return {
      ok: false,
      message: `SIGTERM process-group cancellation failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  return { ok: true, message: "SIGTERM cancellation sent to CLI process." };
}

async function handleAgentLine(invocationId, line) {
  if (!line) {
    return null;
  }
  if (line.startsWith("RESULT ")) {
    return JSON.parse(line.slice("RESULT ".length));
  }
  await request("POST", "/api/bridge/events", {
    invocationId,
    type: "log",
    level: "info",
    message: line
  });
  return null;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const health = await request("GET", "/health");
      if (health?.status === "ok") {
        return;
      }
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Server did not become ready at ${serverUrl}`);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stop() {
  stopped = true;
  clearInterval(timer);
  process.exit(0);
}
