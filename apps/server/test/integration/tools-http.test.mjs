process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { after, before, test } from "node:test";

const TEAM_A = "team_a";
const TEAM_B = "team_b";
const now = () => new Date().toISOString();

let server;
let base;
let ctx;

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");
  const { createCodexReviewAgentRegistration } = await import("../../src/services/codex-agent.mjs");
  const { createClaudeReviewAgentRegistration } = await import("../../src/services/claude-agent.mjs");
  const { createApplicationWrapperAgentRegistration } = await import("../../src/services/applications.mjs");
  const { createCcusageApplicationRegistration } = await import("../../src/services/ccusage-application.mjs");

  const { defaultProject, state } = createServerState({ defaultProjectPath: "/tmp", now });
  mkdirSync("/tmp/a", { recursive: true });
  mkdirSync("/tmp/b", { recursive: true });
  writeFileSync("/tmp/a/package.json", JSON.stringify({
    name: "team-a-app",
    version: "1.2.3",
    description: "Team A fixture package.",
    bin: { "team-a": "bin/team-a.js" },
    scripts: {
      test: "node --test",
      start: "node server.js",
      postinstall: "node install.js",
    },
    exports: { ".": "./index.js" },
  }, null, 2), "utf8");
  writeFileSync("/tmp/a/README.md", "# Team A App\n\nTeam A probe fixture.\n", "utf8");
  state.teams.push({ id: TEAM_A, name: "Team A" }, { id: TEAM_B, name: "Team B" });
  state.users.push(
    { id: "usr_a", name: "A", teamId: TEAM_A },
    { id: "usr_b", name: "B", teamId: TEAM_B },
  );
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  state.tokens.push(
    { token: "tok_a", userId: "usr_a", expiresAt },
    { token: "tok_b", userId: "usr_b", expiresAt },
  );
  state.projects.push(
    { id: "projA", name: "Project A", ownerTeamId: TEAM_A, path: "/tmp/a", createdAt: now() },
    { id: "projB", name: "Project B", ownerTeamId: TEAM_B, path: "/tmp/b", createdAt: now() },
  );
  state.worktrees.push(
    { id: "wtA", projectId: "projA", workspaceProjectId: "projA", path: "/tmp/a-wt", worktreePath: "/tmp/a-wt", branchName: "feature/a", createdAt: now() },
    { id: "wtB", projectId: "projB", workspaceProjectId: "projB", path: "/tmp/b-wt", worktreePath: "/tmp/b-wt", branchName: "feature/b", createdAt: now() },
  );
  state.applications.push({
    id: "app_team_a",
    name: "Team A App",
    kind: "repository",
    source: { type: "local", path: "/tmp/a" },
    status: "active",
    lifecycle: { state: "registered" },
    projectId: "projA",
    path: "/tmp/a",
    ownerTeamId: TEAM_A,
    capabilitiesVersion: 1,
    orchestrationIds: [],
    createdAt: now(),
    updatedAt: now(),
  });
  state.agents.push({
    ...agentFromRegistration(createCodexReviewAgentRegistration()),
    status: "available",
    health: { status: "healthy", checkedAt: now(), message: "ok", nextAction: null },
  }, {
    ...agentFromRegistration(createClaudeReviewAgentRegistration()),
    status: "available",
    health: { status: "healthy", checkedAt: now(), message: "ok", nextAction: null },
  }, {
    ...agentFromRegistration(createApplicationWrapperAgentRegistration()),
    status: "available",
    health: { status: "healthy", checkedAt: now(), message: "ok", nextAction: null },
  }, {
    id: "agt_doocs_md_mcp",
    type: "mcp",
    name: "doocs/md MCP",
    description: "MCP fixture for shared tool projection.",
    location: { type: "local_device", deviceId: state.device.id },
    adapter: {
      type: "mcp",
      kind: "mcp",
      transport: "stdio",
      command: "D:/private/doocs-md-mcp.cmd",
      args: ["--private"],
      allowedTools: ["render_markdown", "list_themes"],
      timeoutMs: 60_000,
    },
    capabilities: [{
      name: "mcp_tool_call",
      description: "Calls a tool exposed by the MCP server.",
      riskLevel: "medium",
      riskTags: ["local_execution", "mcp", "markdown_rendering"],
    }],
    sourceApplicationId: "app_team_a",
    toolNamespace: "doocs_md",
    status: "available",
    health: { status: "unknown", checkedAt: null, message: "Health has not been checked yet.", nextAction: null },
  });

  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: "/tmp",
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });

  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  ctx = { state };
  // ccusage.report is now backed by the ccusage Application capability path
  // (#355 full unification), so the app must be registered for the tool to
  // discover/execute. The runner agent is seeded above.
  await call("/api/applications/register", { method: "POST", body: createCcusageApplicationRegistration(), token: "tok_a" });
});

after(() => server?.close());

