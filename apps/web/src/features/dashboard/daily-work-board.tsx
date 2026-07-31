import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Clock3,
  ListChecks,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { WorkBoard, WorkItem, WorkReport, WorkState } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type {
  LocalScheduleCapacityResponse,
  LocalSchedulePreviewResponse,
  LocalScheduleRolloverResponse,
  LocalScheduleUrgentResponse,
} from "@/lib/api-client";
import type { LocalWorkItem } from "@/features/tasks/task-view-types";

type Tone = "neutral" | "running" | "success" | "warning" | "danger";

type Copy = {
  title: string;
  subtitle: string;
  overview: string;
  todayProgress: string;
  attention: string;
  active: string;
  completed: string;
  failed: string;
  yesterday: string;
  today: string;
  tomorrow: string;
  review: string;
  focus: string;
  plan: string;
  noYesterday: string;
  noToday: string;
  noTomorrow: string;
  yesterdayHint: string;
  todayHint: string;
  tomorrowHint: string;
  rollover: string;
  planTomorrow: string;
  more: string;
  terminalOffline: string;
  terminalCapacity: string;
  queueDepth: string;
  worktreeLocks: string;
  suggestedPlan: string;
  applyPlan: string;
  applyingPlan: string;
  rollingOver: string;
  rolloverCount: string;
  rolloverConfirm: string;
  urgentCount: string;
  insertUrgent: string;
  insertingUrgent: string;
  urgentConfirm: string;
  state: Record<WorkState, string>;
  localState: Record<LocalWorkItem["status"], string>;
};

const COPY: Record<"zh" | "en", Copy> = {
  zh: {
    title: "我的三日工作台",
    subtitle: "复盘昨天，执行今天，规划明天",
    overview: "查看全部任务",
    todayProgress: "今日进度",
    attention: "待处理",
    active: "进行中",
    completed: "已完成",
    failed: "失败",
    yesterday: "昨天",
    today: "今天",
    tomorrow: "明天",
    review: "复盘与结转",
    focus: "今日执行",
    plan: "提前规划",
    noYesterday: "昨天暂无已记录结果",
    noToday: "当前没有待执行事项",
    noTomorrow: "明天还没有安排",
    yesterdayHint: "完成和失败结果会在这里汇总",
    todayHint: "当前待决策、进行中和等待事项",
    tomorrowHint: "先确定重点，再安排任务顺序",
    rollover: "结转未完成",
    planTomorrow: "规划明天",
    more: "另有 {{count}} 项",
    terminalOffline: "本终端不可执行",
    terminalCapacity: "可用槽位 {{available}} / {{total}}",
    queueDepth: "队列 {{count}}",
    worktreeLocks: "工作区锁 {{count}}",
    suggestedPlan: "建议排期 {{count}} 项",
    applyPlan: "应用建议排期",
    applyingPlan: "应用中…",
    rollingOver: "结转中…",
    rolloverCount: "结转 {{count}} 项",
    rolloverConfirm: "其中 {{count}} 项是人工固定日期。确认同时移动这些任务吗？取消后仍可只结转未固定任务。",
    urgentCount: "P0 待插入 {{count}} 项",
    insertUrgent: "插入紧急任务",
    insertingUrgent: "插入中…",
    urgentConfirm: "插入 P0 需要移动 {{count}} 项人工固定任务。确认继续吗？",
    state: {
      pending_decision: "待决策",
      follow_up: "需跟进",
      in_progress: "进行中",
      waiting: "等待中",
      failed: "失败",
      done: "已完成",
    },
    localState: {
      backlog: "待规划",
      ready: "待开始",
      in_progress: "进行中",
      review: "审核中",
      blocked: "已阻塞",
      done: "已完成",
    },
  },
  en: {
    title: "My three-day workbench",
    subtitle: "Review yesterday, execute today, plan tomorrow",
    overview: "View all tasks",
    todayProgress: "Today's progress",
    attention: "Attention",
    active: "In progress",
    completed: "Completed",
    failed: "Failed",
    yesterday: "Yesterday",
    today: "Today",
    tomorrow: "Tomorrow",
    review: "Review and carry over",
    focus: "Today's execution",
    plan: "Plan ahead",
    noYesterday: "No outcomes recorded yesterday",
    noToday: "No current work needs action",
    noTomorrow: "Nothing planned for tomorrow",
    yesterdayHint: "Completed and failed outcomes appear here",
    todayHint: "Current decisions, active work, and waiting items",
    tomorrowHint: "Choose priorities before arranging the sequence",
    rollover: "Carry over unfinished",
    planTomorrow: "Plan tomorrow",
    more: "{{count}} more",
    terminalOffline: "This terminal is unavailable",
    terminalCapacity: "Available slots {{available}} / {{total}}",
    queueDepth: "Queue {{count}}",
    worktreeLocks: "Workspace locks {{count}}",
    suggestedPlan: "{{count}} suggested",
    applyPlan: "Apply suggested plan",
    applyingPlan: "Applying…",
    rollingOver: "Rolling over…",
    rolloverCount: "Roll over {{count}}",
    rolloverConfirm: "{{count}} item(s) have a manually pinned date. Move those too? Cancel still allows unpinned work to roll over.",
    urgentCount: "{{count}} P0 pending",
    insertUrgent: "Insert urgent work",
    insertingUrgent: "Inserting…",
    urgentConfirm: "Inserting P0 work requires moving {{count}} manually pinned item(s). Continue?",
    state: {
      pending_decision: "Decision",
      follow_up: "Follow up",
      in_progress: "In progress",
      waiting: "Waiting",
      failed: "Failed",
      done: "Completed",
    },
    localState: {
      backlog: "Backlog",
      ready: "Ready",
      in_progress: "In progress",
      review: "In review",
      blocked: "Blocked",
      done: "Completed",
    },
  },
};

