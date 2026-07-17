/*
 * Slack Events API request verification (SL1, #1128). node:crypto only. Slack
 * signs the RAW body (stronger than DingTalk):
 *
 *   base = `v0:${X-Slack-Request-Timestamp}:${rawBody}`
 *   sig  = `v0=` + hex(HMAC-SHA256(signing_secret, base))
 *
 * verified against the `X-Slack-Signature` header (constant-time) plus a 5-min
 * timestamp window. The body is plaintext JSON; parsing is mechanical.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export function computeSlackSignature(signingSecret, timestamp, body) {
  const base = `v0:${timestamp}:${body}`;
  return `v0=${createHmac("sha256", String(signingSecret ?? "")).update(base, "utf8").digest("hex")}`;
}

export function verifySlackSignature({ signingSecret, timestamp, body, signature }) {
  const expected = computeSlackSignature(signingSecret, timestamp, body);
  const provided = String(signature ?? "");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(provided, "utf8"));
}

/**
 * Parse a Slack Events API body into a normalized, discriminated shape. Total:
 * never throws; unrecognized documents return `{ kind: "unknown" }`.
 *
 * Bot-authored messages (carrying `bot_id` or the `bot_message` subtype) return
 * `{ kind: "ignored" }` so the gateway never loops on its own replies.
 */
export function parseSlackEvent(jsonString) {
  let doc;
  try {
    doc = JSON.parse(String(jsonString ?? ""));
  } catch {
    return { kind: "unknown" };
  }
  if (doc?.type === "url_verification") {
    return { kind: "url_verification", challenge: String(doc.challenge ?? ""), token: String(doc.token ?? "") };
  }
  if (doc?.type !== "event_callback" || !doc?.event) {
    return { kind: "unknown" };
  }
  const event = doc.event;
  // Loop guard: never re-ingest the bot's own messages.
  if (event.bot_id || event.subtype === "bot_message") {
    return { kind: "ignored", reason: "bot_message" };
  }
  if (event.type !== "message" && event.type !== "app_mention") {
    return { kind: "unknown" };
  }
  const externalUserId = String(event.user ?? "");
  if (!externalUserId) {
    return { kind: "unknown" };
  }
  return {
    kind: "event",
    // event_id (outer envelope) is Slack's per-delivery dedup key; ts is the
    // per-message key. event_id is stable across Slack's retries.
    eventId: String(doc.event_id ?? event.ts ?? ""),
    token: String(doc.token ?? ""),
    externalUserId,
    channel: String(event.channel ?? ""),
    ts: String(event.ts ?? ""),
    content: String(event.text ?? "").trim(),
  };
}
