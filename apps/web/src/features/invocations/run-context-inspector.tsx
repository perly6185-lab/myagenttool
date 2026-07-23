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
  healthTone,
  statusTone,
} from "@/lib/readable-labels";
import type { WebNavigationLink } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import {
  audit as auditLabel,
  cancellation,
  costOwner,
  delivery,
  healthLabel,
  invocationStatus,
  resultDescription,
  resultHeading,
  usage as usageLabel,
} from "@/lib/i18n/readable-labels";

export function RunContextInspector() {
  const { t } = useAppTranslation();
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
            <StatusBadge tone={healthTone(agent.health)}>{healthLabel(t, agent.health)}</StatusBadge>
          </CardHeader>
          <CardContent>
            <FactList
              facts={[
                { term: t("runContext.capability"), value: agent.capabilities?.[0]?.description ?? t("runContext.noCapability") },
                { term: t("runContext.costOwner"), value: costOwner(t, agent.economics, usage) },
                { term: t("runContext.usage"), value: usageLabel(t, usage) },
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
                ? t("runContext.review")
                : approval.status === "approved"
                  ? t("runContext.approved")
                  : t("runContext.denied")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FactList
              facts={[
                { term: t("runContext.risk"), value: approval.summary?.risk ?? t("runContext.riskValue", { level: approval.riskLevel ?? "unknown" }) },
                { term: t("runContext.data"), value: approval.summary?.data ?? t("runContext.recorded") },
                { term: t("runContext.cost"), value: approval.summary?.cost ?? t("runContext.unknownCost") },
                { term: t("runContext.cancel"), value: approval.summary?.cancellation ?? t("runContext.unknownCancel") },
                { term: t("runContext.tags"), value: approval.riskTags?.length ? approval.riskTags.join(", ") : t("runContext.noTags") },
              ]}
            />
            {approval.status === "pending" ? (
              <div className="flex gap-2">
                <Button size="sm" disabled={pending} onClick={() => execute(() => api.approveApproval(approval.id))}>
                  {t("runContext.approve")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => execute(() => api.denyApproval(approval.id))}
                >
                  {t("runContext.deny")}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* No empty result/record scaffolding before a run exists (#930). */}
      {invocation ? (
      <>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{resultHeading(t, invocation?.status)}</CardTitle>
          {invocation ? <StatusBadge tone={statusTone(invocation.status)}>{invocationStatus(t, invocation.status)}</StatusBadge> : null}
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {resultDescription(t, invocation, audit)}
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
              {t("runContext.troubleshoot")}
            </Button>
          ) : null}
          {report ? (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="mb-2 text-sm font-medium">{t("runContext.troubleshooting", { id: report.invocationId })}</p>
              <FactList
                facts={[
                  { term: t("runContext.summary"), value: report.summary },
                  { term: t("runContext.bridge"), value: report.bridgeState },
                  { term: t("runContext.error"), value: report.adapterError ?? t("runContext.noAdapterError") },
                  { term: t("runContext.logs"), value: report.logSummary },
                  { term: t("runContext.fixes"), value: report.suggestedFixes?.join(" ") ?? t("runContext.reviewTimeline") },
                ]}
              />
              {report.webLinks ? (
                <WebNavigationLinkActions
                  title={t("runContext.reportLinks")}
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
          <CardTitle>{t("runContext.whatRecorded")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FactList
            facts={[
              { term: t("runContext.record"), value: audit ? auditLabel(t, audit) : t("runContext.nothingRecorded") },
              { term: t("runContext.delivery"), value: delivery(t, invocation?.delivery?.state) },
              { term: t("runContext.cancel"), value: cancellation(t, invocation?.cancellation?.state) },
            ]}
          />
        </CardContent>
      </Card>
      </>
      ) : null}
    </div>
  );
}
