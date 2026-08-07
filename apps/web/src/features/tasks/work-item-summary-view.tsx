import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  FileText,
  Download,
  Eye,
  ExternalLink,
  MessageSquare,
  RefreshCw,
  UserRound,
  Wrench,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { SectionKey, WorkItemSection } from "@/store/ui-store";
import { WorkItemProgressDialog, type WorkItemProgressTarget } from "./work-item-progress-dialog";
import { TaskMaterialEditor } from "./task-material-editor";
import { readinessSetupSection, type AutoRunReadiness } from "./auto-run-readiness-ui";
import type { LocalWorkItem, LocalWorkItemObservability, WorkItemComment, WorkItemExecutionState } from "./task-view-types";

export type WorkItemUserStatus =
  | "not_started"
  | "scheduled"
  | "ai_working"
  | "waiting"
  | "needs_action"
  | "ready_for_review"
  | "blocked"
  | "completed";

type SummaryCopy = {
  loading: string;
  loadFailed: string;
  retry: string;
  status: Record<WorkItemUserStatus, string>;
  next: Record<WorkItemUserStatus, string>;
  action: Record<WorkItemUserStatus, string>;
  goal: string;
  noGoal: string;
  acceptance: string;
  noAcceptance: string;
  progress: string;
  coordination: string;
  owner: string;
  unassigned: string;
  expectedCompletion: string;
  unscheduled: string;
  aiState: string;
  waitingOn: string;
  lastProgress: string;
  noProgress: string;
  files: string;
  referenceFiles: string;
  fileReady: string;
  filePreparing: string;
  previewFile: string;
  downloadFile: string;
  removeFile: string;
  materialRemoved: string;
  materialRemovedFuture: string;
  materialRestored: string;
  materialUndoFailed: string;
  materialHint: string;
  materialRunningHint: string;
  materialCompletedHint: string;
  noReferenceFiles: string;
  undo: string;
  reopenForMaterials: string;
  reopeningTask: string;
  taskReopened: string;
  reopenFailed: string;
  reopenTitle: string;
  reopenDescription: string;
  keepCompleted: string;
  downloadOnly: string;
  useUpdatedMaterials: string;
  retryWithMaterials: string;
  materialReprocessComment: string;
  materialReprocessStarted: string;
  undoAdd: string;
  undoAddWindow: string;
  additionUndone: string;
  materialActionFailed: string;
  comments: string;
  commentPlaceholder: string;
  addComment: string;
  addingComment: string;
  commentFailed: string;
  expert: string;
  taskCenter: string;
  why: string;
  impact: string;
  remedy: string;
  errorWhy: string;
  errorImpact: string;
  errorRemedy: string;
  noAi: string;
  collaborationTitle: string;
  collaborationHint: string;
  personalPlan: string;
  aiExecution: string;
  humanReview: string;
  reviewPending: string;
  reviewReady: string;
  reviewComplete: string;
  scheduleConflict: string;
  progressSynced: string;
  commentSynced: string;
  deliverableTitle: string;
  deliverableHint: string;
  deliverableSummary: string;
  deliverableFiles: string;
  noDeliverableFiles: string;
  noDeliverableSummary: string;
  noAcceptanceResult: string;
  acceptanceResult: string;
  passed: string;
  needsReview: string;
  fullReport: string;
  hideResult: string;
  retryAi: string;
  retryTitle: string;
  retryDescription: string;
  retryConfirm: string;
  retrying: string;
  retrySucceeded: string;
  retryFailed: string;
  startAi: string;
  startingAi: string;
  aiStarted: string;
  aiStartFailed: string;
  updateProgress: string;
  requestChanges: string;
  changePlaceholder: string;
  sendChanges: string;
  sendingChanges: string;
  changesSent: string;
  changesFailed: string;
  acceptComplete: string;
  acceptTitle: string;
  acceptDescription: string;
  acceptConfirm: string;
  accepting: string;
  completedTitle: string;
  completedHint: string;
  reviewDecisionHint: string;
  completionFailed: string;
  deliveryReviewRequired: string;
  readinessTitle: string;
  readinessChecking: string;
  readinessBlocked: string;
  readinessWarning: string;
  readinessFix: string;
  readinessRetry: string;
  readinessUnavailable: string;
  writebackTitle: string;
  writebackLocalOnly: string;
  writebackLocalOnlyHint: string;
  writebackCloseExternal: string;
  writebackCloseExternalHint: string;
  writebackFailed: string;
  completedLocally: string;
  writebackDisabled: string;
};

