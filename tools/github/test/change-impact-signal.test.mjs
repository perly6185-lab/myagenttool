/*
 * #1317: the Change Impact & Risk Assessment is a NON-blocking signal. The
 * predicate detects the section, planPrEvidence reports it, and — critically —
 * its absence never flips allSatisfied (it is not a hard gate).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { hasChangeImpactAssessment, planPrEvidence } from "../src/pr-evidence.mjs";

test("hasChangeImpactAssessment detects the section heading", () => {
  assert.equal(hasChangeImpactAssessment("## Change Impact & Risk Assessment\n- Risk: low"), true);
  assert.equal(hasChangeImpactAssessment("##  change impact and stuff"), true); // case-insensitive, loose
  assert.equal(hasChangeImpactAssessment("## Verification\n- ran tests"), false);
  assert.equal(hasChangeImpactAssessment(""), false);
  assert.equal(hasChangeImpactAssessment(null), false);
});

test("planPrEvidence reports changeImpact", () => {
  const withSection = planPrEvidence({
    files: ["docs/x.md"],
    body: "Closes #1\n## Verification\n- test\n## Change Impact & Risk Assessment\n- Risk: low",
  });
  assert.equal(withSection.changeImpact, true);

  const without = planPrEvidence({ files: ["docs/x.md"], body: "Closes #1\n## Verification\n- test" });
  assert.equal(without.changeImpact, false);
});

test("missing Change Impact section does NOT block allSatisfied (non-gating)", () => {
  // A clean PR (no risk routes, links issue, has verification) but no impact section.
  const plan = planPrEvidence({
    files: ["docs/x.md"],
    body: "Closes #1\n## Verification\n- pnpm test passed",
  });
  assert.equal(plan.changeImpact, false);
  assert.equal(plan.allSatisfied, true, "absence of the impact section must not gate the PR");
});

test("changeImpact is null when no body is provided", () => {
  const plan = planPrEvidence({ files: ["docs/x.md"], body: "" });
  assert.equal(plan.changeImpact, null);
});
