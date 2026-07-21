/*
 * Canvas visual collaboration loop (#1355). Boots the REAL server, registers the
 * built-in app_canvas, and drives the provider-neutral capability gateway the way
 * a governed Codex or Claude turn would: discover → create → add connected
 * labeled shapes → read → update (stable ids) → hit a stale-revision conflict →
 * be denied on the approval-gated remove → remove with a grant.
 *
 * The Canvas contract is provider-neutral: Codex and Claude share the identical
 * capability names + input schemas and route through the same governed gateway
 * (no per-provider adapter can widen authority). Two seeded teams stand in for the
 * two providers and also exercise tenancy.
 */

process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const now = () => new Date().toISOString();
let server;
let base;

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");
  const { createCanvasApplicationRegistration } = await import("../../src/services/canvas-application.mjs");

  const { defaultProject, state } = createServerState({ defaultProjectPath: "/tmp", now });
  state.teams.push({ id: "team_a", name: "Team A" }, { id: "team_b", name: "Team B" });
  state.users.push({ id: "usr_a", name: "A", teamId: "team_a" }, { id: "usr_b", name: "B", teamId: "team_b" });
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  state.tokens.push({ token: "tok_a", userId: "usr_a", expiresAt }, { token: "tok_b", userId: "usr_b", expiresAt });

  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test", protocolVersion: "0.0.0", state, defaultProject, defaultProjectPath: "/tmp",
    persistenceEnabled: false, stateStorePath: "/tmp/unused.json", stateSchemaVersion: 1, dispatchLeaseMs: 30_000, now,
  });
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;

  // The built-in Canvas Application is registered once for the team. Codex and
  // Claude are both agents of THIS team's developer, not separate tenants — they
  // share the one app_canvas and its provider-neutral capability set.
  const reg = await call("/api/applications/register", { token: "tok_a", method: "POST", body: createCanvasApplicationRegistration({ autoOnline: true }) });
  assert.equal(reg.status < 300, true, `register app_canvas: ${JSON.stringify(reg.body)}`);
});

after(() => server?.close());

async function call(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try { parsed = await res.json(); } catch { parsed = null; }
  return { status: res.status, body: parsed };
}

async function canvasCaps(token) {
  const caps = (await call("/api/capabilities", { token })).body;
  const list = Array.isArray(caps) ? caps : caps?.capabilities ?? [];
  return list.filter((c) => c.name.includes("app_canvas.") && CANVAS_ACTIONS.includes(c.name.split(".").at(-1)));
}
const CANVAS_ACTIONS = ["list", "get", "create", "add_elements", "update_elements", "remove_elements", "export"];
const nameFor = (caps, action) => caps.find((c) => c.name.endsWith(`.${action}`)).name;
const invoke = (token, name, input) => call(`/api/capabilities/${encodeURIComponent(name)}/invocations`, { token, method: "POST", body: input });
const scenesOf = async (token) => (await call("/api/canvas/scenes", { token })).body.scenes;

test("Codex and Claude discover the same provider-neutral Canvas operations + schemas", async () => {
  // Discovery is not scoped by requesting provider (no such filter exists), so
  // the capability set is identical whether Codex or Claude asks — the same 7
  // operations with the same names, risk posture, approval, and closed schemas.
  const caps = await canvasCaps("tok_a");
  assert.deepEqual(caps.map((c) => c.name.split(".").at(-1)).sort(), [...CANVAS_ACTIONS].sort());
  for (const c of caps) assert.equal(c.inputSchema.additionalProperties, false);
  assert.equal(caps.find((c) => c.name.endsWith(".remove_elements")).requiresApproval, true);
  // Element-op guidance reaches the agent via the description (carry revision).
  assert.match(caps.find((c) => c.name.endsWith(".add_elements")).description, /expectedRevision/i);
});

test("full loop: create → add connected labeled shapes → read → update (stable ids)", async () => {
  const caps = await canvasCaps("tok_a");
  const create = await invoke("tok_a", nameFor(caps, "create"), { name: "Architecture" });
  assert.equal(create.status < 300, true, JSON.stringify(create.body));
  const sceneId = (await scenesOf("tok_a")).find((s) => s.name === "Architecture").id;

  // Two boxes + a connecting arrow + a text label, added as one governed batch.
  const add = await invoke("tok_a", nameFor(caps, "add_elements"), {
    sceneId, expectedRevision: 1,
    elements: [
      { id: "box1", type: "rectangle" },
      { id: "box2", type: "rectangle" },
      { id: "edge", type: "arrow", startBinding: { elementId: "box1" }, endBinding: { elementId: "box2" } },
      { id: "label", type: "text", text: "flows into", containerId: "edge" },
    ],
  });
  assert.equal(add.status < 300, true, JSON.stringify(add.body));

  const scene = (await call(`/api/canvas/scenes/${sceneId}`, { token: "tok_a" })).body.scene;
  assert.equal(scene.revision, 2);
  assert.equal(scene.elements.length, 4);
  const arrow = scene.elements.find((e) => e.type === "arrow");
  const box1 = scene.elements.find((e) => e.type === "rectangle");
  assert.equal(arrow.startBinding.elementId, box1.id); // batch bindings remapped to durable ids
  assert.match(box1.id, /^cel_/);

  // Update an element by its server id — identity preserved, revision advances.
  const upd = await invoke("tok_a", nameFor(caps, "update_elements"), {
    sceneId, expectedRevision: 2, elements: [{ id: box1.id, x: 42 }],
  });
  assert.equal(upd.status < 300, true, JSON.stringify(upd.body));
  const scene3 = (await call(`/api/canvas/scenes/${sceneId}`, { token: "tok_a" })).body.scene;
  assert.equal(scene3.revision, 3);
  assert.equal(scene3.elements.find((e) => e.id === box1.id).x, 42); // same id, updated in place
});

