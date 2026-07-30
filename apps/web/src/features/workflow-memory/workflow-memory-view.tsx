import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  Check,
  FileCheck2,
  FileQuestion,
  FolderSearch,
  GitCompareArrows,
  Eye,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X as XIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { api } from "@/data/use-console-actions";
import { useConsoleState, useRefreshConsoleState } from "@/data/use-console-state";
import { workflowMemoryApi } from "@/features/workflow-memory/workflow-memory-api";
import { RoutineSetupGuide } from "@/features/workflow-memory/routine-setup-guide";
import { ApiError } from "@/lib/api-client";
import type {
  BusinessRoutineDefinition,
  BusinessRoutineDiscoveryCandidate,
  BusinessRoutineStep,
  WorkflowArtifact,
  WorkflowArtifactRole,
  WorkflowFeedbackReason,
  WorkflowLearningQuality,
  WorkflowPairProposal,
  WorkflowProfile,
  WorkflowProfileDraft,
  WorkflowRun,
  WorkflowSource,
  SimilarWorkflowCase,
  WorktreeDiffSnapshot,
} from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useUiStore } from "@/store/ui-store";

const workflowApi = { ...api, ...workflowMemoryApi };

const ROLES: WorkflowArtifactRole[] = ["requirement", "delivery", "reference", "draft", "unknown"];
const FEEDBACK_REASONS: WorkflowFeedbackReason[] = [
  "content_corrected",
  "structure_adjusted",
  "format_adjusted",
  "missing_information",
  "quality_issue",
  "wrong_workflow",
  "other",
];

