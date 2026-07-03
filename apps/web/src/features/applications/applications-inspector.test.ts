import { describe, expect, it } from "vitest";
import {
  latestRoutineInvocation,
  readableRecoveryActionAvailabilityReason,
  readableRecoveryActionType,
  readableRecoveryAgentReason,
  readableRecoveryOutcome,
  readableRecoveryOutcomeReason,
  readableRecoveryTimelineStatus,
} from "@/features/applications/applications-inspector";
import type { InvocationSnapshot } from "@/lib/console-state";

describe("latestRoutineInvocation", () => {
  it("selects the newest matching application orchestration invocation", () => {
    const invocations = [
      invocation("inv_new", "app_docs", "routine_docs_smoke"),
      invocation("inv_other_routine", "app_docs", "routine_docs_lint"),
      invocation("inv_other_app", "app_blog", "routine_docs_smoke"),
      invocation("inv_old", "app_docs", "routine_docs_smoke"),
    ];

    expect(latestRoutineInvocation(invocations, "app_docs", "routine_docs_smoke")?.id).toBe("inv_new");
  });

  it("ignores invocations without application orchestration metadata", () => {
    const invocations = [
      {
        id: "inv_manual",
        options: { metadata: { applicationId: "app_docs", routineId: "routine_docs_smoke" } },
      },
    ] satisfies InvocationSnapshot[];

    expect(latestRoutineInvocation(invocations, "app_docs", "routine_docs_smoke")).toBeNull();
  });
});

describe("readableRecoveryAgentReason", () => {
  it("renders governed select-agent rejection reasons", () => {
    expect(readableRecoveryAgentReason("application_control_missing")).toBe("missing application control");
    expect(readableRecoveryAgentReason("device_unlinked")).toBe("device unlinked");
    expect(readableRecoveryAgentReason("custom_reason")).toBe("custom_reason");
  });
});

describe("recovery lineage labels", () => {
  it("renders recovery action and outcome labels", () => {
    expect(readableRecoveryActionType("select_agent")).toBe("Select agent");
    expect(readableRecoveryActionType("custom_action")).toBe("custom_action");
    expect(readableRecoveryActionAvailabilityReason("same_action_in_progress")).toBe("Already in progress");
    expect(readableRecoveryActionAvailabilityReason("custom_reason")).toBe("custom_reason");
    expect(readableRecoveryOutcome("still_failed")).toBe("Still failed");
    expect(readableRecoveryOutcome("custom_state")).toBe("custom_state");
    expect(readableRecoveryOutcomeReason("result_failed")).toBe("Result failed");
    expect(readableRecoveryOutcomeReason("custom_reason")).toBe("custom_reason");
    expect(readableRecoveryTimelineStatus("approval_pending")).toBe("Approval pending");
    expect(readableRecoveryTimelineStatus("custom_status")).toBe("custom_status");
  });
});

function invocation(id: string, applicationId: string, routineId: string): InvocationSnapshot {
  return {
    id,
    status: "queued",
    options: {
      metadata: {
        source: "application_orchestration",
        applicationId,
        routineId,
      },
    },
  };
}
