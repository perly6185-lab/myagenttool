import { EmptyState } from "@/components/common/empty-state";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { LocalWorkItem } from "./task-view-types";

const STATUSES = ["backlog", "ready", "in_progress", "review", "blocked", "done"] as const;
const PRIORITIES = ["p0", "p1", "p2", "p3"] as const;

type PlanningInsightsProps = {
  items: LocalWorkItem[];
  today: string;
  capacityPoints: number;
  startDate: string | null;
  targetDate: string | null;
  daysRemaining: number | null;
  projectOverdue: boolean;
};

type Breakdown = { count: number; points: number };

export function PlanningInsights({
  items,
  today,
  capacityPoints,
  startDate,
  targetDate,
  daysRemaining,
  projectOverdue,
}: PlanningInsightsProps) {
  const { t } = useAppTranslation();
  const noMilestone = t("planningFilters.noMilestone");
  const statusCounts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<(typeof STATUSES)[number], number>;
  const priorityCounts = Object.fromEntries(PRIORITIES.map((priority) => [priority, 0])) as Record<(typeof PRIORITIES)[number], number>;
  const milestoneBreakdown = new Map<string, Breakdown & { done: number }>();
  const assigneeBreakdown = new Map<string, Breakdown>();
  let overdue = 0;
  let blocked = 0;
  let unscheduled = 0;
  let plannedPoints = 0;

  for (const item of items) {
    statusCounts[item.status] += 1;
    priorityCounts[item.priority] += 1;
    const points = item.estimatePoints ?? 0;
    const done = item.status === "done";
    const milestone = item.milestone || noMilestone;
    const milestoneStats = milestoneBreakdown.get(milestone) ?? { count: 0, done: 0, points: 0 };
    milestoneStats.count += 1;
    milestoneStats.done += done ? 1 : 0;
    milestoneStats.points += points;
    milestoneBreakdown.set(milestone, milestoneStats);

    if (!item.dueDate) unscheduled += 1;
    else if (!done && item.dueDate < today) overdue += 1;
    if (item.status === "blocked" || item.blockedBy?.some((dependency) => !dependency.resolved)) blocked += 1;
    if (!done) plannedPoints += points;
    for (const assignee of new Set(item.assigneeIds)) {
      const assigneeStats = assigneeBreakdown.get(assignee) ?? { count: 0, points: 0 };
      if (!done) {
        assigneeStats.count += 1;
        assigneeStats.points += points;
      }
      assigneeBreakdown.set(assignee, assigneeStats);
    }
  }

  if (!items.length) return <EmptyState title={t("planningFilters.noMatches")} hint={t("planningFilters.adjustFilters")} />;

  const total = items.length;
  const utilization = capacityPoints > 0 ? Math.round((plannedPoints / capacityPoints) * 100) : null;
  const milestones = [...milestoneBreakdown.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const assignees = [...assigneeBreakdown.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="rounded-md border border-border p-3">
        <h4 className="mb-2 text-sm font-semibold">{t("planningInsights.statusDistribution")}</h4>
        <div className="space-y-2">
          {STATUSES.map((status) => (
            <div key={status} className="grid grid-cols-[7rem_1fr_2rem] items-center gap-2 text-xs">
              <span>{t(`tasks.localStatus.${status}`)}</span>
              <div className="h-2 overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary" style={{ width: `${(statusCounts[status] / total) * 100}%` }} />
              </div>
              <span className="text-right">{statusCounts[status]}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-md border border-border p-3">
        <h4 className="mb-2 text-sm font-semibold">{t("planningInsights.priorityDistribution")}</h4>
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          {PRIORITIES.map((priority) => (
            <div key={priority} className="rounded bg-muted p-2">
              <strong className="block text-base">{priorityCounts[priority]}</strong>{priority.toUpperCase()}
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div><strong className="block text-base text-destructive">{overdue}</strong>{t("planningInsights.overdue")}</div>
          <div><strong className="block text-base text-destructive">{blocked}</strong>{t("planningInsights.blocked")}</div>
          <div><strong className="block text-base">{unscheduled}</strong>{t("planningInsights.unscheduled")}</div>
        </div>
        <div className={cn("mt-3 rounded p-2 text-center text-xs", utilization != null && utilization > 100 ? "bg-destructive/10 text-destructive" : "bg-muted")}>
          <strong className="block text-base">{utilization == null ? "—" : `${utilization}%`}</strong>
          {t("planningCapacity.utilization", { planned: plannedPoints, capacity: capacityPoints || "—" })}
        </div>
        <div className={cn("mt-2 rounded p-2 text-center text-xs", projectOverdue ? "bg-destructive/10 text-destructive" : "bg-muted")}>
          <strong className="block text-sm">{startDate || "—"} → {targetDate || "—"}</strong>
          {!targetDate
            ? t("planningSchedule.noTarget")
            : projectOverdue
              ? t("planningSchedule.overdue")
              : t("planningSchedule.daysRemaining", { count: daysRemaining ?? 0 })}
        </div>
      </section>
      <section className="rounded-md border border-border p-3">
        <h4 className="mb-2 text-sm font-semibold">{t("planningInsights.milestones")}</h4>
        <div className="space-y-1">
          {milestones.map(([milestone, stats]) => (
            <div key={milestone} className="flex justify-between text-xs">
              <span>{milestone}</span>
              <span>{stats.done}/{stats.count} · {Math.round((stats.done / stats.count) * 100)}% · {stats.points} {t("planningInsights.points")}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-md border border-border p-3">
        <h4 className="mb-2 text-sm font-semibold">{t("planningInsights.workload")}</h4>
        <div className="space-y-1">
          {assignees.map(([assignee, stats]) => (
            <div key={assignee} className="flex justify-between text-xs">
              <span>{assignee}</span>
              <span>{stats.count} · {stats.points} {t("planningInsights.points")}</span>
            </div>
          ))}
          {!assignees.length ? <p className="text-xs text-muted-foreground">{t("planningInsights.noAssignees")}</p> : null}
        </div>
      </section>
    </div>
  );
}
