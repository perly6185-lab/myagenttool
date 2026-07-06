import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { callMcpTool } from "../../desktop/src/mcp-client.mjs";
import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerRuntimeServices } from "../src/runtime/service-composer.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { sameProjectPath } from "../src/services/projects.mjs";

const now = () => "2026-07-05T00:00:00.000Z";

function runtime({ projectPath, stateStorePath = join(projectPath, ".state.json"), persistenceEnabled = false }) {
  const { defaultProject, state } = createServerState({ defaultProjectPath: projectPath, now });
  return {
    defaultProject,
    state,
    api: createServerRuntimeServices({
      namespace: "test",
      protocolVersion: "0.0.0",
      state,
      defaultProject,
      defaultProjectPath: projectPath,
      persistenceEnabled,
      stateStorePath,
      stateSchemaVersion: 1,
      dispatchLeaseMs: 30_000,
      now,
    }).httpDependencies,
  };
}

function doocsRegistration(projectPath) {
  return {
    id: "app_doocs_md",
    name: "doocs/md",
    source: { type: "local", path: projectPath },
    mcpAgent: {
      transport: "stdio",
      command: "node",
      args: ["packages/mcp-server/run.mjs"],
      allowedTools: ["render_markdown", "list_themes"],
      riskTags: ["local_execution", "mcp", "markdown_rendering"],
    },
  };
}

function writeDoocsMcpFixture(projectPath) {
  mkdirSync(join(projectPath, ".vscode"), { recursive: true });
  mkdirSync(join(projectPath, "packages", "mcp-server", "src"), { recursive: true });
  writeFileSync(join(projectPath, "package.json"), JSON.stringify({
    name: "md",
    version: "2.1.0",
    scripts: {
      mcp: "pnpm --filter @md/mcp-server",
    },
  }, null, 2), "utf8");
  writeFileSync(join(projectPath, ".vscode", "mcp.json"), JSON.stringify({
    servers: {
      md: {
        type: "stdio",
        command: "node",
        args: ["--import", "tsx/esm", "${workspaceFolder}/packages/mcp-server/run.mjs"],
        cwd: "${workspaceFolder}/packages/mcp-server",
      },
    },
  }, null, 2), "utf8");
  writeFileSync(join(projectPath, "packages", "mcp-server", "package.json"), JSON.stringify({
    name: "@md/mcp-server",
    scripts: {
      start: "node --import tsx/esm run.mjs",
    },
  }, null, 2), "utf8");
  writeFileSync(join(projectPath, "packages", "mcp-server", "run.mjs"), "import('./src/index.ts')\n", "utf8");
  writeFileSync(join(projectPath, "packages", "mcp-server", "src", "index.ts"), [
    "server.registerTool(`render_markdown`, {}, async () => ({}))",
    "server.registerTool(`list_themes`, {}, async () => ({}))",
    "server.registerTool(`list_colors`, {}, async () => ({}))",
  ].join("\n"), "utf8");
}

function writeExecutableDoocsMcpFixture(projectPath) {
  mkdirSync(join(projectPath, ".vscode"), { recursive: true });
  mkdirSync(join(projectPath, "packages", "mcp-server", "src"), { recursive: true });
  writeFileSync(join(projectPath, "package.json"), JSON.stringify({
    name: "md",
    version: "2.1.0",
  }, null, 2), "utf8");
  writeFileSync(join(projectPath, ".vscode", "mcp.json"), JSON.stringify({
    servers: {
      md: {
        type: "stdio",
        command: process.execPath,
        args: ["${workspaceFolder}/packages/mcp-server/run.mjs"],
        cwd: "${workspaceFolder}/packages/mcp-server",
      },
    },
  }, null, 2), "utf8");
  writeFileSync(join(projectPath, "packages", "mcp-server", "run.mjs"), doocsMcpFixtureServerSource(), "utf8");
  writeFileSync(join(projectPath, "packages", "mcp-server", "src", "index.ts"), [
    "server.registerTool(`render_markdown`, {}, async () => ({}))",
    "server.registerTool(`list_themes`, {}, async () => ({}))",
  ].join("\n"), "utf8");
}

