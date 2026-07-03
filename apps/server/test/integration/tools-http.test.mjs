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
  const { createCcusageAgentRegistration } = await import("../../src/services/ccusage-agent.mjs");
  const { createApplicationWrapperAgentRegistration } = await import("../../src/services/applications.mjs");

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
  }, {
    ...agentFromRegistration(createApplicationWrapperAgentRegistration()),
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
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "approval_required");

  // With approval, the wrapper capability now dispatches a QUEUED invocation to
  // the platform Application Wrapper Runner (bridge execution, #359), carrying
  // the server-resolved approved command in allowlisted metadata — rather than
  // returning a synchronous, non-executable descriptor.
  const invoked = await call(`/api/capabilities/app.${appId}.wrapper.lint/invocations`, {
    method: "POST",
    body: { approvalToken: "operator-approved-wrapper" },
    token: "tok_a",
  });
  assert.equal(invoked.status, 202);
  assert.equal(invoked.body.agentId, "agt_platform_application_wrapper");
  assert.equal(invoked.body.status, "queued");
  const wrapper = invoked.body.invocation.options.metadata.applicationWrapper;
  assert.equal(wrapper.execCommand, "lint");
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

test("POST /api/capabilities generate_orchestration writes a routine draft", async () => {
  const application = findApplicationForTest("app_team_a");
  application.status = "active";
  const noToken = await call("/api/capabilities/app.app_team_a.generate_orchestration/invocations", {
    method: "POST",
    body: {},
    token: "tok_a",
  });
  assert.equal(noToken.status, 409);
  assert.equal(noToken.body.error, "approval_required");

  const res = await call("/api/capabilities/app.app_team_a.generate_orchestration/invocations", {
    method: "POST",
    body: { approvalToken: "operator-approved-generate" },
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
  const generated = await call("/api/applications/app_team_a/orchestrations/generate", {
    method: "POST",
    body: { approvalToken: "operator-approved-generate" },
    token: "tok_a",
  });
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
  const generated = await call("/api/applications/app_team_a/orchestrations/generate", {
    method: "POST",
    body: { approvalToken: "operator-approved-generate" },
    token: "tok_a",
  });
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
  const generated = await call("/api/applications/app_team_a/orchestrations/generate", {
    method: "POST",
    body: { approvalToken: "operator-approved-generate" },
    token: "tok_a",
  });
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
  const generated = await call("/api/applications/app_team_a/orchestrations/generate", {
    method: "POST",
    body: { approvalToken: "operator-approved-generate" },
    token: "tok_a",
  });
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
  const generated = await call("/api/applications/app_team_a/orchestrations/generate", {
    method: "POST",
    body: { approvalToken: "operator-approved-generate" },
    token: "tok_a",
  });
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
  const generated = await call("/api/applications/app_team_a/orchestrations/generate", {
    method: "POST",
    body: { approvalToken: "operator-approved-generate" },
    token: "tok_a",
  });
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
  const generated = await call("/api/applications/app_team_a/orchestrations/generate", {
    method: "POST",
    body: { approvalToken: "operator-approved-generate" },
    token: "tok_a",
  });
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
  assert.equal(approvalRequired.body.recoveryActionRequest.status, "approval_pending");
  assert.equal(approvalRequired.body.recoveryActionRequest.actionType, "regenerate_orchestration");
  assert.ok(approvalRequired.body.approvalRequest.id);
  assert.equal(approvalRequired.body.approvalRequest.applicationRecoveryActionRequestId, approvalRequired.body.recoveryActionRequest.id);
  assert.ok(ctx.state.events.some((event) => event.invocationId === validation.id
    && event.type === "application_orchestration_recovery_approval_requested"
    && event.data?.recoveryActionRequestId === approvalRequired.body.recoveryActionRequest.id));

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

  const directRegenerate = await call(`/api/applications/app_team_a/orchestrations/app-app_team_a-maintenance/runs/${encodeURIComponent(validation.id)}/recovery/actions`, {
    method: "POST",
    body: { actionType: "regenerate_orchestration", approvalToken: "operator-approved-recovery" },
    token: "tok_a",
  });
  assert.equal(directRegenerate.status, 201);
  assert.equal(directRegenerate.body.recoveryActionRequest.status, "executed");
  assert.equal(directRegenerate.body.recoveryActionRequest.resultOrchestrationId, "app-app_team_a-maintenance");

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
  assert.equal(selectUnhealthyAgent.body.recoveryActionRequest.status, "failed");
  assert.equal(selectUnhealthyAgent.body.recoveryActionRequest.selectedAgentId, null);
  assert.equal(selectUnhealthyAgent.body.recoveryActionRequest.requestedAgentId, "agt_demo_cli");
  assert.ok(Array.isArray(selectUnhealthyAgent.body.recoveryActionRequest.agentCandidateSnapshot));
  assert.ok(selectUnhealthyAgent.body.recoveryActionRequest.agentCandidateSnapshot.some((candidate) => candidate.id === "agt_demo_cli"
    && candidate.selectable === false
    && candidate.reasons.includes("application_control_missing")));
  const stateAfterRejectedSelectAgent = await call("/api/state", { token: "tok_a" });
  const rejectedSelectAgentReadModel = stateAfterRejectedSelectAgent.body.applicationRecoveryActions.find((item) => item.id === selectUnhealthyAgent.body.recoveryActionRequest.id);
  assert.equal(rejectedSelectAgentReadModel?.outcome?.state, "needs_attention");
  assert.equal(rejectedSelectAgentReadModel?.outcomeReason, "healthy_agent_not_found");
  assert.equal(rejectedSelectAgentReadModel?.outcome?.severity, "danger");
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
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "approval_required");

  const approved = await call("/api/applications/app_team_a/offline", {
    method: "POST",
    body: { approvalToken: "operator-approved-offline" },
    token: "tok_a",
  });
  assert.equal(approved.status, 201);
  assert.equal(approved.body.invocation.result.output.status, "offline");

  const onlineBlocked = await call("/api/applications/app_team_a/online", {
    method: "POST",
    body: {},
    token: "tok_a",
  });
  assert.equal(onlineBlocked.status, 409);
  assert.equal(onlineBlocked.body.error, "approval_required");

  const online = await call("/api/applications/app_team_a/online", {
    method: "POST",
    body: { approvalToken: "operator-approved-online" },
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
