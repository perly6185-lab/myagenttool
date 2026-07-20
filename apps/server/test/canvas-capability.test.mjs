/*
 * Governed Canvas capabilities (#1353): projection risk levels, the approval
 * gate on the destructive remove, schema/reference validation, and the result
 * contract — invoked through the real application service + scene service.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationService } from "../src/services/applications.mjs";
import { createCanvasSceneService } from "../src/services/canvas-scenes.mjs";
import { createCanvasApplicationRegistration, CANVAS_APPLICATION_ID } from "../src/services/canvas-application.mjs";
import { createCanvasCapabilityHandlers } from "../src/services/canvas-capabilities.mjs";

const OWNER = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

function harness() {
  let counter = 0;
  const state = { applications: [], canvasScenes: [], projects: [] };
  const deps = {
    state,
    now: () => "2026-07-20T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${String(++counter).padStart(4, "0")}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
    // Approve iff a token is present (the single-use grant machinery is covered
    // by approval-grants.test.mjs; here we test the gate is wired).
    validateApprovalToken: (token) => (token ? { approved: true, mode: "legacy" } : { approved: false, reason: "missing_token" }),
  };
  const canvasSceneService = createCanvasSceneService(deps);
  const app = createApplicationService({
    ...deps,
    managedCapabilityHandlers: { [CANVAS_APPLICATION_ID]: createCanvasCapabilityHandlers(canvasSceneService) },
  });
  app.registerApplication(createCanvasApplicationRegistration(), OWNER);
  const caps = app.listApplicationCapabilities(CANVAS_APPLICATION_ID);
  const nameFor = (action) => caps.find((c) => c.name.endsWith(`.${action}`)).name;
  const invoke = (action, input = {}) => app.invokeApplicationCapability(nameFor(action), input, OWNER);
  return { app, caps, invoke, nameFor };
}

test("projects 7 governed capabilities with the right risk + approval posture", () => {
  const { caps } = harness();
  const CANVAS_ACTIONS = ["list", "get", "create", "add_elements", "update_elements", "remove_elements", "export"];
  const byAction = Object.fromEntries(CANVAS_ACTIONS.map((action) => [action, caps.find((c) => c.name.endsWith(`.${action}`))]));
  for (const action of CANVAS_ACTIONS) assert.ok(byAction[action], `${action} is projected`);

  for (const read of ["list", "get", "export"]) {
    assert.equal(byAction[read].riskLevel, "low", `${read} is low-risk`);
    assert.equal(byAction[read].requiresApproval, false, `${read} needs no approval`);
  }
  for (const write of ["create", "add_elements", "update_elements"]) {
    assert.equal(byAction[write].riskLevel, "medium", `${write} is medium`);
    assert.equal(byAction[write].requiresApproval, false);
  }
  assert.equal(byAction.remove_elements.riskLevel, "high");
  assert.equal(byAction.remove_elements.requiresApproval, true);
  // Ready without a Desktop Bridge: in-process application control.
  assert.equal(byAction.list.metadata.readiness.state, "ready");
});

test("read + write capabilities run in-process and return the scene/revision/changed ids", () => {
  const { invoke } = harness();
  assert.equal(invoke("list").result.output.count, 0);

  const created = invoke("create", { name: "Flow", elements: [] });
  assert.equal(created.ok, true);
  const sceneId = created.result.output.scene.id;
  assert.match(created.result.summary, /created/i);

  const added = invoke("add_elements", { sceneId, expectedRevision: 1, elements: [{ type: "rectangle" }] });
  assert.equal(added.ok, true);
  assert.equal(added.result.output.revision, 2);
  assert.equal(added.result.output.changedElementIds.length, 1);
});

test("remove_elements is approval-gated (single-use grant), reads are not", () => {
  const { invoke } = harness();
  const sceneId = invoke("create", { elements: [] }).result.output.scene.id;
  const elId = invoke("add_elements", { sceneId, expectedRevision: 1, elements: [{ type: "rectangle" }] }).result.output.changedElementIds[0];

  const denied = invoke("remove_elements", { sceneId, expectedRevision: 2, elementIds: [elId] });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 409);
  assert.equal(denied.body.error, "approval_required");

  const approved = invoke("remove_elements", { sceneId, expectedRevision: 2, elementIds: [elId], approvalToken: "grant-token" });
  assert.equal(approved.ok, true);
  assert.equal(approved.result.output.removedElementIds.length, 1);
});

test("capability handlers propagate service failures (revision conflict, bad reference)", () => {
  const { invoke } = harness();
  const sceneId = invoke("create", { elements: [] }).result.output.scene.id;

  const conflict = invoke("add_elements", { sceneId, expectedRevision: 99, elements: [{ type: "rectangle" }] });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "canvas_scene_revision_conflict");

  const badRef = invoke("remove_elements", { sceneId, expectedRevision: 1, elementIds: ["nope"], approvalToken: "t" });
  assert.equal(badRef.status, 400);
  assert.equal(badRef.body.error, "invalid_element_reference");
});
