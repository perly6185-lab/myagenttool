import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clipboard, ExternalLink, Play, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { FactList } from "@/components/common/fact-list";
import { ConfirmModal } from "@/components/common/confirm-modal";
import { applicationRunDeepLink } from "@/app/deep-links";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { sourceSummary } from "@/features/applications/applications-view";
import {
  autoRecoveryConfirmCopy,
  autoRecoveryMaxAttempts,
  healthProbeConfirmCopy,
  healthProbeIntervalMinutes,
  routineOverrideBody,
  routineOverrideValue,
} from "@/features/applications/application-ops-ui";
import { Field } from "@/components/common/field";
import {
  applicationExecutionDigest,
  applicationInvocations,
  digestTone,
  durableStatsWindow,
  executionKind,
  formatResultOutput,
} from "@/features/applications/application-executions";
import { ImportedUsageTable } from "@/features/economics/imported-usage-table";
import { Transcript } from "@/features/invocations/transcript";
import {
  isExecutableRecoveryAction,
  latestRecoveryActionRequest,
  readableRecoveryActionAvailabilityReason,
  readableRecoveryActionRequestStatus,
  readableRecoveryActionType,
  readableRecoveryAgentReason,
  readableRecoveryCategory,
  readableRecoveryExplanationReason,
  readableRecoveryExplanationState,
  readableRecoveryOutcome,
  readableRecoveryOutcomeReason,
  readableRecoveryTimelineStatus,
  recoveryActionRequestTone,
  recoveryAgentChoiceLabel,
  recoveryExplanationReasonTone,
  recoveryExplanationTone,
  recoveryOutcomeSeverityTone,
  recoveryOutcomeTone,
  recoveryResultOrchestrationLabel,
  recoveryTimelineTone,
  recoveryTone,
  sortedRecoveryActionRequests,
} from "@/features/recovery/application-recovery-ui";
import { readableStatus, statusTone } from "@/lib/readable-labels";
import type {
  ApplicationOrchestration,
  ApplicationOrchestrationRecoveryAction,
  ApplicationOrchestrationRecoveryAgentCandidate,
  ApplicationRecoveryExplanation,
  ApplicationRecoveryActionRequest,
  ApplicationRecoveryTimelineEntry,
  ApplicationOrchestrationRun,
  ApplicationSnapshot,
  ApplicationResultRef,
  InvocationSnapshot,
} from "@/lib/console-state";

// Governed side-effecting actions run on issued approval grants
// (docs/design/APPROVAL_GRANTS.md): the confirm-modal click mints a single-use,
// action-scoped grant and the call consumes it — a recorded decision, not the
// old hard-coded intent marker.
async function withApprovalGrant<T>(action: string, targetId: string, run: (token: string) => Promise<T>): Promise<T> {
  const grant = await api.issueApprovalGrant(action, targetId);
  return run(grant.token);
}

function riskTone(risk?: string): "neutral" | "warning" | "danger" {
  if (risk === "high" || risk === "critical") return "danger";
  if (risk === "medium") return "warning";
  return "neutral";
}

function readinessTone(state?: string): "neutral" | "success" | "warning" | "danger" {
  if (state === "ready") return "success";
  if (state === "needs_setup") return "warning";
  if (state === "disabled") return "danger";
  return "neutral";
}

interface PendingConfirm {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
  run: () => Promise<unknown>;
}

