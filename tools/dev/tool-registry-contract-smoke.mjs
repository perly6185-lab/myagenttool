import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClaudeReviewAgentRegistration } from "../../apps/server/src/services/claude-agent.mjs";
import { createCodexReviewAgentRegistration } from "../../apps/server/src/services/codex-agent.mjs";
import { createCapabilityService } from "../../apps/server/src/services/capabilities.mjs";
import { createToolService } from "../../apps/server/src/services/tools.mjs";
import { createApplicationService } from "../../apps/server/src/services/applications.mjs";
import { createCcusageApplicationRegistration } from "../../apps/server/src/services/ccusage-application.mjs";
import { handleToolRoutes } from "../../apps/server/src/routes/tools.mjs";

const fixturePath = resolve("docs/engineering/fixtures/tool-registry-contract.v1.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
let passed = 0;

const ok = (message) => {
  passed += 1;
  console.log(`  ok - ${message}`);
};

assert.equal(fixture.contractVersion, "1");
assert.deepEqual(fixture.stableEndpoints, [
  "GET /api/tools",
  "GET /api/tools/{toolName}",
  "POST /api/tools/{toolName}/invocations",
  "GET /api/review-findings",
  "GET /api/state",
]);
ok("fixture declares v1 stable endpoints");
assert(fixture.stableStateCollections.includes("reviewFindings"), "fixture should declare the unified review findings collection");
assert.equal(fixture.recommendedReviewOutputCollection, "reviewFindings");
assert.deepEqual([...fixture.reviewFindingQuery.allowedFilters].sort(), [
  "invocationId",
  "projectId",
  "severity",
  "source",
  "worktreeId",
]);
assert(fixture.exampleClients.some((client) => client.path === "tools/dev/tool-registry-review-client.mjs"), "fixture should declare the review client example");
ok("fixture declares the recommended unified review output collection");

const state = {
  device: { id: "dev_local_001", status: "online", unlinkState: "linked" },
  projects: [{ id: "prj_local", ownerTeamId: "team_local" }],
  worktrees: [{ id: "wtr_local", projectId: "prj_local", workspaceProjectId: "prj_local", worktreePath: process.cwd() }],
  applications: [],
  agents: [
    {
      id: "agt_platform_application_wrapper",
      name: "Application Wrapper Runner",
      status: "available",
      adapter: { type: "cli", command: "node", args: ["tools/agents/application-wrapper.mjs"] },
      location: { type: "local_device", deviceId: "dev_local_001" },
      economics: { model: "free", costOwner: "usr_local", currency: "USD", budgetPoolId: null },
    },
    agentFromRegistration(createCodexReviewAgentRegistration()),
    agentFromRegistration(createClaudeReviewAgentRegistration()),
  ],
  invocations: [],
  events: [],
};

// ccusage.report is backed by the ccusage Application capability path now.
const appSvc = createApplicationService({
  state,
  now: () => "2026-07-02T00:00:00Z",
  nextId: (p) => `${p}_${state.invocations.length}`,
  appendEvent: (event) => state.events.push(event),
  persistStateSoon: () => {},
  addProject: () => null,
  cloneProject: () => null,
  defaultProjectPath: "/tmp/tool-contract-smoke",
});
appSvc.registerApplication(createCcusageApplicationRegistration());

const service = createToolService({
  state,
  now: () => "2026-07-02T00:00:00Z",
  appendEvent: (event) => state.events.push(event),
  createInvocation: (task, agent, options) => {
    const invocation = {
      id: `inv_${state.invocations.length + 1}`,
      agentId: agent.id,
      projectId: options.metadata?.projectId ?? null,
      worktreeId: options.metadata?.worktreeId ?? null,
      requestedBy: options.requestedBy ?? null,
      status: "queued",
      input: { task },
      options: { metadata: options.metadata ?? {} },
    };
    state.invocations.unshift(invocation);
    return invocation;
  },
  startInvocationIfAllowed: () => {},
  findApplication: appSvc.findApplication,
  findAgent: (id) => state.agents.find((agent) => agent.id === id) ?? null,
  planApplicationWrapperInvocation: appSvc.planApplicationWrapperInvocation,
});

const descriptors = service.listTools();
const descriptorsByName = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]));
for (const toolName of Object.keys(fixture.tools)) {
  const descriptor = descriptorsByName.get(toolName);
  assert.ok(descriptor, `${toolName} should be discoverable`);
  assertDescriptorMatchesFixture(descriptor, fixture.tools[toolName]);
}
ok("descriptors match the external fixture");

