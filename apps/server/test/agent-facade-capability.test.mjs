/*
 * agent_facade execution mode (#975): an Application capability backed by a
 * registered Agent, the agent-shaped sibling of tool_facade.
 *
 * The mode name is load-bearing audit metadata — it records WHICH trust regime
 * execution was delegated to (a platform-curated Tool vs. user-registered
 * agent code), so agents are NOT projected into the Tool Registry. These tests
 * pin the whole contract: registration validation (toolName XOR agentId),
 * projection shape, live readiness overlay, lineage-stamped dispatch, the
 * approval gate, the two independent tool gates (descriptor + the agent's own
 * allowedTools), precise refusals for a missing agent, restart survival, and
 * the gateway's options.toolName passthrough that multi-tool MCP agents need.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationService } from "../src/services/applications.mjs";
import { createCapabilityService } from "../src/services/capabilities.mjs";
import { createInvocationCreationRuntime } from "../src/services/invocations/creation.mjs";

const MAIL_AGENT = {
  id: "agt_mcp_mail",
  name: "Mail (read-only)",
  status: "available",
  adapter: { type: "mcp", transport: "stdio", allowedTools: ["mail_list_unread", "mail_fetch"] },
};

const REGISTRATION = {
  id: "app_gmail",
  name: "gmail",
  source: { type: "manual" },
  capabilityFacades: [
    {
      id: "list_unread",
      agentId: "agt_mcp_mail",
      agentToolName: "mail_list_unread",
      displayName: "List unread mail",
      riskLevel: "medium",
      riskTags: ["untrusted_input"],
      requiresApproval: false,
      inputSchema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer" } } },
    },
    {
      id: "fetch",
      agentId: "agt_mcp_mail",
      agentToolName: "mail_fetch",
      displayName: "Fetch one message",
      requiresApproval: true,
    },
  ],
};

function applicationService(state = { applications: [] }, extra = {}) {
  return createApplicationService({
    state,
    now: () => "2026-07-14T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
    ...extra,
  });
}

function capabilityService(applications, { agent = MAIL_AGENT, createInvocation, state = { applications: [] } } = {}) {
  const created = [];
  const service = createCapabilityService({
    state,
    refuse: null,
    listTools: () => [],
    getTool: () => null,
    createToolInvocation: () => { throw new Error("unexpected tool invocation"); },
    createInvocation: createInvocation ?? ((task, invocationAgent, options) => {
      const invocation = { id: "inv_1", status: "queued", task, agentId: invocationAgent.id, options };
      created.push({ task, agent: invocationAgent, options });
      return invocation;
    }),
    completeInvocation: () => {},
    findAgent: (id) => (agent && id === agent.id ? agent : null),
    listApplications: applications.listApplications,
    listApplicationCapabilities: applications.listApplicationCapabilities,
    invokeApplicationCapability: applications.invokeApplicationCapability,
    planAgentFacadeInvocation: applications.planAgentFacadeInvocation,
    planApplicationWrapperInvocation: applications.planApplicationWrapperInvocation,
  });
  return { service, created };
}

test("a facade declares exactly one of toolName (tool) or agentId (agent)", () => {
  const service = applicationService();
  for (const facade of [
    { id: "both", toolName: "t", agentId: "a" },
    { id: "neither" },
    { id: "orphan-tool-pick", toolName: "t", agentToolName: "x" },
  ]) {
    assert.throws(
      () => service.registerApplication({ name: "bad", source: { type: "manual" }, capabilityFacades: [facade] }),
      /exactly one of toolName|agentToolName is only valid/,
      `facade ${facade.id} must be refused`,
    );
  }
});

test("an agent facade projects kind agent_facade with honest execution metadata", () => {
  const state = { applications: [] };
  const service = applicationService(state);
  service.registerApplication(REGISTRATION);
  const capability = service.listApplicationCapabilities("app_gmail")
    .find((item) => item.name === "app.app_gmail.list_unread");
  assert.equal(capability.kind, "agent_facade");
  assert.deepEqual(capability.metadata.execution, {
    mode: "agent_facade",
    agentId: "agt_mcp_mail",
    toolName: "mail_list_unread",
  });
  assert.deepEqual(capability.metadata.compatibilityFacade, { type: "agent", name: "agt_mcp_mail" });
  assert.equal(capability.metadata.readiness.executionMode, "agent_facade");
  // The descriptor is fingerprinted: the agent binding is part of the immutable
  // contract (ADR 0009) — re-pointing it is a re-registration, not an edit.
  assert.match(state.applications[0].descriptorFingerprint, /^sha256:[0-9a-f]{64}$/u);
});

test("discovery overlays the LIVE agent state onto readiness", () => {
  const applications = applicationService();
  applications.registerApplication(REGISTRATION);

  const ready = capabilityService(applications).service
    .getCapability("app.app_gmail.list_unread");
  assert.equal(ready.metadata.readiness.state, "ready");
  assert.equal(ready.metadata.readiness.reason, "agent_available");
  assert.equal(ready.metadata.readiness.agentStatus, "available");

  const missing = capabilityService(applications, { agent: null }).service
    .getCapability("app.app_gmail.list_unread");
  assert.equal(missing.metadata.readiness.state, "needs_setup");
  assert.equal(missing.metadata.readiness.reason, "agent_not_registered");

  const disabled = capabilityService(applications, { agent: { ...MAIL_AGENT, status: "disabled" } }).service
    .getCapability("app.app_gmail.list_unread");
  assert.equal(disabled.metadata.readiness.reason, "agent_disabled");
});

test("dispatch creates a lineage-stamped invocation on the registered agent", () => {
  const applications = applicationService();
  applications.registerApplication(REGISTRATION);
  const { service, created } = capabilityService(applications);

  const result = service.createCapabilityInvocation("app.app_gmail.list_unread", { limit: 10 }, { userId: "usr_1" });
  assert.equal(result.status, 202, JSON.stringify(result.body));
  assert.equal(result.body.agentId, "agt_mcp_mail");
  assert.equal(created.length, 1);
  const call = created[0];
  assert.equal(call.agent.id, "agt_mcp_mail");
  // The chosen MCP tool and the capability's validated inputs travel as the
  // agent invocation's tool selection; control-plane fields do not.
  assert.equal(call.options.toolName, "mail_list_unread");
  assert.deepEqual(call.options.toolArguments, { limit: 10 });
  assert.equal(call.options.metadata.providerType, "application");
  assert.equal(call.options.metadata.applicationId, "app_gmail");
  assert.equal(call.options.metadata.capability, "app.app_gmail.list_unread");
  assert.equal(call.options.metadata.applicationAction, "agent:agt_mcp_mail:mail_list_unread");
});

test("a facade that requires approval refuses without a token and passes with one", () => {
  const applications = applicationService({ applications: [] }, {
    validateApprovalToken: (token) => (token === "grant-1" ? { approved: true } : { approved: false, reason: "unknown_token" }),
  });
  applications.registerApplication(REGISTRATION);
  const { service } = capabilityService(applications);

  const refused = service.createCapabilityInvocation("app.app_gmail.fetch", {}, { userId: "usr_1" });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "approval_required");

  const approved = service.createCapabilityInvocation("app.app_gmail.fetch", { approvalToken: "grant-1" }, { userId: "usr_1" });
  assert.equal(approved.status, 202, JSON.stringify(approved.body));
});

test("the agent's own allowedTools is a second, independent gate", () => {
  const applications = applicationService();
  applications.registerApplication({
    ...REGISTRATION,
    capabilityFacades: [{ id: "send", agentId: "agt_mcp_mail", agentToolName: "mail_send", displayName: "Send" }],
  });
  const { service, created } = capabilityService(applications);

  const result = service.createCapabilityInvocation("app.app_gmail.send", {}, { userId: "usr_1" });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "agent_tool_not_allowlisted");
  assert.equal(created.length, 0, "no invocation is created for a tool outside the agent's allowlist");
});

test("a missing or disabled agent refuses precisely, not opaquely", () => {
  const applications = applicationService();
  applications.registerApplication(REGISTRATION);

  const missing = capabilityService(applications, { agent: null });
  const gone = missing.service.createCapabilityInvocation("app.app_gmail.list_unread", {}, { userId: "usr_1" });
  assert.equal(gone.status, 409);
  assert.equal(gone.body.error, "agent_not_available");
  assert.match(gone.body.message, /not registered/);

  const disabled = capabilityService(applications, { agent: { ...MAIL_AGENT, status: "disabled" } });
  const off = disabled.service.createCapabilityInvocation("app.app_gmail.list_unread", {}, { userId: "usr_1" });
  assert.equal(off.status, 409);
  assert.match(off.body.message, /disabled/);
});

test("the registration survives a restart: same state, fresh services, same contract", () => {
  const state = { applications: [] };
  applicationService(state).registerApplication(REGISTRATION);

  // Simulate restart: persisted JSON round-trip, then services rebuilt over it.
  const restored = JSON.parse(JSON.stringify(state));
  const applications = applicationService(restored);
  const { service, created } = capabilityService(applications, { state: restored });

  const capability = service.getCapability("app.app_gmail.list_unread");
  assert.equal(capability.kind, "agent_facade");
  assert.equal(capability.metadata.execution.agentId, "agt_mcp_mail");
  const result = service.createCapabilityInvocation("app.app_gmail.list_unread", { limit: 1 }, { userId: "usr_1" });
  assert.equal(result.status, 202);
  assert.equal(created[0].options.toolName, "mail_list_unread");
});

test("the invocation gateway carries options.toolName/toolArguments to the bridge payload", () => {
  let n = 0;
  const state = {
    invocations: [], worktrees: [], projects: [{ id: "prj_1", name: "P", path: "/x" }],
    traces: [], spans: [], policyDecisionRecords: [], auditSummaries: [], agentSkills: [],
    device: { id: "dev_1" },
  };
  const agent = { id: "agt_mcp_mail", name: "Mail", adapter: { type: "mcp" }, location: { type: "local_device", deviceId: "dev_1" } };
  const runtime = createInvocationCreationRuntime({
    state,
    now: () => "2026-07-14T00:00:00.000Z",
    nextId: (p) => `${p}_${++n}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    defaultAgent: () => agent,
    currentProject: () => state.projects[0],
    worktreeForProject: () => null,
    normalizeCodexApprovalMode: () => null,
    normalizeCodexSessionMode: () => null,
    normalizeCodexWorkspacePolicy: () => null,
    createManagedCodexWorkspace: () => null,
    createManagedCodexSession: () => null,
    resolveResumeCodexSessionId: () => null,
    evaluateInvocationPolicy: () => ({ decision: "allow", reason: "ok", riskLevel: "low", riskTags: [] }),
    enforcePlatformAiQuota: () => null,
    createPolicyDecisionRecord: () => ({ id: "pdr_1", decision: "allowed", reason: "ok" }),
    createApprovalRequest: () => ({ id: "apr_1" }),
    completeRootSpan: () => {},
    createAuditSummary: () => ({ id: "aud_1" }),
    recordAgentUsage: () => {},
    budgetGateForProject: () => ({ blocked: false }),
  });

  const invocation = runtime.createInvocation("list unread", agent, {
    actor: { userId: "usr_1" },
    toolName: "mail_list_unread",
    toolArguments: { limit: 5 },
  });
  assert.equal(invocation.options.toolName, "mail_list_unread");
  assert.deepEqual(invocation.options.toolArguments, { limit: 5 });

  const plain = runtime.createInvocation("plain", agent, { actor: { userId: "usr_1" } });
  assert.equal("toolName" in plain.options, false, "absent selection stays absent — no empty keys");
});
