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
  const resumeArgs = codexArgsTemplate({ command: "codex", args: codexCliArgs() }, { options: { codexSessionMode: "continue_last" } });
  if (!resumeArgs.includes("resume") || resumeArgs.includes("--ephemeral")) {
    throw new Error("Codex continuation args are not configured.");
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

  const spawnPlan = createCliSpawnPlan(adapter, { invocationId, task, options: work.options ?? {} });
  const preview = executionPreview(adapter, spawnPlan, task);
  await sendCodexHookEvent(invocationId, adapter, {
    eventName: "SessionStart",
    summary: `Managed Codex launcher started with ${preview.sessionMode}.`
  });
  const promptHook = await sendCodexHookEvent(invocationId, adapter, {
    eventName: "UserPromptSubmit",
    summary: summarizeTaskForHook(task)
  });
  if (promptHook?.policyDecision === "blocked") {
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: "failed",
      summary: promptHook.hookEvent?.policyReason ?? "Codex prompt was blocked by policy.",
      result: {
        touchedUserFiles: false,
        policyDecision: "blocked"
      }
    });
    return;
  }
  await request("POST", "/api/bridge/events", {
    invocationId,
    type: "execution_preview",
    level: "info",
    message: `Execution preview: ${preview.commandLine}`,
    data: preview
  });
  await sendCodexHookEvent(invocationId, adapter, {
    eventName: "PreToolUse",
    toolName: "Bash",
    summary: preview.commandLine
  });
  const permissionHook = await sendCodexHookEvent(invocationId, adapter, {
    eventName: "PermissionRequest",
    toolName: "Bash",
    summary: "Codex requested permission for a sandbox-bound command preview.",
    timeoutSeconds: process.env.MYAGENTTOOL_CODEX_APPROVAL_TIMEOUT_SECONDS
  });
  const permissionDecision = await waitForCodexApprovalDecision(permissionHook);
  if (permissionDecision === "denied" || permissionDecision === "timed_out") {
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: "failed",
      summary: permissionDecision === "timed_out"
        ? "Codex approval broker timed out before execution."
        : "Codex approval broker denied the request before execution.",
      result: {
        touchedUserFiles: false,
        policyDecision: permissionDecision
      }
    });
    return;
  }

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
        emitAgentStderrLine(invocationId, adapter, line);
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
    await emitAgentStderrLine(invocationId, adapter, stderrBuffer);
  }

  if (timedOut) {
    await sendCodexHookEvent(invocationId, adapter, {
      eventName: "Stop",
      summary: "Codex run timed out."
    });
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: "timed_out",
      summary: "CLI Agent exceeded its configured timeout.",
      result: finalResult
    });
    return;
  }

  if (cancelled) {
    await sendCodexHookEvent(invocationId, adapter, {
      eventName: "Stop",
      summary: "Codex run was cancelled."
    });
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: cancelResult?.ok === false ? "failed" : "cancelled",
      summary: cancelResult?.ok === false ? cancelResult.message : "CLI Agent was cancelled locally.",
      result: finalResult
    });
    return;
  }

  if (exitCode === 0) {
    await sendCodexHookEvent(invocationId, adapter, {
      eventName: "PostToolUse",
      toolName: "Bash",
      summary: "Codex command completed."
    });
    await sendCodexHookEvent(invocationId, adapter, {
      eventName: "Stop",
      summary: "Codex run stopped after completion."
    });
    await request("POST", "/api/bridge/complete", {
      invocationId,
      status: "succeeded",
      summary: finalResult?.summary ?? "Demo CLI Agent completed.",
      result: finalResult
    });
    return;
  }

  await sendCodexHookEvent(invocationId, adapter, {
    eventName: "PostToolUse",
    toolName: "Bash",
    summary: `Codex command exited with code ${exitCode}.`
  });
  await sendCodexHookEvent(invocationId, adapter, {
    eventName: "Stop",
    summary: "Codex run stopped after failure."
  });
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
            ? "Codex CLI is configured for codex exec and JSONL output; permissions stay with Codex CLI native controls."
            : highRiskCliCommand(path)
            ? "High-risk coding CLI commands still require local approval before invocation."
            : "Review shell execution risk before enabling.",
          codexCommand ? "MyAgentTool records invocation evidence but does not replace Codex CLI authorization." : "Generated integrations stay disabled until explicit registration."
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
      sandbox: null
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
  const argsTemplate = codexArgsTemplate(adapter, payload);
  const args = adapter.command === "demo-agent"
    ? [demoAgentPath, ...renderArgs(argsTemplate, payloadJson, payload)]
    : codexCommandOverride === "fixture"
      ? [codexFixtureAgentPath, ...renderArgs(argsTemplate, payloadJson, payload)]
    : renderArgs(argsTemplate, payloadJson, payload);
  const env = buildEnv(adapter);
  const cwd = adapter.workingDirectoryPolicy === "explicit" && adapter.workingDirectory
    ? String(adapter.workingDirectory)
    : process.cwd();
  return {
    command,
    args,
    env,
    cwd,
    sessionMode: payload.options?.codexSessionMode ?? "not_applicable",
    workspacePolicy: payload.options?.codexWorkspacePolicy ?? "current_repo"
  };
}

