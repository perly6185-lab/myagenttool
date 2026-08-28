import assert from "node:assert/strict";
import { test } from "node:test";

import { handleWorkItemRoutes } from "../src/routes/work-items.mjs";

const actor = { userId: "usr_a", teamId: "team_a", role: "operator" };

function readyState() {
  return {
    projects: [{ id: "prj_a", defaultAgentId: "agt_a", git: { isRepo: true } }],
    agents: [{
      id: "agt_a",
      name: "Task assistant",
      status: "active",
      lifecycle: { state: "enabled" },
      health: { status: "healthy" },
      location: { type: "remote" },
    }],
    devices: [],
    autoRuns: [],
    autoRunSettings: {},
    autoRunBreaker: null,
  };
}

function preparedItem(overrides = {}) {
  return {
    id: "lwi_1",
    projectId: "prj_a",
    revision: 4,
    status: "backlog",
    waitingOn: "none",
    executionPolicy: "manual",
    acceptanceCriteria: ["The requested result exists."],
    verificationSop: ["Check the requested result."],
    executionContractGate: { ready: false, missing: ["confirmation"] },
    ...overrides,
  };
}

test("execution-plan preparation remains unconfirmed and forwards the assisted draft", async () => {
  let received;
  let sent;
  const item = preparedItem({ acceptanceCriteria: [], verificationSop: [] });
  const handled = await handleWorkItemRoutes({
    req: { method: "POST" },
    res: {},
    url: new URL("http://localhost/api/work-items/lwi_1/execution-contract/prepare"),
    readJson: async () => ({
      expectedRevision: 4,
      draftOverride: { acceptanceCriteria: ["Ready"], verificationSop: ["Verify"] },
    }),
    sendJson: (_res, status, body) => { sent = { status, body }; },
    actor,
    state: readyState(),
    getWorkItem: () => ({ ok: true, status: 200, body: { workItem: item } }),
    prepareExecutionContract: (input, requestActor) => {
      received = { input, requestActor };
      return { ok: true, status: 200, body: { workItem: preparedItem() } };
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(received, {
    input: {
      workItemId: "lwi_1",
      expectedRevision: 4,
      confirm: false,
      draftOverride: { acceptanceCriteria: ["Ready"], verificationSop: ["Verify"] },
    },
    requestActor: actor,
  });
  assert.equal(sent.status, 200);
});

test("execution confirmation fails closed when auto-run readiness is blocked", async () => {
  let confirmed = false;
  let sent;
  const state = readyState();
  state.projects[0].defaultAgentId = null;
  const handled = await handleWorkItemRoutes({
    req: { method: "POST" },
    res: {},
    url: new URL("http://localhost/api/work-items/lwi_1/execution-contract/confirm"),
    readJson: async () => ({ expectedRevision: 4 }),
    sendJson: (_res, status, body) => { sent = { status, body }; },
    actor,
    state,
    getWorkItem: () => ({ ok: true, status: 200, body: { workItem: preparedItem() } }),
    confirmExecutionContractAndSchedule: () => { confirmed = true; },
  });

  assert.equal(handled, true);
  assert.equal(confirmed, false);
  assert.equal(sent.status, 409);
  assert.equal(sent.body.error, "work_item_auto_run_not_ready");
  assert.equal(sent.body.readiness.ready, false);
});

test("execution confirmation cannot bypass a changed business-record snapshot", async () => {
  let confirmed = false;
  let sent;
  const handled = await handleWorkItemRoutes({
    req: { method: "POST" },
    res: {},
    url: new URL("http://localhost/api/work-items/lwi_1/execution-contract/confirm"),
    readJson: async () => ({ expectedRevision: 4 }),
    sendJson: (_res, status, body) => { sent = { status, body }; },
    actor,
    state: readyState(),
    reconcileWorkItemRecordBindings: async () => ({
      status: 200,
      body: {
        executionBlocked: true,
        currentRevision: 5,
        blockingBindings: [{ bindingId: "binding_customer", state: "stale" }],
      },
    }),
    getWorkItem: () => ({ ok: true, status: 200, body: { workItem: preparedItem() } }),
    confirmExecutionContractAndSchedule: () => { confirmed = true; },
  });

  assert.equal(handled, true);
  assert.equal(confirmed, false);
  assert.deepEqual(sent, {
    status: 409,
    body: {
      error: "work_item_record_bindings_stale",
      currentRevision: 5,
      blockingBindings: [{ bindingId: "binding_customer", state: "stale" }],
    },
  });
});

test("execution confirmation confirms the reviewed contract and schedules AI once", async () => {
  const calls = [];
  let sent;
  const handled = await handleWorkItemRoutes({
    req: { method: "POST" },
    res: {},
    url: new URL("http://localhost/api/work-items/lwi_1/execution-contract/confirm"),
    readJson: async () => ({ expectedRevision: 4 }),
    sendJson: (_res, status, body) => { sent = { status, body }; },
    actor,
    state: readyState(),
    getWorkItem: () => ({ ok: true, status: 200, body: { workItem: preparedItem() } }),
    confirmExecutionContractAndSchedule: (input) => {
      calls.push(input);
      return {
        ok: true,
        status: 200,
        body: { workItem: preparedItem({ revision: 6, status: "ready", waitingOn: "ai", executionPolicy: "auto" }), replayed: false },
      };
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(calls, [{ workItemId: "lwi_1", expectedRevision: 4 }]);
  assert.equal(sent.status, 200);
  assert.equal(sent.body.replayed, false);
});

test("repeated execution confirmation replays the scheduled state without another update", async () => {
  let confirmed = false;
  let sent;
  const item = preparedItem({
    revision: 8,
    status: "ready",
    waitingOn: "ai",
    executionPolicy: "auto",
    executionContractGate: { ready: true, missing: [] },
  });
  const handled = await handleWorkItemRoutes({
    req: { method: "POST" },
    res: {},
    url: new URL("http://localhost/api/work-items/lwi_1/execution-contract/confirm"),
    readJson: async () => ({ expectedRevision: 4 }),
    sendJson: (_res, status, body) => { sent = { status, body }; },
    actor,
    state: readyState(),
    getWorkItem: () => ({ ok: true, status: 200, body: { workItem: item } }),
    confirmExecutionContractAndSchedule: () => { confirmed = true; },
  });

  assert.equal(handled, true);
  assert.equal(confirmed, false);
  assert.deepEqual(sent, { status: 200, body: { workItem: item, replayed: true } });
});

test("a pending execution start can be cancelled through its dedicated route", async () => {
  let received;
  let sent;
  const handled = await handleWorkItemRoutes({
    req: { method: "POST" },
    res: {},
    url: new URL("http://localhost/api/work-items/lwi_1/execution-start/cancel"),
    readJson: async () => ({ expectedRevision: 7 }),
    sendJson: (_res, status, body) => { sent = { status, body }; },
    actor,
    cancelExecutionStart: (input, requestActor) => {
      received = { input, requestActor };
      return { ok: true, status: 200, body: { workItem: preparedItem({ revision: 8 }), replayed: false } };
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(received, {
    input: { workItemId: "lwi_1", expectedRevision: 7 },
    requestActor: actor,
  });
  assert.equal(sent.status, 200);
});

test("a blocked execution start can request an immediate scheduler recheck", async () => {
  let received;
  let sent;
  const handled = await handleWorkItemRoutes({
    req: { method: "POST" },
    res: {},
    url: new URL("http://localhost/api/work-items/lwi_1/execution-start/recheck"),
    readJson: async () => ({ expectedRevision: 9 }),
    sendJson: (_res, status, body) => { sent = { status, body }; },
    actor,
    recheckExecutionStart: (input, requestActor) => {
      received = { input, requestActor };
      return { ok: true, status: 200, body: { workItem: preparedItem({ revision: 10 }), replayed: false } };
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(received, {
    input: { workItemId: "lwi_1", expectedRevision: 9 },
    requestActor: actor,
  });
  assert.equal(sent.status, 200);
});
