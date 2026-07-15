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

test("top-level scalars (currentProjectId, idCounter) round-trip via the meta row (#1040)", { skip }, () => {
  const store = createSqliteStore({ DatabaseSync, path: ":memory:" });
  try {
    const keys = { arrayKeys: ["projects"], objectKeys: [], scalarKeys: ["currentProjectId", "idCounter"] };
    const state = { projects: [{ id: "prj_1" }], currentProjectId: "prj_1", idCounter: 42 };
    mirrorState({ store, state, ...keys });
    const back = { projects: [], currentProjectId: undefined, idCounter: undefined };
    seedOrHydrate({ store, state: back, ...keys });
    assert.equal(back.currentProjectId, "prj_1");
    assert.equal(back.idCounter, 42);

    // Incremental change to a scalar is mirrored too.
    const mirror = createIncrementalMirror({ store, ...keys });
    mirror.prime(state);
    state.idCounter = 99;
    state.currentProjectId = "prj_2";
    mirror.sync(state);
    const back2 = { projects: [], currentProjectId: undefined, idCounter: undefined };
    seedOrHydrate({ store, state: back2, ...keys });
    assert.equal(back2.idCounter, 99);
    assert.equal(back2.currentProjectId, "prj_2");
  } finally {
    store.close();
  }
});

test("a natural-keyed (id-less) array collection round-trips as a blob, not dropped", { skip }, () => {
  const store = createSqliteStore({ DatabaseSync, path: ":memory:" });
  try {
    const keys = { arrayKeys: ["agentUsageSummaries"], objectKeys: [] };
    // Rows keyed by agentId, no `.id` — the record table can't key these individually.
    const state = { agentUsageSummaries: [{ agentId: "agt_2", n: 2 }, { agentId: "agt_1", n: 1 }] };
    const res = mirrorState({ store, state, ...keys });
    assert.equal(res.skipped, 0, "id-less rows are NOT dropped (stored as a blob)");

    const back = { agentUsageSummaries: [] };
    seedOrHydrate({ store, state: back, ...keys });
    assert.deepEqual(back.agentUsageSummaries, state.agentUsageSummaries, "blob round-trips faithfully, in order");

    // Incremental delta over a blob collection.
    const mirror = createIncrementalMirror({ store, ...keys });
    mirror.prime(state);
    state.agentUsageSummaries.unshift({ agentId: "agt_3", n: 3 });
    const d = mirror.sync(state);
    assert.equal(d.skipped, 0);
    const back2 = { agentUsageSummaries: [] };
    seedOrHydrate({ store, state: back2, ...keys });
    assert.deepEqual(back2.agentUsageSummaries.map((r) => r.agentId), ["agt_3", "agt_2", "agt_1"]);
  } finally {
    store.close();
  }
});

test("incremental mirror preserves PUSH (FIFO) order too (regression: push vs unshift)", { skip }, () => {
  const store = createSqliteStore({ DatabaseSync, path: ":memory:" });
  try {
    const keys = { arrayKeys: ["queue"], objectKeys: [] };
    // A FIFO queue built with push (oldest-first) — e.g. terminalBridgeActions.
    const state = { queue: [{ id: "q1" }, { id: "q2" }] };
    mirrorState({ store, state, ...keys });
    const m = createIncrementalMirror({ store, ...keys });
    m.prime(state);
    state.queue.push({ id: "q3" }); m.sync(state);          // enqueue (append)
    state.queue.push({ id: "q4" }); m.sync(state);
    state.queue = state.queue.filter((x) => x.id !== "q1"); m.sync(state); // dequeue front
    const back = { queue: [] };
    seedOrHydrate({ store, state: back, ...keys });
    assert.deepEqual(back.queue.map((q) => q.id), ["q2", "q3", "q4"], "FIFO order survives incremental push + hydrate");
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
