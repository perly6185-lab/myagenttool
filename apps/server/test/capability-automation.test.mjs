/*
 * #847: an Application capability can be a scheduled automation target.
 *
 * The three things worth pinning are not "it fires":
 *
 *   1. An automation with NO target keeps being the agent prompt it has always
 *      been. Every automation in every live snapshot is that shape.
 *   2. Ownership is re-checked at FIRE time. The scheduler does not pass through
 *      the HTTP layer, so `denyForeignProject` — the gate that protects the manual
 *      path — never runs for it. A schedule outlives the access that created it.
 *   3. A target that has gone away REFUSES, with a reason, and rolls the schedule
 *      forward. It does not fire something approximate, and it does not wedge the
 *      tick for every other schedule.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { runDueAutomations } from "../src/runtime/automation-scheduler.mjs";
import {
  capabilityInvocationInput,
  capabilityTargetProblem,
  isCapabilityTarget,
  normalizeAutomationTarget,
} from "../src/services/automation-target.mjs";

const now = () => "2026-07-13T12:00:00.000Z";
const past = new Date(Date.now() - 60_000).toISOString();

const gitStatus = {
  name: "app.app_git.wrapper.status",
  status: "available",
  invocationMode: "gateway",
  inputSchema: { properties: { since: { type: "date" } } },
  metadata: { wrapper: { cwdPolicy: "invocation_root" } },
};

function harness({
  automation,
  capability = gitStatus,
  projects = [{ id: "prj_1", ownerTeamId: "team_local" }],
  users = [{ id: "usr_local", teamId: "team_local", role: "owner" }],
} = {}) {
  const dispatched = [];
  const events = [];
  const state = { automations: [automation], projects, users, invocations: [] };
  const deps = {
    state,
    now,
    persistStateSoon: () => {},
    findInvocation: () => null,
    findAgent: () => ({ id: "agt_demo_cli" }),
    defaultAgent: () => ({ id: "agt_demo_cli" }),
    createInvocation: (task, agent, options) => {
      const invocation = { id: "inv_agent_1", task, agentId: agent.id, options };
      dispatched.push({ kind: "agent", task });
      return invocation;
    },
    startInvocationIfAllowed: () => {},
    getCapability: () => capability,
    createCapabilityInvocation: (name, input, actor) => {
      dispatched.push({ kind: "capability", name, input, actor });
      return { status: 202, body: { invocationId: "inv_cap_1", capability: name } };
    },
    appendEvent: (event) => events.push(event),
  };
  return { state, deps, dispatched, events, automation };
}

const capabilityAutomation = (over = {}) => ({
  id: "atm_1",
  name: "Nightly git status",
  enabled: true,
  projectId: "prj_1",
  createdBy: "usr_local",
  schedule: { kind: "interval", everyMinutes: 60 },
  nextRunAt: past,
  target: { kind: "capability", capability: "app.app_git.wrapper.status", inputs: { since: "2026-07-01" } },
  ...over,
});

// --- the migration seam -------------------------------------------------------

test("an automation with NO target is still the agent prompt it has always been", () => {
  const { deps, dispatched, automation } = harness({
    automation: {
      id: "atm_legacy",
      name: "Weekday repo audit",
      enabled: true,
      projectId: "prj_1",
      createdBy: "usr_local",
      agentId: "agt_codex_cli",
      prompt: "audit the repo",
      schedule: { kind: "interval", everyMinutes: 60 },
      nextRunAt: past,
      // no `target` — exactly what every persisted automation looks like today
    },
  });
  runDueAutomations(deps);
  assert.deepEqual(dispatched, [{ kind: "agent", task: "audit the repo" }]);
  assert.equal(automation.lastInvocationId, "inv_agent_1");
  assert.notEqual(automation.nextRunAt, past, "the schedule rolls forward");
});

test("normalizeAutomationTarget: absent, junk, and unknown kinds all mean 'agent'", () => {
  for (const raw of [undefined, null, {}, "capability", { kind: "nonsense" }, 7]) {
    assert.deepEqual(normalizeAutomationTarget(raw), { kind: "agent" });
  }
});

// --- firing -------------------------------------------------------------------

test("a capability automation dispatches through the SAME path the run panel uses", () => {
  const { deps, dispatched, automation } = harness({ automation: capabilityAutomation() });
  runDueAutomations(deps);

  assert.equal(dispatched.length, 1);
  const [call] = dispatched;
  assert.equal(call.kind, "capability");
  assert.equal(call.name, "app.app_git.wrapper.status");
  assert.equal(call.input.projectId, "prj_1", "the repository it runs in");
  assert.equal(call.input.since, "2026-07-01", "the saved input");
  assert.equal(call.actor.userId, "usr_local", "it runs as its creator, not as nobody");
  assert.equal(automation.lastInvocationId, "inv_cap_1");
  assert.equal(automation.runCount, 1);
  assert.equal(automation.lastRunError, null);
});

test("only DECLARED inputs are ever stored, so a schedule cannot persist what it cannot send", () => {
  const target = normalizeAutomationTarget({
    kind: "capability",
    capability: "app.app_git.wrapper.status",
    inputs: { since: "2026-07-01", approvalToken: "forged", nested: { a: 1 } },
  });
  // plainInputs keeps only scalar, plainly-named values …
  assert.deepEqual(Object.keys(target.inputs).sort(), ["approvalToken", "since"]);
  // … and the contract check then refuses the undeclared one outright.
  assert.match(
    capabilityTargetProblem({ target, capability: gitStatus, projectId: "prj_1" }),
    /"approvalToken" is not a declared input/,
  );
});

// --- the gate the scheduler bypasses ------------------------------------------

test("ownership is re-checked at FIRE time, not just at save time", () => {
  // The schedule was saved while its creator could see prj_1. The project has
  // since moved to another team. The scheduler never passes through
  // denyForeignProject, so nothing else would catch this.
  const { deps, dispatched, automation, events } = harness({
    automation: capabilityAutomation(),
    projects: [{ id: "prj_1", ownerTeamId: "team_someone_else" }],
  });
  runDueAutomations(deps);

  assert.deepEqual(dispatched, [], "a schedule must not outlive the access that created it");
  assert.match(automation.lastRunError, /can no longer access its project/);
  assert.equal(events[0].type, "automation_target_refused");
  assert.notEqual(automation.nextRunAt, past, "and the scheduler still rolls forward");
});

// --- a target that has gone away ----------------------------------------------

test("a disabled / offline / missing capability refuses with a reason and does not wedge the tick", () => {
  for (const [capability, expected] of [
    [null, /not available/i],
    [{ ...gitStatus, status: "disabled" }, /disabled/i],
    [{ ...gitStatus, invocationMode: "not_invokable" }, /cannot be invoked/i],
  ]) {
    const { deps, dispatched, automation } = harness({ automation: capabilityAutomation(), capability });
    runDueAutomations(deps);
    assert.deepEqual(dispatched, [], "it does not fire something approximate");
    assert.match(automation.lastRunError, expected);
    assert.notEqual(automation.nextRunAt, past, "the schedule rolls forward rather than wedging");
  }
});

test("an invocation_root capability with no project is refused when SAVED, not on the first tick", () => {
  const target = normalizeAutomationTarget({ kind: "capability", capability: "app.app_git.wrapper.status" });
  assert.match(
    capabilityTargetProblem({ target, capability: gitStatus, projectId: null }),
    /runs inside a repository, so the automation needs a project/,
  );
  // A cwd-insensitive capability needs no project.
  assert.equal(
    capabilityTargetProblem({
      target,
      capability: { ...gitStatus, metadata: { wrapper: { cwdPolicy: "fixed" } } },
      projectId: null,
    }),
    null,
  );
});

test("a dispatch refusal (approval required, offline, …) is recorded, not swallowed", () => {
  const { deps, automation } = harness({ automation: capabilityAutomation() });
  deps.createCapabilityInvocation = () => ({ status: 409, body: { error: "approval_required", message: "needs approval" } });
  runDueAutomations(deps);
  assert.match(automation.lastRunError, /needs approval/);
  assert.equal(automation.runCount, undefined, "a refused run is not counted as a run");
});

// --- the in-flight guard still holds -------------------------------------------

test("a capability schedule does not stack a second run while the previous is unresolved", () => {
  const automation = capabilityAutomation({ lastInvocationId: "inv_cap_0" });
  const { deps, dispatched } = harness({ automation });
  deps.findInvocation = () => ({ id: "inv_cap_0", status: "running" });
  runDueAutomations(deps);
  assert.deepEqual(dispatched, [], "the previous run is still in flight");
  assert.notEqual(automation.nextRunAt, past, "it rolls forward and retries next period");
});

test("isCapabilityTarget / capabilityInvocationInput", () => {
  assert.equal(isCapabilityTarget(capabilityAutomation()), true);
  assert.equal(isCapabilityTarget({ target: { kind: "agent" } }), false);
  assert.equal(isCapabilityTarget({}), false);
  assert.deepEqual(capabilityInvocationInput(capabilityAutomation()), {
    projectId: "prj_1",
    since: "2026-07-01",
  });
});

/*
 * Two wires that were composed and then never connected. Both were invisible to
 * every unit test in the suite, because the units all worked — nothing exercised
 * the seam BETWEEN them. Found only by running the real thing end to end.
 */