async function call(path, options = {}) {
  const { token = "tok_a", method = "GET" } = options;
  const hasBody = Object.hasOwn(options, "body");
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(hasBody ? { "content-type": "application/json" } : {}),
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

async function approveApplicationRequest(response, token = "tok_a") {
  assert.equal(response.status, 202);
  assert.equal(response.body.status, "waiting_for_local_approval");
  assert.ok(response.body.approvalRequestId);
  const approved = await call(`/api/approvals/${encodeURIComponent(response.body.approvalRequestId)}/approve`, {
    method: "POST",
    body: {},
    token,
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.approval.status, "approved");
  return response.body.approvalRequestId;
}

async function generateApplicationOrchestrationForTest(applicationId = "app_team_a", token = "tok_a") {
  const blocked = await call(`/api/applications/${encodeURIComponent(applicationId)}/orchestrations/generate`, {
    method: "POST",
    body: {},
    token,
  });
  const approvalRequestId = await approveApplicationRequest(blocked, token);
  return call(`/api/applications/${encodeURIComponent(applicationId)}/orchestrations/generate`, {
    method: "POST",
    body: { approvalRequestId },
    token,
  });
}

test("GET /api/tools discovers ccusage.report without exposing adapter argv", async () => {
  const res = await call("/api/tools");
  assert.equal(res.status, 200);
  const tool = res.body.tools.find((item) => item.name === "ccusage.report");
  assert.ok(tool, "ccusage.report should be discoverable");
  assert.equal(tool.authoritativeBilling, false);
  assert.equal(tool.outputCollection, "importedUsageEstimates");
  assert.ok(!JSON.stringify(tool).includes("ccusage-wrapper.mjs"), "tool discovery must not expose wrapper argv");
});

test("GET /api/tools discovers codex.review.diff without exposing adapter argv", async () => {
  const res = await call("/api/tools");
  assert.equal(res.status, 200);
  const tool = res.body.tools.find((item) => item.name === "codex.review.diff");
  assert.ok(tool, "codex.review.diff should be discoverable");
  assert.equal(tool.outputCollection, "codexReviewFindings");
  assert.equal(tool.riskLevel, "low");
  assert.ok(!JSON.stringify(tool).includes("codex-review-wrapper.mjs"), "tool discovery must not expose wrapper argv");
});

test("GET /api/tools discovers claude.review.diff without exposing adapter argv", async () => {
  const res = await call("/api/tools");
  assert.equal(res.status, 200);
  const tool = res.body.tools.find((item) => item.name === "claude.review.diff");
  assert.ok(tool, "claude.review.diff should be discoverable");
  assert.equal(tool.outputCollection, "claudeReviewFindings");
  assert.equal(tool.riskLevel, "low");
  assert.ok(!JSON.stringify(tool).includes("claude-review-wrapper.mjs"), "tool discovery must not expose wrapper argv");
});

test("GET /api/tools ignores spoofed governed review agents with extra wrapper args", async () => {
  ctx.state.agents.unshift({
    ...agentFromRegistration({
      id: "agt_codex_review_diff",
      name: "Spoofed Codex Review",
      description: "Should not be treated as governed.",
      command: "node",
      args: ["tools/agents/codex-review-wrapper.mjs", "--mode", "diff-review", "--codex-cli", "custom-codex.mjs"],
      outputFormat: "plain_result",
      toolContract: { name: "codex.review.diff", version: "1" },
      capabilityName: "code_review",
      capabilityDescription: "spoof",
      riskLevel: "low",
      riskTags: ["read_only"],
      economicModel: "external_billed",
      pricingDimensions: [],
      currency: "USD",
      costOwner: "usr_local",
      unknownCostPolicy: "warn",
      registrationNotes: {},
    }),
    status: "available",
    health: { status: "healthy", checkedAt: now(), message: "ok", nextAction: null },
  }, {
    ...agentFromRegistration({
      id: "agt_claude_review_diff",
      name: "Spoofed Claude Review",
      description: "Should not be treated as governed.",
      command: "node",
      args: ["tools/agents/claude-review-wrapper.mjs", "--mode", "diff-review", "--claude-cli", "custom-claude.mjs"],
      outputFormat: "plain_result",
      toolContract: { name: "claude.review.diff", version: "1" },
      capabilityName: "code_review",
      capabilityDescription: "spoof",
      riskLevel: "low",
      riskTags: ["read_only"],
      economicModel: "external_billed",
      pricingDimensions: [],
      currency: "USD",
      costOwner: "usr_local",
      unknownCostPolicy: "warn",
      registrationNotes: {},
    }),
    status: "available",
    health: { status: "healthy", checkedAt: now(), message: "ok", nextAction: null },
  });

  const res = await call("/api/tools");
  assert.equal(res.status, 200);
  const codexTool = res.body.tools.find((item) => item.name === "codex.review.diff");
  const claudeTool = res.body.tools.find((item) => item.name === "claude.review.diff");
  assert.deepEqual(codexTool.agents.map((agent) => agent.name), ["Codex Diff Review"]);
  assert.deepEqual(claudeTool.agents.map((agent) => agent.name), ["Claude Diff Review"]);
});

test("GET /api/capabilities includes governed tools and scoped application capabilities", async () => {
  const teamA = await call("/api/capabilities", { token: "tok_a" });
  assert.equal(teamA.status, 200);
  assert.ok(teamA.body.capabilities.some((item) => item.name === "ccusage.report" && item.provider?.type === "tool"));
  const ccusageDaily = teamA.body.capabilities.find((item) => item.name === "app.app_ccusage.wrapper.daily");
  assert.equal(ccusageDaily?.provider?.type, "application");
  assert.equal(ccusageDaily?.metadata?.compatibilityFacade?.name, "ccusage.report");
  assert.equal(ccusageDaily?.metadata?.outputCollection, "importedUsageEstimates");
  assert.equal(ccusageDaily?.metadata?.billing?.externalBilled, true);
  assert.equal(ccusageDaily?.metadata?.resultImport?.amountSource, "imported_ccusage_report");
  assert.ok(teamA.body.capabilities.some((item) => item.name === "app.app_team_a.inspect" && item.provider?.type === "application"));
  const mcpRender = teamA.body.capabilities.find((item) => item.name === "doocs_md.render_markdown");
  assert.equal(mcpRender?.provider?.type, "tool");
  assert.equal(mcpRender?.source, "mcp_agent");
  assert.equal(mcpRender?.mcp?.agentId, "agt_doocs_md_mcp");
  assert.equal(mcpRender?.mcp?.toolName, "render_markdown");
  assert.ok(!JSON.stringify(teamA.body.capabilities).includes("wrapper.mjs"), "capability discovery must not expose wrapper internals");
  assert.ok(!JSON.stringify(teamA.body.capabilities).includes("doocs-md-mcp.cmd"), "MCP capability discovery must not expose adapter command");
  assert.ok(!JSON.stringify(teamA.body.capabilities).includes("--private"), "MCP capability discovery must not expose adapter args");

  const teamB = await call("/api/capabilities?providerType=application", { token: "tok_b" });
  assert.equal(teamB.status, 200);
  assert.ok(!teamB.body.capabilities.some((item) => item.name === "app.app_team_a.inspect"), "foreign application capability should be hidden");

  const teamBTools = await call("/api/capabilities?providerType=tool", { token: "tok_b" });
  assert.equal(teamBTools.status, 200);
  assert.ok(!teamBTools.body.capabilities.some((item) => item.name === "doocs_md.render_markdown"), "foreign application MCP tool should be hidden");
  const teamBToolRegistry = await call("/api/tools", { token: "tok_b" });
  assert.equal(teamBToolRegistry.status, 200);
  assert.ok(!teamBToolRegistry.body.tools.some((item) => item.name === "doocs_md.render_markdown"), "foreign application MCP tool registry entry should be hidden");
});

test("POST /api/capabilities proxies governed tools and executes application capabilities", async () => {
  const ccusage = await call("/api/capabilities/ccusage.report/invocations", {
    method: "POST",
    body: { report: "daily", projectId: "projA" },
    token: "tok_a",
  });
  assert.equal(ccusage.status, 201);
  assert.equal(ccusage.body.tool, "ccusage.report");

  const app = await call("/api/capabilities/app.app_team_a.inspect/invocations", {
    method: "POST",
    body: {},
    token: "tok_a",
  });
  assert.equal(app.status, 201);
  assert.equal(app.body.agentId, "agt_platform_application_control");
  assert.equal(app.body.invocation.status, "succeeded");

  const offlineWithoutApproval = await call("/api/capabilities/app.app_team_a.offline/invocations", {
    method: "POST",
    body: {},
    token: "tok_a",
  });
  const offlineApprovalRequestId = await approveApplicationRequest(offlineWithoutApproval);

  const offline = await call("/api/capabilities/app.app_team_a.offline/invocations", {
    method: "POST",
    body: { approvalRequestId: offlineApprovalRequestId },
    token: "tok_a",
  });
  assert.equal(offline.status, 201);
  assert.equal(offline.body.invocation.result.output.status, "offline");

  const mcp = await call("/api/capabilities/doocs_md.render_markdown/invocations", {
    method: "POST",
    body: { projectId: "projA", markdown: "# Shared", theme: "default" },
    token: "tok_a",
  });
  assert.equal(mcp.status, 201);
  assert.equal(mcp.body.tool, "doocs_md.render_markdown");
  assert.equal(mcp.body.agentId, "agt_doocs_md_mcp");
  assert.equal(mcp.body.outputCollection, "invocations");
  const invocation = ctx.state.invocations.find((item) => item.id === mcp.body.invocationId);
  assert.equal(invocation?.status, "queued");
  assert.equal(invocation?.options?.toolName, "render_markdown");
  assert.deepEqual(invocation?.options?.toolArguments, { markdown: "# Shared", theme: "default" });
  assert.equal(invocation?.options?.metadata?.providerType, "mcp");
  assert.equal(invocation?.options?.metadata?.tool, "doocs_md.render_markdown");
  assert.ok(!JSON.stringify(mcp.body).includes("doocs-md-mcp.cmd"), "MCP capability invocation response must not expose adapter command");
  assert.ok(!JSON.stringify(mcp.body).includes("--private"), "MCP capability invocation response must not expose adapter args");

  const foreignMcp = await call("/api/capabilities/doocs_md.render_markdown/invocations", {
    method: "POST",
    body: { projectId: "projB", markdown: "# Nope" },
    token: "tok_b",
  });
  assert.equal(foreignMcp.status, 404);
  assert.equal(foreignMcp.body.error, "capability_not_found");
});

test("POST /api/capabilities invokes ccusage wrapper capabilities with published runtime semantics", async () => {
  const res = await call("/api/capabilities/app.app_ccusage.wrapper.daily/invocations", {
    method: "POST",
    body: {
      since: "2026-07-01",
      until: "2026-07-02",
      timezone: "Asia/Shanghai",
      projectId: "projA",
    },
    token: "tok_a",
  });
  assert.equal(res.status, 202);
  assert.equal(res.body.capability, "app.app_ccusage.wrapper.daily");
  assert.equal(res.body.agentId, "agt_platform_application_wrapper");
  assert.equal(res.body.outputCollection, "importedUsageEstimates");
  const metadata = res.body.invocation?.options?.metadata;
  assert.equal(metadata?.applicationWrapper?.compatibilityFacade?.name, "ccusage.report");
  assert.equal(metadata?.applicationWrapper?.outputCollection, "importedUsageEstimates");
  assert.equal(metadata?.applicationWrapper?.billing?.externalBilled, true);
  assert.equal(metadata?.applicationWrapper?.resultImport?.source, "ccusage");
  assert.equal(metadata?.applicationWrapper?.resultImport?.amountSource, "imported_ccusage_report");
  assert.ok(!JSON.stringify(res.body).includes("application-wrapper.mjs"), "direct capability response must not expose runner script");
  assert.ok(!JSON.stringify(res.body).includes("ccusage-wrapper.mjs"), "direct capability response must not expose ccusage wrapper script");
});

test("POST /api/invocations guards worktree scope and ignores client control fields", async () => {
  const before = ctx.state.invocations.length;
  const foreignWorktree = await call("/api/invocations", {
    method: "POST",
    body: {
      task: "Run with a foreign worktree.",
      options: { metadata: { worktreeId: "wtB" } },
    },
    token: "tok_a",
  });
  assert.equal(foreignWorktree.status, 404);
  assert.equal(foreignWorktree.body.error, "worktree_not_found");
  assert.equal(ctx.state.invocations.length, before, "foreign worktree metadata must not create an invocation");

  const spoofedControl = await call("/api/invocations", {
    method: "POST",
    body: {
      task: "Run with spoofed control fields.",
      projectId: "projA",
      options: {
        requestedBy: "usr_b",
        idempotencyKey: "body-options-key",
        metadata: { note: "kept" },
      },
    },
    token: "tok_a",
  });
  assert.equal(spoofedControl.status, 201);
  assert.equal(spoofedControl.body.invocation.requestedBy, "usr_a");
  assert.equal(spoofedControl.body.invocation.idempotencyKey, null);
  assert.equal(spoofedControl.body.invocation.options.metadata.projectId, "projA");
  assert.equal(spoofedControl.body.invocation.options.metadata.note, "kept");
});

test("POST /api/compare-runs rejects foreign project/worktree metadata before child invocation creation", async () => {
  const before = ctx.state.invocations.length;
  const foreignProject = await call("/api/compare-runs", {
    method: "POST",
    body: {
      task: "Compare two review agents.",
      agentIds: ["agt_codex_review_diff", "agt_claude_review_diff"],
      options: { metadata: { projectId: "projB" } },
    },
    token: "tok_a",
  });
  assert.equal(foreignProject.status, 404);
  assert.equal(foreignProject.body.error, "project_not_found");
  assert.equal(ctx.state.invocations.length, before, "foreign project metadata must not create child invocations");

  const foreignWorktree = await call("/api/compare-runs", {
    method: "POST",
    body: {
      task: "Compare two review agents.",
      agentIds: ["agt_codex_review_diff", "agt_claude_review_diff"],
      options: { metadata: { worktreeId: "wtB" } },
    },
    token: "tok_a",
  });
  assert.equal(foreignWorktree.status, 404);
  assert.equal(foreignWorktree.body.error, "worktree_not_found");
  assert.equal(ctx.state.invocations.length, before, "foreign worktree metadata must not create child invocations");
});

test("POST /api/compare-runs ignores client control fields on child invocations", async () => {
  const res = await call("/api/compare-runs", {
    method: "POST",
    body: {
      task: "Compare two review agents.",
      agentIds: ["agt_codex_review_diff", "agt_claude_review_diff"],
      options: {
        requestedBy: "usr_b",
        idempotencyKey: "same-child-key",
        metadata: { projectId: "projA", note: "kept" },
      },
    },
    token: "tok_a",
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.invocations.length, 2);
  for (const invocation of res.body.invocations) {
    assert.equal(invocation.requestedBy, "usr_a");
    assert.equal(invocation.idempotencyKey, null);
    assert.equal(invocation.options.metadata.projectId, "projA");
    assert.equal(invocation.options.metadata.note, "kept");
    assert.equal(invocation.options.metadata.compareRunId, res.body.compareRun.id);
  }
});

test("POST /api/invocations/:id/troubleshoot binds the platform child invocation to the target scope", async () => {
  ctx.state.invocations.unshift({
    id: "inv_failed_scope",
    projectId: "projA",
    worktreeId: "wtA",
    agentId: "agt_codex_review_diff",
    status: "failed",
    requestedBy: "usr_a",
    createdAt: now(),
    options: {
      metadata: {
        projectId: "projA",
        worktreeId: "wtA",
        applicationId: "app_docs",
        routineId: "routine_docs_smoke",
      },
    },
  });
  const beforeIds = new Set(ctx.state.invocations.map((item) => item.id));

  const res = await call("/api/invocations/inv_failed_scope/troubleshoot", {
    method: "POST",
    token: "tok_a",
  });

  assert.equal(res.status, 201);
  const child = ctx.state.invocations.find((item) => !beforeIds.has(item.id) && item.agentId === "agt_platform_troubleshooter");
  assert.ok(child, "troubleshooter should create a platform invocation");
  assert.equal(res.body.report.troubleshooterInvocationId, child.id);
  assert.equal(res.body.report.webLinks.failedInvocation.query, "?section=invocations&invocation=inv_failed_scope");
  assert.equal(res.body.report.webLinks.troubleshooterInvocation.query, `?section=invocations&invocation=${child.id}`);
  assert.equal(res.body.report.webLinks.applicationRun.query, "?section=applications&application=app_docs&routine=routine_docs_smoke&run=inv_failed_scope");
  assert.equal(child.projectId, "projA");
  assert.equal(child.worktreeId, "wtA");
  assert.equal(child.options?.metadata?.targetInvocationId, "inv_failed_scope");
  assert.equal(child.options?.metadata?.projectId, "projA");
  assert.equal(child.options?.metadata?.worktreeId, "wtA");
  const state = await call("/api/state", { token: "tok_a" });
  const report = state.body.troubleshootingReports.find((item) => item.id === res.body.report.id);
  assert.equal(report.webLinks.failedInvocation.query, "?section=invocations&invocation=inv_failed_scope");
  assert.equal(report.webLinks.troubleshooterInvocation.query, `?section=invocations&invocation=${child.id}`);
  assert.equal(report.webLinks.applicationRun.query, "?section=applications&application=app_docs&routine=routine_docs_smoke&run=inv_failed_scope");
});

test("POST /api/applications/register rejects duplicate explicit ids", async () => {
  const duplicate = await call("/api/applications/register", {
    method: "POST",
    body: {
      id: "app_team_a",
      name: "Duplicate App",
      source: { type: "npm", package: "@scope/duplicate-app" },
    },
    token: "tok_a",
  });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.error, "invalid_application");
  assert.match(duplicate.body.message, /Application id already exists/);
});

test("POST /api/applications/register scopes ownership to the authenticated actor", async () => {
  const created = await call("/api/applications/register", {
    method: "POST",
    body: {
      id: "foreign_owner_attempt",
      name: "Owned By Actor",
      source: { type: "npm", package: "@scope/owned-by-actor" },
      ownerTeamId: TEAM_B,
    },
    token: "tok_a",
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.application.id, "app_foreign_owner_attempt");
  assert.equal(created.body.application.ownerTeamId, TEAM_A);

  const visibleToA = await call("/api/applications/app_foreign_owner_attempt", { token: "tok_a" });
  assert.equal(visibleToA.status, 200);

  const hiddenFromB = await call("/api/applications/app_foreign_owner_attempt", { token: "tok_b" });
  assert.equal(hiddenFromB.status, 404);
  assert.equal(hiddenFromB.body.error, "application_not_found");
});

test("application capability aliases reject a foreign body projectId before invocation creation", async () => {
  const created = await call("/api/applications/register", {
    method: "POST",
    body: {
      id: "alias_project_boundary",
      name: "Alias Project Boundary",
      source: { type: "npm", package: "@scope/alias-project-boundary" },
    },
    token: "tok_a",
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.application.ownerTeamId, TEAM_A);
  assert.equal(created.body.application.projectId, null);

  const before = ctx.state.invocations.length;
  const blocked = await call("/api/applications/app_alias_project_boundary/offline", {
    method: "POST",
    body: { approvalRequestId: "apr_foreign_project_offline", projectId: "projB" },
    token: "tok_a",
  });
  assert.equal(blocked.status, 404);
  assert.equal(blocked.body.error, "project_not_found");
  assert.equal(ctx.state.invocations.length, before, "foreign projectId must not create an invocation");

  const generateBlocked = await call("/api/applications/app_alias_project_boundary/orchestrations/generate", {
    method: "POST",
    body: { approvalRequestId: "apr_foreign_project_generate", projectId: "projB" },
    token: "tok_a",
  });
  assert.equal(generateBlocked.status, 404);
  assert.equal(generateBlocked.body.error, "project_not_found");
  assert.equal(ctx.state.invocations.length, before, "foreign generate projectId must not create an invocation");
});

test("POST /api/applications/register rejects cross-team duplicate sources", async () => {
  const duplicate = await call("/api/applications/register", {
    method: "POST",
    body: {
      name: "Hijack Team A App",
      source: { type: "local", path: "/tmp/a" },
    },
    token: "tok_b",
  });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.error, "invalid_application");
  assert.match(duplicate.body.message, /already registered/);
});

test("POST /api/applications/register rejects a foreign projectId", async () => {
  const res = await call("/api/applications/register", {
    method: "POST",
    body: {
      name: "Foreign Project App",
      source: { type: "npm", package: "@scope/foreign-project" },
      projectId: "projB",
    },
    token: "tok_a",
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "project_not_found");
});

test("POST /api/applications/register rejects a non-object body without crashing", async () => {
  const res = await call("/api/applications/register", { method: "POST", body: null, token: "tok_a" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_application");
});

test("POST /api/applications/:id/probe infers local package metadata without executable scripts", async () => {
  const res = await call("/api/applications/app_team_a/probe", {
    method: "POST",
    body: {},
    token: "tok_a",
  });
  assert.equal(res.status, 200);
  const probe = res.body.application.probe;
  assert.equal(probe.status, "completed");
  assert.equal(probe.package.name, "team-a-app");
  assert.equal(probe.package.version, "1.2.3");
  assert.equal(probe.readme.heading, "Team A App");
  assert.ok(probe.capabilities.some((item) => item.name === "app.app_team_a.offline" && item.source === "managed"));
  assert.ok(probe.capabilities.some((item) => item.name === "app.app_team_a.online" && item.source === "managed"));
  assert.ok(probe.capabilities.some((item) => item.name === "app.app_team_a.inferred.bin.team-a" && item.source === "inferred" && item.invocationMode === "not_invokable"));
  assert.ok(probe.capabilities.some((item) => item.name === "app.app_team_a.inferred.script.test" && item.source === "inferred"));
  assert.ok(probe.capabilities.some((item) => item.name === "app.app_team_a.inferred.module.exports" && item.source === "inferred"));
  assert.ok(!probe.capabilities.some((item) => item.name.includes("postinstall")), "unsafe lifecycle scripts should not be inferred");
  assert.ok(probe.capabilityNames.includes("app.app_team_a.offline"), "probe should keep a name index for compatibility");
});

test("POST /api/applications/:id/probe autodetects doocs/md MCP tools and exposes them as governed capabilities", async () => {
  const root = "/tmp/doocs-auto-mcp";
  writeDoocsMcpFixture(root);
  const registered = await call("/api/applications/register", {
    method: "POST",
    body: {
      id: "app_doocs_auto_mcp",
      name: "doocs/md auto",
      projectId: "projA",
      source: { type: "local", path: root },
    },
    token: "tok_a",
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.application.mcpAgent, null);

  const probed = await call(`/api/applications/${registered.body.application.id}/probe`, {
    method: "POST",
    body: {},
    token: "tok_a",
  });
  assert.equal(probed.status, 200);
  const app = probed.body.application;
  assert.equal(app.probe.mcpServers.length, 1);
  assert.deepEqual(app.probe.mcpServers[0].allowedTools, ["render_markdown", "list_themes"]);
  assert.equal(app.probe.autoRegisteredMcpAgentId, "agt_app_doocs_auto_mcp_mcp");
  assert.deepEqual(app.mcpAgent.sharedToolNames, ["doocs_md_auto.render_markdown", "doocs_md_auto.list_themes"]);
  assert.equal(app.mcpAgent.adapter, undefined);
  assert.equal(JSON.stringify(probed.body).includes("run.mjs"), false);

  const tools = await call("/api/tools", { token: "tok_a" });
  assert.equal(tools.status, 200);
  assert.ok(tools.body.tools.some((tool) => tool.name === "doocs_md_auto.render_markdown" && tool.source === "mcp_agent"));

  const invocation = await call("/api/capabilities/doocs_md_auto.render_markdown/invocations", {
    method: "POST",
    body: { projectId: "projA", markdown: "# Hello", theme: "default" },
    token: "tok_a",
  });
  assert.equal(invocation.status, 201);
  assert.equal(invocation.body.tool, "doocs_md_auto.render_markdown");
  assert.equal(invocation.body.agentId, "agt_app_doocs_auto_mcp_mcp");
  const stored = ctx.state.invocations.find((item) => item.id === invocation.body.invocationId);
  assert.equal(stored?.options?.toolName, "render_markdown");
  assert.deepEqual(stored?.options?.toolArguments, { markdown: "# Hello", theme: "default" });
  assert.equal(JSON.stringify(tools.body).includes("run.mjs"), false);
  assert.equal(JSON.stringify(invocation.body).includes("run.mjs"), false);
});

test("POST /api/applications/:id/mcp-candidates/:candidateId/confirm requires intent and returns a redacted Application", async () => {
  const root = "/tmp/doocs-manual-mcp";
  writeManualMcpFixture(root);
  const registered = await call("/api/applications/register", {
    method: "POST",
    body: {
      id: "app_doocs_manual_mcp_http",
      name: "doocs/md manual",
      projectId: "projA",
      source: { type: "local", path: root },
    },
    token: "tok_a",
  });
  assert.equal(registered.status, 201);

  const probed = await call(`/api/applications/${registered.body.application.id}/probe`, {
    method: "POST",
    body: {},
    token: "tok_a",
  });
  assert.equal(probed.status, 200);
  const candidate = probed.body.application.probe.mcpServers.find((server) => server.id === "mcp.shell");
  const remote = probed.body.application.probe.mcpServers.find((server) => server.id === "mcp.remote");
  assert.equal(candidate?.autoRegister, false);
  assert.equal(candidate?.autoRegisterReason, "stdio_command_requires_manual_confirmation");
  assert.equal(candidate?.review?.dataBoundary, "local_stdio_process");
  assert.equal(candidate?.review?.filePolicy, "read_only");
  assert.equal(candidate?.review?.networkPolicy, "forbidden");
  assert.equal(remote?.autoRegister, false);
  assert.equal(remote?.autoRegisterReason, "http_transport_requires_manual_confirmation");
  assert.equal(remote?.adapterPreview?.url, "https://mcp.example.test/rpc");
  assert.equal(remote?.review?.dataBoundary, "bridge_to_http_endpoint");
  assert.equal(remote?.review?.endpointOrigin, "https://mcp.example.test");
  assert.equal(remote?.review?.endpointHost, "mcp.example.test");
  assert.equal(remote?.review?.networkPolicy, "restricted");
  assert.equal(JSON.stringify(probed.body).includes("secret"), false);
  assert.equal(probed.body.application.mcpAgent, null);

  const approvalRequired = await call(`/api/applications/${registered.body.application.id}/mcp-candidates/mcp.shell/confirm`, {
    method: "POST",
    body: {},
    token: "tok_a",
  });
  const approvalRequestId = await approveApplicationRequest(approvalRequired);

  const foreign = await call(`/api/applications/${registered.body.application.id}/mcp-candidates/mcp.shell/confirm`, {
    method: "POST",
    body: { approvalRequestId: "apr_foreign_mcp_confirm" },
    token: "tok_b",
  });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, "application_not_found");

  const confirmed = await call(`/api/applications/${registered.body.application.id}/mcp-candidates/mcp.shell/confirm`, {
    method: "POST",
    body: { approvalRequestId },
    token: "tok_a",
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.application.mcpAgent.discovery.manualConfirmed, true);
  assert.equal(confirmed.body.application.mcpAgent.discovery.confirmedBy, "usr_a");
  assert.deepEqual(confirmed.body.application.mcpAgent.sharedToolNames, ["doocs_md_manual.render_markdown"]);
  assert.equal(confirmed.body.application.mcpAgent.adapter, undefined);
  assert.equal(JSON.stringify(confirmed.body).includes("run.mjs"), false);
  assert.equal(JSON.stringify(confirmed.body).includes("/bin/sh"), false);
  assert.equal(JSON.stringify(confirmed.body).includes("secret"), false);

  const capabilities = await call("/api/capabilities", { token: "tok_a" });
  assert.equal(capabilities.status, 200);
  assert.ok(capabilities.body.capabilities.some((capability) => capability.name === "doocs_md_manual.render_markdown" && capability.source === "mcp_agent"));
  const tools = await call("/api/tools", { token: "tok_a" });
  assert.equal(tools.status, 200);
  assert.ok(tools.body.tools.some((tool) => tool.name === "doocs_md_manual.render_markdown" && tool.source === "mcp_agent"));
});

test("POST /api/applications/:id/probe infers npm metadata from registration manifest only", async () => {
  const registered = await call("/api/applications/register", {
    method: "POST",
    body: {
      id: "npm_probe_fixture",
      name: "NPM Probe Fixture",
      source: {
        type: "npm",
        package: "@scope/probe-fixture",
        version: "2.0.0",
        packageJson: {
          name: "@scope/probe-fixture",
          version: "2.0.0",
          bin: "./cli.js",
          scripts: {
            lint: "eslint .",
            dev: "vite --host 0.0.0.0",
            preinstall: "node preinstall.js",
          },
          exports: {
            ".": "./index.js",
          },
        },
        readme: "# Probe Fixture\n\nNPM metadata fixture.\n",
      },
    },
    token: "tok_a",
  });
  assert.equal(registered.status, 201);

  const res = await call(`/api/applications/${registered.body.application.id}/probe`, {
    method: "POST",
    body: {},
    token: "tok_a",
  });
  assert.equal(res.status, 200);
  const probe = res.body.application.probe;
  assert.equal(probe.source.type, "npm");
  assert.equal(probe.package.name, "@scope/probe-fixture");
  assert.equal(probe.readme.heading, "Probe Fixture");
  assert.ok(probe.capabilities.some((item) => item.name === "app.app_npm_probe_fixture.inferred.bin.probe-fixture"));
  assert.ok(probe.capabilities.some((item) => item.name === "app.app_npm_probe_fixture.inferred.script.lint" && item.riskLevel === "low"));
  assert.ok(probe.capabilities.some((item) => item.name === "app.app_npm_probe_fixture.inferred.script.dev" && item.riskLevel === "medium"));
  assert.ok(!probe.capabilities.some((item) => item.name.includes("preinstall")), "npm probe should not infer install lifecycle scripts");
});

test("npm wrapper descriptors project only approved governed capabilities", async () => {
  const registered = await call("/api/applications/register", {
    method: "POST",
    body: {
      id: "npm_wrapper_fixture",
      name: "NPM Wrapper Fixture",
      source: {
        type: "npm",
        package: "@scope/wrapper-fixture",
        version: "3.0.0",
        packageJson: {
          name: "@scope/wrapper-fixture",
          version: "3.0.0",
          scripts: { lint: "eslint .", dev: "vite" },
        },
        wrapper: {
          mode: "installed-wrapper",
          installState: "installed",
          packageManager: "npm",
          commands: [{
            id: "lint",
            displayName: "Lint wrapper",
            commandType: "npm_script",
            command: "lint",
            status: "approved",
            riskLevel: "low",
            requiresApproval: true,
            timeoutSeconds: 45,
            cancellation: "supported",
            envPolicy: { allow: ["CI"], redact: ["NPM_TOKEN"], inherit: false },
            filePolicy: "read_only",
            networkPolicy: "forbidden",
          }, {
            id: "dev",
            commandType: "npm_script",
            command: "dev",
            status: "draft",
          }],
        },
      },
    },
    token: "tok_a",
  });
  assert.equal(registered.status, 201);
  const appId = registered.body.application.id;
  assert.equal(registered.body.application.source.wrapper.mode, "installed-wrapper");

  const capabilities = await call("/api/capabilities?providerType=application", { token: "tok_a" });
  assert.equal(capabilities.status, 200);
  const lintCapability = capabilities.body.capabilities.find((item) => item.name === `app.${appId}.wrapper.lint`);
  assert.ok(lintCapability, "approved wrapper command should project a capability");
  assert.equal(lintCapability.kind, "npm_wrapper");
  assert.equal(lintCapability.metadata.wrapper.commandId, "lint");
  assert.ok(!capabilities.body.capabilities.some((item) => item.name === `app.${appId}.wrapper.dev`), "draft wrapper command should not project");

  const blocked = await call(`/api/capabilities/app.${appId}.wrapper.lint/invocations`, {
    method: "POST",
    body: {},
    token: "tok_a",
  });
  const approvalRequestId = await approveApplicationRequest(blocked);

  // With approval, the wrapper capability now dispatches a QUEUED invocation to
  // the platform Application Wrapper Runner (bridge execution, #359), carrying
  // the server-resolved approved command in allowlisted metadata — rather than
  // returning a synchronous, non-executable descriptor.
  const invoked = await call(`/api/capabilities/app.${appId}.wrapper.lint/invocations`, {
    method: "POST",
    body: { approvalRequestId },
    token: "tok_a",
  });
  assert.equal(invoked.status, 202);
  assert.equal(invoked.body.agentId, "agt_platform_application_wrapper");
  assert.equal(invoked.body.status, "queued");
  const wrapper = invoked.body.invocation.options.metadata.applicationWrapper;
  assert.equal(wrapper.execCommand, "npm");
  assert.deepEqual(wrapper.execArgs, ["run", "lint"]);
  assert.equal(wrapper.capability, `app.${appId}.wrapper.lint`);
});

test("metadata-only npm wrapper registrations do not project invokable commands", async () => {
  const registered = await call("/api/applications/register", {
    method: "POST",
    body: {
      id: "npm_metadata_wrapper",
      name: "NPM Metadata Wrapper",
      source: {
        type: "npm",
        package: "@scope/metadata-wrapper",
        wrapper: {
          mode: "metadata-only",
          commands: [{
            id: "lint",
            command: "lint",
            status: "approved",
          }],
        },
      },
    },
    token: "tok_a",
  });
  assert.equal(registered.status, 201);
  const capabilities = await call("/api/capabilities?providerType=application", { token: "tok_a" });
  assert.ok(!capabilities.body.capabilities.some((item) => item.name === `app.${registered.body.application.id}.wrapper.lint`));
});

test("application descriptor endpoint edits npm wrapper descriptors and reprojects capabilities", async () => {
  const registered = await call("/api/applications/register", {
    method: "POST",
    body: {
      id: "npm_descriptor_edit",
      name: "NPM Descriptor Edit",
      source: {
        type: "npm",
        package: "@scope/descriptor-edit",
        wrapper: {
          mode: "installed-wrapper",
          installState: "installed",
          packageManager: "npm",
          commands: [{
            id: "lint",
            commandType: "npm_script",
            command: "lint",
            status: "approved",
            riskLevel: "low",
          }],
        },
      },
    },
    token: "tok_a",
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.application.source.wrapper.commands[0].command, undefined, "public snapshots should keep wrapper commands redacted");
  const appId = registered.body.application.id;

  const descriptors = await call(`/api/applications/${encodeURIComponent(appId)}/descriptors`, { token: "tok_a" });
  assert.equal(descriptors.status, 200);
  assert.equal(descriptors.body.descriptors.npmWrapper.commands[0].command, "lint");

  const invalid = await call(`/api/applications/${encodeURIComponent(appId)}/descriptors`, {
    method: "PATCH",
    token: "tok_a",
    body: {
      npmWrapper: {
        mode: "installed-wrapper",
        packageManager: "bun",
        commands: [{
          id: "install",
          commandType: "npm_script",
          command: "postinstall",
          status: "approved",
        }, {
          id: "install",
          commandType: "custom",
          command: "node && rm -rf .",
          status: "approved",
        }],
      },
    },
  });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.error, "invalid_application_descriptor");
  assert.ok(invalid.body.validation.errors.some((item) => item.path === "npmWrapper.packageManager" && item.code === "invalid_package_manager"));
  assert.ok(invalid.body.validation.errors.some((item) => item.code === "unsafe_lifecycle_script"));
  assert.ok(invalid.body.validation.errors.some((item) => item.code === "duplicate_id"));
  assert.ok(invalid.body.validation.errors.some((item) => item.code === "shell_syntax_forbidden"));
  const afterInvalid = await call(`/api/applications/${encodeURIComponent(appId)}/descriptors`, { token: "tok_a" });
  assert.equal(afterInvalid.body.descriptors.npmWrapper.commands[0].command, "lint");

  const updated = await call(`/api/applications/${encodeURIComponent(appId)}/descriptors`, {
    method: "PATCH",
    token: "tok_a",
    body: {
      npmWrapper: {
        mode: "installed-wrapper",
        installState: "installed",
        packageManager: "npm",
        commands: [{
          id: "build",
          commandType: "npm_script",
          command: "build",
          status: "approved",
          riskLevel: "low",
          requiresApproval: false,
        }],
      },
    },
  });
  assert.equal(updated.status, 200);
  assert.ok(updated.body.capabilities.some((item) => item.name === `app.${appId}.wrapper.build`));
  assert.ok(!updated.body.capabilities.some((item) => item.name === `app.${appId}.wrapper.lint`));
  assert.equal(updated.body.application.capabilitiesVersion, registered.body.application.capabilitiesVersion + 1);
  assert.equal(updated.body.descriptors.npmWrapper.commands[0].command, "build");
});

test("POST /api/capabilities generate_orchestration writes a routine draft", async () => {
  const application = findApplicationForTest("app_team_a");
  application.status = "active";
  const noToken = await call("/api/capabilities/app.app_team_a.generate_orchestration/invocations", {
    method: "POST",
    body: {},
    token: "tok_a",
  });
  const approvalRequestId = await approveApplicationRequest(noToken);

  const res = await call("/api/capabilities/app.app_team_a.generate_orchestration/invocations", {
    method: "POST",
    body: { approvalRequestId },
    token: "tok_a",
  });
  assert.equal(res.status, 201);
  const orchestration = res.body.invocation.result.output.orchestration;
  assert.equal(orchestration.kind, "LoopRoutineDraft");
  assert.equal(orchestration.relativePath, ".myagenttool/applications/app_team_a/routines/app-app_team_a-maintenance.json");
  assert.equal(orchestration.validation.ok, true);
  assert.deepEqual(orchestration.validation.policy.requiresApprovalFor, ["apply", "push", "pr-create", "pr-merge"]);
  assert.ok(existsSync(orchestration.path), "routine draft should be written to disk");
  const routine = JSON.parse(readFileSync(orchestration.path, "utf8"));
  assert.equal(routine.metadata.sourceApplicationId, "app_team_a");
  assert.ok(routine.metadata.sourceCapabilityNames.includes("app.app_team_a.generate_orchestration"));
  assert.equal(routine.metadata.riskLevel, "high");
  assert.deepEqual(routine.metadata.approvalRequirements, ["apply", "push", "pr-create", "pr-merge"]);
  assert.equal(routine.goal.fanout.apply, false);
  assert.equal(routine.safety.remoteWrites, "forbidden");
  assert.equal(routine.safety.githubWrites, "forbidden");
  assert.ok(application.orchestrations.some((item) => item.routineId === orchestration.id));
});

test("application routine validation blocks unsafe drafts before writing", async () => {
  const application = findApplicationForTest("app_team_a");
  const {
    buildApplicationRoutineSpec,
    validateApplicationRoutineDraft,
    writeApplicationRoutineDraft,
  } = await import("../../src/services/applications.mjs");
  const routineId = `app-team-a-invalid-${Date.now()}`;
  const unsafeRoutine = buildApplicationRoutineSpec(application, routineId);
  unsafeRoutine.goal.fanout.apply = true;
  unsafeRoutine.safety.remoteWrites = "allowed";
  unsafeRoutine.safety.githubWrites = "approval-required";
  unsafeRoutine.safety.requiresApprovalFor = ["apply"];
  unsafeRoutine.metadata.approvalRequirements = ["apply"];

  const validation = validateApplicationRoutineDraft(unsafeRoutine, { root: application.path, application });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.includes("remoteWrites")));
  assert.ok(validation.errors.some((error) => error.includes("githubWrites")));
  assert.ok(validation.errors.some((error) => error.includes("goal.fanout.apply")));
  assert.ok(validation.errors.some((error) => error.includes("requiresApprovalFor must include push")));
  assert.ok(validation.errors.some((error) => error.includes("approvalRequirements must include push")));

  const draft = writeApplicationRoutineDraft(application, "/tmp", { routineId, routine: unsafeRoutine });
  assert.equal(draft.ok, false);
  assert.equal(draft.status, "invalid");
  assert.equal(draft.validation.ok, false);
  assert.ok(!existsSync(draft.path), "invalid routine draft must not be written to disk");
});

test("application orchestration endpoints generate and list routine drafts", async () => {
  findApplicationForTest("app_team_a").status = "active";
  const generated = await generateApplicationOrchestrationForTest();
  assert.equal(generated.status, 201);
  assert.equal(generated.body.invocation.result.output.orchestration.id, "app-app_team_a-maintenance");

  const listed = await call("/api/applications/app_team_a/orchestrations", { token: "tok_a" });
  assert.equal(listed.status, 200);
  assert.ok(listed.body.orchestrations.some((item) => item.routineId === "app-app_team_a-maintenance"));

  const foreign = await call("/api/applications/app_team_a/orchestrations", { token: "tok_b" });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, "application_not_found");
});

test("application orchestration run endpoint creates governed invocations with routine metadata", async () => {
  const application = findApplicationForTest("app_team_a");
  application.status = "active";
  const generated = await generateApplicationOrchestrationForTest();
  assert.equal(generated.status, 201);

  const missing = await call("/api/applications/app_team_a/orchestrations/missing/run", {
    method: "POST",
    body: { agentId: "agt_platform_application_control" },
    token: "tok_a",
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "orchestration_not_found");

  const foreign = await call("/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/run", {
    method: "POST",
    body: { agentId: "agt_platform_application_control" },
    token: "tok_b",
  });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, "application_not_found");

  application.status = "offline";
  const offline = await call("/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/run", {
    method: "POST",
    body: { agentId: "agt_platform_application_control" },
    token: "tok_a",
  });
  assert.equal(offline.status, 409);
  assert.equal(offline.body.error, "application_not_active");

  application.status = "active";
  const run = await call("/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/run", {
    method: "POST",
    body: { agentId: "agt_platform_application_control" },
    token: "tok_a",
  });
  assert.equal(run.status, 201);
  assert.equal(run.body.applicationId, "app_team_a");
  assert.equal(run.body.routineId, "app-app_team_a-maintenance");
  assert.equal(run.body.agentId, "agt_platform_application_control");
  assert.ok(run.body.invocationId);
  assert.equal(run.body.invocation.options.metadata.source, "application_orchestration");
  assert.equal(run.body.invocation.options.metadata.applicationId, "app_team_a");
  assert.equal(run.body.invocation.options.metadata.routineId, "app-app_team_a-maintenance");
  assert.equal(run.body.invocation.options.metadata.routineValidationOk, true);
  assert.equal(run.body.invocation.projectId, "projA");
  assert.match(run.body.invocation.input.task, /validated LoopRoutine draft/);

  const validDraft = application.orchestrations.find((item) => item.routineId === "app-app_team_a-maintenance");
  const originalPath = validDraft.path;
  validDraft.path = "/tmp/a/package.json";
  const outsidePath = await call("/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/run", {
    method: "POST",
    body: { agentId: "agt_platform_application_control" },
    token: "tok_a",
  });
  assert.equal(outsidePath.status, 422);
  assert.equal(outsidePath.body.error, "invalid_orchestration_path");
  validDraft.path = originalPath;

  const invalidDraft = {
    routineId: "app-app_team_a-invalid",
    status: "invalid",
    path: "/tmp/not-written-invalid.json",
    relativePath: ".myagenttool/applications/app_team_a/routines/app-app_team_a-invalid.json",
    validation: { ok: false, errors: ["fixture invalid"] },
  };
  application.orchestrations = [invalidDraft, ...(application.orchestrations ?? [])];
  const invalid = await call("/api/applications/app_team_a/orchestrations/app-app_team_a-invalid/run", {
    method: "POST",
    body: { agentId: "agt_platform_application_control" },
    token: "tok_a",
  });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.error, "invalid_application_routine");
  assert.equal(invalid.body.validation.errors[0], "fixture invalid");
});

test("application orchestration runs endpoint lists scoped run history", async () => {
  const application = findApplicationForTest("app_team_a");
  application.status = "active";
  const generated = await generateApplicationOrchestrationForTest();
  assert.equal(generated.status, 201);

  const first = await call("/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/run", {
    method: "POST",
    body: { agentId: "agt_platform_application_control" },
    token: "tok_a",
  });
  const second = await call("/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/run", {
    method: "POST",
    body: { agentId: "agt_platform_application_control" },
    token: "tok_a",
  });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  const listed = await call("/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs?limit=1", {
    token: "tok_a",
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.applicationId, "app_team_a");
  assert.equal(listed.body.routineId, "app-app_team_a-maintenance");
  assert.equal(listed.body.runs.length, 1);
  assert.equal(listed.body.runs[0].invocationId, second.body.invocationId);
  assert.equal(listed.body.runs[0].metadata.source, "application_orchestration");
  assert.equal(listed.body.runs[0].metadata.applicationId, "app_team_a");
  assert.equal(listed.body.runs[0].metadata.routineId, "app-app_team_a-maintenance");

  const foreign = await call("/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs", {
    token: "tok_b",
  });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, "application_not_found");

  const missing = await call("/api/applications/app_team_a/orchestrations/missing/runs", {
    token: "tok_a",
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "orchestration_not_found");
});

test("application orchestration run detail endpoint returns scoped diagnostics", async () => {
  const application = findApplicationForTest("app_team_a");
  application.status = "active";
  const generated = await generateApplicationOrchestrationForTest();
  assert.equal(generated.status, 201);

  const created = await call("/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/run", {
    method: "POST",
    body: { agentId: "agt_platform_application_control" },
    token: "tok_a",
  });
  assert.equal(created.status, 201);
  const invocation = ctx.state.invocations.find((item) => item.id === created.body.invocationId);
  assert.ok(invocation, "expected orchestration invocation");
  invocation.status = "failed";
  invocation.delivery = { state: "acknowledged", dispatchAttempts: 2 };
  invocation.cancellation = { state: "none" };
  invocation.result = { summary: "Routine inspected package metadata.", touchedUserFiles: false };
  invocation.traceId = "trace_application_detail";
  invocation.rootSpanId = "span_application_detail";
  ctx.state.auditSummaries.unshift({
    invocationId: invocation.id,
    agentId: invocation.agentId,
    permissionDecision: "allow",
    errorSummary: "LoopRoutine step npm.audit failed.",
    traceId: "trace_application_detail",
    costSummary: "$0.00",
  });

  const detail = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(invocation.id)}`, {
    token: "tok_a",
  });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.applicationId, "app_team_a");
  assert.equal(detail.body.routineId, "app-app_team_a-maintenance");
  assert.equal(detail.body.run.invocationId, invocation.id);
  assert.equal(detail.body.run.status, "failed");
  assert.equal(detail.body.run.delivery.dispatchAttempts, 2);
  assert.equal(detail.body.run.result.summary, "Routine inspected package metadata.");
  assert.equal(detail.body.run.errorSummary, "LoopRoutine step npm.audit failed.");
  assert.equal(detail.body.run.audit.permissionDecision, "allow");
  assert.equal(detail.body.run.metadata.applicationId, "app_team_a");
  assert.equal(detail.body.run.metadata.routineId, "app-app_team_a-maintenance");

  const foreign = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(invocation.id)}`, {
    token: "tok_b",
  });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, "application_not_found");

  const wrongRoutine = await call(`/api/applications/app_team_a/orchestrations/missing/runs/${encodeURIComponent(invocation.id)}`, {
    token: "tok_a",
  });
  assert.equal(wrongRoutine.status, 404);
  assert.equal(wrongRoutine.body.error, "orchestration_not_found");

  const missingRun = await call("/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/inv_not_an_app_run", {
    token: "tok_a",
  });
  assert.equal(missingRun.status, 404);
  assert.equal(missingRun.body.error, "orchestration_run_not_found");
});

test("application orchestration run events and retry stay scoped to the routine", async () => {
  const application = findApplicationForTest("app_team_a");
  application.status = "active";
  const generated = await generateApplicationOrchestrationForTest();
  assert.equal(generated.status, 201);

  const original = await call("/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/run", {
    method: "POST",
    body: { agentId: "agt_platform_application_control" },
    token: "tok_a",
  });
  assert.equal(original.status, 201);

  ctx.state.events.push({
    id: "evt_manual_late_app_retry_test",
    invocationId: original.body.invocationId,
    type: "manual_failure_observed",
    level: "error",
    message: "Synthetic failure for retry test.",
    data: { applicationId: "app_team_a", routineId: "app-app_team_a-maintenance" },
    createdAt: "2026-07-03T00:00:10.000Z",
  }, {
    id: "evt_manual_early_app_retry_test",
    invocationId: original.body.invocationId,
    type: "manual_run_started",
    level: "info",
    message: "Synthetic start for retry test.",
    data: { applicationId: "app_team_a", routineId: "app-app_team_a-maintenance" },
    createdAt: "2026-07-03T00:00:01.000Z",
  }, {
    id: "evt_manual_foreign_invocation_retry_test",
    invocationId: "inv_foreign_for_retry_test",
    type: "manual_noise",
    level: "info",
    message: "Foreign invocation noise.",
    data: null,
    createdAt: "2026-07-03T00:00:05.000Z",
  });

  const events = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(original.body.invocationId)}/events`, {
    token: "tok_a",
  });
  assert.equal(events.status, 200);
  assert.equal(events.body.invocationId, original.body.invocationId);
  assert.ok(events.body.events.some((event) => event.type === "manual_failure_observed"));
  assert.ok(events.body.events.findIndex((event) => event.id === "evt_manual_early_app_retry_test")
    < events.body.events.findIndex((event) => event.id === "evt_manual_late_app_retry_test"));
  assert.equal(events.body.events.some((event) => event.invocationId === "inv_foreign_for_retry_test"), false);

  const retry = await call("/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/run", {
    method: "POST",
    body: {
      agentId: "agt_platform_application_control",
      retryOfInvocationId: original.body.invocationId,
      retryReason: "Retry after synthetic failure.",
    },
    token: "tok_a",
  });
  assert.equal(retry.status, 201);
  const retryInvocation = ctx.state.invocations.find((item) => item.id === retry.body.invocationId);
  assert.equal(retryInvocation?.options?.metadata?.retryOfInvocationId, original.body.invocationId);
  assert.equal(retryInvocation?.options?.metadata?.retryReason, "Retry after synthetic failure.");
  assert.ok(ctx.state.events.some((event) => event.invocationId === retry.body.invocationId
    && event.type === "application_orchestration_run_requested"
    && event.data?.retryOfInvocationId === original.body.invocationId));

  const listed = await call("/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs?limit=1", {
    token: "tok_a",
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.runs[0].invocationId, retry.body.invocationId);
  assert.equal(listed.body.runs[0].metadata.retryOfInvocationId, original.body.invocationId);

  const badRetry = await call("/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/run", {
    method: "POST",
    body: {
      agentId: "agt_platform_application_control",
      retryOfInvocationId: "inv_not_an_app_run",
    },
    token: "tok_a",
  });
  assert.equal(badRetry.status, 404);
  assert.equal(badRetry.body.error, "orchestration_run_not_found");

  const foreign = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(original.body.invocationId)}/events`, {
    token: "tok_b",
  });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, "application_not_found");
});

