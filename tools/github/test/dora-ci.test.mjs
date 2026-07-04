/*
 * Unit tests for the L2 CI-green gate metric: rollup judgement (CheckRun
 * conclusions + StatusContext states), the all-merged-PRs denominator, the
 * CI-not-active state, and the token-unreadable state — three honest states,
 * never a faked pass.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeChangeFailures,
  computeCiChecks,
  computeDoraStats,
  formatDoraReport,
  parseChangeFailureRefs,
} from "../src/dora.mjs";

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
  assert.match(stats.ciChecks.unavailable, /neither check runs nor Actions runs/);
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

test("rollupFromActionsRuns: synthesizes the rollup shape; in-progress is not green", async () => {
  const { rollupFromActionsRuns, computeCiChecks } = await import("../src/dora.mjs");
  const rollup = rollupFromActionsRuns([{ conclusion: "success" }, { conclusion: null }]);
  assert.deepEqual(rollup, [{ conclusion: "SUCCESS" }, { conclusion: "IN_PROGRESS" }]);
  const ci = computeCiChecks([{ number: 1, statusCheckRollup: rollup }]);
  assert.equal(ci.greenPrs, 0, "an incomplete run must not read as green");
});

test("ciChecksSince: the post-cutoff slice judges only merges at/after the cutoff", async () => {
  const { computeDoraStats: compute } = await import("../src/dora.mjs");
  const prs = [
    { number: 1, createdAt: "2026-06-01T00:00:00Z", mergedAt: "2026-06-15T00:00:00Z" }, // pre-cutoff, no checks
    { number: 2, createdAt: "2026-07-01T00:00:00Z", mergedAt: "2026-07-03T00:00:00Z", statusCheckRollup: [{ conclusion: "SUCCESS" }] },
  ];
  const stats = compute(prs, { days: 60, ciSince: "2026-07-02T00:00:00.000Z" });
  assert.equal(stats.ciChecks.greenRate, 0.5, "rolling window still counts the unchecked merge");
  assert.equal(stats.ciChecksSince.mergedPrCount, 1);
  assert.equal(stats.ciChecksSince.greenRate, 1, "post-cutoff slice is fully green");
  assert.equal(compute(prs, { days: 60 }).ciChecksSince, null, "no cutoff → no slice");
});

test("parseChangeFailureRefs: extracts culprit numbers, ignores prose, dedupes", () => {
  assert.deepEqual(parseChangeFailureRefs("fix\n\nChange-failure: #10"), [10]);
  assert.deepEqual(parseChangeFailureRefs("Change-failure: #10, #12 #10"), [10, 12]);
  assert.deepEqual(parseChangeFailureRefs("refs #99 but no marker"), []);
  assert.deepEqual(parseChangeFailureRefs(undefined), []);
});

test("computeChangeFailures: CFR + recovery from marker pairs; a PR can't remediate itself", () => {
  const cf = computeChangeFailures([
    { number: 10, mergedAt: "2026-07-04T00:00:00Z", body: "feat" },
    { number: 11, mergedAt: "2026-07-04T03:00:00Z", body: "fix\nChange-failure: #10" },
    { number: 12, mergedAt: "2026-07-05T00:00:00Z", body: "feat" },
    { number: 13, mergedAt: "2026-07-05T01:00:00Z", body: "Change-failure: #13" }, // self-ref ignored
  ]);
  assert.equal(cf.recorded, true);
  assert.equal(cf.culpritCount, 1);
  assert.equal(cf.changeFailureRate, 0.25, "1 culprit / 4 merges");
  assert.equal(cf.recoveryHours.median, 3);
  assert.deepEqual(cf.incidents, [{ culprit: 10, recoveryHours: 3 }]);
});

test("computeChangeFailures: earliest remediation wins for recovery", () => {
  const cf = computeChangeFailures([
    { number: 10, mergedAt: "2026-07-04T00:00:00Z", body: "feat" },
    { number: 20, mergedAt: "2026-07-04T05:00:00Z", body: "Change-failure: #10" },
    { number: 21, mergedAt: "2026-07-04T02:00:00Z", body: "Change-failure: #10" },
  ]);
  assert.equal(cf.culpritCount, 1, "one distinct culprit despite two remediations");
  assert.equal(cf.recoveryHours.median, 2, "earliest fix (2h) sets recovery, not 5h");
});

test("computeChangeFailures: culprit outside the fetched window is skipped (no fake recovery)", () => {
  const cf = computeChangeFailures([
    { number: 30, mergedAt: "2026-07-06T00:00:00Z", body: "Change-failure: #999" },
  ]);
  assert.equal(cf.recorded, false, "unknown culprit mergedAt → not counted");
  assert.equal(cf.changeFailureRate, 0);
});

test("computeChangeFailures: no markers → recorded:false with the signal-since date, never a fake number", () => {
  const cf = computeChangeFailures([{ number: 1, mergedAt: "2026-07-04T00:00:00Z", body: "clean" }]);
  assert.equal(cf.recorded, false);
  assert.equal(cf.changeFailureRate, 0);
  assert.equal(cf.recoveryHours.median, null);
  assert.match(cf.signalSince, /^\d{4}-\d{2}-\d{2}$/);
});

test("formatDoraReport: renders marker-traced CFR + recovery rows; zero-incident is honest", () => {
  const base = { number: 1, createdAt: "2026-07-04T00:00:00Z", mergedAt: "2026-07-04T01:00:00Z" };
  const clean = formatDoraReport(computeDoraStats([base], { days: 7 }), { repo: "o/r" });
  assert.match(clean, /Change failure rate \(marker-traced\) \| 0 recorded incidents \(signal live since 2026-07-04\)/);
  assert.match(clean, /recovery time \(fix-merge\) \| no incidents recorded yet/i);

  const withIncident = formatDoraReport(
    computeDoraStats(
      [
        { ...base, number: 10, mergedAt: "2026-07-04T00:00:00Z" },
        { number: 11, createdAt: "2026-07-04T02:00:00Z", mergedAt: "2026-07-04T02:00:00Z", body: "Change-failure: #10" },
      ],
      { days: 7 },
    ),
    { repo: "o/r" },
  );
  assert.match(withIncident, /Change failure rate \(marker-traced\) \| 50\.0% \(1\/2\)/);
  assert.match(withIncident, /recovery time \(fix-merge\) \| 2h median .* below/i);
});
