import { BrainCircuit, CheckCircle2, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LocalWorkItem } from "./task-view-types";
import type { SummaryCopy } from "./work-item-summary-copy";

export type LocalDeliveryReceipt = {
  baseBranch: string | null;
  deliveredCommit: string | null;
  deliveredAt: string | null;
};

type TemplateOutcome = "met_expectations" | "wrong_result" | "needs_quality_adjustment";

export function WorkItemCompletedTaskCard({
  item,
  language,
  copy,
  receipt,
  changedFileCount,
  verificationSummary,
  resultExpanded,
  resultSectionId,
  resultSummary,
  canOperate,
  templateDraftPending,
  templateOutcomeEditing,
  templateOutcomePending,
  templateOutcomeError,
  onToggleResult,
  onCreateTaskDraft,
  onOpenTemplateDraft,
  onEditTemplateOutcome,
  onRecordTemplateOutcome,
  onOpenTaskCenter,
}: {
  item: LocalWorkItem;
  language: "zh" | "en";
  copy: SummaryCopy;
  receipt: LocalDeliveryReceipt | null;
  changedFileCount: number;
  verificationSummary: string | null;
  resultExpanded: boolean;
  resultSectionId: string;
  resultSummary: string | null;
  canOperate: boolean;
  templateDraftPending: boolean;
  templateOutcomeEditing: boolean;
  templateOutcomePending: boolean;
  templateOutcomeError: string | null;
  onToggleResult: () => void;
  onCreateTaskDraft?: (draft: string) => void;
  onOpenTemplateDraft: () => void;
  onEditTemplateOutcome: () => void;
  onRecordTemplateOutcome: (outcome: TemplateOutcome) => void;
  onOpenTaskCenter?: () => void;
}) {
  return (
    <section className="rounded-xl border border-success/35 bg-success/[0.06] p-4" aria-label={copy.completedTitle} role="status">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success/15 text-success"><CheckCircle2 className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold">{copy.completedTitle}</h4>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{copy.completedHint}</p>
          {receipt ? (
            <div className="mt-3 rounded-lg border border-success/30 bg-background/80 p-3" aria-label={language === "zh" ? "本地交付回执" : "Local delivery receipt"}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{language === "zh" ? "本地交付回执" : "Local delivery receipt"}</p>
                <Badge tone="success">{language === "zh" ? "应用成功" : "Applied successfully"}</Badge>
              </div>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div><dt className="text-muted-foreground">{language === "zh" ? "目标分支" : "Target branch"}</dt><dd className="mt-0.5 break-all font-mono text-foreground">{receipt.baseBranch ?? (language === "zh" ? "本地基准分支" : "Local base branch")}</dd></div>
                <div><dt className="text-muted-foreground">{language === "zh" ? "交付提交" : "Delivered commit"}</dt><dd className="mt-0.5 break-all font-mono text-foreground">{receipt.deliveredCommit?.slice(0, 12) ?? (language === "zh" ? "已由本地 Git 确认" : "Confirmed by local Git")}</dd></div>
                <div><dt className="text-muted-foreground">{language === "zh" ? "修改范围" : "Change scope"}</dt><dd className="mt-0.5 text-foreground">{language === "zh" ? `${changedFileCount} 个文件已应用` : `${changedFileCount} file(s) applied`}</dd></div>
                <div><dt className="text-muted-foreground">{language === "zh" ? "验证结果" : "Verification"}</dt><dd className="mt-0.5 text-foreground">{verificationSummary ?? (language === "zh" ? "审核与验证均已通过" : "Review and verification passed")}</dd></div>
              </dl>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" aria-expanded={resultExpanded} aria-controls={resultSectionId} onClick={onToggleResult}>
              {resultExpanded ? copy.hideResult : copy.action.completed}
              <ChevronDown className={`transition-transform ${resultExpanded ? "rotate-180" : ""}`} aria-hidden />
            </Button>
            {onCreateTaskDraft ? <Button size="sm" variant="secondary" onClick={() => onCreateTaskDraft([item.title, item.body?.trim()].filter(Boolean).join("\n"))}>{copy.reuseTask}</Button> : null}
            {onCreateTaskDraft ? <Button size="sm" variant="secondary" onClick={() => onCreateTaskDraft(language === "zh"
              ? `基于“${item.title}”的结果继续：${resultSummary ?? "请说明下一步目标"}`
              : `Follow up on “${item.title}”: ${resultSummary ?? "describe the next outcome"}`)}>{copy.createFollowUp}</Button> : null}
            {!item.myTemplateBinding && canOperate ? item.myTemplateDraft ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/[0.05] px-3 py-1.5 text-sm font-medium text-primary">
                <BrainCircuit className="size-4" aria-hidden />
                {language === "zh" ? "已保存，等待检查并启用" : "Saved for review and activation"}
              </span>
            ) : (
              <Button size="sm" variant="secondary" disabled={templateDraftPending} onClick={onOpenTemplateDraft}>
                <BrainCircuit aria-hidden />
                {language === "zh" ? "以后按这种方式处理" : "Use this approach next time"}
              </Button>
            ) : null}
            {onOpenTaskCenter ? <Button size="sm" variant="secondary" onClick={onOpenTaskCenter}>{copy.taskCenter}</Button> : null}
          </div>
        </div>
      </div>
      {item.myTemplateBinding && item.status === "done" ? (
        <div className="mt-4 rounded-lg border border-primary/25 bg-background/75 p-3" aria-label={language === "zh" ? "这次结果符合预期吗？" : "Did this result meet your expectations?"}>
          <h5 className="text-sm font-semibold">{language === "zh" ? "这次结果符合预期吗？" : "Did this result meet your expectations?"}</h5>
          <p className="mt-1 text-xs text-muted-foreground">
            {language === "zh" ? "只评价实际结果。电脑离线、权限或运行失败不会被算成模板问题。" : "Rate only the actual result. Offline computers, permissions, and run failures are not treated as template problems."}
          </p>
          {item.myTemplateOutcomeFeedback && !templateOutcomeEditing ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone={item.myTemplateOutcomeFeedback.outcome === "met_expectations" ? "success" : item.myTemplateOutcomeFeedback.outcome === "wrong_result" ? "danger" : "warning"}>
                {item.myTemplateOutcomeFeedback.outcome === "met_expectations"
                  ? (language === "zh" ? "符合预期" : "Met expectations")
                  : item.myTemplateOutcomeFeedback.outcome === "wrong_result"
                    ? (language === "zh" ? "结果类型不对" : "Wrong result type")
                    : (language === "zh" ? "内容需要调整" : "Content needs adjustment")}
              </Badge>
              <span className="text-xs text-muted-foreground">{language === "zh" ? "反馈已记录" : "Feedback recorded"}</span>
              <Button size="sm" variant="ghost" onClick={onEditTemplateOutcome}>{language === "zh" ? "修改反馈" : "Change feedback"}</Button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={templateOutcomePending} onClick={() => onRecordTemplateOutcome("met_expectations")}><CheckCircle2 />{language === "zh" ? "符合预期" : "Met expectations"}</Button>
              <Button size="sm" variant="secondary" disabled={templateOutcomePending} onClick={() => onRecordTemplateOutcome("wrong_result")}>{language === "zh" ? "结果类型不对" : "Wrong result type"}</Button>
              <Button size="sm" variant="secondary" disabled={templateOutcomePending} onClick={() => onRecordTemplateOutcome("needs_quality_adjustment")}>{language === "zh" ? "内容需要调整" : "Content needs adjustment"}</Button>
            </div>
          )}
          {templateOutcomeError ? <p className="mt-2 text-sm text-destructive" role="alert">{templateOutcomeError}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