test("application orchestration recovery endpoint classifies common outcomes", async () => {
  const application = findApplicationForTest("app_team_a");
  application.status = "active";
  const generated = await generateApplicationOrchestrationForTest();
  assert.equal(generated.status, 201);

  const success = await createApplicationOrchestrationRunForTest({ status: "succeeded" });
  const successRecovery = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(success.id)}/recovery`, {
    token: "tok_a",
  });
  assert.equal(successRecovery.status, 200);
  assert.equal(successRecovery.body.recovery.category, "none");
  assert.equal(successRecovery.body.recovery.retryRecommended, false);

  const runtime = await createApplicationOrchestrationRunForTest({ status: "failed" });
  ctx.state.auditSummaries.unshift({
    invocationId: runtime.id,
    agentId: runtime.agentId,
    errorSummary: "npm test failed with exit code 1.",
    permissionDecision: "allow",
    traceId: "trace_runtime_recovery",
  });
  const runtimeRecovery = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(runtime.id)}/recovery`, {
    token: "tok_a",
  });
  assert.equal(runtimeRecovery.status, 200);
  assert.equal(runtimeRecovery.body.recovery.category, "runtime_error");
  assert.equal(runtimeRecovery.body.recovery.retryRecommended, true);
  assert.ok(runtimeRecovery.body.recovery.actions.some((action) => action.type === "rerun"));
  assert.equal(runtimeRecovery.body.recovery.actions[0]?.type, "rerun");
  assert.equal(runtimeRecovery.body.recovery.actions[0]?.recommended, true);
  assert.equal(runtimeRecovery.body.recovery.actions[0]?.priority, 10);
  assert.equal(runtimeRecovery.body.recovery.actions[0]?.riskLevel, "medium");
  assert.match(runtimeRecovery.body.recovery.actions[0]?.recommendationReason ?? "", /governed rerun/);

  const dispatch = await createApplicationOrchestrationRunForTest({
    status: "dispatching",
    delivery: { state: "redelivering", dispatchAttempts: 2 },
  });
  ctx.state.events.unshift({
    id: "evt_recovery_dispatch_timeout",
    invocationId: dispatch.id,
    type: "delivery_redelivered",
    level: "warn",
    message: "Dispatch lease expired; invocation returned to queue for redelivery.",
    data: { dispatchAttempts: 2 },
    createdAt: now(),
  });
  const dispatchRecovery = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(dispatch.id)}/recovery`, {
    token: "tok_a",
  });
  assert.equal(dispatchRecovery.status, 200);
  assert.equal(dispatchRecovery.body.recovery.category, "dispatch_timeout");
  assert.equal(dispatchRecovery.body.recovery.retryRecommended, true);

  const cancelled = await createApplicationOrchestrationRunForTest({
    status: "cancelled",
    cancellation: { state: "cancelled" },
  });
  const cancelledRecovery = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(cancelled.id)}/recovery`, {
    token: "tok_a",
  });
  assert.equal(cancelledRecovery.status, 200);
  assert.equal(cancelledRecovery.body.recovery.category, "cancelled");
  assert.equal(cancelledRecovery.body.recovery.actions[0]?.type, "rerun");

  const unavailable = await createApplicationOrchestrationRunForTest({ status: "failed" });
  ctx.state.auditSummaries.unshift({
    invocationId: unavailable.id,
    agentId: unavailable.agentId,
    errorSummary: "agent_unhealthy: selected agent cannot run.",
    permissionDecision: "allow",
    traceId: "trace_agent_recovery",
  });
  const unavailableRecovery = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(unavailable.id)}/recovery`, {
    token: "tok_a",
  });
  assert.equal(unavailableRecovery.status, 200);
  assert.equal(unavailableRecovery.body.recovery.category, "agent_unavailable");
  assert.equal(unavailableRecovery.body.recovery.actions[0]?.type, "select_agent");
  assert.equal(unavailableRecovery.body.recovery.actions[0]?.recommended, true);

  const foreign = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(runtime.id)}/recovery`, {
    token: "tok_b",
  });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, "application_not_found");
});

