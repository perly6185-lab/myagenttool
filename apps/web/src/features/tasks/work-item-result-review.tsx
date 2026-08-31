import { AlertTriangle, Bot, FolderOpen, RefreshCw, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkdownBlock } from "@/components/ui/markdown-block";
import type { LocalWorkItem, LocalWorkItemAutoRun, LocalWorkItemDeliveryEvidence, LocalWorkItemObservability, WorkItemOutcomeFile } from "./task-view-types";
import { DeliveryDecisionCard } from "./work-item-delivery-decision-card";
import { DeliverableFileList } from "./work-item-deliverable-files";
import type { SummaryCopy } from "./work-item-summary-copy";
import type { DeliveryDecision, resultPresentation } from "./work-item-summary-model";

type ResultPresentation = ReturnType<typeof resultPresentation>;
type ResultOutcome = NonNullable<LocalWorkItemObservability["outcome"]>;
type OutcomeHistory = NonNullable<LocalWorkItemObservability["outcomeHistory"]>;
type DeliveryReview = NonNullable<NonNullable<LocalWorkItemObservability["delivery"]>["review"]>;
type DeliveryAiReview = NonNullable<LocalWorkItemAutoRun["deliveryReview"]>;
type ResultVerification = NonNullable<ResultOutcome["verification"]>;
type ResultCheck = { kind: string; summary: string };
type ReviewFinding = { path: string | null; body: string; line?: number; severity?: string; suggestion?: string };

