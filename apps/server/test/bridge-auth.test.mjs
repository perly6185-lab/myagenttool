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

  const validTerminalPoll = await call("/api/bridge/terminal-next", { token: registered.body.bridgeToken });
  assert.equal(validTerminalPoll.status, 204);

  await assertBridgeCredentialRequired({ token: registered.body.bridgeToken });

  const registerWithoutBearer = await call("/api/bridge/register", { method: "POST", body: { bridgeVersion: "again" } });
  assert.equal(registerWithoutBearer.status, 401);

  const unlink = await call("/api/device/unlink", { method: "POST" });
  assert.equal(unlink.status, 200);
  const revokedPoll = await call("/api/bridge/next", { token: registered.body.bridgeToken });
  assert.equal(revokedPoll.status, 403);
  assert.equal(revokedPoll.body.error, "device_credentials_revoked");

  await assertBridgeCredentialRevoked({ token: registered.body.bridgeToken });
});

const protectedBridgeRoutes = [
  { method: "GET", path: "/api/bridge/next" },
  { method: "GET", path: "/api/bridge/health-next" },
  { method: "POST", path: "/api/bridge/health-complete", body: {} },
  { method: "GET", path: "/api/bridge/discovery-next" },
  { method: "POST", path: "/api/bridge/discovery-complete", body: {} },
  { method: "GET", path: "/api/bridge/probe-next" },
  { method: "POST", path: "/api/bridge/probe-complete", body: {} },
  { method: "GET", path: "/api/bridge/lifecycle-next" },
  { method: "POST", path: "/api/bridge/lifecycle-complete", body: {} },
  { method: "GET", path: "/api/bridge/cancel-status?invocationId=missing" },
  { method: "POST", path: "/api/bridge/ack", body: {} },
  { method: "POST", path: "/api/bridge/events", body: {} },
  { method: "POST", path: "/api/bridge/complete", body: {} },
  { method: "GET", path: "/api/bridge/terminal-next" },
  { method: "POST", path: "/api/bridge/terminal-events", body: {} },
];

async function assertBridgeCredentialRequired({ token }) {
  for (const route of protectedBridgeRoutes) {
    const missingCredential = await call(route.path, { method: route.method, body: route.body });
    assert.equal(missingCredential.status, 401, `${route.method} ${route.path} should reject missing bridge credentials`);
    assert.equal(missingCredential.body.error, "invalid_bridge_credentials");

    const invalidCredential = await call(route.path, { method: route.method, body: route.body, token: "wrong-token" });
    assert.equal(invalidCredential.status, 401, `${route.method} ${route.path} should reject invalid bridge credentials`);
    assert.equal(invalidCredential.body.error, "invalid_bridge_credentials");
  }

  const stillValid = await call("/api/bridge/next", { token });
  assert.equal(stillValid.status, 204);
}

async function assertBridgeCredentialRevoked({ token }) {
  for (const route of protectedBridgeRoutes) {
    const revoked = await call(route.path, { method: route.method, body: route.body, token });
    assert.equal(revoked.status, 403, `${route.method} ${route.path} should reject revoked bridge credentials`);
    assert.equal(revoked.body.error, "device_credentials_revoked");
  }
}

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

test("bridge credential idle-expires past the TTL and reissues on reconnect", async () => {
  const { createBridgeCredentialRuntime } = await import("../src/runtime/bridge-auth.mjs");
  let clockMs = Date.parse("2026-07-04T00:00:00.000Z");
  const nowFn = () => new Date(clockMs).toISOString();
  const st = { device: { id: "dev_1", unlinkState: "linked", credentialRevokedAt: null } };
  const rt = createBridgeCredentialRuntime({ state: st, now: nowFn, persistStateSoon: () => {}, credentialIdleTtlMs: 1000 });

  const { token } = rt.issueBridgeCredential();
  const verify = (t) => {
    let captured = null;
    const result = rt.requireBridgeCredential({
      req: { headers: { authorization: `Bearer ${t}` } },
      res: {},
      sendJson: (_res, status, body) => { captured = { status, body }; },
    });
    return { result, captured };
  };

  clockMs += 500; // within TTL → accepted, slides lastSeenAt to now
  assert.ok(verify(token).result, "a valid token within the idle TTL is accepted");

  clockMs += 2000; // 2s idle since last activity (500) → beyond the 1s TTL
  const expired = verify(token);
  assert.equal(expired.result, null);
  assert.equal(expired.captured.body.error, "bridge_credentials_expired");

  // Reconnect: issuing reissues a fresh token because the existing one idled out.
  const reissued = rt.issueBridgeCredential();
  assert.equal(reissued.issued, true);
  assert.equal(typeof reissued.token, "string");
  assert.notEqual(reissued.token, token);
});
