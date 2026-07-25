import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { LocalWorkItem, LocalWorkItemObservability } from "./task-view-types";

export type TaskTraceIdentity = {
  principalId: string | null;
  deviceId: string | null;
  effectiveAuthority: string | null;
  reason: string | null;
};

const TRACE_TEXT_LIMIT = 160;

function safeTraceText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length > TRACE_TEXT_LIMIT
    ? `${normalized.slice(0, TRACE_TEXT_LIMIT)}…`
    : normalized;
}

/**
 * Trace uses an explicit allowlist instead of rendering event payloads. This
 * keeps credentials, prompts, and arbitrarily large adapter data out of the UI.
 */
export function taskTraceIdentity(event: {
  actorId: string | null;
  data: Record<string, unknown>;
}): TaskTraceIdentity {
  return {
    principalId: safeTraceText(event.data.principalId) ?? safeTraceText(event.actorId),
    deviceId: safeTraceText(event.data.deviceId) ?? safeTraceText(event.data.terminalId),
    effectiveAuthority: safeTraceText(event.data.effectiveAuthority),
    reason: safeTraceText(event.data.waitingReason)
      ?? safeTraceText(event.data.reason)
      ?? safeTraceText(event.data.rationale),
  };
}

export function taskTraceWaitingReason(observability: LocalWorkItemObservability | null): string | null {
  const event = observability?.timeline?.find((candidate) =>
    candidate.stage === "queue" && Boolean(taskTraceIdentity(candidate).reason));
  return event ? taskTraceIdentity(event).reason : null;
}

export function WorkItemTraceSummary({
  item,
  observability,
}: {
  item: LocalWorkItem;
  observability: LocalWorkItemObservability | null;
}) {
  const { t } = useAppTranslation();
  if (!observability) return null;
  const route = observability.routingExplanation;
  const waitingReason = taskTraceWaitingReason(observability);
  const retryCount = observability.timeline?.filter((event) => event.stage === "retry").length ?? 0;
  const evidenceCount = (item.verificationRecords ?? []).reduce(
    (count, record) => count + record.evidence.length,
    0,
  );
  return (
    <>
    <section aria-label={t("shell.taskTrace.summary")} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-md border border-border p-3 text-xs">
        <span className="text-muted-foreground">{t("shell.taskTrace.route")}</span>
        <p className="mt-1 font-semibold">
          {route?.selectedPath ?? t("shell.taskTrace.notSelected")}
          {observability.latestRun?.agentId ? ` · ${observability.latestRun.agentId}` : ""}
        </p>
        {route?.rationale ? <p className="mt-1 text-muted-foreground">{safeTraceText(route.rationale)}</p> : null}
      </div>
      <div className="rounded-md border border-border p-3 text-xs">
        <span className="text-muted-foreground">{t("shell.taskTrace.waiting")}</span>
        <p className="mt-1 font-semibold">{waitingReason ?? t("shell.taskTrace.noWaiting")}</p>
      </div>
      <div className="rounded-md border border-border p-3 text-xs">
        <span className="text-muted-foreground">{t("shell.taskTrace.retries")}</span>
        <p className="mt-1 font-semibold">{t("shell.taskTrace.retryCount", { count: retryCount })}</p>
      </div>
      <div className="rounded-md border border-border p-3 text-xs">
        <span className="text-muted-foreground">{t("shell.taskTrace.finalEvidence")}</span>
        <p className="mt-1 font-semibold">{t("shell.taskTrace.evidenceCount", { count: evidenceCount })}</p>
      </div>
    </section>
    <WorkItemAssetChain item={item} />
    </>
  );
}

