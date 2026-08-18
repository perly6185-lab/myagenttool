import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Clock3,
  ListChecks,
  LoaderCircle,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import type { PendingDecision, WorkBoard, WorkItem, WorkReport, WorkState } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type {
  LocalScheduleCapacityResponse,
  LocalSchedulePreviewResponse,
  LocalScheduleRolloverResponse,
  LocalScheduleUrgentResponse,
} from "@/lib/api-client";
import type { LocalWorkItem, WorkItemRequesterRelation } from "@/features/tasks/task-view-types";
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
  completedOn: string;
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
  columnSwipeHint: string;
  mobileOther: string;
  scheduleScope: string;
  refreshing: string;
  updatedAt: string;
  unassigned: string;
  unassignedHint: string;
  noMyTasks: string;
  noMyTasksHint: string;
  createFirstTask: string;
  quickCreateTask: string;
  claim: string;
  claiming: string;
  handOffAi: string;
  handingOffAi: string;
  handOffAiError: string;
  myWork: string;
  myWorkHint: string;
  allMyWork: string;
  peopleCategory: string;
  otherPeople: string;
  needsMine: string;
  waitingMe: string;
  approvals: string;
  automationApprovals: string;
  aiFailed: string;
  dueToday: string;
  reviewReady: string;
  automationCompleted: string;
  activeAi: string;
  aiWorkHint: string;
  allAiWork: string;
  aiRunning: string;
  aiScheduled: string;
  noAiWork: string;
  noAiWorkHint: string;
  selectTaskForAi: string;
  executionDate: string;
  noExecutionDate: string;
  expectedCompletion: string;
  noExpectedCompletion: string;
  otherDates: string;
  otherDatesHint: string;
  owner: string;
  waitingLabel: string;
  aiLabel: string;
  coordination: {
    aiNotLinked: string;
    executionAfterCompletion: string;
    aiUnscheduled: string;
    reviewPending: string;
    locateAi: string;
    locateMy: string;
    located: string;
    backToAi: string;
    backToMy: string;
  };
  actionQueue: {
    title: string;
    hint: string;
    all: string;
    urgent: string;
    pending: string;
    review: string;
    adjustExecution: string;
    scheduleAi: string;
    scheduleTitle: string;
    scheduleHint: string;
    saveSchedule: string;
    savingSchedule: string;
    cancelSchedule: string;
    scheduleError: string;
    aiNeedsAnswer: string;
    dependencyBlocked: string;
    waitingAuthorizedMember: string;
    viewProgress: string;
  };
  rolloverPrompt: {
    title: string;
    description: string;
    plan: string;
    pinnedLabel: string;
    pinned: string;
    unscheduled: string;
    all: string;
    individual: string;
    later: string;
    open: string;
    unavailable: string;
  };
  dailyBrief: {
    title: string;
    summary: string;
    due: string;
    actions: string;
    aiMoving: string;
    conflict: string;
    nextUp: string;
    allClear: string;
    startFocus: string;
    reviewPlan: string;
  };
  focusMode: {
    title: string;
    position: string;
    timeline: string;
    commitmentDate: string;
    followUpDate: string;
    noDate: string;
    expectedOutcome: string;
    outcomeNext: string;
    outcomeSchedule: string;
    previous: string;
    next: string;
    exit: string;
  };
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
    title: "任务日程",
    subtitle: "复盘昨天，执行今天，规划明天",
    overview: "打开完整任务列表",
    todayProgress: "今日进度",
    attention: "待处理",
    active: "进行中",
    completed: "已完成",
    completedOn: "完成日期",
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
    terminalOffline: "这台电脑暂时不可执行",
    terminalCapacity: "可用槽位 {{available}} / {{total}}",
    queueDepth: "队列 {{count}}",
    worktreeLocks: "工作区锁 {{count}}",
    unscheduled: "稍后 / 未排期",
    unscheduledHint: "包含更晚完成的任务，以及尚未设置完成日期的任务。",
    columnSwipeHint: "选择日期，或左右滑动查看任务",
    mobileOther: "稍后",
    scheduleScope: "调度范围：所有项目",
    refreshing: "正在更新调度…",
    updatedAt: "调度更新于 {{time}}",
    unassigned: "待认领",
    unassignedHint: "尚未分配的任务会显示在这里；认领后才会进入你的安排，并占用这台电脑的执行名额。",
    noMyTasks: "还没有安排任务",
    noMyTasksHint: "创建第一项任务后，就能按完成日期安排今天和接下来的工作。",
    createFirstTask: "创建任务",
    quickCreateTask: "快速创建任务",
    claim: "认领",
    claiming: "认领中…",
    handOffAi: "交给 AI",
    handingOffAi: "正在交给 AI…",
    handOffAiError: "暂时无法交给 AI，请打开任务检查执行条件后重试。",
    myWork: "我的安排",
    myWorkHint: "按负责人和预计完成日期安排任务",
    allMyWork: "全部任务",
    peopleCategory: "按关系筛选",
    otherPeople: "其他 / 未归类",
    needsMine: "需要我处理",
    waitingMe: "待我回复",
    approvals: "AI 待审批",
    automationApprovals: "待审批",
    aiFailed: "AI 执行失败",
    dueToday: "今日到期",
    reviewReady: "待复核与汇报",
    automationCompleted: "已完成",
    activeAi: "AI 执行",
    aiWorkHint: "查看交给 AI 的任务及执行时间；所有任务仍统一保留在“我的任务”中",
    allAiWork: "全部 AI 任务",
    aiRunning: "执行中",
    aiScheduled: "待执行",
    noAiWork: "暂无 AI 执行任务",
    noAiWorkHint: "交给 AI 的任务会显示在这里，并按执行日期排列。",
    selectTaskForAi: "选择任务交给 AI",
    executionDate: "AI 执行日期",
    noExecutionDate: "未安排执行日期",
    expectedCompletion: "预期完成",
    noExpectedCompletion: "未设置预期完成日期",
    otherDates: "稍后 / 未排期",
    otherDatesHint: "包含稍后执行以及尚未安排执行日期的 AI 任务。",
    owner: "负责人",
    waitingLabel: "人",
    aiLabel: "执行方式",
    coordination: {
      aiNotLinked: "尚未自动执行",
      executionAfterCompletion: "自动执行晚于预期完成",
      aiUnscheduled: "自动执行已关联，但尚未安排执行日期",
      reviewPending: "自动执行已完成，等待人工复核",
      locateAi: "在自动执行看板定位",
      locateMy: "在我的安排中定位",
      located: "已临时显示对应任务，原筛选保持不变",
      backToAi: "返回自动执行看板",
      backToMy: "返回我的安排",
    },
    actionQueue: {
      title: "需要我处理",
      hint: "只显示确实需要你决策、复核、补充信息或处理异常的任务；每项任务只保留一个下一步",
      all: "全部",
      urgent: "需重点处理",
      pending: "待行动",
      review: "待复核",
      adjustExecution: "调整执行日期",
      scheduleAi: "安排 AI",
      scheduleTitle: "安排 AI 执行日期",
      scheduleHint: "保存后会刷新两个看板中的同一任务。",
      saveSchedule: "保存日期",
      savingSchedule: "正在保存…",
      cancelSchedule: "取消",
      scheduleError: "执行日期保存失败，请重试。",
      aiNeedsAnswer: "AI 正在等你回答，收到答案后会继续执行",
      dependencyBlocked: "需要先完成前置任务",
      waitingAuthorizedMember: "正在等待有操作权限的成员处理，你无需操作。",
      viewProgress: "查看进展",
    },
    rolloverPrompt: {
      title: "昨日未完成事项",
      description: "有 {{count}} 项未完成工作需要安排，避免它们被遗漏。",
      plan: "以下事项可以进入今天的执行计划",
      pinnedLabel: "固定日期",
      pinned: "其中 {{count}} 项是手动固定日期，全部结转后会移动到今天。",
      unscheduled: "有 {{count}} 项暂时没有可用执行日期，请稍后调整容量或日期。",
      all: "全部结转到今天",
      individual: "逐项处理",
      later: "暂不处理",
      open: "查看任务",
      unavailable: "暂时无法安排",
    },
    dailyBrief: {
      title: "今日协同简报",
      summary: "今天有 {{due}} 项预期完成，当前 {{actions}} 项需要你行动；自动处理中的任务有 {{ai}} 项。",
      due: "今日到期",
      actions: "需要我处理",
      aiMoving: "自动处理中",
      conflict: "其中 {{count}} 项存在个人预期与自动执行日期冲突。",
      nextUp: "建议先处理",
      allClear: "当前没有需要你介入的事项，自动任务会继续按计划推进。",
      startFocus: "开始第一个行动",
      reviewPlan: "查看需要我处理",
    },
    focusMode: {
      title: "专注处理",
      position: "第 {{current}} / {{total}} 项",
      timeline: "时间安排",
      commitmentDate: "承诺日期",
      followUpDate: "下次跟进",
      noDate: "未设置",
      expectedOutcome: "完成这一步后",
      outcomeNext: "系统会刷新状态，并继续显示下一项需要你处理的工作。",
      outcomeSchedule: "个人预期与自动执行安排会重新对齐。",
      previous: "上一项",
      next: "下一项",
      exit: "结束专注",
    },
    execution: { unclaimed: "尚未执行", claimed: "已认领", running: "执行中", awaiting_approval: "等待审批", verifying: "验证中", failed: "执行失败", completed: "等待复核" },
    relation: { boss: "老板", manager: "上级", customer: "客户", child: "小孩学习", colleague: "同事", self: "自己", unknown: "未标注" },
    waiting: { me: "等我", requester: "等提出者", internal: "等内部成员", ai: "等 AI", none: "无需等待" },
    attentionReason: {
      ai_needs_input: "AI 正在等你回答", overdue: "承诺或截止时间已逾期", approval_required: "需要人工审批", ai_failed: "执行失败，需要人工处理", dependency_blocked: "前置任务尚未完成",
      review_ready: "结果已就绪，等待人工复核", user_action_required: "轮到你处理", follow_up_due: "已到跟进时间", waiting_requester: "等待提出者回复",
      waiting_internal: "等待内部成员", ai_running: "执行中，无需人工处理", planned: "已安排",
    },
    nextAction: { open_issue: "查看任务", record_progress: "跟进", review_result: "审核结果", open_approval: "审批", open_run: "查看运行", retry: "处理失败", answer_ai: "回答 AI" },
    report: { draft: "汇报草稿", confirmed: "汇报已确认", stale: "汇报已过期", prepare: "准备汇报", review: "复核汇报" },
    scheduleReasons: {
      manual_retry_today: "重新执行，已安排到今天",
      auto_run_failed: "运行失败，需先复盘或重试",
      auto_run_blocked: "运行被阻塞",
      auto_run_needs_input: "等待补充信息",
      auto_run_awaiting_approval: "等待审批",
      auto_run_decision_required: "等待人工决策",
      auto_run_pr_open: "等待 PR 处理",
      auto_run_not_ready: "当前尚不可执行",
      work_item_blocked: "任务被阻塞",
      review_required: "等待评审",
      terminal_unavailable: "这台电脑暂时不可用",
      terminal_at_capacity: "这台电脑的执行名额已满",
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
    title: "Task schedule",
    subtitle: "Review yesterday, execute today, plan tomorrow",
    overview: "Open full task list",
    todayProgress: "Today's progress",
    attention: "Attention",
    active: "In progress",
    completed: "Completed",
    completedOn: "Completed on",
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
    unscheduled: "Later / unscheduled",
    unscheduledHint: "Tasks due later or missing an expected completion date.",
    columnSwipeHint: "Choose a date or swipe horizontally through tasks",
    mobileOther: "Later",
    scheduleScope: "Schedule scope: All projects",
    refreshing: "Refreshing schedule…",
    updatedAt: "Schedule updated {{time}}",
    unassigned: "Unassigned",
    unassignedHint: "Unassigned tasks appear here. After you claim one, it enters your schedule and uses an execution slot on this computer.",
    noMyTasks: "No tasks scheduled yet",
    noMyTasksHint: "Create your first task to start arranging today and upcoming work by completion date.",
    createFirstTask: "Create task",
    quickCreateTask: "Quick create task",
    claim: "Claim",
    claiming: "Claiming…",
    handOffAi: "Hand off to AI",
    handingOffAi: "Handing off…",
    handOffAiError: "Could not hand this task to AI. Open the task, check its execution requirements, and try again.",
    myWork: "My schedule",
    myWorkHint: "Arrange tasks by owner and expected completion date",
    allMyWork: "All tasks",
    peopleCategory: "Filter by relationship",
    otherPeople: "Other / unlabeled",
    needsMine: "Needs my action",
    waitingMe: "Waiting on me",
    approvals: "AI approvals",
    automationApprovals: "Approval required",
    aiFailed: "Automation failed",
    dueToday: "Due today",
    reviewReady: "Review and report",
    automationCompleted: "Completed",
    activeAi: "AI execution",
    aiWorkHint: "See tasks handed to AI and their execution dates; every task still remains in My tasks",
    allAiWork: "All AI tasks",
    aiRunning: "Running",
    aiScheduled: "Scheduled",
    noAiWork: "No automated work yet",
    noAiWorkHint: "Tasks handed to AI appear here, arranged by execution date.",
    selectTaskForAi: "Choose a task for AI",
    executionDate: "Automated execution date",
    noExecutionDate: "No execution date",
    expectedCompletion: "Expected completion",
    noExpectedCompletion: "Expected completion not set",
    otherDates: "Later / unscheduled",
    otherDatesHint: "Automated tasks scheduled later or missing an execution date.",
    owner: "Owner",
    waitingLabel: "People",
    aiLabel: "Execution",
    coordination: {
      aiNotLinked: "Not automated yet",
      executionAfterCompletion: "Automated execution is after expected completion",
      aiUnscheduled: "Automated execution has no execution date",
      reviewPending: "Automated execution completed; awaiting human review",
      locateAi: "Locate in automated work",
      locateMy: "Locate in My schedule",
      located: "Temporarily showing this task without changing your filter",
      backToAi: "Back to automated work",
      backToMy: "Back to My schedule",
    },
    actionQueue: {
      title: "Needs my action",
      hint: "Only tasks that need your decision, review, input, or exception handling; one next step per task",
      all: "All",
      urgent: "Needs attention",
      pending: "Pending action",
      review: "Ready for review",
      adjustExecution: "Adjust execution date",
      scheduleAi: "Schedule AI",
      scheduleTitle: "Schedule AI execution",
      scheduleHint: "Saving refreshes the same task in both boards.",
      saveSchedule: "Save date",
      savingSchedule: "Saving…",
      cancelSchedule: "Cancel",
      scheduleError: "Could not save the execution date. Try again.",
      aiNeedsAnswer: "AI is waiting for your answer and will continue after you reply",
      dependencyBlocked: "Complete the prerequisite task first",
      waitingAuthorizedMember: "Waiting for a member with permission. You do not need to act.",
      viewProgress: "View progress",
    },
    rolloverPrompt: {
      title: "Unfinished work from yesterday",
      description: "{{count}} unfinished item(s) need a plan so they do not get lost.",
      plan: "These items can move into today's execution plan",
      pinnedLabel: "Pinned",
      pinned: "{{count}} item(s) have manually pinned dates and will move to today when carried over.",
      unscheduled: "{{count}} item(s) have no feasible execution date yet. Adjust capacity or dates later.",
      all: "Carry all to today",
      individual: "Handle one by one",
      later: "Not now",
      open: "View task",
      unavailable: "Not schedulable yet",
    },
    dailyBrief: {
      title: "Today's coordination brief",
      summary: "Today: {{due}} due, {{actions}} need your action, automated work in progress: {{ai}}.",
      due: "Due today",
      actions: "Needs my action",
      aiMoving: "Automation moving",
      conflict: "Date conflicts between your expectation and automated execution: {{count}}.",
      nextUp: "Start with",
      allClear: "Nothing needs your intervention now. Automated work will keep moving the plan forward.",
      startFocus: "Start first action",
      reviewPlan: "Review needs my action",
    },
    focusMode: {
      title: "Focus session",
      position: "Item {{current}} of {{total}}",
      timeline: "Timeline",
      commitmentDate: "Commitment date",
      followUpDate: "Next follow-up",
      noDate: "Not set",
      expectedOutcome: "After this step",
      outcomeNext: "The board refreshes and continues with the next item that needs you.",
      outcomeSchedule: "Your expected completion and the automated execution plan will be realigned.",
      previous: "Previous",
      next: "Next",
      exit: "End focus",
    },
    execution: { unclaimed: "Not started", claimed: "Claimed", running: "Running", awaiting_approval: "Awaiting approval", verifying: "Verifying", failed: "Execution failed", completed: "Ready for review" },
    relation: { boss: "Boss", manager: "Manager", customer: "Customer", child: "Child learning", colleague: "Colleague", self: "Self", unknown: "Not labeled" },
    waiting: { me: "Waiting on me", requester: "Waiting on requester", internal: "Waiting on internal", ai: "Waiting on AI", none: "Not waiting" },
    attentionReason: {
      ai_needs_input: "AI is waiting for your answer", overdue: "Commitment or due date overdue", approval_required: "Needs human approval", ai_failed: "Execution failed; needs human action", dependency_blocked: "A prerequisite task is incomplete",
      review_ready: "Result ready for human review", user_action_required: "Needs your action", follow_up_due: "Follow-up is due", waiting_requester: "Waiting for requester",
      waiting_internal: "Waiting for internal member", ai_running: "Execution in progress; no human action", planned: "Planned",
    },
    nextAction: { open_issue: "View task", record_progress: "Follow up", review_result: "Review result", open_approval: "Approve", open_run: "View run", retry: "Handle failure", answer_ai: "Answer AI" },
    report: { draft: "Report draft", confirmed: "Report confirmed", stale: "Report stale", prepare: "Prepare report", review: "Review report" },
    scheduleReasons: {
      manual_retry_today: "Retry scheduled for today",
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
type ActionQueueFilter = "all" | "danger" | "warning" | "running";
type DailyGroupKey = WorkState | LocalWorkItem["status"];
type WorkView = "my" | "ai";
type DateColumnKey = "yesterday" | "today" | "tomorrow" | "other";

export function hasAutomatedExecution(item: HomeWorkbenchItem): boolean {
  return Boolean(item.executionKind || item.ai);
}

export const hasAiExecution = hasAutomatedExecution;

function isAiWorking(item: HomeWorkbenchItem): boolean {
  if (item.ai?.status === "needs_input") return false;
  return item.userStatus ? item.userStatus === "ai_working" : ["claimed", "running", "verifying"].includes(item.executionState);
}

function isAutomationReviewReady(item: HomeWorkbenchItem): boolean {
  return item.userStatus
    ? item.userStatus === "ready_for_review"
    : item.executionState === "completed" && item.planningStatus !== "done";
}

function isAutomationCompleted(item: HomeWorkbenchItem): boolean {
  return item.userStatus === "completed"
    || (item.executionState === "completed" && item.planningStatus === "done");
}

export function canHandOffToAi(item: HomeWorkbenchItem): boolean {
  return !hasAutomatedExecution(item)
    && item.executionState === "unclaimed"
    && item.planningStatus === "ready";
}
type FocusedIssue = { workItemId: string; view: WorkView; originView: WorkView; nonce: number };

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

const RECENT_COMPLETION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function isCompletedLocal(item: LocalWorkItem): boolean {
  return item.state === "closed" || item.status === "done";
}

function completionDate(item: LocalWorkItem): string | null {
  return isCompletedLocal(item) ? dateKey(item.completedAt ?? item.updatedAt) : item.dueDate;
}

function isVisibleLocal(item: LocalWorkItem, now: number): boolean {
  if (item.archivedAt) return false;
  if (!isCompletedLocal(item)) return true;
  const finishedAt = Date.parse(item.completedAt ?? item.updatedAt ?? "");
  return Number.isFinite(finishedAt) && finishedAt >= now - RECENT_COMPLETION_RETENTION_MS;
}

function displayState(item: DailyWorkItem): DailyGroupKey {
  return item.planningStatus ?? item.state;
}

function displayStateLabel(item: DailyWorkItem, copy: Copy): string {
  return item.planningStatus ? copy.localState[item.planningStatus] : copy.state[item.state];
}

function displayStateTone(item: DailyWorkItem): Tone {
  return item.planningStatus ? LOCAL_STATE_TONE[item.planningStatus] : STATE_TONE[item.state];
}

function executionTone(state: HomeWorkbenchItem["executionState"], userStatus?: HomeWorkbenchItem["userStatus"]): Tone {
  if (userStatus === "ready_for_review" || userStatus === "completed") return "success";
  if (state === "failed") return "danger";
  if (state === "awaiting_approval") return "warning";
  if (state === "completed") return "success";
  if (["running", "verifying"].includes(state)) return "running";
  return "neutral";
}

function executionLabel(item: HomeWorkbenchItem, copy: Copy): string {
  if (item.userStatus === "ready_for_review") return copy.attentionReason.review_ready;
  if (item.userStatus === "ai_working") return copy.execution.running;
  return item.executionState === "completed" && item.planningStatus === "done"
    ? copy.completed
    : copy.execution[item.executionState];
}

function executionTypeLabel(item: HomeWorkbenchItem, locale: string, copy: Copy): string {
  if (item.executionKind === "article_import") return locale.startsWith("zh") ? "公众号导入" : "Article import";
  if (item.executionKind === "article_derivative") return locale.startsWith("zh") ? "内容衍生" : "Article derivative";
  if (item.ai) return "AI";
  return copy.aiLabel;
}

function executionActorLabel(item: HomeWorkbenchItem, locale: string, copy: Copy): string {
  if (item.executionKind === "article_import") return executionTypeLabel(item, locale, copy);
  return item.ai?.agentName ?? item.ai?.agentId ?? executionTypeLabel(item, locale, copy);
}

function homeVisibilityRank(item: HomeWorkbenchItem): number {
  if (item.attentionReason === "ai_failed" || item.executionState === "failed") return 0;
  if (item.attentionReason === "approval_required" || item.executionState === "awaiting_approval") return 1;
  if (item.userStatus === "ready_for_review" || item.attentionReason === "review_ready") return 2;
  if (["claimed", "running", "verifying"].includes(item.executionState)) return 2;
  if (item.executionState === "completed") return 3;
  return 5;
}

function homeActivityTime(item: HomeWorkbenchItem): number {
  const value = Date.parse(item.executionUpdatedAt ?? item.ai?.updatedAt ?? item.completedAt ?? "");
  return Number.isFinite(value) ? value : 0;
}

function compareHomeVisibility(left: HomeWorkbenchItem, right: HomeWorkbenchItem): number {
  const leftRank = homeVisibilityRank(left);
  const rightRank = homeVisibilityRank(right);
  const rankDifference = leftRank - rightRank;
  if (rankDifference) return rankDifference;
  if (leftRank === 5) return 0;
  return homeActivityTime(right) - homeActivityTime(left)
    || right.workItemId.localeCompare(left.workItemId);
}

function compareDailyVisibility(left: DailyWorkItem, right: DailyWorkItem): number {
  if (left.home && right.home) return compareHomeVisibility(left.home, right.home);
  if (left.home) return -1;
  if (right.home) return 1;
  return Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? "");
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
  const timestamp = value.includes("T") ? Date.parse(value) : Date.parse(`${value}T12:00:00`);
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
    state: runtime?.state ?? (isCompletedLocal(item) ? "done" : LOCAL_STATUS_STATE[item.status]),
    planningStatus: isCompletedLocal(item) ? "done" : item.status,
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
  const visibleLocal = plannedItems.filter((item) => isVisibleLocal(item, now));
  const localDate = (item: DailyLocalWorkItem) => completionDate(item);
  const yesterdayLocal = visibleLocal.filter((item) => Boolean(localDate(item) && localDate(item)! <= yesterdayKey)).sort(compareLocal);
  const todayLocal = visibleLocal.filter((item) => localDate(item) === todayKey).sort(compareLocal);
  const tomorrowLocal = visibleLocal.filter((item) => localDate(item) === tomorrowKey).sort(compareLocal);
  const otherLocal = visibleLocal
    .filter((item) => !localDate(item) || localDate(item)! > tomorrowKey)
    .sort((left, right) => String(localDate(left) ?? "9999-12-31").localeCompare(String(localDate(right) ?? "9999-12-31")) || compareLocal(left, right));

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
    todayCompleted: runtimeFallback ? flow?.completed ?? 0 : todayLocal.filter(isCompletedLocal).length,
    todayFailed: flow?.failed ?? 0,
    attention: runtimeFallback
      ? (states?.pending_decision?.count ?? 0) + (states?.follow_up?.count ?? 0)
      : visibleLocal.filter((item) => !isCompletedLocal(item) && (item.status === "blocked" || Boolean(item.dueDate && item.dueDate < todayKey))).length,
    active: runtimeFallback ? states?.in_progress?.count ?? 0 : visibleLocal.filter((item) => !isCompletedLocal(item) && ["in_progress", "review"].includes(item.status)).length,
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
  autoRolloverPrompt = false,
  urgent,
  approvals = [],
  onOpenItem,
  onOpenApproval,
  onOpenTasks,
  onCreateTask,
  onClaimItem,
  onStartAi,
  onUpdatePlannedDate,
  dailyBriefContainer,
  focusSessionActive = false,
  focusPendingWorkItemId = null,
  focusResolvedWorkItemId = null,
  onStartFocusSession,
  onFocusActionLaunched,
  onFocusActionResolved,
  onEndFocusSession,
  claimingItemId = null,
  claimError = null,
  onApplyPlan,
  applyingPlan = false,
  onRollover,
  rollingOver = false,
  onApplyUrgent,
  applyingUrgent = false,
  refreshing = false,
  updatedAt = null,
  now = Date.now(),
  canOperate = true,
}: {
  board?: WorkBoard;
  report?: WorkReport;
  plannedItems?: LocalWorkItem[];
  workbench?: HomeWorkbench;
  unassignedItems?: LocalWorkItem[];
  capacity?: LocalScheduleCapacityResponse;
  preview?: LocalSchedulePreviewResponse;
  rollover?: LocalScheduleRolloverResponse;
  autoRolloverPrompt?: boolean;
  urgent?: LocalScheduleUrgentResponse;
  approvals?: PendingDecision[];
  onOpenApproval?: (decision: PendingDecision) => void;
  onOpenItem: (item: WorkItem) => void;
  onOpenTasks: () => void;
  onCreateTask?: () => void;
  onOpenAttention?: () => void;
  onOpenActive?: () => void;
  onOpenCompleted?: () => void;
  onOpenFailed?: () => void;
  onClaimItem?: (item: LocalWorkItem) => void;
  onStartAi?: (item: HomeWorkbenchItem) => void | Promise<void>;
  onUpdatePlannedDate?: (item: HomeWorkbenchItem, plannedDate: string) => void | Promise<void>;
  dailyBriefContainer?: HTMLElement | null;
  focusSessionActive?: boolean;
  focusPendingWorkItemId?: string | null;
  focusResolvedWorkItemId?: string | null;
  onStartFocusSession?: () => void;
  onFocusActionLaunched?: (workItemId: string) => void;
  onFocusActionResolved?: (workItemId: string) => void;
  onEndFocusSession?: () => void;
  claimingItemId?: string | null;
  claimError?: string | null;
  onApplyPlan?: () => void;
  applyingPlan?: boolean;
  onRollover?: (confirmPinned: boolean) => void | Promise<unknown>;
  rollingOver?: boolean;
  onApplyUrgent?: (confirmPinned: boolean) => void;
  applyingUrgent?: boolean;
  refreshing?: boolean;
  updatedAt?: string | null;
  now?: number;
  canOperate?: boolean;
}) {
  const [unassignedExpanded, setUnassignedExpanded] = useState(false);
  const [capacityExpanded, setCapacityExpanded] = useState(false);
  const [actionQueueExpanded, setActionQueueExpanded] = useState(false);
  const [actionQueueFilter, setActionQueueFilter] = useState<ActionQueueFilter>("all");
  const [rolloverPromptOpen, setRolloverPromptOpen] = useState(false);
  const [activeWorkView, setActiveWorkView] = useState<WorkView>("my");
  const [myDateColumn, setMyDateColumn] = useState<DateColumnKey>("today");
  const [aiDateColumn, setAiDateColumn] = useState<DateColumnKey>("today");
  const [myWorkFilter, setMyWorkFilter] = useState<WorkItemRequesterRelation | "all" | "other">("all");
  const [aiWorkFilter, setAiWorkFilter] = useState<"all" | "scheduled" | "running" | "awaiting_approval" | "failed" | "review_ready" | "completed">("all");
  const [focusedIssue, setFocusedIssue] = useState<FocusedIssue | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<HomeWorkbenchItem | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [schedulePending, setSchedulePending] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [startingAiWorkItemId, setStartingAiWorkItemId] = useState<string | null>(null);
  const [startAiError, setStartAiError] = useState<string | null>(null);
  const [focusTargetId, setFocusTargetId] = useState<string | null>(null);
  const myDateColumnsRef = useRef<HTMLDivElement>(null);
  const aiDateColumnsRef = useRef<HTMLDivElement>(null);
  const myDateNavigationReady = useRef(false);
  const aiDateNavigationReady = useRef(false);
  const { i18n } = useAppTranslation();
  const locale = i18n.language.startsWith("zh") ? "zh-CN" : "en-US";
  const copy = COPY[locale === "zh-CN" ? "zh" : "en"];
  const relationCounts = {
    self: workbench?.summary.byRelation.self ?? plannedItems.filter((item) => item.requesterRelation === "self").length,
    boss: workbench?.summary.byRelation.boss ?? plannedItems.filter((item) => item.requesterRelation === "boss").length,
    manager: workbench?.summary.byRelation.manager ?? plannedItems.filter((item) => item.requesterRelation === "manager").length,
    customer: workbench?.summary.byRelation.customer ?? plannedItems.filter((item) => item.requesterRelation === "customer").length,
    child: workbench?.summary.byRelation.child ?? plannedItems.filter((item) => item.requesterRelation === "child").length,
    other: workbench
      ? workbench.summary.byRelation.colleague + workbench.summary.byRelation.unknown
      : plannedItems.filter((item) => item.requesterRelation === "colleague" || item.requesterRelation === "unknown").length,
  };
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
  const previewById = new Map(previewItems.map((item) => [item.id, item]));
  const projectedWorkbenchItems = workbenchItems.map((item) => ({
    ...item,
    plannedDate: previewById.get(item.workItemId)?.plannedDate ?? item.plannedDate,
  }));
  const myWorkFilterActive = myWorkFilter !== "all";
  const baseModel = buildDailyWorkBoardModel(previewBoard, report, now, previewItems, projectedWorkbenchItems);
  const showMyEmptyState = Boolean(workbench
    && workbench.summary.total === 0
    && baseModel.yesterday.length + baseModel.today.length + baseModel.tomorrow.length + baseModel.unscheduled.length === 0);
  const filterItems = (items: WorkItem[]) => items.filter((item) => {
    const row = item as DailyWorkItem;
    const workItemId = row.home?.workItemId ?? row.targetId;
    if (focusedIssue?.view === "my" && focusedIssue.workItemId === workItemId) return true;
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
  const aiWorkItems = projectedWorkbenchItems.filter(hasAutomatedExecution);
  const actionQueue = buildActionQueue(projectedWorkbenchItems, copy, canOperate);
  const actionQueueCounts: Record<ActionQueueFilter, number> = {
    all: actionQueue.length,
    danger: actionQueue.filter((item) => item.tone === "danger").length,
    warning: actionQueue.filter((item) => item.tone === "warning").length,
    running: actionQueue.filter((item) => item.tone === "running").length,
  };
  const filteredActionQueue = actionQueueFilter === "all"
    ? actionQueue
    : actionQueue.filter((item) => item.tone === actionQueueFilter);
  const todayDueCount = projectedWorkbenchItems.filter((item) => item.dueDate === currentDay && item.planningStatus !== "done").length;
  const aiMovingCount = aiWorkItems.filter(isAiWorking).length;
  const scheduleConflictCount = actionQueue.filter((item) => item.action === "schedule").length;
  const focusedActionIndex = focusTargetId
    ? actionQueue.findIndex((entry) => entry.item.workItemId === focusTargetId)
    : -1;
  const focusedAction = focusedActionIndex >= 0 ? actionQueue[focusedActionIndex] : null;
  const matchesAiWorkFilter = (item: HomeWorkbenchItem) => {
    if (aiWorkFilter === "scheduled") return (!item.userStatus && (item.executionState === "unclaimed" || item.executionState === "claimed")) || item.userStatus === "scheduled";
    if (aiWorkFilter === "running") return isAiWorking(item);
    if (aiWorkFilter === "review_ready") return isAutomationReviewReady(item);
    if (aiWorkFilter === "completed") return isAutomationCompleted(item);
    if (aiWorkFilter === "all") return true;
    return item.executionState === aiWorkFilter;
  };
  const filteredAiWorkItems = aiWorkItems.filter((item) =>
    (focusedIssue?.view === "ai" && focusedIssue.workItemId === item.workItemId) || matchesAiWorkFilter(item));
  const aiCounts = {
    all: aiWorkItems.length,
    scheduled: aiWorkItems.filter((item) => (!item.userStatus && (item.executionState === "unclaimed" || item.executionState === "claimed")) || item.userStatus === "scheduled").length,
    running: aiWorkItems.filter(isAiWorking).length,
    awaiting_approval: aiWorkItems.filter((item) => item.executionState === "awaiting_approval").length,
    failed: aiWorkItems.filter((item) => item.executionState === "failed").length,
    reviewReady: aiWorkItems.filter(isAutomationReviewReady).length,
    completed: aiWorkItems.filter(isAutomationCompleted).length,
  };
  const aiDateGroups = {
    yesterday: filteredAiWorkItems.filter((item) => Boolean(item.plannedDate && item.plannedDate < currentDay)).sort(compareHomeVisibility),
    today: filteredAiWorkItems.filter((item) => item.plannedDate === currentDay).sort(compareHomeVisibility),
    tomorrow: filteredAiWorkItems.filter((item) => item.plannedDate === nextDay).sort(compareHomeVisibility),
    other: filteredAiWorkItems
      .filter((item) => !item.plannedDate || item.plannedDate > nextDay)
      .sort((left, right) => compareHomeVisibility(left, right)
        || String(left.plannedDate ?? "9999-12-31").localeCompare(String(right.plannedDate ?? "9999-12-31"))),
  };
  const suggestedCount = preview?.days.reduce((count, day) =>
    count + day.items.filter((item) => item.previousPlannedDate !== day.date).length, 0) ?? 0;
  const rolloverCount = (rollover?.moves.length ?? 0) + (rollover?.confirmationRequired.length ?? 0);
  const rolloverPromptItems = [
    ...(rollover?.moves ?? []).map((item) => ({
      workItemId: item.workItemId,
      localRef: item.localRef,
      title: item.title,
      targetDate: item.targetDate,
      pinned: false,
      unscheduled: false,
      reason: null,
    })),
    ...(rollover?.confirmationRequired ?? []).map((item) => ({
      workItemId: item.workItemId,
      localRef: item.localRef,
      title: item.title,
      targetDate: item.targetDate,
      pinned: true,
      unscheduled: false,
      reason: null,
    })),
    ...(rollover?.unscheduled ?? []).map((item) => {
      const workItem = projectedWorkbenchItems.find((candidate) => candidate.workItemId === item.workItemId);
      return {
        workItemId: item.workItemId,
        localRef: workItem?.localRef ?? item.workItemId,
        title: workItem?.title ?? item.workItemId,
        targetDate: null,
        pinned: false,
        unscheduled: true,
        reason: item.reason,
      };
    }),
  ];
  const rolloverPromptKey = `myagenttool:rollover-prompt:${rollover?.sourceDate ?? ""}`;
  const urgentCount = urgent?.insertions.length ?? 0;
  const progressTotal = model.today.length;
  const myVisibleItemCount = model.yesterday.length + model.today.length + model.tomorrow.length + model.unscheduled.length;
  const progress = progressTotal ? Math.round((model.todayCompleted / progressTotal) * 100) : 0;
  const runHomeAction = (item: HomeWorkbenchItem) => {
    const targetId = item.userAction?.target.section === "task"
      ? item.userAction.target.id
      : item.workItemId;
    onOpenItem({ ...homeTaskWorkItem(item), targetId });
  };
  const runHomeReport = (item: HomeWorkbenchItem) => onOpenItem(homeReportWorkItem(item));
  const handOffToAi = async (item: HomeWorkbenchItem) => {
    if (!onStartAi || !canHandOffToAi(item)) return;
    setStartingAiWorkItemId(item.workItemId);
    setStartAiError(null);
    try {
      await onStartAi(item);
    } catch {
      setStartAiError(copy.handOffAiError);
    } finally {
      setStartingAiWorkItemId(null);
    }
  };
  const locateIssue = (view: WorkView, workItemId: string) => {
    setActiveWorkView(view);
    setFocusedIssue({ workItemId, view, originView: view === "my" ? "ai" : "my", nonce: Date.now() });
  };
  const returnFromLocate = () => {
    if (!focusedIssue) return;
    const { originView, workItemId } = focusedIssue;
    setActiveWorkView(originView);
    setFocusedIssue(null);
    window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(
        `[data-work-view="${originView}"][data-work-item-id="${workItemId}"]`,
      );
      element?.scrollIntoView?.({ behavior: "smooth", block: "center", inline: "center" });
      element?.focus({ preventScroll: true });
    });
  };
  const openScheduleDialog = (item: HomeWorkbenchItem) => {
    setScheduleTarget(item);
    setScheduleDate(item.plannedDate ?? (item.dueDate && item.dueDate >= currentDay ? item.dueDate : currentDay));
    setScheduleError(null);
  };
  const saveSchedule = async () => {
    if (!scheduleTarget || !scheduleDate || !onUpdatePlannedDate) return;
    setSchedulePending(true);
    setScheduleError(null);
    try {
      await onUpdatePlannedDate(scheduleTarget, scheduleDate);
      onFocusActionResolved?.(scheduleTarget.workItemId);
      setScheduleTarget(null);
    } catch {
      setScheduleError(copy.actionQueue.scheduleError);
    } finally {
      setSchedulePending(false);
    }
  };
  const startFocusSession = () => {
    const first = actionQueue[0];
    if (!first) return;
    onStartFocusSession?.();
    setFocusTargetId(first.item.workItemId);
  };
  const reviewTodayPlan = () => {
    setActionQueueFilter("all");
    setActionQueueExpanded(true);
  };
  const dismissRolloverPrompt = () => {
    try {
      if (rollover?.sourceDate) window.localStorage.setItem(rolloverPromptKey, "dismissed");
    } catch {
      // Some embedded/browser privacy modes disable localStorage. The prompt
      // still dismisses for the current render in that case.
    }
    setRolloverPromptOpen(false);
  };
  const applyAllRollover = async () => {
    if (!onRollover || rolloverCount === 0) return;
    const result = await onRollover(true);
    if (result !== false) dismissRolloverPrompt();
  };
  const handleIndividualRollover = () => {
    dismissRolloverPrompt();
    if (actionQueue.length) setActionQueueExpanded(true);
  };
  const openRolloverItem = (workItemId: string) => {
    const item = projectedWorkbenchItems.find((candidate) => candidate.workItemId === workItemId);
    if (!item) return;
    dismissRolloverPrompt();
    onOpenItem(homeTaskWorkItem(item));
  };
  const launchFocusAction = (entry: ActionQueueItem) => {
    onFocusActionLaunched?.(entry.item.workItemId);
    setFocusTargetId(null);
    if (entry.action === "schedule") openScheduleDialog(entry.item);
    else runHomeAction(entry.item);
  };

  useEffect(() => {
    if (!focusTargetId || focusedActionIndex >= 0) return;
    setFocusTargetId(null);
  }, [focusTargetId, focusedActionIndex]);

  useEffect(() => {
    if (!autoRolloverPrompt) {
      setRolloverPromptOpen(false);
      return;
    }
    if (!rollover?.sourceDate || !rolloverPromptItems.length) return;
    try {
      if (window.localStorage.getItem(rolloverPromptKey) === "dismissed") return;
    } catch {
      // Continue when localStorage is unavailable.
    }
    setRolloverPromptOpen(true);
  }, [autoRolloverPrompt, rollover?.sourceDate, rolloverPromptKey, rolloverPromptItems.length]);

  useEffect(() => {
    if (!focusSessionActive || focusTargetId || scheduleTarget) return;
    const pending = actionQueue.find((entry) => entry.item.workItemId === focusPendingWorkItemId);
    const next = pending ?? actionQueue.find((entry) => entry.item.workItemId !== focusResolvedWorkItemId);
    if (next) setFocusTargetId(next.item.workItemId);
  }, [actionQueue, focusPendingWorkItemId, focusResolvedWorkItemId, focusSessionActive, focusTargetId, scheduleTarget]);

  useEffect(() => {
    if (!focusedIssue) return;
    const frame = window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(
        `[data-work-view="${focusedIssue.view}"][data-work-item-id="${focusedIssue.workItemId}"]`,
      );
      element?.scrollIntoView?.({ behavior: "smooth", block: "center", inline: "center" });
      element?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedIssue, myWorkFilter, aiWorkFilter]);

  useEffect(() => {
    if (!window.matchMedia?.("(max-width: 1023px)").matches) return;
    const frame = window.requestAnimationFrame(() => {
      const container = activeWorkView === "my" ? myDateColumnsRef.current : aiDateColumnsRef.current;
      const dateColumn = activeWorkView === "my" ? myDateColumn : aiDateColumn;
      const suffix = activeWorkView === "my" ? "completion-column" : "execution-column";
      const target = container?.querySelector<HTMLElement>(`[data-testid="${dateColumn}-${suffix}"]`);
      if (container && target) {
        container.scrollTo?.({ left: Math.max(0, target.offsetLeft - 12), behavior: "auto" });
        if (activeWorkView === "my") myDateNavigationReady.current = true;
        else aiDateNavigationReady.current = true;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeWorkView, aiDateColumn, aiWorkItems.length, myDateColumn, myVisibleItemCount]);

  const mobileDateNavigation = (
    view: WorkView,
    selected: DateColumnKey,
    onSelect: (value: DateColumnKey) => void,
  ) => (
    <div
      className={cn("sticky top-14 z-10 grid grid-cols-4 gap-1 bg-card/95 py-2 backdrop-blur lg:hidden", view === "my" && "px-4")}
      role="group"
      aria-label={copy.columnSwipeHint}
      data-testid={`${view}-date-navigation`}
    >
      {([
        ["yesterday", copy.yesterday, copy.yesterday],
        ["today", copy.today, copy.today],
        ["tomorrow", copy.tomorrow, copy.tomorrow],
        ["other", copy.mobileOther, view === "my" ? copy.unscheduled : copy.otherDates],
      ] as const).map(([value, visibleLabel, accessibleLabel]) => (
        <button
          key={value}
          type="button"
          aria-label={accessibleLabel}
          aria-pressed={selected === value}
          className={cn(
            "min-w-0 truncate rounded-md border px-2 py-1.5 text-xs transition-colors",
            selected === value
              ? "border-primary/40 bg-primary/10 font-semibold text-primary"
              : "border-border bg-background text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onSelect(value)}
          title={accessibleLabel}
        >
          {visibleLabel}
        </button>
      ))}
    </div>
  );
  const syncMobileDateNavigation = (view: WorkView, container: HTMLDivElement) => {
    if (!window.matchMedia?.("(max-width: 1023px)").matches) return;
    if (view === "my" ? !myDateNavigationReady.current : !aiDateNavigationReady.current) return;
    const suffix = view === "my" ? "completion-column" : "execution-column";
    const columns = Array.from(container.querySelectorAll<HTMLElement>(`[data-testid$="-${suffix}"]`));
    const nearest = columns.reduce<HTMLElement | null>((current, candidate) => {
      if (!current) return candidate;
      const currentDistance = Math.abs(current.offsetLeft - container.scrollLeft);
      const candidateDistance = Math.abs(candidate.offsetLeft - container.scrollLeft);
      return candidateDistance < currentDistance ? candidate : current;
    }, null);
    const key = nearest?.dataset.testid?.replace(`-${suffix}`, "") as DateColumnKey | undefined;
    if (!key || !["yesterday", "today", "tomorrow", "other"].includes(key)) return;
    if (view === "my") setMyDateColumn(key);
    else setAiDateColumn(key);
  };
  const updatedTime = updatedAt && !Number.isNaN(new Date(updatedAt).getTime())
    ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(updatedAt))
    : null;

  const dailyBrief = workbench ? (
        <DailyCoordinationBrief
          copy={copy}
          todayDueCount={todayDueCount}
          actionCount={actionQueue.length}
          aiMovingCount={aiMovingCount}
          scheduleConflictCount={scheduleConflictCount}
          firstAction={actionQueue[0] ?? null}
          onStartFocus={startFocusSession}
          onReviewPlan={reviewTodayPlan}
        />
      ) : null;

  return (
    <div className="min-w-0 space-y-4" data-testid="daily-work-board">
      {dailyBriefContainer && dailyBrief ? createPortal(dailyBrief, dailyBriefContainer) : dailyBrief}
      {actionQueueExpanded && actionQueue.length ? (
        <TodayActionDrawer
          items={filteredActionQueue}
          totalItems={actionQueue.length}
          counts={actionQueueCounts}
          filter={actionQueueFilter}
          copy={copy}
          locale={locale}
          onClose={() => setActionQueueExpanded(false)}
          onFilterChange={setActionQueueFilter}
          onOpenItem={(item) => onOpenItem(homeTaskWorkItem(item))}
          onRunAction={runHomeAction}
          onSchedule={(item) => onUpdatePlannedDate ? openScheduleDialog(item) : onOpenItem(homeTaskWorkItem(item))}
        />
      ) : null}
      <Modal
        open={rolloverPromptOpen}
        onClose={dismissRolloverPrompt}
        closeDisabled={rollingOver}
        title={copy.rolloverPrompt.title}
        description={copy.rolloverPrompt.description.replace("{{count}}", String(rolloverPromptItems.length))}
        size="lg"
      >
        <div className="space-y-4" data-testid="rollover-prompt">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3.5 py-3 text-sm">
            <Badge tone="warning">{formatDateOnly(rollover?.sourceDate, locale) ?? rollover?.sourceDate}</Badge>
            <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
            <Badge tone="running">{formatDateOnly(rollover?.targetDate, locale) ?? rollover?.targetDate}</Badge>
            <span className="text-muted-foreground">{copy.rolloverPrompt.plan}</span>
          </div>

          {rollover?.confirmationRequired.length ? (
            <p className="text-xs text-warning">
              {copy.rolloverPrompt.pinned.replace("{{count}}", String(rollover.confirmationRequired.length))}
            </p>
          ) : null}
          {rollover?.unscheduled.length ? (
            <p className="text-xs text-warning">
              {copy.rolloverPrompt.unscheduled.replace("{{count}}", String(rollover.unscheduled.length))}
            </p>
          ) : null}

          <div className="max-h-72 divide-y divide-border/70 overflow-y-auto rounded-lg border border-border/80">
            {rolloverPromptItems.map((item) => (
              <div key={item.workItemId} className="flex items-center gap-3 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-muted-foreground">{item.localRef}</p>
                  <p className="mt-0.5 text-sm font-medium [overflow-wrap:anywhere]">{item.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.unscheduled
                      ? (copy.scheduleReasons[item.reason ?? ""] ?? copy.rolloverPrompt.unavailable)
                      : `${formatDateOnly(item.targetDate, locale) ?? item.targetDate}`}
                  </p>
                </div>
                {item.pinned ? <Badge tone="warning">{copy.rolloverPrompt.pinnedLabel}</Badge> : null}
                {item.unscheduled ? <Badge tone="neutral">{copy.rolloverPrompt.unavailable}</Badge> : null}
                {!item.unscheduled && projectedWorkbenchItems.some((candidate) => candidate.workItemId === item.workItemId) ? (
                  <Button size="sm" variant="ghost" onClick={() => openRolloverItem(item.workItemId)}>
                    {copy.rolloverPrompt.open}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <Button
              className="w-full sm:col-span-2"
              disabled={rollingOver || rolloverCount === 0}
              onClick={() => void applyAllRollover()}
            >
              <RotateCcw aria-hidden />
              {rollingOver ? copy.rollingOver : copy.rolloverPrompt.all}
            </Button>
            <Button variant="secondary" className="w-full" disabled={rollingOver} onClick={handleIndividualRollover}>
              {copy.rolloverPrompt.individual}
            </Button>
          </div>
          <Button variant="ghost" className="w-full" disabled={rollingOver} onClick={dismissRolloverPrompt}>
            {copy.rolloverPrompt.later}
          </Button>
        </div>
      </Modal>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2" data-testid="work-view-tabs">
        <div
          className="inline-flex w-fit max-w-full items-center gap-1 rounded-lg border border-border/80 bg-muted/30 p-1"
          role="tablist"
          aria-label={`${copy.myWork} / ${copy.activeAi}`}
        >
          <button
            type="button"
            role="tab"
            id="my-work-tab"
            aria-selected={activeWorkView === "my"}
            aria-controls="my-work-panel"
            onClick={() => setActiveWorkView("my")}
            className={cn(
              "flex min-w-0 items-center justify-start gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              activeWorkView === "my"
                ? "bg-background font-semibold text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
            )}
          >
            <BriefcaseBusiness className="size-4" aria-hidden />
            <span>{copy.myWork}</span>
            <Badge tone="neutral">{workbench?.summary.total ?? plannedItems.length}</Badge>
          </button>
          <button
            type="button"
            role="tab"
            id="ai-work-tab"
            aria-selected={activeWorkView === "ai"}
            aria-controls="ai-work-panel"
            onClick={() => setActiveWorkView("ai")}
            className={cn(
              "flex min-w-0 items-center justify-start gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              activeWorkView === "ai"
                ? "bg-background font-semibold text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
            )}
          >
            <Bot className="size-4" aria-hidden />
            <span>{copy.activeAi}</span>
            <Badge tone={aiWorkItems.length ? "running" : "neutral"}>{aiWorkItems.length}</Badge>
          </button>
        </div>
        {onCreateTask ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="ml-auto size-9 shrink-0 lg:hidden"
            aria-label={copy.quickCreateTask}
            title={copy.quickCreateTask}
            onClick={onCreateTask}
          >
            <Plus aria-hidden />
          </Button>
        ) : null}
        <div className="flex min-w-0 basis-full items-center justify-between gap-2 px-1 text-xs text-muted-foreground sm:basis-auto sm:justify-start sm:px-0">
          <span>{copy.scheduleScope}</span>
          {refreshing ? (
            <span className="inline-flex items-center gap-1" role="status" aria-live="polite">
              <LoaderCircle className="size-3 animate-spin" aria-hidden />{copy.refreshing}
            </span>
          ) : updatedTime ? (
            <span role="status">{copy.updatedAt.replace("{{time}}", updatedTime)}</span>
          ) : null}
        </div>
        {approvals.length ? (
          <div
            className="ml-auto flex min-w-0 max-w-full flex-1 items-center justify-end gap-2 overflow-x-auto"
            aria-label={copy.approvals}
            data-testid="ai-approval-cards"
          >
            {approvals.map((decision) => (
              <button
                key={decision.id}
                type="button"
                onClick={() => onOpenApproval?.(decision)}
                className="flex min-w-0 max-w-64 shrink-0 items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 px-2.5 py-1.5 text-left transition-colors hover:border-warning/70 hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={`${copy.approvals}: ${decision.title}`}
                data-testid="ai-approval-card"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-warning/15 text-warning">
                  <AlertTriangle className="size-3.5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-medium text-warning">{copy.approvals}</span>
                  <span className="block truncate text-xs font-medium text-foreground">{decision.title}</span>
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div id="my-work-panel" role="tabpanel" aria-labelledby="my-work-tab" hidden={activeWorkView !== "my"}>
      <Card className="min-w-0 overflow-clip border-border/80" data-testid="my-work-section">
      <div className="flex flex-col gap-3 border-b border-border/80 px-4 py-3 sm:px-5 sm:py-4 xl:flex-row xl:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary sm:size-10 sm:rounded-xl">
            <BriefcaseBusiness className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{copy.title}</h2>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
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

      {showMyEmptyState ? (
        <section className="grid min-h-52 place-items-center px-5 py-8 text-center" data-testid="my-work-empty-state">
          <div className="max-w-sm">
            <span className="mx-auto grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <BriefcaseBusiness className="size-5" aria-hidden />
            </span>
            <h3 className="mt-3 font-semibold">{copy.noMyTasks}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{copy.noMyTasksHint}</p>
            {onCreateTask ? <Button className="mt-4" onClick={onCreateTask}><Plus aria-hidden />{copy.createFirstTask}</Button> : null}
          </div>
        </section>
      ) : (
        <>
      <section className="border-b border-border/80 bg-muted/10 px-3 py-3 sm:px-4 sm:py-4" data-testid="my-work-status-cards">
          <div className="mb-2 flex items-center gap-2 sm:mb-3">
            <h3 className="text-sm font-semibold">{copy.peopleCategory}</h3>
            <span className="hidden text-xs text-muted-foreground sm:inline">{copy.expectedCompletion} · {copy.yesterday} / {copy.today} / {copy.tomorrow} / {copy.unscheduled}</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0 xl:grid-cols-7">
            <WorkStatusFilterCard
              label={copy.allMyWork}
              value={workbench?.summary.total ?? plannedItems.length}
              tone="neutral"
              active={myWorkFilter === "all"}
              onClick={() => setMyWorkFilter("all")}
            />
            {(["self", "boss", "manager", "customer", "child"] as const).filter((relation) => relationCounts[relation] > 0).map((relation) => (
              <WorkStatusFilterCard
                key={relation}
                label={copy.relation[relation]}
                value={relationCounts[relation]}
                tone={relation === "boss" ? "warning" : relation === "customer" ? "running" : relation === "child" ? "success" : "neutral"}
                active={myWorkFilter === relation}
                onClick={() => setMyWorkFilter(relation)}
              />
            ))}
            {relationCounts.other > 0 ? (
              <WorkStatusFilterCard
                label={copy.otherPeople}
                value={relationCounts.other}
                tone="neutral"
                active={myWorkFilter === "other"}
                onClick={() => setMyWorkFilter("other")}
              />
            ) : null}
          </div>
        </section>

      {focusedIssue?.view === "my" ? (
        <LocateContextBar copy={copy} originView={focusedIssue.originView} onReturn={returnFromLocate} />
      ) : null}
      {startAiError ? <p className="mx-4 mt-3 text-xs text-destructive" role="alert">{startAiError}</p> : null}
      {mobileDateNavigation("my", myDateColumn, setMyDateColumn)}
      <div
        ref={myDateColumnsRef}
        className="grid snap-x snap-mandatory grid-flow-col auto-cols-[88%] gap-3 overflow-x-auto p-3 pb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [scrollbar-width:thin] lg:grid-flow-row lg:auto-cols-auto lg:grid-cols-4 lg:overflow-visible"
        data-testid="my-date-columns"
        aria-label={copy.columnSwipeHint}
        tabIndex={0}
        onScroll={(event) => syncMobileDateNavigation("my", event.currentTarget)}
      >
        <DayColumn
          testId="yesterday-completion-column"
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
          onStartAi={onStartAi ? handOffToAi : undefined}
          startingAiWorkItemId={startingAiWorkItemId}
          focusedWorkItemId={focusedIssue?.view === "my" ? focusedIssue.workItemId : null}
          onLocateAi={(item) => locateIssue("ai", item.workItemId)}
        />

        <DayColumn
          testId="today-completion-column"
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
          onStartAi={onStartAi ? handOffToAi : undefined}
          startingAiWorkItemId={startingAiWorkItemId}
          focusedWorkItemId={focusedIssue?.view === "my" ? focusedIssue.workItemId : null}
          onLocateAi={(item) => locateIssue("ai", item.workItemId)}
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
          testId="tomorrow-completion-column"
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
          onStartAi={onStartAi ? handOffToAi : undefined}
          startingAiWorkItemId={startingAiWorkItemId}
          focusedWorkItemId={focusedIssue?.view === "my" ? focusedIssue.workItemId : null}
          onLocateAi={(item) => locateIssue("ai", item.workItemId)}
        />
        <DayColumn
          testId="other-completion-column"
          title={copy.unscheduled}
          subtitle={copy.unscheduledHint}
          date=""
          icon={CalendarDays}
          items={model.unscheduled}
          emptyTitle={copy.unscheduled}
          emptyHint={copy.unscheduledHint}
          copy={copy}
          locale={locale}
          onOpenItem={onOpenItem}
          onHomeAction={runHomeAction}
          onHomeReport={runHomeReport}
          onStartAi={onStartAi ? handOffToAi : undefined}
          startingAiWorkItemId={startingAiWorkItemId}
          focusedWorkItemId={focusedIssue?.view === "my" ? focusedIssue.workItemId : null}
          onLocateAi={(item) => locateIssue("ai", item.workItemId)}
        />
      </div>
        </>
      )}
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
      </div>

      <div id="ai-work-panel" role="tabpanel" aria-labelledby="ai-work-tab" hidden={activeWorkView !== "ai"}>
      <Card className="min-w-0 overflow-clip border-border/80" data-testid="ai-work-section">
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

        {workbench && aiWorkItems.length === 0 ? (
          <section className="grid min-h-52 place-items-center px-5 py-8 text-center" data-testid="ai-work-empty-state">
            <div className="max-w-sm">
              <span className="mx-auto grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <Bot className="size-5" aria-hidden />
              </span>
              <h3 className="mt-3 font-semibold">{copy.noAiWork}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{copy.noAiWorkHint}</p>
              <Button className="mt-4" variant="secondary" onClick={onOpenTasks}>{copy.selectTaskForAi}<ArrowRight aria-hidden /></Button>
            </div>
          </section>
        ) : (
          <>
        <section className="border-b border-border/80 bg-muted/10 px-3 py-3 sm:px-4 sm:py-4" data-testid="ai-work-status-cards">
          <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-4 sm:overflow-visible sm:pb-0 xl:grid-cols-7">
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
              label={copy.automationApprovals}
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
              value={aiCounts.reviewReady}
              tone="success"
              active={aiWorkFilter === "review_ready"}
              onClick={() => setAiWorkFilter("review_ready")}
            />
            <WorkStatusFilterCard
              label={copy.automationCompleted}
              value={aiCounts.completed}
              tone="success"
              active={aiWorkFilter === "completed"}
              onClick={() => setAiWorkFilter("completed")}
            />
          </div>
        </section>

        <section className="px-4 py-4" data-testid="active-ai-work">
          {focusedIssue?.view === "ai" ? (
            <LocateContextBar copy={copy} originView={focusedIssue.originView} onReturn={returnFromLocate} />
          ) : null}
          <div className="space-y-3" data-testid="ai-execution-timeline">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground">{copy.executionDate}</span>
              <span className="text-[11px] text-muted-foreground">
                {filteredAiWorkItems.length ? `${filteredAiWorkItems.length} · ${copy.allAiWork}` : copy.noAiWorkHint}
              </span>
            </div>
            {mobileDateNavigation("ai", aiDateColumn, setAiDateColumn)}
            <div
              ref={aiDateColumnsRef}
              className="grid snap-x snap-mandatory grid-flow-col auto-cols-[88%] gap-3 overflow-x-auto pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [scrollbar-width:thin] lg:grid-flow-row lg:auto-cols-auto lg:grid-cols-4 lg:overflow-visible"
              data-testid="ai-date-columns"
              aria-label={copy.columnSwipeHint}
              tabIndex={0}
              onScroll={(event) => syncMobileDateNavigation("ai", event.currentTarget)}
            >
              <AiDateColumn
                testId="yesterday-execution-column"
                title={copy.yesterday}
                subtitle={copy.executionDate}
                date={formatDate(addDays(now, -1), locale)}
                items={aiDateGroups.yesterday}
                copy={copy}
                locale={locale}
                onOpenItem={onOpenItem}
                onAction={runHomeAction}
                canOperate={canOperate}
                focusedWorkItemId={focusedIssue?.view === "ai" ? focusedIssue.workItemId : null}
                onLocateMy={(item) => locateIssue("my", item.workItemId)}
                showAll={aiWorkFilter === "failed"}
              />
              <AiDateColumn
                testId="today-execution-column"
                title={copy.today}
                subtitle={copy.executionDate}
                date={formatDate(now, locale)}
                items={aiDateGroups.today}
                copy={copy}
                locale={locale}
                onOpenItem={onOpenItem}
                onAction={runHomeAction}
                canOperate={canOperate}
                focusedWorkItemId={focusedIssue?.view === "ai" ? focusedIssue.workItemId : null}
                onLocateMy={(item) => locateIssue("my", item.workItemId)}
                featured
                showAll={aiWorkFilter === "failed"}
              />
              <AiDateColumn
                testId="tomorrow-execution-column"
                title={copy.tomorrow}
                subtitle={copy.executionDate}
                date={formatDate(addDays(now, 1), locale)}
                items={aiDateGroups.tomorrow}
                copy={copy}
                locale={locale}
                onOpenItem={onOpenItem}
                onAction={runHomeAction}
                canOperate={canOperate}
                focusedWorkItemId={focusedIssue?.view === "ai" ? focusedIssue.workItemId : null}
                onLocateMy={(item) => locateIssue("my", item.workItemId)}
                showAll={aiWorkFilter === "failed"}
              />
              <AiDateColumn
                testId="other-execution-column"
                title={copy.otherDates}
                subtitle={copy.otherDatesHint}
                date=""
                items={aiDateGroups.other}
                copy={copy}
                locale={locale}
                onOpenItem={onOpenItem}
                onAction={runHomeAction}
                canOperate={canOperate}
                focusedWorkItemId={focusedIssue?.view === "ai" ? focusedIssue.workItemId : null}
                onLocateMy={(item) => locateIssue("my", item.workItemId)}
                showAll={aiWorkFilter === "failed"}
              />
            </div>
          </div>
        </section>
          </>
        )}
      </Card>
      </div>

      <Modal
        open={Boolean(focusedAction)}
        onClose={() => {
          setFocusTargetId(null);
          onEndFocusSession?.();
        }}
        title={copy.focusMode.title}
        description={copy.focusMode.position
          .replace("{{current}}", String(focusedActionIndex + 1))
          .replace("{{total}}", String(actionQueue.length))}
        size="lg"
      >
        {focusedAction ? (
          <div className="space-y-4" data-testid="focus-session">
            <div className="rounded-xl border border-primary/25 bg-primary/5 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">{focusedAction.item.localRef}</span>
                <StatusBadge tone={LOCAL_STATE_TONE[focusedAction.item.planningStatus]}>
                  {copy.localState[focusedAction.item.planningStatus]}
                </StatusBadge>
                <StatusBadge tone={executionTone(focusedAction.item.executionState, focusedAction.item.userStatus)}>
                  {executionLabel(focusedAction.item, copy)}
                </StatusBadge>
              </div>
              <h3 className="mt-3 text-xl font-semibold leading-snug [overflow-wrap:anywhere]">{focusedAction.item.title}</h3>
              <p className={cn(
                "mt-2 text-sm font-medium",
                focusedAction.tone === "danger" && "text-destructive",
                focusedAction.tone === "warning" && "text-warning",
                focusedAction.tone === "running" && "text-primary",
              )}>{focusedAction.reason}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                [copy.owner, focusedAction.item.assignees.length ? focusedAction.item.assignees.map((assignee) => assignee.name).join(", ") : copy.unassigned],
                [copy.peopleCategory, `${copy.relation[focusedAction.item.requester.relation]}${focusedAction.item.requester.name ? ` · ${focusedAction.item.requester.name}` : ""}`],
                [copy.waitingLabel, copy.waiting[focusedAction.item.waitingOn]],
                [copy.aiLabel, focusedAction.item.ai?.agentName ?? focusedAction.item.ai?.agentId ?? copy.coordination.aiNotLinked],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border bg-muted/20 px-3.5 py-3">
                  <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
                  <p className="mt-1 text-sm font-medium [overflow-wrap:anywhere]">{value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-xs font-semibold">{copy.focusMode.timeline}</p>
              <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">{copy.expectedCompletion}</p>
                  <p className="mt-1 font-medium">{formatDateOnly(focusedAction.item.dueDate, locale) ?? copy.noExpectedCompletion}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{copy.executionDate}</p>
                  <p className="mt-1 font-medium">{formatDateOnly(focusedAction.item.plannedDate, locale) ?? copy.noExecutionDate}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{copy.focusMode.commitmentDate}</p>
                  <p className="mt-1 font-medium">{formatDateOnly(focusedAction.item.commitmentDate, locale) ?? copy.focusMode.noDate}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{copy.focusMode.followUpDate}</p>
                  <p className="mt-1 font-medium">{formatDateOnly(focusedAction.item.nextFollowUpAt, locale) ?? copy.focusMode.noDate}</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 px-3.5 py-3">
              <p className="text-xs font-medium">{copy.focusMode.expectedOutcome}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {focusedAction.action === "schedule" ? copy.focusMode.outcomeSchedule : copy.focusMode.outcomeNext}
              </p>
            </div>
            <Button className="w-full" onClick={() => launchFocusAction(focusedAction)}>
              {focusedAction.actionLabel}<ArrowRight aria-hidden />
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                disabled={focusedActionIndex <= 0}
                onClick={() => setFocusTargetId(actionQueue[focusedActionIndex - 1]?.item.workItemId ?? null)}
              >
                <ArrowLeft aria-hidden />{copy.focusMode.previous}
              </Button>
              <Button
                variant="secondary"
                disabled={focusedActionIndex >= actionQueue.length - 1}
                onClick={() => setFocusTargetId(actionQueue[focusedActionIndex + 1]?.item.workItemId ?? null)}
              >
                {copy.focusMode.next}<ArrowRight aria-hidden />
              </Button>
            </div>
            <Button
              className="w-full"
              variant="ghost"
              onClick={() => {
                setFocusTargetId(null);
                onEndFocusSession?.();
              }}
            >
              {copy.focusMode.exit}
            </Button>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(scheduleTarget)}
        onClose={schedulePending ? () => undefined : () => setScheduleTarget(null)}
        closeDisabled={schedulePending}
        title={copy.actionQueue.scheduleTitle}
        description={copy.actionQueue.scheduleHint}
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">{scheduleTarget?.localRef}</p>
            <p className="mt-0.5 text-sm font-medium">{scheduleTarget?.title}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {copy.expectedCompletion}：{formatDateOnly(scheduleTarget?.dueDate ?? null, locale) ?? copy.noExpectedCompletion}
            </p>
          </div>
          <label className="block space-y-1.5 text-sm">
            <span>{copy.executionDate}</span>
            <Input
              type="date"
              aria-label={copy.executionDate}
              value={scheduleDate}
              min={currentDay}
              disabled={schedulePending}
              onChange={(event) => setScheduleDate(event.target.value)}
            />
          </label>
          {scheduleError ? <p className="text-sm text-destructive" role="alert">{scheduleError}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" disabled={schedulePending} onClick={() => setScheduleTarget(null)}>
              {copy.actionQueue.cancelSchedule}
            </Button>
            <Button className="w-full sm:w-auto" disabled={schedulePending || !scheduleDate} onClick={() => void saveSchedule()}>
              {schedulePending ? copy.actionQueue.savingSchedule : copy.actionQueue.saveSchedule}
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  );
}

function AiDateColumn({
  testId,
  title,
  subtitle,
  date,
  items,
  copy,
  locale,
  onOpenItem,
  onAction,
  canOperate,
  focusedWorkItemId,
  onLocateMy,
  featured = false,
  showAll = false,
}: {
  testId?: string;
  title: string;
  subtitle: string;
  date: string;
  items: HomeWorkbenchItem[];
  copy: Copy;
  locale: string;
  onOpenItem: (item: WorkItem) => void;
  onAction: (item: HomeWorkbenchItem) => void;
  canOperate: boolean;
  focusedWorkItemId: string | null;
  onLocateMy: (item: HomeWorkbenchItem) => void;
  featured?: boolean;
  showAll?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const revealFocused = Boolean(focusedWorkItemId && items.some((item) => item.workItemId === focusedWorkItemId));
  const leadingItems = items.slice(0, 2);
  const completedItem = items.find((item) => item.executionState === "completed");
  const collapsedItems = completedItem && !leadingItems.includes(completedItem)
    ? [...leadingItems, completedItem]
    : leadingItems;
  const visibleItems = expanded || revealFocused || showAll ? items : collapsedItems;
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  return (
    <section className={cn(
      "min-h-40 snap-start rounded-xl border p-3.5",
      featured ? "border-primary/35 bg-primary/[0.035]" : "border-border bg-background/45",
    )} data-testid={testId}>
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">{title}</h3>
        <Badge tone={featured ? "running" : "neutral"}>{items.length}</Badge>
        {date ? <span className="ml-auto text-[11px] text-muted-foreground">{date}</span> : null}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      <div className="mt-3 space-y-2">
        {items.length ? visibleItems.map((item) => (
          <AiWorkCard
            key={item.workItemId}
            item={item}
            copy={copy}
            locale={locale}
            onOpenItem={onOpenItem}
            onAction={onAction}
            canOperate={canOperate}
            focused={focusedWorkItemId === item.workItemId}
            onLocateMy={() => onLocateMy(item)}
          />
        )) : (
          <div className="grid min-h-20 place-items-center rounded-lg border border-dashed border-border/80 px-3 text-center text-xs text-muted-foreground">
            {copy.noAiWork}
          </div>
        )}
        {hiddenCount > 0 && !revealFocused && !showAll ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="w-full rounded px-2 py-2 text-center text-xs font-medium text-primary hover:bg-primary/5"
          >
            {expanded ? copy.less : copy.more.replace("{{count}}", String(hiddenCount))}
          </button>
        ) : null}
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
  canOperate,
  focused,
  onLocateMy,
}: {
  item: HomeWorkbenchItem;
  copy: Copy;
  locale: string;
  onOpenItem: (item: WorkItem) => void;
  onAction: (item: HomeWorkbenchItem) => void;
  canOperate: boolean;
  focused: boolean;
  onLocateMy: () => void;
}) {
  const dueDate = formatDateOnly(item.dueDate, locale);
  const completedDate = formatDateOnly(item.completedAt, locale);
  const executionDate = formatDateOnly(item.plannedDate, locale);
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border border-border bg-card p-2.5 transition-all hover:bg-muted/35 focus:outline-none",
        focused && "border-primary ring-2 ring-primary/35",
      )}
      data-work-item-id={item.workItemId}
      data-work-view="ai"
      tabIndex={-1}
    >
      <div className="flex flex-wrap items-center gap-1">
        <Badge tone="neutral">{copy.relation[item.requester.relation]}</Badge>
        <StatusBadge tone={executionTone(item.executionState, item.userStatus)}>{executionLabel(item, copy)}</StatusBadge>
      </div>
      <button type="button" onClick={() => onOpenItem(homeTaskWorkItem(item))} className="mt-1.5 block w-full min-w-0 text-left">
        <span className="block text-[11px] text-muted-foreground">{item.localRef}</span>
        <strong className="mt-0.5 block line-clamp-2 text-[13px] [overflow-wrap:anywhere]">{item.title}</strong>
      </button>
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        <span>{copy.executionDate}：{executionDate ?? copy.noExecutionDate}</span>
        {completedDate ? <span>{copy.completedOn}：{completedDate}</span> : <span>{copy.expectedCompletion}：{dueDate ?? copy.noExpectedCompletion}</span>}
        <span className="col-span-2">{executionActorLabel(item, locale, copy)}</span>
      </div>
      <WorkCoordinationNotice item={item} copy={copy} />
      {!canOperate && item.userAction?.requiresPermission ? (
        <p className="mt-1.5 rounded-md bg-warning/[0.07] px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {copy.actionQueue.waitingAuthorizedMember}
        </p>
      ) : null}
      {item.result?.summary ? (
        <p className="mt-1.5 line-clamp-2 rounded-md bg-success/[0.06] px-2 py-1.5 text-[11px] leading-relaxed text-foreground" data-testid={`result-summary-${item.workItemId}`}>
          <span className="font-medium">{item.result.needsReview ? copy.attentionReason.review_ready : copy.completed}：</span>{item.result.summary}
        </p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1 border-t border-border/70 pt-1.5">
        <Button size="sm" variant="primary" onClick={() => onAction(item)}>
          {!canOperate && item.userAction?.requiresPermission
            ? copy.actionQueue.viewProgress
            : copy.nextAction[item.nextAction.kind]}<ArrowRight aria-hidden />
        </Button>
        <Button size="sm" variant="ghost" onClick={onLocateMy}>{copy.coordination.locateMy}</Button>
      </div>
    </div>
  );
}

type CoordinationKind = "late_execution" | "unscheduled" | "review_pending";

function coordinationNotice(item: HomeWorkbenchItem, copy: Copy): { kind: CoordinationKind; label: string; tone: "danger" | "warning" | "running" } | null {
  if (hasAutomatedExecution(item) && item.dueDate && item.plannedDate && item.plannedDate > item.dueDate) {
    return { kind: "late_execution", label: copy.coordination.executionAfterCompletion, tone: "danger" };
  }
  if (hasAutomatedExecution(item) && !item.plannedDate) {
    return { kind: "unscheduled", label: copy.coordination.aiUnscheduled, tone: "warning" };
  }
  if ((item.userStatus === "ready_for_review" || item.executionState === "completed") && item.planningStatus !== "done") {
    return { kind: "review_pending", label: copy.coordination.reviewPending, tone: "running" };
  }
  return null;
}

function WorkCoordinationNotice({ item, copy }: { item: HomeWorkbenchItem; copy: Copy }) {
  const notice = coordinationNotice(item, copy);
  if (!notice) return null;
  return (
    <p
      className={cn(
        "mt-1 text-[10px] font-medium",
        notice.tone === "danger" && "text-destructive",
        notice.tone === "warning" && "text-warning",
        notice.tone === "running" && "text-primary",
      )}
      data-testid={`work-coordination-${item.workItemId}`}
    >
      {notice.label}
    </p>
  );
}

type ActionQueueItem = {
  item: HomeWorkbenchItem;
  reason: string;
  tone: "danger" | "warning" | "running";
  action: "next" | "schedule";
  actionLabel: string;
  rank: number;
};

function buildActionQueue(items: HomeWorkbenchItem[], copy: Copy, canOperate = true): ActionQueueItem[] {
  return items.flatMap((item): ActionQueueItem[] => {
    if (item.planningStatus === "done") return [];
    if (!canOperate && item.userAction?.requiresPermission) return [];
    const attention = item.attentionReason;
    if (attention === "ai_needs_input") {
      const question = item.userAction?.instruction?.trim();
      return [{ item, reason: question ? `${copy.actionQueue.aiNeedsAnswer}: ${question}` : copy.actionQueue.aiNeedsAnswer, tone: "warning", action: "next", actionLabel: copy.nextAction.answer_ai, rank: 0 }];
    }
    if (attention === "ai_failed") {
      return [{ item, reason: copy.attentionReason.ai_failed, tone: "danger", action: "next", actionLabel: copy.nextAction[item.nextAction.kind], rank: 0 }];
    }
    if (attention === "approval_required") {
      return [{ item, reason: copy.attentionReason.approval_required, tone: "warning", action: "next", actionLabel: copy.nextAction[item.nextAction.kind], rank: 1 }];
    }
    if (attention === "review_ready" || item.executionState === "completed") {
      return [{ item, reason: copy.coordination.reviewPending, tone: "running", action: "next", actionLabel: copy.nextAction[item.nextAction.kind], rank: 2 }];
    }
    if (attention === "overdue") {
      return [{ item, reason: copy.attentionReason.overdue, tone: "danger", action: "next", actionLabel: copy.nextAction[item.nextAction.kind], rank: 3 }];
    }
    if (attention === "user_action_required" || attention === "follow_up_due") {
      return [{ item, reason: copy.attentionReason[attention], tone: "warning", action: "next", actionLabel: copy.nextAction[item.nextAction.kind], rank: 4 }];
    }
    if (attention === "dependency_blocked") {
      const dependency = item.userAction?.instruction?.trim();
      return [{ item, reason: dependency ? `${copy.actionQueue.dependencyBlocked}: ${dependency}` : copy.actionQueue.dependencyBlocked, tone: "warning", action: "next", actionLabel: copy.nextAction.open_issue, rank: 2 }];
    }
    // Scheduling metadata must never turn work that is already moving into a
    // human interruption. The execution continues and can be inspected under
    // Task status if needed.
    if (isAiWorking(item)) return [];
    const coordination = coordinationNotice(item, copy);
    if (coordination?.kind === "late_execution") {
      return [{ item, reason: coordination.label, tone: "danger", action: "schedule", actionLabel: copy.actionQueue.adjustExecution, rank: 5 }];
    }
    if (coordination?.kind === "unscheduled") {
      return [{ item, reason: coordination.label, tone: "warning", action: "schedule", actionLabel: copy.actionQueue.scheduleAi, rank: 6 }];
    }
    return [];
  }).sort((left, right) => left.rank - right.rank
    || String(left.item.dueDate ?? "9999-12-31").localeCompare(String(right.item.dueDate ?? "9999-12-31"))
    || left.item.workItemId.localeCompare(right.item.workItemId));
}

function DailyCoordinationBrief({
  copy,
  todayDueCount,
  actionCount,
  aiMovingCount,
  scheduleConflictCount,
  firstAction,
  onStartFocus,
  onReviewPlan,
}: {
  copy: Copy;
  todayDueCount: number;
  actionCount: number;
  aiMovingCount: number;
  scheduleConflictCount: number;
  firstAction: ActionQueueItem | null;
  onStartFocus: () => void;
  onReviewPlan: () => void;
}) {
  const summary = copy.dailyBrief.summary
    .replace("{{due}}", String(todayDueCount))
    .replace("{{actions}}", String(actionCount))
    .replace("{{ai}}", String(aiMovingCount));
  const conflict = copy.dailyBrief.conflict.replace("{{count}}", String(scheduleConflictCount));
  if (todayDueCount === 0 && actionCount === 0 && aiMovingCount === 0) {
    return (
      <Card className="h-full min-w-0 border-primary/20 bg-primary/[0.035]" data-testid="daily-coordination-brief" data-compact="true">
        <div className="flex h-full items-center gap-3 p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-success/10 text-success">
            <CheckCircle2 className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{copy.dailyBrief.title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{copy.dailyBrief.allClear}</p>
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card className="h-full min-w-0 overflow-hidden border-primary/30 bg-gradient-to-br from-primary/[0.08] via-card to-card" data-testid="daily-coordination-brief">
      <div className="flex h-full flex-col gap-3 p-4 sm:gap-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{copy.dailyBrief.title}</h2>
              {actionCount ? <Badge tone="warning">{actionCount}</Badge> : <Badge tone="success">✓</Badge>}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-foreground/90">{summary}</p>
            {scheduleConflictCount ? <p className="mt-1 text-xs font-medium text-warning">{conflict}</p> : null}
          </div>
        </div>

        <div className="hidden grid-cols-3 gap-2 sm:grid" data-testid="daily-brief-metrics">
          {[
            [todayDueCount, copy.dailyBrief.due, "text-foreground"],
            [actionCount, copy.dailyBrief.actions, actionCount ? "text-warning" : "text-foreground"],
            [aiMovingCount, copy.dailyBrief.aiMoving, aiMovingCount ? "text-primary" : "text-foreground"],
          ].map(([value, label, tone]) => (
            <div key={String(label)} className="rounded-lg border border-border/70 bg-background/45 px-3 py-2">
              <p className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        <div className="mt-auto">
          {firstAction ? (
            <div className="rounded-lg border border-border/80 bg-background/55 px-3 py-2.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{copy.dailyBrief.nextUp}</p>
              <p className="mt-1 text-sm font-medium [overflow-wrap:anywhere]">{firstAction.item.localRef} · {firstAction.item.title}</p>
              <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{firstAction.reason}</p>
            </div>
          ) : <p className="text-sm text-muted-foreground">{copy.dailyBrief.allClear}</p>}
          {firstAction ? (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Button className="min-w-0 px-2 sm:w-auto sm:px-4" onClick={onStartFocus}>
                {copy.dailyBrief.startFocus}<ArrowRight aria-hidden />
              </Button>
              <Button className="min-w-0 px-2 sm:w-auto sm:px-4" variant="secondary" onClick={onReviewPlan}>
                <ListChecks aria-hidden />{copy.dailyBrief.reviewPlan}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function TodayActionDrawer({
  items,
  totalItems,
  counts,
  filter,
  copy,
  locale,
  onClose,
  onFilterChange,
  onOpenItem,
  onRunAction,
  onSchedule,
}: {
  items: ActionQueueItem[];
  totalItems: number;
  counts: Record<ActionQueueFilter, number>;
  filter: ActionQueueFilter;
  copy: Copy;
  locale: string;
  onClose: () => void;
  onFilterChange: (filter: ActionQueueFilter) => void;
  onOpenItem: (item: HomeWorkbenchItem) => void;
  onRunAction: (item: HomeWorkbenchItem) => void;
  onSchedule: (item: HomeWorkbenchItem) => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const filters: Array<[ActionQueueFilter, string, number]> = [
    ["all", copy.actionQueue.all, counts.all],
    ["danger", copy.actionQueue.urgent, counts.danger],
    ["warning", copy.actionQueue.pending, counts.warning],
    ["running", copy.actionQueue.review, counts.running],
  ];

  return createPortal(
    <div className="fixed inset-0 z-40" data-testid="unified-action-queue">
      <button
        type="button"
        aria-label={copy.less}
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={copy.actionQueue.title}
        className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-border bg-card shadow-2xl"
      >
        <div className="border-b border-border/80 px-5 pb-4 pt-5 sm:px-6">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <ListChecks className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">{copy.actionQueue.title}</h2>
                <Badge tone="warning">{totalItems}</Badge>
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{copy.actionQueue.hint}</p>
            </div>
            <button type="button" onClick={onClose} aria-label={copy.less} className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="mt-4 flex gap-1 overflow-x-auto rounded-lg border border-border/70 bg-muted/30 p-1" role="tablist" aria-label={copy.actionQueue.title}>
            {filters.map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => onFilterChange(value)}
                className={cn(
                  "shrink-0 rounded-md px-3 py-1.5 text-xs transition-colors",
                  filter === value ? "bg-background font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}<span className="ml-1.5 tabular-nums">{count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-border/70">
          {items.length ? items.map(({ item, reason, tone, action, actionLabel }) => {
            const dueDate = formatDateOnly(item.dueDate, locale) ?? copy.noExpectedCompletion;
            const executionDate = formatDateOnly(item.plannedDate, locale) ?? copy.noExecutionDate;
            return (
              <div key={item.workItemId} className="flex flex-col gap-3 px-5 py-4 sm:px-6" data-testid={`action-queue-${item.workItemId}`}>
                <button type="button" onClick={() => onOpenItem(item)} className="min-w-0 text-left">
                  <span className="block text-[11px] text-muted-foreground">{item.localRef}</span>
                  <span className="mt-0.5 block text-sm font-medium [overflow-wrap:anywhere]">{item.title}</span>
                  <span className={cn(
                    "mt-1 block text-xs font-medium",
                    tone === "danger" && "text-destructive",
                    tone === "warning" && "text-warning",
                    tone === "running" && "text-primary",
                  )}>{reason}</span>
                </button>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    {copy.expectedCompletion} {dueDate} → {copy.executionDate} {executionDate}
                  </span>
                  <Button className="w-full sm:w-auto" size="sm" variant={tone === "danger" ? "primary" : "secondary"} onClick={() => action === "schedule" ? onSchedule(item) : onRunAction(item)}>
                    {actionLabel}<ArrowRight aria-hidden />
                  </Button>
                </div>
              </div>
            );
          }) : (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              {copy.dailyBrief.allClear}
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function LocateContextBar({
  copy,
  originView,
  onReturn,
}: {
  copy: Copy;
  originView: WorkView;
  onReturn: () => void;
}) {
  return (
    <div
      className="mb-3 flex flex-col gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
      role="status"
      data-testid="cross-board-location"
    >
      <span className="text-xs text-foreground">{copy.coordination.located}</span>
      <Button size="sm" variant="ghost" className="w-full sm:w-auto" onClick={onReturn}>
        <ArrowLeft aria-hidden />
        {originView === "my" ? copy.coordination.backToMy : copy.coordination.backToAi}
      </Button>
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
        "group flex min-w-max items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block sm:min-w-0 sm:rounded-xl sm:py-3",
        active ? "border-primary/60 bg-primary/[0.045]" : "border-border",
      )}
    >
      <span className={cn(
        "block text-base font-semibold tabular-nums sm:text-xl",
        tone === "warning" && "text-warning",
        tone === "running" && "text-primary",
        tone === "success" && "text-success",
        tone === "danger" && "text-destructive",
      )}>{value}</span>
      <span className={cn("block truncate text-xs sm:mt-1", active ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
    </button>
  );
}

function DayColumn({
  className,
  testId,
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
  onStartAi,
  startingAiWorkItemId,
  focusedWorkItemId,
  onLocateAi,
  featured = false,
  headerExtra,
  action,
}: {
  className?: string;
  testId?: string;
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
  onStartAi?: (item: HomeWorkbenchItem) => void;
  startingAiWorkItemId: string | null;
  focusedWorkItemId: string | null;
  onLocateAi: (item: HomeWorkbenchItem) => void;
  featured?: boolean;
  headerExtra?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const perGroupLimit = 2;
  const [expandedGroups, setExpandedGroups] = useState<DailyGroupKey[]>([]);
  const groups = GROUP_ORDER.map((key) => ({
    key,
    items: items.filter((item) => displayState(item) === key).sort(compareDailyVisibility),
  })).filter((group) => group.items.length > 0);
  return (
    <section className={cn(
      "flex min-h-[330px] snap-start flex-col rounded-xl border p-3.5",
      featured
        ? "border-primary/35 bg-primary/[0.035] shadow-[0_0_0_1px_hsl(var(--primary)/0.04)]"
        : "border-border bg-background/45",
      className,
    )} data-testid={testId}>
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
            {date ? <span className="ml-auto text-[11px] text-muted-foreground">{date}</span> : null}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          {headerExtra}
        </div>
      </div>

      <div className="mt-3 flex flex-1 flex-col gap-2">
        {items.length ? groups.map((group) => {
          const expanded = expandedGroups.includes(group.key);
          const revealFocused = Boolean(focusedWorkItemId && group.items.some((item) => (item as DailyWorkItem).home?.workItemId === focusedWorkItemId));
          const hiddenCount = Math.max(0, group.items.length - perGroupLimit);
          return (
            <div key={group.key} className="space-y-1.5" data-testid={`daily-state-group-${group.key}`}>
              <div className="flex items-center gap-2 px-1 text-[11px] font-medium text-muted-foreground">
                <span>{displayStateLabel(group.items[0], copy)}</span>
                <span className="h-px flex-1 bg-border/70" aria-hidden />
                <span className="tabular-nums">{group.items.length}</span>
              </div>
              {group.items.slice(0, expanded || revealFocused ? undefined : perGroupLimit).map((item) => (
                <WorkCard
                  key={item.id}
                  item={item}
                  copy={copy}
                  locale={locale}
                  onOpen={() => onOpenItem(item)}
                  onAction={item.home ? () => onHomeAction(item.home!) : undefined}
                  onReport={item.home ? () => onHomeReport(item.home!) : undefined}
                  onStartAi={item.home && canHandOffToAi(item.home) && onStartAi ? () => onStartAi(item.home!) : undefined}
                  startingAi={Boolean(item.home && startingAiWorkItemId === item.home.workItemId)}
                  focused={Boolean(item.home && focusedWorkItemId === item.home.workItemId)}
                  onLocateAi={item.home && hasAutomatedExecution(item.home) ? () => onLocateAi(item.home!) : undefined}
                />
              ))}
              {hiddenCount > 0 && !revealFocused ? (
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
  onStartAi,
  startingAi,
  focused,
  onLocateAi,
}: {
  item: DailyWorkItem;
  copy: Copy;
  locale: string;
  onOpen: () => void;
  onAction?: () => void;
  onReport?: () => void;
  onStartAi?: () => void;
  startingAi: boolean;
  focused: boolean;
  onLocateAi?: () => void;
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
  const completedDate = formatDateOnly(home?.completedAt ?? null, locale);
  return (
    <div
      className={cn(
        "group w-full rounded-lg border border-border border-l-2 bg-card px-2.5 py-2 text-left transition-colors hover:bg-muted/45",
        STATE_ACCENT[item.state],
        focused && "ring-2 ring-primary/35",
      )}
      data-work-item-id={home?.workItemId ?? item.targetId}
      data-work-view="my"
      tabIndex={-1}
    >
      <span className="mb-1 flex flex-wrap items-center gap-1">
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
          <span className="line-clamp-2 text-[13px] font-medium [overflow-wrap:anywhere]">{item.title}</span>
          {scheduleReason || item.subtitle || item.reason ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{scheduleReason ?? item.reason ?? item.subtitle}</span>
          ) : null}
        </span>
        <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </button>
      {home ? (
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
          {completedDate ? <span>{copy.completedOn}：{completedDate}</span> : <span>{copy.expectedCompletion}：{dueDate ?? copy.noExpectedCompletion}</span>}
          <span>
            {copy.aiLabel}：{hasAutomatedExecution(home)
              ? `${executionTypeLabel(home, locale, copy)} · ${executionLabel(home, copy)}`
              : copy.coordination.aiNotLinked}
          </span>
          <span>{copy.owner}：{home.assignees.map((assignee) => assignee.name).join(", ") || "—"}</span>
          <span>{copy.waitingLabel}：{copy.waiting[home.waitingOn]}</span>
          {home.report ? (
            <span className={cn("col-span-2", home.report.stale ? "text-warning" : "")}>
              {home.report.stale ? copy.report.stale : copy.report[home.report.status]}
            </span>
          ) : null}
          {home.result?.summary ? (
            <span className="col-span-2 line-clamp-2 rounded bg-success/[0.06] px-2 py-1 text-foreground" data-testid={`result-summary-${home.workItemId}`}>
              {home.result.needsReview ? copy.attentionReason.review_ready : copy.completed}：{home.result.summary}
            </span>
          ) : null}
          <WorkCoordinationNotice item={home} copy={copy} />
        </div>
      ) : <div className="mt-1.5 text-[10px] text-muted-foreground">{completedDate ? `${copy.completedOn}：${completedDate}` : `${copy.expectedCompletion}：${dueDate ?? copy.noExpectedCompletion}`}</div>}
      <div className="mt-1.5 space-y-1.5 border-t border-border/70 pt-1.5">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge tone={displayStateTone(item)}>{displayStateLabel(item, copy)}</StatusBadge>
          {time ? <span className="text-[11px] text-muted-foreground">{time}</span> : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {onStartAi ? (
            <Button size="sm" variant="primary" disabled={startingAi} onClick={onStartAi}>
              <Bot aria-hidden />{startingAi ? copy.handingOffAi : copy.handOffAi}
            </Button>
          ) : null}
          {home && onAction ? (
            <Button size="sm" variant={onStartAi ? "secondary" : "primary"} onClick={onAction}>{copy.nextAction[home.nextAction.kind]}</Button>
          ) : null}
          <div className="flex flex-wrap items-center gap-1">
            {onLocateAi ? (
              <Button size="sm" variant="ghost" onClick={onLocateAi}>{copy.coordination.locateAi}</Button>
            ) : null}
            {home && onReport ? (
              <Button size="sm" variant="ghost" onClick={onReport}>{home.report ? copy.report.review : copy.report.prepare}</Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
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
    updatedAt: item.executionUpdatedAt ?? item.ai?.updatedAt ?? null,
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
