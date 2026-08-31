import { AlertTriangle, CheckCircle2, CircleHelp, Clock3, OctagonX, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { WorkItemCompletionAssessment, WorkItemJourney } from "./task-view-types";

const COPY = {
  pending: {
    zh: ["任务执行中", "系统正在收集结果、检查和交付回执。"],
    en: ["Task in progress", "Result, verification, and delivery receipts are still being collected."],
  },
  ready_to_complete: {
    zh: ["结果已就绪，待你确认", "目标、结果和检查证据已经闭环，确认后才会计为完成。"],
    en: ["Ready for your confirmation", "Goal, result, and verification evidence are complete. It counts as completed only after confirmation."],
  },
  completed: {
    zh: ["任务已真正完成", "任务状态和完成证据一致。"],
    en: ["Task genuinely completed", "The task lifecycle and completion evidence agree."],
  },
  needs_attention: {
    zh: ["任务尚未完成", "实际结果存在明确偏差，请处理后重新验证。"],
    en: ["Task not complete", "The actual result has confirmed deviations. Resolve them and verify again."],
  },
  unverified: {
    zh: ["暂不能确认完成", "任务虽然已经结束，但关键回执不足，因此不会计为完成。"],
    en: ["Completion cannot be confirmed", "The task ended without sufficient receipts, so it is not counted as completed."],
  },
  stopped: {
    zh: ["任务已停止", "生成内容仍保留供查看，但本次不计为成功完成。"],
    en: ["Task stopped", "Generated work remains available for review, but this run is not counted as completed."],
  },
} as const;

export function WorkItemCompletionStatus({
  assessment,
  journey,
  language,
}: {
  assessment: WorkItemCompletionAssessment;
  journey?: WorkItemJourney | null;
  language: "zh" | "en";
}) {
  const copy = COPY[assessment.status][language];
  const config = assessment.status === "completed"
    ? { Icon: CheckCircle2, tone: "success" as const, className: "border-success/30 bg-success/[0.045]" }
    : assessment.status === "needs_attention"
      ? { Icon: AlertTriangle, tone: "danger" as const, className: "border-destructive/35 bg-destructive/[0.04]" }
      : assessment.status === "unverified"
        ? { Icon: CircleHelp, tone: "warning" as const, className: "border-warning/35 bg-warning/[0.045]" }
        : assessment.status === "stopped"
          ? { Icon: OctagonX, tone: "neutral" as const, className: "border-border bg-muted/30" }
          : assessment.status === "ready_to_complete"
            ? { Icon: Square, tone: "warning" as const, className: "border-primary/30 bg-primary/[0.045]" }
            : { Icon: Clock3, tone: "neutral" as const, className: "border-border bg-background/70" };
  return (
    <section
      className={`rounded-xl border p-4 ${config.className}`}
      data-testid="work-item-completion-status"
      aria-label={language === "zh" ? "任务完成情况" : "Task completion status"}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-background/80">
          <config.Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{language === "zh" ? "完成情况" : "Completion"}</h3>
            <Badge tone={config.tone}>{copy[0]}</Badge>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{copy[1]}</p>
          {journey ? <p className="mt-2 text-xs font-medium text-foreground/80" data-testid="work-item-journey-next-action">
            {language === "zh" ? "下一步：" : "Next: "}{journeyNextAction(journey.nextAction.kind, language)}
          </p> : null}
        </div>
      </div>
    </section>
  );
}

function journeyNextAction(kind: string, language: "zh" | "en") {
  const copy: Record<string, { zh: string; en: string }> = {
    none: { zh: "无需操作，任务已经闭环", en: "No action needed; the task is complete" },
    wait: { zh: "无需操作，系统会自动继续", en: "No action needed; the system will continue" },
    review_result: { zh: "查看结果并确认", en: "Review and confirm the result" },
    open_approval: { zh: "完成审批后继续", en: "Complete the approval to continue" },
    answer_ai: { zh: "补充 AI 需要的信息", en: "Provide the information AI needs" },
    reply_in_channel: { zh: "在原会话中补充或确认", en: "Reply in the original conversation" },
    confirm_in_channel: { zh: "在原会话中确认执行", en: "Confirm execution in the original conversation" },
    retry_execution: { zh: "恢复并重试任务", en: "Recover and retry the task" },
    retry_delivery: { zh: "重新发送结果", en: "Send the result again" },
    create_repair_task: { zh: "按检查结果创建返工任务", en: "Create a repair task from the failed checks" },
    inspect_failure: { zh: "查看阻塞原因并处理", en: "Inspect and resolve the blocker" },
    start_execution: { zh: "确认并开始执行", en: "Confirm and start execution" },
  };
  return copy[kind]?.[language] ?? (language === "zh" ? "查看任务当前状态" : "Review the current task state");
}
