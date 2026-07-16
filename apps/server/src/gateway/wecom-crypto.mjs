/*
 * WeCom (Enterprise WeChat) callback cryptography (S3, #1090/ADR 0012).
 * Implements the documented scheme with node:crypto only — no dependencies:
 *
 *   msg_signature = sha1(sort(token, timestamp, nonce, encrypted).join(""))
 *   AESKey        = base64decode(EncodingAESKey + "=")   → 32 bytes
 *   iv            = AESKey[0..16]
 *   plaintext     = random(16) + msg_len(4, network order) + msg + receiveId
 *   ciphertext    = base64(AES-256-CBC(plaintext, PKCS#7 block=32))
 *
 * Decrypt verifies the receiveId (CorpID) suffix — a ciphertext encrypted for
 * another tenant fails closed. Signature comparison is constant-time.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const BLOCK_SIZE = 32; // WeCom's reference PKCS#7 uses a 32-byte block

export function computeMsgSignature(token, timestamp, nonce, encrypted) {
  const joined = [String(token), String(timestamp), String(nonce), String(encrypted)].sort().join("");
  return createHash("sha1").update(joined).digest("hex");
}

export function verifyMsgSignature({ token, timestamp, nonce, encrypted, signature }) {
  const expected = computeMsgSignature(token, timestamp, nonce, encrypted);
  const provided = String(signature ?? "");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(provided, "utf8"));
}

function aesKeyFrom(encodingAesKey) {
  const key = Buffer.from(String(encodingAesKey ?? "") + "=", "base64");
  if (key.length !== 32) {
    throw new Error("wecom_invalid_encoding_aes_key");
  }
  return key;
}

function pkcs7Pad(buffer) {
  const padLength = BLOCK_SIZE - (buffer.length % BLOCK_SIZE) || BLOCK_SIZE;
  return Buffer.concat([buffer, Buffer.alloc(padLength, padLength)]);
}

function pkcs7Unpad(buffer) {
  const padLength = buffer[buffer.length - 1];
  if (!padLength || padLength > BLOCK_SIZE || padLength > buffer.length) {
    throw new Error("wecom_invalid_padding");
  }
  return buffer.subarray(0, buffer.length - padLength);
}

/**
 * Decrypt a WeCom `Encrypt` payload. Returns the inner message string.
 * Throws (opaquely, no plaintext detail) on bad key, padding, structure, or a
 * receiveId mismatch.
 */
export function decryptWecomMessage({ encodingAesKey, encrypted, receiveId }) {
  const key = aesKeyFrom(encodingAesKey);
  const iv = key.subarray(0, 16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  let padded;
  try {
    padded = Buffer.concat([decipher.update(Buffer.from(String(encrypted ?? ""), "base64")), decipher.final()]);
  } catch {
    throw new Error("wecom_decrypt_failed");
  }
  const plain = pkcs7Unpad(padded);
  if (plain.length < 20) {
    throw new Error("wecom_invalid_plaintext");
  }
  const messageLength = plain.readUInt32BE(16);
  const messageEnd = 20 + messageLength;
  if (messageEnd > plain.length) {
    throw new Error("wecom_invalid_plaintext");
  }
  const message = plain.subarray(20, messageEnd).toString("utf8");
  const embeddedReceiveId = plain.subarray(messageEnd).toString("utf8");
  if (String(receiveId ?? "") && embeddedReceiveId !== String(receiveId)) {
    throw new Error("wecom_receive_id_mismatch");
  }
  return message;
}

/** Encrypt a message the way WeCom does (used for tests and passive replies). */
export function encryptWecomMessage({ encodingAesKey, message, receiveId, random = randomBytes(16) }) {
  const key = aesKeyFrom(encodingAesKey);
  const iv = key.subarray(0, 16);
  const messageBuffer = Buffer.from(String(message ?? ""), "utf8");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(messageBuffer.length);
  const plain = Buffer.concat([
    Buffer.from(random),
    lengthBuffer,
    messageBuffer,
    Buffer.from(String(receiveId ?? ""), "utf8"),
  ]);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(pkcs7Pad(plain)), cipher.final()]).toString("base64");
}

const XML_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

/**
 * Minimal, mechanical field extraction from a WeCom XML document. Not a general
 * XML parser by design: no DTDs, no attributes, no nesting — just the known
 * first-level fields, CDATA-or-entity-decoded. Anything else is ignored.
 */
// Anchored, linear-time field extraction (code-review M2). The earlier
// `<f>(?:<![CDATA[..]]>|..*?)</f>` regex has two lazy `[\s\S]*?` alternatives and
// runs on the RAW request body BEFORE signature verification (the signed value
// lives inside the XML), so a crafted body of many unclosed `<Encrypt>` tags
// caused ~O(n²) event-loop stalls. indexOf scanning is linear per field and
// preserves the CDATA-takes-precedence semantics (CDATA content may itself
// contain a `</field>`, so CDATA end is found by `]]>`, not the close tag).
const CDATA_OPEN = "<![CDATA[";
const CDATA_CLOSE = "]]>";

export function extractXmlFields(xml, fields) {
  const text = String(xml ?? "");
  const out = {};
  for (const field of fields) {
    const start = text.indexOf(`<${field}>`);
    if (start === -1) continue;
    const from = start + field.length + 2;
    if (text.startsWith(CDATA_OPEN, from)) {
      const cdataFrom = from + CDATA_OPEN.length;
      const cdataEnd = text.indexOf(CDATA_CLOSE, cdataFrom);
      if (cdataEnd === -1) continue;
      out[field] = text.slice(cdataFrom, cdataEnd);
    } else {
      const end = text.indexOf(`</${field}>`, from);
      if (end === -1) continue;
      out[field] = text.slice(from, end).replace(/&amp;|&lt;|&gt;|&quot;|&apos;/g, (entity) => XML_ENTITIES[entity]);
    }
  }
  return out;
}
