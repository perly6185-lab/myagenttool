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
  assert.deepEqual(result, { mode: "shadow", swept: 1, selected: 1, eligibleCount: 1, starts: [] });
  assert.deepEqual(state.workItems, before);
  assert.equal(events[0].type, "work_item_auto_scheduler_decision");
  assert.equal(service.preview({ teamId: "team_a" }).nextWorkItemId, "lwi_1");
});

test("enabled mode admits one task, binds its reserved Run, and does not duplicate it", async () => {
  const { state, events } = fixture("enabled");
  Object.assign(state.workItems[0], {
    localNumber: 1, localRef: "LOCAL-1", title: "Implement queue", body: "", terminalId: "dev_local", createdBy: "usr_a",
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
    mode: "enabled", swept: 0, selected: 0, eligibleCount: 0, starts: [],
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
  const service = createWorkItemAutoSchedulerService({
    state,
    now: () => "2026-08-08T04:00:00.000Z",
    appendEvent: (event) => events.push(event),
    getWorkItem: () => ({ ok: true, body: { workItem: state.workItems[0] } }),
    beginExecution: () => ({ ok: true, body: { operation: { id: "weo_1" } } }),
    abortExecution: () => { aborts += 1; return { ok: true }; },
    reserveAutoRun: async () => { throw new Error("At capacity: 1/1 active runs."); },
    recordExecutionBinding: () => ({ ok: true }),
    enqueueAutoRunUnderstanding: () => {},
  });
  const result = await service.sweep();
  assert.equal(result.starts[0].reason, "waiting_capacity");
  assert.equal(aborts, 1);
  assert.equal(events.some((event) => event.type === "work_item_auto_scheduler_start_failed"), false);
});
