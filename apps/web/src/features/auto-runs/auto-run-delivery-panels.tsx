import { CircleAlert, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { ConsoleSnapshot } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { formatAutoRunDuration, formatAutoRunSloValue } from "./auto-run-format";
import { AutoRunDeployList, AutoRunStatTile } from "./auto-run-overview";
import type { AutoRunRecord, AutoRunSummary, DeploymentSummary } from "./auto-run-model";

export function AutoRunOutcomeMetrics({ summary }: { summary: AutoRunSummary }) {
  const { t } = useAppTranslation();
  const rate = summary.successRate;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <AutoRunStatTile label={t("autoRuns.totalRuns")} value={String(summary.total)} hint={t("autoRuns.inFlight", { count: summary.active })} />
      <AutoRunStatTile
        label={t("autoRuns.prSuccess")}
        value={rate == null ? "—" : `${Math.round(rate * 100)}%`}
        hint={t("autoRuns.outcomeSummary", { pr: summary.outcomes.prOpen, blocked: summary.outcomes.blocked, failed: summary.outcomes.failed })}
      />
      <AutoRunStatTile
        label={t("autoRuns.verification")}
        value={`${summary.verification.passed}✓`}
        hint={t("autoRuns.verificationSummary", { failed: summary.verification.failed, unverified: summary.verification.unverified })}
      />
      <AutoRunStatTile
        label={t("autoRuns.timeToPr")}
        value={formatAutoRunDuration(summary.timeToPr.medianSeconds)}
        hint={`p90 ${formatAutoRunDuration(summary.timeToPr.p90Seconds)} · n=${summary.timeToPr.count}`}
      />
      <AutoRunStatTile
        label={t("autoRuns.routing")}
        value={summary.routing?.alignmentRate == null ? "—" : `${Math.round(summary.routing.alignmentRate * 100)}%`}
        hint={t("autoRuns.conclusive", { count: summary.routing?.conclusive ?? 0 })}
      />
      <AutoRunStatTile
        label={t("autoRuns.humanEscalation")}
        value={summary.rates?.humanEscalation == null ? "—" : `${Math.round(summary.rates.humanEscalation * 100)}%`}
        hint={t("autoRuns.humanEscalationHint")}
      />
      <AutoRunStatTile
        label={t("autoRuns.selfRepair")}
        value={summary.rates?.selfRepair == null ? "—" : `${Math.round(summary.rates.selfRepair * 100)}%`}
        hint={t("autoRuns.selfRepairHint")}
      />
    </div>
  );
}

interface AutoRunDeliveryPanelsProps {
  runs: AutoRunRecord[];
  summary: AutoRunSummary;
  deploymentSummary: DeploymentSummary | null;
  deployments?: ConsoleSnapshot["deployments"];
}

export function AutoRunDeliveryPanels({
  runs,
  summary,
  deploymentSummary,
  deployments,
}: AutoRunDeliveryPanelsProps) {
  const { t } = useAppTranslation();

  return (
    <>
      {deploymentSummary && deploymentSummary.total > 0 ? (
        <div className="rounded-lg border p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Rocket className="size-4" /> {t("autoRuns.deploys")}
            <span className="text-xs font-normal text-muted-foreground">
              {t("autoRuns.deploySummary", { deployed: deploymentSummary.deployed, failed: deploymentSummary.failed })}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <AutoRunStatTile
              label={t("autoRuns.deployFrequency")}
              value={deploymentSummary.deployFrequencyPerWeek == null ? "—" : `${deploymentSummary.deployFrequencyPerWeek}/wk`}
              hint={t("autoRuns.deployTotal", { count: deploymentSummary.total })}
            />
            <AutoRunStatTile
              label={t("autoRuns.changeFailure")}
              value={deploymentSummary.changeFailureRate == null ? "—" : `${Math.round(deploymentSummary.changeFailureRate * 100)}%`}
              hint={t("autoRuns.changeFailureHint")}
            />
            <AutoRunStatTile
              label={t("autoRuns.recoveryMedian")}
              value={deploymentSummary.recoveryHours.median == null ? "—" : `${deploymentSummary.recoveryHours.median}h`}
              hint={`over ${deploymentSummary.recoveryHours.count} recovery(ies)`}
            />
          </div>
          <AutoRunDeployList deployments={deployments ?? []} runs={runs} />
        </div>
      ) : null}

      {summary.outcomes.reportPosted + summary.outcomes.needsInput > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("autoRuns.nonDiff", { reports: summary.outcomes.reportPosted, input: summary.outcomes.needsInput })}
        </p>
      ) : null}

      {summary.slo ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            {t("autoRuns.slos")}
            {summary.slo.anyBelow ? <Badge tone="danger">{t("autoRuns.belowTarget")}</Badge> : <Badge tone="success">{t("autoRuns.onTarget")}</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {summary.slo.slos.map((slo) => (
              <div key={slo.key} className={cn("rounded-lg border px-3 py-2", slo.meets === false ? "border-red-500/40 bg-red-500/5" : "border-border")}>
                <p className="text-xs text-muted-foreground">{slo.label}</p>
                <p className={cn("mt-0.5 text-lg font-semibold tabular-nums", slo.meets === false && "text-red-600 dark:text-red-400")}>{formatAutoRunSloValue(slo.value, slo.unit)}</p>
                <p className="text-[10px] text-muted-foreground">
                  {t(slo.meets == null ? "autoRuns.noData" : slo.meets ? "autoRuns.meets" : "autoRuns.below")} · {t("autoRuns.target")} {slo.direction === "gte" ? "≥" : "≤"} {formatAutoRunSloValue(slo.target, slo.unit)}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {summary.blockedReasons.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <CircleAlert className="size-4" /> {t("autoRuns.blockedReasons")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {summary.blockedReasons.map((reason) => (
              <div key={reason.reason} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-muted-foreground">{reason.reason}</span>
                <Badge tone="warning">{reason.count}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
