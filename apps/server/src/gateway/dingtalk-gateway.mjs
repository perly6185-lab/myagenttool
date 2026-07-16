/*
 * DingTalk (钉钉) callback gateway (D1, #1119; ADR 0012 rule 1 + ADR 0013). A
 * separate public listener serving only the callback path — an /api/* probe
 * gets the same bodyless 404 as any unknown path. Verified, normalized events
 * forward into the SHARED importChannelEvent; the exactly-once boundary, the
 * untrusted-input taint, and every governance gate are the shared ones.
 *
 * DingTalk specifics vs WeCom/Feishu: POST-only, HMAC-SHA256 signature (no AES),
 * plaintext JSON. Secrets (appSecret) stay in this process's env; error
 * responses are status-only.
 */

import http from "node:http";

import { parseDingtalkMessage, verifyDingtalkSignature } from "./dingtalk-crypto.mjs";
import { readCappedBody } from "./read-body.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_SEEN = 10_000;

export function createDingtalkGateway({
  appSecret,
  channelId,
  importChannelEvent,
  callbackPath = "/dingtalk/callback",
  replayWindowSeconds = 3600, // DingTalk stamps ms timestamps; its own window is ~1h
  now = () => Date.now(),
}) {
  if (!appSecret || !channelId || !importChannelEvent) {
    throw new Error("dingtalk_gateway_misconfigured");
  }

  // Bounded replay cache keyed by the message signature+timestamp. msgId
  // idempotency at import is the durable exactly-once guarantee; this is the
  // hostile-flood backstop within the freshness window.
  const seen = new Map();

  function pruneSeen(nowMs) {
    for (const [key, expiresAt] of seen) {
      if (expiresAt <= nowMs) seen.delete(key);
    }
    while (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value);
  }

  function freshnessChecked(timestamp, signature) {
    const nowMs = now();
    const tsMs = Number(timestamp);
    if (!Number.isFinite(tsMs) || Math.abs(nowMs - tsMs) > replayWindowSeconds * 1000) {
      return { ok: false, reason: "stale_timestamp" };
    }
    const key = `${timestamp}:${signature}`;
    pruneSeen(nowMs);
    if (seen.has(key)) return { ok: false, reason: "replayed" };
    seen.set(key, nowMs + replayWindowSeconds * 1000);
    return { ok: true };
  }

  function send(res, status, body, headers) {
    res.writeHead(status, headers);
    res.end(body ?? "");
  }

  async function handleRequest(req, res) {
    const url = new URL(req.url ?? "/", "http://gateway.invalid");
    if (url.pathname !== callbackPath) {
      send(res, 404);
      return;
    }
    if (req.method !== "POST") {
      send(res, 405);
      return;
    }

    const timestamp = req.headers?.timestamp;
    const signature = req.headers?.sign;
    if (!timestamp || !signature) {
      send(res, 400);
      return;
    }
    // Signature FIRST: nothing is processed until the sender proved knowledge of
    // the appSecret. Freshness THEN, so a captured valid request cannot replay.
    if (!verifyDingtalkSignature({ timestamp, appSecret, signature })) {
      send(res, 403);
      return;
    }
    const fresh = freshnessChecked(timestamp, signature);
    if (!fresh.ok) {
      send(res, 400);
      return;
    }

    const { raw, overflow } = await readCappedBody(req, MAX_BODY_BYTES);
    if (overflow) {
      send(res, 413);
      return;
    }

    const parsed = parseDingtalkMessage(raw);
    if (parsed.kind !== "message") {
      // Unknown/non-message callback: acknowledge, import nothing.
      send(res, 200, JSON.stringify({}), { "content-type": "application/json" });
      return;
    }

    try {
      await importChannelEvent({
        channelId,
        providerMessageId: parsed.msgId,
        externalUserId: parsed.externalUserId,
        msgType: parsed.msgType,
        content: parsed.content,
        providerCreateTime: parsed.createAt,
        agentId: null,
      });
    } catch {
      // Import must never take the public socket down; DingTalk just retries.
    }
    // DingTalk expects a JSON 200; an empty object is a valid no-reply ack.
    send(res, 200, JSON.stringify({}), { "content-type": "application/json" });
  }

  function createServer() {
    return http.createServer((req, res) => {
      handleRequest(req, res).catch(() => {
        try {
          res.writeHead(500);
          res.end();
        } catch {
          // socket already gone
        }
      });
    });
  }

  return { handleRequest, createServer };
}

/** Gateway config from env. Presence-only readiness for this lives in channels.mjs. */
export function dingtalkGatewayConfigFromEnv(env = process.env) {
  const port = Number(env.DINGTALK_GATEWAY_PORT);
  return {
    port: Number.isFinite(port) && port > 0 ? port : null,
    host: String(env.DINGTALK_GATEWAY_HOST ?? "0.0.0.0"),
    appSecret: String(env.DINGTALK_APP_SECRET ?? "").trim() || null,
    channelId: String(env.DINGTALK_CHANNEL_ID ?? "").trim() || null,
  };
}
