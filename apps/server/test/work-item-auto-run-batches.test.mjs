import test from "node:test";
import assert from "node:assert/strict";

import { createWorkItemAutoRunBatchService } from "../src/services/work-item-auto-run-batches.mjs";

function repoAgent(id, deviceId = "dev_a") {
  return {
    id,
    status: "available",
    lifecycle: { state: "enabled" },
    health: { status: "healthy" },
    adapter: { type: "cli" },
    location: { type: "local_device", deviceId },
    capabilities: [{ name: `${id.replace(/^agt_/, "")}_repo_task` }],
  };
}

function fixture({
  startAutoRun: startAutoRunOverride,
  agents = [repoAgent("agt_codex_cli")],
  projects = [{ id: "prj_a", defaultAgentId: null }],
} = {}) {
  const state = { workItemAutoRunBatches: [], autoRuns: [], agents, projects };
  const scheduledPumps = [];
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
      acceptanceCriteria: [`Task ${number} is complete`],
      verificationSop: ["Review the result"],
      executionContractConfirmedAt: "2026-07-29T00:00:00.000Z",
      executionContractGate: { ready: true, missing: [], source: "manual", confirmedAt: "2026-07-29T00:00:00.000Z" },
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
    schedulePump: (callback, options) => {
      scheduledPumps.push({ callback, options });
    },
    reserveAutoRun: startAutoRunOverride ?? (async ({ executionChainId }) => {
      const run = { id: `aur_${++sequence}`, status: "running", worktreeId: `wtr_${sequence}`, executionChainId };
      state.autoRuns.push(run);
      return { autoRun: run, worktree: { id: run.worktreeId } };
    }),
    enqueueAutoRunUnderstanding: () => true,
  });
  return {
    state,
    service,
    scheduledPumps,
    runNextScheduledPump: async () => {
      const scheduled = scheduledPumps.shift();
      if (scheduled) await scheduled.callback();
    },
    runScheduledPumps: async () => {
      while (scheduledPumps.length > 0) {
        await scheduledPumps.shift().callback();
      }
    },
  };
}

test("durable work-item batch enforces concurrency and backfills the next slot", async () => {
  const { state, service, runScheduledPumps } = fixture();
  const created = await service.createBatch({
    workItemIds: ["lwi_1", "lwi_2", "lwi_3", "lwi_4", "lwi_5"],
    maxConcurrent: 2,
  }, { userId: "usr_a", teamId: "team_a", role: "operator" });

  assert.equal(created.status, 201);
  assert.equal(created.body.batch.total, 5);
  assert.equal(created.body.batch.counts.queued, 5);
  assert.equal(state.autoRuns.length, 0, "acceptance returns before worktree/Auto-run startup");

  await runScheduledPumps();
  let batch = service.listBatches({}, { teamId: "team_a" }).body.batches[0];
  let peakActive = batch.active;
  assert.equal(batch.counts.running, 2);
  assert.equal(batch.counts.queued, 3);
  assert.equal(state.autoRuns.length, 2);

  for (let completed = 0; completed < 3; completed += 1) {
    state.autoRuns[completed].status = "done";
    await service.sweepBatches();
    await runScheduledPumps();
    batch = service.listBatches({}, { teamId: "team_a" }).body.batches[0];
    peakActive = Math.max(peakActive, batch.active);
    assert.equal(batch.active, 2, "each completed run backfills exactly one concurrency slot");
  }

  assert.equal(state.autoRuns.length, 5);
  state.autoRuns[3].status = "done";
  state.autoRuns[4].status = "done";
  await service.sweepBatches();
  await runScheduledPumps();
  batch = service.listBatches({}, { teamId: "team_a" }).body.batches[0];
  assert.equal(peakActive, 2);
  assert.equal(batch.status, "completed");
  assert.equal(batch.counts.done, 5);
  assert.equal(batch.active, 0);
  assert.equal(batch.completed, 5);
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
  const { state, service, runScheduledPumps } = fixture({
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
  await runScheduledPumps();
  assert.match(state.workItemAutoRunBatches[0].items[0].error, /At capacity/);

  hasCapacity = true;
  await service.sweepBatches();
  await runScheduledPumps();
  const batch = service.listBatches({}, { teamId: "team_a" }).body.batches[0];
  assert.equal(batch.items[0].status, "waiting_capacity");
  assert.equal(batch.active, 1);
});

test("batch reconciles a terminal run before rejecting a newly unhealthy agent", async () => {
  const agent = repoAgent("agt_codex_cli");
  const { state, service, runScheduledPumps } = fixture({ agents: [agent] });
  await service.createBatch({
    workItemIds: ["lwi_1"],
    maxConcurrent: 1,
    agentId: agent.id,
  }, { userId: "usr_a", teamId: "team_a", role: "operator" });
  await runScheduledPumps();
  assert.equal(state.workItemAutoRunBatches[0].items[0].status, "running");

  state.autoRuns[0].status = "failed";
  agent.health.status = "unhealthy";
  await service.sweepBatches();
  await runScheduledPumps();

  const batch = service.listBatches({}, { teamId: "team_a" }).body.batches[0];
  assert.equal(batch.status, "completed_with_failures");
  assert.equal(batch.items[0].status, "failed");
  assert.equal(batch.completed, 1);
  assert.equal(batch.active, 0);
});

test("batch acceptance is non-blocking even when Auto-run startup is slow", async () => {
  let releaseStart;
  const startGate = new Promise((resolve) => {
    releaseStart = resolve;
  });
  const { state, service, runScheduledPumps } = fixture({
    startAutoRun: async ({ executionChainId }) => {
      await startGate;
      const run = { id: "aur_slow", status: "running", worktreeId: "wtr_slow", executionChainId };
      state.autoRuns.push(run);
      return { autoRun: run, worktree: { id: run.worktreeId } };
    },
  });

  const created = await service.createBatch({
    workItemIds: ["lwi_1"],
    maxConcurrent: 1,
    idempotencyKey: "slow-batch",
  }, { userId: "usr_a", teamId: "team_a", role: "operator" });

  assert.equal(created.status, 201);
  assert.equal(created.body.batch.status, "queued");
  assert.equal(state.autoRuns.length, 0);
  releaseStart();
  await runScheduledPumps();
  assert.equal(state.autoRuns.length, 1);
});

test("batch pump leaves an acceptance grace window and starts one item per event-loop turn", async () => {
  const { state, service, scheduledPumps, runNextScheduledPump } = fixture();
  const actor = { userId: "usr_a", teamId: "team_a", role: "operator" };
  const created = await service.createBatch({
    workItemIds: ["lwi_1", "lwi_2"],
    maxConcurrent: 2,
    idempotencyKey: "interleaved-replay",
  }, actor);

  assert.equal(created.status, 201);
  assert.equal(scheduledPumps.length, 1);
  assert.equal(scheduledPumps[0].options.delayMs, 250);
  await runNextScheduledPump();
  assert.equal(state.autoRuns.length, 1);
  assert.equal(scheduledPumps.length, 1, "the second start is deferred to another event-loop turn");

  const replay = await service.createBatch({
    workItemIds: ["lwi_1", "lwi_2"],
    maxConcurrent: 2,
    idempotencyKey: "interleaved-replay",
  }, actor);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.batch.id, created.body.batch.id);
  assert.equal(state.autoRuns.length, 1);

  await runNextScheduledPump();
  assert.equal(state.autoRuns.length, 2);
});

test("batch idempotency replays the original batch and rejects key reuse with different input", async () => {
  const { state, service, runScheduledPumps } = fixture();
  const actor = { userId: "usr_a", teamId: "team_a", role: "operator" };
  const first = await service.createBatch({
    workItemIds: ["lwi_1", "lwi_2"],
    maxConcurrent: 2,
    idempotencyKey: "batch-request-1",
  }, actor);
  const replay = await service.createBatch({
    workItemIds: ["lwi_1", "lwi_2"],
    maxConcurrent: 2,
    idempotencyKey: " batch-request-1 ",
  }, actor);
  const conflict = await service.createBatch({
    workItemIds: ["lwi_1"],
    maxConcurrent: 1,
    idempotencyKey: "batch-request-1",
  }, actor);

  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.batch.id, first.body.batch.id);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "idempotency_key_conflict");
  assert.equal(state.workItemAutoRunBatches.length, 1);

  await runScheduledPumps();
  assert.equal(state.autoRuns.length, 2, "a replay does not schedule the batch twice");
});

