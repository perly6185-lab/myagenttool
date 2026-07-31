import assert from "node:assert/strict";
import { test } from "node:test";

import { computeLocalSchedulePreview } from "../src/read-models/local-schedule-preview.mjs";

const NOW = "2026-07-31T04:00:00.000Z";

function item(id, overrides = {}) {
  return {
    workItemId: id,
    localRef: id.toUpperCase(),
    title: id,
    projectId: "prj_local",
    status: "ready",
    priority: "p2",
    dueDate: null,
    plannedDate: null,
    carriedFromDate: null,
    revision: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    category: "executable",
    estimate: { minutes: 60, source: "default", confidence: "low", sampleSize: 0 },
    readiness: { state: "ready", reason: "dispatchable" },
    worktreeIds: [],
    ...overrides,
  };
}

function capacity(items, maxConcurrency = 1) {
  return {
    terminal: { id: "dev_local", status: "online", bridgeAvailable: true },
    capacity: { maxConcurrency, inFlight: 0 },
    work: { items },
  };
}

test("identical inputs produce an identical non-mutating preview", () => {
  const input = capacity([item("second"), item("first", { priority: "p0" })]);
  const before = structuredClone(input);
  const one = computeLocalSchedulePreview(input, { now: () => NOW });
  const two = computeLocalSchedulePreview(input, { now: () => NOW });

  assert.deepEqual(one, two);
  assert.deepEqual(input, before, "preview must not write planned dates or reorder source items");
  assert.deepEqual(one.days[0].items.map((row) => row.workItemId), ["first", "second"]);
});

test("preserves an in-horizon pinned date and never charges attention work to capacity", () => {
  const preview = computeLocalSchedulePreview(capacity([
    item("pinned", { plannedDate: "2026-08-01", schedulePlanSource: "manual", manuallyPinned: true, estimate: { minutes: 120, confidence: "medium" } }),
    item("blocked", { status: "blocked", category: "attention", readiness: { state: "blocked", reason: "work_item_blocked" }, estimate: { minutes: 400, confidence: "low" } }),
  ]), { now: () => NOW, utilization: 1, urgentReserve: 0 });

  assert.deepEqual(preview.days[0].items, []);
  assert.deepEqual(preview.days[1].items.map((row) => row.workItemId), ["pinned"]);
  assert.equal(preview.days[1].plannedMinutes, 120);
  assert.deepEqual(preview.attention, [{ workItemId: "blocked", reason: "work_item_blocked" }]);
});

test("uses bounded reason codes when capacity is exhausted or a pin is outside the horizon", () => {
  const preview = computeLocalSchedulePreview(capacity([
    item("large", { estimate: { minutes: 500, confidence: "low" } }),
    item("future", { plannedDate: "2026-08-03", schedulePlanSource: "manual", manuallyPinned: true }),
  ]), { now: () => NOW, workdayMinutes: 60, utilization: 1, urgentReserve: 0 });

  assert.deepEqual(preview.unscheduled, [
    { workItemId: "future", reason: "pinned_outside_horizon", plannedDate: "2026-08-03" },
    { workItemId: "large", reason: "capacity_exhausted" },
  ]);
  assert.ok(preview.days.every((day) => day.plannedMinutes <= day.capacityMinutes));
});

test("defers a currently busy worktree until tomorrow instead of cross-terminal failover", () => {
  const preview = computeLocalSchedulePreview(capacity([
    item("busy", { readiness: { state: "waiting_worktree", reason: "worktree_busy" } }),
  ]), { now: () => NOW });

  assert.deepEqual(preview.days[0].items, []);
  assert.deepEqual(preview.days[1].items.map((row) => row.workItemId), ["busy"]);
  assert.equal(preview.terminalId, "dev_local");
});

test("uses the terminal timezone when UTC and the local calendar are on different days", () => {
  const input = capacity([]);
  const shanghai = computeLocalSchedulePreview(input, {
    now: () => "2026-07-30T16:30:00.000Z",
    timeZone: "Asia/Shanghai",
  });
  const losAngeles = computeLocalSchedulePreview(input, {
    now: () => "2026-07-30T16:30:00.000Z",
    timeZone: "America/Los_Angeles",
  });
  assert.deepEqual(shanghai.horizon, { yesterday: "2026-07-30", today: "2026-07-31", tomorrow: "2026-08-01" });
  assert.deepEqual(losAngeles.horizon, { yesterday: "2026-07-29", today: "2026-07-30", tomorrow: "2026-07-31" });
});
