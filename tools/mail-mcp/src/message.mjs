/*
 * Shaping an IMAP message into the record the control plane imports.
 *
 * This lives apart from server.mjs on purpose: that module owns the stdio
 * JSON-RPC loop and attaches a process.stdin listener at import time, so it
 * cannot be imported by a test. Everything here is pure — envelope in, record
 * out — which is the whole testable surface of the read path.
 *
 * The shapes are the ones apps/server/src/services/mail-result.mjs parses:
 *   mail_list_unread -> { unread: [{ messageId, from, subject, date }] }
 *   mail_fetch       -> { messageId, from, subject, date, inReplyTo,
 *                         references, body }
 */

import { createHash } from "node:crypto";

const MAX_BODY = 20_000;
const MAX_HTML_BODY = 50_000;
const MAX_CLASSIFICATION_HEADERS = 8_192;

export function formatAddresses(addresses = []) {
  return addresses.map(({ name, address }) => (name ? `${name} <${address}>` : address)).filter(Boolean).join(", ");
}

export function headerOf(message, context = {}) {
  if (!message?.envelope) return null;
  const envelope = message.envelope;
  const classificationHeaders = classificationHeadersOf(message.headers);
  return {
    messageId: envelope.messageId ?? null,
    from: formatAddresses(envelope.from),
    subject: envelope.subject ?? "",
    // #1199: a malformed Date header parses to an Invalid Date, which is still
    // `instanceof Date` but throws RangeError on toISOString(). listUnread maps
    // headerOf over the whole batch, so one poisoned message would have hidden
    // every other unread. Guard validity, not just the type.
    date: envelope.date instanceof Date && !Number.isNaN(envelope.date.getTime())
      ? envelope.date.toISOString()
      : String(envelope.date ?? ""),
    ...(Number.isInteger(message.uid) ? { uid: message.uid } : {}),
    ...(context.folderId ? { folderId: String(context.folderId) } : {}),
    ...(context.folderPath ? { folderPath: String(context.folderPath) } : {}),
    ...(message.flags instanceof Set ? { unread: !message.flags.has("\\Seen") } : {}),
    ...(classificationHeaders ? { classificationHeaders } : {}),
  };
}

export function classificationHeadersOf(value) {
  if (!Buffer.isBuffer(value) && typeof value !== "string") return null;
  const raw = String(Buffer.isBuffer(value) ? value.toString("utf8") : value)
    .slice(0, MAX_CLASSIFICATION_HEADERS)
    .replace(/\r?\n[ \t]+/g, " ");
  const headers = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (!headers.has(key)) headers.set(key, match[2].trim());
  }
  const listId = boundedHeader(headers.get("list-id"), 255);
  const autoSubmitted = boundedHeader(headers.get("auto-submitted"), 80);
  const precedence = boundedHeader(headers.get("precedence"), 80);
  const listUnsubscribe = headers.has("list-unsubscribe");
  if (!listId && !autoSubmitted && !precedence && !listUnsubscribe) return null;
  return {
    ...(listId ? { listId } : {}),
    ...(listUnsubscribe ? { listUnsubscribe: true } : {}),
    ...(autoSubmitted ? { autoSubmitted } : {}),
    ...(precedence ? { precedence } : {}),
  };
}

function boundedHeader(value, max) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) || null;
}

// The threading headers are NOT decoration: mail-issue-transcription.mjs maps a
// reply onto its existing issue by inReplyTo/references, and opens a DUPLICATE
// issue without them. mail-result.mjs tolerates their absence, so dropping them
// here fails silently — one new issue per reply, forever.
//
// `inReplyTo` comes from the IMAP ENVELOPE. `references` is not an ENVELOPE
// field, so it comes from the parsed source; mailparser hands back an array (or
// a lone string when there is exactly one), and mail-result.mjs accepts both —
// normalize to an array here anyway, so the wire shape is one thing.
export function messageRecordOf(message, parsed) {
  const header = headerOf(message);
  if (!header) return null;
  const references = parsed?.references ?? [];
  const rawHtml = typeof parsed?.html === "string" ? parsed.html : "";
  const rawText = typeof parsed?.text === "string" ? parsed.text : rawHtml ? fallbackHtmlText(rawHtml) : "";
  return {
    ...header,
    inReplyTo: message.envelope?.inReplyTo ?? null,
    references: Array.isArray(references) ? references.filter(Boolean) : [references].filter(Boolean),
    body: rawText.slice(0, MAX_BODY),
    bodyHtml: rawHtml.slice(0, MAX_HTML_BODY),
    hasHtml: Boolean(rawHtml),
    bodyTruncated: rawText.length > MAX_BODY || rawHtml.length > MAX_HTML_BODY,
    bodyContentVersion: 2,
    attachments: (parsed?.attachments ?? []).slice(0, 50).map(attachmentMetadataOf),
  };
}

export function attachmentMetadataOf(attachment, index) {
  const name = String(attachment?.filename ?? `attachment-${Number(index) + 1}`).slice(0, 255);
  const contentType = String(attachment?.contentType ?? "application/octet-stream").toLowerCase().slice(0, 127);
  const size = Number.isFinite(attachment?.size) ? Math.max(0, Number(attachment.size)) : attachment?.content?.length ?? 0;
  const content = Buffer.from(attachment?.content ?? []);
  const contentId = normalizeContentId(attachment?.contentId);
  return {
    id: `attachment-${Number(index) + 1}`,
    name,
    contentType,
    size,
    sha256: createHash("sha256").update(content).digest("hex"),
    previewable: previewKind(contentType) !== null,
    ...(contentId ? { contentId } : {}),
  };
}

function normalizeContentId(value) {
  return String(value ?? "").trim().replace(/^<|>$/g, "").slice(0, 998) || null;
}

function fallbackHtmlText(value) {
  return String(value ?? "")
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function previewKind(contentType) {
  if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(contentType)) return "image";
  if (contentType === "text/plain") return "text";
  if (contentType === "application/pdf") return "pdf";
  return null;
}
