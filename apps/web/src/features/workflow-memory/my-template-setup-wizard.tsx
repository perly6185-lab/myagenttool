import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronRight, Circle, ExternalLink, Eye, FileInput, FileOutput, FileText, FolderOpen, Loader2, Sparkles } from "lucide-react";

import { OfficeDocumentFrame } from "@/components/common/office-document-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { MarkdownBlock } from "@/components/ui/markdown-block";
import { Modal } from "@/components/ui/modal";
import { PdfDocumentViewer } from "@/features/documents/pdf-document-viewer";
import { localizedTemplateText } from "@/features/workflow-memory/my-template-model";
import { workflowMemoryApi } from "@/features/workflow-memory/workflow-memory-api";
import { api } from "@/lib/api-client";
import type {
  BusinessDocumentClassification,
  BusinessDocumentType,
  BusinessRoutineDefinition,
  BusinessRoutineDiscoveryCandidate,
  BusinessRoutineStep,
  WorkflowArtifact,
} from "@/lib/api-client";

const DOCUMENT_TYPES: BusinessDocumentType[] = [
  "inquiry", "quotation", "order", "contract_review", "purchase_request", "customer_complaint",
  "weekly_report", "project_acceptance", "price_list", "customer_reference", "other_reference",
  "inquiry_ledger", "quotation_ledger", "order_ledger", "unknown",
];

const DOCUMENT_LABELS: Record<BusinessDocumentType, string> = {
  inquiry: "客户询价/需求",
  quotation: "报价结果",
  order: "订单",
  inquiry_ledger: "询价台账",
  quotation_ledger: "报价台账",
  order_ledger: "订单台账",
  price_list: "价格资料",
  customer_reference: "客户参考资料",
  other_reference: "其他参考资料",
  contract_review: "合同审查资料",
  purchase_request: "采购申请",
  customer_complaint: "客户投诉",
  weekly_report: "周报资料",
  project_acceptance: "项目验收资料",
  unknown: "暂时无法判断",
};

const STEP_LABELS: Record<string, string> = {
  inquiry_registration: "登记收到的材料",
  reference_retrieval: "查找所需参考资料",
  quotation_generation: "生成工作结果",
  quotation_approval: "检查并确认结果",
  quotation_registration: "登记最终结果",
  order_signal: "识别后续工作信号",
  order_handoff: "交接后续处理",
  order_registration: "登记后续结果",
};

type LearnedFilePreview =
  | { kind: "markdown"; text: string; truncated: boolean }
  | { kind: "text"; text: string; truncated: boolean }
  | { kind: "image"; source: string }
  | { kind: "pdf" }
  | { kind: "office"; html: string };

function learnedFileExtension(artifact: WorkflowArtifact) {
  const extension = artifact.extension?.toLowerCase();
  if (extension?.startsWith(".")) return extension;
  const nameExtension = artifact.name.match(/\.[^.]+$/)?.[0]?.toLowerCase();
  return nameExtension ?? (extension ? `.${extension}` : "");
}

function learnedImageMime(extension: string) {
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  return extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "application/octet-stream";
}

function learnedFileRole(artifact: WorkflowArtifact): "input" | "output" | "reference" | "unknown" {
  const path = artifact.relativePath.replaceAll("\\", "/");
  if (path.includes("/raw/inputs/")) return "input";
  if (path.includes("/raw/outputs/")) return "output";
  if (path.includes("/raw/references/")) return "reference";
  if (artifact.role === "requirement") return "input";
  if (artifact.role === "delivery") return "output";
  if (artifact.role === "reference") return "reference";
  return "unknown";
}

function learnedFileStem(artifact: WorkflowArtifact) {
  return artifact.name.replace(/\.[^.]+$/, "").trim();
}

function learnedFormatLabel(artifact: WorkflowArtifact) {
  const extension = learnedFileExtension(artifact);
  if ([".xls", ".xlsx"].includes(extension)) return "Excel";
  if ([".doc", ".docx"].includes(extension)) return "Word";
  if ([".ppt", ".pptx"].includes(extension)) return "PowerPoint";
  if (extension === ".pdf") return "PDF";
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) return "图片";
  return extension.replace(/^\./, "").toUpperCase() || "文件";
}

function artifactPresentation(artifacts: WorkflowArtifact[]) {
  const inputs = artifacts.filter((artifact) => learnedFileRole(artifact) === "input");
  const outputs = artifacts.filter((artifact) => learnedFileRole(artifact) === "output");
  const inputCorpus = inputs.map((artifact) => learnedFileStem(artifact)).join(" ");
  const inputConcept = /技术协议/u.test(inputCorpus) ? (/设备|试验箱|仪器/u.test(inputCorpus) ? "设备技术协议" : "技术协议")
    : inputs.length === 1 ? learnedFileStem(inputs[0]) : inputs.length ? "历史输入文件" : "";
  const inputFormats = [...new Set(inputs.map(learnedFormatLabel))].join("、");
  const outputStem = outputs[0] ? learnedFileStem(outputs[0]) : "";
  const outputFormats = [...new Set(outputs.map(learnedFormatLabel))].join("、");
  return {
    name: inputConcept && outputStem ? `${inputConcept}生成${outputStem}` : "",
    inputs: `${inputConcept}${inputFormats ? ` ${inputFormats}` : ""}`,
    outputs: `${outputStem}${outputFormats ? ` ${outputFormats}` : ""}`,
  };
}

