/*
 * SL1 (#1128): the Slack gateway handler — url_verification handshake succeeds
 * only under a valid signature; events import exactly once; forged/expired/
 * replayed/bot messages handled; control plane not reachable; the sender always
 * gets a 200 once the callback is authentic.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { computeSlackSignature } from "../src/gateway/slack-crypto.mjs";
import { createSlackGateway, slackGatewayConfigFromEnv } from "../src/gateway/slack-gateway.mjs";

const SIGNING_SECRET = "sl-signing-secret";
const NOW_MS = 1_800_000_000_000;

function makeGateway({ importChannelEvent } = {}) {
  const imported = [];
  const gateway = createSlackGateway({
    signingSecret: SIGNING_SECRET,
    channelId: "chn_0001",
    importChannelEvent:
      importChannelEvent ?? ((e) => {
        imported.push(e);
        return { ok: true, eventId: `chev_${imported.length}` };
      }),
    now: () => NOW_MS,
  });
  return { gateway, imported };
}

function fakeRes() {
  const res = { statusCode: null, body: "", headers: null };
  res.writeHead = (s, h) => { res.statusCode = s; res.headers = h ?? null; };
  res.end = (c) => { res.body += c ?? ""; };
  return res;
}

function post(bodyObj, { timestamp = String(NOW_MS / 1000), signature } = {}) {
  const raw = typeof bodyObj === "string" ? bodyObj : JSON.stringify(bodyObj);
  const sig = signature ?? computeSlackSignature(SIGNING_SECRET, timestamp, raw);
  return {
    method: "POST",
    url: "/slack/callback",
    headers: { "x-slack-request-timestamp": timestamp, "x-slack-signature": sig },
    async *[Symbol.asyncIterator]() { yield raw; },
  };
}

function messageEvent(text, { eventId = "Ev1", user = "U_alice" } = {}) {
  return { type: "event_callback", token: "t", event_id: eventId, event: { type: "message", user, channel: "C1", ts: "1800000000.001", text } };
}

async function drive(gateway, req) {
  const res = fakeRes();
  await gateway.handleRequest(req, res);
  return res;
}

test("url_verification: valid signature → echoes challenge", async () => {
  const { gateway } = makeGateway();
  const res = await drive(gateway, post({ type: "url_verification", token: "t", challenge: "chal-42" }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { challenge: "chal-42" });
});

test("a valid signed event imports exactly one normalized event and acks", async () => {
  const { gateway, imported } = makeGateway();
  const res = await drive(gateway, post(messageEvent("/status")));
  assert.equal(res.statusCode, 200);
  assert.equal(imported.length, 1);
  assert.deepEqual(imported[0], {
    channelId: "chn_0001",
    providerMessageId: "Ev1",
    externalUserId: "U_alice",
    msgType: "text",
    content: "/status",
    providerCreateTime: "1800000000.001",
    agentId: null,
  });
});

test("forged signature and stale/tampered are rejected without import", async () => {
  const { gateway, imported } = makeGateway();
  assert.equal((await drive(gateway, post(messageEvent("/status"), { signature: "v0=" + "0".repeat(64) }))).statusCode, 403);

  const staleTs = String((NOW_MS - 10 * 60 * 1000) / 1000);
  assert.equal((await drive(gateway, post(messageEvent("/status", { eventId: "Ev_stale" }), { timestamp: staleTs }))).statusCode, 400);
  assert.equal(imported.length, 0);
});

test("bot-authored messages are acked but never imported (loop guard)", async () => {
  const { gateway, imported } = makeGateway();
  const bot = { type: "event_callback", event_id: "Ev_bot", event: { type: "message", bot_id: "B1", user: "U1", channel: "C1", ts: "1.1", text: "my own reply" } };
  const res = await drive(gateway, post(bot));
  assert.equal(res.statusCode, 200);
  assert.equal(imported.length, 0);
});

test("duplicate event_id (Slack retry) is acked but not re-imported", async () => {
  const { gateway, imported } = makeGateway();
  assert.equal((await drive(gateway, post(messageEvent("/status", { eventId: "Ev_dup" })))).statusCode, 200);
  assert.equal((await drive(gateway, post(messageEvent("/status", { eventId: "Ev_dup" })))).statusCode, 200);
  assert.equal(imported.length, 1, "the replayed event_id is not re-imported");
});

test("control-plane routes are not reachable on the slack gateway", async () => {
  const { gateway } = makeGateway();
  for (const path of ["/api/state", "/api/channels", "/health", "/"]) {
    const res = await drive(gateway, { method: "GET", url: path });
    assert.equal(res.statusCode, 404, path);
    assert.equal(res.body, "");
  }
});

test("import refusal or crash still acks the authentic sender", async () => {
  const refusing = makeGateway({ importChannelEvent: () => ({ ok: false, refused: true }) });
  assert.equal((await drive(refusing.gateway, post(messageEvent("/status", { eventId: "Ev_r1" })))).statusCode, 200);
  const throwing = makeGateway({ importChannelEvent: () => { throw new Error("boom"); } });
  assert.equal((await drive(throwing.gateway, post(messageEvent("/status", { eventId: "Ev_r2" })))).statusCode, 200);
});

test("missing headers and config-from-env", async () => {
  const { gateway } = makeGateway();
  const noHeaders = await drive(gateway, { method: "POST", url: "/slack/callback", async *[Symbol.asyncIterator]() { yield "{}"; } });
  assert.equal(noHeaders.statusCode, 400);

  assert.deepEqual(slackGatewayConfigFromEnv({}), { port: null, host: "0.0.0.0", signingSecret: null, channelId: null });
  const cfg = slackGatewayConfigFromEnv({ SLACK_GATEWAY_PORT: "5305", SLACK_SIGNING_SECRET: SIGNING_SECRET, SLACK_CHANNEL_ID: "chn_0001" });
  assert.equal(cfg.port, 5305);
  assert.throws(() => createSlackGateway({ signingSecret: "", channelId: "c", importChannelEvent: () => {} }), /slack_gateway_misconfigured/);
});