test("#847: a scheduled capability run is traceable back to its schedule", async () => {
  // Without automationId on the invocation, a scheduled run is an ORPHAN: nothing
  // can answer "which schedule produced this?", and a schedule cannot report its
  // own health (#848) from the runs it caused. Driven through the real composed
  // services, against a really-registered app_git — a mock here would only prove
  // the mock.
  const { createServerState } = await import("../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../src/runtime/service-composer.mjs");
  const { createGitApplicationRegistration } = await import("../src/services/git-application.mjs");
  const { createApplicationWrapperAgentRegistration } = await import("../src/services/applications.mjs");

  const created = createServerState({ defaultProjectPath: process.cwd(), now });
  const { httpDependencies: deps } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state: created.state,
    defaultProject: created.defaultProject,
    defaultProjectPath: process.cwd(),
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  deps.registerApplication(createGitApplicationRegistration());
  deps.registerAgent(createApplicationWrapperAgentRegistration({}));

  const projectId = created.state.projects[0].id;
  const result = deps.createCapabilityInvocation(
    "app.app_git.wrapper.status",
    { projectId, automationId: "atm_1", scheduled: true },
    null,
  );
  assert.ok(result.status < 400, `dispatch should succeed, got ${result.status} ${JSON.stringify(result.body)}`);

  const invocation = created.state.invocations.find((item) => item.id === result.body.invocationId);
  assert.equal(invocation.options.metadata.automationId, "atm_1", "the run names the schedule that caused it");
  assert.equal(invocation.options.metadata.scheduled, true);
  // And the control-plane keys must never become argv.
  assert.equal(
    invocation.options.metadata.applicationWrapper.execArgs.some((arg) => String(arg).includes("atm_1")),
    false,
    "an attribution key is not an application input",
  );
});

