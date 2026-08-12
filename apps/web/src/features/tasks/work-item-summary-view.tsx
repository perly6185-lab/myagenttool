import {
  AlertTriangle,
  ArrowRight,
  Bot,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  FileText,
  FolderOpen,
  ImageIcon,
  Download,
  Eye,
  ExternalLink,
  MessageSquare,
  RefreshCw,
  UserRound,
  Wrench,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OfficeDocumentFrame } from "@/components/common/office-document-frame";
import { Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { MarkdownBlock } from "@/components/ui/markdown-block";
import { api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useSessionUser } from "@/hooks/use-session-user";
import { type SectionKey, type WorkItemSection } from "@/store/ui-store";
import { WorkItemProgressDialog, type WorkItemProgressTarget } from "./work-item-progress-dialog";
import { TaskMaterialEditor } from "./task-material-editor";
import { readinessSetupSection, type AutoRunReadiness } from "./auto-run-readiness-ui";
import { myTemplateExpectedOutput } from "@/features/workflow-memory/my-template-model";
import type { BusinessRoutineDefinition } from "@/lib/api-client";
import type { LocalWorkItem, LocalWorkItemAutoRun, LocalWorkItemObservability, WorkItemComment, WorkItemExecutionKind, WorkItemExecutionState, WorkItemOutcomeFile } from "./task-view-types";
import { deriveWorkItemUserStatus, type WorkItemUserStatus } from "./work-item-user-status";
import {
  browsableDeliveryPath,
  deliveryExtension,
  deliveryFileCanUseLegacyPath,
  deliveryFileName,
  imageMime,
  isOfficeDeliveryPath,
  isOfficeMaterial,
  markdownImageCount,
  markdownImageReferences,
  normalizedDeliveryPath,
  parseMarkdownDocument,
  resolveDeliveryAssetPath,
  type DeliveryPreview,
} from "./work-item-delivery-preview-model";

export { deriveWorkItemUserStatus } from "./work-item-user-status";

type TaskTemplateCandidate = {
  templateId: string;
  definitionId: string;
  version: number;
  name: string;
  expectedOutput: string;
  reasons: string[];
};

type PendingTemplateClarification = {
  acceptanceCriteria: string[];
  verificationSop: string[];
  candidates: TaskTemplateCandidate[];
  reason?: string;
};

type MyTemplateDraftPreview = {
  eligible: boolean;
  alreadySaved: boolean;
  reasons: string[];
  draft: LocalWorkItem["myTemplateDraft"];
  suggestion?: {
    name: string;
    typicalInput: string;
    expectedOutput: string;
    applicability: string;
    steps: string[];
  };
  evidence?: {
    inputCount: number;
    outputCount: number;
    passedVerification: boolean;
    passedAcceptance: boolean;
    hasDeliveryReport: boolean;
  };
};

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
  decisionSummary: string;
  completedScope: string;
  checkResult: string;
  recommendedNext: string;
  resultRisk: string;
  actionEffect: string;
  actionRisk: string;
  riskLow: string;
  riskMedium: string;
  riskHigh: string;
  riskUnknown: string;
  originalAiNote: string;
  deliverableSummary: string;
  deliverableFiles: string;
  noDeliverableFiles: string;
  browseDeliverableFile: string;
  deliverableFileOpening: string;
  deliverableFileOpenHint: string;
  deliverableFileUnavailable: string;
  deliverableFileUnsupported: string;
  openDeliverableFolder: string;
  deliverableFolderUnavailable: string;
  deliverablePreviewDescription: string;
  deliverablePreviewLoading: string;
  deliverablePreviewTruncated: string;
  deliverablePreviewImageUnavailable: string;
  deliverablePreviewSource: string;
  deliverablePreviewAuthor: string;
  deliverablePreviewPublished: string;
  deliverablePreviewImages: string;
  deliverablePreviewShowFirstImage: string;
  noDeliverableSummary: string;
  noAcceptanceResult: string;
  acceptanceResult: string;
  passed: string;
  needsReview: string;
  fullReport: string;
  fullReportDescription: string;
  openExpertDetails: string;
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
  reuseTask: string;
  createFollowUp: string;
  reviewDecisionTitle: string;
  reviewDecisionHint: string;
  completionFailed: string;
  deliveryReviewRequired: string;
  aiReviewTitle: string;
  aiReviewPending: string;
  aiReviewApproved: string;
  aiReviewChanges: string;
  aiReviewUnavailable: string;
  aiReviewNoFindings: string;
  sendAiReviewBack: string;
  verificationEvidence: string;
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
      blocked: "任务当前无法继续。先处理下方显示的前置任务，或更新阻塞进展。",
      completed: "任务已经完成，可以查看最终结果和汇报。",
    },
    action: {
      not_started: "更新进展",
      scheduled: "更新进展",
      ai_working: "更新进展",
      waiting: "记录跟进",
      needs_action: "查看原因并处理",
      ready_for_review: "审核结果",
      blocked: "更新阻塞进展",
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
    humanReview: "AI 审查与我的确认",
    reviewPending: "等待 AI 交付",
    reviewReady: "AI 已审查，等待确认",
    reviewComplete: "已确认完成",
    scheduleConflict: "AI 执行日期晚于预期完成日期，可能影响按时交付。",
    progressSynced: "进展已保存，个人看板与 AI 看板已同步更新。",
    commentSynced: "评论已发布，任务协作记录已更新。",
    deliverableTitle: "AI 交付了什么",
    deliverableHint: "先看普通用户能理解的结论、风险和建议动作；技术证据仍完整保留。",
    decisionSummary: "审核结论",
    completedScope: "AI 完成了什么",
    checkResult: "检查结果",
    recommendedNext: "建议下一步",
    resultRisk: "本次结果风险",
    actionEffect: "点击后会发生什么",
    actionRisk: "动作风险",
    riskLow: "较低",
    riskMedium: "中等",
    riskHigh: "较高",
    riskUnknown: "待确认",
    originalAiNote: "AI 原始交付说明（可能包含技术术语）",
    deliverableSummary: "AI 完成的工作",
    deliverableFiles: "涉及的文件",
    noDeliverableFiles: "这次没有可直接打开的附件；代码变更仍保存在任务工作区。",
    browseDeliverableFile: "浏览文件",
    deliverableFileOpening: "正在打开",
    deliverableFileOpenHint: "在当前任务中预览",
    deliverableFileUnavailable: "暂时无法打开这个文件。文件可能已被移动，你仍可继续审核或稍后重试。",
    deliverableFileUnsupported: "暂不支持在线浏览",
    openDeliverableFolder: "打开所在文件夹",
    deliverableFolderUnavailable: "暂时无法打开所在文件夹。请确认本地桌面 Bridge 正在运行，且文件未被移动。",
    deliverablePreviewDescription: "任务内只读预览，不会跳离当前工作。Markdown 已按正文排版展示。",
    deliverablePreviewLoading: "正在准备预览…",
    deliverablePreviewTruncated: "文件较大，当前仅展示可安全读取的部分。",
    deliverablePreviewImageUnavailable: "配图暂时无法显示",
    deliverablePreviewSource: "来源",
    deliverablePreviewAuthor: "作者",
    deliverablePreviewPublished: "发布日期",
    deliverablePreviewImages: "正文配图：{count} 张",
    deliverablePreviewShowFirstImage: "查看首图",
    noDeliverableSummary: "AI 已结束处理，但没有附带可直接阅读的结果摘要；可进入完整报告核对详情。",
    noAcceptanceResult: "本任务未设置完成标准，请结合任务目标人工确认。",
    acceptanceResult: "完成标准",
    passed: "项已通过",
    needsReview: "项待确认",
    fullReport: "查看完整报告",
    fullReportDescription: "在当前任务内查看完整交付、验证与复核结论；不会离开审核页面。",
    openExpertDetails: "打开专业详情",
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
    requestChanges: "让 AI 继续修改",
    changePlaceholder: "告诉 AI 需要修改什么，例如补充数据、调整格式或重新核对结论…",
    sendChanges: "发送给 AI 继续修改",
    sendingChanges: "正在发送…",
    changesSent: "修改要求已记录，AI 已开始继续处理。",
    changesFailed: "修改要求已保留，但 AI 暂时无法继续。请稍后重试。",
    acceptComplete: "确认结果并完成任务",
    acceptTitle: "确认这份结果并完成任务？",
    acceptDescription: "确认表示结果已满足任务目标。系统会保留交付说明、验证证据和审查记录，之后仍可查看或重新打开。",
    acceptConfirm: "确认结果并完成",
    accepting: "正在完成…",
    completedTitle: "这项工作已完成",
    completedHint: "最终成果、确认记录和协作过程都已保留，你可以随时回来查看。",
    reuseTask: "复用为新任务",
    createFollowUp: "创建后续任务",
    reviewDecisionTitle: "请做最后确认",
    reviewDecisionHint: "结果符合任务目标就确认完成；如果不符合，告诉 AI 需要改什么，它会继续在同一任务中处理。",
    completionFailed: "暂时无法完成任务。请核对未通过的完成标准或稍后重试。",
    deliveryReviewRequired: "此任务包含待交付的代码变更，需要先完成技术审查。",
    aiReviewTitle: "自动复核结论",
    aiReviewPending: "系统正在独立检查本次结果，完成后会在这里给出结论。",
    aiReviewApproved: "审查通过，可以由你确认交付。",
    aiReviewChanges: "审查发现需要修复的问题，暂不建议接受交付。",
    aiReviewUnavailable: "自动复核暂时不可用，系统会在检查能力就绪后重试。",
    aiReviewNoFindings: "未发现阻止交付的问题。",
    sendAiReviewBack: "交回 AI 修复",
    verificationEvidence: "系统如何验证",
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
    humanReview: "AI review and my confirmation",
    reviewPending: "Waiting for AI delivery",
    reviewReady: "AI reviewed; awaiting confirmation",
    reviewComplete: "Confirmed complete",
    scheduleConflict: "AI execution is scheduled after the expected completion date and may delay delivery.",
    progressSynced: "Progress saved. My tasks and AI tasks are now in sync.",
    commentSynced: "Comment posted. The collaboration record is up to date.",
    deliverableTitle: "What AI delivered",
    deliverableHint: "Start with a plain-language conclusion, risk, and recommended action. Technical evidence remains available.",
    decisionSummary: "Review conclusion",
    completedScope: "What AI completed",
    checkResult: "Checks",
    recommendedNext: "Recommended next step",
    resultRisk: "Result risk",
    actionEffect: "What happens when you click",
    actionRisk: "Action risk",
    riskLow: "Low",
    riskMedium: "Medium",
    riskHigh: "High",
    riskUnknown: "Needs review",
    originalAiNote: "AI's original delivery note (may contain technical terms)",
    deliverableSummary: "What AI completed",
    deliverableFiles: "Files involved",
    noDeliverableFiles: "There are no attachments to open; code changes remain in the task workspace.",
    browseDeliverableFile: "Browse file",
    deliverableFileOpening: "Opening",
    deliverableFileOpenHint: "Preview inside this task",
    deliverableFileUnavailable: "This file cannot be opened right now. It may have moved; you can keep reviewing or try again later.",
    deliverableFileUnsupported: "Preview is not supported yet",
    openDeliverableFolder: "Open containing folder",
    deliverableFolderUnavailable: "The containing folder could not be opened. Check that the local Desktop Bridge is running and the file has not moved.",
    deliverablePreviewDescription: "Read-only preview inside this task. Markdown is formatted as a document.",
    deliverablePreviewLoading: "Preparing preview…",
    deliverablePreviewTruncated: "This file is large, so only the safely readable portion is shown.",
    deliverablePreviewImageUnavailable: "Image preview unavailable",
    deliverablePreviewSource: "Source",
    deliverablePreviewAuthor: "Author",
    deliverablePreviewPublished: "Published",
    deliverablePreviewImages: "Document images: {count}",
    deliverablePreviewShowFirstImage: "Show first image",
    noDeliverableSummary: "AI finished, but no readable result summary was attached. Open the full report to review the details.",
    noAcceptanceResult: "No completion criteria were set. Review the outcome against the task goal.",
    acceptanceResult: "Definition of done",
    passed: "passed",
    needsReview: "need review",
    fullReport: "View full report",
    fullReportDescription: "Review the complete delivery, verification, and conclusion without leaving this task.",
    openExpertDetails: "Open expert details",
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
    requestChanges: "Ask AI to revise",
    changePlaceholder: "Tell AI what to change, such as adding evidence, adjusting the format, or checking a conclusion again…",
    sendChanges: "Send changes to AI",
    sendingChanges: "Sending…",
    changesSent: "Your changes were recorded and AI has started another pass.",
    changesFailed: "Your changes were saved, but AI could not continue yet. Try again later.",
    acceptComplete: "Confirm result and complete",
    acceptTitle: "Confirm this result and complete the task?",
    acceptDescription: "Confirming means the result meets the task goal. The delivery, verification, and review record remain available afterward.",
    acceptConfirm: "Confirm and complete",
    accepting: "Completing…",
    completedTitle: "This work is complete",
    completedHint: "The final result, your confirmation, and the collaboration history have all been preserved for later review.",
    reuseTask: "Reuse as new task",
    createFollowUp: "Create follow-up",
    reviewDecisionTitle: "Make the final decision",
    reviewDecisionHint: "Confirm completion if the result meets the goal. Otherwise, tell AI what to revise and it will continue in this task.",
    completionFailed: "The task could not be completed. Review unfinished criteria or try again shortly.",
    deliveryReviewRequired: "This task contains code changes that still require technical delivery review.",
    aiReviewTitle: "Codex review conclusion",
    aiReviewPending: "Codex is independently checking this code delivery. Its conclusion will appear here.",
    aiReviewApproved: "Review passed. The delivery is ready for your confirmation.",
    aiReviewChanges: "The review found issues that should be fixed before accepting the delivery.",
    aiReviewUnavailable: "Automatic review is temporarily unavailable and will retry when local Codex is ready.",
    aiReviewNoFindings: "No delivery-blocking issues were found.",
    sendAiReviewBack: "Send back to AI",
    verificationEvidence: "How it was verified",
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

function latestExecutionKind(item: LocalWorkItem): WorkItemExecutionKind | null {
  if (item.executionKind) return item.executionKind;
  return [...(item.executionBindings ?? [])].reverse().find((binding) =>
    ["auto_run", "application_invocation", "article_import", "article_derivative"].includes(binding.kind))?.kind as WorkItemExecutionKind | undefined ?? null;
}

function resultPresentation(kind: WorkItemExecutionKind | null, language: "zh" | "en") {
  if (kind === "article_import") {
    return language === "zh" ? {
      title: "公众号导入结果",
      hint: "查看导入内容、验收结论和结果文件；技术证据仍完整保留。",
      originalNote: "原始导入说明",
      noSummary: "公众号内容已完成导入，结果文件已保存到当前任务。",
      executionLabel: "公众号导入",
      collaborationHint: "Local Issue 统一记录导入执行、结果文件和人工验收；它们始终属于同一个任务。",
      completedScope: "导入完成了什么",
    } : {
      title: "Article import result",
      hint: "Review the imported content, acceptance result, and output files; technical evidence remains available.",
      originalNote: "Original import note",
      noSummary: "The article import completed and its output files are attached to this task.",
      executionLabel: "Article import",
      collaborationHint: "The Local Issue keeps the import run, output files, and human acceptance together as one task.",
      completedScope: "What the import produced",
    };
  }
  return {
    title: COPY[language].deliverableTitle,
    hint: COPY[language].deliverableHint,
    originalNote: COPY[language].originalAiNote,
    noSummary: COPY[language].noDeliverableSummary,
    executionLabel: COPY[language].aiExecution,
    collaborationHint: COPY[language].collaborationHint,
    completedScope: COPY[language].completedScope,
  };
}

function executionStateLabel(item: LocalWorkItem, language: "zh" | "en") {
  if (item.executionState === "completed" && (item.state === "closed" || item.status === "done")) {
    return language === "zh" ? "已完成" : "Completed";
  }
  return item.executionState ? AI_LABEL[language][item.executionState] : COPY[language].noAi;
}

const WAITING_LABEL: Record<"zh" | "en", Record<LocalWorkItem["waitingOn"], string>> = {
  zh: { me: "我", requester: "提出者", internal: "内部成员", ai: "AI", none: "无需等待" },
  en: { me: "Me", requester: "Requester", internal: "Internal teammate", ai: "AI", none: "No one" },
};

function expertSectionFor(item: LocalWorkItem, status: WorkItemUserStatus): WorkItemSection {
  if (item.executionState === "failed" || status === "blocked") return "process";
  if (item.executionState === "awaiting_approval") return "verification";
  if (status === "ready_for_review" || status === "completed") return "report";
  return "overview";
}

type DeliveryDecision = {
  state: "ready" | "changes" | "waiting" | "caution";
  risk: "low" | "medium" | "high" | "unknown";
  headline: string;
  scope: string;
  checks: string;
  recommendation: string;
  confirmEffect: string;
  confirmRisk: string;
  revisionEffect: string;
  revisionRisk: string;
};

function aiPhaseDescription(phase: LocalWorkItemAutoRun["phase"], language: "zh" | "en") {
  if (!phase) return null;
  const descriptions = {
    zh: {
      queued: "任务已经交给 AI，正在等待开始。",
      understanding: "AI 正在理解任务、整理完成标准和验证方式；需要你决定时会在这里提问。",
      waiting_for_input: "AI 已暂停实质修改，正在等待你确认或补充信息。",
      planning: "AI 正在整理执行步骤和本次验收依据。",
      implementing: "执行依据已经建立，AI 正在隔离工作区内处理任务。",
      verifying: "AI 已完成主要处理，正在按本次标准验证结果。",
      review_ready: "AI 已完成处理和验证，请查看交付结果并决定是否通过。",
      failed: "本次 AI 处理失败，请查看原因后重试或转为人工处理。",
      cancelled: "本次 AI 处理已停止，任务仍保留在你的任务中。",
    },
    en: {
      queued: "The task is with AI and waiting to start.",
      understanding: "AI is understanding the task and establishing completion criteria and verification; it will ask here if a decision is needed.",
      waiting_for_input: "AI has paused material changes and is waiting for your confirmation or additional information.",
      planning: "AI is organizing the execution steps and acceptance basis for this run.",
      implementing: "The execution basis is established and AI is working in an isolated workspace.",
      verifying: "AI has completed the main work and is verifying the result against this run's criteria.",
      review_ready: "AI has completed the work and verification. Review the delivery and decide whether to approve it.",
      failed: "This AI run failed. Review the cause, then retry or return the task to manual handling.",
      cancelled: "This AI run was stopped. The task remains in My tasks.",
    },
  } as const;
  return descriptions[language][phase];
}

function changedFileScope(paths: string[], language: "zh" | "en", executionKind: WorkItemExecutionKind | null, resultFiles: string[]) {
  if (executionKind === "article_import") {
    if (!resultFiles.length) {
      return language === "zh"
        ? "公众号正文已完成导入，当前没有可直接打开的结果文件。"
        : "The article content was imported, but no directly browsable output file is available.";
    }
    return language === "zh"
      ? `公众号正文已完成导入，并在当前 Local Issue 中生成 ${resultFiles.length} 个结果文件。`
      : `The article content was imported and ${resultFiles.length} output file${resultFiles.length === 1 ? "" : "s"} were attached to this Local Issue.`;
  }
  const tests = paths.filter((path) => /(?:^|[\\/])(?:test|tests|__tests__)(?:[\\/])|\.(?:test|spec)\.[^.]+$/i.test(path)).length;
  const docsAndConfig = paths.filter((path) =>
    /(?:^|[\\/])docs?(?:[\\/])|\.md$/i.test(path)
    || /(?:^|[\\/])(?:\.github|config)(?:[\\/])|\.(?:json|ya?ml|toml|lock)$/i.test(path)).length;
  const product = Math.max(0, paths.length - tests - docsAndConfig);
  if (!paths.length) {
    return language === "zh"
      ? "AI 已完成处理，但系统没有取得可归类的文件清单；具体内容需要结合原始交付说明确认。"
      : "AI finished, but no file list was available to classify. Review the original delivery note for exact scope.";
  }
  const parts = language === "zh"
    ? [product ? `${product} 个程序文件` : null, tests ? `${tests} 个测试文件` : null, docsAndConfig ? `${docsAndConfig} 个说明或配置文件` : null]
    : [product ? `${product} product file${product === 1 ? "" : "s"}` : null, tests ? `${tests} test file${tests === 1 ? "" : "s"}` : null, docsAndConfig ? `${docsAndConfig} documentation or configuration file${docsAndConfig === 1 ? "" : "s"}` : null];
  return language === "zh"
    ? `AI 已在独立任务工作区完成代码变更，共涉及 ${paths.length} 个文件：${parts.filter(Boolean).join("、")}。这些改动尚未进入本地主分支。`
    : `AI completed code changes in an isolated task workspace across ${paths.length} files: ${parts.filter(Boolean).join(", ")}. These changes are not yet on the local base branch.`;
}

function deriveDeliveryDecision({
  language,
  mode,
  changedFiles,
  reviewVerdict,
  reviewStatus,
  verification,
  executionKind,
  resultFiles,
}: {
  language: "zh" | "en";
  mode: "local_merge" | "pull_request" | null;
  changedFiles: string[];
  reviewVerdict: "approved" | "changes_requested" | null;
  reviewStatus: string | null;
  verification: { passed: boolean; verified: boolean; summary: string | null } | null;
  executionKind: WorkItemExecutionKind | null;
  resultFiles: string[];
}): DeliveryDecision {
  const scope = changedFileScope(changedFiles, language, executionKind, resultFiles);
  const verifiedPass = verification?.verified === true && verification.passed === true;
  const verifiedFail = verification?.verified === true && verification.passed === false;
  const reviewWaiting = !reviewVerdict && ["queued", "running"].includes(reviewStatus ?? "");
  const confirmEffect = mode === "pull_request"
    ? language === "zh"
      ? "创建一个 Pull Request 供后续合并；不会直接改动远端主分支，本地任务会继续保留在审核阶段。"
      : "Create a pull request for later merge. The remote base branch is not changed directly, and this task remains in review."
    : language === "zh"
      ? changedFiles.length
        ? `把这次涉及 ${changedFiles.length} 个文件的代码变更写入本地项目的基础分支，并将本地任务标记为完成；默认不会关闭 GitHub、GitLab 等外部 Issue。`
        : "把这次代码变更写入本地项目的基础分支，并将本地任务标记为完成；默认不会关闭 GitHub、GitLab 等外部 Issue。"
      : `Apply this ${changedFiles.length || "code"}-file delivery to the local base branch and complete the local task. External issues are not closed by default.`;
  const confirmRisk = mode === "pull_request"
    ? language === "zh" ? "较低：只创建待审核的 PR，但仍可能产生远端分支和协作通知。" : "Low: it only creates a reviewable PR, but it may create a remote branch and notifications."
    : language === "zh" ? "中等：会实际修改本地项目代码。虽然已有复核和验证，仍建议先确认功能表现符合预期。" : "Medium: this changes local project code. Even with review and checks, confirm the user-visible behavior first.";
  const revisionEffect = language === "zh"
    ? "保留当前结果和历史记录，不应用现有交付；把你的修改要求交给 AI 在同一任务工作区继续处理。"
    : "Keep the current result and history without applying it, then ask AI to continue in the same task workspace.";
  const revisionRisk = language === "zh"
    ? "较低：不会把当前变更写入基础分支，但会增加一次 AI 运行时间，可能产生额外费用。"
    : "Low: current changes are not applied, but another AI run may take time and incur cost.";

  if (reviewVerdict === "changes_requested" || verifiedFail) {
    return {
      state: "changes", risk: "high", scope,
      headline: language === "zh" ? "这份结果暂不建议接受" : "Do not accept this result yet",
      checks: verifiedFail
        ? language === "zh" ? "自动验证未通过，当前结果存在明确失败项。" : "Automated verification failed, so the result has a confirmed problem."
        : language === "zh" ? "自动复核发现需要处理的问题。" : "Automated review found issues that need to be fixed.",
      recommendation: language === "zh" ? "点击“让 AI 继续修改”，说明期望或直接采用复核建议。" : "Choose Ask AI to revise and describe the expected result or use the review findings.",
      confirmEffect, confirmRisk, revisionEffect, revisionRisk,
    };
  }
  if (reviewWaiting) {
    return {
      state: "waiting", risk: "unknown", scope,
      headline: language === "zh" ? "结果已生成，系统仍在复核" : "Result delivered; automated review is still running",
      checks: verifiedPass
        ? language === "zh" ? "自动验证已通过，独立代码复核尚未结束。" : "Automated verification passed; independent code review is still in progress."
        : language === "zh" ? "独立代码复核尚未结束，暂不能判断是否适合接受。" : "Independent code review has not finished, so acceptance is not yet recommended.",
      recommendation: language === "zh" ? "暂时无需操作；等待复核完成后再确认或交回修改。" : "No action yet. Wait for review before confirming or requesting changes.",
      confirmEffect, confirmRisk, revisionEffect, revisionRisk,
    };
  }
  if (executionKind === "article_import" && verifiedPass) {
    return {
      state: "ready", risk: "low", scope,
      headline: language === "zh" ? "公众号导入结果已通过任务验收" : "The article import passed task acceptance",
      checks: language === "zh"
        ? "完成标准和验证记录均已通过，导入产物已绑定到当前 Local Issue。"
        : "The completion criteria and verification record passed, and the imported outputs are attached to this Local Issue.",
      recommendation: language === "zh"
        ? "任务已经完成；需要时可直接查看、下载或复用结果文件。"
        : "The task is complete. Review, download, or reuse the output files when needed.",
      confirmEffect, confirmRisk, revisionEffect, revisionRisk,
    };
  }
  if (reviewVerdict === "approved" && verifiedPass) {
    return {
      state: "ready", risk: "low", scope,
      headline: language === "zh" ? "结果已通过自动复核和验证" : "Result passed automated review and verification",
      checks: language === "zh" ? "未发现阻止交付的问题，自动检查也已通过；这降低了代码缺陷风险，但不等于业务表现已由人工确认。" : "No delivery-blocking issue was found and automated checks passed. This lowers code risk but does not replace a user-visible behavior check.",
      recommendation: language === "zh" ? "如果功能表现符合你的预期，可以确认交付；拿不准时先让 AI 补充说明或继续修改。" : "Confirm delivery if the behavior matches your expectation; otherwise ask AI for clarification or revisions.",
      confirmEffect, confirmRisk, revisionEffect, revisionRisk,
    };
  }
  return {
    state: "caution", risk: "medium", scope,
    headline: reviewVerdict === "approved"
      ? language === "zh" ? "自动复核已通过，但验证证据不足" : "Automated review approved the change, but verification is incomplete"
      : language === "zh" ? "AI 已交付结果，但审核证据还不完整" : "AI delivered a result, but review evidence is incomplete",
    checks: verification?.verified === false
      ? language === "zh" ? "系统未配置或未执行可复现的自动验证，不能仅凭“AI 已完成”判断功能可用。" : "No reproducible automated verification ran, so AI completion alone does not prove the behavior works."
      : language === "zh" ? "目前没有足够的独立复核与验证信息。" : "There is not enough independent review and verification evidence yet.",
    recommendation: language === "zh" ? "建议先让 AI 补充验证或修改，不要直接确认完成。" : "Ask AI to add verification or revise before confirming completion.",
    confirmEffect, confirmRisk, revisionEffect, revisionRisk,
  };
}

const MARKDOWN_DELIVERY_EXTENSIONS = new Set([".md", ".mdx"]);
const IMAGE_DELIVERY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]);

