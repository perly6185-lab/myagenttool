import assert from "node:assert/strict";
import test from "node:test";
import { runDueAutomations } from "../src/runtime/automation-scheduler.mjs";

test("due application capability automation invokes the governed capability path", () => {
  const calls = [];
  const state = {
    automations: [{
      id: "atm_app_daily",
      name: "ccusage daily",
      enabled: true,
      kind: "application_capability",
      projectId: "prj_myagenttool",
      schedule: { kind: "interval", everyMinutes: 60, label: "Every 60 minutes" },
      nextRunAt: new Date(Date.now() - 1_000).toISOString(),
      lastInvocationId: null,
      lastRunAt: null,
      runCount: 0,
      createdBy: "usr_scheduler",
      target: {
        type: "application_capability",
        applicationId: "app_ccusage",
        capabilityName: "app.app_ccusage.wrapper.daily",
        input: { since: "2026-07-01" },
      },
    }],
  };

  runDueAutomations({
    state,
    now: () => "2026-07-07T01:00:00.000Z",
    createInvocation: () => {
      throw new Error("generic invocation path should not run");
    },
    createCapabilityInvocation: (name, input, actor, context) => {
      calls.push({ name, input, actor, context });
      return { status: 202, body: { invocationId: "inv_app_auto", status: "queued" } };
    },
    startInvocationIfAllowed: () => {},
    findAgent: () => null,
    defaultAgent: () => null,
    findInvocation: () => null,
    persistStateSoon: () => calls.push({ persisted: true }),
  });

  assert.equal(calls[0].name, "app.app_ccusage.wrapper.daily");
  assert.deepEqual(calls[0].input, { since: "2026-07-01", projectId: "prj_myagenttool" });
  assert.deepEqual(calls[0].actor, { userId: "usr_scheduler" });
  assert.deepEqual(calls[0].context, {
    automation: { id: "atm_app_daily", name: "ccusage daily", scheduled: true },
  });
  assert.equal(state.automations[0].lastInvocationId, "inv_app_auto");
  assert.equal(state.automations[0].lastRunAt, "2026-07-07T01:00:00.000Z");
  assert.equal(state.automations[0].runCount, 1);
  assert.ok(Date.parse(state.automations[0].nextRunAt) > Date.now());
  assert.deepEqual(calls.at(-1), { persisted: true });
});
