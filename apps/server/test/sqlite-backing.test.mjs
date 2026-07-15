/*
 * #1002 (Phase B, slice 2) — the SQLite-as-cache backing bridge: seed-or-hydrate +
 * whole-state mirror, including the object-singleton convention. `node:sqlite` is
 * experimental, so the suite SKIPS when the runtime doesn't provide it.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { isStoreEmpty, mirrorState, seedOrHydrate, SINGLETON_ID } from "../src/runtime/store/sqlite-backing.mjs";

let DatabaseSync;
let createSqliteStore;
let openSqliteStore;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
  ({ createSqliteStore, openSqliteStore } = await import("../src/runtime/store/sqlite-store.mjs"));
} catch {
  DatabaseSync = null;
}
const skip = DatabaseSync ? false : "node:sqlite unavailable in this runtime";

const ARRAY_KEYS = ["projects", "agents"];
const OBJECT_KEYS = ["autoRunSettings", "retentionSettings"];

function sampleState() {
  return {
    projects: [{ id: "prj_1", name: "A" }, { id: "prj_2", name: "B" }],
    agents: [{ id: "agt_1", type: "cli" }],
    autoRunSettings: { autoMergeLowRisk: true, globalMaxConcurrent: 3 },
    retentionSettings: { logsDays: 14 },
  };
}

test("an empty store SEEDS from state; a populated store HYDRATES back into a fresh state", { skip }, () => {
  const store = createSqliteStore({ DatabaseSync, path: ":memory:" });
  try {
    assert.equal(isStoreEmpty({ store, arrayKeys: ARRAY_KEYS, objectKeys: OBJECT_KEYS }), true);

    const seed = seedOrHydrate({ store, state: sampleState(), arrayKeys: ARRAY_KEYS, objectKeys: OBJECT_KEYS });
    assert.equal(seed.mode, "seeded");
    assert.equal(seed.mirror.skipped, 0, "no id-less rows dropped");
    assert.equal(isStoreEmpty({ store, arrayKeys: ARRAY_KEYS, objectKeys: OBJECT_KEYS }), false);

    // A fresh, empty state hydrates from the now-populated store.
    const fresh = { projects: [], agents: [], autoRunSettings: {}, retentionSettings: {} };
    const res = seedOrHydrate({ store, state: fresh, arrayKeys: ARRAY_KEYS, objectKeys: OBJECT_KEYS });
    assert.equal(res.mode, "hydrated");
    assert.equal(fresh.projects.length, 2);
    assert.equal(fresh.agents.length, 1);
    // Singletons round-trip via the reserved-id wrapper.
    assert.deepEqual(fresh.autoRunSettings, { autoMergeLowRisk: true, globalMaxConcurrent: 3 });
    assert.equal(fresh.retentionSettings.logsDays, 14);
  } finally {
    store.close();
  }
});

test("the singleton wrapper stores an object under the reserved id, not as loose rows", { skip }, () => {
  const store = createSqliteStore({ DatabaseSync, path: ":memory:" });
  try {
    mirrorState({ store, state: sampleState(), arrayKeys: ARRAY_KEYS, objectKeys: OBJECT_KEYS });
    const rows = store.query("autoRunSettings");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, SINGLETON_ID);
    assert.deepEqual(rows[0].__value, { autoMergeLowRisk: true, globalMaxConcurrent: 3 });
  } finally {
    store.close();
  }
});

test("re-mirroring after a delete propagates it on the next hydrate (no resurrection)", { skip }, () => {
  const store = createSqliteStore({ DatabaseSync, path: ":memory:" });
  try {
    const state = sampleState();
    mirrorState({ store, state, arrayKeys: ARRAY_KEYS, objectKeys: OBJECT_KEYS });

    // A project is removed + a setting flips; mirror again (the commit sink).
    state.projects = state.projects.filter((p) => p.id !== "prj_1");
    state.autoRunSettings.globalMaxConcurrent = 9;
    mirrorState({ store, state, arrayKeys: ARRAY_KEYS, objectKeys: OBJECT_KEYS });

    const fresh = { projects: [], agents: [], autoRunSettings: {}, retentionSettings: {} };
    seedOrHydrate({ store, state: fresh, arrayKeys: ARRAY_KEYS, objectKeys: OBJECT_KEYS });
    assert.deepEqual(new Set(fresh.projects.map((p) => p.id)), new Set(["prj_2"]));
    assert.equal(fresh.autoRunSettings.globalMaxConcurrent, 9);
  } finally {
    store.close();
  }
});

test("a key absent from the durable store keeps its state default (never nulled)", { skip }, () => {
  const store = createSqliteStore({ DatabaseSync, path: ":memory:" });
  try {
    // Seed with only projects populated; retentionSettings never written.
    mirrorState({ store, state: { projects: [{ id: "prj_1" }], agents: [], autoRunSettings: {}, retentionSettings: undefined }, arrayKeys: ARRAY_KEYS, objectKeys: OBJECT_KEYS });
    const fresh = { projects: [], agents: [], autoRunSettings: {}, retentionSettings: { logsDays: 30 } };
    seedOrHydrate({ store, state: fresh, arrayKeys: ARRAY_KEYS, objectKeys: OBJECT_KEYS });
    assert.equal(fresh.retentionSettings.logsDays, 30, "untouched default survives hydration");
  } finally {
    store.close();
  }
});

test("devices mirror + hydrate round-trip (id-keyed array; offline reset lives in normalizeLoadedState)", { skip }, () => {
  const store = createSqliteStore({ DatabaseSync, path: ":memory:" });
  try {
    // A device stored with a LIVE status (as the mirror would on shutdown); hydrate
    // reads it back verbatim — the composer's shared normalizeLoadedState is what
    // forces it offline (covered in persistence.test.mjs).
    mirrorState({ store, state: { devices: [{ id: "dev_local_001", status: "online" }] }, arrayKeys: ["devices"], objectKeys: [] });
    const fresh = { devices: [] };
    seedOrHydrate({ store, state: fresh, arrayKeys: ["devices"], objectKeys: [] });
    assert.equal(fresh.devices.length, 1);
    assert.equal(fresh.devices[0].id, "dev_local_001");
  } finally {
    store.close();
  }
});

test("seed → close → reopen → hydrate survives a durable file round-trip", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sqlite-backing-"));
  const path = join(dir, "store.sqlite");
  try {
    let store = await openSqliteStore({ path });
    seedOrHydrate({ store, state: sampleState(), arrayKeys: ARRAY_KEYS, objectKeys: OBJECT_KEYS });
    store.close();

    store = await openSqliteStore({ path });
    const fresh = { projects: [], agents: [], autoRunSettings: {}, retentionSettings: {} };
    const res = seedOrHydrate({ store, state: fresh, arrayKeys: ARRAY_KEYS, objectKeys: OBJECT_KEYS });
    assert.equal(res.mode, "hydrated");
    assert.equal(fresh.projects.length, 2);
    assert.deepEqual(fresh.autoRunSettings, { autoMergeLowRisk: true, globalMaxConcurrent: 3 });
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
