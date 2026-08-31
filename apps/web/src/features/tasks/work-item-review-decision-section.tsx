import { CheckCircle2, MessageSquare, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import type { SummaryCopy } from "./work-item-summary-copy";
import type { DeliveryDecision } from "./work-item-summary-model";

export function WorkItemReviewDecisionSection({
  resultSectionId,
  language,
  copy,
  deliveryDecision,
  executionContractReady,
  executionContractDefined,
  hasDelivery,
  reviewVerdict,
  aiReviewStatus,
  acceptActionLabel,
  confirmActionEffect,
  confirmActionRisk,
  changeRequestOpen,
  feedbackMode,
  changeRequest,
  actionPending,
  executionActionLocked,
  canConfirmDelivery,
  onPrepareExecutionPlan,
  onChangeRequest,
  onCancelChangeRequest,
  onSendChangeRequest,
  onStopDelivery,
  onOpenFollowUp,
  onOpenRevision,
  onAccept,
}: {
  resultSectionId: string;
  language: "zh" | "en";
  copy: SummaryCopy;
  deliveryDecision: DeliveryDecision;
  executionContractReady: boolean;
  executionContractDefined: boolean;
  hasDelivery: boolean;
  reviewVerdict: "approved" | "changes_requested" | null;
  aiReviewStatus: string | null;
  acceptActionLabel: string;
  confirmActionEffect: string;
  confirmActionRisk: string;
  changeRequestOpen: boolean;
  feedbackMode: "follow_up" | "revision";
  changeRequest: string;
  actionPending: string | null;
  executionActionLocked: boolean;
  canConfirmDelivery: boolean;
  onPrepareExecutionPlan: () => void;
  onChangeRequest: (value: string) => void;
  onCancelChangeRequest: () => void;
  onSendChangeRequest: () => void;
  onStopDelivery: () => void;
  onOpenFollowUp: () => void;
  onOpenRevision: () => void;
  onAccept: () => void;
}) {
  const pending = Boolean(actionPending);
  return (
    <section className="rounded-xl border border-primary/35 bg-primary/[0.045] p-4" aria-labelledby={`${resultSectionId}-decision-title`}>
      <h4 id={`${resultSectionId}-decision-title`} className="text-sm font-semibold">{copy.reviewDecisionTitle}</h4>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{copy.reviewDecisionHint}</p>
      {!executionContractReady ? (
        <div className="mt-3 rounded-lg border border-warning/40 bg-warning/[0.08] px-3 py-2.5 text-sm" role="alert">
          <p className="font-semibold">{language === "zh" ? "本次结果缺少事先确认的完成要求，暂不能确认通过" : "This result has no pre-confirmed completion requirements and cannot be approved"}</p>
          <p className="mt-1 leading-relaxed text-muted-foreground">{executionContractDefined ? language === "zh" ? "完成标准和检查步骤是在这次结果产生后才建立的，因此只能用于下一轮执行。请让 AI 重新执行；新结果才可按这份要求确认。" : "The criteria and SOP were established after this result, so they apply only to the next run. Rerun the task; only the new result can be reviewed against this plan." : language === "zh" ? "完成标准和检查步骤必须在 AI 开始前确定。本次历史运行缺少完整要求，请先补全并重新执行；系统不会在确认结果时倒推标准。" : "Acceptance criteria and the SOP must be confirmed before AI starts. This historical run has no complete execution contract; establish the plan and rerun. The system will not infer criteria during review."}</p>
          {!executionContractDefined ? <Button className="mt-2" size="sm" variant="secondary" disabled={pending} onClick={onPrepareExecutionPlan}>{language === "zh" ? "建立重新执行方案" : "Prepare rerun plan"}</Button> : null}
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className={`rounded-lg border p-3 ${deliveryDecision.state !== "ready" ? "border-primary/40 bg-primary/[0.05]" : "border-border bg-background/70"}`}><div className="flex flex-wrap items-center gap-2"><RefreshCw className="size-4 text-primary" aria-hidden /><p className="text-sm font-semibold">{copy.requestChanges}</p>{deliveryDecision.state !== "ready" ? <Badge tone="running">{language === "zh" ? "建议" : "Recommended"}</Badge> : null}</div><p className="mt-2 text-xs font-medium text-muted-foreground">{copy.actionEffect}</p><p className="mt-1 text-sm leading-relaxed">{deliveryDecision.revisionEffect}</p><p className="mt-2 text-xs font-medium text-muted-foreground">{copy.actionRisk}</p><p className="mt-1 text-sm leading-relaxed">{deliveryDecision.revisionRisk}</p></div>
        <div className={`rounded-lg border p-3 ${deliveryDecision.state === "ready" ? "border-success/40 bg-success/[0.05]" : "border-border bg-background/70"}`}><div className="flex flex-wrap items-center gap-2"><CheckCircle2 className="size-4 text-success" aria-hidden /><p className="text-sm font-semibold">{acceptActionLabel}</p>{deliveryDecision.state === "ready" ? <Badge tone="success">{language === "zh" ? "建议" : "Recommended"}</Badge> : null}</div><p className="mt-2 text-xs font-medium text-muted-foreground">{copy.actionEffect}</p><p className="mt-1 text-sm leading-relaxed">{confirmActionEffect}</p><p className="mt-2 text-xs font-medium text-muted-foreground">{copy.actionRisk}</p><p className="mt-1 text-sm leading-relaxed">{confirmActionRisk}</p></div>
      </div>
      {hasDelivery && reviewVerdict !== "approved" ? <p className="mt-3 rounded-lg bg-warning/[0.08] px-3 py-2 text-sm text-foreground" role="status">{aiReviewStatus === "queued" || aiReviewStatus === "running" ? copy.aiReviewPending : reviewVerdict === "changes_requested" ? copy.aiReviewChanges : ["failed", "unavailable"].includes(aiReviewStatus ?? "") ? copy.aiReviewUnavailable : copy.deliveryReviewRequired}</p> : null}
      {changeRequestOpen ? (
        <div className="mt-3 rounded-lg border border-border bg-background p-3"><p className="mb-2 text-sm font-semibold">{feedbackMode === "follow_up" ? language === "zh" ? "继续追问 AI" : "Ask AI a follow-up" : copy.requestChanges}</p><Textarea rows={3} autoFocus value={changeRequest} placeholder={feedbackMode === "follow_up" ? language === "zh" ? "例如：第二个结论依据是什么？请补充原文证据。" : "For example: What supports the second conclusion? Add source evidence." : copy.changePlaceholder} onChange={(event) => onChangeRequest(event.target.value)} /><div className="mt-2 flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={pending} onClick={onCancelChangeRequest}>{language === "zh" ? "取消" : "Cancel"}</Button><Button disabled={!changeRequest.trim() || pending || executionActionLocked} onClick={onSendChangeRequest}>{actionPending === "changes" ? copy.sendingChanges : feedbackMode === "follow_up" ? language === "zh" ? "提交追问" : "Send follow-up" : copy.sendChanges}</Button></div></div>
      ) : (
        <div className="mt-4 grid gap-2 sm:flex sm:justify-end"><Button variant="ghost" disabled={pending} onClick={onStopDelivery}>{language === "zh" ? "停止交付" : "Stop delivery"}</Button><Button variant="secondary" disabled={pending} onClick={onOpenFollowUp}><MessageSquare aria-hidden />{language === "zh" ? "继续追问" : "Ask follow-up"}</Button><Button variant="secondary" disabled={pending} onClick={onOpenRevision}>{copy.requestChanges}</Button><Button disabled={!executionContractReady || pending || !canConfirmDelivery || (hasDelivery && reviewVerdict !== "approved")} onClick={onAccept}><CheckCircle2 aria-hidden />{acceptActionLabel}</Button></div>
      )}
    </section>
  );
}
