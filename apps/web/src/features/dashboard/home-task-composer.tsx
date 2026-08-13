import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, Eye, FolderKanban, LoaderCircle, Plus, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { api } from "@/data/use-console-actions";
import {
  MAX_TASK_MATERIALS,
  TaskMaterialPicker,
  selectTaskMaterialFiles,
  type TaskMaterialSelection,
} from "@/features/dashboard/task-material-picker";
import type { TaskMaterialDraft } from "@/lib/api-client";
import type { LocalWorkItem } from "@/features/tasks/task-view-types";
import type { SectionKey } from "@/store/ui-store";
import { readinessSetupSection, type AutoRunReadiness } from "@/features/tasks/auto-run-readiness-ui";

type CreateMode = "task" | "ai";

type MyTemplateCandidate = {
  templateId: string;
  definitionId: string;
  version: number;
  name: string;
  description: string;
  expectedOutput: string;
  steps: string[];
  reasons: string[];
  governance?: {
    state: "learning" | "trusted" | "watch" | "paused";
    requiresConfirmation: boolean;
    autoMatchAllowed: boolean;
  };
};

type MyTemplateMatch = {
  state: "matched" | "ambiguous" | "missing";
  candidates: MyTemplateCandidate[];
  selected: MyTemplateCandidate | null;
  decision?: {
    kind: "auto_apply" | "confirm_output" | "no_match";
    confidence: "high" | "medium" | "low";
    reason: string;
  };
  clarification?: {
    kind: "desired_output";
    question: string;
    reason?: string;
    message?: string;
    learnedChoices?: Array<{ label: string; count: number }>;
    options: Array<{ definitionId: string; label: string }>;
  };
};

export type HomeTaskReviewFacts = {
  computer: string;
  agent: string;
  risk: string;
  cost: string;
  data: string;
  cancellation: string;
};

