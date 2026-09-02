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
  Library,
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
import { api } from "@/data/use-console-actions";
import { localContentApi } from "@/features/local-content/local-content-api";
import { useConsoleState } from "@/data/use-console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useSessionUser } from "@/hooks/use-session-user";
import { type SectionKey, type WorkItemSection } from "@/store/ui-store";
import { WorkItemProgressDialog, type WorkItemProgressTarget } from "./work-item-progress-dialog";
import { ExecutionStartConfirmation } from "./execution-start-confirmation";
import { deriveExecutionStartSummary, type ExecutionStartClarificationOption } from "./execution-start-summary";
import { ExecutionStartStatusCard } from "./execution-start-status-card";
import { ExecutionReviewCard, type ExecutionActionReceipt } from "./execution-review-card";
import {
  createWorkItemExecutionController,
  type PendingTemplateClarification,
} from "./work-item-execution-controller";
import { WorkItemPlanActualCard } from "./work-item-plan-actual-card";
import { WorkItemCompletionStatus } from "./work-item-completion-status";
import { WorkItemCompletedTaskCard, type LocalDeliveryReceipt } from "./work-item-completed-task-card";
import { WorkItemDeliveryRecoveryAlert, type DeliveryRecoveryAction } from "./work-item-delivery-recovery-alert";
import {
  WorkItemFailedResultFiles,
  WorkItemResultRepairCard,
  WorkItemResultReportContent,
  WorkItemResultReview,
} from "./work-item-result-review";
import { WorkItemReviewDecisionSection } from "./work-item-review-decision-section";
import { WorkItemRecordBindings } from "./work-item-record-bindings";
import { WorkItemLedgerPostingPlan } from "./work-item-ledger-posting-plan";
import { WorkItemChannelDataPlan, WorkItemChannelMutationPreview } from "./work-item-channel-data-contract";
import { WorkItemTemplateBindingCard } from "./work-item-template-binding-card";
import { TaskMaterialEditor } from "./task-material-editor";
import { TaskContentReferences } from "./task-content-references";
import { readableAutoRunReadinessCheck, readinessFixLabel, readinessSetupSection, type AutoRunReadiness } from "./auto-run-readiness-ui";
import { myTemplateExpectedOutput } from "@/features/workflow-memory/my-template-model";
import { ApiError, type BusinessRoutineDefinition } from "@/lib/api-client";
import type { LocalWorkItem, LocalWorkItemDeliveryEvidence, LocalWorkItemObservability, WorkItemComment, WorkItemOutcomeFile } from "./task-view-types";
import { deriveWorkItemUserStatus } from "./work-item-user-status";
import { WorkItemJobOverview } from "./work-item-job-overview";
import { WorkItemContextCard, type TaskContextUpdate } from "./work-item-context-card";
import { isLocalWorkItem } from "./work-item-response";
import { COPY } from "./work-item-summary-copy";
import {
  WAITING_LABEL,
  aiPhaseDescription,
  deriveDeliveryDecision,
  deriveWorkItemIntentSummary,
  executionStateLabel,
  expertSectionFor,
  latestExecutionKind,
  reviewIntentConfirmationCopy,
  resultPresentation,
  type WorkItemIntentSummary,
} from "./work-item-summary-model";
import {
  DeliveryMarkdownDocument,
  deliverableFileKey,
  IMAGE_DELIVERY_EXTENSIONS,
  MARKDOWN_DELIVERY_EXTENSIONS,
} from "./work-item-deliverable-files";
import {
  browsableDeliveryPath,
  deliveryExtension,
  deliveryFileCanUseLegacyPath,
  deliveryFileName,
  imageMime,
  isOfficeDeliveryPath,
  isOfficeMaterial,
  normalizedDeliveryPath,
  type DeliveryPreview,
} from "./work-item-delivery-preview-model";

export { deriveWorkItemUserStatus } from "./work-item-user-status";

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

function localDeliveryFailure(error: unknown, language: "zh" | "en"): { message: string; action: DeliveryRecoveryAction } | null {
  if (!(error instanceof ApiError)) return null;
  const detail = error.message.toLowerCase();
  if (detail.includes("changed after approval")) {
    return {
      message: language === "zh"
        ? "工作区在审核通过后又发生了变化。任务仍停留在审核阶段；请重新检查当前改动并取得新的审核结论。"
        : "The worktree changed after approval. The task remains in review; inspect the current changes and obtain a new approval before applying it.",
      action: "review_changes",
    };
  }
  if (detail.includes("base branch") && (detail.includes("advanced") || detail.includes("rebase"))) {
    return {
      message: language === "zh"
        ? "本地基准分支已经前进，系统没有强行合并。任务和工作区都已保留；请先同步基准分支，再重新检查改动。"
        : "The local base branch advanced, so no merge was forced. The task and worktree were kept; update the worktree from the base branch and review the changes again.",
      action: "review_changes",
    };
  }
  if (detail.includes("uncommitted changes") || detail.includes("clean it before delivery")) {
    return {
      message: language === "zh"
        ? "工作区或本地基准分支存在未提交修改，因此没有应用交付。任务和改动均已保留；请处理这些修改后重新审核。"
        : "The worktree or local base branch has uncommitted changes, so the delivery was not applied. Everything was kept; resolve those changes and review again.",
      action: "review_changes",
    };
  }
  if (error.code === "work_item_revision_conflict") {
    return {
      message: language === "zh"
        ? "任务在确认期间已更新，本次操作没有应用。刷新任务以查看最新状态。"
        : "The task changed while you were confirming it, so nothing was applied. Refresh the task to review its latest state.",
      action: "refresh",
    };
  }
  if (error.code === "work_item_delivery_failed") {
    return {
      message: language === "zh"
        ? "本地应用没有完成，任务仍停留在审核阶段，工作区也已保留。请检查当前改动后重试。"
        : "The local delivery did not complete. The task remains in review and the worktree was kept; inspect the current changes before retrying.",
      action: "review_changes",
    };
  }
  return null;
}

