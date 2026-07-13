/*
 * #848: schedule health, including the schedule that silently does nothing.
 *
 * The state that matters most is `approval_pending`, and it is the one that looks
 * like nothing at all. The scheduler's in-flight guard (correctly) refuses to
 * stack a second run while the previous is unresolved — so a schedule that fires,
 * parks at `waiting_for_local_approval`, and is never approved does NOT fail, does
 * NOT retry, and does NOT complain. It just stops. Forever. Indistinguishable, to
 * every existing surface, from a schedule with nothing to do.
 *
 * No error will ever tell you about it. That is the whole point of this read model,
 * and it is what these tests exist to keep true.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applicationIdForAutomation,
  automationHealth,
  runsForAutomation,
  scheduleHealthReadModel,
} from "../src/read-models/schedule-health.mjs";

const automation = (over = {}) => ({
  id: "atm_1",
  enabled: true,
  projectId: "prj_1",
  target: { kind: "capability", capability: "app.app_git.wrapper.status", inputs: {} },
  ...over,
});

const run = (status, over = {}) => ({
  id: `inv_${status}`,
  status,
  createdAt: "2026-07-13T00:00:00.000Z",
  options: { metadata: { automationId: "atm_1" } },
  ...over,
});

// --- the one that looks like nothing ------------------------------------------

test("a schedule parked on an approval is approval_pending — NOT healthy, NOT idle", () => {
  const health = automationHealth(automation(), [run("waiting_for_local_approval")]);
  assert.equal(health.state, "approval_pending");
  assert.equal(health.needsAttention, true, "it is waiting for a human, and nothing else will say so");
  assert.match(health.reason, /waiting for an approval/i);
  assert.match(health.reason, /will not run again/i, "the consequence has to be stated, not implied");
});

test("approval_pending is distinguishable from healthy AND from paused", () => {
  const parked = automationHealth(automation(), [run("waiting_for_local_approval")]);
  const fine = automationHealth(automation(), [run("succeeded")]);
  const off = automationHealth(automation({ enabled: false }), [run("succeeded")]);

  assert.notEqual(parked.state, fine.state);
  assert.notEqual(parked.state, off.state);
  // The distinction that actually costs people days: parked demands attention,
  // off does not. A surface that lumps them together has missed the point.
  assert.equal(parked.needsAttention, true);
  assert.equal(off.needsAttention, false);
  assert.equal(fine.needsAttention, false);
});

// --- the rest of the states ---------------------------------------------------

test("a failing run is failing; a never-run schedule is unknown, not healthy", () => {
  for (const status of ["failed", "timed_out", "rejected", "refused"]) {
    const health = automationHealth(automation(), [run(status)]);
    assert.equal(health.state, "failing", `${status} → failing`);
    assert.equal(health.needsAttention, true);
  }
  const never = automationHealth(automation(), []);
  assert.equal(never.state, "unknown");
  assert.equal(never.needsAttention, false, "never-run is not an alarm");
});

test("a disabled schedule is paused, whatever its last run did", () => {
  assert.equal(automationHealth(automation({ enabled: false }), [run("failed")]).state, "paused");
  assert.equal(automationHealth(automation({ enabled: false }), []).state, "paused");
});

test("a run in flight reports nothing yet rather than guessing", () => {
  for (const status of ["queued", "dispatching", "running"]) {
    assert.equal(automationHealth(automation(), [run(status)]).state, "unknown");
  }
});

// --- the refusal that leaves no invocation ------------------------------------

test("a target that went away is paused; a lost-access refusal is failing", () => {
  // The scheduler could not fire at all (#847), so there is NO invocation to read.
  // `lastRunError` is the only record that the tick happened and refused.
  const gone = automationHealth(
    automation({ lastRunError: "The capability app.app_git.wrapper.status is disabled — its application is offline or archived." }),
    [],
  );
  assert.equal(gone.state, "paused", "nothing is wrong with the schedule itself");

  const lostAccess = automationHealth(
    automation({ lastRunError: "The automation's creator can no longer access its project." }),
    [],
  );
  assert.equal(lostAccess.state, "failing", "this one is a real problem, and someone must be told");
  assert.equal(lostAccess.needsAttention, true);
});

// --- attribution ---------------------------------------------------------------

test("runs are attributed by the automationId the scheduler stamps (#847)", () => {
  const mine = run("succeeded");
  const someoneElses = { ...run("failed"), options: { metadata: { automationId: "atm_other" } } };
  const unattributed = { ...run("failed"), options: { metadata: {} } };
  const runs = runsForAutomation(automation(), [mine, someoneElses, unattributed]);
  assert.deepEqual(runs.map((r) => r.id), [mine.id]);
});

test("a schedule is attributed to its application by the SAME slug the projection mints", () => {
  const applications = [{ id: "app_git", name: "git" }, { id: "app_ccusage", name: "ccusage" }];
  assert.equal(applicationIdForAutomation(automation(), applications), "app_git");
  // An agent-target automation belongs to no application …
  assert.equal(applicationIdForAutomation(automation({ target: { kind: "agent" } }), applications), null);
  // … and a capability whose application is gone belongs to none, rather than to a guess.
  assert.equal(
    applicationIdForAutomation(
      automation({ target: { kind: "capability", capability: "app.app_vanished.wrapper.x" } }),
      applications,
    ),
    null,
  );
});

// --- the application rollup ----------------------------------------------------

test("an application with a failing or parked schedule is NOT reported healthy", () => {
  const applications = [{ id: "app_git", name: "git" }];
  const automations = [
    automation({ id: "atm_ok" }),
    automation({ id: "atm_parked" }),
    automation({ id: "atm_broken" }),
    automation({ id: "atm_off", enabled: false }),
  ];
  const invocations = [
    { id: "i1", status: "succeeded", options: { metadata: { automationId: "atm_ok" } } },
    { id: "i2", status: "waiting_for_local_approval", options: { metadata: { automationId: "atm_parked" } } },
    { id: "i3", status: "failed", options: { metadata: { automationId: "atm_broken" } } },
    { id: "i4", status: "succeeded", options: { metadata: { automationId: "atm_off" } } },
  ];

  const { scheduleHealth, applicationScheduleHealth } = scheduleHealthReadModel({
    automations,
    invocations,
    applications,
  });

  assert.equal(scheduleHealth.length, 4);
  const [rollup] = applicationScheduleHealth;
  assert.equal(rollup.applicationId, "app_git");
  assert.equal(rollup.total, 4);
  assert.equal(rollup.healthy, 1);
  assert.equal(rollup.approvalPending, 1);
  assert.equal(rollup.failing, 1);
  assert.equal(rollup.paused, 1);
  assert.equal(rollup.needsAttention, true);
  // The rollup must point AT the schedules, or an operator is told "something is
  // wrong here" and then made to go find it.
  assert.deepEqual(rollup.attentionAutomationIds.sort(), ["atm_broken", "atm_parked"]);
});

test("an application whose schedules are all fine, or has none, raises no attention", () => {
  const applications = [{ id: "app_git", name: "git" }];
  const fine = scheduleHealthReadModel({
    applications,
    automations: [automation()],
    invocations: [{ id: "i1", status: "succeeded", options: { metadata: { automationId: "atm_1" } } }],
  });
  assert.equal(fine.applicationScheduleHealth[0].needsAttention, false);

  const none = scheduleHealthReadModel({ applications, automations: [], invocations: [] });
  assert.deepEqual(none.applicationScheduleHealth, [], "no schedules is not a rollup row");
});

test("an agent-target schedule is still given health — it just belongs to no application", () => {
  const { scheduleHealth, applicationScheduleHealth } = scheduleHealthReadModel({
    applications: [{ id: "app_git", name: "git" }],
    automations: [automation({ id: "atm_agent", target: { kind: "agent" } })],
    invocations: [{ id: "i1", status: "failed", options: { metadata: { automationId: "atm_agent" } } }],
  });
  assert.equal(scheduleHealth[0].state, "failing");
  assert.equal(scheduleHealth[0].applicationId, null);
  assert.deepEqual(applicationScheduleHealth, [], "and it does not fabricate an owner");
});

/*
 * The wire, not the unit. #804 shipped an importer that was composed, handed
 * onward, and never actually reached — every unit test passed while the feature
 * did nothing. Assert that the health rows reach /api/state, and that they are
 * scoped like everything else there.
 */
