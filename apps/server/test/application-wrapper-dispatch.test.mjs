/*
 * #359 Slice B: a wrapper capability invocation dispatches to the bridge as a
 * QUEUED invocation for the platform Application Wrapper Runner agent, carrying
 * the server-resolved approved command in allowlisted metadata. Approval and
 * agent-availability guards are enforced before dispatch.
 */

import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { test } from "node:test";

import { createApplicationService, createApplicationWrapperAgentRegistration, publicApplicationSnapshot } from "../src/services/applications.mjs";
import { createCapabilityService } from "../src/services/capabilities.mjs";
import { createCcusageApplicationRegistration } from "../src/services/ccusage-application.mjs";

const CAP = "app.app_ccusage.wrapper.daily";

test("application wrapper agent registration resolves the wrapper script path", () => {
  const registration = createApplicationWrapperAgentRegistration();
  assert.equal(registration.args.length, 1);
  assert.equal(isAbsolute(registration.args[0]), true);
  assert.match(registration.args[0], /tools[\\/]+agents[\\/]+application-wrapper\.mjs$/);
});

test("application registration persists a structured integration brief", () => {
  const state = { applications: [], projects: [] };
  const appSvc = createApplicationService({
    state,
    now: () => "2026-07-08T00:00:00.000Z",
    nextId: (p) => `${p}_brief`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
  });

  const app = appSvc.registerApplication({
    name: "Briefed Tool",
    source: { type: "manual", uri: "manual://briefed-tool" },
    integrationBrief: {
      intent: "Render markdown previews through a reviewed local MCP server.",
      sourceType: "mcp",
      discoverableCapabilities: ["render markdown", "list themes"],
      invokableCapabilities: ["render markdown"],
      dataBoundary: "Read markdown input and write imported preview evidence only.",
      fixedCommands: ["render_markdown", "list_themes"],
      userInputs: "markdown text and theme id",
      resultImport: "preview evidence record",
      approvalsAndRecovery: "manual confirmation before shared tool projection",
      smokeTests: ["register", "probe", "invoke", "restart"],
    },
  });

  assert.equal(app.integrationBrief.version, "application-intake.v1");
  assert.equal(app.integrationBrief.status, "draft");
  assert.equal(app.integrationBrief.sourceType, "mcp");
  assert.deepEqual(app.integrationBrief.discoverableCapabilities, ["render markdown", "list themes"]);
  assert.deepEqual(app.integrationBrief.aiAssistance.nextDrafts.slice(0, 3), ["descriptor", "wrapper_or_mcp_adapter", "safe_probe"]);

  const snapshot = publicApplicationSnapshot(app);
  assert.equal(snapshot.integrationBrief.intent, "Render markdown previews through a reviewed local MCP server.");
  assert.deepEqual(snapshot.integrationBrief.smokeTests, ["register", "probe", "invoke", "restart"]);
});