test("application orchestration recovery actions are guarded and audited", async () => {
  const application = findApplicationForTest("app_team_a");
  application.status = "active";
  const generated = await generateApplicationOrchestrationForTest();
  assert.equal(generated.status, 201);

  const runtime = await createApplicationOrchestrationRunForTest({ status: "failed" });
  ctx.state.auditSummaries.unshift({
    invocationId: runtime.id,
    agentId: runtime.agentId,
    errorSummary: "npm test failed with exit code 1.",
    permissionDecision: "allow",
    traceId: "trace_runtime_action",
  });

  const rerun = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(runtime.id)}/recovery/actions`, {
    method: "POST",
    body: { actionType: "rerun", reason: "Retry after npm failure." },
    token: "tok_a",
  });
  assert.equal(rerun.status, 201);
  assert.equal(rerun.body.recoveryAction.actionType, "rerun");
  assert.equal(rerun.body.recoveryAction.recoveryOfInvocationId, runtime.id);
  assert.equal(rerun.body.explanation.selectedAction, "rerun");
  assert.equal(rerun.body.explanation.state, "executed");
  const rerunInvocation = ctx.state.invocations.find((item) => item.id === rerun.body.invocationId);
  assert.equal(rerunInvocation?.options?.metadata?.recoveryActionType, "rerun");
  assert.equal(rerunInvocation?.options?.metadata?.recoveryOfInvocationId, runtime.id);
  assert.equal(rerunInvocation?.options?.metadata?.recoveryReason, "Retry after npm failure.");
  assert.equal(rerunInvocation?.options?.metadata?.recoveryCategory, "runtime_error");
  assert.ok(ctx.state.events.some((event) => event.invocationId === runtime.id
    && event.type === "application_orchestration_recovery_action_requested"
    && event.data?.actionType === "rerun"));

  const viewInvocation = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(runtime.id)}/recovery/actions`, {
    method: "POST",
    body: { actionType: "view_invocation", reason: "Operator opened the recovery evidence." },
    token: "tok_a",
  });
  assert.equal(viewInvocation.status, 200);
  assert.equal(viewInvocation.body.status, "noop");
  assert.equal(viewInvocation.body.explanation.state, "no_result_expected");
  assert.equal(viewInvocation.body.explanation.nextStep, "Inspect the source invocation evidence.");
  assert.ok(ctx.state.events.some((event) => event.invocationId === runtime.id
    && event.type === "application_orchestration_recovery_action_requested"
    && event.data?.actionType === "view_invocation"));

  const notSuggested = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(runtime.id)}/recovery/actions`, {
    method: "POST",
    body: { actionType: "relink_device" },
    token: "tok_a",
  });
  assert.equal(notSuggested.status, 400);
  assert.equal(notSuggested.body.error, "recovery_action_not_suggested");
  assert.equal(notSuggested.body.explanation.state, "rejected");
  assert.equal(notSuggested.body.explanation.reason, "action_not_suggested");

  const validation = await createApplicationOrchestrationRunForTest({ status: "failed" });
  ctx.state.events.unshift({
    id: "evt_recovery_validation_action",
    invocationId: validation.id,
    type: "application_routine_validation_failed",
    level: "warn",
    message: "invalid_application_routine validation failed",
    data: null,
    createdAt: now(),
  });
  const approvalRequired = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(validation.id)}/recovery/actions`, {
    method: "POST",
    body: { actionType: "regenerate_orchestration" },
    token: "tok_a",
  });
  assert.equal(approvalRequired.status, 202);
  assert.equal(approvalRequired.body.status, "approval_pending");
  assert.equal(approvalRequired.body.explanation.state, "approval_pending");
  assert.equal(approvalRequired.body.explanation.selectedAction, "regenerate_orchestration");
  assert.equal(approvalRequired.body.explanation.approvalRequestId, approvalRequired.body.approvalRequest.id);
  assert.equal(approvalRequired.body.recoveryActionRequest.status, "approval_pending");
  assert.equal(approvalRequired.body.recoveryActionRequest.actionType, "regenerate_orchestration");
  assert.ok(approvalRequired.body.approvalRequest.id);
  assert.equal(approvalRequired.body.approvalRequest.applicationRecoveryActionRequestId, approvalRequired.body.recoveryActionRequest.id);
  assert.ok(ctx.state.events.some((event) => event.invocationId === validation.id
    && event.type === "application_orchestration_recovery_approval_requested"
    && event.data?.recoveryActionRequestId === approvalRequired.body.recoveryActionRequest.id));
  const pendingRegenerateRecovery = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(validation.id)}/recovery`, {
    token: "tok_a",
  });
  const pendingRegenerateAction = pendingRegenerateRecovery.body.recovery.actions.find((action) => action.type === "regenerate_orchestration");
  assert.equal(pendingRegenerateAction?.availability?.state, "blocked");
  assert.equal(pendingRegenerateAction?.blockedReason, "same_action_approval_pending");
  assert.equal(pendingRegenerateAction?.latestRequestId, approvalRequired.body.recoveryActionRequest.id);
  const pendingRetry = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(validation.id)}/recovery/actions`, {
    method: "POST",
    body: { actionType: "regenerate_orchestration", approvalRequestId: approvalRequired.body.approvalRequest.id },
    token: "tok_a",
  });
  assert.equal(pendingRetry.status, 409);
  assert.equal(pendingRetry.body.error, "approval_not_approved");
  assert.equal(pendingRetry.body.approvalStatus, "pending");
  const duplicateRegenerate = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(validation.id)}/recovery/actions`, {
    method: "POST",
    body: { actionType: "regenerate_orchestration" },
    token: "tok_a",
  });
  assert.equal(duplicateRegenerate.status, 409);
  assert.equal(duplicateRegenerate.body.error, "recovery_action_blocked");
  assert.equal(duplicateRegenerate.body.blockedReason, "same_action_approval_pending");
  assert.equal(duplicateRegenerate.body.explanation.state, "blocked");
  assert.equal(duplicateRegenerate.body.explanation.blockedReason, "same_action_approval_pending");
  assert.equal(duplicateRegenerate.body.explanation.latestRequestId, approvalRequired.body.recoveryActionRequest.id);
  assert.equal(duplicateRegenerate.body.latestRequestId, approvalRequired.body.recoveryActionRequest.id);
  assert.equal(ctx.state.applicationRecoveryActions.filter((item) => item.invocationId === validation.id
    && item.actionType === "regenerate_orchestration").length, 1);

  const foreignApprovalRead = await call(`/api/codex/approval-broker/${encodeURIComponent(approvalRequired.body.approvalRequest.id)}`, {
    token: "tok_b",
  });
  assert.equal(foreignApprovalRead.status, 404);
  assert.equal(foreignApprovalRead.body.error, "codex_approval_request_not_found");

  const foreignApproval = await call(`/api/codex/approval-broker/${encodeURIComponent(approvalRequired.body.approvalRequest.id)}/approve`, {
    method: "POST",
    token: "tok_b",
  });
  assert.equal(foreignApproval.status, 404);
  assert.equal(foreignApproval.body.error, "codex_approval_request_not_found");

  const approvedRecovery = await call(`/api/codex/approval-broker/${encodeURIComponent(approvalRequired.body.approvalRequest.id)}/approve`, {
    method: "POST",
    token: "tok_a",
  });
  assert.equal(approvedRecovery.status, 200);
  const approvedActionRequest = ctx.state.applicationRecoveryActions.find((item) => item.id === approvalRequired.body.recoveryActionRequest.id);
  assert.equal(approvedActionRequest?.status, "executed");
  assert.ok(approvedActionRequest?.resultInvocationId);
  assert.equal(approvedActionRequest?.resultOrchestrationId, "app-app_team_a-maintenance");
  assert.ok(ctx.state.invocations.some((item) => item.id === approvedActionRequest?.resultInvocationId
    && item.options?.metadata?.applicationAction === "generate_orchestration"
    && item.status === "succeeded"));
  assert.ok(findApplicationForTest("app_team_a").orchestrations?.some((item) => item.routineId === approvedActionRequest?.resultOrchestrationId));
  assert.ok(ctx.state.events.some((event) => event.invocationId === validation.id
    && event.type === "application_orchestration_recovery_approval_resolved"
    && event.data?.status === "approved"));
  assert.ok(ctx.state.events.some((event) => event.invocationId === validation.id
    && event.type === "application_orchestration_recovery_action_executed"
    && event.data?.recoveryActionRequestId === approvalRequired.body.recoveryActionRequest.id));
  const generatedInvocationCount = ctx.state.invocations.filter((item) => item.options?.metadata?.applicationAction === "generate_orchestration").length;
  const approvedAgain = await call(`/api/codex/approval-broker/${encodeURIComponent(approvalRequired.body.approvalRequest.id)}/approve`, {
    method: "POST",
    token: "tok_a",
  });
  assert.equal(approvedAgain.status, 200);
  assert.equal(approvedActionRequest?.status, "executed");
  assert.equal(ctx.state.invocations.filter((item) => item.options?.metadata?.applicationAction === "generate_orchestration").length, generatedInvocationCount);

  const approvedRetry = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(validation.id)}/recovery/actions`, {
    method: "POST",
    body: { actionType: "regenerate_orchestration", approvalRequestId: approvalRequired.body.approvalRequest.id },
    token: "tok_a",
  });
  assert.equal(approvedRetry.status, 200);
  assert.equal(approvedRetry.body.recoveryActionRequest.id, approvalRequired.body.recoveryActionRequest.id);
  assert.equal(approvedRetry.body.recoveryActionRequest.status, "executed");
  assert.equal(approvedRetry.body.recoveryActionRequest.resultOrchestrationId, "app-app_team_a-maintenance");
  assert.equal(approvedRetry.body.explanation.state, "executed");
  assert.equal(approvedRetry.body.explanation.resultOrchestrationId, "app-app_team_a-maintenance");
  assert.equal(ctx.state.invocations.filter((item) => item.options?.metadata?.applicationAction === "generate_orchestration").length, generatedInvocationCount);

  const legacyTokenRegenerate = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(validation.id)}/recovery/actions`, {
    method: "POST",
    body: { actionType: "regenerate_orchestration", approvalToken: "operator-approved-recovery" },
    token: "tok_a",
  });
  assert.equal(legacyTokenRegenerate.status, 202);
  assert.equal(legacyTokenRegenerate.body.status, "approval_pending");
  assert.equal(legacyTokenRegenerate.body.recoveryActionRequest.status, "approval_pending");
  assert.equal(ctx.state.invocations.filter((item) => item.options?.metadata?.applicationAction === "generate_orchestration").length, generatedInvocationCount);

  const unhealthy = await createApplicationOrchestrationRunForTest({
    status: "failed",
    agentId: "agt_demo_cli",
  });
  ctx.state.auditSummaries.unshift({
    invocationId: unhealthy.id,
    agentId: unhealthy.agentId,
    errorSummary: "agent_unhealthy: selected agent cannot run.",
    permissionDecision: "allow",
    traceId: "trace_select_agent",
  });
  const agentCandidates = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(unhealthy.id)}/recovery/agent-candidates`, {
    token: "tok_a",
  });
  assert.equal(agentCandidates.status, 200);
  assert.equal(agentCandidates.body.preferredAgentId, "agt_platform_application_control");
  assert.ok(agentCandidates.body.candidates.some((candidate) => candidate.id === "agt_platform_application_control"
    && candidate.selectable === true
    && candidate.preferred === true));
  assert.ok(!agentCandidates.body.candidates.some((candidate) => candidate.id === "agt_demo_cli"));

  const selectAgent = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(unhealthy.id)}/recovery/actions`, {
    method: "POST",
    body: { actionType: "select_agent", agentId: "agt_platform_application_control", reason: "Retry with a healthy platform agent." },
    token: "tok_a",
  });
  assert.equal(selectAgent.status, 201);
  assert.equal(selectAgent.body.recoveryAction.actionType, "select_agent");
  assert.equal(selectAgent.body.recoveryAction.selectedAgentId, "agt_platform_application_control");
  assert.equal(selectAgent.body.explanation.selectedAction, "select_agent");
  assert.equal(selectAgent.body.explanation.selectedAgentId, "agt_platform_application_control");
  assert.equal(selectAgent.body.recoveryActionRequest.status, "executed");
  assert.equal(selectAgent.body.recoveryActionRequest.selectedAgentId, "agt_platform_application_control");
  assert.equal(selectAgent.body.recoveryActionRequest.requestedAgentId, "agt_platform_application_control");
  assert.ok(selectAgent.body.recoveryActionRequest.agentCandidateSnapshot.some((candidate) => candidate.id === "agt_platform_application_control"
    && candidate.selectable === true
    && candidate.preferred === true));
  const selectInvocation = ctx.state.invocations.find((item) => item.id === selectAgent.body.recoveryActionRequest.resultInvocationId);
  assert.equal(selectInvocation?.agentId, "agt_platform_application_control");
  assert.equal(selectInvocation?.options?.metadata?.recoveryActionType, "select_agent");
  assert.equal(selectInvocation?.options?.metadata?.recoveryOfInvocationId, unhealthy.id);
  assert.ok(ctx.state.events.some((event) => event.invocationId === unhealthy.id
    && event.type === "application_orchestration_recovery_action_executed"
    && event.data?.selectedAgentId === "agt_platform_application_control"));
  const stateAfterSelectAgent = await call("/api/state", { token: "tok_a" });
  const selectAgentReadModel = stateAfterSelectAgent.body.applicationRecoveryActions.find((item) => item.id === selectAgent.body.recoveryActionRequest.id);
  assert.equal(selectAgentReadModel?.outcome?.state, "pending");
  assert.equal(selectAgentReadModel?.outcomeReason, "result_in_progress");
  assert.equal(selectAgentReadModel?.outcome?.reason, "result_in_progress");
  assert.equal(selectAgentReadModel?.outcome?.severity, "info");
  assert.match(selectAgentReadModel?.outcome?.nextStep ?? "", /Wait for the recovered invocation/);
  assert.match(selectAgentReadModel?.outcome?.summary ?? "", /^Recovered invocation is /);
  assert.equal(selectAgentReadModel?.explanation?.selectedAction, "select_agent");
  assert.equal(selectAgentReadModel?.explanation?.state, "executed");
  assert.equal(selectAgentReadModel?.explanation?.selectedAgentId, "agt_platform_application_control");
  assert.equal(selectAgentReadModel?.explanation?.nextStep, selectAgentReadModel?.outcome?.nextStep);
  assert.equal(selectAgentReadModel?.sourceInvocation?.id, unhealthy.id);
  assert.equal(selectAgentReadModel?.resultInvocation?.id, selectInvocation?.id);
  assert.equal(selectAgentReadModel?.resultInvocation?.agentId, "agt_platform_application_control");
  assert.ok(selectAgentReadModel?.agentCandidateSnapshot?.some((candidate) => candidate.id === "agt_platform_application_control"
    && candidate.selectable === true
    && candidate.preferred === true));
  assert.ok(selectAgentReadModel?.timeline?.some((entry) => entry.type === "application_orchestration_recovery_action_requested"
    && entry.status === "requested"));
  assert.ok(selectAgentReadModel?.timeline?.some((entry) => entry.type === "application_orchestration_recovery_action_executed"
    && entry.status === "executed"));

  const selectUnhealthyAgent = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(unhealthy.id)}/recovery/actions`, {
    method: "POST",
    body: { actionType: "select_agent", agentId: "agt_demo_cli" },
    token: "tok_a",
  });
  assert.equal(selectUnhealthyAgent.status, 409);
  assert.equal(selectUnhealthyAgent.body.error, "healthy_agent_not_found");
  assert.equal(selectUnhealthyAgent.body.explanation.state, "failed");
  assert.equal(selectUnhealthyAgent.body.explanation.reason, "healthy_agent_not_found");
  assert.equal(selectUnhealthyAgent.body.recoveryActionRequest.status, "failed");
  assert.equal(selectUnhealthyAgent.body.recoveryActionRequest.selectedAgentId, null);
  assert.equal(selectUnhealthyAgent.body.recoveryActionRequest.requestedAgentId, "agt_demo_cli");
  assert.ok(Array.isArray(selectUnhealthyAgent.body.recoveryActionRequest.agentCandidateSnapshot));
  assert.ok(selectUnhealthyAgent.body.recoveryActionRequest.agentCandidateSnapshot.some((candidate) => candidate.id === "agt_demo_cli"
    && candidate.selectable === false
    && candidate.reasons.includes("application_control_missing")));
  const failedSelectAgentRecovery = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(unhealthy.id)}/recovery`, {
    token: "tok_a",
  });
  const failedSelectAgentAction = failedSelectAgentRecovery.body.recovery.actions.find((action) => action.type === "select_agent");
  assert.equal(failedSelectAgentAction?.availability?.state, "warning");
  assert.equal(failedSelectAgentAction?.warningReason, "same_action_recently_failed");
  assert.equal(failedSelectAgentAction?.latestRequestId, selectUnhealthyAgent.body.recoveryActionRequest.id);
  const stateAfterRejectedSelectAgent = await call("/api/state", { token: "tok_a" });
  const rejectedSelectAgentReadModel = stateAfterRejectedSelectAgent.body.applicationRecoveryActions.find((item) => item.id === selectUnhealthyAgent.body.recoveryActionRequest.id);
  assert.equal(rejectedSelectAgentReadModel?.outcome?.state, "needs_attention");
  assert.equal(rejectedSelectAgentReadModel?.outcomeReason, "healthy_agent_not_found");
  assert.equal(rejectedSelectAgentReadModel?.outcome?.severity, "danger");
  assert.equal(rejectedSelectAgentReadModel?.explanation?.selectedAction, "select_agent");
  assert.equal(rejectedSelectAgentReadModel?.explanation?.state, "failed");
  assert.match(rejectedSelectAgentReadModel?.outcome?.nextStep ?? "", /choose another recovery action/);

  const foreign = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(runtime.id)}/recovery/actions`, {
    method: "POST",
    body: { actionType: "rerun" },
    token: "tok_b",
  });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, "application_not_found");
});

