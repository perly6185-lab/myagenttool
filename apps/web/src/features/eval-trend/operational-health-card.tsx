import { useCallback, useEffect, useState } from "react";
import { Activity, BellRing } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/data/use-console-actions";
import { useVisibleInterval } from "@/hooks/use-visible-interval";

type Alert = {
  id: string;
  source: string;
  severity: "warning" | "danger";
  message: string;
  status: "open" | "acknowledged" | "silenced" | "recovered";
  updatedAt: string;
};
type Health = {
  web: { sampleCount: number };
  stream: { activeConnections: number; disconnectRate: number; averageEventLatencyMs: number | null };
  routing: { total: number; failureRate?: number | null; humanOverrideRate?: number | null };
  recovery: { recoveryHours: { median: number | null }; alerting: boolean };
  alerts: Alert[];
};

export function OperationalHealthCard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const load = useCallback(() => {
    void (api.operationalHealth() as Promise<Health>).then(setHealth).catch(() => setHealth(null));
  }, []);
  useEffect(load, [load]);
  useVisibleInterval(load, 30_000);
  if (!health) return null;
  const active = health.alerts.filter((alert) => alert.status !== "recovered");
  const act = (alert: Alert, action: "acknowledge" | "silence") => {
    setPending(alert.id);
    void api.actOnOperationalAlert(alert.id, action, action === "silence" ? 60 : undefined)
      .then(load).finally(() => setPending(null));
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><Activity className="size-4" />Operational health</span>
          {active.length ? <Badge tone="danger"><BellRing className="mr-1 size-3" />{active.length} active</Badge> : <Badge tone="success">Healthy</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
          <Metric label="Web samples" value={String(health.web.sampleCount)} />
          <Metric label="SSE disconnects" value={`${health.stream.disconnectRate}%`} />
          <Metric label="Routing failures" value={health.routing.failureRate == null ? "—" : `${Math.round(health.routing.failureRate * 100)}%`} />
          <Metric label="Recovery median" value={health.recovery.recoveryHours.median == null ? "—" : `${health.recovery.recoveryHours.median}h`} />
        </div>
        {health.alerts.slice(0, 10).map((alert) => (
          <div key={alert.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-xs">
            <Badge tone={alert.status === "recovered" ? "success" : alert.severity === "danger" ? "danger" : "warning"}>{alert.status}</Badge>
            <strong>{alert.source}</strong>
            <span className="min-w-48 flex-1 text-muted-foreground">{alert.message}</span>
            {alert.status === "open" ? <Button size="sm" variant="secondary" disabled={pending === alert.id} onClick={() => act(alert, "acknowledge")}>Acknowledge</Button> : null}
            {!["silenced", "recovered"].includes(alert.status) ? <Button size="sm" variant="secondary" disabled={pending === alert.id} onClick={() => act(alert, "silence")}>Silence 1h</Button> : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded bg-muted p-2"><span className="block text-muted-foreground">{label}</span><strong>{value}</strong></div>;
}
