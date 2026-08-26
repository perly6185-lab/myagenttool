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
  assert.equal(state.workItems[0].waitingOn, "ai");
  syncBoundWorkItemsForAutoRun({ ...input, status: "pr_open" });
  assert.equal(state.workItems[0].status, "review");
  assert.equal(state.workItems[0].waitingOn, "me");
  syncBoundWorkItemsForAutoRun({ ...input, status: "done" });
  assert.equal(state.workItems[0].status, "done");
  assert.equal(state.workItems[0].waitingOn, "none");
  assert.equal(state.workItems[0].state, "closed");
  assert.equal(state.workItemActivities.length, 3);
});

test("a completed local auto-run waits in review until its worktree is delivered", () => {
  const item = {
    id: "lwi_1", status: "review", state: "open", revision: 1, waitingOn: "ai",
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
  assert.equal(item.waitingOn, "me", "a same-status reconciliation still makes the user action visible");
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
  assert.equal(state.workItems[0].waitingOn, "me");
  assert.equal(state.workItems[1].status, "ready");
});

test("an older failed Run cannot overwrite the latest retry result", () => {
  const item = {
    id: "lwi_retry", status: "review", state: "open", revision: 4, waitingOn: "me",
    executionBindings: [
      { kind: "auto_run", targetId: "aur_old", createdAt: "2026-08-08T00:00:00.000Z" },
      { kind: "auto_run", targetId: "aur_retry", createdAt: "2026-08-08T00:01:00.000Z" },
    ],
  };
  const state = { workItems: [item], workItemActivities: [] };
  const input = {
    state,
    now: () => "2026-08-08T00:02:00.000Z",
    nextId: () => "wia_retry",
  };

  syncBoundWorkItemsForAutoRun({ ...input, autoRun: { id: "aur_old" }, status: "failed" });
  assert.equal(item.status, "review");
  assert.equal(item.waitingOn, "me");
  assert.equal(item.revision, 4);

  syncBoundWorkItemsForAutoRun({ ...input, autoRun: { id: "aur_retry" }, status: "report_posted" });
  assert.equal(item.status, "review");
  assert.equal(item.waitingOn, "me");
});

test("human gates explicitly switch the task to waiting on me", () => {
  const item = {
    id: "lwi_1", status: "in_progress", state: "open", revision: 1, waitingOn: "ai",
    executionBindings: [{ kind: "auto_run", targetId: "aur_1" }],
  };
  const state = { workItems: [item], workItemActivities: [] };
  const input = {
    state, autoRun: { id: "aur_1" },
    now: () => "2026-07-24T00:00:00.000Z", nextId: () => "wia_1",
  };

  syncBoundWorkItemsForAutoRun({ ...input, status: "awaiting_approval" });
  assert.equal(item.status, "in_progress");
  assert.equal(item.waitingOn, "me");

  item.waitingOn = "ai";
  syncBoundWorkItemsForAutoRun({ ...input, status: "needs_input" });
  assert.equal(item.status, "review");
  assert.equal(item.waitingOn, "me");
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

test("a verified local software delivery projects Git changes and every required verification kind", () => {
  let counter = 0;
  const item = {
    id: "lwi_code", ownerTeamId: "team_local", projectId: "prj_1", terminalId: "dev_local_001",
    status: "in_progress", state: "open", revision: 1,
    acceptanceCriteria: ["The implementation works"],
    artifactContract: {
      produces: ["software_change"],
      requirements: [{ kind: "software_change", minCount: 1, extensions: [".diff"] }],
      verification: { requiredKinds: ["test", "build"] },
    },
    resultVerificationContract: { enforced: true },
    executionBindings: [{ kind: "auto_run", targetId: "aur_code" }],
  };
  const autoRun = {
    id: "aur_code", worktreeId: "wtr_code", updatedAt: "2026-08-26T00:00:00.000Z",
    link: { type: "local_issue", number: 2 },
    localDelivery: { worktreeId: "wtr_code", branchName: "local-2" },
    deliveryReport: {
      changedFiles: ["src/session.mjs", "test/session.test.mjs"],
      changedFilesBaseCommit: "a".repeat(40),
      completedAt: "2026-08-26T00:00:00.000Z",
    },
    verification: { verified: true, passed: true, summary: "Project verification passed", commands: ["pnpm test:ci"] },
    judgment: { solved: true, summary: "Acceptance satisfied" },
  };
  const state = { workItems: [item], workItemActivities: [] };
  syncBoundWorkItemsForAutoRun({
    state, autoRun, status: "done",
    now: () => "2026-08-26T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++counter}`,
  });

  assert.equal(item.status, "review", "local delivery still waits for the user's apply action");
  assert.deepEqual(item.verificationRecords.map((record) => record.kind).sort(), ["build", "test"]);
  assert.equal(item.executionArtifacts[0].kind, "software_change");
  assert.deepEqual(item.executionArtifacts[0].changedFiles, autoRun.deliveryReport.changedFiles);
  assert.equal(item.resultVerification.status, "passed");
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
