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
      key: "completion",
      title: zh ? "真正完成率" : "Verified completion",
      value: percent(metrics.completion.completionRate, zh),
      detail: zh
        ? `${metrics.completion.completed}/${metrics.completion.settled} 个已结束任务证据闭环`
        : `${metrics.completion.completed}/${metrics.completion.settled} settled tasks verified`,
      check: metrics.completion.check,
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
      title: zh ? "人工介入率" : "Human intervention",
      value: percent(metrics.humanIntervention.rate, zh),
      detail: zh
        ? `${metrics.humanIntervention.count}/${metrics.completion.tracked} 个任务需要异常处理，不含正常确认`
        : `${metrics.humanIntervention.count}/${metrics.completion.tracked} tasks needed exception handling; sign-off excluded`,
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
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
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
      <p className="text-xs text-muted-foreground">
        {zh
          ? `验收线：真正完成率 ≥ ${Math.round(metrics.completion.check.target * 100)}%，恢复成功率 ≥ ${Math.round(metrics.recovery.check.target * 100)}%，人工介入率 ≤ ${Math.round(metrics.humanIntervention.check.target * 100)}%，重复外部动作 = ${metrics.externalActions.check.target}。`
          : `Targets: verified completion ≥ ${Math.round(metrics.completion.check.target * 100)}%, recovery ≥ ${Math.round(metrics.recovery.check.target * 100)}%, human intervention ≤ ${Math.round(metrics.humanIntervention.check.target * 100)}%, duplicate external actions = ${metrics.externalActions.check.target}.`}
      </p>
    </section>
  );
}
