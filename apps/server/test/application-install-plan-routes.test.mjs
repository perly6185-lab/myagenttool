import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

let server;
let base;
let state;

before(async () => {
  const { createServerState } = await import("../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../src/runtime/http-server.mjs");
  const projectDir = mkdtempSync(join(tmpdir(), "application-install-plan-"));
  const created = createServerState({ defaultProjectPath: projectDir, now: () => new Date().toISOString() });
  state = created.state;
  state.projects.push({ id: "proj_foreign", name: "Foreign", path: projectDir, ownerTeamId: "team_foreign" });
  state.users.push({ id: "usr_foreign", teamId: "team_foreign", role: "owner" });
  state.tokens.push({ token: "foreign-token", userId: "usr_foreign", expiresAt: Date.now() + 60_000 });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test", protocolVersion: "0.0.0", state, defaultProject: created.defaultProject,
    defaultProjectPath: projectDir, persistenceEnabled: false, stateStorePath: "/tmp/unused.json",
    stateSchemaVersion: 1, dispatchLeaseMs: 30_000, now: () => new Date().toISOString(),
  });
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test("P1 HTTP catalog and plan endpoints are additive and plan-only", async () => {
  const applications = await call("/api/applications/quick-register/catalog");
  assert.equal(applications.status, 200);
  assert.deepEqual(applications.body.applications.map((entry) => entry.name), ["markdown", "git", "ccusage", "claude", "codex"]);
  const runtimes = await call("/api/runtimes/catalog");
  assert.equal(runtimes.status, 200);
  assert.deepEqual(runtimes.body.runtimes.filter((entry) => entry.kind === "shell").map((entry) => entry.id), ["runtime_git_bash", "runtime_wsl"]);
  const catalog = await call("/api/runtimes/install/catalog");
  assert.equal(catalog.status, 200);
  assert.deepEqual(catalog.body.runtimes.map((entry) => entry.name), ["git", "git-bash", "wsl", "ccusage", "claude", "codex"]);
  const planned = await call("/api/runtimes/install/plan", { method: "POST", body: { name: "ccusage", deviceId: state.device.id, projectId: state.projects[0].id } });
  assert.equal(planned.status, 200, JSON.stringify(planned.body));
  assert.equal(planned.body.plan.execution.shell, false);
  assert.equal(state.events.some((event) => /install/i.test(event.type)), false, "P1 must not execute or enqueue installation work");
});

test("P1 HTTP endpoint fails closed for injection and foreign scope", async () => {
  const injected = await call("/api/applications/install/plan", { method: "POST", body: { name: "git", command: "calc.exe" } });
  assert.equal(injected.status, 400);
  assert.equal(injected.body.error, "install_plan_fields_not_allowed");
  const foreignProject = await call("/api/applications/install/plan", { method: "POST", body: { name: "git", projectId: "proj_foreign" } });
  assert.equal(foreignProject.status, 404);
  assert.equal(foreignProject.body.error, "project_not_found");
  const foreignDevice = await call("/api/applications/install/plan", { method: "POST", token: "foreign-token", body: { name: "git", deviceId: state.device.id } });
  assert.equal(foreignDevice.status, 404);
  assert.equal(foreignDevice.body.error, "device_not_found");
});

async function call(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
