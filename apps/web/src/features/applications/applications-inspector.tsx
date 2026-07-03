import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clipboard, ExternalLink, Play, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { FactList } from "@/components/common/fact-list";
import { ConfirmModal } from "@/components/common/confirm-modal";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { sourceSummary } from "@/features/applications/applications-view";
import { Transcript } from "@/features/invocations/transcript";
import { readableStatus, statusTone } from "@/lib/readable-labels";
import type {
  ApplicationOrchestration,
  ApplicationOrchestrationRecoveryAction,
  ApplicationOrchestrationRecoveryAgentCandidate,
  ApplicationRecoveryActionRequest,
  ApplicationRecoveryTimelineEntry,
  ApplicationOrchestrationRun,
  ApplicationSnapshot,
  InvocationSnapshot,
} from "@/lib/console-state";

// Explicit-intent confirmation token for governed side-effecting actions. It is
// an intent marker (tenancy is the real authz), not a cryptographic approval.
const APPROVAL_TOKEN = "console-operator-confirmed";

function riskTone(risk?: string): "neutral" | "warning" | "danger" {
  if (risk === "high" || risk === "critical") return "danger";
  if (risk === "medium") return "warning";
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
    api.applicationLifecycle(application.id, action, { approvalToken: APPROVAL_TOKEN });

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
              run: () => api.generateApplicationOrchestration(application.id, { approvalToken: APPROVAL_TOKEN }),
            })}>
              Generate orchestration
            </Button>
          ) : null}
        </div>
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
  const [expandedInvocationId, setExpandedInvocationId] = useState<string | null>(null);
  const runs = data?.runs ?? [];

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

  if (error) {
    return <p className="rounded-md bg-destructive/10 p-2 text-destructive">Could not load run diagnostics.</p>;
  }
  if (isLoading || !run) {
    return <p className="rounded-md bg-muted p-2 text-muted-foreground">Loading diagnostics...</p>;
  }

  const retryOfInvocationId = stringValue(run.metadata?.retryOfInvocationId);
  return (
    <div className="space-y-2 rounded-md bg-muted p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium">Run diagnostics</p>
          {retryOfInvocationId ? (
            <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">
              Retry of <span className="font-mono">{retryOfInvocationId}</span>
            </p>
          ) : null}
        </div>
        <Button size="sm" variant="secondary" disabled={!canRetry || pending} onClick={retryRun}>
          <Play />
          {pending ? "Retrying..." : "Re-run"}
        </Button>
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
  const resultInvocationId = request.resultInvocation?.id ?? request.resultInvocationId ?? null;
  return (
    <details className="rounded border border-border bg-background p-2" open={open}>
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">{label}</span>
            <Badge tone="neutral">{readableRecoveryActionType(request.actionType)}</Badge>
            <Badge tone={recoveryActionRequestTone(request.status)}>{readableRecoveryActionRequestStatus(request.status)}</Badge>
            {outcome ? <Badge tone={recoveryOutcomeTone(outcome.state)}>{readableRecoveryOutcome(outcome.state)}</Badge> : null}
          </div>
          <span className="text-xs text-muted-foreground">{shortTime(request.updatedAt ?? request.createdAt)}</span>
        </div>
      </summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {outcome?.summary ? (
            <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">{outcome.summary}</p>
          ) : <span />}
          {resultInvocationId ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onViewInvocation(resultInvocationId)}
            >
              <ExternalLink />
              View recovered invocation
            </Button>
          ) : null}
        </div>
        <FactList
          facts={[
            { term: "Source", value: request.sourceInvocation?.id ?? request.invocationId },
            { term: "Result", value: resultInvocationId ?? "Not linked" },
            { term: "Result status", value: request.resultInvocation?.status ?? "Not recorded" },
            { term: "Requested agent", value: request.requestedAgentId ?? "Automatic" },
            { term: "Selected agent", value: request.selectedAgentId ?? "Not changed" },
            { term: "Updated", value: shortTime(request.updatedAt) },
          ]}
        />
        <RecoveryCandidateSnapshot request={request} />
        <RecoveryActionTimeline entries={request.timeline ?? []} />
      </div>
    </details>
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

  return (
    <li className="rounded border border-border bg-muted p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{action.label}</span>
          {action.requiresApproval ? <Badge tone="warning">Approval</Badge> : null}
          {!isExecutableRecoveryAction(action.type) ? <Badge tone="neutral">Manual</Badge> : null}
          {latestRequest ? <Badge tone={recoveryActionRequestTone(latestRequest.status)}>{readableRecoveryActionRequestStatus(latestRequest.status)}</Badge> : null}
        </div>
        {isExecutableRecoveryAction(action.type) ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={!canRetry || pending || !canRunSelectAgent}
            onClick={() => onRequest(action.type, action.description, isSelectAgent ? effectiveAgentId : null)}
          >
            <Play />
            Run
          </Button>
        ) : action.requiresApproval ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || latestRequest?.status === "approval_pending"}
            onClick={() => onRequest(action.type, action.description)}
          >
            {latestRequest?.status === "approval_pending" ? "Pending approval" : "Request approval"}
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

