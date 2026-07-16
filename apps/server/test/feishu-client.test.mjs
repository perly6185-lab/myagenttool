/*
 * F3 (#1110): the Feishu outbound client — tenant_access_token cache and code
 * handling (fake transport, every branch). No secret or token material leaks.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createFeishuClient } from "../src/gateway/feishu-client.mjs";

const SECRET = "app-secret-must-never-leak";

function makeClient({ responses }) {
  const calls = [];
  let clock = 1_800_000_000_000;
  const client = createFeishuClient({
    appId: "cli_app",
    appSecret: SECRET,
    now: () => clock,
    httpJson: async (url, options) => {
      calls.push({ url, options });
      const next = responses.shift();
      return typeof next === "function" ? next({ url, options }) : next;
    },
  });
  return { client, calls, advance: (ms) => { clock += ms; } };
}

test("caches tenant_access_token, single-flights refresh, refreshes on expiry", async () => {
  const { client, calls, advance } = makeClient({
    responses: [
      { code: 0, tenant_access_token: "t-A", expire: 7200 },
      { code: 0, data: { message_id: "om_1" } },
      { code: 0, data: { message_id: "om_2" } },
      { code: 0, tenant_access_token: "t-B", expire: 7200 },
      { code: 0, data: { message_id: "om_3" } },
    ],
  });
  const [a, b] = await Promise.all([
    client.sendApplicationMessage({ toUser: "ou_1", content: "one" }),
    client.sendApplicationMessage({ toUser: "ou_1", content: "two" }),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(calls.filter((c) => c.url.includes("tenant_access_token")).length, 1);

  advance(7200 * 1000);
  const c = await client.sendApplicationMessage({ toUser: "ou_1", content: "three" });
  assert.equal(c.msgid, "om_3");
  assert.equal(calls.filter((c) => c.url.includes("tenant_access_token")).length, 2);
});

test("invalid token (99991663) refreshes and retries once; frequency-limit retryable; unknown terminal", async () => {
  const { client, calls } = makeClient({
    responses: [
      { code: 0, tenant_access_token: "stale", expire: 7200 },
      { code: 99991663, msg: "invalid access token" },
      { code: 0, tenant_access_token: "fresh", expire: 7200 },
      { code: 0, data: { message_id: "om_retried" } },
      { code: 99991400, msg: "too many requests" },
      { code: 230001, msg: "user not reachable" },
    ],
  });
  const retried = await client.sendApplicationMessage({ toUser: "ou_1", content: "x" });
  assert.deepEqual(retried, { ok: true, msgid: "om_retried" });
  assert.equal(calls.filter((c) => c.url.includes("tenant_access_token")).length, 2);

  const rate = await client.sendApplicationMessage({ toUser: "ou_1", content: "x" });
  assert.equal(rate.ok, false);
  assert.equal(rate.retryable, true);
  assert.equal(rate.errcode, 99991400);

  const terminal = await client.sendApplicationMessage({ toUser: "ou_1", content: "x" });
  assert.equal(terminal.ok, false);
  assert.equal(terminal.retryable, false);
});

test("token fetch failure surfaces; no secret or token material anywhere observable", async () => {
  const { client } = makeClient({ responses: [{ code: 10003, msg: "app not found" }] });
  await assert.rejects(() => client.sendApplicationMessage({ toUser: "ou_1", content: "x" }), /feishu_token_fetch_failed/);

  const ok = makeClient({
    responses: [
      { code: 0, tenant_access_token: "t-secretish", expire: 7200 },
      { code: 0, data: { message_id: "om_1" } },
    ],
  });
  const res = await ok.client.sendApplicationMessage({ toUser: "ou_1", content: "hi" });
  assert.equal(res.ok, true);
  // The request bodies carry app_secret + bearer token, but the RETURNED outcome never does.
  assert.ok(!JSON.stringify(res).includes(SECRET));
  assert.ok(!JSON.stringify(res).includes("t-secretish"));
});

test("misconfiguration throws", () => {
  assert.throws(() => createFeishuClient({ appId: "", appSecret: SECRET }), /feishu_client_misconfigured/);
});
