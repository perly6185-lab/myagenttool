import assert from "node:assert/strict";
import { test } from "node:test";

import { createWorkItemAutoSchedulerService } from "../src/services/work-item-auto-scheduler.mjs";

function fixture(mode = "shadow") {
  const events = [];
  const state = {
    autoRunSettings: { workItemAutoSchedulerMode: mode },
    projects: [{ id: "prj_a", ownerTeamId: "team_a", autoExecutionEnabled: true }],
    workItems: [{
      id: "lwi_1", ownerTeamId: "team_a", projectId: "prj_a", state: "open", status: "ready",
      priority: "p1", executionPolicy: "inherit", waitingOn: "ai", dependencyIds: [], executionBindings: [],
      createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    }],
    autoRuns: [], invocations: [], agents: [{
      id: "agt_codex_cli", status: "idle", health: { status: "healthy" },
      adapter: { type: "cli" }, location: { type: "local_device", deviceId: "dev_local" },
      capabilities: [{ name: "codex_repo_task" }],
    }], approvalRequests: [],
  };
  const service = createWorkItemAutoSchedulerService({
    state,
    now: () => "2026-08-08T04:00:00.000Z",
    appendEvent: (event) => events.push(event),
  });
  return { state, events, service };
}

test("shadow mode reports the next task without creating execution state", async () => {
  const { state, events, service } = fixture();
  const before = structuredClone(state.workItems);
  const result = await service.sweep();
  assert.deepEqual(result, { mode: "shadow", swept: 1, selected: 1, eligibleCount: 1, recoveredBindings: 0, starts: [] });
  assert.deepEqual(state.workItems, before);
  assert.equal(events[0].type, "work_item_auto_scheduler_decision");
  assert.equal(service.preview({ teamId: "team_a" }).nextWorkItemId, "lwi_1");
});

test("enabled mode admits one task, binds its reserved Run, and does not duplicate it", async () => {
  const { state, events } = fixture("enabled");
  Object.assign(state.workItems[0], {
    localNumber: 1, localRef: "LOCAL-1", title: "Implement queue", body: "", terminalId: "dev_local", createdBy: "usr_a",
    plannedDate: "2026-08-10",
  });
  let beginCount = 0;
  let enqueueCount = 0;
  const service = createWorkItemAutoSchedulerService({
    state,
    now: () => "2026-08-08T04:00:00.000Z",
    appendEvent: (event) => events.push(event),
    getWorkItem: ({ workItemId }) => ({ ok: true, body: { workItem: state.workItems.find((item) => item.id === workItemId) } }),
    beginExecution: () => ({ ok: true, body: { operation: { id: `weo_${++beginCount}` } } }),
    abortExecution: () => ({ ok: true }),
    reserveAutoRun: async () => {
      const autoRun = { id: "aur_1", status: "materializing", localIssueId: "lwi_1", executionChainId: "lwi_1" };
      state.autoRuns.push(autoRun);
      return { autoRun, worktree: null };
    },
    recordExecutionBinding: ({ workItemId, targetId }) => {
      state.workItems.find((item) => item.id === workItemId).executionBindings.push({ kind: "auto_run", targetId });
      return { ok: true };
    },
    enqueueAutoRunUnderstanding: () => { enqueueCount += 1; },
  });
  const first = await service.sweep();
  assert.equal(first.starts[0].started, true);
  assert.equal(beginCount, 1);
  assert.equal(enqueueCount, 1);
  assert.equal(service.preview({ teamId: "team_a" }).metrics.futurePullForwards, 1);
  await service.sweep();
  assert.equal(beginCount, 1, "an active Run prevents duplicate scheduler admission");
  assert.equal(events.some((event) => event.type === "work_item_auto_scheduler_started"), true);
});

