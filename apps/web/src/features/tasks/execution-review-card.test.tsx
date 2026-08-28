import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionReviewCard } from "./execution-review-card";
import type { WorkItemExecutionReview } from "./task-view-types";

afterEach(() => cleanup());

function review(overrides: Partial<WorkItemExecutionReview> = {}): WorkItemExecutionReview {
  return {
    schemaVersion: 1,
    state: "working",
    stage: "working",
    stages: [
      { key: "accepted", status: "complete", at: "2026-08-27T01:00:00.000Z" },
      { key: "preparing", status: "complete", at: "2026-08-27T01:01:00.000Z" },
      { key: "working", status: "current", at: "2026-08-27T01:02:00.000Z" },
      { key: "verifying", status: "pending", at: null },
      { key: "review", status: "pending", at: null },
    ],
    executionKind: "auto_run",
    targetId: "aur_1",
    targetStatus: "running",
    agentId: "agt_1",
    agentName: "Coding assistant",
    acceptedAt: "2026-08-27T01:00:00.000Z",
    startedAt: "2026-08-27T01:01:00.000Z",
    updatedAt: "2026-08-27T01:03:00.000Z",
    completedAt: null,
    needsAttention: false,
    attentionCode: null,
    verification: {
      status: "pending",
      verified: false,
      passed: null,
      commands: [],
      command: null,
      exitCode: null,
      summary: null,
      checkedAt: null,
      durationMs: null,
      evidenceCount: 0,
      checks: [],
    },
    impact: { status: "none", reasonCode: "changes_isolated_until_confirmation" },
    riskReasons: [],
    recommendedAction: { kind: "open_details", reasonCode: "execution_in_progress", requiresConfirmation: false, nextOwner: "ai" },
    ...overrides,
  };
}

