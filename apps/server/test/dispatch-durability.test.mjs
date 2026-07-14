/*
 * #968 (W2) — the dispatch claim/lease is durable through the Store's unit of work.
 *
 * Same crash model as invocation-durability: persistStateSoon is a no-op (the
 * eaten debounce), persistStateNow is the real flush, and the dispatch runtime
 * commits through a store bound to persistStateNow. Before #968 the claim persisted
 * only via the appendEvent debounce, so a crash lost the lease + attempt increment
 * (W2); here the claim survives a reload from disk.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createInMemoryStore } from "../src/runtime/store/in-memory-store.mjs";
import { createInvocationDispatchRuntime } from "../src/services/invocations/dispatch.mjs";

const now = () => "2026-07-14T00:00:00.000Z";

const agent = { id: "agt_1", name: "Coder", adapter: { type: "cli" }, location: { type: "local_device", deviceId: "dev_1" } };

function withTmp(fn) {
  const root = join(tmpdir(), `myagenttool-dispatch-durability-${Date.now()}-${Math.floor(process.hrtime()[1] % 1e6)}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  try {
    return fn({ projectPath, stateStorePath });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runtime(projectPath, stateStorePath) {
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now });
  state.device.id = "dev_1";
  const persistence = createPersistenceRuntime({
    state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject, sameProjectPath: () => false,
  });
  const store = createInMemoryStore({ state, commit: () => persistence.persistStateNow() });
  const dispatch = createInvocationDispatchRuntime({
    state, now,
    appendEvent: (e) => state.events.unshift({ id: `evt_${state.events.length}`, ...e }),
    dispatchLeaseMs: 30_000,
    findAgent: () => agent,
    completeInvocation: () => {},
    store,
  });
  const reload = () => {
    const fresh = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({
      state: fresh.state, enabled: true, stateStorePath, schemaVersion: 1, now,
      defaultProject: fresh.defaultProject, sameProjectPath: () => false,
    }).restorePersistentState();
    return fresh.state;
  };
  return { state, dispatch, reload };
}

function queuedInvocation() {
  return {
    id: "inv_1", agentId: "agt_1", status: "queued",
    delivery: { state: "queued", deviceId: null, dispatchAttempts: 0, lastDispatchAt: null, leaseExpiresAt: null, acknowledgedAt: null, bridgeCursor: null },
    options: { metadata: {} }, input: { task: "t" }, createdAt: now(), updatedAt: now(),
  };
}

test("#968 the dispatch claim + lease survive a crash (debounce disabled)", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const rt = runtime(projectPath, stateStorePath);
    rt.state.invocations.push(queuedInvocation());

    rt.dispatch.markDispatched(rt.state.invocations[0]);

    const restored = rt.reload();
    const inv = restored.invocations.find((i) => i.id === "inv_1");
    assert.equal(inv.status, "dispatching", "the claim is durable");
    assert.equal(inv.delivery.dispatchAttempts, 1, "the attempt increment is durable");
    assert(inv.delivery.leaseExpiresAt, "the lease is durable (pre-#968 it was debounce-only → lost)");
    assert.equal(inv.delivery.deviceId, "dev_1");
  });
});

test("#968 the acknowledge (lease cleared → running) survives a crash", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const rt = runtime(projectPath, stateStorePath);
    const inv = queuedInvocation();
    rt.state.invocations.push(inv);
    rt.dispatch.markDispatched(inv);
    rt.dispatch.acknowledgeInvocation(inv);

    const restored = rt.reload();
    const got = restored.invocations.find((i) => i.id === "inv_1");
    assert.equal(got.status, "running", "the ack (running) is durable");
    assert.equal(got.delivery.state, "acknowledged");
    assert.equal(got.delivery.leaseExpiresAt, null, "the lease was cleared durably");
  });
});
