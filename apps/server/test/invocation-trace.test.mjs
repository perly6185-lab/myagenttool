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

test("prefers the indexed store query — traces scoped by invocationId, spans by traceId (earliest-first)", () => {
  const state = { traces: [], spans: [] };
  const calls = [];
  const queryHistory = (collection, opts) => {
    calls.push({ collection, invocationId: opts.invocationId, order: opts.order });
    if (collection === "traces") return { rows: [{ id: "trc_1", subjectType: "invocation", subjectId: "inv_1", createdAt: "t0" }], nextBefore: null };
    return { rows: [{ id: "spn_1", traceId: "trc_1", startedAt: "t", name: "n", status: "s" }], nextBefore: null };
  };
  const { getInvocationTrace } = createInvocationTraceService({ state, readArchiveWithMetadata: null, queryHistory });
  const result = getInvocationTrace({ id: "inv_1", traceId: "trc_1" });
  assert.deepEqual(
    calls,
    [{ collection: "traces", invocationId: "inv_1", order: "desc" }, { collection: "spans", invocationId: "trc_1", order: "asc" }],
    "spans queried by traceId scope, earliest-first so the root span survives the cap",
  );
  assert.equal(result.trace.id, "trc_1");
  assert.deepEqual(result.spans.map((s) => s.id), ["spn_1"]);
});

test("the root span survives the archive cap: earliest-first read keeps the lowest-rowid span", () => {
  // The store evicts oldest-first, so the root span has the lowest rowid. Simulate
  // a queryHistory that honours order: "asc" returns the earliest `limit` rows.
  const archived = Array.from({ length: 6 }, (_, i) => ({ id: `spn_${i}`, traceId: "trc_1", parentSpanId: i === 0 ? null : "spn_0", name: `n${i}`, status: "s", startedAt: `2026-07-17T00:00:0${i}.000Z` }));
  const state = { traces: [{ id: "trc_1", subjectType: "invocation", subjectId: "inv_1", rootSpanId: "spn_0", createdAt: "t0" }], spans: [] };
  const queryHistory = (collection, opts) => {
    if (collection === "traces") return { rows: state.traces, nextBefore: null };
    const ordered = opts.order === "asc" ? archived : [...archived].reverse();
    const page = ordered.slice(0, opts.limit);
    return { rows: page, nextBefore: page.length < ordered.length ? 1 : null };
  };
  const { getInvocationTrace } = createInvocationTraceService({ state, readArchiveWithMetadata: null, queryHistory });
  const result = getInvocationTrace({ id: "inv_1", traceId: "trc_1" }, { limit: 3 });
  assert.ok(result.spans.some((s) => s.id === "spn_0"), "root span (earliest) is present, not dropped off the newest-cap page");
  assert.equal(result.spans[0].id, "spn_0", "root remains chronologically first");
  assert.equal(result.trace.rootSpanId, "spn_0");
});

test("a null trace scope short-circuits: no unscoped whole-table span query, no false truncated", () => {
  const state = { traces: [], spans: [] };
  const calls = [];
  const queryHistory = (collection, opts) => {
    calls.push({ collection, invocationId: opts.invocationId });
    if (collection === "traces") return { rows: [], nextBefore: null };
    return { rows: [{ id: "leak", traceId: "trc_other", startedAt: "t", name: "n", status: "s" }], nextBefore: 99 };
  };
  const { getInvocationTrace } = createInvocationTraceService({ state, readArchiveWithMetadata: null, queryHistory });
  const result = getInvocationTrace({ id: "inv_1" }); // no trace record, no invocation.traceId → scope null
  assert.deepEqual(calls, [{ collection: "traces", invocationId: "inv_1" }], "spans NOT queried when the trace scope is null");
  assert.deepEqual(result.spans, []);
  assert.equal(result.truncated, false, "an unresolved trace is empty, not truncated");
});
