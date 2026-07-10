import assert from "node:assert/strict";
import { test } from "node:test";

import { computeMaturityScorecard, HELDOUT_FLOOR } from "../src/read-models/maturity-scorecard.mjs";

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

test("L5 stays indeterminate until deploy recovery time is instrumented", () => {
  const sc = computeMaturityScorecard({ dora: { ciChecks: { greenRate: 0.97 }, leadTimeHours: { median: 1 } } });
  assert.equal(byLevel(sc)[5].verdict, "indeterminate");
  assert.match(byLevel(sc)[5].detail, /not instrumented/);
  const withRecovery = computeMaturityScorecard({ release: { recoveryHours: 0.5 } });
  assert.equal(byLevel(withRecovery)[5].verdict, "met");
});

test("full ladder met → currentLevel 6", () => {
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
});
