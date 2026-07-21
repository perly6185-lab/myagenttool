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
    // Stub the grant validator: this test exercises the DISPATCH path, not grant
    // semantics, so approval is granted once a token is present. The gate still
    // enforces presence (session-with-no-token below is refused before this runs).
    validateApprovalToken: () => ({ approved: true, mode: "test" }),
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

test("a read-only report command (requiresApproval:false) dispatches without an approvalToken", () => {
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
  const res = capSvc.createCapabilityInvocation(CAP, { approvalToken: "ok" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "agent_not_available");
  assert.equal(created.length, 0);
});

test("the session report still requires an approvalToken (approval gate preserved on the capability path)", () => {
  const { capSvc, created } = harness();
  const denied = capSvc.createCapabilityInvocation("app.app_ccusage.wrapper.session", {});
  assert.equal(denied.status, 409);
  assert.equal(denied.body.error, "approval_required");
  assert.equal(created.length, 0);
  // With a token it proceeds.
  const ok = capSvc.createCapabilityInvocation("app.app_ccusage.wrapper.session", { approvalToken: "operator" });
  assert.equal(ok.status, 202);
});

test("fail-closed: with no grant validator wired, a gated command is denied even WITH a token", () => {
  // A misconfiguration that forgets to inject validateApprovalToken must NOT
  // degrade to "any non-empty string approves" — the pre-grant vulnerability the
  // whole system exists to close. Build the service exactly like the harness but
  // without the validator stub, and confirm a requiresApproval command with a
  // token is still refused.
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
    // validateApprovalToken intentionally omitted.
  });
  appSvc.registerApplication(createCcusageApplicationRegistration());
  const capSvc = createCapabilityService({
    state,
    listTools: () => [],
    getTool: () => null,
    createToolInvocation: () => ({ status: 500 }),
    createInvocation: () => ({ id: "inv_x", status: "queued", agentId: "agt_platform_application_wrapper", options: {} }),
    completeInvocation: () => {},
    findAgent: (id) => (id === "agt_platform_application_wrapper" ? { id, status: "available" } : null),
    listApplications: appSvc.listApplications,
    listApplicationCapabilities: appSvc.listApplicationCapabilities,
    invokeApplicationCapability: appSvc.invokeApplicationCapability,
    planApplicationWrapperInvocation: appSvc.planApplicationWrapperInvocation,
  });
  const res = capSvc.createCapabilityInvocation("app.app_ccusage.wrapper.session", { approvalToken: "operator" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "approval_required");
});

test("an unknown wrapper command resolves no plan and is refused", () => {
  const { capSvc, created } = harness();
  const res = capSvc.createCapabilityInvocation("app.app_ccusage.wrapper.nonexistent", { approvalToken: "ok" });
  assert.equal(res.status, 404);
  assert.equal(created.length, 0);
});

// --- worktree-scoped writes: officecli apply.* runs IN a worktree (#human-edit) ---
import { createOfficecliApplicationRegistration } from "../src/services/officecli-application.mjs";

function officecliHarness() {
  const state = {
    applications: [],
    projects: [{ id: "prj_1", path: "/tmp/repo" }],
    worktrees: [{ id: "wtr_1", projectId: "prj_1", path: "/tmp/repo-wt", branch: "edit" }],
  };
  const appSvc = createApplicationService({
    state, now: () => "t", nextId: (p) => `${p}_x`, appendEvent: () => {}, persistStateSoon: () => {},
    addProject: () => null, cloneProject: () => null, defaultProjectPath: "/tmp/repo",
    validateApprovalToken: () => ({ approved: true, mode: "test" }),
  });
  appSvc.registerApplication(createOfficecliApplicationRegistration());
  const created = [];
  const capSvc = createCapabilityService({
    state, listTools: () => [], getTool: () => null, createToolInvocation: () => ({ status: 500 }),
    createInvocation: (task, agent, options) => { created.push({ task, agent, options }); return { id: "inv_1", status: "queued", agentId: agent.id, options }; },
    completeInvocation: () => {},
    findAgent: (id) => (id === "agt_platform_application_wrapper" ? { id, status: "available" } : null),
    listApplications: appSvc.listApplications,
    listApplicationCapabilities: appSvc.listApplicationCapabilities,
    invokeApplicationCapability: appSvc.invokeApplicationCapability,
    planApplicationWrapperInvocation: appSvc.planApplicationWrapperInvocation,
  });
  return { capSvc, created };
}

test("a workspace_write capability with a valid worktreeId stamps worktreePath on the invocation", () => {
  const { capSvc, created } = officecliHarness();
  const res = capSvc.createCapabilityInvocation("app.app_officecli.apply.set", {
    projectId: "prj_1", worktreeId: "wtr_1", approvalToken: "ok",
    file: "a.xlsx", path: "/Sheet1/A1", props: { value: "x" },
  });
  assert.equal(res.status, 202);
  assert.equal(created[0].options.metadata.worktreePath, "/tmp/repo-wt", "the write runs IN the worktree");
  assert.equal(created[0].options.metadata.projectId, "prj_1");
});

test("a foreign or unknown worktreeId is refused, never downgraded to the project clone", () => {
  const { capSvc } = officecliHarness();
  for (const worktreeId of ["wtr_unknown", "wtr_other"]) {
    const res = capSvc.createCapabilityInvocation("app.app_officecli.apply.set", {
      projectId: "prj_1", worktreeId, approvalToken: "ok", file: "a.xlsx", path: "/x", props: { value: "x" },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "worktree_not_found");
  }
});