const STATE_TONE: Record<WorkState, Tone> = {
  pending_decision: "warning",
  follow_up: "warning",
  in_progress: "running",
  waiting: "neutral",
  failed: "danger",
  done: "success",
};

const STATE_ACCENT: Record<WorkState, string> = {
  pending_decision: "border-l-warning",
  follow_up: "border-l-warning",
  in_progress: "border-l-primary",
  waiting: "border-l-muted-foreground/50",
  failed: "border-l-destructive",
  done: "border-l-success",
};

type DailyWorkItem = WorkItem & { planningStatus?: LocalWorkItem["status"] };
type DailyGroupKey = WorkState | LocalWorkItem["status"];

const GROUP_ORDER: DailyGroupKey[] = [
  "pending_decision",
  "failed",
  "blocked",
  "follow_up",
  "in_progress",
  "review",
  "ready",
  "backlog",
  "waiting",
  "done",
];

const LOCAL_STATE_TONE: Record<LocalWorkItem["status"], Tone> = {
  backlog: "neutral",
  ready: "neutral",
  in_progress: "running",
  review: "running",
  blocked: "warning",
  done: "success",
};

function displayState(item: DailyWorkItem): DailyGroupKey {
  return item.planningStatus ?? item.state;
}

function displayStateLabel(item: DailyWorkItem, copy: Copy): string {
  return item.planningStatus ? copy.localState[item.planningStatus] : copy.state[item.state];
}

function displayStateTone(item: DailyWorkItem): Tone {
  return item.planningStatus ? LOCAL_STATE_TONE[item.planningStatus] : STATE_TONE[item.state];
}

function dateKey(value: number | string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: number, days: number): number {
  const date = new Date(value);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function uniqueItems(groups: WorkItem[][]): WorkItem[] {
  const rows = new Map<string, WorkItem>();
  for (const group of groups) {
    for (const item of group) if (!rows.has(item.id)) rows.set(item.id, item);
  }
  return [...rows.values()];
}

function formatDate(value: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", weekday: "short" }).format(value);
}

function relativeTime(value: string | null | undefined, locale: string): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  if (minutes < 60) return formatter.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return formatter.format(-hours, "hour");
  return formatter.format(-Math.round(hours / 24), "day");
}

export type DailyWorkBoardModel = {
  yesterday: WorkItem[];
  today: WorkItem[];
  tomorrow: WorkItem[];
  todayCompleted: number;
  todayFailed: number;
  attention: number;
  active: number;
};

