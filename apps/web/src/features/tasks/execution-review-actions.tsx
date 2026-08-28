import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkItemReviewAction } from "./task-view-types";

const ACTION_COPY: Record<string, [string, string]> = {
  open_details: ["查看完整过程", "Full execution details"],
  answer_ai: ["回答 AI", "Answer AI"],
  review_approval: ["处理审批", "Review approval"],
  retry_execution: ["重试 AI 工作", "Retry AI work"],
  fix_with_ai: ["让 AI 修复", "Ask AI to fix"],
  rerun_verification: ["重新运行验证", "Rerun verification"],
  review_result: ["复核结果", "Review result"],
  view_result: ["查看结果", "View result"],
  view_changes: ["查看变更", "View changes"],
  view_batch_details: ["查看批次详情", "View batch details"],
  create_pull_request: ["创建 Pull Request", "Create Pull Request"],
  update_pull_request: ["更新 Pull Request", "Update Pull Request"],
  apply_local_changes: ["应用到本地项目", "Apply to local project"],
  apply_office_result: ["应用办公结果", "Apply office result"],
};

const BLOCKED_REASON_COPY: Record<string, [string, string]> = {
  changes_unavailable: ["当前没有可查看的变更文件。", "No changed files are available to view."],
  execution_action_in_flight_or_unknown: ["上一次操作仍在处理中，或结果尚未确认；请先重新检查状态。", "The previous action is still running or unconfirmed. Recheck its status first."],
  auto_run_required: ["这项操作只适用于由 AI 自动执行的任务。", "This action is only available for AI auto-runs."],
  target_status_not_reverifiable: ["当前执行状态不支持重新验证，请等待状态更新。", "The current run state cannot be reverified. Wait for a status update."],
  target_status_not_repairable: ["当前执行状态不能启动 AI 修复，请先刷新任务。", "The current run state cannot start an AI fix. Refresh the task first."],
  target_status_not_retryable: ["当前执行状态不允许重试。", "The current run state cannot be retried."],
  worktree_unavailable: ["本次执行的隔离工作区不可用，无法安全操作变更。", "The run worktree is unavailable, so its changes cannot be handled safely."],
  review_inconsistent: ["复核结论与证据不一致，需要先重新复核。", "The review conclusion conflicts with its evidence and must be reviewed again."],
  review_required: ["还没有形成完整的复核结论。", "A complete review conclusion is still required."],
  structured_review_required: ["缺少结构化复核证据，暂时不能交付。", "Structured review evidence is missing, so delivery is not available yet."],
  review_changes_requested: ["复核要求继续修改，完成修复后才能交付。", "The review requested changes. Finish the fix before delivery."],
  verification_failed: ["验证未通过，请先修复问题或重新运行验证。", "Verification failed. Fix the issue or rerun verification first."],
  verification_required: ["还没有取得可复现的验证结果。", "A reproducible verification result is still required."],
  office_batch_attention: ["办公批次包含失败、待处理或状态未知的项目，请先检查批次详情。", "The office batch has failed, pending, or unknown items. Review its details first."],
  office_batch_rolled_back: ["办公批次已经回滚，需要先确认恢复结果。", "The office batch was rolled back. Confirm its recovery result first."],
  office_batch_in_progress: ["办公批次仍在处理中，请等待完成。", "The office batch is still in progress. Wait for it to finish."],
  office_rollback_incomplete: ["办公批次仅部分回滚，仍有项目未恢复。", "The office batch was only partially rolled back; some items remain unrestored."],
  delivery_evidence_not_ready: ["交付证据尚未准备完整，暂时不能应用结果。", "Delivery evidence is not complete enough to apply the result."],
  input_no_longer_required: ["AI 当前已不再等待回答，请刷新任务状态。", "AI is no longer waiting for an answer. Refresh the task state."],
  approval_no_longer_pending: ["这项审批已不再等待处理，请刷新任务状态。", "This approval is no longer pending. Refresh the task state."],
};

const READ_ONLY_ACTION_KINDS = new Set(["open_details", "review_result", "view_result", "view_changes", "view_batch_details"]);

export function isReadOnlyReviewAction(kind: string) {
  return READ_ONLY_ACTION_KINDS.has(kind);
}

export function reviewActionLabel(kind: string, language: "zh" | "en") {
  const index = language === "zh" ? 0 : 1;
  return ACTION_COPY[kind]?.[index] ?? kind.replaceAll("_", " ");
}

function blockedReasonCopy(code: string, language: "zh" | "en") {
  const index = language === "zh" ? 0 : 1;
  return BLOCKED_REASON_COPY[code]?.[index]
    ?? (language === "zh" ? `当前条件不满足：${code.replaceAll("_", " ")}` : `Current prerequisite not met: ${code.replaceAll("_", " ")}`);
}

export function reviewActionBlockedReasons(action: WorkItemReviewAction | null, language: "zh" | "en", locallyLocked = false) {
  const codes = locallyLocked && !action?.blockedReasonCodes.includes("execution_action_in_flight_or_unknown")
    ? ["execution_action_in_flight_or_unknown", ...(action?.blockedReasonCodes ?? [])]
    : action?.blockedReasonCodes ?? [];
  return [...new Set(codes)].map((code) => blockedReasonCopy(code, language));
}

export function ExecutionReviewActionList({
  actions,
  primaryKind,
  language,
  mutationsLocked = false,
  pendingActionKind = null,
  onAction,
}: {
  actions: WorkItemReviewAction[];
  primaryKind: string;
  language: "zh" | "en";
  mutationsLocked?: boolean;
  pendingActionKind?: string | null;
  onAction?: (kind: string) => void;
}) {
  const secondaryActions = actions.filter((action) => action.visible && action.kind !== primaryKind);
  if (!secondaryActions.length) return null;

  return (
    <div className="mt-3 rounded-lg border border-border/80 bg-background/55 px-3 py-2.5" data-testid="execution-available-actions">
      <p className="text-xs font-medium">{language === "zh" ? "其他操作" : "Other actions"}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {secondaryActions.map((action) => {
          const pending = pendingActionKind === action.kind;
          const locked = mutationsLocked && !isReadOnlyReviewAction(action.kind);
          const disabled = !action.enabled || locked || pending || !onAction;
          const reasons = reviewActionBlockedReasons(action, language, locked);
          return (
            <div key={action.kind} className="rounded-md bg-background/75 px-2.5 py-2" data-testid={`execution-action-${action.kind}`}>
              <Button className="w-full justify-start" size="sm" variant="secondary" disabled={disabled} onClick={() => onAction?.(action.kind)}>
                {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                {reviewActionLabel(action.kind, language)}
              </Button>
              {disabled && reasons.length > 0 ? (
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted-foreground">
                  {reasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