function codexArgsTemplate(adapter, payload) {
  const args = Array.isArray(adapter.args) && adapter.args.length > 0 ? adapter.args : ["{{payloadJson}}"];
  if (isCodexCliCommand(adapter.command) && payload.options?.codexSessionMode === "continue_last") {
    return ["exec", "resume", "--last", "--json", "{{task}}"];
  }
  return args;
}

function executionPreview(adapter, spawnPlan, task) {
  const args = previewArgs(adapter, spawnPlan.args, task);
  return {
    adapterType: adapter.type,
    command: spawnPlan.command,
    args,
    commandLine: [spawnPlan.command, ...args].map(shellQuote).join(" "),
    cwd: spawnPlan.cwd,
    taskSummary: summarizeTask(task),
    sessionMode: spawnPlan.sessionMode,
    workspace: workspacePreview(adapter, spawnPlan),
    environmentPolicy: adapter.environmentPolicy ?? "inherit_safe",
    envVisible: false
  };
}

function workspacePreview(adapter, spawnPlan) {
  if (!isCodexCliCommand(adapter.command)) {
    return null;
  }
  const git = inspectGitWorkspace(spawnPlan.cwd);
  return {
    policy: spawnPlan.workspacePolicy,
    repoPath: git.repoPath ?? spawnPlan.cwd,
    worktreePath: spawnPlan.workspacePolicy === "current_repo" ? null : "pending_explicit_worktree",
    baseBranch: git.baseBranch,
    branchName: git.branchName,
    dirtyState: git.dirtyState,
    lastCommit: git.lastCommit,
    status: spawnPlan.workspacePolicy === "new_worktree" ? "pending_explicit_creation" : git.status
  };
}

function inspectGitWorkspace(cwd) {
  const root = gitOutput(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root.ok) {
    return {
      status: "unknown",
      repoPath: cwd,
      baseBranch: null,
      branchName: null,
      dirtyState: "unknown",
      lastCommit: null
    };
  }
  const branch = gitOutput(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = gitOutput(cwd, ["rev-parse", "--short", "HEAD"]);
  const dirty = gitOutput(cwd, ["status", "--porcelain"]);
  return {
    status: "observed",
    repoPath: root.stdout,
    baseBranch: null,
    branchName: branch.ok ? branch.stdout : "unknown",
    dirtyState: dirty.ok ? dirty.stdout ? "dirty" : "clean" : "unknown",
    lastCommit: commit.ok ? commit.stdout : null
  };
}

function gitOutput(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 2000
  });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout ?? "").trim()
  };
}

function previewArgs(adapter, renderedArgs, task) {
  const templates = Array.isArray(adapter.args) && adapter.args.length > 0 ? adapter.args : ["{{payloadJson}}"];
  const sanitizedTemplates = templates.map((arg) => String(arg).replaceAll("{{payloadJson}}", "<payload-json>").replaceAll("{{task}}", "<task>"));
  if (adapter.command === "demo-agent") {
    return [demoAgentPath, ...sanitizedTemplates];
  }
  if (isCodexCliCommand(adapter.command) && process.env.MYAGENTTOOL_CODEX_COMMAND === "fixture") {
    return [codexFixtureAgentPath, ...sanitizeRenderedArgs(renderedArgs.slice(1), task)];
  }
  return sanitizeRenderedArgs(renderedArgs, task);
}

function sanitizeRenderedArgs(renderedArgs, task) {
  const taskText = String(task ?? "");
  return renderedArgs.map((arg) => {
    const text = String(arg);
    if (taskText && text === taskText) {
      return "<task>";
    }
    if (taskText && text.includes(taskText)) {
      return text.replaceAll(taskText, "<task>");
    }
    return text;
  });
}

