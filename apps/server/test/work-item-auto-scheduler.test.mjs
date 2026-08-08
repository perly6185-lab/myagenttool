import assert from "node:assert/strict";
import { test } from "node:test";

import { createWorkItemAutoSchedulerService } from "../src/services/work-item-auto-scheduler.mjs";

function fixture(mode = "shadow") {
  const events = [];
  const state = {
    autoRunSettings: { workItemAutoSchedulerMode: mode },
    projects: [{ id: "prj_a", ownerTeamId: "team_a", autoExecutionEnabled: true }],
    workItems: [{
      id: "lwi_1", ownerTeamId: "team_a", projectId: "prj_a", state: "open", status: "ready",
      priority: "p1", executionPolicy: "inherit", waitingOn: "ai", dependencyIds: [], executionBindings: [],
      createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    }],
    autoRuns: [], invocations: [], agents: [], approvalRequests: [],
  };
  const service = createWorkItemAutoSchedulerService({
    state,
    now: () => "2026-08-08T04:00:00.000Z",
    appendEvent: (event) => events.push(event),
  });
  return { state, events, service };
}

test("shadow mode reports the next task without creating execution state", async () => {
  const { state, events, service } = fixture();
  const before = structuredClone(state.workItems);
  const result = await service.sweep();
  assert.deepEqual(result, { mode: "shadow", swept: 1, selected: 1, eligibleCount: 1 });
  assert.deepEqual(state.workItems, before);
  assert.equal(events[0].type, "work_item_auto_scheduler_decision");
  assert.equal(service.preview({ teamId: "team_a" }).nextWorkItemId, "lwi_1");
});

test("unchanged shadow decisions are logged once and off mode is inert", async () => {
  const { events, service } = fixture();
  await service.sweep();
  await service.sweep();
  assert.equal(events.length, 1);
  const disabled = fixture("off");
  assert.deepEqual(await disabled.service.sweep(), { mode: "off", swept: 0, selected: 0 });
  assert.equal(disabled.events.length, 0);
});
