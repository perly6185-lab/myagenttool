import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/common/empty-state";
import { webNavigationStateFromLink } from "@/app/deep-links";
import { EventTimeline } from "@/features/invocations/event-timeline";
import { RunTranscriptSection, isTerminalRunStatus } from "@/features/invocations/run-transcript";
import { DecisionAction } from "@/features/invocations/decision-action";
import { ImportedUsageTable } from "@/features/economics/imported-usage-table";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore, type InvocationStatusFilter } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import { formatDuration, formatTokens } from "@/lib/format";
import { formatUsd } from "@/lib/money";
import { statusTone } from "@/lib/readable-labels";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { delivery, invocationStatus } from "@/lib/i18n/readable-labels";
import { searchTraces } from "@/features/invocations/trace-api";
import type { ConsoleSnapshot, InvocationSnapshot, WebNavigationLink } from "@/lib/console-state";
import { InvocationOperatorExplanation as OperatorExplanationCard } from "./invocation-operator-explanation";

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

const ACTIVE_INVOCATION_STATUSES = new Set(["queued", "dispatching", "waiting_for_local_approval", "running", "cancelling"]);
const FAILED_INVOCATION_STATUSES = new Set(["failed", "timed_out", "rejected"]);

export function matchesInvocationStatusFilter(invocation: InvocationSnapshot, filter: InvocationStatusFilter): boolean {
  if (filter === "active") return ACTIVE_INVOCATION_STATUSES.has(invocation.status ?? "");
  if (filter === "completed") return invocation.status === "succeeded";
  if (filter === "failed") return FAILED_INVOCATION_STATUSES.has(invocation.status ?? "");
  return true;
}

export function InvocationsView() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const selectedInvocationId = useUiStore((s) => s.selectedInvocationId);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);
  const setSelectedApplicationId = useUiStore((s) => s.setSelectedApplicationId);
  const setSelectedApplicationRun = useUiStore((s) => s.setSelectedApplicationRun);
  const invocationStatusFilter = useUiStore((s) => s.invocationStatusFilter);
  const setInvocationStatusFilter = useUiStore((s) => s.setInvocationStatusFilter);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  const setSelectedWorktreeId = useUiStore((s) => s.setSelectedWorktreeId);
  const setSelectedAgentId = useUiStore((s) => s.setSelectedAgentId);
  const setResumeFromInvocationId = useUiStore((s) => s.setResumeFromInvocationId);
  const setComposerDraftTask = useUiStore((s) => s.setComposerDraftTask);

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
  const searchedInvocations = normalizedTraceQuery
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
  const invocations = searchedInvocations.filter((invocation) => matchesInvocationStatusFilter(invocation, invocationStatusFilter));
  const traceRecordById = new Map((traceSearch.data?.records ?? []).map((record) => [record.invocationId, record]));
  const selected = invocations.find((invocation) => invocation.id === selectedInvocationId) ?? invocations[0] ?? null;
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
    setSection("approvals");
  }

  function reuseTask(invocation: InvocationSnapshot) {
    if (!invocation.input?.task) return;
    if (invocation.projectId) setSelectedProjectId(invocation.projectId);
    setSelectedWorktreeId(invocation.worktreeId ?? null);
    if (invocation.agentId) setSelectedAgentId(invocation.agentId);
    setResumeFromInvocationId(null);
    setComposerDraftTask(invocation.input.task);
    setSelectedInvocationId(invocation.id);
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
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <Input
                type="search"
                value={traceQuery}
                onChange={(event) => setTraceQuery(event.target.value)}
                aria-label={t("traceSearch.label")}
                placeholder={t("traceSearch.placeholder")}
              />
              <Select
                value={invocationStatusFilter}
                onChange={(event) => setInvocationStatusFilter(event.target.value as InvocationStatusFilter)}
                aria-label={t("runRecords.filterLabel")}
              >
                <option value="all">{t("runRecords.filters.all")}</option>
                <option value="active">{t("runRecords.filters.active")}</option>
                <option value="completed">{t("runRecords.filters.completed")}</option>
                <option value="failed">{t("runRecords.filters.failed")}</option>
              </Select>
            </div>
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
          onReuseTask={FAILED_INVOCATION_STATUSES.has(selected.status ?? "") ? () => reuseTask(selected) : undefined}
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
