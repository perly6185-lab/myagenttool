import { spawn } from "node:child_process";

const serverPort = 3221;
const serverUrl = `http://127.0.0.1:${serverPort}`;
const children = [];

try {
  start("server", process.execPath, ["apps/server/src/index.mjs"], {
    SERVER_PORT: String(serverPort)
  });
  await waitFor(async () => (await request("GET", "/health")).status === "ok", "server health");

  start("desktop", process.execPath, ["apps/desktop/src/index.mjs"], {
    BRIDGE_SERVER_URL: serverUrl,
    BRIDGE_POLL_INTERVAL_MS: "100",
    BRIDGE_TERMINAL_POLL_INTERVAL_MS: "20",
    MYAGENTTOOL_CODEX_COMMAND: "fixture"
  });
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.device.status === "online" && state.terminalRuntimeCapability?.localPty?.available;
  }, "desktop terminal capability");

  const codexAgent = (await request("GET", "/api/state")).agents.find((item) => item.id === "agt_codex_cli");
  const codexRun = await request("POST", "/api/invocations", {
    task: "Create a Codex managed session for terminal linkage.",
    agentId: codexAgent.id
  });
  const codexSessionState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const session = state.codexSessions.find((item) => item.invocationId === codexRun.invocation.id);
    return session ? { state, session } : false;
  }, "codex session registry for terminal linkage");
  const brokerState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const broker = state.codexApprovalBrokerRequests.find((item) => item.invocationId === codexRun.invocation.id);
    return broker?.status === "pending" ? { state, broker } : false;
  }, "codex approval broker before terminal linkage");
  await request("POST", `/api/codex/approval-broker/${encodeURIComponent(brokerState.broker.id)}/approve`);
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === codexRun.invocation.id);
    return ["succeeded", "failed", "timed_out", "cancelled"].includes(invocation?.status);
  }, "codex fixture completion before terminal linkage");

  const created = await request("POST", "/api/terminal/sessions", {
    shell: process.platform === "win32" ? "powershell" : "bash",
    ownerCodexSessionId: codexSessionState.session.id,
    ownerInvocationId: codexRun.invocation.id,
    cols: 100,
    rows: 30
  });
  const sessionId = created.session.terminalSessionId;
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const session = state.terminalSessions.find((item) => item.terminalSessionId === sessionId);
    return session?.status === "attached";
  }, "terminal attach");

  await request("POST", `/api/terminal/sessions/${encodeURIComponent(sessionId)}/resize`, { cols: 90, rows: 24 });
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.terminalEvidenceRecords.some((item) => item.terminalSessionId === sessionId && item.type === "terminal_resize");
  }, "terminal resize evidence");

  const input = process.platform === "win32"
    ? "Write-Output MYAGENTTOOL_TERMINAL_SMOKE\r"
    : "printf 'MYAGENTTOOL_TERMINAL_SMOKE\\n'\n";
  await request("POST", `/api/terminal/sessions/${encodeURIComponent(sessionId)}/input`, { input });
  const outputState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const evidence = state.terminalEvidenceRecords.filter((item) => item.terminalSessionId === sessionId);
    return evidence.some((item) => item.type === "terminal_output_chunk" && JSON.stringify(item).includes("MYAGENTTOOL_TERMINAL_SMOKE")) ? state : false;
  }, "terminal output evidence");

  await request("POST", `/api/terminal/sessions/${encodeURIComponent(sessionId)}/close`);
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const session = state.terminalSessions.find((item) => item.terminalSessionId === sessionId);
    return ["closed", "detached", "exited"].includes(session?.status);
  }, "terminal close");

  assert(outputState.evidenceCenterRecords.some((item) => item.source === "managed_terminal_runtime"), "Evidence Center should include terminal evidence.");
  const linkedSession = outputState.terminalSessions.find((item) => item.terminalSessionId === sessionId);
  assert(linkedSession?.ownerCodexSessionId === codexSessionState.session.id, "Terminal session should link to managed Codex session.");
  assert(outputState.evidenceCenterRecords.some((item) => item.source === "managed_terminal_runtime" && item.codexSessionRegistryId === codexSessionState.session.id), "Terminal evidence should be traceable through Codex session.");
  console.log(`[terminal-smoke] managed terminal PTY OK session=${sessionId} codexSession=${codexSessionState.session.id}`);
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
}

async function waitFor(check, label) {
  let lastError = null;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const result = await check();
      if (result) return result;
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
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${path} failed: ${JSON.stringify(data)}`);
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function prefix(name, chunk) {
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    if (line.trim()) console.log(`[${name}] ${line}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopChildren() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}