test("application lifecycle endpoints require governed approval", async () => {
  findApplicationForTest("app_team_a").status = "active";
  const blocked = await call("/api/applications/app_team_a/offline", {
    method: "POST",
    body: {},
    token: "tok_a",
  });
  const offlineApprovalRequestId = await approveApplicationRequest(blocked);

  const approved = await call("/api/applications/app_team_a/offline", {
    method: "POST",
    body: { approvalRequestId: offlineApprovalRequestId },
    token: "tok_a",
  });
  assert.equal(approved.status, 201);
  assert.equal(approved.body.invocation.result.output.status, "offline");

  const onlineBlocked = await call("/api/applications/app_team_a/online", {
    method: "POST",
    body: {},
    token: "tok_a",
  });
  const onlineApprovalRequestId = await approveApplicationRequest(onlineBlocked);

  const online = await call("/api/applications/app_team_a/online", {
    method: "POST",
    body: { approvalRequestId: onlineApprovalRequestId },
    token: "tok_a",
  });
  assert.equal(online.status, 201);
  assert.equal(online.body.invocation.result.output.status, "active");
});

test("GET /api/tools/ccusage.report returns the tool descriptor", async () => {
  const res = await call("/api/tools/ccusage.report");
  assert.equal(res.status, 200);
  assert.equal(res.body.tool.name, "ccusage.report");
  assert.deepEqual(res.body.tool.inputSchema.properties.offline, { const: true });
  assert.deepEqual(res.body.tool.inputSchema.properties.projectId, { type: "string" });
});

