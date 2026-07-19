import assert from "node:assert/strict";
import { test } from "node:test";

import { computeMaturityScorecard, loadMaturityInputs, HELDOUT_FLOOR } from "../src/read-models/maturity-scorecard.mjs";

const byLevel = (sc) => Object.fromEntries(sc.levels.map((l) => [l.level, l]));

test("no inputs → every level indeterminate, currentLevel -1, disclaimer present", () => {
  const sc = computeMaturityScorecard();
  assert.equal(sc.levels.length, 7);
  assert.ok(sc.levels.every((l) => l.verdict === "indeterminate"));
  assert.equal(sc.currentLevel, -1);
  assert.match(sc.disclaimer, /internal roadmap/i);
});

test("L2 CI-green below 95% is UNMET even with fast lead time (honest, not asserted)", () => {
  const sc = computeMaturityScorecard({
    docsOk: true,
    backlog: { labelCoverage: { rate: 1 }, milestoneCoverage: { rate: 1 } },
    dora: { ciChecks: { greenRate: 0.702 }, leadTimeHours: { median: 0.03 }, changeFailures: { recorded: false } },
  });
  const L = byLevel(sc);
  assert.equal(L[0].verdict, "met");
  assert.equal(L[1].verdict, "met");
  assert.equal(L[2].verdict, "unmet", "70% CI-green < 95% gate");
  assert.match(L[2].detail, /pre-CI-activation/);
  assert.equal(sc.currentLevel, 1, "contiguous level stops at the first unmet gate");
});

test("L2 met when CI-green ≥95% and lead time <1 day", () => {
  const sc = computeMaturityScorecard({
    docsOk: true,
    backlog: { labelCoverage: { rate: 1 }, milestoneCoverage: { rate: 1 } },
    dora: { ciChecks: { greenRate: 0.97 }, leadTimeHours: { median: 2 } },
  });
  assert.equal(byLevel(sc)[2].verdict, "met");
  assert.equal(sc.currentLevel, 2);
});

test("L2 re-anchor: CI-run green ≥95% MEETS the gate even when all-time is <95% (pre-CI merges are N/A, not failures)", () => {
  const sc = computeMaturityScorecard({
    docsOk: true,
    backlog: { labelCoverage: { rate: 1 }, milestoneCoverage: { rate: 1 } },
    // all-time 120/171 = 70.2%, but 47 of those merges predate CI (no checks);
    // over PRs that actually ran CI it is 120/124 = 96.8% ≥ 95%.
    dora: { ciChecks: { greenRate: 0.702, greenPrs: 120, prsWithChecks: 124, mergedPrCount: 171 }, leadTimeHours: { median: 0.03 } },
  });
  const L = byLevel(sc);
  assert.equal(L[2].verdict, "met", "measured over CI-run PRs, not all-time");
  assert.match(L[2].measured, /124 CI-run PRs/);
  assert.match(L[2].measured, /all-time 70%/, "the all-time rate is kept visible as context");
  assert.match(L[2].measured, /47 pre-CI merges/);
  assert.equal(sc.currentLevel, 2, "the ladder advances to 2");
});

test("L2 re-anchor: a genuinely bad CI-run rate is still UNMET (not gamed) — 3 red of 10 checked", () => {
  const sc = computeMaturityScorecard({
    docsOk: true,
    backlog: { labelCoverage: { rate: 1 }, milestoneCoverage: { rate: 1 } },
    dora: { ciChecks: { greenRate: 0.7, greenPrs: 7, prsWithChecks: 10, mergedPrCount: 12 }, leadTimeHours: { median: 0.03 } },
  });
  assert.equal(byLevel(sc)[2].verdict, "unmet", "70% of CI-run PRs green < 95% → honestly unmet");
});

