process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENT_LOCAL_MODE = "1";
process.env.MYAGENT_SECURE_COOKIES = "0";
process.env.MYAGENT_LEGACY_BEARER_AUTH = "0";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

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

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");
  const now = () => new Date().toISOString();
  const { defaultProject, state } = createServerState({ defaultProjectPath: "/tmp", now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "identity-test",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: "/tmp",
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused-identity.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: "identity-test",
    protocolVersion: "0.0.0",
    ...httpDependencies,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test("cookie session is explicit, HttpOnly, CSRF-protected, and revocable", async () => {
  const implicit = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(implicit.status, 400);

  const login = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "local" }),
  });
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  assert.equal(Object.hasOwn(loginBody, "token"), false);
  const setCookie = login.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /myagenttool_session=.*HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const cookies = cookiesFrom(login);
  const cookieHeader = Object.entries(cookies).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("; ");

  const state = await fetch(`${base}/api/state`, { headers: { cookie: cookieHeader } });
  assert.equal(state.status, 200);
  const current = await fetch(`${base}/api/session`, { headers: { cookie: cookieHeader } });
  assert.equal(current.status, 200);
  assert.deepEqual((await current.json()).session.currentDevice, true);

  const missingCsrf = await fetch(`${base}/api/device`, {
    method: "PATCH",
    headers: { cookie: cookieHeader, "content-type": "application/json" },
    body: JSON.stringify({ maxConcurrency: 2 }),
  });
  assert.equal(missingCsrf.status, 403);
  assert.equal((await missingCsrf.json()).error, "csrf_invalid");

  const validCsrf = await fetch(`${base}/api/device`, {
    method: "PATCH",
    headers: {
      cookie: cookieHeader,
      "content-type": "application/json",
      "x-csrf-token": cookies.myagenttool_csrf,
    },
    body: JSON.stringify({ maxConcurrency: 2 }),
  });
  assert.equal(validCsrf.status, 200);

  const logout = await fetch(`${base}/api/session`, {
    method: "DELETE",
    headers: { cookie: cookieHeader, "x-csrf-token": cookies.myagenttool_csrf },
  });
  assert.equal(logout.status, 204);
  const afterLogout = await fetch(`${base}/api/state`, { headers: { cookie: cookieHeader } });
  assert.equal(afterLogout.status, 401);
});

test("all-device logout revokes the current epoch and clears the browser session", async () => {
  const login = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "local" }),
  });
  const cookies = cookiesFrom(login);
  const cookieHeader = Object.entries(cookies).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("; ");
  const logout = await fetch(`${base}/api/sessions`, {
    method: "DELETE",
    headers: { cookie: cookieHeader, "x-csrf-token": cookies.myagenttool_csrf },
  });
  assert.equal(logout.status, 204);
  assert.equal((await fetch(`${base}/api/session`, { headers: { cookie: cookieHeader } })).status, 401);
});
