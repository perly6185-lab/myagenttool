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
  const metadata = invocation.options?.metadata ?? {};
  const applicationId = stringValue(metadata.applicationId);
  const routineId = stringValue(metadata.routineId);
  const isApplicationRun = metadata.source === "application_orchestration" && Boolean(applicationId && routineId);
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
  const explanation = latestRecoveryAction?.explanation ?? null;
  const approvalRequestId = recoveryApprovalRequestId(invocation, explanation, latestRecoveryAction);
  const approval = approvalRequestId
    ? (state?.approvalRequests ?? []).find((item) => item.id === approvalRequestId) ?? null
    : null;
  const resultInvocationId = recoveryResultInvocationId(explanation, latestRecoveryAction);
  const resultOrchestration = recoveryResultOrchestrationLabel(explanation);
  const summary = explanation?.summary
    ?? latestRecoveryAction?.outcome?.summary
    ?? recovery?.summary
    ?? invocation.result?.summary
    ?? latestInvocationRecoveryEventSummary(state, invocation.id)
    ?? defaultInvocationRecoverySummary(invocation);
  const reason = explanation?.reason
    ?? latestRecoveryAction?.outcome?.reason
    ?? recovery?.category
    ?? invocationStatusRecoveryReason(invocation);
  const nextStep = explanation?.nextStep
    ?? latestRecoveryAction?.outcome?.nextStep
    ?? recoveryDefaultNextStep(invocation, recovery, latestRecoveryAction);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Operator explanation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(invocation.status)}>{readableStatus(invocation.status)}</Badge>
          {isApplicationRun ? <Badge tone="neutral">Application orchestration</Badge> : null}
          {recovery ? <Badge tone={recoveryTone(recovery.category)}>{readableRecoveryCategory(recovery.category)}</Badge> : null}
          {explanation?.state ? <Badge tone={recoveryExplanationTone(explanation.state)}>{readableRecoveryExplanationState(explanation.state)}</Badge> : null}
          {reason ? <Badge tone={recoveryExplanationReasonTone(reason)}>{readableRecoveryExplanationReason(reason)}</Badge> : null}
          {recovery?.humanApprovalRequired || approvalRequestId ? <Badge tone="warning">Approval</Badge> : null}
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
            { term: "Why blocked", value: recoveryBlockedReason(invocation, reason) },
            { term: "Waiting on", value: recoveryWaitingOn({ approvalRequestId, approval, latestRecoveryAction }) },
            { term: "Result", value: resultInvocationId ?? resultOrchestration ?? recoveryResultLabel(invocation) },
            { term: "Recovery action", value: latestRecoveryAction ? `${readableRecoveryActionType(latestRecoveryAction.actionType)} · ${readableRecoveryActionStatus(latestRecoveryAction.status, "inline")}` : "Not requested" },
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
