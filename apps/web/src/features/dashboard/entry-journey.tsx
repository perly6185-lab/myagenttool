import { CheckCircle2, Circle, LoaderCircle } from "lucide-react";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore } from "@/store/ui-store";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { ConsoleSnapshot, InvocationSnapshot } from "@/lib/console-state";

function projectIdOf(row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;
  if (typeof row.projectId === "string") return row.projectId;
  const options = row.options as { metadata?: { projectId?: string } } | undefined;
  return options?.metadata?.projectId ?? null;
}

export function entryJourneyContext(
  state: ConsoleSnapshot | undefined,
  selectedProjectId: string | null,
  selectedInvocationId: string | null,
) {
  const all = state?.invocations ?? [];
  const scoped = selectedProjectId
    ? all.filter((row) => projectIdOf(row as unknown as Record<string, unknown>) === selectedProjectId)
    : all;
  const selected = scoped.find((row) => row.id === selectedInvocationId);
  const invocation = selected ?? [...scoped].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
  const belongs = (row: Record<string, unknown>) => {
    const rowInvocationId = typeof row.invocationId === "string" ? row.invocationId : null;
    if (invocation && rowInvocationId) return rowInvocationId === invocation.id;
    const rowProjectId = projectIdOf(row);
    return selectedProjectId ? rowProjectId === selectedProjectId : true;
  };
  return {
    invocation: invocation as InvocationSnapshot | null,
    pending: (state?.pendingDecisions ?? []).filter((row) => belongs(row as unknown as Record<string, unknown>)).length,
    attention: (state?.evidenceLedger ?? []).filter((row) => row.attention && belongs(row as unknown as Record<string, unknown>)).length,
  };
}

export function EntryJourney() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const selectedInvocationId = useUiStore((item) => item.selectedInvocationId);
  const selectedProjectId = useUiStore((item) => item.selectedProjectId);
  const setSection = useUiStore((item) => item.setSection);
  const { invocation, pending, attention } = entryJourneyContext(state, selectedProjectId, selectedInvocationId);
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
