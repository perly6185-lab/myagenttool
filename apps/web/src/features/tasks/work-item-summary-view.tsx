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
import { MarkdownBlock } from "@/components/ui/markdown-block";
import { api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useSessionUser } from "@/hooks/use-session-user";
import { type SectionKey, type WorkItemSection } from "@/store/ui-store";
import { WorkItemProgressDialog, type WorkItemProgressTarget } from "./work-item-progress-dialog";
import { TaskMaterialEditor } from "./task-material-editor";
import { TaskContentReferences } from "./task-content-references";
import { readableAutoRunReadinessCheck, readinessFixLabel, readinessSetupSection, type AutoRunReadiness } from "./auto-run-readiness-ui";
import { myTemplateExpectedOutput } from "@/features/workflow-memory/my-template-model";
import type { BusinessRoutineDefinition } from "@/lib/api-client";
import type { LocalWorkItem, LocalWorkItemObservability, WorkItemComment, WorkItemOutcomeFile } from "./task-view-types";
import { deriveWorkItemUserStatus } from "./work-item-user-status";
import { COPY, type SummaryCopy } from "./work-item-summary-copy";
import {
  WAITING_LABEL,
  aiPhaseDescription,
  deriveDeliveryDecision,
  executionStateLabel,
  expertSectionFor,
  latestExecutionKind,
  resultPresentation,
  type DeliveryDecision,
} from "./work-item-summary-model";
import {
  DeliverableFileList,
  DeliveryMarkdownDocument,
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
        ? "重新执行所需的完成标准和检查步骤已建立。请先核对内容，再选择“让 AI 继续修改”启动新一轮执行；旧结果仍不能据此确认通过。"
        : "The criteria and verification steps for a new run are ready. Review them, then choose Ask AI to revise to start a new run. The old result still cannot be approved against these later requirements.");
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
              ? "这项处理方式已进入观察期。本次确认后才会使用，积累新的成功结果后才恢复自动采用。"
              : "You returned this template to observation. Confirm it for now; automatic use resumes after new successful results.")
          : governancePaused
          ? (language === "zh"
              ? "这项处理方式近期多次产生错误结果类型，已暂停自动采用。你仍可确认本次使用。"
              : "This template repeatedly produced the wrong result type, so automatic matching is paused. You can still confirm it for this task.")
          : governanceWatch
            ? (language === "zh"
                ? "这项处理方式近期出现过多次结果类型不符，系统已降低推荐优先级。本次确认后才会使用。"
                : "This template recently produced several wrong result types. It will be used only after you confirm.")
            : learnedConflict
          ? (language === "zh"
              ? "你以前对此类任务选择过不同结果。请确认这次想得到什么，系统不会擅自猜测。"
              : "You previously chose different results for this kind of task. Confirm this result so the system does not guess.")
          : (language === "zh"
              ? "系统找到了多种可能结果。请只确认这次想得到什么，不需要了解处理方式。"
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
        ? "执行方案已生成。请核对任务目标、完成标准和检查步骤；确认无误后，再次选择“让 AI 开始”。"
        : "The execution plan is ready. Review the goal, completion criteria, and verification steps, then choose Let AI start again to confirm.");
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
        ? "已保存为新的“我的模板”，目前处于学习中；不会改变原任务，也不会立即自动套用。"
        : "Saved as a new learning My template. The original task is unchanged and it will not be applied automatically yet.");
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "my-template-draft", workItemId: item.id } }));
    } catch {
      setTemplateDraftError(language === "zh" ? "暂时无法保存为我的模板，请稍后重试。" : "The My template could not be saved. Try again later.");
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
    if (!run || run.status !== "needs_input" || !answer || clarifyPending) return;
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
        ? "这次执行开始前没有确认完整的完成标准和检查步骤，不能形成正式审核结论。请补全后重新运行。"
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
          ? "执行方案已生成但尚未重试。请先核对完成标准和检查步骤，再次点击重试。"
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
          <span>{language === "zh" ? "任务编号" : "Task ID"}: <span className="font-mono">{item.localRef}</span></span>
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

      {actionError ? <p className="rounded-lg border border-destructive/35 bg-destructive/[0.05] px-3 py-2 text-sm text-destructive" role="alert">{actionError}</p> : null}

      {syncNotice ? (
        <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/[0.06] px-3 py-2 text-sm" role="status">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <span className="min-w-0 flex-1">{syncNotice}</span>
        </div>
      ) : null}

      {item.channelTaskContract?.workMode ? (
        <section
          className={`rounded-xl border p-4 ${item.channelTaskContract.workMode.state === "needs_confirmation" ? "border-warning/35 bg-warning/[0.05]" : "border-primary/25 bg-primary/[0.035]"}`}
          aria-label={language === "zh" ? "我会这样处理" : "How this task will be handled"}
          data-testid="work-mode-summary"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Bot className="size-4 text-primary" aria-hidden />
            <h4 className="text-sm font-semibold">{language === "zh" ? "我会这样处理" : "How I’ll handle this"}</h4>
            <Badge tone={item.channelTaskContract.workMode.state === "matched" ? "success" : "warning"}>
              {item.channelTaskContract.workMode.state === "matched"
                ? (language === "zh" ? "已整理" : "Ready")
                : item.channelTaskContract.workMode.state === "needs_confirmation"
                  ? (language === "zh" ? "等你确认" : "Needs confirmation")
                  : (language === "zh" ? "按本次要求" : "This request")}
            </Badge>
          </div>
          <p className="mt-2 text-sm font-medium">
            {item.channelTaskContract.workMode.state === "needs_confirmation"
              ? (language === "zh" ? "我还不能确定具体怎么处理。" : "I need your confirmation before choosing how to handle this.")
              : item.channelTaskContract.workMode.name}
          </p>
          {item.channelTaskContract.workMode.expectedOutput ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {language === "zh" ? "预期结果：" : "Expected result: "}{item.channelTaskContract.workMode.expectedOutput}
            </p>
          ) : null}
          {item.channelTaskContract.workMode.data.sources.length ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {language === "zh" ? "本次使用：" : "Using: "}
              {item.channelTaskContract.workMode.data.sources.map((source) => `${source.fileName ?? "本地资料"}${source.revision != null ? `（第${source.revision}版）` : ""}`).join("、")}
            </p>
          ) : null}
          {item.channelTaskContract.workMode.confirmationRequired ? (
            <p className="mt-2 text-xs text-warning-foreground">
              {language === "zh" ? "涉及资料选择、文件修改或对外操作，开始前会先让你确认。" : "Source selection, file changes, or external actions require confirmation before starting."}
            </p>
          ) : null}
          {item.channelTaskContract.workMode.state === "needs_confirmation" && item.channelTaskContract.workMode.candidates.length ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {language === "zh" ? "可能的方式：" : "Possible modes: "}
              {item.channelTaskContract.workMode.candidates.map((candidate) => candidate.name ?? candidate.expectedOutput).filter(Boolean).join("、")}
            </p>
          ) : null}
          <details className="mt-3 rounded-lg border border-border/70 bg-background/50 px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium">{language === "zh" ? "查看处理依据" : "View supporting details"}</summary>
            <div className="mt-2 space-y-1 text-muted-foreground">
              <p>{language === "zh" ? "处理依据：" : "Basis: "}{item.channelTaskContract.workMode.source === "my_template" ? (language === "zh" ? "参考了之前确认过的做法" : "A previously confirmed approach") : item.channelTaskContract.workMode.source === "suggested" ? (language === "zh" ? "等待本次确认" : "Awaiting confirmation") : (language === "zh" ? "本次临时整理" : "This request")}{item.channelTaskContract.workMode.version != null ? ` · v${item.channelTaskContract.workMode.version}` : ""}</p>
              <p>{language === "zh" ? "资料检查记录：" : "Source check: "}{item.channelTaskContract.workMode.trace.dataPlanDigest ?? "—"}</p>
              <p>{language === "zh" ? "处理记录：" : "Processing record: "}{item.channelTaskContract.workMode.digest}</p>
            </div>
          </details>
        </section>
      ) : null}

      {item.channelTaskContract?.dataPlan && item.channelTaskContract.dataPlan.status !== "not_required" ? (
        <section
          className={`rounded-xl border p-4 ${item.channelTaskContract.dataPlan.status === "ready" ? "border-success/30 bg-success/[0.04]" : "border-warning/35 bg-warning/[0.05]"}`}
          aria-label={language === "zh" ? "资料检查结果" : "Source check results"}
        >
          <h4 className="text-sm font-semibold">{language === "zh" ? "资料检查结果" : "Source check results"}</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.channelTaskContract.dataPlan.status === "ready"
              ? (language === "zh" ? "以下资料会用于本次处理，开始前还会再次检查。" : "These sources will be used for this task and checked again before starting.")
              : (language === "zh" ? "还缺少部分资料，补齐或选择来源后才能继续。" : "Some sources are still missing. Add or choose them before continuing.")}
          </p>
          {item.channelTaskContract.dataPlan.sources.length ? (
            <ul className="mt-3 space-y-1 text-xs">
              {item.channelTaskContract.dataPlan.sources.map((source) => (
                <li key={source.sourceId}>
                  <span className="font-medium">{source.fileName ?? source.sourceId}</span>
                  {source.revision != null ? <span className="ml-1 text-muted-foreground">· v{source.revision}</span> : null}
                  {source.rowCount != null ? <span className="ml-1 text-muted-foreground">· {source.rowCount} rows</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {item.channelTaskContract.dataPlan.requirements.filter((requirement) => requirement.state !== "ready").map((requirement) => (
            <p key={requirement.id} className="mt-2 text-xs text-warning-foreground">
              {language === "zh" ? "还需要：" : "Needed: "}{requirement.label}{requirement.state === "ambiguous" ? (language === "zh" ? "（来源不唯一）" : " (multiple sources)") : ""}
            </p>
          ))}
          {item.channelTaskContract.dataPlan.relations.length ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {language === "zh" ? "资料对应关系：" : "Source relationships: "}
              {item.channelTaskContract.dataPlan.relations.map((relation) => `${relation.fromRequirementId}.${relation.fromField} → ${relation.toRequirementId}.${relation.toField}`).join("；")}
            </p>
          ) : null}
          {item.channelTaskContract.dataRelationPreview?.relations.length ? (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {item.channelTaskContract.dataRelationPreview.relations.map((relation) => (
                <li key={relation.id}>
                  {relation.fromRequirementId}.{relation.fromField} → {relation.toRequirementId}.{relation.toField}：
                  {relation.state === "ready"
                    ? (language === "zh" ? `已对应 ${relation.matchedRows} 条` : `${relation.matchedRows} matched`)
                    : (language === "zh" ? `还需确认，${relation.unmatchedRows} 条未对应` : `review needed, ${relation.unmatchedRows} unmatched`)}
                </li>
              ))}
            </ul>
          ) : null}
          {item.channelTaskContract.dataRelationConfirmation ? (
            <div className="mt-3 rounded-lg border border-success/25 bg-success/[0.04] p-3 text-xs">
              <p className="font-medium text-success-foreground">
                {item.channelTaskContract.dataRelationConfirmation.status === "verified"
                  ? (language === "zh" ? "资料对应关系已检查并记录" : "Source relationships checked and recorded")
                  : (language === "zh" ? "资料对应关系检查状态：" : "Source relationship check: ") + item.channelTaskContract.dataRelationConfirmation.status}
              </p>
              <p className="mt-1 text-muted-foreground">
                {item.channelTaskContract.dataRelationConfirmation.confirmationMode === "user_confirmation"
                  ? (language === "zh" ? "由本次确认完成检查" : "Checked by this confirmation")
                  : (language === "zh" ? "由系统在开始前完成检查" : "Checked by the system before starting")}
                {item.channelTaskContract.dataRelationConfirmation.objectSnapshotCount > 0
                  ? (language === "zh"
                    ? ` · 已记录 ${item.channelTaskContract.dataRelationConfirmation.objectSnapshotCount} 个对象版本`
                    : ` · ${item.channelTaskContract.dataRelationConfirmation.objectSnapshotCount} object versions recorded`)
                  : ""}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {item.channelTaskContract?.dataMutationPreview && item.channelTaskContract.dataMutationPreview.status !== "not_required" ? (
        <section
          className="rounded-xl border border-warning/35 bg-warning/[0.05] p-4"
          aria-label={language === "zh"
            ? (item.channelTaskContract.ledgerMutationPreview?.kind === "batch" ? "批量文件修改预览" : item.channelTaskContract.ledgerMutationPreview ? "单条文件修改预览" : "文件修改预览")
            : (item.channelTaskContract.ledgerMutationPreview ? "Single-record file change preview" : "File change preview")}
        >
          <h4 className="text-sm font-semibold">
            {language === "zh"
              ? (item.channelTaskContract.ledgerMutationPreview?.kind === "batch" ? "批量文件修改预览" : item.channelTaskContract.ledgerMutationPreview ? "单条文件修改预览" : "文件修改预览")
              : (item.channelTaskContract.ledgerMutationPreview ? "Single-record file change preview" : "File change preview")}
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.channelTaskContract.ledgerMutationPreview
              ? (language === "zh"
                ? (item.channelTaskContract.ledgerMutationPreview.kind === "batch"
                  ? "已生成批量文件修改预览；回复“确认执行”后按文件顺序处理，部分失败会保留可恢复记录。"
                  : "已生成文件修改预览；回复“确认执行”后才会修改，桌面端会保留处理记录。")
                : "A file change preview is ready. Personal Channel confirmation is required before changes are applied.")
              : (language === "zh"
                ? item.channelTaskContract.dataMutationPreview.status === "ready"
                  ? "修改范围预览已生成，但还不会直接修改原文件。"
                  : "目前只整理了修改范围，还需要明确文件、记录范围和修改内容。"
                : item.channelTaskContract.dataMutationPreview.status === "ready"
                  ? "The change scope is previewed, but source files will not be modified yet."
                  : "Only the change scope is recorded. Confirm the files, rows, and changes before continuing.")}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {item.channelTaskContract.dataMutationBinding
              ? (language === "zh"
                ? "文件保护设置已准备好"
                : "File protection is ready")
              : (language === "zh" ? "还需要检查文件保护设置" : "File protection still needs checking")}
          </p>
          {item.channelTaskContract.dataMutationPreview.targetSources.length ? (
            <ul className="mt-3 space-y-1 text-xs">
              {item.channelTaskContract.dataMutationPreview.targetSources.map((source) => (
                <li key={source.sourceId}>
                  <span className="font-medium">{source.fileName ?? source.sourceId}</span>
                  {source.revision != null ? <span className="ml-1 text-muted-foreground">· v{source.revision}</span> : null}
                  {source.rowCount != null ? <span className="ml-1 text-muted-foreground">· {source.rowCount} rows</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {item.channelTaskContract.dataMutationPreview.dataMutationScope ? (
            <div className="mt-3 rounded-lg border border-warning/25 bg-background/40 p-3 text-xs">
              <p className="font-medium">
                {language === "zh" ? "修改范围已固定" : "Change scope fixed"}
                <span className="ml-2 text-muted-foreground">
                  {language === "zh"
                    ? `${item.channelTaskContract.dataMutationPreview.dataMutationScope.targets.length} 个文件 · 预计 ${item.channelTaskContract.dataMutationPreview.dataMutationScope.expectedAffectedRows} 条`
                    : `${item.channelTaskContract.dataMutationPreview.dataMutationScope.targets.length} files · ${item.channelTaskContract.dataMutationPreview.dataMutationScope.expectedAffectedRows} rows`}
                </span>
              </p>
              <p className="mt-1 text-muted-foreground">
                {language === "zh" ? "系统只保留必要的处理记录，不保存原始筛选内容。" : "Only necessary processing records are kept; raw filters are not persisted."}
              </p>
              {item.channelTaskContract.dataMutationPreview.dataMutationScope.changes.length ? (
                <p className="mt-1 text-muted-foreground">
                  {language === "zh" ? "字段：" : "Fields: "}
                  {item.channelTaskContract.dataMutationPreview.dataMutationScope.changes.map((change) => change.field).join("、")}
                </p>
              ) : null}
            </div>
          ) : null}
          {item.channelTaskContract.ledgerMutationPreview ? (
            <div className="mt-3 rounded-lg border border-success/25 bg-success/[0.04] p-3 text-xs">
              <p className="font-medium text-success-foreground">
                {item.channelTaskContract.ledgerMutationPreview.state === "rolled_back"
                  ? (language === "zh" ? "修改已安全撤回" : "Changes rolled back safely")
                  : item.channelTaskContract.ledgerMutationPreview.state === "needs_attention"
                    ? (language === "zh" ? "需要检查文件" : "File needs attention")
                    : item.channelTaskContract.ledgerMutationPreview.state === "committing"
                      ? (language === "zh" ? "正在恢复修改进度" : "Recovering change progress")
                      : (language === "zh" ? "文件修改预览已生成" : "File change preview ready")}
                <span className="ml-2 text-muted-foreground">
                  {item.channelTaskContract.ledgerMutationPreview.state === "waiting"
                    ? (language === "zh" ? "排队等待处理" : "queued behind another change")
                    : item.channelTaskContract.ledgerMutationPreview.state === "rolled_back"
                      ? (language === "zh" ? "未保留任何部分修改" : "no partial changes kept")
                      : item.channelTaskContract.ledgerMutationPreview.state === "needs_attention"
                        ? (language === "zh" ? "检测到文件被其他程序修改" : "file changed elsewhere")
                        : item.channelTaskContract.ledgerMutationPreview.state === "committing"
                          ? (language === "zh" ? "已完成项不会重复修改" : "completed items will not repeat")
                    : (language === "zh" ? "等待 Channel 确认" : "awaiting Channel confirmation")}
                </span>
              </p>
              <p className="mt-1 text-muted-foreground">
                {item.channelTaskContract.ledgerMutationPreview.kind === "batch"
                  ? `${language === "zh" ? "涉及：" : "Scope: "}${item.channelTaskContract.ledgerMutationPreview.targetCount ?? 0} ${language === "zh" ? "个文件，" : "files, "}${item.channelTaskContract.ledgerMutationPreview.operationCount ?? item.channelTaskContract.ledgerMutationPreview.children?.length ?? 0} ${language === "zh" ? "条记录" : "operations"}`
                  : item.channelTaskContract.ledgerMutationPreview.changedCells.length
                    ? `${language === "zh" ? "字段：" : "Fields: "}${item.channelTaskContract.ledgerMutationPreview.changedCells.map((cell) => cell.field).filter(Boolean).join("、")}`
                    : (language === "zh" ? "没有检测到实际字段变化" : "No field difference detected")}
                {item.channelTaskContract.ledgerMutationPreview.kind !== "batch" && item.channelTaskContract.ledgerMutationPreview.rowNumber != null
                  ? ` · ${language === "zh" ? "第" : "row "}${item.channelTaskContract.ledgerMutationPreview.rowNumber}${language === "zh" ? "行" : ""}`
                  : ""}
              </p>
              {item.channelTaskContract.ledgerMutationPreview.kind === "batch" && item.channelTaskContract.ledgerMutationPreview.journal ? (
                <p className="mt-1 text-muted-foreground">
                  {language === "zh"
                    ? `处理记录：已完成 ${item.channelTaskContract.ledgerMutationPreview.journal.appliedCount} 项、保留 ${item.channelTaskContract.ledgerMutationPreview.journal.snapshotCount} 个文件备份`
                    : `Processing record: ${item.channelTaskContract.ledgerMutationPreview.journal.appliedCount} completed, ${item.channelTaskContract.ledgerMutationPreview.journal.snapshotCount} file backups`}
                </p>
              ) : null}
            </div>
          ) : null}
          {item.channelTaskContract.dataMutationPreview.requiredFields.map((field) => (
            <p key={field} className="mt-2 text-xs text-warning-foreground">{language === "zh" ? "还需要：" : "Needed: "}{field}</p>
          ))}
        </section>
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
                    {language === "zh" ? "保存为我的模板" : "Save as My template"}
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
                {language === "zh" ? "只评价实际结果。电脑离线、权限或运行失败不会被算成模板问题。" : "Rate only the actual result. Offline computers, permissions, and run failures are not treated as template problems."}
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
              <p className="font-semibold">{language === "zh" ? "本次结果缺少事先确认的完成要求，暂不能确认通过" : "This result has no pre-confirmed completion requirements and cannot be approved"}</p>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                {executionContractDefined
                  ? language === "zh"
                    ? "完成标准和检查步骤是在这次结果产生后才建立的，因此只能用于下一轮执行。请让 AI 重新执行；新结果才可按这份要求确认。"
                    : "The criteria and SOP were established after this result, so they apply only to the next run. Rerun the task; only the new result can be reviewed against this plan."
                  : language === "zh"
                    ? "完成标准和检查步骤必须在 AI 开始前确定。本次历史运行缺少完整要求，请先补全并重新执行；系统不会在确认结果时倒推标准。"
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
                {language === "zh" ? "处理依据：参考了你之前确认过的做法" : "Basis: a previously confirmed approach"}
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
                ? "系统发现这项任务与之前由你纠正过的任务相似，因此优先采用这个结果。你可以在设置中查看或撤销系统记住的选择。"
                : "This task looks similar to one you corrected before, so that result was preferred. You can review or remove the remembered choice in settings."}
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
                <p className="mt-3 text-sm text-muted-foreground">{language === "zh" ? "还没有其他可用结果，可以先到“我的模板”继续完善。" : "No other result is available yet. Add one in My templates first."}</p>
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
              <Badge tone="neutral">{(item.inputAssets?.length ?? 0) + (item.localContentRefs?.length ?? 0)}</Badge>
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
        title={language === "zh" ? "保存为新的“我的模板”" : "Save as a new My template"}
        description={language === "zh"
          ? "系统已根据这次任务整理输入和结果。保存后即可到“我的模板”检查学习结果，并由你决定是否启用。"
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
              {templateDraftPending ? (language === "zh" ? "正在整理…" : "Saving…") : (language === "zh" ? "确认并保存模板" : "Confirm and save template")}
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
