import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer as createHttpReceiver } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

// Bridge liveness & refusal (docs/design/BRIDGE_LIVENESS_AND_REFUSAL.md):
// stale-device offline flip (evented + alerted) with symmetric restore, the
// running watchdog scoped to a provably-dead bridge, the bounded redelivery
// (delivery_exhausted), and the pre-ack refusal verb.

const now = () => new Date().toISOString();

let server;
let base;
let state;
let deps;
let bridgeToken;
let appId;
let routineId;
let hookServer;
const receivedAlerts = [];

before(async () => {
  const { createServerState } = await import("../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../src/runtime/http-server.mjs");

  const projectDir = mkdtempSync(join(tmpdir(), "liveness-project-"));
  const appDir = mkdtempSync(join(tmpdir(), "liveness-app-"));
  writeFileSync(join(appDir, "package.json"), JSON.stringify({ name: "liveness-demo", version: "1.0.0" }));

  const created = createServerState({ defaultProjectPath: projectDir, now });
  state = created.state;
  ({ httpDependencies: deps } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProject: created.defaultProject,
    defaultProjectPath: projectDir,
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  }));
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...deps });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const registered = await call("/api/applications/register", {
    method: "POST",
    body: { source: { type: "local", path: appDir }, name: "liveness-demo" },
  });
  appId = registered.body.application.id;
  routineId = `app-${appId}-maintenance`;
  await call(`/api/applications/${appId}/orchestrations/generate`, {
    method: "POST",
    body: { approvalToken: "operator-approved" },
  });

  const bridge = await call("/api/bridge/register", { method: "POST", body: { bridgeVersion: "test" } });
  bridgeToken = bridge.body.bridgeToken;

  hookServer = createHttpReceiver((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        receivedAlerts.push(JSON.parse(body));
      } catch {
        /* ignore */
      }
      res.writeHead(200);
      res.end();
    });
  });
  await new Promise((resolve) => hookServer.listen(0, "127.0.0.1", resolve));
  state.autoRunSettings = { ...state.autoRunSettings, alertWebhookUrl: `http://127.0.0.1:${hookServer.address().port}/hook` };
});

after(() => {
  server?.close();
  hookServer?.close();
});

const startRun = async () => {
  const run = await call(`/api/applications/${appId}/orchestrations/${routineId}/run`, { method: "POST", body: {} });
  assert.equal(run.status, 201, JSON.stringify(run.body));
  return run.body.invocation.id;
};
const leaseNext = async (invocationId) => {
  for (let i = 0; i < 10; i += 1) {
    const next = await call("/api/bridge/next", { token: bridgeToken });
    if (next.status === 204 || next.body?.invocationId === invocationId) return next;
  }
  return null;
};
const invocation = (id) => state.invocations.find((i) => i.id === id);
const events = (type) => state.events.filter((e) => e.type === type);
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

