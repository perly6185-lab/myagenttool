import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const now = () => new Date().toISOString();

let server;
let base;
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
    stateStorePath: "/tmp/unused.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });

  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test("bridge registration issues a device-bound credential and protects bridge routes", async () => {
  const registered = await call("/api/bridge/register", { method: "POST", body: { bridgeVersion: "test" } });
  assert.equal(registered.status, 200);
  assert.equal(typeof registered.body.bridgeToken, "string");
  assert(registered.body.bridgeToken.length > 20);
  assert.equal(registered.body.device.bridgeCredential.tokenHash, undefined);
  assert.equal(registered.body.bridgeCredential.tokenHash, undefined);
  assert.equal(typeof state.device.bridgeCredential.tokenHash, "string");

  const unauthenticatedPoll = await call("/api/bridge/next");
  assert.equal(unauthenticatedPoll.status, 401);
  assert.equal(unauthenticatedPoll.body.error, "invalid_bridge_credentials");

  const invalidPoll = await call("/api/bridge/next", { token: "wrong-token" });
  assert.equal(invalidPoll.status, 401);
  assert.equal(invalidPoll.body.error, "invalid_bridge_credentials");

  const validPoll = await call("/api/bridge/next", { token: registered.body.bridgeToken });
  assert.equal(validPoll.status, 204);

  const registerWithoutBearer = await call("/api/bridge/register", { method: "POST", body: { bridgeVersion: "again" } });
  assert.equal(registerWithoutBearer.status, 401);

  const unlink = await call("/api/device/unlink", { method: "POST" });
  assert.equal(unlink.status, 200);
  const revokedPoll = await call("/api/bridge/next", { token: registered.body.bridgeToken });
  assert.equal(revokedPoll.status, 403);
  assert.equal(revokedPoll.body.error, "device_credentials_revoked");
});

async function call(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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
