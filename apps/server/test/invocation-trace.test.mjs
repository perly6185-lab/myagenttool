/*
 * Read surface for an invocation's trace tree — trace + spans, merging the live
 * snapshot with the spans the count cap evicted to the durable archive (slice 2).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createInvocationTraceService } from "../src/services/invocation-trace.mjs";

function archiveOf(rows) {
  return (collection, { filter } = {}) => ({
    entries: (rows[collection] ?? []).filter((entry) => (filter ? filter(entry.row) : true)),
    malformedLines: 0,
    readError: null,
  });
}

test("returns the invocation's trace + merged live/archived spans, chronological, deduped", () => {
  const state = {
    traces: [{ id: "trc_1", subjectType: "invocation", subjectId: "inv_1", rootSpanId: "spn_root", createdAt: "t0" }],
    spans: [
      { id: "spn_root", traceId: "trc_1", parentSpanId: null, name: "m0.remote_invocation", status: "succeeded", startedAt: "2026-07-17T00:00:00.000Z" },
      { id: "spn_r2", traceId: "trc_1", parentSpanId: "spn_root", name: "round.1", status: "succeeded", startedAt: "2026-07-17T00:00:02.000Z" },
      { id: "spn_other", traceId: "trc_2", parentSpanId: null, name: "other", status: "succeeded", startedAt: "x" },
    ],
  };
  const readArchiveWithMetadata = archiveOf({
    spans: [{ row: { id: "spn_r1", traceId: "trc_1", parentSpanId: "spn_root", name: "round.0", status: "succeeded", startedAt: "2026-07-17T00:00:01.000Z" } }],
    traces: [],
  });
  const { getInvocationTrace } = createInvocationTraceService({ state, readArchiveWithMetadata });
  const result = getInvocationTrace({ id: "inv_1", traceId: "trc_1" });
  assert.equal(result.trace.id, "trc_1");
  assert.deepEqual(result.spans.map((s) => s.id), ["spn_root", "spn_r1", "spn_r2"], "trc_1 spans only, chronological, archived merged");
  assert.equal(result.truncated, false);
});

test("live span wins over an archived duplicate; other traces excluded", () => {
  const state = {
    traces: [{ id: "trc_1", subjectType: "invocation", subjectId: "inv_1", createdAt: "t0" }],
    spans: [{ id: "spn_1", traceId: "trc_1", name: "round.0", status: "succeeded", startedAt: "t", endedAt: "t2" }],
  };
  const readArchiveWithMetadata = archiveOf({
    spans: [{ row: { id: "spn_1", traceId: "trc_1", name: "round.0", status: "started", startedAt: "t", endedAt: null } }],
    traces: [],
  });
  const { getInvocationTrace } = createInvocationTraceService({ state, readArchiveWithMetadata });
  const [span] = getInvocationTrace({ id: "inv_1", traceId: "trc_1" }).spans;
  assert.equal(span.status, "succeeded", "the live (completed) span is canonical, not the archived 'started' one");
  assert.equal(span.endedAt, "t2");
});

test("limit bounds the spans and flags truncated; a torn archive line also flags it", () => {
  const state = { traces: [], spans: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, traceId: "trc_1", name: "n", status: "s", startedAt: `2026-07-17T00:00:0${i}.000Z` })) };
  const svc = createInvocationTraceService({ state, readArchiveWithMetadata: archiveOf({ spans: [], traces: [] }) });
  const bounded = svc.getInvocationTrace({ id: "inv_1", traceId: "trc_1" }, { limit: 3 });
  assert.equal(bounded.spans.length, 3);
  assert.equal(bounded.truncated, true);
  const torn = createInvocationTraceService({ state, readArchiveWithMetadata: () => ({ entries: [], malformedLines: 1, readError: null }) });
  assert.equal(torn.getInvocationTrace({ id: "inv_1", traceId: "trc_1" }).truncated, true);
});

test("falls back to invocation.traceId when no trace record is found; no archive reader never throws", () => {
  const state = { traces: [], spans: [{ id: "s1", traceId: "trc_9", name: "n", status: "s", startedAt: "t" }] };
  const { getInvocationTrace } = createInvocationTraceService({ state, readArchiveWithMetadata: null });
  const result = getInvocationTrace({ id: "inv_1", traceId: "trc_9" });
  assert.equal(result.trace, null);
  assert.deepEqual(result.spans.map((s) => s.id), ["s1"], "spans found via invocation.traceId even without a trace record");
});
