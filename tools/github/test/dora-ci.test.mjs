/*
 * Unit tests for the L2 CI-green gate metric: rollup judgement (CheckRun
 * conclusions + StatusContext states), the all-merged-PRs denominator, the
 * CI-not-active state, and the token-unreadable state — three honest states,
 * never a faked pass.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { computeCiChecks, computeDoraStats, formatDoraReport } from "../src/dora.mjs";

test("computeCiChecks: green requires every check successful; no-checks PRs count against the rate", () => {
  const ci = computeCiChecks([
    { number: 1, statusCheckRollup: [{ conclusion: "SUCCESS" }, { state: "SUCCESS" }] },
    { number: 2, statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }] },
    { number: 3, statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "SKIPPED" }, { conclusion: "NEUTRAL" }] },
    { number: 4 },
  ]);
  assert.equal(ci.greenPrs, 2, "#1 and #3 are green; skipped/neutral are non-blocking");
  assert.equal(ci.greenRate, 0.5);
  assert.deepEqual(ci.redPrs, [2]);
  assert.equal(ci.prsWithChecks, 3);
  assert.equal(ci.gateMet, false);
});

test("computeCiChecks: 20 green of 21 (95.2%) meets the gate; 19 of 20 (95.0%) meets exactly", () => {
  const green = (n) => ({ number: n, statusCheckRollup: [{ conclusion: "SUCCESS" }] });
  const twenty = [...Array.from({ length: 20 }, (_, i) => green(i)), { number: 99 }];
  assert.equal(computeCiChecks(twenty).gateMet, true, "20/21 = 95.2% ≥ 95%");
  const exactly = [...Array.from({ length: 19 }, (_, i) => green(i)), { number: 99 }];
  assert.equal(computeCiChecks(exactly).gateMet, true, "19/20 = 95.0% meets the inclusive gate");
});

test("computeDoraStats: checksReadable=false reports the gate as unavailable, not zero", () => {
  const stats = computeDoraStats([{ createdAt: "2026-01-01T00:00:00Z", mergedAt: "2026-01-01T01:00:00Z" }], {
    days: 7,
    checksReadable: false,
  });
  assert.match(stats.ciChecks.unavailable, /checks\/statuses read/);
  const report = formatDoraReport(stats, { repo: "acme/x" });
  assert.match(report, /CI green on merged PRs \(L2 gate\) \| not measurable/);
});

test("formatDoraReport: CI-not-active reads as an explicit gap, not n/a", () => {
  const stats = computeDoraStats(
    [{ number: 1, createdAt: "2026-01-01T00:00:00Z", mergedAt: "2026-01-01T01:00:00Z" }],
    { days: 7 },
  );
  const report = formatDoraReport(stats, { repo: "acme/x" });
  assert.match(report, /0% \(0\/1 — CI not active; no PR carried check runs\)/);
});
