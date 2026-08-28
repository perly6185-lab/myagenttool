import { AlertTriangle, CheckCircle2, Circle, Clock3, ExternalLink, LoaderCircle, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LocalWorkItemObservability, WorkItemExecutionReview } from "./task-view-types";

const STAGE_COPY = {
  accepted: ["已接单", "Accepted"],
  preparing: ["准备执行", "Preparing"],
  working: ["处理任务", "Working"],
  verifying: ["验证结果", "Verifying"],
  review: ["等待复核", "Review"],
} as const;

const STATE_COPY: Record<WorkItemExecutionReview["state"], { title: [string, string]; description: [string, string] }> = {
  queued: { title: ["AI 已接单", "AI accepted the task"], description: ["任务已经进入执行队列。", "The task is in the execution queue."] },
  preparing: { title: ["AI 正在准备执行", "AI is preparing"], description: ["正在理解任务、确认范围并准备安全的执行环境。", "AI is confirming the scope and preparing a safe execution environment."] },
  working: { title: ["AI 正在处理任务", "AI is working on the task"], description: ["处理仍在隔离环境中进行，完成后会自动进入验证。", "Work is still isolated and will move to verification when ready."] },
  waiting: { title: ["执行正在等待处理", "Execution needs attention"], description: ["执行已经暂停推进，需要完成当前提示后才能继续。", "Execution is paused until the current request is resolved."] },
  verifying: { title: ["AI 正在验证结果", "AI is verifying the result"], description: ["主要处理已经完成，系统正在运行本次任务约定的检查。", "The main work is complete and the agreed checks are running."] },
  review_ready: { title: ["结果已准备好复核", "The result is ready for review"], description: ["处理和检查已经结束，请结合证据决定通过或要求修改。", "Work and checks are finished. Review the evidence before approving or requesting changes."] },
  completed: { title: ["任务已经完成", "The task is complete"], description: ["结果已经确认交付，执行与验证记录仍保留在当前任务中。", "The result was confirmed, and its execution and verification records remain here."] },
  failed: { title: ["本次执行遇到问题", "This execution encountered a problem"], description: ["系统已停止继续推进，请查看原因和验证证据后决定重试或修复。", "Progress stopped. Review the reason and evidence before retrying or fixing it."] },
  cancelled: { title: ["本次执行已停止", "This execution was stopped"], description: ["任务和已有记录仍然保留，尚未完成的步骤不会继续。", "The task and existing records remain, but unfinished steps will not continue."] },
};

const VERIFICATION_COPY = {
  pending: ["尚未开始验证", "Verification has not started"],
  running: ["正在运行检查", "Checks are running"],
  passed: ["检查已通过", "Checks passed"],
  failed: ["检查未通过", "Checks failed"],
  not_configured: ["没有可复现的自动检查", "No reproducible automated check"],
  unavailable: ["验证服务暂时不可用", "Verification is temporarily unavailable"],
} as const;

const IMPACT_COPY = {
  none: ["尚未应用到主分支、业务台账或外部系统。", "Nothing has been applied to the base branch, business records, or external systems."],
  prepared: ["结果已经准备好，但仍在等待你的确认。", "The result is prepared but still awaits your confirmation."],
  proposed: ["已经创建变更提案或 Pull Request，但尚未合并生效。", "A change proposal or pull request exists but has not been merged."],
  applied: ["结果已经确认并应用。", "The result was confirmed and applied."],
  partial: ["只有部分办公批次生效，失败项需要单独处理。", "Only part of the office batch was applied; failed items need attention."],
  rolled_back: ["本次办公变更已经回滚。", "This office change was rolled back."],
  unknown: ["系统没有取得足够证据判断是否产生外部影响。", "There is not enough evidence to determine external impact."],
} as const;

const CHECK_KIND_COPY: Record<string, [string, string]> = {
  test: ["自动化测试", "Automated test"],
  build: ["构建检查", "Build check"],
  lint: ["代码规范检查", "Code quality check"],
  typecheck: ["类型检查", "Type check"],
  asset: ["结果文件检查", "Result file check"],
  artifact: ["交付物检查", "Deliverable check"],
  run: ["执行结果检查", "Execution result check"],
};

