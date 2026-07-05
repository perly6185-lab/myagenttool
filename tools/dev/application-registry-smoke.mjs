import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
writeFileSync(join(applicationPath, "package.json"), JSON.stringify({
  name: "smoke-app",
  version: "1.0.0",
  bin: { "smoke-app": "bin/smoke.js" },
  scripts: { test: "node --test", start: "node server.js", postinstall: "node install.js" },
  exports: { ".": "./index.js" },
}, null, 2), "utf8");
writeFileSync(join(applicationPath, "README.md"), "# Smoke App\n\nSmoke app registry fixture.\n", "utf8");

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
  const npmWrapper = await request("POST", "/api/applications/register", {
    name: "Smoke NPM Wrapper",
    source: {
      type: "npm",
      package: "@scope/smoke-wrapper",
      version: "1.0.0",
      packageJson: {
        name: "@scope/smoke-wrapper",
        version: "1.0.0",
        scripts: { lint: "eslint ." },
      },
      wrapper: {
        mode: "installed-wrapper",
        installState: "installed",
        commands: [{
          id: "lint",
          commandType: "npm_script",
          command: "lint",
          status: "approved",
          riskLevel: "low",
          envPolicy: { redact: ["NPM_TOKEN"] },
          filePolicy: "read_only",
          networkPolicy: "forbidden",
        }],
      },
    },
  });
  const npmPrefix = `app.${npmWrapper.application.id}`;
  const npmCapabilities = await request("GET", "/api/capabilities?providerType=application");
  assert(
    npmCapabilities.capabilities.some((capability) => capability.name === `${npmPrefix}.wrapper.lint` && capability.kind === "npm_wrapper"),
    "approved npm wrapper command should project a governed capability",
  );
  const wrapperBlocked = await request("POST", `/api/capabilities/${npmPrefix}.wrapper.lint/invocations`, {}, { expectOk: false });
  assert(wrapperBlocked.status === 202 && wrapperBlocked.data.status === "waiting_for_local_approval", "wrapper command should issue a local approval request");
  const wrapperApprovalRequestId = await approveApplicationRequest(wrapperBlocked.data);
  const wrapperInvocation = await request("POST", `/api/capabilities/${npmPrefix}.wrapper.lint/invocations`, { approvalRequestId: wrapperApprovalRequestId }, { expectOk: false });
  assert(
    (wrapperInvocation.status === 202 && wrapperInvocation.data.status === "queued")
      || (wrapperInvocation.status === 409 && wrapperInvocation.data.error === "agent_not_available"),
    "approved wrapper invocation should pass approval verification and then queue or report a missing runner",
  );

  const expectedRoutineId = `app-${registered.application.id}-maintenance`;

  // Side-effecting actions require a real approvalRequestId; without one the
  // gateway must request approval before doing anything.
  const generateNoToken = await request("POST", `/api/capabilities/${capabilityPrefix}.generate_orchestration/invocations`, {}, { expectOk: false });
  assert(generateNoToken.status === 202 && generateNoToken.data?.approvalRequestId, "generate_orchestration without approval should request local approval");
  const offlineNoToken = await request("POST", `/api/applications/${registered.application.id}/offline`, {}, { expectOk: false });
  assert(offlineNoToken.status === 202 && offlineNoToken.data?.approvalRequestId, "offline without approval should request local approval");

  const generateApprovalRequestId = await approveApplicationRequest(generateNoToken.data);
  const orchestration = await request("POST", `/api/capabilities/${capabilityPrefix}.generate_orchestration/invocations`, { approvalRequestId: generateApprovalRequestId });
  const orchestrationDraft = orchestration.invocation.result.output.orchestration;
  const routinePath = orchestrationDraft.path;
  assert(orchestrationDraft.validation?.ok, "generate_orchestration should return server-side routine validation");
  assert(existsSync(routinePath), "generate_orchestration should write a routine spec file");
  // Draft must live under the platform-managed applications directory, never the
  // application's own path or the server repo root.
  assert(routinePath.includes(join(".myagenttool", "applications")), "routine draft must live under the managed applications directory");
  const routineCheck = aiJson(["loop-routine-check", "--file", routinePath, "--json"], applicationPath);
  assert(routineCheck.validation?.ok, "generated routine spec should validate");
  const directGenerateApproval = await request("POST", `/api/applications/${registered.application.id}/orchestrations/generate`, {});
  const directGenerateApprovalRequestId = await approveApplicationRequest(directGenerateApproval);
  const generated = await request("POST", `/api/applications/${registered.application.id}/orchestrations/generate`, { approvalRequestId: directGenerateApprovalRequestId });
  assert(generated.invocation.result.output.orchestration.id === expectedRoutineId, "application orchestration endpoint should use the id-derived routine id");
  const orchestrations = await request("GET", `/api/applications/${registered.application.id}/orchestrations`);
  assert(orchestrations.orchestrations.some((item) => item.routineId === expectedRoutineId), "orchestration list should expose generated routine draft");

  const probed = await request("POST", `/api/applications/${registered.application.id}/probe`);
  assert(probed.application.probe?.status === "completed", "probe should complete");
  assert(
    probed.application.probe.capabilities.some((capability) => capability.name === `${capabilityPrefix}.offline` && capability.source === "managed"),
    "probe should snapshot managed projected capabilities",
  );
  assert(
    probed.application.probe.capabilities.some((capability) => capability.name === `${capabilityPrefix}.inferred.bin.smoke-app` && capability.source === "inferred"),
    "probe should infer package bin candidates",
  );
  assert(
    !probed.application.probe.capabilities.some((capability) => capability.name.includes("postinstall")),
    "probe must not infer unsafe lifecycle scripts",
  );
  assert(probed.application.probe.package?.name === "smoke-app", "probe should summarize package metadata");
  assert(probed.application.probe.readme?.heading === "Smoke App", "probe should summarize README metadata");

  const offlineApprovalRequestId = await approveApplicationRequest(offlineNoToken.data);
  const offline = await request("POST", `/api/applications/${registered.application.id}/offline`, { approvalRequestId: offlineApprovalRequestId });
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

async function approveApplicationRequest(responseBody) {
  assert(responseBody.status === "waiting_for_local_approval", "approval request should be waiting for local approval");
  assert(responseBody.approvalRequestId, "approval request id should be returned");
  const approved = await request("POST", `/api/approvals/${encodeURIComponent(responseBody.approvalRequestId)}/approve`, {});
  assert(approved.approval.status === "approved", "approval should be approved through the normal approval route");
  return responseBody.approvalRequestId;
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
