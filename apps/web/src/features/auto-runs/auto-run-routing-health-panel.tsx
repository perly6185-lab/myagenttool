import { Badge } from "@/components/ui/badge";
import type { ConsoleSnapshot } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { AutoRunStatTile } from "./auto-run-overview";
import type { AutoRunSummary } from "./auto-run-model";

type RoutingHealth = NonNullable<AutoRunSummary["routingHealth"]>;

interface AutoRunRoutingHealthPanelProps {
  health: RoutingHealth;
  projects?: ConsoleSnapshot["projects"];
}

export function formatAutoRunRoutingSignal(signal: RoutingHealth["signals"][number]): string {
  return signal.key === "latency"
    ? `${Math.round(signal.value)} ms > ${signal.threshold} ms`
    : `${Math.round(signal.value * 100)}% ≥ ${Math.round(signal.threshold * 100)}%`;
}

export function AutoRunRoutingHealthPanel({ health, projects }: AutoRunRoutingHealthPanelProps) {
  const { t } = useAppTranslation();

  return (
    <section className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{t("autoRunRoutingHealth.title")}</h3>
        {health.signals.length ? (
          <Badge tone="danger">{t("autoRunRoutingHealth.signalCount", { count: health.signals.length })}</Badge>
        ) : (
          <Badge tone="success">{t("autoRunRoutingHealth.healthy")}</Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {t("autoRunRoutingHealth.sample", { count: health.total })}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <AutoRunStatTile
          label={t("autoRunRoutingHealth.fallback")}
          value={health.fallbackRate == null ? "—" : `${Math.round(health.fallbackRate * 100)}%`}
          hint={`${health.fallback}/${health.total}`}
        />
        <AutoRunStatTile
          label={t("autoRunRoutingHealth.lowConfidence")}
          value={health.lowConfidenceRate == null ? "—" : `${Math.round(health.lowConfidenceRate * 100)}%`}
          hint={`${health.lowConfidence}/${health.confidenceTotal} agent`}
        />
        <AutoRunStatTile
          label={t("autoRunRoutingHealth.medianLatency")}
          value={health.latency.medianMs == null ? "—" : `${health.latency.medianMs} ms`}
          hint={`n=${health.latency.count}`}
        />
        <AutoRunStatTile
          label={t("autoRunRoutingHealth.p90Latency")}
          value={health.latency.p90Ms == null ? "—" : `${health.latency.p90Ms} ms`}
          hint={t("autoRunRoutingHealth.threshold", { value: health.thresholds.latencyP90Ms })}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {health.confidenceBuckets.map((bucket) => (
          <div key={bucket.key} className="rounded-md bg-muted p-2 text-xs">
            <div className="flex items-center justify-between">
              <strong>{t(`autoRunRoutingHealth.bucket.${bucket.key}` as never)}</strong>
              <span>{bucket.alignmentRate == null ? "—" : `${Math.round(bucket.alignmentRate * 100)}%`}</span>
            </div>
            <p className="text-muted-foreground">
              {t("autoRunRoutingHealth.conclusive", { conclusive: bucket.conclusive, total: bucket.total })}
            </p>
          </div>
        ))}
      </div>
      {health.signals.map((signal) => (
        <div key={signal.key} className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs">
          <strong>{t(`autoRunRoutingHealth.signal.${signal.key}` as never)}</strong>
          <span className="ml-2 text-muted-foreground">
            {formatAutoRunRoutingSignal(signal)}
          </span>
        </div>
      ))}
      {health.daily.length > 1 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t("routingTrend.title")}</p>
          <div className="flex gap-1 overflow-x-auto pb-1">
            {health.daily.map((day) => (
              <div key={day.date} className="min-w-28 rounded bg-muted p-2 text-[10px]">
                <strong>{day.date.slice(5)}</strong>
                <p>{day.total} · {t("routingTrend.align")} {day.alignmentRate == null ? "—" : `${Math.round(day.alignmentRate * 100)}%`}</p>
                <p>{t("routingTrend.fallback")} {day.fallbackRate == null ? "—" : `${Math.round(day.fallbackRate * 100)}%`}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {health.byProject.length > 1 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t("routingTrend.projects")}</p>
          <div className="flex flex-wrap gap-1">
            {health.byProject.map((project) => (
              <Badge key={project.projectId} tone="neutral">
                {projects?.find((candidate) => candidate.id === project.projectId)?.name ?? project.projectId}
                {" · "}{project.total} · {project.alignmentRate == null ? "—" : `${Math.round(project.alignmentRate * 100)}%`}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
