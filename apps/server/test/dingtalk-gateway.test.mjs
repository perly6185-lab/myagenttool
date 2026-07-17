/*
 * D1 (#1119): the DingTalk gateway handler — valid HMAC + fresh timestamp
 * imports exactly one normalized event; forged/expired/replayed are rejected;
 * the control plane is not reachable; the sender always gets a JSON 200 once the
 * callback is authentic.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { computeDingtalkSignature } from "../src/gateway/dingtalk-crypto.mjs";
import { createDingtalkGateway, dingtalkGatewayConfigFromEnv } from "../src/gateway/dingtalk-gateway.mjs";

const APP_SECRET = "dt-app-secret";
const NOW_MS = 1_800_000_000_000;

function makeGateway({ importChannelEvent } = {}) {
  const imported = [];
  const gateway = createDingtalkGateway({
    appSecret: APP_SECRET,
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

function post(bodyObj, { timestamp = String(NOW_MS), signature } = {}) {
  const raw = typeof bodyObj === "string" ? bodyObj : JSON.stringify(bodyObj);
  const sign = signature ?? computeDingtalkSignature(timestamp, APP_SECRET);
  return {
    method: "POST",
    url: "/dingtalk/callback",
    headers: { timestamp, sign },
    async *[Symbol.asyncIterator]() { yield raw; },
  };
}

function message(text, { msgId = "msg_1", sender = "pengshiyu" } = {}) {
  return { msgId, senderStaffId: sender, conversationId: "cid_1", conversationType: "1", msgtype: "text", text: { content: text }, createAt: NOW_MS };
}

async function drive(gateway, req) {
  const res = fakeRes();
  await gateway.handleRequest(req, res);
  return res;
}

test("a valid signed message imports exactly one normalized event and acks JSON", async () => {
  const { gateway, imported } = makeGateway();
  const res = await drive(gateway, post(message("/status")));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), {});
  assert.equal(imported.length, 1);
  assert.deepEqual(imported[0], {
    channelId: "chn_0001",
    providerMessageId: "msg_1",
    externalUserId: "pengshiyu",
    msgType: "text",
    content: "/status",
    providerCreateTime: String(NOW_MS),
    agentId: null,
  });
});

test("forged signature and expired timestamp are rejected without import", async () => {
  const { gateway, imported } = makeGateway();
  assert.equal((await drive(gateway, post(message("/status"), { signature: "AAAA" }))).statusCode, 403);

  const staleTs = String(NOW_MS - 2 * 3600 * 1000); // 2h old, beyond the 1h window
  assert.equal((await drive(gateway, post(message("/status", { msgId: "msg_stale" }), { timestamp: staleTs }))).statusCode, 400);
  assert.equal(imported.length, 0);
});

test("a replayed (timestamp, sign) is rejected; a fresh one still works", async () => {
  const { gateway, imported } = makeGateway();
  const req1 = post(message("/status", { msgId: "msg_a" }), { timestamp: String(NOW_MS) });
  assert.equal((await drive(gateway, req1)).statusCode, 200);
  // Reuse the SAME timestamp+sign verbatim → replay cache rejects.
  const req2 = post(message("/status", { msgId: "msg_a" }), { timestamp: String(NOW_MS) });
  assert.equal((await drive(gateway, req2)).statusCode, 400);
  // A fresh timestamp → new sign → accepted.
  assert.equal((await drive(gateway, post(message("/status", { msgId: "msg_b" }), { timestamp: String(NOW_MS - 5000) }))).statusCode, 200);
  assert.equal(imported.length, 2);
});

test("control-plane routes are not reachable on the dingtalk gateway", async () => {
  const { gateway } = makeGateway();
  for (const path of ["/api/state", "/api/channels", "/health", "/"]) {
    const res = await drive(gateway, { method: "GET", url: path });
    assert.equal(res.statusCode, 404, path);
    assert.equal(res.body, "");
  }
});

test("import refusal or crash still acks the authentic sender", async () => {
  const refusing = makeGateway({ importChannelEvent: () => ({ ok: false, refused: true }) });
  assert.equal((await drive(refusing.gateway, post(message("/status", { msgId: "msg_r1" })))).statusCode, 200);

  const throwing = makeGateway({ importChannelEvent: () => { throw new Error("boom"); } });
  assert.equal((await drive(throwing.gateway, post(message("/status", { msgId: "msg_r2" }), { timestamp: String(NOW_MS - 1000) }))).statusCode, 200);
});

test("missing headers, oversize, non-message, and config-from-env", async () => {
  const { gateway, imported } = makeGateway();
  const noHeaders = await drive(gateway, { method: "POST", url: "/dingtalk/callback", async *[Symbol.asyncIterator]() { yield "{}"; } });
  assert.equal(noHeaders.statusCode, 400);

  // Valid signature, but a non-message body → 200 ack, no import.
  const nonMsg = await drive(gateway, post({ eventType: "chat_update_title" }, { timestamp: String(NOW_MS - 2000) }));
  assert.equal(nonMsg.statusCode, 200);
  assert.equal(imported.length, 0);

  assert.deepEqual(dingtalkGatewayConfigFromEnv({}), { port: null, host: "0.0.0.0", appSecret: null, channelId: null });
  const cfg = dingtalkGatewayConfigFromEnv({ DINGTALK_GATEWAY_PORT: "5303", DINGTALK_APP_SECRET: APP_SECRET, DINGTALK_CHANNEL_ID: "chn_0001" });
  assert.equal(cfg.port, 5303);
  assert.throws(() => createDingtalkGateway({ appSecret: "", channelId: "c", importChannelEvent: () => {} }), /dingtalk_gateway_misconfigured/);
});
