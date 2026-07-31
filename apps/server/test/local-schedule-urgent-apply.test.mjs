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

function workItem(id, overrides = {}) {
  return {
    id, localRef: id.toUpperCase(), ownerTeamId: "team_local", terminalId: "dev_local",
    projectId: "prj_local", title: id, body: "", status: "ready", state: "open",
    priority: "p2", plannedDate: "2026-07-31", schedulePlanSource: "auto_plan",
    assigneeIds: ["usr_local"], labels: [], acceptanceCriteria: [], dependencyIds: [],
    executionBindings: [], externalBindings: [], revision: 1, archivedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-30T00:00:00.000Z",
    ...overrides,
  };
}

function baseState() {
  return {
    devices: [{ id: "dev_local" }],
    workItems: [
      workItem("lwi_p0", { priority: "p0", plannedDate: null, schedulePlanSource: null }),
      workItem("lwi_p3", { priority: "p3" }),
    ],
    workItemActivities: [],
    localScheduleUrgentInsertions: [],
  };
}

function input() {
  return {
    urgentRevision: "0123456789abcdef01234567",
    currentUrgentRevision: "0123456789abcdef01234567",
    date: "2026-07-31",
    insertions: [{
      workItemId: "lwi_p0", expectedRevision: 1, targetDate: "2026-07-31",
      queueOrder: 0, activation: "next_eligible", reason: "p0_next_after_active_work",
      requiresPinnedConfirmation: false,
    }],
    displacements: [{
      workItemId: "lwi_p3", expectedRevision: 1, sourceDate: "2026-07-31", targetDate: "2026-08-01",
      forWorkItemId: "lwi_p0", manuallyPinned: false,
    }],
    confirmationRequired: [],
    confirmPinned: false,
  };
}

test("urgent insertion and displacement commit atomically with bounded evidence", () => {
  const state = baseState();
  const result = serviceFor(state).applyLocalScheduleUrgent(input(), actor);
  assert.equal(result.status, 200);
  assert.equal(result.body.inserted, 1);
  assert.equal(result.body.displaced, 1);
  const urgent = state.workItems.find((item) => item.id === "lwi_p0");
  const displaced = state.workItems.find((item) => item.id === "lwi_p3");
  assert.equal(urgent.schedulePlanSource, "urgent_insert");
  assert.equal(urgent.scheduleOrder, -1_000);
  assert.equal(displaced.plannedDate, "2026-08-01");
  assert.equal(displaced.scheduleReason, "displaced_by_p0:lwi_p0");
  assert.equal(state.localScheduleUrgentInsertions.length, 1);
  assert.equal(state.workItemActivities.length, 2);
});

test("urgent insertion replay survives service reconstruction", () => {
  const state = baseState();
  serviceFor(state).applyLocalScheduleUrgent(input(), actor);
  const replay = serviceFor(state).applyLocalScheduleUrgent({
    ...input(),
    currentUrgentRevision: "fedcba9876543210fedcba98",
  }, actor);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(state.workItems.find((item) => item.id === "lwi_p0").revision, 2);
  assert.equal(state.localScheduleUrgentInsertions.length, 1);
});

test("a stale displacement prevents every urgent-plan mutation", () => {
  const state = baseState();
  state.workItems.find((item) => item.id === "lwi_p3").revision = 2;
  const result = serviceFor(state).applyLocalScheduleUrgent(input(), actor);
  assert.equal(result.status, 409);
  assert.equal(state.workItems.find((item) => item.id === "lwi_p0").schedulePlanSource, null);
  assert.equal(state.workItems.find((item) => item.id === "lwi_p0").revision, 1);
  assert.equal(state.localScheduleUrgentInsertions.length, 0);
});

test("manual pinned displacement is a separate confirmed operation", () => {
  const state = baseState();
  const pinned = state.workItems.find((item) => item.id === "lwi_p3");
  pinned.schedulePlanSource = "manual";
  const confirmedInput = {
    ...input(),
    insertions: [{ ...input().insertions[0], requiresPinnedConfirmation: true }],
    displacements: [],
    confirmationRequired: [{ ...input().displacements[0], manuallyPinned: true }],
  };

  const withoutConfirmation = serviceFor(state).applyLocalScheduleUrgent(confirmedInput, actor);
  assert.equal(withoutConfirmation.status, 200);
  assert.equal(withoutConfirmation.body.inserted, 0);
  assert.equal(state.workItems.find((item) => item.id === "lwi_p0").revision, 1);
  assert.equal(pinned.plannedDate, "2026-07-31");

  const confirmed = serviceFor(state).applyLocalScheduleUrgent({
    ...confirmedInput,
    confirmPinned: true,
  }, actor);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.inserted, 1);
  assert.equal(confirmed.body.confirmedPinned, 1);
  assert.equal(pinned.plannedDate, "2026-08-01");
});
