import assert from "node:assert/strict";
import test from "node:test";

import { projectWorkItemRiskReview } from "../src/services/work-item-risk-review.mjs";

test("risk review combines failed execution, verification, and unknown impact into one user decision", () => {
  assert.deepEqual(projectWorkItemRiskReview({
    state: "failed",
    attentionCode: "test_failed",
    verification: { status: "failed" },
    impact: { status: "unknown" },
  }), {
    needsAttention: true,
    riskReasons: [
      { code: "execution_failed", severity: "high", scope: "execution" },
      { code: "verification_failed", severity: "high", scope: "verification" },
      { code: "external_impact_unknown", severity: "medium", scope: "external_impact" },
    ],
    recommendedAction: {
      kind: "retry_execution", reasonCode: "execution_failed", requiresConfirmation: true, nextOwner: "me",
    },
  });
});

test("risk review distinguishes development repair from office partial-impact review", () => {
  const development = projectWorkItemRiskReview({
    state: "review_ready",
    verification: { status: "failed" },
    impact: { status: "proposed" },
    deliveryEvidence: { domain: "development", status: "changes_requested" },
  });
  assert.equal(development.recommendedAction.kind, "fix_with_ai");
  assert.deepEqual(development.riskReasons.map((reason) => reason.code), ["verification_failed", "pull_request_not_applied"]);

  const office = projectWorkItemRiskReview({
    state: "review_ready",
    verification: { status: "passed" },
    impact: { status: "partial" },
    deliveryEvidence: { domain: "office" },
  });
  assert.equal(office.recommendedAction.kind, "review_result");
  assert.deepEqual(office.riskReasons, [{ code: "office_batch_partial", severity: "high", scope: "external_impact" }]);
});

test("risk review names inconsistent office batch evidence instead of reporting a generic unknown impact", () => {
  const result = projectWorkItemRiskReview({
    state: "review_ready",
    verification: { status: "passed" },
    impact: { status: "unknown" },
    deliveryEvidence: {
      domain: "office",
      actionPreview: { officeDetails: { batch: { countConsistent: false } } },
    },
  });

  assert.deepEqual(result.riskReasons, [{
    code: "office_batch_evidence_inconsistent",
    severity: "high",
    scope: "external_impact",
  }]);
  assert.equal(result.recommendedAction.kind, "review_result");
});