test("GET /api/tools/codex.review.diff returns the tool descriptor", async () => {
  const res = await call("/api/tools/codex.review.diff");
  assert.equal(res.status, 200);
  assert.equal(res.body.tool.name, "codex.review.diff");
  assert.deepEqual(res.body.tool.inputSchema.properties.severityFloor, { enum: ["low", "medium", "high"] });
  assert.equal(res.body.tool.outputCollection, "codexReviewFindings");
});

test("GET /api/tools/claude.review.diff returns the tool descriptor", async () => {
  const res = await call("/api/tools/claude.review.diff");
  assert.equal(res.status, 200);
  assert.equal(res.body.tool.name, "claude.review.diff");
  assert.deepEqual(res.body.tool.inputSchema.properties.severityFloor, { enum: ["low", "medium", "high"] });
  assert.equal(res.body.tool.outputCollection, "claudeReviewFindings");
});

test("POST /api/tools/ccusage.report/invocations creates a governed invocation", async () => {
  const res = await call("/api/tools/ccusage.report/invocations", {
    method: "POST",
    body: {
      report: "daily",
      since: "2026-07-01",
      until: "2026-07-02",
      timezone: "Asia/Shanghai",
      projectId: "projA",
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.tool, "ccusage.report");
  assert.equal(res.body.agentId, "agt_platform_application_wrapper"); // executes via the app capability path now
  assert.equal(res.body.outputCollection, "importedUsageEstimates");
  const invocation = ctx.state.invocations.find((item) => item.id === res.body.invocationId);
  assert.equal(invocation?.projectId, "projA");
  assert.equal(invocation?.options?.metadata?.tool, "ccusage.report");
  assert.equal(invocation?.options?.metadata?.report, "daily");
});

test("POST /api/tools/codex.review.diff/invocations creates a governed invocation", async () => {
  const res = await call("/api/tools/codex.review.diff/invocations", {
    method: "POST",
    body: {
      projectId: "projA",
      worktreeId: "wtA",
      instruction: "Focus on correctness.",
      severityFloor: "medium",
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.tool, "codex.review.diff");
  assert.equal(res.body.agentId, "agt_codex_review_diff");
  assert.equal(res.body.outputCollection, "codexReviewFindings");
  const invocation = ctx.state.invocations.find((item) => item.id === res.body.invocationId);
  assert.equal(invocation?.projectId, "projA");
  assert.equal(invocation?.worktreeId, "wtA");
  assert.equal(invocation?.options?.metadata?.tool, "codex.review.diff");
  assert.equal(invocation?.options?.metadata?.severityFloor, "medium");
});

test("POST /api/tools/claude.review.diff/invocations creates a governed invocation", async () => {
  const res = await call("/api/tools/claude.review.diff/invocations", {
    method: "POST",
    body: {
      projectId: "projA",
      worktreeId: "wtA",
      instruction: "Focus on correctness.",
      severityFloor: "medium",
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.tool, "claude.review.diff");
  assert.equal(res.body.agentId, "agt_claude_review_diff");
  assert.equal(res.body.outputCollection, "claudeReviewFindings");
  const invocation = ctx.state.invocations.find((item) => item.id === res.body.invocationId);
  assert.equal(invocation?.projectId, "projA");
  assert.equal(invocation?.worktreeId, "wtA");
  assert.equal(invocation?.options?.metadata?.tool, "claude.review.diff");
  assert.equal(invocation?.options?.metadata?.severityFloor, "medium");
});

test("GET /api/state exposes unified reviewFindings without raw payloads", async () => {
  ctx.state.invocations.push(
    { id: "inv_review_codex_a", projectId: "projA", worktreeId: "wtA", status: "succeeded" },
    { id: "inv_review_claude_a", projectId: "projA", worktreeId: "wtA", status: "succeeded" },
    { id: "inv_review_claude_b", projectId: "projB", worktreeId: "wtB", status: "succeeded" },
  );
  ctx.state.codexReviewFindings.unshift({
    id: "crf_integration_a",
    source: "codex",
    reviewInvocationId: "inv_review_codex_a",
    invocationId: "inv_review_codex_a",
    projectId: "projA",
    worktreeId: "wtA",
    requestedBy: "usr_a",
    agentId: "agt_codex_review_diff",
    reviewAgentName: "Codex Diff Review",
    tool: "codex.review.diff",
    mode: "diff-review",
    severityFloor: "medium",
    summary: "Codex found 1 issue.",
    findingIndex: 0,
    severity: "high",
    file: "apps/server/src/routes/tools.mjs",
    line: 34,
    message: "Guard project before invocation.",
    suggestion: "Resolve project through facade.",
    confidence: "medium",
    authoritative: false,
    raw: { localPath: "/tmp/secret-codex" },
    createdAt: "2026-07-02T00:00:02.000Z",
  });
  ctx.state.claudeReviewFindings.unshift({
    id: "clf_integration_a",
    source: "claude",
    reviewInvocationId: "inv_review_claude_a",
    invocationId: "inv_review_claude_a",
    projectId: "projA",
    worktreeId: "wtA",
    requestedBy: "usr_a",
    agentId: "agt_claude_review_diff",
    reviewAgentName: "Claude Diff Review",
    tool: "claude.review.diff",
    mode: "diff-review",
    severityFloor: "medium",
    summary: "Claude found 1 issue.",
    findingIndex: 0,
    severity: "medium",
    file: "apps/server/src/services/tools.mjs",
    line: 10,
    message: "Keep facade validation bounded.",
    suggestion: "Reject unknown fields.",
    confidence: "high",
    authoritative: false,
    raw: { localPath: "/tmp/secret-claude" },
    createdAt: "2026-07-02T00:00:03.000Z",
  }, {
    id: "clf_integration_b",
    source: "claude",
    reviewInvocationId: "inv_review_claude_b",
    invocationId: "inv_review_claude_b",
    projectId: "projB",
    worktreeId: "wtB",
    requestedBy: "usr_b",
    agentId: "agt_claude_review_diff",
    reviewAgentName: "Claude Diff Review",
    tool: "claude.review.diff",
    mode: "diff-review",
    severityFloor: "low",
    summary: "Foreign team finding.",
    findingIndex: 0,
    severity: "low",
    file: "private.js",
    line: 1,
    message: "Team B only.",
    suggestion: "Do not leak.",
    confidence: "medium",
    authoritative: false,
    raw: { localPath: "/tmp/team-b-secret" },
    createdAt: "2026-07-02T00:00:04.000Z",
  });

  const res = await call("/api/state", { token: "tok_a" });
  assert.equal(res.status, 200);
  const findings = res.body.reviewFindings.filter((item) => item.id === "crf_integration_a" || item.id === "clf_integration_a" || item.id === "clf_integration_b");
  assert.deepEqual(findings.map((item) => item.id), ["clf_integration_a", "crf_integration_a"]);
  assert.deepEqual(new Set(findings.map((item) => item.source)), new Set(["codex", "claude"]));
  assert.ok(findings.every((item) => !("raw" in item)), "unified public findings must not expose raw payloads");
  assert.ok(!res.body.reviewFindings.some((item) => item.id === "clf_integration_b"), "foreign-team review finding should be hidden");
});

test("GET /api/review-findings queries scoped normalized review results", async () => {
  const byInvocation = await call("/api/review-findings?invocationId=inv_review_claude_a", { token: "tok_a" });
  assert.equal(byInvocation.status, 200);
  assert.equal(byInvocation.body.count, 1);
  assert.equal(byInvocation.body.reviewFindings[0].id, "clf_integration_a");
  assert.equal(byInvocation.body.reviewFindings[0].source, "claude");
  assert.ok(!("raw" in byInvocation.body.reviewFindings[0]));

  const bySourceAndSeverity = await call("/api/review-findings?source=codex&severity=high", { token: "tok_a" });
  assert.equal(bySourceAndSeverity.status, 200);
  assert.ok(bySourceAndSeverity.body.reviewFindings.some((item) => item.id === "crf_integration_a"));
  assert.ok(bySourceAndSeverity.body.reviewFindings.every((item) => item.source === "codex" && item.severity === "high"));

  const foreignProject = await call("/api/review-findings?projectId=projA", { token: "tok_b" });
  assert.equal(foreignProject.status, 404);
  assert.equal(foreignProject.body.error, "project_not_found");

  const invalidSource = await call("/api/review-findings?source=gpt", { token: "tok_a" });
  assert.equal(invalidSource.status, 400);
  assert.equal(invalidSource.body.error, "invalid_source");

  const invalidSeverity = await call("/api/review-findings?severity=critical", { token: "tok_a" });
  assert.equal(invalidSeverity.status, 400);
  assert.equal(invalidSeverity.body.error, "invalid_severity");

  const unknown = await call("/api/review-findings?limit=10", { token: "tok_a" });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, "unknown_field");
  assert.deepEqual(unknown.body.fields, ["limit"]);
});

test("POST /api/tools/ccusage.report/invocations defaults to an actor-owned project", async () => {
  const res = await call("/api/tools/ccusage.report/invocations", {
    token: "tok_b",
    method: "POST",
    body: { report: "daily" },
  });
  assert.equal(res.status, 201);
  const invocation = ctx.state.invocations.find((item) => item.id === res.body.invocationId);
  assert.equal(invocation?.projectId, "projB");
  assert.equal(invocation?.requestedBy, "usr_b");
});

test("tool facade rejects unknown fields, online mode, and session reports", async () => {
  const unknown = await call("/api/tools/ccusage.report/invocations", { method: "POST", body: { report: "daily", shell: true } });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, "unknown_field");

  const online = await call("/api/tools/ccusage.report/invocations", { method: "POST", body: { report: "daily", offline: false } });
  assert.equal(online.status, 409);
  assert.equal(online.body.error, "approval_required");

  const session = await call("/api/tools/ccusage.report/invocations", { method: "POST", body: { report: "session" } });
  assert.equal(session.status, 409);
  assert.equal(session.body.error, "approval_required");
});

test("codex review facade rejects invalid input and foreign worktrees", async () => {
  const beforeCount = ctx.state.invocations.length;
  const unknown = await call("/api/tools/codex.review.diff/invocations", {
    method: "POST",
    body: { projectId: "projA", worktreeId: "wtA", shell: true },
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, "unknown_field");

  const missing = await call("/api/tools/codex.review.diff/invocations", {
    method: "POST",
    body: { projectId: "projA" },
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, "worktree_required");

  const invalidSeverity = await call("/api/tools/codex.review.diff/invocations", {
    method: "POST",
    body: { projectId: "projA", worktreeId: "wtA", severityFloor: "critical" },
  });
  assert.equal(invalidSeverity.status, 400);
  assert.equal(invalidSeverity.body.error, "invalid_severity_floor");

  const longInstruction = await call("/api/tools/codex.review.diff/invocations", {
    method: "POST",
    body: { projectId: "projA", worktreeId: "wtA", instruction: "x".repeat(1201) },
  });
  assert.equal(longInstruction.status, 400);
  assert.equal(longInstruction.body.error, "instruction_too_long");

  const foreignWorktree = await call("/api/tools/codex.review.diff/invocations", {
    token: "tok_b",
    method: "POST",
    body: { projectId: "projB", worktreeId: "wtA" },
  });
  assert.equal(foreignWorktree.status, 404);
  assert.equal(foreignWorktree.body.error, "worktree_not_found");
  assert.equal(ctx.state.invocations.length, beforeCount);
});

test("claude review facade rejects invalid input and foreign worktrees", async () => {
  const beforeCount = ctx.state.invocations.length;
  const unknown = await call("/api/tools/claude.review.diff/invocations", {
    method: "POST",
    body: { projectId: "projA", worktreeId: "wtA", permissionMode: "bypassPermissions" },
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, "unknown_field");

  const missing = await call("/api/tools/claude.review.diff/invocations", {
    method: "POST",
    body: { projectId: "projA" },
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, "worktree_required");

  const invalidSeverity = await call("/api/tools/claude.review.diff/invocations", {
    method: "POST",
    body: { projectId: "projA", worktreeId: "wtA", severityFloor: "critical" },
  });
  assert.equal(invalidSeverity.status, 400);
  assert.equal(invalidSeverity.body.error, "invalid_severity_floor");

  const foreignWorktree = await call("/api/tools/claude.review.diff/invocations", {
    token: "tok_b",
    method: "POST",
    body: { projectId: "projB", worktreeId: "wtA" },
  });
  assert.equal(foreignWorktree.status, 404);
  assert.equal(foreignWorktree.body.error, "worktree_not_found");
  assert.equal(ctx.state.invocations.length, beforeCount);
});

test("tool facade denies a foreign project before creating an invocation", async () => {
  const beforeCount = ctx.state.invocations.length;
  const res = await call("/api/tools/ccusage.report/invocations", {
    token: "tok_b",
    method: "POST",
    body: { report: "daily", projectId: "projA" },
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "project_not_found");
  assert.equal(ctx.state.invocations.length, beforeCount);
});

test("tool facade rejects null JSON input without throwing", async () => {
  const beforeCount = ctx.state.invocations.length;
  const res = await call("/api/tools/ccusage.report/invocations", {
    method: "POST",
    body: null,
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_input");
  assert.equal(ctx.state.invocations.length, beforeCount);
});

function agentFromRegistration(registration) {
  return {
    id: registration.id,
    name: registration.name,
    description: registration.description,
    ownerUserId: "usr_local",
    location: { type: "local_device", deviceId: "dev_local_001" },
    adapter: {
      type: "cli",
      command: registration.command,
      args: registration.args,
      outputFormat: registration.outputFormat,
      cancellation: "supported",
    },
    lifecycle: { state: "enabled", installState: "installed", version: "0.0.0", managedBy: "bridge" },
    economics: {
      model: registration.economicModel,
      pricingDimensions: registration.pricingDimensions,
      currency: registration.currency,
      costOwner: registration.costOwner,
      budgetPoolId: null,
      unknownCostPolicy: registration.unknownCostPolicy,
    },
    capabilities: [{
      name: registration.capabilityName,
      description: registration.capabilityDescription,
      riskLevel: registration.riskLevel,
      riskTags: registration.riskTags,
    }],
    toolContract: registration.toolContract,
    registrationNotes: registration.registrationNotes,
    createdAt: now(),
  };
}

function writeDoocsMcpFixture(root) {
  mkdirSync(`${root}/.vscode`, { recursive: true });
  mkdirSync(`${root}/packages/mcp-server/src`, { recursive: true });
  writeFileSync(`${root}/package.json`, JSON.stringify({
    name: "md",
    version: "2.1.0",
    scripts: { mcp: "pnpm --filter @md/mcp-server" },
  }, null, 2), "utf8");
  writeFileSync(`${root}/.vscode/mcp.json`, JSON.stringify({
    servers: {
      md: {
        type: "stdio",
        command: "node",
        args: ["--import", "tsx/esm", "${workspaceFolder}/packages/mcp-server/run.mjs"],
        cwd: "${workspaceFolder}/packages/mcp-server",
      },
    },
  }, null, 2), "utf8");
  writeFileSync(`${root}/packages/mcp-server/package.json`, JSON.stringify({
    name: "@md/mcp-server",
    scripts: { start: "node --import tsx/esm run.mjs" },
  }, null, 2), "utf8");
  writeFileSync(`${root}/packages/mcp-server/run.mjs`, "import('./src/index.ts')\n", "utf8");
  writeFileSync(`${root}/packages/mcp-server/src/index.ts`, [
    "server.registerTool(`render_markdown`, {}, async () => ({}))",
    "server.registerTool(`list_themes`, {}, async () => ({}))",
  ].join("\n"), "utf8");
}

function writeManualMcpFixture(root) {
  mkdirSync(`${root}/.vscode`, { recursive: true });
  mkdirSync(`${root}/packages/mcp-server`, { recursive: true });
  writeFileSync(`${root}/package.json`, JSON.stringify({
    name: "md-manual",
    version: "2.1.0",
  }, null, 2), "utf8");
  writeFileSync(`${root}/packages/mcp-server/run.mjs`, "process.exit(0)\n", "utf8");
  writeFileSync(`${root}/.vscode/mcp.json`, JSON.stringify({
    servers: {
      shell: {
        type: "stdio",
        command: process.platform === "win32" ? "cmd.exe" : "sh",
        args: ["${workspaceFolder}/packages/mcp-server/run.mjs"],
        allowedTools: ["render_markdown"],
      },
      remote: {
        type: "http",
        url: "https://mcp.example.test/rpc?token=secret#fragment",
        allowedTools: ["render_markdown"],
      },
    },
  }, null, 2), "utf8");
}

async function createApplicationOrchestrationRunForTest({
  status = "queued",
  delivery = { state: "queued", dispatchAttempts: 0 },
  cancellation = { state: "none" },
} = {}) {
  const created = await call("/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/run", {
    method: "POST",
    body: { agentId: "agt_platform_application_control" },
    token: "tok_a",
  });
  assert.equal(created.status, 201);
  const invocation = ctx.state.invocations.find((item) => item.id === created.body.invocationId);
  assert.ok(invocation, "expected application orchestration invocation");
  invocation.status = status;
  invocation.delivery = delivery;
  invocation.cancellation = cancellation;
  invocation.updatedAt = now();
  return invocation;
}

function findApplicationForTest(applicationId) {
  const application = ctx.state.applications.find((item) => item.id === applicationId);
  assert.ok(application, `expected test application ${applicationId}`);
  return application;
}
