/*
 * Read surface for an invocation's trace tree — the trace + its spans, INCLUDING
 * the ones the count cap evicted to the durable archive (slice 2). Merges the
 * live snapshot with the archived rows, dedupes by id. Spans are chronological
 * (a tree read); the trace is one record per invocation. Mirrors the
 * invocation-events / invocation-refusals read surfaces.
 */

const DEFAULT_SPAN_LIMIT = 500;
const MAX_SPAN_LIMIT = 2000;

export function createInvocationTraceService({ state, readArchiveWithMetadata, queryHistory }) {
  // Archived rows for a collection scoped to `scopeId` (invocationId for traces,
  // traceId for spans — matching the history table's scope column). Prefers the
  // indexed store query (ADR 0019 B-2, paginated) over the whole-file JSONL read.
  function readArchived(collection, scopeId, filter, cap, order = "desc") {
    // A null scope means there is nothing to look up — both traces (scoped to the
    // invocation id) and spans (scoped to the trace id) are scope-keyed. Skip the
    // query entirely: an unscoped history read would scan every invocation's rows
    // (then be filtered back to empty) and falsely raise `truncated`.
    if (scopeId == null) {
      return { rows: [], damaged: false, more: false };
    }
    if (typeof queryHistory === "function") {
      const page = queryHistory(collection, { invocationId: scopeId, limit: cap, order });
      return { rows: page.rows ?? [], damaged: false, more: page.nextBefore != null };
    }
    const archive = typeof readArchiveWithMetadata === "function"
      ? readArchiveWithMetadata(collection, { filter })
      : { entries: [], malformedLines: 0, readError: null };
    return {
      rows: (archive.entries ?? []).map((entry) => entry?.row),
      damaged: Number(archive.malformedLines ?? 0) > 0 || Boolean(archive.readError),
      more: false,
    };
  }

  function getInvocationTrace(invocation, { limit = DEFAULT_SPAN_LIMIT } = {}) {
    const cap = clampLimit(limit);

    // The trace: one record whose subject is this invocation (live wins on overlap).
    const traceArchive = readArchived("traces", invocation.id, (row) => row?.subjectId === invocation.id, cap);
    let invalidRows = 0;
    const traceById = new Map();
    for (const trace of traceArchive.rows) {
      if (!isInvocationTrace(trace, invocation.id)) { invalidRows += 1; continue; }
      if (!traceById.has(trace.id)) traceById.set(trace.id, trace);
    }
    for (const trace of state.traces ?? []) {
      if (isInvocationTrace(trace, invocation.id)) traceById.set(trace.id, trace);
    }
    const trace = [...traceById.values()][0] ?? null;
    const traceId = trace?.id ?? invocation.traceId ?? null;

    // The spans under that trace (live + archived), deduped by span id. Spans key
    // by traceId, so that is the scope passed to the indexed history query. Read
    // them EARLIEST-first (order: "asc"): eviction is oldest-first, so the root
    // span has the lowest rowid — a newest-cap read would drop it and dangle
    // trace.rootSpanId, diverging from the whole-file JSONL scan which keeps the
    // earliest cap. compareSpans re-sorts chronologically regardless.
    const spanArchive = readArchived("spans", traceId, (row) => row?.traceId === traceId, cap, "asc");
    const spanById = new Map();
    for (const span of spanArchive.rows) {
      if (!isTraceSpan(span, traceId)) { invalidRows += 1; continue; }
      if (!spanById.has(span.id)) spanById.set(span.id, span);
    }
    for (const span of state.spans ?? []) {
      if (isTraceSpan(span, traceId)) spanById.set(span.id, span);
    }
    const allSpans = [...spanById.values()].sort(compareSpans);

    return {
      invocationId: invocation.id,
      trace: trace ? publicTrace(trace) : null,
      spans: allSpans.slice(0, cap).map(publicSpan),
      truncated: allSpans.length > cap
        || traceArchive.more || traceArchive.damaged
        || spanArchive.more || spanArchive.damaged
        || invalidRows > 0,
    };
  }

  return { getInvocationTrace };
}

function clampLimit(limit) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SPAN_LIMIT;
  return Math.min(MAX_SPAN_LIMIT, parsed);
}

function isInvocationTrace(trace, invocationId) {
  return Boolean(trace) && typeof trace === "object" && typeof trace.id === "string" && trace.subjectId === invocationId;
}

function isTraceSpan(span, traceId) {
  return Boolean(span) && typeof span === "object" && typeof span.id === "string" && span.id.length > 0 && Boolean(traceId) && span.traceId === traceId;
}

// Chronological (a tree read): earliest-started first, stable id tie-break.
function compareSpans(left, right) {
  const byStart = String(left.startedAt ?? "").localeCompare(String(right.startedAt ?? ""));
  if (byStart !== 0) return byStart;
  return String(left.id).localeCompare(String(right.id));
}

function publicTrace(trace) {
  return { id: trace.id, subjectType: trace.subjectType, subjectId: trace.subjectId, rootSpanId: trace.rootSpanId ?? null, createdAt: trace.createdAt };
}

function publicSpan(span) {
  return {
    id: span.id,
    traceId: span.traceId,
    parentSpanId: span.parentSpanId ?? null,
    name: span.name,
    status: span.status,
    startedAt: span.startedAt,
    endedAt: span.endedAt ?? null,
    attributes: span.attributes ?? {},
  };
}