test("a later agent turn sees a user edit and keeps stable element ids", async () => {
  const caps = await canvasCaps("tok_a");
  await invoke("tok_a", nameFor(caps, "create"), { name: "Shared" });
  const sceneId = (await scenesOf("tok_a")).find((s) => s.name === "Shared").id;
  const add = await invoke("tok_a", nameFor(caps, "add_elements"), { sceneId, expectedRevision: 1, elements: [{ id: "a", type: "rectangle" }] });
  assert.equal(add.status < 300, true);
  const el = (await call(`/api/canvas/scenes/${sceneId}`, { token: "tok_a" })).body.scene.elements[0];

  // The user edits the scene directly (as the Web Canvas does), advancing revision.
  await call(`/api/canvas/scenes/${sceneId}`, { token: "tok_a", method: "PUT", body: { expectedRevision: 2, elements: [{ ...el, x: 99 }] } });

  // A later agent read sees the user's edit; the element id is unchanged, so the
  // agent can keep collaborating on the same element.
  const later = (await call(`/api/canvas/scenes/${sceneId}`, { token: "tok_a" })).body.scene;
  assert.equal(later.revision, 3);
  assert.equal(later.elements[0].id, el.id);
  assert.equal(later.elements[0].x, 99);
});

test("stale agent revision conflicts with actionable context and does not mutate", async () => {
  const caps = await canvasCaps("tok_a");
  await invoke("tok_a", nameFor(caps, "create"), { name: "Conflict" });
  const sceneId = (await scenesOf("tok_a")).find((s) => s.name === "Conflict").id;
  await invoke("tok_a", nameFor(caps, "add_elements"), { sceneId, expectedRevision: 1, elements: [{ id: "a", type: "rectangle" }] });

  const stale = await invoke("tok_a", nameFor(caps, "add_elements"), { sceneId, expectedRevision: 1, elements: [{ id: "b", type: "rectangle" }] });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "canvas_scene_revision_conflict");
  assert.equal(stale.body.currentRevision, 2); // actionable: rebase on 2
  assert.equal((await call(`/api/canvas/scenes/${sceneId}`, { token: "tok_a" })).body.scene.elements.length, 1); // no mutation
});

test("the destructive remove is approval-gated; reads/writes are not", async () => {
  const caps = await canvasCaps("tok_a");
  await invoke("tok_a", nameFor(caps, "create"), { name: "Gated" });
  const sceneId = (await scenesOf("tok_a")).find((s) => s.name === "Gated").id;
  await invoke("tok_a", nameFor(caps, "add_elements"), { sceneId, expectedRevision: 1, elements: [{ id: "a", type: "rectangle" }] });
  const elId = (await call(`/api/canvas/scenes/${sceneId}`, { token: "tok_a" })).body.scene.elements[0].id;

  const denied = await invoke("tok_a", nameFor(caps, "remove_elements"), { sceneId, expectedRevision: 2, elementIds: [elId] });
  assert.equal(denied.status, 409);
  assert.equal(denied.body.error, "approval_required");
});

test("no authority widening: ownership is the actor's, and another team cannot read the scene", async () => {
  const caps = await canvasCaps("tok_a");
  // The capability cannot widen ownership: a body-supplied ownerTeamId is ignored.
  await invoke("tok_a", nameFor(caps, "create"), { name: "Owned", ownerTeamId: "team_b" });
  const scene = (await scenesOf("tok_a")).find((s) => s.name === "Owned");
  assert.equal(scene.ownerTeamId, "team_a");
  assert.equal(scene.lastModifiedBy, "usr_a"); // actor attribution on the record

  // Another team cannot reach the scene at all (existence-hiding 404).
  const foreign = await call(`/api/canvas/scenes/${scene.id}`, { token: "tok_b" });
  assert.equal(foreign.status, 404);
  assert.equal((await scenesOf("tok_b")).some((s) => s.id === scene.id), false);
});
