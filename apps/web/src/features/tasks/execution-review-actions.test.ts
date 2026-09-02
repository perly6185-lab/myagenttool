import { describe, expect, it } from "vitest";
import type { WorkItemReviewAction } from "./task-view-types";
import { reviewActionBlockedReasons } from "./execution-review-actions";

describe("review action blocked reasons", () => {
  it("replaces unknown provider reason codes with generic safe copy", () => {
    const action = {
      kind: "apply_local_changes",
      visible: true,
      enabled: false,
      requiresConfirmation: true,
      nextOwner: "me",
      blockedReasonCodes: ["provider_specific_blocker"],
    } as unknown as WorkItemReviewAction;

    expect(reviewActionBlockedReasons(action, "en")).toEqual([
      "Delivery evidence is not complete enough to apply the result.",
    ]);
  });
});
