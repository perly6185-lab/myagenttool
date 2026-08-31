import { describe, expect, it, vi } from "vitest";
import type { ExecutionActionReceipt } from "./execution-review-card";
import type { SummaryCopy } from "./work-item-summary-copy";
import { createWorkItemExecutionController } from "./work-item-execution-controller";
import type {
  LocalWorkItem,
  LocalWorkItemAutoRun,
  LocalWorkItemObservability,
  WorkItemExecutionReview,
} from "./task-view-types";

function workItem(overrides: Partial<LocalWorkItem> = {}) {
  return {
    id: "lwi_1",
    projectId: "project_1",
    title: "Implement the task",
    body: "Keep the existing behavior.",
    revision: 7,
    acceptanceCriteria: [],
    verificationSop: [],
    ...overrides,
  } as LocalWorkItem;
}

function autoRun(overrides: Partial<LocalWorkItemAutoRun> = {}) {
  return {
    id: "run_1",
    status: "failed",
    updatedAt: "2026-08-31T10:00:00.000Z",
    ...overrides,
  } as LocalWorkItemAutoRun;
}

function projectedReview(locked = false) {
  return {
    recommendedAction: { kind: "retry_execution" },
    targetId: "run_1",
    targetStatus: "failed",
    actionAvailability: {
      schemaVersion: 1,
      primaryActionKind: "retry_execution",
      locked,
      actions: [{
        kind: "retry_execution",
        visible: true,
        enabled: true,
        requiresConfirmation: false,
        nextOwner: "me",
        blockedReasonCodes: [],
      }],
    },
  } as unknown as WorkItemExecutionReview;
}

function setup({
  item = workItem(),
  run = null,
  review = null,
  receipt = null,
  executionContractDefined = false,
  hasRetryableExecution = false,
}: {
  item?: LocalWorkItem;
  run?: LocalWorkItemAutoRun | null;
  review?: WorkItemExecutionReview | null;
  receipt?: ExecutionActionReceipt | null;
  executionContractDefined?: boolean;
  hasRetryableExecution?: boolean;
} = {}) {
  const client = {
    suggestWorkItemDraft: vi.fn(),
    updateWorkItem: vi.fn(),
    prepareWorkItemExecutionContract: vi.fn(),
    confirmWorkItemExecutionContract: vi.fn(),
    createWorkItemComment: vi.fn(),
    retryAutoRun: vi.fn(),
    startWorkItemAutoRun: vi.fn(),
    reverifyAutoRun: vi.fn(),
    answerClarify: vi.fn(),
    cancelAutoRun: vi.fn(),
    cancelWorkItemExecutionStart: vi.fn(),
    recheckWorkItemExecutionStart: vi.fn(),
    retryLegacyWorkItemExecution: vi.fn(),
    reconcileAutoRunExecutionAction: vi.fn(),
  };
  const effects = {
    setItem: vi.fn(),
    setReadiness: vi.fn(),
    setPending: vi.fn(),
    setActionError: vi.fn(),
    setNotice: vi.fn(),
    setReceipt: vi.fn(),
    refresh: vi.fn(),
    setStartConfirmationOpen: vi.fn(),
    setPendingTemplateClarification: vi.fn(),
    setChangeRequest: vi.fn(),
    setChangeRequestOpen: vi.fn(),
    setResultExpanded: vi.fn(),
    setReportOpen: vi.fn(),
    setMaterialNotice: vi.fn(),
    setClarifyAnswer: vi.fn(),
    setClarifyPending: vi.fn(),
    setClarifyStopPending: vi.fn(),
    setClarifyError: vi.fn(),
    setRetryOpen: vi.fn(),
    setRetryPending: vi.fn(),
    setRetryError: vi.fn(),
  };
  const reviewHandlers = {
    runPrimaryAction: vi.fn(),
    openReviewResult: vi.fn(),
    openDetails: vi.fn(),
    viewChanges: vi.fn(),
    viewBatchDetails: vi.fn(),
    openPullRequestConfirmation: vi.fn(),
    openDeliveryConfirmation: vi.fn(),
  };
  const controller = createWorkItemExecutionController({
    item,
    observability: run ? { latestRun: run } as unknown as LocalWorkItemObservability : null,
    executionReview: review,
    effectiveReceipt: receipt,
    pendingTemplateClarification: null,
    actionPending: null,
    executionContractDefined,
    canStartAi: true,
    changeRequest: "",
    feedbackMode: "revision",
    canRerunVerification: false,
    canAskAiToFix: false,
    askAiFixFeedback: "Fix the verified issue.",
    clarifyAnswer: "",
    clarifyPending: false,
    clarifyStopPending: false,
    retryPending: false,
    hasRetryableExecution,
    retryableLegacyExecution: false,
    retryableRun: run,
    language: "en",
    copy: {
      aiStartFailed: "AI start failed.",
      changesSent: "Changes sent.",
      changesFailed: "Changes failed.",
      commentFailed: "Comment failed.",
      materialReprocessStarted: "Reprocessing started.",
      retrySucceeded: "Retry started.",
      retryFailed: "Retry failed.",
    } as SummaryCopy,
    effects,
    reviewHandlers,
    client,
  });
  return { client, controller, effects, reviewHandlers };
}

