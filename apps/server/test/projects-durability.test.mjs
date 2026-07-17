/*
 * #1001 (Phase A) — project/worktree writes commit through the Store's unit of
 * work. Crash model: the store commits via persistStateNow while persistStateSoon
 * (the fallback debounce) is a no-op — so a record on disk after the call proves
 * the store transaction fired. Also exercises reentrancy (addProject → selectProject
 * both runTx-wrapped) committing as one unit.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createInMemoryStore } from "../src/runtime/store/in-memory-store.mjs";
import { createProjectService, sameProjectPath } from "../src/services/projects.mjs";

const now = () => "2026-07-14T00:00:00.000Z";

function gitRepo(dir) {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  execFileSync("git", ["-C", dir, "config", "user.email", "t@e.com"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "T"]);
  return dir;
}

test("#1001 addProject (+ nested selectProject) survives a crash via the Store", () => {
  const root = join(tmpdir(), `myagenttool-projects-durability-${Date.now()}-${Math.floor(process.hrtime()[1] % 1e6)}`);
  const defaultRepo = gitRepo(join(root, "default"));
  const newRepo = gitRepo(join(root, "extra"));
  const stateStorePath = join(root, "state", "snapshot.json");
  try {
    const { state, defaultProject } = createServerState({ defaultProjectPath: defaultRepo, now });
    let n = 0;
    const persistence = createPersistenceRuntime({ state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject, sameProjectPath });
    const store = createInMemoryStore({ state, commit: () => persistence.persistStateNow() });
    const projects = createProjectService({
      state, now, nextId: (p) => `${p}_${++n}`, appendEvent: () => {},
      persistStateSoon: () => {}, // the eaten debounce
      store,
    });

    const registered = projects.addProject({ name: "Extra", path: newRepo });

    // Crash + reload straight from disk (the store committed; the debounce was a no-op).
    const fresh = createServerState({ defaultProjectPath: defaultRepo, now });
    createPersistenceRuntime({ state: fresh.state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject: fresh.defaultProject, sameProjectPath }).restorePersistentState();

    assert(fresh.state.projects.some((p) => p.id === registered.id), "the registered project is durable");
    assert.equal(fresh.state.currentProjectId, registered.id, "the nested selectProject committed in the same unit");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