const COPY = {
  en: {
    title: "Delivery memory",
    description: "Learn an explainable, reusable workflow from confirmed requirement and delivery files.",
    back: "Back to assets",
    addSource: "Add a learning source",
    chooseFolder: "Choose folder",
    sourceHint: "Only the selected registered project folder is read. Nothing outside it is scanned.",
    project: "Project",
    sourceName: "Source name",
    relativePath: "Folder inside project",
    rootHint: "Leave empty to use the whole project.",
    metadata: "Metadata only",
    text: "Read supported text files",
    add: "Authorize source",
    sources: "Learning sources",
    noSources: "No folder has been authorized yet.",
    scan: "Scan now",
    cancelScan: "Cancel scan",
    revoke: "Revoke access",
    deleteData: "Delete learned data",
    deleteConfirm: "Delete this source, index, cases, profiles, and run history? Original files will not be deleted.",
    files: "files",
    discovered: "discovered",
    skipped: "skipped",
    parsed: "parsed",
    parseFailed: "parse failed",
    needsOcr: "Scanned PDF — OCR required",
    parseLimited: "Parsing skipped by a safety limit",
    retryParsing: "Retry parsing",
    exclude: "Exclude",
    include: "Include again",
    excluded: "Excluded from learning",
    excludePrompt: "Why should this file be excluded from learning?",
    reusedParsing: "unchanged reused",
    lastScan: "Last scan",
    never: "Never",
    review: "Review file roles",
    reviewHint: "The system proposes a role and explains why. Confirmed files can become workflow evidence.",
    noArtifacts: "Scan this source to discover supported files.",
    confidence: "confidence",
    confirm: "Confirm",
    confirmVisible: "Confirm visible suggestions",
    changed: "File changed — confirm again",
    reason: "Why",
    untrusted: "Instruction-like text detected. Review this file as untrusted input before using it.",
    pairs: "Requirement → delivery cases",
    pairsHint: "Confirm only relationships you recognize. Ambiguous pairs are not learned automatically.",
    noPairs: "No unconfirmed pair proposal is available.",
    createCase: "Confirm case",
    confirmedCases: "Confirmed learning cases",
    archiveCase: "Archive case",
    restoreCase: "Restore case",
    archiveCasePrompt: "Why should this learning case be excluded?",
    restoreCaseConfirm: "Restore this case as trusted learning evidence?",
    profiles: "Workflow profiles",
    profilesHint: "Three confirmed successful cases create an established profile; fewer create a trial profile.",
    profileName: "Workflow name",
    derive: "Create profile",
    rebuildDraft: "Rebuild draft",
    profileDrafts: "Profile drafts awaiting review",
    publishDraft: "Publish draft",
    draftImpact: "Impact preview",
    noProfileChanges: "No structural change detected.",
    noProfiles: "No workflow profile yet.",
    routineLibrary: "Daily work types",
    routineLibraryHint: "Review what was learned from past work, adjust the steps, then explicitly enable it as a reusable task.",
    routineCandidate: "Suggested daily work",
    routineDefinitionCandidate: "Needs review",
    routineDraft: "Awaiting your review",
    routinePublished: "Enabled",
    routineDisabled: "Disabled",
    routineSuperseded: "Replaced by a newer version",
    noRoutineCandidates: "No stable daily work has been discovered yet. Confirm at least three comparable cases first.",
    createRoutineDraft: "Review this work type",
    routineName: "Work type name",
    routineDescription: "What this work produces",
    routineTrigger: "Starts when this arrives",
    routineSteps: "Work steps",
    routineStepKind: "Step purpose",
    routineStepDetails: "Reference, output, ledger, condition, or approval details",
    routineSaveBeforePublish: "Save the latest changes before enabling this work type.",
    routineConditionRequired: "Describe when this conditional step should run.",
    mandatoryStep: "Always",
    conditionalStep: "When applicable",
    historicalCases: "confirmed examples",
    saveRoutineDraft: "Save review",
    addRoutineStep: "Add a step",
    removeRoutineStep: "Remove",
    moveEarlier: "Move earlier",
    moveLater: "Move later",
    publishRoutineConfirm: "I reviewed the trigger, steps, outputs, ledgers, and approval points.",
    publishRoutine: "Enable this work type",
    newRoutineVersion: "Create a new version",
    disableRoutine: "Disable for new tasks",
    manageRoutine: "Version and availability",
    routineEvidenceChanged: "Historical evidence changed. Refresh the cases before enabling this work type.",
    routineSourceRevoked: "Source access was removed. Restore access before enabling this work type.",
    routinePatternChanged: "A newer work pattern is available. Review a fresh suggestion before enabling it.",
    routineRecoveryRefresh: "Refresh this source and reconfirm the affected examples.",
    routineEvidenceSupport: (support: number, total: number) =>
      `${support} of ${total} confirmed examples include this step.`,
    routineErrors: {
      insufficient_confirmed_business_cases: "Confirm at least three comparable cases, then try again.",
      routine_discovery_evidence_changed: "Refresh and reconfirm the changed historical cases, then review the work type again.",
      routine_definition_revision_conflict: "This work type changed in another view. Refresh it before editing again.",
      routine_step_condition_required: "Describe when the conditional step should run, then save again.",
      routine_definition_evidence_not_valid: "Refresh and reconfirm the affected historical cases before enabling this work type.",
      routine_definition_source_revoked: "Restore access to the source before changing this work type.",
      routine_definition_publication_confirmation_required: "Review the work type and select the confirmation before enabling it.",
    },
    routineStepKinds: {
      extract: "Read the inquiry",
      retrieve: "Retrieve references",
      generate: "Prepare an output",
      ledger_upsert: "Update a ledger",
      human_approval: "Human review",
      condition: "Check a condition",
      create_issue: "Hand off follow-up work",
    },
    routineTriggerTypes: {
      inquiry: "Inquiry",
      quotation: "Quotation",
      order: "Order",
    },
    routineStepConfiguration: {
      extract: "Fields to read",
      retrieve: "Reference sources",
      generate: "Output to prepare",
      ledger_upsert: "Ledger and field mapping",
      human_approval: "Approval requirement",
      condition: "Business condition",
      create_issue: "Handoff destination",
    },
    trial: "Trial",
    established: "Established",
    evidenceCases: "evidence cases",
    learningQuality: "Learning quality",
    qualityTrusted: "Trusted",
    qualityReview: "Review",
    qualityBlocked: "Blocked",
    qualitySignals: {
      missing_requirement: "Requirement file is missing",
      missing_delivery: "Delivery file is missing",
      missing_artifact: "Evidence file is missing",
      artifact_unavailable: "Evidence file is unavailable",
      artifact_excluded: "Evidence file was excluded",
      evidence_changed: "Evidence changed after confirmation",
      content_not_fully_parsed: "Some content was not parsed",
      parsing_attention_required: "Some files need parsing attention",
      roles_not_fully_confirmed: "Some file roles need confirmation",
      low_pairing_confidence: "Requirement and delivery may not belong together",
    },
    retrievalEvaluation: "Retrieval quality",
    retrievalEvaluationHint: "Checks whether known requirements can retrieve another case from the correct workflow family.",
    retrievalPassed: "Baseline protected",
    retrievalRegressed: "Regression detected",
    retrievalInsufficient: "More confirmed cases required",
    retrievalSamples: "samples",
    top1: "Top-1",
    top5: "Top-5",
    mrr: "MRR",
    vectorDeferred: "Local semantic search stays off until this gate passes.",
    buildVectorIndex: "Update local semantic index",
    vectorIndexed: "Local index evaluated",
    vectorRolloutActive: "Semantic rollout active",
    outputs: "Expected outputs",
    recipe: "Delivery steps",
    inbox: "New requirements",
    inboxHint: "High-confidence requirement files not already linked to a delivery appear here.",
    inboxEmpty: "No unmatched high-confidence requirement.",
    ready: "Ready for workflow matching",
    inspect: "Review delivery plan",
    match: "Recommended workflow",
    similarCases: "Similar confirmed cases",
    facts: "Requirement facts",
    missing: "Missing critical information",
    planReady: "All required facts were found. The delivery plan can be confirmed.",
    planBlocked: "Execution stays blocked until these facts are supplied.",
    profileBlocked: "This workflow still needs required input fields configured before it can create a task.",
    outputPath: "Planned output path",
    saveVersion: "Save new version",
    disableProfile: "Disable",
    disabledProfile: "Disabled",
    createTask: "Create delivery task",
    runs: "Delivery runs",
    runsHint: "Each run is pinned to one workflow version and keeps its planned outputs and validation evidence.",
    noRuns: "No delivery task has been created from this source.",
    openTask: "Open task",
    validate: "Validate outputs",
    validationBlockers: "blocking issues",
    validationWarnings: "warnings",
    selectAgent: "Execution agent",
    startExecution: "Start delivery",
    restartExecution: "Start again",
    cancelExecution: "Cancel run",
    retryExecution: "Retry run",
    noAgent: "Register an available agent before starting.",
    executionDetail: "Auto-run",
    executionAttempts: "Execution attempts",
    attempt: "Attempt",
    viewChanges: "View changes",
    compareLastTwo: "Compare latest two",
    comparison: "Attempt comparison",
    changedFiles: "changed files",
    cleanupWorktree: "Clean old worktree",
    cleaned: "Worktree cleaned",
    selectedAttempt: "Selected for validation",
    selectAttempt: "Use this result",
    cleanupConfirm: "Safely clean this old worktree? Dirty or unmerged work will be preserved.",
    leftAttempt: "Earlier",
    rightAttempt: "Later",
    executionStatuses: {
      materializing: "Preparing worktree",
      running: "Running",
      awaiting_approval: "Awaiting approval",
      verifying: "Verifying",
      publishing: "Publishing",
      pr_open: "Pull request open",
      report_posted: "Report ready",
      needs_input: "Needs input",
      plan_proposed: "Plan proposed",
      decomposed: "Tasks decomposed",
      blocked: "Blocked",
      done: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
      unknown: "Unknown",
    },
    accept: "Accept",
    acceptEdits: "Accept with edits",
    reject: "Reject",
    feedbackReason: "Reason",
    feedbackNote: "What changed or went wrong?",
    submitFeedback: "Save feedback",
    cancelFeedback: "Cancel",
    feedbackReviewDraft: "Created from accepted edits",
    changedAfterValidation: "files changed after validation",
    feedbackReasons: {
      content_corrected: "Content corrected",
      structure_adjusted: "Structure adjusted",
      format_adjusted: "Format adjusted",
      missing_information: "Missing information",
      quality_issue: "Quality issue",
      wrong_workflow: "Wrong workflow",
      other: "Other",
    },
    learningStatuses: {
      incorporated: "Added as learning evidence",
      review_required: "Profile draft awaiting review",
      pending_publication: "Will enter learning after publication",
      pending_source_scan: "Waiting for source rescan",
      blocked: "Learning evidence needs attention",
      excluded: "Excluded from learning",
    },
    previewPublication: "Preview publication",
    publicationPreview: "Publication preview",
    publicationHint: "Files are copied from the selected worktree to these project paths. Existing files are never overwritten.",
    publicationConfirm: "I reviewed the target paths and want to publish these files.",
    publishOutputs: "Publish outputs",
    publishedOutputs: "Outputs published",
    publicationConflicts: "target conflicts",
    publicationAvailable: "available",
    runStatus: {
      planned: "Task created",
      executing: "Running",
      ready_for_validation: "Ready to validate",
      execution_failed: "Execution failed",
      execution_attention: "Needs attention",
      execution_cancelled: "Execution cancelled",
      validation_failed: "Validation failed",
      awaiting_acceptance: "Awaiting acceptance",
      accepted: "Accepted",
      rejected: "Rejected",
    },
    error: "The action could not be completed.",
    active: "Active",
    revoked: "Revoked",
    scanFailed: "The last scan failed.",
    scanRecoverable: "Saved checkpoints are available; retry reuses completed files.",
    truncation: "The scan reached its safety bound; narrow the folder before learning.",
    roles: {
      requirement: "Requirement",
      delivery: "Delivery",
      reference: "Reference",
      draft: "Draft",
      unknown: "Unknown",
    },
  },
  zh: {
    title: "交付记忆",
    description: "从已确认的需求和交付文件中，形成可解释、可复用的工作流。",
    back: "返回资产",
    addSource: "添加学习目录",
    chooseFolder: "选择本地目录",
    sourceHint: "系统只读取所选已注册项目内的目录，不会扫描目录之外的文件。",
    project: "项目",
    sourceName: "目录名称",
    relativePath: "项目内子目录",
    rootHint: "留空表示使用整个项目目录。",
    metadata: "只读取文件信息",
    text: "读取受支持的文本内容",
    add: "授权目录",
    sources: "学习目录",
    noSources: "还没有授权任何目录。",
    scan: "立即扫描",
    cancelScan: "取消扫描",
    revoke: "撤销访问",
    deleteData: "删除学习数据",
    deleteConfirm: "删除这个来源的索引、案例、画像和任务记录？原始文件不会被删除。",
    files: "个文件",
    discovered: "已发现",
    skipped: "项已跳过",
    parsed: "已解析",
    parseFailed: "解析失败",
    needsOcr: "扫描型 PDF，需要 OCR",
    parseLimited: "达到安全上限，未解析",
    retryParsing: "重试解析",
    exclude: "排除",
    include: "重新纳入",
    excluded: "已从学习中排除",
    excludePrompt: "请输入将这个文件排除出学习范围的原因：",
    reusedParsing: "未变化复用",
    lastScan: "最近扫描",
    never: "尚未扫描",
    review: "确认文件角色",
    reviewHint: "系统会建议文件是需求、交付、资料还是草稿，并解释原因；确认后才能作为学习证据。",
    noArtifacts: "请先扫描该目录以发现受支持文件。",
    confidence: "置信度",
    confirm: "确认",
    confirmVisible: "批量确认当前建议",
    changed: "文件已发生变化，需要重新确认",
    reason: "判断依据",
    untrusted: "检测到类似指令的文字。请将文件视为不可信输入并在使用前复核。",
    pairs: "需求 → 交付案例",
    pairsHint: "只确认你认可的对应关系；有歧义的配对不会被自动学习。",
    noPairs: "没有待确认的配对建议。",
    createCase: "确认案例",
    confirmedCases: "已确认学习案例",
    archiveCase: "撤销案例",
    restoreCase: "恢复案例",
    archiveCasePrompt: "请输入撤销这个学习案例的原因：",
    restoreCaseConfirm: "确认将这个案例恢复为可信学习证据？",
    profiles: "工作流画像",
    profilesHint: "三个已确认的成功案例可形成正式画像，少于三个会标记为试用画像。",
    profileName: "工作流名称",
    derive: "生成画像",
    rebuildDraft: "重新生成草稿",
    profileDrafts: "待审核画像草稿",
    publishDraft: "审核并发布",
    draftImpact: "影响预览",
    noProfileChanges: "未发现结构变化。",
    noProfiles: "还没有工作流画像。",
    routineLibrary: "日常工作类型",
    routineLibraryHint: "查看系统从历史工作中学到的流程，调整步骤后，再明确启用为可复用任务。",
    routineCandidate: "发现的日常工作",
    routineDefinitionCandidate: "需要审核",
    routineDraft: "待你审核",
    routinePublished: "已启用",
    routineDisabled: "已停用",
    routineSuperseded: "已被新版本替代",
    noRoutineCandidates: "尚未发现稳定的日常工作，请先确认至少三个可比较案例。",
    createRoutineDraft: "审核这个工作类型",
    routineName: "工作类型名称",
    routineDescription: "这项工作要产出什么",
    routineTrigger: "收到什么后开始",
    routineSteps: "工作步骤",
    routineStepKind: "步骤用途",
    routineStepDetails: "参考资料、输出、台账、条件或确认要求",
    routineSaveBeforePublish: "请先保存最新修改，再启用这个工作类型。",
    routineConditionRequired: "请说明符合什么业务条件时执行此步骤。",
    mandatoryStep: "每次都做",
    conditionalStep: "符合条件时做",
    historicalCases: "个已确认案例",
    saveRoutineDraft: "保存审核结果",
    addRoutineStep: "增加步骤",
    removeRoutineStep: "删除",
    moveEarlier: "上移",
    moveLater: "下移",
    publishRoutineConfirm: "我已检查触发条件、步骤、输出、台账和人工确认点。",
    publishRoutine: "启用这个工作类型",
    newRoutineVersion: "创建新版本",
    disableRoutine: "不再创建新任务",
    manageRoutine: "版本与启用状态",
    routineEvidenceChanged: "历史证据已变化，请刷新相关案例后再启用。",
    routineSourceRevoked: "来源目录访问权限已失效，请恢复权限后再启用。",
    routinePatternChanged: "系统已发现更新的工作模式，请审核新的建议后再启用。",
    routineRecoveryRefresh: "请刷新来源目录，并重新确认受影响的案例。",
    routineEvidenceSupport: (support: number, total: number) =>
      `${total} 个已确认案例中有 ${support} 个包含此步骤。`,
    routineErrors: {
      insufficient_confirmed_business_cases: "请先确认至少三个可比较案例，再重试。",
      routine_discovery_evidence_changed: "请刷新并重新确认发生变化的历史案例，再审核这个工作类型。",
      routine_definition_revision_conflict: "这个工作类型已在其他页面被修改，请刷新后再编辑。",
      routine_step_condition_required: "请补充条件步骤的业务判断条件，然后重新保存。",
      routine_definition_evidence_not_valid: "请刷新并重新确认受影响的历史案例，再启用这个工作类型。",
      routine_definition_source_revoked: "请先恢复来源目录的访问权限，再修改这个工作类型。",
      routine_definition_publication_confirmation_required: "请审核工作类型并勾选确认后再启用。",
    },
    routineStepKinds: {
      extract: "读取询价信息",
      retrieve: "检索参考资料",
      generate: "准备输出文件",
      ledger_upsert: "更新台账",
      human_approval: "人工确认",
      condition: "判断业务条件",
      create_issue: "移交后续工作",
    },
    routineTriggerTypes: {
      inquiry: "询价单",
      quotation: "报价单",
      order: "订单",
    },
    routineStepConfiguration: {
      extract: "需要读取的字段",
      retrieve: "参考资料来源",
      generate: "需要生成的输出",
      ledger_upsert: "台账及字段对应关系",
      human_approval: "人工确认要求",
      condition: "业务判断条件",
      create_issue: "后续工作移交对象",
    },
    trial: "试用",
    established: "正式",
    evidenceCases: "个证据案例",
    learningQuality: "学习质量",
    qualityTrusted: "可信",
    qualityReview: "需复核",
    qualityBlocked: "已阻断",
    qualitySignals: {
      missing_requirement: "缺少需求文件",
      missing_delivery: "缺少交付文件",
      missing_artifact: "证据文件缺失",
      artifact_unavailable: "证据文件不可用",
      artifact_excluded: "证据文件已排除",
      evidence_changed: "确认后证据发生变化",
      content_not_fully_parsed: "部分内容尚未解析",
      parsing_attention_required: "部分文件需要处理解析问题",
      roles_not_fully_confirmed: "部分文件角色尚未确认",
      low_pairing_confidence: "需求和交付可能不是同一案例",
    },
    retrievalEvaluation: "检索质量",
    retrievalEvaluationHint: "检查已知需求能否检索到同一工作流家族中的其他案例。",
    retrievalPassed: "基线保护通过",
    retrievalRegressed: "发现检索回退",
    retrievalInsufficient: "需要更多已确认案例",
    retrievalSamples: "个样本",
    top1: "Top-1",
    top5: "Top-5",
    mrr: "MRR",
    vectorDeferred: "通过此门禁前不会启用本地语义检索。",
    buildVectorIndex: "更新本地语义索引",
    vectorIndexed: "本地索引已评测",
    vectorRolloutActive: "语义检索灰度已启用",
    outputs: "预期交付",
    recipe: "交付步骤",
    inbox: "新需求",
    inboxHint: "尚未关联交付、且判断置信度较高的需求文件会出现在这里。",
    inboxEmpty: "没有未匹配的高置信度需求。",
    ready: "可以进入工作流匹配",
    inspect: "查看交付计划",
    match: "推荐工作流",
    similarCases: "相似已确认案例",
    facts: "需求信息",
    missing: "缺少的关键信息",
    planReady: "必填信息已经齐全，可以确认交付计划。",
    planBlocked: "补充这些信息前，系统不会开始执行。",
    profileBlocked: "这个工作流尚未配置必填输入字段，暂时不能创建交付任务。",
    outputPath: "计划输出目录",
    saveVersion: "保存新版本",
    disableProfile: "停用",
    disabledProfile: "已停用",
    createTask: "创建交付任务",
    runs: "交付任务",
    runsHint: "每次任务固定使用一个工作流版本，并保留计划输出和验收证据。",
    noRuns: "该目录还没有创建交付任务。",
    openTask: "打开任务",
    validate: "验收输出",
    validationBlockers: "个阻断问题",
    validationWarnings: "个警告",
    selectAgent: "执行 Agent",
    startExecution: "开始交付",
    restartExecution: "重新开始",
    cancelExecution: "取消执行",
    retryExecution: "重试执行",
    noAgent: "请先注册一个可用 Agent，再开始执行。",
    executionDetail: "自动执行",
    executionAttempts: "执行记录",
    attempt: "第",
    viewChanges: "查看改动",
    compareLastTwo: "对比最近两次",
    comparison: "执行对比",
    changedFiles: "个变更文件",
    cleanupWorktree: "清理旧工作树",
    cleaned: "工作树已清理",
    selectedAttempt: "已选为验收结果",
    selectAttempt: "采用此结果",
    cleanupConfirm: "安全清理这个旧工作树？如有未提交或未合并内容，系统会拒绝并保留文件。",
    leftAttempt: "较早尝试",
    rightAttempt: "较新尝试",
    executionStatuses: {
      materializing: "正在准备工作树",
      running: "执行中",
      awaiting_approval: "等待审批",
      verifying: "正在验证",
      publishing: "正在发布",
      pr_open: "拉取请求已创建",
      report_posted: "报告已生成",
      needs_input: "需要补充信息",
      plan_proposed: "方案等待确认",
      decomposed: "任务已拆解",
      blocked: "已阻塞",
      done: "已完成",
      failed: "执行失败",
      cancelled: "已取消",
      unknown: "未知状态",
    },
    accept: "符合预期",
    acceptEdits: "修改后符合",
    reject: "不符合预期",
    feedbackReason: "原因分类",
    feedbackNote: "具体修改了什么，或哪里不符合？",
    submitFeedback: "保存反馈",
    cancelFeedback: "取消",
    feedbackReviewDraft: "由“修改后符合”生成",
    changedAfterValidation: "个文件在验收后发生修改",
    feedbackReasons: {
      content_corrected: "修正内容",
      structure_adjusted: "调整结构",
      format_adjusted: "调整格式",
      missing_information: "信息缺失",
      quality_issue: "质量问题",
      wrong_workflow: "工作流不匹配",
      other: "其他",
    },
    learningStatuses: {
      incorporated: "已加入学习证据",
      review_required: "画像草稿等待审核",
      pending_publication: "发布后再纳入学习",
      pending_source_scan: "等待重新扫描来源",
      blocked: "学习证据需要处理",
      excluded: "不纳入学习",
    },
    previewPublication: "预览发布",
    publicationPreview: "发布预览",
    publicationHint: "文件将从已选工作树复制到这些项目路径；已有文件绝不会被覆盖。",
    publicationConfirm: "我已核对目标路径，并确认发布这些文件。",
    publishOutputs: "确认发布",
    publishedOutputs: "交付文件已发布",
    publicationConflicts: "个目标冲突",
    publicationAvailable: "可发布",
    runStatus: {
      planned: "任务已创建",
      executing: "执行中",
      ready_for_validation: "可以验收",
      execution_failed: "执行失败",
      execution_attention: "需要处理",
      execution_cancelled: "执行已取消",
      validation_failed: "验收未通过",
      awaiting_acceptance: "等待确认",
      accepted: "已接受",
      rejected: "已拒绝",
    },
    error: "操作未能完成。",
    active: "已授权",
    revoked: "已撤销",
    scanFailed: "最近一次扫描失败。",
    scanRecoverable: "已保留扫描检查点；重试时会复用已完成文件。",
    truncation: "扫描达到安全上限，请缩小目录范围后再学习。",
    roles: {
      requirement: "需求",
      delivery: "交付",
      reference: "参考资料",
      draft: "草稿",
      unknown: "待识别",
    },
  },
} as const;