describe("work item execution controller", () => {
  it("builds a stable bounded idempotency request from the current execution state", () => {
    const { controller } = setup({
      run: autoRun({ status: "failed" }),
      review: projectedReview(),
      receipt: { id: "receipt_1", status: "safe_to_retry", message: "Safe", impact: "none", nextOwner: "me" },
    });

    const first = controller.actionRequest("retry_execution");
    const second = controller.actionRequest("retry_execution");

    expect(second).toEqual(first);
    expect(first.expectedWorkItemRevision).toBe(7);
    expect(first.expectedTargetStatus).toBe("failed");
    expect(first.idempotencyKey).toContain("work-item:lwi_1:retry_execution:7:receipt_1:safe_to_retry");
    expect(first.idempotencyKey.length).toBeLessThanOrEqual(200);
  });

  it("prepares the execution contract before opening the single start confirmation", async () => {
    const prepared = workItem({
      revision: 8,
      acceptanceCriteria: ["Behavior is preserved"],
      verificationSop: ["Run the focused tests"],
    });
    const { client, controller, effects } = setup();
    client.suggestWorkItemDraft.mockResolvedValue({
      draft: {
        taskUnderstanding: "Behavior-preserving extraction",
        acceptanceCriteria: prepared.acceptanceCriteria,
        verificationSop: prepared.verificationSop,
      },
    });
    client.prepareWorkItemExecutionContract.mockResolvedValue({ workItem: prepared });

    await controller.prepareStartExecutionPlan();

    expect(client.prepareWorkItemExecutionContract).toHaveBeenCalledWith("lwi_1", {
      expectedRevision: 7,
      draftOverride: {
        taskUnderstanding: "Behavior-preserving extraction",
        acceptanceCriteria: ["Behavior is preserved"],
        verificationSop: ["Run the focused tests"],
        risks: undefined,
        evidence: undefined,
      },
    });
    expect(effects.setItem).toHaveBeenCalledWith(prepared);
    expect(effects.setStartConfirmationOpen).toHaveBeenCalledWith(true);
    expect(effects.setPending.mock.calls).toEqual([["start"], [null]]);
    expect(client.confirmWorkItemExecutionContract).not.toHaveBeenCalled();
  });

  it("honors an authoritative review lock before retrying a failed execution", async () => {
    const run = autoRun();
    const { client, controller, effects } = setup({
      run,
      review: projectedReview(true),
      executionContractDefined: true,
      hasRetryableExecution: true,
    });

    await controller.retryAiWork();

    expect(client.retryAutoRun).not.toHaveBeenCalled();
    expect(effects.setRetryPending).not.toHaveBeenCalled();
  });
});
