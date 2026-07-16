/*
 * Feishu (Lark) callback gateway (F2, #1110; ADR 0012 rule 1 + ADR 0013). A
 * separate public listener serving only the callback path — an /api/* probe
 * gets the same bodyless 404 as any unknown path. Verified, decrypted,
 * normalized events forward into the SHARED importChannelEvent; the exactly-once
 * boundary, untrusted-input taint, and every governance gate are the shared ones.
 *
 * Feishu specifics vs WeCom: POST-only (no GET verify), a `url_verification`
 * challenge handshake, signature = sha256(timestamp+nonce+encryptKey+rawBody),
 * JSON (not XML). Secrets (EncryptKey, VerificationToken) stay in this process's
 * env; error responses are status-only.
 */

import http from "node:http";

import { decryptFeishuMessage, parseFeishuEvent, verifyFeishuSignature } from "./feishu-crypto.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_SEEN_NONCES = 10_000;

export function createFeishuGateway({
  verificationToken,
  encryptKey,
  channelId,
  importChannelEvent,
  callbackPath = "/feishu/callback",
  replayWindowSeconds = 300,
  now = () => Date.now(),
}) {
  if (!verificationToken || !encryptKey || !channelId || !importChannelEvent) {
    throw new Error("feishu_gateway_misconfigured");
  }

  const seenNonces = new Map();

  function pruneNonces(nowMs) {
    for (const [key, expiresAt] of seenNonces) {
      if (expiresAt <= nowMs) seenNonces.delete(key);
    }
    while (seenNonces.size > MAX_SEEN_NONCES) {
      seenNonces.delete(seenNonces.keys().next().value);
    }
  }

  function replayChecked({ timestamp, nonce }) {
    const nowMs = now();
    const timestampMs = Number(timestamp) * 1000;
    if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > replayWindowSeconds * 1000) {
      return { ok: false, reason: "stale_timestamp" };
    }
    const key = `${nonce}:${timestamp}`;
    pruneNonces(nowMs);
    if (seenNonces.has(key)) return { ok: false, reason: "replayed_nonce" };
    seenNonces.set(key, nowMs + replayWindowSeconds * 1000);
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

    let raw = "";
    let overflow = false;
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) {
        overflow = true;
        break;
      }
    }
    if (overflow) {
      send(res, 413);
      return;
    }

    const timestamp = req.headers?.["x-lark-request-timestamp"];
    const nonce = req.headers?.["x-lark-request-nonce"];
    const signature = req.headers?.["x-lark-signature"];
    if (!timestamp || !nonce || !signature) {
      send(res, 400);
      return;
    }
    // Signature FIRST over the RAW body: nothing decrypts until the sender
    // proved knowledge of the EncryptKey.
    if (!verifyFeishuSignature({ timestamp, nonce, encryptKey, body: raw, signature })) {
      send(res, 403);
      return;
    }

    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      send(res, 400);
      return;
    }
    if (typeof envelope?.encrypt !== "string") {
      // Plaintext mode is not accepted — an EncryptKey is configured, so every
      // authentic callback is encrypted.
      send(res, 400);
      return;
    }

    let plaintext;
    try {
      plaintext = decryptFeishuMessage({ encryptKey, encrypt: envelope.encrypt });
    } catch {
      send(res, 400);
      return;
    }

    const parsed = parseFeishuEvent(plaintext);

    // The URL-verification handshake: echo the challenge as JSON. The token must
    // match, or we do not confirm ownership of the callback.
    if (parsed.kind === "url_verification") {
      if (parsed.token !== verificationToken) {
        send(res, 403);
        return;
      }
      send(res, 200, JSON.stringify({ challenge: parsed.challenge }), { "content-type": "application/json" });
      return;
    }

    if (parsed.kind !== "event") {
      // Unknown event type: acknowledge (Feishu retries non-200) but import nothing.
      send(res, 200, "");
      return;
    }
    if (parsed.token !== verificationToken) {
      send(res, 403);
      return;
    }
    // Replay window + nonce cache; event_id idempotency is enforced at import.
    const replay = replayChecked({ timestamp, nonce });
    if (!replay.ok) {
      send(res, 400);
      return;
    }

    try {
      await importChannelEvent({
        channelId,
        providerMessageId: parsed.eventId,
        externalUserId: parsed.externalUserId,
        msgType: parsed.msgType,
        content: parsed.content,
        providerCreateTime: parsed.createTime,
        agentId: null,
      });
    } catch {
      // Import must never take the public socket down; Feishu just retries.
    }
    send(res, 200, "");
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
export function feishuGatewayConfigFromEnv(env = process.env) {
  const port = Number(env.FEISHU_GATEWAY_PORT);
  return {
    port: Number.isFinite(port) && port > 0 ? port : null,
    host: String(env.FEISHU_GATEWAY_HOST ?? "0.0.0.0"),
    verificationToken: String(env.FEISHU_VERIFICATION_TOKEN ?? "").trim() || null,
    encryptKey: String(env.FEISHU_ENCRYPT_KEY ?? "").trim() || null,
    channelId: String(env.FEISHU_CHANNEL_ID ?? "").trim() || null,
  };
}