test("batch resolves a production repository agent and never falls back to the demo agent", async () => {
  const canonical = fixture();
  const canonicalResult = await canonical.service.createBatch({
    workItemIds: ["lwi_1"],
    maxConcurrent: 1,
  }, { userId: "usr_a", teamId: "team_a", role: "operator" });
  assert.equal(canonicalResult.status, 201);
  assert.equal(canonicalResult.body.batch.agentId, "agt_codex_cli");
  assert.equal(canonicalResult.body.batch.agentResolution, "canonical_default");

  const projectDefault = fixture({
    agents: [repoAgent("agt_codex_cli"), repoAgent("agt_claude_acceptEdits")],
    projects: [{ id: "prj_a", defaultAgentId: "agt_claude_acceptEdits" }],
  });
  const projectResult = await projectDefault.service.createBatch({
    workItemIds: ["lwi_1"],
    maxConcurrent: 1,
  }, { userId: "usr_a", teamId: "team_a", role: "operator" });
  assert.equal(projectResult.status, 201);
  assert.equal(projectResult.body.batch.agentId, "agt_claude_acceptEdits");
  assert.equal(projectResult.body.batch.agentResolution, "project_default");

  const demo = fixture({
    agents: [{
      ...repoAgent("agt_demo_cli"),
      capabilities: [{ name: "demo_task" }],
    }],
  });
  const demoResult = await demo.service.createBatch({
    workItemIds: ["lwi_1"],
    agentId: "agt_demo_cli",
  }, { userId: "usr_a", teamId: "team_a", role: "operator" });
  assert.equal(demoResult.status, 409);
  assert.equal(demoResult.body.error, "batch_agent_not_eligible");
  assert.equal(demoResult.body.reason, "demo_agent_not_allowed");
});

test("batch rejects an ambiguous missing agent instead of selecting one silently", async () => {
  const { service } = fixture({
    agents: [repoAgent("agt_claude_acceptEdits"), repoAgent("agt_other_cli")],
  });
  const result = await service.createBatch({
    workItemIds: ["lwi_1"],
  }, { userId: "usr_a", teamId: "team_a", role: "operator" });

  assert.equal(result.status, 409);
  assert.equal(result.body.error, "batch_agent_required");
  assert.equal(result.body.reason, "ambiguous_repository_agents");
});

test("restart sweep returns an interrupted starting item to the durable queue", async () => {
  const { state, service, runScheduledPumps } = fixture();
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
  await runScheduledPumps();
  assert.equal(state.autoRuns.length, 1);
  assert.equal(state.workItemAutoRunBatches[0].items[0].status, "running");
  assert.equal(state.workItemAutoRunBatches[0].agentId, "agt_codex_cli");
});
