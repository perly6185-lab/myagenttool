/*
 * #1041 — the persistence flush mirrors to SQLite via `afterFlush`, so a durable
 * write that NEVER goes through store.transaction (invocation accept/completion via
 * runStateTransaction, route-level persistStateSoon, runtime helpers) still reaches
 * the SQLite backing — it no longer lags the JSON snapshot. Skips without node:sqlite.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime, persistedObjectKeys } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createIncrementalMirror, mirrorState, seedOrHydrate } from "../src/runtime/store/sqlite-backing.mjs";
import { MIRRORED_ARRAY_KEYS } from "../src/runtime/store/parity.mjs";
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

test("a persistStateNow write with NO store.transaction still mirrors to SQLite (#1041)", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "flush-mirror-"));
  const projectPath = join(dir, "proj");
  const stateStorePath = join(dir, "state", "local.json");
  const sqlitePath = join(dir, "state", "local.sqlite");
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(join(dir, "state"), { recursive: true });
  try {
    const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now });
    const store = await openSqliteStore({ path: sqlitePath });
    const arrayKeys = MIRRORED_ARRAY_KEYS;
    const objectKeys = persistedObjectKeys;

    // Wire persistence exactly like the composer: afterFlush mirrors the delta.
    mirrorState({ store, state, arrayKeys, objectKeys }); // seed
    const mirror = createIncrementalMirror({ store, arrayKeys, objectKeys });
    mirror.prime(state);
    const persistence = createPersistenceRuntime({
      state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject, sameProjectPath,
      afterFlush: () => mirror.sync(state),
    });

    // Mutate state DIRECTLY (as a route handler / runStateTransaction body does) and
    // flush — WITHOUT ever calling store.transaction.
    state.agentSkills = [{ id: "skl_flush", name: "Flushed" }, ...(state.agentSkills ?? [])];
    persistence.persistStateNow();
    store.close();

    // Reopen + hydrate: the write reached SQLite purely via the flush hook.
    const store2 = await openSqliteStore({ path: sqlitePath });
    const fresh = {};
    for (const k of arrayKeys) fresh[k] = [];
    seedOrHydrate({ store: store2, state: fresh, arrayKeys, objectKeys });
    assert(
      (fresh.agentSkills ?? []).some((s) => s.id === "skl_flush"),
      "the non-store write is durable in SQLite via afterFlush",
    );
    store2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