function harness({ agentAvailable = true, registration = createCcusageApplicationRegistration() } = {}) {
  const state = { applications: [], projects: [] };
  const approvals = new Map();
  const invocations = new Map();
  const appSvc = createApplicationService({
    state,
    now: () => "2026-07-03T00:00:00.000Z",
    nextId: (p) => `${p}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
  });
  appSvc.registerApplication(registration);

  const created = [];
  const capSvc = createCapabilityService({
    state,
    listTools: () => [],
    getTool: () => null,
    createToolInvocation: () => ({ status: 500 }),
    createInvocation: (task, agent, options) => {
      const invocation = {
        id: `inv_${created.length + 1}`,
        status: options.requireLocalApproval ? "waiting_for_local_approval" : "queued",
        agentId: agent.id,
        approvalRequestId: options.requireLocalApproval ? `apr_${created.length + 1}` : null,
        options,
      };
      invocations.set(invocation.id, invocation);
      if (invocation.approvalRequestId) {
        approvals.set(invocation.approvalRequestId, {
          id: invocation.approvalRequestId,
          status: "pending",
          invocationId: invocation.id,
        });
      }
      created.push({ task, agent, options });
      return invocation;
    },
    completeInvocation: () => {},
    findAgent: (id) => {
      if (id === "agt_platform_application_control") return { id, status: "available" };
      return agentAvailable && id === "agt_platform_application_wrapper" ? { id, status: "available" } : null;
    },
    listApplications: appSvc.listApplications,
    listApplicationCapabilities: appSvc.listApplicationCapabilities,
    invokeApplicationCapability: appSvc.invokeApplicationCapability,
    planApplicationWrapperInvocation: appSvc.planApplicationWrapperInvocation,
    findApprovalRequest: (id) => approvals.get(id) ?? null,
    findInvocation: (id) => invocations.get(id) ?? null,
  });
  return { approvals, appSvc, capSvc, created };
}

test("wrapper capability dispatches a queued bridge invocation with the resolved command", () => {
  const { capSvc, created } = harness();
  const res = capSvc.createCapabilityInvocation(CAP, {});
  assert.equal(res.status, 202);
  assert.equal(res.body.status, "queued");
  assert.equal(res.body.agentId, "agt_platform_application_wrapper");
  assert.equal(res.body.outputCollection, "importedUsageEstimates");
  assert.equal(created.length, 1);
  const meta = created[0].options.metadata;
  assert.equal(meta.capability, CAP);
  assert.equal(meta.applicationWrapper.execCommand, "ccusage");
  assert.deepEqual(meta.applicationWrapper.execArgs, ["daily", "--json", "--offline"]);
  assert.equal(meta.applicationWrapper.compatibilityFacade.name, "ccusage.report");
  assert.equal(meta.applicationWrapper.outputCollection, "importedUsageEstimates");
  assert.equal(meta.applicationWrapper.billing.externalBilled, true);
  assert.equal(meta.applicationWrapper.resultImport.amountSource, "imported_ccusage_report");
});

test("a read-only report command (requiresApproval:false) dispatches without approval", () => {
  // ccusage report commands are requiresApproval:false — parity with the tool's
  // offline reports, which never needed a token. (The approval_required path for
  // requiresApproval:true commands is covered by the tools-http integration test.)
  const { capSvc, created } = harness();
  const res = capSvc.createCapabilityInvocation(CAP, {});
  assert.equal(res.status, 202);
  assert.equal(res.body.status, "queued");
  assert.equal(created.length, 1);
});

test("application capability input schema rejects undeclared managed input", () => {
  const { capSvc, created } = harness();
  const res = capSvc.createCapabilityInvocation("app.app_ccusage.search", { query: "usage", extra: true });
  assert.equal(res.status, 422);
  assert.equal(res.body.error, "invalid_capability_input");
  assert.equal(res.body.validation.errors[0].path, "extra");
  assert.equal(created.length, 0);
});

test("wrapper argInputs are part of the effective invocation schema", () => {
  const { capSvc, created } = harness();
  const ok = capSvc.createCapabilityInvocation(CAP, { since: "2026-07-01", timezone: "Asia/Shanghai", projectId: "projA" });
  assert.equal(ok.status, 202);
  assert.deepEqual(
    created[0].options.metadata.applicationWrapper.execArgs,
    ["daily", "--json", "--offline", "--since", "2026-07-01", "--timezone", "Asia/Shanghai"],
  );
  assert.equal(created[0].options.metadata.projectId, "projA");

  const rejected = capSvc.createCapabilityInvocation(CAP, { since: "not-a-date" });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error, "invalid_capability_input");
  assert.equal(rejected.body.validation.errors[0].path, "since");
  assert.equal(created.length, 1);
});

test("when the wrapper agent is not registered, returns agent_not_available", () => {
  const { capSvc, created } = harness({ agentAvailable: false });
  const res = capSvc.createCapabilityInvocation(CAP, {});
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "agent_not_available");
  assert.equal(created.length, 0);
});

test("the session report requests real approval before dispatch", () => {
  const { approvals, capSvc, created } = harness();
  const approval = capSvc.createCapabilityInvocation("app.app_ccusage.wrapper.session", {});
  assert.equal(approval.status, 202);
  assert.equal(approval.body.status, "waiting_for_local_approval");
  assert.equal(approval.body.approvalRequestId, "apr_1");
  assert.equal(created.length, 1);
  assert.equal(created[0].agent.id, "agt_platform_application_control");
  approvals.get("apr_1").status = "approved";
  const ok = capSvc.createCapabilityInvocation("app.app_ccusage.wrapper.session", { approvalRequestId: "apr_1" });
  assert.equal(ok.status, 202);
});

test("an unknown wrapper command resolves no plan and is refused", () => {
  const { capSvc, created } = harness();
  const res = capSvc.createCapabilityInvocation("app.app_ccusage.wrapper.nonexistent", {});
  assert.equal(res.status, 404);
  assert.equal(created.length, 0);
});

test("write or network wrapper policies require explicit consent before approval and dispatch", () => {
  const { approvals, appSvc, capSvc, created } = harness({
    registration: {
      id: "app_policy_fixture",
      name: "Policy Fixture",
      source: {
        type: "npm",
        package: "@scope/policy-fixture",
        wrapper: {
          mode: "installed-wrapper",
          installState: "installed",
          commands: [{
            id: "write",
            displayName: "Workspace write wrapper",
            commandType: "custom",
            command: "node",
            status: "approved",
            riskLevel: "high",
            requiresApproval: true,
            filePolicy: "workspace_write",
            networkPolicy: "network",
          }],
        },
      },
    },
  });
  const capability = capSvc.getCapability("app.app_policy_fixture.wrapper.write");
  assert.equal(capability.status, "disabled");
  assert.equal(capability.metadata.readiness.state, "needs_consent");
  assert.equal(capability.metadata.readiness.reason, "wrapper_policy_requires_explicit_consent");
  assert.equal(capability.metadata.wrapper.policySupported, false);

  const res = capSvc.createCapabilityInvocation("app.app_policy_fixture.wrapper.write", {});
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "application_wrapper_policy_consent_required");
  assert.equal(res.body.filePolicy, "workspace_write");
  assert.equal(res.body.networkPolicy, "network");
  assert.equal(created.length, 0);

  const consent = appSvc.grantApplicationWrapperPolicyConsent("app_policy_fixture", "write", {
    approvalRequestId: "apr_policy_consent",
    __verifiedApplicationApproval: true,
    reason: "Allow deploy fixture network/write policy.",
  }, { userId: "usr_a", teamId: "team_local" });
  assert.equal(consent.status, 200);
  assert.equal(consent.consent.state, "granted");
  assert.equal(consent.consent.requiresPerRunApproval, true);

  const ready = capSvc.getCapability("app.app_policy_fixture.wrapper.write");
  assert.equal(ready.status, "available");
  assert.equal(ready.requiresApproval, true);
  assert.equal(ready.metadata.readiness.state, "ready");
  assert.equal(ready.metadata.readiness.reason, "wrapper_policy_consent_granted");
  assert.equal(ready.metadata.wrapper.policySupported, true);
  assert.equal(ready.metadata.wrapper.policyConsent.state, "granted");

  const approval = capSvc.createCapabilityInvocation("app.app_policy_fixture.wrapper.write", {});
  assert.equal(approval.status, 202);
  assert.equal(approval.body.status, "waiting_for_local_approval");
  assert.equal(created.length, 1);
  approvals.get(approval.body.approvalRequestId).status = "approved";

  const queued = capSvc.createCapabilityInvocation("app.app_policy_fixture.wrapper.write", {
    approvalRequestId: approval.body.approvalRequestId,
  });
  assert.equal(queued.status, 202);
  assert.equal(queued.body.agentId, "agt_platform_application_wrapper");
  assert.equal(created.length, 2);
  const wrapper = created[1].options.metadata.applicationWrapper;
  assert.equal(wrapper.filePolicy, "workspace_write");
  assert.equal(wrapper.networkPolicy, "network");
});

test("wrapper policy consent is invalidated when the approved command descriptor changes", () => {
  const { appSvc, capSvc, created } = harness({
    registration: {
      id: "app_policy_fingerprint",
      name: "Policy Fingerprint Fixture",
      source: {
        type: "npm",
        package: "@scope/policy-fingerprint",
        wrapper: {
          mode: "installed-wrapper",
          installState: "installed",
          packageManager: "npm",
          commands: [{
            id: "deploy",
            commandType: "npm_script",
            command: "deploy",
            status: "approved",
            riskLevel: "high",
            requiresApproval: false,
            filePolicy: "workspace_write",
            networkPolicy: "network",
          }],
        },
      },
    },
  });

  const consent = appSvc.grantApplicationWrapperPolicyConsent("app_policy_fingerprint", "deploy", {
    approvalRequestId: "apr_policy_fingerprint",
    __verifiedApplicationApproval: true,
    reason: "Allow the original deploy descriptor.",
  }, { userId: "usr_a", teamId: "team_local" });
  assert.equal(consent.status, 200);
  assert.equal(capSvc.getCapability("app.app_policy_fingerprint.wrapper.deploy").metadata.readiness.state, "ready");

  appSvc.updateApplicationDescriptors("app_policy_fingerprint", {
    npmWrapper: {
      mode: "installed-wrapper",
      installState: "installed",
      packageManager: "npm",
      commands: [{
        id: "deploy",
        commandType: "npm_script",
        command: "deploy:prod",
        status: "approved",
        riskLevel: "high",
        requiresApproval: false,
        filePolicy: "workspace_write",
        networkPolicy: "network",
      }],
    },
  });

  const stale = capSvc.getCapability("app.app_policy_fingerprint.wrapper.deploy");
  assert.equal(stale.status, "disabled");
  assert.equal(stale.metadata.readiness.state, "needs_consent");
  assert.equal(stale.metadata.readiness.reason, "wrapper_policy_requires_explicit_consent");
  assert.equal(stale.metadata.wrapper.policySupported, false);

  const refused = capSvc.createCapabilityInvocation("app.app_policy_fingerprint.wrapper.deploy", {});
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "application_wrapper_policy_consent_required");
  assert.equal(created.length, 0);
});

test("wrapper policy consent can expire or be revoked", () => {
  const { appSvc, capSvc } = harness({
    registration: {
      id: "app_policy_lifecycle",
      name: "Policy Lifecycle Fixture",
      source: {
        type: "npm",
        package: "@scope/policy-lifecycle",
        wrapper: {
          mode: "installed-wrapper",
          installState: "installed",
          commands: [{
            id: "deploy",
            commandType: "custom",
            command: "node",
            status: "approved",
            riskLevel: "high",
            requiresApproval: false,
            filePolicy: "workspace_write",
            networkPolicy: "network",
          }],
        },
      },
    },
  });

  const expired = appSvc.grantApplicationWrapperPolicyConsent("app_policy_lifecycle", "deploy", {
    __verifiedApplicationApproval: true,
    expiresAt: "2000-01-01T00:00:00.000Z",
  });
  assert.equal(expired.status, 200);
  assert.equal(capSvc.getCapability("app.app_policy_lifecycle.wrapper.deploy").metadata.readiness.state, "needs_consent");

  const granted = appSvc.grantApplicationWrapperPolicyConsent("app_policy_lifecycle", "deploy", {
    __verifiedApplicationApproval: true,
    expiresAt: "2999-01-01T00:00:00.000Z",
  });
  assert.equal(granted.status, 200);
  assert.equal(capSvc.getCapability("app.app_policy_lifecycle.wrapper.deploy").metadata.readiness.state, "ready");

  const revoked = appSvc.revokeApplicationWrapperPolicyConsent("app_policy_lifecycle", "deploy", {
    reason: "No longer needed.",
  });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.consent.state, "revoked");
  assert.equal(capSvc.getCapability("app.app_policy_lifecycle.wrapper.deploy").metadata.readiness.state, "needs_consent");
});
