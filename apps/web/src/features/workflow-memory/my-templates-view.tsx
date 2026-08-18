import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BrainCircuit, Check, Eye, FileInput, FileOutput, History, Loader2, PencilLine, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import { buildMyTemplateSummaries, type MyTemplateState } from "@/features/workflow-memory/my-template-model";
import { MyTemplateSetupWizard } from "@/features/workflow-memory/my-template-setup-wizard";
import { workflowMemoryApi, type TemplateLearningTask } from "@/features/workflow-memory/workflow-memory-api";
import { ChannelObjectRegistryCard } from "@/features/workflow-memory/channel-object-registry-card";
import { WorkflowMemoryView } from "@/features/workflow-memory/workflow-memory-view";
import type { MyTemplateDraft } from "@/lib/api-client";

type MyTemplateLearningFeedback = {
  id: string;
  projectId: string;
  workItemId: string;
  workItem: { id: string; localRef: string; title: string } | null;
  intentTerms: string[];
  rejectedOutput: string | null;
  selectedOutput: string;
  reason: string;
  createdAt: string;
  state?: "active" | "conflict";
  conflictingOutputs?: string[];
};

type MyTemplateOutcomeSummary = {
  familyId: string;
  total: number;
  metExpectations: number;
  wrongResult: number;
  needsQualityAdjustment: number;
  state: "learning" | "stable" | "needs_attention" | "quality_adjustment";
  governance: {
    state: "learning" | "trusted" | "watch" | "paused";
    matchingFeedbackCount: number;
    wrongResultRate: number;
    autoMatchAllowed: boolean;
    requiresConfirmation: boolean;
    reason: string;
    manualObservation: boolean;
    historicalFeedbackCount: number;
    latestIntervention: {
      id: string;
      action: "resume_observation";
      reason: string;
      createdAt: string;
      createdBy: string;
    } | null;
  };
};

type MyTemplateOutcomeFeedback = {
  id: string;
  projectId: string;
  workItemId: string;
  familyId: string;
  version: number;
  outcome: "met_expectations" | "wrong_result" | "needs_quality_adjustment";
  note: string;
  workItem: { id: string; localRef: string; title: string; status: string } | null;
  governanceImpact: "positive" | "negative" | "quality_neutral" | "historical_baseline";
  createdAt: string;
  updatedAt: string;
};

type MyTemplateLearningCase = {
  id: string;
  workItem: { id: string; localRef: string | null; title: string; completedAt: string | null };
  typicalInput: string;
  expectedOutput: string;
  similarity: { score: number; confidence: "high" | "medium" | "low"; reasons: string[] } | null;
  createdAt: string;
};

type SimilarMyTemplateWorkItem = {
  workItem: { id: string; localRef: string | null; title: string; completedAt: string | null; revision: number };
  similarity: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  typicalInput: string;
  expectedOutput: string;
  evidence: { inputCount: number; outputCount: number; passedVerification: boolean; passedAcceptance: boolean; hasDeliveryReport: boolean };
};

type SimilarMyTemplateResponse = {
  draft: MyTemplateDraft;
  cases: MyTemplateLearningCase[];
  suggestions: SimilarMyTemplateWorkItem[];
  count: number;
  review: {
    learnedResult: {
      taskGoal: string;
      typicalInput: string;
      useWhen: string;
      expectedOutput: string;
      steps: string[];
      inputExamples: string[];
      outputExamples: string[];
    };
    readiness: {
      canEnable: boolean;
      confidence: "initial" | "medium" | "high";
      caseCount: number;
      message: string;
    };
    futureBehavior: {
      participatesInMatching: boolean;
      affectsExistingTasks: boolean;
      requiresExplicitConfirmation: boolean;
    };
  };
};

const OUTCOME_COPY: Record<MyTemplateOutcomeFeedback["outcome"], string> = {
  met_expectations: "符合预期",
  wrong_result: "结果类型不对",
  needs_quality_adjustment: "内容需要调整",
};

const STATE_COPY: Record<MyTemplateState, { label: string; tone: "success" | "warning" | "neutral" }> = {
  ready: { label: "已启用", tone: "success" },
  needs_review: { label: "待确认", tone: "warning" },
  learning: { label: "学习中", tone: "warning" },
  paused: { label: "已暂停", tone: "neutral" },
};

type LocalTemplateCase = {
  id: string;
  inputs: File[];
  outputs: File[];
  references: File[];
};

function emptyTemplateCase(index: number): LocalTemplateCase {
  return { id: `case-${index}`, inputs: [], outputs: [], references: [] };
}

const TEMPLATE_FILE_ACCEPT = ".csv,.docx,.jpeg,.jpg,.json,.md,.pdf,.png,.pptx,.txt,.webp,.xlsx";
const TEMPLATE_IMAGE_EXTENSIONS = new Set(["jpeg", "jpg", "png", "webp"]);

