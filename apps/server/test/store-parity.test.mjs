/*
 * #1039 — the JSON↔SQLite parity checker: the pure diff, and an end-to-end run that
 * writes BOTH backings from one state and asserts they reconstruct identically.
 * `node:sqlite` is experimental, so the end-to-end case SKIPS when it's unavailable.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { diffBackings, loadBackings, MIRRORED_ARRAY_KEYS } from "../src/runtime/store/parity.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { mirrorState } from "../src/runtime/store/sqlite-backing.mjs";
import { persistedObjectKeys } from "../src/runtime/persistence.mjs";
import { sameProjectPath } from "../src/services/projects.mjs";

let openSqliteStore;
try {
  await import("node:sqlite");
  ({ openSqliteStore } = await import("../src/runtime/store/sqlite-store.mjs"));
} catch {
  openSqliteStore = null;
}
const skip = openSqliteStore ? false : "node:sqlite unavailable in this runtime";
const now = () => "2026-07-15T00:00:00.000Z";

test("diffBackings: identical states → no divergence; reversed/changed → reported", () => {
  const a = { agents: [{ id: "a1" }, { id: "a2" }], autoRunSettings: { x: 1 }, currentProjectId: "p1" };
  const b = { agents: [{ id: "a1" }, { id: "a2" }], autoRunSettings: { x: 1 }, currentProjectId: "p1" };
  assert.deepEqual(diffBackings(a, b, { arrayKeys: ["agents"], objectKeys: ["autoRunSettings"], scalarKeys: ["currentProjectId"] }), []);

  const rev = { agents: [{ id: "a2" }, { id: "a1" }], autoRunSettings: { x: 1 }, currentProjectId: "p1" };
  const d1 = diffBackings(a, rev, { arrayKeys: ["agents"], objectKeys: [], scalarKeys: [] });
  assert.equal(d1.length, 1);
  assert.equal(d1[0].kind, "order");

  const shorter = { agents: [{ id: "a1" }], autoRunSettings: { x: 1 }, currentProjectId: "p1" };
  assert.equal(diffBackings(a, shorter, { arrayKeys: ["agents"], objectKeys: [], scalarKeys: [] })[0].kind, "length");

  const objDiff = { agents: a.agents, autoRunSettings: { x: 2 }, currentProjectId: "p2" };
  const d2 = diffBackings(a, objDiff, { arrayKeys: [], objectKeys: ["autoRunSettings"], scalarKeys: ["currentProjectId"] });
  assert.deepEqual(new Set(d2.map((x) => x.kind)), new Set(["object", "scalar"]));
});

test("end-to-end: a state dual-written to JSON + SQLite reconstructs in parity", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "store-parity-"));
  const projectPath = join(dir, "proj");
  const stateStorePath = join(dir, "state", "local.json");
  const sqlitePath = join(dir, "state", "local.sqlite");
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(join(dir, "state"), { recursive: true });
  try {
    const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now });
    // Exercise the tricky surfaces: unshift array, a FIFO push array, an id-less
    // (blob) collection, a singleton, projects/devices.
    state.agentSkills = [{ id: "skl_2", name: "B" }, { id: "skl_1", name: "A" }];
    state.terminalBridgeActions = [{ id: "tba_1" }, { id: "tba_2" }, { id: "tba_3" }]; // FIFO (push order)
    state.agentUsageSummaries = [{ agentId: "agt_2", n: 2 }, { agentId: "agt_1", n: 1 }]; // id-less
    state.autoRunSettings = { ...(state.autoRunSettings ?? {}), globalMaxConcurrent: 7 };

    // Write BOTH backings from this state, exactly like the dual-write commit.
    createPersistenceRuntime({ state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject, sameProjectPath }).persistStateNow();
    const store = await openSqliteStore({ path: sqlitePath });
    mirrorState({ store, state, arrayKeys: MIRRORED_ARRAY_KEYS, objectKeys: persistedObjectKeys });
    store.close();

    const { jsonState, sqliteState, sqliteEmpty } = await loadBackings({ stateStorePath, defaultProjectPath: projectPath, now });
    assert.equal(sqliteEmpty, false);
    const divergences = diffBackings(jsonState, sqliteState);
    assert.deepEqual(divergences, [], `expected parity, got: ${JSON.stringify(divergences)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
