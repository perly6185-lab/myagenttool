import { describe, expect, it, vi } from "vitest";
import type { WorkItemExecutionReview, WorkItemReviewAction } from "./task-view-types";
import { createWorkItemReviewActionController } from "./work-item-review-action-controller";

function projectedReview(actions: WorkItemReviewAction[], locked = false, primaryActionKind = "review_result") {
  return {
    recommendedAction: { kind: primaryActionKind },
    actionAvailability: { schemaVersion: 1, primaryActionKind, locked, actions },
  } as WorkItemExecutionReview;
}

function action(kind: string, enabled = true): WorkItemReviewAction {
  return { kind, visible: true, enabled, requiresConfirmation: false, nextOwner: "me", blockedReasonCodes: enabled ? [] : ["verification_required"] };
}

describe("work item review action controller", () => {
  it("treats the server projection as authoritative over a permissive legacy fallback", () => {
    const rerun = vi.fn();
    const controller = createWorkItemReviewActionController({
      review: projectedReview([action("rerun_verification", false)]),
      handlers: { rerun_verification: rerun },
    });

    expect(controller.isEnabled("rerun_verification", true)).toBe(false);
    expect(controller.run("rerun_verification", true)).toBe(false);
    expect(rerun).not.toHaveBeenCalled();
  });

  it("allows a projected action even when the legacy fallback is stale and restrictive", () => {
    const rerun = vi.fn();
    const controller = createWorkItemReviewActionController({
      review: projectedReview([action("rerun_verification", true)]),
      handlers: { rerun_verification: rerun },
    });

    expect(controller.isEnabled("rerun_verification", false)).toBe(true);
    expect(controller.run("rerun_verification", false)).toBe(true);
    expect(rerun).toHaveBeenCalledTimes(1);
  });

  it("uses the isolated legacy fallback only when no action projection exists", () => {
    const rerun = vi.fn();
    const controller = createWorkItemReviewActionController({
      review: { recommendedAction: { kind: "rerun_verification" } } as WorkItemExecutionReview,
      handlers: { rerun_verification: rerun },
    });

    expect(controller.usesProjection).toBe(false);
    expect(controller.run("rerun_verification", true)).toBe(true);
    expect(controller.run("fix_with_ai", false)).toBe(false);
    expect(rerun).toHaveBeenCalledTimes(1);
  });

  it("keeps read-only actions available while a projection lock freezes mutations", () => {
    const view = vi.fn();
    const apply = vi.fn();
    const controller = createWorkItemReviewActionController({
      review: projectedReview([action("view_changes"), action("apply_local_changes")], true),
      handlers: { view_changes: view, apply_local_changes: apply },
    });

    expect(controller.run("view_changes")).toBe(true);
    expect(controller.run("apply_local_changes")).toBe(false);
    expect(view).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
  });

  it("supports an older projection that omits its read-only primary navigation action", () => {
    const reviewResult = vi.fn();
    const controller = createWorkItemReviewActionController({
      review: projectedReview([], false, "review_result"),
      handlers: { review_result: reviewResult },
    });

    expect(controller.run("review_result")).toBe(true);
    expect(reviewResult).toHaveBeenCalledTimes(1);
  });

  it("sends an enabled unknown action to the read-only fallback instead of guessing a write", () => {
    const knownWrite = vi.fn();
    const unknown = vi.fn();
    const controller = createWorkItemReviewActionController({
      review: projectedReview([action("future_delivery_operation")]),
      handlers: { apply_local_changes: knownWrite },
      onUnknownAction: unknown,
    });

    expect(controller.run("future_delivery_operation")).toBe(false);
    expect(unknown).toHaveBeenCalledWith("future_delivery_operation");
    expect(knownWrite).not.toHaveBeenCalled();
  });
});