export function WorkItemSummaryView({
  workItemId,
  onOpenExpert,
  onOpenDeliveryChanges,
  onOpenTaskCenter,
  onOpenSetup,
  onDirtyChange,
  onCompletedChange,
  onCreateTaskDraft,
  onOpenWorkItem,
}: {
  workItemId: string;
  onOpenExpert: (section?: WorkItemSection) => void;
  onOpenDeliveryChanges?: (projectId: string, worktreeId: string) => void;
  onOpenTaskCenter?: () => void;
  onOpenSetup?: (section: SectionKey) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCompletedChange?: (completed: boolean | null) => void;
  onCreateTaskDraft?: (draft: string) => void;
  onOpenWorkItem?: (workItemId: string) => void;
}) {
  const { t, i18n } = useAppTranslation();
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
  const [executionActionReceipt, setExecutionActionReceipt] = useState<ExecutionActionReceipt | null>(null);
  const [retryOpen, setRetryOpen] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [repairPending, setRepairPending] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [resultExpanded, setResultExpanded] = useState(false);
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const [actionPending, setActionPending] = useState<"start" | "cancel-start" | "recheck-start" | "changes" | "complete" | "reopen" | "policy" | "priority" | "stop-delivery" | "reverify" | "reconcile" | "context" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [startConfirmationOpen, setStartConfirmationOpen] = useState(false);
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
  const [localDeliveryReceipt, setLocalDeliveryReceipt] = useState<LocalDeliveryReceipt | null>(null);
  const [deliveryRecovery, setDeliveryRecovery] = useState<DeliveryRecoveryAction | null>(null);
  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<NonNullable<LocalWorkItem["inputAssets"]>[number] | null>(null);
  const [materialOfficePreview, setMaterialOfficePreview] = useState<string | null>(null);
  const [materialPreviewPending, setMaterialPreviewPending] = useState(false);
  const [materialPreviewError, setMaterialPreviewError] = useState<string | null>(null);
  const [materialRevealPendingId, setMaterialRevealPendingId] = useState<string | null>(null);
  const [materialRevealError, setMaterialRevealError] = useState<string | null>(null);
  const [recordBindingRefreshPendingId, setRecordBindingRefreshPendingId] = useState<string | null>(null);
  const [recordBindingRefreshError, setRecordBindingRefreshError] = useState<string | null>(null);
  const [openingResultFileKey, setOpeningResultFileKey] = useState<string | null>(null);
  const [resultFileError, setResultFileError] = useState<string | null>(null);
  const [resultPreviewFile, setResultPreviewFile] = useState<WorkItemOutcomeFile | null>(null);
  const [resultPreview, setResultPreview] = useState<DeliveryPreview | null>(null);
  const resultPreviewRequest = useRef(0);
  const resultAutoOpenedFor = useRef<string | null>(null);
  const startActionRef = useRef<HTMLButtonElement>(null);

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
    setRecordBindingRefreshPendingId(null);
    setRecordBindingRefreshError(null);
    setMaterialOfficePreview(null);
    setMaterialPreviewPending(false);
    setMaterialPreviewError(null);
    setLoadError(null);
    setSyncNotice(null);
    setExecutionActionReceipt(null);
    setRetryOpen(false);
    setRetryPending(false);
    setRetryError(null);
    setRepairPending(false);
    setRepairError(null);
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
    setLocalDeliveryReceipt(null);
    setDeliveryRecovery(null);
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
      if (detail.status === "fulfilled" && isLocalWorkItem(detail.value?.workItem)) {
        const loadedItem = detail.value.workItem;
        setItem(loadedItem);
        setObservability(detail.value.observability ?? null);
        if (
          deriveWorkItemUserStatus(loadedItem, detail.value.observability?.latestRun ?? null) === "ready_for_review"
          && resultAutoOpenedFor.current !== loadedItem.id
        ) {
          setResultExpanded(true);
          resultAutoOpenedFor.current = loadedItem.id;
        }
        setLoadError(null);
        void (api.autoRunReadiness(loadedItem.projectId) as Promise<{ readiness?: AutoRunReadiness }>)
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
    if (!item?.executionStartReceipt || !["queued", "starting"].includes(item.executionStartReceipt.status)) return undefined;
    const timer = window.setTimeout(() => setRefreshVersion((version) => version + 1), 2_000);
    return () => window.clearTimeout(timer);
  }, [item?.executionStartReceipt?.status, item?.executionStartReceipt?.updatedAt]);

  useEffect(() => {
    const reviewState = observability?.executionReview?.state;
    if (!reviewState || !["preparing", "working", "waiting", "verifying"].includes(reviewState)) return undefined;
    const timer = window.setTimeout(() => setRefreshVersion((version) => version + 1), reviewState === "waiting" ? 5_000 : 2_000);
    return () => window.clearTimeout(timer);
  }, [observability?.executionReview?.state, observability?.executionReview?.updatedAt]);

  useEffect(() => {
    const receipt = observability?.executionReview?.actionReceipt ?? executionActionReceipt;
    if (!receipt || !["accepted", "running"].includes(receipt.status ?? "")) return undefined;
    const timer = window.setTimeout(() => setRefreshVersion((version) => version + 1), 2_000);
    return () => window.clearTimeout(timer);
  }, [executionActionReceipt, observability?.executionReview?.actionReceipt]);

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
  const startReceipt = item.executionStartReceipt ?? null;
  const executionReview = observability?.executionReview ?? null;
  const reviewIntent = executionReview?.reviewIntent ?? null;
  const effectiveExecutionActionReceipt = executionReview?.actionReceipt ?? executionActionReceipt;
  const showExecutionReview = Boolean(executionReview?.targetId && executionReview.state !== "queued");
  const executionReviewOwnsProgress = showExecutionReview;
  const usesProjectedReviewActions = Boolean(showExecutionReview && executionReview?.actionAvailability);
  const startRequestActive = Boolean(startReceipt && startReceipt.status !== "cancelled");
  const startHandoffPending = Boolean(startReceipt && ["queued", "starting", "blocked", "paused"].includes(startReceipt.status));
  const executionContractReady = item.executionContractGate?.ready === true;
  const reviewContractCurrent = item.reviewContract?.supersededByGoalRevision !== true;
  const reviewAcceptanceCriteria = reviewContractCurrent
    ? item.reviewContract?.acceptanceCriteria ?? item.acceptanceCriteria
    : item.acceptanceCriteria;
  const reviewVerificationSop = reviewContractCurrent
    ? item.reviewContract?.verificationSop ?? item.verificationSop ?? []
    : item.verificationSop ?? [];
  const executionContractDefined = Boolean(
    item.acceptanceCriteria.length
    && item.verificationSop?.length
    && item.executionContractConfirmedAt,
  );
  const executionPlanPrepared = Boolean(item.acceptanceCriteria.length && item.verificationSop?.length);
  const scheduleConflict = hasManagedExecution && Boolean(item.dueDate && item.plannedDate && item.plannedDate > item.dueDate);
  const collaborationStage = status === "completed"
    ? 3
    : status === "ready_for_review"
      ? 2
      : hasManagedExecution
      ? 1
      : 0;
  const startEligible = ["not_started", "scheduled"].includes(status) && !hasBoundAutoRun && !observability?.latestRun && !startRequestActive;
  const canCorrectMyTemplate = Boolean(item.myTemplateBinding && startEligible && canOperate);
  const materialExecutionBlocked = (item.recordBindings ?? []).some((binding) =>
    ["stale", "needs_confirmation", "unavailable"].includes(binding.resolution.state));
  const canStartAi = startEligible && readiness?.ready === true && !materialExecutionBlocked;
  const canCorrectTaskContext = canOperate
    && item.state !== "closed"
    && status !== "completed"
    && !hasManagedExecution
    && !startRequestActive;
  const readinessBlocked = startEligible && readiness?.ready === false;
  const readinessChecking = startEligible && readiness == null;
  const readinessWarnings = readiness?.checks.filter((check) => check.status === "warn") ?? [];
  const readableReadiness = readiness ? {
    ...readiness,
    checks: readiness.checks.map((check) => readableAutoRunReadinessCheck(check, language)),
  } : null;
  const startSummary = deriveExecutionStartSummary({
    item,
    project: consoleState?.projects?.find((project) => project.id === item.projectId) ?? null,
    readiness: readableReadiness,
    language,
  });
  const contextHasBlockingIssues = startSummary.issues.some((issue) => issue.severity === "blocking");
  const intentConflictResolution = startSummary.clarification?.resolution ?? null;
  const primaryUsesProgress = (["not_started", "scheduled", "ai_working", "waiting"].includes(status)
    || (status === "needs_action" && item.waitingOn === "me" && !["failed", "awaiting_approval"].includes(item.executionState ?? ""))
    || (status === "blocked" && !observability?.latestRun)) && !startEligible;
  const retryableRun = failed && observability?.latestRun
    && ["failed", "blocked"].includes(observability.latestRun.status)
    ? observability.latestRun
    : null;
  const retryableLegacyExecution = Boolean(
    failed
      && !observability?.latestRun
      && executionKind === "application_invocation"
      && executionReview?.state === "failed"
      && executionReview.targetStatus === "failed",
  );
  const hasRetryableExecution = Boolean(retryableRun || retryableLegacyExecution);
  const phaseDescription = aiPhaseDescription(observability?.latestRun?.phase, language);
  const understandingContext = observability?.latestRun?.understandingContext ?? null;
  const pendingClarification = observability?.latestRun?.status === "needs_input"
    && !observability.latestRun.clarifyAnswer;
  const clarificationSectionId = `work-item-human-action-${item.id}`;
  const firstClarificationQuestion = observability?.latestRun?.decision?.clarifyingQuestions?.find(Boolean) ?? null;
  const unresolvedDependency = item.blockedBy?.find((dependency) => !dependency.resolved) ?? null;
  const primaryGuidance = startHandoffPending
    ? (language === "zh"
        ? "AI 启动请求已经保存；排队或待处理情况会在当前任务中持续更新。"
        : "The AI start request is saved. Queue and action updates will continue in this task.")
    : pendingClarification
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
  const officeBatchResultId = `work-item-office-batch-${item.id}`;
  const acceptancePassed = reviewAcceptanceCriteria.filter((criterion) =>
    (item.reviewEvidence ?? item.acceptanceResults ?? []).some((result) => result.criterion === criterion && result.status === "passed")).length;
  const acceptanceNeedsReview = reviewAcceptanceCriteria.length - acceptancePassed;
  const latestPassedVerification = [...(item.verificationRecords ?? [])].reverse().find((record) => record.status === "passed") ?? null;
  const outputAssets = item.outputAssets ?? [];
  const outcome = observability?.outcome ?? null;
  const deliveryReport = observability?.delivery?.report ?? observability?.latestRun?.deliveryReport ?? null;
  const deliveryAiReview = observability?.delivery?.aiReview ?? observability?.latestRun?.deliveryReview ?? null;
  const deliveryReview = observability?.delivery?.review ?? null;
  const deliveryEvidence: LocalWorkItemDeliveryEvidence | null = observability?.deliveryEvidence
    ?? observability?.delivery?.evidence
    ?? null;
  const reviewFindings = deliveryEvidence?.review.findings?.length
    ? deliveryEvidence.review.findings.map((finding) => ({
      path: finding.file,
      body: finding.message,
      ...(finding.line ? { line: finding.line } : {}),
      severity: finding.severity,
      ...(finding.suggestion ? { suggestion: finding.suggestion } : {}),
    }))
    : deliveryReview?.comments?.length
    ? deliveryReview.comments
    : (deliveryAiReview?.findings ?? []).map((finding) => ({
      path: finding.file,
      body: finding.message,
      ...(finding.line ? { line: finding.line } : {}),
      severity: finding.severity,
      ...(finding.suggestion ? { suggestion: finding.suggestion } : {}),
    }));
  const changedFiles = deliveryEvidence?.actionPreview.changedFiles ?? deliveryReport?.changedFiles ?? [];
  const deliveryWorktreeId = observability?.delivery?.worktreeId ?? observability?.latestRun?.localDelivery?.worktreeId ?? null;
  const resultSummary = outcome?.summary ?? deliveryReport?.summary ?? item.lastProgressSummary
    ?? (executionKind === "article_import" ? latestPassedVerification?.summary ?? null : null);
  const fullResult = outcome?.fullReport ?? deliveryReport?.summary ?? item.lastProgressSummary ?? null;
  const persistedLocalDelivery = observability?.latestRun?.localDelivery;
  const completedLocalDeliveryReceipt = localDeliveryReceipt ?? (
    persistedLocalDelivery?.mode === "local_merge" && persistedLocalDelivery.deliveredAt
      ? {
          baseBranch: persistedLocalDelivery.baseBranch ?? null,
          deliveredCommit: persistedLocalDelivery.deliveredCommit ?? null,
          deliveredAt: persistedLocalDelivery.deliveredAt,
        }
      : null
  );
  const objectiveResultVerification = item.resultVerification ?? null;
  const resultVerification = outcome?.verification ?? deliveryReport?.verification
    ?? (objectiveResultVerification && objectiveResultVerification.status !== "not_required"
      ? {
          verified: true,
          passed: objectiveResultVerification.status === "passed",
          summary: objectiveResultVerification.summary,
        }
      : null)
    ?? (latestPassedVerification && acceptanceNeedsReview === 0
      ? { verified: true, passed: true, summary: latestPassedVerification.summary }
      : null);
  const failedResultChecks = objectiveResultVerification
    ? [...objectiveResultVerification.checks, ...objectiveResultVerification.verificationChecks]
      .filter((check) => check.status === "failed")
    : [];
  const resultRepairNeeded = Boolean(
    objectiveResultVerification?.status === "failed"
    && objectiveResultVerification.repair?.required
    && (["review", "blocked", "done"].includes(item.status) || item.state === "closed"),
  );
  const canCreateResultRepair = canOperate && resultRepairNeeded;
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
    reviewVerdict: deliveryEvidence?.review.verdict ?? deliveryReview?.verdict ?? deliveryAiReview?.verdict ?? null,
    reviewStatus: deliveryEvidence?.review.status ?? deliveryAiReview?.status ?? null,
    reviewFindings,
    reviewSummary: deliveryEvidence?.review.summary ?? deliveryReview?.summary ?? deliveryAiReview?.summary ?? null,
    evidenceStatus: deliveryEvidence?.status ?? null,
    evidenceRisk: deliveryEvidence?.risk ?? null,
    evidenceDomain: deliveryEvidence?.domain ?? null,
    verification: deliveryEvidence?.verification.status
      ? { passed: deliveryEvidence.verification.passed === true, verified: deliveryEvidence.verification.verified, summary: deliveryEvidence.verification.summary }
      : resultVerification,
    executionKind,
    taskKind: item.taskKind,
    taskText: `${item.title}\n${item.body}`,
    resultFiles,
  });
  const deliveryEvidenceNotReady = Boolean(deliveryEvidence
    && (!deliveryEvidence.actionPreview.canProceed || deliveryDecision.state !== "ready" || deliveryDecision.risk !== "low"));
  const intentSummary = deriveWorkItemIntentSummary({ item, domain: deliveryDecision.domain, language, completed: status === "completed", reviewIntent });
  const deliveryMode = observability?.delivery?.mode ?? null;
  const officeDelivery = deliveryDecision.domain === "office";
  const deliveryOperation = deliveryEvidence?.actionPreview.operation ?? null;
  const deliveryBlockedReasonCodes = deliveryEvidence?.actionPreview.blockedReasonCodes ?? [];
  const confirmResultWithoutDelivery = reviewIntent?.source === "frozen_execution_contract"
    ? reviewIntent.confirmation.resultOnly
    : deliveryDecision.state === "ready"
      && deliveryDecision.risk === "low"
      && deliveryEvidence?.status === "ready"
      && deliveryBlockedReasonCodes.length === 1
      && deliveryBlockedReasonCodes[0] === "delivery_action_forbidden_by_intent";
  const legacyConfirmActionEffect = confirmResultWithoutDelivery
    ? language === "zh"
      ? "只记录你已确认结果并完成任务；变更继续保留在当前未提交工作树中，不会写入基础分支、创建提交、创建 PR 或推送远程。"
      : "Only record your result confirmation and complete the task. The change remains in the current uncommitted worktree and is not applied, committed, opened as a pull request, or pushed."
    : deliveryDecision.confirmEffect;
  const legacyConfirmActionRisk = confirmResultWithoutDelivery
    ? language === "zh"
      ? "较低：不会修改基础分支或外部系统；请确认你接受由当前未提交工作树继续保管结果。"
      : "Low: the base branch and external systems are unchanged. Confirm that the current uncommitted worktree should continue to hold the result."
    : deliveryDecision.confirmRisk;
  const updatesPullRequest = deliveryOperation === "update_pull_request";
  const legacyAcceptActionLabel = confirmResultWithoutDelivery
    ? language === "zh" ? "确认结果并完成任务（不应用）" : "Approve result and complete without applying"
    : deliveryMode === "pull_request"
    ? updatesPullRequest
      ? officeDelivery
        ? language === "zh" ? "审核通过并更新办公结果 PR" : "Approve and update office result PR"
        : language === "zh" ? "审核通过并更新 Pull Request" : "Approve and update pull request"
      : officeDelivery
        ? language === "zh" ? "审核通过并创建办公结果 PR" : "Approve and create office result PR"
        : language === "zh" ? "审核通过并创建 Pull Request" : "Approve and create pull request"
    : officeDelivery
      ? language === "zh" ? "审核通过并应用办公结果" : "Approve and apply office result"
    : deliveryMode === "local_merge"
      ? language === "zh" ? "审核通过并应用到本地" : "Approve and apply locally"
      : language === "zh" ? "审核通过并完成任务" : "Approve and complete task";
  const deliveryRun = observability?.latestRun;
  const isDevelopmentDelivery = deliveryEvidence?.domain === "development"
    || (!officeDelivery && deliveryMode != null && Boolean(deliveryWorktreeId));
  const canRerunVerification = Boolean(
    isDevelopmentDelivery
      && deliveryRun
      && ["done", "pr_open", "blocked", "cancelled"].includes(deliveryRun.status),
  );
  const deliveryNeedsAiFix = Boolean(
    ["changes_requested", "verification_failed"].includes(deliveryEvidence?.status ?? "")
      || deliveryEvidence?.review.verdict === "changes_requested"
      || deliveryReview?.verdict === "changes_requested"
      || deliveryAiReview?.verdict === "changes_requested"
      || (resultVerification?.verified === true && resultVerification.passed === false)
      || ["failed", "blocked"].includes(deliveryRun?.status ?? ""),
  );
  const canAskAiToFix = Boolean(
    isDevelopmentDelivery
      && deliveryRun
      && deliveryNeedsAiFix
      && (["failed", "blocked"].includes(deliveryRun.status)
        || ["done", "report_posted", "plan_proposed", "pr_open"].includes(deliveryRun.status)),
  );
  const legacyAcceptDialogTitle = confirmResultWithoutDelivery
    ? language === "zh" ? "确认结果并完成任务？" : "Approve the result and complete the task?"
    : deliveryMode === "pull_request"
    ? updatesPullRequest
      ? language === "zh" ? "确认审核通过并更新现有 Pull Request？" : "Approve and update the existing pull request?"
      : language === "zh" ? "确认审核通过并创建 Pull Request？" : "Approve and create a pull request?"
    : officeDelivery
      ? language === "zh" ? "确认审核通过并应用办公结果？" : "Approve and apply the office result?"
    : deliveryMode === "local_merge"
      ? language === "zh" ? "确认审核通过并应用到本地？" : "Approve and apply this delivery locally?"
      : copy.acceptTitle;
  const legacyAcceptDialogDescription = confirmResultWithoutDelivery
    ? language === "zh"
      ? "系统只会记录你已确认结果并完成任务；变更继续保留在未提交工作树中，不会应用到主分支、创建提交、创建 PR 或推送远程。"
      : "Only your result confirmation and task completion will be recorded. The change remains in the uncommitted worktree and will not be applied, committed, opened as a pull request, or pushed."
    : deliveryMode === "pull_request"
    ? updatesPullRequest
      ? language === "zh"
        ? "系统会先把当前分支的最新改动推送到已有 Pull Request；不会新建重复 PR，也不会直接合并远端主分支。"
        : "The latest branch changes will be pushed to the existing pull request. No duplicate PR will be created and the remote base branch will not be merged."
      : language === "zh"
        ? "系统会用当前交付创建一个待审核的 Pull Request，不会直接合并到远端主分支。创建后，本地任务继续保留在审核阶段。"
        : "The current delivery will become a reviewable pull request without merging into the remote base branch. The local task remains in review afterward."
    : officeDelivery
      ? language === "zh"
        ? "系统只会应用当前预览中的办公结果和范围；不会自动对外发送、删除其他资料或扩大处理范围。"
        : "Only the office result and scope shown in the preview will be applied. Nothing will be sent externally, deleted, or expanded automatically."
    : deliveryMode === "local_merge"
      ? language === "zh"
        ? "系统会把已审核的 Worktree 改动应用到本地基准分支并完成任务；不会推送或合并任何远端分支。"
        : "The reviewed worktree changes will be applied to the local base branch and the task will be completed. No remote branch will be pushed or merged."
      : copy.acceptDescription;
  const legacyAcceptDialogConfirm = confirmResultWithoutDelivery
    ? language === "zh" ? "确认完成，不应用" : "Complete without applying"
    : deliveryMode === "pull_request"
    ? updatesPullRequest
      ? language === "zh" ? "确认更新 Pull Request" : "Update pull request"
      : language === "zh" ? "确认创建 Pull Request" : "Create pull request"
    : officeDelivery
      ? language === "zh" ? "确认应用办公结果" : "Apply office result"
    : deliveryMode === "local_merge"
      ? language === "zh" ? "确认应用到本地" : "Apply locally"
      : copy.acceptConfirm;
  const reviewConfirmation = reviewIntentConfirmationCopy({
    reviewIntent,
    language,
    fallback: {
      actionLabel: legacyAcceptActionLabel,
      dialogTitle: legacyAcceptDialogTitle,
      dialogDescription: legacyAcceptDialogDescription,
      dialogConfirm: legacyAcceptDialogConfirm,
      effect: legacyConfirmActionEffect,
      risk: legacyConfirmActionRisk,
    },
  });
  const acceptActionLabel = reviewConfirmation.actionLabel;
  const acceptDialogTitle = reviewConfirmation.dialogTitle;
  const acceptDialogDescription = reviewConfirmation.dialogDescription;
  const acceptDialogConfirm = reviewConfirmation.dialogConfirm;
  const confirmActionEffect = reviewConfirmation.effect;
  const confirmActionRisk = reviewConfirmation.risk;
  const reviewFeedback = reviewFindings.map((finding) => [
    `${finding.severity ? `[${finding.severity}] ` : ""}${finding.path ?? "Code"}${finding.line ? `:${finding.line}` : ""}: ${finding.body}`,
    finding.suggestion ? `Suggested fix: ${finding.suggestion}` : null,
  ].filter(Boolean).join("\n")).join("\n\n");
  const askAiFixFeedback = reviewFeedback?.trim()
    || deliveryEvidence?.verification.summary?.trim()
    || (language === "zh" ? "请根据当前复核和验证结果修复问题，保持任务范围不变，并重新运行验证。" : "Fix the issues identified by the current review and verification, keep the scope unchanged, and rerun verification.");
  let executionController: ReturnType<typeof createWorkItemExecutionController>;

  const openResultFile = async (file: WorkItemOutcomeFile) => {
    if (!file.contentId && (!file.projectId || !file.path || (file.preview === "unsupported" && !file.worktreeId))) {
      setResultFileError(copy.deliverableFileUnavailable);
      return;
    }
    const requestId = resultPreviewRequest.current + 1;
    resultPreviewRequest.current = requestId;
    const key = deliverableFileKey(file);
    setResultPreviewFile(file);
    setResultPreview(null);
    setOpeningResultFileKey(key);
    setResultFileError(null);
    try {
      if (file.contentId) {
        const response = await localContentApi.preview(file.contentId);
        if (requestId !== resultPreviewRequest.current) return;
        const preview = response.preview;
        const extension = deliveryExtension(file.name);
        setResultPreview({
          kind: MARKDOWN_DELIVERY_EXTENSIONS.has(extension) || preview.mimeType === "text/markdown" ? "markdown" : "text",
          text: preview.text,
          truncated: preview.truncated,
        });
        return;
      }
      if (!file.projectId || !file.path) throw new Error("deliverable_file_unavailable");
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

  const createResultRepair = async () => {
    if (!canCreateResultRepair || repairPending) return;
    setRepairPending(true);
    setRepairError(null);
    try {
      const result = await api.createWorkItemResultRepair(item.id) as {
        workItem?: LocalWorkItem;
        replayed?: boolean;
      };
      if (!result.workItem?.id) throw new Error("result_repair_missing");
      window.dispatchEvent(new Event("myagenttool:state-change"));
      if (onOpenWorkItem) {
        onOpenWorkItem(result.workItem.id);
      } else {
        setSyncNotice(language === "zh"
          ? result.replayed ? "已找到之前创建的返工任务。" : "已创建独立返工任务，原结果保持不变。"
          : result.replayed ? "The existing repair task is ready." : "An independent repair task was created; the original result is unchanged.");
        setRefreshVersion((version) => version + 1);
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      setRepairError(language === "zh"
        ? code.includes("not_required")
          ? "结果已经通过检查，不需要再创建返工任务。"
          : code.includes("not_ready")
            ? "当前任务还在执行，请等结果出来后再处理。"
            : "返工任务暂时未创建，请稍后重试。"
        : code.includes("not_required")
          ? "The result now passes its checks, so no repair task is needed."
          : code.includes("not_ready")
            ? "This task is still running. Wait for the result before creating a repair."
            : "The repair task could not be created. Try again.");
    } finally {
      setRepairPending(false);
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
  const refreshRecordBinding = async (binding: NonNullable<LocalWorkItem["recordBindings"]>[number]) => {
    if (recordBindingRefreshPendingId || !binding.record || (item.executionBindings ?? []).length) return;
    setRecordBindingRefreshPendingId(binding.id);
    setRecordBindingRefreshError(null);
    try {
      const response = await api.refreshWorkItemRecordBinding(
        item.id,
        binding.id,
        item.revision,
      ) as { workItem: LocalWorkItem };
      setItem(response.workItem);
      setSyncNotice(language === "zh" ? "业务资料已刷新并确认，任务将使用当前记录版本。" : "The business material was refreshed and confirmed; the task will use the current record version.");
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-record-binding-refresh", workItemId: item.id } }));
    } catch {
      setRecordBindingRefreshError(language === "zh" ? "业务资料暂时无法刷新，请稍后重试。" : "The business material could not be refreshed. Try again later.");
    } finally {
      setRecordBindingRefreshPendingId(null);
    }
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
        ? "已记住这次做法，正在等待你检查并启用；不会改变原任务，也不会立即用于其他工作。"
        : "This approach was saved for review and activation. The original task is unchanged and it will not be used for other work yet.");
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "my-template-draft", workItemId: item.id } }));
    } catch {
      setTemplateDraftError(language === "zh" ? "暂时无法记住这次做法，请稍后重试。" : "This approach could not be saved. Try again later.");
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
  const updateTaskContext = async (update: TaskContextUpdate) => {
    if (actionPending || !canCorrectTaskContext) throw new Error("work_item_context_locked");
    setActionPending("context");
    setActionError(null);
    try {
      const response = await api.updateWorkItemTaskContext(item.id, {
        expectedRevision: item.revision,
        ...update,
      }) as { workItem: LocalWorkItem };
      setItem(response.workItem);
      setSyncNotice(language === "zh" ? "任务范围已更新，启动确认会使用最新设置。" : "Task scope updated. Start confirmation will use the latest settings.");
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-task-context", workItemId: item.id } }));
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "work_item_revision_conflict") {
        setRefreshVersion((version) => version + 1);
      }
      throw caught;
    } finally {
      setActionPending(null);
    }
  };
  const resolveIntentClarification = async (option: ExecutionStartClarificationOption) => {
    const clarification = startSummary.clarification;
    if (!clarification) return;
    if (option.applyMode === "manual") {
      setStartConfirmationOpen(false);
      if (clarification.resolution === "task_context") {
        window.requestAnimationFrame(() => document.querySelector('[data-testid="work-item-context-card"]')?.scrollIntoView?.({ behavior: "smooth", block: "center" }));
      } else {
        onOpenExpert("overview");
      }
      return;
    }
    if (actionPending || !canCorrectTaskContext || !item.intentContract?.digest) return;
    setActionPending("context");
    setActionError(null);
    try {
      const response = await api.updateWorkItemTaskContext(item.id, {
        expectedRevision: item.revision,
        intentResolution: {
          idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `intent-resolution-${item.id}-${Date.now()}`,
          expectedIntentDigest: item.intentContract.digest,
          conflictCode: clarification.code,
          choiceId: option.id,
        },
      }) as { workItem: LocalWorkItem };
      setItem(response.workItem);
      setSyncNotice(language === "zh"
        ? "已按你的选择更新任务理解，请复核后再开始。"
        : "Task intent updated from your choice. Review it before starting.");
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-intent-clarification", workItemId: item.id } }));
    } catch (caught) {
      if (caught instanceof ApiError && ["work_item_revision_conflict", "work_item_intent_clarification_stale", "work_item_intent_clarification_changed"].includes(caught.code)) {
        setRefreshVersion((version) => version + 1);
        setActionError(language === "zh" ? "任务内容已变化，已刷新最新理解，请重新选择。" : "The task changed. The latest intent is being refreshed; choose again.");
      } else {
        setActionError(language === "zh" ? "未能应用这个选择，请重试。" : "This choice could not be applied. Try again.");
      }
    } finally {
      setActionPending(null);
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
    const confirmationActionKind = confirmResultWithoutDelivery ? "review_result" : deliveryOperation ?? "review_result";
    if (!executionController.reviewActions.isEnabled(confirmationActionKind, confirmResultWithoutDelivery || !deliveryEvidenceNotReady)) {
      setActionError(language === "zh" ? "任务状态或交付证据已经变化，请刷新后重新确认。" : "The task state or delivery evidence changed. Refresh before confirming again.");
      return;
    }
    if (!executionContractReady) {
      setActionError(language === "zh"
        ? "这次执行开始前没有确认完整的完成标准和检查步骤，不能形成正式审核结论。请补全后重新运行。"
        : "This run did not start with confirmed acceptance criteria and a verification SOP, so it cannot produce a formal approval result. Complete the execution plan and rerun it.");
      return;
    }
    if (observability?.delivery && observability.delivery.review?.verdict !== "approved") {
      setActionError(copy.deliveryReviewRequired);
      return;
    }
    if (!executionController.reviewActions.usesProjection && deliveryEvidenceNotReady) {
      setActionError(language === "zh" ? "当前复核或验证证据还不完整，不能确认交付。请先处理预览中的阻塞原因。" : "The review or verification evidence is incomplete, so delivery cannot be confirmed yet. Resolve the blockers shown in the preview first.");
      return;
    }
    setActionPending("complete");
    setActionError(null);
    setDeliveryRecovery(null);
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
      const response: {
        workItem: LocalWorkItem;
        actionReceipt?: ExecutionActionReceipt;
        delivery?: {
          baseBranch?: string | null;
          deliveredCommit?: string | null;
          deliveredAt?: string | null;
        };
      } = observability?.delivery && !confirmResultWithoutDelivery
        ? await api.deliverWorkItem(
            current.id,
            observability.delivery.mode,
            current.revision,
            executionActionRequest(deliveryOperation
              ?? (observability.delivery.mode === "pull_request" ? "create_pull_request" : "apply_local_changes")),
          ) as {
            workItem: LocalWorkItem;
            actionReceipt?: ExecutionActionReceipt;
            delivery?: {
              baseBranch?: string | null;
              deliveredCommit?: string | null;
              deliveredAt?: string | null;
            };
          }
        : await api.transitionWorkItem(current.id, "close", current.revision) as { workItem: LocalWorkItem };
      setItem(response.workItem);
      if (response.actionReceipt) setExecutionActionReceipt(response.actionReceipt);
      if (observability?.delivery?.mode === "local_merge" && !confirmResultWithoutDelivery) {
        setLocalDeliveryReceipt({
          baseBranch: response.delivery?.baseBranch ?? null,
          deliveredCommit: response.delivery?.deliveredCommit ?? observability.delivery.review?.reviewedCommit ?? null,
          deliveredAt: response.delivery?.deliveredAt ?? response.workItem.updatedAt ?? null,
        });
      }
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
    } catch (error) {
      const failure = observability?.delivery?.mode === "local_merge" && !confirmResultWithoutDelivery ? localDeliveryFailure(error, language) : null;
      setActionError(failure?.message ?? copy.completionFailed);
      setDeliveryRecovery(failure?.action ?? null);
      setRefreshVersion((version) => version + 1);
    } finally {
      setActionPending(null);
    }
  };
  const runDeliveryRecovery = () => {
    const recovery = deliveryRecovery;
    setAcceptOpen(false);
    setActionError(null);
    setDeliveryRecovery(null);
    if (recovery === "review_changes" && deliveryWorktreeId) {
      if (onOpenDeliveryChanges) onOpenDeliveryChanges(item.projectId, deliveryWorktreeId);
      else onOpenExpert("process");
      return;
    }
    setRefreshVersion((version) => version + 1);
  };
  const runPrimaryAction = () => {
    if (hasRetryableExecution && executionActionLocked) return;
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
    if (hasRetryableExecution) {
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
      if (readinessChecking) return;
      if (!executionPlanPrepared) {
        void prepareStartExecutionPlan();
        return;
      }
      setActionError(null);
      setStartConfirmationOpen(true);
      return;
    }
    if (startHandoffPending) {
      onOpenExpert("process");
      return;
    }
    if (primaryUsesProgress) {
      setProgressOpen(true);
      return;
    }
    onOpenExpert(expertSectionFor(item, status));
  };
  const openReviewResult = (targetId = resultSectionId) => {
    setResultExpanded(true);
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  };
  const openDeliveryConfirmation = () => {
    if (actionPending || (!executionController.reviewActions.usesProjection && deliveryEvidenceNotReady)) return;
    setCompletionWriteback("local_only");
    setAcceptOpen(true);
  };
  const openPullRequestConfirmation = () => {
    const actionKind = deliveryOperation ?? "create_pull_request";
    if (actionPending || deliveryMode !== "pull_request"
      || !executionController.reviewActions.isEnabled(actionKind, !deliveryEvidenceNotReady)) return;
    if (observability?.delivery?.review?.verdict !== "approved") {
      setActionError(copy.deliveryReviewRequired);
      return;
    }
    setCompletionWriteback("local_only");
    setAcceptOpen(true);
  };
  executionController = createWorkItemExecutionController({
    item,
    observability,
    executionReview,
    effectiveReceipt: effectiveExecutionActionReceipt,
    pendingTemplateClarification,
    actionPending,
    executionContractDefined,
    canStartAi,
    changeRequest,
    feedbackMode,
    canRerunVerification,
    canAskAiToFix,
    askAiFixFeedback,
    clarifyAnswer,
    clarifyPending,
    clarifyStopPending,
    retryPending,
    hasRetryableExecution,
    retryableLegacyExecution,
    retryableRun,
    language,
    copy,
    effects: {
      setItem,
      setReadiness,
      setPending: (pending) => setActionPending(pending),
      setActionError,
      setNotice: setSyncNotice,
      setReceipt: setExecutionActionReceipt,
      refresh: () => setRefreshVersion((version) => version + 1),
      setStartConfirmationOpen,
      setPendingTemplateClarification,
      setChangeRequest,
      setChangeRequestOpen,
      setResultExpanded,
      setReportOpen,
      setMaterialNotice,
      setClarifyAnswer,
      setClarifyPending,
      setClarifyStopPending,
      setClarifyError,
      setRetryOpen,
      setRetryPending,
      setRetryError,
    },
    reviewHandlers: {
      runPrimaryAction,
      openReviewResult,
      openDetails: () => onOpenExpert("process"),
      viewChanges: () => {
        if (deliveryWorktreeId && onOpenDeliveryChanges) onOpenDeliveryChanges(item.projectId, deliveryWorktreeId);
        else onOpenExpert("process");
      },
      viewBatchDetails: () => openReviewResult(officeBatchResultId),
      openPullRequestConfirmation,
      openDeliveryConfirmation,
    },
  });
  const {
    actionRequest: executionActionRequest,
    executionActionLocked,
    prepareReviewExecutionPlan,
    prepareStartExecutionPlan,
    choosePendingTemplateResult,
    startAiWork,
    sendChangeRequest,
    rerunDeliveryVerification,
    askAiToFix,
    answerAiClarification,
    setAutomaticExecution,
    cancelPendingExecutionStart,
    recheckPendingExecutionStart,
    stopAiClarification,
    retryAiWork,
    runExecutionReviewAction,
    reconcileExecutionReviewAction,
  } = executionController;
  const reviewActionController = executionController.reviewActions;
  const savePlanActualFeedback = async (input: {
    decisions: Array<{ code: string; resolution: "keep_plan" | "prefer_actual" }>;
    note: string;
  }) => {
    const planActual = observability?.planActual;
    if (!planActual) throw new Error("plan_actual_not_available");
    const response = await api.recordWorkItemPlanActualFeedback(item.id, {
      expectedPlanActualDigest: planActual.digest,
      decisions: input.decisions,
      note: input.note,
    }) as { planActual: NonNullable<LocalWorkItemObservability["planActual"]> };
    setObservability((current) => current ? { ...current, planActual: response.planActual } : current);
    setSyncNotice(language === "zh"
      ? "已记住这次纠正，只用于以后相似任务；本次执行记录保持不变。"
      : "This correction was saved for future similar tasks. The current execution record remains unchanged.");
  };
  const executionReviewActionPending = executionReview?.recommendedAction.kind === "retry_execution"
    ? retryPending
    : executionReview?.recommendedAction.kind === "fix_with_ai"
      ? actionPending === "changes"
      : executionReview?.recommendedAction.kind === "rerun_verification"
        ? actionPending === "reverify"
        : executionReview?.recommendedAction.kind === "answer_ai"
          ? clarifyPending
          : false;
  const executionReviewPendingActionKind = retryPending
    ? "retry_execution"
    : actionPending === "changes"
      ? "fix_with_ai"
      : actionPending === "reverify"
        ? "rerun_verification"
        : actionPending === "complete"
          ? confirmResultWithoutDelivery ? "review_result" : deliveryOperation
          : clarifyPending
            ? "answer_ai"
            : null;
  const deliveryReviewActionKind = confirmResultWithoutDelivery ? "review_result" : deliveryOperation ?? "review_result";
  const canConfirmProjectedDelivery = reviewActionController.isEnabled(deliveryReviewActionKind, confirmResultWithoutDelivery || !deliveryEvidenceNotReady);
  const canViewProjectedChanges = reviewActionController.isEnabled("view_changes", Boolean(deliveryWorktreeId && onOpenDeliveryChanges));
  const canRerunProjectedVerification = reviewActionController.isEnabled("rerun_verification", canRerunVerification);
  const canRequestProjectedAiFix = reviewActionController.isEnabled("fix_with_ai", canAskAiToFix);
  const canOpenProjectedPullRequest = reviewActionController.isEnabled(deliveryOperation ?? "create_pull_request", deliveryMode === "pull_request" && !deliveryEvidenceNotReady);

  return (
    <div className="space-y-4" data-testid="work-item-summary-view">
      <header className="pr-8">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
          {item.executionPolicy === "auto" && !startReceipt?.canCancel ? <Button size="sm" variant="ghost" disabled={Boolean(actionPending)} onClick={() => void setAutomaticExecution("paused")}>
            {language === "zh" ? "暂停后续 AI 处理" : "Pause future AI work"}
          </Button> : null}
          {item.executionPolicy === "paused" && startReceipt?.status !== "cancelled" ? <Button size="sm" variant="secondary" disabled={Boolean(actionPending)} onClick={() => void setAutomaticExecution("auto")}>
            <Bot aria-hidden />{language === "zh" ? "恢复 AI 自动处理" : "Resume automatic AI work"}
          </Button> : null}
        </div> : null}
      </header>

      <WorkItemIntentCard
        summary={intentSummary}
        language={language}
        onEdit={canOperate && status !== "completed" ? () => onOpenExpert("overview") : undefined}
      />

      <WorkItemContextCard
        summary={item.taskContextSummary}
        language={language}
        onOpenChannel={item.taskContextSummary?.origin.kind === "channel" && onOpenSetup ? () => onOpenSetup("channels") : undefined}
        onUpdate={canCorrectTaskContext ? updateTaskContext : undefined}
        lockedReason={!canCorrectTaskContext && hasManagedExecution
          ? (language === "zh" ? "任务已经开始，本次使用的资料范围和版本已锁定；后续调整只会在下一次执行生效。" : "This run's material scope and versions are locked. Later changes only apply to the next run.")
          : null}
      />

      {startReceipt && !showExecutionReview ? (
        <ExecutionStartStatusCard
          receipt={startReceipt}
          language={language}
          agentName={startReceipt.agentId ? consoleState?.agents?.find((agent) => agent.id === startReceipt.agentId)?.name ?? startReceipt.agentId : null}
          pendingAction={actionPending === "cancel-start" ? "cancel" : actionPending === "recheck-start" ? "recheck" : null}
          onRecheck={() => { void recheckPendingExecutionStart(); }}
          onCancel={startReceipt.canCancel && canOperate ? () => { void cancelPendingExecutionStart(); } : undefined}
          onOpenDetails={() => onOpenExpert("process")}
        />
      ) : null}

      {executionReview && showExecutionReview ? (
        <ExecutionReviewCard
          review={executionReview}
          language={language}
          agentName={executionReview.agentId ? consoleState?.agents?.find((agent) => agent.id === executionReview.agentId)?.name ?? executionReview.agentName ?? executionReview.agentId : executionReview.agentName}
          onOpenDetails={() => onOpenExpert("process")}
          onRecommendedAction={runExecutionReviewAction}
          onAction={runExecutionReviewAction}
          onReconcileAction={() => void reconcileExecutionReviewAction()}
          recommendedActionPending={executionReviewActionPending}
          pendingActionKind={executionReviewPendingActionKind}
          reconcileActionPending={actionPending === "reconcile"}
          actionReceipt={executionReview.actionReceipt ?? executionActionReceipt}
          attemptHistory={observability?.runHistory ?? []}
        />
      ) : null}

      {observability?.completionAssessment ? (
        <WorkItemCompletionStatus assessment={observability.completionAssessment} journey={observability.journey} language={language} />
      ) : null}

      {observability?.planActual ? (
        <WorkItemPlanActualCard
          plan={observability.planActual}
          language={language}
          onOpenDetails={() => onOpenExpert("process")}
          onSaveFeedback={canOperate ? savePlanActualFeedback : undefined}
        />
      ) : null}

      {status !== "completed" && !executionReviewOwnsProgress ? <section className="rounded-xl border border-primary/30 bg-primary/[0.055] p-4" aria-labelledby={`work-item-next-${item.id}`}>
        <div className="flex gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><CircleDot className="size-4" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h4 id={`work-item-next-${item.id}`} className="text-sm font-semibold">{copy.progress}</h4>
            <p className="mt-1 text-sm leading-relaxed text-foreground/90">{primaryGuidance}</p>
            {item.lastProgressSummary ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{copy.lastProgress}: {item.lastProgressSummary}</p> : null}
            <Button
              ref={startActionRef}
              className="mt-3 w-full sm:w-auto"
              data-testid={startEligible ? "review-and-start-ai" : undefined}
              disabled={Boolean(actionPending) || readinessChecking || (hasRetryableExecution && executionActionLocked)}
              aria-expanded={status === "ready_for_review" ? resultExpanded : undefined}
              aria-controls={status === "ready_for_review" ? resultSectionId : undefined}
              onClick={runPrimaryAction}
            >
              {pendingClarification
                ? canOperate ? language === "zh" ? "回答 AI" : "Answer AI" : language === "zh" ? "查看问题" : "View question"
                : unresolvedDependency
                  ? language === "zh" ? "查看前置任务" : "View prerequisite"
                : hasRetryableExecution
                ? copy.retryAi
                : startHandoffPending
                  ? (language === "zh" ? "查看执行详情" : "Execution details")
                : startEligible
                  ? actionPending === "start"
                    ? copy.startingAi
                    : readinessChecking
                      ? copy.readinessChecking
                      : executionPlanPrepared
                        ? (language === "zh" ? "核对并让 AI 开始" : "Review and start AI")
                        : copy.startAi
                  : resultExpanded ? copy.hideResult : copy.action[status]}
              {hasRetryableExecution || startEligible || status !== "ready_for_review"
                ? <ArrowRight aria-hidden />
                : <ChevronDown className={`transition-transform ${resultExpanded ? "rotate-180" : ""}`} aria-hidden />}
            </Button>
            {startEligible ? <Button className="mt-2 w-full sm:ml-2 sm:w-auto" variant="ghost" disabled={Boolean(actionPending)} onClick={() => setProgressOpen(true)}>{copy.updateProgress}</Button> : null}
          </div>
        </div>
      </section> : null}

      <WorkItemJobOverview item={item} language={language} onOpenWorkItem={onOpenWorkItem} />

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
                    : language === "zh" ? "将按任务的检查步骤验证" : "The task verification steps will be used"}</p>
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
        && !observability.latestRun.clarifyAnswer ? (
          <section id={clarificationSectionId} className="rounded-xl border border-warning/35 bg-warning/[0.055] p-4" aria-label={language === "zh" ? "AI 等待你确认" : "AI is waiting for your answer"}>
            <div className="flex items-start gap-3">
              <MessageSquare className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-semibold">{language === "zh" ? "AI 需要你确认后才能继续" : "AI needs your decision before continuing"}</h4>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{language === "zh" ? "当前不会产生新的实质修改。回答后，AI 会在同一次任务运行中继续，不会创建重复任务。" : "No new material changes will be made while waiting. After you answer, AI continues in the same run without creating a duplicate task."}</p>
                {observability.latestRun.decision?.clarifyingQuestions?.length ? (
                  <ol className="mt-3 space-y-2 text-sm">
                    {observability.latestRun.decision.clarifyingQuestions.map((question, index) => (
                      <li key={`${index}-${question}`} className="flex gap-2"><span className="font-medium text-warning">{index + 1}.</span><span>{question}</span></li>
                    ))}
                  </ol>
                ) : null}
                {canOperate ? (
                  <>
                    {observability.latestRun.decision?.suggestedActions?.length ? (
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
                      <Button disabled={!clarifyAnswer.trim() || clarifyPending || clarifyStopPending || executionActionLocked} onClick={() => void answerAiClarification()}>
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
                {readiness.checks.filter((check) => check.status === (readinessBlocked ? "blocked" : "warn")).map((check) => {
                  const readable = readableAutoRunReadinessCheck(check, language);
                  return <li key={check.key}><span className="font-medium text-foreground">{readable.label}:</span> {readable.detail}</li>;
                })}
              </ul>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setReadiness(null); setRefreshVersion((version) => version + 1); }}>{copy.readinessRetry}</Button>
              <Button size="sm" variant="secondary" onClick={() => { if (onOpenSetup) onOpenSetup(readinessSetupSection(readiness)); else onOpenExpert("process"); }}>{readinessFixLabel(readiness, language)}</Button>
            </div>
          </div>
        </section>
      ) : null}

      {actionError && !acceptOpen ? (
        <WorkItemDeliveryRecoveryAlert error={actionError} recovery={deliveryRecovery} language={language} onRecover={runDeliveryRecovery} />
      ) : null}

      {syncNotice && !(executionActionReceipt && showExecutionReview) ? (
        <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/[0.06] px-3 py-2 text-sm" role="status">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <span className="min-w-0 flex-1">{syncNotice}</span>
        </div>
      ) : null}

      {item.channelTaskContract ? <WorkItemChannelDataPlan contract={item.channelTaskContract} language={language} /> : null}

      {item.channelTaskContract ? <WorkItemChannelMutationPreview contract={item.channelTaskContract} language={language} /> : null}

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

      {resultRepairNeeded ? (
        <WorkItemResultRepairCard language={language} failedChecks={failedResultChecks} canOperate={canOperate} pending={repairPending} error={repairError} onCreateRepair={() => { void createResultRepair(); }} />
      ) : null}

      {status === "completed" ? (
        <WorkItemCompletedTaskCard
          item={item}
          language={language}
          copy={copy}
          receipt={completedLocalDeliveryReceipt}
          changedFileCount={changedFiles.length}
          verificationSummary={resultVerification?.summary ?? null}
          resultExpanded={resultExpanded}
          resultSectionId={resultSectionId}
          resultSummary={resultSummary}
          canOperate={canOperate}
          templateDraftPending={templateDraftPending}
          templateOutcomeEditing={templateOutcomeEditing}
          templateOutcomePending={templateOutcomePending}
          templateOutcomeError={templateOutcomeError}
          onToggleResult={() => setResultExpanded((expanded) => !expanded)}
          onCreateTaskDraft={onCreateTaskDraft}
          onOpenTemplateDraft={() => { void openTemplateDraft(); }}
          onEditTemplateOutcome={() => setTemplateOutcomeEditing(true)}
          onRecordTemplateOutcome={(value) => { void recordTemplateOutcome(value); }}
          onOpenTaskCenter={onOpenTaskCenter}
        />
      ) : null}

      {failed ? (
        <section className="grid gap-2 rounded-xl border border-destructive/35 bg-destructive/[0.04] p-4 text-sm sm:grid-cols-3">
          <div><p className="text-xs font-medium text-muted-foreground">{copy.why}</p><p className="mt-1">{copy.errorWhy}</p></div>
          <div><p className="text-xs font-medium text-muted-foreground">{copy.impact}</p><p className="mt-1">{copy.errorImpact}</p></div>
          <div><p className="text-xs font-medium text-muted-foreground">{copy.remedy}</p><p className="mt-1">{copy.errorRemedy}</p></div>
        </section>
      ) : null}

      {failed && resultFileEntries.length ? (
        <WorkItemFailedResultFiles language={language} copy={copy} entries={resultFileEntries} openingKey={openingResultFileKey} error={resultPreviewFile ? null : resultFileError} onOpen={(file) => { void openResultFile(file); }} />
      ) : null}

      {(status === "ready_for_review" || status === "completed") && resultExpanded ? (
        <WorkItemResultReview
          item={item}
          language={language}
          copy={copy}
          resultSectionId={resultSectionId}
          presentation={presentation}
          outcome={outcome}
          resultSummary={resultSummary}
          fullResult={fullResult}
          deliveryDecision={deliveryDecision}
          actionPreview={deliveryEvidence?.actionPreview ?? null}
          officeBatchResultId={officeBatchResultId}
          deliveryReview={deliveryReview}
          deliveryAiReview={deliveryAiReview}
          hasDelivery={Boolean(observability?.delivery)}
          reviewFindings={reviewFindings}
          reviewFeedback={reviewFeedback}
          resultVerification={resultVerification}
          acceptanceCriteriaCount={reviewAcceptanceCriteria.length}
          acceptancePassed={acceptancePassed}
          acceptanceNeedsReview={acceptanceNeedsReview}
          changedFileCount={changedFiles.length}
          deliveryWorktreeId={deliveryWorktreeId}
          reviewChangesLabel={t("taskDelivery.review")}
          resultFileEntries={resultFileEntries}
          openingFileKey={openingResultFileKey}
          fileError={resultPreviewFile ? null : resultFileError}
          outcomeHistory={observability?.outcomeHistory ?? []}
          actionDisabled={Boolean(actionPending) || executionActionLocked}
          verificationPending={actionPending === "reverify"}
          onOpenFullReport={() => setReportOpen(true)}
          onViewProjectedChanges={!usesProjectedReviewActions && deliveryWorktreeId && onOpenDeliveryChanges ? () => onOpenDeliveryChanges(item.projectId, deliveryWorktreeId) : undefined}
          onRerunVerification={!usesProjectedReviewActions && canRerunVerification ? () => { void rerunDeliveryVerification(); } : undefined}
          onAskAiToFix={!usesProjectedReviewActions && canAskAiToFix ? askAiToFix : undefined}
          onCreatePullRequest={!usesProjectedReviewActions && deliveryMode === "pull_request" ? openPullRequestConfirmation : undefined}
          onSendReviewFeedback={(feedback) => { void sendChangeRequest(feedback); }}
          onReviewChanges={() => {
            if (onOpenDeliveryChanges && deliveryWorktreeId) onOpenDeliveryChanges(item.projectId, deliveryWorktreeId);
            else onOpenExpert("process");
          }}
          onOpenFile={(file) => { void openResultFile(file); }}
        />
      ) : null}

      {status === "ready_for_review" && resultExpanded ? (
        <WorkItemReviewDecisionSection
          resultSectionId={resultSectionId}
          language={language}
          copy={copy}
          deliveryDecision={deliveryDecision}
          executionContractReady={executionContractReady}
          executionContractDefined={executionContractDefined}
          hasDelivery={Boolean(observability?.delivery)}
          reviewVerdict={deliveryReview?.verdict ?? null}
          aiReviewStatus={deliveryAiReview?.status ?? null}
          acceptActionLabel={acceptActionLabel}
          confirmActionEffect={confirmActionEffect}
          confirmActionRisk={confirmActionRisk}
          changeRequestOpen={changeRequestOpen}
          feedbackMode={feedbackMode}
          changeRequest={changeRequest}
          actionPending={actionPending}
          executionActionLocked={executionActionLocked}
          canConfirmDelivery={canConfirmProjectedDelivery}
          onPrepareExecutionPlan={() => { void prepareReviewExecutionPlan(); }}
          onChangeRequest={setChangeRequest}
          onCancelChangeRequest={() => { setChangeRequestOpen(false); setChangeRequest(""); }}
          onSendChangeRequest={() => { void sendChangeRequest(); }}
          onStopDelivery={() => { void stopDelivery(); }}
          onOpenFollowUp={() => { setFeedbackMode("follow_up"); setChangeRequestOpen(true); }}
          onOpenRevision={() => { setFeedbackMode("revision"); setChangeRequestOpen(true); }}
          onAccept={() => { setCompletionWriteback("local_only"); setAcceptOpen(true); }}
        />
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-border p-4">
          <div className="flex items-center gap-2"><FileText className="size-4 text-primary" aria-hidden /><h4 className="text-sm font-semibold">{copy.goal}</h4></div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{item.body?.trim() || copy.noGoal}</p>
        </section>
        <section className={`rounded-xl border p-4 ${executionContractReady ? "border-border" : "border-warning/35 bg-warning/[0.035]"}`}>
          <div className="flex flex-wrap items-center gap-2"><CheckCircle2 className="size-4 text-primary" aria-hidden /><h4 className="text-sm font-semibold">{language === "zh" ? "完成要求" : "Completion requirements"}</h4><Badge tone={executionContractReady ? "success" : "warning"}>{executionContractReady ? language === "zh" ? "AI 启动前已确认" : "Confirmed before AI starts" : language === "zh" ? "交给 AI 前待补充" : "Add before handing to AI"}</Badge></div>
          {item.acceptanceCriteriaSource === "body_unstructured" ? <p className="mt-2 text-xs leading-relaxed text-warning">{language === "zh" ? "系统在原任务正文中找到了完成标准，但本次运行开始前没有与检查步骤一起确认。" : "Completion criteria were found in the original task body, but they were not confirmed together with verification steps before this run."}</p> : null}
          <p className="mt-3 text-xs font-medium text-muted-foreground">{copy.acceptance}</p>
          {reviewAcceptanceCriteria.length ? (
            <ul className="mt-2 space-y-1.5 text-sm">{reviewAcceptanceCriteria.map((criterion) => <li key={criterion} className="flex gap-2"><span aria-hidden>✓</span><span>{criterion}</span></li>)}</ul>
          ) : <p className="mt-2 text-sm text-muted-foreground">{copy.noAcceptance}</p>}
          <p className="mt-4 text-xs font-medium text-muted-foreground">{language === "zh" ? "检查步骤" : "Verification steps"}</p>
          {reviewVerificationSop.length ? (
            <ol className="mt-2 space-y-1.5 text-sm">{reviewVerificationSop.map((step, index) => <li key={`${index}-${step}`} className="flex gap-2"><span className="text-primary">{index + 1}.</span><span>{step}</span></li>)}</ol>
          ) : <p className="mt-2 text-sm text-muted-foreground">{language === "zh" ? "还没有检查步骤。仅保存任务时可以不填，交给 AI 前再补充。" : "No verification steps yet. They are optional when saving and required before handing the task to AI."}</p>}
        </section>
      </div>

      {item.myTemplateBinding ? (
        <WorkItemTemplateBindingCard
          workItemId={item.id}
          binding={item.myTemplateBinding}
          language={language}
          canCorrect={canCorrectMyTemplate}
          correctionOpen={templateCorrectionOpen}
          correctionOptions={templateCorrectionOptions}
          correctionPending={templateCorrectionPending}
          correctionError={templateCorrectionError}
          onOpenCorrection={() => { void openTemplateCorrection(); }}
          onCorrect={(definition) => { void correctTemplateResult(definition); }}
          onCancelCorrection={() => { setTemplateCorrectionOpen(false); setTemplateCorrectionError(null); }}
        />
      ) : null}

      <section className="rounded-xl border border-border p-4" aria-labelledby={`work-item-materials-${item.id}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-primary" aria-hidden />
              <h4 id={`work-item-materials-${item.id}`} className="text-sm font-semibold">{copy.referenceFiles}</h4>
              <Badge tone="neutral">{(item.inputAssets?.length ?? 0) + (item.localContentRefs?.length ?? 0) + (item.taskResourceRefs?.length ?? 0)}</Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {status === "completed" ? copy.materialCompletedHint : materialChangesApplyOnRerun ? copy.materialRunningHint : copy.materialHint}
            </p>
          </div>
          {status !== "completed" ? <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => onOpenSetup?.("localLibrary")}><Library aria-hidden />{language === "zh" ? "从资料库添加" : "Add from library"}</Button>
            <TaskMaterialEditor item={item} onUpdated={(next, notice) => {
            const previousIds = new Set((item.inputAssets ?? []).map((asset) => asset.id).filter(Boolean));
            const addedIds = (next.inputAssets ?? []).map((asset) => asset.id).filter((id): id is string => Boolean(id) && !previousIds.has(id));
            setItem(next);
            setMaterialNotice(notice);
            setMaterialUndo(null);
            setMaterialAddUndo(addedIds.length ? { assetIds: addedIds } : null);
            window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-item-material-add", workItemId: next.id } }));
          }} />
          </div> : <Button size="sm" variant="secondary" disabled={Boolean(actionPending)} onClick={() => setReopenConfirmOpen(true)}>{copy.reopenForMaterials}</Button>}
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
        <TaskContentReferences
          item={item}
          readOnly={status === "completed"}
          onUpdated={(next, notice) => {
            setItem(next);
            setMaterialNotice(notice);
            setMaterialUndo(null);
            setMaterialAddUndo(null);
          }}
        />
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
            <Button size="sm" disabled={Boolean(actionPending) || executionActionLocked} onClick={() => void sendChangeRequest(copy.materialReprocessComment)}><RefreshCw aria-hidden />{copy.useUpdatedMaterials}</Button>
          </div>
        ) : null}
        {item.inputAssets?.length && status === "needs_action" && failed ? (
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="secondary" disabled={Boolean(actionPending) || executionActionLocked} onClick={() => setRetryOpen(true)}><RefreshCw aria-hidden />{copy.retryWithMaterials}</Button>
          </div>
        ) : null}
        {materialError ? <p className="mt-2 text-sm text-destructive" role="alert">{materialError}</p> : null}
      </section>

      <WorkItemRecordBindings
        item={item}
        language={language}
        locked={Boolean((item.executionBindings ?? []).length)}
        pendingId={recordBindingRefreshPendingId}
        onRefresh={(binding) => void refreshRecordBinding(binding)}
        error={recordBindingRefreshError}
      />

      <WorkItemLedgerPostingPlan item={item} language={language} canOperate={canOperate} />

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

      <ExecutionStartConfirmation
        open={startConfirmationOpen}
        summary={startSummary}
        language={language}
        pending={actionPending === "start" || actionPending === "context"}
        canConfirm={canStartAi && executionPlanPrepared && !contextHasBlockingIssues}
        error={startConfirmationOpen ? actionError : null}
        blockedActionLabel={materialExecutionBlocked
          ? (language === "zh" ? "检查相关资料" : "Review materials")
          : intentConflictResolution === "task_context"
            ? (language === "zh" ? "调整资料权限" : "Adjust material access")
            : intentConflictResolution
              ? (language === "zh" ? "修正任务理解" : "Correct task intent")
              : readinessBlocked ? readinessFixLabel(readiness, language) : undefined}
        onResolveBlocked={materialExecutionBlocked ? () => {
          setStartConfirmationOpen(false);
          window.requestAnimationFrame(() => document.getElementById(`work-item-records-${item.id}`)?.scrollIntoView?.({ behavior: "smooth", block: "center" }));
        } : intentConflictResolution === "task_context" ? () => {
          setStartConfirmationOpen(false);
          window.requestAnimationFrame(() => document.querySelector('[data-testid="work-item-context-card"]')?.scrollIntoView?.({ behavior: "smooth", block: "center" }));
        } : intentConflictResolution ? () => {
          setStartConfirmationOpen(false);
          onOpenExpert("overview");
        } : readinessBlocked ? () => {
          setStartConfirmationOpen(false);
          if (onOpenSetup) onOpenSetup(readinessSetupSection(readiness));
          else onOpenExpert("process");
        } : undefined}
        onClarificationChoice={(option) => { void resolveIntentClarification(option); }}
        onClose={() => { if (actionPending !== "start" && actionPending !== "context") setStartConfirmationOpen(false); }}
        onConfirm={() => { void startAiWork(); }}
        returnFocusRef={startActionRef}
      />
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
        title={language === "zh" ? "记住这次做法" : "Remember this approach"}
        description={language === "zh"
          ? "系统已从这次成功结果中整理出一套常用做法。保存后不会改变当前任务；检查无误并启用后，相似工作会优先按这种方式处理。"
          : "The system extracted a reusable approach from this successful result. Saving does not change the current task; after review and activation, similar work can prefer it."}
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
              {templateDraftPending ? (language === "zh" ? "正在整理…" : "Saving…") : (language === "zh" ? "记住这种做法" : "Remember this approach")}
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
                  ? (language === "zh" ? "这项任务已经使用了现有模板，不会再创建一个重复的新模板。" : "This task already used an existing template, so a duplicate will not be created.")
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
                  <Button disabled={!changeRequest.trim() || Boolean(actionPending) || executionActionLocked} onClick={() => void sendChangeRequest()}>
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
                  disabled={!executionContractReady || !outcomeReady || Boolean(actionPending) || !canConfirmProjectedDelivery || Boolean(observability?.delivery && observability.delivery.review?.verdict !== "approved")}
                  onClick={() => { setReportOpen(false); setCompletionWriteback("local_only"); setAcceptOpen(true); }}
                >
                  <CheckCircle2 aria-hidden />{acceptActionLabel}
                </Button>
              </div>
            </div>
          </div>
        )}
      >
        <WorkItemResultReportContent
          language={language}
          copy={copy}
          deliveryDecision={deliveryDecision}
          actionPreview={deliveryEvidence?.actionPreview ?? null}
          deliveryReview={deliveryReview}
          deliveryAiReview={deliveryAiReview}
          acceptActionLabel={acceptActionLabel}
          confirmActionEffect={confirmActionEffect}
          confirmActionRisk={confirmActionRisk}
          fullResult={fullResult}
          resultVerification={resultVerification}
          acceptanceCriteriaCount={reviewAcceptanceCriteria.length}
          acceptanceResultsCount={item.acceptanceResults?.length ?? 0}
          acceptancePassed={acceptancePassed}
          acceptanceNeedsReview={acceptanceNeedsReview}
          resultFileEntries={resultFileEntries}
          openingFileKey={openingResultFileKey}
          fileError={resultPreviewFile ? null : resultFileError}
          actionDisabled={Boolean(actionPending)}
          verificationPending={actionPending === "reverify"}
          onViewChanges={canViewProjectedChanges && deliveryWorktreeId && onOpenDeliveryChanges ? () => onOpenDeliveryChanges(item.projectId, deliveryWorktreeId) : undefined}
          onRerunVerification={canRerunProjectedVerification ? () => { void rerunDeliveryVerification(); } : undefined}
          onAskAiToFix={canRequestProjectedAiFix ? askAiToFix : undefined}
          onCreatePullRequest={canOpenProjectedPullRequest ? openPullRequestConfirmation : undefined}
          onOpenFile={(file) => { void openResultFile(file); }}
        />
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
            <Button disabled={retryPending || executionActionLocked} onClick={() => void retryAiWork()}>
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
          {reviewIntent?.source === "frozen_execution_contract" ? (
            <section className="rounded-lg border border-primary/25 bg-primary/[0.04] p-3 text-sm" data-testid="accept-review-intent">
              <p className="font-semibold">{language === "zh" ? "本次确认依据" : "Confirmation basis for this run"}</p>
              <dl className="mt-2 grid gap-1 text-xs">
                <div><dt className="inline text-muted-foreground">{language === "zh" ? "目标：" : "Goal: "}</dt><dd className="inline">{reviewIntent.goal ?? (language === "zh" ? "未记录" : "Unavailable")}</dd></div>
                <div><dt className="inline text-muted-foreground">{language === "zh" ? "预期结果：" : "Expected result: "}</dt><dd className="inline">{reviewIntent.expectedOutput ?? (language === "zh" ? "未记录" : "Unavailable")}</dd></div>
                <div><dt className="inline text-muted-foreground">{language === "zh" ? "确认效果：" : "Effect: "}</dt><dd className="inline">{confirmActionEffect}</dd></div>
                <div><dt className="inline text-muted-foreground">{language === "zh" ? "风险：" : "Risk: "}</dt><dd className="inline">{confirmActionRisk}</dd></div>
              </dl>
            </section>
          ) : null}
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
          {actionError ? (
            <WorkItemDeliveryRecoveryAlert error={actionError} recovery={deliveryRecovery} language={language} compact onRecover={runDeliveryRecovery} />
          ) : null}
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

function WorkItemIntentCard({
  summary,
  language,
  onEdit,
}: {
  summary: WorkItemIntentSummary;
  language: "zh" | "en";
  onEdit?: () => void;
}) {
  const tone = summary.state === "aligned" ? "success" : summary.state === "needs_confirmation" ? "warning" : "neutral";
  return (
    <section
      className={`rounded-xl border p-4 ${summary.state === "needs_confirmation" ? "border-warning/35 bg-warning/[0.055]" : "border-primary/25 bg-primary/[0.035]"}`}
      aria-label={language === "zh" ? "AI 对任务的理解" : "AI understanding of the task"}
      data-testid="work-item-intent-summary"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <BrainCircuit className="size-4 text-primary" aria-hidden />
            <h4 className="text-sm font-semibold">{language === "zh" ? "我理解你要做的是" : "Here’s what I understand"}</h4>
            <Badge tone={tone}>{summary.statusLabel}</Badge>
          </div>
          <p className="mt-2 text-base font-medium leading-relaxed">{summary.goal}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{summary.confidenceReason}</p>
        </div>
        {onEdit ? <Button className="shrink-0" size="sm" variant="secondary" onClick={onEdit}>{language === "zh" ? "修改理解" : "Correct this"}</Button> : null}
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-background/70 px-3 py-2.5">
          <dt className="text-xs font-medium text-muted-foreground">{language === "zh" ? "预期结果" : "Expected result"}</dt>
          <dd className="mt-1 text-sm leading-relaxed">{summary.expectedOutcome}</dd>
        </div>
        <div className="rounded-lg bg-background/70 px-3 py-2.5">
          <dt className="text-xs font-medium text-muted-foreground">{language === "zh" ? "本次范围" : "Scope"}</dt>
          <dd className="mt-1 text-sm leading-relaxed">{summary.scope}</dd>
        </div>
        <div className="rounded-lg bg-background/70 px-3 py-2.5">
          <dt className="text-xs font-medium text-muted-foreground">{language === "zh" ? "不会直接做" : "Safety boundary"}</dt>
          <dd className="mt-1 text-sm leading-relaxed">{summary.boundary}</dd>
        </div>
      </dl>
    </section>
  );
}
