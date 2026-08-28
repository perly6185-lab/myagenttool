import { AlertTriangle, CheckCircle2, CircleHelp, Clock3, FileCheck2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import type { WorkItemPlanActual } from "./task-view-types";

const CHECK_LABELS: Record<WorkItemPlanActual["checks"][number]["key"], [string, string]> = {
  method: ["处理方式", "Method"],
  materials: ["使用资料", "Materials"],
  output: ["实际结果", "Result"],
  action: ["操作范围", "Action scope"],
  delivery: ["交付位置", "Delivery"],
  verification: ["检查结果", "Verification"],
};

const REASON_COPY: Record<string, [string, string]> = {
  execution_method_frozen: ["与启动前确认的处理方式一致", "Matches the method confirmed before execution"],
  execution_method_changed: ["实际执行方式与确认方式不一致", "The execution method differs from the confirmed method"],
  execution_method_not_proven: ["没有足够证据确认实际处理方式", "There is not enough evidence to confirm the method"],
  execution_method_pending: ["执行方式已确认，等待执行回执", "The method is confirmed; waiting for execution evidence"],
  no_materials_planned: ["本次没有指定资料", "No materials were selected for this run"],
  planned_materials_materialized: ["确认的资料已按冻结版本加载", "The confirmed material versions were loaded"],
  material_snapshot_changed: ["执行时的资料版本与确认版本不同", "Material versions at execution differ from the confirmed versions"],
  planned_material_not_available: ["有确认过的资料未能加载", "Some confirmed materials could not be loaded"],
  material_use_not_proven: ["缺少资料加载回执，无法确认实际使用范围", "Material loading receipts are missing"],
  materials_not_materialized_yet: ["资料尚未加载完成", "Materials have not finished loading"],
  reviewable_result_available: ["已得到可查看的结果", "A reviewable result is available"],
  reviewable_result_missing: ["执行结束，但没有可查看的结果", "The run ended without a reviewable result"],
  output_format_mismatch: ["结果格式与启动前确认的不一致", "The result format differs from the confirmed format"],
  result_not_ready: ["结果仍在生成", "The result is still being produced"],
  read_only_boundary_preserved: ["只读边界已保留，没有外部写入回执", "The read-only boundary was preserved"],
  read_only_scope_was_written: ["任务确认只读，但检测到外部写入", "The task was read-only, but an external write was recorded"],
  planned_write_has_receipt: ["修改保持在确认范围内，并已有操作回执", "The planned change has an action receipt"],
  planned_write_partially_applied: ["计划中的修改只完成了一部分", "The planned change was only partially applied"],
  planned_write_rolled_back: ["计划中的修改已回滚，没有保留为最终结果", "The planned change was rolled back and is not part of the final result"],
  write_impact_not_proven: ["缺少写入影响回执", "The write impact is not proven"],
  write_not_prepared_yet: ["修改尚未准备完成", "The change is not ready yet"],
  action_scope_not_proven: ["无法确认是否发生了外部修改", "External impact cannot be confirmed"],
  action_scope_pending: ["正在收集操作范围回执", "Collecting action-scope evidence"],
  result_available_in_task: ["结果已保留在当前任务中", "The result is available in this task"],
  task_delivery_not_proven: ["无法确认结果已保存到任务", "Delivery to the task cannot be confirmed"],
  task_delivery_pending: ["结果尚未保存到任务", "Delivery to the task is pending"],
  channel_delivery_confirmed: ["Channel 已确认收到结果", "The Channel confirmed delivery"],
  channel_delivery_failed: ["结果未能发送到约定的 Channel", "Delivery to the selected Channel failed"],
  channel_delivery_pending: ["正在等待 Channel 送达回执", "Waiting for the Channel delivery receipt"],
  channel_delivery_not_proven: ["缺少 Channel 送达回执", "The Channel delivery receipt is missing"],
  verification_passed: ["检查已通过，并记录了命令结果", "Verification passed with recorded command evidence"],
  verification_failed: ["检查未通过", "Verification failed"],
  verification_pending: ["检查尚未完成", "Verification is not complete"],
  verification_not_proven: ["执行结束，但检查证据不足", "The run ended without sufficient verification evidence"],
};

function methodLabel(plan: WorkItemPlanActual, language: "zh" | "en") {
  const method = plan.planned.method;
  if (!method || method.kind === "custom") return language === "zh" ? "本任务方案" : "Task-specific approach";
  return [method.name, method.version ? `v${method.version}` : null].filter(Boolean).join(" · ");
}

function checkDetail(plan: WorkItemPlanActual, key: WorkItemPlanActual["checks"][number]["key"], language: "zh" | "en") {
  if (key === "method") return methodLabel(plan, language);
  if (key === "materials") {
    const names = plan.planned.materialNames.slice(0, 2).join(language === "zh" ? "、" : ", ");
    const count = language === "zh"
      ? `${plan.actual.materializedCount}/${plan.planned.materialCount} 项已加载`
      : `${plan.actual.materializedCount}/${plan.planned.materialCount} loaded`;
    return names ? `${count} · ${names}${plan.planned.materialNames.length > 2 ? "…" : ""}` : count;
  }
  if (key === "output") {
    if (plan.actual.resultFiles.length) return plan.actual.resultFiles.slice(0, 3).join(", ");
    return plan.planned.expectedOutput ?? (language === "zh" ? "可查看的任务结果" : "Reviewable task result");
  }
  if (key === "action") {
    const scope = plan.planned.actionAccessMode === "read_only"
      ? (language === "zh" ? "计划：只读" : "Planned: read-only")
      : plan.planned.actionAccessMode === "write" ? (language === "zh" ? "计划：允许修改" : "Planned: changes allowed")
        : (language === "zh" ? "计划：范围未明确" : "Planned scope: unknown");
    return `${scope} · ${language === "zh" ? "实际影响" : "Actual impact"}: ${plan.actual.impactStatus}`;
  }
  if (key === "delivery") {
    if (plan.planned.deliveryDestination === "channel") {
      return language === "zh" ? `Channel · ${plan.actual.deliveryStatus ?? "无回执"}` : `Channel · ${plan.actual.deliveryStatus ?? "no receipt"}`;
    }
    return language === "zh" ? "当前任务" : "This task";
  }
  return plan.actual.verificationStatus;
}

function statusIcon(status: WorkItemPlanActual["checks"][number]["status"]) {
  if (status === "matched") return <CheckCircle2 className="size-4 text-success" aria-hidden />;
  if (status === "mismatch") return <AlertTriangle className="size-4 text-destructive" aria-hidden />;
  if (status === "pending") return <Clock3 className="size-4 text-primary" aria-hidden />;
  return <CircleHelp className="size-4 text-warning" aria-hidden />;
}

export function WorkItemPlanActualCard({
  plan,
  language,
  onOpenDetails,
  onSaveFeedback,
}: {
  plan: WorkItemPlanActual;
  language: "zh" | "en";
  onOpenDetails?: () => void;
  onSaveFeedback?: (input: {
    decisions: Array<{ code: string; resolution: "keep_plan" | "prefer_actual" }>;
    note: string;
  }) => Promise<void>;
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [resolutions, setResolutions] = useState<Record<string, "keep_plan" | "prefer_actual">>({});
  const index = language === "zh" ? 0 : 1;
  const unknownCount = plan.checks.filter((check) => check.status === "unknown").length;
  const statusCopy = plan.status === "matched"
    ? ["执行与计划一致", "Execution matches the plan"]
    : plan.status === "attention"
      ? ["发现明确偏差", "Confirmed deviations found"]
      : plan.status === "unverified"
        ? ["部分情况还无法确认", "Some evidence is still missing"]
        : ["正在核对计划与实际", "Reconciling plan and actuals"];
  const description = plan.status === "matched"
    ? ["实际资料范围、结果、操作边界、交付位置和检查结果均有一致回执。", "Materials, result, action scope, delivery, and verification all have matching receipts."]
    : plan.status === "attention"
      ? [`${plan.deviations.length} 项实际情况与启动前确认的内容不一致，请先检查再确认完成。`, `${plan.deviations.length} actual item(s) differ from what was confirmed before execution. Review them before completion.`]
      : plan.status === "unverified"
        ? [`有 ${unknownCount} 项缺少可靠回执。这不等于执行失败，但暂时不能判断完全一致。`, `${unknownCount} item(s) lack reliable receipts. This is not a failure, but a full match cannot be confirmed.`]
        : ["执行尚未结束，系统会持续收集资料、结果、交付和检查回执。", "The run is still active; material, result, delivery, and verification receipts are still being collected."];
  const tone = plan.status === "matched" ? "success" : plan.status === "attention" ? "danger" : plan.status === "unverified" ? "warning" : "neutral";
  const HeaderIcon = plan.status === "matched" ? FileCheck2 : plan.status === "attention" ? AlertTriangle : plan.status === "unverified" ? CircleHelp : Clock3;
  useEffect(() => {
    setFeedbackNote(plan.feedback?.note ?? "");
    setResolutions(Object.fromEntries((plan.feedback?.decisions ?? plan.deviations).map((entry) => [
      entry.code,
      "resolution" in entry ? entry.resolution : "keep_plan",
    ])));
  }, [plan.digest, plan.feedback]);
  const canPreferActual = (deviation: WorkItemPlanActual["deviations"][number]) => {
    if (deviation.correctionTarget === "verification") return false;
    if (["template", "result"].includes(deviation.correctionTarget ?? "")) return plan.actual.resultFiles.length > 0;
    if (deviation.correctionTarget === "delivery") {
      return plan.planned.deliveryDestination === "channel" && plan.actual.resultStatus === "available";
    }
    if (deviation.correctionTarget === "scope") {
      return ["prepared", "proposed", "applied", "partial", "rolled_back"].includes(plan.actual.impactStatus);
    }
    return deviation.correctionTarget === "materials";
  };
  const preferActualLabel = (deviation: WorkItemPlanActual["deviations"][number]) => {
    if (deviation.correctionTarget === "materials") return language === "zh" ? "以后使用执行时的最新版" : "Use the latest version at execution";
    if (deviation.correctionTarget === "delivery") return language === "zh" ? "以后结果留在任务中" : "Keep future results in the task";
    if (deviation.correctionTarget === "scope") return language === "zh" ? "以后允许这类修改（仍需确认）" : "Allow this kind of change (still confirm)";
    return language === "zh" ? "以后接受本次实际结果" : "Prefer this actual result next time";
  };
  const saveFeedback = async () => {
    if (!onSaveFeedback || feedbackPending) return;
    setFeedbackPending(true);
    setFeedbackError(null);
    try {
      await onSaveFeedback({
        decisions: plan.deviations.map((deviation) => ({
          code: deviation.code,
          resolution: resolutions[deviation.code] ?? "keep_plan",
        })),
        note: feedbackNote,
      });
      setFeedbackOpen(false);
    } catch {
      setFeedbackError(language === "zh" ? "暂时无法保存纠正，请重新检查后再试。" : "The correction could not be saved. Recheck and try again.");
    } finally {
      setFeedbackPending(false);
    }
  };

  return (
    <section className={`rounded-xl border p-4 ${plan.status === "attention" ? "border-destructive/35 bg-destructive/[0.035]" : plan.status === "matched" ? "border-success/30 bg-success/[0.035]" : "border-border bg-background/70"}`} data-testid="work-item-plan-actual" aria-label={language === "zh" ? "计划与实际对账" : "Plan and actual reconciliation"}>
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><HeaderIcon className="size-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{language === "zh" ? "计划与实际" : "Plan vs. actual"}</h3>
            <Badge tone={tone}>{statusCopy[index]}</Badge>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description[index]}</p>
        </div>
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        {plan.checks.map((check) => (
          <div key={check.key} className={`rounded-lg border px-3 py-2.5 ${check.status === "mismatch" ? "border-destructive/30 bg-destructive/[0.04]" : "border-border/80 bg-background/75"}`} data-testid={`plan-actual-${check.key}`}>
            <dt className="flex items-center gap-2 text-xs font-medium">
              {statusIcon(check.status)}
              {CHECK_LABELS[check.key][index]}
            </dt>
            <dd className="mt-1.5 text-xs leading-relaxed text-foreground">{REASON_COPY[check.reasonCode]?.[index] ?? check.reasonCode}</dd>
            <dd className="mt-1 break-words text-[11px] leading-relaxed text-muted-foreground">{checkDetail(plan, check.key, language)}</dd>
          </div>
        ))}
      </dl>
      {plan.feedback && !feedbackOpen ? (
        <div className="mt-3 rounded-lg border border-success/30 bg-success/[0.05] px-3 py-2.5" role="status" data-testid="plan-actual-feedback-receipt">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium">{language === "zh" ? "已记录你的纠正" : "Your correction was recorded"}</p>
              <p className="mt-1 text-xs text-muted-foreground">{language === "zh" ? "只影响以后相似任务，不会改写本次执行记录。" : "It affects future similar tasks only and does not rewrite this run."}</p>
            </div>
            {onSaveFeedback ? <Button size="sm" variant="ghost" onClick={() => setFeedbackOpen(true)}>{language === "zh" ? "修改" : "Change"}</Button> : null}
          </div>
        </div>
      ) : null}
      {feedbackOpen ? (
        <section className="mt-3 rounded-lg border border-primary/25 bg-background/80 p-3" aria-label={language === "zh" ? "纠正类似任务" : "Correct future similar tasks"}>
          <h4 className="text-sm font-semibold">{language === "zh" ? "以后遇到类似任务，应该怎么做？" : "What should happen for similar tasks?"}</h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{language === "zh" ? "选择会保存为偏好信号；涉及资料版本或写入权限时，下次仍会要求你确认。" : "Your choices become preference signals. Material-version and write-scope changes still require confirmation next time."}</p>
          <div className="mt-3 grid gap-3">
            {plan.deviations.map((deviation) => {
              const check = plan.checks.find((candidate) => candidate.reasonCode === deviation.code);
              return (
                <label key={deviation.code} className="grid gap-1.5 text-xs">
                  <span className="font-medium">{check ? CHECK_LABELS[check.key][index] : deviation.scope}</span>
                  <Select
                    aria-label={`${check ? CHECK_LABELS[check.key][index] : deviation.scope} ${language === "zh" ? "纠正选择" : "correction choice"}`}
                    value={resolutions[deviation.code] ?? "keep_plan"}
                    onChange={(event) => setResolutions((current) => ({ ...current, [deviation.code]: event.target.value as "keep_plan" | "prefer_actual" }))}
                  >
                    <option value="keep_plan">{language === "zh" ? "以后仍按原计划" : "Keep the original plan"}</option>
                    {canPreferActual(deviation) ? <option value="prefer_actual">{preferActualLabel(deviation)}</option> : null}
                  </Select>
                </label>
              );
            })}
            <label className="grid gap-1.5 text-xs">
              <span className="font-medium">{language === "zh" ? "补充说明（可选）" : "Note (optional)"}</span>
              <Textarea value={feedbackNote} maxLength={1000} onChange={(event) => setFeedbackNote(event.target.value)} />
            </label>
          </div>
          {feedbackError ? <p className="mt-2 text-xs text-destructive" role="alert">{feedbackError}</p> : null}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={feedbackPending} onClick={() => setFeedbackOpen(false)}>{language === "zh" ? "取消" : "Cancel"}</Button>
            <Button size="sm" disabled={feedbackPending} onClick={() => void saveFeedback()}>{feedbackPending ? (language === "zh" ? "正在保存…" : "Saving…") : (language === "zh" ? "保存纠正" : "Save correction")}</Button>
          </div>
        </section>
      ) : null}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {plan.status === "attention" && onSaveFeedback && !feedbackOpen && !plan.feedback ? (
          <Button size="sm" variant="secondary" onClick={() => setFeedbackOpen(true)}>{language === "zh" ? "纠正类似任务" : "Correct future tasks"}</Button>
        ) : null}
        {onOpenDetails ? (
          <Button size="sm" variant="ghost" onClick={onOpenDetails}>{language === "zh" ? "查看完整证据" : "View full evidence"}</Button>
        ) : null}
      </div>
    </section>
  );
}
