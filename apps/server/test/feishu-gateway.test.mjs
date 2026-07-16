/*
 * F2 (#1110): the Feishu gateway handler — url_verification handshake succeeds
 * only under a valid signature + token; encrypted events decrypt only after the
 * signature check; forged/tampered/stale/replayed/wrong-token are rejected
 * without detail; the control plane is not reachable; the sender always gets a
 * 200 once the callback is authentic.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { computeFeishuSignature, encryptFeishuMessage } from "../src/gateway/feishu-crypto.mjs";
import { createFeishuGateway, feishuGatewayConfigFromEnv } from "../src/gateway/feishu-gateway.mjs";

const TOKEN = "verify-token";
const ENCRYPT_KEY = "encrypt-key-123";
const NOW_MS = 1_800_000_000_000;

function makeGateway({ importChannelEvent } = {}) {
  const imported = [];
  const gateway = createFeishuGateway({
    verificationToken: TOKEN,
    encryptKey: ENCRYPT_KEY,
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

function post(raw, { timestamp = String(NOW_MS / 1000), nonce = "n1", signature } = {}) {
  const sig = signature ?? computeFeishuSignature(timestamp, nonce, ENCRYPT_KEY, raw);
  return {
    method: "POST",
    url: "/feishu/callback",
    headers: {
      "x-lark-request-timestamp": timestamp,
      "x-lark-request-nonce": nonce,
      "x-lark-signature": sig,
    },
    async *[Symbol.asyncIterator]() { yield raw; },
  };
}

function encBody(obj) {
  return JSON.stringify({ encrypt: encryptFeishuMessage({ encryptKey: ENCRYPT_KEY, plaintext: JSON.stringify(obj) }) });
}

function messageEvent(text, { eventId = "evt_1", openId = "ou_alice", token = TOKEN } = {}) {
  return {
    schema: "2.0",
    header: { event_id: eventId, token, event_type: "im.message.receive_v1", create_time: "1800000000000" },
    event: {
      sender: { sender_id: { open_id: openId }, sender_type: "user" },
      message: { message_id: "om_1", chat_id: "oc_1", message_type: "text", content: JSON.stringify({ text }) },
    },
  };
}

async function drive(gateway, req) {
  const res = fakeRes();
  await gateway.handleRequest(req, res);
  return res;
}

test("url_verification: valid signature+token → echoes challenge; wrong token → 403", async () => {
  const { gateway } = makeGateway();
  const okBody = encBody({ type: "url_verification", challenge: "chal-42", token: TOKEN });
  const ok = await drive(gateway, post(okBody, { nonce: "nv1" }));
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(JSON.parse(ok.body), { challenge: "chal-42" });

  const badToken = encBody({ type: "url_verification", challenge: "x", token: "wrong" });
  const bad = await drive(gateway, post(badToken, { nonce: "nv2" }));
  assert.equal(bad.statusCode, 403);
});

test("a valid encrypted message imports exactly one normalized event and acks", async () => {
  const { gateway, imported } = makeGateway();
  const res = await drive(gateway, post(encBody(messageEvent("/status")), { nonce: "nm1" }));
  assert.equal(res.statusCode, 200);
  assert.equal(imported.length, 1);
  assert.deepEqual(imported[0], {
    channelId: "chn_0001",
    providerMessageId: "evt_1",
    externalUserId: "ou_alice",
    msgType: "text",
    content: "/status",
    providerCreateTime: "1800000000000",
    agentId: null,
  });
});

test("forged signature and tampered ciphertext never reach decrypt/import", async () => {
  const { gateway, imported } = makeGateway();
  const body = encBody(messageEvent("/status", { eventId: "evt_forge" }));

  const forged = await drive(gateway, post(body, { nonce: "nf1", signature: "0".repeat(64) }));
  assert.equal(forged.statusCode, 403);

  // Tamper the ciphertext but re-sign so the signature matches the tampered body.
  const env = JSON.parse(body);
  const buf = Buffer.from(env.encrypt, "base64");
  buf[buf.length - 1] ^= 0xff;
  const tampered = JSON.stringify({ encrypt: buf.toString("base64") });
  const res = await drive(gateway, post(tampered, { nonce: "nf2" }));
  assert.equal(res.statusCode, 400);
  assert.equal(imported.length, 0);
});

test("wrong event token, stale timestamp, and replayed nonce are rejected", async () => {
  const { gateway, imported } = makeGateway();

  const wrongToken = await drive(gateway, post(encBody(messageEvent("/status", { token: "nope", eventId: "evt_wt" })), { nonce: "nwt" }));
  assert.equal(wrongToken.statusCode, 403);

  const staleTs = String((NOW_MS - 10 * 60 * 1000) / 1000);
  const stale = await drive(gateway, post(encBody(messageEvent("/status", { eventId: "evt_stale" })), { timestamp: staleTs, nonce: "ns" }));
  assert.equal(stale.statusCode, 400);

  const body = encBody(messageEvent("/status", { eventId: "evt_replay" }));
  const first = await drive(gateway, post(body, { nonce: "nrep" }));
  assert.equal(first.statusCode, 200);
  // Reuse the SAME signed request (same nonce+ts) → replay cache rejects.
  const replay = await drive(gateway, post(body, { nonce: "nrep" }));
  assert.equal(replay.statusCode, 400);
  assert.equal(imported.length, 1);
});

test("control-plane routes are not reachable on the feishu gateway", async () => {
  const { gateway } = makeGateway();
  for (const path of ["/api/state", "/api/channels", "/health", "/"]) {
    const res = await drive(gateway, { method: "GET", url: path });
    assert.equal(res.statusCode, 404, path);
    assert.equal(res.body, "");
  }
});

test("import refusal or crash still acks the authentic sender", async () => {
  const refusing = makeGateway({ importChannelEvent: () => ({ ok: false, refused: true }) });
  const r1 = await drive(refusing.gateway, post(encBody(messageEvent("/status", { eventId: "evt_r1" })), { nonce: "nr1" }));
  assert.equal(r1.statusCode, 200);

  const throwing = makeGateway({ importChannelEvent: () => { throw new Error("boom"); } });
  const r2 = await drive(throwing.gateway, post(encBody(messageEvent("/status", { eventId: "evt_r2" })), { nonce: "nr2" }));
  assert.equal(r2.statusCode, 200);
});

test("missing signature headers, plaintext (no encrypt), oversize, and config-from-env", async () => {
  const { gateway } = makeGateway();
  const noHeaders = await drive(gateway, { method: "POST", url: "/feishu/callback", async *[Symbol.asyncIterator]() { yield "{}"; } });
  assert.equal(noHeaders.statusCode, 400);

  const plaintext = await drive(gateway, post(JSON.stringify({ challenge: "x", type: "url_verification", token: TOKEN }), { nonce: "np" }));
  assert.equal(plaintext.statusCode, 400); // no `encrypt` field → rejected

  assert.deepEqual(feishuGatewayConfigFromEnv({}), {
    port: null, host: "0.0.0.0", verificationToken: null, encryptKey: null, channelId: null,
  });
  const cfg = feishuGatewayConfigFromEnv({ FEISHU_GATEWAY_PORT: "5202", FEISHU_VERIFICATION_TOKEN: TOKEN, FEISHU_ENCRYPT_KEY: ENCRYPT_KEY, FEISHU_CHANNEL_ID: "chn_0001" });
  assert.equal(cfg.port, 5202);
  assert.throws(() => createFeishuGateway({ verificationToken: "", encryptKey: ENCRYPT_KEY, channelId: "c", importChannelEvent: () => {} }), /feishu_gateway_misconfigured/);
});
