import { CheckCircle2, Circle, LoaderCircle } from "lucide-react";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore } from "@/store/ui-store";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

export function EntryJourney() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const selectedInvocationId = useUiStore((item) => item.selectedInvocationId);
  const setSection = useUiStore((item) => item.setSection);
  const invocation = (state?.invocations ?? []).find((item) => item.id === selectedInvocationId) ?? state?.invocations?.at(-1) ?? null;
  const pending = (state?.pendingDecisions ?? []).length;
  const attention = (state?.evidenceLedger ?? []).filter((item) => item.attention).length;
  const running = ["queued", "dispatching", "waiting_for_local_approval", "running", "cancelling"].includes(invocation?.status ?? "");
  const finished = Boolean(invocation && !running);
  const steps = [
    { key: "create", label: "entryJourney.create" as const, hint: "entryJourney.createHint" as const, done: Boolean(invocation), active: !invocation },
    { key: "execute", label: "entryJourney.execute" as const, hint: "entryJourney.executeHint" as const, done: finished, active: running },
    { key: "attention", label: "entryJourney.attention" as const, hint: "entryJourney.attentionHint" as const, done: finished && !pending && !attention, active: Boolean(pending || attention) },
    { key: "result", label: "entryJourney.result" as const, hint: "entryJourney.resultHint" as const, done: finished, active: finished },
  ];
  return (
    <nav aria-label={t("entryJourney.label")} className="grid gap-2 sm:grid-cols-4">
      {steps.map((step, index) => (
        <button key={step.key} type="button" disabled={step.key === "create"} onClick={() => {
          if (step.key === "execute" || step.key === "result") setSection("invocations");
          if (step.key === "attention") setSection(pending ? "approvals" : "evidence");
        }} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left text-xs disabled:cursor-default">
          {step.active && running ? <LoaderCircle className="size-4 animate-spin text-primary" /> : step.done ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground" />}
          <span><b className="block">{index + 1}. {t(step.label)}</b><span className="text-muted-foreground">{t(step.hint)}</span></span>
        </button>
      ))}
    </nav>
  );
}
