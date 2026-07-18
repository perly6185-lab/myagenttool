/**
 * #1251 — GET /api/bridge/cancellations returns exactly this device's
 * acknowledged, in-flight invocations whose cancellation was requested (the
 * device-wide multiplex that replaces per-run cancel-status polling). Isolated
 * server harness; invocations are pushed straight into state to exercise the
 * predicate across ownership / delivery-state / status / cancellation-state.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const now = () => new Date().toISOString();

let server;
let base;
let token;
let state;

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
    stateStorePath: "/tmp/unused-cancellations.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const registered = await call("/api/bridge/register", { method: "POST", body: { bridgeVersion: "test" } });
  token = registered.body.bridgeToken;
});

after(() => server?.close());

function pushInvocation(id, { deviceId, deliveryState, status, cancelState }) {
  state.invocations.push({
    id,
    status,
    delivery: { deviceId, state: deliveryState },
    cancellation: { state: cancelState },
  });
}

test("returns only owned + acknowledged + in-flight + cancel-requested invocations", async () => {
  const myDevice = state.device.id;
  // Should appear:
  pushInvocation("inv_yes_running", { deviceId: myDevice, deliveryState: "acknowledged", status: "running", cancelState: "requested" });
  pushInvocation("inv_yes_cancelling", { deviceId: myDevice, deliveryState: "acknowledged", status: "cancelling", cancelState: "requested" });
  // Should NOT appear:
  pushInvocation("inv_not_requested", { deviceId: myDevice, deliveryState: "acknowledged", status: "running", cancelState: "none" });
  pushInvocation("inv_other_device", { deviceId: "dev_other", deliveryState: "acknowledged", status: "running", cancelState: "requested" });
  pushInvocation("inv_not_acked", { deviceId: myDevice, deliveryState: "dispatching", status: "running", cancelState: "requested" });
  pushInvocation("inv_terminal", { deviceId: myDevice, deliveryState: "acknowledged", status: "succeeded", cancelState: "requested" });

  const res = await call("/api/bridge/cancellations", { token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.invocationIds.sort(), ["inv_yes_cancelling", "inv_yes_running"]);
});

test("empty set when nothing is cancel-requested", async () => {
  state.invocations.length = 0;
  pushInvocation("inv_a", { deviceId: state.device.id, deliveryState: "acknowledged", status: "running", cancelState: "none" });
  const res = await call("/api/bridge/cancellations", { token });
  assert.deepEqual(res.body.invocationIds, []);
});

test("requires bridge credentials", async () => {
  const res = await call("/api/bridge/cancellations", {}); // no token
  assert.equal(res.status, 401);
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
