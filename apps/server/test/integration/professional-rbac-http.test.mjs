process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENT_LEGACY_BEARER_AUTH = "1";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const now = () => new Date().toISOString();

let base;
let fixtureRoot;
let server;
let state;

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");

  fixtureRoot = mkdtempSync(join(tmpdir(), "myagenttool-professional-rbac-"));
  const created = createServerState({ defaultProjectPath: fixtureRoot, now });
  state = created.state;
  state.users.push(
    { id: "usr_owner_rbac", name: "Owner", teamId: "team_local", role: "owner" },
    { id: "usr_admin_rbac", name: "Admin", teamId: "team_local", role: "admin" },
    { id: "usr_operator_rbac", name: "Operator", teamId: "team_local", role: "operator" },
    { id: "usr_viewer_rbac", name: "Viewer", teamId: "team_local", role: "viewer" },
  );
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  state.tokens.push(
    { token: "tok_owner_rbac", userId: "usr_owner_rbac", expiresAt },
    { token: "tok_admin_rbac", userId: "usr_admin_rbac", expiresAt },
    { token: "tok_operator_rbac", userId: "usr_operator_rbac", expiresAt },
    { token: "tok_viewer_rbac", userId: "usr_viewer_rbac", expiresAt },
  );

  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProject: created.defaultProject,
    defaultProjectPath: fixtureRoot,
    persistenceEnabled: false,
    stateStorePath: join(fixtureRoot, "unused.json"),
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: "test",
    protocolVersion: "0.0.0",
    ...httpDependencies,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
});

test("owner and admin may change professional configuration", async () => {
  const owner = await call("/api/device", { method: "PATCH", token: "tok_owner_rbac", body: { maxConcurrency: 3 } });
  assert.equal(owner.status, 200, JSON.stringify(owner.body));
  assert.equal(owner.body.device.maxConcurrency, 3);

  const admin = await call("/api/device", { method: "PATCH", token: "tok_admin_rbac", body: { maxConcurrency: 4 } });
  assert.equal(admin.status, 200, JSON.stringify(admin.body));
  assert.equal(admin.body.device.maxConcurrency, 4);
});

test("operator and viewer are rejected before professional configuration mutates", async () => {
  const beforeCount = state.agents.length;
  for (const token of ["tok_operator_rbac", "tok_viewer_rbac"]) {
    const response = await call("/api/agents", { method: "POST", token, body: { name: "Blocked agent" } });
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.deepEqual(response.body, {
      error: "role_forbidden",
      requiredCapability: "manage",
      message: "This action requires an owner or administrator.",
    });
  }
  assert.equal(state.agents.length, beforeCount);
});

test("operator may execute professional operations while viewer may not", async () => {
  const operator = await call("/api/automations/missing/run", { method: "POST", token: "tok_operator_rbac", body: {} });
  assert.equal(operator.status, 404, "operator should reach the route's normal not-found response");
  assert.equal(operator.body.error, "automation_not_found");

  const viewer = await call("/api/automations/missing/run", { method: "POST", token: "tok_viewer_rbac", body: {} });
  assert.equal(viewer.status, 403);
  assert.equal(viewer.body.error, "role_forbidden");
  assert.equal(viewer.body.requiredCapability, "operate");
});

test("viewer keeps read access and ordinary-user workflow writes", async () => {
  const snapshot = await call("/api/state", { token: "tok_viewer_rbac" });
  assert.equal(snapshot.status, 200, JSON.stringify(snapshot.body));

  const workItem = await call("/api/work-items", { method: "POST", token: "tok_viewer_rbac", body: {} });
  assert.notEqual(workItem.status, 403, "professional RBAC must not intercept ordinary-user workflow writes");
});

async function call(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}
