import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createServerRuntimeServices } from "../../apps/server/src/runtime/service-composer.mjs";
import { createServerState } from "../../apps/server/src/runtime/state-factory.mjs";

const now = () => "2026-07-07T02:00:00.000Z";
const tempRoot = mkdtempSync(join(tmpdir(), "myagenttool-app-fleet-smoke-"));
let passed = 0;

const ok = (message) => {
  passed += 1;
  console.log(`  ok - ${message}`);
};

try {
  const projectPath = join(tempRoot, "project");
  const localAppPath = join(tempRoot, "local-package");
  const stdioMcpPath = join(tempRoot, "stdio-mcp-app");
  const httpMcpSuccessPath = join(tempRoot, "http-mcp-success");
  const httpMcpBlockedPath = join(tempRoot, "http-mcp-blocked");
  const stateStorePath = join(tempRoot, "state", "fleet-state.json");
  mkdirSync(projectPath, { recursive: true });
  createLocalPackage(localAppPath);
  createStdioMcpApp(stdioMcpPath);
  createHttpMcpApp(httpMcpSuccessPath, "https://93.184.216.34/mcp?token=secret");
  createHttpMcpApp(httpMcpBlockedPath, "http://127.0.0.1:9876/mcp?token=secret");

  const probeCalls = [];
  const { state, api, savePersistentState } = runtime({
    projectPath,
    stateStorePath,
    persistenceEnabled: true,
    applicationMcpProbeServer: async (adapter) => {
      probeCalls.push(adapter);
      return {
        ok: true,
        message: "Synthetic HTTP MCP endpoint responded.",
        tools: ["render_markdown", "list_themes"],
      };
    },
  });

  const wrapperApp = api.registerApplication({
    id: "app_fleet_wrapper",
    name: "Fleet Wrapper",
    source: {
      type: "npm",
      package: "@scope/fleet-wrapper",
      version: "1.0.0",
      wrapper: {
        mode: "installed-wrapper",
        installState: "installed",
        installPath: localAppPath,
        packageManager: "npm",
        commands: [{
          id: "report",
          displayName: "Fleet report",
          commandType: "custom",
          command: "node",
          args: ["report.mjs"],
          cwd: ".",
          status: "approved",
          riskLevel: "low",
          requiresApproval: false,
          filePolicy: "read_only",
          networkPolicy: "forbidden",
        }],
      },
    },
  });
  api.probeApplication(wrapperApp.id);
  assert(api.listApplicationCapabilities(wrapperApp.id).some((capability) => capability.name === "app.app_fleet_wrapper.wrapper.report"), "wrapper capability should project");
  ok("npm wrapper Application registered, probed, and projected");

  const stdioApp = api.registerApplication({
    id: "app_fleet_stdio_mcp",
    name: "Fleet stdio MCP",
    source: { type: "local", path: stdioMcpPath },
  });
  const stdioProbed = api.probeApplication(stdioApp.id);
  assert.equal(stdioProbed.probe.autoRegisteredMcpAgentId, "agt_app_fleet_stdio_mcp_mcp");
  assert(api.getTool("fleet_stdio.render_markdown")?.mcp?.agentId === "agt_app_fleet_stdio_mcp_mcp", "stdio MCP shared tool should be registered");
  ok("stdio MCP Application auto-registered shared tools");

  const httpSuccessApp = api.registerApplication({
    id: "app_fleet_http_mcp",
    name: "Fleet HTTP MCP",
    source: { type: "local", path: httpMcpSuccessPath },
  });
  const httpInitial = api.probeApplication(httpSuccessApp.id);
  const httpCandidate = httpInitial.probe.mcpServers.find((server) => server.id === "mcp.remote");
  assert.equal(httpCandidate.review.liveProbe.state, "not_run");
  const live = await api.probeApplicationMcpCandidate(httpSuccessApp.id, "mcp.remote", { timeoutMs: 1_000 });
  assert.equal(live.liveProbe.state, "succeeded");
  assert.deepEqual(live.liveProbe.matchedAllowedTools, ["render_markdown"]);
  const requestedConfirm = api.confirmApplicationMcpCandidate(httpSuccessApp.id, "mcp.remote");
  assert.equal(requestedConfirm.status, 202);
  assert(requestedConfirm.body.approvalRequestId, "HTTP MCP confirmation should request local approval");
  const approval = approveApprovalRequest(state, requestedConfirm.body.approvalRequestId);
  const confirmedHttp = api.confirmApplicationMcpCandidate(httpSuccessApp.id, "mcp.remote", { approvalRequestId: approval.id });
  assert.equal(confirmedHttp.status, 200);
  assert(api.getTool("fleet_http.render_markdown")?.mcp?.agentId === "agt_app_fleet_http_mcp_mcp", "HTTP MCP shared tool should be registered after live probe");
  assert.equal(probeCalls.length, 1, "successful HTTP MCP probe should call the synthetic probe runner");
  assert.equal(JSON.stringify(confirmedHttp.candidate).includes("secret"), false, "HTTP MCP public candidate snapshot should stay redacted");
  ok("HTTP MCP Application live-probed and confirmed");

  const httpBlockedApp = api.registerApplication({
    id: "app_fleet_http_blocked",
    name: "Fleet HTTP Blocked",
    source: { type: "local", path: httpMcpBlockedPath },
  });
  api.probeApplication(httpBlockedApp.id);
  const blocked = await api.probeApplicationMcpCandidate(httpBlockedApp.id, "mcp.remote", { timeoutMs: 1_000 });
  assert.equal(blocked.status, 422);
  assert.equal(blocked.body.error, "mcp_http_live_probe_network_blocked");
  assert.equal(blocked.body.liveProbe.state, "blocked");
  assert.equal(api.findApplication(httpBlockedApp.id).probe.mcpServers[0].review.liveProbe.state, "blocked");
  assert.equal(probeCalls.length, 1, "blocked HTTP MCP probe should not call the synthetic probe runner");
  ok("HTTP MCP blocked endpoint records persistent recovery evidence");

  const manualApp = api.registerApplication({
    id: "app_fleet_manual",
    name: "Fleet Manual",
    source: {
      type: "manual",
      uri: "manual:fleet",
      manifest: {
        capabilities: [{
          id: "sync",
          displayName: "Manual sync",
          riskLevel: "medium",
          description: "Declared manual sync capability.",
        }],
      },
    },
  });
  const manualProbed = api.probeApplication(manualApp.id);
  assert(manualProbed.probe.capabilities.some((capability) => capability.name === "app.app_fleet_manual.declared.sync" && capability.source === "declared"), "manual manifest declared capability should be probed");
  ok("manual manifest Application projected declared probe evidence");

  seedFailingApplicationAutomation(state, wrapperApp.id);
  const readModel = api.publicState();
  const apps = new Map(readModel.applications.map((application) => [application.id, application]));
  assert.equal(apps.size >= 5, true, "mixed fleet read model should include all registered Applications");
  assert.equal(apps.get(wrapperApp.id).healthSummary.automationCounts.failing, 1);
  assert.equal(apps.get(wrapperApp.id).healthSummary.latestAutomationAttention.latestInvocationId, "inv_fleet_wrapper_failed");
  assert.equal(apps.get(httpBlockedApp.id).probe.mcpServers[0].review.liveProbe.state, "blocked");
  assert.equal(apps.get(httpSuccessApp.id).mcpAgent.agentId, "agt_app_fleet_http_mcp_mcp");
  assert.equal(apps.get(stdioApp.id).mcpAgent.agentId, "agt_app_fleet_stdio_mcp_mcp");
  assert(apps.get(manualApp.id).probe.capabilities.some((capability) => capability.source === "declared"), "manual Application should survive public read model");
  assert(readModel.automations.some((automation) => automation.healthSummary.status === "failing"), "automation health should be projected in public state");
  ok("mixed fleet public read model exposes health, MCP, and manual evidence");

  savePersistentState();
  const restarted = runtime({
    projectPath,
    stateStorePath,
    persistenceEnabled: true,
    applicationMcpProbeServer: async () => {
      throw new Error("restart verification should use restored MCP evidence, not reprobe");
    },
  });
  const restartedState = restarted.api.publicState();
  const restartedApps = new Map(restartedState.applications.map((application) => [application.id, application]));
  assert.equal(restartedApps.get(wrapperApp.id).probe.status, "completed");
  assert(restarted.api.listApplicationCapabilities(wrapperApp.id).some((capability) => capability.name === "app.app_fleet_wrapper.wrapper.report"), "wrapper capability should restore after restart");
  assert.equal(restarted.api.getTool("fleet_stdio.render_markdown")?.mcp?.agentId, "agt_app_fleet_stdio_mcp_mcp");
  assert.equal(restarted.api.getTool("fleet_http.render_markdown")?.mcp?.agentId, "agt_app_fleet_http_mcp_mcp");
  assert.equal(restartedApps.get(httpSuccessApp.id).probe.mcpServers[0].review.liveProbe.state, "succeeded");
  assert.equal(restartedApps.get(httpBlockedApp.id).probe.mcpServers[0].review.liveProbe.state, "blocked");
  assert(restartedApps.get(manualApp.id).probe.capabilities.some((capability) => capability.name === "app.app_fleet_manual.declared.sync"), "manual declared probe evidence should restore");
  assert.equal(restartedApps.get(wrapperApp.id).healthSummary.latestAutomationAttention.latestInvocationId, "inv_fleet_wrapper_failed");
  ok("mixed fleet restart restores capabilities, MCP evidence, and health signals");

  console.log(`\napplication-fleet-smoke: ${passed} checks passed`);
} finally {
  if (resolve(tempRoot).startsWith(resolve(tmpdir()))) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runtime({
  projectPath,
  stateStorePath = join(projectPath, ".state.json"),
  persistenceEnabled = false,
  applicationMcpProbeServer,
}) {
  const { defaultProject, state } = createServerState({ defaultProjectPath: projectPath, now });
  state.automations = [];
  const services = createServerRuntimeServices({
    namespace: "fleet-smoke",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: projectPath,
    persistenceEnabled,
    stateStorePath,
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
    applicationMcpProbeServer,
  });
  return { defaultProject, state, api: services.httpDependencies, savePersistentState: services.savePersistentState };
}

function createLocalPackage(root) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "@scope/fleet-wrapper",
    version: "1.0.0",
    scripts: { report: "node report.mjs" },
  }, null, 2), "utf8");
  writeFileSync(join(root, "report.mjs"), "console.log(JSON.stringify({ marker: 'fleet-wrapper' }));\n", "utf8");
}