function localDateKey(offsetDays = 0) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clientKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `home-task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function HomeTaskComposer({
  projectId,
  projectName,
  projects = [],
  onProjectChange,
  projectError,
  unavailable = false,
  readOnly = false,
  onCreated,
  onOpenTask,
  onOpenSetup,
  onOpenProjects,
  open: openProp,
  onOpenChange,
  showTrigger = true,
  inline = false,
  mobileOpen = false,
  onMobileOpenChange,
  draftGoal,
  onDraftGoalApplied,
  reviewFacts,
}: {
  projectId: string | null;
  projectName?: string | null;
  projects?: Array<{ id: string; name: string }>;
  onProjectChange?: (projectId: string) => Promise<unknown> | unknown;
  projectError?: string | null;
  worktreeId?: string | null;
  terminalId?: string | null;
  unavailable?: boolean;
  readOnly?: boolean;
  onCreated: () => void;
  onOpenTask: (workItemId: string) => void;
  onOpenSetup?: (section: SectionKey) => void;
  onOpenProjects?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
  inline?: boolean;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
  draftGoal?: string | null;
  onDraftGoalApplied?: () => void;
  reviewFacts?: HomeTaskReviewFacts | null;
}) {
  const { i18n } = useAppTranslation();
  const zh = i18n.language.startsWith("zh");
  const copy = zh ? {
    title: "创建一个任务",
    expand: "展开任务创建",
    collapse: "收起任务创建",
    description: "描述要完成的事情。",
    placeholder: "例如：整理本周客户反馈，并输出按优先级排序的改进建议",
    due: "希望完成（可选）",
    project: "新任务项目",
    criteria: "完成标准（可选）",
    criteriaHint: "每行一项，例如：覆盖全部反馈\n给出明确优先级\n输出可分享的文档",
    sop: "验收 SOP（交给 AI 前必填）",
    sopHint: "每行一步，例如：按真实使用流程检查结果\n核对自动验证证据\n确认风险后再审核通过",
    contractReview: "执行方案草案已生成。确认完成标准和验收步骤后，再明确启动 AI。",
    contractFailed: "暂时无法生成可靠的执行方案。任务尚未创建，请稍后重试。",
    templateRecommended: "将按你以往的做法处理",
    templateOutput: "预计得到",
    templateWhy: "判断依据",
    templateSource: "来自我的模板",
    templateSkip: "本次不使用模板",
    templateAmbiguous: "这次你希望最终得到什么？",
    templateAmbiguousHint: "只需选择想要的结果，系统会自动采用合适的处理方法。",
    templateConflictHint: "你以前对此类任务选择过不同结果。请确认这次需要什么，系统不会擅自猜测。",
    templateGovernanceWatchHint: "这个模板近期出现过多次结果类型不符。系统已降低推荐优先级，本次确认后才会使用。",
    templateGovernancePausedHint: "这个模板近期多次产生错误结果类型，已暂停自动套用。你仍可确认本次使用。",
    templateManualObservationHint: "你已将这个模板恢复到观察期。系统会先请你确认，积累新的成功结果后才恢复自动套用。",
    templateConfidenceHigh: "判断较明确",
    templateConfidenceMedium: "根据现有记录推荐",
    templateConfidenceConfirmed: "已由你确认结果",
    reviewTitle: "AI 启动前请确认",
    reviewHint: "下列方案和运行边界确认后才会加入自动队列。",
    reviewComputer: "运行电脑",
    reviewAgent: "任务助手",
    reviewRisk: "可能影响",
    reviewCost: "费用",
    reviewData: "数据处理",
    reviewCancellation: "如何停止",
    more: "更多选项",
    attach: "添加参考文件",
    attachDrop: "拖放文件到这里，或点击选择文件",
    attachLimit: "最多 6 个文件，每个不超过 50MB",
    retryAttachment: "重试",
    removeAttachment: "移除 {{name}}",
    attachmentRejected: "部分文件未能添加。单个文件不能超过 50MB，最多添加 6 个非空文件。",
    attachmentUploadFailed: "参考文件上传失败，任务尚未创建。请重试或先移除文件。",
    create: "仅保存",
    prepareAi: "交给 AI",
    confirmAi: "确认并启动 AI",
    preparing: "正在生成方案…",
    creating: "正在创建…",
    created: "任务已创建并加入看板。",
    aiStarted: "任务已创建，AI 会自动处理；需要你时会提醒。",
    failed: "任务创建失败，请检查项目和网络状态后重试。",
    preflight: "执行前检查",
    preflightChecking: "正在确认 AI、代码仓库和安全开关…",
    preflightBlocked: "AI 暂时不能启动，请先处理以下问题。",
    preflightWarning: "任务可以加入自动队列；AI 会在条件满足时开始，请留意以下信息。",
    preflightUnavailable: "暂时无法完成执行前检查，请重新检查。",
    preflightRetry: "重新检查",
    preflightSetup: "去设置并修复",
    projectChanged: "项目已切换，原项目的参考文件已清除。",
    projectSwitchFailed: "项目切换失败，仍保留原项目。",
    openProjects: "打开项目设置",
    view: "查看任务",
    noProject: "请先选择或创建一个项目。",
    unavailable: "服务器离线。",
    readOnly: "你可以查看任务和调度；如需创建任务或交给 AI，请联系管理员开通操作权限。",
    readOnlyTitle: "调度查看模式",
    today: "今天",
    tomorrow: "明天",
  } : {
    title: "Create a task",
    expand: "Expand task creation",
    collapse: "Collapse task creation",
    description: "Describe what needs to be done.",
    placeholder: "For example: Summarize this week's customer feedback and rank the recommended improvements",
    due: "Complete by (optional)",
    project: "New task project",
    criteria: "Definition of done (optional)",
    criteriaHint: "One item per line, for example:\nCover every feedback item\nAssign a clear priority\nProduce a shareable document",
    sop: "Verification SOP (required before AI starts)",
    sopHint: "One step per line, for example:\nExercise the real user flow\nReview automated evidence\nConfirm risks before approval",
    contractReview: "The execution-plan draft is ready. Review its completion criteria and verification steps, then explicitly start AI.",
    contractFailed: "A reliable execution plan could not be prepared. No task was created; try again shortly.",
    templateRecommended: "Will follow your previous way of working",
    templateOutput: "Expected result",
    templateWhy: "Why it matches",
    templateSource: "From My templates",
    templateSkip: "Do not use a template this time",
    templateAmbiguous: "What result do you want this time?",
    templateAmbiguousHint: "Choose only the result. The system will use the appropriate way of working automatically.",
    templateConflictHint: "You previously chose different results for this kind of task. Confirm this one so the system does not guess.",
    templateGovernanceWatchHint: "This template recently produced several wrong result types. Its priority is lower and it will be used only after you confirm.",
    templateGovernancePausedHint: "This template repeatedly produced the wrong result type, so automatic matching is paused. You can still confirm it for this task.",
    templateManualObservationHint: "You returned this template to observation. Confirm it for now; automatic use resumes after new successful results.",
    templateConfidenceHigh: "Clear match",
    templateConfidenceMedium: "Recommended from existing records",
    templateConfidenceConfirmed: "Result confirmed by you",
    reviewTitle: "Confirm before AI starts",
    reviewHint: "The task joins the automatic queue only after you confirm this plan and its run boundaries.",
    reviewComputer: "Computer",
    reviewAgent: "Task assistant",
    reviewRisk: "Possible impact",
    reviewCost: "Cost",
    reviewData: "Data handling",
    reviewCancellation: "How to stop",
    more: "More options",
    attach: "Add reference files",
    attachDrop: "Drop files here or choose files",
    attachLimit: "Up to 6 files, 50MB each",
    retryAttachment: "Retry",
    removeAttachment: "Remove {{name}}",
    attachmentRejected: "Some files could not be added. Each file must be non-empty and under 50MB; up to 6 files are allowed.",
    attachmentUploadFailed: "Reference files could not be uploaded, so the task was not created. Retry or remove the files.",
    create: "Save only",
    prepareAi: "Let AI handle it",
    confirmAi: "Confirm and start AI",
    preparing: "Generating plan…",
    creating: "Creating…",
    created: "Task created and added to your boards.",
    aiStarted: "Task created. AI will work automatically and notify you only when needed.",
    failed: "The task could not be created. Check the project and connection, then retry.",
    preflight: "Preflight",
    preflightChecking: "Checking the AI, repository, and safety controls…",
    preflightBlocked: "AI cannot start yet. Resolve these issues first.",
    preflightWarning: "The task can join the automatic queue. AI will start when ready; note the following.",
    preflightUnavailable: "Preflight could not be completed. Recheck before starting AI.",
    preflightRetry: "Recheck",
    preflightSetup: "Open setup and fix",
    projectChanged: "The project changed, so reference files from the previous project were cleared.",
    projectSwitchFailed: "The project could not be switched, so the previous project remains active.",
    openProjects: "Open project setup",
    view: "View task",
    noProject: "Choose or create a project first.",
    unavailable: "Server is offline.",
    readOnly: "You can view tasks and schedules. Ask an administrator for permission to create tasks or hand work to AI.",
    readOnlyTitle: "Schedule viewing mode",
    today: "Today",
    tomorrow: "Tomorrow",
  };
  const [goal, setGoal] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [criteria, setCriteria] = useState("");
  const [verificationSop, setVerificationSop] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [attachments, setAttachments] = useState<TaskMaterialSelection[]>([]);
  const [attachmentFeedback, setAttachmentFeedback] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<CreateMode | null>(null);
  const [projectPending, setProjectPending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "warning" | "danger"; text: string; workItemId?: string } | null>(null);
  const [readiness, setReadiness] = useState<AutoRunReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [planReviewed, setPlanReviewed] = useState(false);
  const [templateMatch, setTemplateMatch] = useState<MyTemplateMatch | null>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const idempotencyKey = useRef<string | null>(null);
  const materialDraft = useRef<TaskMaterialDraft | null>(null);
  const materialDraftPromise = useRef<Promise<TaskMaterialDraft> | null>(null);
  const readinessRequest = useRef(0);
  const projectIdRef = useRef(projectId);
  const title = useMemo(() => goal.trim().split(/\r?\n/)[0]?.slice(0, 200) ?? "", [goal]);
  const filesReady = attachments.every((attachment) => attachment.status === "ready");
  const blocked = unavailable || readOnly;
  const canCreate = Boolean(projectId && title && !pendingMode && filesReady && !blocked);
  const readinessBlocking = readiness?.checks.filter((check) => check.status === "blocked" && check.key !== "capacity") ?? [];
  const readinessWarnings = readiness?.checks.filter((check) => check.status === "warn" || (check.status === "blocked" && check.key === "capacity")) ?? [];
  const capacityBlocked = readiness?.checks.some((check) => check.status === "blocked" && check.key === "capacity") ?? false;
  const queueReady = readinessBlocking.length === 0 && (readiness?.ready === true || capacityBlocked);
  const templateNeedsClarification = planReviewed && templateMatch?.state === "ambiguous";
  const canCreateWithAi = canCreate && queueReady && !readinessLoading && !templateNeedsClarification;

  function chooseDesiredOutput(definitionId: string) {
    if (templateMatch?.state !== "ambiguous") return;
    const selected = templateMatch.candidates.find((candidate) => candidate.definitionId === definitionId);
    if (!selected) return;
    const confirmation = zh
      ? `你确认这次需要“${selected.expectedOutput}”`
      : `You confirmed the desired result is “${selected.expectedOutput}”`;
    setTemplateMatch({
      ...templateMatch,
      state: "matched",
      decision: { kind: "auto_apply", confidence: "high", reason: "user_confirmed_result" },
      selected: {
        ...selected,
        reasons: [...selected.reasons.filter((reason) => reason !== confirmation), confirmation],
      },
    });
    idempotencyKey.current = null;
  }

  function skipTemplateForThisTask() {
    if (!templateMatch) return;
    setTemplateMatch({
      ...templateMatch,
      state: "missing",
      selected: null,
      decision: { kind: "no_match", confidence: "high", reason: "user_skipped_template" },
    });
    idempotencyKey.current = null;
  }

  async function loadReadiness(targetProjectId = projectId) {
    const requestId = ++readinessRequest.current;
    if (!targetProjectId || blocked) {
      setReadiness(null);
      setReadinessLoading(false);
      return null;
    }
    setReadinessLoading(true);
    try {
      const response = await api.autoRunReadiness(targetProjectId) as { readiness?: AutoRunReadiness };
      if (!response.readiness || typeof response.readiness.ready !== "boolean" || !Array.isArray(response.readiness.checks)) {
        throw new Error("invalid_auto_run_readiness");
      }
      if (requestId === readinessRequest.current && projectIdRef.current === targetProjectId) setReadiness(response.readiness);
      return response.readiness;
    } catch {
      const unavailableReadiness: AutoRunReadiness = {
        ready: false,
        checks: [{ key: "preflight", label: copy.preflight, status: "blocked", detail: copy.preflightUnavailable }],
      };
      if (requestId === readinessRequest.current && projectIdRef.current === targetProjectId) setReadiness(unavailableReadiness);
      return unavailableReadiness;
    } finally {
      if (requestId === readinessRequest.current) setReadinessLoading(false);
    }
  }

  useEffect(() => {
    const projectChanged = projectIdRef.current !== projectId;
    projectIdRef.current = projectId;
    if (projectChanged) {
      const hadAttachments = attachments.length > 0;
      setAttachments([]);
      materialDraft.current = null;
      materialDraftPromise.current = null;
      idempotencyKey.current = null;
      setFeedback(null);
      setPlanReviewed(false);
      setTemplateMatch(null);
      setAttachmentFeedback(hadAttachments ? copy.projectChanged : null);
    }
    setReadiness(null);
    void loadReadiness(projectId);
    // The project boundary deliberately invalidates draft state exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, unavailable, readOnly]);

  useEffect(() => {
    const next = draftGoal?.trim();
    if (!next) return;
    setGoal(next);
    onMobileOpenChange?.(true);
    setPlanReviewed(false);
    setTemplateMatch(null);
    setFeedback(null);
    onDraftGoalApplied?.();
  }, [draftGoal, onDraftGoalApplied]);

  function rememberDraft(next: TaskMaterialDraft) {
    if (!materialDraft.current || next.revision >= materialDraft.current.revision) materialDraft.current = next;
  }

  async function ensureMaterialDraft() {
    if (materialDraft.current) return materialDraft.current;
    if (materialDraftPromise.current) return materialDraftPromise.current;
    if (!projectId) throw new Error("project_required");
    const draftProjectId = projectId;
    const pending = (async () => {
      const response = await api.createTaskMaterialDraft(draftProjectId) as { draft: TaskMaterialDraft };
      if (projectIdRef.current !== draftProjectId) throw new Error("project_changed");
      rememberDraft(response.draft);
      return response.draft;
    })();
    materialDraftPromise.current = pending;
    try {
      return await pending;
    } finally {
      if (materialDraftPromise.current === pending) materialDraftPromise.current = null;
    }
  }

  async function uploadAttachment(item: TaskMaterialSelection) {
    if (!projectId) return;
    const uploadProjectId = projectId;
    setAttachments((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "uploading", error: undefined } : candidate));
    try {
      const draft = await ensureMaterialDraft();
      const response = await api.uploadTaskMaterialFile(uploadProjectId, draft.id, item.id, item.file) as { draft: TaskMaterialDraft; asset: { id: string } };
      if (projectIdRef.current !== uploadProjectId) return;
      rememberDraft(response.draft);
      setAttachments((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "ready", assetId: response.asset.id, error: undefined } : candidate));
      setAttachmentFeedback(null);
    } catch (error) {
      if (projectIdRef.current !== uploadProjectId) return;
      setAttachments((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "failed", error: String(error) } : candidate));
      setAttachmentFeedback(copy.attachmentUploadFailed);
    }
  }

  async function addFiles(files: FileList | File[]) {
    const result = selectTaskMaterialFiles(files, Math.max(0, MAX_TASK_MATERIALS - attachments.length));
    setAttachmentFeedback(result.rejected ? copy.attachmentRejected : null);
    if (result.selected.length) {
      idempotencyKey.current = null;
      setPlanReviewed(false);
      setTemplateMatch(null);
      setFeedback(null);
      setAttachments((current) => [...current, ...result.selected].slice(0, MAX_TASK_MATERIALS));
      await Promise.all(result.selected.map((item) => uploadAttachment(item)));
    }
  }

  async function removeAttachment(item: TaskMaterialSelection) {
    if (item.status === "uploading") return;
    const draft = materialDraft.current;
    if (projectId && draft && item.assetId) {
      try {
        const response = await api.removeTaskMaterialFile(projectId, draft.id, item.assetId, draft.revision) as { draft: TaskMaterialDraft };
        rememberDraft(response.draft);
      } catch {
        setAttachmentFeedback(copy.attachmentUploadFailed);
        return;
      }
    }
    idempotencyKey.current = null;
    setPlanReviewed(false);
    setTemplateMatch(null);
    setFeedback(null);
    setAttachments((current) => current.filter((candidate) => candidate.id !== item.id));
    setAttachmentFeedback(null);
  }

  async function create(mode: CreateMode) {
    if (!projectId || !title || pendingMode) return;
    setPendingMode(mode);
    setFeedback(null);
    const key = idempotencyKey.current ?? clientKey();
    idempotencyKey.current = key;
    let created: LocalWorkItem | null = null;
    let effectiveCriteria = criteria;
    let effectiveVerificationSop = verificationSop;
    let effectiveTemplateMatch = templateMatch;
    try {
      if (!filesReady) return;
      if (mode === "ai") {
        const latestReadiness = await loadReadiness(projectId);
        if (projectIdRef.current !== projectId) return;
        const latestBlocking = latestReadiness?.checks.some((check) => check.status === "blocked" && check.key !== "capacity") ?? true;
        const latestCapacityBlocked = latestReadiness?.checks.some((check) => check.status === "blocked" && check.key === "capacity") ?? false;
        const latestQueueReady = !latestBlocking && (latestReadiness?.ready === true || latestCapacityBlocked);
        if (!latestQueueReady) {
          setFeedback({ tone: "warning", text: copy.preflightBlocked });
          return;
        }
        if (!planReviewed) {
          const currentMaterialDraft = materialDraft.current;
          const response = await api.suggestWorkItemDraft({
            projectId,
            title,
            body: goal.trim(),
            ...(attachments.length && currentMaterialDraft ? {
              materialDraftId: currentMaterialDraft.id,
              materialDraftRevision: currentMaterialDraft.revision,
            } : {}),
          }) as {
            draft?: { acceptanceCriteria?: string[]; verificationSop?: string[]; templateMatch?: MyTemplateMatch };
          };
          const suggestedCriteria = response.draft?.acceptanceCriteria?.filter(Boolean) ?? [];
          const suggestedSop = response.draft?.verificationSop?.filter(Boolean) ?? [];
          const nextCriteria = criteria.trim() || suggestedCriteria.join("\n");
          const nextSop = verificationSop.trim() || suggestedSop.join("\n");
          if (!nextCriteria || !nextSop) throw new Error("execution_plan_incomplete");
          effectiveCriteria = nextCriteria;
          effectiveVerificationSop = nextSop;
          effectiveTemplateMatch = response.draft?.templateMatch ?? null;
          setCriteria(nextCriteria);
          setVerificationSop(nextSop);
          setTemplateMatch(effectiveTemplateMatch);
          const canStartDirectly = effectiveTemplateMatch?.state === "matched"
            && effectiveTemplateMatch.selected
            && effectiveTemplateMatch.decision?.kind === "auto_apply"
            && effectiveTemplateMatch.decision.confidence === "high";
          if (canStartDirectly) {
            setPlanReviewed(false);
          } else {
            setDetailsOpen(true);
            setPlanReviewed(true);
            setFeedback({ tone: "warning", text: copy.contractReview });
            return;
          }
        }
      }
      const draft = materialDraft.current;
      const response = await api.createWorkItem({
        projectId,
        title,
        body: goal.trim(),
        type: "task",
        status: mode === "ai" ? "ready" : "backlog",
        priority: "p2",
        executionPolicy: mode === "ai" ? "auto" : "manual",
        acceptanceCriteria: effectiveCriteria.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
        verificationSop: effectiveVerificationSop.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
        requesterRelation: "self",
        intakeChannel: "manual",
        waitingOn: mode === "ai" ? "ai" : "none",
        dueDate: dueDate || null,
        plannedDate: mode === "ai" ? localDateKey() : null,
        ...(attachments.length && draft ? { materialDraftId: draft.id, materialDraftRevision: draft.revision } : {}),
        ...(effectiveTemplateMatch?.state === "matched" && effectiveTemplateMatch.selected ? {
          myTemplateBinding: {
            definitionId: effectiveTemplateMatch.selected.definitionId,
            familyId: effectiveTemplateMatch.selected.templateId,
            version: effectiveTemplateMatch.selected.version,
            matchReasons: effectiveTemplateMatch.selected.reasons,
            ...(effectiveTemplateMatch.decision?.reason === "user_confirmed_result" ? { userConfirmedResult: true } : {}),
          },
        } : {}),
        idempotencyKey: key,
      }) as { workItem: LocalWorkItem };
      created = response.workItem;
      if (mode === "ai") {
        setFeedback({ tone: "success", text: copy.aiStarted, workItemId: created.id });
      } else {
        setFeedback({ tone: "success", text: copy.created, workItemId: created.id });
      }
      setGoal("");
      setCriteria("");
      setVerificationSop("");
      setDetailsOpen(false);
      setPlanReviewed(false);
      setTemplateMatch(null);
      setAttachments([]);
      materialDraft.current = null;
      setAttachmentFeedback(null);
      idempotencyKey.current = null;
      onCreated();
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "home-task-create", workItemId: created.id } }));
    } catch {
      setFeedback({ tone: "danger", text: mode === "ai" && !planReviewed ? copy.contractFailed : copy.failed });
    } finally {
      setPendingMode(null);
    }
  }

  if (inline && readOnly) {
    return (
      <div className="h-full" data-testid="home-task-composer-inline">
        <Card className="border-border/80" data-testid="home-task-composer-read-only">
          <CardContent className="flex items-start gap-3 p-4">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Eye className="size-4" aria-hidden />
            </span>
            <div>
              <h2 className="text-sm font-semibold">{copy.readOnlyTitle}</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{copy.readOnly}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const composerForm = (
    <Card className="h-full border-primary/25" data-testid="home-task-composer">
      <CardContent className={inline ? "space-y-3 p-4" : "space-y-3 pt-1"}>
        {inline ? (
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Sparkles className="size-4" aria-hidden /></span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{copy.title}</h2>
              {projectName ? <p className={`mt-0.5 truncate text-xs text-muted-foreground ${mobileOpen ? "" : "hidden sm:block"}`}>{projectName}</p> : null}
            </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="shrink-0 sm:hidden"
              aria-expanded={mobileOpen}
              aria-controls="home-task-composer-fields"
              aria-label={mobileOpen ? copy.collapse : copy.expand}
              onClick={() => onMobileOpenChange?.(!mobileOpen)}
            >
              <ChevronDown className={`transition-transform ${mobileOpen ? "rotate-180" : ""}`} aria-hidden />
            </Button>
          </div>
        ) : null}
        <div id="home-task-composer-fields" className={`space-y-3 ${inline && !mobileOpen ? "hidden sm:block" : ""}`}>
        <textarea
          aria-label={copy.title}
          disabled={blocked}
          className="min-h-16 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
          value={goal}
          placeholder={copy.placeholder}
          onChange={(event) => {
            setGoal(event.target.value);
            setPlanReviewed(false);
            setTemplateMatch(null);
            idempotencyKey.current = null;
            setFeedback(null);
          }}
        />
        <div className="grid gap-2 sm:grid-cols-2 sm:items-end">
          <Button className="w-full" disabled={!canCreate} onClick={() => void create("task")}>{pendingMode === "task" ? copy.creating : copy.create}</Button>
          <Button className="w-full" variant="secondary" data-home-create-action="create-ai" disabled={!canCreateWithAi} title={!queueReady ? copy.preflightBlocked : undefined} onClick={() => void create("ai")}><Sparkles aria-hidden />{pendingMode === "ai" ? (planReviewed ? copy.creating : copy.preparing) : planReviewed ? copy.confirmAi : copy.prepareAi}</Button>
        </div>
        {projectId && !blocked && (readinessLoading || readinessBlocking.length > 0 || readinessWarnings.length > 0) ? (
          <section className={`rounded-lg border px-3 py-2 text-sm ${readinessBlocking.length > 0 ? "border-warning/40 bg-warning/[0.06]" : "border-border bg-muted/30"}`} aria-label={copy.preflight} role={readinessBlocking.length > 0 ? "alert" : "status"}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  {readinessLoading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <AlertTriangle className="size-4 text-warning" aria-hidden />}
                  {readinessLoading ? copy.preflightChecking : readinessBlocking.length > 0 ? copy.preflightBlocked : copy.preflightWarning}
                </p>
                {!readinessLoading ? <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  {(readinessBlocking.length > 0 ? readinessBlocking : readinessWarnings).map((check) => (
                    <li key={check.key}><span className="font-medium text-foreground">{check.label}:</span> {check.detail}</li>
                  ))}
                </ul> : null}
              </div>
              {!readinessLoading ? <div className="flex shrink-0 flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => { void loadReadiness(); }}><RefreshCw aria-hidden />{copy.preflightRetry}</Button>
                {readinessBlocking.length > 0 && readiness && onOpenSetup ? <Button size="sm" variant="secondary" onClick={() => onOpenSetup(readinessSetupSection({ ...readiness, checks: readinessBlocking }))}>{copy.preflightSetup}</Button> : null}
              </div> : null}
            </div>
          </section>
        ) : null}
        {planReviewed ? (
          templateMatch?.state === "matched" && templateMatch.selected ? (
            <section className="rounded-lg border border-success/35 bg-success/[0.055] px-3 py-3 text-sm" aria-label={copy.templateRecommended}>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                <div className="min-w-0">
                  <h3 className="font-semibold">{copy.templateRecommended}</h3>
                  {templateMatch.decision ? (
                    <p className="mt-1 text-xs font-medium text-success">{templateMatch.decision.reason === "user_confirmed_result"
                      ? copy.templateConfidenceConfirmed
                      : templateMatch.decision.confidence === "high" ? copy.templateConfidenceHigh : copy.templateConfidenceMedium}</p>
                  ) : null}
                  <p className="mt-1"><span className="text-muted-foreground">{copy.templateOutput}：</span>{templateMatch.selected.expectedOutput}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{copy.templateSource}：{templateMatch.selected.name}</p>
                  {templateMatch.selected.reasons.length ? (
                    <p className="mt-1 text-xs text-muted-foreground">{copy.templateWhy}：{templateMatch.selected.reasons.join("；")}</p>
                  ) : null}
                </div>
                <Button className="ml-auto shrink-0" type="button" size="sm" variant="ghost" onClick={skipTemplateForThisTask}>{copy.templateSkip}</Button>
              </div>
            </section>
          ) : templateMatch?.state === "ambiguous" ? (
            <section className="rounded-lg border border-warning/40 bg-warning/[0.06] px-3 py-3 text-sm" aria-label={copy.templateAmbiguous}>
              <h3 className="font-semibold">{copy.templateAmbiguous}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{
                templateMatch.clarification?.reason === "learned_preference_conflict" ? copy.templateConflictHint
                  : templateMatch.clarification?.reason === "outcome_feedback_paused" ? copy.templateGovernancePausedHint
                    : templateMatch.clarification?.reason === "outcome_feedback_watch" ? copy.templateGovernanceWatchHint
                      : templateMatch.clarification?.reason === "manual_resume_observation" ? copy.templateManualObservationHint
                      : copy.templateAmbiguousHint
              }</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[...new Map(templateMatch.candidates.map((candidate) => [candidate.expectedOutput, candidate])).values()].map((candidate) => (
                  <Button key={candidate.definitionId} type="button" size="sm" variant="secondary" onClick={() => chooseDesiredOutput(candidate.definitionId)}>
                    {candidate.expectedOutput}
                  </Button>
                ))}
                <Button type="button" size="sm" variant="ghost" onClick={skipTemplateForThisTask}>{copy.templateSkip}</Button>
              </div>
            </section>
          ) : null
        ) : null}
        {planReviewed ? (
          <section className="rounded-lg border border-primary/35 bg-primary/[0.045] px-3 py-3 text-sm" aria-label={copy.reviewTitle}>
            <h3 className="font-semibold">{copy.reviewTitle}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{copy.reviewHint}</p>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[
                [copy.reviewComputer, reviewFacts?.computer ?? projectName ?? "—"],
                [copy.reviewAgent, reviewFacts?.agent ?? "—"],
                [copy.reviewRisk, reviewFacts?.risk ?? (zh ? "尚未明确；执行期间仍受安全开关限制" : "Not specified; safety controls still apply")],
                [copy.reviewCost, reviewFacts?.cost ?? (zh ? "未知" : "Unknown")],
                [copy.reviewData, reviewFacts?.data ?? (zh ? "任务输入、结果和审查记录会被保存" : "Task input, result, and review records are saved")],
                [copy.reviewCancellation, reviewFacts?.cancellation ?? (zh ? "可停止；正在执行的本地操作可能需要等待安全退出" : "Can be stopped; local work may need time to exit safely")],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md bg-background/75 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-medium leading-relaxed">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
        <details className="group rounded-lg border border-border px-3 py-2" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium text-muted-foreground">
            {copy.more}<ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {projectId && projects.length > 1 && onProjectChange ? (
              <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
                <span className="inline-flex items-center gap-1"><FolderKanban className="size-3.5" aria-hidden />{copy.project}</span>
                <select
                  aria-label={copy.project}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
                  value={projectId}
                  disabled={projectPending || Boolean(pendingMode) || readOnly}
                  onChange={(event) => {
                    const nextProjectId = event.target.value;
                    setProjectPending(true);
                    setFeedback(null);
                    void Promise.resolve(onProjectChange(nextProjectId)).finally(() => setProjectPending(false));
                  }}
                >
                  {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                {projectError ? <span role="alert" className="text-xs text-destructive">{copy.projectSwitchFailed} {projectError}</span> : null}
              </label>
            ) : null}
            <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
              <span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" aria-hidden />{copy.due}</span>
              <Input aria-label={copy.due} type="date" value={dueDate} min={localDateKey()} disabled={blocked} onChange={(event) => { setDueDate(event.target.value); setPlanReviewed(false); idempotencyKey.current = null; setFeedback(null); }} />
            </label>
          </div>
          <label className="mt-3 grid gap-1 text-xs font-medium text-muted-foreground">
            {copy.criteria}
            <textarea className="min-h-24 rounded-md border border-border bg-background p-2 text-sm text-foreground" value={criteria} placeholder={copy.criteriaHint} disabled={blocked} onChange={(event) => { setCriteria(event.target.value); idempotencyKey.current = null; setFeedback(null); }} />
          </label>
          <label className="mt-3 grid gap-1 text-xs font-medium text-muted-foreground">
            {copy.sop}
            <textarea className="min-h-24 rounded-md border border-border bg-background p-2 text-sm text-foreground" value={verificationSop} placeholder={copy.sopHint} disabled={blocked} onChange={(event) => { setVerificationSop(event.target.value); idempotencyKey.current = null; setFeedback(null); }} />
          </label>
          <div className="mt-3 border-t border-border pt-3">
            <TaskMaterialPicker
              files={attachments}
              onFiles={(files) => { void addFiles(files); }}
              onRemove={(id) => {
                const item = attachments.find((candidate) => candidate.id === id);
                if (item) void removeAttachment(item);
              }}
              onRetry={(id) => {
                const item = attachments.find((candidate) => candidate.id === id);
                if (item) void uploadAttachment(item);
              }}
              label={copy.attach}
              dropLabel={copy.attachDrop}
              limitLabel={copy.attachLimit}
              retryLabel={copy.retryAttachment}
              removeLabel={(name) => copy.removeAttachment.replace("{{name}}", name)}
              disabled={!projectId || blocked}
              feedback={attachmentFeedback}
            />
          </div>
        </details>
        {blocked
          ? <p className="text-sm text-warning" role="status">{readOnly ? copy.readOnly : copy.unavailable}</p>
          : !projectId ? <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-warning" role="status"><span>{copy.noProject}</span>{onOpenProjects ? <Button size="sm" variant="secondary" onClick={onOpenProjects}>{copy.openProjects}</Button> : null}</div> : null}
        {feedback ? (
          <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${feedback.tone === "success" ? "border-success/30 bg-success/[0.06]" : feedback.tone === "warning" ? "border-warning/35 bg-warning/[0.06]" : "border-destructive/35 bg-destructive/[0.05]"}`} role={feedback.tone === "danger" ? "alert" : "status"}>
            {feedback.tone === "success" ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden /> : null}
            <span className="min-w-0 flex-1">{feedback.text}</span>
            {feedback.workItemId ? <Button size="sm" variant="secondary" onClick={() => { setOpen(false); onOpenTask(feedback.workItemId!); }}>{copy.view}</Button> : null}
          </div>
        ) : null}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <>
      {showTrigger ? <Button
        type="button"
        data-testid="home-create-task-trigger"
        className="fixed bottom-5 right-5 z-40 rounded-full px-5 shadow-lg shadow-primary/20 sm:bottom-6 sm:right-6"
        disabled={blocked}
        title={blocked ? (readOnly ? copy.readOnly : copy.unavailable) : copy.title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" aria-hidden />
        {zh ? "创建任务" : "Create task"}
      </Button> : null}
      {inline ? <div className="h-full" data-testid="home-task-composer-inline">{composerForm}</div> : (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title={copy.title}
          description={copy.description}
          size="xl"
          closeDisabled={Boolean(pendingMode)}
        >
          {composerForm}
        </Modal>
      )}
    </>
  );
}

export default HomeTaskComposer;
