/*
 * T1 (#1135): the Teams gateway handler — a valid Bearer JWT + Activity imports
 * exactly once with a replyContext; forged/expired/missing-token rejected; JWKS
 * fetch failure refuses (503); control plane not reachable; replay deduped.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";

import { createTeamsGateway, teamsGatewayConfigFromEnv } from "../src/gateway/teams-gateway.mjs";

const APP_ID = "bot-app-id";
const NOW_MS = 1_800_000_000_000;
const nowSec = Math.floor(NOW_MS / 1000);

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "kid1", alg: "RS256", use: "sig" };

function b64url(o) { return Buffer.from(JSON.stringify(o)).toString("base64url"); }
function jwt(over = {}) {
  const h = b64url({ alg: "RS256", kid: "kid1", typ: "JWT" });
  const p = b64url({ iss: "https://api.botframework.com", aud: APP_ID, exp: nowSec + 3600, nbf: nowSec - 60, ...over });
  const si = `${h}.${p}`;
  return `${si}.${sign("RSA-SHA256", Buffer.from(si), privateKey).toString("base64url")}`;
}

function makeGateway({ importChannelEvent, fetchJwks } = {}) {
  const imported = [];
  const gateway = createTeamsGateway({
    appId: APP_ID, channelId: "chn_0001",
    importChannelEvent: importChannelEvent ?? ((e) => { imported.push(e); return { ok: true, eventId: `chev_${imported.length}` }; }),
    fetchJwks: fetchJwks ?? (async () => [jwk]),
    now: () => NOW_MS,
  });
  return { gateway, imported };
}

function fakeRes() {
  const res = { statusCode: null, body: "" };
  res.writeHead = (s) => { res.statusCode = s; };
  res.end = (c) => { res.body += c ?? ""; };
  return res;
}

function activity(text, { id = "act_1", user = "29:alice" } = {}) {
  return { type: "message", id, text, from: { id: user }, conversation: { id: "conv_1" }, serviceUrl: "https://smba.example/amer/", timestamp: "2026-07-16T00:00:00Z" };
}

function post(bodyObj, { token = jwt() } = {}) {
  const raw = typeof bodyObj === "string" ? bodyObj : JSON.stringify(bodyObj);
  return { method: "POST", url: "/teams/callback", headers: { authorization: token ? `Bearer ${token}` : "" }, async *[Symbol.asyncIterator]() { yield raw; } };
}

async function drive(gateway, req) { const res = fakeRes(); await gateway.handleRequest(req, res); return res; }

test("a valid Bearer JWT + Activity imports exactly one event with a replyContext", async () => {
  const { gateway, imported } = makeGateway();
  const res = await drive(gateway, post(activity("/status")));
  assert.equal(res.statusCode, 200);
  assert.equal(imported.length, 1);
  assert.deepEqual(imported[0], {
    channelId: "chn_0001",
    providerMessageId: "act_1",
    externalUserId: "29:alice",
    msgType: "text",
    content: "/status",
    providerCreateTime: "2026-07-16T00:00:00Z",
    agentId: null,
    replyContext: { serviceUrl: "https://smba.example/amer/", conversationId: "conv_1" },
  });
});

test("missing token → 401; forged/expired token → 401; nothing imported", async () => {
  const { gateway, imported } = makeGateway();
  assert.equal((await drive(gateway, post(activity("/status"), { token: null }))).statusCode, 401);
  assert.equal((await drive(gateway, post(activity("/status"), { token: jwt({ aud: "wrong" }) }))).statusCode, 401);
  assert.equal((await drive(gateway, post(activity("/status"), { token: jwt({ exp: nowSec - 10000 }) }))).statusCode, 401);
  assert.equal(imported.length, 0);
});

test("JWKS fetch failure refuses (503) rather than trusting", async () => {
  const { gateway } = makeGateway({ fetchJwks: async () => { throw new Error("network"); } });
  assert.equal((await drive(gateway, post(activity("/status")))).statusCode, 503);
});

test("a duplicate activity id (Teams retry) is acked but not re-imported", async () => {
  const { gateway, imported } = makeGateway();
  assert.equal((await drive(gateway, post(activity("/status", { id: "dup" })))).statusCode, 200);
  assert.equal((await drive(gateway, post(activity("/status", { id: "dup" })))).statusCode, 200);
  assert.equal(imported.length, 1);
});

test("non-message activities are acked without import; control plane not reachable", async () => {
  const { gateway, imported } = makeGateway();
  assert.equal((await drive(gateway, post({ type: "conversationUpdate" }))).statusCode, 200);
  assert.equal(imported.length, 0);
  for (const path of ["/api/state", "/api/channels", "/health"]) {
    const res = await drive(gateway, { method: "GET", url: path });
    assert.equal(res.statusCode, 404, path);
  }
});

test("JWKS is cached (fetched once across requests) and config comes from env", async () => {
  let fetches = 0;
  const { gateway } = makeGateway({ fetchJwks: async () => { fetches += 1; return [jwk]; } });
  await drive(gateway, post(activity("/status", { id: "a1" })));
  await drive(gateway, post(activity("/status", { id: "a2" })));
  assert.equal(fetches, 1, "JWKS fetched once and cached");

  assert.deepEqual(teamsGatewayConfigFromEnv({}), { port: null, host: "0.0.0.0", appId: null, channelId: null });
  const cfg = teamsGatewayConfigFromEnv({ TEAMS_GATEWAY_PORT: "5306", TEAMS_APP_ID: APP_ID, TEAMS_CHANNEL_ID: "chn_0001" });
  assert.equal(cfg.port, 5306);
  assert.throws(() => createTeamsGateway({ appId: "", channelId: "c", importChannelEvent: () => {} }), /teams_gateway_misconfigured/);
});
