import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";

import { createApplicationWrapperAgentRegistration } from "../../apps/server/src/services/applications.mjs";

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
  // The npm-wrapper capability dispatches to the opt-in platform wrapper runner
  // agent; register it so the wrapper invocation below resolves a runner instead
  // of failing agent_not_available.
  const wrapperAgent = await request("POST", "/api/agents", createApplicationWrapperAgentRegistration());
  assert(wrapperAgent.agent?.id === "agt_platform_application_wrapper", "wrapper runner agent should register");

  const npmPrefix = `app.${npmWrapper.application.id}`;
  const npmCapabilities = await request("GET", "/api/capabilities?providerType=application");
  assert(
    npmCapabilities.capabilities.some((capability) => capability.name === `${npmPrefix}.wrapper.lint` && capability.kind === "npm_wrapper"),
    "approved npm wrapper command should project a governed capability",
  );
  const wrapperBlocked = await request("POST", `/api/capabilities/${npmPrefix}.wrapper.lint/invocations`, {}, { expectOk: false });
  assert(wrapperBlocked.status === 409 && wrapperBlocked.data.error === "approval_required", "wrapper command should require approval");
  // An approved wrapper command dispatches as a QUEUED bridge invocation for the
  // platform wrapper runner (the server-resolved argv rides as allowlisted
  // metadata); it does not execute npm inline.
  const wrapperInvocation = await request("POST", `/api/capabilities/${npmPrefix}.wrapper.lint/invocations`, { approvalToken: await issueGrant(`wrapper:lint`, npmWrapper.application.id) });
  assert(wrapperInvocation.status === "queued", "approved wrapper command should dispatch a queued invocation");
  assert(wrapperInvocation.agentId === "agt_platform_application_wrapper", "wrapper invocation should route to the platform wrapper runner");
  assert(typeof wrapperInvocation.invocationId === "string" && wrapperInvocation.invocationId.length > 0, "wrapper dispatch should return an invocation id");

  const expectedRoutineId = `app-${registered.application.id}-maintenance`;

  // Side-effecting actions require an explicit approvalToken; without one the
  // gateway must reject before doing anything.
  const generateNoToken = await request("POST", `/api/capabilities/${capabilityPrefix}.generate_orchestration/invocations`, {}, { expectOk: false });
  assert(generateNoToken.status === 409 && generateNoToken.data?.error === "approval_required", "generate_orchestration without an approvalToken should be rejected");
  const offlineNoToken = await request("POST", `/api/applications/${registered.application.id}/offline`, {}, { expectOk: false });
  assert(offlineNoToken.status === 409 && offlineNoToken.data?.error === "approval_required", "offline without an approvalToken should be rejected");

  const orchestration = await request("POST", `/api/capabilities/${capabilityPrefix}.generate_orchestration/invocations`, { approvalToken: await issueGrant("generate_orchestration", registered.application.id) });
  const orchestrationDraft = orchestration.invocation.result.output.orchestration;
  const routinePath = orchestrationDraft.path;
  assert(orchestrationDraft.validation?.ok, "generate_orchestration should return server-side routine validation");
  assert(existsSync(routinePath), "generate_orchestration should write a routine spec file");
  // Draft must live under the platform-managed applications directory, never the
  // application's own path or the server repo root.
  assert(routinePath.includes(join(".myagenttool", "applications")), "routine draft must live under the managed applications directory");
  const routineCheck = aiJson(["loop-routine-check", "--file", routinePath, "--json"], applicationPath);
  assert(routineCheck.validation?.ok, "generated routine spec should validate");
  const generated = await request("POST", `/api/applications/${registered.application.id}/orchestrations/generate`, { approvalToken: await issueGrant("generate_orchestration", registered.application.id) });
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

  const offline = await request("POST", `/api/applications/${registered.application.id}/offline`, { approvalToken: await issueGrant("offline", registered.application.id) });
  assert(offline.invocation.result.output.status === "offline", "offline action should update status");
  const offlineState = await request("GET", `/api/applications/${registered.application.id}`);
  const refresh = offlineState.capabilities.find((capability) => capability.name === `${capabilityPrefix}.refresh`);
  assert(refresh?.status === "disabled", "offline application should disable execution-like capabilities");

  const state = await request("GET", "/api/state");
  assert(state.applications.some((application) => application.id === registered.application.id), "public state should include application");
  // Phase 2 readiness: every side-effecting call above used an issued grant, so
  // the legacy free-text counter must still read zero. If someone reintroduces a
  // free-text token, this fails loudly instead of silently keeping the migration
  // from ever reaching strict mode.
  assert(
    (state.approvalTokenLegacyUses?.count ?? 0) === 0,
    `smoke must use issued grants only — legacy token counter is ${state.approvalTokenLegacyUses?.count}`,
  );

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

// Phase 2 (APPROVAL_GRANTS.md): every side-effecting call below carries a real
// server-issued, single-use, action+target-scoped grant instead of a free-text
// token — so this smoke no longer trips the legacy-token counter and passes even
// once `requireIssuedApprovals` strict mode is flipped on.
async function issueGrant(action, targetId) {
  const grant = await request("POST", "/api/approvals/grants", { action, targetId });
  assert(grant?.token, `grant issuance should return a token for ${action} on ${targetId}`);
  return grant.token;
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
