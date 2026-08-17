// HTTP integration for the session-manager routes: real server + fetch on
// 127.0.0.1, SHIM site CLI (no browser). Mirrors integration/work-items-http.
process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, before, test } from "node:test";

// SHIM probe CLI: {"ok":true,"loggedIn":true,"detail":"z_c0 present"}.
const SHIM = String.raw`
process.stdout.write(JSON.stringify({ ok: true, loggedIn: true, detail: "z_c0 present" }) + "\n");
`;

let server;
let base;
let closeRuntimeServices;
let runtimeState;
const root = mkdtempSync(join(tmpdir(), "myagenttool-sessions-http-"));
const projectPath = join(root, "a");

before(async () => {
  const shimDir = mkdtempSync(join(tmpdir(), "myagenttool-sessions-shim-"));
  const shimPath = join(shimDir, "shim.mjs");
  writeFileSync(shimPath, SHIM, "utf8");
  process.env.MYAGENTTOOL_SESSION_ZHIHU_COMMAND_JSON = JSON.stringify([process.execPath, shimPath]);

  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");
  const now = () => new Date().toISOString();
  mkdirSync(projectPath, { recursive: true });
  execFileSync("git", ["init", "-b", "main", projectPath]);
  execFileSync("git", ["-C", projectPath, "config", "user.email", "test@example.test"]);
  execFileSync("git", ["-C", projectPath, "config", "user.name", "Test"]);
  writeFileSync(join(projectPath, "README.md"), "# test\n");
  execFileSync("git", ["-C", projectPath, "add", "README.md"]);
  execFileSync("git", ["-C", projectPath, "commit", "-m", "initial"]);
  const { defaultProject, state } = createServerState({ defaultProjectPath: projectPath, now });
  runtimeState = state;
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  state.users.push({ id: "usr_a", teamId: "team_a" });
  state.tokens.push({ token: "tok_a", userId: "usr_a", expiresAt });
  const runtimeServices = createServerRuntimeServices({
    namespace: "test", protocolVersion: "0.0.0", state, defaultProject, defaultProjectPath: "/tmp",
    persistenceEnabled: false, stateStorePath: join(root, "state", "local-demo-state.json"), stateSchemaVersion: 1, dispatchLeaseMs: 30_000, now,
  });
  const { httpDependencies } = runtimeServices;
  closeRuntimeServices = runtimeServices.closeRuntimeServices;
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve) ?? resolve());
  await closeRuntimeServices?.();
  rmSync(root, { recursive: true, force: true });
});

async function call(path, { token = "tok_a", method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

test("GET /api/sessions lists the registry with unknown status before any probe", async () => {
  const { status, body } = await call("/api/sessions");
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.sessions));
  const zhihu = body.sessions.find((s) => s.site === "zhihu");
  assert.ok(zhihu, "zhihu card present");
  assert.equal(zhihu.status, "unknown");
  assert.equal(zhihu.lastProbeAt, null);
  assert.equal(zhihu.authMethod, "persistent_profile");
  assert.equal(zhihu.heartbeatTier, "logged_in");
  // The manual-tier card: probe on demand only, no sweep interval (quota).
  const qichacha = body.sessions.find((s) => s.site === "qichacha");
  assert.ok(qichacha, "qichacha card present");
  assert.equal(qichacha.status, "unknown");
  assert.equal(qichacha.heartbeatTier, "manual");
  assert.equal(qichacha.heartbeatIntervalMinutes, null);
});

test("GET /api/sessions requires auth", async () => {
  const response = await fetch(`${base}/api/sessions`);
  assert.ok(response.status === 401 || response.status === 403, `status=${response.status}`);
});

test("POST /api/sessions/zhihu/probe runs the site CLI and records the session", async () => {
  const { status, body } = await call("/api/sessions/zhihu/probe", { method: "POST" });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.loggedIn, true);
  assert.equal(body.detail, "z_c0 present");
  assert.equal(body.session.status, "active");

  // The durable row feeds the merged listing.
  const listed = await call("/api/sessions");
  const zhihu = listed.body.sessions.find((s) => s.site === "zhihu");
  assert.equal(zhihu.status, "active");
  assert.ok(zhihu.lastProbeAt);
  // And the runtime state carries the row for persistence.
  assert.ok(runtimeState.sessions.some((row) => row.site === "zhihu" && row.status === "active"));
});

test("POST /api/sessions/:site/probe returns 404 for an unknown site", async () => {
  const { status, body } = await call("/api/sessions/nonexistent/probe", { method: "POST" });
  assert.equal(status, 404);
  assert.equal(body.error, "session_site_unknown");
});

test("POST /api/sessions/:site/reauth returns 404 for an unknown site", async () => {
  const { status, body } = await call("/api/sessions/nonexistent/reauth", { method: "POST" });
  assert.equal(status, 404);
  assert.equal(body.error, "session_site_unknown");
});
