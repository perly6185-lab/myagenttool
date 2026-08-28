import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkItemCompletionAssessment } from "./task-view-types";
import { WorkItemCompletionStatus } from "./work-item-completion-status";

afterEach(() => cleanup());

function assessment(overrides: Partial<WorkItemCompletionAssessment> = {}): WorkItemCompletionAssessment {
  return {
    schemaVersion: 1,
    status: "completed",
    declaredComplete: true,
    evidenceComplete: true,
    falseCompletion: false,
    requiresUserAction: false,
    humanInterventionRequired: false,
    reasonCodes: [],
    stages: {},
    ...overrides,
  };
}

describe("work item completion status", () => {
  it("states genuine completion without exposing internal evidence jargon", () => {
    render(<WorkItemCompletionStatus assessment={assessment()} language="zh" />);
    expect(screen.getByText("任务已真正完成")).toBeTruthy();
    expect(screen.getByText("任务状态和完成证据一致。")).toBeTruthy();
  });

  it("does not call a closed task completed when receipts are missing", () => {
    render(<WorkItemCompletionStatus assessment={assessment({
      status: "unverified", evidenceComplete: false, falseCompletion: true, requiresUserAction: true,
    })} language="zh" />);
    expect(screen.getByText("暂不能确认完成")).toBeTruthy();
    expect(screen.getByText(/不会计为完成/)).toBeTruthy();
  });

  it("distinguishes a user-stopped task from successful completion", () => {
    render(<WorkItemCompletionStatus assessment={assessment({
      status: "stopped", requiresUserAction: true, reasonCodes: ["delivery_stopped_by_user"],
    })} language="en" />);
    expect(screen.getByText("Task stopped")).toBeTruthy();
    expect(screen.getByText(/not counted as completed/)).toBeTruthy();
  });
});
