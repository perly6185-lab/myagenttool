import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { actionErrorModel } from "@/lib/action-error";

describe("actionErrorModel", () => {
  it("turns an expired session into an actionable retry", () => {
    expect(actionErrorModel(new ApiError("unauthenticated", "Session expired.", 401))).toMatchObject({
      retryable: true,
      impact: "This action was not sent.",
    });
  });

  it("does not offer a blind retry for approval refusal", () => {
    expect(actionErrorModel(new ApiError("approval_required", "Approval required.", 403)).retryable).toBe(false);
  });
});
