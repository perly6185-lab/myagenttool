import assert from "node:assert/strict";
import { test } from "node:test";
import { syncBoundWorkItemsForAutoRun } from "../src/services/auto-run.mjs";

test("auto-run status transitions advance bound local work items", () => {
  let counter = 0;
  const state = {
    workItems: [{
      id: "lwi_1", ownerTeamId: "team_local", projectId: "prj_1",
      status: "ready", state: "open", revision: 1,
      executionBindings: [{ kind: "auto_run", targetId: "aur_1" }],
    }],
    workItemActivities: [],
  };
  const input = {
    state, autoRun: { id: "aur_1" },
    now: () => "2026-07-24T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++counter}`,
  };

  syncBoundWorkItemsForAutoRun({ ...input, status: "running" });
  assert.equal(state.workItems[0].status, "in_progress");
  syncBoundWorkItemsForAutoRun({ ...input, status: "pr_open" });
  assert.equal(state.workItems[0].status, "review");
  syncBoundWorkItemsForAutoRun({ ...input, status: "done" });
  assert.equal(state.workItems[0].status, "done");
  assert.equal(state.workItems[0].state, "closed");
  assert.equal(state.workItemActivities.length, 3);
});

test("failed auto-runs block bound items without touching unrelated work", () => {
  const state = {
    workItems: [
      { id: "lwi_1", status: "in_progress", state: "open", revision: 2, executionBindings: [{ kind: "auto_run", targetId: "aur_1" }] },
      { id: "lwi_2", status: "ready", state: "open", revision: 1, executionBindings: [] },
    ],
    workItemActivities: [],
  };
  syncBoundWorkItemsForAutoRun({
    state, autoRun: { id: "aur_1" }, status: "failed",
    now: () => "2026-07-24T00:00:00.000Z", nextId: () => "wia_1",
  });
  assert.equal(state.workItems[0].status, "blocked");
  assert.equal(state.workItems[1].status, "ready");
});