async function waitForAlert(kind, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = receivedAlerts.find((alert) => alert.kind === kind);
    if (hit) return hit;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

test("a stale bridge flips the device offline (evented + alerted); the next authenticated request restores it", async () => {
  assert.equal(state.device.status, "online");
  state.device.lastSeenAt = minutesAgo(5); // bridge silent for 5m > 90s threshold
  deps.bridgeLivenessSweep();
  assert.equal(state.device.status, "offline");
  assert.ok(state.device.livenessLostAt);
  assert.equal(events("bridge_liveness_lost").length, 1);
  const alert = await waitForAlert("bridge_liveness_lost");
  assert.ok(alert, "operator alert pushed");

  // Any authenticated bridge request restores liveness symmetrically.
  const poll = await call("/api/bridge/next", { token: bridgeToken });
  assert.ok([200, 204].includes(poll.status));
  assert.equal(state.device.status, "online");
  assert.equal(state.device.livenessLostAt, null);
  assert.equal(events("bridge_liveness_restored").length, 1);
});

test("a fresh bridge is never flipped; the sweep is a no-op while lastSeenAt is recent", () => {
  state.device.lastSeenAt = now();
  deps.bridgeLivenessSweep();
  assert.equal(state.device.status, "online");
});

test("running watchdog reaps a run stranded on a dead bridge — and only past the grace", async () => {
  const invocationId = await startRun();
  await leaseNext(invocationId);
  await call("/api/bridge/ack", { method: "POST", body: { invocationId }, token: bridgeToken });
  assert.equal(invocation(invocationId).status, "running");

  // Bridge dies. Within the grace window the run is untouched.
  state.device.status = "offline";
  state.device.livenessLostAt = minutesAgo(1); // < max(2×30s, 5m) grace
  deps.bridgeLivenessSweep();
  assert.equal(invocation(invocationId).status, "running", "inside the grace window nothing is reaped");

  state.device.livenessLostAt = minutesAgo(6); // past the 5m grace
  deps.bridgeLivenessSweep();
  const reaped = invocation(invocationId);
  assert.equal(reaped.status, "timed_out");
  assert.equal(reaped.result.errorCode, "dispatch_timeout");
  assert.equal(events("delivery_reclaimed").length, 1);

  // Restore liveness for the following tests.
  await call("/api/bridge/next", { token: bridgeToken });
  assert.equal(state.device.status, "online");
});

test("a running run on a LIVE bridge is left alone while it is inside its runtime budget", async () => {
  const invocationId = await startRun();
  await leaseNext(invocationId);
  await call("/api/bridge/ack", { method: "POST", body: { invocationId }, token: bridgeToken });
  deps.bridgeLivenessSweep();
  assert.equal(invocation(invocationId).status, "running");
  await call("/api/bridge/complete", { method: "POST", body: { invocationId, status: "succeeded", result: { summary: "ok" } }, token: bridgeToken });
});

test("a LIVE bridge cannot keep a dead child invocation running past its hard deadline", async () => {
  const invocationId = await startRun();
  await leaseNext(invocationId);
  await call("/api/bridge/ack", { method: "POST", body: { invocationId }, token: bridgeToken });
  invocation(invocationId).options.timeoutSeconds = 30;
  invocation(invocationId).delivery.acknowledgedAt = minutesAgo(2);

  deps.bridgeLivenessSweep();
  assert.equal(invocation(invocationId).status, "cancelling");
  assert.equal(invocation(invocationId).cancellation.state, "requested");
  assert.ok(events("invocation_deadline_exceeded").some((event) => event.invocationId === invocationId));

  invocation(invocationId).deadlineEnforcement.requestedAt = minutesAgo(1);
  deps.bridgeLivenessSweep();
  assert.equal(invocation(invocationId).status, "timed_out");
  assert.equal(invocation(invocationId).result.errorCode, "execution_timeout");
  assert.equal(invocation(invocationId).result.timeoutKind, "server_hard_deadline");
  assert.ok(events("invocation_deadline_reclaimed").some((event) => event.invocationId === invocationId));
});

test("redelivery is bounded: after 5 leased-and-lapsed attempts the delivery is exhausted", async () => {
  const invocationId = await startRun();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const leased = await leaseNext(invocationId);
    assert.equal(leased.body?.invocationId, invocationId, `attempt ${attempt} leased`);
    assert.equal(invocation(invocationId).delivery.dispatchAttempts, attempt);
    invocation(invocationId).delivery.leaseExpiresAt = minutesAgo(1); // never acked; lease lapses
  }
  // The next poll first runs redelivery, sees attempts at the cap → exhausts.
  const after5 = await call("/api/bridge/next", { token: bridgeToken });
  assert.equal(after5.status, 204, "nothing re-leased — the delivery is terminal");
  const exhausted = invocation(invocationId);
  assert.equal(exhausted.status, "failed");
  assert.equal(exhausted.delivery.state, "exhausted");
  assert.equal(exhausted.result.errorCode, "dispatch_timeout");
  assert.equal(events("delivery_exhausted").length, 1);
});

test("the refusal verb: pre-ack only, honest reason + errorCode into recovery; unknown codes drop", async () => {
  const invocationId = await startRun();
  await leaseNext(invocationId);
  const refused = await call("/api/bridge/refuse", {
    method: "POST",
    body: { invocationId, reason: "agent binary not installed on this device", errorCode: "agent_unavailable" },
    token: bridgeToken,
  });
  assert.equal(refused.status, 200, JSON.stringify(refused.body));
  const refusedInvocation = invocation(invocationId);
  assert.equal(refusedInvocation.status, "failed");
  assert.equal(refusedInvocation.delivery.state, "refused");
  assert.equal(refusedInvocation.result.errorCode, "agent_unavailable");
  assert.ok(events("delivery_refused").some((e) => e.invocationId === invocationId));
  // The declared code steers the recovery model.
  const recovery = await call(`/api/applications/${appId}/orchestrations/${routineId}/runs/${invocationId}/recovery`);
  assert.equal(recovery.body.recovery.category, "agent_unavailable");

  // Refuse after ack → 409 (an acked run reports through complete).
  const acked = await startRun();
  await leaseNext(acked);
  await call("/api/bridge/ack", { method: "POST", body: { invocationId: acked }, token: bridgeToken });
  const late = await call("/api/bridge/refuse", { method: "POST", body: { invocationId: acked, reason: "too late" }, token: bridgeToken });
  assert.equal(late.status, 409);
  assert.equal(late.body.error, "bridge_invocation_not_active");
  await call("/api/bridge/complete", { method: "POST", body: { invocationId: acked, status: "succeeded", result: { summary: "ok" } }, token: bridgeToken });

  // Unknown errorCode is dropped, refusal still lands.
  const weird = await startRun();
  await leaseNext(weird);
  const weirdRefusal = await call("/api/bridge/refuse", {
    method: "POST",
    body: { invocationId: weird, reason: "no idea", errorCode: "flux_capacitor" },
    token: bridgeToken,
  });
  assert.equal(weirdRefusal.status, 200);
  assert.equal(invocation(weird).result.errorCode, undefined);
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
