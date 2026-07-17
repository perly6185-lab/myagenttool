// #1145 (#979): end-to-end wiring smoke for app_gmail against a real server —
// register the mail MCP agent, run the register script, and assert discovery
// (untrusted_input taint present) plus credential-driven readiness
// (unauthorized reads needs_setup; no secret anywhere in state).
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const mailFixture = resolve(here, "../../apps/desktop/test/fixtures/mcp-mail-server.mjs");
const registerScript = resolve(here, "register-gmail-application.mjs");
const registerSendScript = resolve(here, "register-gmail-send-application.mjs");

const serverPort = Number(process.env.GMAIL_APP_SMOKE_PORT ?? 3327);
const serverUrl = `http://127.0.0.1:${serverPort}`;
const tempRoot = join(tmpdir(), `myagenttool-gmail-app-smoke-${Date.now()}`);
const projectPath = join(tempRoot, "project");
mkdirSync(projectPath, { recursive: true });

const server = spawn(process.execPath, ["apps/server/src/index.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SERVER_PORT: String(serverPort),
    MYAGENTTOOL_PROJECT_PATH: projectPath,
    MYAGENTTOOL_STATE_PATH: join(tempRoot, "state.json"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[server:error] ${chunk}`));

try {
  await waitForServer();

  // Without the mail agent, the register script must refuse loudly.
  const refused = spawnScript(["--server-url", serverUrl]);
  assert(refused.status !== 0, "register script must refuse when no mail agent is registered");
  assert(/No registered read-only mail MCP agent/.test(refused.stderr), `refusal names the prerequisite: ${refused.stderr.slice(0, 200)}`);

  // #1185: a mail agent for ANOTHER provider is not a Gmail agent. With only
  // this one registered, counting candidates finds exactly one and the old shape
  // wired app_gmail to a NetEase mailbox, silently, exit 0. Nothing about being
  // the only candidate makes an agent the right one.
  const neteaseAgent = await request("POST", "/api/agents", {
    type: "mcp",
    transport: "stdio",
    command: process.execPath,
    args: [mailFixture],
    allowedTools: ["mail_list_unread", "mail_fetch"],
    timeoutMs: 5_000,
    name: "163 Mail (read-only)",
    provider: "netease",
    capabilityName: "mail.read",
    riskLevel: "medium",
    riskTags: ["local_execution", "untrusted_input"],
  });
  const neteaseAgentId = neteaseAgent.agent?.id ?? neteaseAgent.id;
  assert(neteaseAgentId, "the netease mail agent registers");
  assert(neteaseAgent.agent?.provider === "netease", "the declared provider is projected into state");

  const wrongProvider = spawnScript(["--server-url", serverUrl]);
  assert(wrongProvider.status !== 0, "register script must refuse when the only mail agent is another provider");
  assert(/No mail MCP agent declares provider "google"/.test(wrongProvider.stderr), `refusal names the missing provider: ${wrongProvider.stderr.slice(0, 250)}`);
  assert(wrongProvider.stderr.includes(neteaseAgentId), "refusal names the agent it declined to use");
  assert(/--agent-id/.test(wrongProvider.stderr), "refusal names the way out");
  const afterRefusal = await request("GET", "/api/state");
  assert(!(afterRefusal.applications ?? []).some((item) => item.id === "app_gmail"), "app_gmail is NOT created against the wrong provider");

  // Register the read-only mail MCP agent (#976 shape), declaring google (#1185).
  const agentResponse = await request("POST", "/api/agents", {
    type: "mcp",
    transport: "stdio",
    command: process.execPath,
    args: [mailFixture],
    allowedTools: ["mail_list_unread", "mail_fetch"],
    timeoutMs: 5_000,
    name: "Mail (read-only)",
    provider: "google",
    capabilityName: "mail.read",
    riskLevel: "medium",
    riskTags: ["local_execution", "untrusted_input"],
  });
  const agentId = agentResponse.agent?.id ?? agentResponse.id;
  assert(agentId, "mail agent registration returns an id");

  // Now the script wires app_gmail against the live agent — and picks it out from
  // beside the netease one, which is the whole point of the provider marker.
  const wired = spawnScript(["--server-url", serverUrl]);
  assert(wired.status === 0, `register script succeeds with the google agent present: ${wired.stderr.slice(0, 300)}`);
  assert(/registered application app_gmail/.test(wired.stdout), "script reports the registration");
  assert(new RegExp(`-> agent ${agentId}`).test(wired.stdout), "the google agent is the one wired, not the netease one");

  const state = await request("GET", "/api/state");
  const application = (state.applications ?? []).find((item) => item.id === "app_gmail");
  assert(application, "app_gmail appears in state");
  assert(application.source?.credential?.scope === "gmail.readonly", "descriptor pins the read-only scope");

  const capabilities = await request("GET", "/api/applications/app_gmail/capabilities");
  const rows = (capabilities.capabilities ?? capabilities)
    .filter((row) => row.metadata?.execution?.mode === "agent_facade" || /^app\.app_gmail\.(list_unread|fetch)$/.test(row.name ?? ""));
  assert(rows.length === 2, `both agent_facades discoverable (got ${rows.length})`);
  assert(rows.every((row) => (row.riskTags ?? []).includes("untrusted_input")), "the ADR-0011 taint travels into discovery");

  // Unauthorized credential -> readiness is needs_setup, and no secret-shaped
  // field leaks into the public state.
  const readiness = application.credentialReadiness?.status ?? application.readiness?.credential ?? application.lifecycle?.credential ?? null;
  const serialized = JSON.stringify(state);
  assert(!/refresh_token|access_token|client_secret/i.test(serialized), "no credential material in public state");
  console.log(`[gmail-app-smoke] wired app_gmail -> ${agentId}; capabilities tainted; credential readiness: ${readiness ?? "(reported by bridge at runtime)"}`);

  // TWO agents declaring google is the ambiguity the provider marker cannot
  // resolve — two Gmail accounts are both honestly "google" (#1176). Refuse and
  // name both. The netease agent is still registered here and must NOT be named:
  // it was never a candidate.
  const secondAgent = await request("POST", "/api/agents", {
    type: "mcp",
    transport: "stdio",
    command: process.execPath,
    args: [mailFixture],
    allowedTools: ["mail_list_unread", "mail_fetch"],
    timeoutMs: 5_000,
    name: "Mail (read-only, second account)",
    provider: "google",
    capabilityName: "mail.read",
    riskLevel: "medium",
    riskTags: ["local_execution", "untrusted_input"],
  });
  const secondAgentId = secondAgent.agent?.id ?? secondAgent.id;
  assert(secondAgentId && secondAgentId !== agentId, "the second google mail agent registers with its own id");

  const ambiguous = spawnScript(["--server-url", serverUrl]);
  assert(ambiguous.status !== 0, "register script must refuse when two google mail agents are registered");
  assert(/Ambiguous: 2 mail MCP agents declare provider "google"/.test(ambiguous.stderr), `refusal reports the ambiguity: ${ambiguous.stderr.slice(0, 200)}`);
  for (const id of [agentId, secondAgentId]) {
    assert(ambiguous.stderr.includes(id), `refusal names candidate ${id}: ${ambiguous.stderr.slice(0, 300)}`);
  }
  assert(!ambiguous.stderr.includes(neteaseAgentId), "the netease agent is not offered as a candidate");
  assert(/--agent-id/.test(ambiguous.stderr), "refusal names the way out");

  // ...and naming the agent explicitly still works: the refusal is a prompt for
  // an operator decision, not a dead end.
  const disambiguated = spawnScript(["--server-url", serverUrl, "--agent-id", agentId]);
  assert(disambiguated.status === 0, `--agent-id resolves the ambiguity: ${disambiguated.stderr.slice(0, 300)}`);
  assert(new RegExp(`-> agent ${agentId}`).test(disambiguated.stdout), "the named agent is the one wired");

  console.log(`[gmail-app-smoke] lone netease agent -> refused; google picked out beside it; two google agents -> refused by name; --agent-id ${agentId} still wires`);

  // The SEND script (#1147, ADR 0014) must hold the same line, and the stakes are
  // higher: app_gmail_send carries send authority, so a wrong bind sends AS the
  // wrong account. `mail_send` says an agent can send, never as whom — so a lone
  // netease send agent must be refused, not adopted for want of an alternative.
  const neteaseSend = await request("POST", "/api/agents", {
    type: "mcp",
    transport: "stdio",
    command: process.execPath,
    args: [mailFixture],
    allowedTools: ["mail_send"],
    timeoutMs: 5_000,
    name: "163 Mail (send)",
    provider: "netease",
    capabilityName: "mail.send",
    riskLevel: "high",
    riskTags: ["local_execution"],
  });
  const neteaseSendId = neteaseSend.agent?.id ?? neteaseSend.id;
  const wrongProviderSend = spawnSendScript(["--server-url", serverUrl]);
  assert(wrongProviderSend.status !== 0, "send script must refuse when the only send agent is another provider");
  assert(/No mail send MCP agent declares provider "google"/.test(wrongProviderSend.stderr), `send refusal names the missing provider: ${wrongProviderSend.stderr.slice(0, 250)}`);
  assert(wrongProviderSend.stderr.includes(neteaseSendId), "send refusal names the agent it declined to use");
  const afterSendRefusal = await request("GET", "/api/state");
  assert(!(afterSendRefusal.applications ?? []).some((item) => item.id === "app_gmail_send"), "app_gmail_send is NOT created against the wrong provider");

  // Two google send agents stay ambiguous (#1176).
  const sendAgentIds = [];
  for (const name of ["Mail (send)", "Mail (send, second account)"]) {
    const registered = await request("POST", "/api/agents", {
      type: "mcp",
      transport: "stdio",
      command: process.execPath,
      args: [mailFixture],
      allowedTools: ["mail_send"],
      timeoutMs: 5_000,
      name,
      provider: "google",
      capabilityName: "mail.send",
      riskLevel: "high",
      riskTags: ["local_execution"],
    });
    sendAgentIds.push(registered.agent?.id ?? registered.id);
  }
  const ambiguousSend = spawnSendScript(["--server-url", serverUrl]);
  assert(ambiguousSend.status !== 0, "send register script must refuse when two google send agents are registered");
  assert(/Ambiguous: 2 mail send MCP agents declare provider "google"/.test(ambiguousSend.stderr), `send refusal reports the ambiguity: ${ambiguousSend.stderr.slice(0, 200)}`);
  for (const id of sendAgentIds) {
    assert(ambiguousSend.stderr.includes(id), `send refusal names candidate ${id}: ${ambiguousSend.stderr.slice(0, 300)}`);
  }
  assert(!ambiguousSend.stderr.includes(neteaseSendId), "the netease send agent is not offered as a candidate");

  console.log(`[gmail-app-smoke] lone netease send agent -> refused; two google send agents (${sendAgentIds.join(", ")}) -> refused by name`);
  console.log("[gmail-application-smoke] gmail application wiring OK");
} finally {
  server.kill();
  await new Promise((resolveExit) => {
    if (server.exitCode !== null) return resolveExit();
    server.once("exit", resolveExit);
    setTimeout(resolveExit, 5000).unref?.();
  });
  if (resolve(tempRoot).startsWith(resolve(tmpdir()))) {
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

function spawnScript(args) {
  return spawnSync(process.execPath, [registerScript, ...args], { cwd: process.cwd(), encoding: "utf8" });
}

function spawnSendScript(args) {
  return spawnSync(process.execPath, [registerSendScript, ...args], { cwd: process.cwd(), encoding: "utf8" });
}

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${serverUrl}/api/state`);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error("Timed out waiting for the smoke server.");
}

async function request(method, path, body) {
  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
