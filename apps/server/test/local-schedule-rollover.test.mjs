import assert from "node:assert/strict";
import { test } from "node:test";

import { computeLocalScheduleRollover } from "../src/read-models/local-schedule-rollover.mjs";

function item(id, overrides = {}) {
  return {
    workItemId: id,
    localRef: id.toUpperCase(),
    title: id,
    status: "ready",
    category: "executable",
    plannedDate: "2026-07-30",
    revision: 1,
    schedulePlanSource: "auto_plan",
    manuallyPinned: false,
    ...overrides,
  };
}

function schedulePreview(overrides = {}) {
  return {
    generatedAt: "2026-07-31T04:00:00.000Z",
    planRevision: "schedule-revision",
    horizon: { yesterday: "2026-07-30", today: "2026-07-31", tomorrow: "2026-08-01" },
    days: [
      { date: "2026-07-31", items: [{ workItemId: "ready" }, { workItemId: "running" }, { workItemId: "pinned" }] },
      { date: "2026-08-01", items: [] },
    ],
    unscheduled: [],
    ...overrides,
  };
}

test("rolls unpinned unfinished work to its earliest feasible date and preserves running context", () => {
  const capacity = {
    terminal: { id: "dev_local" },
    work: { items: [item("ready"), item("running", { status: "in_progress" })] },
  };
  const preview = computeLocalScheduleRollover(capacity, schedulePreview());

  assert.deepEqual(preview.moves.map((move) => [move.workItemId, move.targetDate]), [
    ["ready", "2026-07-31"],
    ["running", "2026-07-31"],
  ]);
  assert.equal(preview.moves.find((move) => move.workItemId === "running").runningContextPreserved, true);
});

test("requires explicit confirmation for a manual pin and does not duplicate it in automatic moves", () => {
  const pinned = item("pinned", { schedulePlanSource: "manual", manuallyPinned: true });
  const preview = computeLocalScheduleRollover(
    { terminal: { id: "dev_local" }, work: { items: [pinned] } },
    schedulePreview(),
  );

  assert.deepEqual(preview.moves, []);
  assert.deepEqual(preview.confirmationRequired.map((move) => move.workItemId), ["pinned"]);
});

test("moves non-executable planning work to today without charging schedule capacity", () => {
  const backlog = item("backlog", { status: "backlog", category: "backlog" });
  const blocked = item("blocked", { status: "blocked", category: "attention" });
  const preview = computeLocalScheduleRollover(
    { terminal: { id: "dev_local" }, work: { items: [backlog, blocked] } },
    schedulePreview({ days: [{ date: "2026-07-31", items: [] }, { date: "2026-08-01", items: [] }] }),
  );

  assert.deepEqual(preview.moves.map((move) => [move.workItemId, move.targetDate]), [
    ["backlog", "2026-07-31"],
    ["blocked", "2026-07-31"],
  ]);
});

test("returns a stable revision for the same local-day input", () => {
  const capacity = { terminal: { id: "dev_local" }, work: { items: [item("ready")] } };
  const first = computeLocalScheduleRollover(capacity, schedulePreview());
  const second = computeLocalScheduleRollover(capacity, schedulePreview());
  assert.equal(first.rolloverRevision, second.rolloverRevision);
});
