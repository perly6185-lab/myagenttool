import assert from "node:assert/strict";
import { test } from "node:test";
import { convergeAutoRunTerminalState, syncBoundWorkItemsForAutoRun } from "../src/services/auto-run.mjs";

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

test("a completed local auto-run waits in review until its worktree is delivered", () => {
  const item = {
    id: "lwi_1", status: "in_progress", state: "open", revision: 1,
    acceptanceCriteria: [],
    executionBindings: [{ kind: "auto_run", targetId: "aur_local" }],
  };
  const state = { workItems: [item], workItemActivities: [] };
  syncBoundWorkItemsForAutoRun({
    state,
    autoRun: {
      id: "aur_local",
      link: { type: "local_issue", number: 1 },
      localDelivery: { worktreeId: "wtr_1", branchName: "local-1" },
    },
    status: "done",
    now: () => "2026-07-24T00:00:00.000Z",
    nextId: () => "wia_1",
  });
  assert.equal(item.status, "review");
  assert.equal(item.state, "open");
});

test("a merged pull request settles a formerly local delivery", () => {
  const item = {
    id: "lwi_1", status: "review", state: "open", revision: 1,
    acceptanceCriteria: [],
    executionBindings: [{ kind: "auto_run", targetId: "aur_local_pr" }],
  };
  const autoRun = {
    id: "aur_local_pr",
    status: "pr_open",
    prState: "OPEN",
    link: { type: "local_issue", number: 1 },
    localDelivery: {
      worktreeId: "wtr_1", branchName: "local-1", mode: "pull_request",
      prNumber: 7, prUrl: "https://github.test/o/r/pull/7",
    },
  };
  const state = { workItems: [item], workItemActivities: [] };
  convergeAutoRunTerminalState({
    state,
    autoRun,
    disposition: "MERGED",
    source: "poll",
    now: () => "2026-07-24T00:00:00.000Z",
    nextId: () => "wia_1",
  });
  assert.equal(item.status, "done");
  assert.equal(item.state, "closed");
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

test("auto-run verification and judgment become work-item evidence", () => {
  let counter = 0;
  const state = {
    workItems: [{
      id: "lwi_1", ownerTeamId: "team_local", projectId: "prj_1",
      status: "in_progress", state: "open", revision: 1,
      acceptanceCriteria: ["Tests pass", "Behavior matches"],
      executionBindings: [{ kind: "auto_run", targetId: "aur_1" }],
    }],
    workItemActivities: [],
  };
  const autoRun = {
    id: "aur_1", worktreeId: "wtr_1", prUrl: "https://github.test/pr/1",
    verification: { verified: true, passed: true, summary: "321 tests passed" },
    judgment: { solved: true, summary: "Acceptance satisfied" },
  };
  const input = {
    state, autoRun, now: () => "2026-07-24T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++counter}`,
  };
  syncBoundWorkItemsForAutoRun({ ...input, status: "pr_open" });
  const item = state.workItems[0];
  assert.equal(item.verificationRecords[0].status, "passed");
  assert.equal(item.verificationRecords[0].sourceAutoRunId, "aur_1");
  assert.equal(item.acceptanceResults.every((result) => result.status === "passed"), true);
  assert.equal(item.verificationRecords[0].evidence.some((entry) => entry.ref === autoRun.prUrl), true);
  syncBoundWorkItemsForAutoRun({ ...input, status: "done" });
  assert.equal(item.status, "done");
  assert.equal(item.verificationRecords.length, 1);
});

test("auto-run cannot close a criteria-bearing item without completion evidence", () => {
  const state = {
    workItems: [{
      id: "lwi_1", status: "review", state: "open", revision: 1,
      acceptanceCriteria: ["Human sign-off"],
      executionBindings: [{ kind: "auto_run", targetId: "aur_1" }],
    }],
    workItemActivities: [],
  };
  syncBoundWorkItemsForAutoRun({
    state, autoRun: { id: "aur_1" }, status: "done",
    now: () => "2026-07-24T00:00:00.000Z", nextId: () => "wia_1",
  });
  assert.equal(state.workItems[0].status, "review");
  assert.equal(state.workItems[0].state, "open");
});

test("terminal convergence records one canonical outcome and settles the bound local issue", () => {
  const item = {
    id: "wi_1",
    status: "review",
    executionBindings: [{ kind: "auto_run", targetId: "aur_1" }],
    acceptanceCriteria: [],
  };
  const autoRun = { id: "aur_1", status: "pr_open", prState: "OPEN" };
  const state = { workItems: [item], workItemActivities: [] };
  const result = convergeAutoRunTerminalState({
    state,
    autoRun,
    disposition: "MERGED",
    source: "github_webhook",
    now: () => "2026-07-24T12:00:00.000Z",
    nextId: () => "wia_1",
  });
  assert.equal(result.changed, true);
  assert.equal(autoRun.prState, "MERGED");
  assert.equal(autoRun.prMergedAt, "2026-07-24T12:00:00.000Z");
  assert.deepEqual(autoRun.terminalOutcome, {
    disposition: "MERGED",
    source: "github_webhook",
    convergedAt: "2026-07-24T12:00:00.000Z",
  });
  assert.equal(item.status, "done");
});
