import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverUrl = process.env.BRIDGE_SERVER_URL ?? "http://127.0.0.1:3001";
const pollIntervalMs = Number(process.env.BRIDGE_POLL_INTERVAL_MS ?? 700);
const demoAgentPath = resolve(__dirname, "demo-agent.mjs");
const codexFixtureAgentPath = resolve(__dirname, "codex-fixture-agent.mjs");

if (process.argv.includes("--check")) {
  if (!existsSync(demoAgentPath) || !existsSync(codexFixtureAgentPath)) {
    throw new Error("Desktop agent fixtures are not configured.");
  }
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
    return;
  }

  const probeWork = await request("GET", "/api/bridge/probe-next");
  if (probeWork) {
    busy = true;
    try {
      await runIntegrationProbe(probeWork);
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
  let stderrBuffer = "";
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
    await reportForcedKill(invocationId, cancelResult, "Timeout");
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
      await reportForcedKill(invocationId, cancelResult, "Cancellation");
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
      handleAgentLine(invocationId, line, adapter).then((result) => {
        if (result) {
          finalResult = result;
        }
      });
    }
  });

  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString("utf8");
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        request("POST", "/api/bridge/events", {
          invocationId,
          type: adapter.outputFormat === "codex_jsonl" ? "agent_output" : "log",
          level: "warn",
          message: line.trim()
        });
      }
    }
  });

  const exitCode = await new Promise((resolveExit) => {
    child.on("close", resolveExit);
  });
  clearInterval(cancelTimer);
  clearTimeout(timeoutTimer);

  if (stdoutBuffer.trim()) {
    const result = await handleAgentLine(invocationId, stdoutBuffer.trim(), adapter);
    if (result) {
      finalResult = result;
    }
  }
  if (stderrBuffer.trim()) {
    await request("POST", "/api/bridge/events", {
      invocationId,
      type: adapter.outputFormat === "codex_jsonl" ? "agent_output" : "log",
      level: "warn",
      message: stderrBuffer.trim()
    });
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
  if (isCodexCliCommand(adapter.command)) {
    const probe = probeCodexCli(adapter);
    return {
      ok: probe.ok,
      message: probe.ok ? "Codex CLI non-interactive surface is reachable." : probe.summary,
      nextAction: probe.ok ? null : "Verify Codex CLI installation and authentication."
    };
  }
  if (isClaudeCliCommand(adapter.command)) {
    const probe = probeClaudeCli(adapter);
    return {
      ok: probe.ok,
      message: probe.ok ? "Claude Code CLI non-interactive surface is reachable." : probe.summary,
      nextAction: probe.ok ? null : "Verify Claude Code CLI installation and authentication."
    };
  }
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
      const codexCommand = isCodexCliCommand(path);
      candidates.push(cliCandidate({
        id: `cand_user_cli_${safeId(path)}`,
        name: codexCommand ? "Codex CLI" : `User-provided CLI: ${path}`,
        command: path,
        source: "user_provided_path",
        confidence: path === "demo-agent" ? "high" : "medium",
        riskLevel: highRiskCliCommand(path) ? "high" : "medium",
        riskTags: codexCommand ? codexRiskTags() : highRiskCliCommand(path) ? ["read_local", "write_local", "shell_exec", "network_access"] : ["read_local", "shell_exec"],
        riskHints: [
          "Found from a user-provided command path.",
          "No broad filesystem scan was performed.",
          codexCommand
            ? "Codex CLI is configured for codex exec, JSONL output, and read-only sandbox by default."
            : highRiskCliCommand(path)
            ? "High-risk coding CLI commands still require local approval before invocation."
            : "Review shell execution risk before enabling.",
          codexCommand ? "Local approval is required before invoking this coding agent." : "Generated integrations stay disabled until explicit registration."
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

async function runIntegrationProbe(work) {
  const adapter = work.adapter;
  if (!adapter || adapter.type !== "cli") {
    await request("POST", "/api/bridge/probe-complete", {
      probeRunId: work.probeRunId,
      status: "failed",
      summary: `Desktop Bridge cannot probe adapter type ${adapter?.type ?? "unknown"}.`,
      details: ["Use HTTP server-side probe or CLI adapter config."]
    });
    return;
  }

  if (isCodexCliCommand(adapter.command)) {
    const probe = probeCodexCli(adapter);
    await request("POST", "/api/bridge/probe-complete", {
      probeRunId: work.probeRunId,
      status: probe.ok ? "succeeded" : "failed",
      summary: probe.summary,
      details: probe.details
    });
    return;
  }

  const health = checkCliAgentHealth(adapter);
  const highRisk = highRiskCliCommand(adapter.command);
  await request("POST", "/api/bridge/probe-complete", {
    probeRunId: work.probeRunId,
    status: health.ok ? "succeeded" : "failed",
    summary: health.ok ? `Restricted CLI probe passed for ${adapter.command}.` : health.message,
    details: [
      "No install scripts were run.",
      "No broad filesystem scan was performed.",
      highRisk
        ? "Command is high risk and remains subject to local approval before invocation."
        : "Command can be reviewed and registered explicitly.",
      health.nextAction ?? "Probe complete."
    ]
  });
}

function cliCandidate({ id, name, command, source, confidence, riskLevel, riskTags, riskHints }) {
  const codexCommand = isCodexCliCommand(command);
  return {
    id,
    name,
    description: codexCommand ? "Runs Codex CLI non-interactively through a reviewed local adapter config." : "Runs a local CLI command discovered conservatively.",
    adapter: {
      type: "cli",
      command,
      args: codexCommand ? codexCliArgs() : ["{{payloadJson}}"],
      timeoutSeconds: codexCommand ? 120 : 30,
      cancellation: "supported",
      outputFormat: codexCommand ? "codex_jsonl" : "plain_result",
      sandbox: codexCommand ? "read-only" : null
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
  const codexCommandOverride = isCodexCliCommand(adapter.command) ? process.env.MYAGENTTOOL_CODEX_COMMAND : null;
  const command = adapter.command === "demo-agent" || codexCommandOverride === "fixture"
    ? process.execPath
    : codexCommandOverride || String(adapter.command);
  const argsTemplate = Array.isArray(adapter.args) && adapter.args.length > 0 ? adapter.args : ["{{payloadJson}}"];
  const args = adapter.command === "demo-agent"
    ? [demoAgentPath, ...renderArgs(argsTemplate, payloadJson, payload)]
    : codexCommandOverride === "fixture"
      ? [codexFixtureAgentPath, ...renderArgs(argsTemplate, payloadJson, payload)]
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

function highRiskCliCommand(command) {
  const normalized = String(command ?? "").trim().toLowerCase();
  return ["codex", "codex.cmd", "codex.ps1", "claude", "qwen", "qwen-code", "openclaw", "qclaw"].some((name) => normalized === name || normalized.endsWith(`/${name}`) || normalized.endsWith(`\\${name}`));
}

function probeCodexCli(adapter) {
  const codexCommandOverride = process.env.MYAGENTTOOL_CODEX_COMMAND;
  const command = codexCommandOverride === "fixture"
    ? process.execPath
    : codexCommandOverride || String(adapter.command ?? "codex");
  const args = codexCommandOverride === "fixture"
    ? [codexFixtureAgentPath, "exec", "--help"]
    : ["exec", "--help"];
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: buildEnv({ ...adapter, environmentPolicy: "inherit_safe" }),
    windowsHide: true,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const hasExecHelp = result.status === 0 && /Run Codex non-interactively|Usage:\s+codex exec/i.test(combined);
  return {
    ok: hasExecHelp,
    summary: hasExecHelp ? "Restricted Codex CLI probe passed." : "Restricted Codex CLI probe failed.",
    details: [
      "Probe used codex exec --help only.",
      "No prompt was executed.",
      "No install scripts were run.",
      "No broad filesystem scan was performed.",
      `Configured output format: ${adapter.outputFormat ?? "unknown"}.`,
      `Configured sandbox: ${adapter.sandbox ?? "unset"}.`,
      hasExecHelp ? "Codex exec surface is available." : `Codex exec help was not detected. Exit: ${result.status ?? "unknown"}.`
    ]
  };
}

function isCodexCliCommand(command) {
  const normalized = String(command ?? "").trim().toLowerCase();
  return ["codex", "codex.cmd", "codex.ps1", "codex.exe"].some((name) => normalized === name || normalized.endsWith(`/${name}`) || normalized.endsWith(`\\${name}`));
}

function isClaudeCliCommand(command) {
  const normalized = String(command ?? "").trim().toLowerCase();
  return ["claude", "claude.cmd", "claude.exe"].some((name) => normalized === name || normalized.endsWith(`/${name}`) || normalized.endsWith(`\\${name}`));
}

// Restricted Claude probe: `claude --version` only, no prompt is executed.
function probeClaudeCli(adapter) {
  const command = String(adapter.command ?? "claude");
  const result = spawnSync(command, ["--version"], {
    cwd: process.cwd(),
    env: buildEnv({ ...adapter, environmentPolicy: "inherit_safe" }),
    windowsHide: true,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const ok = result.status === 0 && /Claude Code|\d+\.\d+\.\d+/.test(combined);
  return {
    ok,
    summary: ok ? "Restricted Claude CLI probe passed." : "Restricted Claude CLI probe failed."
  };
}

function codexCliArgs() {
  return ["exec", "--json", "--sandbox", "read-only", "--ephemeral", "{{task}}"];
}

function codexRiskTags() {
  return ["read_local", "write_local", "shell_exec", "network_access", "repo_context", "code_change"];
}

// Terminate the agent's whole process tree, gracefully then forcefully, and
// confirm it actually died. A coding agent spawns child processes (shells, model
// calls); killing only the parent leaves orphans running. On posix the child is
// a process-group leader (spawned detached), so we signal the negative pid to
// reach the whole group; on Windows we use taskkill /t. SIGTERM is given a grace
// period, then escalated to SIGKILL if the tree is still alive.
async function terminateProcessTree(child, { graceMs = 2000 } = {}) {
  if (!child || child.pid == null) {
    return { ok: false, message: "Cannot cancel CLI process because no process id was assigned." };
  }
  if (child.exitCode !== null || child.killed) {
    return { ok: true, message: "Process already exited.", signal: null };
  }

  if (process.platform === "win32") {
    const result = await taskkillTree(child);
    await awaitChildExit(child, graceMs);
    return result;
  }

  // posix: signal the process group, escalating SIGTERM -> SIGKILL.
  safeGroupKill(child.pid, "SIGTERM");
  if (await awaitChildExit(child, graceMs)) {
    return { ok: true, message: "Process tree terminated with SIGTERM.", signal: "SIGTERM" };
  }
  safeGroupKill(child.pid, "SIGKILL");
  if (await awaitChildExit(child, graceMs)) {
    return { ok: true, message: "Process tree force-killed with SIGKILL after grace period.", signal: "SIGKILL" };
  }
  return { ok: false, message: "Process tree did not exit after SIGTERM and SIGKILL.", signal: "SIGKILL" };
}

// Make a forced kill observable: when a process tree ignored the graceful stop
// and had to be SIGKILLed, record it so the timeline and audit show that a hard
// kill was needed (not a clean cooperative stop).
async function reportForcedKill(invocationId, result, context) {
  if (result?.signal !== "SIGKILL") {
    return;
  }
  await request("POST", "/api/bridge/events", {
    invocationId,
    type: "cancel_force_killed",
    level: "warn",
    message: `${context}: the agent process tree ignored the graceful stop and was force-killed (SIGKILL).`,
    data: { signal: "SIGKILL", reason: result.message }
  });
}

// Resolve true if the child exits within ms, false otherwise.
function awaitChildExit(child, ms) {
  if (child.exitCode !== null || child.killed) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    child.once("exit", onExit);
    const timer = setTimeout(() => finish(false), ms);
  });
}

// Signal a process group, tolerating an already-gone group (ESRCH) and falling
// back to the single pid if the group signal is not permitted.
function safeGroupKill(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error && error.code === "ESRCH") {
      return false;
    }
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

function taskkillTree(child) {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    killer.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    killer.on("error", (error) => {
      resolve({ ok: false, message: `taskkill could not run: ${error.message}`, signal: null });
    });
    killer.on("close", (code) => {
      const gone = child.exitCode !== null || /not found|128/i.test(stderr);
      resolve({
        ok: code === 0 || gone,
        message:
          code === 0
            ? "Windows process tree terminated (taskkill /t /f)."
            : gone
              ? "Process already exited."
              : `Windows process-tree cancellation failed: ${stderr.trim() || `taskkill exited ${code}`}`,
        signal: "taskkill"
      });
    });
  });
}

async function handleAgentLine(invocationId, line, adapter = {}) {
  if (!line) {
    return null;
  }
  if (adapter.outputFormat === "codex_jsonl") {
    return handleCodexJsonLine(invocationId, line);
  }
  if (adapter.outputFormat === "claude_jsonl") {
    return handleClaudeJsonLine(invocationId, line);
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

async function handleCodexJsonLine(invocationId, line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    await request("POST", "/api/bridge/events", {
      invocationId,
      type: "agent_output",
      level: "info",
      message: line
    });
    return null;
  }

  const message = codexEventMessage(event);
  if (message) {
    await request("POST", "/api/bridge/events", {
      invocationId,
      type: "agent_output",
      level: event.type === "turn.failed" || event.type === "error" ? "warn" : "info",
      message,
      data: {
        source: "codex_jsonl",
        eventType: event.type,
        itemType: event.item?.type ?? null
      }
    });
  }

  if (event.type === "turn.completed") {
    return {
      summary: "Codex CLI completed.",
      touchedUserFiles: false,
      output: { usage: event.usage ?? null },
      cost: {
        model: "codex",
        billable: true,
        unknown: true,
        amountUsd: null,
        inputTokens: Number(event.usage?.input_tokens ?? 0) || 0,
        outputTokens: Number(event.usage?.output_tokens ?? 0) || 0
      }
    };
  }

  if (event.item?.type === "agent_message" && event.item?.text) {
    return {
      summary: String(event.item.text),
      touchedUserFiles: false,
      output: { latestMessage: String(event.item.text) },
      cost: { model: "codex", billable: true, unknown: true }
    };
  }

  return null;
}

function codexEventMessage(event) {
  if (event.type === "thread.started") return `Codex thread started: ${event.thread_id ?? "unknown"}.`;
  if (event.type === "turn.started") return "Codex turn started.";
  if (event.type === "turn.completed") return "Codex turn completed.";
  if (event.type === "turn.failed") return `Codex turn failed: ${event.error?.message ?? "unknown error"}.`;
  if (event.type === "error") return `Codex error: ${event.message ?? event.error?.message ?? "unknown error"}.`;
  if (event.item?.type === "agent_message" && event.item?.text) return String(event.item.text);
  if (event.item?.type) return `Codex event: ${event.item.type}.`;
  return null;
}

// Parse one Claude Code stream-json line. The final `result` event carries the
// answer text; assistant events stream interim output as evidence.
async function handleClaudeJsonLine(invocationId, line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    await request("POST", "/api/bridge/events", {
      invocationId,
      type: "agent_output",
      level: "info",
      message: line
    });
    return null;
  }

  const message = claudeEventMessage(event);
  if (message) {
    await request("POST", "/api/bridge/events", {
      invocationId,
      type: "agent_output",
      level: event.type === "result" && event.subtype !== "success" ? "warn" : "info",
      message,
      data: {
        source: "claude_jsonl",
        eventType: event.type,
        subtype: event.subtype ?? null
      }
    });
  }

  if (event.type === "result") {
    const text = typeof event.result === "string" ? event.result : `Claude result: ${event.subtype ?? "done"}`;
    return {
      summary: String(text),
      touchedUserFiles: false,
      output: { subtype: event.subtype ?? null, numTurns: event.num_turns ?? null },
      cost: {
        model: "claude",
        billable: true,
        unknown: typeof event.total_cost_usd !== "number",
        amountUsd: typeof event.total_cost_usd === "number" ? event.total_cost_usd : null,
        inputTokens: Number(event.usage?.input_tokens ?? 0) || 0,
        outputTokens: Number(event.usage?.output_tokens ?? 0) || 0
      }
    };
  }

  return null;
}

function claudeEventMessage(event) {
  if (event.type === "assistant" && Array.isArray(event.message?.content)) {
    const text = event.message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    return text || null;
  }
  if (event.type === "result") {
    return typeof event.result === "string" ? event.result : `Claude result: ${event.subtype ?? "done"}.`;
  }
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
