import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { api } from "@/lib/api-client";
import { useEffect, useState } from "react";
import type { LocalWorkItem, LocalWorkItemObservability } from "./task-view-types";
import { useUiStore } from "@/store/ui-store";

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
  const { t } = useAppTranslation();
  const setSection = useUiStore((state) => state.setSection);
  const [starting, setStarting] = useState(false);
  const [startResult, setStartResult] = useState<string | null>(null);
  const [currentRevision, setCurrentRevision] = useState(item.revision);
  useEffect(() => setCurrentRevision(item.revision), [item.id, item.revision]);
  const inputs = item.inputAssets ?? [];
  const outputs = item.outputAssets ?? [];
  if (!inputs.length && !outputs.length) return null;
  const evidenceIds = new Set((item.verificationRecords ?? [])
    .flatMap((record) => record.evidence)
    .filter((evidence) => evidence.kind === "asset" && evidence.assetId)
    .map((evidence) => evidence.assetId));
  const latestResolution = item.applicationResolutions?.at(-1) ?? null;
  const latestApplicationInvocation = item.executionBindings?.filter((binding) => binding.kind === "application_invocation").at(-1);
  const readiness = item.queueReadiness ?? item.assetReadiness;
  async function startApplication(requestApproval = false) {
    const assetVerb = item.requiredCapabilities?.[0];
    if (!assetVerb) return;
    setStarting(true);
    setStartResult(null);
    try {
      const selection = {
        expectedRevision: currentRevision,
        assetVerb,
        assetFamily: inputs.find((asset) => asset.capabilities.includes(assetVerb))?.family,
        resourceClass: inputs.find((asset) => asset.capabilities.includes(assetVerb))?.resourceClass,
      };
      const approval = requestApproval
        ? await api.requestWorkItemApplicationApproval(item.id, selection)
        : null;
      const result = await api.startWorkItemApplication(item.id, {
        ...selection,
        ...(approval?.approvalToken ? { approvalToken: approval.approvalToken } : {}),
      }) as { invocation?: { id?: string }; workItem?: { revision?: number } };
      if (Number.isInteger(result.workItem?.revision)) setCurrentRevision(result.workItem!.revision!);
      setStartResult(result.invocation?.id ? `${t("assetChain.started")} · ${result.invocation.id}` : t("assetChain.started"));
    } catch {
      setStartResult(t("assetChain.startFailed"));
    } finally {
      setStarting(false);
    }
  }
  async function cancelApplication() {
    const invocationId = latestApplicationInvocation?.id;
    if (!invocationId) return;
    setStarting(true);
    setStartResult(null);
    try {
      await api.cancelInvocation(invocationId);
      setStartResult(`${t("assetChain.cancelled")} · ${invocationId}`);
    } catch {
      setStartResult(t("assetChain.cancelFailed"));
    } finally {
      setStarting(false);
    }
  }
  return (
    <section aria-label={t("assetChain.label")} className="rounded-md border border-border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{t("assetChain.title")}</strong>
        <Badge tone={readiness?.state === "ready" ? "success" : "warning"}>
          {readiness?.state === "waiting_capability"
            ? t(readiness.reason === "local_resource_class_required:large" ? "assetChain.largeResource" : "assetChain.waiting")
            : readiness?.state === "waiting_approval" ? t("assetChain.approval")
              : readiness?.state === "waiting_capacity" ? t("assetChain.capacity")
                : readiness?.state === "refusal" ? t("assetChain.unavailable") : t("assetChain.ready")}
        </Badge>
        {latestResolution?.label ? <span className="text-muted-foreground">{latestResolution.label}{latestResolution.durationMs != null ? ` · ${latestResolution.durationMs}ms` : ""}</span> : null}
        {readiness?.state === "waiting_capability" ? <Button type="button" size="sm" variant="secondary" onClick={() => setSection("applications")}>{t("assetChain.setup")}</Button> : null}
        {readiness?.state === "waiting_approval" && item.requiredCapabilities?.length ? <Button type="button" size="sm" onClick={() => void startApplication(true)} disabled={starting}>{t(starting ? "assetChain.approving" : "assetChain.approveStart")}</Button> : null}
        {readiness?.state === "ready" && item.requiredCapabilities?.length ? <Button type="button" size="sm" onClick={() => void startApplication()} disabled={starting}>{t(starting ? "assetChain.starting" : "assetChain.start")}</Button> : null}
        {latestApplicationInvocation?.id ? <Button type="button" size="sm" variant="secondary" onClick={() => void cancelApplication()} disabled={starting}>{t("assetChain.cancel")}</Button> : null}
        {latestApplicationInvocation?.id && item.requiredCapabilities?.length ? <Button type="button" size="sm" variant="secondary" onClick={() => void startApplication(readiness?.state === "waiting_approval")} disabled={starting}>{t("assetChain.retry")}</Button> : null}
      </div>
      {readiness?.reason && readiness.state !== "ready" ? <p className="mt-2 text-muted-foreground">{t("assetChain.why")}: {readiness.reason}</p> : null}
      {startResult ? <p role="status" className="mt-2 text-muted-foreground">{startResult}</p> : null}
      <ol className="mt-2 flex flex-wrap items-center gap-2" aria-label={t("assetChain.steps")}>
        {inputs.map((asset) => <li key={`input:${asset.id ?? asset.path}`}><a href={assetDeepLink(item, asset)} className="block rounded bg-muted px-2 py-1 hover:text-primary"><span className="text-muted-foreground">{t("assetChain.input")} · </span>{asset.path}</a></li>)}
        {(item.assetOperations ?? []).slice().reverse().map((operation) => <li key={operation.id} className="contents"><span aria-hidden="true">→</span><span className="rounded bg-muted px-2 py-1">{t("assetChain.operation")} · {assetOperationLabel(operation.capability)}</span></li>)}
        {outputs.map((asset) => <li key={`output:${asset.id ?? asset.path}`} className="contents"><span aria-hidden="true">→</span><a href={assetDeepLink(item, asset)} className="rounded bg-muted px-2 py-1 hover:text-primary"><span className="text-muted-foreground">{t(evidenceIds.has(asset.id) ? "assetChain.evidence" : "assetChain.output")} · </span>{asset.path}</a></li>)}
      </ol>
      <p className="mt-2 text-muted-foreground">{t("assetChain.terminal")} · {item.assetReadiness?.terminalId ?? inputs[0]?.terminalId ?? outputs[0]?.terminalId}</p>
    </section>
  );
}

