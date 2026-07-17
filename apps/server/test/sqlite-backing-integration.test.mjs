/*
 * #1002 (Phase B, slice 3) — end-to-end: with a SQLite store wired into the real
 * service composer, a runtime write MIRRORS to SQLite and a fresh boot HYDRATES it
 * back. Proves the commit sink + seed/hydrate wiring, not just the unit logic.
 * Skips when node:sqlite is unavailable (CI-safe).
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createServerRuntimeServices } from "../src/runtime/service-composer.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createRetentionArchive } from "../src/services/retention-archive.mjs";

let openSqliteStore;
try {
  await import("node:sqlite");
  ({ openSqliteStore } = await import("../src/runtime/store/sqlite-store.mjs"));
} catch {
  openSqliteStore = null;
}
const skip = openSqliteStore ? false : "node:sqlite unavailable in this runtime";

const now = () => new Date().toISOString();

function boot({ projectPath, stateStorePath, sqliteStore }) {
  const seed = createServerState({ defaultProjectPath: projectPath, now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state: seed.state,
    defaultProject: seed.defaultProject,
    defaultProjectPath: projectPath,
    persistenceEnabled: true,
    stateStorePath,
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
    sqliteStore,
  });
  return { state: seed.state, api: httpDependencies };
}

test("a runtime write mirrors to SQLite and a fresh boot hydrates it back", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sqlite-integration-"));
  const projectPath = join(dir, "proj");
  const stateStorePath = join(dir, "state", "local.json");
  const sqlitePath = join(dir, "state", "local.sqlite");
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(join(dir, "state"), { recursive: true });
  try {
    // Boot 1: empty SQLite → seeds from the default state, then a runtime write.
    let store = await openSqliteStore({ path: sqlitePath });
    const b1 = boot({ projectPath, stateStorePath, sqliteStore: store });
    const created = b1.api.createAgentSkill({ name: "Integration Skill" });
    assert(created?.id, "the skill was created");
    // The create ran through runTx → the SQLite-mirroring commit.
    assert(store.query("agentSkills").some((s) => s.name === "Integration Skill"), "the write mirrored to SQLite");
    store.close();

    // Boot 2: reopen the same file → SQLite is authoritative → state hydrates.
    store = await openSqliteStore({ path: sqlitePath });
    const b2 = boot({ projectPath, stateStorePath, sqliteStore: store });
    assert(
      (b2.state.agentSkills ?? []).some((s) => s.name === "Integration Skill"),
      "the skill survived the restart via the SQLite backing",
    );
    // devices persist through their own JSON path, but the SQLite backing mirrors +
    // hydrates them too (else they'd be lost when JSON is retired), brought back offline.
    const dev = (b2.state.devices ?? []).find((d) => d.id === "dev_local_001");
    assert(dev, "the default device survived the restart via the SQLite backing");
    assert.equal(dev.status, "offline", "a hydrated device is offline until its bridge re-registers");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an invocation-event shard high-water wins over a stale SQLite id counter", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sqlite-event-floor-"));
  const projectPath = join(dir, "proj");
  const stateStorePath = join(dir, "state", "local.json");
  const sqlitePath = join(dir, "state", "local.sqlite");
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(join(dir, "state"), { recursive: true });
  try {
    // Seed SQLite first, leaving its persisted idCounter below the simulated
    // event-shard crash window written afterward.
    let store = await openSqliteStore({ path: sqlitePath });
    boot({ projectPath, stateStorePath, sqliteStore: store });
    store.close();

    const archive = createRetentionArchive({ stateStorePath, now });
    const archived = archive.archiveInvocationEvents([{
      id: "evt_demo_9000",
      invocationId: "inv_archive_floor",
      type: "log",
      level: "info",
      message: "durable beyond SQLite",
      data: null,
      createdAt: now(),
    }]);
    assert.equal(archived.ok, true);

    store = await openSqliteStore({ path: sqlitePath });
    const restarted = boot({ projectPath, stateStorePath, sqliteStore: store });
    const event = restarted.api.appendEvent({
      invocationId: "inv_archive_floor",
      type: "log",
      level: "info",
      message: "after SQLite hydrate",
    });
    assert.ok(Number(event.id.match(/(\d+)$/)?.[1]) > 9000, "the hydrated runtime never reissues an archived event id");
    await new Promise((resolve) => setTimeout(resolve, 40));
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
