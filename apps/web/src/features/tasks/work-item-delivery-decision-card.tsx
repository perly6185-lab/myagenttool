import { AlertTriangle, CheckCircle2, ExternalLink, FolderOpen, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LocalWorkItemDeliveryEvidence } from "./task-view-types";
import type { SummaryCopy } from "./work-item-summary-copy";
import type { DeliveryDecision } from "./work-item-summary-model";

export function DeliveryDecisionCard({
  decision,
  copy,
  scopeLabel,
  actionPreview,
  officeBatchResultId,
  language,
  onViewChanges,
  onRerunVerification,
  onAskAiToFix,
  onCreatePullRequest,
  actionDisabled = false,
  verificationPending = false,
}: {
  decision: DeliveryDecision;
  copy: SummaryCopy;
  scopeLabel?: string;
  actionPreview?: LocalWorkItemDeliveryEvidence["actionPreview"] | null;
  officeBatchResultId?: string;
  language: "zh" | "en";
  onViewChanges?: () => void;
  onRerunVerification?: () => void;
  onAskAiToFix?: () => void;
  onCreatePullRequest?: () => void;
  actionDisabled?: boolean;
  verificationPending?: boolean;
}) {
  const confirmedProblem = decision.state === "changes" && decision.risk === "high";
  const tone = decision.state === "ready" ? "success" : confirmedProblem ? "danger" : decision.state === "waiting" ? "neutral" : "warning";
  const riskLabel = {
    low: copy.riskLow,
    medium: copy.riskMedium,
    high: copy.riskHigh,
    unknown: copy.riskUnknown,
  }[decision.risk];
  const showPullRequestAction = ["create_pull_request", "update_pull_request"].includes(actionPreview?.operation ?? "") && actionPreview?.canProceed && Boolean(onCreatePullRequest);
  const hasDeliveryAction = Boolean(onViewChanges || onRerunVerification || onAskAiToFix || showPullRequestAction);
  return (
    <section className={`rounded-lg border p-4 ${
      decision.state === "ready"
        ? "border-success/35 bg-success/[0.06]"
        : confirmedProblem
          ? "border-destructive/35 bg-destructive/[0.05]"
          : "border-warning/35 bg-warning/[0.05]"
    }`} aria-label={copy.decisionSummary}>
      <div className="flex flex-wrap items-center gap-2">
        {decision.state === "ready"
          ? <CheckCircle2 className="size-5 text-success" aria-hidden />
          : <AlertTriangle className={`size-5 ${confirmedProblem ? "text-destructive" : "text-warning"}`} aria-hidden />}
        <h3 className="font-semibold">{decision.headline}</h3>
        <Badge tone="neutral">{decision.domainLabel}</Badge>
        <Badge tone={tone}>{copy.resultStatus}: {decision.statusLabel}</Badge>
        <Badge tone={tone}>{copy.resultRisk}: {riskLabel}</Badge>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{decision.riskReason}</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="rounded-md bg-background/75 px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">{scopeLabel ?? copy.completedScope}</p>
          <p className="mt-1.5 text-sm leading-relaxed">{decision.scope}</p>
        </div>
        <div className="rounded-md bg-background/75 px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">{copy.checkResult}</p>
          <p className="mt-1.5 text-sm leading-relaxed">{decision.checks}</p>
        </div>
        <div className="rounded-md bg-background/75 px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">{copy.recommendedNext}</p>
          <p className="mt-1.5 text-sm font-medium leading-relaxed">{decision.recommendation}</p>
        </div>
      </div>
      {actionPreview ? (
        <div className="mt-3 rounded-md border border-border/80 bg-background/60 px-3 py-2.5" data-testid="delivery-action-preview">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium text-muted-foreground">{language === "zh" ? "应用前预览" : "Before-apply preview"}</p>
            <Badge tone={actionPreview.canProceed ? "success" : "warning"}>
              {actionPreview.canProceed ? (language === "zh" ? "满足确认条件" : "Ready for confirmation") : (language === "zh" ? "暂不能应用" : "Not ready to apply")}
            </Badge>
          </div>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            <div><dt className="inline text-muted-foreground">{language === "zh" ? "动作：" : "Action: "}</dt><dd className="inline">{actionPreview.operation === "update_pull_request" ? (language === "zh" ? "更新现有 Pull Request" : "Update existing pull request") : actionPreview.operation === "create_pull_request" ? (language === "zh" ? "创建 Pull Request" : "Create pull request") : actionPreview.operation === "apply_office_result" ? (language === "zh" ? "应用办公结果" : "Apply office result") : (language === "zh" ? "应用到本地项目" : "Apply to local project")}</dd></div>
            <div><dt className="inline text-muted-foreground">{language === "zh" ? "范围：" : "Scope: "}</dt><dd className="inline">{language === "zh" ? `${actionPreview.changedFileCount || actionPreview.officeDetails?.targetFiles.length || 0} 个文件` : `${actionPreview.changedFileCount || actionPreview.officeDetails?.targetFiles.length || 0} file(s)`}</dd></div>
            {actionPreview.branchName ? <div className="min-w-0"><dt className="inline text-muted-foreground">{language === "zh" ? "分支：" : "Branch: "}</dt><dd className="break-all font-mono">{actionPreview.branchName}</dd></div> : null}
            {actionPreview.officeDetails ? (
              <>
                {actionPreview.officeDetails.targetFiles.length ? <div className="min-w-0 sm:col-span-2"><dt className="inline text-muted-foreground">{language === "zh" ? "目标资料：" : "Target files: "}</dt><dd className="inline break-all">{actionPreview.officeDetails.targetFiles.join("、")}</dd></div> : null}
                {actionPreview.officeDetails.targetResources?.length ? <div className="min-w-0 sm:col-span-2"><dt className="inline text-muted-foreground">{language === "zh" ? "资料来源：" : "Resource source: "}</dt><dd className="inline break-all">{actionPreview.officeDetails.targetResources.map((resource) => `${resource.displayName} · ${resource.locality === "local" ? (language === "zh" ? "本地" : "Local") : (language === "zh" ? "远程" : "Remote")}`).join("；")}</dd></div> : null}
                {actionPreview.officeDetails.estimatedAffectedRows != null ? <div><dt className="inline text-muted-foreground">{language === "zh" ? "预计记录：" : "Estimated records: "}</dt><dd className="inline">{actionPreview.officeDetails.estimatedAffectedRows}</dd></div> : null}
                {actionPreview.officeDetails.fields.length ? <div className="min-w-0 sm:col-span-2"><dt className="inline text-muted-foreground">{language === "zh" ? "字段范围：" : "Fields: "}</dt><dd className="inline break-all">{actionPreview.officeDetails.fields.join("、")}</dd></div> : null}
                <div><dt className="inline text-muted-foreground">{language === "zh" ? "失败保护：" : "Failure protection: "}</dt><dd className="inline">{actionPreview.officeDetails.reversible === true ? (language === "zh" ? "系统已记录恢复依据" : "Recovery evidence recorded") : actionPreview.officeDetails.reversible === false ? (language === "zh" ? "未准备自动恢复" : "Automatic recovery not prepared") : (language === "zh" ? "待确认" : "Unknown")}</dd></div>
              </>
            ) : null}
            <div><dt className="inline text-muted-foreground">{language === "zh" ? "确认：" : "Confirmation: "}</dt><dd className="inline">{language === "zh" ? "仍需人工确认" : "Human confirmation is still required"}</dd></div>
          </dl>
          {actionPreview.officeDetails?.batch ? (
            <OfficeBatchResult id={officeBatchResultId} batch={actionPreview.officeDetails.batch} copy={copy} language={language} />
          ) : null}
        </div>
      ) : null}
      {actionPreview && hasDeliveryAction ? (
        <div className="mt-3 rounded-md border border-primary/20 bg-primary/[0.04] px-3 py-2.5" data-testid="development-actions">
          <p className="text-xs font-medium text-muted-foreground">{decision.domain === "development" ? copy.developmentActions : language === "zh" ? "可执行动作" : "Available actions"}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {onViewChanges ? <Button size="sm" variant="secondary" disabled={actionDisabled} onClick={onViewChanges}><FolderOpen aria-hidden />{copy.viewChanges}</Button> : null}
            {onRerunVerification ? <Button size="sm" variant="secondary" disabled={actionDisabled} onClick={onRerunVerification}><CheckCircle2 aria-hidden />{verificationPending ? copy.verifying : copy.rerunVerification}</Button> : null}
            {onAskAiToFix ? <Button size="sm" variant={confirmedProblem ? "primary" : "secondary"} disabled={actionDisabled} onClick={onAskAiToFix}><Wrench aria-hidden />{copy.askAiToFix}</Button> : null}
            {showPullRequestAction ? <Button size="sm" disabled={actionDisabled} onClick={onCreatePullRequest}><ExternalLink aria-hidden />{actionPreview.operation === "update_pull_request" ? (language === "zh" ? "更新 Pull Request" : "Update Pull Request") : copy.createPullRequest}</Button> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function OfficeBatchResult({ id, batch, copy, language }: {
  id?: string;
  batch: NonNullable<NonNullable<LocalWorkItemDeliveryEvidence["actionPreview"]["officeDetails"]>["batch"]>;
  copy: SummaryCopy;
  language: "zh" | "en";
}) {
  const stateLabel: Record<string, [string, string]> = {
    pending: ["待处理", "Pending"], waiting: ["等待执行", "Waiting"], committing: ["处理中", "Committing"],
    partial: ["部分完成", "Partial"], committed: ["已完成", "Committed"], rolled_back: ["已回滚", "Rolled back"],
    needs_attention: ["需要处理", "Needs attention"], invalidated: ["已失效", "Invalidated"], expired: ["已过期", "Expired"],
  };
  const rollbackLabel: Record<string, [string, string]> = {
    prepared: ["系统已准备自动恢复", "Automatic recovery prepared"], available: ["已记录恢复保障", "Recovery evidence recorded"],
    partial: ["部分回滚", "Partial"], rolled_back: ["已回滚", "Rolled back"], not_available: ["无回滚记录", "Not available"],
  };
  const state = stateLabel[batch.state]?.[language === "zh" ? 0 : 1] ?? batch.state;
  const rollback = rollbackLabel[batch.rollback.status]?.[language === "zh" ? 0 : 1] ?? batch.rollback.status;
  return (
    <div id={id} className="mt-3 scroll-mt-4 rounded-md border border-border/80 bg-background/60 px-3 py-2.5" data-testid="office-batch-result">
      <div className="flex flex-wrap items-center gap-2"><p className="text-xs font-medium text-muted-foreground">{copy.officeBatchResult}</p><Badge tone={batch.failedCount > 0 || batch.rollback.status === "partial" ? "warning" : batch.state === "committed" ? "success" : "neutral"}>{state}</Badge></div>
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        <div><dt className="inline text-muted-foreground">{copy.batchSuccess}{language === "zh" ? "：" : ": "}</dt><dd className="inline">{batch.successCount}</dd></div>
        {(batch.restoredCount ?? batch.rollback.restoredTargets) > 0 ? <div><dt className="inline text-muted-foreground">{language === "zh" ? "已恢复：" : "Restored: "}</dt><dd className="inline">{batch.restoredCount ?? batch.rollback.restoredTargets}</dd></div> : null}
        <div><dt className="inline text-muted-foreground">{copy.batchFailed}{language === "zh" ? "：" : ": "}</dt><dd className="inline">{batch.failedCount}</dd></div>
        {(batch.pendingCount ?? 0) > 0 ? <div><dt className="inline text-muted-foreground">{language === "zh" ? "待处理：" : "Pending: "}</dt><dd className="inline">{batch.pendingCount}</dd></div> : null}
        {(batch.unknownCount ?? 0) > 0 ? <div><dt className="inline text-muted-foreground">{language === "zh" ? "状态未知：" : "Unknown: "}</dt><dd className="inline">{batch.unknownCount}</dd></div> : null}
        <div><dt className="inline text-muted-foreground">{copy.batchRollback}{language === "zh" ? "：" : ": "}</dt><dd className="inline">{rollback}</dd></div>
      </dl>
      {batch.rollback.restoredTargets || batch.rollback.blockedTargets ? <p className="mt-1 text-xs text-muted-foreground">{language === "zh" ? `已恢复 ${batch.rollback.restoredTargets} 项，受阻 ${batch.rollback.blockedTargets} 项` : `${batch.rollback.restoredTargets} restored, ${batch.rollback.blockedTargets} blocked`}</p> : null}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium">{language === "zh" ? `${copy.batchDetails}（${batch.operationCount}）` : `${copy.batchDetails} (${batch.operationCount})`}</summary>
        {batch.details.length ? <ul className="mt-2 space-y-1.5">{batch.details.slice(0, 8).map((detail, index) => (
          <li key={detail.id ?? `${detail.businessKey ?? "item"}-${index}`} className="rounded bg-muted/40 px-2.5 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-medium">{detail.businessKey ?? (language === "zh" ? `第 ${detail.rowNumber ?? "?"} 行` : `Row ${detail.rowNumber ?? "?"}`)}</span><Badge tone={detail.state === "committed" ? "success" : ["invalidated", "expired"].includes(detail.state) ? "danger" : "neutral"}>{stateLabel[detail.state]?.[language === "zh" ? 0 : 1] ?? detail.state}</Badge></div>
            {detail.changedFields.length ? <p className="mt-1 text-muted-foreground">{language === "zh" ? "字段：" : "Fields: "}{detail.changedFields.join("、")}</p> : null}
          </li>
        ))}</ul> : <p className="mt-2 text-xs text-muted-foreground">{copy.batchNoDetails}</p>}
      </details>
    </div>
  );
}