export function WorkItemAssetChain({ item }: { item: LocalWorkItem }) {
  const inputs = item.inputAssets ?? [];
  const outputs = item.outputAssets ?? [];
  if (!inputs.length && !outputs.length) return null;
  const evidenceIds = new Set((item.verificationRecords ?? [])
    .flatMap((record) => record.evidence)
    .filter((evidence) => evidence.kind === "asset" && evidence.assetId)
    .map((evidence) => evidence.assetId));
  return (
    <section aria-label="Asset execution chain" className="rounded-md border border-border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <strong>Assets</strong>
        <Badge tone={item.assetReadiness?.state === "ready" ? "success" : "warning"}>
          {item.assetReadiness?.state === "waiting_capability" ? "Waiting for a local capability" : "Ready on this computer"}
        </Badge>
      </div>
      <ol className="mt-2 flex flex-wrap items-center gap-2" aria-label="Input, operation, output, and evidence">
        {inputs.map((asset) => <li key={`input:${asset.id ?? asset.path}`} className="rounded bg-muted px-2 py-1"><span className="text-muted-foreground">Input · </span>{asset.path}</li>)}
        {(item.assetOperations ?? []).slice().reverse().map((operation) => <li key={operation.id} className="contents"><span aria-hidden="true">→</span><span className="rounded bg-muted px-2 py-1">Operation · {operation.capability}</span></li>)}
        {outputs.map((asset) => <li key={`output:${asset.id ?? asset.path}`} className="contents"><span aria-hidden="true">→</span><span className="rounded bg-muted px-2 py-1"><span className="text-muted-foreground">{evidenceIds.has(asset.id) ? "Evidence" : "Output"} · </span>{asset.path}</span></li>)}
      </ol>
      <p className="mt-2 text-muted-foreground">Terminal · {item.assetReadiness?.terminalId ?? inputs[0]?.terminalId ?? outputs[0]?.terminalId}</p>
    </section>
  );
}

export function workItemAssetChainLabels(item: LocalWorkItem): string[] {
  const evidenceIds = new Set((item.verificationRecords ?? [])
    .flatMap((record) => record.evidence)
    .filter((evidence) => evidence.kind === "asset" && evidence.assetId)
    .map((evidence) => evidence.assetId));
  return [
    ...(item.inputAssets ?? []).map((asset) => `Input · ${asset.path}`),
    ...(item.assetOperations ?? []).slice().reverse().map((operation) => `Operation · ${operation.capability}`),
    ...(item.outputAssets ?? []).map((asset) => `${evidenceIds.has(asset.id) ? "Evidence" : "Output"} · ${asset.path}`),
  ];
}

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

export function WorkItemTimeline({
  observability,
  expanded = false,
}: {
  observability: LocalWorkItemObservability | null;
  expanded?: boolean;
}) {
  const { t } = useAppTranslation();
  if (!observability?.timeline?.length) return null;
  return (
    <details open={expanded || undefined} className="rounded-md border border-border p-3 text-xs">
      <summary className="cursor-pointer text-sm font-semibold">{t("aiOps.timeline")} · {observability.executionChainId}</summary>
      <div className="mt-3 space-y-2">
        {observability.timeline.map((event) => {
          const identity = taskTraceIdentity(event);
          const stage = event.stage ?? "other";
          return (
            <div key={`${event.source}:${event.id}`} className="grid gap-2 rounded bg-muted p-2 sm:grid-cols-[9rem_5rem_1fr]">
              <time>{new Date(event.at).toLocaleString()}</time>
              <Badge tone={event.source === "alert" ? "danger" : stage === "completion" || stage === "verification" ? "success" : stage === "execution" || stage === "tool" ? "running" : "neutral"}>
                {t(`shell.taskTraceStages.${stage}`)}
              </Badge>
              <div className="min-w-0">
                <p>{event.message}</p>
                <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                  {identity.principalId ? <div><dt className="inline">{t("shell.taskTrace.principal")}: </dt><dd className="inline font-mono">{identity.principalId}</dd></div> : null}
                  {identity.deviceId ? <div><dt className="inline">{t("shell.taskTrace.terminal")}: </dt><dd className="inline font-mono">{identity.deviceId}</dd></div> : null}
                  {identity.effectiveAuthority ? <div><dt className="inline">{t("shell.taskTrace.authority")}: </dt><dd className="inline">{identity.effectiveAuthority}</dd></div> : null}
                </dl>
                {identity.reason ? <p className="mt-1 text-xs text-muted-foreground">{t("shell.taskTrace.reason")}: {identity.reason}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}
