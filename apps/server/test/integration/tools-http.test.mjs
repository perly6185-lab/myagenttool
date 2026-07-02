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
