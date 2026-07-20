/*
 * Canvas scenes (#1352): a created + updated scene, its revision, and last
 * modifier survive a crash/restart via the Store. Crash model: persistStateNow
 * commits, persistStateSoon is a no-op.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createInMemoryStore } from "../src/runtime/store/in-memory-store.mjs";
import { createCanvasSceneService } from "../src/services/canvas-scenes.mjs";

const now = () => "2026-07-20T00:00:00.000Z";
const owner = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

test("a created + updated canvas scene survives restart with its revision", () => {
  const root = join(tmpdir(), `myagenttool-canvas-durability-${process.pid}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  try {
    const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now });
    const persistence = createPersistenceRuntime({
      state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject, sameProjectPath: () => false,
    });
    const store = createInMemoryStore({ state, commit: () => persistence.persistStateNow() });
    let counter = 0;
    const service = createCanvasSceneService({
      state, now, nextId: (prefix) => `${prefix}_${String(++counter).padStart(4, "0")}`, appendEvent: () => {}, persistStateSoon: () => {}, store,
    });

    const created = service.createScene({ name: "Flow", elements: [{ id: "a", type: "rectangle" }] }, owner);
    const sceneId = created.body.scene.id;
    service.updateScene({ sceneId, elements: [{ id: "a", type: "rectangle" }, { id: "b", type: "ellipse" }], expectedRevision: 1 }, owner);

    const fresh = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({
      state: fresh.state, enabled: true, stateStorePath, schemaVersion: 1, now,
      defaultProject: fresh.defaultProject, sameProjectPath: () => false,
    }).restorePersistentState();

    const scene = (fresh.state.canvasScenes ?? []).find((row) => row.id === sceneId);
    assert(scene, "canvas scene is durable");
    assert.equal(scene.revision, 2);
    assert.equal(scene.elements.length, 2);
    assert.equal(scene.ownerTeamId, "team_local");
    assert.equal(scene.lastModifiedBy, "usr_local");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
