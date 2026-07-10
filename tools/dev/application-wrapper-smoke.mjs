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
const mcpApplicationPath = join(tempRoot, "stdio-mcp-app");
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
createStdioMcpApp(mcpApplicationPath);

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
  const initialState = await request("GET", "/api/state");
  const smokeProjectId = initialState.currentProject?.id ?? initialState.currentProjectId;
  assert(smokeProjectId, "smoke project id should be available");

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
          id: "report",
          displayName: "Generic wrapper report",
          commandType: "custom",
          command: "node",
          args: ["smoke-wrapper.mjs", "--report"],
          cwd: ".",
          status: "approved",
          riskLevel: "low",
          requiresApproval: false,
          filePolicy: "read_only",
          networkPolicy: "forbidden",
          timeoutSeconds: 20,
          argInputs: [
            { key: "since", flag: "--since", type: "date" },
            { key: "timezone", flag: "--timezone", type: "token" },
          ],
        }, {
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
        }, {
          id: "draft",
          displayName: "Draft wrapper smoke",
          commandType: "custom",
          command: "node",
          args: ["smoke-wrapper.mjs", "--draft"],
          cwd: ".",
          status: "draft",
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
  const reportCapability = `app.${registered.application.id}.wrapper.report`;
  assert(registered.capabilities.some((item) => item.name === capability), "generic wrapper capability should be projected");
  assert(registered.capabilities.some((item) => item.name === reportCapability), "read-only wrapper capability should be projected");
  assert(!registered.capabilities.some((item) => item.name.endsWith(".wrapper.draft")), "draft wrapper command should not be projected");
  ok("generic npm Application registered with approved and draft commands");

  const mcpRegistered = await request("POST", "/api/applications/register", {
    id: "app_wrapper_smoke_mcp",
    name: "Wrapper Smoke MCP",
    source: { type: "local", path: mcpApplicationPath },
  });
  const mcpProbed = await request("POST", `/api/applications/${encodeURIComponent(mcpRegistered.application.id)}/probe`, {});
  const mcpSharedTools = (mcpProbed.application.probe?.mcpServers ?? []).flatMap((item) => item.sharedToolNames ?? []);
  assert(mcpProbed.application.mcpAgent?.agentId === "agt_app_wrapper_smoke_mcp_mcp", "stdio MCP Application should auto-register an MCP agent in the live fleet");
  assert(mcpSharedTools.includes("wrapper_smoke_mcp.render_markdown"), "stdio MCP Application should publish shared tool evidence in the live fleet");
  const toolRegistry = await request("GET", "/api/tools");
  const mcpRenderTool = toolRegistry.tools.find((tool) =>
    tool.source === "mcp_agent"
    && tool.mcp?.agentId === "agt_app_wrapper_smoke_mcp_mcp"
    && tool.mcp?.toolName === "render_markdown");
  assert(mcpRenderTool, "stdio MCP Application should publish an invokable tool facade in the live fleet");
  const manualRegistered = await request("POST", "/api/applications/register", {
    id: "app_wrapper_smoke_manual",
    name: "Wrapper Smoke Manual",
    source: {
      type: "manual",
      uri: "manual:wrapper-smoke",
      manifest: {
        capabilities: [{
          id: "sync",
          displayName: "Manual sync",
          riskLevel: "medium",
          description: "Declared manual smoke capability.",
        }],
      },
    },
  });
  const manualProbed = await request("POST", `/api/applications/${encodeURIComponent(manualRegistered.application.id)}/probe`, {});
  assert(
    manualProbed.application.probe?.capabilities?.some((item) => item.name === "app.app_wrapper_smoke_manual.declared.sync" && item.source === "declared"),
    "manual declared capability should appear as probe evidence in the live fleet",
  );
  ok("mixed live fleet includes npm wrapper, stdio MCP, and manual Applications");

  const mcpRenderInvocation = await request("POST", `/api/tools/${encodeURIComponent(mcpRenderTool.name)}/invocations`, {
    projectId: smokeProjectId,
    markdown: "# Mixed fleet MCP\n\nRendered through the live Desktop Bridge.",
    theme: "github",
  });
  assert(mcpRenderInvocation.status === "queued", "stdio MCP render invocation should queue for Desktop Bridge");
  assert(mcpRenderInvocation.agentId === "agt_app_wrapper_smoke_mcp_mcp", "stdio MCP render should target the Application MCP agent");
  ok("stdio MCP render invocation queued through the live fleet");

  const reportInvocation = await request("POST", `/api/capabilities/${reportCapability}/invocations`, {
    projectId: smokeProjectId,
    since: "2026-07-01",
    timezone: "Asia/Shanghai",
  });
  assert(reportInvocation.status === "queued", "read-only wrapper call should queue without approval");
  assert(reportInvocation.agentId === "agt_platform_application_wrapper", "read-only wrapper invocation should target the platform wrapper runner");
  ok("read-only wrapper invocation queued without approval");

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
    const reportRun = state.invocations.find((item) => item.id === reportInvocation.invocationId);
    const mcpRenderRun = state.invocations.find((item) => item.id === mcpRenderInvocation.invocationId);
    if (invocation?.status === "succeeded" && reportRun?.status === "succeeded" && mcpRenderRun?.status === "succeeded") return state;
    for (const candidate of [invocation, reportRun, mcpRenderRun]) {
      if (["failed", "cancelled", "timed_out", "expired", "rejected"].includes(candidate?.status)) {
        throw new Error(`Generic wrapper invocation ended unexpectedly: ${candidate.status} ${JSON.stringify(candidate.result)}`);
      }
    }
    return false;
  }, "Desktop Bridge generic wrapper execution", 15_000);
  const completed = finalState.invocations.find((item) => item.id === invoked.invocationId);
  const completedReport = finalState.invocations.find((item) => item.id === reportInvocation.invocationId);
  const completedMcpRender = finalState.invocations.find((item) => item.id === mcpRenderInvocation.invocationId);
  const report = completed.result?.output?.report;
  const readOnlyReport = completedReport.result?.output?.report;
  assert(report?.marker === "generic-npm-application-wrapper-smoke", "runner should execute the generic wrapper command");
  assert(report?.cwd === resolve(applicationPath), "wrapper command should run in the Application install path");
  assert(report?.argv?.includes("--from-wrapper"), "server-resolved wrapper args should reach the child command");
  assert(readOnlyReport?.argv?.includes("--report"), "read-only wrapper args should reach the child command");
  assert(readOnlyReport?.argv?.includes("--since"), "declared wrapper argInputs should reach the child command");
  assert(readOnlyReport?.argv?.includes("2026-07-01"), "declared date argInput value should reach the child command");
  assert(readOnlyReport?.argv?.includes("--timezone"), "declared timezone argInput should reach the child command");
  assert(readOnlyReport?.argv?.includes("Asia/Shanghai"), "declared timezone value should reach the child command");
  assert(!readOnlyReport?.argv?.includes(smokeProjectId), "projectId is control-plane metadata and must not become argv");
  assert(completed.options?.metadata?.applicationWrapper?.execCommand === "node", "metadata should carry the resolved command");
  assert(completedReport.options?.metadata?.projectId === smokeProjectId, "projectId control field should remain in invocation metadata");
  ok("wrapper argInputs and projectId control metadata boundary verified");
  assert(completedMcpRender.result?.renderMarkdown?.resultRef?.type === "application_render_result", "live MCP render should import an Application render result");
  assert(
    finalState.applicationRenderResults?.some((item) =>
      item.id === completedMcpRender.result.renderMarkdown.resultRef.id
      && item.applicationId === mcpRegistered.application.id
      && item.htmlSummary?.includes("Mixed fleet MCP")),
    "mixed fleet public state should expose the live MCP render result summary",
  );
  ok("Desktop Bridge executed stdio MCP Application and imported a render result");
  assert(
    finalState.events.some((event) => event.invocationId === invoked.invocationId && event.type === "invocation_succeeded"),
    "completion should record invocation_succeeded evidence",
  );
  const appsById = new Map(finalState.applications.map((application) => [application.id, application]));
  assert(
    [invoked.invocationId, reportInvocation.invocationId].includes(appsById.get(registered.application.id)?.latestResult?.invocationId),
    "wrapper Application latest result should point to a bridge-executed invocation",
  );
  assert(appsById.get(mcpRegistered.application.id)?.mcpAgent?.agentId === "agt_app_wrapper_smoke_mcp_mcp", "MCP Application should remain in the live public read model");
  assert(
    appsById.get(manualRegistered.application.id)?.probe?.capabilities?.some((item) => item.name === "app.app_wrapper_smoke_manual.declared.sync"),
    "manual Application declared probe evidence should remain in the live public read model",
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

function createStdioMcpApp(root) {
  mkdirSync(join(root, ".vscode"), { recursive: true });
  writeFileSync(join(root, "server.mjs"), stdioMcpFixtureServerSource(), "utf8");
  writeFileSync(join(root, ".vscode", "mcp.json"), JSON.stringify({
    servers: {
      md: {
        command: "node",
        args: ["server.mjs"],
        toolNamespace: "wrapper_smoke_mcp",
        allowedTools: ["render_markdown"],
        toolSchemas: {
          render_markdown: {
            type: "object",
            required: ["markdown"],
            properties: {
              markdown: { type: "string" },
              theme: { type: "string" },
            },
            additionalProperties: false,
          },
        },
      },
    },
  }, null, 2), "utf8");
}

function stdioMcpFixtureServerSource() {
  return `
const tools = [{
  name: "render_markdown",
  description: "Render Markdown.",
  inputSchema: {
    type: "object",
    required: ["markdown"],
    properties: {
      markdown: { type: "string" },
      theme: { type: "string" }
    },
    additionalProperties: false
  }
}];

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
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "wrapper-smoke-mcp", version: "0.0.0" }
      }
    });
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools } });
    return;
  }
  if (message.method === "tools/call") {
    const args = message.params?.arguments ?? {};
    const markdown = String(args.markdown ?? "");
    const heading = markdown.match(/^#\\s+(.+)$/m)?.[1] ?? "Untitled";
    const theme = String(args.theme ?? "default");
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{
          type: "text",
          text: '<article data-theme="' + theme + '"><h1>' + heading + '</h1><p>Rendered through the live Desktop Bridge.</p></article>'
        }]
      }
    });
  }
}
`;
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