test("unchanged shadow decisions are logged once and off mode is inert", async () => {
  const { events, service } = fixture();
  await service.sweep();
  await service.sweep();
  assert.equal(events.length, 1);
  const disabled = fixture("off");
  assert.deepEqual(await disabled.service.sweep(), { mode: "off", swept: 0, selected: 0 });
  assert.equal(disabled.events.length, 0);
});

test("scheduler defaults on safely and the global kill switch stops it", async () => {
  const enabled = fixture(undefined);
  delete enabled.state.autoRunSettings.workItemAutoSchedulerMode;
  assert.equal(enabled.service.mode(), "enabled");
  enabled.state.projects[0].autoExecutionEnabled = false;
  assert.deepEqual(await enabled.service.sweep(), {
    mode: "enabled", swept: 1, selected: 0, eligibleCount: 0, recoveredBindings: 0, starts: [],
  });

  const stopped = fixture("enabled");
  stopped.state.autoRunSettings.autonomyKillSwitch = true;
  assert.equal(stopped.service.mode(), "off");
  assert.deepEqual(await stopped.service.sweep(), { mode: "off", swept: 0, selected: 0 });
});

test("capacity refusal aborts admission and stays an internal retry state", async () => {
  const { state, events } = fixture("enabled");
  Object.assign(state.workItems[0], {
    localNumber: 1, localRef: "LOCAL-1", title: "Wait quietly", body: "", terminalId: "dev_local", createdBy: "usr_a",
  });
  let aborts = 0;
  let reservations = 0;
  const service = createWorkItemAutoSchedulerService({
    state,
    now: () => "2026-08-08T04:00:00.000Z",
    appendEvent: (event) => events.push(event),
    getWorkItem: () => ({ ok: true, body: { workItem: state.workItems[0] } }),
    beginExecution: () => ({ ok: true, body: { operation: { id: "weo_1" } } }),
    abortExecution: () => { aborts += 1; return { ok: true }; },
    reserveAutoRun: async () => { reservations += 1; throw new Error("At capacity: 1/1 active runs."); },
    recordExecutionBinding: () => ({ ok: true }),
    enqueueAutoRunUnderstanding: () => {},
  });
  const result = await service.sweep();
  assert.equal(result.starts[0].reason, "waiting_capacity");
  assert.equal(aborts, 1);
  assert.equal(events.some((event) => event.type === "work_item_auto_scheduler_start_failed"), false);
  await service.sweep();
  assert.equal(reservations, 2, "an unchanged capacity deferral is retried on the next sweep");
});

test("recovers a reserved Run that lost its work-item binding before restart", async () => {
  const { state, events } = fixture("enabled");
  Object.assign(state.workItems[0], {
    localNumber: 1,
    localRef: "LOCAL-1",
    title: "Recover me",
    createdBy: "usr_a",
    executionOperation: { id: "weo_1", kind: "auto_run", status: "starting" },
  });
  state.autoRuns.push({
    id: "aur_orphan",
    status: "materializing",
    localIssueId: "lwi_1",
    scheduler: { source: "work_item_auto_scheduler", operationId: "weo_1" },
  });
  let enqueued = 0;
  const service = createWorkItemAutoSchedulerService({
    state,
    now: () => "2026-08-08T04:00:00.000Z",
    appendEvent: (event) => events.push(event),
    recordExecutionBinding: ({ workItemId, targetId, operationId }) => {
      assert.deepEqual({ workItemId, targetId, operationId }, { workItemId: "lwi_1", targetId: "aur_orphan", operationId: "weo_1" });
      state.workItems[0].executionBindings.push({ kind: "auto_run", targetId });
      state.workItems[0].executionOperation = null;
      return { ok: true };
    },
    enqueueAutoRunUnderstanding: () => { enqueued += 1; },
  });

  const result = await service.sweep();
  assert.equal(result.recoveredBindings, 1);
  assert.equal(enqueued, 1);
  assert.equal(service.preview({ teamId: "team_a" }).metrics.recoveredBindings, 1);
  assert.equal(events.some((event) => event.type === "work_item_auto_scheduler_binding_recovered"), true);
});

