/*
 * #1001 (Phase A) — agent registration + health writes commit through the Store's
 * unit of work. Crash model: the store commits via persistStateNow while
 * persistStateSoon (the fallback debounce) is a no-op — so a row on disk after the
 * call proves the store transaction fired, not the eaten debounce.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createInMemoryStore } from "../src/runtime/store/in-memory-store.mjs";
import { createAgentService } from "../src/services/agents.mjs";

const now = () => "2026-07-14T00:00:00.000Z";

function withTmp(fn) {
  const root = join(tmpdir(), `myagenttool-agents-durability-${Date.now()}-${Math.floor(process.hrtime()[1] % 1e6)}`);
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
  const agents = createAgentService({
    state, now, nextId: (p) => `${p}_${++n}`, appendEvent: () => {},
    persistStateSoon: () => {}, // the eaten debounce
    store,
  });
  const reload = () => {
    const fresh = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({ state: fresh.state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject: fresh.defaultProject, sameProjectPath: () => false }).restorePersistentState();
    return fresh.state;
  };
  return { state, agents, reload };
}

test("#1001 a registered agent survives a crash via the Store (debounce disabled)", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const rt = runtime(projectPath, stateStorePath);
    const agent = rt.agents.registerAgent({ type: "cli", command: "node", args: ["--version"], name: "Durable CLI" });

    const restored = rt.reload();
    const found = restored.agents.find((a) => a.id === agent.id);
    assert(found, "the registered agent is durable (pre-#1001 this used only the debounce)");
    assert.equal(found.name, agent.name);
  });
});

test("#1001 a health-check result survives a crash via the Store", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const rt = runtime(projectPath, stateStorePath);
    const agent = rt.agents.registerAgent({ type: "cli", command: "node", args: ["--version"], name: "HC" });
    const op = rt.agents.createAgentHealthCheck(agent);
    rt.agents.completeHealthCheck(op, { status: "healthy", message: "ok" });

    const restored = rt.reload();
    const found = restored.agents.find((a) => a.id === agent.id);
    assert.equal(found.health.status, "healthy", "the health result is durable");
    assert(restored.healthChecks.some((h) => h.id === op.id), "the health-check record is durable");
  });
});
