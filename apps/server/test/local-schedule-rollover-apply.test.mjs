import assert from "node:assert/strict";
import { test } from "node:test";

import { createWorkItemService } from "../src/services/work-items.mjs";

const actor = { teamId: "team_local", userId: "usr_local" };

function serviceFor(state) {
  let sequence = 0;
  return createWorkItemService({
    state,
    now: () => "2026-07-31T04:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++sequence}`,
  });
}

function stateWithItem() {
  return {
    devices: [{ id: "dev_local" }],
    workItems: [{
      id: "lwi_restart",
      localRef: "LOCAL-RESTART",
      ownerTeamId: "team_local",
      terminalId: "dev_local",
      projectId: "prj_local",
      title: "Survive a restart",
      body: "",
      status: "ready",
      state: "open",
      priority: "p1",
      plannedDate: "2026-07-30",
      schedulePlanSource: "auto_plan",
      assigneeIds: ["usr_local"],
      labels: [],
      acceptanceCriteria: [],
      dependencyIds: [],
      executionBindings: [],
      externalBindings: [],
      revision: 1,
      archivedAt: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z",
    }],
    workItemActivities: [],
    localScheduleRollovers: [],
  };
}

test("a rollover replay remains idempotent after reconstructing the service", () => {
  const state = stateWithItem();
  const input = {
    rolloverRevision: "0123456789abcdef01234567",
    currentRolloverRevision: "0123456789abcdef01234567",
    sourceDate: "2026-07-30",
    moves: [{ workItemId: "lwi_restart", expectedRevision: 1, targetDate: "2026-07-31" }],
    confirmationMoves: [],
    confirmPinned: false,
  };

  const first = serviceFor(state).applyLocalScheduleRollover(input, actor);
  assert.equal(first.status, 200);
  assert.equal(first.body.applied, 1);
  assert.equal(state.workItems[0].revision, 2);
  assert.equal(state.localScheduleRollovers.length, 1);

  const afterRestart = serviceFor(state).applyLocalScheduleRollover({
    ...input,
    currentRolloverRevision: "fedcba9876543210fedcba98",
  }, actor);
  assert.equal(afterRestart.status, 200);
  assert.equal(afterRestart.body.replayed, true);
  assert.equal(state.workItems[0].revision, 2);
  assert.equal(state.localScheduleRollovers.length, 1);
});

test("rollover validates every revision before mutating any item", () => {
  const state = stateWithItem();
  state.workItems.push({
    ...structuredClone(state.workItems[0]),
    id: "lwi_stale",
    localRef: "LOCAL-STALE",
    revision: 2,
  });
  const result = serviceFor(state).applyLocalScheduleRollover({
    rolloverRevision: "0123456789abcdef01234567",
    currentRolloverRevision: "0123456789abcdef01234567",
    sourceDate: "2026-07-30",
    moves: [
      { workItemId: "lwi_restart", expectedRevision: 1, targetDate: "2026-07-31" },
      { workItemId: "lwi_stale", expectedRevision: 1, targetDate: "2026-07-31" },
    ],
  }, actor);

  assert.equal(result.status, 409);
  assert.equal(state.workItems[0].plannedDate, "2026-07-30");
  assert.equal(state.workItems[0].revision, 1);
  assert.equal(state.localScheduleRollovers.length, 0);
});
