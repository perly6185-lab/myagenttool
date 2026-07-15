/*
 * Parse a mail agent's structured output into importable records (#977 read-loop).
 *
 * `mail_list_unread` returns JSON text `{ unread: [{ messageId, from, subject,
 * date }] }`; `mail_fetch` returns one message `{ messageId, from, subject, date,
 * body }`. This turns either into a normalized record so the result shows up in
 * Application run history and the Evidence Center — the Result step of
 * Discovery → Access → Execute → Result.
 *
 * Two rules, both because mail is attacker-controlled text (#978):
 *   1. Every string is length-capped. A hostile sender cannot bloat state with a
 *      megabyte subject line.
 *   2. `messageId` — the idempotency key every later phase depends on — is
 *      preserved verbatim, but nothing here interprets any field as an
 *      instruction. This is a parser; it reads, it never acts.
 */

const MAX_HEADERS = 200;
const MAX_FIELD = 998; // RFC 5322 line-length ceiling; generous but bounded.
const MAX_BODY = 20000;

const cap = (value, max) => (typeof value === "string" ? value.slice(0, max) : null);

function normalizeHeader(entry) {
  if (!entry || typeof entry !== "object") return null;
  const messageId = cap(entry.messageId, MAX_FIELD);
  if (!messageId) return null; // no idempotency key -> not a usable record
  return {
    messageId,
    from: cap(entry.from, MAX_FIELD),
    subject: cap(entry.subject, MAX_FIELD),
    date: cap(entry.date, MAX_FIELD),
  };
}

// Dispatched from RESULT_PARSERS["mail_headers"]. Returns null on unreadable
// output — an unparsed result is still stored (with its raw text) rather than
// failing the invocation, exactly like the git parser.
export function parseMailApplicationResult({ text }) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;

  // list_unread: { unread: [...] }
  if (Array.isArray(payload.unread)) {
    const headers = payload.unread.slice(0, MAX_HEADERS).map(normalizeHeader).filter(Boolean);
    return { kind: "unread_headers", count: headers.length, headers };
  }

  // fetch: a single message with a body. The body is DATA — carried, capped,
  // never executed (#978). Threading headers (inReplyTo / references) are carried
  // when present so a reply can be mapped onto its existing issue rather than
  // opening a duplicate (Phase 3, #979). References is a space-separated list of
  // Message-IDs; keep it bounded and as an array.
  if (payload.messageId) {
    const header = normalizeHeader(payload);
    if (!header) return null;
    const references = Array.isArray(payload.references)
      ? payload.references.map((ref) => cap(ref, MAX_FIELD)).filter(Boolean).slice(0, 50)
      : typeof payload.references === "string"
        ? payload.references.split(/\s+/).map((ref) => cap(ref, MAX_FIELD)).filter(Boolean).slice(0, 50)
        : [];
    return {
      kind: "message",
      ...header,
      inReplyTo: cap(payload.inReplyTo, MAX_FIELD),
      references,
      body: cap(payload.body, MAX_BODY) ?? "",
    };
  }

  return null;
}