test("isolates orphan binding recovery failures so another Run can recover", async () => {
  const { state } = fixture("enabled");
  state.workItems.push({
    ...structuredClone(state.workItems[0]),
    id: "lwi_2",
    localRef: "LOCAL-2",
    executionBindings: [],
    executionOperation: { id: "weo_2", kind: "auto_run", status: "starting" },
  });
  state.workItems[0].executionOperation = { id: "weo_1", kind: "auto_run", status: "starting" };
  state.autoRuns.push(
    { id: "aur_broken", status: "materializing", localIssueId: "lwi_1", scheduler: { source: "work_item_auto_scheduler", operationId: "weo_1" } },
    { id: "aur_recoverable", status: "materializing", localIssueId: "lwi_2", scheduler: { source: "work_item_auto_scheduler", operationId: "weo_2" } },
  );
  let enqueued = 0;
  const service = createWorkItemAutoSchedulerService({
    state,
    now: () => "2026-08-08T04:00:00.000Z",
    recordExecutionBinding: ({ workItemId, targetId }) => {
      if (workItemId === "lwi_1") throw new Error("fixture write failure");
      state.workItems[1].executionBindings.push({ kind: "auto_run", targetId });
      return { ok: true };
    },
    enqueueAutoRunUnderstanding: () => { enqueued += 1; },
  });

  const result = await service.sweep();
  assert.equal(result.recoveredBindings, 1);
  assert.equal(enqueued, 1);
  const metrics = service.preview({ teamId: "team_a" }).metrics;
  assert.equal(metrics.recoveredBindings, 1);
  assert.equal(metrics.recoveryFailures, 1);
});

test("shadow mode never repairs or enqueues an orphaned Run", async () => {
  const { state } = fixture("shadow");
  state.workItems[0].executionOperation = { id: "weo_1", kind: "auto_run", status: "starting" };
  state.autoRuns.push({
    id: "aur_orphan",
    status: "materializing",
    localIssueId: "lwi_1",
    scheduler: { source: "work_item_auto_scheduler", operationId: "weo_1" },
  });
  let recorded = 0;
  let enqueued = 0;
  const service = createWorkItemAutoSchedulerService({
    state,
    now: () => "2026-08-08T04:00:00.000Z",
    recordExecutionBinding: () => { recorded += 1; return { ok: true }; },
    enqueueAutoRunUnderstanding: () => { enqueued += 1; },
  });

  const result = await service.sweep();
  assert.equal(result.recoveredBindings, 0);
  assert.equal(recorded, 0);
  assert.equal(enqueued, 0);
  assert.equal(state.workItems[0].executionBindings.length, 0);
});

test("does not claim or fail an unbound Run created outside the scheduler", async () => {
  const { state } = fixture("enabled");
  state.workItems[0].executionOperation = { id: "weo_manual", kind: "auto_run", status: "starting" };
  state.autoRuns.push({
    id: "aur_manual",
    status: "materializing",
    localIssueId: "lwi_1",
  });
  let recorded = 0;
  let failed = 0;
  const service = createWorkItemAutoSchedulerService({
    state,
    now: () => "2026-08-08T04:00:00.000Z",
    recordExecutionBinding: () => { recorded += 1; return { ok: true }; },
    failAutoRunUnderstanding: () => { failed += 1; },
  });

  const result = await service.sweep();
  assert.equal(result.recoveredBindings, 0);
  assert.equal(recorded, 0);
  assert.equal(failed, 0);
});