const LOCAL_STATUS_STATE: Record<LocalWorkItem["status"], WorkState> = {
  backlog: "waiting",
  ready: "waiting",
  in_progress: "in_progress",
  review: "in_progress",
  blocked: "follow_up",
  done: "done",
};

function localItemTargets(item: LocalWorkItem): Set<string> {
  return new Set((item.executionBindings ?? []).flatMap((binding) =>
    [binding.targetId, binding.id].filter((value): value is string => Boolean(value))));
}

function localWorkItemCard(item: LocalWorkItem, runtimeItems: WorkItem[]): DailyWorkItem {
  const targets = localItemTargets(item);
  const runtime = runtimeItems.find((candidate) => Boolean(candidate.targetId && targets.has(candidate.targetId)));
  return {
    id: `local:${item.id}`,
    state: runtime?.state ?? LOCAL_STATUS_STATE[item.status],
    planningStatus: item.status,
    kind: "local_work_item",
    title: `${item.localRef} · ${item.title}`,
    subtitle: runtime?.reason ?? runtime?.subtitle,
    reason: runtime?.reason,
    section: "task",
    targetId: item.id,
    projectId: item.projectId,
    updatedAt: item.completedAt ?? item.updatedAt,
  };
}

function withoutBoundRuntime(runtimeItems: WorkItem[], localItems: LocalWorkItem[]): WorkItem[] {
  const targets = new Set(localItems.flatMap((item) => [...localItemTargets(item)]));
  return runtimeItems.filter((item) => !item.targetId || !targets.has(item.targetId));
}

export function buildDailyWorkBoardModel(
  board: WorkBoard | undefined,
  report: WorkReport | undefined,
  now = Date.now(),
  plannedItems: LocalWorkItem[] = [],
): DailyWorkBoardModel {
  const states = board?.states;
  const yesterdayKey = dateKey(addDays(now, -1));
  const todayKey = dateKey(now);
  const tomorrowKey = dateKey(addDays(now, 1));
  const yesterdayRuntime = uniqueItems([
    states?.failed?.items ?? [],
    states?.done?.items ?? [],
  ]).filter((item) => dateKey(item.updatedAt ?? "") === yesterdayKey);
  const todayRuntime = uniqueItems([
    states?.pending_decision?.items ?? [],
    states?.in_progress?.items ?? [],
    states?.follow_up?.items ?? [],
    states?.waiting?.items ?? [],
  ]);
  const yesterdayLocal = plannedItems.filter((item) => dateKey(item.completedAt ?? "") === yesterdayKey);
  const priorityRank = { p0: 0, p1: 1, p2: 2, p3: 3 };
  const todayLocal = plannedItems
    .filter((item) => item.plannedDate === todayKey)
    .sort((left, right) =>
      (left.scheduleOrder ?? Number.MAX_SAFE_INTEGER) - (right.scheduleOrder ?? Number.MAX_SAFE_INTEGER)
      || priorityRank[left.priority] - priorityRank[right.priority]
      || left.id.localeCompare(right.id));
  const tomorrowLocal = plannedItems.filter((item) => item.plannedDate === tomorrowKey && item.status !== "done");
  const yesterday = [
    ...yesterdayLocal.map((item) => localWorkItemCard(item, yesterdayRuntime)),
    ...withoutBoundRuntime(yesterdayRuntime, yesterdayLocal),
  ];
  const today = [
    ...todayLocal.map((item) => localWorkItemCard(item, todayRuntime)),
    ...withoutBoundRuntime(todayRuntime, todayLocal),
  ];
  const tomorrow = tomorrowLocal.map((item) => localWorkItemCard(item, []));
  const flow = report?.periods.day.flow;
  return {
    yesterday,
    today,
    tomorrow,
    todayCompleted: flow?.completed ?? 0,
    todayFailed: flow?.failed ?? 0,
    attention: (states?.pending_decision?.count ?? 0) + (states?.follow_up?.count ?? 0),
    active: states?.in_progress?.count ?? 0,
  };
}