test("#804 regression: the result importer is actually WIRED to completion", async () => {
  // The importer was composed, handed to the invocation service, and never
  // forwarded to the completion runtime that calls it — so
  // `typeof recordApplicationResult === "function"` was false and the import
  // silently never ran. Every unit test passed: they exercised the importer
  // directly, never this wire. Assert the wire, not the unit.
  const { createServerState } = await import("../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../src/runtime/service-composer.mjs");
  const created = createServerState({ defaultProjectPath: process.cwd(), now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state: created.state,
    defaultProject: created.defaultProject,
    defaultProjectPath: process.cwd(),
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });

  const invocation = {
    id: "inv_wire",
    status: "running",
    projectId: "prj_1",
    requestedBy: "usr_local",
    options: {
      metadata: {
        providerType: "application",
        applicationId: "app_git",
        capability: "app.app_git.wrapper.status",
        applicationWrapper: {
          capability: "app.app_git.wrapper.status",
          resultImport: { source: "git", kind: "repo_state" },
          outputCollection: "applicationResults",
        },
      },
    },
    delivery: { state: "acknowledged" },
    cancellation: { state: "none" },
  };
  created.state.invocations.unshift(invocation);

  httpDependencies.completeInvocation(invocation, {
    status: "succeeded",
    result: {
      summary: "done",
      output: { source: "application", capability: "app.app_git.wrapper.status", report: { text: "# branch.head main" } },
    },
  });

  assert.equal(
    (created.state.applicationResults ?? []).length,
    1,
    "a completed git capability must import its result — the importer has to be REACHED, not just exist",
  );
  assert.equal(created.state.applicationResults[0].data.branch.name, "main");
});
