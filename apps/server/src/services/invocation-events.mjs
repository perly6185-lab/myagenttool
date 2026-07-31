const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 2_048;

export function createInvocationEventService({ state, readInvocationEventArchive, readArchiveWithMetadata }) {
  function listInvocationEvents(invocation, { before = null, limit = DEFAULT_PAGE_SIZE } = {}) {
    const pageSize = clampPageSize(limit);
    const boundary = before !== null && before !== undefined
      ? decodeCursor(before, invocation.id)
      : null;
    const archive = typeof readInvocationEventArchive === "function"
      ? readInvocationEventArchive(invocation.id)
      : typeof readArchiveWithMetadata === "function"
        ? readArchiveWithMetadata("events", {
          filter: (row) => row?.invocationId === invocation.id,
        })
        : { entries: [], malformedLines: 0, readError: null };

    let invalidArchivedRows = 0;
    const byId = new Map();
    for (const entry of archive.entries ?? []) {
      const event = entry?.row;
      if (!isInvocationEvent(event, invocation.id)) {
        invalidArchivedRows += 1;
        continue;
      }
      // readArchiveWithMetadata returns newest archive writes first. Keep that
      // first copy if a crash caused the same overflow row to be appended twice.
      if (!byId.has(event.id)) byId.set(event.id, event);
    }
    for (const event of state.events ?? []) {
      if (!isInvocationEvent(event, invocation.id)) continue;
      // The snapshot is the canonical copy while an event straddles hot storage
      // and the archive after a crash between append and snapshot persistence.
      byId.set(event.id, event);
    }

    const allEvents = [...byId.values()].sort(compareEvents);
    const eligible = boundary
      ? allEvents.filter((event) => compareEventToCursor(event, boundary) < 0)
      : allEvents;
    // `before` walks backward from the newest window, while each returned page
    // remains lifecycle-readable from oldest to newest.
    const pageStart = Math.max(0, eligible.length - pageSize);
    const events = eligible.slice(pageStart).map(publicInvocationEvent);
    const hasMore = pageStart > 0;
    const nextCursor = hasMore && events.length > 0
      ? encodeCursor(invocation.id, events[0])
      : null;

    return {
      invocationId: invocation.id,
      events,
      nextCursor,
      hasMore,
      retentionTruncated: invocationHistoryTruncated({
        invocation,
        allEvents,
        retention: state.eventHistoryRetention,
        archive,
        invalidArchivedRows,
      }),
    };
  }

  return { listInvocationEvents };
}

function invocationHistoryTruncated({ invocation, allEvents, retention, archive, invalidArchivedRows }) {
  const knownFailure = Boolean(retention?.globalTruncated)
    || (retention?.truncatedInvocationIds ?? []).includes(invocation.id);
  const archiveDamaged = Number(archive?.malformedLines ?? 0) > 0
    || Boolean(archive?.readError)
    || invalidArchivedRows > 0;
  // Every invocation created through the service emits a stable first lifecycle
  // marker. Its absence also detects history lost by the pre-archive 500-row ring.
  const expectedStartType = invocation?.options?.metadata?.managedCodexSessionId
    ? "codex_session_registered"
    : "invocation_created";
  const hasKnownStart = allEvents.some((event) => event.type === expectedStartType);
  return knownFailure || archiveDamaged || !hasKnownStart;
}

function isInvocationEvent(event, invocationId) {
  return Boolean(event)
    && typeof event === "object"
    && typeof event.id === "string"
    && event.id.length > 0
    && event.invocationId === invocationId
    && typeof event.type === "string"
    && typeof event.createdAt === "string";
}

export function publicInvocationEvent(event) {
  const codexEvent = isCodexProviderEvent(event);
  return {
    id: event.id,
    invocationId: event.invocationId,
    type: event.type,
    level: event.level,
    message: codexEvent && String(event.message ?? "").startsWith("Codex thread started:")
      ? "Codex thread started."
      : event.message,
    data: publicEventData(event),
    createdAt: event.createdAt,
  };
}

function publicEventData(event) {
  const data = event?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return data ?? null;
  const {
    claudeSessionId: _claudeSessionId,
    resumeSessionId: _resumeSessionId,
    ...withoutProviderIds
  } = data;
  const claudeEvent = String(event?.type ?? "").startsWith("claude_")
    || ["claude_sdk", "claude_jsonl"].includes(data.source)
    || data.runtime === "agent_sdk";
  const codexEvent = isCodexProviderEvent(event);
  if (!claudeEvent && !codexEvent) return withoutProviderIds;
  const {
    sessionId: _sessionId,
    threadId: _threadId,
    turnId: _turnId,
    ...safe
  } = withoutProviderIds;
  return safe;
}

function isCodexProviderEvent(event) {
  return String(event?.type ?? "").startsWith("codex_")
    || event?.data?.source === "codex_jsonl";
}

function compareEvents(left, right) {
  const byOrdinal = compareEventOrdinals(left.id, right.id);
  if (byOrdinal !== 0) return byOrdinal;
  const byTime = left.createdAt.localeCompare(right.createdAt);
  return byTime || left.id.localeCompare(right.id);
}

function compareEventToCursor(event, cursor) {
  return compareEvents(event, cursor);
}

function compareEventOrdinals(left, right) {
  const leftMatch = /([0-9]+)$/.exec(left);
  const rightMatch = /([0-9]+)$/.exec(right);
  if (leftMatch && rightMatch) {
    const leftOrdinal = BigInt(leftMatch[1]);
    const rightOrdinal = BigInt(rightMatch[1]);
    if (leftOrdinal < rightOrdinal) return -1;
    if (leftOrdinal > rightOrdinal) return 1;
    return 0;
  }
  // Keep the comparator transitive for legacy/non-standard ids: all numeric
  // allocator ids form one ordered class, all other ids use time + lexical
  // ordering after it. Mixing time for only one side creates cursor gaps.
  if (leftMatch) return -1;
  if (rightMatch) return 1;
  return 0;
}

function clampPageSize(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_PAGE_SIZE;
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, parsed));
}

function encodeCursor(invocationId, event) {
  return Buffer.from(JSON.stringify({
    v: CURSOR_VERSION,
    invocationId,
    createdAt: event.createdAt,
    id: event.id,
  })).toString("base64url");
}

function decodeCursor(value, invocationId) {
  try {
    if (
      typeof value !== "string"
      || !value
      || value.length > MAX_CURSOR_LENGTH
      || !/^[A-Za-z0-9_-]+$/.test(value)
    ) {
      throw new Error("invalid");
    }
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      parsed?.v !== CURSOR_VERSION
      || parsed.invocationId !== invocationId
      || typeof parsed.createdAt !== "string"
      || !parsed.createdAt
      || typeof parsed.id !== "string"
      || !parsed.id
    ) {
      throw new Error("invalid");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    const error = new Error("Invalid invocation event cursor.");
    error.code = "invalid_cursor";
    throw error;
  }
}
