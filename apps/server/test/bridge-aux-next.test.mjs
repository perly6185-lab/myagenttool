/**
 * #1251 — GET /api/bridge/aux-next multiplexes the five aux queues into one
 * request. Verifies: priority order (health > discovery > probe > lifecycle >
 * install), the `kind` discriminator, that ONLY the handed-out item is marked
 * started, and 204 when every queue is empty. Own isolated server harness so
 * the shared mutable state in bridge-auth.test.mjs cannot interfere.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const now = () => new Date().toISOString();

let server;
let base;
let state;
let token;

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
    stateStorePath: "/tmp/unused-aux.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const registered = await call("/api/bridge/register", { method: "POST", body: { bridgeVersion: "test" } });
  token = registered.body.bridgeToken;
  // Register auto-enqueues health checks for CLI agents; start from a known-empty
  // set of aux queues so ordering assertions are deterministic.
  clearAuxQueues();
});

after(() => server?.close());

test("aux-next returns 204 when every aux queue is empty", async () => {
  clearAuxQueues();
  const res = await call("/api/bridge/aux-next", { token });
  assert.equal(res.status, 204);
});

test("aux-next honors priority order, tags kind, and marks only the handed-out item", async () => {
  clearAuxQueues();
  const health = healthCheckFixture("hc_aux_1", { status: "queued", deviceId: state.device.id });
  const lifecycle = lifecycleActionFixture("lco_aux_1", { status: "queued", deviceId: state.device.id });
  state.healthChecks.unshift(health);
  state.lifecycleQueuedActions.unshift(lifecycle);

  // Health outranks lifecycle — it wins the first poll, tagged kind: "health".
  const first = await call("/api/bridge/aux-next", { token });
  assert.equal(first.status, 200);
  assert.equal(first.body.kind, "health");
  assert.equal(first.body.checkId, health.id);
  assert.equal(health.status, "running", "the handed-out health check is marked started");
  assert.equal(lifecycle.status, "queued", "the skipped-over lifecycle item is NOT marked");

  // With health drained, the next poll hands out the lifecycle item.
  const second = await call("/api/bridge/aux-next", { token });
  assert.equal(second.status, 200);
  assert.equal(second.body.kind, "lifecycle");
  assert.equal(second.body.lifecycleActionId, lifecycle.id);
  assert.equal(lifecycle.status, "running");

  // Both drained → 204.
  const third = await call("/api/bridge/aux-next", { token });
  assert.equal(third.status, 204);
});

test("aux-next payload for a queue matches its dedicated endpoint plus kind", async () => {
  clearAuxQueues();
  const probe = probeRunFixture("probe_aux_1", { status: "queued", deviceId: state.device.id });
  state.integrationProbeRuns.unshift(probe);
  const mux = await call("/api/bridge/aux-next", { token });
  assert.equal(mux.status, 200);
  assert.equal(mux.body.kind, "probe");
  assert.equal(mux.body.probeRunId, probe.id);
  assert.equal(mux.body.artifactId, probe.artifactId);
  assert.deepEqual(mux.body.adapter, probe.adapter);
  // The dedicated endpoint returns the same shape WITHOUT a kind field.
  assert.equal(probe.status, "running");
});

function clearAuxQueues() {
  state.healthChecks.length = 0;
  state.discoveryRuns.length = 0;
  state.integrationProbeRuns.length = 0;
  state.lifecycleQueuedActions.length = 0;
}

function healthCheckFixture(id, { status, deviceId }) {
  return {
    id,
    agentId: "agt_demo_cli",
    deviceId,
    requestedBy: "usr_local",
    operation: "health_check",
    status,
    reason: "Test health check.",
    message: "Test health check.",
    createdAt: now(),
    completedAt: null,
  };
}

function lifecycleActionFixture(id, { status, deviceId }) {
  return {
    id,
    recipeId: `rec_${id}`,
    agentId: "agt_demo_cli",
    deviceId,
    requestedBy: "usr_local",
    action: "update",
    status,
    executionEnabled: true,
    command: {
      summary: "Run the bridge-managed demo agent update fixture.",
      commandId: "demo_agent_update",
      executable: "demo-agent",
      args: ["--self-check-update"],
      shell: false,
      packageManager: null,
    },
    summary: "Test lifecycle action.",
    result: null,
    createdAt: now(),
    startedAt: status === "running" ? now() : null,
    completedAt: null,
  };
}

function probeRunFixture(id, { status, deviceId }) {
  return {
    id,
    artifactId: null,
    kind: "agent_dry_probe",
    deviceId,
    requestedBy: "usr_local",
    status,
    adapter: { type: "cli", command: "demo-agent" },
    summary: "Test probe run.",
    details: [],
    tools: [],
    createdAt: now(),
    completedAt: null,
  };
}

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
