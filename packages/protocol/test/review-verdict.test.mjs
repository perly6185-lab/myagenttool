import assert from "node:assert/strict";
import test from "node:test";

import { normalizeReviewVerdict, reviewSummaryIndicatesClean } from "@myagenttool/protocol/review-verdict";

test("clean empty review corrects a contradictory changes-requested verdict", () => {
  assert.deepEqual(normalizeReviewVerdict({
    reportedVerdict: "changes_requested",
    summary: "The changes are consistent, type-safe, and do not introduce observable regressions.",
    findings: [],
  }), {
    verdict: "approved",
    reportedVerdict: "changes_requested",
    consistency: "corrected_clean_summary",
    cleanSummary: true,
    actionableFindingCount: 0,
  });
});

test("actionable findings override an incorrect approval", () => {
  const result = normalizeReviewVerdict({
    reportedVerdict: "approved",
    summary: "Looks good.",
    findings: [{ message: "Persistence is missing." }],
  });
  assert.equal(result.verdict, "changes_requested");
  assert.equal(result.consistency, "corrected_actionable_findings");
});

test("negative and ambiguous empty reviews continue to fail closed when reported that way", () => {
  for (const summary of [
    "The requested behavior is incomplete.",
    "No issues were found, but persistence is still missing.",
    "No issues were found. Persistence is missing.",
    "Review finished.",
  ]) {
    const result = normalizeReviewVerdict({ reportedVerdict: "changes_requested", summary, findings: [] });
    assert.equal(result.verdict, "changes_requested", summary);
    assert.equal(result.consistency, "consistent", summary);
  }
  assert.equal(reviewSummaryIndicatesClean("The result is not consistent."), false);
});
