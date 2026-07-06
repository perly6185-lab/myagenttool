import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { FactList } from "@/components/common/fact-list";
import { WebNavigationLinkActions } from "@/components/common/web-navigation-link-actions";
import { webNavigationStateFromLink } from "@/app/deep-links";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore } from "@/store/ui-store";
import {
  approvalFor,
  auditFor,
  resolveAgents,
  resolveInvocation,
  troubleshootingFor,
  usageFor,
} from "@/features/selection";
import {
  costOwnerText,
  readableAudit,
  readableCancellation,
  readableDelivery,
  readableHealthLabel,
  healthTone,
  resultSummary,
  resultTitle,
  statusTone,
  usageText,
} from "@/lib/readable-labels";
import type { WebNavigationLink } from "@/lib/console-state";

export function RunContextInspector() {
  const { data: state } = useConsoleState();
  const selectedAgentId = useUiStore((s) => s.selectedAgentId);
  const selectedInvocationId = useUiStore((s) => s.selectedInvocationId);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSelectedApplicationId = useUiStore((s) => s.setSelectedApplicationId);
  const setSelectedApplicationRun = useUiStore((s) => s.setSelectedApplicationRun);
  const setSection = useUiStore((s) => s.setSection);
  const { execute, pending } = useAsyncAction();

  const { agent } = resolveAgents(state, selectedAgentId);
  const invocation = resolveInvocation(state, selectedInvocationId);
  const approval = approvalFor(state, invocation);
  const audit = auditFor(state, invocation);
  const report = troubleshootingFor(state, invocation);
  const usage = usageFor(state, agent);

  function openWebNavigationLink(link: WebNavigationLink) {
    const navigation = webNavigationStateFromLink(link);
    if (navigation.selectedInvocationId !== undefined) {
      setSelectedInvocationId(navigation.selectedInvocationId);
    }
    if (navigation.selectedApplicationId !== undefined) {
      setSelectedApplicationId(navigation.selectedApplicationId);
    }
    if (navigation.selectedApplicationRun !== undefined) {
      setSelectedApplicationRun(navigation.selectedApplicationRun);
    }
    if (navigation.section) {
      setSection(navigation.section);
    }
  }

  return (
    <div className="space-y-4">
      {agent ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{agent.name}</CardTitle>
            <StatusBadge tone={healthTone(agent.health)}>{readableHealthLabel(agent.health)}</StatusBadge>
          </CardHeader>
          <CardContent>
            <FactList
              facts={[
                { term: "Capability", value: agent.capabilities?.[0]?.description ?? "No capability selected" },
                { term: "Cost owner", value: costOwnerText(agent.economics, usage) },
                { term: "Usage", value: usageText(usage) },
              ]}
            />
          </CardContent>
        </Card>
      ) : null}

      {approval ? (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle>
              {approval.status === "pending"
                ? "Review before running"
                : approval.status === "approved"
                  ? "Approval granted"
                  : "Approval denied"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FactList
              facts={[
                { term: "Risk", value: approval.summary?.risk ?? `${approval.riskLevel} risk` },
                { term: "Data", value: approval.summary?.data ?? "Task input and result are recorded." },
                { term: "Cost", value: approval.summary?.cost ?? "Cost is unknown." },
                { term: "Cancel", value: approval.summary?.cancellation ?? "Cancellation behavior is unknown." },
                { term: "Tags", value: approval.riskTags?.length ? approval.riskTags.join(", ") : "No tags declared" },
              ]}
            />
            {approval.status === "pending" ? (
              <div className="flex gap-2">
                <Button size="sm" disabled={pending} onClick={() => execute(() => api.approveApproval(approval.id))}>
                  Approve run
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => execute(() => api.denyApproval(approval.id))}
                >
                  Deny run
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{resultTitle(invocation?.status)}</CardTitle>
          {invocation ? <StatusBadge tone={statusTone(invocation.status)}>{invocation.status}</StatusBadge> : null}
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {resultSummary(invocation, audit)}
          </p>
          {invocation ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={
                pending ||
                !["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation.status ?? "")
              }
              onClick={() => execute(() => api.troubleshoot(invocation.id))}
            >
              Troubleshoot
            </Button>
          ) : null}
          {report ? (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="mb-2 text-sm font-medium">Troubleshooting {report.invocationId}</p>
              <FactList
                facts={[
                  { term: "Summary", value: report.summary },
                  { term: "Bridge", value: report.bridgeState },
                  { term: "Error", value: report.adapterError ?? "No adapter error text recorded." },
                  { term: "Logs", value: report.logSummary },
                  { term: "Fixes", value: report.suggestedFixes?.join(" ") ?? "Review the timeline and retry safely." },
                ]}
              />
              {report.webLinks ? (
                <WebNavigationLinkActions
                  title="Report links"
                  links={[
                    report.webLinks.failedInvocation,
                    report.webLinks.troubleshooterInvocation,
                    report.webLinks.applicationRun,
                  ]}
                  onOpen={openWebNavigationLink}
                  className="mt-3"
                />
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What was recorded</CardTitle>
        </CardHeader>
        <CardContent>
          <FactList
            facts={[
              { term: "Record", value: audit ? readableAudit(audit) : "Nothing recorded yet" },
              { term: "Delivery", value: readableDelivery(invocation?.delivery?.state) },
              { term: "Cancel", value: readableCancellation(invocation?.cancellation?.state) },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
