import { Check, ChevronRight, Circle, FileCheck2, FolderSearch, Loader2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";

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
    enabledTitle: "This computer has learned how you do this work",
    enabledHint: "The work rules are ready. Turn on automatic handling once and AI will use them for similar future work without per-task setup.",
    learnedFrom: "Learned from this folder",
    acceptance: "Checks before completion",
    asksWhen: "When AI will ask you",
    asksHint: "AI continues on its own. It pauses only when key information is missing or conflicting, or at the confirmation points below.",
    asksFallback: "Key information is missing or conflicting, or an action needs your confirmation",
    adjust: "Review or adjust these rules",
    enableTitle: "Ready to use this work type",
    enableHint: "After enabling it, similar new work can follow these steps and checks without setting up each task again.",
    enableConfirm: "I reviewed the trigger, steps, outputs, ledgers, and approval points.",
    enable: "Enable this work type",
    saveFirst: "Save the latest changes before enabling this work type.",
    cannotEnable: "This work type still needs review before it can be enabled.",
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
    title: "让 AI 学会你平时怎么做",
    hint: "不用写规则。给 AI 看几组“收到的材料”和“最后交付的结果”，它会自己总结做法，再交给你确认。",
    steps: ["选历史工作文件夹", "配对几组历史工作", "确认 AI 的做法"],
    selected: "已选",
    scan: "重新读取文件夹",
    scanning: "正在读取文件，请稍候…",
    reviewFiles: "开始整理历史案例",
    reviewTask: "看看 AI 总结得对不对",
    enabled: "已经可以使用",
    enabledTitle: "这台电脑已经学会这项工作",
    enabledHint: "工作规矩已经准备好。开启一次自动处理后，AI 会按这些规矩处理相似的新工作，不需要你在每个任务里重新设置。",
    learnedFrom: "从这个目录学会",
    acceptance: "完成前会检查",
    asksWhen: "什么时候会询问你",
    asksHint: "AI 会自动连续执行；只有缺少关键信息、资料相互冲突，或遇到下列确认点时才会暂停。",
    asksFallback: "缺少关键信息、资料相互冲突，或操作需要你确认时",
    adjust: "查看或调整已学规矩",
    enableTitle: "可以启用这项工作了",
    enableHint: "启用后，相似的新工作会按上面的步骤和检查要求处理，不需要在每个任务里重新设置。",
    enableConfirm: "我已检查触发条件、步骤、输出、台账和人工确认点。",
    enable: "启用这个工作类型",
    saveFirst: "请先保存最新修改，再启用这个工作类型。",
    cannotEnable: "这项工作还有需要检查的内容，暂时不能启用。",
    needsHistory: "先告诉 AI：哪个文件是别人发给你的，哪个文件是你最后交付的。通常确认 3 组相似工作后，就能总结出你的做法。",
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
  const target = document.getElementById(id);
  if (!target) return;
  const collapsedParent = target.closest("details") as HTMLDetailsElement | null;
  if (collapsedParent) collapsedParent.open = true;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
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
  publishPending = false,
  publishConfirmed = false,
  publishBlocked = false,
  onScan,
  onCreateDraft,
  onPublishConfirmed = () => {},
  onPublish = () => {},
}: {
  source: WorkflowSource;
  candidate: BusinessRoutineDiscoveryCandidate | null;
  definition: BusinessRoutineDefinition | null;
  artifacts: WorkflowArtifact[];
  pending: boolean;
  publishPending?: boolean;
  publishConfirmed?: boolean;
  publishBlocked?: boolean;
  onScan: () => void;
  onCreateDraft: (candidateId: string) => void;
  onPublishConfirmed?: (confirmed: boolean) => void;
  onPublish?: () => void;
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
  const approvalSteps = steps.filter((step) => step.kind === "human_approval");
  const requiredSteps = steps.filter((step) => step.required);
  const invalidCondition = steps.some((step) => step.kind === "condition"
    && !Object.values(step.configuration ?? {}).some((value) => typeof value === "string" && value.trim()));
  const publishReady = definition?.state === "draft"
    && definition.evidenceHealth.state === "valid"
    && steps.length > 0
    && steps.every((step) => step.label.trim())
    && !invalidCondition
    && !publishBlocked;
  const currentStep = published ? 3 : reviewed ? 3 : 2;

  if (published) {
    return (
      <section className="rounded-lg border border-success/40 bg-success/5 p-4 shadow-sm" aria-labelledby="routine-setup-title">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Sparkles className="size-5 text-success" aria-hidden="true" />
              <h2 id="routine-setup-title" className="font-semibold">{text.enabledTitle}</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{text.enabledHint}</p>
          </div>
          <Badge tone="success"><Check className="size-3" aria-hidden="true" /> {text.enabled}</Badge>
        </div>

        <div className="mt-4 rounded-md border bg-background p-3">
          <div className="flex flex-wrap items-center gap-2">
            <FolderSearch className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">{text.learnedFrom}</span>
            <span className="text-sm font-medium">{source.name}</span>
          </div>
          <p className="mt-3 text-sm font-semibold">{definition?.name}</p>

          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-md bg-muted/30 p-3">
              <dt className="text-xs text-muted-foreground">{text.starts}</dt>
              <dd className="mt-1 font-medium">
                {triggerTypes.map((type) => text.types[type as keyof typeof text.types] ?? type).join("、") || text.none}
              </dd>
            </div>
            <div className="rounded-md bg-muted/30 p-3">
              <dt className="text-xs text-muted-foreground">{text.references}</dt>
              <dd className="mt-1">
                {groups.references.map((step) => configuredValue(step) ?? text.kinds[step.kind]).join("；") || text.none}
              </dd>
            </div>
            <div className="rounded-md bg-muted/30 p-3">
              <dt className="text-xs text-muted-foreground">{text.outputs}</dt>
              <dd className="mt-1">
                {groups.outputs.map((step) => configuredValue(step) ?? text.kinds[step.kind]).join("；") || text.none}
              </dd>
            </div>
            <div className="rounded-md bg-muted/30 p-3">
              <dt className="text-xs text-muted-foreground">{text.ledgers}</dt>
              <dd className="mt-1">
                {groups.ledgers.map((step) => configuredValue(step) ?? text.kinds[step.kind]).join("；") || text.none}
              </dd>
            </div>
            <div className="rounded-md bg-muted/30 p-3 sm:col-span-2">
              <dt className="text-xs text-muted-foreground">{text.acceptance}</dt>
              <dd className="mt-1">{requiredSteps.map((step) => step.label).join(" → ") || text.none}</dd>
            </div>
          </dl>

          <div className="mt-3 rounded-md border border-warning/40 bg-warning/5 p-3">
            <p className="text-sm font-medium">{text.asksWhen}</p>
            <p className="mt-1 text-xs text-muted-foreground">{text.asksHint}</p>
            <p className="mt-2 text-sm">
              {approvalSteps.map((step) => step.label).join("；") || text.asksFallback}
            </p>
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium">{text.why}</summary>
            <p className="mt-2 text-xs text-muted-foreground">{text.whyHint}</p>
            {evidenceFiles.length ? (
              <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
                {evidenceFiles.map((artifact) => <li key={artifact.id}>{artifact.name}</li>)}
              </ul>
            ) : null}
          </details>

          <Button className="mt-3" size="sm" variant="secondary" onClick={() => scrollTo("workflow-routine-library")}>
            {text.adjust}
          </Button>
        </div>
      </section>
    );
  }

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
      </div>

      <ol className="mt-4 grid gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <Step label={text.steps[0]} state="complete" />
        <ChevronRight className="mx-auto hidden size-4 self-center text-muted-foreground md:block" aria-hidden="true" />
        <Step label={text.steps[1]} state={currentStep > 2 ? "complete" : "current"} />
        <ChevronRight className="mx-auto hidden size-4 self-center text-muted-foreground md:block" aria-hidden="true" />
        <Step label={text.steps[2]} state={reviewed ? "current" : "pending"} />
      </ol>

      <div className="mt-4 rounded-md border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <FolderSearch className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium">{source.name}</span>
          <span className="text-xs text-muted-foreground">{text.selected}</span>
        </div>
        {!reviewed ? (
          <div className="mt-3">
            <p className="text-sm font-medium">{text.steps[1]}</p>
            <p className="mt-1 text-sm text-muted-foreground">{text.needsHistory}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={pending || source.scanState === "scanning"}
                onClick={() => scrollTo("workflow-file-review")}>
                <FileCheck2 />
                {source.scanState === "scanning" ? text.scanning : text.reviewFiles}
              </Button>
              {source.scanState !== "scanning" ? (
                <Button size="sm" variant="ghost" disabled={pending} onClick={onScan}>
                  <RefreshCw /> {text.scan}
                </Button>
              ) : null}
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
              ) : definition?.state !== "draft" ? (
                <Button size="sm" variant="secondary" onClick={() => scrollTo("workflow-routine-library")}>
                  {text.reviewTask}
                </Button>
              ) : null}
            </div>

            {definition?.state === "draft" ? (
              <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-3">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold">{text.enableTitle}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{text.enableHint}</p>
                  </div>
                </div>
                {publishBlocked ? <p className="mt-3 text-xs text-warning">{text.saveFirst}</p> : null}
                {!publishBlocked && !publishReady ? (
                  <p className="mt-3 text-xs text-warning">{text.cannotEnable}</p>
                ) : null}
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input className="mt-0.5" type="checkbox" checked={publishConfirmed}
                    disabled={!publishReady || publishPending}
                    onChange={(event) => onPublishConfirmed(event.target.checked)} />
                  <span>{text.enableConfirm}</span>
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" disabled={!publishReady || !publishConfirmed || publishPending}
                    onClick={onPublish}>
                    {publishPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                    {text.enable}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => scrollTo("workflow-routine-library")}>
                    {text.adjust}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
