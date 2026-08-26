import type { WorkItemUserStatus } from "./work-item-user-status";

export type SummaryCopy = {
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

export const COPY: Record<"zh" | "en", SummaryCopy> = {
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
    noDeliverableFiles: "这次没有登记可直接打开的交付文件。",
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
    readinessBlocked: "还差一步才能交给 AI",
    readinessWarning: "可以启动，但建议先处理这些提醒",
    readinessFix: "打开设置",
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
    noDeliverableFiles: "No directly openable deliverable files were registered for this task.",
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
