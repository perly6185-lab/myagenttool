/*
 * Auto-run observability/evaluation summary: status distribution, success rate,
 * verification-gate outcomes, blocked reasons, and time-to-PR. Pure function.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeAutoRuns } from "../src/services/auto-run-metrics.mjs";

test("empty input: zero-filled statuses and a null success rate (no data yet)", () => {
  const s = summarizeAutoRuns([]);
  assert.equal(s.total, 0);
  assert.equal(s.active, 0);
  assert.equal(s.successRate, null, "no completed runs → null, not a fake 0%");
  assert.equal(s.byStatus.pr_open, 0, "all lifecycle states are present, zero-filled");
  assert.equal(s.timeToPr.count, 0);
});

test("counts by status and active-in-flight", () => {
  const s = summarizeAutoRuns([
    { status: "running" },
    { status: "verifying" },
    { status: "awaiting_approval" },
    { status: "pr_open" },
    { status: "materializing" },
  ]);
  assert.equal(s.total, 5);
  assert.equal(s.active, 4, "running+verifying+awaiting_approval+materializing are active");
  assert.equal(s.byStatus.pr_open, 1);
});

test("success rate is PRs opened over completed runs (ignores in-flight)", () => {
  const s = summarizeAutoRuns([
    { status: "pr_open" },
    { status: "pr_open" },
    { status: "blocked", error: "verification failed" },
    { status: "failed", error: "boom" },
    { status: "running" }, // in-flight, excluded from the rate
  ]);
  // terminal = 4 (2 pr_open + 1 blocked + 1 failed); rate = 2/4.
  assert.equal(s.successRate, 0.5);
  assert.deepEqual(s.outcomes, { prOpen: 2, blocked: 1, failed: 1 });
});

test("verification outcomes and blocked reasons are aggregated", () => {
  const s = summarizeAutoRuns([
    { status: "pr_open", verification: { verified: true, passed: true } },
    { status: "pr_open", verification: { verified: false, passed: true } },
    { status: "blocked", verification: { verified: true, passed: false }, error: "checks failed" },
    { status: "blocked", verification: { verified: true, passed: false }, error: "checks failed" },
    { status: "blocked", error: "The agent run produced no changes to open a pull request with." },
  ]);
  assert.deepEqual(s.verification, { passed: 1, failed: 2, unverified: 1 });
  assert.equal(s.blockedReasons[0].reason, "checks failed");
  assert.equal(s.blockedReasons[0].count, 2, "most common blocked reason first");
});

test("time-to-PR: median and p90 over pr_open runs", () => {
  const base = 1_000_000;
  const iso = (ms) => new Date(base + ms).toISOString();
  const s = summarizeAutoRuns([
    { status: "pr_open", createdAt: iso(0), updatedAt: iso(10_000) }, // 10s
    { status: "pr_open", createdAt: iso(0), updatedAt: iso(20_000) }, // 20s
    { status: "pr_open", createdAt: iso(0), updatedAt: iso(60_000) }, // 60s
    { status: "running", createdAt: iso(0), updatedAt: iso(5_000) }, // not pr_open → ignored
  ]);
  assert.equal(s.timeToPr.count, 3);
  assert.equal(s.timeToPr.medianSeconds, 20);
  assert.equal(s.timeToPr.p90Seconds, 60);
});