test("L4 held-out shows its own verdict even when a lower gate blocks contiguity", () => {
  const sc = computeMaturityScorecard({
    docsOk: true,
    backlog: { labelCoverage: { rate: 1 }, milestoneCoverage: { rate: 1 } },
    dora: { ciChecks: { greenRate: 0.702 }, leadTimeHours: { median: 0.03 } }, // L2 unmet
    evalSummary: { heldout: { latest: { passRate: 0.857, total: 21 }, realRuns: 1 } },
  });
  const L = byLevel(sc);
  assert.equal(L[4].verdict, "met", "capability demonstrated (85.7% ≥ 60%)");
  assert.match(L[4].measured, /18\/21/);
  assert.match(L[4].detail, /provisional/, "n=1 real run flagged");
  assert.equal(sc.currentLevel, 1, "but the contiguous gate-met level is still capped by L2");
});

test("held-out below the floor is unmet", () => {
  const sc = computeMaturityScorecard({ evalSummary: { heldout: { latest: { passRate: HELDOUT_FLOOR - 0.01, total: 21 }, realRuns: 5 } } });
  assert.equal(byLevel(sc)[4].verdict, "unmet");
});

test("L3 governance gate needs 100% coverage AND zero silent bypasses", () => {
  const partial = computeMaturityScorecard({ governance: { coverageRate: 0.34, directPushCount: 2 } });
  assert.equal(byLevel(partial)[3].verdict, "unmet");
  const clean = computeMaturityScorecard({ governance: { coverageRate: 1, directPushCount: 0 } });
  assert.equal(byLevel(clean)[3].verdict, "met");
});

test("L3 re-anchor: prefers the post-enforcement coverageSince slice over the all-time rate", () => {
  // all-time 52% coverage + 2 historical bypasses would be UNMET; the enforcement
  // slice (100% covered, 0 bypasses since the cutoff) MEETS the gate.
  const sc = computeMaturityScorecard({
    docsOk: true,
    backlog: { labelCoverage: { rate: 1 }, milestoneCoverage: { rate: 1 } },
    dora: { ciChecks: { greenRate: 0.702, greenPrs: 120, prsWithChecks: 124, mergedPrCount: 171 }, leadTimeHours: { median: 0.03 } },
    governance: {
      coverageRate: 0.519,
      directPushCount: 2,
      coverageSince: { since: "2026-07-04T00:00:00Z", coverageRate: 1, directPushCount: 0, coverageMet: true, bypassMet: true },
    },
  });
  const L = byLevel(sc);
  assert.equal(L[3].verdict, "met", "measured over the enforcement slice, not all-time");
  assert.match(L[3].measured, /since 2026-07-04/);
  assert.match(L[3].measured, /all-time 52%/, "all-time kept as context");
  assert.equal(sc.currentLevel, 3, "L2+L3 both re-anchored → the ladder advances to 3");
});

test("L3 re-anchor: falls back to all-time (still UNMET) when no coverageSince slice is present", () => {
  const sc = computeMaturityScorecard({ governance: { coverageRate: 0.519, directPushCount: 2 } });
  assert.equal(byLevel(sc)[3].verdict, "unmet", "no slice → the honest all-time reading gates it");
});

test("L5 stays indeterminate until deploy recovery time is instrumented", () => {
  const sc = computeMaturityScorecard({ dora: { ciChecks: { greenRate: 0.97 }, leadTimeHours: { median: 1 } } });
  assert.equal(byLevel(sc)[5].verdict, "indeterminate");
  assert.match(byLevel(sc)[5].detail, /enable the deploy stage/);
  const withRecovery = computeMaturityScorecard({ release: { recoveryHours: 0.5 } });
  assert.equal(byLevel(withRecovery)[5].verdict, "met");
});

