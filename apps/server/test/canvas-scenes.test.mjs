import assert from "node:assert/strict";
import { test } from "node:test";
import { createCanvasSceneService } from "../src/services/canvas-scenes.mjs";

const ACTOR_A = { userId: "usr_a", teamId: "team_a" };
const ACTOR_B = { userId: "usr_b", teamId: "team_b" };

function harness() {
  let counter = 0;
  const events = [];
  const state = {
    canvasScenes: [],
    projects: [
      { id: "prj_a", ownerTeamId: "team_a", path: "/tmp/a" },
      { id: "prj_b", ownerTeamId: "team_b", path: "/tmp/b" },
    ],
  };
  const service = createCanvasSceneService({
    state,
    now: () => "2026-07-20T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${String(++counter).padStart(4, "0")}`,
    appendEvent: (event) => events.push(event),
  });
  return { state, events, service };
}

const rect = (id) => ({ id, type: "rectangle", x: 0, y: 0, width: 10, height: 10 });

test("createScene stamps ownership from the actor and ignores the body", () => {
  const { service, events } = harness();
  const result = service.createScene(
    { name: "Diagram", elements: [rect("a")], ownerTeamId: "team_evil", createdBy: "usr_evil" },
    ACTOR_A,
  );
  assert.equal(result.status, 201);
  assert.equal(result.body.scene.ownerTeamId, "team_a");
  assert.equal(result.body.scene.createdBy, "usr_a");
  assert.equal(result.body.scene.revision, 1);
  assert.equal(events.at(-1).type, "canvas_scene_created");
});

test("list and get are team-scoped; foreign reads are hidden as 404", () => {
  const { service } = harness();
  const created = service.createScene({ name: "A", elements: [] }, ACTOR_A).body.scene;

  assert.equal(service.listScenes(ACTOR_A).body.count, 1);
  assert.equal(service.listScenes(ACTOR_B).body.count, 0);

  const foreign = service.getScene({ sceneId: created.id }, ACTOR_B);
  const missing = service.getScene({ sceneId: "cvs_missing" }, ACTOR_B);
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.body, missing.body); // existence-hiding: identical
});

test("update requires a matching expectedRevision (typed 409, no mutation)", () => {
  const { service } = harness();
  const scene = service.createScene({ name: "A", elements: [rect("a")] }, ACTOR_A).body.scene;

  const missingRev = service.updateScene({ sceneId: scene.id, elements: [rect("a"), rect("b")] }, ACTOR_A);
  assert.equal(missingRev.status, 400);
  assert.equal(missingRev.body.error, "expected_revision_required");

  const stale = service.updateScene(
    { sceneId: scene.id, elements: [rect("a"), rect("b")], expectedRevision: 99 },
    ACTOR_A,
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "canvas_scene_revision_conflict");
  assert.equal(stale.body.currentRevision, 1);
  assert.equal(service.getScene({ sceneId: scene.id }, ACTOR_A).body.scene.elements.length, 1);

  const ok = service.updateScene(
    { sceneId: scene.id, elements: [rect("a"), rect("b")], expectedRevision: 1 },
    ACTOR_A,
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.body.scene.revision, 2);
  assert.equal(ok.body.scene.elements.length, 2);
});

test("delete is revision-gated and team-scoped", () => {
  const { service } = harness();
  const scene = service.createScene({ name: "A", elements: [] }, ACTOR_A).body.scene;

  assert.equal(service.deleteScene({ sceneId: scene.id, expectedRevision: 5 }, ACTOR_A).status, 409);
  assert.equal(service.deleteScene({ sceneId: scene.id, expectedRevision: 1 }, ACTOR_B).status, 404);
  assert.equal(service.deleteScene({ sceneId: scene.id, expectedRevision: 1 }, ACTOR_A).status, 200);
  assert.equal(service.listScenes(ACTOR_A).body.count, 0);
});

test("project scope is validated against the actor (foreign project hidden as 404)", () => {
  const { service } = harness();
  assert.equal(service.createScene({ elements: [], projectId: "prj_b" }, ACTOR_A).status, 404);
  assert.equal(service.createScene({ elements: [], projectId: "prj_a" }, ACTOR_A).status, 201);
});

test("bounds and embedded-URL policy fail closed", () => {
  const { service } = harness();
  const create = (payload) => service.createScene(payload, ACTOR_A);

  assert.equal(create({ elements: "nope" }).body.error, "invalid_canvas_scene");
  assert.equal(create({ elements: [{ type: "rectangle" }] }).body.error, "invalid_canvas_element");
  assert.equal(create({ elements: [{ id: "t", type: "text", text: "x".repeat(20001) }] }).body.error, "invalid_canvas_element");
  assert.equal(create({ elements: [{ id: "a", type: "rectangle", link: "javascript:alert(1)" }] }).body.error, "unsupported_canvas_url");
  assert.equal(create({ elements: [{ id: "a", type: "rectangle", link: "http://x" }] }).body.error, "unsupported_canvas_url");
  assert.equal(create({ elements: [{ id: "a", type: "rectangle", link: "https://ok" }] }).status, 201);

  assert.equal(create({ elements: [], files: { f1: { mimeType: "image/png" } } }).body.error, "invalid_canvas_file");
  assert.equal(create({ elements: [], files: { f1: { mimeType: "image/png", dataURL: "javascript:x" } } }).body.error, "unsupported_canvas_url");
  assert.equal(create({ elements: [], files: { f1: { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA" } } }).status, 201);

  const many = Array.from({ length: 5001 }, (_, i) => rect(`e${i}`));
  assert.equal(create({ elements: many }).body.error, "canvas_scene_too_large");
});
