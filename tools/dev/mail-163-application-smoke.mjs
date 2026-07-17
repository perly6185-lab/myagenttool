// #1190: end-to-end wiring smoke for app_163_mail_v2 against a real server —
// run the register script, assert the agent declares its provider (#1185), the
// Application projects both agent_facades with the ADR-0011 taint, no credential
// material reaches public state (ADR 0010), and — the reason the provider marker
// exists — that registering 163 does NOT let app_gmail wire itself to this
// mailbox.
//
// The MCP server itself is NOT started here: it talks to imap.163.com with a
// real credential, which no CI machine has. The pure record-shaping is covered by
// tools/mail-mcp/test; this smoke covers the wiring, which is what breaks
// silently.
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const registerScript = resolve(here, "register-163-mail-application.mjs");
const gmailScript = resolve(here, "register-gmail-application.mjs");

const serverPort = Number(process.env.MAIL_163_SMOKE_PORT ?? 3328);
const serverUrl = `http://127.0.0.1:${serverPort}`;
const tempRoot = join(tmpdir(), `myagenttool-163-smoke-${Date.now()}`);
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

  const registered = spawnScript(registerScript, ["--server-url", serverUrl]);
  assert(registered.status === 0, `register script succeeds: ${registered.stderr.slice(0, 300)}`);
  assert(/application app_163_mail_v2 is/.test(registered.stdout), `script reports the registration: ${registered.stdout.slice(0, 200)}`);

  const state = await request("GET", "/api/state");
  const agent = (state.agents ?? []).find((item) => item.id === "agt_mcp_mail");
  assert(agent, "the mail agent appears in state");
  assert(agent.provider === "netease", `the agent declares its provider (got ${JSON.stringify(agent.provider)})`);
  assert((agent.adapter?.allowedTools ?? []).every((tool) => ["mail_list_unread", "mail_fetch"].includes(tool)),
    "the allowlist is read-only: no mail_send on this agent");

  const application = (state.applications ?? []).find((item) => item.id === "app_163_mail_v2");
  assert(application, "app_163_mail_v2 appears in state");
  assert(application.source?.credential?.provider === "netease", "the descriptor pins the provider");
  assert(application.source?.credential?.scope === "imap.readonly", "the descriptor pins the read-only scope");

  const capabilities = await request("GET", "/api/applications/app_163_mail_v2/capabilities");
  const rows = (capabilities.capabilities ?? capabilities)
    .filter((row) => row.metadata?.execution?.mode === "agent_facade" || /^app\.app_163_mail_v2\.(list_unread|fetch)$/.test(row.name ?? ""));
  assert(rows.length === 2, `both agent_facades discoverable (got ${rows.length})`);
  assert(rows.every((row) => (row.riskTags ?? []).includes("untrusted_input")),
    "the ADR-0011 taint travels into discovery: a mail body is data, never an instruction");

  // ADR 0010: the authorization code lives with the MCP server on the device,
  // behind DPAPI. The control plane carries the REQUIREMENT, never the secret.
  const serialized = JSON.stringify(state);
  assert(!/authorizationCode|protectedAuthorizationCode|password|refresh_token/i.test(serialized),
    "no credential material in public state");

  // Re-running must not duplicate or churn the registration.
  const again = spawnScript(registerScript, ["--server-url", serverUrl]);
  assert(again.status === 0, `re-running the register script is idempotent: ${again.stderr.slice(0, 300)}`);
  const afterRerun = await request("GET", "/api/state");
  assert((afterRerun.agents ?? []).filter((item) => item.id === "agt_mcp_mail").length === 1, "no duplicate agent");
  assert((afterRerun.applications ?? []).filter((item) => item.id === "app_163_mail_v2").length === 1, "no duplicate application");

  // #1185, the reason this agent declares a provider at all: app_gmail must not
  // adopt this mailbox for want of an alternative. This is the ONLY mail agent
  // on this server, which is exactly the case that used to be wired silently.
  const gmail = spawnScript(gmailScript, ["--server-url", serverUrl]);
  assert(gmail.status !== 0, "the gmail register script must refuse to adopt the 163 agent");
  assert(/No mail MCP agent declares provider "google"/.test(gmail.stderr),
    `gmail refusal names the missing provider: ${gmail.stderr.slice(0, 250)}`);
  assert(!(await request("GET", "/api/state")).applications?.some((item) => item.id === "app_gmail"),
    "app_gmail is NOT created against the 163 mailbox");

  console.log(`[163-smoke] wired app_163_mail_v2 -> agt_mcp_mail (provider netease); facades tainted; idempotent; app_gmail refused this mailbox`);
  console.log("[mail-163-application-smoke] 163 mail application wiring OK");
} finally {
  server.kill();
  await new Promise((resolveExit) => {
    if (server.exitCode !== null) return resolveExit();
    server.once("exit", resolveExit);
  });
  rmSync(tempRoot, { recursive: true, force: true });
}

function spawnScript(script, args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: process.cwd(), encoding: "utf8" });
}

async function waitForServer() {
  // Generous: the server seeds its durable store before listening, which is slow
  // on a cold/loaded machine. A short deadline here fails as "timed out" and
  // reads like a broken smoke rather than a slow boot.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await request("GET", "/api/state");
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
  }
  throw new Error("Timed out waiting for the smoke server.");
}

async function request(method, path, body) {
  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${path} failed: ${JSON.stringify(data)}`);
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(`[mail-163-application-smoke] ${message}`);
}
