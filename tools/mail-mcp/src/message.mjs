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

export function formatAddresses(addresses = []) {
  return addresses.map(({ name, address }) => (name ? `${name} <${address}>` : address)).filter(Boolean).join(", ");
}

export function headerOf(message) {
  if (!message?.envelope) return null;
  const envelope = message.envelope;
  return {
    messageId: envelope.messageId ?? null,
    from: formatAddresses(envelope.from),
    subject: envelope.subject ?? "",
    date: envelope.date instanceof Date ? envelope.date.toISOString() : String(envelope.date ?? ""),
  };
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
  return {
    ...header,
    inReplyTo: message.envelope?.inReplyTo ?? null,
    references: Array.isArray(references) ? references.filter(Boolean) : [references].filter(Boolean),
    body: parsed?.text ?? parsed?.html ?? "",
  };
}
