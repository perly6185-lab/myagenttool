/*
 * Feishu (Lark) event-callback cryptography (F2, #1110). node:crypto only,
 * matching Feishu's documented scheme:
 *
 *   key        = sha256(EncryptKey)                       // 32 bytes
 *   ciphertext = base64decode(body.encrypt)
 *   iv         = ciphertext[0..16]                         // prefixed IV
 *   plaintext  = AES-256-CBC-decrypt(ciphertext[16..], key, iv), PKCS#7-unpadded
 *
 *   signature  = sha256(timestamp + nonce + EncryptKey + rawBody).hex()
 *                compared against the X-Lark-Signature header (constant-time)
 *
 * The decrypted JSON is either a url_verification challenge or a v2 event
 * (`im.message.receive_v1`). Parsing is mechanical — no field is interpreted.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const BLOCK_SIZE = 16; // AES block; Feishu uses standard PKCS#7 (block 16)

function feishuKey(encryptKey) {
  const key = String(encryptKey ?? "");
  if (!key) throw new Error("feishu_missing_encrypt_key");
  return createHash("sha256").update(key, "utf8").digest();
}

export function computeFeishuSignature(timestamp, nonce, encryptKey, body) {
  return createHash("sha256")
    .update(String(timestamp) + String(nonce) + String(encryptKey) + String(body), "utf8")
    .digest("hex");
}

export function verifyFeishuSignature({ timestamp, nonce, encryptKey, body, signature }) {
  const expected = computeFeishuSignature(timestamp, nonce, encryptKey, body);
  const provided = String(signature ?? "");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(provided, "utf8"));
}

function pkcs7Unpad(buffer) {
  const pad = buffer[buffer.length - 1];
  if (!pad || pad > BLOCK_SIZE || pad > buffer.length) {
    throw new Error("feishu_invalid_padding");
  }
  return buffer.subarray(0, buffer.length - pad);
}

function pkcs7Pad(buffer) {
  const pad = BLOCK_SIZE - (buffer.length % BLOCK_SIZE) || BLOCK_SIZE;
  return Buffer.concat([buffer, Buffer.alloc(pad, pad)]);
}

/**
 * Decrypt a Feishu `encrypt` payload → the inner JSON string. Throws opaquely
 * (no plaintext detail) on bad key/structure/padding.
 */
export function decryptFeishuMessage({ encryptKey, encrypt }) {
  const key = feishuKey(encryptKey);
  const blob = Buffer.from(String(encrypt ?? ""), "base64");
  if (blob.length <= 16 || (blob.length - 16) % BLOCK_SIZE !== 0) {
    throw new Error("feishu_invalid_ciphertext");
  }
  const iv = blob.subarray(0, 16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  let padded;
  try {
    padded = Buffer.concat([decipher.update(blob.subarray(16)), decipher.final()]);
  } catch {
    throw new Error("feishu_decrypt_failed");
  }
  return pkcs7Unpad(padded).toString("utf8");
}

/** Encrypt the way Feishu does (used by tests): base64(iv ‖ AES-256-CBC(pkcs7(plaintext))). */
export function encryptFeishuMessage({ encryptKey, plaintext, iv = randomBytes(16) }) {
  const key = feishuKey(encryptKey);
  const cipher = createCipheriv("aes-256-cbc", key, Buffer.from(iv));
  cipher.setAutoPadding(false);
  const body = Buffer.concat([cipher.update(pkcs7Pad(Buffer.from(String(plaintext ?? ""), "utf8"))), cipher.final()]);
  return Buffer.concat([Buffer.from(iv), body]).toString("base64");
}

/** Text content is a JSON string `{"text":"..."}`; other types keep their raw content as data. */
function extractText(message) {
  if (message?.message_type !== "text") return String(message?.content ?? "");
  try {
    const parsed = JSON.parse(String(message.content ?? "{}"));
    return String(parsed?.text ?? "");
  } catch {
    return String(message?.content ?? "");
  }
}

/**
 * Parse a decrypted Feishu JSON string into a normalized, discriminated shape.
 * Total: never throws; unrecognized documents return `{ kind: "unknown" }`.
 */
export function parseFeishuEvent(jsonString) {
  let doc;
  try {
    doc = JSON.parse(String(jsonString ?? ""));
  } catch {
    return { kind: "unknown" };
  }
  if (doc?.type === "url_verification") {
    return { kind: "url_verification", challenge: String(doc.challenge ?? ""), token: String(doc.token ?? "") };
  }
  const header = doc?.header ?? {};
  const event = doc?.event ?? {};
  if (header.event_type === "im.message.receive_v1" || event?.message) {
    const senderId = event?.sender?.sender_id ?? {};
    return {
      kind: "event",
      eventId: String(header.event_id ?? ""),
      token: String(header.token ?? ""),
      eventType: String(header.event_type ?? ""),
      createTime: String(header.create_time ?? ""),
      externalUserId: String(senderId.open_id ?? senderId.user_id ?? senderId.union_id ?? ""),
      messageId: String(event?.message?.message_id ?? ""),
      chatId: String(event?.message?.chat_id ?? ""),
      msgType: String(event?.message?.message_type ?? "text"),
      content: extractText(event?.message),
    };
  }
  return { kind: "unknown" };
}
