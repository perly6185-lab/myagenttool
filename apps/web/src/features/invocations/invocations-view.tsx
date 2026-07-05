import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { FactList } from "@/components/common/fact-list";
import { EventTimeline } from "@/features/invocations/event-timeline";
import { DecisionAction } from "@/features/invocations/decision-action";
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
import { readableDelivery, readableStatus, statusTone } from "@/lib/readable-labels";
import type {
  ConsoleSnapshot,
  InvocationExplanation,
  InvocationSnapshot,
} from "@/lib/console-state";

export function InvocationsView() {
  const { data: state } = useConsoleState();
  const selectedInvocationId = useUiStore((s) => s.selectedInvocationId);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);

  const invocations = state?.invocations ?? [];
  const selected = resolveInvocation(state, selectedInvocationId);
  const events = selected
    ? (state?.events ?? []).filter((e) => e.invocationId === selected.id).slice(0, 40)
    : [];

  function viewInvocation(invocationId: string) {
    setSelectedInvocationId(invocationId);
    setSection("invocations");
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Invocations</CardTitle>
        </CardHeader>
        <CardContent>
          {invocations.length === 0 ? (
            <EmptyState title="No invocations yet" hint="Start a task from Overview to see it here." />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Task</th>
                    <th className="px-3 py-2 text-left font-medium">Agent</th>
                    <th className="px-3 py-2 text-left font-medium">Delivery</th>
                    <th className="px-3 py-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invocations.map((invocation) => {
                    const active = invocation.id === selected?.id;
                    return (
                      <tr
                        key={invocation.id}
                        onClick={() => setSelectedInvocationId(invocation.id)}
                        className={cn(
                          "cursor-pointer border-t border-border transition-colors hover:bg-accent/60",
                          active && "bg-accent",
                        )}
                      >
                        <td className="px-3 py-2 font-mono text-xs">{invocation.id}</td>
                        <td className="px-3 py-2 text-muted-foreground">{invocation.agentId ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {readableDelivery(invocation.delivery?.state)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <StatusBadge tone={statusTone(invocation.status)}>
                            {readableStatus(invocation.status)}
                          </StatusBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selected ? (
        <OperatorExplanationCard
          invocation={selected}
          state={state ?? null}
          onViewInvocation={viewInvocation}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{selected ? `Timeline · ${selected.id}` : "Timeline"}</CardTitle>
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
  onViewInvocation,
}: {
  invocation: InvocationSnapshot;
  state: ConsoleSnapshot | null;
  onViewInvocation: (invocationId: string) => void;
}) {
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
  const resultInvocationId = serverExplanation?.resultLocation?.invocationId
    ?? serverExplanation?.recovery?.resultInvocationId
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Operator explanation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(invocation.status)}>{readableStatus(invocation.status)}</Badge>
          {sourceLabel ? <Badge tone="neutral">{sourceLabel}</Badge> : null}
          {recoveryCategory ? <Badge tone={recoveryTone(recoveryCategory)}>{readableRecoveryCategory(recoveryCategory)}</Badge> : null}
          {recoveryState ? <Badge tone={recoveryExplanationTone(recoveryState)}>{readableRecoveryExplanationState(recoveryState)}</Badge> : null}
          {reasonCode ? <Badge tone={recoveryExplanationReasonTone(reasonCode)}>{readableRecoveryExplanationReason(reasonCode)}</Badge> : null}
          {recovery?.humanApprovalRequired || approvalRequestId || serverExplanation?.approval ? <Badge tone="warning">Approval</Badge> : null}
        </div>
        <p className="[overflow-wrap:anywhere] text-sm text-muted-foreground">{summary}</p>
        {nextStep ? (
          <p className="[overflow-wrap:anywhere] rounded-md bg-muted px-3 py-2 text-sm">
            <span className="font-medium">Next step: </span>
            <span className="text-muted-foreground">{nextStep}</span>
          </p>
        ) : null}
        <FactList
          facts={[
            { term: "Why blocked", value: serverExplanation?.reason ?? recoveryBlockedReason(invocation, reasonCode) },
            { term: "Waiting on", value: waitingOnLabel(serverExplanation) ?? recoveryWaitingOn({ approvalRequestId, approval, latestRecoveryAction }) },
            { term: "Result", value: resultLabel },
            { term: "Recovery action", value: recoveryActionValue },
          ]}
        />
        {error ? <p className="text-xs text-destructive">Could not load recovery explanation.</p> : null}
        {isLoading ? <p className="text-xs text-muted-foreground">Loading recovery explanation...</p> : null}
        {resultInvocationId ? (
          <Button size="sm" variant="secondary" onClick={() => onViewInvocation(resultInvocationId)}>
            <ExternalLink />
            View result
          </Button>
        ) : null}
        {recovery?.actions.length ? (
          <div className="space-y-1 rounded-md border border-border bg-muted p-2">
            <p className="text-xs font-medium">Recommended recovery</p>
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

function sourceBadgeLabel(explanation: InvocationExplanation | null): string | null {
  const type = explanation?.source?.type;
  if (type === "application_orchestration") return "Application orchestration";
  if (type === "automation") return explanation?.source?.scheduled ? "Scheduled automation" : "Automation";
  if (type === "auto_run") return "Auto-run";
  if (type === "compare_run") return "Compare run";
  if (type === "troubleshooting") return "Troubleshooting";
  if (type === "recovery_result") return "Recovery result";
  if (type === "tool") return "Tool";
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
