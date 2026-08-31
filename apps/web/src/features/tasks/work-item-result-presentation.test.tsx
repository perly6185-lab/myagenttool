import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalWorkItem } from "./task-view-types";
import { WorkItemCompletedTaskCard } from "./work-item-completed-task-card";
import { WorkItemDeliveryRecoveryAlert } from "./work-item-delivery-recovery-alert";
import { WorkItemFailedResultFiles, WorkItemResultRepairCard } from "./work-item-result-review";
import { WorkItemReviewDecisionSection } from "./work-item-review-decision-section";
import { COPY } from "./work-item-summary-copy";
import type { DeliveryDecision } from "./work-item-summary-model";

afterEach(() => cleanup());

const completedItem = {
  id: "wi_1",
  title: "Prepare customer update",
  body: "Summarize the outcome.",
  status: "done",
  myTemplateBinding: null,
  myTemplateDraft: null,
  myTemplateOutcomeFeedback: null,
} as unknown as LocalWorkItem;

const decision: DeliveryDecision = {
  state: "ready",
  risk: "low",
  domain: "development",
  domainLabel: "Development",
  statusLabel: "Ready",
  riskReason: "Checks passed.",
  headline: "Ready to apply",
  scope: "One file",
  checks: "All checks passed",
  recommendation: "Accept",
  confirmEffect: "Apply the result",
  confirmRisk: "Low risk",
  revisionEffect: "Create another run",
  revisionRisk: "The current result remains available",
};

describe("work item result presentation", () => {
  it("shows the local delivery receipt and keeps the result toggle accessible", () => {
    const onToggle = vi.fn();
    render(<WorkItemCompletedTaskCard
      item={completedItem}
      language="zh"
      copy={COPY.zh}
      receipt={{ baseBranch: "main", deliveredCommit: "1234567890abcdef", deliveredAt: "2026-08-31T00:00:00Z" }}
      changedFileCount={2}
      verificationSummary="测试已通过"
      resultExpanded={false}
      resultSectionId="result-wi-1"
      resultSummary="已完成更新"
      canOperate={false}
      templateDraftPending={false}
      templateOutcomeEditing={false}
      templateOutcomePending={false}
      templateOutcomeError={null}
      onToggleResult={onToggle}
      onOpenTemplateDraft={vi.fn()}
      onEditTemplateOutcome={vi.fn()}
      onRecordTemplateOutcome={vi.fn()}
    />);

    expect(screen.getByLabelText("本地交付回执").textContent).toContain("1234567890ab");
    expect(screen.getByText("2 个文件已应用")).toBeTruthy();
    const toggle = screen.getByRole("button", { name: COPY.zh.action.completed });
    expect(toggle.getAttribute("aria-controls")).toBe("result-wi-1");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("exposes the explicit delivery recovery action", () => {
    const onRecover = vi.fn();
    render(<WorkItemDeliveryRecoveryAlert error="交付未完成" recovery="review_changes" language="zh" onRecover={onRecover} />);
    expect(screen.getByRole("alert").textContent).toContain("交付未完成");
    fireEvent.click(screen.getByRole("button", { name: "检查当前改动" }));
    expect(onRecover).toHaveBeenCalledOnce();
  });

  it("keeps result repair permission-gated and non-automatic", () => {
    const onCreateRepair = vi.fn();
    render(<WorkItemResultRepairCard
      language="en"
      failedChecks={[{ kind: "verification", summary: "Unit tests failed" }]}
      canOperate
      pending={false}
      error={null}
      onCreateRepair={onCreateRepair}
    />);
    expect(screen.getByText("Creates the task without starting it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Create repair task/ }));
    expect(onCreateRepair).toHaveBeenCalledOnce();
  });

  it("preserves direct review access for files produced by a failed run", () => {
    const onOpen = vi.fn();
    render(<WorkItemFailedResultFiles
      language="en"
      copy={COPY.en}
      entries={[{ name: "report.md", path: "report.md", projectId: "prj_1", worktreeId: "wt_1", status: "available", preview: "document" }]}
      openingKey={null}
      error={null}
      onOpen={onOpen}
    />);
    fireEvent.click(screen.getByRole("button", { name: `${COPY.en.browseDeliverableFile}: report.md` }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ path: "report.md" }));
  });

  it("does not enable completion when the authoritative review is pending", () => {
    const onAccept = vi.fn();
    render(<WorkItemReviewDecisionSection
      resultSectionId="result-wi-1"
      language="en"
      copy={COPY.en}
      deliveryDecision={decision}
      executionContractReady
      executionContractDefined
      hasDelivery
      reviewVerdict={null}
      aiReviewStatus="running"
      acceptActionLabel="Accept and complete"
      confirmActionEffect="Apply the result"
      confirmActionRisk="Low risk"
      changeRequestOpen={false}
      feedbackMode="revision"
      changeRequest=""
      actionPending={null}
      executionActionLocked={false}
      canConfirmDelivery
      onPrepareExecutionPlan={vi.fn()}
      onChangeRequest={vi.fn()}
      onCancelChangeRequest={vi.fn()}
      onSendChangeRequest={vi.fn()}
      onStopDelivery={vi.fn()}
      onOpenFollowUp={vi.fn()}
      onOpenRevision={vi.fn()}
      onAccept={onAccept}
    />);
    expect(screen.getByText(COPY.en.aiReviewPending)).toBeTruthy();
    const accept = screen.getByRole("button", { name: "Accept and complete" });
    expect((accept as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(accept);
    expect(onAccept).not.toHaveBeenCalled();
  });
});
