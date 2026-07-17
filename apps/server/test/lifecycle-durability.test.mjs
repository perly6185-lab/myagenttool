/*
 * #968 — a lifecycle-action transition commits durably through the Store's unit
 * of work. Crash model: the store commits via a real persistStateNow while
 * persistStateSoon (the fallback debounce) is a no-op. Before #968 these
 * transitions (queue/start/complete) ended with persistStateSoon only, so a crash
 * in the window lost the transition + its failure/rollback evidence; here the
 * completed action survives a reload from disk WITHOUT an explicit save.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createInMemoryStore } from "../src/runtime/store/in-memory-store.mjs";
import { createM3Service } from "../src/services/m3.mjs";

const now = () => "2026-07-14T00:00:00.000Z";

function withTmp(fn) {
  const root = join(tmpdir(), `myagenttool-lifecycle-durability-${Date.now()}-${Math.floor(process.hrtime()[1] % 1e6)}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  try { return fn({ projectPath, stateStorePath }); } finally { rmSync(root, { recursive: true, force: true }); }
}

function m3With(state, { store } = {}) {
  let id = 0;
  return createM3Service({
    state, now,
    nextId: (p) => `${p}_${++id}`,
    appendEvent: () => {},
    findAgent: (agentId) => state.agents.find((a) => a.id === agentId) ?? null,
    persistStateSoon: () => {}, // the eaten debounce
    store,
  });
}

function seedFailedLifecycle(state, m3) {
  const catalog = m3.createPrivateCatalogEntry({ packageName: "demo-agent", version: "1.2.3" });
  m3.createSignedBundleManifest({ catalogEntryId: catalog.id, packageName: "demo-agent", version: "1.2.3", signatureStatus: "not_required" });
  const recipe = m3.createLifecycleRecipe({
    action: "update", name: "Durable update", catalogEntryId: catalog.id,
    source: { type: "manual_entry", uri: "manual://demo-agent", author: "t", version: "1.2.3", signatureStatus: "not_required" },
    supportedPlatforms: [state.device.platform], expectedBinary: "demo-agent",
    rollback: { available: true, strategy: "previous_version", summary: "Restore 1.2.2." },
    command: { summary: "Update.", commandId: "demo_agent_update", executable: "demo-agent", args: ["--self-check-update"], shell: false },
  });
  m3.transitionLifecycleRecipe(recipe, "approve");
  const queued = m3.queueLifecycleAction(recipe);
  m3.markLifecycleActionStarted(queued);
  m3.completeLifecycleAction(queued, { status: "failed", summary: "Bridge update failed.", exitCode: 42, rollbackAvailable: true });
  return queued;
}

test("#968 a completed lifecycle action + rollback survive a crash via the Store (no explicit save)", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const first = createServerState({ defaultProjectPath: projectPath, now });
    const persistence = createPersistenceRuntime({
      state: first.state, enabled: true, stateStorePath, schemaVersion: 1, now,
      defaultProject: first.defaultProject, sameProjectPath: () => false,
    });
    const store = createInMemoryStore({ state: first.state, commit: () => persistence.persistStateNow() });
    const m3 = m3With(first.state, { store });
    const queued = seedFailedLifecycle(first.state, m3);

    // Crash + reload straight from disk — the store committed synchronously, no
    // explicit save() and the debounce was a no-op.
    const second = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({
      state: second.state, enabled: true, stateStorePath, schemaVersion: 1, now,
      defaultProject: second.defaultProject, sameProjectPath: () => false,
    }).restorePersistentState();

    const audit = second.state.lifecycleAuditRecords.find((r) => r.id === queued.id);
    assert.equal(audit?.status, "failed", "the completed transition is durable");
    assert.equal(audit?.result?.exitCode, 42);
    const action = second.state.lifecycleQueuedActions.find((a) => a.id === queued.id);
    assert.equal(action?.status, "failed");
    assert(second.state.lifecycleRollbackRequests.some((r) => r.failedActionId === queued.id), "the rollback request is durable");
  });
});

test("#968 without a Store the same transition is lost when the debounce is a no-op (bite)", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const first = createServerState({ defaultProjectPath: projectPath, now });
    // NO store → runTx falls back to persistStateSoon, which is a no-op here.
    const m3 = m3With(first.state, { store: undefined });
    // Write the snapshot ONCE up front so the file exists, then run the lifecycle
    // (whose transitions would only persist via the eaten debounce).
    createPersistenceRuntime({
      state: first.state, enabled: true, stateStorePath, schemaVersion: 1, now,
      defaultProject: first.defaultProject, sameProjectPath: () => false,
    }).savePersistentState();
    const queued = seedFailedLifecycle(first.state, m3);

    const second = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({
      state: second.state, enabled: true, stateStorePath, schemaVersion: 1, now,
      defaultProject: second.defaultProject, sameProjectPath: () => false,
    }).restorePersistentState();

    assert.equal(second.state.lifecycleQueuedActions.find((a) => a.id === queued.id), undefined, "without the store the transition was not durable");
  });
});