function doocsMcpFixtureServerSource() {
  return `
const tools = [
  { name: "render_markdown", description: "Render Markdown.", inputSchema: { type: "object" } },
  { name: "list_themes", description: "List themes.", inputSchema: { type: "object" } },
];

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  const lines = buffer.split("\\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    handle(JSON.parse(line));
  }
});

function handle(message) {
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "doocs-md-fixture", version: "0.0.0" } } });
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools } });
    return;
  }
  if (message.method === "tools/call") {
    const name = message.params?.name;
    if (name === "list_themes") {
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "github\\nvuepress" }] } });
      return;
    }
    const args = message.params?.arguments ?? {};
    const markdown = String(args.markdown ?? "");
    const heading = markdown.match(/^#\\s+(.+)$/m)?.[1] ?? "Untitled";
    const theme = String(args.theme ?? "default");
    send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: '<article data-theme="' + theme + '"><h1>' + heading + '</h1></article>' }] } });
  }
}
`;
}

async function removeTreeEventually(path) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(error?.code)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  rmSync(path, { recursive: true, force: true });
}

async function startHttpMcpFixture(tools = [{ name: "render_markdown" }]) {
  const sessionId = "sess-application-http-mcp";
  const requests = [];
  const server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const message = JSON.parse(body);
      requests.push({ url: req.url, method: message.method, sessionId: req.headers["mcp-session-id"] ?? null });
      const json = (payload, headers = {}) => {
        res.writeHead(200, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(payload));
      };
      if (message.method === "initialize") {
        json({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: message.params?.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "application-http-fixture", version: "0.0.0" },
          },
        }, { "mcp-session-id": sessionId });
        return;
      }
      if (req.headers["mcp-session-id"] !== sessionId) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id ?? null, error: { message: "missing session id" } }));
        return;
      }
      if (message.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      if (message.method === "tools/list") {
        json({ jsonrpc: "2.0", id: message.id, result: { tools } });
        return;
      }
      json({ jsonrpc: "2.0", id: message.id, error: { message: `unknown method ${message.method}` } });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    requests,
    url: `http://127.0.0.1:${server.address().port}/mcp?token=secret`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("application mcpAgent registers a recoverable MCP agent and shared tools", () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-app-mcp-"));
  const projectPath = join(root, "project");
  mkdirSync(projectPath, { recursive: true });
  try {
    const { api } = runtime({ projectPath });
    const app = api.registerApplication(doocsRegistration(projectPath), { userId: "usr_a", teamId: "team_local" });

    assert.equal(app.mcpAgent.agentId, "agt_app_doocs_md_mcp");
    assert.equal(app.mcpAgent.toolNamespace, "doocs_md");
    assert.deepEqual(app.mcpAgent.sharedToolNames, ["doocs_md.render_markdown", "doocs_md.list_themes"]);

    const agent = api.findAgent(app.mcpAgent.agentId);
    assert.equal(agent?.adapter.type, "mcp");
    assert.equal(agent?.sourceApplicationId, app.id);
    assert.equal(agent?.toolNamespace, "doocs_md");
    assert.deepEqual(agent?.adapter.allowedTools, ["render_markdown", "list_themes"]);

    const tool = api.getTool("doocs_md.render_markdown");
    assert.equal(tool?.source, "mcp_agent");
    assert.equal(tool?.application?.id, app.id);
    assert.equal(tool?.mcp?.agentId, agent.id);
    assert.equal(tool?.mcp?.toolName, "render_markdown");

    const capability = api.getCapability("doocs_md.render_markdown", { userId: "usr_a", teamId: "team_local" });
    assert.equal(capability?.provider?.type, "tool");
    assert.equal(capability?.source, "mcp_agent");
    assert.equal(JSON.stringify(capability).includes("packages/mcp-server/run.mjs"), false);

    assert.equal(api.getTool("doocs_md.render_markdown", { userId: "usr_b", teamId: "team_other" }), null);
    assert.equal(api.getCapability("doocs_md.render_markdown", { userId: "usr_b", teamId: "team_other" }), null);
    assert.equal(
      api.state.events.some((event) =>
        event.type === "application_mcp_agent_recovered"
        && event.data?.applicationId === app.id
        && event.data?.startup === false),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("application probe autodetects a doocs/md MCP server and registers shared tools", () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-app-mcp-discovery-"));
  const projectPath = join(root, "doocs-md");
  mkdirSync(projectPath, { recursive: true });
  writeDoocsMcpFixture(projectPath);
  try {
    const { api } = runtime({ projectPath });
    const actor = { userId: "usr_a", teamId: "team_local" };
    const app = api.registerApplication({
      id: "app_doocs_md_auto",
      name: "doocs/md",
      source: { type: "local", path: projectPath },
    }, actor);

    assert.equal(app.mcpAgent, null);
    assert.equal(api.getTool("doocs_md.render_markdown", actor), null);

    const probed = api.probeApplication(app.id, actor);
    assert.equal(probed.probe.mcpServers.length, 1);
    assert.equal(probed.probe.mcpServers[0].serverName, "md");
    assert.deepEqual(probed.probe.mcpServers[0].allowedTools, ["render_markdown", "list_themes", "list_colors"]);
    assert.equal(probed.probe.mcpServers[0].confidence, "high");
    assert.equal(probed.probe.mcpServers[0].autoRegisterReason, "node_entrypoint_inside_application_root");
    assert.equal(probed.probe.autoRegisteredMcpAgentId, "agt_app_doocs_md_auto_mcp");
    assert.equal(probed.mcpAgent.agentId, "agt_app_doocs_md_auto_mcp");
    assert.deepEqual(probed.mcpAgent.sharedToolNames, ["doocs_md.render_markdown", "doocs_md.list_themes", "doocs_md.list_colors"]);

    const agent = api.findAgent("agt_app_doocs_md_auto_mcp");
    assert.equal(agent?.sourceApplicationId, app.id);
    assert.equal(agent?.adapter.command, "node");
    assert.deepEqual(agent?.adapter.allowedTools, ["render_markdown", "list_themes", "list_colors"]);
    assert.equal(agent?.adapter.args.some((arg) => arg.endsWith("packages\\mcp-server\\run.mjs") || arg.endsWith("packages/mcp-server/run.mjs")), true);

    const tool = api.getTool("doocs_md.render_markdown", actor);
    assert.equal(tool?.source, "mcp_agent");
    assert.equal(tool?.mcp?.agentId, "agt_app_doocs_md_auto_mcp");
    assert.equal(tool?.mcp?.toolName, "render_markdown");
    assert.equal(JSON.stringify(tool).includes("run.mjs"), false);
    assert.equal(
      api.state.events.some((event) =>
        event.type === "application_mcp_agent_recovered"
        && event.data?.applicationId === app.id
        && event.data?.sharedToolNames?.includes("doocs_md.render_markdown")),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("application MCP tool calls doocs/md render_markdown and records result evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-app-mcp-render-"));
  const projectPath = join(root, "doocs-md");
  mkdirSync(projectPath, { recursive: true });
  writeExecutableDoocsMcpFixture(projectPath);
  try {
    const { api } = runtime({ projectPath });
    const actor = { userId: "usr_a", teamId: "team_local" };
    const app = api.registerApplication({
      id: "app_doocs_md_render",
      name: "doocs/md",
      source: { type: "local", path: projectPath },
    }, actor);
    api.probeApplication(app.id, actor);

    const created = api.createCapabilityInvocation("doocs_md.render_markdown", {
      markdown: "# Hello",
      theme: "github",
    }, actor);
    assert.equal(created.status, 201);
    const invocation = api.findInvocation(created.body.invocationId);
    assert(invocation, "MCP capability should create an invocation");
    const agent = api.findAgent(invocation.agentId);
    assert(agent, "MCP capability should resolve an agent");

    const outcome = await callMcpTool({
      adapter: agent.adapter,
      task: invocation.input.task,
      options: invocation.options,
    });
    assert.equal(outcome.status, "succeeded", outcome.summary);
    assert.match(outcome.result.output, /<h1>Hello<\/h1>/);

    api.completeInvocation(invocation, outcome);
    assert.equal(invocation.status, "succeeded");
    assert.equal(invocation.options.metadata.applicationId, app.id);
    assert.equal(invocation.options.metadata.mcpToolName, "render_markdown");
    assert.equal(invocation.result.applicationResult.applicationId, app.id);
    assert.equal(invocation.result.applicationResult.capability, "doocs_md.render_markdown");
    assert.equal(invocation.result.applicationResult.mcpToolName, "render_markdown");

    const recordedApp = api.findApplication(app.id);
    assert.equal(recordedApp.latestResult.invocationId, invocation.id);
    assert.equal(recordedApp.latestResult.outputCollection, "invocations");

    const audit = api.state.auditSummaries.find((item) => item.invocationId === invocation.id);
    assert.equal(audit?.applicationResult?.mcpToolName, "render_markdown");
    const publicState = api.publicState(actor);
    const evidence = publicState.evidenceCenterRecords.find((item) => item.id === `${invocation.id}:application_result`);
    assert.equal(evidence?.source, "application_capability_result");
    assert.match(evidence?.summary ?? "", /doocs_md\.render_markdown/);
  } finally {
    await removeTreeEventually(root);
  }
});

test("application MCP probe keeps manual-confirm candidates while auto-registering only high confidence", () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-app-mcp-confidence-"));
  const projectPath = join(root, "doocs-md");
  mkdirSync(join(projectPath, ".vscode"), { recursive: true });
  mkdirSync(join(projectPath, "packages", "mcp-server", "src"), { recursive: true });
  writeFileSync(join(projectPath, "packages", "mcp-server", "run.mjs"), "process.exit(0)\n", "utf8");
  writeFileSync(join(projectPath, "packages", "mcp-server", "src", "index.ts"), [
    "server.registerTool(`render_markdown`, {}, async () => ({}))",
  ].join("\n"), "utf8");
  writeFileSync(join(projectPath, ".vscode", "mcp.json"), JSON.stringify({
    servers: {
      md: {
        type: "stdio",
        command: "node",
        args: ["${workspaceFolder}/packages/mcp-server/run.mjs"],
      },
      shell: {
        type: "stdio",
        command: process.platform === "win32" ? "cmd.exe" : "sh",
        args: ["${workspaceFolder}/packages/mcp-server/run.mjs"],
        allowedTools: ["render_markdown"],
      },
      remote: {
        type: "http",
        url: "https://example.test/mcp?token=secret",
        allowedTools: ["render_markdown"],
      },
    },
  }, null, 2), "utf8");
  try {
    const { api } = runtime({ projectPath });
    const app = api.registerApplication({
      id: "app_doocs_md_candidates",
      name: "doocs/md",
      source: { type: "local", path: projectPath },
    });
    const probed = api.probeApplication(app.id);
    assert.equal(probed.probe.mcpServers.length, 3);
    const high = probed.probe.mcpServers.find((server) => server.serverName === "md");
    const shell = probed.probe.mcpServers.find((server) => server.serverName === "shell");
    const remote = probed.probe.mcpServers.find((server) => server.serverName === "remote");
    assert.equal(high?.confidence, "high");
    assert.equal(high?.autoRegister, true);
    assert.equal(shell?.autoRegister, false);
    assert.equal(shell?.autoRegisterReason, "stdio_command_requires_manual_confirmation");
    assert.equal(remote?.confidence, "medium");
    assert.equal(remote?.autoRegisterReason, "http_transport_requires_manual_confirmation");
    assert.equal(remote?.adapterPreview?.url, "https://example.test/mcp");
    assert.equal(remote?.review?.dataBoundary, "bridge_to_http_endpoint");
    assert.equal(remote?.review?.endpointOrigin, "https://example.test");
    assert.equal(remote?.review?.endpointHost, "example.test");
    assert.equal(remote?.review?.endpointProtocol, "https");
    assert.equal(remote?.review?.filePolicy, "read_only");
    assert.equal(remote?.review?.networkPolicy, "restricted");
    assert.equal(remote?.review?.allowedToolCount, 1);
    assert.equal(remote?.review?.requiresManualConfirmation, true);
    assert.equal(remote?.review?.liveProbe?.state, "not_run");
    assert.equal(remote?.review?.liveProbe?.requiredBeforeExecution, true);
    assert.equal(remote?.review?.liveProbe?.endpointOrigin, "https://example.test");
    assert.equal(JSON.stringify(remote).includes("secret"), false);
    assert.equal(probed.probe.autoRegisteredMcpAgentId, "agt_app_doocs_md_candidates_mcp");
    assert.deepEqual(probed.mcpAgent.sharedToolNames, ["doocs_md.render_markdown"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("application MCP candidate manual confirmation registers shared tools", () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-app-mcp-manual-confirm-"));
  const projectPath = join(root, "doocs-md");
  mkdirSync(join(projectPath, ".vscode"), { recursive: true });
  mkdirSync(join(projectPath, "packages", "mcp-server"), { recursive: true });
  writeFileSync(join(projectPath, "packages", "mcp-server", "run.mjs"), "process.exit(0)\n", "utf8");
  writeFileSync(join(projectPath, ".vscode", "mcp.json"), JSON.stringify({
    servers: {
      shell: {
        type: "stdio",
        command: process.platform === "win32" ? "cmd.exe" : "sh",
        args: ["${workspaceFolder}/packages/mcp-server/run.mjs"],
        allowedTools: ["render_markdown"],
      },
    },
  }, null, 2), "utf8");
  try {
    const { api } = runtime({ projectPath });
    const actor = { userId: "usr_a", teamId: "team_local" };
    const app = api.registerApplication({
      id: "app_doocs_md_manual",
      name: "doocs/md",
      source: { type: "local", path: projectPath },
    }, actor);
    const probed = api.probeApplication(app.id, actor);
    const candidate = probed.probe.mcpServers.find((server) => server.id === "mcp.shell");
    assert(candidate, "manual-confirm MCP candidate should be visible after probe");
    assert.equal(candidate.autoRegister, false);
    assert.equal(candidate.autoRegisterReason, "stdio_command_requires_manual_confirmation");
    assert.equal(api.findAgent("agt_app_doocs_md_manual_mcp"), undefined);

    const requested = api.confirmApplicationMcpCandidate(app.id, "mcp.shell", {}, actor);
    assert.equal(requested.status, 202);
    assert.equal(requested.body.status, "waiting_for_local_approval");
    assert.ok(requested.body.approvalRequestId);

    const approval = api.findApprovalRequest(requested.body.approvalRequestId);
    const approvalInvocation = api.findInvocation(approval.invocationId);
    api.approveInvocation(approval, approvalInvocation, actor);

    const confirmed = api.confirmApplicationMcpCandidate(app.id, "mcp.shell", { approvalRequestId: requested.body.approvalRequestId }, actor);
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.application.mcpAgent.discovery.manualConfirmed, true);
    assert.equal(confirmed.application.mcpAgent.discovery.autoRegistered, false);
    assert.deepEqual(confirmed.application.mcpAgent.sharedToolNames, ["doocs_md.render_markdown"]);

    const agent = api.findAgent("agt_app_doocs_md_manual_mcp");
    assert.equal(agent?.sourceApplicationId, app.id);
    assert.equal(agent?.adapter.command, process.platform === "win32" ? "cmd.exe" : "sh");
    assert.equal(api.getTool("doocs_md.render_markdown", actor)?.mcp?.agentId, agent.id);
    assert.equal(
      api.state.events.some((event) =>
        event.type === "application_mcp_candidate_confirmed"
        && event.data?.candidateId === "mcp.shell"),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("application HTTP MCP candidate requires live-probe evidence before confirmation", () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-app-mcp-http-confirm-"));
  const projectPath = join(root, "doocs-md");
  mkdirSync(join(projectPath, ".vscode"), { recursive: true });
  writeFileSync(join(projectPath, ".vscode", "mcp.json"), JSON.stringify({
    servers: {
      remote: {
        type: "http",
        url: "https://example.test/mcp?token=secret",
        allowedTools: ["render_markdown"],
      },
    },
  }, null, 2), "utf8");
  try {
    const { api } = runtime({ projectPath });
    const actor = { userId: "usr_a", teamId: "team_local" };
    const app = api.registerApplication({
      id: "app_doocs_md_http_manual",
      name: "doocs/md",
      source: { type: "local", path: projectPath },
    }, actor);
    const probed = api.probeApplication(app.id, actor);
    const candidate = probed.probe.mcpServers.find((server) => server.id === "mcp.remote");
    assert.equal(candidate?.review?.liveProbe?.state, "not_run");
    assert.equal(candidate?.review?.liveProbe?.requiredBeforeExecution, true);

    const requested = api.confirmApplicationMcpCandidate(app.id, "mcp.remote", {}, actor);
    assert.equal(requested.status, 202);
    const approval = api.findApprovalRequest(requested.body.approvalRequestId);
    const approvalInvocation = api.findInvocation(approval.invocationId);
    api.approveInvocation(approval, approvalInvocation, actor);

    const confirmed = api.confirmApplicationMcpCandidate(app.id, "mcp.remote", { approvalRequestId: requested.body.approvalRequestId }, actor);
    assert.equal(confirmed.status, 409);
    assert.equal(confirmed.body.error, "mcp_http_live_probe_required");
    assert.equal(confirmed.body.liveProbe.state, "not_run");
    assert.equal(confirmed.body.candidate.review.liveProbe.endpointOrigin, "https://example.test");
    assert.equal(JSON.stringify(confirmed.body).includes("secret"), false);
    assert.equal(api.findApplication(app.id).mcpAgent, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("application HTTP MCP candidate live probe records evidence and enables confirmation", async () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-app-mcp-http-live-"));
  const projectPath = join(root, "doocs-md");
  const fixture = await startHttpMcpFixture([
    { name: "render_markdown", description: "Render Markdown.", inputSchema: { type: "object" } },
    { name: "list_themes", description: "List themes.", inputSchema: { type: "object" } },
  ]);
  mkdirSync(join(projectPath, ".vscode"), { recursive: true });
  writeFileSync(join(projectPath, ".vscode", "mcp.json"), JSON.stringify({
    servers: {
      remote: {
        type: "http",
        url: fixture.url,
        allowedTools: ["render_markdown"],
      },
    },
  }, null, 2), "utf8");
  try {
    const { api } = runtime({ projectPath });
    const actor = { userId: "usr_a", teamId: "team_local" };
    const app = api.registerApplication({
      id: "app_doocs_md_http_live",
      name: "doocs/md",
      source: { type: "local", path: projectPath },
    }, actor);
    const probed = api.probeApplication(app.id, actor);
    assert.equal(probed.probe.mcpServers[0].review.liveProbe.state, "not_run");

    const live = await api.probeApplicationMcpCandidate(app.id, "mcp.remote", { timeoutMs: 5_000 }, actor);
    assert.equal(live.status, 200);
    assert.equal(live.liveProbe.state, "succeeded");
    assert.equal(live.liveProbe.evidence, "json_rpc_initialize_tools_list");
    assert.equal(live.liveProbe.toolCount, 2);
    assert.deepEqual(live.liveProbe.matchedAllowedTools, ["render_markdown"]);
    assert.deepEqual(live.liveProbe.missingAllowedTools, []);
    assert.equal(live.candidate.review.liveProbe.state, "succeeded");
    assert.equal(live.candidate.adapterPreview.url.startsWith("http://127.0.0.1:"), true);
    assert.equal(JSON.stringify(live).includes("secret"), false);
    assert.equal(fixture.requests.some((request) => request.method === "tools/list" && request.sessionId), true);

    const recorded = api.findApplication(app.id).probe.mcpServers.find((server) => server.id === "mcp.remote");
    assert.equal(recorded.review.liveProbe.state, "succeeded");
    const reprobed = api.probeApplication(app.id, actor);
    assert.equal(reprobed.probe.mcpServers.find((server) => server.id === "mcp.remote").review.liveProbe.state, "succeeded");

    const requested = api.confirmApplicationMcpCandidate(app.id, "mcp.remote", {}, actor);
    assert.equal(requested.status, 202);
    const approval = api.findApprovalRequest(requested.body.approvalRequestId);
    const approvalInvocation = api.findInvocation(approval.invocationId);
    api.approveInvocation(approval, approvalInvocation, actor);

    const confirmed = api.confirmApplicationMcpCandidate(app.id, "mcp.remote", { approvalRequestId: requested.body.approvalRequestId }, actor);
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.application.mcpAgent.discovery.manualConfirmed, true);
    assert.deepEqual(confirmed.application.mcpAgent.sharedToolNames, ["doocs_md.render_markdown"]);
    assert.equal(api.getTool("doocs_md.render_markdown", actor)?.mcp?.agentId, "agt_app_doocs_md_http_live_mcp");
    assert.equal(JSON.stringify(confirmed.candidate).includes("secret"), false);
  } finally {
    await fixture.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("application mcpAgent restores shared tools when the agent row is missing after restart", () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-app-mcp-restore-"));
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  try {
    const first = runtime({ projectPath });
    const app = first.api.registerApplication(doocsRegistration(projectPath), { userId: "usr_a", teamId: "team_local" });
    first.state.agents = first.state.agents.filter((agent) => agent.id !== app.mcpAgent.agentId);
    assert.equal(first.state.agents.some((agent) => agent.id === app.mcpAgent.agentId), false);

    createPersistenceRuntime({
      state: first.state,
      enabled: true,
      stateStorePath,
      schemaVersion: 1,
      now,
      defaultProject: first.defaultProject,
      sameProjectPath,
    }).savePersistentState();

    const second = runtime({ projectPath, stateStorePath, persistenceEnabled: true });
    const restoredApp = second.api.findApplication(app.id);
    const restoredAgent = second.api.findAgent(app.mcpAgent.agentId);

    assert(restoredApp, "application should restore from snapshot");
    assert(restoredAgent, "MCP agent should be recovered from the application descriptor");
    assert.equal(restoredAgent.sourceApplicationId, app.id);
    assert.deepEqual(restoredApp.mcpAgent.sharedToolNames, ["doocs_md.render_markdown", "doocs_md.list_themes"]);
    assert.equal(second.api.getTool("doocs_md.render_markdown")?.mcp?.agentId, restoredAgent.id);
    assert.equal(second.api.getCapability("doocs_md.render_markdown")?.source, "mcp_agent");
    assert.equal(
      second.state.events.some((event) =>
        event.type === "application_mcp_agent_recovered"
        && event.data?.applicationId === app.id
        && event.data?.startup === true),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
