/**
 * #1272 — the bridge refreshes its invocation cap from the readiness response,
 * so the server contract it depends on must hold: POST /api/bridge/readiness
 * echoes the device's CURRENT maxConcurrency, and a live PATCH /api/device
 * change is reflected on the next readiness call. Isolated server harness.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const now = () => new Date().toISOString();

let server;
let base;
let token;

before(async () => {
  const { createServerState } = await import("../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../src/runtime/http-server.mjs");

  const created = createServerState({ defaultProjectPath: process.cwd(), now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state: created.state,
    defaultProject: created.defaultProject,
    defaultProjectPath: process.cwd(),
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused-cap.json",
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

test("the readiness response echoes the current maxConcurrency", async () => {
  const readiness = await call("/api/bridge/readiness", { method: "POST", token, body: {} });
  assert.equal(readiness.status, 200);
  assert.equal(typeof readiness.body.device.maxConcurrency, "number");
  assert.ok(readiness.body.device.maxConcurrency >= 1);
});

test("a live PATCH /api/device maxConcurrency is reflected on the next readiness call", async () => {
  const patched = await call("/api/device", { method: "PATCH", body: { maxConcurrency: 7 } });
  assert.equal(patched.status, 200);

  const readiness = await call("/api/bridge/readiness", { method: "POST", token, body: {} });
  assert.equal(readiness.body.device.maxConcurrency, 7, "the bridge would adopt 7 on its next readiness refresh");
});

test("the server clamps maxConcurrency, and readiness reflects the clamped value", async () => {
  await call("/api/device", { method: "PATCH", body: { maxConcurrency: 999 } });
  const readiness = await call("/api/bridge/readiness", { method: "POST", token, body: {} });
  assert.equal(readiness.body.device.maxConcurrency, 16, "clamped to the [1,16] ceiling");
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
