/*
 * Read surface for an invocation's trace tree — the trace + its spans, INCLUDING
 * the ones the count cap evicted to the durable archive (slice 2). Merges the
 * live snapshot with the archived rows, dedupes by id. Spans are chronological
 * (a tree read); the trace is one record per invocation. Mirrors the
 * invocation-events / invocation-refusals read surfaces.
 */

const DEFAULT_SPAN_LIMIT = 500;
const MAX_SPAN_LIMIT = 2000;

export function createInvocationTraceService({ state, readArchiveWithMetadata }) {
  function readArchive(collection, filter) {
    return typeof readArchiveWithMetadata === "function"
      ? readArchiveWithMetadata(collection, { filter })
      : { entries: [], malformedLines: 0, readError: null };
  }
  function damaged(archive, invalidRows) {
    return Number(archive.malformedLines ?? 0) > 0 || Boolean(archive.readError) || invalidRows > 0;
  }

  function getInvocationTrace(invocation, { limit = DEFAULT_SPAN_LIMIT } = {}) {
    const cap = clampLimit(limit);

    // The trace: one record whose subject is this invocation (live wins on overlap).
    const traceArchive = readArchive("traces", (row) => row?.subjectId === invocation.id);
    let invalidTraces = 0;
    const traceById = new Map();
    for (const entry of traceArchive.entries ?? []) {
      const trace = entry?.row;
      if (!isInvocationTrace(trace, invocation.id)) { invalidTraces += 1; continue; }
      if (!traceById.has(trace.id)) traceById.set(trace.id, trace);
    }
    for (const trace of state.traces ?? []) {
      if (isInvocationTrace(trace, invocation.id)) traceById.set(trace.id, trace);
    }
    const trace = [...traceById.values()][0] ?? null;
    const traceId = trace?.id ?? invocation.traceId ?? null;

    // The spans under that trace (live + archived), deduped by span id.
    const spanArchive = readArchive("spans", (row) => row?.traceId === traceId);
    let invalidSpans = 0;
    const spanById = new Map();
    for (const entry of spanArchive.entries ?? []) {
      const span = entry?.row;
      if (!isTraceSpan(span, traceId)) { invalidSpans += 1; continue; }
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
        || damaged(traceArchive, invalidTraces)
        || damaged(spanArchive, invalidSpans),
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