const COPY: Record<"zh" | "en", SummaryCopy> = {
  zh: {
    loading: "正在加载任务…",
    loadFailed: "任务加载失败，请稍后重试。",
    retry: "重新加载",
    status: {
      not_started: "尚未开始",
      scheduled: "已安排",
      ai_working: "AI 处理中",
      waiting: "等待他人",
      needs_action: "需要你处理",
      ready_for_review: "等待你确认",
      blocked: "已受阻",
      completed: "已完成",
    },
    next: {
      not_started: "补充任务进展，或安排 AI 开始处理。",
      scheduled: "任务已进入计划，当前无需额外操作。",
      ai_working: "AI 正在处理；你可以查看当前进展，必要时补充说明。",
      waiting: "任务正在等待相关人员回复，建议按约定时间跟进。",
      needs_action: "任务需要你的判断或补充信息后才能继续。",
      ready_for_review: "AI 已完成当前工作，请确认结果是否符合预期。",
      blocked: "任务当前无法继续，需要先处理阻塞原因。",
      completed: "任务已经完成，可以查看最终结果和汇报。",
    },
    action: {
      not_started: "更新进展",
      scheduled: "更新进展",
      ai_working: "更新进展",
      waiting: "记录跟进",
      needs_action: "查看原因并处理",
      ready_for_review: "审核结果",
      blocked: "查看阻塞原因",
      completed: "查看结果",
    },
    goal: "任务目标",
    noGoal: "尚未补充任务说明。",
    acceptance: "完成标准",
    noAcceptance: "尚未设置完成标准。",
    progress: "当前进展",
    coordination: "人员与 AI 协同",
    owner: "负责人",
    unassigned: "尚未分配",
    expectedCompletion: "预期完成",
    unscheduled: "尚未安排",
    aiState: "AI 状态",
    waitingOn: "当前等待",
    lastProgress: "最近进展",
    noProgress: "暂无进展记录",
    files: "相关文件",
    referenceFiles: "参考文件",
    fileReady: "已就绪",
    filePreparing: "准备中",
    previewFile: "预览",
    downloadFile: "下载",
    removeFile: "移除",
    materialRemoved: "参考文件已移除。AI 处理或重新执行任务时不再使用。",
    materialRemovedFuture: "参考文件已移除。本次 AI 运行不变，重新执行任务时不再使用。",
    materialRestored: "参考文件已恢复。",
    materialUndoFailed: "暂时无法恢复参考文件，请刷新任务后重试。",
    materialHint: "选择文件后会自动加入任务，AI 处理或重新执行任务时使用。",
    materialRunningHint: "本次 AI 运行使用的材料不会改变；新增或移除将在重新执行任务时生效。",
    materialCompletedHint: "任务已完成。如需调整参考材料，请先重新打开任务。",
    noReferenceFiles: "尚未添加参考材料。",
    undo: "撤销",
    reopenForMaterials: "重新打开任务",
    reopeningTask: "正在重新打开…",
    taskReopened: "任务已重新打开，现在可以调整参考材料。",
    reopenFailed: "暂时无法重新打开任务，请稍后重试。",
    reopenTitle: "重新打开任务以调整参考材料？",
    reopenDescription: "任务会恢复为进行中；已有结果和历史记录都会保留。AI 不会自动启动，直到你选择再次处理任务。",
    keepCompleted: "保持已完成",
    downloadOnly: "此格式仅支持下载",
    useUpdatedMaterials: "使用更新后的材料重新处理",
    retryWithMaterials: "使用当前材料重试",
    materialReprocessComment: "请结合当前参考材料重新处理这个任务。",
    materialReprocessStarted: "AI 已开始使用当前参考材料重新处理任务。",
    undoAdd: "撤销添加",
    undoAddWindow: "8 秒内可撤销",
    additionUndone: "已撤销添加，AI 不会使用这些文件。",
    materialActionFailed: "暂时无法操作参考文件，请刷新任务后重试。",
    comments: "评论",
    commentPlaceholder: "补充背景、决定或需要他人知道的信息…",
    addComment: "发表评论",
    addingComment: "正在发表…",
    commentFailed: "评论发表失败，请重试。",
    expert: "技术与审计详情",
    taskCenter: "在任务中心打开",
    why: "发生了什么",
    impact: "有什么影响",
    remedy: "建议处理",
    errorWhy: "AI 执行没有成功。",
    errorImpact: "任务尚未完成，原定计划可能受到影响。",
    errorRemedy: "查看失败摘要，确认重试或调整任务。",
    noAi: "尚未关联 AI 执行",
    collaborationTitle: "协同接力",
    collaborationHint: "个人看板关注你要完成什么，AI 看板关注 AI 何时执行；两边始终是同一个任务。",
    personalPlan: "我的计划",
    aiExecution: "AI 执行",
    humanReview: "我的确认",
    reviewPending: "等待 AI 交付",
    reviewReady: "结果等待确认",
    reviewComplete: "已确认完成",
    scheduleConflict: "AI 执行日期晚于预期完成日期，可能影响按时交付。",
    progressSynced: "进展已保存，个人看板与 AI 看板已同步更新。",
    commentSynced: "评论已发布，任务协作记录已更新。",
    deliverableTitle: "交付结果",
    deliverableHint: "先在这里确认结果是否符合预期，需要核对证据时再进入完整报告。",
    deliverableSummary: "结果摘要",
    deliverableFiles: "交付文件",
    noDeliverableFiles: "暂无可展示的交付文件。",
    noDeliverableSummary: "AI 已结束处理，但没有附带可直接阅读的结果摘要；可进入完整报告核对详情。",
    noAcceptanceResult: "本任务未设置完成标准，请结合任务目标人工确认。",
    acceptanceResult: "完成标准",
    passed: "项已通过",
    needsReview: "项待确认",
    fullReport: "查看完整报告",
    hideResult: "收起结果",
    retryAi: "重试 AI 处理",
    retryTitle: "重试 AI 处理？",
    retryDescription: "系统会基于上次进展重新启动 AI 处理，可能产生新的运行时间和费用。",
    retryConfirm: "确认重试",
    retrying: "正在重试…",
    retrySucceeded: "已重新启动 AI 处理，两块看板将持续同步最新状态。",
    retryFailed: "暂时无法重新启动。任务仍保持原状态，你可以稍后重试或查看详细原因。",
    startAi: "交给 AI 开始处理",
    startingAi: "正在启动 AI…",
    aiStarted: "AI 已开始处理，两块看板会持续同步进展。",
    aiStartFailed: "AI 暂时无法开始，任务仍保持原状态。请稍后重试或查看技术详情。",
    updateProgress: "我来更新进展",
    requestChanges: "要求修改",
    changePlaceholder: "告诉 AI 需要修改什么，例如补充数据、调整格式或重新核对结论…",
    sendChanges: "发送给 AI 继续修改",
    sendingChanges: "正在发送…",
    changesSent: "修改要求已记录，AI 已开始继续处理。",
    changesFailed: "修改要求已保留，但 AI 暂时无法继续。请稍后重试。",
    acceptComplete: "接受结果并完成",
    acceptTitle: "接受结果并完成任务？",
    acceptDescription: "系统会记录你的人工确认并关闭任务。完成后仍可查看成果或重新打开。",
    acceptConfirm: "确认完成",
    accepting: "正在完成…",
    completedTitle: "这项工作已完成",
    completedHint: "最终成果、确认记录和协作过程都已保留，你可以随时回来查看。",
    reviewDecisionHint: "请确认结果是否可用；不符合预期时直接说明需要修改的地方。",
    completionFailed: "暂时无法完成任务。请核对未通过的完成标准或稍后重试。",
    deliveryReviewRequired: "此任务包含待交付的代码变更，需要先完成技术审查。",
    readinessTitle: "执行前检查",
    readinessChecking: "正在确认 AI、代码仓库和安全开关…",
    readinessBlocked: "暂时还不能启动 AI",
    readinessWarning: "可以启动，但建议先处理这些提醒",
    readinessFix: "去设置并修复",
    readinessRetry: "重新检查",
    readinessUnavailable: "无法完成执行前检查，请刷新后重试。",
    writebackTitle: "外部 Issue 如何处理？",
    writebackLocalOnly: "只完成本地任务",
    writebackLocalOnlyHint: "外部 Issue 保持原状态，之后可在“管理同步”中处理。",
    writebackCloseExternal: "完成本地任务并回写外部 Issue",
    writebackCloseExternalHint: "把最终任务内容推送到外部平台，并关闭对应 Issue。",
    writebackFailed: "本地任务已完成，但外部 Issue 回写失败。请在“管理同步”中重试；不会重复完成本地任务。",
    completedLocally: "本地任务已安全完成，外部 Issue 仍待回写。",
    writebackDisabled: "当前项目已关闭外部回写或启用了紧急停止；可先只完成本地任务。",
  },
  en: {
    loading: "Loading task…",
    loadFailed: "The task could not be loaded. Try again shortly.",
    retry: "Try again",
    status: {
      not_started: "Not started",
      scheduled: "Scheduled",
      ai_working: "AI working",
      waiting: "Waiting on others",
      needs_action: "Needs your action",
      ready_for_review: "Ready for your review",
      blocked: "Blocked",
      completed: "Completed",
    },
    next: {
      not_started: "Add a progress update or arrange for AI to begin.",
      scheduled: "The task is planned and needs no additional action right now.",
      ai_working: "AI is working. Review progress or add context when needed.",
      waiting: "The task is waiting for a response. Follow up at the agreed time.",
      needs_action: "Your decision or additional information is needed before work can continue.",
      ready_for_review: "AI finished its work. Confirm that the result meets expectations.",
      blocked: "Work cannot continue until the blocking issue is resolved.",
      completed: "The task is complete. Review the final result and report.",
    },
    action: {
      not_started: "Update progress",
      scheduled: "Update progress",
      ai_working: "Update progress",
      waiting: "Record follow-up",
      needs_action: "Review and resolve",
      ready_for_review: "Review result",
      blocked: "Review blocker",
      completed: "View result",
    },
    goal: "Task goal",
    noGoal: "No task description has been added yet.",
    acceptance: "Definition of done",
    noAcceptance: "No completion criteria have been set.",
    progress: "Current progress",
    coordination: "People and AI coordination",
    owner: "Owner",
    unassigned: "Unassigned",
    expectedCompletion: "Expected completion",
    unscheduled: "Not scheduled",
    aiState: "AI state",
    waitingOn: "Waiting on",
    lastProgress: "Latest progress",
    noProgress: "No progress update yet",
    files: "Related files",
    referenceFiles: "Reference files",
    fileReady: "Ready",
    filePreparing: "Preparing",
    previewFile: "Preview",
    downloadFile: "Download",
    removeFile: "Remove",
    materialRemoved: "Reference file removed. AI will not use it when processing or rerunning this task.",
    materialRemovedFuture: "Reference file removed. This AI run is unchanged; AI will not use it when you rerun the task.",
    materialRestored: "Reference file restored.",
    materialUndoFailed: "The reference file could not be restored. Refresh the task and try again.",
    materialHint: "Selected files join the task automatically. AI uses them when processing or rerunning this task.",
    materialRunningHint: "Materials used by this AI run will not change. Additions or removals apply when you rerun the task.",
    materialCompletedHint: "This task is complete. Reopen it before changing reference files.",
    noReferenceFiles: "No reference files have been added.",
    undo: "Undo",
    reopenForMaterials: "Reopen task",
    reopeningTask: "Reopening…",
    taskReopened: "Task reopened. You can now change reference files.",
    reopenFailed: "The task could not be reopened. Try again shortly.",
    reopenTitle: "Reopen this task to change its materials?",
    reopenDescription: "The task returns to In progress. Existing results and history stay available. AI will not start until you choose to process the task again.",
    keepCompleted: "Keep completed",
    downloadOnly: "This format supports download only",
    useUpdatedMaterials: "Process again with updated material",
    retryWithMaterials: "Retry with current material",
    materialReprocessComment: "Process this task again using the current reference materials.",
    materialReprocessStarted: "AI started another pass using the current reference materials.",
    undoAdd: "Undo add",
    undoAddWindow: "Available for 8 seconds",
    additionUndone: "Addition undone. AI will not use those files.",
    materialActionFailed: "The reference file action failed. Refresh the task and try again.",
    comments: "Comments",
    commentPlaceholder: "Add context, a decision, or something others should know…",
    addComment: "Post comment",
    addingComment: "Posting…",
    commentFailed: "The comment could not be posted. Try again.",
    expert: "Technical and audit details",
    taskCenter: "Open in task center",
    why: "What happened",
    impact: "Impact",
    remedy: "Recommended action",
    errorWhy: "The AI execution did not succeed.",
    errorImpact: "The task is incomplete and the original plan may be affected.",
    errorRemedy: "Review the failure summary, then retry or adjust the task.",
    noAi: "No AI execution is linked",
    collaborationTitle: "Collaboration handoff",
    collaborationHint: "My tasks tracks what you need to finish; AI tasks tracks when AI works. Both views represent this same task.",
    personalPlan: "My plan",
    aiExecution: "AI execution",
    humanReview: "My confirmation",
    reviewPending: "Waiting for AI delivery",
    reviewReady: "Result awaiting confirmation",
    reviewComplete: "Confirmed complete",
    scheduleConflict: "AI execution is scheduled after the expected completion date and may delay delivery.",
    progressSynced: "Progress saved. My tasks and AI tasks are now in sync.",
    commentSynced: "Comment posted. The collaboration record is up to date.",
    deliverableTitle: "Delivered result",
    deliverableHint: "Review the outcome here first. Open the full report only when you need supporting evidence.",
    deliverableSummary: "Result summary",
    deliverableFiles: "Delivered files",
    noDeliverableFiles: "No delivered files are available to preview.",
    noDeliverableSummary: "AI finished, but no readable result summary was attached. Open the full report to review the details.",
    noAcceptanceResult: "No completion criteria were set. Review the outcome against the task goal.",
    acceptanceResult: "Definition of done",
    passed: "passed",
    needsReview: "need review",
    fullReport: "View full report",
    hideResult: "Hide result",
    retryAi: "Retry AI work",
    retryTitle: "Retry AI work?",
    retryDescription: "AI will restart from the previous progress. This may use additional run time and cost.",
    retryConfirm: "Retry",
    retrying: "Retrying…",
    retrySucceeded: "AI work restarted. My tasks and AI tasks will keep showing the latest state.",
    retryFailed: "The retry could not be started. The task is unchanged; try again later or review the detailed cause.",
    startAi: "Let AI start",
    startingAi: "Starting AI…",
    aiStarted: "AI has started. My tasks and AI tasks will keep the progress in sync.",
    aiStartFailed: "AI could not start yet. The task is unchanged; retry later or open technical details.",
    updateProgress: "Update it myself",
    requestChanges: "Request changes",
    changePlaceholder: "Tell AI what to change, such as adding evidence, adjusting the format, or checking a conclusion again…",
    sendChanges: "Send changes to AI",
    sendingChanges: "Sending…",
    changesSent: "Your changes were recorded and AI has started another pass.",
    changesFailed: "Your changes were saved, but AI could not continue yet. Try again later.",
    acceptComplete: "Accept and complete",
    acceptTitle: "Accept the result and complete this task?",
    acceptDescription: "Your review will be recorded and the task will be closed. You can still view the result or reopen it later.",
    acceptConfirm: "Complete task",
    accepting: "Completing…",
    completedTitle: "This work is complete",
    completedHint: "The final result, your confirmation, and the collaboration history have all been preserved for later review.",
    reviewDecisionHint: "Confirm whether the result is usable, or describe what AI should change.",
    completionFailed: "The task could not be completed. Review unfinished criteria or try again shortly.",
    deliveryReviewRequired: "This task contains code changes that still require technical delivery review.",
    readinessTitle: "Preflight",
    readinessChecking: "Checking the AI, repository, and safety controls…",
    readinessBlocked: "AI cannot start yet",
    readinessWarning: "Ready to start, with recommendations",
    readinessFix: "Open setup and fix",
    readinessRetry: "Recheck",
    readinessUnavailable: "Preflight could not be completed. Refresh before starting AI.",
    writebackTitle: "What should happen to the external issue?",
    writebackLocalOnly: "Complete the local task only",
    writebackLocalOnlyHint: "Leave the external issue unchanged and handle it later from Manage sync.",
    writebackCloseExternal: "Complete locally and write back",
    writebackCloseExternalHint: "Push the final task content to the provider and close the external issue.",
    writebackFailed: "The local task is complete, but external writeback failed. Retry from Manage sync; the local completion will not be repeated.",
    completedLocally: "The local task completed safely. External writeback is still pending.",
    writebackDisabled: "External writeback is disabled for this project or emergency stop is active. Complete locally for now.",
  },
};

