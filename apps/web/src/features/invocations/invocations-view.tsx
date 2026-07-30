import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Clipboard, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/common/empty-state";
import { FactList } from "@/components/common/fact-list";
import { WebNavigationLinkActions } from "@/components/common/web-navigation-link-actions";
import { invocationDeepLink, webNavigationStateFromLink } from "@/app/deep-links";
import { EventTimeline } from "@/features/invocations/event-timeline";
import { RunTranscriptSection, isTerminalRunStatus } from "@/features/invocations/run-transcript";
import { DecisionAction } from "@/features/invocations/decision-action";
import { ImportedUsageTable } from "@/features/economics/imported-usage-table";
import { useConsoleState } from "@/data/use-console-state";
import { api } from "@/data/use-console-actions";
import { resolveInvocation } from "@/features/selection";
import {
  defaultInvocationRecoverySummary,
  invocationStatusRecoveryReason,
  latestInvocationRecoveryEventSummary,
  readableRecoveryActionAvailabilityReason,
  readableRecoveryActionStatus,
  readableRecoveryActionType,
  readableRecoveryCategory,
  readableRecoveryExplanationReason,
  readableRecoveryExplanationState,
  recoveryApprovalRequestId,
  recoveryBlockedReason,
  recoveryDefaultNextStep,
  recoveryExplanationReasonTone,
  recoveryExplanationTone,
  recoveryResultInvocationId,
  recoveryResultLabel,
  recoveryResultOrchestrationLabel,
  recoveryTone,
  recoveryWaitingOn,
  sortedRecoveryActionRequests,
} from "@/features/recovery/application-recovery-ui";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import { formatDuration, formatTokens } from "@/lib/format";
import { formatUsd } from "@/lib/money";
import { statusTone } from "@/lib/readable-labels";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { delivery, invocationStatus } from "@/lib/i18n/readable-labels";
import { searchTraces } from "@/features/invocations/trace-api";
import type {
  ApplicationRecoveryActionRequest,
  ConsoleSnapshot,
  InvocationExplanation,
  InvocationSnapshot,
  WebNavigationLink,
} from "@/lib/console-state";

export function matchesTraceQuery(invocation: InvocationSnapshot, state: ConsoleSnapshot | null, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const related = [
    ...(state?.events ?? []).filter((row) => row.invocationId === invocation.id),
    ...(state?.evidenceLedger ?? []).filter((row) => JSON.stringify(row).includes(invocation.id)),
    ...(state?.applicationResults ?? []).filter((row) => JSON.stringify(row).includes(invocation.id)),
    ...(state?.channelDeliveries ?? []).filter((row) => JSON.stringify(row).includes(invocation.id)),
  ];
  return `${JSON.stringify(invocation)} ${JSON.stringify(related)}`.toLowerCase().includes(normalized);
}

