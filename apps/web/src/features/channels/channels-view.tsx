import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { SectionHeading } from "@/components/common/section-heading";
import { useConsoleState } from "@/data/use-console-state";
import { api, useAsyncAction } from "@/data/use-console-actions";
import type { ChannelDelivery, ChannelOperations, ChannelTaskRequest, ProjectSnapshot } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

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
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const channels = state?.channelOperations ?? [];

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow={t("channelsPage.messaging")}
        title={t("channelsPage.title")}
        description={t("channelsPage.description")}
      />
      {channels.length === 0 ? (
        <EmptyState
          title={t("channelsPage.empty")}
          hint={t("channelsPage.emptyHint")}
        />
      ) : (
        <div className="space-y-4">
          {channels.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              deliveries={(state?.channelDeliveries ?? []).filter((d) => d.channelId === channel.id)}
              projects={(state?.projects ?? []).filter((p) => p.status !== "archived")}
              tasks={(state?.channelTaskRequests ?? []).filter((task) => task.channelId === channel.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelCard({ channel, deliveries, projects, tasks }: { channel: ChannelOperations; deliveries: ChannelDelivery[]; projects: ProjectSnapshot[]; tasks: ChannelTaskRequest[] }) {
  const { t } = useAppTranslation();
  const { execute, pending, error } = useAsyncAction();
  const [taskProject, setTaskProject] = useState(channel.taskProjectId ?? "");
  const [autoRoute, setAutoRoute] = useState(Boolean(channel.taskAutoRoute));
  const [dailyLimit, setDailyLimit] = useState(channel.taskDailyLimit ?? 50);
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = channel.taskDayDate === today ? (channel.taskDayCount ?? 0) : 0;

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

  async function toggleSelfApprove(next: boolean) {
    const grant = await api.issueApprovalGrant("channel.approvalPolicy", channel.id);
    await execute(() => api.setChannelApprovalPolicy(channel.id, next, grant.token));
  }

  async function saveTaskProject() {
    const grant = await api.issueApprovalGrant("channel.taskProject", channel.id);
    await execute(() => api.setChannelTaskProject(channel.id, taskProject || null, autoRoute, dailyLimit, grant.token));
  }

  async function taskAction(task: ChannelTaskRequest, action: "route" | "dismiss" | "retry" | "reroute" | "takeover") {
    const handlers = { route: api.routeChannelTask, dismiss: api.dismissChannelTask, retry: api.retryChannelTask, reroute: api.rerouteChannelTask, takeover: api.takeoverChannelTask };
    await execute(() => handlers[action](task.id));
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
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1 text-xs text-muted-foreground" title={t("channelsPage.approveHint")}>
              <input type="checkbox" checked={Boolean(channel.allowSelfApprove)} onChange={(e) => toggleSelfApprove(e.target.checked)} disabled={pending} />
              {t("channelsPage.inChannelApprove")}
            </label>
            {channel.status === "enabled" ? (
              <Button variant="secondary" size="sm" onClick={disable} disabled={pending}>
                {t("channelsPage.disable")}
              </Button>
            ) : (
              <Button size="sm" onClick={enable} disabled={pending}>
                {t("channelsPage.enable")}
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {Object.entries(channel.readiness).map(([scope, ok]) => (
            <div key={scope} className="flex items-center gap-2 text-xs">
              <Badge tone={ok ? "success" : "danger"}>{ok ? t("channelsPage.ready") : t("channelsPage.missing")}</Badge>
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

        {/* /task target: the project inbound tasks are filed into as tracked
            GitHub issues. Approval-gated (mints a grant), same as enable. */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t("channelsPage.taskProject")} (/task →)</span>
          <select
            className="h-7 rounded-md border border-border bg-background px-1.5"
            value={taskProject}
            onChange={(e) => setTaskProject(e.target.value)}
            disabled={pending}
          >
            <option value="">— {t("channelsPage.noneDisabled")} —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-muted-foreground">
            <input type="checkbox" checked={autoRoute} onChange={(e) => setAutoRoute(e.target.checked)} disabled={pending || !taskProject} />
            {t("channelsPage.autoRoute")}
          </label>
          <label className="flex items-center gap-1 text-muted-foreground">
            <input
              type="number" min={0} max={10000}
              className="h-6 w-16 rounded border border-border bg-background px-1"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              disabled={pending || !taskProject}
            />
            /{t("channelsPage.day")}
          </label>
          {taskProject ? <span className="text-muted-foreground">{usedToday}/{channel.taskDailyLimit ?? 50} {t("channelsPage.today")}</span> : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={saveTaskProject}
            disabled={pending || ((channel.taskProjectId ?? "") === taskProject && Boolean(channel.taskAutoRoute) === autoRoute && (channel.taskDailyLimit ?? 50) === dailyLimit)}
          >
            {t("channelsPage.save")}
          </Button>
          {channel.taskProjectId ? (
            <Badge tone="success">{channel.taskAutoRoute ? t("channelsPage.autoRoute") : t("channelsPage.capture")}</Badge>
          ) : (
            <span className="text-muted-foreground">{t("channelsPage.unbound")}</span>
          )}
        </div>

        {tasks.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3" data-testid="channel-task-operations">
            <p className="text-xs font-medium">{t("channelsPage.tasks")}</p>
            {tasks.slice().reverse().slice(0, 10).map((task) => (
              <div key={task.id} className="grid gap-2 rounded-md border border-border p-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={task.stage.includes("failed") || task.stage === "run_blocked" ? "danger" : task.stage === "run_succeeded" ? "success" : "neutral"}>{task.stage.replaceAll("_", " ")}</Badge>
                    <a className="text-primary underline-offset-2 hover:underline" href={task.issueUrl ?? undefined} target="_blank" rel="noreferrer">Issue #{task.issueNumber}</a>
                    {task.invocationId ? <span className="font-mono text-muted-foreground">{task.invocationId}</span> : null}
                    {task.deliveryStatus ? <span className="text-muted-foreground">delivery {task.deliveryStatus.replaceAll("_", " ")}</span> : null}
                  </div>
                  <p className="truncate font-medium" title={task.title}>{task.title}</p>
                  {task.resultSummary ? <p className="line-clamp-2 text-muted-foreground">{task.resultSummary}</p> : null}
                </div>
                <div className="flex flex-wrap items-start gap-1.5">
                  {task.status === "pending" ? <><Button size="sm" onClick={() => taskAction(task, "route")} disabled={pending}>{t("channelsPage.route")}</Button><Button variant="ghost" size="sm" onClick={() => taskAction(task, "dismiss")} disabled={pending}>{t("channelsPage.dismiss")}</Button></> : null}
                  {task.actions.retry ? <Button variant="secondary" size="sm" onClick={() => taskAction(task, "retry")} disabled={pending}>{t("channelsPage.retry")}</Button> : null}
                  {task.actions.reroute ? <Button variant="secondary" size="sm" onClick={() => taskAction(task, "reroute")} disabled={pending}>{t("channelsPage.reroute")}</Button> : null}
                  {task.actions.takeover ? <Button variant="ghost" size="sm" onClick={() => taskAction(task, "takeover")} disabled={pending}>{t("channelsPage.takeover")}</Button> : null}
                </div>
              </div>
            ))}
          </div>
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
