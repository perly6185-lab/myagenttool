process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
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
  const { createCcusageAgentRegistration } = await import("../../src/services/ccusage-agent.mjs");

  const { defaultProject, state } = createServerState({ defaultProjectPath: "/tmp", now });
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
  state.agents.push({
    ...agentFromRegistration(createCcusageAgentRegistration({
      reportId: "daily",
      cliScriptPath: "/usr/local/lib/node_modules/ccusage/src/cli.js",
    })),
    status: "available",
    health: { status: "healthy", checkedAt: now(), message: "ok", nextAction: null },
  }, {
    ...agentFromRegistration(createCodexReviewAgentRegistration()),
    status: "available",
    health: { status: "healthy", checkedAt: now(), message: "ok", nextAction: null },
  }, {
    ...agentFromRegistration(createClaudeReviewAgentRegistration()),
    status: "available",
    health: { status: "healthy", checkedAt: now(), message: "ok", nextAction: null },
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
  assert.equal(res.body.agentId, "agt_ccusage_daily");
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