function DeliveryMarkdownDocument({ file, text, copy }: { file: WorkItemOutcomeFile; text: string; copy: SummaryCopy }) {
  const document = useMemo(() => parseMarkdownDocument(text), [text]);
  const articleRef = useRef<HTMLElement>(null);
  const imageCount = useMemo(() => markdownImageCount(document.body), [document.body]);
  const [imageSources, setImageSources] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!file.projectId || !file.path) return undefined;
    let cancelled = false;
    const objectUrls: string[] = [];
    const references = markdownImageReferences(document.body);
    if (!references.length) return undefined;
    void Promise.all(references.map(async (reference) => {
      const assetPath = resolveDeliveryAssetPath(file.path!, reference);
      if (!assetPath) return null;
      try {
        const bytes = await api.projectAssetPreviewBytes(file.projectId!, assetPath, file.worktreeId ?? undefined);
        const source = URL.createObjectURL(new Blob([bytes], { type: imageMime(assetPath) }));
        objectUrls.push(source);
        return [reference, source] as const;
      } catch {
        return null;
      }
    })).then((entries) => {
      if (cancelled) {
        for (const source of objectUrls) URL.revokeObjectURL(source);
        return;
      }
      setImageSources(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))));
    });
    return () => {
      cancelled = true;
      for (const source of objectUrls) URL.revokeObjectURL(source);
    };
  }, [document.body, file.path, file.projectId, file.worktreeId]);

  const metadata = [
    document.metadata.author ? `${copy.deliverablePreviewAuthor}: ${document.metadata.author}` : null,
    document.metadata.published_at ? `${copy.deliverablePreviewPublished}: ${document.metadata.published_at}` : null,
    document.metadata.source_provider ? `${copy.deliverablePreviewSource}: ${document.metadata.source_provider}` : null,
  ].filter(Boolean);
  const showFirstImage = () => {
    articleRef.current?.querySelector<HTMLElement>("img, [role='img']")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  return (
    <article ref={articleRef} className="mx-auto max-w-4xl px-1 pb-6 sm:px-5">
      {metadata.length ? <p className="mb-5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">{metadata.join(" · ")}</p> : null}
      {imageCount ? (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/[0.045] px-3 py-2 text-sm" role="status">
          <ImageIcon className="size-4 text-primary" aria-hidden />
          <span className="mr-auto">{copy.deliverablePreviewImages.replace("{count}", String(imageCount))}</span>
          <Button type="button" size="sm" variant="secondary" onClick={showFirstImage}>{copy.deliverablePreviewShowFirstImage}</Button>
        </div>
      ) : null}
      <MarkdownBlock
        text={document.body}
        variant="document"
        imageUnavailableLabel={copy.deliverablePreviewImageUnavailable}
        resolveImageSrc={(src) => /^(?:https?:|data:|blob:)/i.test(src) ? src : imageSources[src] ?? null}
      />
    </article>
  );
}