const AI_LABEL: Record<"zh" | "en", Record<WorkItemExecutionState, string>> = {
  zh: { unclaimed: "尚未执行", claimed: "已认领", running: "执行中", awaiting_approval: "等待审批", verifying: "验证中", failed: "执行失败", completed: "等待复核" },
  en: { unclaimed: "Not started", claimed: "Claimed", running: "Running", awaiting_approval: "Awaiting approval", verifying: "Verifying", failed: "Execution failed", completed: "Awaiting review" },
};

const WAITING_LABEL: Record<"zh" | "en", Record<LocalWorkItem["waitingOn"], string>> = {
  zh: { me: "我", requester: "提出者", internal: "内部成员", ai: "AI", none: "无需等待" },
  en: { me: "Me", requester: "Requester", internal: "Internal teammate", ai: "AI", none: "No one" },
};

export function deriveWorkItemUserStatus(item: LocalWorkItem): WorkItemUserStatus {
  if (item.state === "closed" || item.status === "done" || item.planningStatus === "done") return "completed";
  if (item.executionState === "failed") return "needs_action";
  if (item.executionState === "awaiting_approval") return "needs_action";
  if (item.executionState === "completed") return "ready_for_review";
  if (["claimed", "running", "verifying"].includes(item.executionState ?? "")) return "ai_working";
  if (item.waitingOn === "me") return "needs_action";
  if (item.status === "blocked" || item.planningStatus === "blocked") return "blocked";
  if (item.status === "review" || item.planningStatus === "review") return "ready_for_review";
  if (["requester", "internal"].includes(item.waitingOn)) return "waiting";
  if (item.plannedDate) return "scheduled";
  return "not_started";
}

function expertSectionFor(item: LocalWorkItem, status: WorkItemUserStatus): WorkItemSection {
  if (item.executionState === "failed" || status === "blocked") return "process";
  if (item.executionState === "awaiting_approval") return "verification";
  if (status === "ready_for_review" || status === "completed") return "report";
  return "overview";
}

