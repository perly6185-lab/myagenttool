/*
 * Auto-run observability/evaluation summary: status distribution, success rate,
 * verification-gate outcomes, blocked reasons, and time-to-PR. Pure function.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeAutoRuns, deriveFinalStatus } from "../src/services/auto-run-metrics.mjs";

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
  assert.deepEqual(s.outcomes, { prOpen: 2, blocked: 1, failed: 1, reportPosted: 0, needsInput: 0 });
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

test("routing decisions are aggregated by path and decider", () => {
  const s = summarizeAutoRuns([
    { status: "running", decision: { path: "develop", decidedBy: "heuristic", confidence: 0.3 } },
    { status: "pr_open", decision: { path: "develop", decidedBy: "agent", confidence: 0.9 } },
    { status: "report_posted", decision: { path: "design", decidedBy: "agent", confidence: 0.8 } },
    { status: "failed" }, // legacy record without a decision
  ]);
  assert.equal(s.decisions.byPath.develop, 2);
  assert.equal(s.decisions.byPath.design, 1);
  assert.deepEqual(s.decisions.byDecidedBy, { agent: 2, heuristic: 1 });
});

test("decision via (heuristic / fast-path / agent / fallback) is aggregated", () => {
  const s = summarizeAutoRuns([
    { status: "running", decision: { path: "develop", decidedBy: "heuristic", via: "heuristic" } },
    { status: "running", decision: { path: "clarify", decidedBy: "heuristic", via: "fast-path" } },
    { status: "running", decision: { path: "design", decidedBy: "agent", via: "agent" } },
    { status: "running", decision: { path: "develop", decidedBy: "heuristic", via: "fallback" } },
    { status: "running", decision: { path: "develop", decidedBy: "heuristic" } }, // legacy: no via
  ]);
  assert.deepEqual(s.decisions.byVia, { heuristic: 2, "fast-path": 1, agent: 1, fallback: 1 });
});

test("routing health exposes fallback, confidence calibration, latency, and risk signals", () => {
  const s = summarizeAutoRuns([
    { status: "blocked", decision: { path: "develop", decidedBy: "heuristic", via: "fallback", confidence: 0.3, latencyMs: 9000 } },
    { status: "pr_open", decision: { path: "develop", decidedBy: "heuristic", via: "fallback", confidence: 0.5, latencyMs: 8000 } },
    { status: "blocked", error: "produced no changes", decision: { path: "develop", decidedBy: "agent", via: "agent", confidence: 0.3, latencyMs: 7500 } },
    { status: "pr_open", decision: { path: "develop", decidedBy: "agent", via: "agent", confidence: 0.5, latencyMs: 7200 } },
    { status: "pr_open", decision: { path: "develop", decidedBy: "agent", via: "agent", confidence: 0.7, latencyMs: 7000 } },
    { status: "report_posted", decision: { path: "design", decidedBy: "agent", via: "agent", confidence: 0.9, latencyMs: 6000 } },
    { status: "needs_input", decision: { path: "clarify", decidedBy: "agent", via: "agent", confidence: 0.95, latencyMs: 100 } },
  ]);
  assert.equal(s.routingHealth.total, 7);
  assert.equal(s.routingHealth.confidenceTotal, 5);
  assert.equal(s.routingHealth.fallbackRate, 0.2857);
  assert.equal(s.routingHealth.lowConfidenceRate, 0.4);
  assert.deepEqual(s.routingHealth.latency, { count: 7, medianMs: 7200, p90Ms: 9000 });
  assert.equal(s.routingHealth.failureRate, 0.2857);
  assert.equal(s.routingHealth.humanOverrideRate, 0);
  assert.deepEqual(s.routingHealth.signals.map((signal) => signal.key), ["fallback_spike", "low_confidence", "latency", "routing_failure_rate"]);
  assert.deepEqual(
    s.routingHealth.confidenceBuckets.map((bucket) => [bucket.key, bucket.total, bucket.conclusive, bucket.alignmentRate]),
    [["low", 2, 2, 0.5], ["medium", 1, 1, 1], ["high", 2, 2, 1]],
  );
});

test("routing health is not made healthier by a human correction", () => {
  const s = summarizeAutoRuns([{
    status: "blocked",
    error: "produced no changes",
    decision: { path: "develop", via: "agent", confidence: 0.9, latencyMs: 10 },
    routingOverride: { actualPath: "design" },
  }]);
  assert.equal(s.routingHealth.confidenceBuckets[2].alignmentRate, 0);
  assert.equal(s.routing.humanTruth.accuracy, 0);
});

test("routing health excludes records outside the configured rolling window", () => {
  const s = summarizeAutoRuns([
    { createdAt: "2026-05-01T00:00:00.000Z", status: "blocked", error: "produced no changes", decision: { path: "develop", via: "fallback" } },
    { createdAt: "2026-07-20T00:00:00.000Z", status: "pr_open", decision: { path: "develop", via: "agent", confidence: 0.9 } },
  ], {
    routingNow: "2026-07-24T00:00:00.000Z",
    routingThresholds: { windowDays: 30 },
  });
  assert.equal(s.total, 2, "lifecycle totals retain history");
  assert.equal(s.routingHealth.total, 1, "health posture only uses the rolling window");
  assert.equal(s.routingHealth.fallback, 0);
});

test("non-diff outcomes (report_posted/needs_input) are counted apart from the change rate", () => {
  const s = summarizeAutoRuns([
    { status: "pr_open" },
    { status: "blocked", error: "x" },
    { status: "report_posted" },
    { status: "report_posted" },
    { status: "needs_input" },
  ]);
  assert.equal(s.outcomes.reportPosted, 2);
  assert.equal(s.outcomes.needsInput, 1);
  // successRate is over change-shaped terminal only (pr_open+blocked+failed = 2): 1/2.
  assert.equal(s.successRate, 0.5);
  assert.equal(s.byStatus.report_posted, 2);
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

test("summarizeAutoRuns applies operator SLO target overrides", () => {
  const runs = [{ status: "pr_open", createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:05:00Z" }, { status: "failed" }];
  const def = summarizeAutoRuns(runs).slo.slos.find((s) => s.key === "prSuccessRate");
  assert.equal(def.target, 0.7, "default target");
  const tuned = summarizeAutoRuns(runs, { sloTargets: { prSuccessRate: 0.4 } }).slo.slos.find((s) => s.key === "prSuccessRate");
  assert.equal(tuned.target, 0.4, "overridden target");
  assert.equal(tuned.meets, true, "0.5 >= 0.4 now meets");
});

test("quality rates: humanEscalation over all runs, selfRepair over develop runs", () => {
  const s = summarizeAutoRuns([
    { status: "pr_open", decision: { path: "develop" }, repairAttempts: 2 }, // develop, repaired
    { status: "pr_open", decision: { path: "develop" } },                    // develop, clean
    { status: "needs_input", decision: { path: "develop" } },                // develop + escalated
    { status: "blocked", decision: { path: "design" } },                     // escalated, non-develop
    { status: "report_posted", decision: { path: "design" } },               // neither
  ]);
  // 2 of 5 runs handed control to a human (needs_input + blocked).
  assert.equal(s.rates.humanEscalation, 0.4);
  // 3 develop runs, 1 needed a self-repair round.
  assert.equal(s.rates.selfRepair, Number((1 / 3).toFixed(4)));
});

test("quality rates are null until their population exists (no fake 0%)", () => {
  const empty = summarizeAutoRuns([]);
  assert.equal(empty.rates.humanEscalation, null);
  assert.equal(empty.rates.selfRepair, null);
  // Runs with no develop path → selfRepair stays null, escalation is real.
  const noDevelop = summarizeAutoRuns([{ status: "report_posted", decision: { path: "design" } }]);
  assert.equal(noDevelop.rates.selfRepair, null);
  assert.equal(noDevelop.rates.humanEscalation, 0);
});

test("a run with no decision defaults to the develop population", () => {
  const s = summarizeAutoRuns([{ status: "pr_open", repairAttempts: 1 }]);
  assert.equal(s.rates.selfRepair, 1, "no decision.path is treated as develop");
});

// --- Derived terminal grade (finalStatus) ------------------------------------

test("deriveFinalStatus grades a terminal run without changing its stored status", () => {
  assert.equal(deriveFinalStatus({ status: "pr_open" }), "clean_success");
  assert.equal(deriveFinalStatus({ status: "pr_open", repairAttempts: 2 }), "degraded_success");
  assert.equal(deriveFinalStatus({ status: "pr_open", verification: { verified: false } }), "unverified_success", "opened but no check ran");
  // A ran-and-passed check with a repair is degraded, not unverified.
  assert.equal(deriveFinalStatus({ status: "pr_open", verification: { verified: true, passed: true }, repairAttempts: 1 }), "degraded_success");
  assert.equal(deriveFinalStatus({ status: "failed" }), "failed");
  assert.equal(deriveFinalStatus({ status: "blocked" }), "failed");
  // Non-terminal / needs-human runs are not graded yet.
  assert.equal(deriveFinalStatus({ status: "running" }), null);
  assert.equal(deriveFinalStatus({ status: "needs_input" }), null);
  assert.equal(deriveFinalStatus(null), null);
});

test("summarizeAutoRuns distributes runs across the finalStatuses grades", () => {
  const s = summarizeAutoRuns([
    { status: "pr_open" },                                        // clean
    { status: "pr_open", repairAttempts: 1 },                     // degraded
    { status: "pr_open", verification: { verified: false } },     // unverified
    { status: "failed" },                                         // failed
    { status: "running" },                                        // ungraded
  ]);
  assert.deepEqual(s.finalStatuses, { clean_success: 1, degraded_success: 1, unverified_success: 1, failed: 1 });
});