const LEARNED_FILE_ROLE_COPY = {
  input: { label: "输入文件", tone: "running" as const },
  output: { label: "输出文件", tone: "success" as const },
  reference: { label: "参考资料", tone: "neutral" as const },
  unknown: { label: "待确认用途", tone: "warning" as const },
};

function semanticFileLabel(summary: string) {
  return summary.replace(/\s+(?:PDF|Excel|Word|PowerPoint|图片|文本)(?:、.*)?$/u, "").trim();
}

function WizardStep({ label, state }: { label: string; state: "complete" | "current" | "pending" }) {
  return (
    <li className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
      state === "current" ? "border-primary bg-primary/5" : state === "complete" ? "border-success/40 bg-success/5" : "border-border"
    }`}>
      {state === "complete"
        ? <Check className="size-4 shrink-0 text-success" aria-hidden />
        : <Circle className={`size-4 shrink-0 ${state === "current" ? "text-primary" : "text-muted-foreground"}`} aria-hidden />}
      <span className={state === "pending" ? "text-muted-foreground" : "font-medium"}>{label}</span>
    </li>
  );
}

function artifactName(artifacts: WorkflowArtifact[], artifactId: string) {
  return artifacts.find((artifact) => artifact.id === artifactId)?.name ?? "未命名文件";
}

function currentDefinition(definitions: BusinessRoutineDefinition[]) {
  const priority: Record<BusinessRoutineDefinition["state"], number> = {
    published: 5, draft: 4, candidate: 3, disabled: 2, superseded: 1,
  };
  return definitions.slice().sort((left, right) =>
    priority[right.state] - priority[left.state] || right.version - left.version)[0] ?? null;
}

function routinePresentation(
  candidate: BusinessRoutineDiscoveryCandidate | null,
  definition: BusinessRoutineDefinition | null,
  artifacts: WorkflowArtifact[],
) {
  const steps = definition?.steps ?? candidate?.steps ?? [];
  const triggerTypes = definition?.triggerDocumentTypes ?? candidate?.triggerDocumentTypes ?? [];
  const contract = definition?.templateContract ?? candidate?.templateContract ?? null;
  const artifactFallback = artifactPresentation(artifacts);
  const outputs = steps.filter((step) => ["generate", "create_issue", "ledger_upsert"].includes(step.kind));
  const inputOverride = definition?.description.match(/^收到：(.+)$/m)?.[1]?.trim();
  const outputOverride = definition?.description.match(/^得到：(.+)$/m)?.[1]?.trim();
  const rawName = definition?.name ?? candidate?.name ?? "识别到的工作方法";
  const genericName = ["Inquiry to quotation", "Commercial inquiry and quotation"].includes(rawName);
  const triggerSummary = triggerTypes.map((type) => DOCUMENT_LABELS[type]).join("、");
  const inferredOutput = outputs.map((step) => {
    const configured = step.configuration?.output ?? step.configuration?.expectedOutput ?? step.configuration?.result;
    return typeof configured === "string" && configured.trim()
      ? localizedTemplateText(configured)
      : localizedTemplateText(step.label);
  }).join("、");
  return {
    name: genericName && artifactFallback.name ? artifactFallback.name : localizedTemplateText(rawName),
    inputs: inputOverride || contract?.inputSummary || (genericName ? artifactFallback.inputs : triggerSummary)
      || artifactFallback.inputs || "需要继续确认输入材料",
    outputs: outputOverride || contract?.outputSummary || (genericName ? artifactFallback.outputs : inferredOutput)
      || artifactFallback.outputs || "需要继续确认最终结果",
    steps: steps.map((step) => ({ ...step, label: STEP_LABELS[step.key] ?? localizedTemplateText(step.label) })),
    contract,
  };
}

export function MyTemplateSetupWizard({
  sourceId,
  onBack,
  onOpenAdvanced,
}: {
  sourceId: string;
  onBack: () => void;
  onOpenAdvanced: () => void;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeDrafts, setTypeDrafts] = useState<Record<string, BusinessDocumentType>>({});
  const [presentationDraft, setPresentationDraft] = useState({ name: "", inputs: "", outputs: "" });
  const [stepDrafts, setStepDrafts] = useState<string[]>([]);
  const [fileActionPending, setFileActionPending] = useState<string | null>(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [previewArtifact, setPreviewArtifact] = useState<WorkflowArtifact | null>(null);
  const [filePreview, setFilePreview] = useState<LearnedFilePreview | null>(null);
  const [filePreviewPending, setFilePreviewPending] = useState(false);
  const [filePreviewError, setFilePreviewError] = useState<string | null>(null);
  const filePreviewRequest = useRef(0);

  const sourcesQuery = useQuery({
    queryKey: ["workflow-memory", "sources"],
    queryFn: () => workflowMemoryApi.listWorkflowSources(),
  });
  const artifactsQuery = useQuery({
    queryKey: ["workflow-memory", "artifacts", sourceId],
    queryFn: () => workflowMemoryApi.listWorkflowArtifacts({ sourceId }),
  });
  const classificationsQuery = useQuery({
    queryKey: ["workflow-memory", "business-document-classifications", sourceId],
    queryFn: () => workflowMemoryApi.listBusinessDocumentClassifications({ sourceId }),
  });
  const casesQuery = useQuery({
    queryKey: ["workflow-memory", "business-case-candidates", sourceId],
    queryFn: () => workflowMemoryApi.listBusinessCaseCandidates({ sourceId }),
  });
  const candidatesQuery = useQuery({
    queryKey: ["workflow-memory", "business-routine-candidates", sourceId],
    queryFn: () => workflowMemoryApi.listBusinessRoutineCandidates(sourceId),
  });
  const definitionsQuery = useQuery({
    queryKey: ["workflow-memory", "business-routine-definitions", sourceId],
    queryFn: () => workflowMemoryApi.listBusinessRoutineDefinitions(sourceId),
  });

  const source = (sourcesQuery.data?.sources ?? []).find((item) => item.id === sourceId) ?? null;
  const allArtifacts = artifactsQuery.data?.artifacts ?? [];
  const artifacts = source?.purpose === "template_learning"
    ? allArtifacts.filter((artifact) => artifact.relativePath !== "manifest.json"
      && !artifact.relativePath.endsWith("/source-manifest.json"))
    : allArtifacts;
  const visibleArtifactIds = new Set(artifacts.map((artifact) => artifact.id));
  const classifications = (classificationsQuery.data?.classifications ?? [])
    .filter((row) => visibleArtifactIds.has(row.artifactId));
  const classificationByArtifactId = new Map(classifications.map((row) => [row.artifactId, row]));
  const inputArtifacts = artifacts.filter((artifact) => learnedFileRole(artifact) === "input");
  const outputArtifacts = artifacts.filter((artifact) => learnedFileRole(artifact) === "output");
  const inputFileCount = inputArtifacts.length;
  const outputFileCount = outputArtifacts.length;
  const caseCandidates = casesQuery.data?.candidates ?? [];
  const confirmedCases = caseCandidates.filter((item) => item.state === "confirmed");
  const proposedCases = caseCandidates.filter((item) => item.state === "proposed");
  const candidate = (candidatesQuery.data?.candidates ?? []).find((item) => item.state === "candidate") ?? null;
  const definition = currentDefinition(definitionsQuery.data?.routineDefinitions ?? []);
  const presentation = useMemo(() => routinePresentation(candidate, definition, artifacts), [candidate, definition, artifacts]);
  const presentationRevisionKey = `${definition?.id ?? ""}:${definition?.revision ?? 0}:${candidate?.id ?? ""}`;
  useEffect(() => {
    setPresentationDraft({ name: presentation.name, inputs: presentation.inputs, outputs: presentation.outputs });
    setStepDrafts(presentation.steps.map((step) => step.label));
  // Only replace local edits when the server-side draft changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationRevisionKey]);
  useEffect(() => {
    if (filePreview?.kind !== "image") return undefined;
    const sourceUrl = filePreview.source;
    return () => URL.revokeObjectURL(sourceUrl);
  }, [filePreview]);
  const published = definition?.state === "published";
  const reviewReady = Boolean(candidate || definition);
  const currentStep = published ? 4 : reviewReady ? 3 : 2;
  const loading = [sourcesQuery, artifactsQuery, classificationsQuery, casesQuery, candidatesQuery, definitionsQuery]
    .some((query) => query.isLoading);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "sources"] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "artifacts", sourceId] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "business-document-classifications", sourceId] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "business-case-candidates", sourceId] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "business-routine-candidates", sourceId] }),
      queryClient.invalidateQueries({ queryKey: ["workflow-memory", "business-routine-definitions"] }),
    ]);
  }

  async function run(key: string, action: () => Promise<unknown>) {
    setPending(key);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "unknown";
      setError(message.includes("insufficient_confirmed_business_cases")
        ? "至少需要 1 组包含输入和最终结果的历史案例。"
        : message.includes("no_business_cases_found")
          ? "暂时没有找到清晰的“输入 → 最终结果”组合。可以补充文件名更明确的历史案例，或打开高级调整手动配对。"
          : message.includes("no_business_documents_found")
            ? "所选文件里暂时没有识别出可学习的输入和结果。请返回后补充或重新选择文件。"
        : "这一步暂时无法完成。已有判断和安全副本不会丢失，你可以重试；识别详情可在“需要调整”中查看。" );
    } finally {
      setPending(null);
    }
  }

  const recognizeFiles = () => void run("recognize", async () => {
    await workflowMemoryApi.scanWorkflowSource(sourceId);
    const result = await workflowMemoryApi.analyzeBusinessDocuments(sourceId);
    if (result.job.status === "succeeded" && result.job.classified === 0 && result.job.replayed === 0) {
      throw new Error("no_business_documents_found");
    }
  });

  const openLearnedFile = (artifact: WorkflowArtifact) => void (async () => {
    const key = `open:${artifact.id}`;
    const projectId = source?.projectId;
    setFileActionPending(key);
    setFileActionError(null);
    if (!projectId) {
      setFileActionPending(null);
      setFileActionError("学习目录暂时不可用，请刷新后重试。");
      return;
    }
    try {
      const bridge = window.myagenttoolDesktop?.openContainedAsset;
      if (bridge) await bridge({ projectId, relativePath: artifact.relativePath });
      else await api.openProjectAsset(projectId, artifact.relativePath);
    } catch {
      setFileActionError(`无法打开“${artifact.name}”。请确认文件仍在学习目录中。`);
    } finally {
      setFileActionPending(null);
    }
  })();

  const previewLearnedFile = (artifact: WorkflowArtifact) => void (async () => {
    const requestId = filePreviewRequest.current + 1;
    filePreviewRequest.current = requestId;
    const projectId = source?.projectId;
    setPreviewArtifact(artifact);
    setFilePreview(null);
    setFilePreviewError(null);
    setFilePreviewPending(true);
    if (!projectId) {
      setFilePreviewPending(false);
      setFilePreviewError("学习目录暂时不可用，请刷新后重试。");
      return;
    }
    try {
      const extension = learnedFileExtension(artifact);
      let preview: LearnedFilePreview;
      if (extension === ".md" || extension === ".mdx") {
        const result = await api.projectAssetPreview(projectId, artifact.relativePath);
        preview = { kind: "markdown", text: result.text, truncated: result.truncated };
      } else if ([".txt", ".csv", ".json"].includes(extension)) {
        const result = await api.projectAssetPreview(projectId, artifact.relativePath);
        let text = result.text;
        if (extension === ".json") {
          try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Show original invalid JSON safely. */ }
        }
        preview = { kind: "text", text, truncated: result.truncated };
      } else if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
        const bytes = await api.projectAssetPreviewBytes(projectId, artifact.relativePath);
        preview = { kind: "image", source: URL.createObjectURL(new Blob([bytes], { type: learnedImageMime(extension) })) };
      } else if (extension === ".pdf") {
        preview = { kind: "pdf" };
      } else if ([".docx", ".xlsx", ".pptx"].includes(extension)) {
        const result = await api.officecliPreview(projectId, artifact.relativePath);
        preview = { kind: "office", html: result.content };
      } else {
        throw new Error("preview_unsupported");
      }
      if (requestId === filePreviewRequest.current) setFilePreview(preview);
      else if (preview.kind === "image") URL.revokeObjectURL(preview.source);
    } catch {
      if (requestId === filePreviewRequest.current) setFilePreviewError("暂时无法生成这个文件的预览，你仍可使用系统应用打开或查看所在目录。");
    } finally {
      if (requestId === filePreviewRequest.current) setFilePreviewPending(false);
    }
  })();

  const closeFilePreview = () => {
    filePreviewRequest.current += 1;
    setPreviewArtifact(null);
    setFilePreview(null);
    setFilePreviewPending(false);
    setFilePreviewError(null);
  };

  const revealLearnedFile = (artifact: WorkflowArtifact) => void (async () => {
    const key = `reveal:${artifact.id}`;
    const projectId = source?.projectId;
    setFileActionPending(key);
    setFileActionError(null);
    if (!projectId) {
      setFileActionPending(null);
      setFileActionError("学习目录暂时不可用，请刷新后重试。");
      return;
    }
    try {
      const bridge = window.myagenttoolDesktop?.revealContainedAsset;
      if (bridge) await bridge({ projectId, relativePath: artifact.relativePath });
      else await api.revealProjectAsset(projectId, artifact.relativePath);
    } catch {
      setFileActionError(`无法定位“${artifact.name}”。请确认文件仍在学习目录中。`);
    } finally {
      setFileActionPending(null);
    }
  })();

  const confirmClassifications = () => void run("confirm-files", async () => {
    const pendingRows = classifications.filter((item) => item.confirmationState === "proposed");
    for (const row of pendingRows) {
      await workflowMemoryApi.confirmBusinessDocumentClassification(row.id, {
        expectedRevision: row.revision,
        documentType: typeDrafts[row.id] ?? row.documentType,
      });
    }
  });

  const discoverCases = () => void run("discover-cases", async () => {
    const result = await workflowMemoryApi.discoverBusinessCases(sourceId);
    if (result.count === 0) throw new Error("no_business_cases_found");
    return result;
  });
  const confirmCase = (caseId: string, revision: number) => void run(`case-${caseId}`, () =>
    workflowMemoryApi.reviewBusinessCaseCandidate(caseId, { expectedRevision: revision, action: "confirm" }));
  const discoverRoutine = () => void run("discover-routine", () => workflowMemoryApi.discoverBusinessRoutine(sourceId));
  const publish = () => (definition?.state === "draft" || candidate) && void run("publish", async () => {
    let draft = definition?.state === "draft" ? definition : null;
    if (!draft && candidate) {
      const created = await workflowMemoryApi.createBusinessRoutineDraft(candidate.id);
      draft = created.routineDefinition;
    }
    if (!draft) throw new Error("routine_draft_not_ready");
    const name = presentationDraft.name.trim();
    const inputs = presentationDraft.inputs.trim();
    const outputs = presentationDraft.outputs.trim();
    if (!name || !inputs || !outputs) throw new Error("template_presentation_required");
    let outputApplied = false;
    const steps: BusinessRoutineStep[] = draft.steps.map((step, index) => {
      const isOutputStep = !outputApplied && ["generate", "create_issue", "ledger_upsert"].includes(step.kind);
      if (isOutputStep) outputApplied = true;
      const nextContract = isOutputStep && draft.templateContract
        ? { ...draft.templateContract, inputSummary: inputs, outputSummary: outputs }
        : null;
      return {
        ...step,
        label: stepDrafts[index]?.trim() || step.label,
        configuration: isOutputStep
          ? { ...step.configuration, expectedOutput: outputs, ...(nextContract ? { templateContract: nextContract } : {}) }
          : typeof step.configuration?.inputSummary === "string"
            ? { ...step.configuration, inputSummary: inputs }
            : step.configuration,
      };
    });
    const updated = await workflowMemoryApi.updateBusinessRoutineDefinition(draft.id, {
      expectedRevision: draft.revision,
      name,
      description: `收到：${inputs}\n得到：${outputs}`,
      steps,
    });
    const result = await workflowMemoryApi.publishBusinessRoutineDefinition(
      updated.routineDefinition.id,
      updated.routineDefinition.revision,
      true,
    );
    if (source?.purpose === "template_learning") {
      await workflowMemoryApi.completeTemplateLearningTask(sourceId);
    }
    return result;
  });

  if (loading || !source) {
    return <div className="grid min-h-80 place-items-center"><Loader2 className="animate-spin text-primary" aria-label="正在加载我的模板" /></div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-3 sm:p-6">
      <header className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft />返回我的模板</Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold"><Sparkles className="size-5 text-primary" />创建我的模板</h1>
          <p className="mt-1 text-sm text-muted-foreground">只需核对历史输入和最终结果，不需要编写规则。</p>
        </div>
      </header>

      <ol className="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr]" aria-label="我的模板创建进度">
        <WizardStep label="1. 添加输入和输出" state="complete" />
        <ChevronRight className="mx-auto hidden size-4 self-center text-muted-foreground md:block" aria-hidden />
        <WizardStep label="2. 核对输入和结果" state={currentStep > 2 ? "complete" : "current"} />
        <ChevronRight className="mx-auto hidden size-4 self-center text-muted-foreground md:block" aria-hidden />
        <WizardStep label="3. 确认并启用" state={published ? "complete" : reviewReady ? "current" : "pending"} />
      </ol>

      {error ? <div role="alert" className="rounded-lg border border-warning/40 bg-warning/[0.07] p-3 text-sm">
        <p>{error}</p>
        <Button className="mt-2" size="sm" variant="secondary" onClick={onOpenAdvanced}>查看识别详情</Button>
      </div> : null}

      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <FolderOpen className="size-4 text-primary" aria-hidden />
            <h2 className="font-semibold">{source.name}</h2>
            <Badge tone="neutral">已复制 {artifacts.length} 个文件</Badge>
            <Badge tone="running">输入 {inputFileCount}</Badge>
            <Badge tone="success">输出 {outputFileCount}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">系统只学习你明确选择的安全副本；不会修改历史文档。</p>
          <div className="mt-4 overflow-hidden rounded-lg border" aria-label="本次学习的文件">
            <div className="flex items-center justify-between gap-3 border-b bg-muted/20 px-3 py-2">
              <h3 className="text-sm font-medium">本次学习的文件</h3>
              <span className="text-xs text-muted-foreground">共 {artifacts.length} 个</span>
            </div>
            {artifacts.length ? (
              <ul className="max-h-56 divide-y overflow-y-auto">
                {artifacts.map((artifact) => {
                  const classification = classificationByArtifactId.get(artifact.id);
                  const learnedRole = learnedFileRole(artifact);
                  const roleCopy = LEARNED_FILE_ROLE_COPY[learnedRole];
                  const learnedSemantic = source.purpose === "template_learning"
                    ? learnedRole === "input" ? semanticFileLabel(presentation.inputs)
                      : learnedRole === "output" ? semanticFileLabel(presentation.outputs)
                        : null
                    : null;
                  return (
                    <li key={artifact.id} className="flex flex-wrap items-start gap-2 px-3 py-2.5">
                      <FileText className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium" title={artifact.name}>{artifact.name}</p>
                        {artifact.relativePath !== artifact.name
                          ? <p className="truncate text-xs text-muted-foreground" title={artifact.relativePath}>安全副本位置：{artifact.relativePath}</p>
                          : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <Badge tone={roleCopy.tone}>{roleCopy.label}</Badge>
                        {learnedSemantic
                          ? <Badge tone="neutral">{learnedSemantic}</Badge>
                          : classification ? <Badge tone="neutral">{DOCUMENT_LABELS[classification.documentType]}</Badge> : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <Button type="button" size="sm" variant="ghost" disabled={Boolean(fileActionPending)} aria-label={`预览文件：${artifact.name}`} onClick={() => previewLearnedFile(artifact)}>
                          <Eye />预览
                        </Button>
                        <Button type="button" size="sm" variant="ghost" disabled={Boolean(fileActionPending)} aria-label={`打开所在目录：${artifact.name}`} onClick={() => revealLearnedFile(artifact)}>
                          {fileActionPending === `reveal:${artifact.id}` ? <Loader2 className="animate-spin" /> : <FolderOpen />}打开所在目录
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="px-3 py-4 text-sm text-muted-foreground">暂未读取到可学习的文件。</p>}
          </div>
          {fileActionError ? <p className="mt-2 text-sm text-destructive" role="alert">{fileActionError}</p> : null}
          <p className="mt-3 text-xs text-muted-foreground">支持 PDF、Word（.docx）、Excel（.xlsx）、PowerPoint、常见图片及文本文件。图片和扫描 PDF 会优先使用本机 OCR；本机不可用时可自动切换到 Codex AI。</p>
        </CardContent>
      </Card>

      {published ? (
        <Card className="border-success/40 bg-success/[0.04]">
          <CardContent className="p-5">
            <div className="flex items-center gap-2"><Check className="size-5 text-success" /><h2 className="text-lg font-semibold">这个模板已经可以使用</h2></div>
            <p className="mt-2 text-sm">创建任务时，只要写清楚最终想得到什么，系统会自动判断是否使用它。</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-background p-3">
                <p className="text-xs text-muted-foreground">以后收到什么类型</p>
                <p className="mt-1 font-medium">{presentation.inputs}</p>
                <div className="mt-3 border-t pt-3">
                  <p className="text-xs text-muted-foreground">学习依据 · {inputArtifacts.length} 个输入文件</p>
                  {inputArtifacts.length ? <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto pr-1" aria-label="对应的输入文件">
                    {inputArtifacts.map((artifact) => <li key={artifact.id}>
                      <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => previewLearnedFile(artifact)}>
                        <FileInput className="size-4 shrink-0 text-primary" aria-hidden />
                        <span className="min-w-0 flex-1 truncate" title={artifact.name}>{artifact.name}</span>
                        <Eye className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      </button>
                    </li>)}
                  </ul> : <p className="mt-2 text-xs text-warning">暂未关联到输入文件。</p>}
                </div>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <p className="text-xs text-muted-foreground">要生成什么结果</p>
                <p className="mt-1 font-medium">{presentation.outputs}</p>
                <div className="mt-3 border-t pt-3">
                  <p className="text-xs text-muted-foreground">学习依据 · {outputArtifacts.length} 个输出文件</p>
                  {outputArtifacts.length ? <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto pr-1" aria-label="对应的输出文件">
                    {outputArtifacts.map((artifact) => <li key={artifact.id}>
                      <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => previewLearnedFile(artifact)}>
                        <FileOutput className="size-4 shrink-0 text-success" aria-hidden />
                        <span className="min-w-0 flex-1 truncate" title={artifact.name}>{artifact.name}</span>
                        <Eye className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      </button>
                    </li>)}
                  </ul> : <p className="mt-2 text-xs text-warning">暂未关联到输出文件。</p>}
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">这里引用的是上方同一组安全副本，只展示关联关系，不会重复保存文件。</p>
            <p className="mt-4 text-sm text-muted-foreground">模板已经保存并启用，无需继续训练。</p>
            <Button className="mt-3" onClick={onBack}><ArrowLeft />返回我的模板</Button>
          </CardContent>
        </Card>
      ) : reviewReady ? (
        <Card className="border-primary/30">
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground">系统已整理好一份预览，有不准确的地方可直接修改</p>
            <label className="mt-3 block space-y-1.5 text-sm">
              <span className="font-medium">模板名称</span>
              <Input aria-label="模板名称" value={presentationDraft.name} onChange={(event) => setPresentationDraft((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-muted/20 p-3">
                <label><span className="flex items-center gap-1.5 text-xs text-muted-foreground"><FileInput className="size-3.5" />收到什么</span><Input className="mt-2" aria-label="收到什么" value={presentationDraft.inputs} onChange={(event) => setPresentationDraft((current) => ({ ...current, inputs: event.target.value }))} /></label>
                <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">学习依据 · {inputArtifacts.length} 个输入文件</p>
                <ul className="mt-1 space-y-1" aria-label="收到什么对应的文件">
                  {inputArtifacts.map((artifact) => <li key={artifact.id}><button type="button" className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-muted" onClick={() => previewLearnedFile(artifact)}><FileInput className="size-3.5 shrink-0 text-primary" /><span className="min-w-0 flex-1 truncate">{artifact.name}</span><Eye className="size-3.5" /></button></li>)}
                </ul>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <label><span className="flex items-center gap-1.5 text-xs text-muted-foreground"><FileOutput className="size-3.5" />最后得到</span><Input className="mt-2" aria-label="最后得到" value={presentationDraft.outputs} onChange={(event) => setPresentationDraft((current) => ({ ...current, outputs: event.target.value }))} /></label>
                <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">学习依据 · {outputArtifacts.length} 个输出文件</p>
                <ul className="mt-1 space-y-1" aria-label="最后得到对应的文件">
                  {outputArtifacts.map((artifact) => <li key={artifact.id}><button type="button" className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-muted" onClick={() => previewLearnedFile(artifact)}><FileOutput className="size-3.5 shrink-0 text-success" /><span className="min-w-0 flex-1 truncate">{artifact.name}</span><Eye className="size-3.5" /></button></li>)}
                </ul>
              </div>
            </div>
            {presentation.contract?.outputColumns?.length ? (
              <div className="mt-3 rounded-lg border bg-background p-3 text-sm">
                <p><span className="font-medium">已识别输出结构：</span>{presentation.contract.outputColumns.length} 列 · {presentation.contract.outputColumns.join("、")}</p>
                {presentation.contract.uncertainFields.length ? <p className="mt-2 text-xs text-muted-foreground">{presentation.contract.uncertainFields.join("、")} 等字段未在历史输入中找到明确来源；运行时将留空并提醒确认，不阻塞模板启用。</p> : null}
              </div>
            ) : null}
            <ol className="mt-4 space-y-2 text-sm">
              {presentation.steps.map((step, index) => <li key={step.key} className="grid grid-cols-[auto_1fr] items-center gap-2"><span className="text-primary">{index + 1}.</span><Input aria-label={`第 ${index + 1} 步`} value={stepDrafts[index] ?? step.label} onChange={(event) => setStepDrafts((current) => current.map((label, candidateIndex) => candidateIndex === index ? event.target.value : label))} /></li>)}
            </ol>
            <div className="mt-5 flex flex-wrap gap-2">
              {(candidate || definition?.state === "draft") ? <Button disabled={Boolean(pending) || !presentationDraft.name.trim() || !presentationDraft.inputs.trim() || !presentationDraft.outputs.trim()} onClick={publish}>{pending === "publish" ? <Loader2 className="animate-spin" /> : <Check />}保存并启用这个模板</Button> : null}
              <Button variant="secondary" onClick={onOpenAdvanced}>需要调整</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-5">
            <h2 className="font-semibold">核对几组“输入 → 最终结果”</h2>
            <p className="mt-1 text-sm text-muted-foreground">系统会先猜测文件用途。你只需修正明显错误，再确认相似的历史工作。</p>

            {classifications.length === 0 ? (
              <Button className="mt-4" disabled={Boolean(pending)} onClick={recognizeFiles}>{pending === "recognize" ? <Loader2 className="animate-spin" /> : <Sparkles />}识别历史文件</Button>
            ) : (
              <div className="mt-4 space-y-2">
                {classifications.map((row: BusinessDocumentClassification) => (
                  <div key={row.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_13rem_auto] sm:items-center">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{artifactName(artifacts, row.artifactId)}</p><p className="text-xs text-muted-foreground">系统判断 · {Math.round(row.confidence * 100)}%</p></div>
                    <Select aria-label={`${artifactName(artifacts, row.artifactId)} 的用途`} value={typeDrafts[row.id] ?? row.documentType} disabled={row.confirmationState !== "proposed"} onChange={(event) => setTypeDrafts((current) => ({ ...current, [row.id]: event.target.value as BusinessDocumentType }))}>
                      {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{DOCUMENT_LABELS[type]}</option>)}
                    </Select>
                    <Badge tone={row.confirmationState === "proposed" ? "warning" : "success"}>{row.confirmationState === "proposed" ? "待确认" : "已确认"}</Badge>
                  </div>
                ))}
                {classifications.some((row) => row.confirmationState === "proposed") ? <Button disabled={Boolean(pending)} onClick={confirmClassifications}>{pending === "confirm-files" ? <Loader2 className="animate-spin" /> : <Check />}确认这些文件用途</Button> : null}
              </div>
            )}

            {classifications.length > 0 && classifications.every((row) => row.confirmationState !== "proposed") && caseCandidates.length === 0 ? (
              <div className="mt-5 border-t pt-4"><Button disabled={Boolean(pending)} onClick={discoverCases}>{pending === "discover-cases" ? <Loader2 className="animate-spin" /> : <Sparkles />}整理成历史工作案例</Button></div>
            ) : null}

            {caseCandidates.length ? (
              <div className="mt-5 border-t pt-4">
                <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">识别到的历史工作</h3><Badge tone={confirmedCases.length >= 1 ? "success" : "warning"}>{confirmedCases.length} 组已确认</Badge></div>
                <div className="mt-3 space-y-2">
                  {caseCandidates.map((item) => {
                    const inputs = item.artifactBindings.filter((binding) => binding.roles.some((role) => ["trigger", "input"].includes(role))).map((binding) => artifactName(artifacts, binding.artifactId));
                    const outputs = item.artifactBindings.filter((binding) => binding.roles.includes("output")).map((binding) => artifactName(artifacts, binding.artifactId));
                    return <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm"><span className="min-w-0 flex-1">{inputs.join("、") || "输入文件"} <span className="text-muted-foreground">→</span> {outputs.join("、") || "结果文件"}</span>{item.state === "proposed" ? <Button size="sm" disabled={Boolean(pending)} onClick={() => confirmCase(item.id, item.revision)}>{pending === `case-${item.id}` ? <Loader2 className="animate-spin" /> : <Check />}这是一组工作</Button> : <Badge tone="success">已确认</Badge>}</div>;
                  })}
                </div>
                {confirmedCases.length >= 1 && proposedCases.length === 0 ? <Button className="mt-4" disabled={Boolean(pending)} onClick={discoverRoutine}>{pending === "discover-routine" ? <Loader2 className="animate-spin" /> : <Sparkles />}总结我的处理方法</Button> : null}
                {confirmedCases.length < 1 && proposedCases.length === 0 ? (
                  <div className="mt-4 rounded-lg border border-warning/35 bg-warning/[0.05] p-3 text-sm">
                    <p>还没有可确认的输入和结果组合。可以重试识别，或返回后重新选择一组对应文件。</p>
                    <Button className="mt-2" size="sm" variant="secondary" disabled={Boolean(pending)} onClick={recognizeFiles}>重试识别</Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
      <Modal
        open={Boolean(previewArtifact)}
        onClose={closeFilePreview}
        title={previewArtifact?.name ?? "文件预览"}
        description="预览的是系统复制的安全副本，不会修改历史原文件。"
        size="2xl"
        footer={previewArtifact ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" disabled={Boolean(fileActionPending)} onClick={() => revealLearnedFile(previewArtifact)}>
              <FolderOpen />打开所在目录
            </Button>
            <Button type="button" variant="secondary" disabled={Boolean(fileActionPending)} onClick={() => openLearnedFile(previewArtifact)}>
              {fileActionPending === `open:${previewArtifact.id}` ? <Loader2 className="animate-spin" /> : <ExternalLink />}使用系统应用打开
            </Button>
          </div>
        ) : null}
        bodyClassName="min-h-72"
      >
        {previewArtifact ? <p className="mb-3 truncate font-mono text-[11px] text-muted-foreground" title={previewArtifact.relativePath}>{previewArtifact.relativePath}</p> : null}
        {filePreviewPending ? (
          <p className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="animate-spin" />正在准备预览…</p>
        ) : filePreviewError ? (
          <div className="grid min-h-64 place-items-center px-4 text-center"><p className="max-w-lg text-sm text-muted-foreground" role="alert">{filePreviewError}</p></div>
        ) : filePreview?.kind === "markdown" ? (
          <div className="min-h-64 rounded-lg border bg-background p-4 sm:p-6">
            {filePreview.truncated ? <p className="mb-3 text-sm text-warning">文件较大，当前仅显示部分内容。</p> : null}
            <MarkdownBlock text={filePreview.text} variant="document" />
          </div>
        ) : filePreview?.kind === "text" ? (
          <div>
            {filePreview.truncated ? <p className="mb-3 text-sm text-warning">文件较大，当前仅显示部分内容。</p> : null}
            <pre className="min-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-background p-4 font-mono text-xs leading-6">{filePreview.text}</pre>
          </div>
        ) : filePreview?.kind === "image" ? (
          <div className="grid min-h-[28rem] place-items-center rounded-lg border bg-background p-4"><img src={filePreview.source} alt={previewArtifact?.name ?? ""} className="max-h-[70vh] max-w-full object-contain" /></div>
        ) : filePreview?.kind === "pdf" && previewArtifact && source ? (
          <div className="min-h-[65vh] overflow-hidden rounded-lg border bg-background"><PdfDocumentViewer projectId={source.projectId} path={previewArtifact.relativePath} /></div>
        ) : filePreview?.kind === "office" ? (
          <OfficeDocumentFrame title={previewArtifact?.name ?? "文档"} content={filePreview.html} className="min-h-[65vh] rounded-lg border" />
        ) : null}
      </Modal>
    </div>
  );
}