test("schedule health reaches the public state, and is scoped to what the viewer can see", async () => {
  const { buildPublicState } = await import("../src/read-models/state.mjs");

  const state = {
    projects: [
      { id: "prj_mine", ownerTeamId: "team_a" },
      { id: "prj_theirs", ownerTeamId: "team_b" },
    ],
    applications: [{ id: "app_git", name: "git", ownerTeamId: "team_a" }],
    automations: [
      automation({ id: "atm_mine", projectId: "prj_mine" }),
      automation({ id: "atm_theirs", projectId: "prj_theirs" }),
    ],
    invocations: [
      { id: "i_mine", projectId: "prj_mine", status: "waiting_for_local_approval", options: { metadata: { automationId: "atm_mine" } } },
      { id: "i_theirs", projectId: "prj_theirs", status: "failed", options: { metadata: { automationId: "atm_theirs" } } },
    ],
    users: [], teams: [], agents: [], events: [], traces: [], spans: [], worktrees: [],
    device: { id: "dev_local_001" },
  };

  const published = buildPublicState({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProjectPath: process.cwd(),
    currentProject: () => state.projects[0],
    defaultAgent: () => null,
    loopRoutineReadModel: () => ({}),
    codexApprovalQueue: () => [],
    evidenceCenterRecords: () => [],
    ledgerSummary: () => ({}),
    budgetStatuses: () => [],
    teamBudgetStatuses: () => [],
    actor: { userId: "usr_a", teamId: "team_a" },
  });

  assert.ok(Array.isArray(published.scheduleHealth), "the read model is actually published");
  assert.deepEqual(
    published.scheduleHealth.map((row) => row.automationId),
    ["atm_mine"],
    "another team's schedule must not leak through its health row",
  );
  assert.equal(published.scheduleHealth[0].state, "approval_pending");

  // And the application carries the rollup, so the Applications view can stop
  // calling it healthy while what it schedules is parked.
  const app = published.applications.find((item) => item.id === "app_git");
  assert.equal(app.scheduleHealth.needsAttention, true);
  assert.deepEqual(app.scheduleHealth.attentionAutomationIds, ["atm_mine"]);
});

test("a dispatch refused for want of an approval is WAITING, not broken", () => {
  // A schedule pointed at an approval-required capability can never run
  // unattended. Calling that "failing" sends someone to fix a thing that is not
  // wrong — what it needs is a person. It belongs with the parked run, not with
  // the broken one.
  const health = automationHealth(
    automation({ lastRunError: "This wrapper command requires an explicit approvalToken." }),
    [],
  );
  assert.equal(health.state, "approval_pending");
  assert.equal(health.needsAttention, true);
  assert.match(health.reason, /needs an approval/i);
});