const RISK_REASON_COPY: Record<WorkItemExecutionReview["riskReasons"][number]["code"], [string, string]> = {
  execution_failed: ["本次执行未正常完成。", "This run did not complete normally."],
  user_input_required: ["AI 需要你的回答才能继续。", "AI needs your answer before it can continue."],
  approval_required: ["下一步需要人工审批。", "The next step requires human approval."],
  verification_failed: ["检查发现了需要处理的问题。", "The checks found an issue that needs attention."],
  verification_not_configured: ["当前没有可复现的自动检查。", "No reproducible automated check is configured."],
  verification_unavailable: ["验证服务暂时不可用。", "The verification service is temporarily unavailable."],
  external_impact_unknown: ["系统无法确认是否影响了外部数据。", "The system cannot confirm whether external data was affected."],
  office_batch_partial: ["办公批次只有部分内容成功。", "Only part of the office batch succeeded."],
  office_batch_rolled_back: ["办公批次已回滚，需要核对恢复结果。", "The office batch was rolled back and its recovery needs review."],
  pull_request_not_applied: ["Pull Request 尚未合并生效。", "The pull request has not been merged or applied."],
};

const ACTION_COPY: Record<WorkItemExecutionReview["recommendedAction"]["kind"], [string, string]> = {
  open_details: ["查看完整过程", "Full execution details"],
  answer_ai: ["回答 AI", "Answer AI"],
  review_approval: ["处理审批", "Review approval"],
  retry_execution: ["重试 AI 工作", "Retry AI work"],
  fix_with_ai: ["让 AI 修复", "Ask AI to fix"],
  rerun_verification: ["重新运行验证", "Rerun verification"],
  review_result: ["复核结果", "Review result"],
  view_result: ["查看结果", "View result"],
};

const NEXT_OWNER_COPY = {
  ai: ["下一步由 AI 处理", "Next: AI"],
  me: ["下一步需要你处理", "Next: You"],
  system: ["下一步由系统处理", "Next: System"],
  none: ["当前无需继续操作", "No further action is required"],
} as const;

const ACTION_RECEIPT_COPY: Record<string, [string, string]> = {
  request_accepted: ["操作请求已被系统接收。", "The action request was accepted."],
  retry_started: ["AI 已重新开始处理。", "AI work restarted."],
  ai_fix_started: ["修改要求已交给 AI。", "The requested fix was sent to AI."],
  retry_start_failed: ["AI 未能重新开始处理。", "AI work could not be restarted."],
  retry_prepare_failed: ["重试未能完成执行前准备。", "The retry could not finish preparing."],
  retry_superseded: ["任务已被其他操作推进，本次没有重复执行。", "Another action advanced the task, so this retry was not started."],
  verification_running: ["系统正在重新运行验证。", "The system is rerunning verification."],
  verification_passed: ["重新验证已经通过。", "The rerun verification passed."],
  verification_failed: ["重新验证已完成，但检查仍未通过。", "The rerun finished, but checks still failed."],
  verification_unavailable: ["验证服务暂时无法完成本次检查。", "The verification service could not complete this check."],
  verification_not_configured: ["当前没有可复现的验证命令。", "No reproducible verification command is configured."],
  verification_completed: ["重新验证请求已经完成。", "The reverification request completed."],
  answer_processing: ["系统正在确认并处理你的回答。", "The system is confirming and processing your answer."],
  answer_recorded: ["你的回答已经记录。", "Your answer was recorded."],
  answer_resumed: ["你的回答已交给 AI，任务继续处理。", "Your answer was sent to AI and the task resumed."],
  answer_needs_more_input: ["AI 已处理回答，但仍需要你确认一个问题。", "AI processed the answer but still needs another decision."],
  answer_cancelled: ["回答提交期间任务状态发生变化。", "The task changed while the answer was being submitted."],
  answer_resume_failed: ["回答已收到，但 AI 未能继续执行。", "The answer was received, but AI could not resume."],
  stale_state: ["任务已经发生变化，本次操作没有执行。", "The task changed, so this action was not performed."],
  safe_to_retry: ["系统已确认本次操作没有启动新的执行，可以安全重试。", "The system confirmed that this action did not start another run and can be retried safely."],
  action_result_unknown: ["系统仍无法确认本次操作是否产生了执行结果。", "The system still cannot confirm whether this action produced a result."],
};

export type ExecutionActionReceipt = {
  id?: string;
  message?: string;
  messageCode?: string | null;
  status?: "accepted" | "running" | "succeeded" | "failed" | "safe_to_retry" | "unknown";
  errorMessage?: string | null;
  impact: "none" | "proposed" | "applied" | "unknown";
  nextOwner: "ai" | "me" | "system" | "none";
  updatedAt?: string | null;
};

function readableCheckKind(kind: string, index: 0 | 1) {
  return CHECK_KIND_COPY[kind]?.[index] ?? kind.replaceAll("_", " ");
}