for (const descriptor of descriptors) {
  const serialized = JSON.stringify(descriptor);
  for (const forbidden of fixture.forbiddenDescriptorFields) {
    assert(!containsForbiddenFieldName(descriptor, forbidden), `descriptor ${descriptor.name} exposes forbidden field ${forbidden}`);
  }
  assert(!serialized.includes("wrapper.mjs"), `descriptor ${descriptor.name} exposes wrapper internals`);
  assert(!serialized.includes("codex-review-wrapper.mjs"), `descriptor ${descriptor.name} exposes Codex wrapper internals`);
  assert(!serialized.includes("ccusage-wrapper.mjs"), `descriptor ${descriptor.name} exposes ccusage wrapper internals`);
}
ok("descriptors do not expose raw execution fields");

const capabilities = createCapabilityService({
  state,
  listTools: service.listTools,
  getTool: service.getTool,
  createToolInvocation: service.createToolInvocation,
  listApplications: () => [],
  listApplicationCapabilities: () => [],
}).listCapabilities({ userId: "usr_local", teamId: "team_local" });
const ccusageCapability = capabilities.find((capability) => capability.name === "ccusage.report");
assert.equal(ccusageCapability?.provider?.type, "tool");
assert.equal(ccusageCapability?.invocationMode, "tool-facade");
assert(!JSON.stringify(capabilities).includes("wrapper.mjs"), "capability registry must not expose wrapper internals");
ok("capability registry maps governed tools without exposing raw execution fields");

const ccusageCreated = service.createToolInvocation("ccusage.report", fixture.tools["ccusage.report"].exampleInput, {
  userId: "usr_local",
  teamId: "team_local",
});
assert.equal(ccusageCreated.status, 201);
assert.equal(ccusageCreated.body.outputCollection, fixture.tools["ccusage.report"].outputCollection);

const codexCreated = service.createToolInvocation("codex.review.diff", fixture.tools["codex.review.diff"].exampleInput, {
  userId: "usr_local",
  teamId: "team_local",
});
assert.equal(codexCreated.status, 201);
assert.equal(codexCreated.body.outputCollection, fixture.tools["codex.review.diff"].outputCollection);

const claudeCreated = service.createToolInvocation("claude.review.diff", fixture.tools["claude.review.diff"].exampleInput, {
  userId: "usr_local",
  teamId: "team_local",
});
assert.equal(claudeCreated.status, 201);
assert.equal(claudeCreated.body.outputCollection, fixture.tools["claude.review.diff"].outputCollection);
ok("fixture example inputs create governed invocations");

const unknown = service.createToolInvocation("codex.review.diff", {
  ...fixture.tools["codex.review.diff"].exampleInput,
  shell: true,
}, { userId: "usr_local", teamId: "team_local" });
assert.equal(unknown.status, 400);
assert.equal(unknown.body.error, "unknown_field");

assertStableError("codex.review.diff", unknown);
assertStableError("codex.review.diff", service.createToolInvocation("codex.review.diff", {
  projectId: "prj_local",
}, { userId: "usr_local", teamId: "team_local" }));
assertStableError("codex.review.diff", service.createToolInvocation("codex.review.diff", {
  ...fixture.tools["codex.review.diff"].exampleInput,
  severityFloor: "critical",
}, { userId: "usr_local", teamId: "team_local" }));
assertStableError("codex.review.diff", service.createToolInvocation("codex.review.diff", {
  ...fixture.tools["codex.review.diff"].exampleInput,
  instruction: "x".repeat(1201),
}, { userId: "usr_local", teamId: "team_local" }));
assertStableError("codex.review.diff", service.createToolInvocation("codex.review.diff", {
  ...fixture.tools["codex.review.diff"].exampleInput,
  projectId: "prj_missing",
}, { userId: "usr_local", teamId: "team_local" }));
assertStableError("claude.review.diff", service.createToolInvocation("claude.review.diff", {
  ...fixture.tools["claude.review.diff"].exampleInput,
  permissionMode: "bypassPermissions",
}, { userId: "usr_local", teamId: "team_local" }));
assertStableError("claude.review.diff", service.createToolInvocation("claude.review.diff", {
  projectId: "prj_local",
}, { userId: "usr_local", teamId: "team_local" }));
assertStableError("claude.review.diff", service.createToolInvocation("claude.review.diff", {
  ...fixture.tools["claude.review.diff"].exampleInput,
  severityFloor: "critical",
}, { userId: "usr_local", teamId: "team_local" }));
assertStableError("claude.review.diff", service.createToolInvocation("claude.review.diff", {
  ...fixture.tools["claude.review.diff"].exampleInput,
  instruction: "x".repeat(1201),
}, { userId: "usr_local", teamId: "team_local" }));
assertStableError("claude.review.diff", service.createToolInvocation("claude.review.diff", {
  ...fixture.tools["claude.review.diff"].exampleInput,
  projectId: "prj_missing",
}, { userId: "usr_local", teamId: "team_local" }));
assertStableError("ccusage.report", service.createToolInvocation("ccusage.report", {
  report: "daily",
  shell: true,
}, { userId: "usr_local", teamId: "team_local" }));
assertStableError("ccusage.report", service.createToolInvocation("ccusage.report", {
  report: "daily",
  since: "2026/07/01",
}, { userId: "usr_local", teamId: "team_local" }));
assert(fixture.tools["ccusage.report"].stableErrorCodes.includes("project_not_found"), "ccusage.report fixture should include route-level project guard errors");
assert(fixture.tools["codex.review.diff"].stableErrorCodes.includes("project_not_found"), "codex.review.diff fixture should include route-level project guard errors");
assert(fixture.tools["claude.review.diff"].stableErrorCodes.includes("project_not_found"), "claude.review.diff fixture should include route-level project guard errors");
ok("facade validation errors are listed in the fixture");

