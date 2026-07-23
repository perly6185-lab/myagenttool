import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { formatDuration } from "@/lib/format";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

// Why a queued invocation isn't running → a tone + a plain-language label. Shares
// the reason vocabulary the server's dispatch classifier emits (dispatch-
// eligibility.mjs), so the operator sees exactly what the bridge decided.
const REASON: Record<string, { tone: "neutral" | "success" | "warning" | "danger"; label: string }> = {
  dispatchable: { tone: "success", label: "Ready — next up" },
  waiting_concurrency: { tone: "warning", label: "Waiting for a free slot" },
  dir_busy: { tone: "neutral", label: "Worktree busy" },
  wrong_device: { tone: "neutral", label: "Other device" },
  agent_missing: { tone: "danger", label: "Agent missing" },
  agent_disabled: { tone: "danger", label: "Agent disabled" },
  agent_unhealthy: { tone: "danger", label: "Agent unhealthy" },
  not_queued: { tone: "neutral", label: "Not queued" },
};

const pct = (rate: number | null | undefined) => (rate == null ? "—" : `${Math.round(rate * 100)}%`);

/**
 * Layer-A dispatch health for this device: how many runs are in flight vs the
 * concurrency cap, which queued invocations are blocked and why, and dispatch
 * latency. Reads /api/invocation-dispatch-health (team-scoped queue; global
 * capacity). Polls so the queue stays live while an operator is watching it.
 */
export function InvocationDispatchHealth() {
  const { t } = useAppTranslation();
  const { data, isError } = useQuery({
    queryKey: ["invocation-dispatch-health"],
    queryFn: () => api.getInvocationDispatchHealth(),
    refetchInterval: 15_000,
  });

  if (isError) {
    return (
      <Card className="max-w-xl" data-testid="dispatch-health-error">
        <CardHeader>
          <CardTitle>{t("devicesPage.dispatchQueue")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Badge tone="warning">{t("devicesPage.dispatchUnavailable")}</Badge>
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const { capacity, queue, stats, reliability } = data;

  return (
    <Card className="max-w-xl" data-testid="dispatch-health">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t("devicesPage.dispatchQueue")}</CardTitle>
        <Badge tone={capacity.atCapacity ? "warning" : "neutral"}>
          {t("devicesPage.inFlight", { count: capacity.inFlight, total: capacity.maxConcurrency })}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {queue.depth === 0 ? (
          <p className="text-sm text-muted-foreground">{t("devicesPage.queueClear")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="dispatch-health-queue">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pb-1 font-medium">{t("devicesPage.agent")}</th>
                  <th className="pb-1 font-medium">{t("devicesPage.whyWaiting")}</th>
                  <th className="pb-1 font-medium text-right">{t("devicesPage.waited")}</th>
                </tr>
              </thead>
              <tbody>
                {queue.items.map((item) => {
                  const reason = REASON[item.blockedReason] ?? { tone: "neutral" as const, label: item.blockedReason };
                  return (
                    <tr key={item.invocationId} className="border-t border-border">
                      <td className="py-1 pr-2 font-mono">{item.agentName ?? item.agentId ?? "—"}</td>
                      <td className="py-1 pr-2">
                        <Badge tone={reason.tone}>{reason.label}</Badge>
                        {item.dispatchAttempts > 1 ? (
                          <span className="ml-1 text-muted-foreground">·{item.dispatchAttempts} tries</span>
                        ) : null}
                      </td>
                      <td className="py-1 text-right tabular-nums text-muted-foreground">{formatDuration(item.queuedForMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {stats.indeterminate ? (
            <>Dispatch latency: not enough data yet ({stats.sampleSize} settled).</>
          ) : (
            <>
              Median time to dispatch <span className="text-foreground">{formatDuration(stats.medianMsToDispatch)}</span>
              {" · "}redelivery <span className="text-foreground">{pct(stats.redeliveryRate)}</span>
              {stats.exhaustedCount > 0 ? (
                <>
                  {" · "}
                  <span className="text-foreground">{stats.exhaustedCount}</span> exhausted
                </>
              ) : null}
            </>
          )}
        </p>
        <div className="grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs" data-testid="runtime-reliability">
          <div><span className="block text-muted-foreground">{t("devicesPage.failover")}</span><strong>{t("devicesPage.recovered", { count: reliability.failover.recovered, total: reliability.failover.attempts })}</strong></div>
          <div><span className="block text-muted-foreground">{t("devicesPage.claims")}</span><strong>{t("devicesPage.active", { count: reliability.claims.active })}</strong>{reliability.claims.expired ? <span className="block text-warning">{t("devicesPage.expired", { count: reliability.claims.expired })}</span> : null}</div>
          <div><span className="block text-muted-foreground">{t("devicesPage.intervention")}</span><strong className={reliability.intervention.required ? "text-destructive" : ""}>{reliability.intervention.required ? t("devicesPage.needReview", { count: reliability.intervention.required }) : t("devicesPage.none")}</strong></div>
        </div>
      </CardContent>
    </Card>
  );
}