function attemptStatus(status: string, index: 0 | 1): { label: string; tone: "neutral" | "running" | "success" | "danger" } {
  if (["succeeded", "done", "pr_open", "report_posted"].includes(status)) return { label: ["已完成", "Completed"][index], tone: "success" };
  if (["failed", "blocked", "timed_out", "rejected", "expired"].includes(status)) return { label: ["未完成", "Failed"][index], tone: "danger" };
  if (status === "cancelled") return { label: ["已停止", "Stopped"][index], tone: "neutral" };
  if (["queued", "dispatching", "running", "verifying"].includes(status)) return { label: ["处理中", "In progress"][index], tone: "running" };
  return { label: status.replaceAll("_", " "), tone: "neutral" };
}

function statusTone(review: WorkItemExecutionReview) {
  if (["failed"].includes(review.state) || review.verification.status === "failed" || review.impact.status === "partial") return "danger" as const;
  if (["waiting"].includes(review.state) || ["not_configured", "unavailable"].includes(review.verification.status)) return "warning" as const;
  if (["review_ready", "completed"].includes(review.state)) return "success" as const;
  return "running" as const;
}

export function ExecutionReviewCard({
  review,
  language,
  agentName,
  onOpenDetails,
  onRecommendedAction,
  onReconcileAction,
  recommendedActionPending = false,
  reconcileActionPending = false,
  actionReceipt = null,
  attemptHistory = [],
}: {
  review: WorkItemExecutionReview;
  language: "zh" | "en";
  agentName?: string | null;
  onOpenDetails: () => void;
  onRecommendedAction?: () => void;
  onReconcileAction?: () => void;
  recommendedActionPending?: boolean;
  reconcileActionPending?: boolean;
  actionReceipt?: ExecutionActionReceipt | null;
  attemptHistory?: NonNullable<LocalWorkItemObservability["runHistory"]>;
}) {
  const index = language === "zh" ? 0 : 1;
  const copy = STATE_COPY[review.state];
  const tone = statusTone(review);
  const verificationTone = review.verification.status === "passed" ? "success"
    : review.verification.status === "failed" ? "danger"
      : review.verification.status === "running" ? "running" : "warning";
  const updatedAt = review.updatedAt
    ? new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(review.updatedAt))
    : null;
  const HeaderIcon = review.state === "failed" ? AlertTriangle
    : ["review_ready", "completed"].includes(review.state) ? CheckCircle2
      : review.state === "waiting" ? Clock3 : LoaderCircle;
  const recommendedActionHandler = onRecommendedAction
    ?? (review.recommendedAction.kind === "open_details" ? onOpenDetails : undefined);
  const receiptStatus = actionReceipt?.status ?? (actionReceipt ? "succeeded" : null);
  const receiptPending = receiptStatus === "accepted" || receiptStatus === "running";
  const receiptUnknown = receiptStatus === "unknown";
  const receiptSafeToRetry = receiptStatus === "safe_to_retry";
  const projectedRecommendedAction = review.actionAvailability?.actions.find(
    (candidate) => candidate.kind === review.recommendedAction.kind,
  ) ?? null;
  const effectiveActionHandler = receiptUnknown ? onReconcileAction : recommendedActionHandler;
  const effectiveActionDisabled = receiptPending
    || (!receiptUnknown && projectedRecommendedAction?.enabled === false)
    || !effectiveActionHandler
    || recommendedActionPending
    || reconcileActionPending;
  const actionLabel = receiptUnknown
    ? reconcileActionPending
      ? language === "zh" ? "正在重新检查" : "Checking again"
      : language === "zh" ? "重新检查操作状态" : "Recheck action status"
    : receiptPending
      ? language === "zh" ? "正在确认操作" : "Confirming action"
      : ACTION_COPY[review.recommendedAction.kind][index];
  return (
    <section className="rounded-xl border border-primary/25 bg-primary/[0.04] p-4" aria-label={language === "zh" ? "执行进度与复核证据" : "Execution progress and review evidence"} data-testid="execution-review-card">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <HeaderIcon className={!review.needsAttention && !["review_ready", "completed"].includes(review.state) ? "size-4 animate-spin" : "size-4"} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{copy.title[index]}</h3>
            <Badge tone={tone}>{STAGE_COPY[review.stage][index]}</Badge>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{copy.description[index]}</p>
          <div className="mt-3 grid grid-cols-3 gap-1 sm:grid-cols-5" aria-label={language === "zh" ? "执行步骤" : "Execution stages"}>
            {review.stages.map((stage) => {
              const StageIcon = stage.status === "complete" ? CheckCircle2 : stage.status === "current" ? LoaderCircle : stage.status === "attention" ? AlertTriangle : Circle;
              return (
                <div key={stage.key} className={`rounded-md px-1.5 py-2 text-center ${["current", "attention"].includes(stage.status) ? "bg-primary/10" : "bg-background/60"}`}>
                  <StageIcon className={`mx-auto size-3.5 ${stage.status === "complete" ? "text-success" : stage.status === "attention" ? "text-warning" : stage.status === "current" ? "animate-spin text-primary" : "text-muted-foreground/50"}`} aria-hidden />
                  <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{STAGE_COPY[stage.key][index]}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-primary/20 bg-background/70 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between" data-testid="execution-next-action">
            <span className="text-xs font-medium">{NEXT_OWNER_COPY[actionReceipt?.nextOwner ?? review.recommendedAction.nextOwner][index]}</span>
            <div className="flex flex-wrap gap-2">
              {review.recommendedAction.kind !== "open_details" ? <Button size="sm" variant="ghost" onClick={onOpenDetails}>{language === "zh" ? "查看完整过程" : "Full execution details"}</Button> : null}
              <Button size="sm" disabled={effectiveActionDisabled} onClick={effectiveActionHandler}>
                {recommendedActionPending || reconcileActionPending || receiptPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                {actionLabel}
              </Button>
            </div>
          </div>
          {!receiptUnknown && projectedRecommendedAction?.enabled === false ? (
            <p className="mt-1.5 text-xs text-muted-foreground" data-testid="execution-action-unavailable">
              {language === "zh" ? "当前证据或任务状态尚不满足此操作，请先处理上方风险并刷新状态。" : "The current evidence or task state does not allow this action yet. Resolve the risks above and refresh the task."}
            </p>
          ) : null}
          {actionReceipt ? (
            <div className={`mt-3 rounded-lg border px-3 py-2.5 ${receiptStatus === "failed" || receiptUnknown ? "border-destructive/30 bg-destructive/[0.045]" : receiptPending ? "border-primary/30 bg-primary/[0.05]" : "border-success/30 bg-success/[0.06]"}`} role="status" data-testid="execution-action-receipt">
              <div className="flex items-center gap-2 text-xs font-medium">
                {receiptStatus === "failed" || receiptUnknown
                  ? <AlertTriangle className="size-4 text-destructive" aria-hidden />
                  : receiptPending ? <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden /> : <CheckCircle2 className="size-4 text-success" aria-hidden />}
                {receiptUnknown
                  ? language === "zh" ? "尚未确认操作结果" : "Action result is not confirmed"
                  : receiptSafeToRetry
                    ? language === "zh" ? "可以安全重试" : "Safe to retry"
                  : receiptStatus === "failed"
                    ? language === "zh" ? "操作未完成" : "Action did not complete"
                    : receiptPending
                      ? language === "zh" ? "正在确认操作" : "Confirming action"
                      : language === "zh" ? "操作已完成" : "Action completed"}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed">
                {actionReceipt.message
                  ?? ACTION_RECEIPT_COPY[actionReceipt.messageCode ?? ""]?.[index]
                  ?? actionReceipt.errorMessage
                  ?? (language === "zh" ? "系统已记录本次操作。" : "The system recorded this action.")}
              </p>
              {receiptUnknown ? <p className="mt-1 text-xs leading-relaxed text-destructive">{language === "zh" ? "请先重新检查状态，不要重复执行。" : "Recheck the status before trying this action again."}</p> : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {actionReceipt.impact === "none"
                  ? language === "zh" ? "本次操作尚未修改主分支、业务台账或外部系统。" : "This action has not changed the base branch, business records, or external systems."
                  : actionReceipt.impact === "proposed"
                    ? language === "zh" ? "本次操作只创建了待复核提案，尚未生效。" : "This action created a reviewable proposal that is not yet applied."
                    : actionReceipt.impact === "applied"
                      ? language === "zh" ? "本次操作已产生确认过的应用结果。" : "This action produced a confirmed applied result."
                      : language === "zh" ? "系统尚未取得足够证据判断本次操作的影响。" : "There is not enough evidence to determine this action's impact."}
              </p>
            </div>
          ) : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg bg-background/70 px-3 py-2.5" data-testid="execution-verification-evidence">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldCheck className="size-4 text-primary" aria-hidden />
                <p className="text-xs font-medium">{language === "zh" ? "验证证据" : "Verification evidence"}</p>
                <Badge tone={verificationTone}>{VERIFICATION_COPY[review.verification.status][index]}</Badge>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {review.verification.summary ?? (language === "zh" ? "验证结果产生后会显示命令、状态和证据数量。" : "Commands, status, and evidence count will appear when verification runs.")}
              </p>
              <dl className="mt-2 grid gap-1 text-xs">
                {review.verification.command ? <div className="min-w-0"><dt className="inline text-muted-foreground">{language === "zh" ? "命令：" : "Command: "}</dt><dd className="inline break-all font-mono">{review.verification.command}</dd></div> : null}
                {review.verification.exitCode != null ? <div><dt className="inline text-muted-foreground">{language === "zh" ? "退出码：" : "Exit code: "}</dt><dd className="inline font-mono">{review.verification.exitCode}</dd></div> : null}
                {review.verification.evidenceCount > 0 ? <div><dt className="inline text-muted-foreground">{language === "zh" ? "证据：" : "Evidence: "}</dt><dd className="inline">{language === "zh" ? `${review.verification.evidenceCount} 条` : `${review.verification.evidenceCount} item(s)`}</dd></div> : null}
              </dl>
              {review.verification.checks.length > 0 ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium">{language === "zh" ? `查看 ${review.verification.checks.length} 项检查` : `View ${review.verification.checks.length} check(s)`}</summary>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {review.verification.checks.map((check) => <li key={check.id}>{readableCheckKind(check.kind, index)} · {check.status === "passed" ? (language === "zh" ? "通过" : "Passed") : (language === "zh" ? "失败" : "Failed")} · {check.summary}</li>)}
                  </ul>
                </details>
              ) : null}
            </div>
            <div className="rounded-lg bg-background/70 px-3 py-2.5" data-testid="execution-impact-status">
              <div className="flex items-center gap-2">
                <ExternalLink className="size-4 text-primary" aria-hidden />
                <p className="text-xs font-medium">{language === "zh" ? "外部影响" : "External impact"}</p>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{IMPACT_COPY[review.impact.status][index]}</p>
            </div>
          </div>
          {review.riskReasons.length > 0 ? (
            <div className={`mt-3 rounded-lg border px-3 py-2.5 ${review.riskReasons.some((reason) => reason.severity === "high") ? "border-destructive/30 bg-destructive/[0.045]" : "border-warning/30 bg-warning/[0.045]"}`} data-testid="execution-risk-reasons">
              <p className="text-xs font-medium">{language === "zh" ? "为什么需要注意" : "Why this needs attention"}</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                {review.riskReasons.map((reason) => <li key={reason.code}>{RISK_REASON_COPY[reason.code][index]}</li>)}
              </ul>
            </div>
          ) : null}
          {attemptHistory.length > 0 ? (
            <details className="mt-3 rounded-lg border border-border/80 bg-background/50 px-3 py-2.5" data-testid="execution-attempt-history">
              <summary className="cursor-pointer text-xs font-medium">
                {language === "zh" ? `查看最近 ${attemptHistory.length} 次执行` : `View ${attemptHistory.length} recent attempt(s)`}
              </summary>
              <ol className="mt-2 space-y-2">
                {[...attemptHistory].reverse().slice(0, 5).map((attempt) => {
                  const status = attemptStatus(attempt.status, index);
                  return (
                    <li key={attempt.invocationId} className="rounded-md bg-background/75 px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{language === "zh" ? `第 ${attempt.attempt} 次` : `Attempt ${attempt.attempt}`}</span>
                        <Badge tone={status.tone}>{status.label}</Badge>
                        {attempt.current ? <Badge tone="running">{language === "zh" ? "当前" : "Current"}</Badge> : null}
                        {attempt.verification ? <Badge tone={attempt.verification.status === "passed" ? "success" : attempt.verification.status === "failed" ? "danger" : "neutral"}>
                          {attempt.verification.status === "passed"
                            ? language === "zh" ? "验证通过" : "Checks passed"
                            : attempt.verification.status === "failed"
                              ? language === "zh" ? "验证失败" : "Checks failed"
                              : language === "zh" ? "未运行验证" : "Checks not run"}
                        </Badge> : null}
                      </div>
                      {attempt.summary ? <p className="mt-1.5 leading-relaxed text-muted-foreground">{attempt.summary}</p> : null}
                      {attempt.verification?.summary ? <p className="mt-1 leading-relaxed text-muted-foreground">{attempt.verification.summary}</p> : null}
                      {attempt.verification?.command ? <p className="mt-1 break-all text-muted-foreground">{language === "zh" ? "命令：" : "Command: "}<span className="font-mono text-foreground">{attempt.verification.command}</span></p> : null}
                    </li>
                  );
                })}
              </ol>
            </details>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {agentName ?? review.agentName ? <span>{language === "zh" ? "处理助手：" : "Assistant: "}{agentName ?? review.agentName}</span> : null}
            {updatedAt ? <span>{language === "zh" ? "最近更新：" : "Updated: "}{updatedAt}</span> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
