import test from "node:test";
import assert from "node:assert/strict";

import { createWorkItemAutoRunBatchService } from "../src/services/work-item-auto-run-batches.mjs";

function fixture({ startAutoRun: startAutoRunOverride } = {}) {
  const state = { workItemAutoRunBatches: [], autoRuns: [] };
  let sequence = 0;
  const workItems = new Map(Array.from({ length: 5 }, (_, index) => {
    const number = index + 1;
    return [`lwi_${number}`, {
      id: `lwi_${number}`,
      localRef: `LOCAL-${number}`,
      localNumber: number,
      projectId: "prj_a",
      title: `Task ${number}`,
      body: "",
      acceptanceCriteria: [],
      state: "open",
      planningProjects: [],
      terminalId: "dev_a",
    }];
  }));
  const service = createWorkItemAutoRunBatchService({
    state,
    now: () => "2026-07-29T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++sequence}`,
    persistStateSoon: () => {},
    appendEvent: () => {},
    getWorkItem: ({ workItemId }) => ({
      ok: workItems.has(workItemId),
      status: workItems.has(workItemId) ? 200 : 404,
      body: workItems.has(workItemId) ? { workItem: workItems.get(workItemId) } : { error: "not_found" },
    }),
    beginExecution: () => ({ ok: true, body: { operation: { id: `op_${++sequence}` } } }),
    abortExecution: () => ({ ok: true }),
    recordExecutionBinding: () => ({ ok: true }),
    startAutoRun: startAutoRunOverride ?? (async ({ executionChainId }) => {
      const run = { id: `aur_${++sequence}`, status: "running", worktreeId: `wtr_${sequence}`, executionChainId };
      state.autoRuns.push(run);
      return { autoRun: run, worktree: { id: run.worktreeId } };
    }),
  });
  return { state, service };
}

test("durable work-item batch enforces concurrency and backfills the next slot", async () => {
  const { state, service } = fixture();
  const created = await service.createBatch({
    workItemIds: ["lwi_1", "lwi_2", "lwi_3", "lwi_4", "lwi_5"],
    maxConcurrent: 2,
  }, { userId: "usr_a", teamId: "team_a", role: "operator" });

  assert.equal(created.status, 201);
  assert.equal(created.body.batch.total, 5);
  assert.equal(created.body.batch.counts.running, 2);
  assert.equal(created.body.batch.counts.queued, 3);
  assert.equal(state.autoRuns.length, 2);

  state.autoRuns[0].status = "done";
  await service.sweepBatches();

  const batch = service.listBatches({}, { teamId: "team_a" }).body.batches[0];
  assert.equal(state.autoRuns.length, 3);
  assert.equal(batch.counts.running, 2);
  assert.equal(batch.counts.done, 1);
  assert.equal(batch.counts.queued, 2);
});

test("batch listing is team scoped", async () => {
  const { service } = fixture();
  await service.createBatch({ workItemIds: ["lwi_1"], maxConcurrent: 1 }, {
    userId: "usr_a", teamId: "team_a", role: "operator",
  });
  assert.equal(service.listBatches({}, { teamId: "team_a" }).body.count, 1);
  assert.equal(service.listBatches({}, { teamId: "team_b" }).body.count, 0);
});

test("global capacity pressure keeps the item queued for a later sweep", async () => {
  let hasCapacity = false;
  const { state, service } = fixture({
    startAutoRun: async ({ executionChainId }) => {
      if (!hasCapacity) throw new Error("At capacity: max 2 active Auto-runs.");
      const run = { id: "aur_retried", status: "waiting_capacity", executionChainId };
      state.autoRuns.push(run);
      return { autoRun: run, worktree: { id: "wtr_retried" } };
    },
  });

  const created = await service.createBatch({ workItemIds: ["lwi_1"], maxConcurrent: 1 }, {
    userId: "usr_a", teamId: "team_a", role: "operator",
  });
  assert.equal(created.body.batch.status, "queued");
  assert.equal(created.body.batch.counts.queued, 1);
  assert.match(created.body.batch.items[0].error, /At capacity/);

  hasCapacity = true;
  await service.sweepBatches();
  const batch = service.listBatches({}, { teamId: "team_a" }).body.batches[0];
  assert.equal(batch.items[0].status, "waiting_capacity");
  assert.equal(batch.active, 1);
});

test("restart sweep returns an interrupted starting item to the durable queue", async () => {
  const { state, service } = fixture();
  state.workItemAutoRunBatches.push({
    id: "wib_restored",
    teamId: "team_a",
    createdBy: "usr_a",
    createdByRole: "operator",
    status: "running",
    maxConcurrent: 1,
    agentId: null,
    items: [{
      workItemId: "lwi_1", localRef: "LOCAL-1", title: "Task 1",
      status: "starting", autoRunId: null, createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    }],
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  });

  await service.sweepBatches();
  assert.equal(state.autoRuns.length, 1);
  assert.equal(state.workItemAutoRunBatches[0].items[0].status, "running");
});
