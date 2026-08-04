import {
  AlertTriangle,
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Clock3,
  ListChecks,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
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
import type { LocalWorkItem, WorkItemRequesterRelation } from "@/features/tasks/task-view-types";
import { WorkItemProgressDialog, type WorkItemProgressTarget } from "@/features/tasks/work-item-progress-dialog";
import type { HomeAttentionReason, HomeWorkbench, HomeWorkbenchItem } from "./home-workbench-types";

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
  less: string;
  terminalOffline: string;
  terminalCapacity: string;
  queueDepth: string;
  worktreeLocks: string;
  unscheduled: string;
  unscheduledHint: string;
  unassigned: string;
  unassignedHint: string;
  claim: string;
  claiming: string;
  myWork: string;
  myWorkHint: string;
  allMyWork: string;
  peopleCategory: string;
  otherPeople: string;
  needsMine: string;
  waitingMe: string;
  approvals: string;
  aiFailed: string;
  dueToday: string;
  reviewReady: string;
  activeAi: string;
  aiWorkHint: string;
  allAiWork: string;
  aiRunning: string;
  aiScheduled: string;
  noAiWork: string;
  noAiWorkHint: string;
  executionDate: string;
  noExecutionDate: string;
  expectedCompletion: string;
  noExpectedCompletion: string;
  otherDates: string;
  otherDatesHint: string;
  owner: string;
  waitingLabel: string;
  aiLabel: string;
  execution: Record<HomeWorkbenchItem["executionState"], string>;
  relation: Record<WorkItemRequesterRelation, string>;
  waiting: Record<HomeWorkbenchItem["waitingOn"], string>;
  attentionReason: Record<HomeAttentionReason, string>;
  nextAction: Record<HomeWorkbenchItem["nextAction"]["kind"], string>;
  report: { draft: string; confirmed: string; stale: string; prepare: string; review: string };
  scheduleReasons: Record<string, string>;
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
    title: "我的任务",
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
    review: "应完成 / 已逾期",
    focus: "今天应完成",
    plan: "明天应完成",
    noYesterday: "没有昨天应完成的任务",
    noToday: "今天没有应完成的任务",
    noTomorrow: "明天没有应完成的任务",
    yesterdayHint: "更早未完成的任务也会归入这里",
    todayHint: "按预期完成日期查看今天的任务",
    tomorrowHint: "按预期完成日期查看明天的任务",
    rollover: "结转未完成",
    planTomorrow: "规划明天",
    more: "查看另外 {{count}} 项",
    less: "收起",
    terminalOffline: "本终端不可执行",
    terminalCapacity: "可用槽位 {{available}} / {{total}}",
    queueDepth: "队列 {{count}}",
    worktreeLocks: "工作区锁 {{count}}",
    unscheduled: "其他完成日期",
    unscheduledHint: "显示更晚日期以及尚未设置预期完成日期的任务。",
    unassigned: "待认领",
    unassignedHint: "所有尚未分配的本地 Issue 都在这里；认领后才会进入个人调度并占用终端容量。",
    claim: "认领",
    claiming: "认领中…",
    myWork: "我的任务",
    myWorkHint: "按任务人员归类和预期完成日期查看本终端 Issue",
    allMyWork: "全部人员",
    peopleCategory: "任务人员",
    otherPeople: "其他 / 未归类",
    needsMine: "需要我处理",
    waitingMe: "待我回复",
    approvals: "AI 待审批",
    aiFailed: "AI 失败",
    dueToday: "今日到期",
    reviewReady: "待复核与汇报",
    activeAi: "AI 的任务",
    aiWorkHint: "按本终端 AI 执行日期和执行状态查看同一批 Issue",
    allAiWork: "全部 AI 任务",
    aiRunning: "执行中",
    aiScheduled: "待执行",
    noAiWork: "暂无 AI 任务",
    noAiWorkHint: "为 Issue 设置 AI 执行日期或启动执行后会显示在这里",
    executionDate: "AI 执行日期",
    noExecutionDate: "未安排执行日期",
    expectedCompletion: "预期完成",
    noExpectedCompletion: "未设置预期完成日期",
    otherDates: "其他日期 / 未安排",
    otherDatesHint: "显示更晚执行或尚未安排执行日期的 AI 任务。",
    owner: "负责人",
    waitingLabel: "人",
    aiLabel: "AI",
    execution: { unclaimed: "尚未执行", claimed: "已认领", running: "执行中", awaiting_approval: "等待审批", verifying: "验证中", failed: "执行失败", completed: "等待复核" },
    relation: { boss: "老板", manager: "上级", customer: "客户", child: "小孩学习", colleague: "同事", self: "自己", unknown: "未标注" },
    waiting: { me: "等我", requester: "等提出者", internal: "等内部成员", ai: "等 AI", none: "无需等待" },
    attentionReason: {
      overdue: "承诺或截止时间已逾期", approval_required: "需要人工审批", ai_failed: "执行失败，需要人工处理",
      review_ready: "结果已就绪，等待人工复核", follow_up_due: "已到跟进时间", waiting_requester: "等待提出者回复",
      waiting_internal: "等待内部成员", ai_running: "执行中，无需人工处理", planned: "已安排",
    },
    nextAction: { open_issue: "查看任务", record_progress: "跟进", review_result: "复核", open_approval: "审批", open_run: "查看运行", retry: "处理失败" },
    report: { draft: "汇报草稿", confirmed: "汇报已确认", stale: "汇报已过期", prepare: "准备汇报", review: "复核汇报" },
    scheduleReasons: {
      auto_run_failed: "运行失败，需先复盘或重试",
      auto_run_blocked: "运行被阻塞",
      auto_run_needs_input: "等待补充信息",
      auto_run_awaiting_approval: "等待审批",
      auto_run_decision_required: "等待人工决策",
      auto_run_pr_open: "等待 PR 处理",
      auto_run_not_ready: "当前尚不可执行",
      work_item_blocked: "任务被阻塞",
      review_required: "等待评审",
      terminal_unavailable: "本终端不可用",
      terminal_at_capacity: "本终端容量已满",
      capacity_exhausted: "今天和明天容量不足",
      pinned_capacity_exceeded: "固定日期超出容量",
      pinned_outside_horizon: "固定日期不在两日计划范围内",
      not_ready: "当前尚不可安排",
    },
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
    title: "My tasks",
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
    review: "Due / overdue",
    focus: "Due today",
    plan: "Due tomorrow",
    noYesterday: "No tasks were due yesterday",
    noToday: "No tasks are due today",
    noTomorrow: "No tasks are due tomorrow",
    yesterdayHint: "Older unfinished tasks also appear here",
    todayHint: "Tasks grouped by expected completion date",
    tomorrowHint: "Tasks grouped by expected completion date",
    rollover: "Carry over unfinished",
    planTomorrow: "Plan tomorrow",
    more: "Show {{count}} more",
    less: "Show fewer",
    terminalOffline: "This terminal is unavailable",
    terminalCapacity: "Available slots {{available}} / {{total}}",
    queueDepth: "Queue {{count}}",
    worktreeLocks: "Workspace locks {{count}}",
    unscheduled: "Other completion dates",
    unscheduledHint: "Tasks due later or missing an expected completion date.",
    unassigned: "Unassigned",
    unassignedHint: "Every unassigned local Issue appears here. It enters personal scheduling and terminal capacity only after you claim it.",
    claim: "Claim",
    claiming: "Claiming…",
    myWork: "My tasks",
    myWorkHint: "View this terminal's Issues by person category and expected completion date",
    allMyWork: "All people",
    peopleCategory: "Task person",
    otherPeople: "Other / unlabeled",
    needsMine: "Needs my action",
    waitingMe: "Waiting on me",
    approvals: "AI approvals",
    aiFailed: "AI failed",
    dueToday: "Due today",
    reviewReady: "Review and report",
    activeAi: "AI tasks",
    aiWorkHint: "View the same Issues by this terminal's AI execution date and execution state",
    allAiWork: "All AI tasks",
    aiRunning: "Running",
    aiScheduled: "Scheduled",
    noAiWork: "No AI work yet",
    noAiWorkHint: "Set an AI execution date or start execution to show an Issue here",
    executionDate: "AI execution date",
    noExecutionDate: "No execution date",
    expectedCompletion: "Expected completion",
    noExpectedCompletion: "Expected completion not set",
    otherDates: "Other dates / unscheduled",
    otherDatesHint: "AI tasks scheduled later or missing an execution date.",
    owner: "Owner",
    waitingLabel: "People",
    aiLabel: "AI",
    execution: { unclaimed: "Not started", claimed: "Claimed", running: "Running", awaiting_approval: "Awaiting approval", verifying: "Verifying", failed: "Execution failed", completed: "Ready for review" },
    relation: { boss: "Boss", manager: "Manager", customer: "Customer", child: "Child learning", colleague: "Colleague", self: "Self", unknown: "Not labeled" },
    waiting: { me: "Waiting on me", requester: "Waiting on requester", internal: "Waiting on internal", ai: "Waiting on AI", none: "Not waiting" },
    attentionReason: {
      overdue: "Commitment or due date overdue", approval_required: "Needs human approval", ai_failed: "Execution failed; needs human action",
      review_ready: "Result ready for human review", follow_up_due: "Follow-up is due", waiting_requester: "Waiting for requester",
      waiting_internal: "Waiting for internal member", ai_running: "Execution in progress; no human action", planned: "Planned",
    },
    nextAction: { open_issue: "View task", record_progress: "Follow up", review_result: "Review", open_approval: "Approve", open_run: "View run", retry: "Handle failure" },
    report: { draft: "Report draft", confirmed: "Report confirmed", stale: "Report stale", prepare: "Prepare report", review: "Review report" },
    scheduleReasons: {
      auto_run_failed: "Run failed; triage or retry first",
      auto_run_blocked: "Run is blocked",
      auto_run_needs_input: "Waiting for more information",
      auto_run_awaiting_approval: "Waiting for approval",
      auto_run_decision_required: "Waiting for a human decision",
      auto_run_pr_open: "Waiting for PR handling",
      auto_run_not_ready: "Not currently executable",
      work_item_blocked: "Task is blocked",
      review_required: "Waiting for review",
      terminal_unavailable: "This terminal is unavailable",
      terminal_at_capacity: "This terminal is at capacity",
      capacity_exhausted: "Today and Tomorrow have no remaining capacity",
      pinned_capacity_exceeded: "Pinned date exceeds capacity",
      pinned_outside_horizon: "Pinned date is outside the two-day plan",
      not_ready: "Not currently schedulable",
    },
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

type DailyWorkItem = WorkItem & {
  planningStatus?: LocalWorkItem["status"];
  home?: HomeWorkbenchItem;
  dueDate?: string | null;
  requesterRelation?: WorkItemRequesterRelation;
};
type DailyLocalWorkItem = LocalWorkItem & { scheduleReason?: string | null };
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

function executionTone(state: HomeWorkbenchItem["executionState"]): Tone {
  if (state === "failed") return "danger";
  if (state === "awaiting_approval") return "warning";
  if (state === "completed") return "success";
  if (["running", "verifying"].includes(state)) return "running";
  return "neutral";
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

function formatDateOnly(value: string | null | undefined, locale: string): string | null {
  if (!value) return null;
  const timestamp = Date.parse(`${value}T12:00:00`);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(timestamp)
    : value;
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
  unscheduled: WorkItem[];
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

function localWorkItemCard(
  item: DailyLocalWorkItem,
  runtimeItems: WorkItem[],
  home?: HomeWorkbenchItem,
): DailyWorkItem {
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
    plannedDate: item.dueDate,
    dueDate: item.dueDate,
    requesterRelation: item.requesterRelation,
    home,
  };
}

export function buildDailyWorkBoardModel(
  board: WorkBoard | undefined,
  report: WorkReport | undefined,
  now = Date.now(),
  plannedItems: DailyLocalWorkItem[] = [],
  workbenchItems: HomeWorkbenchItem[] = [],
): DailyWorkBoardModel {
  const states = board?.states;
  const yesterdayKey = dateKey(addDays(now, -1)) ?? new Date(addDays(now, -1)).toISOString().slice(0, 10);
  const todayKey = dateKey(now) ?? new Date(now).toISOString().slice(0, 10);
  const tomorrowKey = dateKey(addDays(now, 1)) ?? new Date(addDays(now, 1)).toISOString().slice(0, 10);
  const priorityRank = { p0: 0, p1: 1, p2: 2, p3: 3 };
  const homeById = new Map(workbenchItems.map((item) => [item.workItemId, item]));
  const homeRank = new Map(workbenchItems.map((item, index) => [item.workItemId, index]));
  const compareLocal = (left: DailyLocalWorkItem, right: DailyLocalWorkItem) =>
    (homeRank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (homeRank.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    || priorityRank[left.priority] - priorityRank[right.priority]
    || left.id.localeCompare(right.id);
  const visibleLocal = plannedItems.filter((item) => !item.archivedAt && item.state !== "closed");
  const yesterdayLocal = visibleLocal.filter((item) => Boolean(item.dueDate && item.dueDate <= yesterdayKey)).sort(compareLocal);
  const todayLocal = visibleLocal.filter((item) => item.dueDate === todayKey).sort(compareLocal);
  const tomorrowLocal = visibleLocal.filter((item) => item.dueDate === tomorrowKey).sort(compareLocal);
  const otherLocal = visibleLocal
    .filter((item) => !item.dueDate || item.dueDate > tomorrowKey)
    .sort((left, right) => String(left.dueDate ?? "9999-12-31").localeCompare(String(right.dueDate ?? "9999-12-31")) || compareLocal(left, right));

  const activeRuntime = uniqueItems([
    states?.pending_decision?.items ?? [],
    states?.in_progress?.items ?? [],
    states?.follow_up?.items ?? [],
    states?.waiting?.items ?? [],
  ]);
  const yesterdayRuntime = uniqueItems([states?.failed?.items ?? [], states?.done?.items ?? []])
    .filter((item) => dateKey(item.updatedAt ?? "") === yesterdayKey);
  const runtimeFallback = plannedItems.length === 0;
  const yesterday = runtimeFallback
    ? yesterdayRuntime
    : yesterdayLocal.map((item) => localWorkItemCard(item, [], homeById.get(item.id)));
  const today = runtimeFallback
    ? activeRuntime.filter((item) => item.plannedDate === todayKey || (!item.plannedDate && item.state === "in_progress"))
    : todayLocal.map((item) => localWorkItemCard(item, [], homeById.get(item.id)));
  const tomorrow = runtimeFallback
    ? activeRuntime.filter((item) => item.plannedDate === tomorrowKey && item.state !== "done")
    : tomorrowLocal.map((item) => localWorkItemCard(item, [], homeById.get(item.id)));
  const unscheduled = runtimeFallback
    ? activeRuntime.filter((item) => !item.plannedDate && item.state !== "in_progress")
    : otherLocal.map((item) => localWorkItemCard(item, [], homeById.get(item.id)));
  const flow = report?.periods.day.flow;
  return {
    yesterday,
    today,
    tomorrow,
    unscheduled,
    todayCompleted: runtimeFallback ? flow?.completed ?? 0 : todayLocal.filter((item) => item.status === "done").length,
    todayFailed: flow?.failed ?? 0,
    attention: runtimeFallback
      ? (states?.pending_decision?.count ?? 0) + (states?.follow_up?.count ?? 0)
      : visibleLocal.filter((item) => item.status === "blocked" || Boolean(item.dueDate && item.dueDate < todayKey)).length,
    active: runtimeFallback ? states?.in_progress?.count ?? 0 : visibleLocal.filter((item) => ["in_progress", "review"].includes(item.status)).length,
  };
}

export function DailyWorkBoard({
  board,
  report,
  plannedItems = [],
  workbench,
  unassignedItems = [],
  capacity,
  preview,
  rollover,
  urgent,
  onOpenItem,
  onOpenTasks,
  onClaimItem,
  onProgressRecorded,
  claimingItemId = null,
  claimError = null,
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
  workbench?: HomeWorkbench;
  unassignedItems?: LocalWorkItem[];
  capacity?: LocalScheduleCapacityResponse;
  preview?: LocalSchedulePreviewResponse;
  rollover?: LocalScheduleRolloverResponse;
  urgent?: LocalScheduleUrgentResponse;
  onOpenItem: (item: WorkItem) => void;
  onOpenTasks: () => void;
  onOpenAttention?: () => void;
  onOpenActive?: () => void;
  onOpenCompleted?: () => void;
  onOpenFailed?: () => void;
  onClaimItem?: (item: LocalWorkItem) => void;
  onProgressRecorded?: () => void | Promise<void>;
  claimingItemId?: string | null;
  claimError?: string | null;
  onApplyPlan?: () => void;
  applyingPlan?: boolean;
  onRollover?: (confirmPinned: boolean) => void;
  rollingOver?: boolean;
  onApplyUrgent?: (confirmPinned: boolean) => void;
  applyingUrgent?: boolean;
  now?: number;
}) {
  const [unassignedExpanded, setUnassignedExpanded] = useState(false);
  const [capacityExpanded, setCapacityExpanded] = useState(false);
  const [myWorkFilter, setMyWorkFilter] = useState<WorkItemRequesterRelation | "all" | "other">("all");
  const [aiWorkFilter, setAiWorkFilter] = useState<"all" | "scheduled" | "running" | "awaiting_approval" | "failed" | "completed">("all");
  const [progressTarget, setProgressTarget] = useState<WorkItemProgressTarget | null>(null);
  const { i18n } = useAppTranslation();
  const locale = i18n.language.startsWith("zh") ? "zh-CN" : "en-US";
  const copy = COPY[locale === "zh-CN" ? "zh" : "en"];
  const currentDay = workbench?.horizon.today ?? dateKey(now) ?? new Date(now).toISOString().slice(0, 10);
  const nextDay = workbench?.horizon.tomorrow ?? dateKey(addDays(now, 1)) ?? new Date(addDays(now, 1)).toISOString().slice(0, 10);
  const suggestedDates = new Map(preview?.days.flatMap((day) =>
    day.items.map((item) => [item.workItemId, day.date] as const)) ?? []);
  for (const insertion of urgent?.insertions ?? []) suggestedDates.set(insertion.workItemId, insertion.targetDate);
  for (const displacement of [...(urgent?.displacements ?? []), ...(urgent?.confirmationRequired ?? [])]) {
    suggestedDates.set(displacement.workItemId, displacement.targetDate);
  }
  const unscheduledReasons = new Map([
    ...(preview?.attention ?? []),
    ...(preview?.unscheduled ?? []),
  ].map((item) => [item.workItemId, item.reason] as const));
  const previewItems = plannedItems.map((item) => {
    const plannedDate = suggestedDates.get(item.id);
    const scheduleReason = unscheduledReasons.get(item.id) ?? null;
    return { ...item, ...(plannedDate && item.plannedDate !== plannedDate ? { plannedDate } : {}), scheduleReason };
  });
  const previewBoard = board ? {
    ...board,
    states: Object.fromEntries(Object.entries(board.states).map(([key, state]) => [key, {
      ...state,
      items: state.items.map((item) => {
        const scheduleKey = item.scheduleKey ?? item.id;
        const suggestedDate = suggestedDates.get(scheduleKey);
        const unscheduledReason = unscheduledReasons.get(scheduleKey);
        if (!suggestedDate && !unscheduledReason) return item;
        return {
          ...item,
          plannedDate: suggestedDate ?? item.plannedDate ?? null,
          scheduleReason: unscheduledReason ?? item.scheduleReason ?? null,
        };
      }),
    }])) as WorkBoard["states"],
  } : undefined;
  const workbenchItems = workbench?.items ?? [];
  const myWorkFilterActive = myWorkFilter !== "all";
  const baseModel = buildDailyWorkBoardModel(previewBoard, report, now, previewItems, workbenchItems);
  const filterItems = (items: WorkItem[]) => items.filter((item) => {
    const row = item as DailyWorkItem;
    const relation = row.home?.requester.relation ?? row.requesterRelation ?? "unknown";
    if (myWorkFilter === "other") return relation === "colleague" || relation === "unknown";
    return relation === myWorkFilter;
  });
  const model = myWorkFilterActive ? {
    ...baseModel,
    yesterday: filterItems(baseModel.yesterday),
    today: filterItems(baseModel.today),
    tomorrow: filterItems(baseModel.tomorrow),
    unscheduled: filterItems(baseModel.unscheduled),
  } : baseModel;
  const previewById = new Map(previewItems.map((item) => [item.id, item]));
  const aiWorkItems = workbenchItems
    .map((item) => ({ ...item, plannedDate: previewById.get(item.workItemId)?.plannedDate ?? item.plannedDate }))
    .filter((item) => Boolean(item.plannedDate || item.ai));
  const matchesAiWorkFilter = (item: HomeWorkbenchItem) => {
    if (aiWorkFilter === "scheduled") return item.executionState === "unclaimed" || item.executionState === "claimed";
    if (aiWorkFilter === "running") return item.executionState === "running" || item.executionState === "verifying";
    if (aiWorkFilter === "all") return true;
    return item.executionState === aiWorkFilter;
  };
  const filteredAiWorkItems = aiWorkItems.filter(matchesAiWorkFilter);
  const aiCounts = {
    all: aiWorkItems.length,
    scheduled: aiWorkItems.filter((item) => item.executionState === "unclaimed" || item.executionState === "claimed").length,
    running: aiWorkItems.filter((item) => item.executionState === "running" || item.executionState === "verifying").length,
    awaiting_approval: aiWorkItems.filter((item) => item.executionState === "awaiting_approval").length,
    failed: aiWorkItems.filter((item) => item.executionState === "failed").length,
    completed: aiWorkItems.filter((item) => item.executionState === "completed").length,
  };
  const aiDateGroups = {
    yesterday: filteredAiWorkItems.filter((item) => Boolean(item.plannedDate && item.plannedDate < currentDay)),
    today: filteredAiWorkItems.filter((item) => item.plannedDate === currentDay),
    tomorrow: filteredAiWorkItems.filter((item) => item.plannedDate === nextDay),
    other: filteredAiWorkItems.filter((item) => !item.plannedDate || item.plannedDate > nextDay),
  };
  const suggestedCount = preview?.days.reduce((count, day) =>
    count + day.items.filter((item) => item.previousPlannedDate !== day.date).length, 0) ?? 0;
  const rolloverCount = (rollover?.moves.length ?? 0) + (rollover?.confirmationRequired.length ?? 0);
  const urgentCount = urgent?.insertions.length ?? 0;
  const progressTotal = model.today.length;
  const progress = progressTotal ? Math.round((model.todayCompleted / progressTotal) * 100) : 0;
  const runHomeAction = (item: HomeWorkbenchItem) => {
    if (item.nextAction.kind === "record_progress") {
      setProgressTarget({
        id: item.workItemId,
        title: item.title,
        revision: item.revision,
        requesterRelation: item.requester.relation,
        waitingOn: item.waitingOn,
        nextFollowUpAt: item.nextFollowUpAt,
      });
      return;
    }
    onOpenItem(homeActionWorkItem(item));
  };
  const runHomeReport = (item: HomeWorkbenchItem) => onOpenItem(homeReportWorkItem(item));

  return (
    <div className="space-y-4" data-testid="daily-work-board">
      <Card className="overflow-hidden border-border/80" data-testid="my-work-section">
      <div className="flex flex-col gap-4 border-b border-border/80 px-5 py-4 xl:flex-row xl:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <BriefcaseBusiness className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{copy.title}</h2>
            <p className="truncate text-xs text-muted-foreground">
              {formatDate(now, locale)} · {copy.myWorkHint}
            </p>
          </div>
        </div>

        <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-2 xl:justify-end">
          <Button variant="ghost" size="sm" onClick={onOpenTasks} className="ml-auto">
            {copy.overview}<ArrowRight aria-hidden />
          </Button>
        </div>
      </div>

      <section className="border-b border-border/80 bg-muted/10 px-4 py-4" data-testid="my-work-status-cards">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold">{copy.peopleCategory}</h3>
            <span className="text-xs text-muted-foreground">{copy.expectedCompletion} · {copy.yesterday} / {copy.today} / {copy.tomorrow}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-7">
            <WorkStatusFilterCard
              label={copy.allMyWork}
              value={workbench?.summary.total ?? plannedItems.length}
              tone="neutral"
              active={myWorkFilter === "all"}
              onClick={() => setMyWorkFilter("all")}
            />
            {(["self", "boss", "manager", "customer", "child"] as const).map((relation) => (
              <WorkStatusFilterCard
                key={relation}
                label={copy.relation[relation]}
                value={workbench?.summary.byRelation[relation]
                  ?? plannedItems.filter((item) => item.requesterRelation === relation).length}
                tone={relation === "boss" ? "warning" : relation === "customer" ? "running" : relation === "child" ? "success" : "neutral"}
                active={myWorkFilter === relation}
                onClick={() => setMyWorkFilter(relation)}
              />
            ))}
            <WorkStatusFilterCard
              label={copy.otherPeople}
              value={workbench
                ? workbench.summary.byRelation.colleague + workbench.summary.byRelation.unknown
                : plannedItems.filter((item) => item.requesterRelation === "colleague" || item.requesterRelation === "unknown").length}
              tone="neutral"
              active={myWorkFilter === "other"}
              onClick={() => setMyWorkFilter("other")}
            />
          </div>
        </section>

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
          onHomeAction={runHomeAction}
          onHomeReport={runHomeReport}
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
          onHomeAction={runHomeAction}
          onHomeReport={runHomeReport}
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
            </div>
          )}
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
          onHomeAction={runHomeAction}
          onHomeReport={runHomeReport}
        />
      </div>
      {model.unscheduled.length > 0 ? (
        <section className="border-t border-border/80 px-4 py-4" data-testid="unscheduled-work">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{copy.unscheduled}</h3>
                <Badge tone="warning">{model.unscheduled.length}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{copy.unscheduledHint}</p>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {model.unscheduled.map((item) => (
              <WorkCard
                key={item.id}
                item={item}
                copy={copy}
                locale={locale}
                onOpen={() => onOpenItem(item)}
                onAction={(item as DailyWorkItem).home ? () => runHomeAction((item as DailyWorkItem).home!) : undefined}
                onReport={(item as DailyWorkItem).home ? () => runHomeReport((item as DailyWorkItem).home!) : undefined}
              />
            ))}
          </div>
        </section>
      ) : null}
      {unassignedItems.length > 0 ? (
        <section className="border-t border-border/80 px-4 py-4" data-testid="unassigned-work">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{copy.unassigned}</h3>
                <Badge tone="neutral">{unassignedItems.length}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{copy.unassignedHint}</p>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {unassignedItems.slice(0, unassignedExpanded ? undefined : 6).map((item) => (
              <ClaimableWorkCard
                key={item.id}
                item={item}
                copy={copy}
                locale={locale}
                claiming={claimingItemId === item.id}
                claimDisabled={Boolean(claimingItemId)}
                onOpen={() => onOpenItem(localWorkItemCard(item, []))}
                onClaim={onClaimItem ? () => onClaimItem(item) : undefined}
              />
            ))}
          </div>
          {unassignedItems.length > 6 ? (
            <button
              type="button"
              aria-expanded={unassignedExpanded}
              onClick={() => setUnassignedExpanded((value) => !value)}
              className="mt-2 w-full rounded px-2 py-2 text-center text-xs font-medium text-primary hover:bg-primary/5"
            >
              {unassignedExpanded ? copy.less : copy.more.replace("{{count}}", String(unassignedItems.length - 6))}
            </button>
          ) : null}
          {claimError ? <p className="mt-2 text-xs text-destructive" role="alert">{claimError}</p> : null}
        </section>
      ) : null}
      </Card>

      <Card className="overflow-hidden border-border/80" data-testid="ai-work-section">
        <div className="flex flex-col gap-3 border-b border-border/80 px-5 py-4 xl:flex-row xl:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Bot className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">{copy.activeAi}</h2>
                <Badge tone={aiWorkItems.length ? "running" : "neutral"}>{aiWorkItems.length}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{copy.aiWorkHint}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {suggestedCount > 0 ? (
              <StatusBadge tone="running">{copy.suggestedPlan.replace("{{count}}", String(suggestedCount))}</StatusBadge>
            ) : null}
            {urgentCount > 0 ? (
              <StatusBadge tone="danger">{copy.urgentCount.replace("{{count}}", String(urgentCount))}</StatusBadge>
            ) : null}
            {capacity ? (
              <button
                type="button"
                aria-expanded={capacityExpanded}
                onClick={() => setCapacityExpanded((expanded) => !expanded)}
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <StatusBadge tone={capacity.terminal?.bridgeAvailable ? "success" : "warning"}>
                  {capacity.terminal?.bridgeAvailable
                    ? copy.terminalCapacity
                      .replace("{{available}}", String(capacity.capacity.availableSlots))
                      .replace("{{total}}", String(capacity.capacity.maxConcurrency))
                    : copy.terminalOffline}
                </StatusBadge>
              </button>
            ) : null}
            {rolloverCount > 0 && onRollover ? (
              <Button variant="secondary" size="sm" disabled={rollingOver} onClick={() => {
                const pinned = rollover?.confirmationRequired.length ?? 0;
                const confirmPinned = pinned > 0 ? window.confirm(copy.rolloverConfirm.replace("{{count}}", String(pinned))) : false;
                if (!confirmPinned && pinned > 0 && (rollover?.moves.length ?? 0) === 0) return;
                onRollover(confirmPinned);
              }}>
                <RotateCcw />{rollingOver ? copy.rollingOver : copy.rolloverCount.replace("{{count}}", String(rolloverCount))}
              </Button>
            ) : null}
            {urgentCount > 0 && onApplyUrgent ? (
              <Button size="sm" disabled={applyingUrgent} onClick={() => {
                const pinned = urgent?.confirmationRequired.length ?? 0;
                const confirmPinned = pinned > 0 ? window.confirm(copy.urgentConfirm.replace("{{count}}", String(pinned))) : false;
                if (!confirmPinned && pinned > 0 && (urgent?.insertions.every((item) => item.requiresPinnedConfirmation) ?? false)) return;
                onApplyUrgent(confirmPinned);
              }}>
                <AlertTriangle />{applyingUrgent ? copy.insertingUrgent : copy.insertUrgent}
              </Button>
            ) : null}
            {suggestedCount > 0 && onApplyPlan ? (
              <Button size="sm" onClick={onApplyPlan} disabled={applyingPlan}>
                <Sparkles />{applyingPlan ? copy.applyingPlan : copy.applyPlan}
              </Button>
            ) : null}
          </div>
        </div>

        {capacityExpanded && capacity ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border/80 bg-muted/20 px-5 py-2 text-xs text-muted-foreground" role="status" data-testid="local-capacity-summary">
            <span>{copy.queueDepth.replace("{{count}}", String(capacity.capacity.queueDepth))}</span>
            <span>{copy.worktreeLocks.replace("{{count}}", String(capacity.capacity.worktreeLocks))}</span>
            <span>{copy.executionDate}</span>
          </div>
        ) : null}

        <section className="border-b border-border/80 bg-muted/10 px-4 py-4" data-testid="ai-work-status-cards">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <WorkStatusFilterCard
              label={copy.allAiWork}
              value={aiCounts.all}
              tone="neutral"
              active={aiWorkFilter === "all"}
              onClick={() => setAiWorkFilter("all")}
            />
            <WorkStatusFilterCard
              label={copy.aiScheduled}
              value={aiCounts.scheduled}
              tone="neutral"
              active={aiWorkFilter === "scheduled"}
              onClick={() => setAiWorkFilter("scheduled")}
            />
            <WorkStatusFilterCard
              label={copy.aiRunning}
              value={aiCounts.running}
              tone="running"
              active={aiWorkFilter === "running"}
              onClick={() => setAiWorkFilter("running")}
            />
            <WorkStatusFilterCard
              label={copy.approvals}
              value={aiCounts.awaiting_approval}
              tone="warning"
              active={aiWorkFilter === "awaiting_approval"}
              onClick={() => setAiWorkFilter("awaiting_approval")}
            />
            <WorkStatusFilterCard
              label={copy.aiFailed}
              value={aiCounts.failed}
              tone="danger"
              active={aiWorkFilter === "failed"}
              onClick={() => setAiWorkFilter("failed")}
            />
            <WorkStatusFilterCard
              label={copy.reviewReady}
              value={aiCounts.completed}
              tone="success"
              active={aiWorkFilter === "completed"}
              onClick={() => setAiWorkFilter("completed")}
            />
          </div>
        </section>

        <section className="px-4 py-4" data-testid="active-ai-work">
          {filteredAiWorkItems.length ? (
            <div className="space-y-3">
              <div className="grid grid-flow-col auto-cols-[88%] gap-3 overflow-x-auto pb-1 [scrollbar-width:thin] lg:grid-flow-row lg:auto-cols-auto lg:grid-cols-3 lg:overflow-visible">
                <AiDateColumn
                  title={copy.yesterday}
                  subtitle={copy.executionDate}
                  date={formatDate(addDays(now, -1), locale)}
                  items={aiDateGroups.yesterday}
                  copy={copy}
                  locale={locale}
                  onOpenItem={onOpenItem}
                  onAction={runHomeAction}
                />
                <AiDateColumn
                  title={copy.today}
                  subtitle={copy.executionDate}
                  date={formatDate(now, locale)}
                  items={aiDateGroups.today}
                  copy={copy}
                  locale={locale}
                  onOpenItem={onOpenItem}
                  onAction={runHomeAction}
                  featured
                />
                <AiDateColumn
                  title={copy.tomorrow}
                  subtitle={copy.executionDate}
                  date={formatDate(addDays(now, 1), locale)}
                  items={aiDateGroups.tomorrow}
                  copy={copy}
                  locale={locale}
                  onOpenItem={onOpenItem}
                  onAction={runHomeAction}
                />
              </div>
              {aiDateGroups.other.length ? (
                <div className="rounded-xl border border-border bg-background/45 p-3.5">
                  <div className="mb-3 flex items-center gap-2">
                    <h3 className="text-sm font-semibold">{copy.otherDates}</h3>
                    <Badge tone="neutral">{aiDateGroups.other.length}</Badge>
                    <span className="text-xs text-muted-foreground">{copy.otherDatesHint}</span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {aiDateGroups.other.map((item) => (
                      <AiWorkCard key={item.workItemId} item={item} copy={copy} locale={locale} onOpenItem={onOpenItem} onAction={runHomeAction} />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid min-h-36 place-items-center rounded-xl border border-dashed border-border/80 bg-background/30 px-4 py-6 text-center">
              <div>
                <Bot className="mx-auto mb-2 size-6 text-muted-foreground" aria-hidden />
                <p className="text-sm font-medium">{copy.noAiWork}</p>
                <p className="mt-1 text-xs text-muted-foreground">{copy.noAiWorkHint}</p>
              </div>
            </div>
          )}
        </section>
      </Card>

      <WorkItemProgressDialog
        target={progressTarget}
        open={Boolean(progressTarget)}
        onClose={() => setProgressTarget(null)}
        onSaved={async () => { await onProgressRecorded?.(); }}
      />
    </div>
  );
}

function AiDateColumn({
  title,
  subtitle,
  date,
  items,
  copy,
  locale,
  onOpenItem,
  onAction,
  featured = false,
}: {
  title: string;
  subtitle: string;
  date: string;
  items: HomeWorkbenchItem[];
  copy: Copy;
  locale: string;
  onOpenItem: (item: WorkItem) => void;
  onAction: (item: HomeWorkbenchItem) => void;
  featured?: boolean;
}) {
  return (
    <section className={cn(
      "min-h-56 snap-start rounded-xl border p-3.5",
      featured ? "border-primary/35 bg-primary/[0.035]" : "border-border bg-background/45",
    )}>
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">{title}</h3>
        <Badge tone={featured ? "running" : "neutral"}>{items.length}</Badge>
        <span className="ml-auto text-[11px] text-muted-foreground">{date}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      <div className="mt-3 space-y-2">
        {items.length ? items.map((item) => (
          <AiWorkCard key={item.workItemId} item={item} copy={copy} locale={locale} onOpenItem={onOpenItem} onAction={onAction} />
        )) : (
          <div className="grid min-h-32 place-items-center rounded-lg border border-dashed border-border/80 px-3 text-center text-xs text-muted-foreground">
            {copy.noAiWork}
          </div>
        )}
      </div>
    </section>
  );
}

function AiWorkCard({
  item,
  copy,
  locale,
  onOpenItem,
  onAction,
}: {
  item: HomeWorkbenchItem;
  copy: Copy;
  locale: string;
  onOpenItem: (item: WorkItem) => void;
  onAction: (item: HomeWorkbenchItem) => void;
}) {
  const dueDate = formatDateOnly(item.dueDate, locale);
  const executionDate = formatDateOnly(item.plannedDate, locale);
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/35">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{copy.relation[item.requester.relation]}</Badge>
        <StatusBadge tone={executionTone(item.executionState)}>{copy.execution[item.executionState]}</StatusBadge>
      </div>
      <button type="button" onClick={() => onOpenItem(homeTaskWorkItem(item))} className="mt-2 block w-full min-w-0 text-left">
        <span className="block text-[11px] text-muted-foreground">{item.localRef}</span>
        <strong className="mt-0.5 block line-clamp-2 text-sm [overflow-wrap:anywhere]">{item.title}</strong>
      </button>
      <div className="mt-2 grid gap-0.5 text-[11px] text-muted-foreground">
        <span>{copy.executionDate}：{executionDate ?? copy.noExecutionDate}</span>
        <span>{copy.expectedCompletion}：{dueDate ?? copy.noExpectedCompletion}</span>
        <span>{item.ai?.agentName ?? item.ai?.agentId ?? copy.aiLabel}</span>
      </div>
      <div className="mt-2 flex justify-end border-t border-border/70 pt-2">
        <Button size="sm" variant="secondary" onClick={() => onAction(item)}>
          {copy.nextAction[item.nextAction.kind]}<ArrowRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function ClaimableWorkCard({
  item,
  copy,
  locale,
  claiming,
  claimDisabled,
  onOpen,
  onClaim,
}: {
  item: LocalWorkItem;
  copy: Copy;
  locale: string;
  claiming: boolean;
  claimDisabled: boolean;
  onOpen: () => void;
  onClaim?: () => void;
}) {
  const time = relativeTime(item.updatedAt, locale);
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <button type="button" onClick={onOpen} className="group flex w-full min-w-0 items-start gap-2 text-left">
        <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.localRef} · {item.title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{copy.localState[item.status]}</span>
        </span>
        <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </button>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 pt-2">
        <span className="text-[11px] text-muted-foreground">{time}</span>
        {onClaim ? (
          <Button size="sm" variant="secondary" disabled={claimDisabled} onClick={onClaim}>
            <Plus />{claiming ? copy.claiming : copy.claim}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function WorkStatusFilterCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: Tone;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "group min-w-0 rounded-xl border bg-card px-3 py-3 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary/60 bg-primary/[0.045]" : "border-border",
      )}
    >
      <span className={cn(
        "block text-xl font-semibold tabular-nums",
        tone === "warning" && "text-warning",
        tone === "running" && "text-primary",
        tone === "success" && "text-success",
        tone === "danger" && "text-destructive",
      )}>{value}</span>
      <span className={cn("mt-1 block truncate text-xs", active ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
    </button>
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
  onHomeAction,
  onHomeReport,
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
  onHomeAction: (item: HomeWorkbenchItem) => void;
  onHomeReport: (item: HomeWorkbenchItem) => void;
  featured?: boolean;
  headerExtra?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const perGroupLimit = 2;
  const [expandedGroups, setExpandedGroups] = useState<DailyGroupKey[]>([]);
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
        {items.length ? groups.map((group) => {
          const expanded = expandedGroups.includes(group.key);
          const hiddenCount = Math.max(0, group.items.length - perGroupLimit);
          return (
            <div key={group.key} className="space-y-1.5" data-testid={`daily-state-group-${group.key}`}>
              <div className="flex items-center gap-2 px-1 text-[11px] font-medium text-muted-foreground">
                <span>{displayStateLabel(group.items[0], copy)}</span>
                <span className="h-px flex-1 bg-border/70" aria-hidden />
                <span className="tabular-nums">{group.items.length}</span>
              </div>
              {group.items.slice(0, expanded ? undefined : perGroupLimit).map((item) => (
                <WorkCard
                  key={item.id}
                  item={item}
                  copy={copy}
                  locale={locale}
                  onOpen={() => onOpenItem(item)}
                  onAction={item.home ? () => onHomeAction(item.home!) : undefined}
                  onReport={item.home ? () => onHomeReport(item.home!) : undefined}
                />
              ))}
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpandedGroups((current) => expanded
                    ? current.filter((key) => key !== group.key)
                    : [...current, group.key])}
                  className="w-full rounded px-1 py-1 text-center text-[11px] font-medium text-primary hover:bg-primary/5"
                >
                  {expanded ? copy.less : copy.more.replace("{{count}}", String(hiddenCount))}
                </button>
              ) : null}
            </div>
          );
        }) : (
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
  onAction,
  onReport,
}: {
  item: DailyWorkItem;
  copy: Copy;
  locale: string;
  onOpen: () => void;
  onAction?: () => void;
  onReport?: () => void;
}) {
  const time = relativeTime(item.updatedAt, locale);
  const scheduleReason = item.scheduleReason ? copy.scheduleReasons[item.scheduleReason] ?? item.scheduleReason : null;
  const Icon = item.state === "done"
    ? CheckCircle2
    : item.state === "failed" || item.state === "follow_up"
      ? AlertTriangle
      : item.state === "in_progress"
        ? CircleDot
        : Clock3;
  const home = item.home;
  const requester = home
    ? `${copy.relation[home.requester.relation]}${home.requester.name ? ` · ${home.requester.name}` : ""}`
    : copy.relation[item.requesterRelation ?? "unknown"];
  const dueDate = formatDateOnly(item.dueDate ?? home?.dueDate, locale);
  return (
    <div
      className={cn(
        "group w-full rounded-lg border border-border border-l-2 bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/45",
        STATE_ACCENT[item.state],
      )}
    >
      <span className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral" className="max-w-full whitespace-normal [overflow-wrap:anywhere]">{requester}</Badge>
          {home ? (
            <>
          <Badge tone={home.priority === "p0" ? "danger" : home.priority === "p1" ? "warning" : "neutral"}>{home.priority.toUpperCase()}</Badge>
          {home.attentionReason ? <span className="text-[11px] text-warning">{copy.attentionReason[home.attentionReason]}</span> : null}
            </>
          ) : null}
        </span>
      <button type="button" onClick={onOpen} className="flex w-full min-w-0 items-start gap-2 text-left">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere]">{item.title}</span>
          {scheduleReason || item.subtitle || item.reason ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{scheduleReason ?? item.reason ?? item.subtitle}</span>
          ) : null}
        </span>
        <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </button>
      {home ? (
        <div className="mt-2 grid gap-0.5 text-[11px] text-muted-foreground">
          <span>{copy.expectedCompletion}：{dueDate ?? copy.noExpectedCompletion}</span>
          <span>{copy.owner}：{home.assignees.map((assignee) => assignee.name).join(", ") || "—"}</span>
          <span>{copy.waitingLabel}：{copy.waiting[home.waitingOn]}</span>
          {home.report ? (
            <span className={home.report.stale ? "text-warning" : ""}>
              {home.report.stale ? copy.report.stale : copy.report[home.report.status]}
            </span>
          ) : null}
        </div>
      ) : <div className="mt-2 text-[11px] text-muted-foreground">{copy.expectedCompletion}：{dueDate ?? copy.noExpectedCompletion}</div>}
      <span className="mt-2 flex items-center justify-between gap-2">
        <StatusBadge tone={displayStateTone(item)}>{displayStateLabel(item, copy)}</StatusBadge>
        <span className="flex items-center gap-2">
          {time ? <span className="text-[11px] text-muted-foreground">{time}</span> : null}
          {home && onAction ? (
            <Button size="sm" variant="secondary" onClick={onAction}>{copy.nextAction[home.nextAction.kind]}</Button>
          ) : null}
          {home && onReport ? (
            <Button size="sm" variant="ghost" onClick={onReport}>{home.report ? copy.report.review : copy.report.prepare}</Button>
          ) : null}
        </span>
      </span>
    </div>
  );
}

function homeActionWorkItem(item: HomeWorkbenchItem): WorkItem {
  return {
    id: `home:${item.workItemId}:${item.nextAction.kind}`,
    state: item.executionState === "failed"
      ? "failed"
      : item.executionState === "running" ? "in_progress" : item.needsAttention ? "follow_up" : "waiting",
    kind: `home_${item.nextAction.kind}`,
    title: item.title,
    section: item.nextAction.section,
    targetId: item.nextAction.targetId,
    projectId: item.projectId,
    updatedAt: item.ai?.updatedAt ?? null,
  };
}

function homeTaskWorkItem(item: HomeWorkbenchItem): WorkItem {
  return {
    id: `home:${item.workItemId}:task`,
    state: item.needsAttention ? "follow_up" : "waiting",
    kind: "local_work_item",
    title: item.title,
    section: "task",
    targetId: item.workItemId,
    projectId: item.projectId,
    updatedAt: item.ai?.updatedAt ?? null,
  };
}

function homeReportWorkItem(item: HomeWorkbenchItem): WorkItem {
  return {
    id: `home:${item.workItemId}:report`,
    state: item.report?.stale ? "follow_up" : "waiting",
    kind: "home_report_review",
    title: item.title,
    section: "task",
    targetId: item.workItemId,
    projectId: item.projectId,
    updatedAt: item.report?.updatedAt ?? null,
  };
}
