import {
  captureSeededDefaults,
  createPersistenceRuntime,
  normalizeLoadedState,
  persistedArrayKeys,
  persistedObjectKeys,
} from "./persistence.mjs";
import { createInMemoryStore } from "./store/in-memory-store.mjs";
import {
  createIncrementalMirror,
  isStoreEmpty,
  mirrorState,
  seedOrHydrate,
} from "./store/sqlite-backing.mjs";

const MIRRORED_ARRAY_KEYS = Object.freeze([...persistedArrayKeys, "projects", "devices"]);
const MIRRORED_OBJECT_KEYS = Object.freeze([...persistedObjectKeys]);
const MIRRORED_SCALAR_KEYS = Object.freeze(["currentProjectId", "idCounter"]);

/**
 * Owns runtime persistence selection, boot hydration, and durable-history seams.
 *
 * The returned store remains the mutation facade over the live in-memory state.
 * When sqliteStore is present, SQLite is the durable backing and the JSON file is
 * read only for a one-time seed. Without sqliteStore, the existing JSON snapshot
 * behavior is preserved. Business-service composition must not depend on either
 * backing directly.
 */
export function createRuntimeStoreBoundary({
  state,
  persistenceEnabled,
  stateStorePath,
  stateSchemaVersion,
  now,
  defaultProject,
  sameProjectPath,
  sqliteStore = null,
}) {
  // Every durable flush, including legacy persistStateSoon call sites, reaches
  // this hook. It remains a no-op until the SQLite mirror has been hydrated and
  // primed, preventing a partial boot from writing an incomplete state view.
  let durableSync = () => {};
  const persistence = createPersistenceRuntime({
    state,
    enabled: persistenceEnabled,
    stateStorePath,
    schemaVersion: stateSchemaVersion,
    now,
    defaultProject,
    sameProjectPath,
    afterFlush: () => durableSync(),
    jsonBacking: !sqliteStore,
  });

  const incrementalMirror = sqliteStore
    ? createIncrementalMirror({
        store: sqliteStore,
        arrayKeys: MIRRORED_ARRAY_KEYS,
        objectKeys: MIRRORED_OBJECT_KEYS,
        scalarKeys: MIRRORED_SCALAR_KEYS,
      })
    : null;
  const store = createInMemoryStore({ state, commit: persistence.persistStateNow });
  const seededDefaults = sqliteStore ? captureSeededDefaults(state) : null;

  // SQLite restores directly when populated. An empty SQLite store receives a
  // one-time seed from the prior JSON snapshot (when present) or fresh defaults.
  // The JSON-only path retains the existing restore behavior.
  let restored;
  if (!sqliteStore) {
    restored = persistence.restorePersistentState();
  } else if (isStoreEmpty({
    store: sqliteStore,
    arrayKeys: MIRRORED_ARRAY_KEYS,
    objectKeys: MIRRORED_OBJECT_KEYS,
  })) {
    restored = persistence.restorePersistentState();
  }

  if (sqliteStore) {
    const outcome = seedOrHydrate({
      store: sqliteStore,
      state,
      arrayKeys: MIRRORED_ARRAY_KEYS,
      objectKeys: MIRRORED_OBJECT_KEYS,
      scalarKeys: MIRRORED_SCALAR_KEYS,
    });
    if (outcome.mode === "seeded" && outcome.mirror?.skipped > 0) {
      console.warn(
        `[store:sqlite] initial seed dropped ${outcome.mirror.skipped} id-less row(s) in ${outcome.mirror.skippedCollections.join(", ")}.`,
      );
    }
    if (outcome.mode === "hydrated") {
      normalizeLoadedState(state, { seededDefaults, defaultProject, sameProjectPath });
      // Normalization may merge defaults, drop invalid projects, repair ids, or
      // mark devices offline. Reconcile those changes before delta mirroring.
      mirrorState({
        store: sqliteStore,
        state,
        arrayKeys: MIRRORED_ARRAY_KEYS,
        objectKeys: MIRRORED_OBJECT_KEYS,
        scalarKeys: MIRRORED_SCALAR_KEYS,
      });
    }
    incrementalMirror.prime(state);
    durableSync = () => {
      const { skipped, skippedCollections } = incrementalMirror.sync(state);
      if (skipped > 0) {
        console.warn(
          `[store:sqlite] mirror dropped ${skipped} id-less row(s) in ${skippedCollections.join(", ")} — those records are not durable in the SQLite backing.`,
        );
      }
    };
    console.log(
      `[store:sqlite] durable backing ${outcome.mode} (${MIRRORED_ARRAY_KEYS.length} collections).`,
    );
  }

  return {
    ...persistence,
    store,
    restored,
    backing: sqliteStore ? "sqlite" : persistenceEnabled ? "json" : "memory",
    queryDurableRecords: sqliteMethod(sqliteStore, "query"),
    compactDurableStoreForErasure: sqliteMethod(sqliteStore, "compactForErasure"),
    historyAppend: sqliteMethod(sqliteStore, "appendHistory"),
    historyQuery: sqliteMethod(sqliteStore, "queryHistory"),
    historyDelete: sqliteMethod(sqliteStore, "deleteHistory"),
    historyRedact: sqliteMethod(sqliteStore, "redactHistory"),
  };
}

function sqliteMethod(sqliteStore, name) {
  return sqliteStore && typeof sqliteStore[name] === "function"
    ? (...args) => sqliteStore[name](...args)
    : null;
}

export const runtimeStoreBoundaryCollections = Object.freeze({
  arrays: MIRRORED_ARRAY_KEYS,
  objects: MIRRORED_OBJECT_KEYS,
  scalars: MIRRORED_SCALAR_KEYS,
});
