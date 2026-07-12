/*
 * #773: cwdPolicy on wrapper commands. "fixed" (default) keeps ccusage's
 * cwd-insensitive behavior; "invocation_root" plans cwd:null so the bridge
 * resolves it to the invocation's repository. An invocation_root command with no
 * project must REFUSE, not silently fall back to the bridge's own directory.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationService, applicationWrapperExecutionPlan } from "../src/services/applications.mjs";
import { createCcusageApplicationRegistration } from "../src/services/ccusage-application.mjs";
import { createCapabilityService } from "../src/services/capabilities.mjs";

function appService() {
  const state = { applications: [] };
  return createApplicationService({
    state,
    now: () => "2026-07-12T00:00:00.000Z",
    nextId: (p) => `${p}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
  });
}

function registerCwdDemo(svc) {
  return svc.registerApplication({
    id: "app_cwd",
    name: "cwd-demo",
    autoOnline: false,
    source: {
      type: "npm",
      package: "demo",
      version: "1.0.0",
      wrapper: {
        mode: "installed-wrapper",
        packageManager: "npm",
        commands: [
          { id: "fixed_cmd", command: "demo", args: ["run"], status: "approved", riskLevel: "low", requiresApproval: false, filePolicy: "read_only", networkPolicy: "forbidden" },
          { id: "root_cmd", command: "demo", args: ["run"], cwdPolicy: "invocation_root", status: "approved", riskLevel: "low", requiresApproval: false, filePolicy: "read_only", networkPolicy: "forbidden" },
          { id: "weird_cmd", command: "demo", args: ["run"], cwdPolicy: "bogus", status: "approved", riskLevel: "low", requiresApproval: false, filePolicy: "read_only", networkPolicy: "forbidden" },
        ],
      },
    },
  });
}

test("fixed cwdPolicy (default) plans a concrete cwd; unknown value degrades to fixed", () => {
  const app = registerCwdDemo(appService());
  const fixed = applicationWrapperExecutionPlan(app, "fixed_cmd");
  assert.equal(fixed.cwd, ".");
  assert.equal(fixed.cwdPolicy, "fixed");
  const weird = applicationWrapperExecutionPlan(app, "weird_cmd");
  assert.equal(weird.cwd, ".", "unknown cwdPolicy is treated as fixed");
  assert.equal(weird.cwdPolicy, "fixed");
});

test("invocation_root plans cwd:null so the bridge resolves the repo root", () => {
  const app = registerCwdDemo(appService());
  const plan = applicationWrapperExecutionPlan(app, "root_cmd");
  assert.equal(plan.cwd, null);
  assert.equal(plan.cwdPolicy, "invocation_root");
  assert.deepEqual(plan.args, ["run"], "argv is unaffected by cwdPolicy");
});

test("ccusage's planned cwd and argv are unchanged (default fixed)", () => {
  const svc = appService();
  const app = svc.registerApplication(createCcusageApplicationRegistration());
  const plan = applicationWrapperExecutionPlan(app, "daily");
  assert.equal(plan.cwd, ".");
  assert.equal(plan.cwdPolicy, "fixed");
  assert.deepEqual(plan.args, ["daily", "--json", "--offline"]);
});

// --- the no-project refuse guard, at the dispatch chokepoint ---

function capabilityService({ projectId, cwdPolicy, inputProjectId }) {
  let created = null;
  const app = { id: "app_x", name: "x", status: "online", projectId };
  const capability = {
    name: "app.app_x.wrapper.status",
    provider: { type: "application", id: "app_x" },
    invokable: true,
  };
  const svc = createCapabilityService({
    state: { applications: [app] },
    listTools: () => [],
    getTool: () => null,
    createToolInvocation: () => ({ status: 500, body: {} }),
    createInvocation: (task, agent, options) => {
      created = { task, agent, options };
      return { id: "inv_1", status: "queued" };
    },
    completeInvocation: () => {},
    findAgent: () => ({ id: "agt_platform_application_wrapper", status: "enabled" }),
    listApplications: () => [app],
    listApplicationCapabilities: () => [capability],
    invokeApplicationCapability: () => ({ status: 500, body: {} }),
    planApplicationWrapperInvocation: () => ({
      ok: true,
      wrapper: { cwdPolicy, capability: capability.name, execCommand: "demo", execArgs: ["status"] },
      timeoutSeconds: 120,
    }),
  });
  const input = inputProjectId ? { projectId: inputProjectId } : {};
  const result = svc.createCapabilityInvocation("app.app_x.wrapper.status", input, { userId: "usr_local" });
  return { result, created };
}

test("invocation_root with NO project is refused, not dispatched to the bridge's own cwd", () => {
  const { result, created } = capabilityService({ projectId: null, cwdPolicy: "invocation_root" });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "invocation_root_requires_project");
  assert.deepEqual(result.body.evidence, { cwdPolicy: "invocation_root", applicationId: "app_x" });
  assert.equal(created, null, "no invocation was created");
});

test("invocation_root WITH a project dispatches normally", () => {
  const { result, created } = capabilityService({ projectId: "prj_1", cwdPolicy: "invocation_root" });
  assert.equal(result.status, 202);
  assert.ok(created, "an invocation was created");
  assert.equal(created.options.metadata.projectId, "prj_1");
});

test("a project supplied on the input (not the application) also satisfies invocation_root", () => {
  const { result } = capabilityService({ projectId: null, cwdPolicy: "invocation_root", inputProjectId: "prj_2" });
  assert.equal(result.status, 202);
});

test("a fixed command with no project still dispatches (cwd-insensitive, ccusage parity)", () => {
  const { result } = capabilityService({ projectId: null, cwdPolicy: "fixed" });
  assert.equal(result.status, 202);
});
