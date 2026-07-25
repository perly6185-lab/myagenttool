/*
 * End-to-end multi-user plumbing test.
 *
 * Where tenancy-http.test.mjs hand-seeds a second team, this one provisions the
 * whole tenant through the REAL APIs — create-team, create-user, multi-user
 * login (POST /api/session {userId}), and project creation — then confirms a
 * project made by team A is owned by team A and isolated from team B. It proves
 * the plumbing that makes tenancy reachable actually works, not just the guards.
 */

process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const now = () => new Date().toISOString();

let server;
let base;

async function call(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");

  const { defaultProject, state } = createServerState({ defaultProjectPath: "/tmp", now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: "/tmp",
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

// Shared across tests, populated by the provisioning test below.
const ctx = {};

test("provision two tenants through the real APIs (team, user, multi-user login)", async () => {
  // Bootstrap: the seeded local user logs in (no credential in demo mode).
  const local = await call("/api/session", { method: "POST", body: {} });
  assert.equal(local.status, 200);

  const invalidWebhookTeam = await call("/api/teams", {
    token: local.body.token,
    method: "POST",
    body: { name: "Invalid target", alertWebhookUrl: "file:///tmp/not-a-webhook" },
  });
  assert.equal(invalidWebhookTeam.status, 400);
  assert.equal(invalidWebhookTeam.body.error, "invalid_alert_webhook_url");

  const teamA = await call("/api/teams", { token: local.body.token, method: "POST", body: { name: "Team A" } });
  const teamB = await call("/api/teams", { token: local.body.token, method: "POST", body: { name: "Team B" } });
  assert.equal(teamA.status, 201);
  assert.equal(teamB.status, 201);
  ctx.teamAId = teamA.body.team.id;
  ctx.teamBId = teamB.body.team.id;

  const userA = await call("/api/users", { token: local.body.token, method: "POST", body: { name: "Alice", teamId: ctx.teamAId } });
  const userB = await call("/api/users", { token: local.body.token, method: "POST", body: { name: "Bob", teamId: ctx.teamBId } });
  assert.equal(userA.status, 201);
  assert.equal(userB.body.user.teamId, ctx.teamBId);

  const loginA = await call("/api/session", { method: "POST", body: { userId: userA.body.user.id } });
  const loginB = await call("/api/session", { method: "POST", body: { userId: userB.body.user.id } });
  assert.equal(loginA.status, 200);
  assert.equal(loginA.body.user.teamId, ctx.teamAId, "login mints a token scoped to the user's team");
  ctx.tokA = loginA.body.token;
  ctx.tokB = loginB.body.token;
});

test("login with an unknown user is rejected (404)", async () => {
  const r = await call("/api/session", { method: "POST", body: { userId: "usr_nope" } });
  assert.equal(r.status, 404);
});

test("credentialed login: a password-protected user needs the right password", async () => {
  // Bootstrap login (seeded local user is passwordless).
  const local = await call("/api/session", { method: "POST", body: {} });
  const carol = await call("/api/users", {
    token: local.body.token,
    method: "POST",
    body: { name: "Carol", teamId: ctx.teamAId, password: "s3cret" },
  });
  assert.equal(carol.status, 201);
  assert.equal(carol.body.user.passwordHash, undefined, "the response must not echo the hash");
  const uid = carol.body.user.id;

  const wrong = await call("/api/session", { method: "POST", body: { userId: uid, password: "nope" } });
  assert.equal(wrong.status, 401, "wrong password is rejected");
  const none = await call("/api/session", { method: "POST", body: { userId: uid } });
  assert.equal(none.status, 401, "no password is rejected for a credentialed user");
  const ok = await call("/api/session", { method: "POST", body: { userId: uid, password: "s3cret" } });
  assert.equal(ok.status, 200, "the right password logs in");
});

test("password hashes are never exposed in public state", async () => {
  const state = await call("/api/state", { token: ctx.tokA });
  assert.equal(state.status, 200);
  for (const u of state.body.users ?? []) {
    assert.equal(u.passwordHash, undefined, `user ${u.id} must not expose passwordHash`);
  }
});

test("a project created by team A is owned by team A", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-proja-"));
  const created = await call("/api/projects/create", { token: ctx.tokA, method: "POST", body: { name: "A repo", path: dir } });
  assert.equal(created.status, 201);
  assert.equal(created.body.project.ownerTeamId, ctx.teamAId, "ownerTeamId defaults to the creator's team");
  ctx.projAId = created.body.project.id;
});

test("team B cannot see team A's project, and team A can", async () => {
  const b = await call("/api/state", { token: ctx.tokB });
  assert.ok(!(b.body.projects ?? []).some((p) => p.id === ctx.projAId), "team B must not see team A's project");
  const a = await call("/api/state", { token: ctx.tokA });
  assert.ok((a.body.projects ?? []).some((p) => p.id === ctx.projAId), "team A sees its own project");
});

test("team B cannot act on team A's automation (created via API)", async () => {
  const auto = await call("/api/automations", {
    token: ctx.tokA,
    method: "POST",
    body: { projectId: ctx.projAId, name: "A nightly", prompt: "p" },
  });
  assert.equal(auto.status, 201);
  const autoId = auto.body.automation.id;

  const foreign = await call(`/api/automations/${autoId}`, { token: ctx.tokB, method: "DELETE" });
  assert.equal(foreign.status, 404, "team B cannot delete team A's automation");

  const owner = await call(`/api/automations/${autoId}`, { token: ctx.tokA, method: "PATCH", body: { prompt: "p2" } });
  assert.equal(owner.status, 200, "team A can update its own automation");
});

test("provisioning RBAC: a non-admin (operator) cannot create teams or users", async () => {
  const local = await call("/api/session", { method: "POST", body: {} });
  const op = await call("/api/users", {
    token: local.body.token,
    method: "POST",
    body: { name: "Op", teamId: ctx.teamAId, role: "operator", password: "p" },
  });
  assert.equal(op.status, 201);
  const opLogin = await call("/api/session", { method: "POST", body: { userId: op.body.user.id, password: "p" } });
  const opTok = opLogin.body.token;

  const team = await call("/api/teams", { token: opTok, method: "POST", body: { name: "Sneaky" } });
  assert.equal(team.status, 403, "operator cannot create a team");
  const user = await call("/api/users", { token: opTok, method: "POST", body: { name: "X", teamId: ctx.teamAId } });
  assert.equal(user.status, 403, "operator cannot create a user");
  const globalConfig = await call("/api/auto-run-settings", {
    token: opTok,
    method: "PUT",
    body: { autonomyKillSwitch: true, alertWebhookUrl: "https://user:secret@hooks.example.test/global" },
  });
  assert.equal(globalConfig.status, 403, "operator cannot mutate global Auto-run safety settings");

  // The seeded local owner still can (bootstrap path).
  const ok = await call("/api/teams", { token: local.body.token, method: "POST", body: { name: "Owned" } });
  assert.equal(ok.status, 201);
  const ownerConfig = await call("/api/auto-run-settings", {
    token: local.body.token,
    method: "PUT",
    body: { alertWebhookUrl: "https://user:secret@hooks.example.test/global" },
  });
  assert.equal(ownerConfig.status, 200);
  assert.equal(ownerConfig.body.config.alertWebhookConfigured, true);
  assert.equal("alertWebhookUrl" in ownerConfig.body.config.settings, false);
  assert.equal(JSON.stringify(ownerConfig.body).includes("user:secret@hooks.example.test"), false);
});
