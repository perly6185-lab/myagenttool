import { Bot, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { myTemplateExpectedOutput } from "@/features/workflow-memory/my-template-model";
import type { BusinessRoutineDefinition } from "@/lib/api-client";
import type { LocalWorkItem } from "./task-view-types";

type MyTemplateBinding = NonNullable<LocalWorkItem["myTemplateBinding"]>;

export function WorkItemTemplateBindingCard({
  workItemId,
  binding,
  language,
  canCorrect,
  correctionOpen,
  correctionOptions,
  correctionPending,
  correctionError,
  onOpenCorrection,
  onCorrect,
  onCancelCorrection,
}: {
  workItemId: string;
  binding: MyTemplateBinding;
  language: "zh" | "en";
  canCorrect: boolean;
  correctionOpen: boolean;
  correctionOptions: BusinessRoutineDefinition[];
  correctionPending: boolean;
  correctionError: string | null;
  onOpenCorrection: () => void;
  onCorrect: (definition: BusinessRoutineDefinition) => void;
  onCancelCorrection: () => void;
}) {
  const learnedFromCorrection = binding.matchReasons.some((reason) => /纠正|corrected|correction/i.test(reason));

  return (
    <section
      className="rounded-xl border border-primary/30 bg-primary/[0.035] p-4"
      aria-labelledby={`work-item-template-${workItemId}`}
      data-testid="work-item-template-binding"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Bot className="size-4 text-primary" aria-hidden />
            <h4 id={`work-item-template-${workItemId}`} className="text-sm font-semibold">
              {language === "zh" ? "这次会怎样得到结果" : "How this task will produce its result"}
            </h4>
            <Badge tone="success">{learnedFromCorrection
              ? (language === "zh" ? "参考了你的纠正" : "Learned from your correction")
              : (language === "zh" ? "已按结果自动采用" : "Selected from the result")}</Badge>
          </div>
          <p className="mt-2 text-sm font-medium">
            {language === "zh" ? "预计得到：" : "Expected result: "}{binding.expectedOutput}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {language === "zh" ? "处理依据：参考了你之前确认过的做法" : "Basis: a previously confirmed approach"}
          </p>
        </div>
        {canCorrect && !correctionOpen ? (
          <Button size="sm" variant="ghost" disabled={correctionPending} onClick={onOpenCorrection}>
            {language === "zh" ? "结果不对" : "Wrong result"}
          </Button>
        ) : null}
      </div>
      {learnedFromCorrection ? (
        <p className="mt-3 rounded-lg border border-primary/20 bg-background/70 p-2.5 text-xs leading-relaxed text-muted-foreground">
          {language === "zh"
            ? "系统发现这项任务与之前由你纠正过的任务相似，因此优先采用这个结果。你可以在设置中查看或撤销系统记住的选择。"
            : "This task looks similar to one you corrected before, so that result was preferred. You can review or remove the remembered choice in settings."}
        </p>
      ) : null}
      {binding.matchReasons.length ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {language === "zh" ? "使用原因：" : "Why it was used: "}
          {binding.matchReasons.join(language === "zh" ? "；" : "; ")}
        </p>
      ) : null}
      {correctionOpen ? (
        <section className="mt-3 rounded-lg border border-warning/35 bg-background/80 p-3" aria-label={language === "zh" ? "纠正处理结果" : "Correct the result"}>
          <h5 className="text-sm font-semibold">{language === "zh" ? "这次实际想得到什么？" : "What do you actually want this time?"}</h5>
          <p className="mt-1 text-xs text-muted-foreground">
            {language === "zh" ? "选择结果即可。只会调整尚未开始的当前任务，并帮助以后判断相似任务。" : "Choose the result only. This changes only the unstarted task and helps with similar tasks later."}
          </p>
          {correctionPending && !correctionOptions.length ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" aria-hidden />{language === "zh" ? "正在查找可用结果…" : "Finding available results…"}</p>
          ) : correctionOptions.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {correctionOptions.map((definition) => (
                <Button key={definition.id} size="sm" variant="secondary" disabled={correctionPending} onClick={() => onCorrect(definition)}>
                  {myTemplateExpectedOutput(definition)}
                </Button>
              ))}
            </div>
          ) : !correctionError ? (
            <p className="mt-3 text-sm text-muted-foreground">{language === "zh" ? "还没有其他可用结果，可以先到“我的模板”继续完善。" : "No other result is available yet. Add one in My templates first."}</p>
          ) : null}
          {correctionError ? <p className="mt-3 text-sm text-destructive" role="alert">{correctionError}</p> : null}
          <Button className="mt-3" size="sm" variant="ghost" disabled={correctionPending} onClick={onCancelCorrection}>
            {language === "zh" ? "取消" : "Cancel"}
          </Button>
        </section>
      ) : null}
      {binding.snapshot.steps.length ? (
        <details className="mt-3 rounded-lg border border-border/80 bg-background/70 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">
            {language === "zh" ? "查看处理步骤" : "View processing steps"}
          </summary>
          <ol className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            {binding.snapshot.steps.map((step, index) => (
              <li key={step.key} className="flex gap-2">
                <span className="text-primary">{index + 1}.</span>
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
