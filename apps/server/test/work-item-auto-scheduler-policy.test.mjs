import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evaluateAutoExecutionCandidate,
  planAutoExecutionQueue,
} from "../src/services/work-item-auto-scheduler-policy.mjs";

const NOW = "2026-08-08T04:00:00.000Z";

function item(id, overrides = {}) {
  return {
    id,
    projectId: "prj_auto",
    state: "open",
    status: "ready",
    priority: "p2",
    executionPolicy: "inherit",
    waitingOn: "ai",
    dueDate: null,
    plannedDate: null,
    notBefore: null,
    dependencyIds: [],
    executionState: "unclaimed",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const projects = [{ id: "prj_auto", autoExecutionEnabled: true }];

test("future planned work remains eligible and fills otherwise idle capacity", () => {
  const future = item("future", { plannedDate: "2026-08-20" });
  const plan = planAutoExecutionQueue([future], { projects, today: "2026-08-08", now: NOW });
  assert.equal(plan.next, future);
  assert.equal(plan.decisions[0].eligible, true);
});

test("a project can disable future pull-forward without making today's work manual", () => {
  const future = item("future", { plannedDate: "2026-08-20" });
  const today = item("today", { plannedDate: "2026-08-08" });
  const plan = planAutoExecutionQueue([future, today], {
    projects: [{ id: "prj_auto", autoExecutionEnabled: true, futurePullForwardEnabled: false }],
    today: "2026-08-08",
    now: NOW,
  });
  assert.deepEqual(plan.eligible.map((row) => row.id), ["today"]);
  assert.deepEqual(plan.decisions.find((row) => row.workItemId === "future").reasons, ["future_pull_forward_disabled"]);
});

test("notBefore is a hard eligibility boundary while plannedDate is soft", () => {
  const decision = evaluateAutoExecutionCandidate(item("later", {
    plannedDate: "2026-08-20",
    notBefore: "2026-08-09T00:00:00.000Z",
  }), { project: projects[0], today: "2026-08-08", now: NOW });
  assert.equal(decision.eligible, false);
  assert.deepEqual(decision.reasons, ["not_before_reached"]);
});

test("P0 leads, then deadline risk, normal priority, plan date, and age", () => {
  const rows = [
    item("future-high", { priority: "p1", plannedDate: "2026-08-20" }),
    item("today-normal", { priority: "p2", plannedDate: "2026-08-08" }),
    item("overdue-low", { priority: "p3", dueDate: "2026-08-07" }),
    item("urgent", { priority: "p0", plannedDate: "2026-09-01" }),
  ];
  const plan = planAutoExecutionQueue(rows, { projects, today: "2026-08-08", now: NOW });
  assert.deepEqual(plan.eligible.map((row) => row.id), ["urgent", "overdue-low", "future-high", "today-normal"]);
});

test("blocked work does not prevent the next eligible item from being selected", () => {
  const dependency = item("dependency", { status: "blocked", executionPolicy: "manual" });
  const blocked = item("blocked", { priority: "p0", dependencyIds: [dependency.id] });
  const available = item("available", { priority: "p2" });
  const plan = planAutoExecutionQueue([blocked, dependency, available], { projects, today: "2026-08-08", now: NOW });
  assert.equal(plan.next.id, "available");
  assert.deepEqual(plan.decisions.find((row) => row.workItemId === "blocked").reasons, ["dependencies_unresolved"]);
});

test("project policy is inherited and explicit task pause wins", () => {
  const disabled = evaluateAutoExecutionCandidate(item("disabled"), {
    project: { id: "prj_auto", autoExecutionEnabled: false }, today: "2026-08-08", now: NOW,
  });
  const paused = evaluateAutoExecutionCandidate(item("paused", { executionPolicy: "paused" }), {
    project: projects[0], today: "2026-08-08", now: NOW,
  });
  assert.deepEqual(disabled.reasons, ["automatic_execution_disabled"]);
  assert.deepEqual(paused.reasons, ["execution_paused"]);
});
