import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { LocalWorkItemObservability } from "./task-view-types";

export function WorkItemAlertAndCostDetails({
  observability,
  pending,
  onRetryAlert,
}: {
  observability: LocalWorkItemObservability | null;
  pending: boolean;
  onRetryAlert: (alertId: string) => void;
}) {
  const { t } = useAppTranslation();
  if (!observability) return null;
  const alerts = observability.alerts.items ?? [];
  const showCost = observability.cost.entryCount > 0 || observability.cost.projectBudget || observability.cost.teamBudget;
  return (
    <>
      {alerts.length ? (
        <details className="rounded-md border border-border p-3 text-xs">
          <summary className="cursor-pointer font-semibold">{t("taskCockpit.alertDetails")}</summary>
          <div className="mt-2 space-y-2">
            {alerts.map((alert) => (
              <div key={alert.id} className="rounded bg-muted p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{alert.kind}</strong>
                  <Badge tone={alert.status === "failed" ? "danger" : alert.status === "sent" ? "success" : alert.status === "skipped" ? "neutral" : "warning"}>{alert.status}</Badge>
                  {["failed", "skipped"].includes(alert.status) ? (
                    <button type="button" className="text-primary hover:underline" disabled={pending} onClick={() => onRetryAlert(alert.id)}>
                      {t("shared.tryAgain")}
                    </button>
                  ) : null}
                  <span>{t("taskCockpit.alertAttempts", { count: alert.attempts })}</span>
                </div>
                {alert.lastError ? <p className="mt-1 text-destructive">{alert.lastError}</p> : null}
                {alert.nextAttemptAt && alert.status !== "sent" ? (
                  <p className="mt-1 text-muted-foreground">{t("taskCockpit.alertNextRetry", { time: new Date(alert.nextAttemptAt).toLocaleString() })}</p>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {showCost ? (
        <details className="rounded-md border border-border p-3 text-xs">
          <summary className="cursor-pointer font-semibold">{t("taskCockpit.costDetails")}</summary>
          {(["projectBudget", "teamBudget"] as const).map((key) => {
            const budget = observability.cost[key];
            if (!budget) return null;
            return (
              <p key={key} className={cn("mt-2", budget.admissionOver ? "text-destructive" : "text-muted-foreground")}>
                {t(key === "projectBudget" ? "taskCockpit.projectBudget" : "taskCockpit.teamBudget", {
                  spent: budget.spentUsd.toFixed(2), reserved: budget.reservedUsd.toFixed(2),
                  limit: budget.limitUsd.toFixed(2), remaining: budget.remainingUsd.toFixed(2),
                })}
              </p>
            );
          })}
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {[
              [t("taskCockpit.byAutoRun"), observability.cost.byAutoRun ?? [], "autoRunId"],
              [t("taskCockpit.byModel"), observability.cost.byModel ?? [], "model"],
              [t("taskCockpit.byBudgetPool"), observability.cost.byBudgetPool ?? [], "budgetPoolId"],
            ].map(([label, rows, keyName]) => (
              <div key={String(label)} className="rounded bg-muted p-2">
                <strong>{String(label)}</strong>
                {(rows as Record<string, unknown>[]).map((row) => (
                  <p key={String(row[String(keyName)])} className="mt-1">
                    {String(row[String(keyName)])}: ${Number(row.knownUsd).toFixed(4)}
                    {Number(row.unknownEntries) ? ` +${row.unknownEntries}?` : ""}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

export function WorkItemTimeline({ observability }: { observability: LocalWorkItemObservability | null }) {
  const { t } = useAppTranslation();
  if (!observability?.timeline?.length) return null;
  return (
    <details className="rounded-md border border-border p-3 text-xs">
      <summary className="cursor-pointer text-sm font-semibold">{t("aiOps.timeline")} · {observability.executionChainId}</summary>
      <div className="mt-3 space-y-2">
        {observability.timeline.map((event) => (
          <div key={`${event.source}:${event.id}`} className="grid grid-cols-[9rem_5rem_1fr] gap-2 rounded bg-muted p-2">
            <time>{new Date(event.at).toLocaleString()}</time>
            <Badge tone={event.source === "alert" ? "danger" : event.source === "execution" ? "warning" : event.source === "cost" ? "running" : "neutral"}>{event.source}</Badge>
            <span>{event.message}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