test("the deploy stage's recovery time feeds L5 — indeterminate becomes measured (D3)", () => {
  const base = Date.parse("2026-07-01T00:00:00Z");
  const t = (ms) => new Date(ms).toISOString();
  // A failed deploy recovered by a later success (0.5h) — hermetic (no artifacts).
  const inputs = loadMaturityInputs({
    metricsDir: "/nonexistent-metrics-xyz",
    evalTrend: [],
    deployments: [
      { status: "failed", at: t(base) },
      { status: "deployed", at: t(base + 1_800_000) },
    ],
  });
  assert.equal(inputs.release.recoveryHours, 0.5, "release recovery = median failure→success gap");
  assert.equal(byLevel(computeMaturityScorecard(inputs))[5].verdict, "met", "L5 is measured + under 1h");
  // No deploy data → no release → L5 stays indeterminate (honest, not faked).
  const none = loadMaturityInputs({ metricsDir: "/nonexistent-metrics-xyz", evalTrend: [], deployments: [] });
  assert.equal(none.release, null);
  assert.equal(byLevel(computeMaturityScorecard(none))[5].verdict, "indeterminate");
});

test("orchestration recovery stands in for L5 when there is no deploy data — labeled as a proxy", () => {
  const base = Date.parse("2026-07-01T00:00:00Z");
  const t = (ms) => new Date(base + ms).toISOString();
  const orchestrationRun = (status, atMs) => ({
    id: `inv_${atMs}`,
    status,
    completedAt: t(atMs),
    options: { metadata: { source: "application_orchestration", applicationId: "app_1", routineId: "rt_1" } },
  });
  const inputs = loadMaturityInputs({
    metricsDir: "/nonexistent-metrics-xyz",
    evalTrend: [],
    deployments: [],
    invocations: [orchestrationRun("failed", 0), orchestrationRun("succeeded", 1_800_000)],
  });
  assert.deepEqual(inputs.release, { recoveryHours: 0.5, recoveryCount: 1, source: "orchestration", deployPresentNoRecovery: false });
  const l5 = byLevel(computeMaturityScorecard(inputs))[5];
  assert.equal(l5.verdict, "met");
  assert.match(l5.measured, /orchestration proxy/, "the proxy is named, never passed off as a deploy");
});

test("deploy recovery wins over orchestration when both are measured (the gate's anchor)", () => {
  const base = Date.parse("2026-07-01T00:00:00Z");
  const t = (ms) => new Date(base + ms).toISOString();
  const orchestrationRun = (status, atMs) => ({
    id: `inv_${atMs}`,
    status,
    completedAt: t(atMs),
    options: { metadata: { source: "application_orchestration", applicationId: "app_1", routineId: "rt_1" } },
  });
  const inputs = loadMaturityInputs({
    metricsDir: "/nonexistent-metrics-xyz",
    evalTrend: [],
    deployments: [
      { status: "failed", at: t(0) },
      { status: "deployed", at: t(7_200_000) }, // 2h deploy recovery
    ],
    invocations: [orchestrationRun("failed", 0), orchestrationRun("succeeded", 1_800_000)], // 0.5h orchestration
  });
  assert.deepEqual(inputs.release, { recoveryHours: 2, recoveryCount: 1, openIncident: false, source: "deploy" });
  assert.equal(inputs.orchestration.recoveryHours.median, 0.5, "orchestration stays visible in inputs");
  const l5 = byLevel(computeMaturityScorecard(inputs))[5];
  assert.match(l5.measured, /deploy recovery 2h/);
  assert.equal(l5.verdict, "unmet"); // 2h ≥ 1h — the slower deploy signal gates, not the faster proxy
});

test("an unrecovered orchestration failure alone keeps L5 indeterminate (no fake median)", () => {
  const inputs = loadMaturityInputs({
    metricsDir: "/nonexistent-metrics-xyz",
    evalTrend: [],
    deployments: [],
    invocations: [{
      id: "inv_f",
      status: "failed",
      completedAt: "2026-07-01T00:00:00Z",
      options: { metadata: { source: "application_orchestration", applicationId: "app_1", routineId: "rt_1" } },
    }],
  });
  assert.equal(inputs.release, null);
  assert.equal(byLevel(computeMaturityScorecard(inputs))[5].verdict, "indeterminate");
});

