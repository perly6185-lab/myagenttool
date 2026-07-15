/*
 * #1039 (Phase C soak) — JSON ↔ SQLite backing PARITY check.
 *
 * During the dual-write soak the server writes BOTH the JSON snapshot and the
 * SQLite backing from the same in-memory `state` on every commit, so the two must
 * reconstruct an identical live state. This tool restores a state dir through each
 * path and diffs them ORDER-SENSITIVELY per collection — catching exactly the class
 * of mirror/hydrate bugs the pre-flip reviews found (array-order reversal, id-less
 * collections dropped, projects not mirrored, push/FIFO reversal). A clean run over
 * a real soak dir is the evidence that retiring the JSON backing (#1042) is safe.
 *
 * `diffBackings` is pure + tested; `loadBackings` reconstructs both states from a
 * state dir; the CLI (`pnpm store:parity <state.json>`) prints a report + exit code.
 * Run it against a STOPPED server (or a copied state dir) so the live writer's lock
 * and WAL are not disturbed.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { createServerState } from "../state-factory.mjs";
import {
  captureSeededDefaults,
  createPersistenceRuntime,
  normalizeLoadedState,
  persistedArrayKeys,
  persistedObjectKeys,
} from "../persistence.mjs";
import { isStoreEmpty, seedOrHydrate } from "./sqlite-backing.mjs";
import { openSqliteStore } from "./sqlite-store.mjs";
import { sameProjectPath } from "../../services/projects.mjs";

// The full durable surface the SQLite backing mirrors (mirrors the composer's set).
export const MIRRORED_ARRAY_KEYS = [...persistedArrayKeys, "projects", "devices"];
const SCALAR_KEYS = ["currentProjectId", "idCounter"];

/**
 * Pure diff of two reconstructed states. Returns a list of divergences; an empty
 * list means the two backings are byte-identical over the persisted surface. Arrays
 * are compared ORDER-SENSITIVELY (a reversed collection is a divergence, not a pass).
 */
export function diffBackings(a, b, { arrayKeys = MIRRORED_ARRAY_KEYS, objectKeys = persistedObjectKeys, scalarKeys = SCALAR_KEYS } = {}) {
  const divergences = [];
  const push = (collection, kind, detail) => divergences.push({ collection, kind, detail });

  for (const key of arrayKeys) {
    const aa = Array.isArray(a[key]) ? a[key] : [];
    const bb = Array.isArray(b[key]) ? b[key] : [];
    if (aa.length !== bb.length) {
      push(key, "length", `json=${aa.length} sqlite=${bb.length}`);
      continue;
    }
    for (let i = 0; i < aa.length; i += 1) {
      if (JSON.stringify(aa[i]) !== JSON.stringify(bb[i])) {
        const aid = aa[i]?.id ?? aa[i]?.agentId ?? `#${i}`;
        const bid = bb[i]?.id ?? bb[i]?.agentId ?? `#${i}`;
        const kind = aid !== bid ? "order" : "content";
        push(key, kind, `at index ${i}: json=${aid} sqlite=${bid}`);
        break; // one divergence per collection keeps the report readable
      }
    }
  }

  for (const key of objectKeys) {
    if (JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null)) {
      push(key, "object", "singleton value differs");
    }
  }

  for (const key of scalarKeys) {
    if (JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null)) {
      push(key, "scalar", `json=${JSON.stringify(a[key] ?? null)} sqlite=${JSON.stringify(b[key] ?? null)}`);
    }
  }

  return divergences;
}

// Reconstruct the live state the JSON snapshot backing would produce.
function loadJsonBacking({ stateStorePath, defaultProjectPath, now }) {
  const { state, defaultProject } = createServerState({ defaultProjectPath, now });
  createPersistenceRuntime({
    state,
    enabled: true,
    stateStorePath,
    schemaVersion: 1,
    now,
    defaultProject,
    sameProjectPath,
  }).restorePersistentState();
  return state;
}

