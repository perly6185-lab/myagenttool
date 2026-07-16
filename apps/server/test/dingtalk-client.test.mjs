/*
 * D2 (#1119): the DingTalk outbound client — access_token cache and code
 * handling (fake transport, every branch). No secret or token material leaks.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createDingtalkClient } from "../src/gateway/dingtalk-client.mjs";

const SECRET = "dt-app-secret-must-never-leak";

function makeClient({ responses }) {
  const calls = [];
  let clock = 1_800_000_000_000;
  const client = createDingtalkClient({
    appKey: "dt_key",
    appSecret: SECRET,
    robotCode: "robot_1",
    now: () => clock,
    httpJson: async (url, options) => {
      calls.push({ url, options });
      const next = responses.shift();
      return typeof next === "function" ? next({ url, options }) : next;
    },
  });
  return { client, calls, advance: (ms) => { clock += ms; } };
}

test("caches access_token, single-flights refresh, refreshes on expiry", async () => {
  const { client, calls, advance } = makeClient({
    responses: [
      { status: 200, json: { accessToken: "t-A", expireIn: 7200 } },
      { status: 200, json: { processQueryKey: "pqk_1" } },
      { status: 200, json: { processQueryKey: "pqk_2" } },
      { status: 200, json: { accessToken: "t-B", expireIn: 7200 } },
      { status: 200, json: { processQueryKey: "pqk_3" } },
    ],
  });
  const [a, b] = await Promise.all([
    client.sendApplicationMessage({ toUser: "u1", content: "one" }),
    client.sendApplicationMessage({ toUser: "u1", content: "two" }),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(calls.filter((c) => c.url.includes("accessToken")).length, 1);

  advance(7200 * 1000);
  const c = await client.sendApplicationMessage({ toUser: "u1", content: "three" });
  assert.equal(c.msgid, "pqk_3");
  assert.equal(calls.filter((c) => c.url.includes("accessToken")).length, 2);
});

test("invalid token refreshes and retries once; rate-limit retryable; unknown terminal", async () => {
  const { client, calls } = makeClient({
    responses: [
      { status: 200, json: { accessToken: "stale", expireIn: 7200 } },
      { status: 401, json: { code: "InvalidAuthentication", message: "invalid access token" } },
      { status: 200, json: { accessToken: "fresh", expireIn: 7200 } },
      { status: 200, json: { processQueryKey: "pqk_retried" } },
      { status: 429, json: { code: "flowControl.limit", message: "too many requests" } },
      { status: 400, json: { code: "invalidParameter.user.notExist", message: "user not found" } },
    ],
  });
  const retried = await client.sendApplicationMessage({ toUser: "u1", content: "x" });
  assert.deepEqual(retried, { ok: true, msgid: "pqk_retried" });
  assert.equal(calls.filter((c) => c.url.includes("accessToken")).length, 2);

  const rate = await client.sendApplicationMessage({ toUser: "u1", content: "x" });
  assert.equal(rate.ok, false);
  assert.equal(rate.retryable, true);
  assert.equal(rate.errcode, "flowControl.limit");

  const terminal = await client.sendApplicationMessage({ toUser: "u1", content: "x" });
  assert.equal(terminal.ok, false);
  assert.equal(terminal.retryable, false);
});

test("token fetch failure surfaces; no secret or token material anywhere observable", async () => {
  const { client } = makeClient({ responses: [{ status: 200, json: { code: "appNotFound" } }] });
  await assert.rejects(() => client.sendApplicationMessage({ toUser: "u1", content: "x" }), /dingtalk_token_fetch_failed/);

  const ok = makeClient({
    responses: [
      { status: 200, json: { accessToken: "t-secretish", expireIn: 7200 } },
      { status: 200, json: { processQueryKey: "pqk_1" } },
    ],
  });
  const res = await ok.client.sendApplicationMessage({ toUser: "u1", content: "hi" });
  assert.equal(res.ok, true);
  assert.ok(!JSON.stringify(res).includes(SECRET));
  assert.ok(!JSON.stringify(res).includes("t-secretish"));
});

test("misconfiguration throws", () => {
  assert.throws(() => createDingtalkClient({ appKey: "k", appSecret: SECRET, robotCode: "" }), /dingtalk_client_misconfigured/);
});
