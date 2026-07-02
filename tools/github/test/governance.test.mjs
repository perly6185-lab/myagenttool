/*
 * Unit tests for the L3 governance reporter: per-PR evidence judgement uses the
 * same predicates as the check-pr gate, coverage math, gate flags, and honest
 * not-instrumented reporting.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { computeGovernanceStats, formatGovernanceReport, judgePrEvidence } from "../src/governance.mjs";

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

test("formatGovernanceReport: renders the gate table and honest not-instrumented row", () => {
  const stats = computeGovernanceStats([coveredPr], { days: 30, directPushCount: null });
  const report = formatGovernanceReport(stats, { repo: "acme/x" });
  assert.match(report, /Risk-evidence coverage .*100\.0% \(1\/1\)/);
  assert.match(report, /Silent-bypass merges .* n\/a /);
  assert.match(report, /Scope-drift false-positive rate \| not instrumented/);
});
