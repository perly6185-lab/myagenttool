process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENT_LOCAL_MODE = "1";
process.env.MYAGENT_SECURE_COOKIES = "0";
process.env.MYAGENT_LEGACY_BEARER_AUTH = "0";
process.env.MYAGENT_LEGACY_LOCAL_LOGIN = "0";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { hashPassword } from "../../src/runtime/auth.mjs";

let server;
let base;

function cookiesFrom(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : String(response.headers.get("set-cookie") ?? "").split(/,\s*(?=[^;,]+=)/);
  return Object.fromEntries(values.map((value) => {
    const [pair] = value.split(";");
    const index = pair.indexOf("=");
    return [pair.slice(0, index), decodeURIComponent(pair.slice(index + 1))];
  }));
}

function cookieHeader(cookies) {
  return Object.entries(cookies)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("; ");
}

async function json(response) {
  return response.json().catch(() => ({}));
}

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");
  const now = () => new Date().toISOString();
  const { defaultProject, state } = createServerState({ defaultProjectPath: "/tmp", now });
  state.teams.unshift({ id: "team_a", name: "Team A", slug: "team-a", createdAt: now() });
  state.users.unshift(
    {
      id: "usr_owner",
      name: "Owner",
      teamId: "team_a",
      role: "owner",
      sessionEpoch: 0,
      passwordHash: hashPassword("owner access passphrase"),
      createdAt: now(),
    },
    {
      id: "usr_member",
      name: "Member",
      teamId: "team_a",
      role: "operator",
      sessionEpoch: 0,
      passwordHash: hashPassword("member original password"),
      createdAt: now(),
    },
  );
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "recovery-test",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: "/tmp",
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused-recovery.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: "recovery-test",
    protocolVersion: "0.0.0",
    ...httpDependencies,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test("administrator grant rotates a credential and invalidates every existing session", async () => {
  const memberLogin = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "password",
      teamId: "team_a",
      userId: "usr_member",
      password: "member original password",
    }),
  });
  assert.equal(memberLogin.status, 200);
  const memberCookies = cookiesFrom(memberLogin);

  const ownerLogin = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "password",
      teamId: "team_a",
      userId: "usr_owner",
      password: "owner access passphrase",
    }),
  });
  assert.equal(ownerLogin.status, 200);
  const ownerCookies = cookiesFrom(ownerLogin);

  const issue = await fetch(`${base}/api/identity/recovery-grants`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader(ownerCookies),
      "x-csrf-token": ownerCookies.myagenttool_csrf,
    },
    body: JSON.stringify({ userId: "usr_member", purpose: "password_reset" }),
  });
  assert.equal(issue.status, 201);
  const issued = await json(issue);
  assert.match(issued.recoveryToken, /^rgr_/);

  const complete = await fetch(`${base}/api/identity/recovery/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      teamId: "team_a",
      userId: "usr_member",
      recoveryToken: issued.recoveryToken,
      newPassword: "member replacement passphrase",
    }),
  });
  assert.equal(complete.status, 200);
  assert.equal((await json(complete)).completed, true);

  const oldSession = await fetch(`${base}/api/session`, {
    headers: { cookie: cookieHeader(memberCookies) },
  });
  assert.equal(oldSession.status, 401);

  const replay = await fetch(`${base}/api/identity/recovery/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      teamId: "team_a",
      userId: "usr_member",
      recoveryToken: issued.recoveryToken,
      newPassword: "member second passphrase",
    }),
  });
  assert.equal(replay.status, 401);
  assert.deepEqual(await json(replay), { ok: false, error: "recovery_failed" });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rejected = await fetch(`${base}/api/identity/recovery/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: "team_a",
        userId: "usr_member",
        recoveryToken: "rgr_invalid",
        newPassword: "member second passphrase",
      }),
    });
    assert.equal(rejected.status, 401);
  }
  const throttled = await fetch(`${base}/api/identity/recovery/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      teamId: "team_a",
      userId: "usr_member",
      recoveryToken: "rgr_invalid",
      newPassword: "member second passphrase",
    }),
  });
  assert.equal(throttled.status, 429);
  assert.deepEqual(await json(throttled), { ok: false, error: "recovery_failed" });

  const newLogin = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "password",
      teamId: "team_a",
      userId: "usr_member",
      password: "member replacement passphrase",
    }),
  });
  assert.equal(newLogin.status, 200);
});
