/*
 * #970 — time-based retention. `applyRetentionPolicies` reaps telemetry
 * (events/traces/spans) older than retentionSettings.logsDays, on top of the
 * per-collection count caps, while never touching shielded evidence (spend
 * ledger, lifecycle audit, refusals, audit summaries).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { applyRetentionPolicies } from "../src/services/retention.mjs";

const NOW = "2026-07-14T00:00:00.000Z";
const now = () => NOW;
const daysAgo = (n) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

function baseState(logsDays) {
  return {
    retentionSettings: { logsDays },
    events: [
      { id: "e_new", createdAt: daysAgo(1) },
      { id: "e_old", createdAt: daysAgo(20) },
    ],
    traces: [
      { id: "t_new", createdAt: daysAgo(2) },
      { id: "t_old", createdAt: daysAgo(30) },
    ],
    spans: [
      { id: "s_new", startedAt: daysAgo(3) },
      { id: "s_old", startedAt: daysAgo(40) },
    ],
    // Shielded evidence — must never be reaped by the time policy.
    ledgerEntries: [{ id: "led_old", createdAt: daysAgo(100), amountUsd: 5 }],
    lifecycleAuditRecords: [{ id: "lco_old", createdAt: daysAgo(100), status: "failed" }],
    refusals: [{ id: "ref_old", createdAt: daysAgo(100) }],
    auditSummaries: [{ id: "aud_old", completedAt: daysAgo(100) }],
  };
}

test("#970 reaps telemetry older than logsDays, keeps recent rows", () => {
  const state = baseState(14);
  const { reaped } = applyRetentionPolicies(state, { now });
  assert.equal(reaped, 3, "the three stale telemetry rows were reaped");
  assert.deepEqual(state.events.map((r) => r.id), ["e_new"]);
  assert.deepEqual(state.traces.map((r) => r.id), ["t_new"]);
  assert.deepEqual(state.spans.map((r) => r.id), ["s_new"]);
});

test("#970 never reaps shielded evidence (ledger/audit/refusals) by age", () => {
  const state = baseState(14);
  applyRetentionPolicies(state, { now });
  assert.equal(state.ledgerEntries.length, 1, "spend ledger is shielded");
  assert.equal(state.lifecycleAuditRecords.length, 1, "lifecycle audit is shielded");
  assert.equal(state.refusals.length, 1, "refusals are shielded");
  assert.equal(state.auditSummaries.length, 1, "audit summaries are shielded");
});

test("#970 logsDays unset/0/negative turns the time policy off", () => {
  for (const off of [0, -1, undefined, "nope"]) {
    const state = baseState(off);
    const { reaped } = applyRetentionPolicies(state, { now });
    assert.equal(reaped, 0, `logsDays=${off} reaps nothing`);
    assert.equal(state.events.length, 2, "all events kept when the policy is off");
  }
});

test("#970 rows without a parseable timestamp are kept (never reaped on bad data)", () => {
  const state = { retentionSettings: { logsDays: 1 }, events: [{ id: "e1" }, { id: "e2", createdAt: "not-a-date" }], traces: [], spans: [] };
  const { reaped } = applyRetentionPolicies(state, { now });
  assert.equal(reaped, 0);
  assert.equal(state.events.length, 2, "undated rows are conservatively kept");
});

test("#970 a tighter window reaps more", () => {
  const state = baseState(2); // keep only the last 2 days
  applyRetentionPolicies(state, { now });
  assert.deepEqual(state.events.map((r) => r.id), ["e_new"], "e_new (1d) kept, e_old (20d) reaped");
  assert.deepEqual(state.spans.map((r) => r.id), [], "s_new (3d) now falls outside the 2d window too");
});

// --- #913: raw proposal payloads follow the same time window ---

function proposalRow(id, { completedAt, status = "succeeded", patch = "diff --git a/x b/x\n+y\n" } = {}) {
  return {
    id, status, completedAt,
    options: { metadata: { tool: "claude.propose.patch" } },
    result: { output: { patch, contentHash: "aa".repeat(32), baseCommit: "bb".repeat(20), summary: "s", files: [{ path: "x" }] } },
  };
}

test("#913 reaps the raw patch of an old terminal proposal but keeps its bindings", () => {
  const state = { ...baseState(14), invocations: [proposalRow("inv_old", { completedAt: daysAgo(20) }), proposalRow("inv_new", { completedAt: daysAgo(1) })] };
  applyRetentionPolicies(state, { now });
  const oldOut = state.invocations[0].result.output;
  assert.equal(oldOut.patch, undefined, "the raw diff text is gone");
  assert.equal(oldOut.patchRedacted, true);
  assert.equal(oldOut.patchRedactedAt, NOW);
  assert.equal(oldOut.contentHash, "aa".repeat(32), "bindings survive the reap");
  assert.equal(oldOut.baseCommit, "bb".repeat(20));
  assert.deepEqual(oldOut.files, [{ path: "x" }]);
  const newOut = state.invocations[1].result.output;
  assert.match(newOut.patch, /diff --git/, "a fresh proposal keeps its payload");
  assert.ok(!newOut.patchRedacted);
});

test("#913 never strips an in-flight proposal and stays off when logsDays is unset", () => {
  const inFlight = { ...baseState(14), invocations: [proposalRow("inv_run", { completedAt: daysAgo(20), status: "running" })] };
  applyRetentionPolicies(inFlight, { now });
  assert.match(inFlight.invocations[0].result.output.patch, /diff --git/);

  const off = { ...baseState(0), invocations: [proposalRow("inv_old", { completedAt: daysAgo(400) })] };
  applyRetentionPolicies(off, { now });
  assert.match(off.invocations[0].result.output.patch, /diff --git/, "no window, no reap");
});
