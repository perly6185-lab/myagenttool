import assert from "node:assert/strict";
import { test } from "node:test";

import { handleWorkItemRoutes } from "../src/routes/work-items.mjs";

const actor = { userId: "usr_a", teamId: "team_a", role: "operator" };

test("work-item reads reconcile record freshness before returning the task", async () => {
  const calls = [];
  let sent;
  const handled = await handleWorkItemRoutes({
    req: { method: "GET" },
    res: {},
    url: new URL("http://localhost/api/work-items/lwi%201"),
    sendJson: (_res, status, body) => { sent = { status, body }; },
    actor,
    reconcileWorkItemRecordBindings: async (input, requestActor) => {
      calls.push({ type: "reconcile", input, requestActor });
      return { status: 200, body: { changed: true, currentRevision: 2 } };
    },
    getWorkItem: (input, requestActor) => {
      calls.push({ type: "get", input, requestActor });
      return { status: 200, body: { workItem: { id: input.workItemId, revision: 2 } } };
    },
  });
  assert.equal(handled, true);
  assert.deepEqual(calls.map((call) => call.type), ["reconcile", "get"]);
  assert.deepEqual(calls[0].input, { workItemId: "lwi 1" });
  assert.deepEqual(sent, { status: 200, body: { workItem: { id: "lwi 1", revision: 2 } } });
});

test("managed record refresh route forwards the revision and decoded binding identity", async () => {
  let received;
  let sent;
  const handled = await handleWorkItemRoutes({
    req: { method: "POST" },
    res: {},
    url: new URL("http://localhost/api/work-items/lwi%201/record-bindings/binding%201/refresh"),
    readJson: async () => ({ expectedRevision: 4 }),
    sendJson: (_res, status, body) => { sent = { status, body }; },
    actor,
    refreshWorkItemRecordBinding: async (input, requestActor) => {
      received = { input, requestActor };
      return { status: 200, body: { workItem: { id: "lwi 1", revision: 5 } } };
    },
  });
  assert.equal(handled, true);
  assert.deepEqual(received, {
    input: { workItemId: "lwi 1", bindingId: "binding 1", expectedRevision: 4 },
    requestActor: actor,
  });
  assert.deepEqual(sent, { status: 200, body: { workItem: { id: "lwi 1", revision: 5 } } });
});

test("task context route forwards bounded user corrections to the managed service", async () => {
  const body = {
    expectedRevision: 4,
    deliveryDestination: "task",
    materialRoles: [{ id: "wrr 1", role: "change_target" }],
  };
  let received;
  let sent;
  const handled = await handleWorkItemRoutes({
    req: { method: "PATCH" },
    res: {},
    url: new URL("http://localhost/api/work-items/lwi%201/task-context"),
    readJson: async () => body,
    sendJson: (_res, status, responseBody) => { sent = { status, body: responseBody }; },
    actor,
    updateTaskContext: (input, requestActor) => {
      received = { input, requestActor };
      return { status: 200, body: { workItem: { id: input.workItemId, revision: 5 } } };
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(received, { input: { workItemId: "lwi 1", ...body }, requestActor: actor });
  assert.deepEqual(sent, { status: 200, body: { workItem: { id: "lwi 1", revision: 5 } } });
});

test("attention reads reconcile visible record bindings before listing the queue", async () => {
  const calls = [];
  let sent;
  const handled = await handleWorkItemRoutes({
    req: { method: "GET" },
    res: {},
    url: new URL("http://localhost/api/work-items/attention?projectId=prj_a&kind=record_binding_stale"),
    sendJson: (_res, status, body) => { sent = { status, body }; },
    actor,
    reconcileVisibleWorkItemRecordBindings: async (input, requestActor) => {
      calls.push({ type: "reconcile", input, requestActor });
      return { status: 200, body: { checked: 2, changed: 1 } };
    },
    listAttention: (input, requestActor) => {
      calls.push({ type: "list", input, requestActor });
      return { status: 200, body: { items: [{ id: "record_binding_stale:lwi_1" }] } };
    },
  });
  assert.equal(handled, true);
  assert.deepEqual(calls.map((call) => call.type), ["reconcile", "list"]);
  assert.deepEqual(calls[0], {
    type: "reconcile",
    input: { projectId: "prj_a" },
    requestActor: actor,
  });
  assert.equal(calls[1].input.kind, "record_binding_stale");
  assert.deepEqual(sent, {
    status: 200,
    body: { items: [{ id: "record_binding_stale:lwi_1" }] },
  });
});

test("batch record refresh route forwards all task revisions and bindings", async () => {
  const body = {
    items: [
      { id: "lwi_1", expectedRevision: 2, bindingIds: ["binding_a"] },
      { id: "lwi_2", expectedRevision: 5, bindingIds: ["binding_b", "binding_c"] },
    ],
  };
  let received;
  let sent;
  const handled = await handleWorkItemRoutes({
    req: { method: "POST" },
    res: {},
    url: new URL("http://localhost/api/work-items/record-bindings/refresh"),
    readJson: async () => body,
    sendJson: (_res, status, responseBody) => { sent = { status, body: responseBody }; },
    actor,
    refreshWorkItemRecordBindingsBatch: async (input, requestActor) => {
      received = { input, requestActor };
      return { status: 200, body: { refreshedCount: 2 } };
    },
  });
  assert.equal(handled, true);
  assert.deepEqual(received, { input: body, requestActor: actor });
  assert.deepEqual(sent, { status: 200, body: { refreshedCount: 2 } });
});

test("application execution fails closed when reconciliation finds stale input records", async () => {
  let started = false;
  let sent;
  const handled = await handleWorkItemRoutes({
    req: { method: "POST" },
    res: {},
    url: new URL("http://localhost/api/work-items/lwi_1/application-invocations"),
    readJson: async () => ({ expectedRevision: 7 }),
    sendJson: (_res, status, body) => { sent = { status, body }; },
    actor,
    reconcileWorkItemRecordBindings: async () => ({
      status: 200,
      body: {
        executionBlocked: true,
        currentRevision: 8,
        blockingBindings: [{ bindingId: "binding_customer", state: "stale" }],
      },
    }),
    startApplicationExecution: () => {
      started = true;
      return { status: 201, body: {} };
    },
  });
  assert.equal(handled, true);
  assert.equal(started, false);
  assert.deepEqual(sent, {
    status: 409,
    body: {
      error: "work_item_record_bindings_stale",
      currentRevision: 8,
      blockingBindings: [{ bindingId: "binding_customer", state: "stale" }],
    },
  });
});
