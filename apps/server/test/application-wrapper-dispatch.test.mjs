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

function harness({ agentAvailable = true } = {}) {
  const state = { applications: [], projects: [] };
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
  appSvc.registerApplication(createCcusageApplicationRegistration());

  const created = [];
  const capSvc = createCapabilityService({
    state,
    listTools: () => [],
    getTool: () => null,
    createToolInvocation: () => ({ status: 500 }),
    createInvocation: (task, agent, options) => {
      const invocation = { id: "inv_1", status: "queued", agentId: agent.id, options };
      created.push({ task, agent, options });
      return invocation;
    },
    completeInvocation: () => {},
    findAgent: (id) => (agentAvailable && id === "agt_platform_application_wrapper" ? { id, status: "available" } : null),
    listApplications: appSvc.listApplications,
    listApplicationCapabilities: appSvc.listApplicationCapabilities,
    invokeApplicationCapability: appSvc.invokeApplicationCapability,
    planApplicationWrapperInvocation: appSvc.planApplicationWrapperInvocation,
  });
  return { capSvc, created };
}

test("wrapper capability dispatches a queued bridge invocation with the resolved command", () => {
  const { capSvc, created } = harness();
  const res = capSvc.createCapabilityInvocation(CAP, { approvalToken: "ok" });
  assert.equal(res.status, 202);
  assert.equal(res.body.status, "queued");
  assert.equal(res.body.agentId, "agt_platform_application_wrapper");
  assert.equal(created.length, 1);
  const meta = created[0].options.metadata;
  assert.equal(meta.capability, CAP);
  assert.equal(meta.applicationWrapper.execCommand, "ccusage");
  assert.deepEqual(meta.applicationWrapper.execArgs, ["daily", "--json", "--offline"]);
});

test("without an approvalToken the invocation is refused before dispatch", () => {
  const { capSvc, created } = harness();
  const res = capSvc.createCapabilityInvocation(CAP, {});
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "approval_required");
  assert.equal(created.length, 0);
});

test("when the wrapper agent is not registered, returns agent_not_available", () => {
  const { capSvc, created } = harness({ agentAvailable: false });
  const res = capSvc.createCapabilityInvocation(CAP, { approvalToken: "ok" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "agent_not_available");
  assert.equal(created.length, 0);
});

test("an unknown wrapper command resolves no plan and is refused", () => {
  const { capSvc, created } = harness();
  const res = capSvc.createCapabilityInvocation("app.app_ccusage.wrapper.nonexistent", { approvalToken: "ok" });
  assert.equal(res.status, 404);
  assert.equal(created.length, 0);
});