// Reconstruct the live state the SQLite backing would produce (read-only hydrate;
// no seed write — bails if the store is empty). Mirrors the composer's boot path.
async function loadSqliteBacking({ sqlitePath, defaultProjectPath, now }) {
  const { state, defaultProject } = createServerState({ defaultProjectPath, now });
  const store = await openSqliteStore({ path: sqlitePath });
  try {
    const arrayKeys = MIRRORED_ARRAY_KEYS;
    const objectKeys = persistedObjectKeys;
    if (isStoreEmpty({ store, arrayKeys, objectKeys })) return { state, empty: true };
    const seededDefaults = captureSeededDefaults(state);
    seedOrHydrate({ store, state, arrayKeys, objectKeys });
    normalizeLoadedState(state, { seededDefaults, defaultProject, sameProjectPath });
    return { state, empty: false };
  } finally {
    store.close();
  }
}

/**
 * Load BOTH backings from a state dir and return { jsonState, sqliteState, sqliteEmpty }.
 * `stateStorePath` is the JSON snapshot; the SQLite DB is derived as `<path sans .json>.sqlite`.
 */
export async function loadBackings({ stateStorePath, defaultProjectPath = process.cwd(), now = () => new Date().toISOString() }) {
  const sqlitePath = `${stateStorePath.replace(/\.json$/, "")}.sqlite`;
  const jsonState = loadJsonBacking({ stateStorePath, defaultProjectPath, now });
  const { state: sqliteState, empty: sqliteEmpty } = await loadSqliteBacking({ sqlitePath, defaultProjectPath, now });
  return { jsonState, sqliteState, sqliteEmpty, sqlitePath };
}

// CLI: pnpm store:parity <state.json> [projectPath]
async function main() {
  const stateStorePath = resolve(process.argv[2] ?? ".myagenttool/state/local-demo-state.json");
  const defaultProjectPath = resolve(process.argv[3] ?? process.cwd());
  if (!existsSync(stateStorePath)) {
    console.error(`[store:parity] no JSON snapshot at ${stateStorePath}`);
    process.exit(2);
  }
  const now = () => new Date().toISOString();
  const { sqliteState, jsonState, sqliteEmpty, sqlitePath } = await loadBackings({ stateStorePath, defaultProjectPath, now });
  if (sqliteEmpty) {
    console.error(`[store:parity] the SQLite backing at ${sqlitePath} is empty — nothing to compare.`);
    process.exit(2);
  }
  const divergences = diffBackings(jsonState, sqliteState);
  // Scalars aren't mirrored yet (idCounter is reconstructed from records by the
  // composer; currentProjectId is reconciled) — a durable slot for them is the last
  // Phase C gap (#1040 / retirement #1042). Flag them but don't fail the run: the
  // gate that matters for retirement is that the DATA surface (arrays + singletons)
  // reconstructs identically.
  const blocking = divergences.filter((d) => d.kind !== "scalar");
  const scalarGaps = divergences.filter((d) => d.kind === "scalar");
  const dataKeys = MIRRORED_ARRAY_KEYS.length + persistedObjectKeys.length;
  if (blocking.length > 0) {
    console.error(`[store:parity] FAIL — ${blocking.length} DATA divergence(s) between JSON and SQLite:`);
    for (const d of blocking.slice(0, 40)) console.error(`  - ${d.collection} [${d.kind}]: ${d.detail}`);
    process.exit(1);
  }
  console.log(`[store:parity] PASS — JSON and SQLite data surfaces agree across ${dataKeys} collections (${stateStorePath}).`);
  if (scalarGaps.length > 0) {
    console.log(`[store:parity] NOTE — ${scalarGaps.length} un-mirrored scalar(s) (durable slot pending, #1040 / retirement):`);
    for (const d of scalarGaps) console.log(`  - ${d.collection}: ${d.detail}`);
  }
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
