import { useCallback, useEffect, useState } from "react";
import { Activity, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/data/use-console-actions";
import { useVisibleInterval } from "@/hooks/use-visible-interval";

type MetricSummary = {
  samples: number;
  p75: number;
  poor: number;
  poorRate: number;
  alerting: boolean;
};
type Trend = {
  metrics: Partial<Record<"CLS" | "FCP" | "INP" | "LCP", MetricSummary>>;
  versions: string[];
  sampleCount: number;
};

export function WebPerformanceCard() {
  const [trend, setTrend] = useState<Trend | null>(null);
  const load = useCallback(() => {
    void (api.webPerformanceTrend() as Promise<Trend>).then(setTrend).catch(() => setTrend(null));
  }, []);
  useEffect(load, [load]);
  useVisibleInterval(load, 60_000);

  if (!trend?.sampleCount) return null;
  const alertCount = Object.values(trend.metrics).filter((metric) => metric?.alerting).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><Activity className="size-4" />Web performance</span>
          {alertCount ? <Badge tone="danger"><TriangleAlert className="mr-1 size-3" />{alertCount} degraded</Badge> : <Badge tone="success">Healthy</Badge>}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Core Web Vitals p75 · {trend.sampleCount} samples · {trend.versions.length} version(s)
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(["FCP", "LCP", "INP", "CLS"] as const).map((name) => {
          const metric = trend.metrics[name];
          return (
            <div key={name} className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">{name} p75</p>
              <p className="mt-1 text-lg font-semibold">{metric ? `${metric.p75}${name === "CLS" ? "" : " ms"}` : "—"}</p>
              <p className={metric?.alerting ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {metric ? `${metric.poorRate}% poor · n=${metric.samples}` : "No samples"}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
