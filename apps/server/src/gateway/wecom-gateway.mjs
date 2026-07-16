/*
 * WeCom callback gateway (S3, #1090/ADR 0012 rule 1): the ONLY public surface.
 * A dedicated listener that verifies signatures, decrypts, applies replay
 * protection, and forwards normalized events to the channel service in-process.
 * No control-plane route exists here — an /api/* probe gets the same 404 as any
 * unknown path.
 *
 * Secrets (callback Token, EncodingAESKey) live in this gateway's config only.
 * Error responses are status-only: no reason detail leaves the socket, and no
 * secret or plaintext fragment is ever echoed or logged.
 */

import http from "node:http";

import { decryptWecomMessage, extractXmlFields, verifyMsgSignature } from "./wecom-crypto.mjs";
import { readCappedBody } from "./read-body.mjs";

const MAX_BODY_BYTES = 64 * 1024; // WeCom callbacks are small; anything bigger is hostile
const MAX_SEEN_NONCES = 10_000;

export function createWecomGateway({
  token,
  encodingAesKey,
  receiveId,
  channelId,
  importChannelEvent,
  callbackPath = "/wecom/callback",
  replayWindowSeconds = 300,
  now = () => Date.now(),
}) {
  if (!token || !encodingAesKey || !importChannelEvent) {
    throw new Error("wecom_gateway_misconfigured");
  }

  // Bounded (nonce, timestamp) replay cache. The timestamp window already
  // rejects anything older than the window, so entries only need to live that
  // long; the size cap is a hostile-flood backstop.
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
    if (seenNonces.has(key)) {
      return { ok: false, reason: "replayed_nonce" };
    }
    seenNonces.set(key, nowMs + replayWindowSeconds * 1000);
    return { ok: true };
  }

  function deny(res, status) {
    res.writeHead(status);
    res.end();
  }

  async function handleRequest(req, res) {
    const url = new URL(req.url ?? "/", "http://gateway.invalid");
    if (url.pathname !== callbackPath) {
      // Includes every /api/* control-plane probe: identical 404, no body.
      deny(res, 404);
      return;
    }

    const signature = url.searchParams.get("msg_signature");
    const timestamp = url.searchParams.get("timestamp");
    const nonce = url.searchParams.get("nonce");
    if (!signature || !timestamp || !nonce) {
      deny(res, 400);
      return;
    }

    // GET: callback URL verification — echostr decrypts only under a valid signature.
    if (req.method === "GET") {
      const echostr = url.searchParams.get("echostr") ?? "";
      if (!verifyMsgSignature({ token, timestamp, nonce, encrypted: echostr, signature })) {
        deny(res, 403);
        return;
      }
      try {
        const echo = decryptWecomMessage({ encodingAesKey, encrypted: echostr, receiveId });
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end(echo);
      } catch {
        deny(res, 400);
      }
      return;
    }

    if (req.method !== "POST") {
      deny(res, 405);
      return;
    }

    const { raw: body, overflow } = await readCappedBody(req, MAX_BODY_BYTES);
    if (overflow) {
      deny(res, 413);
      return;
    }

    const { Encrypt: encrypted } = extractXmlFields(body, ["Encrypt"]);
    if (!encrypted) {
      deny(res, 400);
      return;
    }
    // Signature FIRST: nothing decrypts until the sender proved knowledge of the token.
    if (!verifyMsgSignature({ token, timestamp, nonce, encrypted, signature })) {
      deny(res, 403);
      return;
    }
    const replay = replayChecked({ timestamp, nonce });
    if (!replay.ok) {
      deny(res, 400);
      return;
    }

    let message;
    try {
      message = decryptWecomMessage({ encodingAesKey, encrypted, receiveId });
    } catch {
      deny(res, 400);
      return;
    }

    const fields = extractXmlFields(message, [
      "ToUserName",
      "FromUserName",
      "CreateTime",
      "MsgType",
      "Content",
      "MsgId",
      "AgentID",
    ]);

    // Normalize and hand off. Import owns MsgId idempotency; whatever it
    // decides (imported / duplicate / refused-disabled), WeCom gets a prompt
    // empty 200 ACK — a retry storm cannot force a second import, and a
    // disabled channel is not the sender's error to observe.
    try {
      await importChannelEvent({
        channelId,
        providerMessageId: String(fields.MsgId ?? "").trim(),
        externalUserId: String(fields.FromUserName ?? "").trim(),
        msgType: String(fields.MsgType ?? "").trim(),
        content: String(fields.Content ?? ""),
        providerCreateTime: String(fields.CreateTime ?? "").trim(),
        agentId: String(fields.AgentID ?? "").trim(),
      });
    } catch {
      // Import must never take the public socket down with it; the event is
      // lost only if import both threw and recorded nothing, which its own
      // tests forbid.
    }
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("");
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
export function wecomGatewayConfigFromEnv(env = process.env) {
  const port = Number(env.WECOM_GATEWAY_PORT);
  return {
    port: Number.isFinite(port) && port > 0 ? port : null,
    host: String(env.WECOM_GATEWAY_HOST ?? "0.0.0.0"),
    token: String(env.WECOM_CALLBACK_TOKEN ?? "").trim() || null,
    encodingAesKey: String(env.WECOM_ENCODING_AES_KEY ?? "").trim() || null,
    receiveId: String(env.WECOM_CORP_ID ?? "").trim() || null,
    channelId: String(env.WECOM_CHANNEL_ID ?? "").trim() || null,
  };
}
