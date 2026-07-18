/**
 * #1302 long-poll — GET /api/bridge/cancellations?wait=1 holds until this
 * device is notified (or a max-wait timeout), then returns the cancel-requested
 * set. Isolated server harness; we drive the signal + state directly (the notify
 * hook itself is covered by cancellation-notify.test.mjs).
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const now = () => new Date().toISOString();

let server;
let base;
let token;
let state;
let cancellationSignal;

before(async () => {
  const { createServerState } = await import("../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../src/runtime/http-server.mjs");

  const created = createServerState({ defaultProjectPath: process.cwd(), now });
  state = created.state;
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProject: created.defaultProject,
    defaultProjectPath: process.cwd(),
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused-longpoll.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  cancellationSignal = httpDependencies.cancellationSignal;
  assert.ok(cancellationSignal, "the composer exposes the shared cancellation signal");
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const registered = await call("/api/bridge/register", { method: "POST", body: { bridgeVersion: "test" } });
  token = registered.body.bridgeToken;
});

after(() => server?.close());

function pushRunning(id, { cancelState = "none" } = {}) {
  state.invocations.push({
    id,
    status: cancelState === "requested" ? "cancelling" : "running",
    delivery: { deviceId: state.device.id, state: "acknowledged" },
    cancellation: { state: cancelState },
  });
}

test("?wait=1 returns immediately when something is already cancel-requested", async () => {
  state.invocations.length = 0;
  pushRunning("inv_now", { cancelState: "requested" });
  const t0 = Date.now();
  const res = await call("/api/bridge/cancellations?wait=1", { token });
  assert.ok(Date.now() - t0 < 500, "did not park — there was already work");
  assert.deepEqual(res.body.invocationIds, ["inv_now"]);
});

test("?wait=1 parks until the device is notified, then returns the newly-cancelled id", async () => {
  state.invocations.length = 0;
  pushRunning("inv_wait", { cancelState: "none" });

  const t0 = Date.now();
  const pending = call("/api/bridge/cancellations?wait=1", { token });

  // Simulate cancelInvocation: flip the state, then notify the device.
  await new Promise((r) => setTimeout(r, 60));
  const inv = state.invocations.find((i) => i.id === "inv_wait");
  inv.status = "cancelling";
  inv.cancellation.state = "requested";
  cancellationSignal.notify(state.device.id);

  const res = await pending;
  assert.ok(Date.now() - t0 >= 50, "the poll actually parked before waking");
  assert.deepEqual(res.body.invocationIds, ["inv_wait"]);
});

test("without wait, the endpoint still returns immediately (back-compat)", async () => {
  state.invocations.length = 0;
  pushRunning("inv_x", { cancelState: "none" });
  const res = await call("/api/bridge/cancellations", { token });
  assert.deepEqual(res.body.invocationIds, []);
});

async function call(path, { method = "GET", body, token: authToken } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}
