/*
 * DingTalk (钉钉) enterprise-internal-robot callback verification (D1, #1119).
 * node:crypto only. Unlike WeCom/Feishu (AES), a DingTalk robot callback is
 * plaintext JSON whose integrity is an HMAC-SHA256 signature:
 *
 *   sign = base64(HmacSHA256(key = appSecret, msg = `${timestamp}\n${appSecret}`))
 *
 * verified against the `sign` header (constant-time), plus a timestamp-freshness
 * window. The body is parsed mechanically — no field is interpreted.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export function computeDingtalkSignature(timestamp, appSecret) {
  const stringToSign = `${timestamp}\n${appSecret}`;
  return createHmac("sha256", String(appSecret ?? "")).update(stringToSign, "utf8").digest("base64");
}

export function verifyDingtalkSignature({ timestamp, appSecret, signature }) {
  const expected = computeDingtalkSignature(timestamp, appSecret);
  const provided = String(signature ?? "");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(provided, "utf8"));
}

/**
 * Parse a DingTalk robot-callback JSON body into a normalized shape. Total:
 * never throws; a non-message document returns `{ kind: "unknown" }`.
 *
 * Content is `text.content` for text messages; other message types keep their
 * raw text (as data). `senderStaffId` is the sender's DingTalk userid.
 */
export function parseDingtalkMessage(jsonString) {
  let doc;
  try {
    doc = JSON.parse(String(jsonString ?? ""));
  } catch {
    return { kind: "unknown" };
  }
  const msgId = String(doc?.msgId ?? "");
  const senderStaffId = String(doc?.senderStaffId ?? doc?.senderId ?? "");
  if (!msgId || !senderStaffId) {
    return { kind: "unknown" };
  }
  const msgType = String(doc?.msgtype ?? "text");
  const content = msgType === "text" ? String(doc?.text?.content ?? "").trim() : String(doc?.text?.content ?? "");
  return {
    kind: "message",
    msgId,
    externalUserId: senderStaffId,
    conversationId: String(doc?.conversationId ?? ""),
    conversationType: String(doc?.conversationType ?? ""),
    msgType,
    content,
    createAt: String(doc?.createAt ?? ""),
  };
}
