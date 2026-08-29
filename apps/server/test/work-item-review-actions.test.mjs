import assert from "node:assert/strict";
import test from "node:test";

import { projectWorkItemReviewActions } from "../src/services/work-item-review-actions.mjs";

function byKind(result, kind) {
  return result.actions.find((candidate) => candidate.kind === kind);
}

test("development verification failure enables repair and reverification but blocks pull-request creation", () => {
  const result = projectWorkItemReviewActions({
    state: "review_ready",
    targetStatus: "pr_open",
    executionKind: "auto_run",
    verification: { status: "failed" },
    hasWorktree: true,
    recommendedAction: { kind: "fix_with_ai" },
    deliveryEvidence: {
      domain: "development",
      status: "verification_failed",
      review: { verdict: "approved" },
      actionPreview: {
        operation: "update_pull_request",
        changedFileCount: 2,
        canProceed: false,
        requiresConfirmation: true,
        blockedReasonCodes: ["verification_failed"],
      },
    },
  });

  assert.equal(byKind(result, "view_changes").enabled, true);
  assert.equal(byKind(result, "rerun_verification").enabled, true);
  assert.equal(byKind(result, "fix_with_ai").enabled, true);
  assert.equal(byKind(result, "update_pull_request").enabled, false);
  assert.deepEqual(byKind(result, "update_pull_request").blockedReasonCodes, ["verification_failed"]);
});

test("partial office batch keeps details readable and blocks applying another result", () => {
  const result = projectWorkItemReviewActions({
    state: "review_ready",
    targetStatus: "done",
    executionKind: "auto_run",
    deliveryEvidence: {
      domain: "office",
      status: "office_batch_attention",
      blockingReasonCodes: ["office_batch_attention"],
      actionPreview: {
        operation: "apply_office_result",
        canProceed: false,
        requiresConfirmation: true,
        blockedReasonCodes: ["office_batch_attention"],
        officeDetails: { batch: { failedCount: 1, rollback: { status: "prepared" } } },
      },
    },
  });

  assert.equal(byKind(result, "view_batch_details").enabled, true);
  assert.equal(byKind(result, "apply_office_result").enabled, false);
  assert.deepEqual(byKind(result, "apply_office_result").blockedReasonCodes, ["office_batch_attention"]);
});

test("failed office rollback is an explicit delivery blocker", () => {
  const result = projectWorkItemReviewActions({
    state: "review_ready",
    targetStatus: "done",
    executionKind: "auto_run",
    deliveryEvidence: {
      domain: "office",
      status: "office_batch_attention",
      actionPreview: {
        operation: "apply_office_result",
        canProceed: false,
        blockedReasonCodes: ["office_batch_attention"],
        officeDetails: { batch: { rollback: { status: "partial", restoredTargets: 1, blockedTargets: 1 } } },
      },
    },
  });

  assert.deepEqual(byKind(result, "apply_office_result").blockedReasonCodes, [
    "office_batch_attention",
    "office_rollback_incomplete",
  ]);
});

test("missing review evidence disables delivery while preserving safe inspection actions", () => {
  const result = projectWorkItemReviewActions({
    state: "review_ready",
    targetStatus: "done",
    executionKind: "auto_run",
    verification: { status: "not_configured" },
    hasWorktree: true,
    recommendedAction: { kind: "review_result" },
    deliveryEvidence: {
      domain: "development",
      status: "evidence_incomplete",
      actionPreview: {
        operation: "create_pull_request",
        changedFileCount: 1,
        canProceed: false,
        requiresConfirmation: true,
        blockedReasonCodes: ["structured_review_required", "verification_required"],
      },
    },
  });

  assert.equal(byKind(result, "view_changes").enabled, true);
  assert.equal(byKind(result, "rerun_verification").enabled, true);
  assert.equal(byKind(result, "create_pull_request").enabled, false);
  assert.equal(byKind(result, "review_result").enabled, false);
  assert.deepEqual(byKind(result, "create_pull_request").blockedReasonCodes, [
    "structured_review_required",
    "verification_required",
  ]);
});

test("an intent that forbids delivery still allows confirming the reviewed result as complete", () => {
  const result = projectWorkItemReviewActions({
    state: "review_ready",
    targetStatus: "done",
    executionKind: "auto_run",
    verification: { status: "passed" },
    hasWorktree: true,
    recommendedAction: { kind: "review_result" },
    deliveryEvidence: {
      domain: "development",
      status: "ready",
      review: { verdict: "approved" },
      actionPreview: {
        operation: "apply_local_changes",
        changedFileCount: 1,
        canProceed: false,
        requiresConfirmation: true,
        blockedReasonCodes: ["delivery_action_forbidden_by_intent"],
      },
    },
  });

  assert.equal(byKind(result, "apply_local_changes").enabled, false);
  assert.deepEqual(byKind(result, "apply_local_changes").blockedReasonCodes, ["delivery_action_forbidden_by_intent"]);
  assert.equal(byKind(result, "review_result").enabled, true);
  assert.deepEqual(byKind(result, "review_result").blockedReasonCodes, []);
});

test("an uncertain execution receipt locks every mutating review action", () => {
  const result = projectWorkItemReviewActions({
    state: "review_ready",
    targetStatus: "done",
    executionKind: "auto_run",
    verification: { status: "failed" },
    hasWorktree: true,
    actionReceipt: { status: "unknown" },
    deliveryEvidence: {
      domain: "development",
      status: "verification_failed",
      actionPreview: {
        operation: "create_pull_request", changedFileCount: 1, canProceed: false,
        blockedReasonCodes: ["verification_failed"],
      },
    },
  });

  assert.equal(result.locked, true);
  assert.equal(byKind(result, "view_changes").enabled, true);
  assert.ok(byKind(result, "rerun_verification").blockedReasonCodes.includes("execution_action_in_flight_or_unknown"));
  assert.ok(byKind(result, "fix_with_ai").blockedReasonCodes.includes("execution_action_in_flight_or_unknown"));
});

test("a failed legacy application invocation can restart through the Auto-run recovery path", () => {
  const result = projectWorkItemReviewActions({
    state: "failed",
    targetStatus: "failed",
    executionKind: "application_invocation",
    hasWorktree: false,
    recommendedAction: { kind: "retry_execution" },
  });

  assert.equal(byKind(result, "retry_execution").enabled, true);
  assert.deepEqual(byKind(result, "retry_execution").blockedReasonCodes, []);
});

test("a disabled delivery without a specialized diagnosis still returns a usable reason", () => {
  const result = projectWorkItemReviewActions({
    state: "review_ready",
    executionKind: "auto_run",
    deliveryEvidence: {
      domain: "office",
      actionPreview: { operation: "apply_office_result", canProceed: false, blockedReasonCodes: [] },
    },
  });
  assert.deepEqual(byKind(result, "apply_office_result").blockedReasonCodes, ["delivery_evidence_not_ready"]);
});
