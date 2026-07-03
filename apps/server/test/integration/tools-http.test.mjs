process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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

test("GET /api/capabilities includes governed tools and scoped application capabilities", async () => {
  const teamA = await call("/api/capabilities", { token: "tok_a" });
  assert.equal(teamA.status, 200);
  assert.ok(teamA.body.capabilities.some((item) => item.name === "ccusage.report" && item.provider?.type === "tool"));
  assert.ok(teamA.body.capabilities.some((item) => item.name === "app.app_team_a.inspect" && item.provider?.type === "application"));
  assert.ok(!JSON.stringify(teamA.body.capabilities).includes("wrapper.mjs"), "capability discovery must not expose wrapper internals");

  const teamB = await call("/api/capabilities?providerType=application", { token: "tok_b" });
  assert.equal(teamB.status, 200);
  assert.ok(!teamB.body.capabilities.some((item) => item.name === "app.app_team_a.inspect"), "foreign application capability should be hidden");
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
  assert.equal(offlineWithoutApproval.status, 409);
  assert.equal(offlineWithoutApproval.body.error, "approval_required");

  const offline = await call("/api/capabilities/app.app_team_a.offline/invocations", {
    method: "POST",
    body: { approvalToken: "operator-approved-offline" },
    token: "tok_a",
  });
  assert.equal(offline.status, 201);
  assert.equal(offline.body.invocation.result.output.status, "offline");
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
  assert.ok(probe.capabilities.some((item) => item.name === "app.app_team_a.inferred.bin.team-a" && item.source === "inferred" && item.invocationMode === "not_invokable"));
  assert.ok(probe.capabilities.some((item) => item.name === "app.app_team_a.inferred.script.test" && item.source === "inferred"));
  assert.ok(probe.capabilities.some((item) => item.name === "app.app_team_a.inferred.module.exports" && item.source === "inferred"));
  assert.ok(!probe.capabilities.some((item) => item.name.includes("postinstall")), "unsafe lifecycle scripts should not be inferred");
  assert.ok(probe.capabilityNames.includes("app.app_team_a.offline"), "probe should keep a name index for compatibility");
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

test("POST /api/capabilities generate_orchestration writes a routine draft", async () => {
  const application = findApplicationForTest("app_team_a");
  application.status = "active";
  const res = await call("/api/capabilities/app.app_team_a.generate_orchestration/invocations", {
    method: "POST",
    body: {},
    token: "tok_a",
  });
  assert.equal(res.status, 201);
  const orchestration = res.body.invocation.result.output.orchestration;
  assert.equal(orchestration.kind, "LoopRoutineDraft");
  assert.equal(orchestration.relativePath, ".myagenttool/routines/app-team-a-app-maintenance.json");
  assert.ok(existsSync(orchestration.path), "routine draft should be written to disk");
  assert.ok(application.orchestrations.some((item) => item.routineId === orchestration.id));
});

test("application orchestration endpoints generate and list routine drafts", async () => {
  findApplicationForTest("app_team_a").status = "active";
  const generated = await call("/api/applications/app_team_a/orchestrations/generate", {
    method: "POST",
    body: {},
    token: "tok_a",
  });
  assert.equal(generated.status, 201);
  assert.equal(generated.body.invocation.result.output.orchestration.id, "app-team-a-app-maintenance");

  const listed = await call("/api/applications/app_team_a/orchestrations", { token: "tok_a" });
  assert.equal(listed.status, 200);
  assert.ok(listed.body.orchestrations.some((item) => item.routineId === "app-team-a-app-maintenance"));

  const foreign = await call("/api/applications/app_team_a/orchestrations", { token: "tok_b" });
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
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "approval_required");

  const approved = await call("/api/applications/app_team_a/offline", {
    method: "POST",
    body: { approvalToken: "operator-approved-offline" },
    token: "tok_a",
  });
  assert.equal(approved.status, 201);
  assert.equal(approved.body.invocation.result.output.status, "offline");
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

function findApplicationForTest(applicationId) {
  const application = ctx.state.applications.find((item) => item.id === applicationId);
  assert.ok(application, `expected test application ${applicationId}`);
  return application;
}
