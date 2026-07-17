import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { SectionHeading } from "@/components/common/section-heading";
import { useConsoleState } from "@/data/use-console-state";
import { api, useAsyncAction } from "@/data/use-console-actions";
import type { ChannelDelivery, ChannelOperations } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";

function healthTone(health: string): Tone {
  if (health === "attention") return "danger";
  if (health === "idle") return "neutral";
  return "success";
}

function statusTone(status: string): Tone {
  if (status === "enabled") return "success";
  if (status === "disabled") return "warning";
  return "neutral";
}

/**
 * Channels operations surface (#1090, S7). Readiness is booleans only — no
 * secret ever reaches the client. Enable and failed-delivery retry are
 * approval-gated: the client mints a single-use grant, then calls the action.
 */
export function ChannelsView() {
  const { data: state } = useConsoleState();
  const channels = state?.channelOperations ?? [];

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Messaging"
        title="Channels"
        description="Bidirectional messaging channels (WeCom). Credentials live in the gateway — the console shows readiness, health, and delivery state, never secret values."
      />
      {channels.length === 0 ? (
        <EmptyState
          title="No channels registered"
          hint="Register a WeCom channel via the API, then map operator identities and enable intake here."
        />
      ) : (
        <div className="space-y-4">
          {channels.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              deliveries={(state?.channelDeliveries ?? []).filter((d) => d.channelId === channel.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelCard({ channel, deliveries }: { channel: ChannelOperations; deliveries: ChannelDelivery[] }) {
  const { execute, pending, error } = useAsyncAction();

  const failed = useMemo(() => deliveries.filter((d) => d.status === "failed_terminal"), [deliveries]);

  async function enable() {
    const grant = await api.issueApprovalGrant("channel.enable", channel.id);
    await execute(() => api.enableChannel(channel.id, grant.token));
  }

  async function disable() {
    await execute(() => api.disableChannel(channel.id));
  }

  async function retry(deliveryId: string) {
    const grant = await api.issueApprovalGrant("channel.delivery.retry", deliveryId);
    await execute(() => api.retryChannelDelivery(channel.id, deliveryId, grant.token));
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{channel.name}</span>
              <Badge tone="neutral">{channel.provider}</Badge>
              <Badge tone={statusTone(channel.status)}>{channel.status}</Badge>
              <Badge tone={healthTone(channel.health)}>{channel.health}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {channel.counts.identities} identities · {channel.counts.conversations} conversations · {channel.counts.events} events
              {channel.counts.injectionFlagged > 0 ? ` · ${channel.counts.injectionFlagged} flagged` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            {channel.status === "enabled" ? (
              <Button variant="secondary" size="sm" onClick={disable} disabled={pending}>
                Disable
              </Button>
            ) : (
              <Button size="sm" onClick={enable} disabled={pending}>
                Enable
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {Object.entries(channel.readiness).map(([scope, ok]) => (
            <div key={scope} className="flex items-center gap-2 text-xs">
              <Badge tone={ok ? "success" : "danger"}>{ok ? "ready" : "missing"}</Badge>
              <span className="text-muted-foreground">{scope}</span>
            </div>
          ))}
        </div>

        {channel.capabilityAllowlist.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Allowlist: {channel.capabilityAllowlist.join(", ")}
            {channel.statusCapability ? ` · /status → ${channel.statusCapability}` : ""}
          </p>
        )}

        {failed.length > 0 && (
          <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-xs font-medium text-destructive">
              {failed.length} failed {failed.length === 1 ? "delivery" : "deliveries"}
            </p>
            {failed.map((delivery) => (
              <div key={delivery.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono text-muted-foreground">
                  {delivery.id} · {delivery.attempts} attempts · errcode {delivery.lastErrorCode ?? "—"}
                </span>
                <Button variant="secondary" size="sm" onClick={() => retry(delivery.id)} disabled={pending}>
                  Retry
                </Button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
