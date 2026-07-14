/*
 * #1001 (Phase A) — m3's economics writes commit through the Store's unit of work.
 * Crash model: the store commits via persistStateNow while persistStateSoon (the
 * fallback debounce) is a no-op — a record on disk after the call proves the store
 * transaction fired.
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
  const root = join(tmpdir(), `myagenttool-m3-durability-${Date.now()}-${Math.floor(process.hrtime()[1] % 1e6)}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  try { return fn({ projectPath, stateStorePath }); } finally { rmSync(root, { recursive: true, force: true }); }
}

function runtime(projectPath, stateStorePath) {
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now });
  let n = 0;
  const persistence = createPersistenceRuntime({ state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject, sameProjectPath: () => false });
  const store = createInMemoryStore({ state, commit: () => persistence.persistStateNow() });
  const m3 = createM3Service({
    state, now, nextId: (p) => `${p}_${++n}`, appendEvent: () => {}, findAgent: () => null,
    persistStateSoon: () => {}, // the eaten debounce
    store,
  });
  const reload = () => {
    const fresh = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({ state: fresh.state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject: fresh.defaultProject, sameProjectPath: () => false }).restorePersistentState();
    return fresh.state;
  };
  return { state, m3, reload, projectId: defaultProject.id };
}

test("#1001 upsertBudget survives a crash via the Store", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const rt = runtime(projectPath, stateStorePath);
    rt.m3.upsertBudget({ projectId: rt.projectId, limitUsd: 25, policy: "block" });

    const restored = rt.reload();
    const budget = restored.budgets.find((b) => b.projectId === rt.projectId);
    assert(budget, "the budget is durable via the Store");
    assert.equal(Number(budget.limitUsd), 25);
    assert.equal(budget.policy, "block");
  });
});

test("#1001 a budget reservation survives a crash via the Store", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const rt = runtime(projectPath, stateStorePath);
    rt.m3.upsertBudget({ projectId: rt.projectId, limitUsd: 100, policy: "block" });
    const held = rt.m3.reserveBudget({ projectId: rt.projectId, amountUsd: 7, autoRunId: "aur_1" });
    assert.equal(held.ok, true);

    const restored = rt.reload();
    assert(restored.budgetReservations.some((r) => r.id === held.reservationId && r.status === "active"), "the reservation is durable");
  });
});

test("#1001 a private catalog entry survives a crash via the Store", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const rt = runtime(projectPath, stateStorePath);
    const entry = rt.m3.createPrivateCatalogEntry({ packageName: "demo-agent", version: "1.2.3" });

    const restored = rt.reload();
    assert(restored.privateCatalogEntries.some((e) => e.id === entry.id), "the catalog entry is durable");
  });
});
