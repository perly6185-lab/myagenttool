import { SERVER_REFUSAL_EVENT_TYPES } from "./refusal-log.mjs";

const warnedRefusalBypass = new Set();
export const EVENT_HOT_LIMIT = 500;
const TRUNCATED_INVOCATION_ID_LIMIT = 1_000;

export function createEventLogRuntime({
  state,
  now,
  nextId,
  persistStateSoon,
  getCodexEventHandlers,
  archiveEvicted,
}) {
  // The structural chokepoint (refusal model Phase 2, #760): a refusal-typed
  // event may only reach the log via refuse(), which passes { viaRefuse: true }.
  // A denial that appends one directly has bypassed the single writer — throw
  // under REFUSAL_STRICT (the refusal test suite), warn otherwise so a stray
  // legacy path never turns a live refusal into a 500.
  function appendEvent(event, options = {}) {
    if (event && SERVER_REFUSAL_EVENT_TYPES.has(event.type) && !options.viaRefuse) {
      const message = `refusal-typed event "${event.type}" appended outside refuse() — route it through the single writer`;
      if (process.env.REFUSAL_STRICT === "1") {
        throw new Error(message);
      }
      if (!warnedRefusalBypass.has(event.type)) {
        warnedRefusalBypass.add(event.type);
        console.warn(`[refusal] ${message}`);
      }
    }
    const invocation = event?.invocationId
      ? (state.invocations ?? []).find((row) => row.id === event.invocationId) ?? null
      : null;
    const executionChainId = event?.data?.executionChainId
      ?? invocation?.options?.metadata?.executionChainId
      ?? invocation?.input?.metadata?.executionChainId
      ?? null;
    const record = {
      id: nextId("evt_demo"),
      invocationId: event.invocationId,
      type: event.type,
      level: event.level,
      message: event.message,
      data: executionChainId ? { ...(event.data ?? {}), executionChainId } : event.data ?? null,
      createdAt: now()
    };
    state.events.unshift(record);
    // Keep /api/state as a bounded real-time tail, but archive the overflow
    // synchronously BEFORE removing it. A crash before the later state snapshot
    // can leave a duplicate in hot + archive; the invocation detail reader
    // de-duplicates by id at that boundary.
    const overflow = state.events.slice(EVENT_HOT_LIMIT);
    if (overflow.length > 0) {
      let archiveResult = null;
      try {
        archiveResult = typeof archiveEvicted === "function"
          ? archiveEvicted("events", overflow)
          : null;
      } catch (error) {
        archiveResult = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (archiveResult?.ok !== true) {
        markEventHistoryTruncated(state, overflow, now(), archiveResult?.error ?? "event_archive_unavailable");
      }
      state.events = state.events.slice(0, EVENT_HOT_LIMIT);
    }
    const handlers = getCodexEventHandlers();
    handlers.updateCodexSessionFromEvent(record);
    handlers.createCodexEvidenceRecord(record);
    persistStateSoon();
    return record;
  }

  return { appendEvent };
}

function markEventHistoryTruncated(state, rows, failedAt, error) {
  const retention = state.eventHistoryRetention && typeof state.eventHistoryRetention === "object"
    ? state.eventHistoryRetention
    : {};
  const ids = Array.isArray(retention.truncatedInvocationIds)
    ? retention.truncatedInvocationIds.filter((id) => typeof id === "string" && id)
    : [];
  const seen = new Set(ids);
  for (const row of rows) {
    if (typeof row?.invocationId !== "string" || !row.invocationId || seen.has(row.invocationId)) continue;
    if (ids.length >= TRUNCATED_INVOCATION_ID_LIMIT) {
      retention.globalTruncated = true;
      break;
    }
    ids.push(row.invocationId);
    seen.add(row.invocationId);
  }
  retention.truncatedInvocationIds = ids;
  retention.globalTruncated = Boolean(retention.globalTruncated);
  retention.lastArchiveErrorAt = failedAt;
  retention.lastArchiveError = String(error ?? "event_archive_unavailable").slice(0, 500);
  state.eventHistoryRetention = retention;
}
