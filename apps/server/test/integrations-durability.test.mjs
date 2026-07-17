/*
 * #1001 (Phase A #5b) — the integrations/* services' durable writes commit through
 * the Store. Crash model: persistStateNow commits, persistStateSoon is a no-op.
 * Representative coverage (discovery run); the sweep across discovery/artifacts/
 * probes/governance/registration is the value.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createInMemoryStore } from "../src/runtime/store/in-memory-store.mjs";
import { createDiscoveryRuntime } from "../src/services/integrations/discovery.mjs";

const now = () => "2026-07-14T00:00:00.000Z";

function makeDiscovery({ persistStateSoon, store }) {
  const root = join(tmpdir(), `myagenttool-integrations-durability-${Date.now()}-${Math.round(Math.random() * 1e9)}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now });
  // A linked+online bridge queues (rather than fails) the discovery run.
  state.device.status = "online";
  state.device.unlinkState = "linked";
  const persistence = createPersistenceRuntime({ state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject, sameProjectPath: () => false });
  let counter = 0;
  const discovery = createDiscoveryRuntime({
    state,
    now,
    nextId: (prefix) => `${prefix}_${++counter}`,
    appendEvent: () => {},
    disableAgent: () => {},
    registerAgent: (agent) => agent,
    persistStateSoon,
    store: store === undefined ? undefined : createInMemoryStore({ state, commit: () => persistence.persistStateNow() }),
  });
  const reload = () => {
    const fresh = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({ state: fresh.state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject: fresh.defaultProject, sameProjectPath: () => false }).restorePersistentState();
    return fresh.state;
  };
  return { discovery, reload, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("#1001 a discovery run survives a crash via the Store", () => {
  const { discovery, reload, cleanup } = makeDiscovery({ persistStateSoon: () => {}, store: true });
  try {
    const run = discovery.createDiscoveryRun({ requestedBy: "usr_local" });
    const restored = reload();
    const row = (restored.discoveryRuns ?? []).find((r) => r.id === run.id);
    assert(row, "the discovery run is durable via the Store");
    assert.equal(row.status, "queued");
  } finally {
    cleanup();
  }
});

test("#1001 the durability test bites — without the Store the eaten debounce loses the write", () => {
  const { discovery, reload, cleanup } = makeDiscovery({ persistStateSoon: () => {}, store: undefined });
  try {
    const run = discovery.createDiscoveryRun({ requestedBy: "usr_local" });
    const restored = reload();
    const row = (restored.discoveryRuns ?? []).find((r) => r.id === run.id);
    assert(!row, "without the Store the write is lost when persistStateSoon is a no-op");
  } finally {
    cleanup();
  }
});
