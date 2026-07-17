import assert from "node:assert/strict";
import { test } from "node:test";

import { workBoard } from "../src/read-models/work-board.mjs";

const NOW = Date.parse("2026-07-17T12:00:00Z");

test("auto-runs sort into the lifecycle lenses by status", () => {
  const autoRuns = [
    { id: "ar_run", status: "running", link: { number: 1, title: "Build it" }, updatedAt: "2026-07-17T10:00:00Z" },
    { id: "ar_wait", status: "blocked", link: { number: 2, title: "Stuck" }, updatedAt: "2026-07-17T09:00:00Z" },
    { id: "ar_done", status: "done", link: { number: 3, title: "Shipped" }, updatedAt: "2026-07-17T08:00:00Z" },
    { id: "ar_fail", status: "failed", link: { number: 4, title: "Broke" }, updatedAt: "2026-07-17T07:00:00Z" },
  ];
  const { states } = workBoard({ autoRuns, now: NOW });
  assert.equal(states.in_progress.count, 1);
  assert.equal(states.in_progress.items[0].targetId, "ar_run");
  assert.equal(states.waiting.count, 1);
  assert.equal(states.waiting.items[0].targetId, "ar_wait");
  assert.equal(states.done.count, 1);
  assert.equal(states.failed.count, 1);
});

test("pr_open resolves by PR state: open → waiting, merged → done", () => {
  const autoRuns = [
    { id: "ar_open", status: "pr_open", prState: "OPEN", prNumber: 10, updatedAt: "2026-07-17T10:00:00Z" },
    { id: "ar_merged", status: "pr_open", prState: "MERGED", prNumber: 11, updatedAt: "2026-07-17T09:00:00Z" },
  ];
  const { states } = workBoard({ autoRuns, now: NOW });
  assert.equal(states.waiting.items[0].targetId, "ar_open");
  assert.equal(states.done.items[0].targetId, "ar_merged");
});

test("a gated auto-run is counted under 待决策 only, never double-counted in a lifecycle lens", () => {
  const autoRuns = [{ id: "ar_gate", status: "pr_open", prState: "OPEN", prNumber: 42, updatedAt: "2026-07-17T10:00:00Z" }];
  const pendingDecisions = [
    { id: "merge:ar_gate", kind: "merge", title: "PR #42 ready to merge", section: "autoRuns", targetId: "ar_gate", createdAt: "2026-07-17T10:00:00Z", ref: { autoRunId: "ar_gate", prNumber: 42 } },
  ];
  const { states } = workBoard({ autoRuns, pendingDecisions, now: NOW });
  assert.equal(states.pending_decision.count, 1);
  assert.equal(states.pending_decision.items[0].kind, "merge");
  assert.equal(states.waiting.count, 0);
  assert.equal(states.in_progress.count, 0);
});

test("非 auto-run 的待决策(approval/compare/lifecycle)照样进 pending_decision 桶", () => {
  const pendingDecisions = [
    { id: "approval:apr_1", kind: "invocation_approval", title: "Invocation needs approval", section: "invocations", targetId: "inv_1", createdAt: "2026-07-17T11:00:00Z" },
    { id: "promote:cmp_1", kind: "compare_promote", title: "Compare winner ready", section: "compare", targetId: "cmp_1", createdAt: "2026-07-17T10:00:00Z" },
  ];
  const { states } = workBoard({ pendingDecisions, now: NOW });
  assert.equal(states.pending_decision.count, 2);
  // newest-first
  assert.equal(states.pending_decision.items[0].id, "approval:apr_1");
});

test("follow_up = failed runs + refusals within the 48h window; stale refusals excluded", () => {
  const autoRuns = [{ id: "ar_fail", status: "failed", link: { number: 4, title: "Broke" }, updatedAt: "2026-07-17T07:00:00Z" }];
  const refusals = [
    { id: "ref_fresh", at: "2026-07-17T06:00:00Z", category: "policy", code: "over_budget", summary: "budget exhausted", invocationId: "inv_9" },
    { id: "ref_stale", at: "2026-07-10T06:00:00Z", category: "human", code: "denied", summary: "old veto", invocationId: "inv_8" },
  ];
  const { states } = workBoard({ autoRuns, refusals, now: NOW });
  const ids = states.follow_up.items.map((i) => i.id);
  assert.ok(ids.includes("autorun:ar_fail"), "failed run is an attention item");
  assert.ok(ids.includes("refusal:ref_fresh"), "recent refusal surfaces");
  assert.ok(!ids.includes("refusal:ref_stale"), "48h-old refusal is filtered out");
  // The failed run appears in BOTH failed and follow_up by design.
  assert.equal(states.failed.count, 1);
});

test("empty inputs yield all six lenses at zero", () => {
  const { states } = workBoard({ now: NOW });
  assert.deepEqual(
    Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v.count])),
    { pending_decision: 0, in_progress: 0, waiting: 0, done: 0, failed: 0, follow_up: 0 },
  );
});
