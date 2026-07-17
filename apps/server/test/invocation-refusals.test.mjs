/*
 * Read surface for an invocation's refusals, merging the live snapshot with the
 * ones the 200-row cap evicted to the durable archive (slice 1). Mirrors the
 * invocation-events read merge.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createInvocationRefusalService } from "../src/services/invocation-refusals.mjs";

test("merges live + archived refusals for one invocation, newest-first, deduped, other invocations excluded", () => {
  const state = {
    refusals: [
      { id: "ref_3", invocationId: "inv_1", at: "2026-07-17T00:00:03.000Z", category: "policy", code: "action_not_permitted", summary: "live 3" },
      { id: "ref_x", invocationId: "inv_2", at: "2026-07-17T00:00:09.000Z", category: "policy", code: "action_not_permitted", summary: "other inv" },
    ],
  };
  const readArchiveWithMetadata = (collection, { filter } = {}) => {
    assert.equal(collection, "refusals");
    const rows = [
      { archivedAt: "a2", row: { id: "ref_2", invocationId: "inv_1", at: "2026-07-17T00:00:02.000Z", category: "policy", code: "over_quota", summary: "archived 2" } },
      { archivedAt: "a1", row: { id: "ref_1", invocationId: "inv_1", at: "2026-07-17T00:00:01.000Z", category: "policy", code: "over_budget", summary: "archived 1" } },
      { archivedAt: "a0", row: { id: "ref_other", invocationId: "inv_2", at: "z", category: "policy" } },
    ];
    return { entries: rows.filter((entry) => (filter ? filter(entry.row) : true)), malformedLines: 0, readError: null };
  };
  const { listInvocationRefusals } = createInvocationRefusalService({ state, readArchiveWithMetadata });
  const result = listInvocationRefusals({ id: "inv_1" });
  assert.deepEqual(result.refusals.map((r) => r.id), ["ref_3", "ref_2", "ref_1"], "inv_1 only, newest first, archived merged");
  assert.equal(result.refusals[0].summary, "live 3");
  assert.equal(result.truncated, false);
});

test("the live snapshot wins over an archived duplicate (e.g. a post-hoc PII scrub)", () => {
  const state = { refusals: [{ id: "ref_1", invocationId: "inv_1", at: "t", category: "policy", summary: "scrubbed [redacted]", piiRedacted: true }] };
  const readArchiveWithMetadata = () => ({ entries: [{ row: { id: "ref_1", invocationId: "inv_1", at: "t", category: "policy", summary: "leaked alice@example.com" } }], malformedLines: 0, readError: null });
  const { listInvocationRefusals } = createInvocationRefusalService({ state, readArchiveWithMetadata });
  const [row] = listInvocationRefusals({ id: "inv_1" }).refusals;
  assert.equal(row.summary, "scrubbed [redacted]", "the scrubbed live copy is canonical, not the archived pre-scrub one");
  assert.equal(row.piiRedacted, true);
});

test("limit bounds the list and reports truncated; a torn archive line also flags truncated", () => {
  const state = { refusals: [] };
  const entries = Array.from({ length: 5 }, (_, i) => ({ row: { id: `r${i}`, invocationId: "inv_1", at: `2026-07-17T00:00:0${i}.000Z`, category: "policy" } }));
  const svc = createInvocationRefusalService({ state, readArchiveWithMetadata: () => ({ entries, malformedLines: 0, readError: null }) });
  const bounded = svc.listInvocationRefusals({ id: "inv_1" }, { limit: 3 });
  assert.equal(bounded.refusals.length, 3);
  assert.equal(bounded.truncated, true, "more rows than the limit → truncated");

  const torn = createInvocationRefusalService({ state, readArchiveWithMetadata: () => ({ entries: [], malformedLines: 1, readError: null }) });
  assert.equal(torn.listInvocationRefusals({ id: "inv_1" }).truncated, true, "an unreadable/torn archive line flags truncated history");
});

test("no archive reader → live-only, never throws", () => {
  const state = { refusals: [{ id: "ref_1", invocationId: "inv_1", at: "t", category: "policy" }] };
  const { listInvocationRefusals } = createInvocationRefusalService({ state, readArchiveWithMetadata: null });
  assert.deepEqual(listInvocationRefusals({ id: "inv_1" }).refusals.map((r) => r.id), ["ref_1"]);
});

test("prefers the indexed store query (paginated) over the whole-file JSONL archive", () => {
  const state = { refusals: [{ id: "ref_live", invocationId: "inv_1", at: "t3", category: "policy", summary: "live" }] };
  const calls = [];
  const queryHistory = (collection, opts) => {
    calls.push({ collection, opts });
    return { rows: [{ id: "ref_arch", invocationId: "inv_1", at: "t1", category: "policy", summary: "archived" }], nextBefore: 42 };
  };
  const readArchiveWithMetadata = () => { throw new Error("must NOT read the whole-file archive when queryHistory is present"); };
  const { listInvocationRefusals } = createInvocationRefusalService({ state, readArchiveWithMetadata, queryHistory });
  const result = listInvocationRefusals({ id: "inv_1" }, { limit: 50 });
  assert.deepEqual(calls[0], { collection: "refusals", opts: { invocationId: "inv_1", limit: 50 } });
  assert.deepEqual(result.refusals.map((r) => r.id).sort(), ["ref_arch", "ref_live"], "store-archived + live merged");
  assert.equal(result.truncated, true, "nextBefore present → more pages → truncated");
});