export function DailyWorkBoard({
  board,
  report,
  plannedItems = [],
  capacity,
  preview,
  rollover,
  urgent,
  onOpenItem,
  onOpenTasks,
  onApplyPlan,
  applyingPlan = false,
  onRollover,
  rollingOver = false,
  onApplyUrgent,
  applyingUrgent = false,
  now = Date.now(),
}: {
  board?: WorkBoard;
  report?: WorkReport;
  plannedItems?: LocalWorkItem[];
  capacity?: LocalScheduleCapacityResponse;
  preview?: LocalSchedulePreviewResponse;
  rollover?: LocalScheduleRolloverResponse;
  urgent?: LocalScheduleUrgentResponse;
  onOpenItem: (item: WorkItem) => void;
  onOpenTasks: () => void;
  onApplyPlan?: () => void;
  applyingPlan?: boolean;
  onRollover?: (confirmPinned: boolean) => void;
  rollingOver?: boolean;
  onApplyUrgent?: (confirmPinned: boolean) => void;
  applyingUrgent?: boolean;
  now?: number;
}) {
  const { i18n } = useAppTranslation();
  const locale = i18n.language.startsWith("zh") ? "zh-CN" : "en-US";
  const copy = COPY[locale === "zh-CN" ? "zh" : "en"];
  const suggestedDates = new Map(preview?.days.flatMap((day) =>
    day.items.map((item) => [item.workItemId, day.date] as const)) ?? []);
  for (const insertion of urgent?.insertions ?? []) suggestedDates.set(insertion.workItemId, insertion.targetDate);
  for (const displacement of [...(urgent?.displacements ?? []), ...(urgent?.confirmationRequired ?? [])]) {
    suggestedDates.set(displacement.workItemId, displacement.targetDate);
  }
  const previewItems = plannedItems.map((item) => {
    const plannedDate = suggestedDates.get(item.id);
    return plannedDate && item.plannedDate !== plannedDate ? { ...item, plannedDate } : item;
  });
  const model = buildDailyWorkBoardModel(board, report, now, previewItems);
  const suggestedCount = preview?.days.reduce((count, day) =>
    count + day.items.filter((item) => item.previousPlannedDate !== day.date).length, 0) ?? 0;
  const rolloverCount = (rollover?.moves.length ?? 0) + (rollover?.confirmationRequired.length ?? 0);
  const urgentCount = urgent?.insertions.length ?? 0;
  const progressTotal = model.todayCompleted + model.today.length;
  const progress = progressTotal ? Math.round((model.todayCompleted / progressTotal) * 100) : 0;

  return (
    <Card className="overflow-hidden border-border/80" data-testid="daily-work-board">
      <div className="flex flex-col gap-4 border-b border-border/80 px-5 py-4 xl:flex-row xl:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <CalendarDays className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{copy.title}</h2>
            <p className="truncate text-xs text-muted-foreground">
              {formatDate(now, locale)} · {copy.subtitle}
            </p>
          </div>
        </div>

        <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-2 xl:justify-end">
          <SummaryMetric label={copy.attention} value={model.attention} tone={model.attention ? "warning" : "neutral"} />
          <SummaryMetric label={copy.active} value={model.active} tone={model.active ? "running" : "neutral"} />
          <SummaryMetric label={copy.completed} value={model.todayCompleted} tone="success" />
          <SummaryMetric label={copy.failed} value={model.todayFailed} tone={model.todayFailed ? "danger" : "neutral"} />
          {capacity ? (
            <StatusBadge tone={capacity.terminal?.bridgeAvailable ? "success" : "warning"}>
              {capacity.terminal?.bridgeAvailable
                ? copy.terminalCapacity
                  .replace("{{available}}", String(capacity.capacity.availableSlots))
                  .replace("{{total}}", String(capacity.capacity.maxConcurrency))
                : copy.terminalOffline}
            </StatusBadge>
          ) : null}
          {suggestedCount > 0 ? (
            <StatusBadge tone="running">
              {copy.suggestedPlan.replace("{{count}}", String(suggestedCount))}
            </StatusBadge>
          ) : null}
          {urgentCount > 0 ? (
            <StatusBadge tone="danger">{copy.urgentCount.replace("{{count}}", String(urgentCount))}</StatusBadge>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onOpenTasks} className="ml-auto">
            {copy.overview}<ArrowRight aria-hidden />
          </Button>
        </div>
      </div>

      <div className="grid grid-flow-col auto-cols-[88%] gap-3 overflow-x-auto p-3 pb-4 [scrollbar-width:thin] lg:grid-flow-row lg:auto-cols-auto lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)_minmax(0,0.9fr)] lg:overflow-visible">
        <DayColumn
          className="order-2 lg:order-1"
          title={copy.yesterday}
          subtitle={copy.review}
          date={formatDate(addDays(now, -1), locale)}
          icon={RotateCcw}
          items={model.yesterday}
          emptyTitle={copy.noYesterday}
          emptyHint={copy.yesterdayHint}
          copy={copy}
          locale={locale}
          onOpenItem={onOpenItem}
          action={rolloverCount > 0 && onRollover ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={rollingOver}
              onClick={() => {
                const pinned = rollover?.confirmationRequired.length ?? 0;
                const confirmPinned = pinned > 0
                  ? window.confirm(copy.rolloverConfirm.replace("{{count}}", String(pinned)))
                  : false;
                if (!confirmPinned && pinned > 0 && (rollover?.moves.length ?? 0) === 0) return;
                onRollover(confirmPinned);
              }}
            >
              <RotateCcw />
              {rollingOver ? copy.rollingOver : copy.rolloverCount.replace("{{count}}", String(rolloverCount))}
            </Button>
          ) : <Button variant="ghost" size="sm" disabled><RotateCcw />{copy.rollover}</Button>}
        />

        <DayColumn
          className="order-1 lg:order-2"
          title={copy.today}
          subtitle={copy.focus}
          date={formatDate(now, locale)}
          icon={CircleDot}
          items={model.today}
          emptyTitle={copy.noToday}
          emptyHint={copy.todayHint}
          copy={copy}
          locale={locale}
          onOpenItem={onOpenItem}
          featured
          headerExtra={(
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">{copy.todayProgress}</span>
                <span className="font-medium tabular-nums">{progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
              </div>
              {capacity ? (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground" data-testid="local-capacity-summary">
                  <span>{copy.queueDepth.replace("{{count}}", String(capacity.capacity.queueDepth))}</span>
                  <span>{copy.worktreeLocks.replace("{{count}}", String(capacity.capacity.worktreeLocks))}</span>
                </div>
              ) : null}
            </div>
          )}
          action={urgentCount > 0 && onApplyUrgent ? (
            <Button
              size="sm"
              disabled={applyingUrgent}
              onClick={() => {
                const pinned = urgent?.confirmationRequired.length ?? 0;
                const confirmPinned = pinned > 0
                  ? window.confirm(copy.urgentConfirm.replace("{{count}}", String(pinned)))
                  : false;
                if (!confirmPinned && pinned > 0 && (urgent?.insertions.every((item) => item.requiresPinnedConfirmation) ?? false)) return;
                onApplyUrgent(confirmPinned);
              }}
            >
              <AlertTriangle />{applyingUrgent ? copy.insertingUrgent : copy.insertUrgent}
            </Button>
          ) : undefined}
        />

        <DayColumn
          className="order-3"
          title={copy.tomorrow}
          subtitle={copy.plan}
          date={formatDate(addDays(now, 1), locale)}
          icon={Sparkles}
          items={model.tomorrow}
          emptyTitle={copy.noTomorrow}
          emptyHint={copy.tomorrowHint}
          copy={copy}
          locale={locale}
          onOpenItem={onOpenItem}
          action={suggestedCount > 0 && onApplyPlan ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onOpenTasks}><Plus />{copy.planTomorrow}</Button>
              <Button size="sm" onClick={onApplyPlan} disabled={applyingPlan}>
                <Sparkles />{applyingPlan ? copy.applyingPlan : copy.applyPlan}
              </Button>
            </div>
          ) : <Button variant="secondary" size="sm" onClick={onOpenTasks}><Plus />{copy.planTomorrow}</Button>}
        />
      </div>
    </Card>
  );
}