describe("execution review card", () => {
  it("shows ordinary progress and makes the no-impact boundary explicit", () => {
    const open = vi.fn();
    render(<ExecutionReviewCard review={review()} language="en" onOpenDetails={open} />);

    expect(screen.getByText("AI is working on the task")).toBeTruthy();
    expect(screen.getByText("Verification has not started")).toBeTruthy();
    expect(screen.getByText(/Nothing has been applied/)).toBeTruthy();
    expect(screen.getByText(/Assistant: Coding assistant/)).toBeTruthy();
    const nextAction = screen.getByTestId("execution-next-action");
    const evidence = screen.getByTestId("execution-verification-evidence");
    expect(nextAction.compareDocumentPosition(evidence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Full execution details" }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("shows a failed verification command, exit code, and evidence count", () => {
    render(<ExecutionReviewCard
      review={review({
        state: "failed",
        stage: "verifying",
        needsAttention: true,
        attentionCode: "verification_failed",
        stages: review().stages.map((stage) => ({
          ...stage,
          status: stage.key === "verifying" ? "attention" : stage.key === "review" ? "pending" : "complete",
        })),
        verification: {
          status: "failed",
          verified: true,
          passed: false,
          commands: ["pnpm test"],
          command: "pnpm test",
          exitCode: 1,
          summary: "One test failed.",
          checkedAt: "2026-08-27T01:04:00.000Z",
          durationMs: 2_000,
          evidenceCount: 2,
          checks: [{ id: "wvr_1", kind: "test", status: "failed", command: "pnpm test", summary: "One test failed.", recordedAt: "2026-08-27T01:04:00.000Z", evidenceCount: 2 }],
        },
        riskReasons: [
          { code: "execution_failed", severity: "high", scope: "execution" },
          { code: "verification_failed", severity: "high", scope: "verification" },
        ],
        recommendedAction: { kind: "retry_execution", reasonCode: "execution_failed", requiresConfirmation: true, nextOwner: "me" },
      })}
      language="zh"
      onOpenDetails={() => {}}
    />);

    expect(screen.getByText("本次执行遇到问题")).toBeTruthy();
    expect(screen.getByText("检查未通过")).toBeTruthy();
    expect(screen.getByText("pnpm test")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2 条")).toBeTruthy();
    expect(screen.getByText("本次执行未正常完成。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试 AI 工作" }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps one recommended primary action and shows its completed receipt", () => {
    const act = vi.fn();
    render(<ExecutionReviewCard
      review={review({
        state: "review_ready",
        stage: "review",
        recommendedAction: { kind: "review_result", reasonCode: "result_ready_for_review", requiresConfirmation: false, nextOwner: "me" },
      })}
      language="en"
      onOpenDetails={() => {}}
      onRecommendedAction={act}
      actionReceipt={{ message: "Verification restarted.", impact: "none", nextOwner: "system" }}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Review result" }));
    expect(act).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Action completed")).toBeTruthy();
    expect(screen.getByText(/has not changed the base branch/)).toBeTruthy();
    expect(screen.getByText("Next: System")).toBeTruthy();
  });

  it("prevents duplicate clicks while the server is still confirming the action", () => {
    const act = vi.fn();
    render(<ExecutionReviewCard
      review={review({
        state: "failed",
        needsAttention: true,
        recommendedAction: { kind: "retry_execution", reasonCode: "execution_failed", requiresConfirmation: true, nextOwner: "me" },
      })}
      language="en"
      onOpenDetails={() => {}}
      onRecommendedAction={act}
      actionReceipt={{ status: "running", messageCode: "request_accepted", impact: "none", nextOwner: "ai" }}
    />);

    const button = screen.getByRole("button", { name: "Confirming action" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(act).not.toHaveBeenCalled();
    expect(screen.getByText("The action request was accepted.")).toBeTruthy();
    expect(screen.getByText("Next: AI")).toBeTruthy();
  });

  it("honors the server action gate and explains why the primary action is unavailable", () => {
    const act = vi.fn();
    render(<ExecutionReviewCard
      review={review({
        state: "review_ready",
        stage: "review",
        recommendedAction: { kind: "review_result", reasonCode: "result_ready_for_review", requiresConfirmation: false, nextOwner: "me" },
        actionAvailability: {
          schemaVersion: 1,
          primaryActionKind: "review_result",
          locked: false,
          actions: [{
            kind: "review_result",
            visible: true,
            enabled: false,
            requiresConfirmation: true,
            nextOwner: "me",
            blockedReasonCodes: ["verification_required"],
          }],
        },
      })}
      language="en"
      onOpenDetails={() => {}}
      onRecommendedAction={act}
    />);

    const button = screen.getByRole("button", { name: "Review result" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(act).not.toHaveBeenCalled();
    expect(screen.getByTestId("execution-action-unavailable").textContent).toMatch(/reproducible verification result is still required/i);
  });

  it("renders every server-projected action and explains each blocked prerequisite", () => {
    const act = vi.fn();
    render(<ExecutionReviewCard
      review={review({
        state: "review_ready",
        stage: "review",
        recommendedAction: { kind: "review_result", reasonCode: "result_ready_for_review", requiresConfirmation: false, nextOwner: "me" },
        actionAvailability: {
          schemaVersion: 1,
          primaryActionKind: "review_result",
          locked: false,
          actions: [
            { kind: "view_changes", visible: true, enabled: true, requiresConfirmation: false, nextOwner: "me", blockedReasonCodes: [] },
            { kind: "rerun_verification", visible: true, enabled: false, requiresConfirmation: false, nextOwner: "system", blockedReasonCodes: ["worktree_unavailable"] },
            { kind: "fix_with_ai", visible: true, enabled: true, requiresConfirmation: false, nextOwner: "ai", blockedReasonCodes: [] },
            { kind: "create_pull_request", visible: true, enabled: false, requiresConfirmation: true, nextOwner: "me", blockedReasonCodes: ["review_changes_requested", "verification_failed"] },
            { kind: "review_result", visible: true, enabled: true, requiresConfirmation: false, nextOwner: "me", blockedReasonCodes: [] },
          ],
        },
      })}
      language="zh"
      onOpenDetails={() => {}}
      onAction={act}
    />);

    const actions = screen.getByTestId("execution-available-actions");
    expect(within(actions).getByRole("button", { name: "查看变更" }).hasAttribute("disabled")).toBe(false);
    expect(within(actions).getByRole("button", { name: "重新运行验证" }).hasAttribute("disabled")).toBe(true);
    expect(within(actions).getByRole("button", { name: "让 AI 修复" }).hasAttribute("disabled")).toBe(false);
    expect(within(actions).getByRole("button", { name: "创建 Pull Request" }).hasAttribute("disabled")).toBe(true);
    expect(within(actions).getByText("本次执行的隔离工作区不可用，无法安全操作变更。")).toBeTruthy();
    expect(within(actions).getByText("复核要求继续修改，完成修复后才能交付。")).toBeTruthy();
    expect(within(actions).getByText("验证未通过，请先修复问题或重新运行验证。")).toBeTruthy();

    fireEvent.click(within(actions).getByRole("button", { name: "查看变更" }));
    fireEvent.click(within(actions).getByRole("button", { name: "让 AI 修复" }));
    expect(act).toHaveBeenNthCalledWith(1, "view_changes");
    expect(act).toHaveBeenNthCalledWith(2, "fix_with_ai");
  });

  it("locks secondary mutations while an action receipt is still being confirmed", () => {
    render(<ExecutionReviewCard
      review={review({
        state: "review_ready",
        stage: "review",
        recommendedAction: { kind: "review_result", reasonCode: "result_ready_for_review", requiresConfirmation: false, nextOwner: "me" },
        actionAvailability: {
          schemaVersion: 1,
          primaryActionKind: "review_result",
          locked: false,
          actions: [
            { kind: "review_result", visible: true, enabled: true, requiresConfirmation: false, nextOwner: "me", blockedReasonCodes: [] },
            { kind: "apply_office_result", visible: true, enabled: true, requiresConfirmation: true, nextOwner: "me", blockedReasonCodes: [] },
          ],
        },
      })}
      language="en"
      onOpenDetails={() => {}}
      onAction={() => {}}
      actionReceipt={{ status: "running", messageCode: "request_accepted", impact: "none", nextOwner: "system" }}
    />);

    const officeAction = screen.getByTestId("execution-action-apply_office_result");
    expect(within(officeAction).getByRole("button", { name: "Apply office result" }).hasAttribute("disabled")).toBe(true);
    expect(within(officeAction).getByText(/previous action is still running or unconfirmed/i)).toBeTruthy();
  });

  it("keeps read-only review navigation available while the top-level lock freezes mutations", () => {
    const act = vi.fn();
    render(<ExecutionReviewCard
      review={review({
        state: "review_ready",
        stage: "review",
        recommendedAction: { kind: "review_result", reasonCode: "result_ready_for_review", requiresConfirmation: false, nextOwner: "me" },
        actionAvailability: {
          schemaVersion: 1,
          primaryActionKind: "review_result",
          locked: true,
          actions: [
            { kind: "review_result", visible: true, enabled: true, requiresConfirmation: false, nextOwner: "me", blockedReasonCodes: [] },
            { kind: "create_pull_request", visible: true, enabled: true, requiresConfirmation: true, nextOwner: "me", blockedReasonCodes: [] },
          ],
        },
      })}
      language="en"
      onOpenDetails={() => {}}
      onAction={act}
    />);

    expect(screen.getByRole("button", { name: "Review result" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Create Pull Request" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText(/previous action is still running or unconfirmed/i)).toHaveLength(1);
    expect(act).not.toHaveBeenCalled();
  });

  it("turns an uncertain result into a status check instead of a second execution", () => {
    const reconcile = vi.fn();
    const act = vi.fn();
    render(<ExecutionReviewCard
      review={review({
        state: "failed",
        needsAttention: true,
        recommendedAction: { kind: "retry_execution", reasonCode: "execution_failed", requiresConfirmation: true, nextOwner: "me" },
      })}
      language="en"
      onOpenDetails={() => {}}
      onRecommendedAction={act}
      onReconcileAction={reconcile}
      actionReceipt={{ status: "unknown", message: "The connection ended before confirmation.", impact: "unknown", nextOwner: "me" }}
    />);

    expect(screen.getByText("Action result is not confirmed")).toBeTruthy();
    expect(screen.getByText("Recheck the status before trying this action again.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recheck action status" }));
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(act).not.toHaveBeenCalled();
  });

  it("restores the recommended action after the server proves a retry is safe", () => {
    const act = vi.fn();
    render(<ExecutionReviewCard
      review={review({
        state: "failed",
        needsAttention: true,
        recommendedAction: { kind: "retry_execution", reasonCode: "execution_failed", requiresConfirmation: true, nextOwner: "me" },
      })}
      language="en"
      onOpenDetails={() => {}}
      onRecommendedAction={act}
      actionReceipt={{ status: "safe_to_retry", messageCode: "safe_to_retry", impact: "none", nextOwner: "me" }}
    />);

    expect(screen.getByText("Safe to retry")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry AI work" }));
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("keeps earlier attempts collapsed and compares their verification evidence on demand", () => {
    render(<ExecutionReviewCard
      review={review()}
      language="en"
      onOpenDetails={() => {}}
      attemptHistory={[
        { invocationId: "inv_1", autoRunId: "aur_1", attempt: 1, status: "failed", createdAt: null, startedAt: null, completedAt: null, errorCode: "test_failed", summary: "The first attempt stopped.", verification: { status: "failed", command: "pnpm test", summary: "One test failed." }, current: false },
        { invocationId: "inv_2", autoRunId: "aur_1", attempt: 2, status: "running", createdAt: null, startedAt: null, completedAt: null, errorCode: null, summary: "Fixing the failed check.", verification: null, current: true },
      ]}
    />);

    const history = screen.getByTestId("execution-attempt-history");
    expect(within(history).getByText("View 2 recent attempt(s)")).toBeTruthy();
    fireEvent.click(within(history).getByText("View 2 recent attempt(s)"));
    expect(within(history).getByText("Checks failed")).toBeTruthy();
    expect(within(history).getByText("pnpm test")).toBeTruthy();
    expect(within(history).getByText("Current")).toBeTruthy();
  });
});