function DeliverableFileList({
  entries,
  copy,
  openingKey,
  error,
  limit,
  onOpen,
}: {
  entries: WorkItemOutcomeFile[];
  copy: SummaryCopy;
  openingKey: string | null;
  error: string | null;
  limit?: number;
  onOpen: (file: WorkItemOutcomeFile) => void;
}) {
  const [revealingKey, setRevealingKey] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const revealBridge = window.myagenttoolDesktop?.revealContainedAsset;
  const visible = typeof limit === "number" ? entries.slice(0, limit) : entries;
  if (!visible.length) return <p className="mt-1.5 text-sm text-muted-foreground">{copy.noDeliverableFiles}</p>;
  return (
    <>
      <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
        {visible.map((file) => {
          const key = `${file.projectId ?? "project"}:${file.worktreeId ?? "base"}:${file.path ?? file.name}`;
          const opening = openingKey === key;
          const canOpen = file.status === "available"
            && Boolean(file.projectId && file.path)
            && (file.preview === "document" || Boolean(file.worktreeId));
          const canReveal = file.status === "available" && Boolean(file.projectId && file.path);
          const revealing = revealingKey === key;
          const reveal = async () => {
            if (!file.projectId || !file.path) return;
            setRevealError(null);
            setRevealingKey(key);
            try {
              if (revealBridge) {
                await revealBridge({
                  projectId: file.projectId,
                  relativePath: file.path,
                  ...(file.worktreeId ? { worktreeId: file.worktreeId } : {}),
                });
              } else {
                await api.revealProjectAsset(file.projectId, file.path, file.worktreeId ?? undefined);
              }
            } catch {
              setRevealError(copy.deliverableFolderUnavailable);
            } finally {
              setRevealingKey(null);
            }
          };
          const content = (
            <>
              {opening
                ? <RefreshCw className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden />
                : canOpen
                  ? <FileText className="size-3.5 shrink-0 text-primary" aria-hidden />
                  : <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs">{file.name}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {opening ? copy.deliverableFileOpening : canOpen ? copy.deliverableFileOpenHint : copy.deliverableFileUnsupported}
                </span>
              </span>
              {canOpen ? <Eye className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
            </>
          );
          return (
            <li key={key} title={file.path ?? file.name} className="min-w-0">
              <div className="flex overflow-hidden rounded-lg bg-background/70">
                {canOpen ? (
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait"
                    aria-label={`${copy.browseDeliverableFile}: ${file.name}`}
                    disabled={Boolean(openingKey)}
                    onClick={() => onOpen(file)}
                  >
                    {content}
                  </button>
                ) : <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 opacity-75" aria-disabled="true">{content}</div>}
                {canReveal ? (
                  <button
                    type="button"
                    className="grid w-11 shrink-0 place-items-center border-l border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait"
                    aria-label={`${copy.openDeliverableFolder}: ${file.name}`}
                    title={copy.openDeliverableFolder}
                    disabled={Boolean(revealingKey)}
                    onClick={() => void reveal()}
                  >
                    {revealing ? <RefreshCw className="size-4 animate-spin" aria-hidden /> : <FolderOpen className="size-4" aria-hidden />}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {error ? <p className="mt-2 rounded-md border border-warning/40 bg-warning/[0.07] px-3 py-2 text-sm" role="alert">{error}</p> : null}
      {revealError ? <p className="mt-2 rounded-md border border-warning/40 bg-warning/[0.07] px-3 py-2 text-sm" role="alert">{revealError}</p> : null}
    </>
  );
}

export function WorkItemSummaryView({
  workItemId,
  onOpenExpert,
  onOpenTaskCenter,
  onOpenSetup,
  onDirtyChange,
  onCompletedChange,
  onCreateTaskDraft,
  onOpenWorkItem,
}: {
  workItemId: string;
  onOpenExpert: (section?: WorkItemSection) => void;
  onOpenTaskCenter?: () => void;
  onOpenSetup?: (section: SectionKey) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCompletedChange?: (completed: boolean | null) => void;
  onCreateTaskDraft?: (draft: string) => void;
  onOpenWorkItem?: (workItemId: string) => void;
}) {
  const { i18n } = useAppTranslation();
  const language = i18n.language.startsWith("zh") ? "zh" : "en";
  const copy = COPY[language];
  const sessionUser = useSessionUser();
  const canOperate = sessionUser?.role !== "viewer";
  const { data: consoleState } = useConsoleState();
  const [item, setItem] = useState<LocalWorkItem | null>(null);
  const [observability, setObservability] = useState<LocalWorkItemObservability | null>(null);
  const [readiness, setReadiness] = useState<AutoRunReadiness | null>(null);
  const [comments, setComments] = useState<WorkItemComment[]>([]);
  const [comment, setComment] = useState("");
  const [commentPending, setCommentPending] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [clarifyAnswer, setClarifyAnswer] = useState("");
  const [clarifyPending, setClarifyPending] = useState(false);
  const [clarifyStopPending, setClarifyStopPending] = useState(false);
  const [clarifyError, setClarifyError] = useState<string | null>(null);
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
  const [actionPending, setActionPending] = useState<"start" | "changes" | "complete" | "reopen" | "policy" | "priority" | "stop-delivery" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingTemplateClarification, setPendingTemplateClarification] = useState<PendingTemplateClarification | null>(null);
  const [templateCorrectionOpen, setTemplateCorrectionOpen] = useState(false);
  const [templateCorrectionOptions, setTemplateCorrectionOptions] = useState<BusinessRoutineDefinition[]>([]);
  const [templateCorrectionPending, setTemplateCorrectionPending] = useState(false);
  const [templateCorrectionError, setTemplateCorrectionError] = useState<string | null>(null);
  const [templateOutcomePending, setTemplateOutcomePending] = useState(false);
  const [templateOutcomeError, setTemplateOutcomeError] = useState<string | null>(null);
  const [templateOutcomeEditing, setTemplateOutcomeEditing] = useState(false);
  const [templateDraftOpen, setTemplateDraftOpen] = useState(false);
  const [templateDraftPreview, setTemplateDraftPreview] = useState<MyTemplateDraftPreview | null>(null);
  const [templateDraftName, setTemplateDraftName] = useState("");
  const [templateDraftInput, setTemplateDraftInput] = useState("");
  const [templateDraftOutput, setTemplateDraftOutput] = useState("");
  const [templateDraftPending, setTemplateDraftPending] = useState(false);
  const [templateDraftError, setTemplateDraftError] = useState<string | null>(null);
  const [changeRequestOpen, setChangeRequestOpen] = useState(false);
  const [changeRequest, setChangeRequest] = useState("");
  const [feedbackMode, setFeedbackMode] = useState<"revision" | "follow_up">("revision");
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [completionWriteback, setCompletionWriteback] = useState<"local_only" | "sync_close">("local_only");
  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<NonNullable<LocalWorkItem["inputAssets"]>[number] | null>(null);
  const [materialOfficePreview, setMaterialOfficePreview] = useState<string | null>(null);
  const [materialPreviewPending, setMaterialPreviewPending] = useState(false);
  const [materialPreviewError, setMaterialPreviewError] = useState<string | null>(null);
  const [materialRevealPendingId, setMaterialRevealPendingId] = useState<string | null>(null);
  const [materialRevealError, setMaterialRevealError] = useState<string | null>(null);
  const [openingResultFileKey, setOpeningResultFileKey] = useState<string | null>(null);
  const [resultFileError, setResultFileError] = useState<string | null>(null);
  const [resultPreviewFile, setResultPreviewFile] = useState<WorkItemOutcomeFile | null>(null);
  const [resultPreview, setResultPreview] = useState<DeliveryPreview | null>(null);
  const resultPreviewRequest = useRef(0);
  const resultAutoOpenedFor = useRef<string | null>(null);

  useEffect(() => {
    setItem(null);
    setObservability(null);
    setReadiness(null);
    setComments([]);
    setComment("");
    setClarifyAnswer("");
    setClarifyPending(false);
    setClarifyError(null);
    setMaterialError(null);
    setMaterialUndo(null);
    setMaterialNotice(null);
    setMaterialAddUndo(null);
    setMaterialRevealPendingId(null);
    setMaterialRevealError(null);
    setMaterialOfficePreview(null);
    setMaterialPreviewPending(false);
    setMaterialPreviewError(null);
    setLoadError(null);
    setSyncNotice(null);
    setRetryOpen(false);
    setRetryPending(false);
    setRetryError(null);
    setResultExpanded(false);
    setDiscussionOpen(false);
    setActionPending(null);
    setActionError(null);
    setPendingTemplateClarification(null);
    setTemplateCorrectionOpen(false);
    setTemplateCorrectionOptions([]);
    setTemplateCorrectionPending(false);
    setTemplateCorrectionError(null);
    setTemplateOutcomePending(false);
    setTemplateOutcomeError(null);
    setTemplateOutcomeEditing(false);
    setChangeRequestOpen(false);
    setChangeRequest("");
    setFeedbackMode("revision");
    setAcceptOpen(false);
    setReportOpen(false);
    setCompletionWriteback("local_only");
    setReopenConfirmOpen(false);
    setPreviewAsset(null);
    setOpeningResultFileKey(null);
    setResultFileError(null);
    setResultPreviewFile(null);
    setResultPreview(null);
    resultPreviewRequest.current += 1;
    resultAutoOpenedFor.current = null;
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
        if (
          deriveWorkItemUserStatus(detail.value.workItem, detail.value.observability?.latestRun ?? null) === "ready_for_review"
          && resultAutoOpenedFor.current !== detail.value.workItem.id
        ) {
          setResultExpanded(true);
          resultAutoOpenedFor.current = detail.value.workItem.id;
        }
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
    onCompletedChange?.(item ? deriveWorkItemUserStatus(item, observability?.latestRun ?? null) === "completed" : null);
    return () => onCompletedChange?.(null);
  }, [item, observability?.latestRun, onCompletedChange]);

  useEffect(() => {
    const reviewStatus = observability?.delivery?.aiReview?.status;
    if (!reviewStatus || reviewStatus === "completed") return undefined;
    const timer = window.setTimeout(
      () => setRefreshVersion((version) => version + 1),
      reviewStatus === "queued" || reviewStatus === "running" ? 2_000 : 5_000,
    );
    return () => window.clearTimeout(timer);
  }, [observability?.delivery?.aiReview?.status]);

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

  useEffect(() => {
    if (resultPreview?.kind !== "image") return undefined;
    const source = resultPreview.source;
    return () => URL.revokeObjectURL(source);
  }, [resultPreview]);

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

  const status = deriveWorkItemUserStatus(item, observability?.latestRun ?? null);
  const failed = item.executionState === "failed";
  const materialChangesApplyOnRerun = ["claimed", "running", "awaiting_approval", "verifying"].includes(item.executionState ?? "");
  const dateLocale = language === "zh" ? "zh-CN" : "en-US";
  const dueDate = item.dueDate
    ? new Intl.DateTimeFormat(dateLocale, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${item.dueDate}T00:00:00`))
    : copy.unscheduled;
  const plannedDate = item.plannedDate
    ? new Intl.DateTimeFormat(dateLocale, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${item.plannedDate}T00:00:00`))
    : copy.unscheduled;
  const executionKind = latestExecutionKind(item);
  const presentation = resultPresentation(executionKind, language);
  const hasBoundAutoRun = item.executionBindings?.some((binding) => binding.kind === "auto_run") ?? false;
  const hasManagedExecution = Boolean(executionKind) || Boolean(item.executionState && item.executionState !== "unclaimed");
  const executionContractReady = item.executionContractGate?.ready === true;
  const reviewAcceptanceCriteria = item.reviewContract?.acceptanceCriteria ?? item.acceptanceCriteria;
  const reviewVerificationSop = item.reviewContract?.verificationSop ?? item.verificationSop ?? [];
  const executionContractDefined = Boolean(
    item.acceptanceCriteria.length
    && item.verificationSop?.length
    && item.executionContractConfirmedAt,
  );
  const scheduleConflict = hasManagedExecution && Boolean(item.dueDate && item.plannedDate && item.plannedDate > item.dueDate);
  const collaborationStage = status === "completed"
    ? 3
    : status === "ready_for_review"
      ? 2
      : hasManagedExecution
      ? 1
      : 0;
  const startEligible = ["not_started", "scheduled"].includes(status) && !hasBoundAutoRun && !observability?.latestRun;
  const canCorrectMyTemplate = Boolean(item.myTemplateBinding && startEligible && canOperate);
  const learnedTemplateMatch = Boolean(item.myTemplateBinding?.matchReasons.some((reason) =>
    /纠正|corrected|correction/i.test(reason)));
  const canStartAi = startEligible && readiness?.ready === true;
  const readinessBlocked = startEligible && readiness?.ready === false;
  const readinessChecking = startEligible && readiness == null;
  const readinessWarnings = readiness?.checks.filter((check) => check.status === "warn") ?? [];
  const primaryUsesProgress = (["not_started", "scheduled", "ai_working", "waiting"].includes(status)
    || (status === "needs_action" && item.waitingOn === "me" && !["failed", "awaiting_approval"].includes(item.executionState ?? ""))
    || (status === "blocked" && !observability?.latestRun)) && !startEligible;
  const retryableRun = failed && observability?.latestRun
    && ["failed", "blocked"].includes(observability.latestRun.status)
    ? observability.latestRun
    : null;
  const phaseDescription = aiPhaseDescription(observability?.latestRun?.phase, language);
  const understandingContext = observability?.latestRun?.understandingContext ?? null;
  const pendingClarification = observability?.latestRun?.status === "needs_input"
    && observability.latestRun.decision?.path === "clarify"
    && !observability.latestRun.clarifyAnswer;
  const clarificationSectionId = `work-item-human-action-${item.id}`;
  const firstClarificationQuestion = observability?.latestRun?.decision?.clarifyingQuestions?.find(Boolean) ?? null;
  const unresolvedDependency = item.blockedBy?.find((dependency) => !dependency.resolved) ?? null;
  const primaryGuidance = pendingClarification
    ? canOperate
      ? firstClarificationQuestion
        ? (language === "zh" ? `AI 需要你回答：${firstClarificationQuestion}` : `AI needs your answer: ${firstClarificationQuestion}`)
        : (language === "zh" ? "AI 需要你补充信息，收到回答后会继续同一次执行。" : "AI needs more information and will continue the same run after your answer.")
      : (language === "zh" ? "AI 正在等待有操作权限的成员回答，你无需操作。" : "AI is waiting for a member with permission. You do not need to act.")
    : unresolvedDependency
      ? (language === "zh"
          ? `正在等待 ${unresolvedDependency.localRef} · ${unresolvedDependency.title} 完成。`
          : `Waiting for ${unresolvedDependency.localRef} · ${unresolvedDependency.title} to finish.`)
      : phaseDescription ?? copy.next[status];
  const resultSectionId = `work-item-result-${item.id}`;
  const acceptancePassed = reviewAcceptanceCriteria.filter((criterion) =>
    (item.reviewEvidence ?? item.acceptanceResults ?? []).some((result) => result.criterion === criterion && result.status === "passed")).length;
  const acceptanceNeedsReview = reviewAcceptanceCriteria.length - acceptancePassed;
  const latestPassedVerification = [...(item.verificationRecords ?? [])].reverse().find((record) => record.status === "passed") ?? null;
  const outputAssets = item.outputAssets ?? [];
  const outcome = observability?.outcome ?? null;
  const deliveryReport = observability?.delivery?.report ?? observability?.latestRun?.deliveryReport ?? null;
  const deliveryAiReview = observability?.delivery?.aiReview ?? observability?.latestRun?.deliveryReview ?? null;
  const deliveryReview = observability?.delivery?.review ?? null;
  const reviewFindings = deliveryReview?.comments?.length
    ? deliveryReview.comments
    : (deliveryAiReview?.findings ?? []).map((finding) => ({
      path: finding.file,
      body: finding.message,
      ...(finding.line ? { line: finding.line } : {}),
      severity: finding.severity,
      ...(finding.suggestion ? { suggestion: finding.suggestion } : {}),
    }));
  const changedFiles = deliveryReport?.changedFiles ?? [];
  const resultSummary = outcome?.summary ?? deliveryReport?.summary ?? item.lastProgressSummary
    ?? (executionKind === "article_import" ? latestPassedVerification?.summary ?? null : null);
  const fullResult = outcome?.fullReport ?? deliveryReport?.summary ?? item.lastProgressSummary ?? null;
  const resultVerification = outcome?.verification ?? deliveryReport?.verification
    ?? (latestPassedVerification && acceptanceNeedsReview === 0
      ? { verified: true, passed: true, summary: latestPassedVerification.summary }
      : null);
  const resultFiles = outcome?.files?.length
    ? outcome.files
    : [...new Set([...outputAssets.map((asset) => asset.path), ...changedFiles])];
  const resultWorktreeId = observability?.delivery?.worktreeId
    ?? [...(item.executionBindings ?? [])].reverse().find((binding) =>
      binding.kind === "auto_run" && binding.targetId === observability?.latestRun?.id)?.worktreeId
    ?? outputAssets.find((asset) => asset.worktreeId)?.worktreeId
    ?? null;
  const resultFileEntries: WorkItemOutcomeFile[] = outcome?.fileEntries?.length
    ? outcome.fileEntries
    : resultFiles.map((rawPath) => {
      const path = deliveryFileCanUseLegacyPath(rawPath) ? normalizedDeliveryPath(rawPath).replace(/^\.\//, "") : null;
      return {
        name: deliveryFileName(rawPath),
        path,
        projectId: item.projectId,
        worktreeId: resultWorktreeId,
        status: path ? "available" : "unavailable",
        preview: path && browsableDeliveryPath(path) ? "document" : "unsupported",
      };
    });
  const outcomeReady = outcome == null || outcome.status === "available";
  const deliveryDecision = deriveDeliveryDecision({
    language,
    mode: observability?.delivery?.mode ?? null,
    changedFiles,
    reviewVerdict: deliveryReview?.verdict ?? deliveryAiReview?.verdict ?? null,
    reviewStatus: deliveryAiReview?.status ?? null,
    verification: resultVerification,
    executionKind,
    resultFiles,
  });
  const acceptActionLabel = observability?.delivery?.mode === "pull_request"
    ? language === "zh" ? "审核通过并创建 Pull Request" : "Approve and create pull request"
    : language === "zh" ? "审核通过并完成任务" : "Approve and complete task";
  const acceptDialogTitle = observability?.delivery?.mode === "pull_request"
    ? language === "zh" ? "确认审核通过并创建 Pull Request？" : "Approve and create a pull request?"
    : copy.acceptTitle;
  const acceptDialogDescription = observability?.delivery?.mode === "pull_request"
    ? language === "zh"
      ? "系统会用当前交付创建一个待审核的 Pull Request，不会直接合并到远端主分支。创建后，本地任务继续保留在审核阶段。"
      : "The current delivery will become a reviewable pull request without merging into the remote base branch. The local task remains in review afterward."
    : copy.acceptDescription;
  const acceptDialogConfirm = observability?.delivery?.mode === "pull_request"
    ? language === "zh" ? "确认创建 Pull Request" : "Create pull request"
    : copy.acceptConfirm;
  const reviewFeedback = reviewFindings.map((finding) => [
    `${finding.severity ? `[${finding.severity}] ` : ""}${finding.path ?? "Code"}${finding.line ? `:${finding.line}` : ""}: ${finding.body}`,
    finding.suggestion ? `Suggested fix: ${finding.suggestion}` : null,
  ].filter(Boolean).join("\n")).join("\n\n");

  const openResultFile = async (file: WorkItemOutcomeFile) => {
    if (!file.projectId || !file.path || (file.preview === "unsupported" && !file.worktreeId)) {
      setResultFileError(copy.deliverableFileUnavailable);
      return;
    }
    const requestId = resultPreviewRequest.current + 1;
    resultPreviewRequest.current = requestId;
    const key = `${file.projectId}:${file.worktreeId ?? "base"}:${file.path}`;
    setResultPreviewFile(file);
    setResultPreview(null);
    setOpeningResultFileKey(key);
    setResultFileError(null);
    try {
      await api.projectAssetDescriptor(file.projectId, file.path, file.worktreeId ?? undefined);
      if (requestId !== resultPreviewRequest.current) return;
      const extension = deliveryExtension(file.path);
      if (MARKDOWN_DELIVERY_EXTENSIONS.has(extension)) {
        const preview = await api.projectAssetPreview(file.projectId, file.path, file.worktreeId ?? undefined);
        if (requestId === resultPreviewRequest.current) {
          setResultPreview({ kind: "markdown", text: preview.text, truncated: preview.truncated });
        }
        return;
      }
      if (IMAGE_DELIVERY_EXTENSIONS.has(extension)) {
        const bytes = await api.projectAssetPreviewBytes(file.projectId, file.path, file.worktreeId ?? undefined);
        const source = URL.createObjectURL(new Blob([bytes], { type: imageMime(file.path) }));
        if (requestId === resultPreviewRequest.current) setResultPreview({ kind: "image", source });
        else URL.revokeObjectURL(source);
        return;
      }
      if (extension === ".pdf") {
        const source = await api.projectPdfSource(file.projectId, file.path, file.worktreeId ?? undefined);
        if (requestId === resultPreviewRequest.current) setResultPreview({ kind: "pdf", source: source.url });
        return;
      }
      if (isOfficeDeliveryPath(file.path)) {
        const preview = await api.officecliPreview(file.projectId, file.path, file.worktreeId ?? undefined);
        if (requestId === resultPreviewRequest.current) setResultPreview({ kind: "office", html: preview.content });
        return;
      }
      if (!file.worktreeId) throw new Error("worktree_required");
      const preview = await api.readWorktreeFile(file.worktreeId, file.path) as { content: string; truncated?: boolean };
      let text = preview.content;
      if (extension === ".json") {
        try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Keep the original text. */ }
      }
      if (requestId === resultPreviewRequest.current) {
        setResultPreview({ kind: "text", text, truncated: Boolean(preview.truncated) });
      }
    } catch {
      if (requestId === resultPreviewRequest.current) setResultFileError(copy.deliverableFileUnavailable);
    } finally {
      if (requestId === resultPreviewRequest.current) setOpeningResultFileKey(null);
    }
  };
  const closeResultPreview = () => {
    resultPreviewRequest.current += 1;
    setOpeningResultFileKey(null);
    setResultPreviewFile(null);
    setResultPreview(null);
    setResultFileError(null);
  };
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
  const previewMaterial = async (assetId: string) => {
    const asset = item.inputAssets?.find((candidate) => candidate.id === assetId) ?? null;
    setPreviewAsset(asset);
    setMaterialOfficePreview(null);
    setMaterialPreviewError(null);
    if (!asset || !isOfficeMaterial(asset)) return;
    setMaterialPreviewPending(true);
    try {
      const preview = await api.previewTaskMaterialOffice(item.id, assetId);
      setMaterialOfficePreview(preview.content);
    } catch {
      setMaterialPreviewError(copy.deliverableFileUnavailable);
    } finally {
      setMaterialPreviewPending(false);
    }
  };
  const closeMaterialPreview = () => {
    setPreviewAsset(null);
    setMaterialOfficePreview(null);
    setMaterialPreviewPending(false);
    setMaterialPreviewError(null);
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
  const prepareReviewExecutionPlan = async () => {
    if (actionPending || executionContractDefined) return;
    setActionPending("start");
    setActionError(null);
    try {
      const assisted = await api.suggestWorkItemDraft({ projectId: item.projectId, title: item.title, body: item.body }) as {
        draft: { acceptanceCriteria: string[]; verificationSop: string[] };
      };
      const prepared = await api.updateWorkItem(item.id, {
        expectedRevision: item.revision,
        acceptanceCriteria: assisted.draft.acceptanceCriteria,
        verificationSop: assisted.draft.verificationSop,
      }) as { workItem: LocalWorkItem };
      setItem(prepared.workItem);
      setSyncNotice(language === "zh"
        ? "重新执行所需的完成标准和 SOP 已建立。请先核对内容，再选择“让 AI 继续修改”启动新一轮执行；旧结果仍不能据此审核通过。"
        : "The criteria and SOP for a new run are ready. Review them, then choose Ask AI to revise to start a new run. The old result still cannot be approved against this later contract.");
    } catch {
      setActionError(language === "zh" ? "执行方案暂时无法生成，请稍后重试。" : "The execution plan could not be prepared. Try again later.");
    } finally {
      setActionPending(null);
    }
  };
  const prepareStartExecutionPlan = async () => {
    if (actionPending || executionContractDefined) return;
    setActionPending("start");
    setActionError(null);
    try {
      const assisted = await api.suggestWorkItemDraft({ projectId: item.projectId, title: item.title, body: item.body }) as {
        draft: {
          acceptanceCriteria: string[];
          verificationSop: string[];
          templateMatch?: {
            state: "matched" | "ambiguous" | "missing";
            candidates: TaskTemplateCandidate[];
            selected: TaskTemplateCandidate | null;
            clarification?: { reason?: string };
          };
        };
      };
      if (!assisted.draft.acceptanceCriteria?.length || !assisted.draft.verificationSop?.length) {
        throw new Error("execution_plan_incomplete");
      }
      if (assisted.draft.templateMatch?.state === "ambiguous") {
        setPendingTemplateClarification({
          acceptanceCriteria: assisted.draft.acceptanceCriteria,
          verificationSop: assisted.draft.verificationSop,
          candidates: assisted.draft.templateMatch.candidates,
          reason: assisted.draft.templateMatch.clarification?.reason,
        });
        const learnedConflict = assisted.draft.templateMatch.clarification?.reason === "learned_preference_conflict";
        const governancePaused = assisted.draft.templateMatch.clarification?.reason === "outcome_feedback_paused";
        const governanceWatch = assisted.draft.templateMatch.clarification?.reason === "outcome_feedback_watch";
        const manualObservation = assisted.draft.templateMatch.clarification?.reason === "manual_resume_observation";
        setSyncNotice(manualObservation
          ? (language === "zh"
              ? "你已将这个模版恢复到观察期。本次确认后才会使用，积累新的成功结果后才恢复自动套用。"
              : "You returned this template to observation. Confirm it for now; automatic use resumes after new successful results.")
          : governancePaused
          ? (language === "zh"
              ? "这个模版近期多次产生错误结果类型，已暂停自动套用。你仍可确认本次使用。"
              : "This template repeatedly produced the wrong result type, so automatic matching is paused. You can still confirm it for this task.")
          : governanceWatch
            ? (language === "zh"
                ? "这个模版近期出现过多次结果类型不符，系统已降低推荐优先级。本次确认后才会使用。"
                : "This template recently produced several wrong result types. It will be used only after you confirm.")
            : learnedConflict
          ? (language === "zh"
              ? "你以前对此类任务选择过不同结果。请确认这次想得到什么，系统不会擅自猜测。"
              : "You previously chose different results for this kind of task. Confirm this result so the system does not guess.")
          : (language === "zh"
              ? "系统找到了多种可能结果。请只确认这次想得到什么，不需要选择模版。"
              : "Several results may fit. Confirm only the result you want; you do not need to choose a template."));
        return;
      }
      const prepared = await api.updateWorkItem(item.id, {
        expectedRevision: item.revision,
        acceptanceCriteria: assisted.draft.acceptanceCriteria,
        verificationSop: assisted.draft.verificationSop,
        ...(assisted.draft.templateMatch?.state === "matched" && assisted.draft.templateMatch.selected ? {
          myTemplateBinding: {
            definitionId: assisted.draft.templateMatch.selected.definitionId,
            familyId: assisted.draft.templateMatch.selected.templateId,
            version: assisted.draft.templateMatch.selected.version,
            matchReasons: assisted.draft.templateMatch.selected.reasons,
          },
        } : {}),
      }) as { workItem: LocalWorkItem };
      setItem(prepared.workItem);
      setSyncNotice(language === "zh"
        ? "执行方案已生成。请核对任务目标、完成标准和验证 SOP；确认无误后，再次选择“让 AI 开始”。"
        : "The execution plan is ready. Review the goal, completion criteria, and verification SOP, then choose Let AI start again to confirm.");
    } catch {
      setActionError(language === "zh" ? "执行方案暂时无法生成，请稍后重试。" : "The execution plan could not be prepared. Try again later.");
    } finally {
      setActionPending(null);
    }
  };
  const choosePendingTemplateResult = async (candidate: TaskTemplateCandidate) => {
    if (actionPending || !pendingTemplateClarification) return;
    setActionPending("start");
    setActionError(null);
    try {
      const confirmation = language === "zh"
        ? `你确认这次需要“${candidate.expectedOutput}”`
        : `You confirmed the desired result is “${candidate.expectedOutput}”`;
      const prepared = await api.updateWorkItem(item.id, {
        expectedRevision: item.revision,
        acceptanceCriteria: pendingTemplateClarification.acceptanceCriteria,
        verificationSop: pendingTemplateClarification.verificationSop,
        myTemplateBinding: {
          definitionId: candidate.definitionId,
          familyId: candidate.templateId,
          version: candidate.version,
          matchReasons: [...candidate.reasons, confirmation],
          userConfirmedResult: true,
        },
      }) as { workItem: LocalWorkItem };
      setItem(prepared.workItem);
      setPendingTemplateClarification(null);
      setSyncNotice(language === "zh"
        ? `已确认最终得到“${candidate.expectedOutput}”。请核对执行方案，再选择“让 AI 开始”。`
        : `The desired result is “${candidate.expectedOutput}”. Review the plan, then choose Let AI start.`);
    } catch {
      setActionError(language === "zh" ? "处理结果暂时无法确认，请重试。" : "The desired result could not be confirmed. Try again.");
    } finally {
      setActionPending(null);
    }
  };
  const openTemplateCorrection = async () => {
    if (!canCorrectMyTemplate || templateCorrectionPending) return;
    setTemplateCorrectionOpen(true);
    setTemplateCorrectionPending(true);
    setTemplateCorrectionError(null);
    try {
      const response = await api.listMyTemplateDefinitions() as { routineDefinitions: BusinessRoutineDefinition[] };
      const choices = [...(response.routineDefinitions ?? [])]
        .filter((definition) => definition.projectId === item.projectId && definition.state === "published")
        .sort((left, right) => right.version - left.version);
      const byOutput = new Map<string, BusinessRoutineDefinition>();
      for (const definition of choices) {
        const output = myTemplateExpectedOutput(definition);
        if (output === item.myTemplateBinding?.expectedOutput || byOutput.has(output)) continue;
        byOutput.set(output, definition);
      }
      setTemplateCorrectionOptions([...byOutput.values()]);
    } catch {
      setTemplateCorrectionError(language === "zh" ? "暂时无法读取其他处理结果，请重试。" : "Other results could not be loaded. Try again.");
    } finally {
      setTemplateCorrectionPending(false);
    }
  };
  const recordTemplateOutcome = async (outcome: "met_expectations" | "wrong_result" | "needs_quality_adjustment") => {
    if (templateOutcomePending) return;
    setTemplateOutcomePending(true);
    setTemplateOutcomeError(null);
    try {
      const response = await api.recordMyTemplateOutcomeFeedback(item.id, { outcome }) as { workItem: LocalWorkItem };
      setItem(response.workItem);
      setTemplateOutcomeEditing(false);
      setSyncNotice(language === "zh"
        ? "已记录这次实际结果，将用于评估这套处理方法。"
        : "This real result was recorded and will be used to evaluate the way of working.");
    } catch {
      setTemplateOutcomeError(language === "zh" ? "暂时无法记录结果反馈，请重试。" : "The result feedback could not be recorded. Try again.");
    } finally {
      setTemplateOutcomePending(false);
    }
  };
  const openTemplateDraft = async () => {
    if (templateDraftPending) return;
    setTemplateDraftOpen(true);
    setTemplateDraftPending(true);
    setTemplateDraftError(null);
    setTemplateDraftPreview(null);
    try {
      const preview = await api.previewMyTemplateDraft(item.id) as MyTemplateDraftPreview;
      setTemplateDraftPreview(preview);
      if (preview.suggestion) {
        setTemplateDraftName(preview.suggestion.name);
        setTemplateDraftInput(preview.suggestion.typicalInput);
        setTemplateDraftOutput(preview.suggestion.expectedOutput);
      }
    } catch {
      setTemplateDraftError(language === "zh" ? "暂时无法整理这次任务，请稍后重试。" : "This task could not be prepared yet. Try again later.");
    } finally {
      setTemplateDraftPending(false);
    }
  };
  const saveTemplateDraft = async () => {
    if (templateDraftPending || !templateDraftPreview?.eligible) return;
    setTemplateDraftPending(true);
    setTemplateDraftError(null);
    try {
      const response = await api.createMyTemplateDraft(item.id, {
        expectedRevision: item.revision,
        confirm: true,
        name: templateDraftName.trim(),
        typicalInput: templateDraftInput.trim(),
        expectedOutput: templateDraftOutput.trim(),
        idempotencyKey: `work-item:${item.id}:my-template-draft`,
      }) as { workItem: LocalWorkItem };
      setItem(response.workItem);
      setTemplateDraftOpen(false);
      setSyncNotice(language === "zh"
        ? "已保存为新的“我的模版”，目前处于学习中；不会改变原任务，也不会立即自动套用。"
        : "Saved as a new learning My template. The original task is unchanged and it will not be applied automatically yet.");
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "my-template-draft", workItemId: item.id } }));
    } catch {
      setTemplateDraftError(language === "zh" ? "暂时无法保存为我的模版，请稍后重试。" : "The My template could not be saved. Try again later.");
    } finally {
      setTemplateDraftPending(false);
    }
  };
  const correctTemplateResult = async (definition: BusinessRoutineDefinition) => {
    if (!canCorrectMyTemplate || templateCorrectionPending || actionPending) return;
    const expectedOutput = myTemplateExpectedOutput(definition);
    setTemplateCorrectionPending(true);
    setActionPending("start");
    setTemplateCorrectionError(null);
    try {
      const response = await api.updateWorkItem(item.id, {
        expectedRevision: item.revision,
        myTemplateBinding: {
          definitionId: definition.id,
          familyId: definition.familyId,
          version: definition.version,
          matchReasons: [language === "zh"
            ? `你纠正了处理结果，这次需要“${expectedOutput}”`
            : `You corrected the desired result to “${expectedOutput}”`],
        },
      }) as { workItem: LocalWorkItem };
      setItem(response.workItem);
      setTemplateCorrectionOpen(false);
      setTemplateCorrectionOptions([]);
      setSyncNotice(language === "zh"
        ? `已改为得到“${expectedOutput}”。这次纠正会帮助以后判断相似任务。`
        : `The result is now “${expectedOutput}”. This correction will help with similar tasks later.`);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-template-corrected", workItemId: item.id } }));
    } catch {
      setTemplateCorrectionError(language === "zh"
        ? "暂时无法更改处理结果。若 AI 已经开始，本次处理方式将保持不变。"
        : "The result could not be changed. If AI has started, this task's way of working remains fixed.");
    } finally {
      setTemplateCorrectionPending(false);
      setActionPending(null);
    }
  };
  const startAiWork = async () => {
    if (actionPending || !canStartAi) return;
    setActionPending("start");
    setActionError(null);
    try {
      const response = await api.updateWorkItem(item.id, {
        expectedRevision: item.revision,
        executionPolicy: "auto",
        waitingOn: "ai",
        ...(item.status === "backlog" ? { status: "ready" } : {}),
      }) as { workItem: LocalWorkItem };
      setItem(response.workItem);
      setSyncNotice(language === "zh"
        ? "任务已设为自动处理。AI 会按截止风险和优先级开始；需要你决定时会在当前任务中提问。"
        : "The task is set to automatic. AI will start based on deadline risk and priority, and ask here only when a decision is needed.");
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-start-ai", workItemId: item.id } }));
      setRefreshVersion((version) => version + 1);
    } catch {
      setActionError(copy.aiStartFailed);
    } finally {
      setActionPending(null);
    }
  };
  const sendChangeRequest = async (bodyOverride?: string, modeOverride?: "revision" | "follow_up") => {
    const body = (bodyOverride ?? changeRequest).trim();
    const mode = modeOverride ?? feedbackMode;
    if (!body || actionPending) return;
    setActionPending("changes");
    setActionError(null);
    let commentSaved = false;
    try {
      await api.createWorkItemComment(item.id, body);
      commentSaved = true;
      if (observability?.latestRun?.id) {
        await api.retryAutoRun(observability.latestRun.id, body);
      } else {
        await api.startWorkItemAutoRun(item.id);
      }
      setChangeRequest("");
      setChangeRequestOpen(false);
      setResultExpanded(false);
      setReportOpen(false);
      setSyncNotice(mode === "follow_up"
        ? language === "zh" ? "问题已交给 AI。AI 会沿用当前任务和材料继续处理，并生成新版结果。" : "Your question was sent to AI. It will continue with the same task and materials and produce a new result."
        : copy.changesSent);
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
  const answerAiClarification = async () => {
    const run = observability?.latestRun;
    const answer = clarifyAnswer.trim();
    if (!run || run.status !== "needs_input" || run.decision?.path !== "clarify" || !answer || clarifyPending) return;
    setClarifyPending(true);
    setClarifyError(null);
    try {
      const response = await api.answerClarify(run.id, { answers: answer }) as {
        resumed?: boolean;
        waitingForInput?: boolean;
        alreadyDecided?: unknown;
        reason?: string;
      };
      if (response.resumed !== true && !response.alreadyDecided) {
        throw new Error(response.reason ?? "clarification_resume_failed");
      }
      setClarifyAnswer("");
      setSyncNotice(response.waitingForInput
        ? language === "zh"
          ? "AI 已重新理解你的回答，但仍需要你确认一个问题。"
          : "AI reconsidered your answer and still needs one more decision."
        : language === "zh"
          ? "你的回答已交给 AI，AI 将在同一次任务运行中继续处理。"
          : "Your answer was sent to AI. It will continue in the same task run.");
      setRefreshVersion((version) => version + 1);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-clarification-answered", workItemId: item.id, autoRunId: run.id } }));
    } catch {
      setClarifyError(language === "zh" ? "回答暂时无法提交，请稍后重试。" : "The answer could not be submitted. Try again later.");
    } finally {
      setClarifyPending(false);
    }
  };
  const revealMaterial = async (assetId: string) => {
    setMaterialRevealPendingId(assetId);
    setMaterialRevealError(null);
    try {
      await api.revealTaskMaterial(item.id, assetId);
    } catch {
      setMaterialRevealError(copy.deliverableFolderUnavailable);
    } finally {
      setMaterialRevealPendingId(null);
    }
  };
  const setAutomaticExecution = async (executionPolicy: "auto" | "paused") => {
    if (actionPending) return;
    setActionPending("policy");
    setActionError(null);
    try {
      const response = await api.updateWorkItem(item.id, {
        expectedRevision: item.revision,
        executionPolicy,
        ...(executionPolicy === "auto" ? { waitingOn: "ai" } : {}),
      }) as { workItem: LocalWorkItem };
      setItem(response.workItem);
      setSyncNotice(executionPolicy === "auto"
        ? language === "zh" ? "AI 自动处理已恢复；资源可用时会继续。" : "Automatic AI work resumed and will continue when capacity is available."
        : language === "zh" ? "已暂停后续 AI 自动处理；当前运行不会被强制中断。" : "Future automatic AI work is paused; a currently running task is not forcibly interrupted.");
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-execution-policy", workItemId: item.id } }));
    } catch {
      setActionError(language === "zh" ? "自动处理设置更新失败，请重试。" : "The automatic-work setting could not be updated. Try again.");
    } finally {
      setActionPending(null);
    }
  };
  const markUrgent = async () => {
    if (actionPending || item.priority === "p0") return;
    setActionPending("priority");
    setActionError(null);
    try {
      const response = await api.updateWorkItem(item.id, { expectedRevision: item.revision, priority: "p0" }) as { workItem: LocalWorkItem };
      setItem(response.workItem);
      setSyncNotice(language === "zh" ? "已加急，调度时会优先处理。" : "Marked urgent. The scheduler will prioritize this task.");
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-priority", workItemId: item.id } }));
    } catch {
      setActionError(language === "zh" ? "加急失败，请重试。" : "The task could not be marked urgent. Try again.");
    } finally {
      setActionPending(null);
    }
  };
  const stopAiClarification = async () => {
    const run = observability?.latestRun;
    if (!run || run.status !== "needs_input" || clarifyStopPending || clarifyPending) return;
    setClarifyStopPending(true);
    setClarifyError(null);
    try {
      await api.cancelAutoRun(run.id);
      setSyncNotice(language === "zh"
        ? "本次 AI 处理已停止，任务和已有信息仍会保留。"
        : "This AI run was stopped. The task and its existing information were kept.");
      setRefreshVersion((version) => version + 1);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-clarification-stopped", workItemId: item.id, autoRunId: run.id } }));
    } catch {
      setClarifyError(language === "zh" ? "暂时无法停止 AI，请稍后重试。" : "AI could not be stopped. Try again shortly.");
    } finally {
      setClarifyStopPending(false);
    }
  };
  const stopDelivery = async () => {
    const run = observability?.latestRun;
    if (!run || actionPending) return;
    const confirmed = window.confirm(language === "zh"
      ? "停止本次交付？任务会结束，但 AI 生成的工作区或 PR 会保留供审计，不会合入主分支。"
      : "Stop this delivery? The task will end, while the AI worktree or PR remains available for audit and will not be merged.");
    if (!confirmed) return;
    setActionPending("stop-delivery");
    setActionError(null);
    try {
      await api.stopAutoRunDelivery(run.id, language === "zh" ? "用户在审核阶段停止交付。" : "The user stopped delivery during review.");
      setSyncNotice(language === "zh"
        ? "已停止交付；生成内容已保留，但不会进入主分支。"
        : "Delivery stopped. Generated work was kept and will not enter the base branch.");
      setResultExpanded(false);
      setReportOpen(false);
      setRefreshVersion((version) => version + 1);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-delivery-stopped", workItemId: item.id, autoRunId: run.id } }));
    } catch {
      setActionError(language === "zh" ? "暂时无法停止交付，请重试。" : "Delivery could not be stopped. Try again.");
    } finally {
      setActionPending(null);
    }
  };
  const acceptAndComplete = async () => {
    if (actionPending) return;
    if (!executionContractReady) {
      setActionError(language === "zh"
        ? "这次执行开始前没有确认完整的验收标准和 SOP，不能形成正式审核结论。请补全执行方案后重新运行。"
        : "This run did not start with confirmed acceptance criteria and a verification SOP, so it cannot produce a formal approval result. Complete the execution plan and rerun it.");
      return;
    }
    if (observability?.delivery && observability.delivery.review?.verdict !== "approved") {
      setActionError(copy.deliveryReviewRequired);
      return;
    }
    setActionPending("complete");
    setActionError(null);
    try {
      let current = item;
      if (reviewAcceptanceCriteria.length && acceptancePassed < reviewAcceptanceCriteria.length) {
        const verification = await api.recordWorkItemVerification(item.id, {
          expectedRevision: item.revision,
          kind: "manual",
          status: "passed",
          command: null,
          summary: language === "zh" ? "用户已审核交付结果并确认符合完成标准。" : "The user reviewed the delivered result and accepted the completion criteria.",
          acceptanceResults: reviewAcceptanceCriteria.map((criterion) => ({
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
    if (pendingTemplateClarification) {
      document.getElementById("task-template-result-question")?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      return;
    }
    if (pendingClarification) {
      document.getElementById(clarificationSectionId)?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      if (canOperate) window.requestAnimationFrame(() => document.getElementById(`${clarificationSectionId}-answer`)?.focus());
      return;
    }
    if (unresolvedDependency) {
      if (onOpenWorkItem) onOpenWorkItem(unresolvedDependency.id);
      else if (onOpenTaskCenter) onOpenTaskCenter();
      else onOpenExpert("overview");
      return;
    }
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
      if (!executionContractDefined) {
        void prepareStartExecutionPlan();
        return;
      }
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
      if (!executionContractDefined) {
        const assisted = await api.suggestWorkItemDraft({ projectId: item.projectId, title: item.title, body: item.body }) as {
          draft: { acceptanceCriteria: string[]; verificationSop: string[] };
        };
        const prepared = await api.updateWorkItem(item.id, {
          expectedRevision: item.revision,
          acceptanceCriteria: assisted.draft.acceptanceCriteria,
          verificationSop: assisted.draft.verificationSop,
        }) as { workItem: LocalWorkItem };
        setItem(prepared.workItem);
        setRetryOpen(false);
        setSyncNotice(language === "zh"
          ? "执行方案已生成但尚未重试。请先核对完成标准和 SOP，再次点击重试。"
          : "The execution plan is ready, but the retry has not started. Review the criteria and SOP, then retry again.");
        return;
      }
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
        {item.state !== "closed" ? <div className="mt-3 flex flex-wrap gap-2">
          {item.priority !== "p0" ? <Button size="sm" variant="secondary" disabled={Boolean(actionPending)} onClick={() => void markUrgent()}>
            {language === "zh" ? "加急" : "Mark urgent"}
          </Button> : null}
          {item.executionPolicy === "auto" ? <Button size="sm" variant="ghost" disabled={Boolean(actionPending)} onClick={() => void setAutomaticExecution("paused")}>
            {language === "zh" ? "暂停后续 AI 处理" : "Pause future AI work"}
          </Button> : null}
          {item.executionPolicy === "paused" ? <Button size="sm" variant="secondary" disabled={Boolean(actionPending)} onClick={() => void setAutomaticExecution("auto")}>
            <Bot aria-hidden />{language === "zh" ? "恢复 AI 自动处理" : "Resume automatic AI work"}
          </Button> : null}
        </div> : null}
      </header>

      {status !== "completed" ? <section className="rounded-xl border border-primary/30 bg-primary/[0.055] p-4" aria-labelledby={`work-item-next-${item.id}`}>
        <div className="flex gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><CircleDot className="size-4" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h4 id={`work-item-next-${item.id}`} className="text-sm font-semibold">{copy.progress}</h4>
            <p className="mt-1 text-sm leading-relaxed text-foreground/90">{primaryGuidance}</p>
            {item.lastProgressSummary ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{copy.lastProgress}: {item.lastProgressSummary}</p> : null}
            <Button
              className="mt-3 w-full sm:w-auto"
              disabled={Boolean(actionPending) || readinessChecking || readinessBlocked}
              aria-expanded={status === "ready_for_review" ? resultExpanded : undefined}
              aria-controls={status === "ready_for_review" ? resultSectionId : undefined}
              onClick={runPrimaryAction}
            >
              {pendingClarification
                ? canOperate ? language === "zh" ? "回答 AI" : "Answer AI" : language === "zh" ? "查看问题" : "View question"
                : unresolvedDependency
                  ? language === "zh" ? "查看前置任务" : "View prerequisite"
                : retryableRun
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

      {understandingContext ? (
        <section className="rounded-xl border border-border/80 bg-muted/20 p-4" aria-label={language === "zh" ? "AI 理解任务时参考的内容" : "Context AI used to understand the task"}>
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><FileText className="size-4" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold">{language === "zh" ? "AI 理解任务时参考了什么" : "What AI used to understand the task"}</h4>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {language === "zh"
                  ? "这些内容只用于理解任务和拟定执行方案，不代表任务已经完成或验收通过。"
                  : "This context is used only to understand and plan the task. It does not mean the task is complete or accepted."}
              </p>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                <div className="rounded-lg bg-background/75 px-3 py-2">
                  <p className="text-xs text-muted-foreground">{language === "zh" ? "项目说明" : "Project guidance"}</p>
                  <p className="mt-1 font-medium">{understandingContext.documentPaths.length
                    ? understandingContext.documentPaths.join(language === "zh" ? "、" : ", ")
                    : language === "zh" ? "未找到可用说明" : "No guidance found"}</p>
                </div>
                <div className="rounded-lg bg-background/75 px-3 py-2">
                  <p className="text-xs text-muted-foreground">{language === "zh" ? "相关线索" : "Relevant clues"}</p>
                  <p className="mt-1 font-medium">{language === "zh"
                    ? `${understandingContext.relatedFiles.length} 个相关位置 · ${understandingContext.similarTasks.length} 个相似任务`
                    : `${understandingContext.relatedFiles.length} relevant locations · ${understandingContext.similarTasks.length} similar tasks`}</p>
                </div>
                <div className="rounded-lg bg-background/75 px-3 py-2">
                  <p className="text-xs text-muted-foreground">{language === "zh" ? "计划验证方式" : "Planned verification"}</p>
                  <p className="mt-1 font-medium [overflow-wrap:anywhere]">{understandingContext.verificationCommand.length
                    ? understandingContext.verificationCommand.join(" ")
                    : language === "zh" ? "将按任务的验收 SOP 验证" : "The task acceptance SOP will be used"}</p>
                </div>
              </div>
              {understandingContext.truncated || (understandingContext.redactions ?? 0) > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {language === "zh"
                    ? `为控制范围和保护敏感信息，系统仅使用有限摘录${(understandingContext.redactions ?? 0) > 0 ? `，并隐藏了 ${understandingContext.redactions} 处疑似凭据` : ""}。`
                    : `To keep the scope safe, only bounded excerpts were used${(understandingContext.redactions ?? 0) > 0 ? ` and ${understandingContext.redactions} possible credentials were hidden` : ""}.`}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {observability?.latestRun?.status === "needs_input"
        && observability.latestRun.decision?.path === "clarify"
        && !observability.latestRun.clarifyAnswer ? (
          <section id={clarificationSectionId} className="rounded-xl border border-warning/35 bg-warning/[0.055] p-4" aria-label={language === "zh" ? "AI 等待你确认" : "AI is waiting for your answer"}>
            <div className="flex items-start gap-3">
              <MessageSquare className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-semibold">{language === "zh" ? "AI 需要你确认后才能继续" : "AI needs your decision before continuing"}</h4>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{language === "zh" ? "当前不会产生新的实质修改。回答后，AI 会在同一次任务运行中继续，不会创建重复任务。" : "No new material changes will be made while waiting. After you answer, AI continues in the same run without creating a duplicate task."}</p>
                {observability.latestRun.decision.clarifyingQuestions?.length ? (
                  <ol className="mt-3 space-y-2 text-sm">
                    {observability.latestRun.decision.clarifyingQuestions.map((question, index) => (
                      <li key={`${index}-${question}`} className="flex gap-2"><span className="font-medium text-warning">{index + 1}.</span><span>{question}</span></li>
                    ))}
                  </ol>
                ) : null}
                {canOperate ? (
                  <>
                    {observability.latestRun.decision.suggestedActions?.length ? (
                      <div className="mt-3 flex flex-wrap gap-2" aria-label={language === "zh" ? "AI 建议" : "AI suggestions"}>
                        {observability.latestRun.decision.suggestedActions.map((suggestion) => (
                          <Button key={suggestion.id} size="sm" variant="secondary" onClick={() => setClarifyAnswer(suggestion.description ?? suggestion.label)}>
                            {language === "zh" ? "采用建议：" : "Use suggestion: "}{suggestion.label}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                    <Textarea
                      id={`${clarificationSectionId}-answer`}
                      className="mt-3"
                      rows={3}
                      value={clarifyAnswer}
                      placeholder={language === "zh" ? "直接回答上面的问题，也可以说明采用 AI 建议" : "Answer the questions above, or say that AI should use its recommendation"}
                      onChange={(event) => setClarifyAnswer(event.target.value)}
                    />
                    {clarifyError ? <p className="mt-2 text-sm text-destructive" role="alert">{clarifyError}</p> : null}
                    <div className="mt-3 flex flex-wrap justify-between gap-2">
                      <Button variant="secondary" disabled={clarifyPending || clarifyStopPending} onClick={() => void stopAiClarification()}>
                        {clarifyStopPending ? <RefreshCw className="animate-spin" aria-hidden /> : <X aria-hidden />}
                        {clarifyStopPending ? language === "zh" ? "正在停止" : "Stopping" : language === "zh" ? "停止 AI" : "Stop AI"}
                      </Button>
                      <Button disabled={!clarifyAnswer.trim() || clarifyPending || clarifyStopPending} onClick={() => void answerAiClarification()}>
                        {clarifyPending ? <RefreshCw className="animate-spin" aria-hidden /> : <ArrowRight aria-hidden />}
                        {clarifyPending ? language === "zh" ? "正在提交" : "Submitting" : language === "zh" ? "提交并让 AI 继续" : "Submit and continue"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="mt-3 rounded-lg bg-background/70 px-3 py-2 text-sm text-muted-foreground">
                    {language === "zh" ? "你的账号只能查看。请联系任务负责人或管理员回答，AI 会在收到答案后自动继续。" : "Your account is view-only. Ask the task owner or an administrator to answer; AI will continue automatically afterward."}
                  </p>
                )}
              </div>
            </div>
          </section>
        ) : null}

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

      {pendingTemplateClarification ? (
        <section id="task-template-result-question" className="rounded-xl border border-warning/40 bg-warning/[0.06] p-4" aria-label={language === "zh" ? "这次你希望最终得到什么？" : "What result do you want this time?"}>
          <h4 className="text-sm font-semibold">{language === "zh" ? "这次你希望最终得到什么？" : "What result do you want this time?"}</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            {pendingTemplateClarification.reason === "learned_preference_conflict"
              ? (language === "zh" ? "你以前对此类任务选择过不同结果。请选择本次结果，系统不会擅自猜测。" : "You previously chose different results for this kind of task. Choose this result so the system does not guess.")
              : (language === "zh" ? "选择结果即可，系统会自动采用对应的处理方法。" : "Choose the result only. The appropriate way of working will be applied automatically.")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[...new Map(pendingTemplateClarification.candidates.map((candidate) => [candidate.expectedOutput, candidate])).values()].map((candidate) => (
              <Button key={candidate.definitionId} size="sm" variant="secondary" disabled={actionPending !== null} onClick={() => { void choosePendingTemplateResult(candidate); }}>
                {candidate.expectedOutput}
              </Button>
            ))}
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
                {onCreateTaskDraft ? <Button size="sm" variant="secondary" onClick={() => onCreateTaskDraft([item.title, item.body?.trim()].filter(Boolean).join("\n"))}>{copy.reuseTask}</Button> : null}
                {onCreateTaskDraft ? <Button size="sm" variant="secondary" onClick={() => onCreateTaskDraft(language === "zh"
                  ? `基于“${item.title}”的结果继续：${resultSummary ?? "请说明下一步目标"}`
                  : `Follow up on “${item.title}”: ${resultSummary ?? "describe the next outcome"}`)}>{copy.createFollowUp}</Button> : null}
                {!item.myTemplateBinding && canOperate ? item.myTemplateDraft ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/[0.05] px-3 py-1.5 text-sm font-medium text-primary">
                    <BrainCircuit className="size-4" aria-hidden />
                    {language === "zh" ? "已保存，等待检查并启用" : "Saved for review and activation"}
                  </span>
                ) : (
                  <Button size="sm" variant="secondary" disabled={templateDraftPending} onClick={() => { void openTemplateDraft(); }}>
                    <BrainCircuit aria-hidden />
                    {language === "zh" ? "保存为我的模版" : "Save as My template"}
                  </Button>
                ) : null}
                {onOpenTaskCenter ? <Button size="sm" variant="secondary" onClick={onOpenTaskCenter}>{copy.taskCenter}</Button> : null}
              </div>
            </div>
          </div>
          {item.myTemplateBinding && item.status === "done" ? (
            <div className="mt-4 rounded-lg border border-primary/25 bg-background/75 p-3" aria-label={language === "zh" ? "这次结果符合预期吗？" : "Did this result meet your expectations?"}>
              <h5 className="text-sm font-semibold">{language === "zh" ? "这次结果符合预期吗？" : "Did this result meet your expectations?"}</h5>
              <p className="mt-1 text-xs text-muted-foreground">
                {language === "zh" ? "只评价实际结果。电脑离线、权限或运行失败不会被算成模版问题。" : "Rate only the actual result. Offline computers, permissions, and run failures are not treated as template problems."}
              </p>
              {item.myTemplateOutcomeFeedback && !templateOutcomeEditing ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge tone={item.myTemplateOutcomeFeedback.outcome === "met_expectations" ? "success" : item.myTemplateOutcomeFeedback.outcome === "wrong_result" ? "danger" : "warning"}>
                    {item.myTemplateOutcomeFeedback.outcome === "met_expectations"
                      ? (language === "zh" ? "符合预期" : "Met expectations")
                      : item.myTemplateOutcomeFeedback.outcome === "wrong_result"
                        ? (language === "zh" ? "结果类型不对" : "Wrong result type")
                        : (language === "zh" ? "内容需要调整" : "Content needs adjustment")}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{language === "zh" ? "反馈已记录" : "Feedback recorded"}</span>
                  <Button size="sm" variant="ghost" onClick={() => setTemplateOutcomeEditing(true)}>{language === "zh" ? "修改反馈" : "Change feedback"}</Button>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" disabled={templateOutcomePending} onClick={() => { void recordTemplateOutcome("met_expectations"); }}><CheckCircle2 />{language === "zh" ? "符合预期" : "Met expectations"}</Button>
                  <Button size="sm" variant="secondary" disabled={templateOutcomePending} onClick={() => { void recordTemplateOutcome("wrong_result"); }}>{language === "zh" ? "结果类型不对" : "Wrong result type"}</Button>
                  <Button size="sm" variant="secondary" disabled={templateOutcomePending} onClick={() => { void recordTemplateOutcome("needs_quality_adjustment"); }}>{language === "zh" ? "内容需要调整" : "Content needs adjustment"}</Button>
                </div>
              )}
              {templateOutcomeError ? <p className="mt-2 text-sm text-destructive" role="alert">{templateOutcomeError}</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {failed ? (
        <section className="grid gap-2 rounded-xl border border-destructive/35 bg-destructive/[0.04] p-4 text-sm sm:grid-cols-3">
          <div><p className="text-xs font-medium text-muted-foreground">{copy.why}</p><p className="mt-1">{copy.errorWhy}</p></div>
          <div><p className="text-xs font-medium text-muted-foreground">{copy.impact}</p><p className="mt-1">{copy.errorImpact}</p></div>
          <div><p className="text-xs font-medium text-muted-foreground">{copy.remedy}</p><p className="mt-1">{copy.errorRemedy}</p></div>
        </section>
      ) : null}

      {failed && resultFileEntries.length ? (
        <section className="rounded-xl border border-border bg-background/70 p-4" aria-label={copy.deliverableFiles}>
          <h4 className="text-sm font-semibold">{copy.deliverableFiles}</h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {language === "zh"
              ? "本次执行虽未正常结束，但已产生以下文件，可以直接查看。"
              : "The run did not finish normally, but these files were produced and remain available to review."}
          </p>
          <div className="mt-3">
            <DeliverableFileList
              entries={resultFileEntries}
              copy={copy}
              openingKey={openingResultFileKey}
              error={resultPreviewFile ? null : resultFileError}
              onOpen={(file) => void openResultFile(file)}
            />
          </div>
        </section>
      ) : null}

      {(status === "ready_for_review" || status === "completed") && resultExpanded ? (
        <section id={resultSectionId} className="scroll-mt-4 rounded-xl border border-success/30 bg-success/[0.035] p-4" aria-labelledby={`${resultSectionId}-title`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 id={`${resultSectionId}-title`} className="text-sm font-semibold">{presentation.title}</h4>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{presentation.hint}</p>
            </div>
            <Button size="sm" variant="secondary" disabled={!fullResult} onClick={() => setReportOpen(true)}>{copy.fullReport}</Button>
          </div>
          {outcome?.status === "missing" ? (
            <div className="mt-3 rounded-lg border border-destructive/35 bg-destructive/[0.05] px-3 py-2.5 text-sm" role="alert">
              <p className="font-semibold">{language === "zh" ? "结果暂时无法读取" : "The result is temporarily unavailable"}</p>
              <p className="mt-1 text-muted-foreground">{language === "zh" ? "系统记录到 AI 已结束，但没有取得可审核的结果。请重试或查看专业详情，在结果恢复前不能确认完成。" : "AI has finished, but no reviewable result was returned. Retry or open expert details; completion stays disabled until the result is restored."}</p>
            </div>
          ) : resultSummary ? (
            <div className="mt-3 rounded-lg border border-primary/25 bg-background/80 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">{language === "zh" ? "一句话结论" : "At a glance"}</p>
              <p className="mt-1 text-base font-medium leading-relaxed">{resultSummary}</p>
            </div>
          ) : null}
          {outcome?.highlights?.length ? (
            <div className="mt-3">
              <p className="text-xs font-medium text-muted-foreground">{language === "zh" ? "关键结果" : "Key results"}</p>
              <ul className="mt-1.5 grid gap-2 sm:grid-cols-2">
                {outcome.highlights.map((highlight) => <li key={highlight} className="rounded-lg bg-background/70 px-3 py-2 text-sm">{highlight}</li>)}
              </ul>
            </div>
          ) : null}
          {outcome?.warnings?.length ? (
            <div className="mt-3 rounded-lg border border-warning/35 bg-warning/[0.06] px-3 py-2.5">
              <p className="text-xs font-semibold text-warning">{language === "zh" ? "需要注意" : "Needs attention"}</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
                {outcome.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          ) : null}
          <div className="mt-3">
            <DeliveryDecisionCard decision={deliveryDecision} copy={copy} scopeLabel={presentation.completedScope} />
          </div>
          {observability?.delivery ? (
            <div className={`mt-3 rounded-lg border px-3 py-3 ${deliveryReview?.verdict === "approved" ? "border-success/35 bg-success/[0.06]" : deliveryReview?.verdict === "changes_requested" ? "border-destructive/35 bg-destructive/[0.05]" : "border-warning/35 bg-warning/[0.05]"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bot className="size-4 text-primary" aria-hidden />
                  <p className="text-sm font-semibold">{copy.aiReviewTitle}</p>
                  <Badge tone={deliveryReview?.verdict === "approved" ? "success" : deliveryReview?.verdict === "changes_requested" ? "danger" : "neutral"}>
                    {deliveryReview?.verdict === "approved"
                      ? language === "zh" ? "通过" : "Passed"
                      : deliveryReview?.verdict === "changes_requested"
                        ? language === "zh" ? "需修改" : "Changes needed"
                        : deliveryAiReview?.status === "running"
                          ? language === "zh" ? "审查中" : "Reviewing"
                          : language === "zh" ? "等待审查" : "Pending"}
                  </Badge>
                </div>
                {deliveryReview?.verdict === "changes_requested" && reviewFeedback ? (
                  <Button size="sm" disabled={Boolean(actionPending)} onClick={() => void sendChangeRequest(reviewFeedback)}>
                    <RefreshCw aria-hidden />{copy.sendAiReviewBack}
                  </Button>
                ) : null}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                {deliveryReview?.summary
                  ?? deliveryAiReview?.summary
                  ?? (deliveryReview?.verdict === "approved"
                    ? copy.aiReviewApproved
                    : deliveryReview?.verdict === "changes_requested"
                      ? copy.aiReviewChanges
                      : ["failed", "unavailable"].includes(deliveryAiReview?.status ?? "")
                        ? copy.aiReviewUnavailable
                        : copy.aiReviewPending)}
              </p>
              {reviewFindings.length ? (
                <ul className="mt-3 space-y-2">
                  {reviewFindings.slice(0, 8).map((finding, index) => (
                    <li key={`${finding.path ?? "finding"}-${finding.line ?? 0}-${index}`} className="rounded-md bg-background/75 px-3 py-2 text-sm">
                      <p className="font-medium [overflow-wrap:anywhere]">
                        {finding.path ?? (language === "zh" ? "代码" : "Code")}{finding.line ? `:${finding.line}` : ""}
                        {finding.severity ? <span className="ml-2 text-xs uppercase text-muted-foreground">{finding.severity}</span> : null}
                      </p>
                      <p className="mt-1 leading-relaxed text-foreground/90">{finding.body}</p>
                      {finding.suggestion ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{language === "zh" ? "修复建议" : "Suggested fix"}: {finding.suggestion}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : deliveryReview?.verdict === "approved" ? <p className="mt-2 text-xs text-muted-foreground">{copy.aiReviewNoFindings}</p> : null}
            </div>
          ) : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-background/70 px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground">{presentation.originalNote}</p>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed">{resultSummary || presentation.noSummary}</p>
            </div>
            <div className="rounded-lg bg-background/70 px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground">{resultVerification ? copy.verificationEvidence : copy.acceptanceResult}</p>
              <p className="mt-1">{resultVerification
                ? resultVerification.summary ?? (resultVerification.passed ? copy.aiReviewApproved : copy.aiReviewChanges)
                : reviewAcceptanceCriteria.length || item.acceptanceResults?.length
                  ? `${acceptancePassed} ${copy.passed} · ${Math.max(0, acceptanceNeedsReview)} ${copy.needsReview}`
                  : copy.noAcceptanceResult}</p>
            </div>
          </div>
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">{copy.deliverableFiles}</p>
            <DeliverableFileList
              entries={resultFileEntries}
              copy={copy}
              openingKey={openingResultFileKey}
              error={resultPreviewFile ? null : resultFileError}
              limit={8}
              onOpen={(file) => void openResultFile(file)}
            />
          </div>
          {observability?.outcomeHistory?.length ? (
            <details className="mt-3 rounded-lg border border-border bg-background/60 px-3 py-2.5">
              <summary className="cursor-pointer text-sm font-medium">
                {language === "zh" ? `历史结果（${observability.outcomeHistory.length}）` : `Previous results (${observability.outcomeHistory.length})`}
              </summary>
              <ol className="mt-2 space-y-2">
                {observability.outcomeHistory.map((previous) => (
                  <li key={`${previous.invocationId ?? "result"}-${previous.version}`} className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                    <p className="text-xs font-medium text-muted-foreground">
                      {language === "zh" ? `第 ${previous.version} 版` : `Version ${previous.version}`}
                      {previous.supersededAt ? ` · ${new Date(previous.supersededAt).toLocaleString()}` : ""}
                    </p>
                    <p className="mt-1 leading-relaxed">{previous.summary ?? (language === "zh" ? "该版本没有可读摘要" : "No readable summary for this version")}</p>
                    {previous.supersededByFeedback ? <p className="mt-1 text-xs text-muted-foreground">{language === "zh" ? "修改要求" : "Requested change"}: {previous.supersededByFeedback}</p> : null}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </section>
      ) : null}

      {status === "ready_for_review" && resultExpanded ? (
        <section className="rounded-xl border border-primary/35 bg-primary/[0.045] p-4" aria-labelledby={`${resultSectionId}-decision-title`}>
          <h4 id={`${resultSectionId}-decision-title`} className="text-sm font-semibold">{copy.reviewDecisionTitle}</h4>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{copy.reviewDecisionHint}</p>
          {!executionContractReady ? (
            <div className="mt-3 rounded-lg border border-warning/40 bg-warning/[0.08] px-3 py-2.5 text-sm" role="alert">
              <p className="font-semibold">{language === "zh" ? "本次结果缺少执行前验收依据，暂不能审核通过" : "This result has no pre-execution acceptance basis and cannot be approved"}</p>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                {executionContractDefined
                  ? language === "zh"
                    ? "完成标准和 SOP 是在这次结果产生后才建立的，因此只能用于下一轮执行。请让 AI 重新执行；新结果才可按这份方案验收。"
                    : "The criteria and SOP were established after this result, so they apply only to the next run. Rerun the task; only the new result can be reviewed against this plan."
                  : language === "zh"
                    ? "验收标准和 SOP 必须在 AI 开始前确定。本次历史运行没有完整执行契约，请先建立方案并重新执行；系统不会在审核阶段倒推标准。"
                    : "Acceptance criteria and the SOP must be confirmed before AI starts. This historical run has no complete execution contract; establish the plan and rerun. The system will not infer criteria during review."}
              </p>
              {!executionContractDefined ? <Button className="mt-2" size="sm" variant="secondary" disabled={Boolean(actionPending)} onClick={() => void prepareReviewExecutionPlan()}>{language === "zh" ? "建立重新执行方案" : "Prepare rerun plan"}</Button> : null}
            </div>
          ) : null}
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className={`rounded-lg border p-3 ${deliveryDecision.state !== "ready" ? "border-primary/40 bg-primary/[0.05]" : "border-border bg-background/70"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <RefreshCw className="size-4 text-primary" aria-hidden />
                <p className="text-sm font-semibold">{copy.requestChanges}</p>
                {deliveryDecision.state !== "ready" ? <Badge tone="running">{language === "zh" ? "建议" : "Recommended"}</Badge> : null}
              </div>
              <p className="mt-2 text-xs font-medium text-muted-foreground">{copy.actionEffect}</p>
              <p className="mt-1 text-sm leading-relaxed">{deliveryDecision.revisionEffect}</p>
              <p className="mt-2 text-xs font-medium text-muted-foreground">{copy.actionRisk}</p>
              <p className="mt-1 text-sm leading-relaxed">{deliveryDecision.revisionRisk}</p>
            </div>
            <div className={`rounded-lg border p-3 ${deliveryDecision.state === "ready" ? "border-success/40 bg-success/[0.05]" : "border-border bg-background/70"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <CheckCircle2 className="size-4 text-success" aria-hidden />
                <p className="text-sm font-semibold">{acceptActionLabel}</p>
                {deliveryDecision.state === "ready" ? <Badge tone="success">{language === "zh" ? "建议" : "Recommended"}</Badge> : null}
              </div>
              <p className="mt-2 text-xs font-medium text-muted-foreground">{copy.actionEffect}</p>
              <p className="mt-1 text-sm leading-relaxed">{deliveryDecision.confirmEffect}</p>
              <p className="mt-2 text-xs font-medium text-muted-foreground">{copy.actionRisk}</p>
              <p className="mt-1 text-sm leading-relaxed">{deliveryDecision.confirmRisk}</p>
            </div>
          </div>
          {observability?.delivery && deliveryReview?.verdict !== "approved" ? (
            <p className="mt-3 rounded-lg bg-warning/[0.08] px-3 py-2 text-sm text-foreground" role="status">
              {deliveryAiReview?.status === "queued" || deliveryAiReview?.status === "running"
                ? copy.aiReviewPending
                : deliveryReview?.verdict === "changes_requested"
                  ? copy.aiReviewChanges
                  : ["failed", "unavailable"].includes(deliveryAiReview?.status ?? "")
                    ? copy.aiReviewUnavailable
                    : copy.deliveryReviewRequired}
            </p>
          ) : null}
          {changeRequestOpen ? (
            <div className="mt-3 rounded-lg border border-border bg-background p-3">
              <p className="mb-2 text-sm font-semibold">{feedbackMode === "follow_up" ? language === "zh" ? "继续追问 AI" : "Ask AI a follow-up" : copy.requestChanges}</p>
              <Textarea rows={3} autoFocus value={changeRequest} placeholder={feedbackMode === "follow_up" ? language === "zh" ? "例如：第二个结论依据是什么？请补充原文证据。" : "For example: What supports the second conclusion? Add source evidence." : copy.changePlaceholder} onChange={(event) => setChangeRequest(event.target.value)} />
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <Button variant="ghost" disabled={Boolean(actionPending)} onClick={() => { setChangeRequestOpen(false); setChangeRequest(""); }}>{language === "zh" ? "取消" : "Cancel"}</Button>
                <Button disabled={!changeRequest.trim() || Boolean(actionPending)} onClick={() => void sendChangeRequest()}>{actionPending === "changes" ? copy.sendingChanges : feedbackMode === "follow_up" ? language === "zh" ? "提交追问" : "Send follow-up" : copy.sendChanges}</Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 grid gap-2 sm:flex sm:justify-end">
              <Button variant="ghost" disabled={Boolean(actionPending)} onClick={() => void stopDelivery()}>{language === "zh" ? "停止交付" : "Stop delivery"}</Button>
              <Button variant="secondary" disabled={Boolean(actionPending)} onClick={() => { setFeedbackMode("follow_up"); setChangeRequestOpen(true); }}><MessageSquare aria-hidden />{language === "zh" ? "继续追问" : "Ask follow-up"}</Button>
              <Button variant="secondary" disabled={Boolean(actionPending)} onClick={() => { setFeedbackMode("revision"); setChangeRequestOpen(true); }}>{copy.requestChanges}</Button>
              <Button
                disabled={!executionContractReady || Boolean(actionPending) || Boolean(observability?.delivery && observability.delivery.review?.verdict !== "approved")}
                onClick={() => { setCompletionWriteback("local_only"); setAcceptOpen(true); }}
              >
                <CheckCircle2 aria-hidden />{acceptActionLabel}
              </Button>
            </div>
          )}
        </section>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-border p-4">
          <div className="flex items-center gap-2"><FileText className="size-4 text-primary" aria-hidden /><h4 className="text-sm font-semibold">{copy.goal}</h4></div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{item.body?.trim() || copy.noGoal}</p>
        </section>
        <section className={`rounded-xl border p-4 ${executionContractReady ? "border-border" : "border-warning/35 bg-warning/[0.035]"}`}>
          <div className="flex flex-wrap items-center gap-2"><CheckCircle2 className="size-4 text-primary" aria-hidden /><h4 className="text-sm font-semibold">{language === "zh" ? "执行与验收依据" : "Execution and acceptance basis"}</h4><Badge tone={executionContractReady ? "success" : "warning"}>{executionContractReady ? language === "zh" ? "执行前已确认" : "Confirmed before execution" : language === "zh" ? "尚未建立" : "Not established"}</Badge></div>
          {item.acceptanceCriteriaSource === "body_unstructured" ? <p className="mt-2 text-xs leading-relaxed text-warning">{language === "zh" ? "系统在原任务正文中找到了验收标准，但本次运行开始前没有把它与 SOP 一起确认为执行契约。" : "Acceptance criteria were found in the original task body, but they were not confirmed together with an SOP before this run."}</p> : null}
          <p className="mt-3 text-xs font-medium text-muted-foreground">{copy.acceptance}</p>
          {reviewAcceptanceCriteria.length ? (
            <ul className="mt-2 space-y-1.5 text-sm">{reviewAcceptanceCriteria.map((criterion) => <li key={criterion} className="flex gap-2"><span aria-hidden>✓</span><span>{criterion}</span></li>)}</ul>
          ) : <p className="mt-2 text-sm text-muted-foreground">{copy.noAcceptance}</p>}
          <p className="mt-4 text-xs font-medium text-muted-foreground">{language === "zh" ? "验收 SOP" : "Verification SOP"}</p>
          {reviewVerificationSop.length ? (
            <ol className="mt-2 space-y-1.5 text-sm">{reviewVerificationSop.map((step, index) => <li key={`${index}-${step}`} className="flex gap-2"><span className="text-primary">{index + 1}.</span><span>{step}</span></li>)}</ol>
          ) : <p className="mt-2 text-sm text-muted-foreground">{language === "zh" ? "尚未设置验收 SOP。AI 自动执行前必须先补全。" : "No verification SOP is set. Complete it before AI execution."}</p>}
        </section>
      </div>

      {item.myTemplateBinding ? (
        <section
          className="rounded-xl border border-primary/30 bg-primary/[0.035] p-4"
          aria-labelledby={`work-item-template-${item.id}`}
          data-testid="work-item-template-binding"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Bot className="size-4 text-primary" aria-hidden />
                <h4 id={`work-item-template-${item.id}`} className="text-sm font-semibold">
                  {language === "zh" ? "这次会怎样得到结果" : "How this task will produce its result"}
                </h4>
                <Badge tone="success">{learnedTemplateMatch
                  ? (language === "zh" ? "参考了你的纠正" : "Learned from your correction")
                  : (language === "zh" ? "已按结果自动采用" : "Selected from the result")}</Badge>
              </div>
              <p className="mt-2 text-sm font-medium">
                {language === "zh" ? "预计得到：" : "Expected result: "}{item.myTemplateBinding.expectedOutput}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {language === "zh" ? "来自我的模版：" : "From My templates: "}{item.myTemplateBinding.name}
              </p>
            </div>
            {canCorrectMyTemplate && !templateCorrectionOpen ? (
              <Button size="sm" variant="ghost" disabled={templateCorrectionPending} onClick={() => { void openTemplateCorrection(); }}>
                {language === "zh" ? "结果不对" : "Wrong result"}
              </Button>
            ) : null}
          </div>
          {learnedTemplateMatch ? (
            <p className="mt-3 rounded-lg border border-primary/20 bg-background/70 p-2.5 text-xs leading-relaxed text-muted-foreground">
              {language === "zh"
                ? "系统发现这项任务与之前由你纠正过的任务相似，因此优先采用这个结果。你可以在“我的模版”中的“系统记住的选择”查看或撤销。"
                : "This task looks similar to one you corrected before, so that result was preferred. You can review or remove the preference in My templates under Learned choices."}
            </p>
          ) : null}
          {item.myTemplateBinding.matchReasons.length ? (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {language === "zh" ? "使用原因：" : "Why it was used: "}
              {item.myTemplateBinding.matchReasons.join(language === "zh" ? "；" : "; ")}
            </p>
          ) : null}
          {templateCorrectionOpen ? (
            <section className="mt-3 rounded-lg border border-warning/35 bg-background/80 p-3" aria-label={language === "zh" ? "纠正处理结果" : "Correct the result"}>
              <h5 className="text-sm font-semibold">{language === "zh" ? "这次实际想得到什么？" : "What do you actually want this time?"}</h5>
              <p className="mt-1 text-xs text-muted-foreground">
                {language === "zh" ? "选择结果即可。只会调整尚未开始的当前任务，并帮助以后判断相似任务。" : "Choose the result only. This changes only the unstarted task and helps with similar tasks later."}
              </p>
              {templateCorrectionPending && !templateCorrectionOptions.length ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" aria-hidden />{language === "zh" ? "正在查找可用结果…" : "Finding available results…"}</p>
              ) : templateCorrectionOptions.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {templateCorrectionOptions.map((definition) => (
                    <Button key={definition.id} size="sm" variant="secondary" disabled={templateCorrectionPending} onClick={() => { void correctTemplateResult(definition); }}>
                      {myTemplateExpectedOutput(definition)}
                    </Button>
                  ))}
                </div>
              ) : !templateCorrectionError ? (
                <p className="mt-3 text-sm text-muted-foreground">{language === "zh" ? "还没有其他可用结果，可以先到“我的模版”继续完善。" : "No other result is available yet. Add one in My templates first."}</p>
              ) : null}
              {templateCorrectionError ? <p className="mt-3 text-sm text-destructive" role="alert">{templateCorrectionError}</p> : null}
              <Button className="mt-3" size="sm" variant="ghost" disabled={templateCorrectionPending} onClick={() => { setTemplateCorrectionOpen(false); setTemplateCorrectionError(null); }}>
                {language === "zh" ? "取消" : "Cancel"}
              </Button>
            </section>
          ) : null}
          {item.myTemplateBinding.snapshot.steps.length ? (
            <details className="mt-3 rounded-lg border border-border/80 bg-background/70 px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">
                {language === "zh" ? "查看处理步骤" : "View processing steps"}
              </summary>
              <ol className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                {item.myTemplateBinding.snapshot.steps.map((step, index) => (
                  <li key={step.key} className="flex gap-2">
                    <span className="text-primary">{index + 1}.</span>
                    <span>{step.label}</span>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </section>
      ) : null}

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
                    {(asset.mimeType?.startsWith("text/") || asset.mimeType?.startsWith("image/") || asset.mimeType === "application/pdf" || asset.mimeType === "application/json" || isOfficeMaterial(asset)) ? (
                      <Button size="sm" variant="ghost" aria-label={`${copy.previewFile}: ${asset.originalName ?? asset.path}`} onClick={() => void previewMaterial(asset.id!)}><Eye className="size-3.5" aria-hidden />{copy.previewFile}</Button>
                    ) : <Badge tone="neutral">{copy.downloadOnly}</Badge>}
                    <Button size="sm" variant="ghost" aria-label={`${copy.downloadFile}: ${asset.originalName ?? asset.path}`} onClick={() => downloadMaterial(asset.id!)}><Download className="size-3.5" aria-hidden />{copy.downloadFile}</Button>
                    <Button size="sm" variant="ghost" aria-label={`${copy.openDeliverableFolder}: ${asset.originalName ?? asset.path}`} title={copy.openDeliverableFolder} disabled={materialRevealPendingId === asset.id} onClick={() => void revealMaterial(asset.id!)}>{materialRevealPendingId === asset.id ? <RefreshCw className="size-3.5 animate-spin" aria-hidden /> : <FolderOpen className="size-3.5" aria-hidden />}{copy.openDeliverableFolder}</Button>
                    {status !== "completed" ? <Button size="sm" variant="ghost" className="hover:text-destructive" aria-label={`${copy.removeFile}: ${asset.originalName ?? asset.path}`} disabled={materialPendingId === asset.id} onClick={() => void removeMaterial(asset.id!)}><Trash2 className="size-3.5" aria-hidden />{copy.removeFile}</Button> : null}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {materialRevealError ? <p className="mt-2 rounded-md border border-warning/40 bg-warning/[0.07] px-3 py-2 text-sm" role="alert">{materialRevealError}</p> : null}
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
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{presentation.collaborationHint}</p>
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
            complete={hasManagedExecution && collaborationStage > 1}
            icon={Bot}
            label={presentation.executionLabel}
            detail={`${plannedDate} · ${executionStateLabel(item, language)}`}
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
        open={templateDraftOpen}
        onClose={() => { if (!templateDraftPending) setTemplateDraftOpen(false); }}
        title={language === "zh" ? "保存为新的“我的模版”" : "Save as a new My template"}
        description={language === "zh"
          ? "系统已根据这次任务整理输入和结果。保存后即可到“我的模版”检查学习结果，并由你决定是否启用。"
          : "The input and result were extracted from this task. After saving, review what was learned in My templates and decide whether to enable it."}
        closeDisabled={templateDraftPending}
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" disabled={templateDraftPending} onClick={() => setTemplateDraftOpen(false)}>
              {language === "zh" ? "取消" : "Cancel"}
            </Button>
            <Button
              disabled={templateDraftPending || !templateDraftPreview?.eligible || !templateDraftName.trim() || !templateDraftInput.trim() || !templateDraftOutput.trim()}
              onClick={() => { void saveTemplateDraft(); }}
            >
              {templateDraftPending ? <RefreshCw className="animate-spin" aria-hidden /> : <BrainCircuit aria-hidden />}
              {templateDraftPending ? (language === "zh" ? "正在整理…" : "Saving…") : (language === "zh" ? "确认并保存模版" : "Confirm and save template")}
            </Button>
          </div>
        )}
      >
        {templateDraftPending && !templateDraftPreview ? (
          <p className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <RefreshCw className="size-4 animate-spin" aria-hidden />
            {language === "zh" ? "正在从本次输入和结果中提取…" : "Extracting this task's input and result…"}
          </p>
        ) : templateDraftPreview && !templateDraftPreview.eligible ? (
          <div className="rounded-lg border border-warning/35 bg-warning/[0.06] p-3 text-sm" role="status">
            <p className="font-semibold">{language === "zh" ? "这项任务暂时不能保存" : "This task cannot be saved yet"}</p>
            <p className="mt-1 text-muted-foreground">
              {templateDraftPreview.reasons.includes("task_result_evidence_required")
                ? (language === "zh" ? "还没有可确认的结果文件、交付说明或通过记录。请先补充并确认任务结果。" : "No confirmable result file, delivery summary, or passed check is available yet.")
                : templateDraftPreview.reasons.includes("task_already_used_my_template")
                  ? (language === "zh" ? "这项任务已经使用了现有模版，不会再创建一个重复的新模版。" : "This task already used an existing template, so a duplicate will not be created.")
                  : (language === "zh" ? "请先完成这项任务。" : "Complete this task first.")}
            </p>
          </div>
        ) : templateDraftPreview?.suggestion ? (
          <div className="space-y-4">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">{language === "zh" ? "这类工作叫什么？" : "What is this kind of work called?"}</span>
              <Input value={templateDraftName} onChange={(event) => setTemplateDraftName(event.target.value)} maxLength={200} autoFocus />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">{language === "zh" ? "通常收到什么？" : "What usually comes in?"}</span>
              <Textarea rows={2} value={templateDraftInput} onChange={(event) => setTemplateDraftInput(event.target.value)} maxLength={1000} />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">{language === "zh" ? "最后希望得到什么？" : "What should come out?"}</span>
              <Textarea rows={2} value={templateDraftOutput} onChange={(event) => setTemplateDraftOutput(event.target.value)} maxLength={1000} />
            </label>
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              <p className="font-medium">{language === "zh" ? "保存后会怎样？" : "What happens after saving?"}</p>
              <p className="mt-1 text-muted-foreground">
                {language === "zh" ? "这会保存 1 个成功案例。一个案例即可进入检查和启用；启用前不会参与匹配，原任务保持不变。" : "This saves one successful case. One case is enough to review and enable; it will not participate in matching before activation, and the original task stays unchanged."}
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-primary">{language === "zh" ? "查看系统整理的处理方法" : "View extracted method"}</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                  {templateDraftPreview.suggestion.steps.map((step) => <li key={step}>{step}</li>)}
                </ol>
              </details>
            </div>
          </div>
        ) : null}
        {templateDraftError ? <p className="mt-3 text-sm text-destructive" role="alert">{templateDraftError}</p> : null}
      </Modal>
      <Modal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title={presentation.title}
        description={copy.fullReportDescription}
        size="xl"
        closeDisabled={Boolean(actionPending)}
        footer={(
          <div className="space-y-3">
            {changeRequestOpen ? (
              <div className="rounded-lg border border-primary/30 bg-primary/[0.035] p-3">
                <label className="text-sm font-semibold" htmlFor={`report-change-request-${item.id}`}>{feedbackMode === "follow_up" ? language === "zh" ? "继续追问 AI" : "Ask AI a follow-up" : copy.requestChanges}</label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{deliveryDecision.revisionEffect}</p>
                <Textarea
                  id={`report-change-request-${item.id}`}
                  className="mt-2"
                  rows={3}
                  autoFocus
                  value={changeRequest}
                  placeholder={feedbackMode === "follow_up" ? language === "zh" ? "例如：第二个结论依据是什么？请补充原文证据。" : "For example: What supports the second conclusion? Add source evidence." : copy.changePlaceholder}
                  onChange={(event) => setChangeRequest(event.target.value)}
                />
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" disabled={Boolean(actionPending)} onClick={() => { setChangeRequestOpen(false); setChangeRequest(""); }}>{language === "zh" ? "取消修改" : "Cancel revision"}</Button>
                  <Button disabled={!changeRequest.trim() || Boolean(actionPending)} onClick={() => void sendChangeRequest()}>
                    <RefreshCw className={actionPending === "changes" ? "animate-spin" : ""} aria-hidden />
                    {actionPending === "changes" ? copy.sendingChanges : feedbackMode === "follow_up" ? language === "zh" ? "提交追问" : "Send follow-up" : copy.sendChanges}
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" disabled={Boolean(actionPending)} onClick={() => { setReportOpen(false); onOpenExpert("report"); }}>
                <Wrench aria-hidden />{copy.openExpertDetails}
              </Button>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" disabled={Boolean(actionPending)} onClick={() => setReportOpen(false)}>{language === "zh" ? "关闭" : "Close"}</Button>
                <Button variant="secondary" disabled={Boolean(actionPending)} onClick={() => { setFeedbackMode("follow_up"); setChangeRequestOpen(true); }}>
                  <MessageSquare aria-hidden />{language === "zh" ? "继续追问" : "Ask follow-up"}
                </Button>
                <Button variant="secondary" disabled={Boolean(actionPending)} onClick={() => { setFeedbackMode("revision"); setChangeRequestOpen(true); }}>
                  <RefreshCw aria-hidden />{copy.requestChanges}
                </Button>
                <Button
                  disabled={!executionContractReady || !outcomeReady || Boolean(actionPending) || Boolean(observability?.delivery && observability.delivery.review?.verdict !== "approved")}
                  onClick={() => { setReportOpen(false); setCompletionWriteback("local_only"); setAcceptOpen(true); }}
                >
                  <CheckCircle2 aria-hidden />{acceptActionLabel}
                </Button>
              </div>
            </div>
          </div>
        )}
      >
        <div className="space-y-4">
          <DeliveryDecisionCard decision={deliveryDecision} copy={copy} />


          <section className="rounded-lg border border-primary/25 bg-primary/[0.035] p-4">
            <h3 className="text-sm font-semibold">{language === "zh" ? "可选动作与影响" : "Available actions and impact"}</h3>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded-md bg-background/75 px-3 py-2.5">
                <p className="text-sm font-semibold">{copy.requestChanges}</p>
                <p className="mt-2 text-xs font-medium text-muted-foreground">{copy.actionEffect}</p>
                <p className="mt-1 text-sm leading-relaxed">{deliveryDecision.revisionEffect}</p>
                <p className="mt-2 text-xs font-medium text-muted-foreground">{copy.actionRisk}</p>
                <p className="mt-1 text-sm leading-relaxed">{deliveryDecision.revisionRisk}</p>
              </div>
              <div className="rounded-md bg-background/75 px-3 py-2.5">
                <p className="text-sm font-semibold">{acceptActionLabel}</p>
                <p className="mt-2 text-xs font-medium text-muted-foreground">{copy.actionEffect}</p>
                <p className="mt-1 text-sm leading-relaxed">{deliveryDecision.confirmEffect}</p>
                <p className="mt-2 text-xs font-medium text-muted-foreground">{copy.actionRisk}</p>
                <p className="mt-1 text-sm leading-relaxed">{deliveryDecision.confirmRisk}</p>
              </div>
            </div>
          </section>

          <section className={`rounded-lg border p-4 ${deliveryReview?.verdict === "approved" ? "border-success/35 bg-success/[0.06]" : deliveryReview?.verdict === "changes_requested" ? "border-destructive/35 bg-destructive/[0.05]" : "border-border bg-muted/30"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Bot className="size-4 text-primary" aria-hidden />
              <h3 className="text-sm font-semibold">{copy.aiReviewTitle}</h3>
              <Badge tone={deliveryReview?.verdict === "approved" ? "success" : deliveryReview?.verdict === "changes_requested" ? "danger" : "neutral"}>
                {deliveryReview?.verdict === "approved"
                  ? language === "zh" ? "通过" : "Passed"
                  : deliveryReview?.verdict === "changes_requested"
                    ? language === "zh" ? "需修改" : "Changes needed"
                    : language === "zh" ? "等待复核" : "Pending"}
              </Badge>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{deliveryReview?.summary ?? deliveryAiReview?.summary ?? copy.aiReviewPending}</p>
          </section>

          <section className="rounded-lg border border-border bg-background/70 p-4">
            <h3 className="text-sm font-semibold">{copy.originalAiNote}</h3>
            {fullResult ? <MarkdownBlock text={fullResult} className="mt-2" /> : <p className="mt-2 text-sm text-muted-foreground">{copy.noDeliverableSummary}</p>}
          </section>

          <section className="rounded-lg border border-border bg-background/70 p-4">
            <h3 className="text-sm font-semibold">{resultVerification ? copy.verificationEvidence : copy.acceptanceResult}</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {resultVerification?.summary
                ?? (resultVerification?.passed ? copy.aiReviewApproved : null)
                ?? (reviewAcceptanceCriteria.length || item.acceptanceResults?.length
                  ? `${acceptancePassed} ${copy.passed} · ${Math.max(0, acceptanceNeedsReview)} ${copy.needsReview}`
                  : copy.noAcceptanceResult)}
            </p>
          </section>

          <section className="rounded-lg border border-border bg-background/70 p-4">
            <h3 className="text-sm font-semibold">{copy.deliverableFiles}</h3>
            <DeliverableFileList
              entries={resultFileEntries}
              copy={copy}
              openingKey={openingResultFileKey}
              error={resultPreviewFile ? null : resultFileError}
              onOpen={(file) => void openResultFile(file)}
            />
          </section>

        </div>
      </Modal>
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
              {retryPending ? copy.retrying : executionContractDefined ? copy.retryConfirm : language === "zh" ? "先生成执行方案" : "Prepare execution plan"}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={acceptOpen}
        onClose={() => { if (actionPending !== "complete") setAcceptOpen(false); }}
        title={acceptDialogTitle}
        description={acceptDialogDescription}
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
            <Button disabled={!executionContractReady || !outcomeReady || actionPending === "complete"} onClick={() => void acceptAndComplete()}>
              <CheckCircle2 aria-hidden />
              {actionPending === "complete" ? copy.accepting : acceptDialogConfirm}
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
        open={Boolean(resultPreviewFile)}
        onClose={closeResultPreview}
        title={resultPreviewFile?.name ?? copy.browseDeliverableFile}
        description={copy.deliverablePreviewDescription}
        size="2xl"
      >
        {resultPreviewFile?.path ? <p className="mb-3 truncate font-mono text-[11px] text-muted-foreground" title={resultPreviewFile.path}>{resultPreviewFile.path}</p> : null}
        {openingResultFileKey && !resultPreview ? (
          <p className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <RefreshCw className="size-4 animate-spin" aria-hidden />
            {copy.deliverablePreviewLoading}
          </p>
        ) : resultFileError && !resultPreview ? (
          <div className="grid min-h-48 place-items-center text-center">
            <div>
              <p className="text-sm text-destructive" role="alert">{resultFileError}</p>
              {resultPreviewFile ? <Button className="mt-3" variant="secondary" onClick={() => void openResultFile(resultPreviewFile)}>{copy.retry}</Button> : null}
            </div>
          </div>
        ) : resultPreview?.kind === "markdown" && resultPreviewFile ? (
          <>
            {resultPreview.truncated ? <p className="mb-3 rounded-md border border-warning/40 bg-warning/[0.07] px-3 py-2 text-sm">{copy.deliverablePreviewTruncated}</p> : null}
            <DeliveryMarkdownDocument file={resultPreviewFile} text={resultPreview.text} copy={copy} />
          </>
        ) : resultPreview?.kind === "text" ? (
          <>
            {resultPreview.truncated ? <p className="mb-3 rounded-md border border-warning/40 bg-warning/[0.07] px-3 py-2 text-sm">{copy.deliverablePreviewTruncated}</p> : null}
            <pre className="min-h-48 whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-4 font-mono text-xs leading-6">{resultPreview.text}</pre>
          </>
        ) : resultPreview?.kind === "image" ? (
          <div className="grid min-h-[28rem] place-items-center rounded-lg border border-border bg-background p-4">
            <img src={resultPreview.source} alt={resultPreviewFile?.name ?? ""} className="max-h-[70vh] max-w-full object-contain" />
          </div>
        ) : resultPreview?.kind === "pdf" ? (
          <iframe className="h-[70vh] w-full rounded-lg border border-border bg-background" src={resultPreview.source} title={resultPreviewFile?.name ?? "PDF"} />
        ) : resultPreview?.kind === "office" ? (
          <OfficeDocumentFrame title={resultPreviewFile?.name ?? "Document"} content={resultPreview.html} className="min-h-[70vh]" />
        ) : null}
      </Modal>
      <Modal
        open={Boolean(previewAsset)}
        onClose={closeMaterialPreview}
        title={previewAsset?.originalName ?? previewAsset?.path.split("/").pop() ?? copy.previewFile}
        description={item.title}
        size="full"
      >
        {previewAsset?.id ? (
          <div className="space-y-3">
            {isOfficeMaterial(previewAsset) ? (
              materialPreviewPending ? (
                <p className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status"><RefreshCw className="size-4 animate-spin" aria-hidden />{copy.deliverablePreviewLoading}</p>
              ) : materialPreviewError ? (
                <p className="grid min-h-48 place-items-center text-sm text-destructive" role="alert">{materialPreviewError}</p>
              ) : materialOfficePreview ? (
                <OfficeDocumentFrame title={`${copy.previewFile}: ${previewAsset.originalName ?? previewAsset.path}`} content={materialOfficePreview} className="min-h-[65vh] rounded-lg border border-border" />
              ) : null
            ) : (
              <iframe
                className="h-[65vh] w-full rounded-lg border border-border bg-background"
                src={api.taskMaterialContentUrl(item.id, previewAsset.id)}
                title={`${copy.previewFile}: ${previewAsset.originalName ?? previewAsset.path}`}
              />
            )}
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

function DeliveryDecisionCard({
  decision,
  copy,
  scopeLabel,
}: {
  decision: DeliveryDecision;
  copy: SummaryCopy;
  scopeLabel?: string;
}) {
  const tone = decision.state === "ready" ? "success" : decision.state === "changes" ? "danger" : decision.state === "waiting" ? "neutral" : "warning";
  const riskLabel = {
    low: copy.riskLow,
    medium: copy.riskMedium,
    high: copy.riskHigh,
    unknown: copy.riskUnknown,
  }[decision.risk];
  return (
    <section className={`rounded-lg border p-4 ${
      decision.state === "ready"
        ? "border-success/35 bg-success/[0.06]"
        : decision.state === "changes"
          ? "border-destructive/35 bg-destructive/[0.05]"
          : "border-warning/35 bg-warning/[0.05]"
    }`} aria-label={copy.decisionSummary}>
      <div className="flex flex-wrap items-center gap-2">
        {decision.state === "ready"
          ? <CheckCircle2 className="size-5 text-success" aria-hidden />
          : <AlertTriangle className={`size-5 ${decision.state === "changes" ? "text-destructive" : "text-warning"}`} aria-hidden />}
        <h3 className="font-semibold">{decision.headline}</h3>
        <Badge tone={tone}>{copy.resultRisk}: {riskLabel}</Badge>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="rounded-md bg-background/75 px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">{scopeLabel ?? copy.completedScope}</p>
          <p className="mt-1.5 text-sm leading-relaxed">{decision.scope}</p>
        </div>
        <div className="rounded-md bg-background/75 px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">{copy.checkResult}</p>
          <p className="mt-1.5 text-sm leading-relaxed">{decision.checks}</p>
        </div>
        <div className="rounded-md bg-background/75 px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">{copy.recommendedNext}</p>
          <p className="mt-1.5 text-sm font-medium leading-relaxed">{decision.recommendation}</p>
        </div>
      </div>
    </section>
  );
}
