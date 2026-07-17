/*
 * S3 (#1090): the WeCom gateway handler — URL verification succeeds only with a
 * valid signature; POST callbacks decrypt only after signature + replay checks;
 * forged/tampered/stale/replayed requests are rejected without detail; the
 * control plane is not reachable on the gateway; the sender always gets an ACK
 * once the callback is authentic, whatever import decides.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { computeMsgSignature, encryptWecomMessage } from "../src/gateway/wecom-crypto.mjs";
import { createWecomGateway, wecomGatewayConfigFromEnv } from "../src/gateway/wecom-gateway.mjs";

const TOKEN = "callback-token";
const AES_KEY = randomBytes(32).toString("base64").slice(0, 43);
const CORP_ID = "ww1234567890abcdef";
const NOW_MS = 1_800_000_000_000;

function makeGateway({ importChannelEvent } = {}) {
  const imported = [];
  const gateway = createWecomGateway({
    token: TOKEN,
    encodingAesKey: AES_KEY,
    receiveId: CORP_ID,
    channelId: "chn_0001",
    importChannelEvent:
      importChannelEvent ?? ((event) => {
        imported.push(event);
        return { ok: true, eventId: `chev_${imported.length}` };
      }),
    now: () => NOW_MS,
  });
  return { gateway, imported };
}

function fakeRes() {
  const res = { statusCode: null, body: "", headers: null };
  res.writeHead = (status, headers) => {
    res.statusCode = status;
    res.headers = headers ?? null;
  };
  res.end = (chunk) => {
    res.body += chunk ?? "";
  };
  return res;
}

function getRequest(params) {
  return { method: "GET", url: `/wecom/callback?${new URLSearchParams(params)}` };
}

function postRequest(params, xmlBody) {
  const req = {
    method: "POST",
    url: `/wecom/callback?${new URLSearchParams(params)}`,
    async *[Symbol.asyncIterator]() {
      yield xmlBody;
    },
  };
  return req;
}

function signedParams(encrypted, { timestamp = String(NOW_MS / 1000), nonce = `n${Math.abs(encrypted.length)}` } = {}) {
  return {
    msg_signature: computeMsgSignature(TOKEN, timestamp, nonce, encrypted),
    timestamp,
    nonce,
  };
}

function envelope(message, { msgId = "70001", from = "zhangsan" } = {}) {
  const inner = `<xml><ToUserName><![CDATA[${CORP_ID}]]></ToUserName><FromUserName><![CDATA[${from}]]></FromUserName><CreateTime>1800000000</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${message}]]></Content><MsgId>${msgId}</MsgId><AgentID>1000002</AgentID></xml>`;
  const encrypted = encryptWecomMessage({ encodingAesKey: AES_KEY, message: inner, receiveId: CORP_ID });
  return { encrypted, body: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>` };
}

test("GET URL verification: valid signature → decrypted echo; forged → 403, no echo", async () => {
  const { gateway } = makeGateway();
  const echo = "3804918852103457292";
  const echostr = encryptWecomMessage({ encodingAesKey: AES_KEY, message: echo, receiveId: CORP_ID });

  const ok = fakeRes();
  await gateway.handleRequest(getRequest({ ...signedParams(echostr), echostr }), ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body, echo);

  const forged = fakeRes();
  await gateway.handleRequest(getRequest({ ...signedParams(echostr), msg_signature: "0".repeat(40), echostr }), forged);
  assert.equal(forged.statusCode, 403);
  assert.equal(forged.body, "");
});

test("POST: a valid encrypted callback imports exactly one normalized event and ACKs empty", async () => {
  const { gateway, imported } = makeGateway();
  const { encrypted, body } = envelope("/status");
  const res = fakeRes();
  await gateway.handleRequest(postRequest(signedParams(encrypted), body), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "");
  assert.equal(imported.length, 1);
  assert.deepEqual(imported[0], {
    channelId: "chn_0001",
    providerMessageId: "70001",
    externalUserId: "zhangsan",
    msgType: "text",
    content: "/status",
    providerCreateTime: "1800000000",
    agentId: "1000002",
  });
});

test("POST: forged signature and tampered ciphertext never reach decrypt/import", async () => {
  const { gateway, imported } = makeGateway();
  const { encrypted, body } = envelope("/status");

  const forged = fakeRes();
  await gateway.handleRequest(postRequest({ ...signedParams(encrypted), msg_signature: "f".repeat(40) }, body), forged);
  assert.equal(forged.statusCode, 403);

  // Tampered ciphertext with a matching (re-signed) signature: decrypt fails → 400.
  const tamperedBuffer = Buffer.from(encrypted, "base64");
  tamperedBuffer[tamperedBuffer.length - 1] ^= 0xff;
  const tampered = tamperedBuffer.toString("base64");
  const tamperedRes = fakeRes();
  await gateway.handleRequest(
    postRequest(signedParams(tampered, { nonce: "n-tampered" }), `<xml><Encrypt><![CDATA[${tampered}]]></Encrypt></xml>`),
    tamperedRes,
  );
  assert.equal(tamperedRes.statusCode, 400);
  assert.equal(imported.length, 0);
});

test("POST: stale timestamp and replayed nonce are rejected; a fresh nonce still works", async () => {
  const { gateway, imported } = makeGateway();
  const { encrypted, body } = envelope("/status");

  const stale = fakeRes();
  const staleTimestamp = String((NOW_MS - 10 * 60 * 1000) / 1000);
  await gateway.handleRequest(postRequest(signedParams(encrypted, { timestamp: staleTimestamp, nonce: "n-stale" }), body), stale);
  assert.equal(stale.statusCode, 400);
  assert.equal(imported.length, 0);

  const params = signedParams(encrypted, { nonce: "n-once" });
  const first = fakeRes();
  await gateway.handleRequest(postRequest(params, body), first);
  assert.equal(first.statusCode, 200);
  assert.equal(imported.length, 1);

  // Same nonce+timestamp+signature verbatim: the replay cache rejects it.
  const replay = fakeRes();
  await gateway.handleRequest(postRequest(params, body), replay);
  assert.equal(replay.statusCode, 400);
  assert.equal(imported.length, 1);

  const again = fakeRes();
  await gateway.handleRequest(postRequest(signedParams(encrypted, { nonce: "n-fresh" }), body), again);
  assert.equal(again.statusCode, 200);
  assert.equal(imported.length, 2);
});

test("control-plane routes are not reachable on the gateway port", async () => {
  const { gateway } = makeGateway();
  for (const path of ["/api/state", "/api/channels", "/api/invocations", "/health", "/"]) {
    const res = fakeRes();
    await gateway.handleRequest({ method: "GET", url: path }, res);
    assert.equal(res.statusCode, 404, path);
    assert.equal(res.body, "");
  }
});

test("import refusal or crash still ACKs the authentic sender (no amplifiable error)", async () => {
  const refusing = makeGateway({ importChannelEvent: () => ({ ok: false, refused: true, reason: "channel_not_enabled" }) });
  const { encrypted, body } = envelope("/status");
  const res = fakeRes();
  await refusing.gateway.handleRequest(postRequest(signedParams(encrypted, { nonce: "n-r1" }), body), res);
  assert.equal(res.statusCode, 200);

  const throwing = makeGateway({
    importChannelEvent: () => {
      throw new Error("import exploded");
    },
  });
  const crashRes = fakeRes();
  await throwing.gateway.handleRequest(postRequest(signedParams(encrypted, { nonce: "n-r2" }), body), crashRes);
  assert.equal(crashRes.statusCode, 200);
});

test("oversized bodies and missing params are rejected early", async () => {
  const { gateway, imported } = makeGateway();
  const big = fakeRes();
  await gateway.handleRequest(postRequest(signedParams("x", { nonce: "n-big" }), "x".repeat(70 * 1024)), big);
  assert.equal(big.statusCode, 413);

  const missing = fakeRes();
  await gateway.handleRequest({ method: "POST", url: "/wecom/callback" , async *[Symbol.asyncIterator]() {} }, missing);
  assert.equal(missing.statusCode, 400);
  assert.equal(imported.length, 0);
});

test("gateway config comes from env; absent config disables the listener", () => {
  assert.deepEqual(wecomGatewayConfigFromEnv({}), {
    port: null, host: "0.0.0.0", token: null, encodingAesKey: null, receiveId: null, channelId: null,
  });
  const config = wecomGatewayConfigFromEnv({
    WECOM_GATEWAY_PORT: "5201",
    WECOM_CALLBACK_TOKEN: "t",
    WECOM_ENCODING_AES_KEY: AES_KEY,
    WECOM_CORP_ID: CORP_ID,
    WECOM_CHANNEL_ID: "chn_0001",
  });
  assert.equal(config.port, 5201);
  assert.equal(config.channelId, "chn_0001");
  assert.throws(() => createWecomGateway({ token: "", encodingAesKey: AES_KEY, importChannelEvent: () => {} }), /wecom_gateway_misconfigured/);
});
