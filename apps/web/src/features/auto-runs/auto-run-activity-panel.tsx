import { AutoRunOnboardingCard } from "./auto-run-onboarding-card";
import { AutoRunReadinessCard } from "./auto-run-readiness-card";
import { Badge } from "@/components/ui/badge";
import { InvocationDispatchHealth } from "@/features/devices/invocation-dispatch-health";
import { cn } from "@/lib/cn";
import type { ConsoleSnapshot } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { AutoRunStatTile } from "./auto-run-overview";
import {
  eventsForRun,
  localQueueSnapshot,
  statusTone,
  type AutoRunRecord,
} from "./auto-run-model";

interface AutoRunActivityPanelProps {
  runs: AutoRunRecord[];
  consoleState?: ConsoleSnapshot;
  onOpenRun: (runId: string) => void;
}

export function selectAutoRunCenterRows(runs: AutoRunRecord[], limit = 6): AutoRunRecord[] {
  const queue = localQueueSnapshot(runs);
  return [...queue.running, ...queue.queued, ...queue.waiting]
    .filter((run, index, rows) => rows.findIndex((candidate) => candidate.id === run.id) === index)
    .slice(0, limit);
}

export function AutoRunActivityPanel({ runs, consoleState, onOpenRun }: AutoRunActivityPanelProps) {
  const { t } = useAppTranslation();
  const queue = localQueueSnapshot(runs);
  const runCenterRows = selectAutoRunCenterRows(runs);

  return (
    <>
      <section aria-label={t("devicesPage.dispatchQueue")} className="grid gap-3 sm:grid-cols-3">
        <AutoRunStatTile label={t("autoRuns.status.running")} value={String(queue.running.length)} hint={queue.running[0]?.link?.title ?? t("workBoard.none")} />
        <AutoRunStatTile label={t("executionUi.queueNext")} value={queue.next ? String(queue.queued.length) : "—"} hint={queue.next?.link?.title ?? t("devicesPage.queueClear")} />
        <AutoRunStatTile
          label={t("devicesPage.whyWaiting")}
          value={String(queue.attentionCount)}
          hint={queue.waiting[0]
            ? queue.waiting[0].error
              ?? t(`runLabels.resultSummary.${queue.waiting[0].status === "awaiting_approval" ? "waiting_for_local_approval" : queue.waiting[0].status === "failed" ? "failed" : "default"}` as never)
            : t("workBoard.none")}
        />
      </section>

      {runCenterRows.length ? (
        <section className="rounded-lg border border-border bg-card p-3" aria-label={t("executionUi.runCenter")}>
          <div className="mb-2">
            <h2 className="text-sm font-semibold">{t("executionUi.runCenter")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("executionUi.runCenterSummary", {
                running: queue.running.length,
                queued: queue.queued.length,
                attention: queue.attentionCount,
              })}
            </p>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {runCenterRows.map((run) => {
              const latestEvent = eventsForRun(consoleState?.events ?? [], run.id, run.invocationId).at(-1);
              const ageSeconds = latestEvent
                ? Math.max(0, Math.floor((Date.now() - Date.parse(latestEvent.createdAt)) / 1_000))
                : null;
              return (
                <button
                  key={`center:${run.id}`}
                  type="button"
                  onClick={() => onOpenRun(run.id)}
                  className="flex min-w-0 items-center gap-2 rounded-md border border-border p-2 text-left hover:border-primary/50 hover:bg-muted/40"
                  title={run.error ?? latestEvent?.message ?? undefined}
                >
                  <Badge tone={statusTone(run.status)}>
                    {run.status === "done" ? t("executionUi.done") : t(`autoRuns.status.${run.status}` as never, { defaultValue: run.status })}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {run.link ? `#${run.link.number} ${run.link.title}` : run.id}
                  </span>
                  <span className={cn(
                    "shrink-0 text-[10px]",
                    ageSeconds != null && ageSeconds <= 120 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                  )}>
                    {ageSeconds == null
                      ? t("executionUi.noActivity")
                      : ageSeconds < 60
                        ? t("executionUi.secondsAgo", { count: ageSeconds })
                        : t("taskCockpit.minutesAgo", { count: Math.floor(ageSeconds / 60) })}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <InvocationDispatchHealth />
      <AutoRunOnboardingCard projectId={consoleState?.currentProjectId ?? null} />
      <AutoRunReadinessCard projectId={consoleState?.currentProjectId ?? null} />
    </>
  );
}
