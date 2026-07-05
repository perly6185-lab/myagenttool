import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";

import { createApplicationWrapperAgentRegistration } from "../../apps/server/src/services/applications.mjs";

const serverPort = process.env.APPLICATION_WRAPPER_SMOKE_PORT
  ? Number(process.env.APPLICATION_WRAPPER_SMOKE_PORT)
  : await freePort();
const serverUrl = `http://127.0.0.1:${serverPort}`;
const tempRoot = join(tmpdir(), `myagenttool-app-wrapper-smoke-${Date.now()}`);
const projectPath = join(tempRoot, "project");
const applicationPath = join(tempRoot, "generic-npm-app");
const statePath = join(tempRoot, "state.json");
const children = [];
let passed = 0;

const ok = (message) => {
  passed += 1;
  console.log(`  ok - ${message}`);
};

mkdirSync(projectPath, { recursive: true });
mkdirSync(applicationPath, { recursive: true });
writeFileSync(join(projectPath, "README.md"), "# Application wrapper smoke project\n", "utf8");
writeFileSync(join(applicationPath, "package.json"), JSON.stringify({
  name: "@scope/generic-wrapper-smoke",
  version: "1.0.0",
  scripts: { smoke: "node smoke-wrapper.mjs" },
}, null, 2), "utf8");
writeFileSync(join(applicationPath, "smoke-wrapper.mjs"), [
  "console.log(JSON.stringify({",
  "  marker: 'generic-npm-application-wrapper-smoke',",
  "  cwd: process.cwd(),",
  "  argv: process.argv.slice(2)",
  "}));",
].join("\n"), "utf8");

try {
  start("server", process.execPath, ["apps/server/src/index.mjs"], {
    SERVER_PORT: String(serverPort),
    MYAGENTTOOL_PROJECT_PATH: projectPath,
    MYAGENTTOOL_STATE_PATH: statePath,
    MYAGENTTOOL_STATE_DISABLED: "1",
  });
  await waitForServer();
  ok("server started");

  start("desktop", process.execPath, ["apps/desktop/src/index.mjs"], {
    BRIDGE_SERVER_URL: serverUrl,
    BRIDGE_POLL_INTERVAL_MS: "100",
    BRIDGE_TERMINAL_POLL_INTERVAL_MS: "100",
  });
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.device?.status === "online" ? state : false;
  }, "desktop bridge registration");
  ok("desktop bridge registered");

  const wrapperAgent = await request("POST", "/api/agents", createApplicationWrapperAgentRegistration({
    wrapperScriptPath: resolve("tools/agents/application-wrapper.mjs"),
    costOwner: "team_smoke_ops",
  }));
  assert(wrapperAgent.agent.id === "agt_platform_application_wrapper", "Application wrapper runner should register");
  assert(wrapperAgent.agent.status === "available", "Application wrapper runner should be available with the bridge online");
  ok("application wrapper runner registered");

  const registered = await request("POST", "/api/applications/register", {
    id: "app_generic_wrapper_smoke",
    name: "Generic Wrapper Smoke",
    source: {
      type: "npm",
      package: "@scope/generic-wrapper-smoke",
      version: "1.0.0",
      wrapper: {
        mode: "installed-wrapper",
        installState: "installed",
        installPath: applicationPath,
        packageManager: "npm",
        commands: [{
          id: "smoke",
          displayName: "Generic wrapper smoke",
          commandType: "custom",
          command: "node",
          args: ["smoke-wrapper.mjs", "--from-wrapper"],
          cwd: ".",
          status: "approved",
          riskLevel: "low",
          requiresApproval: true,
          filePolicy: "read_only",
          networkPolicy: "forbidden",
          timeoutSeconds: 20,
        }],
      },
    },
  });
  const capability = `app.${registered.application.id}.wrapper.smoke`;
  assert(registered.capabilities.some((item) => item.name === capability), "generic wrapper capability should be projected");
  ok("generic npm Application registered");

  const approvalRequired = await request("POST", `/api/capabilities/${capability}/invocations`, {});
  assert(approvalRequired.status === "waiting_for_local_approval", "first wrapper call should request local approval");
  assert(approvalRequired.approvalRequestId, "approval request id should be returned");
  const approved = await request("POST", `/api/approvals/${encodeURIComponent(approvalRequired.approvalRequestId)}/approve`, {});
  assert(approved.approval.status === "approved", "approval should be granted through the normal approval route");
  ok("real approval issued and approved");

  const invoked = await request("POST", `/api/capabilities/${capability}/invocations`, {
    approvalRequestId: approvalRequired.approvalRequestId,
  });
  assert(invoked.status === "queued", "approved wrapper call should queue for Desktop Bridge");
  assert(invoked.agentId === "agt_platform_application_wrapper", "wrapper invocation should target the platform wrapper runner");
  ok("approved wrapper invocation queued");

  const finalState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === invoked.invocationId);
    if (invocation?.status === "succeeded") return state;
    if (["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation?.status)) {
      throw new Error(`Generic wrapper invocation ended unexpectedly: ${invocation.status} ${JSON.stringify(invocation.result)}`);
    }
    return false;
  }, "Desktop Bridge generic wrapper execution", 15_000);
  const completed = finalState.invocations.find((item) => item.id === invoked.invocationId);
  const report = completed.result?.output?.report;
  assert(report?.marker === "generic-npm-application-wrapper-smoke", "runner should execute the generic wrapper command");
  assert(report?.cwd === resolve(applicationPath), "wrapper command should run in the Application install path");
  assert(report?.argv?.includes("--from-wrapper"), "server-resolved wrapper args should reach the child command");
  assert(completed.options?.metadata?.applicationWrapper?.execCommand === "node", "metadata should carry the resolved command");
  assert(
    finalState.events.some((event) => event.invocationId === invoked.invocationId && event.type === "invocation_succeeded"),
    "completion should record invocation_succeeded evidence",
  );
  ok("Desktop Bridge executed generic npm Application wrapper");

  console.log(`\napplication-wrapper-smoke: ${passed} checks passed`);
} finally {
  for (const child of children.reverse()) {
    if (!child.killed) child.kill();
  }
  if (resolve(tempRoot).startsWith(resolve(tmpdir()))) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function start(label, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}:error] ${chunk}`));
  children.push(child);
  return child;
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

async function request(method, path, body = undefined) {
  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  }
  return data;
}

async function waitFor(check, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port) resolvePort(port);
        else reject(new Error("Unable to allocate a free port."));
      });
    });
  });
}
