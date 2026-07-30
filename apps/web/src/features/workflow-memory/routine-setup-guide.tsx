import { Check, ChevronRight, Circle, FolderSearch, Search, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  BusinessRoutineDefinition,
  BusinessRoutineDiscoveryCandidate,
  WorkflowArtifact,
  WorkflowSource,
} from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

const copy = {
  en: {
    title: "Set up your daily work",
    hint: "Three guided steps turn past files into a reusable task. You can review every conclusion before enabling it.",
    steps: ["Choose a work folder", "Review the work we found", "Confirm the task type"],
    selected: "Folder selected",
    scan: "Find my daily work",
    scanning: "Reviewing the folder…",
    reviewFiles: "Review file roles",
    reviewTask: "Review this task type",
    enabled: "Ready to use",
    needsHistory: "No stable daily-work pattern is ready yet. Confirm comparable request and result files, then scan again.",
    found: "We found this daily work",
    role: "Likely work",
    starts: "Starts when",
    always: "Usually done every time",
    conditional: "Done only when needed",
    references: "Uses",
    outputs: "Produces",
    ledgers: "Updates",
    why: "Why did we identify this?",
    whyHint: "The conclusion comes from confirmed examples and their file relationships. It does not use files outside the selected folder.",
    examples: "confirmed examples",
    supportingFiles: "Supporting files",
    exceptions: "exceptions",
    confidence: "Match",
    none: "None identified",
    types: {
      inquiry: "an inquiry arrives",
      quotation: "a quotation arrives",
      order: "a confirmed order arrives",
    },
    kinds: {
      extract: "Read and register the request",
      retrieve: "Look up reference material",
      generate: "Prepare an output",
      ledger_upsert: "Update a business ledger",
      human_approval: "Ask for confirmation",
      condition: "Check a business condition",
      create_issue: "Create follow-up work",
    },
  },
  zh: {
    title: "设置你的日常工作",
    hint: "通过三个引导步骤，把历史文件整理成可复用任务；启用前，每个判断都可以检查和修改。",
    steps: ["选择工作目录", "查看识别出的日常工作", "确认任务类型"],
    selected: "目录已选择",
    scan: "识别我的日常工作",
    scanning: "正在分析目录…",
    reviewFiles: "检查文件归类",
    reviewTask: "检查这个任务类型",
    enabled: "已经可以使用",
    needsHistory: "暂时没有形成稳定的日常工作规律。请先确认几组相似的需求文件和交付文件，然后重新识别。",
    found: "识别到这项日常工作",
    role: "可能的工作",
    starts: "开始条件",
    always: "通常每次都做",
    conditional: "符合条件时再做",
    references: "会参考",
    outputs: "会产出",
    ledgers: "会更新",
    why: "为什么这样识别？",
    whyHint: "判断来自已确认的历史案例及文件关系，不会使用所选目录之外的文件。",
    examples: "个已确认案例",
    supportingFiles: "支持判断的文件",
    exceptions: "个例外",
    confidence: "匹配度",
    none: "暂未识别",
    types: {
      inquiry: "收到询价时",
      quotation: "收到报价资料时",
      order: "收到已确认订单时",
    },
    kinds: {
      extract: "读取并登记需求",
      retrieve: "查找参考资料",
      generate: "生成业务文件",
      ledger_upsert: "更新业务台账",
      human_approval: "请用户确认",
      condition: "判断业务条件",
      create_issue: "创建后续任务",
    },
  },
} as const;

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Step({
  label,
  state,
}: {
  label: string;
  state: "complete" | "current" | "pending";
}) {
  return (
    <li className={cn(
      "flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3 py-2 text-sm",
      state === "current" && "border-primary bg-primary/5",
      state === "complete" && "border-success/40 bg-success/5",
    )}>
      {state === "complete"
        ? <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
        : <Circle className={cn("size-4 shrink-0", state === "current" ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />}
      <span className={state === "pending" ? "text-muted-foreground" : "font-medium"}>{label}</span>
    </li>
  );
}

function configuredValue(step: BusinessRoutineDiscoveryCandidate["steps"][number]) {
  const values = Object.values(step.configuration ?? {})
    .filter((value) => typeof value === "string" && value.trim());
  return values.length ? values.join(", ") : null;
}

export function RoutineSetupGuide({
  source,
  candidate,
  definition,
  artifacts,
  pending,
  onScan,
  onCreateDraft,
}: {
  source: WorkflowSource;
  candidate: BusinessRoutineDiscoveryCandidate | null;
  definition: BusinessRoutineDefinition | null;
  artifacts: WorkflowArtifact[];
  pending: boolean;
  onScan: () => void;
  onCreateDraft: (candidateId: string) => void;
}) {
  const { i18n } = useAppTranslation();
  const text = copy[i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en"];
  const published = definition?.state === "published";
  const reviewed = Boolean(candidate || definition);
  const activeCandidate = candidate ?? null;
  const steps = activeCandidate?.steps ?? definition?.steps.map((step) => ({
    ...step,
    requirement: step.required ? "mandatory" as const : "conditional" as const,
    coverage: 1,
    supportCaseIds: definition.historicalCaseIds,
    exceptionCaseIds: [],
    explanation: "",
  })) ?? [];
  const triggerTypes = activeCandidate?.triggerDocumentTypes ?? definition?.triggerDocumentTypes ?? [];
  const evidenceIds = [...new Set(steps.flatMap((step) =>
    (step.evidenceRefs ?? []).map((ref) => ref.artifactId)))];
  const evidenceFiles = evidenceIds
    .map((id) => artifacts.find((artifact) => artifact.id === id))
    .filter((artifact): artifact is WorkflowArtifact => Boolean(artifact))
    .slice(0, 12);
  const groups = {
    references: steps.filter((step) => step.kind === "retrieve"),
    outputs: steps.filter((step) => ["generate", "create_issue"].includes(step.kind)),
    ledgers: steps.filter((step) => step.kind === "ledger_upsert"),
  };
  const currentStep = published ? 3 : reviewed ? 3 : 2;

  return (
    <section className="rounded-lg border border-primary/30 bg-background p-4 shadow-sm" aria-labelledby="routine-setup-title">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" aria-hidden="true" />
            <h2 id="routine-setup-title" className="font-semibold">{text.title}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{text.hint}</p>
        </div>
        {published ? <Badge tone="success">{text.enabled}</Badge> : null}
      </div>

      <ol className="mt-4 grid gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <Step label={text.steps[0]} state="complete" />
        <ChevronRight className="mx-auto hidden size-4 self-center text-muted-foreground md:block" aria-hidden="true" />
        <Step label={text.steps[1]} state={currentStep > 2 ? "complete" : "current"} />
        <ChevronRight className="mx-auto hidden size-4 self-center text-muted-foreground md:block" aria-hidden="true" />
        <Step label={text.steps[2]} state={published ? "complete" : reviewed ? "current" : "pending"} />
      </ol>

      <div className="mt-4 rounded-md border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <FolderSearch className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium">{source.name}</span>
          <span className="text-xs text-muted-foreground">{text.selected}</span>
        </div>
        {!reviewed ? (
          <div className="mt-3">
            <p className="text-sm text-muted-foreground">{text.needsHistory}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={pending || source.scanState === "scanning"} onClick={onScan}>
                <Search className={cn("size-4", source.scanState === "scanning" && "animate-spin")} />
                {source.scanState === "scanning" ? text.scanning : text.scan}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => scrollTo("workflow-file-review")}>
                {text.reviewFiles}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-muted-foreground">{text.found}</p>
              {activeCandidate ? (
                <Badge tone={activeCandidate.evidenceHealth.state === "valid" ? "success" : "warning"}>
                  {text.confidence} {Math.round(activeCandidate.confidence * 100)}%
                </Badge>
              ) : null}
            </div>
            <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">{text.role}</dt>
                <dd className="font-medium">{activeCandidate?.name ?? definition?.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{text.starts}</dt>
                <dd>{triggerTypes.map((type) => text.types[type as keyof typeof text.types] ?? type).join("、") || text.none}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{text.always}</dt>
                <dd>{steps.filter((step) => step.required).map((step) => step.label).join(" → ") || text.none}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{text.conditional}</dt>
                <dd>{steps.filter((step) => !step.required).map((step) => step.label).join(" → ") || text.none}</dd>
              </div>
              {(["references", "outputs", "ledgers"] as const).map((group) => (
                <div key={group}>
                  <dt className="text-xs text-muted-foreground">{text[group]}</dt>
                  <dd>{groups[group].map((step) => configuredValue(step) ?? text.kinds[step.kind]).join("；") || text.none}</dd>
                </div>
              ))}
            </dl>

            <details className="mt-3 rounded-md border bg-background p-3">
              <summary className="cursor-pointer text-sm font-medium">{text.why}</summary>
              <p className="mt-2 text-xs text-muted-foreground">{text.whyHint}</p>
              <ul className="mt-2 space-y-1 text-xs">
                {steps.map((step) => (
                  <li key={step.key}>
                    <span className="font-medium">{step.label}</span>
                    {" · "}{step.supportCaseIds?.length ?? 0} {text.examples}
                    {step.exceptionCaseIds?.length ? ` · ${step.exceptionCaseIds.length} ${text.exceptions}` : ""}
                    {step.explanation ? <span className="block text-muted-foreground">{step.explanation}</span> : null}
                  </li>
                ))}
              </ul>
              {evidenceFiles.length ? (
                <div className="mt-3">
                  <p className="text-xs font-medium">{text.supportingFiles}</p>
                  <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                    {evidenceFiles.map((artifact) => <li key={artifact.id}>{artifact.name}</li>)}
                  </ul>
                </div>
              ) : null}
              <Button className="mt-3" size="sm" variant="secondary" onClick={() => scrollTo("workflow-file-review")}>
                {text.reviewFiles}
              </Button>
            </details>

            <div className="mt-3">
              {activeCandidate && !definition ? (
                <Button size="sm" disabled={pending || activeCandidate.evidenceHealth.state !== "valid"}
                  onClick={() => onCreateDraft(activeCandidate.id)}>
                  <Check /> {text.reviewTask}
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => scrollTo("workflow-routine-library")}>
                  {text.reviewTask}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