function SummaryMetric({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className={cn(
        "font-semibold tabular-nums",
        tone === "warning" && "text-warning",
        tone === "running" && "text-primary",
        tone === "success" && "text-success",
        tone === "danger" && "text-destructive",
      )}>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function DayColumn({
  className,
  title,
  subtitle,
  date,
  icon: Icon,
  items,
  emptyTitle,
  emptyHint,
  copy,
  locale,
  onOpenItem,
  featured = false,
  headerExtra,
  action,
}: {
  className?: string;
  title: string;
  subtitle: string;
  date: string;
  icon: typeof CalendarDays;
  items: DailyWorkItem[];
  emptyTitle: string;
  emptyHint: string;
  copy: Copy;
  locale: string;
  onOpenItem: (item: WorkItem) => void;
  featured?: boolean;
  headerExtra?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const perGroupLimit = 2;
  const groups = GROUP_ORDER.map((key) => ({
    key,
    items: items.filter((item) => displayState(item) === key),
  })).filter((group) => group.items.length > 0);
  return (
    <section className={cn(
      "flex min-h-[330px] snap-start flex-col rounded-xl border p-3.5",
      featured
        ? "border-primary/35 bg-primary/[0.035] shadow-[0_0_0_1px_hsl(var(--primary)/0.04)]"
        : "border-border bg-background/45",
      className,
    )}>
      <div className="flex items-start gap-2.5">
        <span className={cn(
          "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg",
          featured ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{title}</h3>
            <Badge tone={featured ? "running" : "neutral"}>{items.length}</Badge>
            <span className="ml-auto text-[11px] text-muted-foreground">{date}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          {headerExtra}
        </div>
      </div>

      <div className="mt-3 flex flex-1 flex-col gap-2">
        {items.length ? groups.map((group) => (
          <div key={group.key} className="space-y-1.5" data-testid={`daily-state-group-${group.key}`}>
            <div className="flex items-center gap-2 px-1 text-[11px] font-medium text-muted-foreground">
              <span>{displayStateLabel(group.items[0], copy)}</span>
              <span className="h-px flex-1 bg-border/70" aria-hidden />
              <span className="tabular-nums">{group.items.length}</span>
            </div>
            {group.items.slice(0, perGroupLimit).map((item) => (
              <WorkCard key={item.id} item={item} copy={copy} locale={locale} onOpen={() => onOpenItem(item)} />
            ))}
            {group.items.length > perGroupLimit ? (
              <p className="px-1 text-center text-[11px] text-muted-foreground">
                {copy.more.replace("{{count}}", String(group.items.length - perGroupLimit))}
              </p>
            ) : null}
          </div>
        )) : (
          <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-border/80 bg-background/30 px-4 py-6 text-center">
            <div>
              {featured
                ? <ListChecks className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden />
                : <Clock3 className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden />}
              <p className="text-sm font-medium">{emptyTitle}</p>
              <p className="mt-1 text-xs text-muted-foreground">{emptyHint}</p>
            </div>
          </div>
        )}
      </div>

      {action ? <div className="mt-3 flex justify-end border-t border-border/70 pt-3">{action}</div> : null}
    </section>
  );
}

function WorkCard({
  item,
  copy,
  locale,
  onOpen,
}: {
  item: DailyWorkItem;
  copy: Copy;
  locale: string;
  onOpen: () => void;
}) {
  const time = relativeTime(item.updatedAt, locale);
  const Icon = item.state === "done"
    ? CheckCircle2
    : item.state === "failed" || item.state === "follow_up"
      ? AlertTriangle
      : item.state === "in_progress"
        ? CircleDot
        : Clock3;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group w-full rounded-lg border border-border border-l-2 bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/45",
        STATE_ACCENT[item.state],
      )}
    >
      <span className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.title}</span>
          {item.subtitle || item.reason ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.reason ?? item.subtitle}</span>
          ) : null}
        </span>
        <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </span>
      <span className="mt-2 flex items-center justify-between gap-2">
        <StatusBadge tone={displayStateTone(item)}>{displayStateLabel(item, copy)}</StatusBadge>
        {time ? <span className="text-[11px] text-muted-foreground">{time}</span> : null}
      </span>
    </button>
  );
}