function fileExtension(file: File) {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function learningFailureCopy(errorCode?: string | null) {
  const code = String(errorCode ?? "");
  if (code.includes("no_business_documents")) return {
    title: "没有识别出可学习的输入和结果",
    detail: "请检查文件是否包含可读内容，或进入检查页手动确认文件用途。",
    retryable: false,
  };
  if (code.includes("no_business_cases") || code.includes("insufficient_confirmed")) return {
    title: "没有找到清晰的输入与结果对应关系",
    detail: "安全副本仍然保留，可以进入检查页手动确认这一组文件。",
    retryable: false,
  };
  if (code.includes("file_type_unsupported")) return {
    title: "其中有暂不支持的文件类型",
    detail: "请改用 Office、PDF、CSV、文本或常见图片后重新创建。",
    retryable: false,
  };
  if (code.includes("ocr_required") || code.includes("ocr_failed")) return {
    title: "扫描件或图片需要文字识别",
    detail: "本机 OCR 不可用时，可以改用已登录的 Codex 识别安全副本；临时页图会在识别后删除。",
    retryable: true,
  };
  if (code.includes("file_size") || code.includes("total_size")) return {
    title: "选择的文件过大",
    detail: "单个文件需小于 24 MB；也可以减少本次选择的文件数量。",
    retryable: false,
  };
  if (code.includes("scan") || code.includes("background") || code.includes("preparation")) return {
    title: "整理过程暂时中断",
    detail: "文件已经安全保存，可以直接重新整理，不需要再次选择原文件。",
    retryable: true,
  };
  return {
    title: "这次没有整理完成",
    detail: "安全副本仍然保留，可以重新整理；如果仍然失败，再进入检查页确认文件内容。",
    retryable: true,
  };
}

function TemplateFilePicker({
  label,
  hint,
  ariaLabel,
  files,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  ariaLabel: string;
  files: File[];
  disabled: boolean;
  onChange: (files: FileList | null) => void;
}) {
  return (
    <label className="block rounded-md border border-dashed p-3 text-sm">
      <span className="font-medium">{label}</span>
      <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      <input
        className="sr-only"
        type="file"
        multiple
        disabled={disabled}
        aria-label={ariaLabel}
        accept={TEMPLATE_FILE_ACCEPT}
        onChange={(event) => onChange(event.target.files)}
      />
      <span className={`mt-2 inline-flex rounded-md border bg-background px-3 py-1.5 text-xs font-medium ${disabled ? "opacity-50" : "cursor-pointer hover:bg-muted"}`}>
        选择文件
      </span>
      {files.length ? (
        <ul className="mt-2 space-y-1 text-xs" aria-label={`${ariaLabel}已选文件`}>
          {files.map((file) => <li key={`${file.name}-${file.size}`} className="break-all text-success">{file.name} · {formatFileSize(file.size)}</li>)}
        </ul>
      ) : <span className="ml-2 text-xs text-muted-foreground">尚未选择</span>}
    </label>
  );
}

export function MyTemplatesView() {
  const queryClient = useQueryClient();
  const { data: consoleState } = useConsoleState();
  const projects = consoleState?.projects ?? [];
  const [caseDraftId, setCaseDraftId] = useState<string | null>(null);
  const [casePendingWorkItemId, setCasePendingWorkItemId] = useState<string | null>(null);
  const [caseError, setCaseError] = useState<string | null>(null);
  const [caseNotice, setCaseNotice] = useState<string | null>(null);
  const [activationFields, setActivationFields] = useState({ name: "", typicalInput: "", expectedOutput: "" });
  const [activationConfirmed, setActivationConfirmed] = useState(false);
  const [activationPending, setActivationPending] = useState(false);
  const sourcesQuery = useQuery({
    queryKey: ["workflow-memory", "sources"],
    queryFn: () => workflowMemoryApi.listWorkflowSources(),
  });
  const definitionsQuery = useQuery({
    queryKey: ["workflow-memory", "business-routine-definitions", "all"],
    queryFn: () => workflowMemoryApi.listBusinessRoutineDefinitions(),
  });
  const learningQuery = useQuery({
    queryKey: ["my-template-learning"],
    queryFn: () => api.listMyTemplateLearning() as Promise<{ feedback: MyTemplateLearningFeedback[]; count: number }>,
  });
  const ocrReadinessQuery = useQuery({
    queryKey: ["workflow-memory", "ocr-readiness"],
    queryFn: () => workflowMemoryApi.getWorkflowOcrReadiness(),
    staleTime: 60_000,
  });
  const outcomesQuery = useQuery({
    queryKey: ["my-template-outcomes"],
    queryFn: () => api.listMyTemplateOutcomes() as Promise<{
      feedback: MyTemplateOutcomeFeedback[]; summaries: MyTemplateOutcomeSummary[]; count: number;
    }>,
  });
  const taskDraftsQuery = useQuery({
    queryKey: ["my-template-drafts"],
    queryFn: () => api.listMyTemplateDrafts() as Promise<{ drafts: MyTemplateDraft[]; count: number }>,
  });
  const templateTasksQuery = useQuery({
    queryKey: ["workflow-memory", "template-learning-tasks"],
    queryFn: () => workflowMemoryApi.listTemplateLearningTasks(),
    refetchInterval: 2_000,
  });
  const similarTasksQuery = useQuery({
    queryKey: ["my-template-drafts", caseDraftId, "similar-work-items"],
    queryFn: () => api.listSimilarMyTemplateWorkItems(caseDraftId!) as Promise<SimilarMyTemplateResponse>,
    enabled: Boolean(caseDraftId),
  });
  const sources = sourcesQuery.data?.sources ?? [];
  const templates = useMemo(() => buildMyTemplateSummaries(
    sources,
    definitionsQuery.data?.routineDefinitions ?? [],
  ), [definitionsQuery.data?.routineDefinitions, sources]);
  const learningFeedback = learningQuery.data?.feedback ?? [];
  const outcomeFeedback = outcomesQuery.data?.feedback ?? [];
  const taskDrafts = taskDraftsQuery.data?.drafts ?? [];
  const learningTaskBySource = new Map((templateTasksQuery.data?.tasks ?? [])
    .map((task: TemplateLearningTask) => [task.sourceId, task] as const));
  const outcomeSummaryByFamily = new Map((outcomesQuery.data?.summaries ?? []).map((summary) => [summary.familyId, summary]));
  const [editorSourceId, setEditorSourceId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("sourceId"));
  const [advancedEditor, setAdvancedEditor] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [allowCloudOcr, setAllowCloudOcr] = useState(true);
  const [localCases, setLocalCases] = useState<LocalTemplateCase[]>([emptyTemplateCase(1)]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createNotice, setCreateNotice] = useState<{ message: string; sourceId?: string } | null>(null);
  const [retryTaskId, setRetryTaskId] = useState<string | null>(null);
  const learningStagesRef = useRef<Map<string, TemplateLearningTask["stage"]> | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ completed: number; total: number; phase: "copying" | "organizing" } | null>(null);
  const [recoverySourceId, setRecoverySourceId] = useState<string | null>(null);
  const [learningToRemove, setLearningToRemove] = useState<MyTemplateLearningFeedback | null>(null);
  const [learningRemovePending, setLearningRemovePending] = useState(false);
  const [learningRemoveError, setLearningRemoveError] = useState<string | null>(null);
  const [detailFamilyId, setDetailFamilyId] = useState<string | null>(null);
  const [feedbackToCorrect, setFeedbackToCorrect] = useState<MyTemplateOutcomeFeedback | null>(null);
  const [correctedOutcome, setCorrectedOutcome] = useState<MyTemplateOutcomeFeedback["outcome"]>("met_expectations");
  const [correctionPending, setCorrectionPending] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [resumeFamilyId, setResumeFamilyId] = useState<string | null>(null);
  const [resumePending, setResumePending] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const selectedLocalCases = localCases.filter((item) => item.inputs.length || item.outputs.length || item.references.length);
  const incompleteLocalCase = selectedLocalCases.find((item) => !item.inputs.length || !item.outputs.length);
  const selectedFiles = selectedLocalCases.flatMap((item) => [...item.inputs, ...item.outputs, ...item.references]);
  const selectedImagesNeedOcr = selectedFiles.some((file) => TEMPLATE_IMAGE_EXTENSIONS.has(fileExtension(file)));
  const selectedFilesMayNeedOcr = selectedFiles.some((file) =>
    TEMPLATE_IMAGE_EXTENSIONS.has(fileExtension(file)) || fileExtension(file) === "pdf");
  const cloudOcrConsentNeeded = Boolean(ocrReadinessQuery.data?.requiresCloudConsent);
  const imageOcrUnavailable = selectedImagesNeedOcr && (
    ocrReadinessQuery.data?.state === "unavailable" || (cloudOcrConsentNeeded && !allowCloudOcr)
  );
  const canStartTemplateLearning = selectedLocalCases.length > 0 && !incompleteLocalCase && !imageOcrUnavailable;
  const fileSelectionMessage = imageOcrUnavailable
    ? "图片需要文字识别。请允许使用 Codex AI 识别，或改用文字型 PDF、Word（.docx）或 Excel（.xlsx）。"
    : selectedFilesMayNeedOcr && cloudOcrConsentNeeded && allowCloudOcr
      ? "已选好文件。本机无法读取扫描件时，系统会自动切换到 Codex AI 识别。"
    : selectedLocalCases.length === 0
    ? "请先选择历史输入和对应的最终输出。"
    : incompleteLocalCase && !incompleteLocalCase.inputs.length && !incompleteLocalCase.outputs.length
      ? "这组案例还缺历史输入和最终输出。"
      : incompleteLocalCase && !incompleteLocalCase.inputs.length
        ? "这组案例还缺历史输入。"
        : incompleteLocalCase
          ? "这组案例还缺对应的最终输出。"
          : "输入和最终输出已选好，可以开始整理。";
  const settledLearningTaskSignature = (templateTasksQuery.data?.tasks ?? [])
    .filter((task) => ["needs_case_review", "completed", "failed"].includes(task.stage))
    .map((task) => `${task.id}:${task.stage}:${task.updatedAt}`)
    .join("|");

  useEffect(() => {
    if (!settledLearningTaskSignature) return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "sources"] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "business-routine-definitions"] }),
      queryClient.invalidateQueries({ queryKey: ["console-state"] }),
    ]);
  }, [queryClient, settledLearningTaskSignature]);

  useEffect(() => {
    const tasks = templateTasksQuery.data?.tasks;
    if (!tasks) return;
    const nextStages = new Map(tasks.map((task) => [task.id, task.stage] as const));
    const previousStages = learningStagesRef.current;
    learningStagesRef.current = nextStages;
    if (!previousStages) return;
    const changed = tasks.find((task) => previousStages.get(task.id) === "analyzing"
      && ["needs_case_review", "failed"].includes(task.stage));
    if (!changed) return;
    setCreateNotice(changed.stage === "needs_case_review"
      ? { message: `“${changed.name || "新模板"}”已经整理完成，可以检查并启用。`, sourceId: changed.sourceId }
      : { message: `“${changed.name || "新模板"}”没有整理完成，安全副本仍然保留。`, sourceId: changed.sourceId });
  }, [templateTasksQuery.data?.tasks]);

  const addLearningCase = async (suggestion: SimilarMyTemplateWorkItem) => {
    if (!caseDraftId || casePendingWorkItemId) return;
    const selectedDraft = similarTasksQuery.data?.draft ?? taskDrafts.find((draft) => draft.id === caseDraftId);
    if (!selectedDraft) return;
    setCasePendingWorkItemId(suggestion.workItem.id);
    setCaseError(null);
    setCaseNotice(null);
    try {
      const result = await api.addMyTemplateLearningCase(caseDraftId, {
        workItemId: suggestion.workItem.id,
        expectedDraftRevision: selectedDraft.revision,
        expectedWorkItemRevision: suggestion.workItem.revision,
        confirm: true,
      }) as { draft: MyTemplateDraft; readyForReview: boolean };
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["my-template-drafts"], exact: true }),
        queryClient.invalidateQueries({ queryKey: ["my-template-drafts", caseDraftId, "similar-work-items"], exact: true }),
      ]);
      setCaseNotice(result.readyForReview
        ? "案例已加入。当前已可确认启用，也可以继续补充更多案例。"
        : `案例已加入，还需要 ${Math.max(0, result.draft.casesRequired - result.draft.caseCount)} 个相似成功案例。`);
    } catch {
      setCaseError("暂时无法加入这个案例。任务或模板可能刚刚发生变化，请刷新后重试。");
    } finally {
      setCasePendingWorkItemId(null);
    }
  };

  const openTaskLearnedTemplate = (draft: MyTemplateDraft) => {
    setCaseError(null);
    setCaseNotice(null);
    setActivationConfirmed(false);
    setActivationFields({ name: draft.name, typicalInput: draft.typicalInput, expectedOutput: draft.expectedOutput });
    setCaseDraftId(draft.id);
  };

  const activateTaskLearnedTemplate = async () => {
    if (!caseDraftId || activationPending || !activationConfirmed) return;
    const selectedDraft = similarTasksQuery.data?.draft ?? taskDrafts.find((draft) => draft.id === caseDraftId);
    if (!selectedDraft) return;
    setActivationPending(true);
    setCaseError(null);
    setCaseNotice(null);
    try {
      await api.activateMyTemplateDraft(caseDraftId, {
        expectedDraftRevision: selectedDraft.revision,
        confirm: true,
        name: activationFields.name,
        typicalInput: activationFields.typicalInput,
        expectedOutput: activationFields.expectedOutput,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["my-template-drafts"], exact: true }),
        queryClient.invalidateQueries({ queryKey: ["my-template-drafts", caseDraftId, "similar-work-items"], exact: true }),
        queryClient.invalidateQueries({ queryKey: ["workflow-memory", "business-routine-definitions"] }),
      ]);
      setActivationConfirmed(false);
      setCaseNotice("已启用。以后创建相似任务时，系统会自动判断是否使用这个模板；历史任务不会改变。");
    } catch {
      setCaseError("暂时无法启用。模板可能刚刚发生变化，或已有内容相同的模板，请刷新后重试。");
    } finally {
      setActivationPending(false);
    }
  };

  const removeLearning = async () => {
    if (!learningToRemove || learningRemovePending) return;
    setLearningRemovePending(true);
    setLearningRemoveError(null);
    try {
      await api.removeMyTemplateLearning(learningToRemove.id);
      await queryClient.invalidateQueries({ queryKey: ["my-template-learning"] });
      setLearningToRemove(null);
    } catch (caught) {
      setLearningRemoveError(caught instanceof Error ? caught.message : "无法撤销这条学习");
    } finally {
      setLearningRemovePending(false);
    }
  };

  const saveOutcomeCorrection = async () => {
    if (!feedbackToCorrect || correctionPending) return;
    setCorrectionPending(true);
    setCorrectionError(null);
    try {
      await api.recordMyTemplateOutcomeFeedback(feedbackToCorrect.workItemId, {
        outcome: correctedOutcome,
        note: feedbackToCorrect.note,
      });
      await queryClient.invalidateQueries({ queryKey: ["my-template-outcomes"] });
      setFeedbackToCorrect(null);
    } catch (caught) {
      setCorrectionError(caught instanceof Error ? caught.message : "反馈暂时无法修正");
    } finally {
      setCorrectionPending(false);
    }
  };

  const resumeObservation = async () => {
    if (!resumeFamilyId || resumePending) return;
    const template = templates.find((candidate) => candidate.familyId === resumeFamilyId);
    if (!template) return;
    setResumePending(true);
    setResumeError(null);
    try {
      await api.resumeMyTemplateGovernanceObservation(resumeFamilyId, {
        projectId: template.projectId,
        confirm: true,
      });
      await queryClient.invalidateQueries({ queryKey: ["my-template-outcomes"] });
      setResumeFamilyId(null);
    } catch (caught) {
      setResumeError(caught instanceof Error ? caught.message : "暂时无法恢复观察");
    } finally {
      setResumePending(false);
    }
  };

  const openEditor = (sourceId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("sourceId", sourceId);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setAdvancedEditor(false);
    setEditorSourceId(sourceId);
  };
  const closeEditor = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("sourceId");
    url.searchParams.delete("returnWorkItemId");
    url.hash = "";
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    setEditorSourceId(null);
    setAdvancedEditor(false);
  };

  const createTemplate = async () => {
    if (pending) return;
    const preparedCases = selectedLocalCases;
    if (!preparedCases.length || preparedCases.some((item) => !item.inputs.length || !item.outputs.length)) {
      setError("每组历史案例都需要至少一个输入文件和一个对应的最终输出文件。");
      return;
    }
    setPending(true);
    setError(null);
    setRecoverySourceId(null);
    const totalFiles = preparedCases.reduce((total, item) => total + item.inputs.length + item.outputs.length + item.references.length, 0);
    let completedFiles = 0;
    let createdSourceId: string | null = null;
    setUploadProgress({ completed: 0, total: totalFiles, phase: "copying" });
    try {
      const created = await workflowMemoryApi.createTemplateLearningTask({
        name: name.trim(),
        allowCloudOcr,
      });
      createdSourceId = created.source.id;
      for (const [caseIndex, item] of preparedCases.entries()) {
        const caseId = `case-${caseIndex + 1}`;
        for (const file of item.inputs) {
          await workflowMemoryApi.uploadTemplateLearningFile(created.task.id, caseId, "input", file);
          completedFiles += 1;
          setUploadProgress({ completed: completedFiles, total: totalFiles, phase: "copying" });
        }
        for (const file of item.outputs) {
          await workflowMemoryApi.uploadTemplateLearningFile(created.task.id, caseId, "output", file);
          completedFiles += 1;
          setUploadProgress({ completed: completedFiles, total: totalFiles, phase: "copying" });
        }
        for (const file of item.references) {
          await workflowMemoryApi.uploadTemplateLearningFile(created.task.id, caseId, "reference", file);
          completedFiles += 1;
          setUploadProgress({ completed: completedFiles, total: totalFiles, phase: "copying" });
        }
      }
      setUploadProgress({ completed: totalFiles, total: totalFiles, phase: "organizing" });
      await workflowMemoryApi.startTemplateLearningTask(created.task.id, { allowCloudOcr });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workflow-memory", "sources"] }),
        queryClient.invalidateQueries({ queryKey: ["workflow-memory", "business-routine-definitions"] }),
        queryClient.invalidateQueries({ queryKey: ["workflow-memory", "template-learning-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["console-state"] }),
      ]);
      setCreateOpen(false);
      setName("");
      setAllowCloudOcr(true);
      setLocalCases([emptyTemplateCase(1)]);
      setCreateNotice({ message: "文件已安全复制，系统正在后台整理。你可以先做别的事，整理好后会在通知中心提醒你。" });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      const failure = learningFailureCopy(message);
      setError(`${failure.title}。${failure.detail}`);
      setRecoverySourceId(createdSourceId);
    } finally {
      setPending(false);
      setUploadProgress(null);
    }
  };

  const retryTemplateTask = async (task: TemplateLearningTask) => {
    if (retryTaskId) return;
    setRetryTaskId(task.id);
    setCreateNotice(null);
    try {
      const useCodexOcr = String(task.lastError ?? "").includes("ocr");
      await workflowMemoryApi.startTemplateLearningTask(task.id, { allowCloudOcr: useCodexOcr });
      setCreateNotice({ message: useCodexOcr
        ? "已允许使用 Codex AI 识别扫描件并继续整理；原始文件不会被修改。"
        : "已重新开始整理，原始文件和已保存的安全副本都不会被修改。" });
      await queryClient.invalidateQueries({ queryKey: ["workflow-memory", "template-learning-tasks"] });
    } catch {
      setCreateNotice({ message: "暂时无法重新整理。安全副本仍然保留，可以稍后再试。", sourceId: task.sourceId });
    } finally {
      setRetryTaskId(null);
    }
  };

  if (editorSourceId) {
    if (advancedEditor) {
      return <WorkflowMemoryView onBack={() => setAdvancedEditor(false)} backLabel="返回简易向导" />;
    }
    return (
      <MyTemplateSetupWizard
        sourceId={editorSourceId}
        onBack={closeEditor}
        onOpenAdvanced={() => setAdvancedEditor(true)}
      />
    );
  }

  const loading = sourcesQuery.isLoading || definitionsQuery.isLoading || taskDraftsQuery.isLoading;
  const readyCount = templates.filter((template) => template.state === "ready").length
    + taskDrafts.filter((draft) => draft.state === "ready").length;
  const attentionCount = templates.filter((template) => ["learning", "needs_review"].includes(template.state)).length
    + taskDrafts.filter((draft) => draft.state !== "ready" && draft.state !== "rejected").length;
  const selectedTaskDraft = similarTasksQuery.data?.draft
    ?? taskDrafts.find((draft) => draft.id === caseDraftId)
    ?? null;
  const canActivateSelectedDraft = selectedTaskDraft?.state === "needs_review"
    && Boolean(similarTasksQuery.data?.review.readiness.canEnable);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-3 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="size-6 text-primary" aria-hidden="true" />
            <h1 className="text-2xl font-semibold">我的模板</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            从你本地电脑的历史工作中，学习“收到什么、怎样处理、最后得到什么”。
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}><Plus /> 创建我的模板</Button>
      </header>

      <ChannelObjectRegistryCard />

      {templates.length || taskDrafts.length ? (
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge tone="success">{readyCount} 个已启用</Badge>
          {attentionCount ? <Badge tone="warning">{attentionCount} 个需要继续</Badge> : null}
        </div>
      ) : null}

      {createNotice ? (
        <div className="rounded-lg border border-success/30 bg-success/[0.05] p-3 text-sm" role="status">
          <div className="flex items-start justify-between gap-3">
            <span>{createNotice.message}</span>
            {createNotice.sourceId ? <Button size="sm" onClick={() => openEditor(createNotice.sourceId!)}>立即检查</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => setCreateNotice(null)}>知道了</Button>
          </div>
        </div>
      ) : null}

      <details className="order-5 rounded-xl border bg-card">
        <summary className="flex cursor-pointer items-center gap-2 px-5 py-4 text-sm font-medium">
          <BrainCircuit className="size-4 text-primary" aria-hidden="true" />
          学习与纠正记录
          <Badge tone="neutral">{learningFeedback.length} 条</Badge>
        </summary>
        <Card className="border-0 shadow-none">
        <CardContent className="border-t p-5">
          <div className="flex items-start gap-3">
            <BrainCircuit className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <h2 id="learned-preferences-heading" className="font-semibold">系统记住的选择</h2>
              <p className="mt-1 text-sm text-muted-foreground">这里来自你对任务结果的纠正，只帮助以后判断相似任务，不会改变已有任务。</p>
            </div>
          </div>
          {learningQuery.isLoading ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在读取…</p>
          ) : learningQuery.isError ? (
            <p className="mt-4 text-sm text-destructive" role="alert">暂时无法读取系统记住的选择。</p>
          ) : learningFeedback.length ? (
            <ul className="mt-4 divide-y rounded-lg border" aria-labelledby="learned-preferences-heading">
              {learningFeedback.map((feedback) => {
                const project = projects.find((candidate) => candidate.id === feedback.projectId);
                const subject = feedback.intentTerms.length ? `任务提到“${feedback.intentTerms.join("、")}”时` : "遇到相似任务时";
                return (
                  <li key={feedback.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm"><span className="font-medium">{subject}</span>，优先得到“{feedback.selectedOutput}”{feedback.rejectedOutput ? `，而不是“${feedback.rejectedOutput}”` : "（由你确认）"}。</p>
                        {feedback.state === "conflict" ? <Badge tone="warning">存在冲突</Badge> : <Badge tone="success">正在使用</Badge>}
                      </div>
                      {feedback.state === "conflict" ? (
                        <p className="mt-1 text-xs text-warning">你曾为类似任务选择不同结果；创建任务时系统会先请你确认。</p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {project?.name ?? "当前项目"}{feedback.workItem ? ` · 来自 ${feedback.workItem.localRef} ${feedback.workItem.title}` : ""}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => { setLearningRemoveError(null); setLearningToRemove(feedback); }}>
                      <Trash2 />忘记这条
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">还没有记住任何纠正。以后在任务中点击“结果不对”，确认后的选择会出现在这里。</p>
          )}
        </CardContent>
        </Card>
      </details>

      {taskDrafts.length ? (
        <section className="order-2" aria-labelledby="task-template-drafts-heading">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="task-template-drafts-heading" className="text-lg font-semibold">从任务学会的模板</h2>
              <p className="mt-1 text-sm text-muted-foreground">一个成功案例即可确认启用；你也可以继续补充相似案例，让适用范围更准确。</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {taskDrafts.map((draft) => (
              <Card key={draft.id} className="overflow-hidden border-warning/30">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-semibold">{draft.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{draft.state === "ready"
                        ? "已经参与未来任务的自动匹配，历史任务不会被改变。"
                        : "来自已完成的普通任务，确认前不会参与自动匹配。"}</p>
                    </div>
                    <Badge tone={draft.state === "ready" ? "success" : "warning"}>
                      {draft.state === "ready" ? "已启用" : draft.state === "needs_review" ? "待确认" : "学习中"}
                    </Badge>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><FileInput className="size-3.5" /> 收到什么</p>
                      <p className="mt-1 text-sm font-medium">{draft.typicalInput}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><FileOutput className="size-3.5" /> 最后得到</p>
                      <p className="mt-1 text-sm font-medium">{draft.expectedOutput}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm">{draft.applicability}</p>
                  <div className="mt-3 rounded-lg border border-warning/25 bg-warning/[0.04] p-3 text-sm">
                    <p className="font-medium">已从 {draft.caseCount} 个成功案例中学习</p>
                    <p className="mt-1 text-xs text-muted-foreground">{draft.state === "ready"
                      ? "已启用；后续任务结果会继续帮助系统校正匹配。"
                      : draft.caseCount >= 1
                        ? "现在即可检查学习结果并确认启用，不必等待更多案例。"
                        : "至少需要一个有明确交付结果的成功案例。"}</p>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <History className="size-3.5" />
                    <span className="truncate">学习自：{draft.origin.localRef ? `${draft.origin.localRef} · ` : ""}{draft.origin.title}</span>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button variant={draft.state === "needs_review" ? "primary" : "secondary"} onClick={() => openTaskLearnedTemplate(draft)}>
                      <Eye />{draft.state === "ready" ? "查看已学内容" : draft.state === "needs_review" ? "检查并启用" : "查看学习结果"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {loading ? (
        <Card><CardContent className="grid min-h-52 place-items-center"><Loader2 className="animate-spin text-primary" /></CardContent></Card>
      ) : templates.length === 0 && taskDrafts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="grid min-h-72 place-items-center p-6 text-center">
            <div className="max-w-md">
              <History className="mx-auto size-10 text-primary" aria-hidden="true" />
              <h2 className="mt-4 text-lg font-semibold">先让 AI 学会一项你经常做的工作</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                选择一组历史输入文件和对应的最终输出文件。系统会先复制到安全工作区，再识别规律并交给你确认。
              </p>
              <Button className="mt-4" onClick={() => setCreateOpen(true)}><Plus /> 创建我的模板</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((template) => {
            const state = STATE_COPY[template.state];
            const outcomeSummary = template.familyId ? outcomeSummaryByFamily.get(template.familyId) : null;
            const governance = outcomeSummary?.governance;
            const learningTask = learningTaskBySource.get(template.sourceId);
            return (
              <Card key={template.id} className="overflow-hidden">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold">{template.name}</h2>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{template.description}</p>
                    </div>
                    <Badge className="shrink-0 whitespace-nowrap" tone={state.tone}>{state.label}</Badge>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><FileInput className="size-3.5" /> 收到什么</p>
                      <p className="mt-1 text-sm font-medium">{template.input}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><FileOutput className="size-3.5" /> 最后得到</p>
                      <p className="mt-1 text-sm font-medium">{template.output}</p>
                    </div>
                  </div>

                  <p className="mt-3 text-sm">{template.applicability}</p>
                  {learningTask?.stage === "analyzing" ? (
                    <div className="mt-3 rounded-lg border bg-muted/15 p-3 text-sm" role="status">
                      <div className="flex items-center justify-between gap-2"><span>系统正在整理安全副本</span><span>{learningTask.progress}%</span></div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${learningTask.progress}%` }} /></div>
                    </div>
                  ) : null}
                  {learningTask?.stage === "needs_case_review" ? (
                    <div className="mt-3 rounded-lg border border-success/30 bg-success/[0.04] p-3 text-sm">
                      系统已整理完成，请检查名称、输入、输出和步骤后启用。
                    </div>
                  ) : null}
                  {learningTask?.stage === "failed" ? (
                    <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/[0.04] p-3 text-sm" role="alert">
                      <p className="font-medium">{learningFailureCopy(learningTask.lastError).title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{learningFailureCopy(learningTask.lastError).detail}</p>
                    </div>
                  ) : null}
                  {outcomeSummary ? (
                    <div className="mt-3 rounded-lg border bg-muted/15 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">实际任务反馈</p>
                        <Badge tone={governance?.state === "paused" || governance?.state === "watch" ? "warning" : governance?.state === "trusted" ? "success" : "neutral"}>
                          {governance?.state === "paused" ? "已暂停"
                            : governance?.manualObservation || governance?.state === "watch" ? "使用前确认"
                              : governance?.state === "trusted" ? "已启用" : "学习中"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {outcomeSummary.total} 次反馈 · {outcomeSummary.metExpectations} 次符合预期
                        {outcomeSummary.wrongResult ? ` · ${outcomeSummary.wrongResult} 次结果类型不对` : ""}
                        {outcomeSummary.needsQualityAdjustment ? ` · ${outcomeSummary.needsQualityAdjustment} 次内容需调整` : ""}
                      </p>
                      {governance?.manualObservation ? (
                        <p className="mt-2 text-xs text-muted-foreground">这个模板已经恢复使用，目前每次使用前都会请你确认。积累新的成功结果后，会恢复自动使用。</p>
                      ) : governance?.state === "watch" ? (
                        <p className="mt-2 text-xs text-warning">近期有较多“结果类型不对”的反馈，使用前会先请你确认。</p>
                      ) : governance?.state === "paused" ? (
                        <p className="mt-2 text-xs text-warning">近期多次产生错误结果类型，系统已暂停使用。修正误标反馈后，你也可以手动恢复。</p>
                      ) : outcomeSummary.needsQualityAdjustment ? (
                        <p className="mt-2 text-xs text-muted-foreground">内容质量反馈只用于改进结果，不会因此暂停这个模板。</p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setDetailFamilyId(template.familyId)}>
                          <Eye />查看使用情况
                        </Button>
                        {governance?.state === "paused" ? (
                          <Button size="sm" variant="secondary" onClick={() => { setResumeError(null); setResumeFamilyId(template.familyId); }}>
                            <RotateCcw />恢复使用
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <History className="size-3.5" />
                    <span>{template.historyCaseCount || learningTask?.cases.length || 0} 组历史案例</span>
                    {template.definitionVersion ? <span>· v{template.definitionVersion}</span> : null}
                  </div>

                  <div className="mt-4 flex justify-end">
                    <Button
                      variant={template.state === "ready" ? "secondary" : "primary"}
                      disabled={learningTask?.stage === "analyzing" || retryTaskId === learningTask?.id}
                      onClick={() => learningTask?.stage === "failed" && learningFailureCopy(learningTask.lastError).retryable
                        ? void retryTemplateTask(learningTask)
                        : openEditor(template.sourceId)}
                    >
                      {learningTask?.stage === "analyzing" ? <><Loader2 className="animate-spin" />正在后台整理</>
                        : learningTask?.stage === "failed" ? learningFailureCopy(learningTask.lastError).retryable
                          ? String(learningTask.lastError ?? "").includes("ocr")
                            ? <><RotateCcw />使用 AI 识别并继续</>
                            : <><RotateCcw />重新整理</>
                          : <><Eye />检查文件用途</>
                          : learningTask?.stage === "needs_case_review" ? <>检查并启用 <ArrowRight /></>
                            : <>{template.state === "ready" ? "查看和管理" : "继续完成"} <ArrowRight /></>}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(caseDraftId)}
        onClose={() => { if (!casePendingWorkItemId && !activationPending) setCaseDraftId(null); }}
        title={`${selectedTaskDraft?.name ?? "我的模板"} · ${selectedTaskDraft?.state === "ready" ? "已学内容" : "检查学习结果"}`}
        description="先确认系统学到的任务目标、适用输入和预期产出。只有你明确启用后，它才会参与未来任务的自动匹配。"
        closeDisabled={Boolean(casePendingWorkItemId) || activationPending}
        size="xl"
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" disabled={Boolean(casePendingWorkItemId) || activationPending} onClick={() => setCaseDraftId(null)}>关闭</Button>
            {canActivateSelectedDraft ? (
              <Button
                disabled={!activationConfirmed || activationPending || !activationFields.name.trim()
                  || !activationFields.typicalInput.trim() || !activationFields.expectedOutput.trim()}
                onClick={() => { void activateTaskLearnedTemplate(); }}
              >
                {activationPending ? <Loader2 className="animate-spin" /> : <Check />}
                {activationPending ? "正在启用" : "确认并启用自动匹配"}
              </Button>
            ) : null}
          </div>
        )}
      >
        {similarTasksQuery.isLoading ? (
          <p className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" />正在查找相似的已完成任务…
          </p>
        ) : similarTasksQuery.isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/[0.04] p-3 text-sm" role="alert">
            <p>暂时无法读取相似任务。</p>
            <Button className="mt-2" size="sm" variant="secondary" onClick={() => { void similarTasksQuery.refetch(); }}>重试</Button>
          </div>
        ) : similarTasksQuery.data ? (
          <div className="space-y-5">
            <section aria-labelledby="learned-template-result-heading" className="rounded-xl border border-primary/25 bg-primary/[0.03] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 id="learned-template-result-heading" className="font-semibold">系统学到了什么</h3>
                  <p className="mt-1 text-xs text-muted-foreground">如有不准确，可以直接修改后再启用。</p>
                </div>
                <Badge tone={similarTasksQuery.data.draft.state === "ready" ? "success" : "warning"}>
                  {similarTasksQuery.data.draft.state === "ready" ? "正在用于未来任务" : "尚未启用"}
                </Badge>
              </div>
              <div className="mt-4 space-y-3">
                <label className="block text-sm font-medium" htmlFor="learned-template-name">
                  这项工作叫什么
                  <Input
                    id="learned-template-name"
                    className="mt-1.5"
                    value={activationFields.name}
                    disabled={similarTasksQuery.data.draft.state === "ready"}
                    onChange={(event) => setActivationFields((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium" htmlFor="learned-template-input">
                    哪些输入适用
                    <Textarea
                      id="learned-template-input"
                      className="mt-1.5 min-h-24"
                      value={activationFields.typicalInput}
                      disabled={similarTasksQuery.data.draft.state === "ready"}
                      onChange={(event) => setActivationFields((current) => ({ ...current, typicalInput: event.target.value }))}
                    />
                  </label>
                  <label className="block text-sm font-medium" htmlFor="learned-template-output">
                    最后应该得到什么
                    <Textarea
                      id="learned-template-output"
                      className="mt-1.5 min-h-24"
                      value={activationFields.expectedOutput}
                      disabled={similarTasksQuery.data.draft.state === "ready"}
                      onChange={(event) => setActivationFields((current) => ({ ...current, expectedOutput: event.target.value }))}
                    />
                  </label>
                </div>
                <p className="rounded-lg bg-muted/30 p-3 text-sm">
                  <span className="font-medium">以后什么时候使用：</span>
                  当任务收到“{activationFields.typicalInput || "尚未填写的输入"}”，并希望得到“{activationFields.expectedOutput || "尚未填写的结果"}”时，系统会自动判断是否匹配。
                </p>
                {similarTasksQuery.data.review.learnedResult.steps.length ? (
                  <div>
                    <p className="text-sm font-medium">学到的处理方法</p>
                    <ol className="mt-2 grid gap-2 sm:grid-cols-3">
                      {similarTasksQuery.data.review.learnedResult.steps.map((step, index) => (
                        <li key={`${index}-${step}`} className="rounded-lg border bg-background p-2.5 text-sm">
                          <span className="mr-1.5 text-xs text-muted-foreground">{index + 1}.</span>{step}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
                <div className="rounded-lg border border-success/30 bg-success/[0.05] p-3 text-sm">
                  <p className="font-medium">{similarTasksQuery.data.review.readiness.message}</p>
                  {similarTasksQuery.data.review.readiness.confidence === "initial" ? (
                    <p className="mt-1 text-xs text-muted-foreground">目前依据 1 个成功案例。可以立即使用，建议关注前几次任务结果；如有偏差可通过结果反馈继续纠正。</p>
                  ) : null}
                </div>
                {canActivateSelectedDraft ? (
                  <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                    <input
                      className="mt-0.5 size-4"
                      type="checkbox"
                      checked={activationConfirmed}
                      onChange={(event) => setActivationConfirmed(event.target.checked)}
                    />
                    <span>我确认以上输入和产出描述正确，并同意它只用于判断未来的新任务。</span>
                  </label>
                ) : null}
              </div>
            </section>

            <section aria-labelledby="confirmed-learning-cases-heading">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="confirmed-learning-cases-heading" className="font-semibold">已确认案例</h3>
                <Badge tone={similarTasksQuery.data.draft.state === "needs_review" ? "success" : "warning"}>
                  {similarTasksQuery.data.draft.caseCount} / {similarTasksQuery.data.draft.casesRequired}
                </Badge>
              </div>
              <ul className="mt-2 divide-y rounded-lg border" aria-label="已确认的模板案例">
                {similarTasksQuery.data.cases.map((learningCase) => (
                  <li key={learningCase.id} className="p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{learningCase.workItem.localRef ? `${learningCase.workItem.localRef} · ` : ""}{learningCase.workItem.title}</p>
                      {learningCase.similarity ? <Badge tone="neutral">人工确认加入</Badge> : <Badge tone="neutral">创建来源</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">输入：{learningCase.typicalInput} · 结果：{learningCase.expectedOutput}</p>
                  </li>
                ))}
              </ul>
              {similarTasksQuery.data.draft.state === "needs_review" ? (
                <p className="mt-2 rounded-lg border border-success/30 bg-success/[0.05] p-3 text-sm text-success">
                  已有一个明确结果的成功案例，现在即可确认启用；补充更多案例是可选的。
                </p>
              ) : null}
            </section>

            {similarTasksQuery.data.draft.state !== "ready" ? <section aria-labelledby="suggested-learning-cases-heading">
              <h3 id="suggested-learning-cases-heading" className="font-semibold">可选：再补充相似案例</h3>
              <p className="mt-1 text-xs text-muted-foreground">不补充也可以启用。这里只是建议，不会自动加入，也不会改变原任务。</p>
              {similarTasksQuery.data.suggestions.length ? (
                <ul className="mt-2 space-y-3" aria-label="推荐的相似任务">
                  {similarTasksQuery.data.suggestions.map((suggestion) => (
                    <li key={suggestion.workItem.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{suggestion.workItem.localRef ? `${suggestion.workItem.localRef} · ` : ""}{suggestion.workItem.title}</p>
                            <Badge tone={suggestion.confidence === "high" ? "success" : "neutral"}>相似度 {Math.round(suggestion.similarity * 100)}%</Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{suggestion.reasons.join(" · ")}</p>
                          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                            <p className="rounded-md bg-muted/25 px-2.5 py-2"><span className="text-xs text-muted-foreground">收到：</span>{suggestion.typicalInput}</p>
                            <p className="rounded-md bg-muted/25 px-2.5 py-2"><span className="text-xs text-muted-foreground">得到：</span>{suggestion.expectedOutput}</p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          disabled={Boolean(casePendingWorkItemId)}
                          onClick={() => { void addLearningCase(suggestion); }}
                        >
                          {casePendingWorkItemId === suggestion.workItem.id ? <Loader2 className="animate-spin" /> : <Plus />}
                          {casePendingWorkItemId === suggestion.workItem.id ? "正在加入" : "确认加入案例"}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">暂时没有足够相似的已完成任务。以后有新的相似任务完成后，会自动出现在这里供你确认。</p>
              )}
            </section> : null}
            {caseNotice ? <p className="rounded-lg border border-success/30 bg-success/[0.05] p-3 text-sm text-success" role="status">{caseNotice}</p> : null}
            {caseError ? <p className="text-sm text-destructive" role="alert">{caseError}</p> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(learningToRemove)}
        onClose={() => !learningRemovePending && setLearningToRemove(null)}
        title="让系统忘记这条选择？"
        description="撤销后，系统不再用这条偏好判断未来任务。已经创建或执行的任务不会改变。"
        closeDisabled={learningRemovePending}
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={learningRemovePending} onClick={() => setLearningToRemove(null)}>取消</Button>
            <Button variant="destructive" disabled={learningRemovePending} onClick={() => { void removeLearning(); }}>
              {learningRemovePending ? <Loader2 className="animate-spin" /> : <Trash2 />}确认忘记
            </Button>
          </div>
        )}
      >
        {learningToRemove ? (
          <div className="space-y-3 text-sm">
            <p>系统将忘记：优先得到“{learningToRemove.selectedOutput}”{learningToRemove.rejectedOutput ? `，而不是“${learningToRemove.rejectedOutput}”` : "（由你确认）"}。</p>
            {learningRemoveError ? <p role="alert" className="text-destructive">{learningRemoveError}</p> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(detailFamilyId)}
        onClose={() => setDetailFamilyId(null)}
        title={`${templates.find((template) => template.familyId === detailFamilyId)?.name ?? "我的模板"} · 使用情况`}
        description="查看哪些真实任务影响了当前状态。你可以修正误标，已有记录仍会保留。"
        footer={(() => {
          const summary = detailFamilyId ? outcomeSummaryByFamily.get(detailFamilyId) : null;
          return (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setDetailFamilyId(null)}>关闭</Button>
              {summary?.governance.state === "paused" ? (
                <Button onClick={() => { setResumeError(null); setResumeFamilyId(detailFamilyId); }}>
                  <RotateCcw />恢复使用
                </Button>
              ) : null}
            </div>
          );
        })()}
      >
        {detailFamilyId ? (() => {
          const summary = outcomeSummaryByFamily.get(detailFamilyId);
          const rows = outcomeFeedback.filter((entry) => entry.familyId === detailFamilyId);
          return (
            <div className="space-y-3 text-sm">
              {summary ? (
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="font-medium">
                    当前状态：{summary.governance.state === "paused" ? "已暂停"
                      : summary.governance.manualObservation || summary.governance.state === "watch" ? "使用前确认"
                        : summary.governance.state === "trusted" ? "已启用" : "学习中"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    当前判断使用 {summary.governance.matchingFeedbackCount} 条结果类型反馈。
                    {summary.governance.historicalFeedbackCount ? ` ${summary.governance.historicalFeedbackCount} 条恢复前反馈仅作为历史记录。` : ""}
                  </p>
                </div>
              ) : null}
              {rows.length ? (
                <ul className="divide-y rounded-lg border" aria-label="影响治理的任务反馈">
                  {rows.map((feedback) => (
                    <li key={feedback.id} className="p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium">{feedback.workItem
                            ? `${feedback.workItem.localRef} ${feedback.workItem.title}` : "原任务已不可用"}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge tone={feedback.outcome === "wrong_result" ? "warning" : feedback.outcome === "met_expectations" ? "success" : "neutral"}>
                              {OUTCOME_COPY[feedback.outcome]}
                            </Badge>
                            <span>{feedback.governanceImpact === "historical_baseline" ? "恢复前历史记录，不参与当前判断"
                              : feedback.governanceImpact === "negative" ? "降低匹配可信度"
                                : feedback.governanceImpact === "positive" ? "支持当前匹配"
                                  : "只影响内容优化，不影响匹配"}</span>
                            <span>· {new Date(feedback.updatedAt).toLocaleString()}</span>
                          </div>
                          {feedback.note ? <p className="mt-1 text-xs text-muted-foreground">备注：{feedback.note}</p> : null}
                        </div>
                        {feedback.workItem ? (
                          <Button size="sm" variant="ghost" onClick={() => {
                            setCorrectionError(null);
                            setCorrectedOutcome(feedback.outcome);
                            setFeedbackToCorrect(feedback);
                          }}><PencilLine />修正反馈</Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="rounded-lg border border-dashed p-3 text-muted-foreground">还没有真实任务反馈。</p>}
            </div>
          );
        })() : null}
      </Modal>

      <Modal
        open={Boolean(feedbackToCorrect)}
        onClose={() => !correctionPending && setFeedbackToCorrect(null)}
        title="修正这条任务反馈"
        description="修正后系统会立即重新计算匹配状态，不会改变该任务已经产生的结果。"
        closeDisabled={correctionPending}
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={correctionPending} onClick={() => setFeedbackToCorrect(null)}>取消</Button>
            <Button disabled={correctionPending || correctedOutcome === feedbackToCorrect?.outcome} onClick={() => { void saveOutcomeCorrection(); }}>
              {correctionPending ? <Loader2 className="animate-spin" /> : <Check />}保存修正
            </Button>
          </div>
        )}
      >
        <div className="space-y-3 text-sm">
          <p>{feedbackToCorrect?.workItem ? `${feedbackToCorrect.workItem.localRef} ${feedbackToCorrect.workItem.title}` : ""}</p>
          <label className="block space-y-1.5">
            <span className="font-medium">这次实际情况</span>
            <Select value={correctedOutcome} onChange={(event) => setCorrectedOutcome(event.target.value as MyTemplateOutcomeFeedback["outcome"])}>
              <option value="met_expectations">符合预期</option>
              <option value="wrong_result">结果类型不对</option>
              <option value="needs_quality_adjustment">结果类型正确，但内容需要调整</option>
            </Select>
          </label>
          {correctionError ? <p role="alert" className="text-destructive">{correctionError}</p> : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(resumeFamilyId)}
        onClose={() => !resumePending && setResumeFamilyId(null)}
        title="恢复使用这个模板？"
        description="恢复后不会立即自动使用。新任务使用前仍会请你确认，并从后续新任务开始累计判断。"
        closeDisabled={resumePending}
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={resumePending} onClick={() => setResumeFamilyId(null)}>取消</Button>
            <Button disabled={resumePending} onClick={() => { void resumeObservation(); }}>
              {resumePending ? <Loader2 className="animate-spin" /> : <RotateCcw />}确认恢复
            </Button>
          </div>
        )}
      >
        <div className="space-y-2 text-sm">
          <p>恢复前的反馈会继续显示为历史记录，但不再影响当前是否使用这个模板。</p>
          <p className="text-muted-foreground">如果后续再次连续出现错误结果类型，系统仍会先要求确认，必要时再次暂停。</p>
          {resumeError ? <p role="alert" className="text-destructive">{resumeError}</p> : null}
        </div>
      </Modal>

      <Modal
        open={createOpen}
        onClose={() => !pending && setCreateOpen(false)}
        title="创建我的模板"
        description="选择一组历史输入和对应的最终输出即可创建模板；系统只处理安全副本。"
        closeDisabled={pending}
        size="lg"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={pending} onClick={() => setCreateOpen(false)}>取消</Button>
            <Button
              disabled={pending || !canStartTemplateLearning}
              onClick={createTemplate}
            >
              {pending ? <Loader2 className="animate-spin" /> : <Check />}
              {pending ? uploadProgress?.phase === "organizing" ? "正在识别并整理…" : "正在安全复制…" : "开始学习"}
            </Button>
          </div>
        )}
      >
        <div className="space-y-4">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">工作名称（可选）</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="留空即可，系统会根据文件自动命名" autoFocus />
          </label>

          <div className="space-y-3">
            {localCases.map((item, index) => {
              const updateFiles = (field: "inputs" | "outputs" | "references", files: FileList | null) => {
                const selected = Array.from(files ?? []);
                setLocalCases((current) => current.map((candidate) =>
                  candidate.id === item.id ? { ...candidate, [field]: selected } : candidate));
              };
              return (
                <div key={item.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">历史案例 {index + 1}</p>
                    {localCases.length > 1 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        aria-label={`删除历史案例 ${index + 1}`}
                        onClick={() => setLocalCases((current) => current.filter((candidate) => candidate.id !== item.id))}
                      ><Trash2 />删除</Button>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <TemplateFilePicker
                      label="历史输入"
                      hint="支持文字型 PDF、Word（.docx）、Excel（.xlsx）、常见图片及文本文件"
                      ariaLabel={`案例 ${index + 1} 的历史输入`}
                      files={item.inputs}
                      disabled={pending}
                      onChange={(files) => updateFiles("inputs", files)}
                    />
                    <TemplateFilePicker
                      label="对应的最终输出"
                      hint="选择当时确认完成的结果；支持格式与历史输入相同"
                      ariaLabel={`案例 ${index + 1} 的最终输出`}
                      files={item.outputs}
                      disabled={pending}
                      onChange={(files) => updateFiles("outputs", files)}
                    />
                  </div>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium">添加参考资料（可选）</summary>
                    <div className="mt-2"><TemplateFilePicker
                      label="参考资料"
                      hint="例如价目表、客户资料或填写说明"
                      ariaLabel={`案例 ${index + 1} 的参考资料`}
                      files={item.references}
                      disabled={pending}
                      onChange={(files) => updateFiles("references", files)}
                    /></div>
                  </details>
                </div>
              );
            })}
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">可选：补充更多历史案例</summary>
              <Button
                className="mt-2"
                variant="secondary"
                disabled={pending || localCases.length >= 20}
                onClick={() => setLocalCases((current) => [...current, emptyTemplateCase(current.length + 1)])}
              ><Plus />添加另一组历史案例</Button>
            </details>
          </div>

          {!pending ? (
            <p className={`rounded-lg border px-3 py-2 text-sm ${canStartTemplateLearning
              ? "border-success/30 bg-success/[0.04] text-success"
              : "border-warning/30 bg-warning/[0.04] text-warning"}`} role="status">
              {fileSelectionMessage}
            </p>
          ) : null}

          {selectedFilesMayNeedOcr && cloudOcrConsentNeeded ? (
            <label className="flex items-start gap-3 rounded-lg border border-primary/25 bg-primary/[0.04] p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                checked={allowCloudOcr}
                disabled={pending}
                onChange={(event) => setAllowCloudOcr(event.target.checked)}
              />
              <span>
                <span className="block font-medium">本机无法识别时，自动使用 Codex AI</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  仅发送独立工作区中的安全副本页图用于文字识别；原文件不会上传或修改，临时页图识别后会删除。
                </span>
              </span>
            </label>
          ) : null}

          <div className="rounded-lg border border-success/30 bg-success/[0.04] p-3 text-xs text-muted-foreground">
            <p>系统会先复制所选文件，再在独立工作区中识别。原文件不会被修改或覆盖。提供 1 组明确的输入和最终输出即可开始整理。</p>
            <p className="mt-1">格式：PDF、Word（.docx）、Excel（.xlsx）、PowerPoint（.pptx）、Markdown、CSV、TXT、JSON、PNG/JPG/WebP。扫描件会先尝试本机 OCR，不可用时按上方选择切换到 Codex AI。</p>
          </div>

          {pending && uploadProgress ? (
            <div className="rounded-lg border p-3 text-sm" role="status">
              <div className="flex items-center justify-between gap-2">
                <span>{uploadProgress.phase === "copying" ? "正在复制到安全工作区" : "正在识别输入、结果和处理方法"}</span>
                <span>{uploadProgress.phase === "copying" ? `${uploadProgress.completed}/${uploadProgress.total}` : "即将完成"}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${uploadProgress.phase === "organizing" ? 90 : uploadProgress.total ? (uploadProgress.completed / uploadProgress.total) * 70 : 0}%` }} /></div>
            </div>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          {error && recoverySourceId ? (
            <Button variant="secondary" onClick={() => { setCreateOpen(false); openEditor(recoverySourceId); }}>继续这个学习任务</Button>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
