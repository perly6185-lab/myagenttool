import { describe, expect, it } from "vitest";
import {
  deriveHomeNextAction,
  hasPendingDecisionForInvocation,
} from "./home-next-action";

const invocation = (status: string) => ({
  id: "run-1",
  projectId: "project-1",
  status,
});

describe("Home single-next-action matrix (#1539)", () => {
  it.each([
    [null, false, "idle", "run"],
    [invocation("running"), false, "running", "view_progress"],
    [invocation("waiting_for_local_approval"), false, "approval", "handle_approval"],
    [invocation("failed"), false, "failed", "review_failure"],
    [invocation("succeeded"), false, "succeeded", "view_result"],
  ] as const)("maps %o to one %s action", (current, pending, state, action) => {
    expect(deriveHomeNextAction({
      invocation: current,
      hasPendingDecision: pending,
    })).toEqual({ state, action });
  });

  it("prioritizes a pending decision over running progress", () => {
    expect(deriveHomeNextAction({
      invocation: invocation("running"),
      hasPendingDecision: true,
    })).toEqual({ state: "approval", action: "handle_approval" });
  });

  it("matches decisions by invocation reference or current project", () => {
    const current = invocation("running");
    expect(hasPendingDecisionForInvocation([{
      id: "decision-1",
      kind: "invocation_approval",
      title: "Approve",
      section: "approvals",
      ref: { invocationId: "run-1" },
    }], current, "project-1")).toBe(true);
    expect(hasPendingDecisionForInvocation([{
      id: "decision-2",
      kind: "design",
      title: "Other project",
      section: "approvals",
      projectId: "project-2",
    }], current, "project-1")).toBe(false);
  });
});
