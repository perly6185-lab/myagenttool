import assert from "node:assert/strict";
import { test } from "node:test";

import { computeLocalScheduleCapacity } from "../src/read-models/local-schedule-capacity.mjs";

const NOW = "2026-07-31T04:00:00.000Z";
const agent = {
  id: "agt_local",
  name: "Local",
  location: { type: "local_device", deviceId: "dev_local" },
  adapter: { type: "cli" },
  health: { status: "healthy" },
};
const findAgent = (id) => id === agent.id ? agent : null;

function workItem(id, overrides = {}) {
  return {
    id,
    localRef: id.toUpperCase(),
    ownerTeamId: "team_a",
    terminalId: "dev_local",
    projectId: "prj_a",
    title: id,
    state: "open",
    status: "ready",
    priority: "p2",
    estimatePoints: 0,
    executionBindings: [],
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    device: { id: "dev_local", name: "This terminal", status: "online", unlinkState: "linked", maxConcurrency: 2 },
    invocations: [],
    autoRuns: [],
    workItems: [],
    ...overrides,
  };
}

test("reports only this terminal's visible unfinished work and classifies planning lanes", () => {
  const model = computeLocalScheduleCapacity(state({
    workItems: [
      workItem("ready"),
      workItem("blocked", { status: "blocked" }),
      workItem("backlog", { status: "backlog" }),
      workItem("done", { status: "done", state: "closed" }),
      workItem("other-terminal", { terminalId: "dev_other" }),
      workItem("foreign-team"),
    ],
  }), {
    findAgent,
    now: () => NOW,
    visibleWorkItem: (item) => item.id !== "foreign-team",
  });

  assert.equal(model.terminal.id, "dev_local");
  assert.equal(model.terminal.bridgeAvailable, true);
  assert.deepEqual(
    { total: model.work.total, executable: model.work.executable, attention: model.work.attention, backlog: model.work.backlog },
    { total: 3, executable: 1, attention: 1, backlog: 1 },
  );
  assert.deepEqual(model.work.items.map((item) => item.workItemId), ["ready", "blocked", "backlog"]);
});

test("uses local bridge concurrency and worktree locks from the real dispatch predicates", () => {
  const model = computeLocalScheduleCapacity(state({
    invocations: [{
      id: "inv_running",
      agentId: agent.id,
      terminalId: "dev_local",
      worktreeId: "wtr_busy",
      status: "running",
      delivery: { state: "acknowledged" },
      options: { metadata: { worktreePath: "/work/busy" } },
    }],
    workItems: [
      workItem("same-tree", { executionBindings: [{ kind: "worktree", targetId: "wtr_busy" }] }),
      workItem("free-tree", { executionBindings: [{ kind: "worktree", targetId: "wtr_free" }] }),
    ],
  }), { findAgent, now: () => NOW });

  assert.deepEqual(model.capacity, {
    maxConcurrency: 2,
    inFlight: 1,
    utilization: 0.5,
    atCapacity: false,
    availableSlots: 1,
    queueDepth: 0,
    worktreeLocks: 1,
  });
  assert.equal(model.work.items.find((item) => item.workItemId === "same-tree").readiness.state, "waiting_worktree");
  assert.equal(model.work.items.find((item) => item.workItemId === "free-tree").readiness.state, "ready");
});

test("estimates duration from history, then points, then a low-confidence default", () => {
  const model = computeLocalScheduleCapacity(state({
    autoRuns: [{ id: "run_history", invocationId: "inv_history" }],
    invocations: [{
      id: "inv_history",
      agentId: agent.id,
      status: "succeeded",
      startedAt: "2026-07-31T01:00:00.000Z",
      completedAt: "2026-07-31T02:30:00.000Z",
    }],
    workItems: [
      workItem("history", { executionBindings: [{ kind: "auto_run", targetId: "run_history" }] }),
      workItem("points", { estimatePoints: 3 }),
      workItem("default"),
    ],
  }), { findAgent, now: () => NOW });

  const estimates = Object.fromEntries(model.work.items.map((item) => [item.workItemId, item.estimate]));
  assert.deepEqual(estimates.history, { minutes: 90, source: "history", confidence: "medium", sampleSize: 1 });
  assert.deepEqual(estimates.points, { minutes: 180, source: "estimate_points", confidence: "medium", sampleSize: 0 });
  assert.deepEqual(estimates.default, { minutes: 60, source: "default", confidence: "low", sampleSize: 0 });
});

test("marks otherwise runnable work unavailable when the current terminal bridge is offline", () => {
  const model = computeLocalScheduleCapacity(state({
    device: { id: "dev_local", status: "offline", unlinkState: "linked", maxConcurrency: 2 },
    workItems: [workItem("ready")],
  }), { findAgent, now: () => NOW });

  assert.equal(model.terminal.bridgeAvailable, false);
  assert.deepEqual(model.work.items[0].readiness, { state: "waiting_terminal", reason: "terminal_unavailable" });
});

test("adds unbound unfinished Auto-runs without duplicating locally bound runs", () => {
  const model = computeLocalScheduleCapacity(state({
    autoRuns: [
      { id: "runtime_ready", projectId: "prj_a", terminalId: "dev_local", status: "waiting_capacity", link: { number: 41, title: "Ready issue" } },
      { id: "runtime_failed", projectId: "prj_a", terminalId: "dev_local", status: "failed", link: { number: 42, title: "Failed issue" } },
      { id: "bound", projectId: "prj_a", terminalId: "dev_local", status: "waiting_capacity", link: { number: 43, title: "Bound issue" } },
    ],
    workItems: [workItem("local-bound", { executionBindings: [{ kind: "auto_run", targetId: "bound" }] })],
    runtimeWorkSchedules: [{
      kind: "auto_run", targetId: "runtime_ready", ownerTeamId: "team_a", userId: "usr_a", terminalId: "dev_local",
      plannedDate: "2026-08-01", schedulePlanSource: "auto_plan", scheduleReason: "current_terminal_capacity_plan", scheduleOrder: 3, revision: 2,
    }],
  }), {
    findAgent,
    now: () => NOW,
    visibleAutoRun: () => true,
    visibleRuntimeSchedule: (schedule) => schedule.userId === "usr_a",
  });

  assert.deepEqual(model.work.items.map((row) => row.workItemId), [
    "local-bound", "autorun:runtime_ready", "autorun:runtime_failed",
  ]);
  const ready = model.work.items.find((row) => row.workItemId === "autorun:runtime_ready");
  assert.equal(ready.sourceKind, "auto_run");
  assert.equal(ready.plannedDate, "2026-08-01");
  assert.equal(ready.revision, 2);
  const failed = model.work.items.find((row) => row.workItemId === "autorun:runtime_failed");
  assert.equal(failed.category, "attention");
  assert.deepEqual(failed.readiness, { state: "attention", reason: "auto_run_failed" });
});