test("nextGap points at the first blocker with an actionable message", () => {
  // L2 unmet (CI-green low) is the blocker to advancing from L1.
  const unmet = computeMaturityScorecard({
    docsOk: true,
    backlog: { labelCoverage: { rate: 1 }, milestoneCoverage: { rate: 1 } },
    dora: { ciChecks: { greenRate: 0.702 }, leadTimeHours: { median: 0.03 } },
  });
  assert.equal(unmet.nextGap.level, 2);
  assert.equal(unmet.nextGap.verdict, "unmet");
  assert.match(unmet.nextGap.action, /Close the gap/);

  // An indeterminate blocker asks to instrument, not to "close a gap".
  const indet = computeMaturityScorecard({ docsOk: true });
  assert.equal(indet.nextGap.level, 1); // L1 has no backlog data → indeterminate
  assert.match(indet.nextGap.action, /Instrument/);
});

test("full ladder met → currentLevel 6, nextGap null", () => {
  const sc = computeMaturityScorecard({
    docsOk: true,
    backlog: { labelCoverage: { rate: 1 }, milestoneCoverage: { rate: 1 } },
    dora: { ciChecks: { greenRate: 0.97 }, leadTimeHours: { median: 1 } },
    governance: { coverageRate: 1, directPushCount: 0 },
    evalSummary: { heldout: { latest: { passRate: 0.9, total: 21 }, realRuns: 5 } },
    release: { recoveryHours: 0.5 },
    feedback: { conversionRate: 1 },
  });
  assert.equal(sc.currentLevel, 6);
  assert.ok(sc.levels.every((l) => l.verdict === "met"));
  assert.equal(sc.nextGap, null);
});

test("L5: a change-failure-marker recovery is labeled honestly, never 'deploy recovery'", () => {
  const sc = computeMaturityScorecard({ dora: { changeFailures: { recoveryHours: { median: 0.5 } } } });
  const l5 = sc.levels.find((l) => l.level === 5);
  assert.equal(l5.recoverySource, "change_failure_marker");
  assert.match(l5.measured, /change-failure recovery/);
  assert.doesNotMatch(l5.measured, /deploy recovery/, "a github marker number must not masquerade as deploy recovery");
});

test("L5: a real deploy recovery is labeled 'deploy recovery' with source deploy", () => {
  const sc = computeMaturityScorecard({ release: { recoveryHours: 0.4, source: "deploy" } });
  const l5 = sc.levels.find((l) => l.level === 5);
  assert.equal(l5.recoverySource, "deploy");
  assert.match(l5.measured, /deploy recovery 0\.4h/);
});

test("L5 measured surfaces the recovery sample size and an open incident (M4 + n)", () => {
  const l5 = byLevel(computeMaturityScorecard({
    release: { recoveryHours: 0.3, recoveryCount: 1, openIncident: true, source: "deploy" },
  }))[5];
  assert.match(l5.measured, /n=1/, "sample size is visible (a met on n=1 is not n=20)");
  assert.match(l5.measured, /open incident/, "an active unrecovered failure is surfaced, not hidden by the median");
  assert.equal(l5.openIncident, true);
});

test("L5 orchestration proxy names 'deploys present, no recovery sample' honestly (M5)", () => {
  const withDeploys = byLevel(computeMaturityScorecard({
    release: { recoveryHours: 0.5, recoveryCount: 2, source: "orchestration", deployPresentNoRecovery: true },
  }))[5];
  assert.match(withDeploys.measured, /deploys present, no failure→recovery sample/);
  assert.doesNotMatch(withDeploys.measured, /no deploy data/, "don't claim 'no deploy data' when deploys exist");
});

import { maturityScorecard } from "../src/read-models/maturity-scorecard.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir as tmp } from "node:os";
import { join as pjoin } from "node:path";

