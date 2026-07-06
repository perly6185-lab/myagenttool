/*
 * #359 Slice B: a wrapper capability invocation dispatches to the bridge as a
 * QUEUED invocation for the platform Application Wrapper Runner agent, carrying
 * the server-resolved approved command in allowlisted metadata. Approval and
 * agent-availability guards are enforced before dispatch.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationService } from "../src/services/applications.mjs";
import { createCapabilityService } from "../src/services/capabilities.mjs";
import { createCcusageApplicationRegistration } from "../src/services/ccusage-application.mjs";

const CAP = "app.app_ccusage.wrapper.daily";

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