function summarizeTask(task) {
  const normalized = String(task ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117)}...`;
}

function shellQuote(value) {
  const text = String(value ?? "");
  if (/^[a-zA-Z0-9_./:=@{}-]+$/.test(text)) {
    return text;
  }
  return JSON.stringify(text);
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

function codexCliArgs() {
  return ["exec", "--json", "{{task}}"];
}

function codexRiskTags() {
  return ["read_local", "write_local", "shell_exec", "network_access", "repo_context", "code_change"];
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

async function handleAgentLine(invocationId, line, adapter = {}) {
  if (!line) {
    return null;
  }
  if (adapter.outputFormat === "codex_jsonl") {
    return handleCodexJsonLine(invocationId, line);
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

async function emitAgentStderrLine(invocationId, adapter = {}, line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) {
    return;
  }
  if (adapter.outputFormat === "codex_jsonl") {
    await request("POST", "/api/bridge/events", codexRuntimeWarningEvent(invocationId, trimmed));
    return;
  }
  await request("POST", "/api/bridge/events", {
    invocationId,
    type: "log",
    level: "warn",
    message: trimmed
  });
}

function codexRuntimeWarningEvent(invocationId, line) {
  const summary = codexRuntimeWarningSummary(line);
  return {
    invocationId,
    type: "codex_runtime_warning",
    level: "warn",
    message: summary.message,
    data: {
      source: "codex_stderr",
      warningCategory: summary.category,
      redactionState: "summary_only"
    }
  };
}

function codexRuntimeWarningSummary(line) {
  const normalized = String(line ?? "").replace(/\s+/g, " ").trim();
  if (/featured plugins?/i.test(normalized) && /401|unauthorized/i.test(normalized)) {
    return {
      category: "plugin_catalog_auth",
      message: "Codex plugin catalog warning: Codex CLI could not refresh featured plugins authorization. The task can still complete."
    };
  }
  const redacted = redactLocalPaths(normalized);
  return {
    category: "codex_cli_stderr",
    message: `Codex CLI warning: ${redacted.length > 180 ? `${redacted.slice(0, 177)}...` : redacted}`
  };
}

function redactLocalPaths(value) {
  let redacted = String(value ?? "");
  for (const home of [process.env.HOME, process.env.USERPROFILE]) {
    if (home) {
      redacted = redacted.split(home).join("<home>");
    }
  }
  return redacted;
}

async function sendCodexHookEvent(invocationId, adapter, event) {
  if (adapter?.outputFormat !== "codex_jsonl") {
    return null;
  }
  return request("POST", "/api/codex/hooks", {
    invocationId,
    eventName: event.eventName,
    toolName: event.toolName ?? null,
    summary: event.summary ?? event.eventName,
    timeoutSeconds: event.timeoutSeconds ?? null
  });
}

async function waitForCodexApprovalDecision(hookResult) {
  const requestId = hookResult?.brokerRequest?.id;
  if (!requestId) {
    return "not_required";
  }
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await request("GET", `/api/codex/approval-broker/${encodeURIComponent(requestId)}`);
    const status = response?.approvalRequest?.status;
    if (status === "approved" || status === "denied" || status === "timed_out") {
      return status;
    }
    await delay(250);
  }
  return "denied";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeTaskForHook(task) {
  const normalized = String(task ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Empty prompt";
  }
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}...`;
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
        itemType: event.item?.type ?? null,
        threadId: event.thread_id ?? null,
        sessionId: event.session_id ?? event.sessionId ?? null,
        commandSummary: codexCommandSummary(event),
        fileChangeSummary: codexFileChangeSummary(event),
        fileChangePath: codexFileChangePath(event),
        fileChangeAction: codexFileChangeAction(event),
        diffPreview: codexDiffPreview(event),
        changeRisk: codexChangeRisk(event)
      }
    });
  }

  if (event.type === "turn.completed") {
    return {
      summary: "Codex CLI completed.",
      touchedUserFiles: false,
      output: { usage: event.usage ?? null },
      cost: { model: "codex", billable: true, unknown: true }
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

function codexCommandSummary(event) {
  if (event.item?.type !== "command_execution") {
    return null;
  }
  const command = String(event.item.command ?? "").replace(/\s+/g, " ").trim();
  if (!command) {
    return "Command execution";
  }
  return command.length > 160 ? `${command.slice(0, 157)}...` : command;
}

function codexFileChangeSummary(event) {
  const item = event.item ?? {};
  if (!["file_change", "file_changes"].includes(item.type)) {
    return null;
  }
  const path = codexFileChangePath(event);
  const action = codexFileChangeAction(event);
  return path ? `${action}: ${path}` : action;
}

function codexFileChangePath(event) {
  const item = event.item ?? {};
  if (!["file_change", "file_changes"].includes(item.type)) {
    return null;
  }
  return String(item.path ?? item.file ?? item.files?.[0]?.path ?? "").trim() || null;
}

function codexFileChangeAction(event) {
  const item = event.item ?? {};
  if (!["file_change", "file_changes"].includes(item.type)) {
    return null;
  }
  return String(item.action ?? item.change_type ?? item.status ?? "changed").trim() || "changed";
}

function codexDiffPreview(event) {
  const item = event.item ?? {};
  if (!["file_change", "file_changes"].includes(item.type)) {
    return null;
  }
  const diff = String(item.diff ?? item.patch ?? item.diffPreview ?? item.summary ?? "").trim();
  if (!diff) {
    return null;
  }
  return diff.length <= 4000 ? diff : `${diff.slice(0, 3997)}...`;
}

function codexChangeRisk(event) {
  const item = event.item ?? {};
  if (!["file_change", "file_changes"].includes(item.type)) {
    return null;
  }
  const normalized = String(item.risk ?? item.riskLevel ?? "unknown").trim().toLowerCase();
  return ["low", "medium", "high", "critical"].includes(normalized) ? normalized : "unknown";
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