test("L1: a backlog artifact missing a coverage field is INDETERMINATE, not 0% unmet", () => {
  const l1 = byLevel(computeMaturityScorecard({ backlog: { labelCoverage: { rate: 1 } } }))[1]; // milestoneCoverage absent
  assert.equal(l1.verdict, "indeterminate", "an absent coverage field is a measurement gap, not a failure");
});

test("L6: an unwired feedback input reads as 'not instrumented', not silent-indeterminate", () => {
  const l6 = byLevel(computeMaturityScorecard({}))[6];
  assert.equal(l6.verdict, "indeterminate");
  assert.match(l6.detail, /not instrumented/);
});

test("L6: a wired feedback ledger reads measured with the conversion rate + sample size", () => {
  const l6 = byLevel(computeMaturityScorecard({
    feedback: { conversionRate: 0.25, events: 4, created: 0, pendingApproval: 1 },
  }))[6];
  assert.equal(l6.verdict, "met", "conversion > 0 meets the frontier gate");
  assert.match(l6.measured, /25% conversion \(n=4\)/, "the rate carries its sample size");
  assert.deepEqual(l6.feedbackSample, { events: 4, created: 0, pendingApproval: 1 });
  assert.doesNotMatch(l6.detail, /not instrumented/);
});

test("loadMaturityInputs reads the feedback ledger into the L6 input via triageReport", () => {
  const root = mkdtempSync(pjoin(tmp(), "mx-fb-"));
  mkdirSync(pjoin(root, ".myagenttool", "feedback"), { recursive: true });
  writeFileSync(
    pjoin(root, ".myagenttool", "feedback", "processed.jsonl"),
    [
      JSON.stringify({ dedupeKey: "a", action: "created", eventCreatedAt: "2026-07-01T00:00:00.000Z", processedAt: "2026-07-01T00:05:00.000Z" }),
      JSON.stringify({ dedupeKey: "b", action: "skipped-duplicate" }),
    ].join("\n") + "\n",
  );
  const inputs = loadMaturityInputs({ repoRoot: root, metricsDir: pjoin(root, "no-metrics"), evalTrend: [] });
  assert.ok(inputs.feedback, "the ledger populates the feedback input");
  assert.equal(inputs.feedback.events, 2);
  assert.equal(inputs.feedback.conversionRate, 0.5, "1 handled of 2 ledger events");
  assert.equal(byLevel(computeMaturityScorecard(inputs))[6].verdict, "met");
});

test("loadMaturityInputs leaves feedback null (L6 indeterminate) when there is no ledger", () => {
  const root = mkdtempSync(pjoin(tmp(), "mx-nofb-"));
  const inputs = loadMaturityInputs({ repoRoot: root, metricsDir: pjoin(root, "no-metrics"), evalTrend: [] });
  assert.equal(inputs.feedback, null, "no ledger → no faked pass");
  assert.equal(byLevel(computeMaturityScorecard(inputs))[6].verdict, "indeterminate");
});

test("maturityScorecard surfaces metrics freshness + a stale flag (H5)", () => {
  const dir = mkdtempSync(pjoin(tmp(), "mx-fresh-"));
  mkdirSync(pjoin(dir, "2020-01-01T00-00-00-000Z-governance"));
  writeFileSync(pjoin(dir, "2020-01-01T00-00-00-000Z-governance", "governance.json"), JSON.stringify({ coverageRate: 1, directPushCount: 0 }));
  const sc = maturityScorecard({ metricsDir: dir, evalTrend: [] });
  const gov = sc.metricsFreshness.sources.find((s) => s.source === "governance");
  assert.ok(gov, "the governance artifact's age is surfaced");
  assert.ok(gov.ageHours > 24, "a 2020 artifact is very old");
  assert.equal(sc.metricsFreshness.stale, true, "stale when the oldest source is >24h old");
});