export function InvocationsView() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const selectedInvocationId = useUiStore((s) => s.selectedInvocationId);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);
  const setSelectedApplicationId = useUiStore((s) => s.setSelectedApplicationId);
  const setSelectedApplicationRun = useUiStore((s) => s.setSelectedApplicationRun);

  const [traceQuery, setTraceQuery] = useState("");
  const [traceCursor, setTraceCursor] = useState<string | null>(null);
  const [traceCursorHistory, setTraceCursorHistory] = useState<(string | null)[]>([]);
  const [tracePage, setTracePage] = useState(1);
  const allInvocations = state?.invocations ?? [];
  const normalizedTraceQuery = traceQuery.trim().toLowerCase();
  useEffect(() => {
    setTraceCursor(null);
    setTraceCursorHistory([]);
    setTracePage(1);
  }, [normalizedTraceQuery]);
  const traceSearch = useQuery({
    queryKey: ["trace-search", normalizedTraceQuery, traceCursor],
    queryFn: () => searchTraces(normalizedTraceQuery, traceCursor),
    enabled: Boolean(normalizedTraceQuery),
  });
  const invocations = normalizedTraceQuery
    ? (traceSearch.data?.records ?? []).map((record) => allInvocations.find((row) => row.id === record.invocationId) ?? ({
        id: record.invocationId,
        status: record.status,
        agentId: record.agentId,
        projectId: record.projectId,
        worktreeId: record.worktreeId,
        traceId: record.traceId,
        createdAt: record.createdAt,
        input: { task: record.task },
      }))
    : allInvocations;
  const traceRecordById = new Map((traceSearch.data?.records ?? []).map((record) => [record.invocationId, record]));
  const selected = resolveInvocation(state, selectedInvocationId);
  const events = selected
    ? (state?.events ?? []).filter((e) => e.invocationId === selected.id).slice(0, 40)
    : [];
  // The rows THIS run imported (e.g. a ccusage wrapper report) — the timeline
  // event only says "Imported N row(s)"; the content lives here.
  const importedRows = selected
    ? (state?.importedUsageEstimates ?? []).filter((row) => row.invocationId === selected.id)
    : [];
  // Per-round telemetry for this run — one row per model turn (Epic #805).
  const rounds = selected
    ? (state?.invocationRounds ?? [])
        .filter((round) => round.invocationId === selected.id)
        .slice()
        .sort((a, b) => a.roundIndex - b.roundIndex)
    : [];
  const roundInputTokens = rounds.reduce((sum, round) => sum + (round.inputTokens ?? 0), 0);
  const roundOutputTokens = rounds.reduce((sum, round) => sum + (round.outputTokens ?? 0), 0);
  const roundCostUsd = rounds.reduce((sum, round) => sum + (round.estimatedCostUsd ?? 0), 0);
  const anyRoundPriced = rounds.some((round) => round.estimatedCostUsd != null);

  function viewInvocation(invocationId: string) {
    setSelectedInvocationId(invocationId);
    setSection("invocations");
  }

  function viewApproval(invocationId: string) {
    setSelectedInvocationId(invocationId);
    setSection("dashboard");
  }

  function viewApplicationRun(applicationId: string, routineId: string, invocationId: string) {
    setSelectedApplicationId(applicationId);
    setSelectedApplicationRun({ applicationId, routineId, invocationId });
    setSection("applications");
  }

  function viewWebNavigationLink(link: WebNavigationLink) {
    const navigation = webNavigationStateFromLink(link);
    if (navigation.selectedApplicationRun) {
      viewApplicationRun(
        navigation.selectedApplicationRun.applicationId,
        navigation.selectedApplicationRun.routineId,
        navigation.selectedApplicationRun.invocationId,
      );
      return;
    }
    if (navigation.selectedInvocationId) {
      viewInvocation(navigation.selectedInvocationId);
      return;
    }
    if (navigation.section) {
      setSection(navigation.section);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{t("invocations.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 space-y-2">
            <Input
              type="search"
              value={traceQuery}
              onChange={(event) => setTraceQuery(event.target.value)}
              aria-label={t("traceSearch.label")}
              placeholder={t("traceSearch.placeholder")}
            />
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge tone="neutral">{t("traceSearch.runs", { count: normalizedTraceQuery ? traceSearch.data?.total ?? 0 : invocations.length })}</Badge>
              <span>{t("traceSearch.scope")}</span>
            </div>
          </div>
          {normalizedTraceQuery && traceSearch.isPending ? (
            <p role="status" className="rounded-lg border p-4 text-sm text-muted-foreground">{t("traceSearch.loading")}</p>
          ) : normalizedTraceQuery && traceSearch.isError ? (
            <div role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm">
              <p>{t("traceSearch.failed")}</p>
              <Button className="mt-2" size="sm" variant="secondary" onClick={() => traceSearch.refetch()}>{t("traceSearch.retry")}</Button>
            </div>
          ) : invocations.length === 0 ? (
            <EmptyState
              title={normalizedTraceQuery ? t("traceSearch.noMatch") : t("invocations.emptyTitle")}
              hint={normalizedTraceQuery ? t("traceSearch.noMatchHint") : t("invocations.emptyHint")}
              action={<Button size="sm" onClick={() => setSection("dashboard")}>{t("invocations.startTask")}</Button>}
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{t("invocations.task")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("invocations.agent")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("invocations.delivery")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("invocations.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {invocations.map((invocation) => {
                    const active = invocation.id === selected?.id;
                    const traceRecord = traceRecordById.get(invocation.id);
                    const invocationAgent = (state?.agents ?? []).find((agent) => agent.id === invocation.agentId);
                    const related = traceRecord ? [
                      ...traceRecord.applicationIds.map((id) => `Application · ${id}`),
                      ...traceRecord.channelIds.map((id) => `Channel · ${id}`),
                      ...traceRecord.eventTypes.map((id) => `Event · ${id}`),
                      ...traceRecord.evidenceIds.map((id) => `Evidence · ${id}`),
                    ].slice(0, 3) : [];
                    return (
                      <tr
                        key={invocation.id}
                        onClick={() => setSelectedInvocationId(invocation.id)}
                        className={cn(
                          "cursor-pointer border-t border-border transition-colors hover:bg-accent/60",
                          active && "bg-accent",
                        )}
                      >
                        <td className="px-3 py-2 text-xs">
                          <span className="block font-medium">
                            {invocation.input?.task || traceRecord?.task || t("dashboard.untitledTask")}
                          </span>
                          <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">{invocation.id}</span>
                          {related.length ? <span className="mt-1 flex flex-wrap gap-1">{related.map((label) => <Badge key={label} tone="neutral">{label}</Badge>)}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          <span className="block">{invocationAgent?.name ?? invocation.agentId ?? "—"}</span>
                          {invocationAgent && invocation.agentId ? (
                            <span className="block font-mono text-[11px]">{invocation.agentId}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {delivery(t, invocation.delivery?.state)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <StatusBadge tone={statusTone(invocation.status)}>
                            {invocationStatus(t, invocation.status)}
                          </StatusBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {normalizedTraceQuery && (tracePage > 1 || traceSearch.data?.nextCursor) ? (
            <div className="mt-3 flex items-center justify-end gap-2">
              <span className="text-xs text-muted-foreground">{t("traceSearch.page", { page: tracePage })}</span>
              {traceCursorHistory.length ? (
                <Button size="sm" variant="ghost" onClick={() => {
                  const previous = traceCursorHistory.at(-1) ?? null;
                  setTraceCursorHistory((history) => history.slice(0, -1));
                  setTraceCursor(previous);
                  setTracePage((page) => Math.max(1, page - 1));
                }}>{t("traceSearch.previous")}</Button>
              ) : null}
              {traceSearch.data?.nextCursor ? (
                <Button size="sm" variant="secondary" onClick={() => {
                  setTraceCursorHistory((history) => [...history, traceCursor]);
                  setTraceCursor(traceSearch.data?.nextCursor ?? null);
                  setTracePage((page) => page + 1);
                }}>{t("traceSearch.next")}</Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {selected ? (
        <OperatorExplanationCard
          invocation={selected}
          state={state ?? null}
          onViewApproval={viewApproval}
          onViewApplicationRun={viewApplicationRun}
          onViewInvocation={viewInvocation}
          onViewWebNavigationLink={viewWebNavigationLink}
        />
      ) : null}

      {selected && importedRows.length ? (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <CardTitle>{t("invocations.importedUsage")}</CardTitle>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone="neutral">{t("invocations.nonAuthoritative")}</Badge>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSection("economics")}>
                  {t("invocations.viewEconomics")}
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("invocations.importedSummary", { count: importedRows.length })}
            </p>
          </CardHeader>
          <CardContent>
            <ImportedUsageTable rows={importedRows} />
          </CardContent>
        </Card>
      ) : null}

      {selected?.requestContext ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("invocations.requestContext")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("invocations.requestContextHint")}
            </p>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
              {selected.requestContext.model ? (
                <>
                  <dt className="text-muted-foreground">{t("invocations.model")}</dt>
                  <dd className="font-mono [overflow-wrap:anywhere]">
                    {selected.requestContext.model}
                    {selected.requestContext.provider ? (
                      <span className="ml-1 text-xs text-muted-foreground">{selected.requestContext.provider}</span>
                    ) : null}
                  </dd>
                </>
              ) : null}
              {selected.requestContext.permissionMode ? (
                <>
                  <dt className="text-muted-foreground">{t("invocations.permission")}</dt>
                  <dd><Badge tone="neutral">{selected.requestContext.permissionMode}</Badge></dd>
                </>
              ) : null}
              {selected.requestContext.tools?.length ? (
                <>
                  <dt className="text-muted-foreground">{t("invocations.tools", { count: selected.requestContext.tools.length })}</dt>
                  <dd className="flex flex-wrap gap-1">
                    {selected.requestContext.tools.map((tool) => (
                      <span key={tool} className="rounded border border-border px-1.5 py-0.5 font-mono text-xs">{tool}</span>
                    ))}
                  </dd>
                </>
              ) : null}
              {selected.requestContext.mcpServers?.length ? (
                <>
                  <dt className="text-muted-foreground">{t("invocations.mcpServers")}</dt>
                  <dd className="flex flex-wrap gap-1">
                    {selected.requestContext.mcpServers.map((server) => (
                      <span key={server.name} className="rounded border border-border px-1.5 py-0.5 text-xs">
                        {server.name}
                        {server.status ? <span className="ml-1 text-muted-foreground">· {server.status}</span> : null}
                      </span>
                    ))}
                  </dd>
                </>
              ) : null}
              {selected.requestContext.skills?.length ? (
                <>
                  <dt className="text-muted-foreground">{t("invocations.skills", { count: selected.requestContext.skills.length })}</dt>
                  <dd className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {selected.requestContext.skills.join(", ")}
                  </dd>
                </>
              ) : null}
              {selected.requestContext.agents?.length ? (
                <>
                  <dt className="text-muted-foreground">{t("invocations.agents", { count: selected.requestContext.agents.length })}</dt>
                  <dd className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {selected.requestContext.agents.join(", ")}
                  </dd>
                </>
              ) : null}
              {selected.requestContext.slashCommandCount ? (
                <>
                  <dt className="text-muted-foreground">{t("invocations.slashCommands")}</dt>
                  <dd className="tabular-nums text-muted-foreground">{selected.requestContext.slashCommandCount}</dd>
                </>
              ) : null}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      {selected && rounds.length ? (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <CardTitle>{t("invocations.roundsTitle")}</CardTitle>
              <Badge tone="neutral">{t("invocations.rounds", { count: rounds.length })}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("invocations.roundSummary", {
                input: formatTokens(roundInputTokens),
                output: formatTokens(roundOutputTokens),
                cost: anyRoundPriced ? ` · ~${formatUsd(roundCostUsd)} ${t("invocations.estimated")}` : "",
              })}
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">#</th>
                    <th className="px-3 py-2 text-left font-medium">{t("invocations.model")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("invocations.input")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("invocations.output")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("invocations.cached")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("invocations.cost")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("invocations.duration")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("invocations.files")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("invocations.toolsHeader")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("invocations.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.map((round) => {
                    const files = round.filesRead ?? [];
                    return (
                      <tr key={round.id} className="border-t border-border align-top">
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{round.roundIndex}</td>
                        <td className="px-3 py-2 [overflow-wrap:anywhere]">
                          {round.model ?? "—"}
                          {round.provider ? (
                            <span className="ml-1 text-xs text-muted-foreground">{round.provider}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatTokens(round.inputTokens)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatTokens(round.outputTokens)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatTokens(round.cachedTokens)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {round.estimatedCostUsd != null ? formatUsd(round.estimatedCostUsd) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatDuration(round.durationMs)}</td>
                        <td
                          className="px-3 py-2 text-right tabular-nums text-muted-foreground"
                          title={files.length ? files.join("\n") : undefined}
                        >
                          {files.length}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{(round.toolCallIds ?? []).length}</td>
                        <td className="px-3 py-2 text-right">
                          <StatusBadge tone={statusTone(round.status ?? "")}>
                            {invocationStatus(t, round.status ?? "")}
                          </StatusBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* #1086: the run's actual work — every "open run" deep-link (evidence,
          approvals, operator explanation) lands here; the Rounds table above
          shows tool/file COUNTS, this is where they expand. */}
      {selected ? (
        <RunTranscriptSection invocationId={selected.id} terminal={isTerminalRunStatus(selected.status)} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{selected ? t("invocations.timelineId", { id: selected.id }) : t("invocations.timeline")}</CardTitle>
        </CardHeader>
        <CardContent>
          <EventTimeline events={events} renderAction={(event) => <DecisionAction event={event} />} />
        </CardContent>
      </Card>
    </div>
  );
}

function OperatorExplanationCard({
  invocation,
  state,
  onViewApproval,
  onViewApplicationRun,
  onViewInvocation,
  onViewWebNavigationLink,
}: {
  invocation: InvocationSnapshot;
  state: ConsoleSnapshot | null;
  onViewApproval: (invocationId: string) => void;
  onViewApplicationRun: (applicationId: string, routineId: string, invocationId: string) => void;
  onViewInvocation: (invocationId: string) => void;
  onViewWebNavigationLink: (link: WebNavigationLink) => void;
}) {
  const { t } = useAppTranslation();
  const [copiedLink, setCopiedLink] = useState(false);
  const serverExplanation = invocation.explanation ?? null;
  const metadata = invocation.options?.metadata ?? {};
  const source = serverExplanation?.source ?? null;
  const applicationId = stringValue(source?.applicationId) ?? stringValue(metadata.applicationId);
  const routineId = stringValue(source?.routineId) ?? stringValue(metadata.routineId);
  const isApplicationRun = (source?.type === "application_orchestration" || metadata.source === "application_orchestration") && Boolean(applicationId && routineId);
  const recoveryActions = sortedRecoveryActionRequests(
    (state?.applicationRecoveryActions ?? []).filter((request) => request.invocationId === invocation.id),
  );
  const latestRecoveryAction = recoveryActions[0] ?? null;
  const { data: recoveryData, isLoading, error } = useQuery({
    queryKey: ["invocation-operator-recovery", applicationId, routineId, invocation.id],
    queryFn: () => api.getApplicationOrchestrationRunRecovery(applicationId!, routineId!, invocation.id),
    enabled: Boolean(isApplicationRun && applicationId && routineId),
    refetchInterval: 2000,
  });
  const recovery = recoveryData?.recovery ?? null;
  const recoveryExplanation = latestRecoveryAction?.explanation ?? null;
  const approvalRequestId = serverExplanation?.approval?.requestId
    ?? (serverExplanation?.waitingOn?.type === "approval" ? serverExplanation.waitingOn.id ?? null : null)
    ?? recoveryApprovalRequestId(invocation, recoveryExplanation, latestRecoveryAction);
  const approval = approvalRequestId
    ? (state?.approvalRequests ?? []).find((item) => item.id === approvalRequestId) ?? null
    : null;
  const resultInvocationId = serverExplanation?.resultLocation?.type === "invocation"
    ? serverExplanation.resultLocation.invocationId
    ?? serverExplanation?.recovery?.resultInvocationId
    ?? recoveryResultInvocationId(recoveryExplanation, latestRecoveryAction)
    : serverExplanation?.recovery?.resultInvocationId
      ?? recoveryResultInvocationId(recoveryExplanation, latestRecoveryAction);
  const resultOrchestration = serverExplanation?.resultLocation?.type === "orchestration"
    ? serverExplanation.resultLocation.label ?? serverExplanation.resultLocation.orchestrationId ?? null
    : recoveryResultOrchestrationLabel(recoveryExplanation);
  const summary = serverExplanation?.summary
    ?? recoveryExplanation?.summary
    ?? latestRecoveryAction?.outcome?.summary
    ?? recovery?.summary
    ?? invocation.result?.summary
    ?? latestInvocationRecoveryEventSummary(state, invocation.id)
    ?? defaultInvocationRecoverySummary(invocation);
  const reasonCode = serverExplanation?.reasonCode
    ?? recoveryExplanation?.reason
    ?? latestRecoveryAction?.outcome?.reason
    ?? recovery?.category
    ?? invocationStatusRecoveryReason(invocation);
  const nextStep = serverExplanation?.nextAction
    ?? recoveryExplanation?.nextStep
    ?? latestRecoveryAction?.outcome?.nextStep
    ?? recoveryDefaultNextStep(invocation, recovery, latestRecoveryAction);
  const recoveryCategory = serverExplanation?.recovery?.category ?? recovery?.category ?? null;
  const sourceLabel = sourceBadgeLabel(serverExplanation);
  const recoveryState = recoveryExplanation?.state
    ?? (serverExplanation?.state && ["approval_pending", "approval_denied", "failed", "executed", "executing"].includes(serverExplanation.state)
      ? serverExplanation.state
      : null);
  const resultLabel = resultLocationLabel(serverExplanation)
    ?? resultInvocationId
    ?? resultOrchestration
    ?? recoveryResultLabel(invocation);
  const recoveryActionValue = latestRecoveryAction
    ? `${readableRecoveryActionType(latestRecoveryAction.actionType)} · ${readableRecoveryActionStatus(latestRecoveryAction.status, "inline")}`
    : serverRecoveryActionLabel(serverExplanation);
  const recoveryRequest = recoveryRequestForExplanation(state, serverExplanation, latestRecoveryAction);
  const approvalTargetInvocationId = approval?.invocationId
    ?? recoveryRequest?.invocationId
    ?? (invocation.approvalRequestId === approvalRequestId ? invocation.id : null);
  const approvalTargetMissing = Boolean(approvalRequestId && !approvalTargetInvocationId);
  const recoveryTimelineTarget = recoveryRequest
    ? {
        applicationId: recoveryRequest.applicationId,
        routineId: recoveryRequest.routineId,
        invocationId: recoveryRequest.invocationId,
      }
    : applicationId && routineId && (serverExplanation?.recovery?.sourceInvocationId ?? invocation.id)
      ? {
          applicationId,
          routineId,
          invocationId: serverExplanation?.recovery?.sourceInvocationId ?? invocation.id,
        }
      : null;
  const troubleshootingTarget = serverExplanation?.resultLocation?.type === "troubleshooting_report" && serverExplanation.resultLocation.reportId
    ? (state?.troubleshootingReports ?? []).find((report) => report.id === serverExplanation.resultLocation?.reportId) ?? null
    : null;
  const resultInvocationTargetId = resultInvocationId && invocationExists(state, resultInvocationId)
    ? resultInvocationId
    : null;
  const resultInvocationMissing = Boolean(resultInvocationId && !resultInvocationTargetId);
  const troubleshootingInvocationTargetId = troubleshootingTarget?.invocationId && invocationExists(state, troubleshootingTarget.invocationId)
    ? troubleshootingTarget.invocationId
    : null;
  const troubleshootingReportMissing = serverExplanation?.resultLocation?.type === "troubleshooting_report"
    && Boolean(serverExplanation.resultLocation.reportId)
    && !troubleshootingTarget;
  const troubleshootingInvocationMissing = Boolean(troubleshootingTarget?.invocationId && !troubleshootingInvocationTargetId);
  const sourceInvocationId = serverExplanation?.source?.type === "troubleshooting"
    ? serverExplanation.source.targetInvocationId ?? null
    : serverExplanation?.source?.type === "recovery_result"
      ? serverExplanation.source.invocationId ?? null
      : serverExplanation?.recovery?.sourceInvocationId ?? null;
  const sourceInvocationTargetId = sourceInvocationId && invocationExists(state, sourceInvocationId)
    ? sourceInvocationId
    : null;
  const sourceInvocationMissing = Boolean(sourceInvocationId && !sourceInvocationTargetId);

  function copyInvocationLink() {
    void navigator.clipboard?.writeText(invocationDeepLink(invocation.id));
    setCopiedLink(true);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("invocations.operatorExplanation")}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="icon"
              variant="secondary"
              title={t("invocations.copyLink")}
              aria-label={t("invocations.copyLink")}
              onClick={copyInvocationLink}
            >
              <Clipboard />
            </Button>
            {copiedLink ? <span className="text-xs text-success">{t("invocations.copied")}</span> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(invocation.status)}>{invocationStatus(t, invocation.status)}</Badge>
          {sourceLabel ? <Badge tone="neutral">{sourceLabel}</Badge> : null}
          {recoveryCategory ? <Badge tone={recoveryTone(recoveryCategory)}>{readableRecoveryCategory(recoveryCategory)}</Badge> : null}
          {recoveryState ? <Badge tone={recoveryExplanationTone(recoveryState)}>{readableRecoveryExplanationState(recoveryState)}</Badge> : null}
          {reasonCode ? <Badge tone={recoveryExplanationReasonTone(reasonCode)}>{readableRecoveryExplanationReason(reasonCode)}</Badge> : null}
          {recovery?.humanApprovalRequired || approvalRequestId || serverExplanation?.approval ? <Badge tone="warning">{t("invocations.approval")}</Badge> : null}
        </div>
        <p className="[overflow-wrap:anywhere] text-sm text-muted-foreground">{summary}</p>
        {nextStep ? (
          <p className="[overflow-wrap:anywhere] rounded-md bg-muted px-3 py-2 text-sm">
            <span className="font-medium">{t("invocations.nextStep")}: </span>
            <span className="text-muted-foreground">{nextStep}</span>
          </p>
        ) : null}
        <FactList
          facts={[
            { term: "Why blocked", value: serverExplanation?.reason ?? recoveryBlockedReason(invocation, reasonCode) },
            {
              term: "Waiting on",
              value: approvalRequestId && approvalTargetInvocationId ? (
                <ActionValue
                  value={waitingOnLabel(serverExplanation) ?? recoveryWaitingOn({ approvalRequestId, approval, latestRecoveryAction })}
                  actionLabel="Open approval"
                  onAction={() => onViewApproval(approvalTargetInvocationId)}
                />
              ) : approvalTargetMissing ? (
                <UnavailableTargetValue
                  value={waitingOnLabel(serverExplanation) ?? recoveryWaitingOn({ approvalRequestId, approval, latestRecoveryAction })}
                  reason="Approval target is not loaded."
                />
              ) : waitingOnLabel(serverExplanation) ?? recoveryWaitingOn({ approvalRequestId, approval, latestRecoveryAction }),
            },
            {
              term: "Result",
              value: resultInvocationTargetId ? (
                <ActionValue value={resultLabel} actionLabel="View result" onAction={() => onViewInvocation(resultInvocationTargetId)} />
              ) : resultInvocationMissing ? (
                <UnavailableTargetValue value={resultLabel} reason="Result invocation is not loaded." />
              ) : troubleshootingInvocationTargetId ? (
                <ActionValue
                  value={resultLabel}
                  actionLabel="Open report"
                  onAction={() => onViewInvocation(troubleshootingInvocationTargetId)}
                />
              ) : troubleshootingReportMissing ? (
                <UnavailableTargetValue value={resultLabel} reason="Troubleshooting report is not loaded." />
              ) : troubleshootingInvocationMissing ? (
                <UnavailableTargetValue value={resultLabel} reason="Troubleshooting invocation is not loaded." />
              ) : recoveryTimelineTarget && serverExplanation?.resultLocation?.type === "orchestration" ? (
                <ActionValue
                  value={resultLabel}
                  actionLabel="Open application"
                  onAction={() => onViewApplicationRun(
                    recoveryTimelineTarget.applicationId,
                    recoveryTimelineTarget.routineId,
                    recoveryTimelineTarget.invocationId,
                  )}
                />
              ) : resultLabel,
            },
            {
              term: "Recovery action",
              value: recoveryTimelineTarget ? (
                <ActionValue
                  value={recoveryActionValue}
                  actionLabel="Open timeline"
                  onAction={() => onViewApplicationRun(
                    recoveryTimelineTarget.applicationId,
                    recoveryTimelineTarget.routineId,
                    recoveryTimelineTarget.invocationId,
                  )}
                />
              ) : recoveryActionValue,
            },
            {
              term: "Source",
              value: sourceInvocationTargetId ? (
                <ActionValue
                  value={sourceLabel ?? sourceInvocationId}
                  actionLabel="View source"
                  onAction={() => onViewInvocation(sourceInvocationTargetId)}
                />
              ) : sourceInvocationMissing ? (
                <UnavailableTargetValue
                  value={sourceLabel ?? sourceInvocationId}
                  reason="Source invocation is not loaded."
                />
              ) : sourceLabel ?? "Direct invocation",
            },
          ]}
        />
        {error ? <p className="text-xs text-destructive">{t("invocations.recoveryLoadFailed")}</p> : null}
        {isLoading ? <p className="text-xs text-muted-foreground">{t("invocations.recoveryLoading")}</p> : null}
        {troubleshootingTarget?.webLinks ? (
          <WebNavigationLinkActions
            title="Troubleshooting report links"
            links={[
              troubleshootingTarget.webLinks.failedInvocation,
              troubleshootingTarget.webLinks.troubleshooterInvocation,
              troubleshootingTarget.webLinks.applicationRun,
            ]}
            onOpen={onViewWebNavigationLink}
            className="rounded-md border border-border bg-muted p-2"
          />
        ) : null}
        {recovery?.actions.length ? (
          <div className="space-y-1 rounded-md border border-border bg-muted p-2">
            <p className="text-xs font-medium">{t("invocations.recommendedRecovery")}</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {recovery.actions.slice(0, 3).map((action) => (
                <li key={`${action.type}:${action.label}`} className="[overflow-wrap:anywhere]">
                  <span className="font-medium text-foreground">{action.label}</span>
                  {action.description ? `: ${action.description}` : ""}
                  {action.availability?.blockedReason ? ` (${readableRecoveryActionAvailabilityReason(action.availability.blockedReason)})` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function invocationExists(state: ConsoleSnapshot | null, invocationId: string): boolean {
  return (state?.invocations ?? []).some((item) => item.id === invocationId);
}

function ActionValue({
  value,
  actionLabel,
  onAction,
}: {
  value: ReactNode;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 [overflow-wrap:anywhere]">{value}</span>
      <Button size="sm" variant="secondary" onClick={onAction}>
        <ExternalLink />
        {actionLabel}
      </Button>
    </span>
  );
}

function UnavailableTargetValue({
  value,
  reason,
}: {
  value: ReactNode;
  reason: string;
}) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 [overflow-wrap:anywhere]">{value}</span>
      <span className="rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground">{reason}</span>
    </span>
  );
}

function sourceBadgeLabel(explanation: InvocationExplanation | null): string | null {
  const type = explanation?.source?.type;
  if (type === "application_orchestration") return "Application orchestration";
  if (type === "automation") return explanation?.source?.scheduled ? "Scheduled automation" : "Automation";
  if (type === "auto_run") return "Auto-run";
  if (type === "compare_run") return "Compare run";
  if (type === "troubleshooting") return "Troubleshooting";
  if (type === "recovery_result") return "Recovery result";
  if (type === "tool") return "Tool";
  if (type === "channel") return "Channel";
  return null;
}

function waitingOnLabel(explanation: InvocationExplanation | null): string | null {
  const waitingOn = explanation?.waitingOn;
  if (!waitingOn) return null;
  if (waitingOn.label) return waitingOn.label;
  if (waitingOn.id && waitingOn.status) return `${waitingOn.id} (${waitingOn.status})`;
  return waitingOn.id ?? waitingOn.type ?? null;
}

function resultLocationLabel(explanation: InvocationExplanation | null): string | null {
  const result = explanation?.resultLocation;
  if (!result) return null;
  return result.label ?? result.invocationId ?? result.reportId ?? result.relativePath ?? result.orchestrationId ?? null;
}

function serverRecoveryActionLabel(explanation: InvocationExplanation | null): string {
  const recovery = explanation?.recovery;
  if (!recovery?.actionType) return "Not requested";
  const status = recovery.status ? ` · ${readableRecoveryActionStatus(recovery.status, "inline")}` : "";
  return `${readableRecoveryActionType(recovery.actionType)}${status}`;
}

function recoveryRequestForExplanation(
  state: ConsoleSnapshot | null,
  explanation: InvocationExplanation | null,
  fallback: ApplicationRecoveryActionRequest | null,
): ApplicationRecoveryActionRequest | null {
  const requestId = explanation?.recovery?.actionRequestId
    ?? explanation?.source?.recoveryActionRequestId
    ?? fallback?.id
    ?? null;
  if (!requestId) return fallback;
  return (state?.applicationRecoveryActions ?? []).find((request) => request.id === requestId) ?? fallback;
}