function createStdioMcpApp(root) {
  mkdirSync(join(root, ".vscode"), { recursive: true });
  writeFileSync(join(root, "server.mjs"), "export {};\n", "utf8");
  writeFileSync(join(root, ".vscode", "mcp.json"), JSON.stringify({
    servers: {
      md: {
        command: "node",
        args: ["server.mjs"],
        toolNamespace: "fleet_stdio",
        allowedTools: ["render_markdown"],
      },
    },
  }, null, 2), "utf8");
}

function createHttpMcpApp(root, url) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({
    mcpServers: {
      remote: {
        type: "http",
        url,
        toolNamespace: url.includes("127.0.0.1") ? "fleet_blocked" : "fleet_http",
        allowedTools: ["render_markdown"],
      },
    },
  }, null, 2), "utf8");
}

function approveApprovalRequest(state, approvalRequestId) {
  const approval = state.approvalRequests.find((request) => request.id === approvalRequestId);
  assert(approval, "expected pending Application approval request");
  assert.equal(approval.status, "pending");
  approval.status = "approved";
  approval.decidedAt = now();
  approval.decidedBy = "usr_local";
  return approval;
}

function seedFailingApplicationAutomation(state, applicationId) {
  state.automations.unshift({
    id: "atm_fleet_wrapper_failed",
    name: "Fleet wrapper daily",
    enabled: true,
    kind: "application_capability",
    projectId: state.currentProjectId,
    schedule: { kind: "daily", time: "09:00", label: "Daily at 09:00" },
    nextRunAt: "2026-07-08T09:00:00.000Z",
    agentId: "agt_platform_application_wrapper",
    prompt: "Run application capability app.app_fleet_wrapper.wrapper.report.",
    lastRunAt: "2026-07-07T01:00:00.000Z",
    lastInvocationId: "inv_fleet_wrapper_failed",
    runCount: 2,
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T01:00:00.000Z",
    target: {
      type: "application_capability",
      applicationId,
      capabilityName: "app.app_fleet_wrapper.wrapper.report",
      input: {},
    },
  });
  for (const index of [0, 1]) {
    const createdAt = index === 0 ? "2026-07-07T01:01:00.000Z" : "2026-07-07T01:00:00.000Z";
    state.invocations.unshift({
      id: index === 0 ? "inv_fleet_wrapper_failed" : "inv_fleet_wrapper_failed_old",
      status: "failed",
      agentId: "agt_platform_application_wrapper",
      projectId: state.currentProjectId,
      prompt: "Run application capability app.app_fleet_wrapper.wrapper.report.",
      requestedBy: "usr_local",
      createdAt,
      updatedAt: createdAt,
      result: { summary: "Wrapper command exited 1." },
      options: {
        metadata: {
          providerType: "application",
          applicationId,
          capability: "app.app_fleet_wrapper.wrapper.report",
          automationId: "atm_fleet_wrapper_failed",
          automationName: "Fleet wrapper daily",
          scheduled: true,
        },
      },
    });
    state.auditSummaries.unshift({
      id: `aud_fleet_${index}`,
      invocationId: index === 0 ? "inv_fleet_wrapper_failed" : "inv_fleet_wrapper_failed_old",
      status: "failed",
      agentId: "agt_platform_application_wrapper",
      errorSummary: "Wrapper command exited 1.",
      createdAt,
      updatedAt: createdAt,
      metadata: {
        applicationId,
        automationId: "atm_fleet_wrapper_failed",
      },
    });
  }
}
