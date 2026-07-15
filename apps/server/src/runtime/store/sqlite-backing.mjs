/*
 * #1002 (Phase B, slice 2) — the SQLite-as-cache backing logic, as a pure unit
 * (no boot wiring; B1b-ii does that behind MYAGENTTOOL_STORE=sqlite).
 *
 * The cutover (Epic #1000) keeps the in-memory `state` object as the live
 * materialized VIEW; SQLite becomes the durable backing. This module bridges the
 * two:
 *   - seedOrHydrate: on boot, either SEED SQLite from the current (JSON-restored)
 *     state when SQLite is empty — the one-time migration from JSON backing to
 *     SQLite backing — or HYDRATE `state` from SQLite when it already holds data
 *     (SQLite is then authoritative, overriding the JSON restore).
 *   - mirrorState: the `commit` sink — a faithful whole-state mirror into SQLite
 *     (deletes propagate) run on every store transaction commit.
 *
 * Singletons: the persisted state is ~64 id-keyed collection arrays PLUS a handful
 * of object singletons (autoRunSettings, retentionSettings, …) that have no `.id`
 * and so cannot live in the generic (collection,id,json) record table directly.
 * Each singleton is stored as ONE row under a reserved id, wrapping the object in
 * `{ id: SINGLETON_ID, __value }`; hydration unwraps `.__value`. Arrays store as-is.
 */

import { existsSync } from "node:fs";

import { listDevices } from "../device.mjs";

// Reserved record id under which an object singleton (a non-array persisted key)
// is stored. Real record ids are prefixed slugs (agt_, prj_, …) and never collide.
export const SINGLETON_ID = "__singleton__";

// Wrap an object singleton as the single row of its collection.
function singletonRows(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? [{ id: SINGLETON_ID, __value: value }]
    : [];
}

// Build the { collection: rows[] } map a full mirror writes: every array key as-is,
// every object key wrapped as one singleton row.
function snapshotFor({ state, arrayKeys, objectKeys }) {
  const snapshot = {};
  for (const key of arrayKeys) {
    if (Array.isArray(state[key])) snapshot[key] = state[key];
  }
  for (const key of objectKeys) {
    if (state[key] !== undefined) snapshot[key] = singletonRows(state[key]);
  }
  return snapshot;
}

/**
 * True when the SQLite store holds no persisted data yet (a fresh backing) — the
 * signal to SEED it from the current state rather than HYDRATE state from it.
 */
export function isStoreEmpty({ store, arrayKeys, objectKeys }) {
  for (const key of [...arrayKeys, ...objectKeys]) {
    if (store.query(key).length > 0) return false;
  }
  return true;
}

/**
 * Mirror the whole in-memory `state` view into SQLite (the commit sink). Faithful:
 * deletes propagate (replaceSnapshot clears then writes). Returns replaceSnapshot's
 * accounting ({ written, skipped, skippedCollections }) so the caller can assert no
 * id-less array row was silently dropped.
 */
export function mirrorState({ store, state, arrayKeys, objectKeys }) {
  return store.replaceSnapshot(snapshotFor({ state, arrayKeys, objectKeys }));
}

/**
 * Boot bridge: seed SQLite from `state` if the store is empty, otherwise hydrate
 * `state` from SQLite (mutating the passed-in state object in place — SQLite wins).
 * Returns { mode: "seeded" | "hydrated", mirror? } — `mirror` (the seed's
 * accounting) is present on the seed path so the caller can verify fidelity.
 */
export function seedOrHydrate({ store, state, arrayKeys, objectKeys }) {
  if (isStoreEmpty({ store, arrayKeys, objectKeys })) {
    const mirror = mirrorState({ store, state, arrayKeys, objectKeys });
    return { mode: "seeded", mirror };
  }
  const back = store.readSnapshot([...arrayKeys, ...objectKeys]);
  for (const key of arrayKeys) {
    state[key] = Array.isArray(back[key]) ? back[key] : [];
  }
  for (const key of objectKeys) {
    const row = (back[key] ?? []).find((r) => r?.id === SINGLETON_ID);
    // Only overwrite when SQLite actually carried the singleton — a key absent from
    // the durable store keeps its state-factory default rather than becoming null.
    if (row && "__value" in row) state[key] = row.__value;
  }
  return { mode: "hydrated" };
}

/**
 * Apply the JSON restore's fail-closed PROJECT normalization to a state hydrated
 * from SQLite (#1003 Phase C prep). Boot hydration reads raw rows, so — unlike the
 * JSON restore path (persistence.mjs restorePersistentState) — it would otherwise:
 *   - resurrect a project whose materialized path has since vanished, and
 *   - not guarantee the default project is present / currentProjectId is valid.
 * This mirrors that logic so the SQLite backing fails closed identically. (Dup-ids
 * need no repair here — SQLite's PRIMARY KEY(collection,id) makes them impossible.)
 *
 * The JSON restore in persistence.mjs is the source of truth for this behavior;
 * kept byte-aligned with it (a test pins the parity).
 */
/**
 * Force every hydrated device offline (#1003 Phase C prep). A restart tells us
 * nothing about which machines are still up, so the JSON restore resets liveness
 * (persistence.mjs). The SQLite mirror stores a device with its LIVE status, so a
 * raw hydrate would bring it back online — this re-applies the fail-closed reset so
 * a device is trusted online only after its own bridge re-registers.
 */
export function normalizeHydratedDevices({ state }) {
  for (const device of listDevices(state)) {
    if (device) device.status = "offline";
  }
}

export function normalizeHydratedProjects({ state, defaultProject, sameProjectPath }) {
  if (!defaultProject) return;
  const same = typeof sameProjectPath === "function" ? sameProjectPath : (a, b) => a === b;
  let projects = Array.isArray(state.projects)
    ? state.projects.filter((project) => project?.id && project?.path && existsSync(project.path))
    : [];
  // A stored row under the default project's id but a different path is stale.
  projects = projects.filter((project) => project.id !== defaultProject.id || same(project.path, defaultProject.path));
  let defaultPathProject = projects.find((project) => same(project.path, defaultProject.path));
  if (!defaultPathProject) {
    projects.unshift(defaultProject);
    defaultPathProject = defaultProject;
  }
  state.projects = projects;
  state.currentProjectId = projects.some((project) => project.id === state.currentProjectId)
    ? state.currentProjectId
    : defaultPathProject.id;
}
