/*
 * Unit tests for the L3 governance reporter: per-PR evidence judgement uses the
 * same predicates as the check-pr gate, coverage math, gate flags, and honest
 * not-instrumented reporting.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { computeGovernanceStats, countBypassCommits, formatGovernanceReport, judgePrEvidence } from "../src/governance.mjs";

const coveredPr = {
  number: 1,
  body: "Closes #7\n## Verification\n- pnpm test passed\n",
  files: ["docs/vision/PRODUCT.md"],
  closingIssuesReferences: [{ number: 7 }],
};

test("judgePrEvidence: full evidence → covered; refs #N in the body also links", () => {
  assert.equal(judgePrEvidence(coveredPr).covered, true);
  const refsOnly = judgePrEvidence({ ...coveredPr, closingIssuesReferences: [], body: "refs #9\n## Verification\n- pnpm test passed" });
  assert.equal(refsOnly.linksIssue, true);
});

test("judgePrEvidence: a web change without visual evidence trips the risk route", () => {
  const judged = judgePrEvidence({
    number: 2,
    body: "Closes #7\n## Verification\n- pnpm test passed",
    files: [{ path: "apps/web/src/App.tsx" }], // object file shape (gh --json files)
  });
  assert.equal(judged.riskRoutesClean, false);
  assert.match(judged.riskFindings[0], /visual QA/);
  assert.equal(judged.covered, false);
});

test("computeGovernanceStats: coverage math, per-check rates, gate flags, uncovered detail", () => {
  const stats = computeGovernanceStats(
    [coveredPr, { number: 2, body: "nothing", files: [] }],
    { days: 30, directPushCount: 3 },
  );
  assert.equal(stats.coverageRate, 0.5);
  assert.equal(stats.byCheck.linksIssue, 0.5);
  assert.equal(stats.byCheck.verification, 0.5);
  assert.equal(stats.gate.coverageMet, false);
  assert.equal(stats.gate.bypassMet, false);
  assert.deepEqual(stats.uncovered[0].missing.slice(0, 2), ["issue link", "verification evidence"]);
  assert.match(stats.notInstrumented.scopeDriftFalsePositiveRate, /labeled/);
});

test("computeGovernanceStats: 100% coverage + 0 bypass meets both gates", () => {
  const stats = computeGovernanceStats([coveredPr], { days: 30, directPushCount: 0 });
  assert.equal(stats.gate.coverageMet, true);
  assert.equal(stats.gate.bypassMet, true);
});

test("computeGovernanceStats: --since slice judges only post-cutoff merges", () => {
  const old = { number: 2, body: "nothing", files: [], mergedAt: "2026-06-01T00:00:00Z" };
  const fresh = { ...coveredPr, mergedAt: "2026-07-02T08:00:00Z" };
  const stats = computeGovernanceStats([old, fresh], {
    days: 30,
    directPushCount: 5,
    since: "2026-07-02T00:00:00Z",
    directPushCountSince: 0,
  });
  // Rolling window still carries the pre-cutoff debt…
  assert.equal(stats.coverageRate, 0.5);
  assert.equal(stats.gate.coverageMet, false);
  // …while the slice shows current discipline meeting both gates.
  assert.equal(stats.coverageSince.mergedPrCount, 1);
  assert.equal(stats.coverageSince.coverageRate, 1);
  assert.equal(stats.coverageSince.coverageMet, true);
  assert.equal(stats.coverageSince.bypassMet, true);
});

test("computeGovernanceStats: no --since → no slice; empty slice reads n/a not a fake pass", () => {
  const noSlice = computeGovernanceStats([coveredPr], { days: 30, directPushCount: 0 });
  assert.equal(noSlice.coverageSince, null);
  const emptySlice = computeGovernanceStats(
    [{ ...coveredPr, mergedAt: "2026-06-01T00:00:00Z" }],
    { days: 30, directPushCount: 0, since: "2026-07-02T00:00:00Z", directPushCountSince: null },
  );
  assert.equal(emptySlice.coverageSince.coverageRate, null);
  assert.equal(emptySlice.coverageSince.coverageMet, false);
  const report = formatGovernanceReport(emptySlice, { repo: "acme/x" });
  assert.match(report, /coverage since 2026-07-02 .*no merged PRs since cutoff \| 100% \| n\/a/);
  assert.doesNotMatch(report, /Silent-bypass merges since/);
});

test("formatGovernanceReport: renders both since rows when the slice has data", () => {
  const stats = computeGovernanceStats(
    [{ ...coveredPr, mergedAt: "2026-07-02T08:00:00Z" }],
    { days: 30, directPushCount: 5, since: "2026-07-02T00:00:00Z", directPushCountSince: 0 },
  );
  const report = formatGovernanceReport(stats, { repo: "acme/x" });
  assert.match(report, /Risk-evidence coverage since 2026-07-02 \(current discipline\) \| 100\.0% \(1\/1\) \| 100% \| meets/);
  assert.match(report, /Silent-bypass merges since 2026-07-02 \| 0 \| 0 \| meets/);
});

test("countBypassCommits: squash-merged PR commits are not bypasses; true direct pushes are", () => {
  const prs = [
    { number: 1, mergeCommit: { oid: "aaa" } }, // squash merge → non-merge commit on main
    { number: 2, mergeCommit: null }, // API gave no merge commit — must not crash
  ];
  assert.equal(countBypassCommits(["aaa", "bbb"], prs), 1); // only bbb is a real direct push
  assert.equal(countBypassCommits([], prs), 0);
  assert.equal(countBypassCommits(["ccc"], []), 1);
});

test("formatGovernanceReport: renders the gate table and honest not-instrumented row", () => {
  const stats = computeGovernanceStats([coveredPr], { days: 30, directPushCount: null });
  const report = formatGovernanceReport(stats, { repo: "acme/x" });
  assert.match(report, /Risk-evidence coverage .*100\.0% \(1\/1\)/);
  assert.match(report, /Silent-bypass merges .* n\/a /);
  assert.match(report, /Scope-drift false-positive rate \| not instrumented/);
});