function readableRecoveryCategory(category: string): string {
  return category
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ") || "Unknown";
}

function recoveryTone(category: string): "neutral" | "success" | "warning" | "danger" | "running" {
  if (category === "none") return "success";
  if (["validation_failed", "policy_blocked", "device_unlinked"].includes(category)) return "warning";
  if (["runtime_error", "unknown_failure"].includes(category)) return "danger";
  if (["dispatch_timeout", "agent_unavailable", "cancelled"].includes(category)) return "running";
  return "neutral";
}

function isExecutableRecoveryAction(actionType: string): boolean {
  return actionType === "rerun" || actionType === "select_agent";
}

function latestRecoveryActionRequest(
  requests: ApplicationRecoveryActionRequest[],
  actionType?: string,
): ApplicationRecoveryActionRequest | null {
  return sortedRecoveryActionRequests(requests)
    .filter((request) => !actionType || request.actionType === actionType)[0] ?? null;
}

function sortedRecoveryActionRequests(requests: ApplicationRecoveryActionRequest[]): ApplicationRecoveryActionRequest[] {
  return [...requests].sort(
    (left, right) => Date.parse(right.updatedAt ?? right.createdAt) - Date.parse(left.updatedAt ?? left.createdAt),
  );
}

function recoveryActionRequestTone(status: string): "neutral" | "success" | "warning" | "danger" | "running" {
  if (status === "executed" || status === "approval_approved" || status === "noop") return "success";
  if (status === "executing") return "running";
  if (status === "approval_pending" || status === "requested") return "warning";
  if (status === "failed" || status === "unsupported" || status === "approval_denied" || status === "approval_timed_out") return "danger";
  return "neutral";
}

function readableRecoveryActionRequestStatus(status: string): string {
  const labels: Record<string, string> = {
    approval_approved: "Approved",
    approval_denied: "Denied",
    approval_pending: "Pending",
    approval_timed_out: "Timed out",
    executing: "Executing",
    executed: "Executed",
    failed: "Failed",
    noop: "Viewed",
    requested: "Requested",
    unsupported: "Unsupported",
  };
  return labels[status] ?? status;
}

function recoveryOutcomeTone(state: string): "neutral" | "success" | "warning" | "danger" | "running" {
  if (state === "recovered") return "success";
  if (state === "pending") return "running";
  if (state === "still_failed") return "danger";
  if (state === "needs_attention") return "warning";
  return "neutral";
}

function recoveryTimelineTone(status: string): "neutral" | "success" | "warning" | "danger" | "running" {
  if (status === "executed" || status === "approval_approved") return "success";
  if (status === "executing") return "running";
  if (status === "requested" || status === "approval_pending") return "warning";
  if (status === "failed" || status === "rejected" || status === "approval_denied" || status === "approval_timed_out") return "danger";
  return "neutral";
}

export function readableRecoveryOutcome(state: string): string {
  const labels: Record<string, string> = {
    needs_attention: "Needs attention",
    pending: "Pending",
    recovered: "Recovered",
    still_failed: "Still failed",
  };
  return labels[state] ?? state;
}

export function readableRecoveryActionType(actionType: string): string {
  const labels: Record<string, string> = {
    regenerate_orchestration: "Regenerate orchestration",
    rerun: "Re-run",
    select_agent: "Select agent",
    view_invocation: "View invocation",
  };
  return labels[actionType] ?? actionType;
}

export function readableRecoveryTimelineStatus(status: string): string {
  const labels: Record<string, string> = {
    approval_approved: "Approved",
    approval_denied: "Denied",
    approval_pending: "Approval pending",
    approval_resolved: "Approval resolved",
    approval_timed_out: "Timed out",
    executed: "Executed",
    executing: "Executing",
    failed: "Failed",
    recorded: "Recorded",
    rejected: "Rejected",
    requested: "Requested",
  };
  return labels[status] ?? status;
}

export function readableRecoveryAgentReason(reason: string): string {
  const labels: Record<string, string> = {
    agent_disabled: "disabled",
    agent_not_found: "not found",
    agent_unavailable: "unavailable",
    agent_unhealthy: "unhealthy",
    application_control_missing: "missing application control",
    device_unlinked: "device unlinked",
  };
  return labels[reason] ?? reason;
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

      <Card>
        <CardHeader>
          <CardTitle>Capabilities</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!capabilities.length ? (
            <p className="text-sm text-muted-foreground">No capabilities projected.</p>
          ) : (
            capabilities.map((capability) => (
              <div key={capability.name} className="flex items-center justify-between gap-2 text-sm">
                <span className="[overflow-wrap:anywhere]">
                  {capability.displayName ?? capability.name}
                  {capability.requiresApproval ? <span className="text-warning"> ⚠</span> : null}
                </span>
                <div className="flex shrink-0 gap-1.5">
                  <Badge tone={riskTone(capability.riskLevel)}>{capability.riskLevel ?? "—"}</Badge>
                  <Badge tone={capability.status === "disabled" ? "danger" : "success"}>
                    {capability.status ?? "—"}
                  </Badge>
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
