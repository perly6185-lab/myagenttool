/*
 * Slack callback gateway (SL1, #1128; ADR 0012 rule 1 + ADR 0013). A separate
 * public listener serving only the callback path — an /api/* probe gets the same
 * bodyless 404 as any unknown path. Verified, normalized events forward into the
 * SHARED importChannelEvent; the exactly-once boundary, the untrusted-input
 * taint, and every governance gate are the shared ones.
 *
 * Slack specifics: POST-only, HMAC-SHA256 over `v0:{ts}:{rawBody}` (body IS
 * signed), plaintext JSON, a `url_verification` challenge handshake, and
 * bot-message skipping. Secrets (signing secret) stay in this process's env;
 * error responses are status-only.
 */

import http from "node:http";

import { readCappedBody } from "./read-body.mjs";
import { parseSlackEvent, verifySlackSignature } from "./slack-crypto.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_SEEN = 10_000;

export function createSlackGateway({
  signingSecret,
  channelId,
  importChannelEvent,
  callbackPath = "/slack/callback",
  replayWindowSeconds = 300,
  now = () => Date.now(),
}) {
  if (!signingSecret || !channelId || !importChannelEvent) {
    throw new Error("slack_gateway_misconfigured");
  }

  // Bounded event_id replay cache within the freshness window. event_id
  // idempotency at import is the durable exactly-once guarantee; this is the
  // in-window backstop.
  const seen = new Map();

  function pruneSeen(nowMs) {
    for (const [key, expiresAt] of seen) {
      if (expiresAt <= nowMs) seen.delete(key);
    }
    while (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value);
  }

  function replayChecked(eventId) {
    const nowMs = now();
    pruneSeen(nowMs);
    if (seen.has(eventId)) return false;
    seen.set(eventId, nowMs + replayWindowSeconds * 1000);
    return true;
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

    const timestamp = req.headers?.["x-slack-request-timestamp"];
    const signature = req.headers?.["x-slack-signature"];
    if (!timestamp || !signature) {
      send(res, 400);
      return;
    }
    // Timestamp freshness first (cheap) — reject stale before HMAC work.
    const tsMs = Number(timestamp) * 1000;
    if (!Number.isFinite(tsMs) || Math.abs(now() - tsMs) > replayWindowSeconds * 1000) {
      send(res, 400);
      return;
    }

    const { raw, overflow } = await readCappedBody(req, MAX_BODY_BYTES);
    if (overflow) {
      send(res, 413);
      return;
    }
    // Signature over the RAW body: nothing is processed until the sender proved
    // knowledge of the signing secret.
    if (!verifySlackSignature({ signingSecret, timestamp, body: raw, signature })) {
      send(res, 403);
      return;
    }

    const parsed = parseSlackEvent(raw);

    if (parsed.kind === "url_verification") {
      send(res, 200, JSON.stringify({ challenge: parsed.challenge }), { "content-type": "application/json" });
      return;
    }
    if (parsed.kind !== "event") {
      // Bot message or unknown event: acknowledge, import nothing.
      send(res, 200, "");
      return;
    }
    // event_id replay backstop; msgId idempotency is enforced at import. An event
    // with no id at all cannot be deduped, so drop it rather than let it bypass
    // the backstop (#channel-audit) — real Slack events always carry event_id/ts.
    if (!parsed.eventId || !replayChecked(parsed.eventId)) {
      send(res, 200, ""); // a Slack retry or an unidentifiable event — ack, don't import
      return;
    }

    try {
      await importChannelEvent({
        channelId,
        providerMessageId: parsed.eventId,
        externalUserId: parsed.externalUserId,
        msgType: "text",
        content: parsed.content,
        providerCreateTime: parsed.ts,
        agentId: null,
      });
    } catch {
      // Import must never take the public socket down; Slack just retries.
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
export function slackGatewayConfigFromEnv(env = process.env) {
  const port = Number(env.SLACK_GATEWAY_PORT);
  return {
    port: Number.isFinite(port) && port > 0 ? port : null,
    host: String(env.SLACK_GATEWAY_HOST ?? "0.0.0.0"),
    signingSecret: String(env.SLACK_SIGNING_SECRET ?? "").trim() || null,
    channelId: String(env.SLACK_CHANNEL_ID ?? "").trim() || null,
  };
}