export function WorkflowMemoryView() {
  const { i18n } = useAppTranslation();
  const copy = COPY[i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en"];
  const { data: consoleState } = useConsoleState();
  const refreshConsoleState = useRefreshConsoleState();
  const projects = consoleState?.projects?.filter((project) => project.status !== "archived") ?? [];
  const setSection = useUiStore((state) => state.setSection);
  const setSelectedWorkItemId = useUiStore((state) => state.setSelectedWorkItemId);
  const setSelectedWorktreeId = useUiStore((state) => state.setSelectedWorktreeId);
  const queryClient = useQueryClient();

  const sourcesQuery = useQuery({
    queryKey: ["workflow-memory", "sources"],
    queryFn: () => workflowApi.listWorkflowSources(),
  });
  const sources = sourcesQuery.data?.sources ?? [];
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const selectedSource = sources.find((source) => source.id === selectedSourceId) ?? sources[0] ?? null;
  const activeSourceId = selectedSource?.id ?? "";

  const [projectId, setProjectId] = useState("");
  const effectiveProjectId = projectId || consoleState?.currentProjectId || projects[0]?.id || "";
  const [sourceName, setSourceName] = useState("");
  const [relativePath, setRelativePath] = useState("");
  const [readMode, setReadMode] = useState<WorkflowSource["readMode"]>("metadata");
  const [profileName, setProfileName] = useState("");
  const [roleDrafts, setRoleDrafts] = useState<Record<string, WorkflowArtifactRole>>({});
  const [pairDrafts, setPairDrafts] = useState<Record<string, string>>({});
  const [selectedInboxArtifactId, setSelectedInboxArtifactId] = useState("");
  const [runAgentIds, setRunAgentIds] = useState<Record<string, string>>({});
  const [attemptComparison, setAttemptComparison] = useState<{
    runId: string;
    left: { number: number; diff: WorktreeDiffSnapshot };
    right: { number: number; diff: WorktreeDiffSnapshot };
  } | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState<{
    runId: string;
    feedback: "accepted_with_edits" | "rejected";
    reasonCode: WorkflowFeedbackReason;
    note: string;
  } | null>(null);
  const [publicationConfirmations, setPublicationConfirmations] = useState<Record<string, boolean>>({});
  const [routinePublishConfirmations, setRoutinePublishConfirmations] = useState<Record<string, boolean>>({});
  const [pendingAction, setPendingAction] = useState("");
  const [error, setError] = useState<string | null>(null);

  const artifactsQuery = useQuery({
    queryKey: ["workflow-memory", "artifacts", activeSourceId],
    queryFn: () => workflowApi.listWorkflowArtifacts({ sourceId: activeSourceId }),
    enabled: Boolean(activeSourceId),
  });
  const pairsQuery = useQuery({
    queryKey: ["workflow-memory", "pairs", activeSourceId],
    queryFn: () => workflowApi.workflowPairProposals(activeSourceId),
    enabled: Boolean(activeSourceId),
  });
  const casesQuery = useQuery({
    queryKey: ["workflow-memory", "cases", activeSourceId],
    queryFn: () => workflowApi.listDeliveryCases(activeSourceId),
    enabled: Boolean(activeSourceId),
  });
  const profilesQuery = useQuery({
    queryKey: ["workflow-memory", "profiles"],
    queryFn: () => workflowApi.listWorkflowProfiles(),
  });
  const retrievalEvaluationQuery = useQuery({
    queryKey: ["workflow-memory", "retrieval-evaluation", activeSourceId],
    queryFn: () => workflowApi.evaluateWorkflowRetrieval(activeSourceId),
    enabled: Boolean(activeSourceId),
  });
  const profileDraftsQuery = useQuery({
    queryKey: ["workflow-memory", "profile-drafts"],
    queryFn: () => workflowApi.listWorkflowProfileDrafts(),
  });
  const routineCandidatesQuery = useQuery({
    queryKey: ["workflow-memory", "business-routine-candidates", activeSourceId],
    queryFn: () => workflowApi.listBusinessRoutineCandidates(activeSourceId),
    enabled: Boolean(activeSourceId),
  });
  const routineDefinitionsQuery = useQuery({
    queryKey: ["workflow-memory", "business-routine-definitions", activeSourceId],
    queryFn: () => workflowApi.listBusinessRoutineDefinitions(activeSourceId),
    enabled: Boolean(activeSourceId),
  });
  const inboxQuery = useQuery({
    queryKey: ["workflow-memory", "inbox", activeSourceId],
    queryFn: () => workflowApi.listWorkflowInbox(activeSourceId),
    enabled: Boolean(activeSourceId),
  });
  const runsQuery = useQuery({
    queryKey: ["workflow-memory", "runs"],
    queryFn: () => workflowApi.listWorkflowRuns(),
    refetchInterval: (query) =>
      query.state.data?.runs.some((run) => run.status === "executing") ? 2_000 : false,
  });
  const matchesQuery = useQuery({
    queryKey: ["workflow-memory", "matches", selectedInboxArtifactId],
    queryFn: () => workflowApi.matchWorkflowProfiles(selectedInboxArtifactId),
    enabled: Boolean(selectedInboxArtifactId),
  });
  const topMatch = matchesQuery.data?.matches[0] ?? null;
  const inspectionQuery = useQuery({
    queryKey: ["workflow-memory", "inspection", selectedInboxArtifactId, topMatch?.profile.id],
    queryFn: () => workflowApi.inspectWorkflowRequirement(selectedInboxArtifactId, topMatch!.profile.id),
    enabled: Boolean(selectedInboxArtifactId && topMatch?.profile.id),
  });

  const artifacts = artifactsQuery.data?.artifacts ?? [];
  const cases = casesQuery.data?.cases ?? [];
  const activeCases = useMemo(
    () => cases.filter((deliveryCase) => deliveryCase.state === "confirmed"),
    [cases],
  );
  const profiles = (profilesQuery.data?.profiles ?? []).filter((profile) =>
    profile.sourceId === activeSourceId && !profile.supersededByProfileId && profile.state !== "archived");
  const profileDrafts = (profileDraftsQuery.data?.drafts ?? []).filter((draft) =>
    draft.sourceId === activeSourceId && draft.state === "draft");
  const routineDefinitions = routineDefinitionsQuery.data?.routineDefinitions ?? [];
  const primaryRoutineDefinition = routineDefinitions
    .slice()
    .sort((left, right) => {
      const priority = { draft: 5, candidate: 4, published: 3, disabled: 2, superseded: 1 };
      return priority[right.state] - priority[left.state] || right.version - left.version;
    })[0] ?? null;
  const routineCandidates = (routineCandidatesQuery.data?.candidates ?? []).filter((candidate) =>
    candidate.state === "candidate"
    && !routineDefinitions.some((definition) =>
      definition.discoveryCandidateId === candidate.id && definition.state !== "superseded"));
  const availableAgents = (consoleState?.agents ?? []).filter((agent) =>
    agent.status !== "disabled"
    && agent.status !== "unavailable"
    && agent.health?.status !== "unhealthy");
  const selectedAgentIdFor = (run: { id: string; projectId: string }) => {
    const requested = runAgentIds[run.id]
      || projects.find((project) => project.id === run.projectId)?.defaultAgentId
      || "";
    return availableAgents.some((agent) => agent.id === requested)
      ? requested
      : availableAgents[0]?.id ?? "";
  };
  const assignedRequirements = useMemo(
    () => new Set(activeCases.flatMap((deliveryCase) => deliveryCase.requirementArtifactIds)),
    [activeCases],
  );
  const assignedDeliveries = useMemo(
    () => new Set(activeCases.flatMap((deliveryCase) => deliveryCase.deliveryArtifactIds)),
    [activeCases],
  );
  const pairProposals = (pairsQuery.data?.proposals ?? [])
    .map((proposal) => ({
      ...proposal,
      candidates: proposal.candidates.filter((candidate) => !assignedDeliveries.has(candidate.delivery.id)),
    }))
    .filter((proposal) => !assignedRequirements.has(proposal.requirement.id) && proposal.candidates.length > 0);

  async function refreshSourceData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "sources"] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "artifacts"] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "pairs"] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "cases"] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "profiles"] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "retrieval-evaluation"] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "profile-drafts"] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "business-routine-candidates"] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "business-routine-definitions"] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "inbox"] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "matches"] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "inspection"] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "runs"] }),
    ]);
  }

  async function runAction(key: string, action: () => Promise<unknown>) {
    setPendingAction(key);
    setError(null);
    try {
      await action();
      await refreshSourceData();
    } catch (caught) {
      const routineError = caught instanceof ApiError
        ? copy.routineErrors[caught.code as keyof typeof copy.routineErrors]
        : null;
      setError(routineError ?? (caught instanceof Error ? caught.message : copy.error));
    } finally {
      setPendingAction("");
    }
  }

  const addSource = () => {
    if (!effectiveProjectId) return;
    void runAction("add-source", async () => {
      const result = await workflowApi.createWorkflowSource({
        projectId: effectiveProjectId,
        relativePath: relativePath.trim(),
        readMode,
        name: sourceName.trim() || undefined,
      });
      setSelectedSourceId(result.source.id);
      setSourceName("");
      setRelativePath("");
    });
  };

  const chooseFolder = () => {
    const picker = window.myagenttoolDesktop?.pickWorkflowSourceFolder;
    if (!picker) return;
    void runAction("pick-folder", async () => {
      const selection = await picker();
      if (!selection) return;
      const match = longestProjectRoot(selection.absolutePath, projects);
      if (match) {
        setProjectId(match.projectId);
        setRelativePath(match.relativePath);
      } else {
        const result = await workflowApi.bindProject({
          repoPath: selection.absolutePath,
          name: selection.name,
        }) as { project?: { id: string } };
        if (!result.project?.id) throw new Error(copy.error);
        setProjectId(result.project.id);
        setRelativePath("");
        await refreshConsoleState();
      }
      setSourceName(selection.name);
    });
  };

  const confirmRole = (artifact: WorkflowArtifact) => {
    const role = roleDrafts[artifact.id] ?? artifact.role;
    void runAction(`artifact-${artifact.id}`, () =>
      workflowApi.confirmWorkflowArtifact(artifact.id, { role, expectedRevision: artifact.revision }));
  };

  const confirmVisibleRoles = () => {
    const pendingArtifacts = artifacts
      .slice(0, 200)
      .filter((artifact) =>
        !artifact.exclusion
        && (artifact.confirmationState !== "confirmed"
          || (roleDrafts[artifact.id] != null && roleDrafts[artifact.id] !== artifact.role)));
    void runAction("confirm-visible", async () => {
      for (let index = 0; index < pendingArtifacts.length; index += 8) {
        await Promise.all(pendingArtifacts.slice(index, index + 8).map((artifact) =>
          workflowApi.confirmWorkflowArtifact(artifact.id, {
            role: roleDrafts[artifact.id] ?? artifact.role,
            expectedRevision: artifact.revision,
          })));
      }
    });
  };

  const confirmPair = (proposal: WorkflowPairProposal) => {
    const candidate = proposal.candidates.find((item) =>
      item.delivery.id === pairDrafts[proposal.requirement.id]) ?? proposal.candidates[0];
    if (!candidate) return;
    void runAction(`pair-${proposal.requirement.id}`, () =>
      workflowApi.createDeliveryCase({
        sourceId: activeSourceId,
        requirementArtifactIds: [proposal.requirement.id],
        deliveryArtifactIds: [candidate.delivery.id],
      }));
  };

  const deriveProfile = () => {
    if (!activeCases.length) return;
    void runAction("derive-profile", () =>
      workflowApi.deriveWorkflowProfile({
        name: profileName.trim() || undefined,
        caseIds: activeCases.map((deliveryCase) => deliveryCase.id),
      }));
  };

  const compareLatestAttempts = (run: WorkflowRun) => {
    const inspectable = (run.executionAttempts ?? []).filter((attempt) =>
      attempt.worktreeId && attempt.cleanup?.state !== "cleaned");
    const [left, right] = inspectable.slice(-2);
    if (!left?.worktreeId || !right?.worktreeId) return;
    void runAction(`compare-${run.id}`, async () => {
      const [leftDiff, rightDiff] = await Promise.all([
        workflowApi.worktreeDiff(left.worktreeId!),
        workflowApi.worktreeDiff(right.worktreeId!),
      ]);
      setAttemptComparison({
        runId: run.id,
        left: { number: left.number, diff: leftDiff },
        right: { number: right.number, diff: rightDiff },
      });
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-3 sm:p-6">
      <header className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="sm" onClick={() => setSection("documents")}>
          <ArrowLeft /> {copy.back}
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <BrainCircuit className="size-6 text-primary" />
            <h1 className="text-xl font-semibold">{copy.title}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
        </div>
      </header>

      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">{copy.addSource}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">{copy.sourceHint}</p>
              {window.myagenttoolDesktop?.pickWorkflowSourceFolder ? (
                <Button className="w-full" variant="secondary" disabled={pendingAction === "pick-folder"} onClick={chooseFolder}>
                  {pendingAction === "pick-folder" ? <Loader2 className="animate-spin" /> : <FolderSearch />}
                  {copy.chooseFolder}
                </Button>
              ) : null}
              <Field label={copy.project}>
                <Select value={effectiveProjectId} onChange={(event) => setProjectId(event.target.value)}>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </Select>
              </Field>
              <Field label={copy.sourceName}>
                <Input value={sourceName} onChange={(event) => setSourceName(event.target.value)} />
              </Field>
              <Field label={copy.relativePath} hint={copy.rootHint}>
                <Input value={relativePath} onChange={(event) => setRelativePath(event.target.value)} placeholder="客户项目/历史案例" />
              </Field>
              <Select value={readMode} onChange={(event) => setReadMode(event.target.value as WorkflowSource["readMode"])}>
                <option value="metadata">{copy.metadata}</option>
                <option value="supported_text">{copy.text}</option>
              </Select>
              <Button className="w-full" disabled={!effectiveProjectId || pendingAction === "add-source"} onClick={addSource}>
                {pendingAction === "add-source" ? <Loader2 className="animate-spin" /> : <FolderSearch />}
                {copy.add}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">{copy.sources}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {sources.length === 0 ? <p className="text-sm text-muted-foreground">{copy.noSources}</p> : sources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => setSelectedSourceId(source.id)}
                  className={cn(
                    "w-full rounded-md border p-3 text-left",
                    source.id === activeSourceId ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{source.name}</span>
                    <Badge tone={source.state === "active" ? "success" : "neutral"}>
                      {source.state === "active" ? copy.active : copy.revoked}
                    </Badge>
                  </span>
                  <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                    {source.relativePath || "."}
                  </span>
                  <span className="mt-2 block text-xs text-muted-foreground">
                    {source.fileCount} {copy.files} · {source.skippedCount} {copy.skipped}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
        </aside>

        <main className="min-w-0 space-y-4">
          {!selectedSource ? (
            <Card className="border-dashed">
              <CardContent className="grid min-h-60 place-items-center text-center text-sm text-muted-foreground">
                <div><FolderSearch className="mx-auto mb-2 size-8" /><p>{copy.noSources}</p></div>
              </CardContent>
            </Card>
          ) : (
            <>
              <SourceSummary
                source={selectedSource}
                copy={copy}
                pendingAction={pendingAction}
                onScan={() => void runAction("scan", () => workflowApi.scanWorkflowSource(selectedSource.id))}
                onCancel={() => void runAction("cancel-scan", () => workflowApi.cancelWorkflowSourceScan(selectedSource.id))}
                onRevoke={() => void runAction("revoke", () => workflowApi.revokeWorkflowSource(selectedSource.id, selectedSource.revision))}
                onDelete={() => {
                  if (!window.confirm(copy.deleteConfirm)) return;
                  void runAction("delete-source", () =>
                    workflowApi.deleteWorkflowSourceLearning(selectedSource.id, selectedSource.revision));
                }}
              />

              <RoutineSetupGuide
                source={selectedSource}
                candidate={routineCandidates[0] ?? null}
                definition={primaryRoutineDefinition}
                artifacts={artifacts}
                pending={pendingAction === "scan"
                  || pendingAction.startsWith("routine-candidate-")}
                onScan={() => void runAction(
                  "scan",
                  () => workflowApi.scanWorkflowSource(selectedSource.id),
                )}
                onCreateDraft={(candidateId) => void runAction(
                  `routine-candidate-${candidateId}`,
                  () => workflowApi.createBusinessRoutineDraft(candidateId),
                )}
              />

              <SectionCard title={copy.inbox} hint={copy.inboxHint} icon={FileQuestion}>
                {(inboxQuery.data?.artifacts ?? []).length === 0
                  ? <Empty text={copy.inboxEmpty} />
                  : <div className="grid gap-2 sm:grid-cols-2">
                    {(inboxQuery.data?.artifacts ?? []).map((artifact) => (
                      <div key={artifact.id} className="rounded-md border border-primary/30 bg-primary/5 p-3">
                        <p className="truncate text-sm font-medium">{artifact.name}</p>
                        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{artifact.relativePath}</p>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="flex items-center gap-1 text-xs text-primary"><Sparkles className="size-3" /> {copy.ready}</p>
                          <Button size="sm" variant="secondary" onClick={() => setSelectedInboxArtifactId(artifact.id)}>
                            {copy.inspect}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>}
                {selectedInboxArtifactId ? (
                  <RequirementPlan
                    copy={copy}
                    loading={matchesQuery.isLoading || inspectionQuery.isLoading}
                    match={topMatch}
                    similarCases={matchesQuery.data?.similarCases ?? []}
                    inspection={inspectionQuery.data ?? null}
                    pending={pendingAction === "create-run"}
                    onCreate={(answers) => {
                      if (!topMatch) return;
                      void runAction("create-run", () => workflowApi.createWorkflowRun({
                        artifactId: selectedInboxArtifactId,
                        profileId: topMatch.profile.id,
                        answers,
                      }));
                    }}
                  />
                ) : null}
              </SectionCard>

              <SectionCard id="workflow-file-review" title={copy.review} hint={copy.reviewHint} icon={FileCheck2}>
                {artifacts.length === 0 ? <Empty text={copy.noArtifacts} /> : (
                  <>
                    <div className="mb-3 flex justify-end">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={
                          pendingAction === "confirm-visible"
                          || !artifacts.slice(0, 200).some((artifact) =>
                            artifact.confirmationState !== "confirmed"
                            || (roleDrafts[artifact.id] != null && roleDrafts[artifact.id] !== artifact.role))
                        }
                        onClick={confirmVisibleRoles}
                      >
                        {pendingAction === "confirm-visible" ? <Loader2 className="animate-spin" /> : <Check />}
                        {copy.confirmVisible}
                      </Button>
                    </div>
                    <div className="divide-y divide-border overflow-hidden rounded-md border">
                      {artifacts.slice(0, 200).map((artifact) => {
                      const role = roleDrafts[artifact.id] ?? artifact.role;
                      const actionPending = pendingAction === `artifact-${artifact.id}`;
                      const parsePending = pendingAction === `parse-${artifact.id}`;
                      return (
                        <div key={artifact.id} className="grid gap-2 p-3 md:grid-cols-[minmax(0,1fr)_10rem_auto] md:items-center">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{artifact.name}</p>
                            <p className="truncate font-mono text-[10px] text-muted-foreground">{artifact.relativePath}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {copy.confidence} {Math.round((artifact.roleInference?.confidence ?? 0) * 100)}%
                              {" · "}{copy.reason}: {(artifact.roleInference?.reasons ?? []).slice(0, 3).join(", ")}
                            </p>
                            {artifact.roleInference?.riskSignals?.includes("instruction_like_content") ? (
                              <p className="mt-1 flex items-center gap-1 text-xs text-warning">
                                <AlertTriangle className="size-3" /> {copy.untrusted}
                              </p>
                            ) : null}
                            {artifact.confirmationState === "changed" ? (
                              <p className="mt-1 text-xs text-warning">{copy.changed}</p>
                            ) : null}
                            {artifact.exclusion ? (
                              <p className="mt-1 text-xs text-warning">
                                {copy.excluded}: {artifact.exclusion.reason}
                              </p>
                            ) : null}
                            {artifact.extraction?.state === "needs_ocr" ? (
                              <p className="mt-1 text-xs text-warning">{copy.needsOcr}</p>
                            ) : artifact.extraction?.state === "failed" ? (
                              <p className="mt-1 text-xs text-destructive">
                                {copy.parseFailed}: {artifact.extraction.errorCode}
                              </p>
                            ) : artifact.extraction?.state === "limited" ? (
                              <p className="mt-1 text-xs text-warning">{copy.parseLimited}</p>
                            ) : artifact.extraction?.state === "ready" ? (
                              <p className="mt-1 text-xs text-success">
                                {copy.parsed} · {artifact.extraction.characterCount ?? 0}
                              </p>
                            ) : null}
                          </div>
                          <Select
                            aria-label={`${artifact.name} role`}
                            value={role}
                            onChange={(event) => setRoleDrafts((current) => ({
                              ...current,
                              [artifact.id]: event.target.value as WorkflowArtifactRole,
                            }))}
                          >
                            {ROLES.map((value) => <option key={value} value={value}>{copy.roles[value]}</option>)}
                          </Select>
                          <div className="flex flex-wrap gap-1">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={actionPending || parsePending}
                              onClick={() => {
                                if (artifact.exclusion) {
                                  void runAction(
                                    `exclude-${artifact.id}`,
                                    () => workflowApi.setWorkflowArtifactExclusion(artifact.id, {
                                      expectedRevision: artifact.revision,
                                      excluded: false,
                                    }),
                                  );
                                  return;
                                }
                                const reason = window.prompt(copy.excludePrompt)?.trim();
                                if (!reason) return;
                                void runAction(
                                  `exclude-${artifact.id}`,
                                  () => workflowApi.setWorkflowArtifactExclusion(artifact.id, {
                                    expectedRevision: artifact.revision,
                                    excluded: true,
                                    reason,
                                  }),
                                );
                              }}
                            >
                              {artifact.exclusion ? copy.include : copy.exclude}
                            </Button>
                            {artifact.extraction?.state === "failed" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={actionPending || parsePending}
                                onClick={() => void runAction(
                                  `parse-${artifact.id}`,
                                  () => workflowApi.retryWorkflowArtifactExtraction(artifact.id, artifact.revision),
                                )}
                              >
                                {parsePending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                                {copy.retryParsing}
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant={artifact.confirmationState === "confirmed" && role === artifact.role ? "secondary" : "primary"}
                              disabled={actionPending || parsePending || Boolean(artifact.exclusion)}
                              onClick={() => confirmRole(artifact)}
                            >
                              {actionPending ? <Loader2 className="animate-spin" /> : <Check />}
                              {copy.confirm}
                            </Button>
                          </div>
                        </div>
                      );
                      })}
                    </div>
                  </>
                )}
              </SectionCard>

              <SectionCard title={copy.pairs} hint={copy.pairsHint} icon={ShieldCheck}>
                {pairProposals.length === 0 ? <Empty text={copy.noPairs} /> : (
                  <div className="space-y-2">
                    {pairProposals.map((proposal) => {
                      const candidate = proposal.candidates.find((item) =>
                        item.delivery.id === pairDrafts[proposal.requirement.id]) ?? proposal.candidates[0];
                      return (
                        <div key={proposal.requirement.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_auto_1fr_auto] md:items-center">
                          <ArtifactMini artifact={proposal.requirement} role={copy.roles.requirement} />
                          <span className="text-muted-foreground">→</span>
                          <div>
                            <ArtifactMini
                              artifact={candidate.delivery}
                              role={`${copy.roles.delivery} · ${Math.round(candidate.score * 100)}%`}
                            />
                            {proposal.candidates.length > 1 ? (
                              <Select
                                className="mt-2"
                                aria-label={`${proposal.requirement.name} delivery`}
                                value={candidate.delivery.id}
                                onChange={(event) => setPairDrafts((current) => ({
                                  ...current,
                                  [proposal.requirement.id]: event.target.value,
                                }))}
                              >
                                {proposal.candidates.map((option) => (
                                  <option key={option.delivery.id} value={option.delivery.id}>
                                    {option.delivery.name} · {Math.round(option.score * 100)}%
                                  </option>
                                ))}
                              </Select>
                            ) : null}
                          </div>
                          <Button
                            size="sm"
                            disabled={pendingAction === `pair-${proposal.requirement.id}`}
                            onClick={() => confirmPair(proposal)}
                          >
                            {pendingAction === `pair-${proposal.requirement.id}` ? <Loader2 className="animate-spin" /> : <Check />}
                            {copy.createCase}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {cases.length ? (
                  <div className="mt-4 border-t pt-3">
                    <p className="mb-2 text-xs font-semibold">{copy.confirmedCases}</p>
                    <div className="space-y-2">
                      {cases.map((deliveryCase) => {
                        const requirementNames = deliveryCase.requirementArtifactIds.map((id) =>
                          artifacts.find((artifact) => artifact.id === id)?.name ?? id);
                        const deliveryNames = deliveryCase.deliveryArtifactIds.map((id) =>
                          artifacts.find((artifact) => artifact.id === id)?.name ?? id);
                        const action = deliveryCase.state === "confirmed" ? "archive" : "restore";
                        return (
                          <div key={deliveryCase.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs">
                            <div className="min-w-0 flex-1">
                              <p className="truncate">
                                {requirementNames.join(", ")} → {deliveryNames.join(", ")}
                              </p>
                              {deliveryCase.qualityAssessment ? (
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  {qualityIssueText(deliveryCase.qualityAssessment, copy)}
                                </p>
                              ) : null}
                            </div>
                            {deliveryCase.qualityAssessment ? (
                              <QualityBadge quality={deliveryCase.qualityAssessment} copy={copy} />
                            ) : null}
                            <Badge tone={deliveryCase.state === "confirmed" ? "success" : "neutral"}>
                              {deliveryCase.state === "confirmed" ? copy.active : copy.archiveCase}
                            </Badge>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pendingAction === `case-${deliveryCase.id}`}
                              onClick={() => {
                                let reason = "Restored after evidence review.";
                                if (action === "archive") {
                                  const entered = window.prompt(copy.archiveCasePrompt);
                                  if (!entered?.trim()) return;
                                  reason = entered.trim();
                                } else if (!window.confirm(copy.restoreCaseConfirm)) {
                                  return;
                                }
                                void runAction(`case-${deliveryCase.id}`, () =>
                                  workflowApi.changeDeliveryCaseState(deliveryCase.id, action, {
                                    expectedRevision: deliveryCase.revision,
                                    reason,
                                  }));
                              }}
                            >
                              {pendingAction === `case-${deliveryCase.id}` ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                              {action === "archive" ? copy.archiveCase : copy.restoreCase}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </SectionCard>

              <SectionCard
                title={copy.retrievalEvaluation}
                hint={copy.retrievalEvaluationHint}
                icon={GitCompareArrows}
              >
                {retrievalEvaluationQuery.isLoading ? (
                  <Loader2 className="animate-spin text-muted-foreground" />
                ) : retrievalEvaluationQuery.data ? (
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <Badge tone={
                      retrievalEvaluationQuery.data.gate.status === "passed"
                        ? "success"
                        : retrievalEvaluationQuery.data.gate.status === "regressed"
                          ? "danger"
                          : "warning"
                    }>
                      {retrievalEvaluationQuery.data.gate.status === "passed"
                        ? copy.retrievalPassed
                        : retrievalEvaluationQuery.data.gate.status === "regressed"
                          ? copy.retrievalRegressed
                          : copy.retrievalInsufficient}
                    </Badge>
                    <span>
                      {retrievalEvaluationQuery.data.current.sampleCount} {copy.retrievalSamples}
                    </span>
                    <span>{copy.top1}: {formatRate(retrievalEvaluationQuery.data.current.top1)}</span>
                    <span>{copy.top5}: {formatRate(retrievalEvaluationQuery.data.current.top5)}</span>
                    <span>{copy.mrr}: {formatRate(retrievalEvaluationQuery.data.current.mrr)}</span>
                    {retrievalEvaluationQuery.data.retrieval.vector.state !== "not_configured" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pendingAction === "index-embeddings"}
                        onClick={() => void runAction(
                          "index-embeddings",
                          () => workflowApi.indexWorkflowSourceEmbeddings(activeSourceId),
                        )}
                      >
                        {pendingAction === "index-embeddings" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                        {copy.buildVectorIndex}
                      </Button>
                    ) : null}
                    {retrievalEvaluationQuery.data.retrieval.vector.state === "rollout_active" ? (
                      <span className="text-success">{copy.vectorRolloutActive}</span>
                    ) : retrievalEvaluationQuery.data.retrieval.vector.state === "evaluated" ? (
                      <span className="text-muted-foreground">{copy.vectorIndexed}</span>
                    ) : null}
                    {!retrievalEvaluationQuery.data.gate.embeddingEligible ? (
                      <p className="basis-full text-muted-foreground">{copy.vectorDeferred}</p>
                    ) : null}
                  </div>
                ) : (
                  <Empty text={copy.retrievalInsufficient} />
                )}
              </SectionCard>

              <SectionCard id="workflow-routine-library" title={copy.routineLibrary} hint={copy.routineLibraryHint} icon={Sparkles}>
                {routineCandidatesQuery.isLoading || routineDefinitionsQuery.isLoading ? (
                  <Loader2 className="animate-spin text-muted-foreground" />
                ) : routineCandidates.length === 0 && routineDefinitions.length === 0 ? (
                  <Empty text={copy.noRoutineCandidates} />
                ) : (
                  <div className="space-y-3">
                    {routineCandidates.map((candidate) => (
                      <RoutineCandidateCard
                        key={candidate.id}
                        candidate={candidate}
                        copy={copy}
                        pending={pendingAction === `routine-candidate-${candidate.id}`}
                        onCreateDraft={() => void runAction(
                          `routine-candidate-${candidate.id}`,
                          () => workflowApi.createBusinessRoutineDraft(candidate.id),
                        )}
                      />
                    ))}
                    {routineDefinitions
                      .slice()
                      .sort((left, right) => right.version - left.version)
                      .map((definition) => (
                        <RoutineDefinitionCard
                          key={`${definition.id}:${definition.revision}`}
                          definition={definition}
                          copy={copy}
                          pending={pendingAction === `routine-definition-${definition.id}`}
                          publishConfirmed={routinePublishConfirmations[definition.id] === true}
                          onPublishConfirmed={(confirmed) => setRoutinePublishConfirmations((current) => ({
                            ...current,
                            [definition.id]: confirmed,
                          }))}
                          onSave={(draft) => void runAction(
                            `routine-definition-${definition.id}`,
                            () => workflowApi.updateBusinessRoutineDefinition(definition.id, {
                              expectedRevision: definition.revision,
                              ...draft,
                            }),
                          )}
                          onPublish={() => void runAction(
                            `routine-definition-${definition.id}`,
                            () => workflowApi.publishBusinessRoutineDefinition(
                              definition.id,
                              definition.revision,
                              routinePublishConfirmations[definition.id] === true,
                            ),
                          )}
                          onNewVersion={() => void runAction(
                            `routine-definition-${definition.id}`,
                            () => workflowApi.createBusinessRoutineDefinitionVersion(
                              definition.id,
                              definition.revision,
                            ),
                          )}
                          onDisable={() => void runAction(
                            `routine-definition-${definition.id}`,
                            () => workflowApi.disableBusinessRoutineDefinition(
                              definition.id,
                              definition.revision,
                            ),
                          )}
                        />
                      ))}
                  </div>
                )}
              </SectionCard>

              <SectionCard title={copy.profiles} hint={copy.profilesHint} icon={BrainCircuit}>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Input className="min-w-48 flex-1" value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder={copy.profileName} />
                  <Button disabled={activeCases.length === 0 || pendingAction === "derive-profile"} onClick={deriveProfile}>
                    {pendingAction === "derive-profile" ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    {copy.derive}
                  </Button>
                </div>
                {profiles.length === 0 ? <Empty text={copy.noProfiles} /> : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {profiles.map((profile) => (
                      <ProfileCard
                        key={profile.id}
                        profile={profile}
                        copy={copy}
                        pending={pendingAction === `revise-${profile.id}`}
                        draftPending={pendingAction === `draft-${profile.id}`}
                        onRevise={(pathTemplate) => void runAction(`revise-${profile.id}`, () =>
                          workflowApi.reviseWorkflowProfile(profile.id, {
                            expectedRevision: profile.revision,
                            outcomeSpec: { ...profile.outcomeSpec, pathTemplate },
                          }))}
                        onDisable={() => void runAction(`revise-${profile.id}`, () =>
                          workflowApi.reviseWorkflowProfile(profile.id, {
                            expectedRevision: profile.revision,
                            state: "disabled",
                          }))}
                        onDraft={() => void runAction(`draft-${profile.id}`, () =>
                          workflowApi.createWorkflowProfileDraft(profile.id, {
                            expectedRevision: profile.revision,
                          }))}
                      />
                    ))}
                  </div>
                )}
                {profileDrafts.length ? (
                  <div className="mt-4 border-t pt-3">
                    <p className="mb-2 text-xs font-semibold">{copy.profileDrafts}</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      {profileDrafts.map((draft) => (
                        <ProfileDraftCard
                          key={draft.id}
                          draft={draft}
                          copy={copy}
                          pending={pendingAction === `publish-draft-${draft.id}`}
                          onPublish={() => void runAction(`publish-draft-${draft.id}`, () =>
                            workflowApi.publishWorkflowProfileDraft(draft.id, draft.revision))}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </SectionCard>

              <SectionCard title={copy.runs} hint={copy.runsHint} icon={RefreshCw}>
                {(runsQuery.data?.runs ?? []).filter((run) => run.sourceId === activeSourceId).length === 0
                  ? <Empty text={copy.noRuns} />
                  : <div className="space-y-2">
                    {(runsQuery.data?.runs ?? []).filter((run) => run.sourceId === activeSourceId).map((run) => (
                      <div key={run.id} className="rounded-md border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="min-w-0 flex-1 truncate text-sm font-medium">
                            {run.plannedOutputs.map((output) => output.relativePath).join(", ")}
                          </p>
                          <Badge tone={
                            ["accepted", "ready_for_validation"].includes(run.status)
                              ? "success"
                              : ["validation_failed", "execution_failed", "rejected"].includes(run.status)
                                ? "danger"
                                : "neutral"
                          }>
                            {copy.runStatus[run.status]}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">v{run.profileVersion} · {new Date(run.createdAt).toLocaleString()}</p>
                        {run.execution ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {copy.executionDetail}: {executionStatusLabel(copy, run.execution.status)}
                            {run.execution.agentId
                              ? ` · ${availableAgents.find((agent) => agent.id === run.execution?.agentId)?.name ?? run.execution.agentId}`
                              : ""}
                          </p>
                        ) : null}
                        {run.execution?.error ? (
                          <p className="mt-1 text-xs text-destructive">{run.execution.error}</p>
                        ) : null}
                        {(run.executionAttempts ?? []).length ? (
                          <details className="mt-2 rounded-md bg-muted/40 px-3 py-2">
                            <summary className="cursor-pointer text-xs font-medium">
                              {copy.executionAttempts} · {run.executionAttempts!.length}
                            </summary>
                            <div className="mt-2 space-y-2">
                              {run.executionAttempts!.map((attempt) => (
                                <div key={attempt.autoRunId} className="flex flex-wrap items-center gap-2 rounded border bg-background p-2 text-xs text-muted-foreground">
                                  <div className="min-w-0 flex-1">
                                    <span className="font-medium text-foreground">
                                      {copy.attempt}{copy === COPY.zh ? attempt.number : ` ${attempt.number}`}
                                    </span>
                                    <span className="ml-2">{executionStatusLabel(copy, attempt.status)}</span>
                                    {attempt.retryCount ? <span> · retry × {attempt.retryCount}</span> : null}
                                    {attempt.agentId ? (
                                      <span>
                                        {" · "}{availableAgents.find((agent) => agent.id === attempt.agentId)?.name ?? attempt.agentId}
                                      </span>
                                    ) : null}
                                    {attempt.startedAt ? <span> · {new Date(attempt.startedAt).toLocaleString()}</span> : null}
                                  </div>
                                  {attempt.cleanup?.state === "cleaned" ? (
                                    <Badge tone="neutral">{copy.cleaned}</Badge>
                                  ) : attempt.worktreeId ? (
                                    <>
                                      {run.selectedAttemptNumber === attempt.number ? (
                                        <Badge tone="success">{copy.selectedAttempt}</Badge>
                                      ) : ["done", "pr_open", "report_posted"].includes(attempt.status)
                                        && !["accepted", "rejected"].includes(run.status) ? (
                                          <Button
                                            size="sm"
                                            variant="secondary"
                                            disabled={pendingAction === `select-${run.id}-${attempt.number}`}
                                            onClick={() => void runAction(
                                              `select-${run.id}-${attempt.number}`,
                                              () => workflowApi.selectWorkflowRunAttempt(
                                                run.id,
                                                attempt.number,
                                                run.revision,
                                              ),
                                            )}
                                          >
                                            {pendingAction === `select-${run.id}-${attempt.number}`
                                              ? <Loader2 className="animate-spin" />
                                              : <Check />}
                                            {copy.selectAttempt}
                                          </Button>
                                        ) : null}
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => {
                                          setSelectedWorktreeId(attempt.worktreeId);
                                          setSection("projects");
                                        }}
                                      >
                                        <Eye /> {copy.viewChanges}
                                      </Button>
                                      {attempt.autoRunId !== run.execution?.autoRunId
                                        && run.selectedAttemptNumber !== attempt.number ? (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          disabled={pendingAction === `cleanup-${run.id}-${attempt.number}`}
                                          onClick={() => {
                                            if (!window.confirm(copy.cleanupConfirm)) return;
                                            void runAction(`cleanup-${run.id}-${attempt.number}`, async () => {
                                              await workflowApi.cleanupWorkflowRunAttemptWorktree(
                                                run.id,
                                                attempt.number,
                                                run.revision,
                                              );
                                              await refreshConsoleState();
                                              if (attemptComparison?.runId === run.id) setAttemptComparison(null);
                                            });
                                          }}
                                        >
                                          {pendingAction === `cleanup-${run.id}-${attempt.number}`
                                            ? <Loader2 className="animate-spin" />
                                            : <Trash2 />}
                                          {copy.cleanupWorktree}
                                        </Button>
                                      ) : null}
                                    </>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                            {(run.executionAttempts ?? []).filter((attempt) =>
                              attempt.worktreeId && attempt.cleanup?.state !== "cleaned").length >= 2 ? (
                              <Button
                                className="mt-2"
                                size="sm"
                                variant="secondary"
                                disabled={pendingAction === `compare-${run.id}`}
                                onClick={() => compareLatestAttempts(run)}
                              >
                                {pendingAction === `compare-${run.id}`
                                  ? <Loader2 className="animate-spin" />
                                  : <GitCompareArrows />}
                                {copy.compareLastTwo}
                              </Button>
                            ) : null}
                          </details>
                        ) : null}
                        {attemptComparison?.runId === run.id ? (
                          <AttemptComparison copy={copy} comparison={attemptComparison} />
                        ) : null}
                        {run.validationResults.length ? (
                          <div className="mt-2 space-y-1">
                            {run.validationSummary ? (
                              <p className="text-xs font-medium">
                                v{run.validationSummary.validatorVersion}
                                {" · "}{run.validationSummary.blockerCount} {copy.validationBlockers}
                                {" · "}{run.validationSummary.warningCount} {copy.validationWarnings}
                              </p>
                            ) : null}
                            {run.validationResults.map((result) => (
                              <div
                                key={result.id ?? result.criterion}
                                className={cn(
                                  "rounded border-l-2 px-2 py-1 text-xs",
                                  result.status === "passed"
                                    ? "border-success text-success"
                                    : result.status === "warning"
                                      ? "border-warning text-warning"
                                      : "border-destructive text-destructive",
                                )}
                              >
                                <p>
                                  {result.status === "passed" ? "✓" : result.status === "warning" ? "!" : "×"}
                                  {" "}{result.criterion}
                                </p>
                                {result.file || result.note ? (
                                  <p className="mt-0.5 text-[10px] opacity-80">
                                    {result.file ? `${result.file} · ` : ""}{result.note}
                                  </p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {run.feedback ? (
                          <div className="mt-2 rounded-md border bg-muted/30 p-2 text-xs">
                            <p className="font-medium">
                              {run.feedback.learning
                                ? copy.learningStatuses[run.feedback.learning.status]
                                : run.feedback.state}
                            </p>
                            {run.feedback.outputDiff?.comparisonAvailable ? (
                              <p className="mt-1 text-muted-foreground">
                                {run.feedback.outputDiff.changedFileCount} {copy.changedAfterValidation}
                              </p>
                            ) : null}
                            {run.feedback.reasonCode ? (
                              <p className="mt-1 text-muted-foreground">
                                {copy.feedbackReasons[run.feedback.reasonCode]}
                              </p>
                            ) : null}
                            {run.feedback.note ? (
                              <p className="mt-1 text-muted-foreground">{run.feedback.note}</p>
                            ) : null}
                          </div>
                        ) : null}
                        {run.publication ? (
                          <div className={cn(
                            "mt-2 rounded-md border p-3 text-xs",
                            run.publication.state === "published"
                              ? "border-success/40 bg-success/5"
                              : run.publication.conflictCount
                                ? "border-destructive/40 bg-destructive/5"
                                : "border-primary/30 bg-primary/5",
                          )}>
                            <p className="font-medium">
                              {run.publication.state === "published"
                                ? copy.publishedOutputs
                                : copy.publicationPreview}
                            </p>
                            <p className="mt-1 text-muted-foreground">{copy.publicationHint}</p>
                            {run.publication.attemptNumber != null ? (
                              <p className="mt-1 text-muted-foreground">
                                {copy.attempt} {run.publication.attemptNumber}
                              </p>
                            ) : null}
                            <div className="mt-2 space-y-1">
                              {run.publication.files.map((file) => (
                                <div
                                  key={file.relativePath}
                                  className="flex items-center justify-between gap-3 rounded bg-background/70 px-2 py-1"
                                >
                                  <span className="min-w-0 truncate font-mono">
                                    {file.relativePath} · {file.bytes.toLocaleString()} B
                                  </span>
                                  <span className={file.targetState === "conflict"
                                    ? "text-destructive"
                                    : "text-success"}
                                  >
                                    {file.targetState === "conflict"
                                      ? file.conflictType
                                      : copy.publicationAvailable}
                                  </span>
                                </div>
                              ))}
                            </div>
                            {run.publication.conflictCount ? (
                              <p className="mt-2 text-destructive">
                                {run.publication.conflictCount} {copy.publicationConflicts}
                              </p>
                            ) : null}
                            {run.publication.state === "previewed" ? (
                              <label className="mt-3 flex items-start gap-2">
                                <input
                                  className="mt-0.5"
                                  type="checkbox"
                                  aria-label={`${copy.publicationConfirm}: ${run.id}`}
                                  checked={Boolean(publicationConfirmations[run.id])}
                                  onChange={(event) => setPublicationConfirmations((current) => ({
                                    ...current,
                                    [run.id]: event.target.checked,
                                  }))}
                                />
                                <span>{copy.publicationConfirm}</span>
                              </label>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" variant="secondary" onClick={() => {
                            setSelectedWorkItemId(run.workItemId);
                            setSection("task");
                          }}>{copy.openTask}</Button>
                          {["planned", "execution_cancelled"].includes(run.status) ? (
                            <>
                              {availableAgents.length ? (
                                <Select
                                  aria-label={`${copy.selectAgent}: ${run.id}`}
                                  className="h-8 min-w-40 text-xs"
                                  value={selectedAgentIdFor(run)}
                                  onChange={(event) => setRunAgentIds((current) => ({
                                    ...current,
                                    [run.id]: event.target.value,
                                  }))}
                                >
                                  {availableAgents.map((agent) => (
                                    <option key={agent.id} value={agent.id}>
                                      {agent.name}{agent.health?.status ? ` · ${agent.health.status}` : ""}
                                    </option>
                                  ))}
                                </Select>
                              ) : <span className="self-center text-xs text-warning">{copy.noAgent}</span>}
                              <Button
                                size="sm"
                                disabled={!availableAgents.length || pendingAction === `execute-${run.id}`}
                                onClick={() => {
                                  const agentId = selectedAgentIdFor(run);
                                  if (!agentId) return;
                                  void runAction(`execute-${run.id}`, () => workflowApi.executeWorkflowRun(run.id, {
                                    expectedRevision: run.revision,
                                    agentId,
                                  }));
                                }}
                              >
                                {pendingAction === `execute-${run.id}` ? <Loader2 className="animate-spin" /> : <Play />}
                                {run.status === "execution_cancelled" ? copy.restartExecution : copy.startExecution}
                              </Button>
                            </>
                          ) : null}
                          {run.status === "executing" ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={pendingAction === `cancel-execution-${run.id}`}
                              onClick={() => void runAction(
                                `cancel-execution-${run.id}`,
                                () => workflowApi.cancelWorkflowRunExecution(run.id, run.revision),
                              )}
                            >
                              {pendingAction === `cancel-execution-${run.id}` ? <Loader2 className="animate-spin" /> : <XIcon />}
                              {copy.cancelExecution}
                            </Button>
                          ) : null}
                          {run.status === "execution_failed" ? (
                            <Button
                              size="sm"
                              disabled={pendingAction === `retry-execution-${run.id}`}
                              onClick={() => void runAction(
                                `retry-execution-${run.id}`,
                                () => workflowApi.retryWorkflowRunExecution(run.id, run.revision),
                              )}
                            >
                              {pendingAction === `retry-execution-${run.id}` ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                              {copy.retryExecution}
                            </Button>
                          ) : null}
                          {["planned", "ready_for_validation", "validation_failed"].includes(run.status) ? (
                            <Button
                              size="sm"
                              disabled={pendingAction === `validate-${run.id}`}
                              onClick={() => void runAction(`validate-${run.id}`, () => workflowApi.validateWorkflowRun(run.id, run.revision))}
                            >
                              {pendingAction === `validate-${run.id}` ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                              {copy.validate}
                            </Button>
                          ) : null}
                          {run.status === "awaiting_acceptance" ? (
                            <>
                              <Button size="sm" onClick={() => void runAction(`feedback-${run.id}`, () => workflowApi.recordWorkflowRunFeedback(run.id, { expectedRevision: run.revision, feedback: "accepted" }))}>{copy.accept}</Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setFeedbackDraft({
                                  runId: run.id,
                                  feedback: "accepted_with_edits",
                                  reasonCode: "content_corrected",
                                  note: "",
                                })}
                              >
                                {copy.acceptEdits}
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setFeedbackDraft({
                                  runId: run.id,
                                  feedback: "rejected",
                                  reasonCode: "quality_issue",
                                  note: "",
                                })}
                              >
                                {copy.reject}
                              </Button>
                            </>
                          ) : null}
                          {[
                            "ready_for_validation",
                            "validation_failed",
                            "execution_failed",
                            "execution_attention",
                          ].includes(run.status) ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => setFeedbackDraft({
                                runId: run.id,
                                feedback: "rejected",
                                reasonCode: "quality_issue",
                                note: "",
                              })}
                            >
                              {copy.reject}
                            </Button>
                          ) : null}
                          {run.status === "accepted"
                          && (
                            run.feedback?.learning?.status === "pending_publication"
                            || Boolean(run.publication)
                          )
                          && !["published", "publishing"].includes(run.publication?.state ?? "") ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={pendingAction === `publication-preview-${run.id}`}
                              onClick={() => void runAction(
                                `publication-preview-${run.id}`,
                                () => workflowApi.previewWorkflowRunPublication(run.id, run.revision),
                              )}
                            >
                              {pendingAction === `publication-preview-${run.id}`
                                ? <Loader2 className="animate-spin" />
                                : <Eye />}
                              {copy.previewPublication}
                            </Button>
                          ) : null}
                          {["previewed", "publishing"].includes(run.publication?.state ?? "") ? (
                            <Button
                              size="sm"
                              disabled={
                                (run.publication?.state === "previewed"
                                  && !publicationConfirmations[run.id])
                                || pendingAction === `publish-${run.id}`
                              }
                              onClick={() => void runAction(`publish-${run.id}`, async () => {
                                await workflowApi.publishWorkflowRunOutputs(run.id, {
                                  expectedRevision: run.revision,
                                  publicationId: run.publication!.id,
                                  confirmed: true,
                                });
                                setPublicationConfirmations((current) => ({
                                  ...current,
                                  [run.id]: false,
                                }));
                              })}
                            >
                              {pendingAction === `publish-${run.id}`
                                ? <Loader2 className="animate-spin" />
                                : <FileCheck2 />}
                              {copy.publishOutputs}
                            </Button>
                          ) : null}
                        </div>
                        {feedbackDraft?.runId === run.id ? (
                          <div className="mt-3 space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3">
                            <label className="block text-xs font-medium">
                              {copy.feedbackReason}
                              <Select
                                className="mt-1"
                                aria-label={`${copy.feedbackReason}: ${run.id}`}
                                value={feedbackDraft.reasonCode}
                                onChange={(event) => setFeedbackDraft({
                                  ...feedbackDraft,
                                  reasonCode: event.target.value as WorkflowFeedbackReason,
                                })}
                              >
                                {FEEDBACK_REASONS.map((reason) => (
                                  <option key={reason} value={reason}>
                                    {copy.feedbackReasons[reason]}
                                  </option>
                                ))}
                              </Select>
                            </label>
                            <label className="block text-xs font-medium">
                              {copy.feedbackNote}
                              <textarea
                                className="mt-1 min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
                                aria-label={`${copy.feedbackNote}: ${run.id}`}
                                maxLength={5_000}
                                value={feedbackDraft.note}
                                onChange={(event) => setFeedbackDraft({
                                  ...feedbackDraft,
                                  note: event.target.value,
                                })}
                              />
                            </label>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                disabled={
                                  !feedbackDraft.note.trim()
                                  || pendingAction === `feedback-${run.id}`
                                }
                                onClick={() => void runAction(`feedback-${run.id}`, async () => {
                                  await workflowApi.recordWorkflowRunFeedback(run.id, {
                                    expectedRevision: run.revision,
                                    feedback: feedbackDraft.feedback,
                                    reasonCode: feedbackDraft.reasonCode,
                                    note: feedbackDraft.note.trim(),
                                  });
                                  setFeedbackDraft(null);
                                })}
                              >
                                {pendingAction === `feedback-${run.id}`
                                  ? <Loader2 className="animate-spin" />
                                  : <Check />}
                                {copy.submitFeedback}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setFeedbackDraft(null)}>
                                {copy.cancelFeedback}
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>}
              </SectionCard>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function longestProjectRoot(
  absolutePath: string,
  projects: Array<{ id: string; git?: { repoPath?: string | null }; path?: string }>,
) {
  const windows = /^[a-z]:[\\/]/i.test(absolutePath);
  const normalize = (value: string) => {
    const normalized = value.replaceAll("\\", "/").replace(/\/+$/g, "");
    return windows ? normalized.toLowerCase() : normalized;
  };
  const selected = normalize(absolutePath);
  const candidates = projects.flatMap((project) => {
    const root = project.path ?? project.git?.repoPath;
    if (!root) return [];
    const normalizedRoot = normalize(root);
    if (selected !== normalizedRoot && !selected.startsWith(`${normalizedRoot}/`)) return [];
    return [{ projectId: project.id, root: normalizedRoot }];
  }).sort((left, right) => right.root.length - left.root.length);
  const match = candidates[0];
  if (!match) return null;
  return {
    projectId: match.projectId,
    relativePath: selected === match.root ? "" : selected.slice(match.root.length + 1),
  };
}

function SourceSummary({
  source,
  copy,
  pendingAction,
  onScan,
  onCancel,
  onRevoke,
  onDelete,
}: {
  source: WorkflowSource;
  copy: typeof COPY.en | typeof COPY.zh;
  pendingAction: string;
  onScan: () => void;
  onCancel: () => void;
  onRevoke: () => void;
  onDelete: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{source.name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {copy.lastScan}: {source.lastScanAt ? new Date(source.lastScanAt).toLocaleString() : copy.never}
          </p>
          {source.scanState === "scanning" && source.scanProgress ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {source.scanProgress.scannedEntries} {copy.files} · {copy.discovered} {source.scanProgress.discovered}
              {" · "}{copy.parsed} {source.scanProgress.parsed}
              {source.scanProgress.reused ? ` · ${copy.reusedParsing} ${source.scanProgress.reused}` : ""}
              {source.scanProgress.parseFailed ? ` · ${copy.parseFailed} ${source.scanProgress.parseFailed}` : ""}
            </p>
          ) : null}
          {source.scanState === "ready" && (source.parsedCount || source.parseFailedCount) ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {copy.parsed} {source.parsedCount ?? 0}
              {source.reusedCount ? ` · ${copy.reusedParsing} ${source.reusedCount}` : ""}
              {source.parseFailedCount ? ` · ${copy.parseFailed} ${source.parseFailedCount}` : ""}
            </p>
          ) : null}
          {source.scanState === "failed" ? (
            <p className="mt-1 text-xs text-destructive">
              {copy.scanFailed}{source.recoveryAvailable ? ` ${copy.scanRecoverable}` : ""}
            </p>
          ) : null}
          {source.truncated ? <p className="mt-1 text-xs text-warning">{copy.truncation}</p> : null}
        </div>
        <Badge tone="neutral">{source.readMode === "metadata" ? copy.metadata : copy.text}</Badge>
        {pendingAction === "scan" || source.scanState === "scanning" ? (
          <Button size="sm" variant="secondary" disabled={pendingAction === "cancel-scan"} onClick={onCancel}>
            {pendingAction === "cancel-scan" ? <Loader2 className="animate-spin" /> : <XIcon />}
            {copy.cancelScan}
          </Button>
        ) : (
          <Button size="sm" disabled={source.state !== "active"} onClick={onScan}>
            <RefreshCw />
            {copy.scan}
          </Button>
        )}
        <Button size="sm" variant="secondary" disabled={source.state !== "active" || pendingAction === "revoke"} onClick={onRevoke}>
          {copy.revoke}
        </Button>
        {source.state === "revoked" ? (
          <Button size="sm" variant="destructive" disabled={pendingAction === "delete-source"} onClick={onDelete}>
            {copy.deleteData}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SectionCard({
  id,
  title,
  hint,
  icon: Icon,
  children,
}: {
  id?: string;
  title: string;
  hint: string;
  icon: typeof BrainCircuit;
  children: React.ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Icon className="size-4 text-primary" /> {title}</CardTitle>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      {children}
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{text}</p>;
}

function executionStatusLabel(
  copy: typeof COPY.en | typeof COPY.zh,
  status: string,
) {
  return (copy.executionStatuses as Record<string, string>)[status] ?? status;
}

function AttemptComparison({
  copy,
  comparison,
}: {
  copy: typeof COPY.en | typeof COPY.zh;
  comparison: {
    left: { number: number; diff: WorktreeDiffSnapshot };
    right: { number: number; diff: WorktreeDiffSnapshot };
  };
}) {
  const leftFiles = new Set(comparison.left.diff.files.map((file) => file.path));
  const rightFiles = new Set(comparison.right.diff.files.map((file) => file.path));
  const paths = [...new Set([...leftFiles, ...rightFiles])].sort().slice(0, 200);
  const fileDiff = (diff: string, path: string) => {
    const section = diff.split(/^diff --git /m).find((candidate) =>
      candidate.startsWith(`a/${path} b/${path}\n`)
      || candidate.includes(`\n+++ b/${path}\n`)
      || candidate.includes(`\n--- a/${path}\n`));
    return section ? `diff --git ${section}`.slice(0, 20_000) : "";
  };
  return (
    <div className="mt-3 overflow-hidden rounded-md border">
      <div className="border-b bg-muted/40 px-3 py-2 text-xs font-semibold">{copy.comparison}</div>
      <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] text-xs">
        <div className="border-b px-3 py-2 text-muted-foreground">
          {paths.length} {copy.changedFiles}
        </div>
        <div className="border-b border-l px-2 py-2 text-center font-medium">
          {copy.leftAttempt} #{comparison.left.number}
        </div>
        <div className="border-b border-l px-2 py-2 text-center font-medium">
          {copy.rightAttempt} #{comparison.right.number}
        </div>
        {paths.map((path) => (
          <div key={path} className="contents">
            <div className="truncate border-b px-3 py-2 font-mono" title={path}>{path}</div>
            <div className="border-b border-l px-2 py-2 text-center">
              {leftFiles.has(path) ? "✓" : "—"}
            </div>
            <div className="border-b border-l px-2 py-2 text-center">
              {rightFiles.has(path) ? "✓" : "—"}
            </div>
          </div>
        ))}
      </div>
      <div className="divide-y">
        {paths.map((path) => {
          const left = fileDiff(comparison.left.diff.diff, path);
          const right = fileDiff(comparison.right.diff.diff, path);
          if (!left && !right) return null;
          return (
            <details key={`diff:${path}`} className="px-3 py-2 text-xs">
              <summary className="cursor-pointer truncate font-mono">{path}</summary>
              <div className="mt-2 grid gap-2 lg:grid-cols-2">
                <pre className="max-h-80 overflow-auto rounded bg-muted/50 p-2 text-[10px]">
                  {left || "—"}
                </pre>
                <pre className="max-h-80 overflow-auto rounded bg-muted/50 p-2 text-[10px]">
                  {right || "—"}
                </pre>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function ArtifactMini({ artifact, role }: { artifact: WorkflowArtifact; role: string }) {
  return (
    <div className="min-w-0">
      <Badge tone="neutral">{role}</Badge>
      <p className="mt-1 truncate text-sm font-medium">{artifact.name}</p>
      <p className="truncate font-mono text-[10px] text-muted-foreground">{artifact.relativePath}</p>
    </div>
  );
}

function qualityStatusLabel(
  quality: WorkflowLearningQuality,
  copy: typeof COPY.en | typeof COPY.zh,
) {
  if (quality.status === "trusted") return copy.qualityTrusted;
  if (quality.status === "blocked") return copy.qualityBlocked;
  return copy.qualityReview;
}

function formatRate(value: number | null) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function qualityIssueText(
  quality: WorkflowLearningQuality,
  copy: typeof COPY.en | typeof COPY.zh,
) {
  const signalCopy = copy.qualitySignals as Record<string, string>;
  const issues = [...quality.blockers, ...quality.warnings]
    .map((signal) => signalCopy[signal] ?? signal)
    .slice(0, 2);
  return issues.length ? issues.join(" · ") : qualityStatusLabel(quality, copy);
}

function QualityBadge({
  quality,
  copy,
}: {
  quality: WorkflowLearningQuality;
  copy: typeof COPY.en | typeof COPY.zh;
}) {
  return (
    <Badge
      tone={quality.status === "trusted" ? "success" : quality.status === "blocked" ? "danger" : "warning"}
      title={qualityIssueText(quality, copy)}
    >
      {copy.learningQuality} {Math.round(quality.score * 100)}% · {qualityStatusLabel(quality, copy)}
    </Badge>
  );
}

function RoutineCandidateCard({
  candidate,
  copy,
  pending,
  onCreateDraft,
}: {
  candidate: BusinessRoutineDiscoveryCandidate;
  copy: typeof COPY.en | typeof COPY.zh;
  pending: boolean;
  onCreateDraft: () => void;
}) {
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{copy.routineCandidate}</p>
          <p className="text-sm font-semibold">{candidate.name}</p>
        </div>
        <Badge tone={candidate.evidenceHealth.state === "valid" ? "success" : "danger"}>
          {Math.round(candidate.confidence * 100)}%
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {candidate.confirmedCaseIds.length} {copy.historicalCases}
      </p>
      <ol className="mt-3 space-y-2">
        {candidate.steps.map((step, index) => (
          <li key={step.key} className="flex items-start gap-2 text-sm">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px]">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-medium">{step.label}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {step.requirement === "mandatory" ? copy.mandatoryStep : copy.conditionalStep}
                {" · "}{Math.round(step.coverage * 100)}%
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {copy.routineEvidenceSupport(step.supportCaseIds.length, candidate.confirmedCaseIds.length)}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {candidate.evidenceHealth.state !== "valid" ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {copy.routineEvidenceChanged}
        </p>
      ) : null}
      <Button
        className="mt-3"
        size="sm"
        disabled={pending || candidate.evidenceHealth.state !== "valid"}
        onClick={onCreateDraft}
      >
        {pending ? <Loader2 className="animate-spin" /> : <Eye />}
        {copy.createRoutineDraft}
      </Button>
    </div>
  );
}

function resequenceRoutineSteps(steps: BusinessRoutineStep[]) {
  return steps.map((step, index) => ({
    ...step,
    dependsOn: index === 0 ? [] : [steps[index - 1].key],
  }));
}

const ROUTINE_CONFIGURATION_KEYS: Record<BusinessRoutineStep["kind"], string> = {
  extract: "fields",
  retrieve: "referenceSources",
  generate: "output",
  ledger_upsert: "ledgerMapping",
  human_approval: "approvalGate",
  condition: "condition",
  create_issue: "handoff",
};

function routineConfigurationValue(step: BusinessRoutineStep) {
  const value = step.configuration[ROUTINE_CONFIGURATION_KEYS[step.kind]]
    ?? step.configuration.note
    ?? "";
  return typeof value === "string" ? value : "";
}

function routineHealthIssueText(
  definition: BusinessRoutineDefinition,
  copy: typeof COPY.en | typeof COPY.zh,
) {
  if (definition.evidenceHealth.issues.some((issue) => issue.includes("Source access"))) {
    return copy.routineSourceRevoked;
  }
  if (definition.evidenceHealth.issues.some((issue) => issue.includes("work pattern"))) {
    return copy.routinePatternChanged;
  }
  if (definition.evidenceHealth.issues.some((issue) => issue.includes("business condition"))) {
    return copy.routineConditionRequired;
  }
  return copy.routineEvidenceChanged;
}

function RoutineDefinitionCard({
  definition,
  copy,
  pending,
  publishConfirmed,
  onPublishConfirmed,
  onSave,
  onPublish,
  onNewVersion,
  onDisable,
}: {
  definition: BusinessRoutineDefinition;
  copy: typeof COPY.en | typeof COPY.zh;
  pending: boolean;
  publishConfirmed: boolean;
  onPublishConfirmed: (confirmed: boolean) => void;
  onSave: (draft: {
    name: string;
    description: string;
    triggerDocumentTypes: BusinessRoutineDefinition["triggerDocumentTypes"];
    steps: BusinessRoutineStep[];
  }) => void;
  onPublish: () => void;
  onNewVersion: () => void;
  onDisable: () => void;
}) {
  const editable = ["candidate", "draft"].includes(definition.state);
  const [name, setName] = useState(definition.name);
  const [description, setDescription] = useState(definition.description);
  const [trigger, setTrigger] = useState(definition.triggerDocumentTypes[0] ?? "inquiry");
  const [steps, setSteps] = useState(definition.steps);
  const stateLabel = definition.state === "candidate"
    ? copy.routineDefinitionCandidate
    : definition.state === "draft"
      ? copy.routineDraft
      : definition.state === "published"
        ? copy.routinePublished
        : definition.state === "disabled"
          ? copy.routineDisabled
          : copy.routineSuperseded;
  const dirty = JSON.stringify({
    name,
    description,
    trigger,
    steps,
  }) !== JSON.stringify({
    name: definition.name,
    description: definition.description,
    trigger: definition.triggerDocumentTypes[0] ?? "inquiry",
    steps: definition.steps,
  });
  const invalidCondition = steps.some((step) =>
    step.kind === "condition" && !routineConfigurationValue(step).trim());
  const markChanged = () => {
    if (publishConfirmed) onPublishConfirmed(false);
  };
  const updateStep = (index: number, patch: Partial<BusinessRoutineStep>) => {
    markChanged();
    setSteps((current) => current.map((step, stepIndex) =>
      stepIndex === index ? { ...step, ...patch } : step));
  };
  const moveStep = (index: number, offset: number) => {
    markChanged();
    setSteps((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return resequenceRoutineSteps(next);
    });
  };
  const removeStep = (index: number) => {
    markChanged();
    setSteps((current) => resequenceRoutineSteps(current.filter((_, stepIndex) => stepIndex !== index)));
  };
  const addStep = () => {
    markChanged();
    const key = `custom_${Date.now()}`;
    setSteps((current) => resequenceRoutineSteps([...current, {
      key,
      kind: "human_approval",
      label: copy.routineStepKinds.human_approval,
      required: true,
      dependsOn: [],
      evidenceRefs: [],
      configuration: { note: "" },
    }]));
  };
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold">{definition.name}</p>
        <Badge tone={definition.state === "published" ? "success" : definition.state === "draft" ? "warning" : "neutral"}>
          {stateLabel} · v{definition.version}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {definition.historicalCaseIds.length} {copy.historicalCases}
      </p>
      {definition.evidenceHealth.state !== "valid" ? (
        <div role="alert" className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          <p>{routineHealthIssueText(definition, copy)}</p>
          <p className="mt-1">{copy.routineRecoveryRefresh}</p>
        </div>
      ) : null}
      {editable ? (
        <div className="mt-3 space-y-3">
          <label className="block text-xs font-medium">
            {copy.routineName}
            <Input
              className="mt-1"
              value={name}
              onChange={(event) => {
                markChanged();
                setName(event.target.value);
              }}
            />
          </label>
          <label className="block text-xs font-medium">
            {copy.routineDescription}
            <textarea
              className="mt-1 min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={description}
              onChange={(event) => {
                markChanged();
                setDescription(event.target.value);
              }}
            />
          </label>
          <label className="block text-xs font-medium">
            {copy.routineTrigger}
            <Select
              className="mt-1"
              value={trigger}
              onChange={(event) => {
                markChanged();
                setTrigger(event.target.value as "inquiry" | "quotation" | "order");
              }}
            >
              {Object.entries(copy.routineTriggerTypes).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </label>
          <div>
            <p className="text-xs font-medium">{copy.routineSteps}</p>
            <div className="mt-1 space-y-2">
              {steps.map((step, index) => (
                <div key={step.key} className="rounded-md border bg-muted/20 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">{index + 1}</span>
                    <Input
                      aria-label={`${copy.routineSteps} ${index + 1}`}
                      className="min-w-44 flex-1"
                      value={step.label}
                      onChange={(event) => updateStep(index, { label: event.target.value })}
                    />
                    <Select
                      aria-label={`${step.label} ${copy.routineStepKind}`}
                      value={step.kind}
                      onChange={(event) => updateStep(index, {
                        kind: event.target.value as BusinessRoutineStep["kind"],
                      })}
                    >
                      {Object.entries(copy.routineStepKinds).map(([kind, label]) => (
                        <option key={kind} value={kind}>{label}</option>
                      ))}
                    </Select>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={step.required}
                        onChange={(event) => updateStep(index, { required: event.target.checked })}
                      />
                      {step.required ? copy.mandatoryStep : copy.conditionalStep}
                    </label>
                  </div>
                  <Input
                    aria-label={`${step.label} ${copy.routineStepConfiguration[step.kind]}`}
                    className="mt-2"
                    value={routineConfigurationValue(step)}
                    placeholder={copy.routineStepConfiguration[step.kind]}
                    onChange={(event) => updateStep(index, {
                      configuration: {
                        ...step.configuration,
                        [ROUTINE_CONFIGURATION_KEYS[step.kind]]: event.target.value,
                      },
                    })}
                  />
                  {step.kind === "condition" && !routineConfigurationValue(step).trim() ? (
                    <p role="alert" className="mt-1 text-xs text-destructive">
                      {copy.routineConditionRequired}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => moveStep(index, -1)}>
                      {copy.moveEarlier}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)}>
                      {copy.moveLater}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={steps.length === 1} onClick={() => removeStep(index)}>
                      {copy.removeRoutineStep}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button className="mt-2" size="sm" variant="secondary" onClick={addStep}>
              {copy.addRoutineStep}
            </Button>
          </div>
          <Button
            size="sm"
            disabled={pending || !dirty || invalidCondition || !name.trim() || !description.trim()
              || steps.some((step) => !step.label.trim())}
            onClick={() => {
              onPublishConfirmed(false);
              onSave({
                name: name.trim(),
                description: description.trim(),
                triggerDocumentTypes: [trigger],
                steps,
              });
            }}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Check />}
            {copy.saveRoutineDraft}
          </Button>
          {definition.state === "draft" ? (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
              {dirty ? (
                <p role="status" className="mb-2 text-xs text-amber-700 dark:text-amber-300">
                  {copy.routineSaveBeforePublish}
                </p>
              ) : null}
              <label className="flex items-start gap-2 text-xs">
                <input
                  className="mt-0.5"
                  type="checkbox"
                  checked={publishConfirmed}
                  disabled={dirty || invalidCondition}
                  onChange={(event) => onPublishConfirmed(event.target.checked)}
                />
                {copy.publishRoutineConfirm}
              </label>
              <Button
                className="mt-2"
                size="sm"
                disabled={pending || dirty || invalidCondition || !publishConfirmed
                  || definition.evidenceHealth.state !== "valid"}
                onClick={onPublish}
              >
                <ShieldCheck /> {copy.publishRoutine}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <p className="mt-3 text-sm text-muted-foreground">{definition.description}</p>
          <ol className="mt-3 space-y-1 text-sm">
            {definition.steps.map((step, index) => (
              <li key={step.key}>
                {index + 1}. {step.label}
                <span className="ml-2 text-xs text-muted-foreground">
                  {step.required ? copy.mandatoryStep : copy.conditionalStep}
                </span>
              </li>
            ))}
          </ol>
          {definition.state === "published" || definition.state === "disabled" ? (
            <details className="mt-3 rounded-md border bg-muted/20 p-2">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                {copy.manageRoutine}
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={pending} onClick={onNewVersion}>
                  <RefreshCw /> {copy.newRoutineVersion}
                </Button>
                {definition.state === "published" ? (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={onDisable}>
                    {copy.disableRoutine}
                  </Button>
                ) : null}
              </div>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

function ProfileCard({
  profile,
  copy,
  pending,
  draftPending,
  onRevise,
  onDisable,
  onDraft,
}: {
  profile: WorkflowProfile;
  copy: typeof COPY.en | typeof COPY.zh;
  pending: boolean;
  draftPending: boolean;
  onRevise: (pathTemplate: string) => void;
  onDisable: () => void;
  onDraft: () => void;
}) {
  const [pathTemplate, setPathTemplate] = useState(profile.outcomeSpec.pathTemplate);
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold">{profile.name}</p>
        <Badge tone={profile.state === "established" ? "success" : "neutral"}>
          {profile.state === "established"
            ? copy.established
            : profile.state === "disabled"
              ? copy.disabledProfile
              : copy.trial}
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        v{profile.profileVersion} · {profile.evidenceCaseIds.length} {copy.evidenceCases}
      </p>
      {profile.learningQuality ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <QualityBadge quality={profile.learningQuality} copy={copy} />
          <span className="text-[10px] text-muted-foreground">
            {qualityIssueText(profile.learningQuality, copy)}
          </span>
        </div>
      ) : null}
      <p className="mt-3 text-xs font-medium">{copy.outputs}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {profile.outcomeSpec.outputs.map((output) => (
          <Badge key={`${output.family}:${output.extension}`} tone="neutral">
            {output.family} · .{output.extension}
          </Badge>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          aria-label={copy.outputPath}
          className="h-8 font-mono text-xs"
          value={pathTemplate}
          onChange={(event) => setPathTemplate(event.target.value)}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || !pathTemplate.trim() || pathTemplate === profile.outcomeSpec.pathTemplate}
          onClick={() => onRevise(pathTemplate.trim())}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          {copy.saveVersion}
        </Button>
      </div>
      {profile.state !== "disabled" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={pending || draftPending} onClick={onDraft}>
            {draftPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {copy.rebuildDraft}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending || draftPending} onClick={onDisable}>
            {copy.disableProfile}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ProfileDraftCard({
  draft,
  copy,
  pending,
  onPublish,
}: {
  draft: WorkflowProfileDraft;
  copy: typeof COPY.en | typeof COPY.zh;
  pending: boolean;
  onPublish: () => void;
}) {
  const changes = [
    ...draft.changes.requirementFields.added.map((value) => `+ field: ${value}`),
    ...draft.changes.requirementFields.removed.map((value) => `− field: ${value}`),
    ...draft.changes.requiredSections.added.map((value) => `+ section: ${value}`),
    ...draft.changes.requiredSections.removed.map((value) => `− section: ${value}`),
    ...(draft.changes.requiredOutcomeFields?.added ?? []).map((value) => `+ output field: ${value}`),
    ...(draft.changes.requiredOutcomeFields?.removed ?? []).map((value) => `− output field: ${value}`),
    ...draft.changes.outputs.added.map((value) => `+ output: ${value}`),
    ...draft.changes.outputs.removed.map((value) => `− output: ${value}`),
  ];
  if (draft.changes.pathTemplate.changed) {
    changes.push(`path: ${draft.changes.pathTemplate.before} → ${draft.changes.pathTemplate.after}`);
  }
  const feedbackTrigger = draft.feedbackTriggers?.at(-1) ?? null;
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold">{draft.proposedProfile.name}</p>
        <Badge tone="warning">v{draft.baseProfileVersion + 1}</Badge>
      </div>
      <p className="mt-2 text-xs font-medium">{copy.draftImpact}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {draft.impact.activeCaseCount} {copy.evidenceCases}
        {" · "}{draft.impact.pendingRequirementCount} {copy.inbox}
      </p>
      {feedbackTrigger ? (
        <div className="mt-2 rounded border border-warning/30 bg-warning/5 p-2 text-xs">
          <p className="font-medium">{copy.feedbackReviewDraft}</p>
          <p className="mt-1 text-muted-foreground">
            {copy.feedbackReasons[feedbackTrigger.reasonCode]}
            {" · "}{feedbackTrigger.outputDiff.changedFileCount} {copy.changedAfterValidation}
          </p>
          <p className="mt-1 text-muted-foreground">{feedbackTrigger.note}</p>
        </div>
      ) : null}
      <div className="mt-2 max-h-28 space-y-1 overflow-auto rounded bg-background p-2 font-mono text-[10px]">
        {changes.length
          ? changes.map((change) => <p key={change}>{change}</p>)
          : <p className="text-muted-foreground">{copy.noProfileChanges}</p>}
      </div>
      <Button className="mt-3" size="sm" disabled={pending} onClick={onPublish}>
        {pending ? <Loader2 className="animate-spin" /> : <Check />}
        {copy.publishDraft}
      </Button>
    </div>
  );
}

function RequirementPlan({
  copy,
  loading,
  match,
  similarCases,
  inspection,
  pending,
  onCreate,
}: {
  copy: typeof COPY.en | typeof COPY.zh;
  loading: boolean;
  match: { profile: WorkflowProfile; score: number; reasons: string[] } | null;
  similarCases: SimilarWorkflowCase[];
  inspection: import("@/lib/api-client").WorkflowRequirementInspection | null;
  pending: boolean;
  onCreate: (answers: Record<string, string>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  if (loading) {
    return <p className="mt-3 flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground"><Loader2 className="animate-spin" /> {copy.inspect}</p>;
  }
  if (!match) return <div className="mt-3"><Empty text={copy.noProfiles} /></div>;
  return (
    <div className="mt-3 space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">{copy.match}</p>
          <p className="text-sm font-semibold">{match.profile.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {match.profile.evidenceCaseIds.length} {copy.evidenceCases}
          </p>
        </div>
        <Badge tone={match.score >= 0.75 ? "success" : "warning"}>{Math.round(match.score * 100)}%</Badge>
      </div>
      {similarCases.length ? (
        <div className="rounded-md border bg-background p-3">
          <p className="text-xs font-semibold">{copy.similarCases}</p>
          <div className="mt-2 space-y-1">
            {similarCases.slice(0, 3).map((candidate) => (
              <p key={candidate.deliveryCase.id} className="text-xs text-muted-foreground">
                {Math.round(candidate.score * 100)}% · {candidate.reasons.join(", ")}
                {" · "}{candidate.deliveryCase.deliveryArtifactIds.length} {copy.outputs}
              </p>
            ))}
          </div>
        </div>
      ) : null}
      {inspection ? (
        <>
          <div>
            <p className="text-xs font-medium">{copy.facts}</p>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {inspection.fields.map((field) => (
                <div key={field.key} className="rounded border bg-background p-2 text-xs">
                  <span className="font-medium">{field.label}</span>
                  <span className={cn("ml-2", field.status === "found" ? "text-success" : "text-warning")}>
                    {field.status === "found" ? field.value : copy.missing}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {inspection.missingFields.length ? (
            <div className="space-y-2 rounded border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
              <p className="font-medium">{copy.missing}</p>
              {inspection.missingFields.map((field) => (
                <label key={field.key} className="block space-y-1">
                  <span>{field.label}</span>
                  <Input
                    className="bg-background text-foreground"
                    value={answers[field.key] ?? ""}
                    onChange={(event) => setAnswers((current) => ({ ...current, [field.key]: event.target.value }))}
                  />
                </label>
              ))}
              <p className="mt-1">{copy.planBlocked}</p>
            </div>
          ) : inspection.blockers.length === 0 ? (
            <p className="rounded border border-success/30 bg-success/10 p-2 text-xs text-success">{copy.planReady}</p>
          ) : null}
          {inspection.blockers.length ? (
            <div className="rounded border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
              <p className="font-medium">{copy.profileBlocked}</p>
              {inspection.blockers.map((blocker) => <p key={blocker} className="mt-1">{blocker}</p>)}
            </div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium">{copy.outputs}</p>
              {(inspection.plannedOutputs ?? []).map((output) => (
                <p key={`${output.family}:${output.extension}`} className="mt-1 text-xs text-muted-foreground">
                  {output.family} · .{output.extension}
                </p>
              ))}
            </div>
            <div>
              <p className="text-xs font-medium">{copy.recipe}</p>
              {match.profile.taskRecipe.steps.map((step, index) => (
                <p key={`${index}:${step}`} className="mt-1 text-xs text-muted-foreground">
                  {index + 1}. {step}
                </p>
              ))}
            </div>
          </div>
          <p className="font-mono text-xs text-muted-foreground">{copy.outputPath}: {inspection.pathTemplate}</p>
          <Button
            disabled={
              pending
              || inspection.blockers.length > 0
              || inspection.missingFields.some((field) => !(answers[field.key] ?? "").trim())
            }
            onClick={() => onCreate(answers)}
          >
            {pending ? <Loader2 className="animate-spin" /> : <FileCheck2 />}
            {copy.createTask}
          </Button>
        </>
      ) : null}
    </div>
  );
}
