import { Badge } from "@/components/ui/badge";
import type { WorkItemCompletionQualityMetrics, WorkItemMetricCheck } from "./task-view-types";

function percent(value: number | null, zh: boolean) {
  return value == null ? (zh ? "暂无样本" : "No sample") : `${Math.round(value * 100)}%`;
}

function tone(check: WorkItemMetricCheck) {
  return check.status === "passed" ? "success" : check.status === "attention" ? "warning" : "neutral";
}

function checkLabel(check: WorkItemMetricCheck, zh: boolean) {
  if (check.status === "passed") return zh ? "达标" : "On target";
  if (check.status === "attention") return zh ? "待改进" : "Needs work";
  return zh ? "样本不足" : "More data needed";
}

export function WorkItemCompletionMetricsCard({
  report,
  language,
}: {
  report: WorkItemCompletionQualityMetrics;
  language: string;
}) {
  const zh = language.startsWith("zh");
  const { metrics } = report;
  const cards = [
    {
      key: "first-completion",
      title: zh ? "首次完成率" : "First-attempt completion",
      value: percent(metrics.completion.firstAttempt.rate, zh),
      detail: zh
        ? `${metrics.completion.firstAttempt.completed}/${metrics.completion.firstAttempt.settled} 个任务无需恢复即证据闭环`
        : `${metrics.completion.firstAttempt.completed}/${metrics.completion.firstAttempt.settled} settled tasks completed without recovery`,
      check: metrics.completion.firstAttempt.check,
    },
    {
      key: "final-completion",
      title: zh ? "最终完成率" : "Final completion",
      value: percent(metrics.completion.final.rate, zh),
      detail: zh
        ? `${metrics.completion.final.completed}/${metrics.completion.final.settled} 个已结束任务在恢复后证据闭环`
        : `${metrics.completion.final.completed}/${metrics.completion.final.settled} settled tasks verified after recovery`,
      check: metrics.completion.final.check,
    },
    {
      key: "recovery",
      title: zh ? "恢复成功率" : "Recovery success",
      value: percent(metrics.recovery.successRate, zh),
      detail: zh
        ? `${metrics.recovery.succeeded}/${metrics.recovery.required} 次失败或断点恢复成功`
        : `${metrics.recovery.succeeded}/${metrics.recovery.required} failure or checkpoint recoveries succeeded`,
      check: metrics.recovery.check,
    },
    {
      key: "intervention",
      title: zh ? "被迫人工介入率" : "Forced human intervention",
      value: percent(metrics.humanIntervention.rate, zh),
      detail: zh
        ? `${metrics.humanIntervention.count}/${metrics.completion.tracked} 个任务明确等待人工；另有 ${metrics.humanIntervention.userInitiatedRecovery.tasks} 个任务由用户主动恢复`
        : `${metrics.humanIntervention.count}/${metrics.completion.tracked} tasks explicitly waited for a person; ${metrics.humanIntervention.userInitiatedRecovery.tasks} were voluntarily recovered`,
      check: metrics.humanIntervention.check,
    },
    {
      key: "duplicates",
      title: zh ? "重复外部动作" : "Duplicate external actions",
      value: String(metrics.externalActions.duplicateCount),
      detail: zh
        ? `${metrics.externalActions.attempts} 次外部动作尝试，${metrics.externalActions.unresolvedCount} 次结果待恢复`
        : `${metrics.externalActions.attempts} external attempts; ${metrics.externalActions.unresolvedCount} awaiting recovery`,
      check: metrics.externalActions.check,
    },
  ];
  const overallTone = metrics.acceptance.status === "passed"
    ? "success"
    : metrics.acceptance.status === "attention" ? "warning" : "neutral";

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-3" aria-label={zh ? "任务完成质量" : "Task completion quality"}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{zh ? "任务完成质量" : "Task completion quality"}</h3>
          <p className="text-xs text-muted-foreground">
            {zh ? "只按真实证据与持久动作回执统计，不把状态改成完成当作完成。" : "Measured from durable evidence and action receipts, not status labels alone."}
          </p>
        </div>
        <Badge tone={overallTone}>
          {metrics.acceptance.status === "passed"
            ? (zh ? "整体达标" : "On target")
            : metrics.acceptance.status === "attention"
              ? (zh ? "仍需改进" : "Needs work")
              : (zh ? "等待样本" : "Awaiting data")}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {cards.map((card) => (
          <div key={card.key} className="space-y-1 rounded-lg border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="text-xs text-muted-foreground">{card.title}</span>
              <Badge tone={tone(card.check)}>{checkLabel(card.check, zh)}</Badge>
            </div>
            <p className="text-xl font-semibold tabular-nums">{card.value}</p>
            <p className="text-xs text-muted-foreground">{card.detail}</p>
          </div>
        ))}
      </div>
      {Object.keys(metrics.byCategory).length ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{zh ? "任务类型" : "Task type"}</th>
                <th className="px-3 py-2 font-medium">{zh ? "样本" : "Samples"}</th>
                <th className="px-3 py-2 font-medium">{zh ? "最终完成" : "Final completion"}</th>
                <th className="px-3 py-2 font-medium">{zh ? "恢复" : "Recovery"}</th>
                <th className="px-3 py-2 font-medium">{zh ? "被迫人工" : "Forced human"}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(metrics.byCategory).map(([category, row]) => row ? (
                <tr key={category} className="border-t border-border">
                  <td className="px-3 py-2">{{ development: zh ? "开发" : "Development", office: zh ? "办公" : "Office", material: zh ? "资料" : "Material", channel: "Channel", task: zh ? "其他任务" : "Other" }[category] ?? category}</td>
                  <td className="px-3 py-2 tabular-nums">{row.tracked}</td>
                  <td className="px-3 py-2 tabular-nums">{percent(row.finalCompletionRate, zh)}</td>
                  <td className="px-3 py-2 tabular-nums">{row.recoverySucceeded}/{row.recoveryRequired}</td>
                  <td className="px-3 py-2 tabular-nums">{row.forcedHumanInterventions}</td>
                </tr>
              ) : null)}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {zh
          ? `验收线：首次完成率 ≥ ${Math.round(metrics.completion.firstAttempt.check.target * 100)}%，最终完成率 ≥ ${Math.round(metrics.completion.final.check.target * 100)}%，恢复成功率 ≥ ${Math.round(metrics.recovery.check.target * 100)}%，被迫人工介入率 ≤ ${Math.round(metrics.humanIntervention.check.target * 100)}%，重复外部动作 = ${metrics.externalActions.check.target}。`
          : `Targets: first-attempt completion ≥ ${Math.round(metrics.completion.firstAttempt.check.target * 100)}%, final completion ≥ ${Math.round(metrics.completion.final.check.target * 100)}%, recovery ≥ ${Math.round(metrics.recovery.check.target * 100)}%, forced human intervention ≤ ${Math.round(metrics.humanIntervention.check.target * 100)}%, duplicate external actions = ${metrics.externalActions.check.target}.`}
      </p>
    </section>
  );
}