// The `project_not_found` guard is emitted only by the HTTP route
// (denyForeignProject), never by the service layer. Assert it against the real
// route so a rename/removal fails this smoke instead of silently drifting from
// the fixture the external consumer relies on.
for (const toolName of Object.keys(fixture.tools)) {
  const response = await runToolRoute({
    method: "POST",
    pathname: `/api/tools/${toolName}/invocations`,
    body: { ...(fixture.tools[toolName].exampleInput ?? {}), projectId: "prj_foreign" },
    actor: { userId: "usr_local", teamId: "team_local" },
  });
  assert.equal(response.status, 404, `${toolName} route should reject a foreign projectId`);
  assert.equal(response.body.error, "project_not_found", `${toolName} route should emit project_not_found`);
  assert(
    fixture.tools[toolName].stableErrorCodes.includes(response.body.error),
    `${toolName} route emitted ${response.body.error}, absent from the fixture contract`,
  );
}
ok("route-level project guard emits project_not_found (contract enforced against runtime)");

console.log(`\ntool-registry-contract-smoke: ${passed} checks passed`);

async function runToolRoute({ method, pathname, body, actor }) {
  const captured = { status: null, body: null };
  const handled = await handleToolRoutes({
    req: { method },
    res: {},
    url: { pathname },
    sendJson: (_res, status, payload) => {
      captured.status = status;
      captured.body = payload;
    },
    readJson: async () => body,
    state,
    actor,
    listTools: service.listTools,
    getTool: service.getTool,
    createToolInvocation: service.createToolInvocation,
  });
  assert(handled, `route did not handle ${method} ${pathname}`);
  return captured;
}

function assertDescriptorMatchesFixture(descriptor, spec) {
  for (const field of fixture.descriptorRequiredFields) {
    assert(Object.hasOwn(descriptor, field), `${descriptor.name} descriptor missing ${field}`);
  }
  assert.equal(descriptor.version, spec.version);
  assert.equal(descriptor.outputCollection, spec.outputCollection);
  assert.equal(descriptor.authoritativeBilling, spec.authoritativeBilling);

  const schemaFields = Object.keys(descriptor.inputSchema?.properties ?? {}).sort();
  assert.deepEqual(schemaFields, [...spec.allowedInputFields].sort(), `${descriptor.name} input fields drifted`);
  for (const required of spec.requiredInputFields) {
    assert((descriptor.inputSchema?.required ?? []).includes(required), `${descriptor.name} schema missing required field ${required}`);
  }
}

function containsForbiddenFieldName(value, forbidden) {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenFieldName(item, forbidden));
  }
  return Object.entries(value).some(([key, child]) => key === forbidden || containsForbiddenFieldName(child, forbidden));
}

function assertStableError(toolName, result) {
  assert(result.status >= 400, `${toolName} negative case should fail`);
  const stable = fixture.tools[toolName]?.stableErrorCodes ?? [];
  assert(stable.includes(result.body?.error), `${toolName} fixture missing stable error code ${result.body?.error}`);
}

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
      unknownCostPolicy: registration.unknownCostPolicy,
    },
    capabilities: [{
      name: registration.capabilityName,
      description: registration.capabilityDescription,
      riskLevel: registration.riskLevel,
      riskTags: registration.riskTags,
    }],
    toolContract: registration.toolContract,
    status: "available",
    health: { status: "healthy", checkedAt: "2026-07-02T00:00:00Z", message: "ok", nextAction: null },
    registrationNotes: registration.registrationNotes,
    createdAt: "2026-07-02T00:00:00Z",
    updatedAt: "2026-07-02T00:00:00Z",
  };
}
