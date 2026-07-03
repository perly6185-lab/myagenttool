import { mkdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";

const serverPort = Number(process.env.APPLICATION_REGISTRY_SMOKE_PORT ?? 3331);
const serverUrl = `http://127.0.0.1:${serverPort}`;
const defaultProjectPath = join(tmpdir(), `myagenttool-app-default-${Date.now()}`);
const applicationPath = join(tmpdir(), `myagenttool-app-smoke-${Date.now()}`);
const statePath = join(tmpdir(), `myagenttool-app-smoke-state-${Date.now()}.json`);
mkdirSync(defaultProjectPath, { recursive: true });
mkdirSync(applicationPath, { recursive: true });

const server = spawn(process.execPath, ["apps/server/src/index.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SERVER_PORT: String(serverPort),
    MYAGENTTOOL_PROJECT_PATH: defaultProjectPath,
    MYAGENTTOOL_STATE_PATH: statePath,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[server:error] ${chunk}`));

try {
  await waitForServer();

  const registered = await request("POST", "/api/applications/register", {
    name: "Smoke App",
    source: { type: "local", path: applicationPath },
  });
  const capabilityPrefix = `app.${registered.application.id}`;
  assert(registered.application.name === "Smoke App", "registered application should preserve name");
  assert(registered.application.status === "active", "registered application should default active");
  assert(registered.capabilities.some((capability) => capability.name === `${capabilityPrefix}.inspect`), "inspect capability should be projected");

  const listed = await request("GET", "/api/applications");
  assert(listed.applications.some((application) => application.id === registered.application.id), "application should be listed");

  const appCapabilities = await request("GET", "/api/capabilities?providerType=application");
  assert(
    appCapabilities.capabilities.some((capability) => capability.name === `${capabilityPrefix}.inspect`),
    "application capability should be discoverable through the unified registry",
  );
  const appInvocation = await request("POST", `/api/capabilities/${capabilityPrefix}.inspect/invocations`, {});
  assert(appInvocation.status === "succeeded", "application capability invocation should complete through Application Control");
  assert(
    appInvocation.agentId === "agt_platform_application_control",
    "application capability invocation should use the platform Application Control agent",
  );
  const orchestration = await request("POST", `/api/capabilities/${capabilityPrefix}.generate_orchestration/invocations`, {});
  const routinePath = orchestration.invocation.result.output.orchestration.path;
  assert(existsSync(routinePath), "generate_orchestration should write a routine spec file");
  const routineCheck = aiJson(["loop-routine-check", "--file", routinePath, "--json"], applicationPath);
  assert(routineCheck.validation?.ok, "generated routine spec should validate");
  const generated = await request("POST", `/api/applications/${registered.application.id}/orchestrations/generate`, {});
  assert(generated.invocation.result.output.orchestration.id === "app-smoke-app-maintenance", "application orchestration endpoint should use the same routine id");
  const orchestrations = await request("GET", `/api/applications/${registered.application.id}/orchestrations`);
  assert(orchestrations.orchestrations.some((item) => item.routineId === "app-smoke-app-maintenance"), "orchestration list should expose generated routine draft");

  const probed = await request("POST", `/api/applications/${registered.application.id}/probe`);
  assert(probed.application.probe?.status === "completed", "probe should complete");
  assert(probed.application.probe.capabilities.includes(`${capabilityPrefix}.offline`), "probe should snapshot projected capability names");

  const offline = await request("POST", `/api/applications/${registered.application.id}/offline`, { approvalToken: "operator-approved-offline" });
  assert(offline.invocation.result.output.status === "offline", "offline action should update status");
  const offlineState = await request("GET", `/api/applications/${registered.application.id}`);
  const refresh = offlineState.capabilities.find((capability) => capability.name === `${capabilityPrefix}.refresh`);
  assert(refresh?.status === "disabled", "offline application should disable execution-like capabilities");

  const state = await request("GET", "/api/state");
  assert(state.applications.some((application) => application.id === registered.application.id), "public state should include application");

  console.log("[application-registry-smoke] application registry API OK");
} finally {
  server.kill();
}

async function waitForServer() {
  await waitFor(async () => {
    try {
      const response = await fetch(`${serverUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }, "server health");
}

async function request(method, path, body = undefined, options = {}) {
  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok && options.expectOk !== false) {
    throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  }
  return options.expectOk === false ? { status: response.status, data } : data;
}

async function waitFor(check, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function aiJson(args, cwd) {
  const output = execFileSync("node", [join(process.cwd(), "tools/ai/src/index.mjs"), ...args], {
    cwd,
    encoding: "utf8",
  });
  return JSON.parse(output);
}