test("an explicit automatic task runs even when its project defaults to manual", async () => {
  const { state } = fixture("enabled");
  state.projects[0].autoExecutionEnabled = false;
  Object.assign(state.workItems[0], {
    executionPolicy: "auto",
    localNumber: 1,
    title: "Explicit handoff",
    body: "",
    terminalId: "dev_local",
  });
  const service = createWorkItemAutoSchedulerService({
    state,
    now: () => "2026-08-08T04:00:00.000Z",
    getWorkItem: () => ({ ok: true, body: { workItem: state.workItems[0] } }),
    beginExecution: () => ({ ok: true, body: { operation: { id: "weo_1" } } }),
    abortExecution: () => ({ ok: true }),
    reserveAutoRun: async () => {
      const autoRun = { id: "aur_1", status: "materializing", localIssueId: "lwi_1" };
      state.autoRuns.push(autoRun);
      return { autoRun };
    },
    recordExecutionBinding: ({ targetId }) => {
      state.workItems[0].executionBindings.push({ kind: "auto_run", targetId });
      return { ok: true };
    },
    enqueueAutoRunUnderstanding: () => true,
  });

  const result = await service.sweep();
  assert.equal(result.starts[0].started, true);
});

test("a permanently unavailable queue head does not starve the next task", async () => {
  const { state } = fixture("enabled");
  Object.assign(state.workItems[0], {
    priority: "p0",
    localNumber: 1,
    title: "Unavailable terminal",
    terminalId: "dev_missing",
  });
  state.workItems.push({
    ...structuredClone(state.workItems[0]),
    id: "lwi_2",
    localNumber: 2,
    title: "Runnable task",
    priority: "p1",
    terminalId: "dev_local",
    executionBindings: [],
  });
  const service = createWorkItemAutoSchedulerService({
    state,
    now: () => "2026-08-08T04:00:00.000Z",
    getWorkItem: ({ workItemId }) => ({ ok: true, body: { workItem: state.workItems.find((item) => item.id === workItemId) } }),
    beginExecution: ({ workItemId }) => ({ ok: true, body: { operation: { id: `weo_${workItemId}` } } }),
    abortExecution: () => ({ ok: true }),
    reserveAutoRun: async ({ localIssueId }) => {
      const autoRun = { id: `aur_${localIssueId}`, status: "materializing", localIssueId };
      state.autoRuns.push(autoRun);
      return { autoRun };
    },
    recordExecutionBinding: ({ workItemId, targetId }) => {
      state.workItems.find((item) => item.id === workItemId).executionBindings.push({ kind: "auto_run", targetId });
      return { ok: true };
    },
    enqueueAutoRunUnderstanding: () => true,
  });

  const result = await service.sweep();
  assert.deepEqual(result.starts.map((row) => row.reason ?? row.workItemId), ["repository_agent_unavailable", "lwi_2"]);
});

test("a failed binding marks the reserved Run failed before reconciliation", async () => {
  const { state } = fixture("enabled");
  Object.assign(state.workItems[0], { localNumber: 1, title: "Binding failure", terminalId: "dev_local" });
  let failedRunId = null;
  const service = createWorkItemAutoSchedulerService({
    state,
    now: () => "2026-08-08T04:00:00.000Z",
    getWorkItem: () => ({ ok: true, body: { workItem: state.workItems[0] } }),
    beginExecution: () => ({ ok: true, body: { operation: { id: "weo_1" } } }),
    abortExecution: () => ({ ok: true }),
    reserveAutoRun: async () => {
      const autoRun = { id: "aur_orphan", status: "materializing", localIssueId: "lwi_1" };
      state.autoRuns.push(autoRun);
      return { autoRun };
    },
    recordExecutionBinding: () => ({ ok: false, body: { error: "work_item_execution_operation_conflict" } }),
    enqueueAutoRunUnderstanding: () => true,
    failAutoRunUnderstanding: (id) => {
      failedRunId = id;
      state.autoRuns.find((run) => run.id === id).status = "failed";
    },
  });

  const result = await service.sweep();
  assert.equal(result.starts[0].started, false);
  assert.equal(failedRunId, "aur_orphan");
  assert.equal(state.autoRuns[0].status, "failed");
});