export function WorkItemSummaryView({
  workItemId,
  onOpenExpert,
  onOpenTaskCenter,
  onOpenSetup,
  onDirtyChange,
  onCompletedChange,
}: {
  workItemId: string;
  onOpenExpert: (section?: WorkItemSection) => void;
  onOpenTaskCenter?: () => void;
  onOpenSetup?: (section: SectionKey) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCompletedChange?: (completed: boolean | null) => void;
}) {
  const { i18n } = useAppTranslation();
  const language = i18n.language.startsWith("zh") ? "zh" : "en";
  const copy = COPY[language];
  const { data: consoleState } = useConsoleState();
  const [item, setItem] = useState<LocalWorkItem | null>(null);
  const [observability, setObservability] = useState<LocalWorkItemObservability | null>(null);
  const [readiness, setReadiness] = useState<AutoRunReadiness | null>(null);
  const [comments, setComments] = useState<WorkItemComment[]>([]);
  const [comment, setComment] = useState("");
  const [commentPending, setCommentPending] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [materialPendingId, setMaterialPendingId] = useState<string | null>(null);
  const [materialError, setMaterialError] = useState<string | null>(null);
  const [materialUndo, setMaterialUndo] = useState<{ assetId: string; name: string; notice: string } | null>(null);
  const [materialNotice, setMaterialNotice] = useState<string | null>(null);
  const [materialAddUndo, setMaterialAddUndo] = useState<{ assetIds: string[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progressOpen, setProgressOpen] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [retryOpen, setRetryOpen] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [resultExpanded, setResultExpanded] = useState(false);
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const [actionPending, setActionPending] = useState<"start" | "changes" | "complete" | "reopen" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [changeRequestOpen, setChangeRequestOpen] = useState(false);
  const [changeRequest, setChangeRequest] = useState("");
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [completionWriteback, setCompletionWriteback] = useState<"local_only" | "sync_close">("local_only");
  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<NonNullable<LocalWorkItem["inputAssets"]>[number] | null>(null);

  useEffect(() => {
    setItem(null);
    setObservability(null);
    setReadiness(null);
    setComments([]);
    setComment("");
    setMaterialError(null);
    setMaterialUndo(null);
    setMaterialNotice(null);
    setMaterialAddUndo(null);
    setLoadError(null);
    setSyncNotice(null);
    setRetryOpen(false);
    setRetryPending(false);
    setRetryError(null);
    setResultExpanded(false);
    setDiscussionOpen(false);
    setActionPending(null);
    setActionError(null);
    setChangeRequestOpen(false);
    setChangeRequest("");
    setAcceptOpen(false);
    setCompletionWriteback("local_only");
    setReopenConfirmOpen(false);
    setPreviewAsset(null);
  }, [workItemId]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      api.getWorkItem(workItemId) as Promise<{ workItem: LocalWorkItem; observability?: LocalWorkItemObservability }>,
      api.listWorkItemComments(workItemId) as Promise<{ comments: WorkItemComment[] }>,
    ]).then(([detail, commentResult]) => {
      if (cancelled) return;
      if (detail.status === "fulfilled") {
        setItem(detail.value.workItem);
        setObservability(detail.value.observability ?? null);
        setLoadError(null);
        void (api.autoRunReadiness(detail.value.workItem.projectId) as Promise<{ readiness?: AutoRunReadiness }>)
          .then((result) => {
            if (!cancelled) setReadiness(result.readiness ?? {
              ready: false,
              checks: [{ key: "preflight", label: copy.readinessTitle, status: "blocked", detail: copy.readinessUnavailable }],
            });
          })
          .catch(() => {
            if (!cancelled) setReadiness({
              ready: false,
              checks: [{ key: "preflight", label: copy.readinessTitle, status: "blocked", detail: copy.readinessUnavailable }],
            });
          });
      } else {
        setLoadError(copy.loadFailed);
      }
      if (commentResult.status === "fulfilled") setComments(commentResult.value.comments ?? []);
    });
    return () => { cancelled = true; };
  }, [copy.loadFailed, copy.readinessTitle, copy.readinessUnavailable, refreshVersion, workItemId]);

  useEffect(() => {
    onDirtyChange?.(Boolean(comment.trim() || changeRequest.trim()));
    return () => onDirtyChange?.(false);
  }, [changeRequest, comment, onDirtyChange]);

  useEffect(() => {
    onCompletedChange?.(item ? deriveWorkItemUserStatus(item) === "completed" : null);
    return () => onCompletedChange?.(null);
  }, [item, onCompletedChange]);

  useEffect(() => {
    if (!materialUndo) return undefined;
    const timer = window.setTimeout(() => setMaterialUndo(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [materialUndo]);

  useEffect(() => {
    if (!materialAddUndo) return undefined;
    const timer = window.setTimeout(() => setMaterialAddUndo(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [materialAddUndo]);

  const owners = useMemo(() => item?.assigneeIds?.map((id) =>
    consoleState?.users?.find((user) => user.id === id)?.name ?? id) ?? [], [consoleState?.users, item?.assigneeIds]);

  if (!item) {
    return (
      <div className="grid justify-items-center gap-3 py-8 text-center">
        <p className={loadError ? "text-sm text-destructive" : "text-sm text-muted-foreground"} role={loadError ? "alert" : "status"}>{loadError ?? copy.loading}</p>
        {loadError ? <Button variant="secondary" onClick={() => setRefreshVersion((version) => version + 1)}>{copy.retry}</Button> : null}
      </div>
    );
  }

  const status = deriveWorkItemUserStatus(item);
  const failed = item.executionState === "failed";
  const materialChangesApplyOnRerun = ["claimed", "running", "awaiting_approval", "verifying"].includes(item.executionState ?? "");
  const dateLocale = language === "zh" ? "zh-CN" : "en-US";
  const dueDate = item.dueDate
    ? new Intl.DateTimeFormat(dateLocale, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${item.dueDate}T00:00:00`))
    : copy.unscheduled;
  const plannedDate = item.plannedDate
    ? new Intl.DateTimeFormat(dateLocale, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${item.plannedDate}T00:00:00`))
    : copy.unscheduled;
  const scheduleConflict = Boolean(item.dueDate && item.plannedDate && item.plannedDate > item.dueDate);
  const hasAiExecution = Boolean(item.plannedDate || (item.executionState && item.executionState !== "unclaimed"));
  const collaborationStage = status === "completed"
    ? 3
    : status === "ready_for_review"
      ? 2
      : hasAiExecution
      ? 1
      : 0;
  const hasBoundAutoRun = item.executionBindings?.some((binding) => binding.kind === "auto_run") ?? false;
  const startEligible = ["not_started", "scheduled"].includes(status) && !hasBoundAutoRun && !observability?.latestRun;
  const canStartAi = startEligible && readiness?.ready === true;
  const readinessBlocked = startEligible && readiness?.ready === false;
  const readinessChecking = startEligible && readiness == null;
  const readinessWarnings = readiness?.checks.filter((check) => check.status === "warn") ?? [];
  const primaryUsesProgress = ["not_started", "scheduled", "ai_working", "waiting"].includes(status) && !startEligible;
  const retryableRun = failed && observability?.latestRun
    && ["failed", "blocked"].includes(observability.latestRun.status)
    ? observability.latestRun
    : null;
  const resultSectionId = `work-item-result-${item.id}`;
  const acceptancePassed = item.acceptanceResults?.filter((result) => result.status === "passed").length ?? 0;
  const acceptanceNeedsReview = (item.acceptanceResults?.length ?? item.acceptanceCriteria.length) - acceptancePassed;
  const outputAssets = item.outputAssets ?? [];
  const primaryExternalBinding = item.externalBindings?.find((binding) => binding.isPrimary !== false)
    ?? item.externalBindings?.[0]
    ?? null;
  const externalProvider = primaryExternalBinding
    ? primaryExternalBinding.provider
      ?? (primaryExternalBinding.kind === "gitlab_issue" ? "gitlab" : primaryExternalBinding.kind === "gitea_issue" ? "gitea" : "github")
    : null;
  const externalProviderLabel = externalProvider === "gitlab" ? "GitLab" : externalProvider === "gitea" ? "Gitea" : "GitHub";
  const projectExternalPolicy = consoleState?.projects?.find((project) => project.id === item.projectId)?.externalIssuePolicy;
  const externalWritebackAllowed = projectExternalPolicy?.writebackEnabled !== false && projectExternalPolicy?.emergencyStop !== true;
  const progressTarget: WorkItemProgressTarget = {
    id: item.id,
    title: item.title,
    revision: item.revision,
    requesterRelation: item.requesterRelation ?? "unknown",
    waitingOn: item.waitingOn ?? "none",
    nextFollowUpAt: item.nextFollowUpAt ?? null,
  };
  const postComment = async () => {
    const body = comment.trim();
    if (!body || commentPending) return;
    setCommentPending(true);
    setCommentError(null);
    try {
      await api.createWorkItemComment(item.id, body);
      setComment("");
      setSyncNotice(copy.commentSynced);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-comment", workItemId: item.id } }));
      setRefreshVersion((version) => version + 1);
    } catch {
      setCommentError(copy.commentFailed);
    } finally {
      setCommentPending(false);
    }
  };
  const previewMaterial = (assetId: string) => {
    setPreviewAsset(item.inputAssets?.find((asset) => asset.id === assetId) ?? null);
  };
  const downloadMaterial = (assetId: string) => {
    const anchor = document.createElement("a");
    anchor.href = api.taskMaterialContentUrl(item.id, assetId, true);
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };
  const removeMaterial = async (assetId: string) => {
    if (materialPendingId) return;
    const asset = item.inputAssets?.find((candidate) => candidate.id === assetId);
    setMaterialPendingId(assetId);
    setMaterialError(null);
    setMaterialAddUndo(null);
    try {
      const response = await api.removeWorkItemMaterial(item.id, assetId, item.revision) as { workItem: LocalWorkItem; appliesTo: "next_execution" | "future_execution" };
      setItem(response.workItem);
      setMaterialUndo({
        assetId,
        name: asset?.originalName ?? asset?.path.split("/").pop() ?? copy.referenceFiles,
        notice: response.appliesTo === "future_execution" ? copy.materialRemovedFuture : copy.materialRemoved,
      });
      setSyncNotice(null);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-material-remove", workItemId: item.id } }));
    } catch {
      setMaterialError(copy.materialActionFailed);
    } finally {
      setMaterialPendingId(null);
    }
  };
  const undoAddedMaterials = async () => {
    if (!materialAddUndo || materialPendingId) return;
    setMaterialPendingId(materialAddUndo.assetIds[0] ?? "undo-add");
    setMaterialError(null);
    try {
      let current = item;
      for (const assetId of materialAddUndo.assetIds) {
        const response = await api.removeWorkItemMaterial(current.id, assetId, current.revision) as { workItem: LocalWorkItem };
        current = response.workItem;
      }
      setItem(current);
      setMaterialAddUndo(null);
      setMaterialNotice(copy.additionUndone);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-material-add-undone", workItemId: item.id } }));
    } catch {
      setMaterialError(copy.materialActionFailed);
    } finally {
      setMaterialPendingId(null);
    }
  };
  const restoreMaterial = async () => {
    if (!materialUndo || materialPendingId) return;
    setMaterialPendingId(materialUndo.assetId);
    setMaterialError(null);
    try {
      const response = await api.restoreWorkItemMaterial(item.id, materialUndo.assetId, item.revision) as { workItem: LocalWorkItem };
      setItem(response.workItem);
      setMaterialUndo(null);
      setMaterialNotice(`${materialUndo.name}: ${copy.materialRestored}`);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-material-restore", workItemId: item.id } }));
    } catch {
      setMaterialError(copy.materialUndoFailed);
    } finally {
      setMaterialPendingId(null);
    }
  };
  const reopenForMaterials = async () => {
    if (actionPending) return;
    setActionPending("reopen");
    setMaterialError(null);
    try {
      const response = await api.transitionWorkItem(item.id, "reopen", item.revision) as { workItem: LocalWorkItem };
      setItem(response.workItem);
      setReopenConfirmOpen(false);
      setMaterialNotice(copy.taskReopened);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-reopened-for-materials", workItemId: item.id } }));
    } catch {
      setMaterialError(copy.reopenFailed);
    } finally {
      setActionPending(null);
    }
  };
  const startAiWork = async () => {
    if (actionPending || !canStartAi) return;
    setActionPending("start");
    setActionError(null);
    try {
      await api.startWorkItemAutoRun(item.id);
      setSyncNotice(copy.aiStarted);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-start-ai", workItemId: item.id } }));
      setRefreshVersion((version) => version + 1);
    } catch {
      setActionError(copy.aiStartFailed);
    } finally {
      setActionPending(null);
    }
  };
  const sendChangeRequest = async (bodyOverride?: string) => {
    const body = (bodyOverride ?? changeRequest).trim();
    if (!body || actionPending) return;
    setActionPending("changes");
    setActionError(null);
    let commentSaved = false;
    try {
      await api.createWorkItemComment(item.id, body);
      commentSaved = true;
      await api.startWorkItemAutoRun(item.id);
      setChangeRequest("");
      setChangeRequestOpen(false);
      setResultExpanded(false);
      setSyncNotice(copy.changesSent);
      if (bodyOverride) setMaterialNotice(copy.materialReprocessStarted);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-request-changes", workItemId: item.id } }));
      setRefreshVersion((version) => version + 1);
    } catch {
      setActionError(commentSaved ? copy.changesFailed : copy.commentFailed);
      if (commentSaved) {
        window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-change-comment", workItemId: item.id } }));
        setRefreshVersion((version) => version + 1);
      }
    } finally {
      setActionPending(null);
    }
  };
  const acceptAndComplete = async () => {
    if (actionPending) return;
    if (observability?.delivery && observability.delivery.review?.verdict !== "approved") {
      setActionError(copy.deliveryReviewRequired);
      return;
    }
    setActionPending("complete");
    setActionError(null);
    try {
      let current = item;
      if (item.acceptanceCriteria.length && acceptancePassed < item.acceptanceCriteria.length) {
        const verification = await api.recordWorkItemVerification(item.id, {
          expectedRevision: item.revision,
          kind: "manual",
          status: "passed",
          command: null,
          summary: language === "zh" ? "用户已审核交付结果并确认符合完成标准。" : "The user reviewed the delivered result and accepted the completion criteria.",
          acceptanceResults: item.acceptanceCriteria.map((criterion) => ({
            criterion,
            status: "passed",
            note: language === "zh" ? "用户确认" : "Accepted by user",
          })),
          evidence: [],
        }) as { workItem: LocalWorkItem };
        current = verification.workItem;
        setItem(current);
      }
      const response = observability?.delivery
        ? await api.deliverWorkItem(current.id, observability.delivery.mode, current.revision) as { workItem: LocalWorkItem }
        : await api.transitionWorkItem(current.id, "close", current.revision) as { workItem: LocalWorkItem };
      setItem(response.workItem);
      setAcceptOpen(false);
      setSyncNotice(null);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-completed", workItemId: item.id } }));
      if (primaryExternalBinding && externalProvider && completionWriteback === "sync_close") {
        try {
          const syncPayload = { expectedRevision: response.workItem.revision, direction: "push" };
          const synced = externalProvider === "github"
            ? await api.syncWorkItemGithubIssue(response.workItem.id, syncPayload) as { workItem?: LocalWorkItem }
            : await api.syncWorkItemExternalIssue(response.workItem.id, externalProvider, syncPayload) as { workItem?: LocalWorkItem };
          if (synced.workItem) setItem(synced.workItem);
        } catch {
          setActionError(copy.writebackFailed);
          setSyncNotice(copy.completedLocally);
          return;
        }
      }
    } catch {
      setActionError(copy.completionFailed);
      setRefreshVersion((version) => version + 1);
    } finally {
      setActionPending(null);
    }
  };
  const runPrimaryAction = () => {
    if (retryableRun) {
      setRetryError(null);
      setRetryOpen(true);
      return;
    }
    if (status === "ready_for_review" || status === "completed") {
      if (resultExpanded) {
        setResultExpanded(false);
        return;
      }
      setResultExpanded(true);
      window.requestAnimationFrame(() => {
        document.getElementById(resultSectionId)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      });
      return;
    }
    if (startEligible) {
      if (!canStartAi) return;
      void startAiWork();
      return;
    }
    if (primaryUsesProgress) {
      setProgressOpen(true);
      return;
    }
    onOpenExpert(expertSectionFor(item, status));
  };
  const retryAiWork = async () => {
    if (!retryableRun || retryPending) return;
    setRetryPending(true);
    setRetryError(null);
    try {
      await api.retryAutoRun(retryableRun.id);
      setRetryOpen(false);
      setSyncNotice(copy.retrySucceeded);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-retry", workItemId: item.id } }));
      setRefreshVersion((version) => version + 1);
    } catch {
      setRetryError(copy.retryFailed);
    } finally {
      setRetryPending(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="work-item-summary-view">
      <header className="pr-8">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{item.localRef}</span>
          <Badge tone={status === "completed" ? "success" : ["needs_action", "blocked"].includes(status) ? "warning" : status === "ai_working" ? "running" : "neutral"}>
            {copy.status[status]}
          </Badge>
        </div>
        <h3 className="mt-2 text-xl font-semibold leading-tight [overflow-wrap:anywhere]">{item.title}</h3>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><UserRound className="size-3.5" aria-hidden />{owners.join(", ") || copy.unassigned}</span>
          <span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" aria-hidden />{dueDate}</span>
          <span className="inline-flex items-center gap-1"><Clock3 className="size-3.5" aria-hidden />{copy.waitingOn}: {WAITING_LABEL[language][item.waitingOn ?? "none"]}</span>
        </div>
      </header>

      {status !== "completed" ? <section className="rounded-xl border border-primary/30 bg-primary/[0.055] p-4" aria-labelledby={`work-item-next-${item.id}`}>
        <div className="flex gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><CircleDot className="size-4" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h4 id={`work-item-next-${item.id}`} className="text-sm font-semibold">{copy.progress}</h4>
            <p className="mt-1 text-sm leading-relaxed text-foreground/90">{copy.next[status]}</p>
            {item.lastProgressSummary ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{copy.lastProgress}: {item.lastProgressSummary}</p> : null}
            <Button
              className="mt-3 w-full sm:w-auto"
              disabled={Boolean(actionPending) || readinessChecking || readinessBlocked}
              aria-expanded={status === "ready_for_review" ? resultExpanded : undefined}
              aria-controls={status === "ready_for_review" ? resultSectionId : undefined}
              onClick={runPrimaryAction}
            >
              {retryableRun
                ? copy.retryAi
                : startEligible
                  ? actionPending === "start" ? copy.startingAi : readinessChecking ? copy.readinessChecking : copy.startAi
                  : resultExpanded ? copy.hideResult : copy.action[status]}
              {retryableRun || startEligible || status !== "ready_for_review"
                ? <ArrowRight aria-hidden />
                : <ChevronDown className={`transition-transform ${resultExpanded ? "rotate-180" : ""}`} aria-hidden />}
            </Button>
            {startEligible ? <Button className="mt-2 w-full sm:ml-2 sm:w-auto" variant="ghost" disabled={Boolean(actionPending)} onClick={() => setProgressOpen(true)}>{copy.updateProgress}</Button> : null}
          </div>
        </div>
      </section> : null}

      {startEligible && readiness && (readinessBlocked || readinessWarnings.length > 0) ? (
        <section
          className={`rounded-xl border p-4 ${readinessBlocked ? "border-destructive/35 bg-destructive/[0.05]" : "border-warning/35 bg-warning/[0.06]"}`}
          aria-label={copy.readinessTitle}
          role={readinessBlocked ? "alert" : "status"}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h4 className={`text-sm font-semibold ${readinessBlocked ? "text-destructive" : ""}`}>{readinessBlocked ? copy.readinessBlocked : copy.readinessWarning}</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {readiness.checks.filter((check) => check.status === (readinessBlocked ? "blocked" : "warn")).map((check) => (
                  <li key={check.key}><span className="font-medium text-foreground">{check.label}:</span> {check.detail}</li>
                ))}
              </ul>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setReadiness(null); setRefreshVersion((version) => version + 1); }}>{copy.readinessRetry}</Button>
              <Button size="sm" variant="secondary" onClick={() => { if (onOpenSetup) onOpenSetup(readinessSetupSection(readiness)); else onOpenExpert("process"); }}>{copy.readinessFix}</Button>
            </div>
          </div>
        </section>
      ) : null}

      {actionError ? <p className="rounded-lg border border-destructive/35 bg-destructive/[0.05] px-3 py-2 text-sm text-destructive" role="alert">{actionError}</p> : null}

      {syncNotice ? (
        <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/[0.06] px-3 py-2 text-sm" role="status">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <span className="min-w-0 flex-1">{syncNotice}</span>
        </div>
      ) : null}

      {primaryExternalBinding ? (
        <section className="rounded-xl border border-border bg-muted/25 p-4" aria-label={language === "zh" ? "外部 Issue 来源" : "External issue source"}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold">{language === "zh" ? "外部 Issue 来源" : "External issue source"}</h4>
                <Badge tone="neutral">{externalProviderLabel} #{primaryExternalBinding.number}</Badge>
                <Badge tone={primaryExternalBinding.conflict ? "danger" : "neutral"}>
                  {primaryExternalBinding.conflict
                    ? language === "zh" ? "存在同步冲突" : "Sync conflict"
                    : primaryExternalBinding.syncPolicy === "manual"
                      ? language === "zh" ? "手动同步" : "Manual sync"
                      : language === "zh" ? "已连接" : "Connected"}
                </Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {primaryExternalBinding.syncPolicy === "manual"
                  ? status === "completed"
                    ? language === "zh"
                      ? "本地任务已经完成，但外部 Issue 不会自动关闭；请确认后再推送本地结果。"
                      : "The local task is complete, but the external issue will not close automatically. Review it before pushing the local result."
                    : language === "zh"
                      ? "本地 Issue 是执行主记录；外部内容默认不会自动覆盖或回写。"
                      : "The local issue is the execution record. External content is not overwritten or written back automatically."
                  : language === "zh"
                    ? "外部 Issue 已连接；可在同步详情中查看最近状态。"
                    : "The external issue is connected. Open sync details to review its latest state."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {primaryExternalBinding.url ? (
                <a className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted" href={primaryExternalBinding.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" aria-hidden />{language === "zh" ? "打开外部 Issue" : "Open external issue"}
                </a>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => onOpenExpert("trace")}>
                {language === "zh" ? "管理同步" : "Manage sync"}
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {status === "completed" ? (
        <section className="rounded-xl border border-success/35 bg-success/[0.06] p-4" aria-label={copy.completedTitle} role="status">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success/15 text-success"><CheckCircle2 className="size-5" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold">{copy.completedTitle}</h4>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{copy.completedHint}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" aria-expanded={resultExpanded} aria-controls={resultSectionId} onClick={() => setResultExpanded((expanded) => !expanded)}>
                  {resultExpanded ? copy.hideResult : copy.action.completed}
                  <ChevronDown className={`transition-transform ${resultExpanded ? "rotate-180" : ""}`} aria-hidden />
                </Button>
                {onOpenTaskCenter ? <Button size="sm" variant="secondary" onClick={onOpenTaskCenter}>{copy.taskCenter}</Button> : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {failed ? (
        <section className="grid gap-2 rounded-xl border border-destructive/35 bg-destructive/[0.04] p-4 text-sm sm:grid-cols-3">
          <div><p className="text-xs font-medium text-muted-foreground">{copy.why}</p><p className="mt-1">{copy.errorWhy}</p></div>
          <div><p className="text-xs font-medium text-muted-foreground">{copy.impact}</p><p className="mt-1">{copy.errorImpact}</p></div>
          <div><p className="text-xs font-medium text-muted-foreground">{copy.remedy}</p><p className="mt-1">{copy.errorRemedy}</p></div>
        </section>
      ) : null}

      {status === "ready_for_review" && resultExpanded ? (
        <section className="sticky top-0 z-20 -mx-1 rounded-xl border border-primary/35 bg-card/95 p-3 shadow-md backdrop-blur" aria-label={copy.reviewDecisionHint}>
          <p className="mb-2 text-xs leading-relaxed text-muted-foreground">{copy.reviewDecisionHint}</p>
          {observability?.delivery && observability.delivery.review?.verdict !== "approved" ? (
            <p className="mb-3 rounded-lg bg-warning/[0.08] px-3 py-2 text-sm text-foreground" role="status">{copy.deliveryReviewRequired}</p>
          ) : null}
          {changeRequestOpen ? (
            <div className="rounded-lg border border-border bg-background p-3">
              <Textarea rows={3} autoFocus value={changeRequest} placeholder={copy.changePlaceholder} onChange={(event) => setChangeRequest(event.target.value)} />
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <Button variant="ghost" disabled={Boolean(actionPending)} onClick={() => { setChangeRequestOpen(false); setChangeRequest(""); }}>{language === "zh" ? "取消" : "Cancel"}</Button>
                <Button disabled={!changeRequest.trim() || Boolean(actionPending)} onClick={() => void sendChangeRequest()}>{actionPending === "changes" ? copy.sendingChanges : copy.sendChanges}</Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 sm:flex sm:justify-end">
              <Button variant="secondary" disabled={Boolean(actionPending)} onClick={() => setChangeRequestOpen(true)}>{copy.requestChanges}</Button>
              <Button
                disabled={Boolean(actionPending) || Boolean(observability?.delivery && observability.delivery.review?.verdict !== "approved")}
                onClick={() => { setCompletionWriteback("local_only"); setAcceptOpen(true); }}
              >
                <CheckCircle2 aria-hidden />{copy.acceptComplete}
              </Button>
            </div>
          )}
        </section>
      ) : null}

      {(status === "ready_for_review" || status === "completed") && resultExpanded ? (
        <section id={resultSectionId} className="scroll-mt-4 rounded-xl border border-success/30 bg-success/[0.035] p-4" aria-labelledby={`${resultSectionId}-title`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 id={`${resultSectionId}-title`} className="text-sm font-semibold">{copy.deliverableTitle}</h4>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{copy.deliverableHint}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => onOpenExpert("report")}>{copy.fullReport}</Button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-background/70 px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground">{copy.deliverableSummary}</p>
              <p className="mt-1 leading-relaxed">{item.lastProgressSummary || copy.noDeliverableSummary}</p>
            </div>
            <div className="rounded-lg bg-background/70 px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground">{copy.acceptanceResult}</p>
              <p className="mt-1">{item.acceptanceCriteria.length || item.acceptanceResults?.length
                ? `${acceptancePassed} ${copy.passed} · ${Math.max(0, acceptanceNeedsReview)} ${copy.needsReview}`
                : copy.noAcceptanceResult}</p>
            </div>
          </div>
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">{copy.deliverableFiles}</p>
            {outputAssets.length ? (
              <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                {outputAssets.slice(0, 4).map((asset, index) => (
                  <li key={`${asset.id ?? asset.path}-${index}`} className="min-w-0 rounded-lg bg-background/70 px-3 py-2 text-sm [overflow-wrap:anywhere]">
                    <FileText className="mr-1.5 inline size-3.5 text-muted-foreground" aria-hidden />
                    {asset.path.split(/[\\/]/).at(-1) ?? asset.path}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1.5 text-sm text-muted-foreground">{copy.noDeliverableFiles}</p>}
          </div>
        </section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-xl border border-border p-4">
          <div className="flex items-center gap-2"><FileText className="size-4 text-primary" aria-hidden /><h4 className="text-sm font-semibold">{copy.goal}</h4></div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{item.body?.trim() || copy.noGoal}</p>
        </section>
        <section className="rounded-xl border border-border p-4">
          <div className="flex items-center gap-2"><CheckCircle2 className="size-4 text-primary" aria-hidden /><h4 className="text-sm font-semibold">{copy.acceptance}</h4></div>
          {item.acceptanceCriteria?.length ? (
            <ul className="mt-2 space-y-1.5 text-sm">{item.acceptanceCriteria.map((criterion) => <li key={criterion} className="flex gap-2"><span aria-hidden>✓</span><span>{criterion}</span></li>)}</ul>
          ) : <p className="mt-2 text-sm text-muted-foreground">{copy.noAcceptance}</p>}
        </section>
      </div>

      <section className="rounded-xl border border-border p-4" aria-labelledby={`work-item-materials-${item.id}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-primary" aria-hidden />
              <h4 id={`work-item-materials-${item.id}`} className="text-sm font-semibold">{copy.referenceFiles}</h4>
              <Badge tone="neutral">{item.inputAssets?.length ?? 0}</Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {status === "completed" ? copy.materialCompletedHint : materialChangesApplyOnRerun ? copy.materialRunningHint : copy.materialHint}
            </p>
          </div>
          {status !== "completed" ? <TaskMaterialEditor item={item} onUpdated={(next, notice) => {
            const previousIds = new Set((item.inputAssets ?? []).map((asset) => asset.id).filter(Boolean));
            const addedIds = (next.inputAssets ?? []).map((asset) => asset.id).filter((id): id is string => Boolean(id) && !previousIds.has(id));
            setItem(next);
            setMaterialNotice(notice);
            setMaterialUndo(null);
            setMaterialAddUndo(addedIds.length ? { assetIds: addedIds } : null);
            window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-material-add", workItemId: next.id } }));
          }} /> : <Button size="sm" variant="secondary" disabled={Boolean(actionPending)} onClick={() => setReopenConfirmOpen(true)}>{copy.reopenForMaterials}</Button>}
        </div>
        {item.inputAssets?.length ? (
          <div className="mt-3 space-y-2">
            {item.inputAssets.map((asset, index) => (
              <div key={asset.id ?? `${asset.path}-${index}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/45 px-3 py-2 text-sm">
                <FileText className="size-4 shrink-0 text-primary" aria-hidden />
                <span className="min-w-[10rem] flex-1 truncate">{asset.originalName ?? asset.path.split("/").pop()}</span>
                {asset.size != null ? <span className="text-xs text-muted-foreground">{Math.max(1, Math.round(asset.size / 1024))}KB</span> : null}
                <Badge tone="neutral">{asset.readiness?.state === "ready" ? copy.fileReady : copy.filePreparing}</Badge>
                {asset.id && asset.readiness?.reason === "task_material_claimed" ? (
                  <span className="flex shrink-0 flex-wrap items-center gap-1">
                    {(asset.mimeType?.startsWith("text/") || asset.mimeType?.startsWith("image/") || asset.mimeType === "application/pdf" || asset.mimeType === "application/json") ? (
                      <Button size="sm" variant="ghost" aria-label={`${copy.previewFile}: ${asset.originalName ?? asset.path}`} onClick={() => previewMaterial(asset.id!)}><Eye className="size-3.5" aria-hidden />{copy.previewFile}</Button>
                    ) : <Badge tone="neutral">{copy.downloadOnly}</Badge>}
                    <Button size="sm" variant="ghost" aria-label={`${copy.downloadFile}: ${asset.originalName ?? asset.path}`} onClick={() => downloadMaterial(asset.id!)}><Download className="size-3.5" aria-hidden />{copy.downloadFile}</Button>
                    {status !== "completed" ? <Button size="sm" variant="ghost" className="hover:text-destructive" aria-label={`${copy.removeFile}: ${asset.originalName ?? asset.path}`} disabled={materialPendingId === asset.id} onClick={() => void removeMaterial(asset.id!)}><Trash2 className="size-3.5" aria-hidden />{copy.removeFile}</Button> : null}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {materialNotice ? (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-success/30 bg-success/[0.06] px-3 py-2 text-sm" role="status">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <span className="min-w-0 flex-1">{materialNotice}</span>
            {materialAddUndo ? <span className="flex shrink-0 items-center gap-1"><span className="text-xs text-muted-foreground">{copy.undoAddWindow}</span><Button size="sm" variant="ghost" className="-my-1 shrink-0" disabled={Boolean(materialPendingId)} onClick={() => void undoAddedMaterials()}>{copy.undoAdd}</Button></span> : null}
          </div>
        ) : null}
        {materialUndo ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-success/30 bg-success/[0.06] px-3 py-2 text-sm" role="status">
            <span className="min-w-0 flex-1">{materialUndo.notice}</span>
            <Button size="sm" variant="ghost" className="-my-1 shrink-0" disabled={Boolean(materialPendingId)} onClick={() => void restoreMaterial()}>{copy.undo}</Button>
          </div>
        ) : null}
        {item.inputAssets?.length && item.materialChangesPending && status === "ready_for_review" && !materialChangesApplyOnRerun ? (
          <div className="mt-3 flex justify-end">
            <Button size="sm" disabled={Boolean(actionPending)} onClick={() => void sendChangeRequest(copy.materialReprocessComment)}><RefreshCw aria-hidden />{copy.useUpdatedMaterials}</Button>
          </div>
        ) : null}
        {item.inputAssets?.length && status === "needs_action" && failed ? (
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="secondary" disabled={Boolean(actionPending)} onClick={() => setRetryOpen(true)}><RefreshCw aria-hidden />{copy.retryWithMaterials}</Button>
          </div>
        ) : null}
        {materialError ? <p className="mt-2 text-sm text-destructive" role="alert">{materialError}</p> : null}
      </section>

      <section className="rounded-xl border border-border p-4" aria-labelledby={`work-item-collaboration-${item.id}`}>
        <h4 id={`work-item-collaboration-${item.id}`} className="text-sm font-semibold">{copy.collaborationTitle}</h4>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{copy.collaborationHint}</p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-3" data-testid="work-item-collaboration-path">
          <CollaborationStage
            active={collaborationStage === 0}
            complete={collaborationStage > 0}
            icon={UserRound}
            label={copy.personalPlan}
            detail={dueDate}
          />
          <CollaborationStage
            active={collaborationStage === 1}
            complete={hasAiExecution && collaborationStage > 1}
            icon={Bot}
            label={copy.aiExecution}
            detail={`${plannedDate} · ${item.executionState ? AI_LABEL[language][item.executionState] : copy.noAi}`}
          />
          <CollaborationStage
            active={collaborationStage === 2}
            complete={collaborationStage === 3}
            icon={CheckCircle2}
            label={copy.humanReview}
            detail={status === "completed" ? copy.reviewComplete : status === "ready_for_review" ? copy.reviewReady : copy.reviewPending}
          />
        </ol>
        {scheduleConflict ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning/[0.08] px-3 py-2 text-sm text-foreground" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>{copy.scheduleConflict}</span>
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-border p-4">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left"
          aria-expanded={discussionOpen}
          aria-controls={`work-item-discussion-${item.id}`}
          onClick={() => setDiscussionOpen((open) => !open)}
        >
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <MessageSquare className="size-4 text-primary" aria-hidden />
            <span className="text-sm font-semibold">{copy.comments}</span>
            <Badge tone="neutral">{comments.length}</Badge>
          </span>
          <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${discussionOpen ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {discussionOpen ? (
          <div id={`work-item-discussion-${item.id}`} className="mt-3 border-t border-border pt-3">
            {comments.length ? (
              <div className="space-y-2">{comments.slice(-3).map((row) => {
                const author = consoleState?.users?.find((user) => user.id === row.createdBy)?.name ?? row.createdBy;
                const createdAt = new Intl.DateTimeFormat(dateLocale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(row.createdAt));
                return <div key={row.id} className="rounded-lg bg-muted/45 px-3 py-2 text-sm"><p className="text-xs text-muted-foreground">{author} · {createdAt}</p><p className="mt-1 whitespace-pre-wrap">{row.body}</p></div>;
              })}</div>
            ) : null}
            <Textarea className="mt-3" rows={3} value={comment} placeholder={copy.commentPlaceholder} onChange={(event) => setComment(event.target.value)} />
            {commentError ? <p className="mt-2 text-sm text-destructive" role="alert">{commentError}</p> : null}
            <div className="mt-2 flex justify-end"><Button size="sm" variant="secondary" disabled={!comment.trim() || commentPending} onClick={() => void postComment()}>{commentPending ? copy.addingComment : copy.addComment}</Button></div>
          </div>
        ) : null}
      </section>

      <footer className="grid gap-2 border-t border-border pt-4 sm:flex sm:justify-between">
        {onOpenTaskCenter ? <Button variant="ghost" onClick={onOpenTaskCenter}>{copy.taskCenter}</Button> : <span />}
        <Button variant="secondary" onClick={() => onOpenExpert("overview")}><Wrench aria-hidden />{copy.expert}</Button>
      </footer>

      <WorkItemProgressDialog
        target={progressTarget}
        open={progressOpen}
        onClose={() => setProgressOpen(false)}
        onSaved={(next) => {
          setItem(next);
          setSyncNotice(copy.progressSynced);
          window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-progress", workItemId: next.id } }));
          setRefreshVersion((version) => version + 1);
        }}
      />
      <Modal
        open={retryOpen}
        onClose={() => { if (!retryPending) setRetryOpen(false); }}
        title={copy.retryTitle}
        description={copy.retryDescription}
        closeDisabled={retryPending}
      >
        <div className="space-y-3">
          {retryError ? <p className="text-sm text-destructive" role="alert">{retryError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={retryPending} onClick={() => setRetryOpen(false)}>{language === "zh" ? "取消" : "Cancel"}</Button>
            <Button disabled={retryPending} onClick={() => void retryAiWork()}>
              <RefreshCw className={retryPending ? "animate-spin" : ""} aria-hidden />
              {retryPending ? copy.retrying : copy.retryConfirm}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={acceptOpen}
        onClose={() => { if (actionPending !== "complete") setAcceptOpen(false); }}
        title={copy.acceptTitle}
        description={copy.acceptDescription}
        closeDisabled={actionPending === "complete"}
      >
        <div className="space-y-3">
          {primaryExternalBinding ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">{copy.writebackTitle}</legend>
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${completionWriteback === "local_only" ? "border-primary/45 bg-primary/[0.05]" : ""}`}>
                <input className="mt-1 size-4" type="radio" name="completion-writeback" value="local_only" checked={completionWriteback === "local_only"} disabled={actionPending === "complete"} onChange={() => setCompletionWriteback("local_only")} />
                <span><strong className="block text-sm">{copy.writebackLocalOnly}</strong><span className="block text-xs text-muted-foreground">{copy.writebackLocalOnlyHint}</span></span>
              </label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${completionWriteback === "sync_close" ? "border-primary/45 bg-primary/[0.05]" : ""}`}>
                <input className="mt-1 size-4" type="radio" name="completion-writeback" value="sync_close" checked={completionWriteback === "sync_close"} disabled={actionPending === "complete" || !externalWritebackAllowed} onChange={() => setCompletionWriteback("sync_close")} />
                <span><strong className="block text-sm">{copy.writebackCloseExternal}</strong><span className="block text-xs text-muted-foreground">{copy.writebackCloseExternalHint}</span></span>
              </label>
              {!externalWritebackAllowed ? <p className="text-xs text-warning" role="status">{copy.writebackDisabled}</p> : null}
            </fieldset>
          ) : null}
          {actionError ? <p className="text-sm text-destructive" role="alert">{actionError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={actionPending === "complete"} onClick={() => setAcceptOpen(false)}>{language === "zh" ? "取消" : "Cancel"}</Button>
            <Button disabled={actionPending === "complete"} onClick={() => void acceptAndComplete()}>
              <CheckCircle2 aria-hidden />
              {actionPending === "complete" ? copy.accepting : copy.acceptConfirm}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={reopenConfirmOpen}
        onClose={() => { if (actionPending !== "reopen") setReopenConfirmOpen(false); }}
        title={copy.reopenTitle}
        description={copy.reopenDescription}
        closeDisabled={actionPending === "reopen"}
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={actionPending === "reopen"} onClick={() => setReopenConfirmOpen(false)}>{copy.keepCompleted}</Button>
          <Button disabled={actionPending === "reopen"} onClick={() => void reopenForMaterials()}>{actionPending === "reopen" ? copy.reopeningTask : copy.reopenForMaterials}</Button>
        </div>
      </Modal>
      <Modal
        open={Boolean(previewAsset)}
        onClose={() => setPreviewAsset(null)}
        title={previewAsset?.originalName ?? previewAsset?.path.split("/").pop() ?? copy.previewFile}
        description={item.title}
        size="full"
      >
        {previewAsset?.id ? (
          <div className="space-y-3">
            <iframe
              className="h-[65vh] w-full rounded-lg border border-border bg-background"
              src={api.taskMaterialContentUrl(item.id, previewAsset.id)}
              title={`${copy.previewFile}: ${previewAsset.originalName ?? previewAsset.path}`}
            />
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => downloadMaterial(previewAsset.id!)}><Download aria-hidden />{copy.downloadFile}</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function CollaborationStage({
  active,
  complete,
  icon: Icon,
  label,
  detail,
}: {
  active: boolean;
  complete: boolean;
  icon: typeof UserRound;
  label: string;
  detail: string;
}) {
  return (
    <li
      className={`flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2 ${
        active ? "border-primary/40 bg-primary/[0.06]" : complete ? "border-success/30 bg-success/[0.04]" : "border-border bg-muted/35"
      }`}
      aria-current={active ? "step" : undefined}
    >
      <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${
        active ? "bg-primary text-primary-foreground" : complete ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
      }`}>
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="min-w-0">
        <strong className="block text-xs font-medium">{label}</strong>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{detail}</span>
      </span>
    </li>
  );
}