export function assetOperationLabel(capability: string): string {
  const labels: Record<string, string> = {
    discover: "Find asset", preview: "Preview asset", inspect: "Inspect asset",
    create: "Create asset", edit: "Update asset", transform: "Convert asset",
    render: "Render preview", compare: "Compare versions", export: "Export asset",
    open_external: "Open in local application", attach_evidence: "Attach evidence",
  };
  return labels[capability] ?? "Process asset";
}

export function assetDeepLink(item: LocalWorkItem, asset: { path: string; worktreeId?: string | null }): string {
  const query = new URLSearchParams({ section: "documents", project: item.projectId, document: asset.path });
  if (asset.worktreeId) query.set("worktree", asset.worktreeId);
  return `/?${query}`;
}

export function workItemAssetChainLabels(item: LocalWorkItem): string[] {
  const evidenceIds = new Set((item.verificationRecords ?? [])
    .flatMap((record) => record.evidence)
    .filter((evidence) => evidence.kind === "asset" && evidence.assetId)
    .map((evidence) => evidence.assetId));
  return [
    ...(item.inputAssets ?? []).map((asset) => `Input · ${asset.path}`),
    ...(item.assetOperations ?? []).slice().reverse().map((operation) => `Operation · ${assetOperationLabel(operation.capability)}`),
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
  const [showAll, setShowAll] = useState(false);
  if (!observability?.timeline?.length) return null;
  const orderedEvents = observability.timeline
    .slice()
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const visibleEvents = showAll ? orderedEvents : orderedEvents.slice(-20);
  const hiddenCount = orderedEvents.length - visibleEvents.length;
  return (
    <details open={expanded || undefined} className="rounded-md border border-border p-3 text-xs">
      <summary className="cursor-pointer text-sm font-semibold">
        {t("aiOps.timeline")} · {orderedEvents.length} {t("executionUi.events")}
      </summary>
      <div className="mt-3 space-y-2">
        {hiddenCount > 0 ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setShowAll(true)}>
            {t("executionUi.showEarlier", { count: hiddenCount })}
          </Button>
        ) : showAll && orderedEvents.length > 20 ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setShowAll(false)}>
            {t("executionUi.showRecent")}
          </Button>
        ) : null}
        {visibleEvents.map((event) => {
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
