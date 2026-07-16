/*
 * T2 (#1135): the Teams outbound client — Azure AD access_token cache and reply
 * via the inbound serviceUrl/conversation. No secret material leaks.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createTeamsClient } from "../src/gateway/teams-client.mjs";

const SECRET = "teams-app-password-must-never-leak";
const RC = { serviceUrl: "https://smba.example/amer/", conversationId: "conv_1" };

function makeClient({ responses }) {
  const calls = [];
  let clock = 1_800_000_000_000;
  const client = createTeamsClient({
    appId: "app-id", appPassword: SECRET, now: () => clock,
    httpJson: async (url, options) => { calls.push({ url, options }); const n = responses.shift(); return typeof n === "function" ? n({ url, options }) : n; },
  });
  return { client, calls, advance: (ms) => { clock += ms; } };
}

test("caches the AAD token, single-flights, refreshes on expiry, and posts to the reply serviceUrl", async () => {
  const { client, calls, advance } = makeClient({
    responses: [
      { status: 200, json: { access_token: "t-A", expires_in: 3600 } },
      { status: 201, json: { id: "act_out_1" } },
      { status: 201, json: { id: "act_out_2" } },
      { status: 200, json: { access_token: "t-B", expires_in: 3600 } },
      { status: 201, json: { id: "act_out_3" } },
    ],
  });
  const [a, b] = await Promise.all([
    client.sendApplicationMessage({ content: "one", replyContext: RC }),
    client.sendApplicationMessage({ content: "two", replyContext: RC }),
  ]);
  assert.equal(a.ok, true);
  assert.equal(a.msgid, "act_out_1");
  assert.equal(b.ok, true);
  assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 1, "single-flight token");
  // Posts to the conversation activities endpoint under the serviceUrl.
  assert.match(calls[1].url, /smba\.example\/amer\/v3\/conversations\/conv_1\/activities$/);

  advance(3600 * 1000);
  const c = await client.sendApplicationMessage({ content: "three", replyContext: RC });
  assert.equal(c.msgid, "act_out_3");
  assert.equal(calls.filter((x) => x.url.includes("oauth2")).length, 2);
});

test("401 refreshes and retries once; 429/5xx retryable; other 4xx terminal", async () => {
  const { client, calls } = makeClient({
    responses: [
      { status: 200, json: { access_token: "stale", expires_in: 3600 } },
      { status: 401, json: {} },
      { status: 200, json: { access_token: "fresh", expires_in: 3600 } },
      { status: 201, json: { id: "act_retried" } },
      { status: 429, json: {} },
      { status: 403, json: { error: { code: "Forbidden" } } },
    ],
  });
  const retried = await client.sendApplicationMessage({ content: "x", replyContext: RC });
  assert.deepEqual(retried, { ok: true, msgid: "act_retried" });
  assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 2);

  const rate = await client.sendApplicationMessage({ content: "x", replyContext: RC });
  assert.equal(rate.retryable, true);

  const term = await client.sendApplicationMessage({ content: "x", replyContext: RC });
  assert.equal(term.ok, false);
  assert.equal(term.retryable, false);
  assert.equal(term.errcode, "Forbidden");
});

test("a missing reply context fails terminal (no serviceUrl to reply to)", async () => {
  const { client } = makeClient({ responses: [] });
  const res = await client.sendApplicationMessage({ content: "x", replyContext: null });
  assert.deepEqual(res, { ok: false, retryable: false, errcode: "missing_reply_context" });
});

test("token fetch failure surfaces; no secret material in the outcome; misconfig throws", async () => {
  const fail = makeClient({ responses: [{ status: 400, json: { error: "unauthorized_client" } }] });
  await assert.rejects(() => fail.client.sendApplicationMessage({ content: "x", replyContext: RC }), /teams_token_fetch_failed/);

  const ok = makeClient({ responses: [{ status: 200, json: { access_token: "t-secretish", expires_in: 3600 } }, { status: 201, json: { id: "a1" } }] });
  const res = await ok.client.sendApplicationMessage({ content: "hi", replyContext: RC });
  assert.ok(!JSON.stringify(res).includes(SECRET));
  assert.ok(!JSON.stringify(res).includes("t-secretish"));
  assert.throws(() => createTeamsClient({ appId: "a", appPassword: "" }), /teams_client_misconfigured/);
});
