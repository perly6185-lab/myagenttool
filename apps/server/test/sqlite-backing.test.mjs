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

import { createIncrementalMirror, isStoreEmpty, mirrorState, seedOrHydrate, SINGLETON_ID } from "../src/runtime/store/sqlite-backing.mjs";

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

test("mirror + hydrate PRESERVES newest-first order (regression: rowid-DESC vs insert order)", { skip }, () => {
  const store = createSqliteStore({ DatabaseSync, path: ":memory:" });
  try {
    const keys = { arrayKeys: ["events"], objectKeys: [] };
    // Newest-first, as every collection is kept (services unshift). e5 is newest.
    const state = { events: [{ id: "e5" }, { id: "e4" }, { id: "e3" }, { id: "e2" }, { id: "e1" }] };
    mirrorState({ store, state, ...keys });
    const back = { events: [] };
    seedOrHydrate({ store, state: back, ...keys });
    assert.deepEqual(back.events.map((e) => e.id), ["e5", "e4", "e3", "e2", "e1"], "full-mirror round-trip keeps order");

    // Incremental path: unshift two newer records, then hydrate again.
    const mirror = createIncrementalMirror({ store, ...keys });
    mirror.prime(state);
    state.events = [{ id: "e7" }, { id: "e6" }, { id: "e5" }, { id: "e4" }, { id: "e3" }, { id: "e2" }, { id: "e1" }];
    mirror.sync(state);
    const back2 = { events: [] };
    seedOrHydrate({ store, state: back2, ...keys });
    assert.deepEqual(back2.events.map((e) => e.id), ["e7", "e6", "e5", "e4", "e3", "e2", "e1"], "delta insert keeps newest-first order");
  } finally {
    store.close();
  }
});

test("createIncrementalMirror writes ONLY the delta and keeps SQLite byte-faithful", { skip }, () => {
  const store = createSqliteStore({ DatabaseSync, path: ":memory:" });
  try {
    const keys = { arrayKeys: ["projects", "agents"], objectKeys: ["autoRunSettings"] };
    const state = {
      projects: [{ id: "prj_1", name: "A" }, { id: "prj_2", name: "B" }],
      agents: [{ id: "agt_1", type: "cli" }],
      autoRunSettings: { globalMaxConcurrent: 3 },
    };
    // Seed the store fully, then prime the mirror to that baseline.
    mirrorState({ store, state, ...keys });
    const mirror = createIncrementalMirror({ store, ...keys });
    mirror.prime(state);

    // No change → no writes.
    assert.deepEqual({ u: mirror.sync(state).upserts, d: mirror.sync(state).deletes }, { u: 0, d: 0 });

    // One change (prj_1 renamed), one add (prj_3), one delete (prj_2), one singleton flip.
    state.projects = [{ id: "prj_1", name: "A2" }, { id: "prj_3", name: "C" }];
    state.autoRunSettings.globalMaxConcurrent = 9;
    const res = mirror.sync(state);
    assert.equal(res.upserts, 3, "prj_1 changed + prj_3 new + autoRunSettings changed");
    assert.equal(res.deletes, 1, "prj_2 removed");

    // SQLite now matches the state exactly (delta writes are byte-faithful).
    const fresh = { projects: [], agents: [], autoRunSettings: {} };
    seedOrHydrate({ store, state: fresh, ...keys });
    assert.deepEqual(new Set(fresh.projects.map((p) => p.id)), new Set(["prj_1", "prj_3"]));
    assert.equal(fresh.projects.find((p) => p.id === "prj_1").name, "A2");
    assert.equal(fresh.agents.length, 1);
    assert.equal(fresh.autoRunSettings.globalMaxConcurrent, 9);
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