export function WorkItemResultRepairCard({
  language,
  failedChecks,
  canOperate,
  pending,
  error,
  onCreateRepair,
}: {
  language: "zh" | "en";
  failedChecks: ResultCheck[];
  canOperate: boolean;
  pending: boolean;
  error: string | null;
  onCreateRepair: () => void;
}) {
  return (
    <section className="rounded-xl border border-destructive/35 bg-destructive/[0.04] p-4" aria-label={language === "zh" ? "结果检查未通过" : "Result checks failed"} data-testid="result-repair-card">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive"><AlertTriangle className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold">{language === "zh" ? "结果还不能算完成" : "This result is not complete yet"}</h4>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {language === "zh"
              ? "检查发现以下问题。你可以单独创建一个返工任务；原任务、原结果和其他任务都不会被覆盖。"
              : "The checks found the following issues. Create a separate repair task without replacing the original task, result, or other work."}
          </p>
          {failedChecks.length ? (
            <ul className="mt-3 space-y-1 text-sm">
              {failedChecks.slice(0, 5).map((check, index) => <li key={`${check.kind}-${index}`} className="flex items-start gap-2"><span aria-hidden>•</span><span>{check.summary}</span></li>)}
            </ul>
          ) : null}
          {canOperate ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={pending} onClick={onCreateRepair}>
                <Wrench aria-hidden />
                {pending ? (language === "zh" ? "正在创建…" : "Creating…") : (language === "zh" ? "按检查结果创建返工任务" : "Create repair task from checks")}
              </Button>
              <span className="text-xs text-muted-foreground">{language === "zh" ? "只创建任务，不会自动执行。" : "Creates the task without starting it."}</span>
            </div>
          ) : <p className="mt-3 text-xs text-muted-foreground">{language === "zh" ? "请让有操作权限的成员创建返工任务。" : "Ask a member with permission to create the repair task."}</p>}
          {error ? <p className="mt-2 text-sm text-destructive" role="alert">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}

export function WorkItemFailedResultFiles({
  language,
  copy,
  entries,
  openingKey,
  error,
  onOpen,
}: {
  language: "zh" | "en";
  copy: SummaryCopy;
  entries: WorkItemOutcomeFile[];
  openingKey: string | null;
  error: string | null;
  onOpen: (file: WorkItemOutcomeFile) => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-background/70 p-4" aria-label={copy.deliverableFiles}>
      <h4 className="text-sm font-semibold">{copy.deliverableFiles}</h4>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {language === "zh" ? "本次执行虽未正常结束，但已产生以下文件，可以直接查看。" : "The run did not finish normally, but these files were produced and remain available to review."}
      </p>
      <div className="mt-3"><DeliverableFileList entries={entries} copy={copy} openingKey={openingKey} error={error} onOpen={onOpen} /></div>
    </section>
  );
}

function AiReviewCard({
  language,
  copy,
  review,
  aiReview,
  findings,
  feedback,
  actionDisabled,
  onSendBack,
  compact = false,
}: {
  language: "zh" | "en";
  copy: SummaryCopy;
  review: DeliveryReview | null;
  aiReview: DeliveryAiReview | null;
  findings: ReviewFinding[];
  feedback: string;
  actionDisabled: boolean;
  onSendBack?: (feedback: string) => void;
  compact?: boolean;
}) {
  return (
    <section className={`${compact ? "" : "mt-3 "}rounded-lg border ${compact ? "p-4" : "px-3 py-3"} ${review?.verdict === "approved" ? "border-success/35 bg-success/[0.06]" : review?.verdict === "changes_requested" ? "border-destructive/35 bg-destructive/[0.05]" : compact ? "border-border bg-muted/30" : "border-warning/35 bg-warning/[0.05]"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" aria-hidden />
          <h3 className="text-sm font-semibold">{copy.aiReviewTitle}</h3>
          <Badge tone={review?.verdict === "approved" ? "success" : review?.verdict === "changes_requested" ? "danger" : "neutral"}>
            {review?.verdict === "approved" ? (language === "zh" ? "通过" : "Passed") : review?.verdict === "changes_requested" ? (language === "zh" ? "需修改" : "Changes needed") : !compact && aiReview?.status === "running" ? (language === "zh" ? "审查中" : "Reviewing") : (language === "zh" ? "等待审查" : "Pending")}
          </Badge>
        </div>
        {onSendBack && review?.verdict === "changes_requested" && feedback ? <Button size="sm" disabled={actionDisabled} onClick={() => onSendBack(feedback)}><RefreshCw aria-hidden />{copy.sendAiReviewBack}</Button> : null}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
        {review?.summary ?? aiReview?.summary ?? (compact ? copy.aiReviewPending : review?.verdict === "approved" ? copy.aiReviewApproved : review?.verdict === "changes_requested" ? copy.aiReviewChanges : ["failed", "unavailable"].includes(aiReview?.status ?? "") ? copy.aiReviewUnavailable : copy.aiReviewPending)}
      </p>
      {!compact && findings.length ? (
        <ul className="mt-3 space-y-2">
          {findings.slice(0, 8).map((finding, index) => (
            <li key={`${finding.path ?? "finding"}-${finding.line ?? 0}-${index}`} className="rounded-md bg-background/75 px-3 py-2 text-sm">
              <p className="font-medium [overflow-wrap:anywhere]">{finding.path ?? (language === "zh" ? "代码" : "Code")}{finding.line ? `:${finding.line}` : ""}{finding.severity ? <span className="ml-2 text-xs uppercase text-muted-foreground">{finding.severity}</span> : null}</p>
              <p className="mt-1 leading-relaxed text-foreground/90">{finding.body}</p>
              {finding.suggestion ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{language === "zh" ? "修复建议" : "Suggested fix"}: {finding.suggestion}</p> : null}
            </li>
          ))}
        </ul>
      ) : !compact && review?.verdict === "approved" ? <p className="mt-2 text-xs text-muted-foreground">{copy.aiReviewNoFindings}</p> : null}
    </section>
  );
}

export function WorkItemResultReview({
  item,
  language,
  copy,
  resultSectionId,
  presentation,
  outcome,
  resultSummary,
  fullResult,
  deliveryDecision,
  actionPreview,
  officeBatchResultId,
  deliveryReview,
  deliveryAiReview,
  hasDelivery,
  reviewFindings,
  reviewFeedback,
  resultVerification,
  acceptanceCriteriaCount,
  acceptancePassed,
  acceptanceNeedsReview,
  changedFileCount,
  deliveryWorktreeId,
  reviewChangesLabel,
  resultFileEntries,
  openingFileKey,
  fileError,
  outcomeHistory,
  actionDisabled,
  verificationPending,
  onOpenFullReport,
  onViewProjectedChanges,
  onRerunVerification,
  onAskAiToFix,
  onCreatePullRequest,
  onSendReviewFeedback,
  onReviewChanges,
  onOpenFile,
}: {
  item: LocalWorkItem;
  language: "zh" | "en";
  copy: SummaryCopy;
  resultSectionId: string;
  presentation: ResultPresentation;
  outcome: ResultOutcome | null;
  resultSummary: string | null;
  fullResult: string | null;
  deliveryDecision: DeliveryDecision;
  actionPreview: LocalWorkItemDeliveryEvidence["actionPreview"] | null;
  officeBatchResultId: string;
  deliveryReview: DeliveryReview | null;
  deliveryAiReview: DeliveryAiReview | null;
  hasDelivery: boolean;
  reviewFindings: ReviewFinding[];
  reviewFeedback: string;
  resultVerification: ResultVerification | null;
  acceptanceCriteriaCount: number;
  acceptancePassed: number;
  acceptanceNeedsReview: number;
  changedFileCount: number;
  deliveryWorktreeId: string | null;
  reviewChangesLabel: string;
  resultFileEntries: WorkItemOutcomeFile[];
  openingFileKey: string | null;
  fileError: string | null;
  outcomeHistory: OutcomeHistory;
  actionDisabled: boolean;
  verificationPending: boolean;
  onOpenFullReport: () => void;
  onViewProjectedChanges?: () => void;
  onRerunVerification?: () => void;
  onAskAiToFix?: () => void;
  onCreatePullRequest?: () => void;
  onSendReviewFeedback: (feedback: string) => void;
  onReviewChanges: () => void;
  onOpenFile: (file: WorkItemOutcomeFile) => void;
}) {
  return (
    <section id={resultSectionId} className="scroll-mt-4 rounded-xl border border-success/30 bg-success/[0.035] p-4" aria-labelledby={`${resultSectionId}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h4 id={`${resultSectionId}-title`} className="text-sm font-semibold">{presentation.title}</h4><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{presentation.hint}</p></div>
        <Button size="sm" variant="secondary" disabled={!fullResult} onClick={onOpenFullReport}>{copy.fullReport}</Button>
      </div>
      {outcome?.status === "missing" ? (
        <div className="mt-3 rounded-lg border border-destructive/35 bg-destructive/[0.05] px-3 py-2.5 text-sm" role="alert"><p className="font-semibold">{language === "zh" ? "结果暂时无法读取" : "The result is temporarily unavailable"}</p><p className="mt-1 text-muted-foreground">{language === "zh" ? "系统记录到 AI 已结束，但没有取得可审核的结果。请重试或查看专业详情，在结果恢复前不能确认完成。" : "AI has finished, but no reviewable result was returned. Retry or open expert details; completion stays disabled until the result is restored."}</p></div>
      ) : resultSummary ? <div className="mt-3 rounded-lg border border-primary/25 bg-background/80 px-4 py-3"><p className="text-xs font-medium text-muted-foreground">{language === "zh" ? "一句话结论" : "At a glance"}</p><p className="mt-1 text-base font-medium leading-relaxed">{resultSummary}</p></div> : null}
      {outcome?.highlights?.length ? <div className="mt-3"><p className="text-xs font-medium text-muted-foreground">{language === "zh" ? "关键结果" : "Key results"}</p><ul className="mt-1.5 grid gap-2 sm:grid-cols-2">{outcome.highlights.map((highlight) => <li key={highlight} className="rounded-lg bg-background/70 px-3 py-2 text-sm">{highlight}</li>)}</ul></div> : null}
      {outcome?.warnings?.length ? <div className="mt-3 rounded-lg border border-warning/35 bg-warning/[0.06] px-3 py-2.5"><p className="text-xs font-semibold text-warning">{language === "zh" ? "需要注意" : "Needs attention"}</p><ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">{outcome.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
      <div className="mt-3"><DeliveryDecisionCard decision={deliveryDecision} copy={copy} scopeLabel={presentation.completedScope} actionPreview={actionPreview} officeBatchResultId={officeBatchResultId} language={language} onViewChanges={onViewProjectedChanges} onRerunVerification={onRerunVerification} onAskAiToFix={onAskAiToFix} onCreatePullRequest={onCreatePullRequest} actionDisabled={actionDisabled} verificationPending={verificationPending} /></div>
      {hasDelivery ? <AiReviewCard language={language} copy={copy} review={deliveryReview} aiReview={deliveryAiReview} findings={reviewFindings} feedback={reviewFeedback} actionDisabled={actionDisabled} onSendBack={onSendReviewFeedback} /> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-background/70 px-3 py-2 text-sm"><p className="text-xs text-muted-foreground">{presentation.originalNote}</p><p className="mt-1 whitespace-pre-wrap leading-relaxed">{resultSummary || presentation.noSummary}</p></div>
        <div className="rounded-lg bg-background/70 px-3 py-2 text-sm"><p className="text-xs text-muted-foreground">{resultVerification ? copy.verificationEvidence : copy.acceptanceResult}</p><p className="mt-1">{resultVerification ? resultVerification.summary ?? (resultVerification.passed ? copy.aiReviewApproved : copy.aiReviewChanges) : acceptanceCriteriaCount || item.acceptanceResults?.length ? `${acceptancePassed} ${copy.passed} · ${Math.max(0, acceptanceNeedsReview)} ${copy.needsReview}` : copy.noAcceptanceResult}</p></div>
      </div>
      <div className="mt-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{copy.deliverableFiles}</p>{changedFileCount && deliveryWorktreeId ? <Button size="sm" variant="secondary" onClick={onReviewChanges}><FolderOpen aria-hidden />{reviewChangesLabel}</Button> : null}</div><DeliverableFileList entries={resultFileEntries} copy={copy} openingKey={openingFileKey} error={fileError} limit={8} onOpen={onOpenFile} /></div>
      {outcomeHistory.length ? <details className="mt-3 rounded-lg border border-border bg-background/60 px-3 py-2.5"><summary className="cursor-pointer text-sm font-medium">{language === "zh" ? `历史结果（${outcomeHistory.length}）` : `Previous results (${outcomeHistory.length})`}</summary><ol className="mt-2 space-y-2">{outcomeHistory.map((previous) => <li key={`${previous.invocationId ?? "result"}-${previous.version}`} className="rounded-md bg-muted/40 px-3 py-2 text-sm"><p className="text-xs font-medium text-muted-foreground">{language === "zh" ? `第 ${previous.version} 版` : `Version ${previous.version}`}{previous.supersededAt ? ` · ${new Date(previous.supersededAt).toLocaleString()}` : ""}</p><p className="mt-1 leading-relaxed">{previous.summary ?? (language === "zh" ? "该版本没有可读摘要" : "No readable summary for this version")}</p>{previous.supersededByFeedback ? <p className="mt-1 text-xs text-muted-foreground">{language === "zh" ? "修改要求" : "Requested change"}: {previous.supersededByFeedback}</p> : null}</li>)}</ol></details> : null}
    </section>
  );
}

export function WorkItemResultReportContent({
  language,
  copy,
  deliveryDecision,
  actionPreview,
  deliveryReview,
  deliveryAiReview,
  acceptActionLabel,
  confirmActionEffect,
  confirmActionRisk,
  fullResult,
  resultVerification,
  acceptanceCriteriaCount,
  acceptanceResultsCount,
  acceptancePassed,
  acceptanceNeedsReview,
  resultFileEntries,
  openingFileKey,
  fileError,
  actionDisabled,
  verificationPending,
  onViewChanges,
  onRerunVerification,
  onAskAiToFix,
  onCreatePullRequest,
  onOpenFile,
}: {
  language: "zh" | "en";
  copy: SummaryCopy;
  deliveryDecision: DeliveryDecision;
  actionPreview: LocalWorkItemDeliveryEvidence["actionPreview"] | null;
  deliveryReview: DeliveryReview | null;
  deliveryAiReview: DeliveryAiReview | null;
  acceptActionLabel: string;
  confirmActionEffect: string;
  confirmActionRisk: string;
  fullResult: string | null;
  resultVerification: ResultVerification | null;
  acceptanceCriteriaCount: number;
  acceptanceResultsCount: number;
  acceptancePassed: number;
  acceptanceNeedsReview: number;
  resultFileEntries: WorkItemOutcomeFile[];
  openingFileKey: string | null;
  fileError: string | null;
  actionDisabled: boolean;
  verificationPending: boolean;
  onViewChanges?: () => void;
  onRerunVerification?: () => void;
  onAskAiToFix?: () => void;
  onCreatePullRequest?: () => void;
  onOpenFile: (file: WorkItemOutcomeFile) => void;
}) {
  return (
    <div className="space-y-4">
      <DeliveryDecisionCard decision={deliveryDecision} copy={copy} actionPreview={actionPreview} language={language} onViewChanges={onViewChanges} onRerunVerification={onRerunVerification} onAskAiToFix={onAskAiToFix} onCreatePullRequest={onCreatePullRequest} actionDisabled={actionDisabled} verificationPending={verificationPending} />
      <details className="rounded-lg border border-primary/25 bg-primary/[0.035] p-4">
        <summary className="cursor-pointer text-sm font-semibold">{language === "zh" ? "查看动作影响" : "Available actions and impact"}</summary>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-md bg-background/75 px-3 py-2.5"><p className="text-sm font-semibold">{copy.requestChanges}</p><p className="mt-2 text-xs font-medium text-muted-foreground">{copy.actionEffect}</p><p className="mt-1 text-sm leading-relaxed">{deliveryDecision.revisionEffect}</p><p className="mt-2 text-xs font-medium text-muted-foreground">{copy.actionRisk}</p><p className="mt-1 text-sm leading-relaxed">{deliveryDecision.revisionRisk}</p></div>
          <div className="rounded-md bg-background/75 px-3 py-2.5"><p className="text-sm font-semibold">{acceptActionLabel}</p><p className="mt-2 text-xs font-medium text-muted-foreground">{copy.actionEffect}</p><p className="mt-1 text-sm leading-relaxed">{confirmActionEffect}</p><p className="mt-2 text-xs font-medium text-muted-foreground">{copy.actionRisk}</p><p className="mt-1 text-sm leading-relaxed">{confirmActionRisk}</p></div>
        </div>
      </details>
      <AiReviewCard language={language} copy={copy} review={deliveryReview} aiReview={deliveryAiReview} findings={[]} feedback="" actionDisabled={actionDisabled} compact />
      <section className="rounded-lg border border-border bg-background/70 p-4"><h3 className="text-sm font-semibold">{copy.originalAiNote}</h3>{fullResult ? <MarkdownBlock text={fullResult} className="mt-2" /> : <p className="mt-2 text-sm text-muted-foreground">{copy.noDeliverableSummary}</p>}</section>
      <section className="rounded-lg border border-border bg-background/70 p-4"><h3 className="text-sm font-semibold">{resultVerification ? copy.verificationEvidence : copy.acceptanceResult}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{resultVerification?.summary ?? (resultVerification?.passed ? copy.aiReviewApproved : null) ?? (acceptanceCriteriaCount || acceptanceResultsCount ? `${acceptancePassed} ${copy.passed} · ${Math.max(0, acceptanceNeedsReview)} ${copy.needsReview}` : copy.noAcceptanceResult)}</p></section>
      <section className="rounded-lg border border-border bg-background/70 p-4"><h3 className="text-sm font-semibold">{copy.deliverableFiles}</h3><DeliverableFileList entries={resultFileEntries} copy={copy} openingKey={openingFileKey} error={fileError} onOpen={onOpenFile} /></section>
    </div>
  );
}
