/*
 * SL2 (#1128): the Slack outbound client — static bot token (no exchange) +
 * chat.postMessage, ratelimit-aware. No secret material leaks.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createSlackClient } from "../src/gateway/slack-client.mjs";

const TOKEN = "xoxb-bot-token-must-never-leak";

function makeClient({ responses }) {
  const calls = [];
  const client = createSlackClient({
    botToken: TOKEN,
    httpJson: async (url, options) => {
      calls.push({ url, options });
      const next = responses.shift();
      return typeof next === "function" ? next({ url, options }) : next;
    },
  });
  return { client, calls };
}

test("chat.postMessage success returns the ts; uses the static bot token, no token exchange", async () => {
  const { client, calls } = makeClient({ responses: [{ status: 200, json: { ok: true, ts: "1800000000.001", channel: "D1" } }] });
  const res = await client.sendApplicationMessage({ toUser: "U_alice", content: "hi" });
  assert.deepEqual(res, { ok: true, msgid: "1800000000.001" });
  // Exactly one call — no accessToken/oauth round-trip.
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /chat\.postMessage$/);
  assert.equal(calls[0].options.headers.authorization, `Bearer ${TOKEN}`);
});

test("ratelimited (or HTTP 429) is retryable; other Slack errors are terminal", async () => {
  const rl = makeClient({ responses: [{ status: 200, json: { ok: false, error: "ratelimited" } }] });
  const r1 = await rl.client.sendApplicationMessage({ toUser: "U", content: "x" });
  assert.deepEqual(r1, { ok: false, retryable: true, errcode: "ratelimited" });

  const http429 = makeClient({ responses: [{ status: 429, json: {} }] });
  const r2 = await http429.client.sendApplicationMessage({ toUser: "U", content: "x" });
  assert.equal(r2.retryable, true);

  const term = makeClient({ responses: [{ status: 200, json: { ok: false, error: "channel_not_found" } }] });
  const r3 = await term.client.sendApplicationMessage({ toUser: "U", content: "x" });
  assert.deepEqual(r3, { ok: false, retryable: false, errcode: "channel_not_found" });

  const auth = makeClient({ responses: [{ status: 200, json: { ok: false, error: "invalid_auth" } }] });
  assert.equal((await auth.client.sendApplicationMessage({ toUser: "U", content: "x" })).retryable, false);
});

test("a 5xx with no Slack error body is retryable", async () => {
  const { client } = makeClient({ responses: [{ status: 503, json: {} }] });
  const res = await client.sendApplicationMessage({ toUser: "U", content: "x" });
  assert.equal(res.ok, false);
  assert.equal(res.retryable, true);
});

test("no bot token material appears in the returned outcome; misconfig throws", async () => {
  const { client } = makeClient({ responses: [{ status: 200, json: { ok: true, ts: "1.1" } }] });
  const res = await client.sendApplicationMessage({ toUser: "U", content: "hi" });
  assert.ok(!JSON.stringify(res).includes(TOKEN));
  assert.throws(() => createSlackClient({ botToken: "" }), /slack_client_misconfigured/);
});