function ApplicationActions({ application }: { application: ApplicationSnapshot }) {
  const { execute, pending, error } = useAsyncAction();
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const status = application.status;

  const lifecycle = (action: "probe" | "online" | "offline" | "archive" | "refresh") =>
    withApprovalGrant(action, application.id, (token) =>
      api.applicationLifecycle(application.id, action, { approvalToken: token }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lifecycle</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => void execute(() => api.applicationLifecycle(application.id, "probe"))}>
            Probe
          </Button>
          {status !== "active" && status !== "archived" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirm({
              title: `Bring "${application.name}" online?`,
              description: "Re-enables the application's execution-like capabilities.",
              confirmLabel: "Bring online",
              destructive: false,
              run: () => lifecycle("online"),
            })}>
              Bring online
            </Button>
          ) : null}
          {status === "active" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirm({
              title: `Take "${application.name}" offline?`,
              description: "Disables its execution-like capabilities until brought back online.",
              confirmLabel: "Take offline",
              destructive: true,
              run: () => lifecycle("offline"),
            })}>
              Take offline
            </Button>
          ) : null}
          {status !== "archived" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirm({
              title: `Archive "${application.name}"?`,
              description: "Archived applications can no longer be invoked.",
              confirmLabel: "Archive",
              destructive: true,
              run: () => lifecycle("archive"),
            })}>
              Archive
            </Button>
          ) : null}
          {status === "active" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirm({
              title: `Refresh "${application.name}"?`,
              description: "Re-records the application source state.",
              confirmLabel: "Refresh",
              destructive: false,
              run: () => lifecycle("refresh"),
            })}>
              Refresh
            </Button>
          ) : null}
          {status !== "archived" && status !== "offline" ? (
            <Button size="sm" disabled={pending} onClick={() => setConfirm({
              title: `Generate orchestration for "${application.name}"?`,
              description: "Writes a governed LoopRoutine draft into the managed application directory.",
              confirmLabel: "Generate",
              destructive: false,
              run: () => withApprovalGrant("generate_orchestration", application.id, (token) => api.generateApplicationOrchestration(application.id, { approvalToken: token })),
            })}>
              Generate orchestration
            </Button>
          ) : null}
          {status !== "archived" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => {
              const next = { enabled: !application.autoRecovery?.enabled };
              setConfirm({
                ...autoRecoveryConfirmCopy(application, next),
                run: () => withApprovalGrant("auto-recovery-config", application.id, (token) => api.setApplicationAutoRecovery(application.id, { ...next, approvalToken: token })),
              });
            }}>
              {application.autoRecovery?.enabled ? "Disable auto-recovery" : "Enable auto-recovery"}
            </Button>
          ) : null}
          {status !== "archived" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => {
              const next = { enabled: !application.healthProbe?.enabled };
              setConfirm({
                ...healthProbeConfirmCopy(application, next),
                run: () => withApprovalGrant("health-probe-config", application.id, (token) => api.setApplicationHealthProbe(application.id, { ...next, approvalToken: token })),
              });
            }}>
              {application.healthProbe?.enabled ? "Disable health probe" : "Enable health probe"}
            </Button>
          ) : null}
          {application.autoRecovery?.enabled ? <Badge tone="warning">auto-recovery on · max {autoRecoveryMaxAttempts(application)}</Badge> : null}
          {application.healthProbe?.enabled ? <Badge tone="warning">health probe on · every {healthProbeIntervalMinutes(application)}m</Badge> : null}
        </div>
        {application.autoRecovery?.enabled || application.healthProbe?.enabled ? (
          <div className="flex flex-wrap items-end gap-3">
            {application.autoRecovery?.enabled ? (
              <Field label="Max auto-recovery attempts" className="w-52">
                <Select
                  value={String(autoRecoveryMaxAttempts(application))}
                  disabled={pending}
                  onChange={(e) => {
                    const next = { enabled: true, maxAttempts: Number(e.target.value) };
                    setConfirm({
                      ...autoRecoveryConfirmCopy(application, next),
                      run: () => withApprovalGrant("auto-recovery-config", application.id, (token) => api.setApplicationAutoRecovery(application.id, { ...next, approvalToken: token })),
                    });
                  }}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {application.healthProbe?.enabled ? (
              <Field label="Health probe interval" className="w-52">
                <Select
                  value={String(healthProbeIntervalMinutes(application))}
                  disabled={pending}
                  onChange={(e) => {
                    const next = { enabled: true, intervalMinutes: Number(e.target.value) };
                    setConfirm({
                      ...healthProbeConfirmCopy(application, next),
                      run: () => withApprovalGrant("health-probe-config", application.id, (token) => api.setApplicationHealthProbe(application.id, { ...next, approvalToken: token })),
                    });
                  }}
                >
                  {[1, 5, 15, 30, 60].map((n) => (
                    <option key={n} value={n}>{n} min</option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
        ) : null}
        {application.health ? (
          <p className="text-xs text-muted-foreground">
            Health:{" "}
            <Badge tone={application.health.status === "healthy" ? "success" : application.health.status === "unhealthy" ? "danger" : "neutral"}>
              {application.health.status}
            </Badge>
            {application.health.reason ? <span> · {application.health.reason}</span> : null}
          </p>
        ) : null}
        {error && !confirm ? <p className="text-xs text-destructive">{error}</p> : null}
        <ConfirmModal
          open={Boolean(confirm)}
          title={confirm?.title ?? ""}
          description={confirm?.description}
          confirmLabel={confirm?.confirmLabel}
          destructive={confirm?.destructive}
          pending={pending}
          error={error}
          onConfirm={() => {
            if (!confirm) return;
            const run = confirm.run;
            void execute(run).then((ok) => {
              if (ok) setConfirm(null);
            });
          }}
          onClose={() => setConfirm(null)}
        />
      </CardContent>
    </Card>
  );
}

function ApplicationResultSummary({
  result,
  onViewInvocation,
  invocations,
}: {
  result?: ApplicationResultRef | null;
  onViewInvocation: (invocationId: string) => void;
  invocations: InvocationSnapshot[];
}) {
  const { data: state } = useConsoleState();
  if (!result) return null;
  const importedCount = result.importedRecordCount ?? result.importedRecordIds?.length ?? 0;
  const resultInvocation = invocations.find((invocation) => invocation.id === result.invocationId) ?? null;
  const importedRows = (state?.importedUsageEstimates ?? []).filter((row) => row.invocationId === result.invocationId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Latest result</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(result.status ?? "unknown")}>{readableStatus(result.status ?? "unknown")}</Badge>
          {result.outputCollection ? <Badge tone="neutral">{result.outputCollection}</Badge> : null}
          {importedCount > 0 ? <Badge tone="success">{importedCount} imported</Badge> : null}
        </div>
        <FactList
          facts={[
            { term: "Capability", value: result.capability ?? result.applicationAction ?? "—" },
            { term: "Invocation", value: result.invocationId ?? "—" },
            { term: "Completed", value: shortTime(result.completedAt) },
            {
              term: "Imported records",
              value: importedCount > 0 ? (result.importedRecordIds ?? []).join(", ") || String(importedCount) : "None",
            },
          ]}
        />
        {importedRows.length ? <ImportedUsageTable rows={importedRows} limit={10} /> : null}
        <ResultOutputBrowser output={resultInvocation?.result?.output} />
        {result.invocationId ? (
          <Button size="sm" variant="secondary" onClick={() => onViewInvocation(result.invocationId!)}>
            <ExternalLink />
            View invocation
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

// The bounded, in-place browser for what a run actually PRODUCED — the timeline
// only ever said "result recorded"; the payload lives here.
function ResultOutputBrowser({ output }: { output?: unknown }) {
  const formatted = formatResultOutput(output);
  if (!formatted) return null;
  return (
    <details className="rounded-md border border-border bg-muted/40 p-2">
      <summary className="cursor-pointer text-xs font-medium">
        Result output{formatted.truncated ? " (truncated)" : ""}
      </summary>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">{formatted.text}</pre>
    </details>
  );
}

// Every invocation this application produced — orchestration runs, wrapper
// commands, lifecycle/generate calls, recovery products — with an honest
// rollup over what is visible in the current snapshot window.
function ApplicationExecutions({
  application,
  invocations,
  onViewInvocation,
}: {
  application: ApplicationSnapshot;
  invocations: InvocationSnapshot[];
  onViewInvocation: (invocationId: string) => void;
}) {
  const { data: state } = useConsoleState();
  const [showAll, setShowAll] = useState(false);
  const rows = applicationInvocations(invocations, application.id);
  const dailyStats = state?.applicationDailyStats ?? [];
  const week = durableStatsWindow(dailyStats, application.id, 7);
  const month = durableStatsWindow(dailyStats, application.id, 30);
  if (!rows.length && !month.succeeded && !month.failed) return null;
  const digest = applicationExecutionDigest(rows);
  const visible = showAll ? rows : rows.slice(0, 8);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>Executions</CardTitle>
          <Badge tone={digestTone(digest)}>
            {digest.successRate == null ? "no finished runs" : `${Math.round(digest.successRate * 100)}% success`}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {digest.total} execution(s) in this window · {digest.succeeded} succeeded · {digest.failed} failed
          {digest.active ? ` · ${digest.active} active` : ""}
          {digest.recoveryRuns ? ` · ${digest.recoveryRuns} from recovery` : ""}
          {digest.lastAt ? ` · last ${shortTime(digest.lastAt)}` : ""}
        </p>
        {week.succeeded + week.failed + month.succeeded + month.failed > 0 ? (
          <p className="text-xs text-muted-foreground">
            Durable: 7d {week.succeeded} ✓ / {week.failed} ✗ · 30d {month.succeeded} ✓ / {month.failed} ✗
            {month.recovered ? ` · ${month.recovered} recovered (30d)` : ""}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {visible.map((invocation) => (
          <div key={invocation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-xs">
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(invocation.status ?? "unknown")}>{readableStatus(invocation.status ?? "unknown")}</Badge>
                <span className="font-medium">{executionKind(invocation)}</span>
                <span className="text-muted-foreground">{shortTime(invocation.createdAt)}</span>
              </div>
              {invocation.result?.summary ? (
                <p className="[overflow-wrap:anywhere] text-muted-foreground">{invocation.result.summary}</p>
              ) : null}
            </div>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onViewInvocation(invocation.id)}>
              <ExternalLink />
              Open
            </Button>
          </div>
        ))}
        {rows.length > 8 ? (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setShowAll((value) => !value)}>
            {showAll ? "Show fewer" : `Show all ${rows.length}`}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function latestRoutineInvocation(invocations: InvocationSnapshot[], applicationId: string, routineId: string) {
  return invocations.find((invocation) => {
    const metadata = invocation.options?.metadata;
    return metadata?.source === "application_orchestration"
      && metadata.applicationId === applicationId
      && metadata.routineId === routineId;
  }) ?? null;
}

function OrchestrationDrafts({
  application,
  invocations,
  orchestrations,
}: {
  application: ApplicationSnapshot;
  invocations: InvocationSnapshot[];
  orchestrations: ApplicationOrchestration[];
}) {
  const { execute, pending, error } = useAsyncAction();
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);
  const [createdInvocationByRoutineKey, setCreatedInvocationByRoutineKey] = useState<Record<string, string>>({});
  const [copiedRoutineId, setCopiedRoutineId] = useState<string | null>(null);
  const [pendingRoutineId, setPendingRoutineId] = useState<string | null>(null);

  function viewInvocation(invocationId: string) {
    setSelectedInvocationId(invocationId);
    setSection("invocations");
  }

  function copyRoutine(orchestration: ApplicationOrchestration) {
    const text = orchestration.relativePath
      ? `${orchestration.routineId} (${orchestration.relativePath})`
      : orchestration.routineId;
    void navigator.clipboard?.writeText(text);
    setCopiedRoutineId(orchestration.routineId);
  }

  async function runOrchestration(orchestration: ApplicationOrchestration) {
    setPendingRoutineId(orchestration.routineId);
    const routineKey = `${application.id}:${orchestration.routineId}`;
    const ok = await execute(async () => {
      const created = await api.runApplicationOrchestration(application.id, orchestration.routineId) as {
        invocationId?: string;
        invocation?: { id?: string };
      };
      const invocationId = created.invocationId ?? created.invocation?.id ?? null;
      if (invocationId) {
        setCreatedInvocationByRoutineKey((current) => ({
          ...current,
          [routineKey]: invocationId,
        }));
      }
      return created;
    });
    if (!ok) {
      setCreatedInvocationByRoutineKey((current) => {
        const next = { ...current };
        delete next[routineKey];
        return next;
      });
    }
    setPendingRoutineId(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orchestration drafts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {orchestrations.map((orchestration) => {
          const lastInvocation = latestRoutineInvocation(invocations, application.id, orchestration.routineId);
          const invocationId = createdInvocationByRoutineKey[`${application.id}:${orchestration.routineId}`]
            ?? lastInvocation?.id
            ?? null;
          const isPendingRoutine = pending && pendingRoutineId === orchestration.routineId;
          return (
            <div key={orchestration.routineId} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="[overflow-wrap:anywhere] font-mono text-xs">{orchestration.routineId}</p>
                  <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">
                    {orchestration.relativePath ?? orchestration.path ?? "Draft path not recorded"}
                  </p>
                </div>
                <Badge tone={orchestration.validation?.ok === false ? "danger" : "success"}>
                  {orchestration.validation?.ok === false ? "invalid" : orchestration.status ?? "draft"}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="icon"
                  variant="secondary"
                  title="Copy orchestration reference"
                  aria-label="Copy orchestration reference"
                  onClick={() => copyRoutine(orchestration)}
                >
                  <Clipboard />
                </Button>
                <Button
                  size="sm"
                  disabled={pending || orchestration.validation?.ok === false || application.status !== "active"}
                  onClick={() => void runOrchestration(orchestration)}
                >
                  <Play />
                  {isPendingRoutine ? "Starting..." : "Run"}
                </Button>
                {invocationId ? (
                  <Button size="sm" variant="secondary" onClick={() => viewInvocation(invocationId)}>
                    <ExternalLink />
                    View invocation
                  </Button>
                ) : null}
                {copiedRoutineId === orchestration.routineId ? (
                  <span className="text-xs text-success">Copied.</span>
                ) : null}
                {application.autoRecovery ? (
                  <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                    Auto-recovery
                    <Select
                      className="h-7 w-28 text-xs"
                      value={routineOverrideValue(application, orchestration.routineId)}
                      disabled={pending}
                      onChange={(e) => {
                        const parsed = routineOverrideBody(e.target.value);
                        void execute(() => withApprovalGrant("auto-recovery-config", application.id, (token) =>
                          api.setApplicationAutoRecovery(application.id, parsed
                            ? { ...parsed, routineId: orchestration.routineId, approvalToken: token }
                            : { routineId: orchestration.routineId, clearOverride: true, approvalToken: token }),
                        ));
                      }}
                    >
                      <option value="default">App default</option>
                      <option value="off">Off</option>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>On · cap {n}</option>
                      ))}
                    </Select>
                  </label>
                ) : null}
              </div>
              <OrchestrationRunHistory application={application} orchestration={orchestration} onView={viewInvocation} />
            </div>
          );
        })}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {application.status !== "active" ? (
          <p className="text-xs text-muted-foreground">Bring the application online before running a draft.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OrchestrationRunHistory({
  application,
  orchestration,
  onView,
}: {
  application: ApplicationSnapshot;
  orchestration: ApplicationOrchestration;
  onView: (invocationId: string) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["application-orchestration-runs", application.id, orchestration.routineId],
    queryFn: () => api.listApplicationOrchestrationRuns(application.id, orchestration.routineId, 3),
    enabled: Boolean(application.id && orchestration.routineId),
    refetchInterval: 2000,
  });
  const selectedApplicationRun = useUiStore((s) => s.selectedApplicationRun);
  const [expandedInvocationId, setExpandedInvocationId] = useState<string | null>(null);
  const runs = data?.runs ?? [];

  useEffect(() => {
    if (
      selectedApplicationRun?.applicationId === application.id
      && selectedApplicationRun.routineId === orchestration.routineId
    ) {
      setExpandedInvocationId(selectedApplicationRun.invocationId);
    }
  }, [application.id, orchestration.routineId, selectedApplicationRun]);

  if (error) {
    return <p className="text-xs text-destructive">Could not load run history.</p>;
  }
  if (!runs.length) {
    return (
      <p className="text-xs text-muted-foreground">
        {isLoading ? "Loading runs..." : "No runs recorded yet."}
      </p>
    );
  }

  return (
    <div className="space-y-1.5 border-t border-border pt-2">
      {runs.map((run) => (
        <OrchestrationRunRow
          key={run.invocationId}
          application={application}
          orchestration={orchestration}
          run={run}
          expanded={expandedInvocationId === run.invocationId}
          onToggleInspect={() => setExpandedInvocationId((current) => current === run.invocationId ? null : run.invocationId)}
          onView={onView}
        />
      ))}
    </div>
  );
}

function OrchestrationRunRow({
  application,
  orchestration,
  run,
  expanded,
  onToggleInspect,
  onView,
}: {
  application: ApplicationSnapshot;
  orchestration: ApplicationOrchestration;
  run: ApplicationOrchestrationRun;
  expanded: boolean;
  onToggleInspect: () => void;
  onView: (invocationId: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border p-2 text-xs">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(run.status)}>{readableStatus(run.status)}</Badge>
            <span className="font-mono text-muted-foreground">{run.invocationId}</span>
            <span className="text-muted-foreground">{shortTime(run.createdAt)}</span>
            {run.agentId ? <span className="text-muted-foreground">{run.agentId}</span> : null}
            {run.metadata?.retryOfInvocationId ? (
              <span className="text-muted-foreground">
                Retry of <span className="font-mono">{run.metadata.retryOfInvocationId}</span>
              </span>
            ) : null}
          </div>
          {run.resultSummary || run.errorSummary ? (
            <p className="[overflow-wrap:anywhere] text-muted-foreground">
              {run.resultSummary ?? run.errorSummary}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onToggleInspect}>
            <Search />
            {expanded ? "Hide" : "Inspect"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onView(run.invocationId)}>
            <ExternalLink />
            View
          </Button>
        </div>
      </div>
      {expanded ? (
        <OrchestrationRunDiagnostics
          applicationId={application.id}
          routineId={orchestration.routineId}
          invocationId={run.invocationId}
          canRetry={application.status === "active"}
        />
      ) : null}
    </div>
  );
}

function OrchestrationRunDiagnostics({
  applicationId,
  routineId,
  invocationId,
  canRetry,
}: {
  applicationId: string;
  routineId: string;
  invocationId: string;
  canRetry: boolean;
}) {
  const { execute, pending, error: retryError } = useAsyncAction();
  const [copiedRunLink, setCopiedRunLink] = useState(false);
  const { data: state } = useConsoleState();
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);
  const { data, isLoading, error } = useQuery({
    queryKey: ["application-orchestration-run", applicationId, routineId, invocationId],
    queryFn: () => api.getApplicationOrchestrationRun(applicationId, routineId, invocationId),
    enabled: Boolean(applicationId && routineId && invocationId),
    refetchInterval: 2000,
  });
  const { data: eventData, isLoading: eventsLoading, error: eventsError } = useQuery({
    queryKey: ["application-orchestration-run-events", applicationId, routineId, invocationId],
    queryFn: () => api.listApplicationOrchestrationRunEvents(applicationId, routineId, invocationId),
    enabled: Boolean(applicationId && routineId && invocationId),
    refetchInterval: 2000,
  });
  const { data: recoveryData, isLoading: recoveryLoading, error: recoveryError } = useQuery({
    queryKey: ["application-orchestration-run-recovery", applicationId, routineId, invocationId],
    queryFn: () => api.getApplicationOrchestrationRunRecovery(applicationId, routineId, invocationId),
    enabled: Boolean(applicationId && routineId && invocationId),
    refetchInterval: 2000,
  });
  const run = data?.run;
  const events = eventData?.events ?? [];
  const recovery = recoveryData?.recovery;
  const hasSelectAgentAction = recovery?.actions.some((action) => action.type === "select_agent") ?? false;
  const { data: recoveryAgentData, isLoading: recoveryAgentsLoading, error: recoveryAgentsError } = useQuery({
    queryKey: ["application-orchestration-recovery-agent-candidates", applicationId, routineId, invocationId],
    queryFn: () => api.listApplicationOrchestrationRecoveryAgentCandidates(applicationId, routineId, invocationId),
    enabled: Boolean(applicationId && routineId && invocationId && hasSelectAgentAction),
    refetchInterval: 2000,
  });
  const recoveryActionRequests = (state?.applicationRecoveryActions ?? [])
    .filter((request) => request.applicationId === applicationId
      && request.routineId === routineId
      && request.invocationId === invocationId);

  function retryRun() {
    void execute(() => api.requestApplicationOrchestrationRecoveryAction(applicationId, routineId, invocationId, {
      actionType: "rerun",
      reason: run?.errorSummary ?? "Manual retry from application orchestration diagnostics.",
    }));
  }

  function requestRecoveryAction(actionType: string, reason?: string | null, agentId?: string | null) {
    void execute(() => api.requestApplicationOrchestrationRecoveryAction(applicationId, routineId, invocationId, {
      actionType,
      reason,
      agentId,
    }));
  }

  function viewInvocation(targetInvocationId: string) {
    setSelectedInvocationId(targetInvocationId);
    setSection("invocations");
  }

  function copyRunLink() {
    void navigator.clipboard?.writeText(applicationRunDeepLink({ applicationId, routineId, invocationId }));
    setCopiedRunLink(true);
  }

  if (error) {
    return <p className="rounded-md bg-destructive/10 p-2 text-destructive">Could not load run diagnostics.</p>;
  }
  if (isLoading || !run) {
    return <p className="rounded-md bg-muted p-2 text-muted-foreground">Loading diagnostics...</p>;
  }

  const retryOfInvocationId = stringValue(run.metadata?.retryOfInvocationId);
  const runInvocation = (state?.invocations ?? []).find((item) => item.id === invocationId) ?? null;
  return (
    <div className="space-y-2 rounded-md bg-muted p-2">
      <ResultOutputBrowser output={runInvocation?.result?.output} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium">Run diagnostics</p>
          {retryOfInvocationId ? (
            <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">
              Retry of <span className="font-mono">{retryOfInvocationId}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="icon"
            variant="secondary"
            title="Copy run link"
            aria-label="Copy run link"
            onClick={copyRunLink}
          >
            <Clipboard />
          </Button>
          <Button size="sm" variant="secondary" disabled={!canRetry || pending} onClick={retryRun}>
            <Play />
            {pending ? "Retrying..." : "Re-run"}
          </Button>
          {copiedRunLink ? <span className="text-xs text-success">Copied.</span> : null}
        </div>
      </div>
      {retryError ? <p className="text-xs text-destructive">{retryError}</p> : null}
      <FactList
        facts={[
          { term: "Status", value: readableStatus(run.status) },
          { term: "Agent", value: run.agentId ?? "Unassigned" },
          { term: "Delivery", value: run.delivery?.state ?? run.deliveryState ?? "Not recorded" },
          { term: "Dispatch attempts", value: formatValue(run.delivery?.dispatchAttempts) },
          { term: "Cancellation", value: run.cancellation?.state ?? run.cancellationState ?? "None" },
          { term: "Trace", value: run.traceId ?? "Not recorded" },
          { term: "Policy", value: run.audit?.permissionDecision ?? run.policyDecisionId ?? "Not recorded" },
          { term: "Cost", value: run.audit?.costSummary ?? "Not recorded" },
        ]}
      />
      {run.result?.summary || run.errorSummary ? (
        <div className="space-y-1">
          {run.result?.summary ? <p className="[overflow-wrap:anywhere] text-muted-foreground">{run.result.summary}</p> : null}
          {run.errorSummary ? <p className="[overflow-wrap:anywhere] text-destructive">{run.errorSummary}</p> : null}
        </div>
      ) : null}
      <div className="rounded-md border border-border bg-background p-2">
        <p className="mb-2 text-xs font-medium">Timeline</p>
        {eventsError ? (
          <p className="text-xs text-destructive">Could not load run timeline.</p>
        ) : eventsLoading ? (
          <p className="text-xs text-muted-foreground">Loading timeline...</p>
        ) : (
          <Transcript events={events} />
        )}
      </div>
      <div className="rounded-md border border-border bg-background p-2">
        <p className="mb-2 text-xs font-medium">Recovery</p>
        {recoveryError ? (
          <p className="text-xs text-destructive">Could not load recovery suggestions.</p>
        ) : recoveryLoading || !recovery ? (
          <p className="text-xs text-muted-foreground">Loading recovery...</p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={recoveryTone(recovery.category)}>{readableRecoveryCategory(recovery.category)}</Badge>
              <span className="text-muted-foreground">{Math.round(recovery.confidence * 100)}% confidence</span>
              {recovery.retryRecommended ? <Badge tone="running">Retry recommended</Badge> : null}
              {recovery.humanApprovalRequired ? <Badge tone="warning">Approval required</Badge> : null}
            </div>
            <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">{recovery.summary}</p>
            <RecoveryTimeline requests={recoveryActionRequests} onViewInvocation={viewInvocation} />
            {recovery.actions.length ? (
              <ul className="space-y-1">
                {recovery.actions.map((action) => {
                  const latestRequest = latestRecoveryActionRequest(recoveryActionRequests, action.type);
                  return (
                    <RecoveryActionItem
                      key={`${action.type}:${action.label}`}
                      action={action}
                      canRetry={canRetry}
                      pending={pending}
                      latestRequest={latestRequest}
                      agentCandidates={recoveryAgentData?.candidates ?? []}
                      agentsLoading={recoveryAgentsLoading}
                      agentsError={Boolean(recoveryAgentsError)}
                      onRequest={requestRecoveryAction}
                    />
                  );
                })}
              </ul>
            ) : null}
          </div>
        )}
      </div>
      <DiagnosticsBlock title="Metadata" value={run.metadata} />
      <DiagnosticsBlock title="Result" value={run.result} />
      <DiagnosticsBlock title="Delivery" value={run.delivery} />
    </div>
  );
}

function RecoveryTimeline({
  requests,
  onViewInvocation,
}: {
  requests: ApplicationRecoveryActionRequest[];
  onViewInvocation: (invocationId: string) => void;
}) {
  const sortedRequests = sortedRecoveryActionRequests(requests);
  if (sortedRequests.length === 0) return null;
  return (
    <div className="space-y-2 rounded border border-border bg-muted p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium">Recovery history</p>
        <span className="text-xs text-muted-foreground">{sortedRequests.length} action{sortedRequests.length === 1 ? "" : "s"}</span>
      </div>
      <div className="space-y-2">
        {sortedRequests.map((request, index) => (
          <RecoveryLineage
            key={request.id}
            request={request}
            open={index === 0}
            label={index === 0 ? "Latest recovery" : "Recovery action"}
            onViewInvocation={onViewInvocation}
          />
        ))}
      </div>
    </div>
  );
}

function RecoveryLineage({
  request,
  open,
  label,
  onViewInvocation,
}: {
  request: ApplicationRecoveryActionRequest;
  open: boolean;
  label: string;
  onViewInvocation: (invocationId: string) => void;
}) {
  const outcome = request.outcome;
  const explanation = request.explanation ?? null;
  const resultInvocationId = request.resultInvocation?.id ?? request.resultInvocationId ?? null;
  return (
    <details className="rounded border border-border bg-background p-2" open={open}>
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">{label}</span>
            <Badge tone="neutral">{readableRecoveryActionType(request.actionType)}</Badge>
            <Badge tone={recoveryActionRequestTone(request.status)}>{readableRecoveryActionRequestStatus(request.status)}</Badge>
            {request.requestedBy === "system_auto_recovery" ? <Badge tone="warning">auto</Badge> : null}
            {outcome ? <Badge tone={recoveryOutcomeTone(outcome.state)}>{readableRecoveryOutcome(outcome.state)}</Badge> : null}
            {outcome?.reason ? <Badge tone={recoveryOutcomeSeverityTone(outcome.severity)}>{readableRecoveryOutcomeReason(outcome.reason)}</Badge> : null}
            {explanation?.state ? <Badge tone={recoveryExplanationTone(explanation.state)}>{readableRecoveryExplanationState(explanation.state)}</Badge> : null}
          </div>
          <span className="text-xs text-muted-foreground">{shortTime(request.updatedAt ?? request.createdAt)}</span>
        </div>
      </summary>
      <div className="mt-2 space-y-2">
        <RecoveryExplanationPanel
          explanation={explanation}
          outcome={outcome}
          fallbackResultInvocationId={resultInvocationId}
          onViewInvocation={onViewInvocation}
        />
        <FactList
          facts={[
            { term: "Source", value: request.sourceInvocation?.id ?? request.invocationId },
            { term: "Result", value: resultInvocationId ?? "Not linked" },
            { term: "Result status", value: request.resultInvocation?.status ?? "Not recorded" },
            { term: "Requested agent", value: request.requestedAgentId ?? "Automatic" },
            { term: "Selected agent", value: request.selectedAgentId ?? "Not changed" },
            { term: "Outcome reason", value: outcome?.reason ? readableRecoveryOutcomeReason(outcome.reason) : "Not recorded" },
            { term: "Next step", value: outcome?.nextStep ?? "Not recorded" },
            { term: "Updated", value: shortTime(request.updatedAt) },
          ]}
        />
        <RecoveryCandidateSnapshot request={request} />
        <RecoveryActionTimeline entries={request.timeline ?? []} />
      </div>
    </details>
  );
}

function RecoveryExplanationPanel({
  explanation,
  outcome,
  fallbackResultInvocationId,
  onViewInvocation,
}: {
  explanation: ApplicationRecoveryExplanation | null;
  outcome: ApplicationRecoveryActionRequest["outcome"];
  fallbackResultInvocationId: string | null;
  onViewInvocation: (invocationId: string) => void;
}) {
  if (!explanation && !outcome) return null;
  const state = explanation?.state ?? outcome?.state ?? null;
  const reason = explanation?.reason ?? outcome?.reason ?? null;
  const summary = explanation?.summary ?? outcome?.summary ?? null;
  const nextStep = explanation?.nextStep ?? outcome?.nextStep ?? null;
  const resultInvocationId = explanation?.resultInvocationId ?? fallbackResultInvocationId;
  const resultOrchestration = recoveryResultOrchestrationLabel(explanation);
  const requestedAgent = recoveryAgentChoiceLabel(explanation);

  return (
    <div className="space-y-2 rounded border border-border bg-muted p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium">Recovery guidance</span>
          {explanation?.selectedAction ? <Badge tone="neutral">{readableRecoveryActionType(explanation.selectedAction)}</Badge> : null}
          {state ? <Badge tone={recoveryExplanationTone(state)}>{readableRecoveryExplanationState(state)}</Badge> : null}
          {reason ? <Badge tone={recoveryExplanationReasonTone(reason)}>{readableRecoveryExplanationReason(reason)}</Badge> : null}
        </div>
        {resultInvocationId ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onViewInvocation(resultInvocationId)}
          >
            <ExternalLink />
            View result
          </Button>
        ) : null}
      </div>
      {summary ? <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">{summary}</p> : null}
      {nextStep ? (
        <p className="[overflow-wrap:anywhere] rounded bg-background px-2 py-1 text-xs">
          <span className="font-medium">Next step: </span>
          <span className="text-muted-foreground">{nextStep}</span>
        </p>
      ) : null}
      <FactList
        facts={[
          { term: "Approval request", value: explanation?.approvalRequestId ?? "Not required" },
          { term: "Duplicate guard", value: explanation?.blockedReason ? readableRecoveryActionAvailabilityReason(explanation.blockedReason) : "Clear" },
          { term: "Latest request", value: explanation?.latestRequestId ?? explanation?.recoveryActionRequestId ?? "Not recorded" },
          { term: "Result invocation", value: resultInvocationId ?? "Not linked" },
          { term: "Result orchestration", value: resultOrchestration ?? "Not linked" },
          { term: "Agent choice", value: requestedAgent ?? "Automatic" },
        ]}
      />
    </div>
  );
}

function RecoveryCandidateSnapshot({ request }: { request: ApplicationRecoveryActionRequest }) {
  const candidates = request.agentCandidateSnapshot ?? [];
  if (request.actionType !== "select_agent" || candidates.length === 0) return null;
  const selectableCount = candidates.filter((candidate) => candidate.selectable).length;
  const selected = candidates.find((candidate) => candidate.id === request.selectedAgentId)
    ?? candidates.find((candidate) => candidate.id === request.requestedAgentId)
    ?? null;
  const blocked = candidates.filter((candidate) => !candidate.selectable);
  return (
    <div className="space-y-1 rounded border border-border bg-muted p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">Agent candidate snapshot</span>
        <Badge tone="success">{selectableCount} selectable</Badge>
        {blocked.length ? <Badge tone="warning">{blocked.length} blocked</Badge> : null}
        {selected ? <Badge tone={selected.selectable ? "success" : "warning"}>{selected.name}</Badge> : null}
      </div>
      {blocked.length ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {blocked.map((candidate) => (
            <li key={candidate.id} className="[overflow-wrap:anywhere]">
              {candidate.name}: {candidate.reasons.map(readableRecoveryAgentReason).join(", ")}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RecoveryActionTimeline({ entries }: { entries: ApplicationRecoveryTimelineEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <ol className="space-y-1 border-l border-border pl-3 text-xs">
      {entries.map((entry) => (
        <li key={entry.id} className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={recoveryTimelineTone(entry.status)}>{readableRecoveryTimelineStatus(entry.status)}</Badge>
            <span className="text-muted-foreground">{shortTime(entry.createdAt)}</span>
          </div>
          {entry.message ? <p className="[overflow-wrap:anywhere] text-muted-foreground">{entry.message}</p> : null}
        </li>
      ))}
    </ol>
  );
}

function RecoveryActionItem({
  action,
  canRetry,
  pending,
  latestRequest,
  agentCandidates,
  agentsLoading,
  agentsError,
  onRequest,
}: {
  action: ApplicationOrchestrationRecoveryAction;
  canRetry: boolean;
  pending: boolean;
  latestRequest: ApplicationRecoveryActionRequest | null;
  agentCandidates: ApplicationOrchestrationRecoveryAgentCandidate[];
  agentsLoading: boolean;
  agentsError: boolean;
  onRequest: (actionType: string, reason?: string | null, agentId?: string | null) => void;
}) {
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const selectableAgents = agentCandidates.filter((candidate) => candidate.selectable);
  const preferredAgentId = agentCandidates.find((candidate) => candidate.preferred)?.id ?? selectableAgents[0]?.id ?? "";
  const effectiveAgentId = selectedAgentId || preferredAgentId;
  const selectedAgent = agentCandidates.find((candidate) => candidate.id === effectiveAgentId) ?? null;
  const isSelectAgent = action.type === "select_agent";
  const canRunSelectAgent = !isSelectAgent || Boolean(effectiveAgentId && selectedAgent?.selectable);
  const blockedReason = action.availability?.blockedReason ?? action.blockedReason ?? null;
  const warningReason = action.availability?.warningReason ?? action.warningReason ?? null;
  const actionBlocked = action.availability?.state === "blocked" || Boolean(blockedReason);
  const disabled = pending || actionBlocked;
  const latestExplanation = latestRequest?.explanation ?? null;

  return (
    <li className="rounded border border-border bg-muted p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{action.label}</span>
          {action.recommended ? <Badge tone="success">Recommended</Badge> : null}
          {action.riskLevel ? <Badge tone={riskTone(action.riskLevel)}>Risk {action.riskLevel}</Badge> : null}
          {blockedReason ? <Badge tone="warning">{readableRecoveryActionAvailabilityReason(blockedReason)}</Badge> : null}
          {warningReason ? <Badge tone="warning">{readableRecoveryActionAvailabilityReason(warningReason)}</Badge> : null}
          {action.requiresApproval ? <Badge tone="warning">Approval</Badge> : null}
          {!isExecutableRecoveryAction(action.type) ? <Badge tone="neutral">Manual</Badge> : null}
          {latestRequest ? <Badge tone={recoveryActionRequestTone(latestRequest.status)}>{readableRecoveryActionRequestStatus(latestRequest.status)}</Badge> : null}
        </div>
        {isExecutableRecoveryAction(action.type) ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={!canRetry || disabled || !canRunSelectAgent}
            onClick={() => onRequest(action.type, action.description, isSelectAgent ? effectiveAgentId : null)}
          >
            <Play />
            {actionBlocked ? "Blocked" : "Run"}
          </Button>
        ) : action.requiresApproval ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || latestRequest?.status === "approval_pending"}
            onClick={() => onRequest(action.type, action.description)}
          >
            {actionBlocked ? "Blocked" : latestRequest?.status === "approval_pending" ? "Pending approval" : "Request approval"}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled>
            {action.type === "view_invocation" ? "Open from View" : "Not supported"}
          </Button>
        )}
      </div>
      {action.description ? (
        <p className="[overflow-wrap:anywhere] text-muted-foreground">{action.description}</p>
      ) : null}
      {action.recommendationReason ? (
        <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">{action.recommendationReason}</p>
      ) : null}
      {blockedReason || warningReason ? (
        <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">
          {readableRecoveryActionAvailabilityReason(blockedReason ?? warningReason ?? "")}
          {action.latestRequestId ? ` (${action.latestRequestId})` : ""}
        </p>
      ) : null}
      {latestExplanation?.nextStep || latestExplanation?.approvalRequestId || latestExplanation?.resultInvocationId ? (
        <div className="mt-2 space-y-1 rounded border border-border bg-background p-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Latest action guidance</span>
            {latestExplanation.state ? <Badge tone={recoveryExplanationTone(latestExplanation.state)}>{readableRecoveryExplanationState(latestExplanation.state)}</Badge> : null}
            {latestExplanation.reason ? <Badge tone={recoveryExplanationReasonTone(latestExplanation.reason)}>{readableRecoveryExplanationReason(latestExplanation.reason)}</Badge> : null}
          </div>
          {latestExplanation.nextStep ? (
            <p className="[overflow-wrap:anywhere] text-muted-foreground">{latestExplanation.nextStep}</p>
          ) : null}
          <FactList
            facts={[
              { term: "Approval request", value: latestExplanation.approvalRequestId ?? "Not required" },
              { term: "Result invocation", value: latestExplanation.resultInvocationId ?? "Not linked" },
              { term: "Result orchestration", value: latestExplanation.resultOrchestrationId ?? "Not linked" },
            ]}
          />
        </div>
      ) : null}
      {isSelectAgent ? (
        <SelectAgentRecoveryPicker
          candidates={agentCandidates}
          loading={agentsLoading}
          error={agentsError}
          value={effectiveAgentId}
          onChange={setSelectedAgentId}
        />
      ) : null}
    </li>
  );
}

function SelectAgentRecoveryPicker({
  candidates,
  loading,
  error,
  value,
  onChange,
}: {
  candidates: ApplicationOrchestrationRecoveryAgentCandidate[];
  loading: boolean;
  error: boolean;
  value: string;
  onChange: (agentId: string) => void;
}) {
  if (error) {
    return <p className="mt-2 text-xs text-destructive">Could not load recovery agents.</p>;
  }
  if (loading && candidates.length === 0) {
    return <p className="mt-2 text-xs text-muted-foreground">Loading recovery agents...</p>;
  }
  if (candidates.length === 0) {
    return <p className="mt-2 text-xs text-destructive">No governed application-control agents are registered.</p>;
  }
  const selected = candidates.find((candidate) => candidate.id === value) ?? null;
  return (
    <div className="mt-2 space-y-2">
      <Select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Recovery agent"
      >
        {!value ? <option value="">No selectable recovery agent</option> : null}
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id} disabled={!candidate.selectable}>
            {recoveryAgentOptionLabel(candidate)}
          </option>
        ))}
      </Select>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {selected?.preferred ? <Badge tone="success">Recommended</Badge> : null}
        {selected?.sourceAgent ? <Badge tone="neutral">Original agent</Badge> : null}
        {selected ? (
          <span className="text-muted-foreground">
            {selected.status}
            {selected.healthStatus ? ` / ${selected.healthStatus}` : ""}
            {selected.locationType ? ` / ${selected.locationType}` : ""}
          </span>
        ) : null}
      </div>
      {candidates.some((candidate) => !candidate.selectable) ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {candidates.filter((candidate) => !candidate.selectable).map((candidate) => (
            <li key={candidate.id} className="[overflow-wrap:anywhere]">
              {candidate.name}: {candidate.reasons.map(readableRecoveryAgentReason).join(", ")}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function recoveryAgentOptionLabel(candidate: ApplicationOrchestrationRecoveryAgentCandidate): string {
  const suffixes = [
    candidate.preferred ? "recommended" : "",
    candidate.sourceAgent ? "original" : "",
    candidate.selectable ? "" : candidate.reasons.map(readableRecoveryAgentReason).join(", "),
  ].filter(Boolean);
  return suffixes.length ? `${candidate.name} (${suffixes.join("; ")})` : candidate.name;
}

function DiagnosticsBlock({ title, value }: { title: string; value?: unknown }) {
  if (value == null) return null;
  return (
    <details className="rounded border border-border bg-background p-2">
      <summary className="cursor-pointer text-xs font-medium">{title}</summary>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not recorded";
  return String(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function shortTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Right-pane detail for the application selected in the Applications view. */
export function ApplicationsInspector() {
  const { data: state } = useConsoleState();
  const selectedApplicationId = useUiStore((s) => s.selectedApplicationId);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);
  const application = (state?.applications ?? []).find((app) => app.id === selectedApplicationId);

  const { data: capabilityData } = useQuery({
    queryKey: ["application-capabilities", application?.id],
    queryFn: () => api.listApplicationCapabilities(application!.id),
    enabled: Boolean(application?.id),
    refetchInterval: 2000,
  });

  if (!application) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Application details</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Select an application to see its source, capabilities, probe, and orchestration drafts.
          </p>
        </CardContent>
      </Card>
    );
  }

  const capabilities = capabilityData?.capabilities ?? [];
  const probe = application.probe;
  const orchestrations = application.orchestrations ?? [];
  const invocations = state?.invocations ?? [];

  function viewInvocation(invocationId: string) {
    setSelectedInvocationId(invocationId);
    setSection("invocations");
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{application.name}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {application.id} · {application.kind}
          </p>
        </CardHeader>
        <CardContent>
          <FactList
            facts={[
              { term: "Status", value: application.status },
              { term: "Source", value: `${application.source.type} · ${sourceSummary(application.source)}` },
              { term: "Path", value: application.path ?? "—" },
              { term: "Owner", value: application.ownerTeamId ?? "—" },
            ]}
          />
        </CardContent>
      </Card>

      <ApplicationActions application={application} />
      <ApplicationExecutions application={application} invocations={invocations} onViewInvocation={viewInvocation} />
      <ApplicationResultSummary result={application.latestResult} invocations={invocations} onViewInvocation={viewInvocation} />

      <Card>
        <CardHeader>
          <CardTitle>Capabilities</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!capabilities.length ? (
            <p className="text-sm text-muted-foreground">No capabilities projected.</p>
          ) : (
            capabilities.map((capability) => (
              <div key={capability.name} className="flex items-start justify-between gap-2 text-sm">
                <span className="[overflow-wrap:anywhere]">
                  {capability.displayName ?? capability.name}
                  {capability.requiresApproval ? <span className="text-warning"> ⚠</span> : null}
                </span>
                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  <Badge tone={riskTone(capability.riskLevel)}>{capability.riskLevel ?? "—"}</Badge>
                  <Badge tone={capability.status === "disabled" ? "danger" : "success"}>
                    {capability.status ?? "—"}
                  </Badge>
                  {capability.metadata?.readiness?.state ? (
                    <Badge tone={readinessTone(capability.metadata.readiness.state)}>
                      {capability.metadata.readiness.state}
                    </Badge>
                  ) : null}
                  {capability.metadata?.resultPath?.outputCollection ? (
                    <Badge tone="neutral">{capability.metadata.resultPath.outputCollection}</Badge>
                  ) : null}
                </div>
              </div>
            ))
          )}
          <p className="text-xs text-muted-foreground">⚠ requires an explicit approval token</p>
        </CardContent>
      </Card>

      {probe ? (
        <Card>
          <CardHeader>
            <CardTitle>Probe</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {probe.summary ? <p className="text-sm text-muted-foreground">{probe.summary}</p> : null}
            {probe.capabilities?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {probe.capabilities.map((capability) => (
                  <Badge key={capability.name} tone={capability.source === "inferred" ? "warning" : "neutral"}>
                    {capability.name.split(".").at(-1)}
                  </Badge>
                ))}
              </div>
            ) : null}
            {probe.warnings?.length ? (
              <ul className="list-inside list-disc text-xs text-warning">
                {probe.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {orchestrations.length ? (
        <OrchestrationDrafts
          application={application}
          invocations={invocations}
          orchestrations={orchestrations}
        />
      ) : null}
    </div>
  );
}
