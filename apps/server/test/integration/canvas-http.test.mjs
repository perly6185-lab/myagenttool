/*
 * Canvas scene API — end-to-end HTTP + tenancy (#1352). Boots the REAL server
 * (same composition as src/index.mjs) with MYAGENT_REQUIRE_AUTH=1 and two
 * hand-seeded teams, then drives the 5 endpoints over actual HTTP. Proves the
 * tenancy guards, existence-hiding, optimistic concurrency, and bounds hold
 * through the whole dispatch stack.
 */

process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const TEAM_A = "team_a";
const TEAM_B = "team_b";
const now = () => new Date().toISOString();

let server;
let base;

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");

  const { defaultProject, state } = createServerState({ defaultProjectPath: "/tmp", now });
  state.teams.push({ id: TEAM_A, name: "Team A" }, { id: TEAM_B, name: "Team B" });
  state.users.push({ id: "usr_a", name: "A", teamId: TEAM_A }, { id: "usr_b", name: "B", teamId: TEAM_B });
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  state.tokens.push({ token: "tok_a", userId: "usr_a", expiresAt }, { token: "tok_b", userId: "usr_b", expiresAt });
  state.projects.push(
    { id: "projA", name: "Project A", ownerTeamId: TEAM_A, path: "/tmp/a", createdAt: now() },
    { id: "projB", name: "Project B", ownerTeamId: TEAM_B, path: "/tmp/b", createdAt: now() },
  );

  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test", protocolVersion: "0.0.0", state, defaultProject, defaultProjectPath: "/tmp",
    persistenceEnabled: false, stateStorePath: "/tmp/unused.json", stateSchemaVersion: 1, dispatchLeaseMs: 30_000, now,
  });
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
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

const rect = (id) => ({ id, type: "rectangle", x: 0, y: 0, width: 10, height: 10 });

test("unauthenticated writes are rejected", async () => {
  const res = await call("/api/canvas/scenes", { method: "POST", body: { name: "x", elements: [] } });
  assert.equal(res.status, 401);
});

test("create stamps ownership from the token, not the body", async () => {
  const res = await call("/api/canvas/scenes", {
    token: "tok_a", method: "POST",
    body: { name: "Team A diagram", elements: [rect("a")], ownerTeamId: TEAM_B, createdBy: "usr_b" },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.scene.ownerTeamId, TEAM_A);
  assert.equal(res.body.scene.createdBy, "usr_a");
  assert.equal(res.body.scene.revision, 1);
});

test("scenes are team-scoped and foreign access is hidden as an identical 404", async () => {
  const created = (await call("/api/canvas/scenes", { token: "tok_a", method: "POST", body: { name: "S", elements: [] } })).body.scene;

  assert.equal((await call("/api/canvas/scenes", { token: "tok_a" })).body.scenes.some((s) => s.id === created.id), true);
  assert.equal((await call("/api/canvas/scenes", { token: "tok_b" })).body.scenes.some((s) => s.id === created.id), false);

  const foreignGet = await call(`/api/canvas/scenes/${created.id}`, { token: "tok_b" });
  const missingGet = await call(`/api/canvas/scenes/cvs_missing`, { token: "tok_b" });
  assert.equal(foreignGet.status, 404);
  assert.deepEqual(foreignGet.body, missingGet.body);

  const foreignPut = await call(`/api/canvas/scenes/${created.id}`, { token: "tok_b", method: "PUT", body: { expectedRevision: 1, elements: [rect("x")] } });
  const missingPut = await call(`/api/canvas/scenes/cvs_missing`, { token: "tok_b", method: "PUT", body: { expectedRevision: 1, elements: [rect("x")] } });
  assert.equal(foreignPut.status, 404);
  assert.deepEqual(foreignPut.body, missingPut.body);
});

test("optimistic concurrency: stale expectedRevision is a typed 409 with no mutation", async () => {
  const created = (await call("/api/canvas/scenes", { token: "tok_a", method: "POST", body: { name: "S", elements: [rect("a")] } })).body.scene;

  const stale = await call(`/api/canvas/scenes/${created.id}`, { token: "tok_a", method: "PUT", body: { expectedRevision: 99, elements: [rect("a"), rect("b")] } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "canvas_scene_revision_conflict");
  assert.equal(stale.body.currentRevision, 1);

  const fresh = await call(`/api/canvas/scenes/${created.id}`, { token: "tok_a" });
  assert.equal(fresh.body.scene.elements.length, 1); // untouched

  const ok = await call(`/api/canvas/scenes/${created.id}`, { token: "tok_a", method: "PUT", body: { expectedRevision: 1, elements: [rect("a"), rect("b")] } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.scene.revision, 2);
});

test("project scope is validated against the actor", async () => {
  const foreign = await call("/api/canvas/scenes", { token: "tok_a", method: "POST", body: { elements: [], projectId: "projB" } });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, "project_not_found");
  const own = await call("/api/canvas/scenes", { token: "tok_a", method: "POST", body: { elements: [], projectId: "projA" } });
  assert.equal(own.status, 201);
});

test("embedded-URL policy fails closed over HTTP", async () => {
  const res = await call("/api/canvas/scenes", { token: "tok_a", method: "POST", body: { elements: [{ id: "a", type: "rectangle", link: "javascript:alert(1)" }] } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "unsupported_canvas_url");
});

test("delete is revision-gated and removes the scene", async () => {
  const created = (await call("/api/canvas/scenes", { token: "tok_a", method: "POST", body: { name: "S", elements: [] } })).body.scene;
  assert.equal((await call(`/api/canvas/scenes/${created.id}`, { token: "tok_a", method: "DELETE", body: { expectedRevision: 9 } })).status, 409);
  assert.equal((await call(`/api/canvas/scenes/${created.id}`, { token: "tok_a", method: "DELETE", body: { expectedRevision: 1 } })).status, 200);
  assert.equal((await call(`/api/canvas/scenes/${created.id}`, { token: "tok_a" })).status, 404);
});
