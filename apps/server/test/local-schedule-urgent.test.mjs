import assert from "node:assert/strict";
import { test } from "node:test";

import { computeLocalScheduleUrgent } from "../src/read-models/local-schedule-urgent.mjs";

function source(id, overrides = {}) {
  return {
    workItemId: id, localRef: id.toUpperCase(), title: id,
    status: "ready", category: "executable", priority: "p2",
    dueDate: null, createdAt: "2026-07-20T00:00:00.000Z", plannedDate: null,
    revision: 1, manuallyPinned: false, schedulePlanSource: null,
    estimate: { minutes: 60, confidence: "low" },
    readiness: { state: "ready", reason: "dispatchable" },
    ...overrides,
  };
}

function row(item) {
  return {
    workItemId: item.workItemId, localRef: item.localRef, title: item.title,
    priority: item.priority, status: item.status, estimatedMinutes: item.estimate.minutes,
    estimateConfidence: item.estimate.confidence, previousPlannedDate: item.plannedDate,
    pinned: item.manuallyPinned, expectedRevision: item.revision,
  };
}

function input(items, { availableSlots = 1, todayItems = items, tomorrowItems = [], gross = 480, routine = 384 } = {}) {
  return [{
    terminal: { id: "dev_local", bridgeAvailable: true },
    capacity: { availableSlots, inFlight: availableSlots ? 0 : 1 },
    work: { items },
  }, {
    generatedAt: "2026-07-31T04:00:00.000Z",
    planRevision: "plan-revision",
    horizon: { today: "2026-07-31", tomorrow: "2026-08-01" },
    assumptions: { grossMinutes: gross, allocatableMinutes: routine },
    days: [
      { date: "2026-07-31", capacityMinutes: routine, items: todayItems.map(row) },
      { date: "2026-08-01", capacityMinutes: routine, items: tomorrowItems.map(row) },
    ],
  }];
}

test("uses an idle slot immediately and orders multiple P0 by deadline then arrival", () => {
  const later = source("later", { priority: "p0", dueDate: "2026-08-02", createdAt: "2026-07-01T00:00:00Z" });
  const soonerNew = source("sooner-new", { priority: "p0", dueDate: "2026-08-01", createdAt: "2026-07-03T00:00:00Z" });
  const soonerOld = source("sooner-old", { priority: "p0", dueDate: "2026-08-01", createdAt: "2026-07-02T00:00:00Z" });
  const urgent = computeLocalScheduleUrgent(...input([later, soonerNew, soonerOld]));
  assert.deepEqual(urgent.insertions.map((item) => item.workItemId), ["sooner-old", "sooner-new", "later"]);
  assert.ok(urgent.insertions.every((item) => item.activation === "immediate"));
});

test("at full concurrency P0 becomes next eligible without displacing running work", () => {
  const p0 = source("p0", { priority: "p0" });
  const urgent = computeLocalScheduleUrgent(...input([p0], { availableSlots: 0 }));
  assert.equal(urgent.insertions[0].activation, "next_eligible");
  assert.deepEqual(urgent.displacements, []);
});

test("same-worktree P0 moves to the local queue head after the lock releases", () => {
  const p0 = source("p0", { priority: "p0", readiness: { state: "waiting_worktree", reason: "worktree_busy" } });
  const urgent = computeLocalScheduleUrgent(...input([p0], { availableSlots: 1 }));
  assert.equal(urgent.insertions[0].activation, "head_after_worktree_unlock");
  assert.equal(urgent.insertions[0].queueOrder, 0);
});

test("displaces the lowest-priority unstarted unpinned task to tomorrow", () => {
  const p0 = source("p0", { priority: "p0", estimate: { minutes: 200, confidence: "medium" } });
  const p1 = source("p1", { priority: "p1", estimate: { minutes: 200, confidence: "medium" } });
  const p3 = source("p3", { priority: "p3", estimate: { minutes: 200, confidence: "medium" } });
  const urgent = computeLocalScheduleUrgent(...input([p0, p1, p3], {
    todayItems: [p0, p1, p3], gross: 400, routine: 400,
  }));
  assert.deepEqual(urgent.displacements.map((item) => item.workItemId), ["p3"]);
  assert.equal(urgent.displacements[0].targetDate, "2026-08-01");
});

test("requires confirmation before displacing a manually pinned task", () => {
  const p0 = source("p0", { priority: "p0", estimate: { minutes: 300, confidence: "medium" } });
  const pinned = source("pinned", {
    priority: "p3", plannedDate: "2026-07-31", manuallyPinned: true, schedulePlanSource: "manual",
    estimate: { minutes: 200, confidence: "medium" },
  });
  const urgent = computeLocalScheduleUrgent(...input([p0, pinned], {
    todayItems: [p0, pinned], gross: 300, routine: 300,
  }));
  assert.equal(urgent.insertions[0].requiresPinnedConfirmation, true);
  assert.deepEqual(urgent.confirmationRequired.map((item) => item.workItemId), ["pinned"]);
  assert.deepEqual(urgent.displacements, []);
});

test("#1614: urgentRevision ignores slot/readiness churn but tracks urgent content", () => {
  const p0 = source("p0", { priority: "p0" });
  const base = computeLocalScheduleUrgent(...input([p0], { availableSlots: 1 }));

  // Dispatch activity: a slot fills and readiness flips. Content unchanged.
  const busyP0 = source("p0", { priority: "p0", readiness: { state: "waiting_capacity", reason: "terminal_at_capacity" } });
  const busy = computeLocalScheduleUrgent(...input([busyP0], { availableSlots: 0 }));
  assert.notEqual(busy.insertions[0].activation, base.insertions[0].activation,
    "fixture sanity: the activation label really did change");
  assert.equal(busy.urgentRevision, base.urgentRevision,
    "slot/readiness churn must not invalidate a confirmed urgent plan");

  // A real content change — the item's revision moved — must invalidate.
  const edited = computeLocalScheduleUrgent(...input([source("p0", { priority: "p0", revision: 2 })], { availableSlots: 1 }));
  assert.notEqual(edited.urgentRevision, base.urgentRevision);
});

test("prefers an unpinned victim before considering a lower-priority manual pin", () => {
  const p0 = source("p0", { priority: "p0", estimate: { minutes: 200, confidence: "medium" } });
  const unpinned = source("unpinned", { priority: "p2", estimate: { minutes: 200, confidence: "medium" } });
  const pinned = source("pinned", {
    priority: "p3", plannedDate: "2026-07-31", manuallyPinned: true, schedulePlanSource: "manual",
    estimate: { minutes: 200, confidence: "medium" },
  });
  const urgent = computeLocalScheduleUrgent(...input([p0, unpinned, pinned], {
    todayItems: [p0, unpinned, pinned], gross: 400, routine: 400,
  }));
  assert.deepEqual(urgent.displacements.map((item) => item.workItemId), ["unpinned"]);
  assert.deepEqual(urgent.confirmationRequired, []);
});
