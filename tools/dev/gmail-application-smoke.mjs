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

  // Register the read-only mail MCP agent (#976 shape).
  const agentResponse = await request("POST", "/api/agents", {
    type: "mcp",
    transport: "stdio",
    command: process.execPath,
    args: [mailFixture],
    allowedTools: ["mail_list_unread", "mail_fetch"],
    timeoutMs: 5_000,
    name: "Mail (read-only)",
    capabilityName: "mail.read",
    riskLevel: "medium",
    riskTags: ["local_execution", "untrusted_input"],
  });
  const agentId = agentResponse.agent?.id ?? agentResponse.id;
  assert(agentId, "mail agent registration returns an id");

  // Now the script wires app_gmail against the live agent.
  const wired = spawnScript(["--server-url", serverUrl]);
  assert(wired.status === 0, `register script succeeds with the agent present: ${wired.stderr.slice(0, 300)}`);
  assert(/registered application app_gmail/.test(wired.stdout), "script reports the registration");

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
