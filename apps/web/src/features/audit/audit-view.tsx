import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { audit as auditLabel, lifecycleAudit } from "@/lib/i18n/readable-labels";
import { ObservabilityDeletionCard } from "./observability-deletion-card";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

export function AuditView() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const audits = state?.auditSummaries ?? [];
  const lifecycle = state?.lifecycleAuditRecords ?? [];
  const policies = state?.policyDecisionRecords ?? [];

  // Pick-from-list subjects for the deletion card, per scope. Empty lists fall
  // back to a free-text id input in the card.
  const deletionSubjects = {
    user: (state?.users ?? []).map((user) => ({ id: user.id, label: user.name ?? user.id })),
    team: (state?.teams ?? []).map((team) => ({ id: team.id, label: team.name ?? team.id })),
    device: (state?.devices ?? []).map((device) => ({ id: device.id, label: device.name ?? device.id })),
  };

  return (
    <div className="space-y-5">
      <ObservabilityDeletionCard subjects={deletionSubjects} />
      <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("auditPage.invocation")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {audits.length === 0 ? (
            <EmptyState title={t("auditPage.empty")} hint={t("auditPage.emptyHint")} />
          ) : (
            audits.slice(0, 20).map((audit, index) => (
              <div
                key={`${audit.invocationId ?? "audit"}-${index}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{audit.invocationId ?? audit.agentId}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {audit.costSummary ?? t("auditPage.noCost")}
                  </p>
                </div>
                <Badge tone={audit.permissionDecision === "denied" ? "danger" : "success"}>
                  {auditLabel(t, audit)}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>{t("auditPage.lifecycle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {lifecycle.length === 0 ? (
              <EmptyState title={t("auditPage.noLifecycle")} hint={t("auditPage.lifecycleHint")} />
            ) : (
              lifecycle.slice(0, 12).map((record, index) => (
                <div
                  key={`${record.agentId ?? "agent"}-${record.operation}-${index}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="truncate text-muted-foreground">{record.agentId}</span>
                  <Badge tone={record.status === "failed" ? "danger" : "success"}>
                    {lifecycleAudit(t, record)}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("auditPage.policy")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {policies.length === 0 ? (
              <EmptyState title={t("auditPage.noPolicy")} hint={t("auditPage.policyHint")} />
            ) : (
              policies.slice(0, 12).map((policy) => (
                <div key={policy.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{policy.decision.replaceAll("_", " ")}</span>
                    {policy.riskTags?.length ? (
                      <span className="text-xs text-muted-foreground">{policy.riskTags.join(", ")}</span>
                    ) : null}
                  </div>
                  {policy.reason ? (
                    <p className="text-xs text-muted-foreground">{policy.reason}</p>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}
