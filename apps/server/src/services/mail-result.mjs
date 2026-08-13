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
const MAX_ATTACHMENTS = 50;
const MAX_FOLDERS = 20;

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

  if (Array.isArray(payload.folders) && Array.isArray(payload.cursors) && Array.isArray(payload.messages)) {
    const folders = payload.folders.slice(0, MAX_FOLDERS).map(normalizeFolder).filter(Boolean);
    const allowedPaths = new Set(folders.map((folder) => folder.path));
    const messages = payload.messages.slice(0, MAX_HEADERS * MAX_FOLDERS).map(normalizeSyncedHeader).filter((header) => header && allowedPaths.has(header.folderPath));
    const cursors = payload.cursors.slice(0, MAX_FOLDERS).map(normalizeCursor).filter((cursor) => cursor && allowedPaths.has(cursor.folderPath));
    const readStates = Array.isArray(payload.readStates) ? payload.readStates.slice(0, MAX_HEADERS * MAX_FOLDERS).map(normalizeSyncedReadState).filter(Boolean) : [];
    return { kind: "mailbox_sync", folders, messages, readStates, cursors };
  }

  if (payload.readState && typeof payload.readState === "object") {
    const messageId = cap(payload.readState.messageId, MAX_FIELD);
    const folderPath = cap(payload.readState.folderPath, MAX_FIELD);
    if (!messageId || !folderPath || typeof payload.readState.read !== "boolean") return null;
    return {
      kind: "read_state",
      messageId,
      folderId: cap(payload.readState.folderId, 100),
      folderPath,
      read: payload.readState.read,
    };
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
    const attachments = Array.isArray(payload.attachments)
      ? payload.attachments.slice(0, MAX_ATTACHMENTS).map(normalizeAttachment).filter(Boolean)
      : [];
    return {
      kind: "message",
      ...header,
      folderId: cap(payload.folderId, 100) ?? "inbox",
      folderPath: cap(payload.folderPath, MAX_FIELD) ?? "INBOX",
      inReplyTo: cap(payload.inReplyTo, MAX_FIELD),
      references,
      body: cap(payload.body, MAX_BODY) ?? "",
      attachments,
      attachmentMetadataLoaded: true,
    };
  }

  return null;
}

function normalizeFolder(value) {
  if (!value || typeof value !== "object") return null;
  const id = cap(value.id, 100);
  const path = cap(value.path, MAX_FIELD);
  const name = cap(value.name, 255);
  if (!id || !path || !name) return null;
  return {
    id,
    path,
    name,
    specialUse: cap(value.specialUse, 30),
    count: boundedCount(value.count),
    unread: boundedCount(value.unread),
    cursorReset: value.cursorReset === true,
    syncError: value.syncError === true,
  };
}

function normalizeSyncedHeader(value) {
  const header = normalizeHeader(value);
  const folderId = cap(value?.folderId, 100);
  const folderPath = cap(value?.folderPath, MAX_FIELD);
  if (!header || !folderId || !folderPath) return null;
  return {
    ...header,
    folderId,
    folderPath,
    uid: Number.isInteger(value.uid) && value.uid > 0 ? value.uid : null,
    unread: value.unread !== false,
  };
}

function normalizeCursor(value) {
  if (!value || typeof value !== "object") return null;
  const folderId = cap(value.folderId, 100);
  const folderPath = cap(value.folderPath, MAX_FIELD);
  const uidValidity = cap(value.uidValidity, 30);
  if (!folderId || !folderPath || !uidValidity) return null;
  return { folderId, folderPath, uidValidity, lastUid: Number.isInteger(value.lastUid) ? Math.max(0, value.lastUid) : 0 };
}

function normalizeSyncedReadState(value) {
  if (!value || typeof value !== "object") return null;
  const folderId = cap(value.folderId, 100);
  const folderPath = cap(value.folderPath, MAX_FIELD);
  if (!folderId || !folderPath || !Number.isInteger(value.uid) || value.uid < 1 || typeof value.unread !== "boolean") return null;
  return { folderId, folderPath, uid: value.uid, unread: value.unread };
}

function boundedCount(value) {
  return Number.isInteger(value) ? Math.max(0, Math.min(value, 10_000_000)) : 0;
}

function normalizeAttachment(value) {
  if (!value || typeof value !== "object") return null;
  const id = cap(value.id, 100);
  const name = cap(value.name, 255);
  if (!id || !name || !/^attachment-[1-9][0-9]*$/.test(id)) return null;
  return {
    id,
    name,
    contentType: cap(value.contentType, 127) ?? "application/octet-stream",
    size: Number.isFinite(value.size) ? Math.max(0, Math.min(Number(value.size), 25 * 1024 * 1024)) : 0,
    previewable: value.previewable === true,
  };
}
