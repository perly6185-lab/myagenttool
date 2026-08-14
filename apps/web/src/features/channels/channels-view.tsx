import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/common/empty-state";
import { SectionHeading } from "@/components/common/section-heading";
import { useConsoleState } from "@/data/use-console-state";
import { api, useAsyncAction } from "@/data/use-console-actions";
import type { ChannelDelivery, ChannelInteraction, ChannelOperations, ChannelTaskRequest, ProjectSnapshot } from "@/lib/console-state";
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

function interactionStatusTone(status: string): Tone {
  if (status === "delivered" || status === "imported") return "success";
  if (status === "failed_terminal") return "danger";
  if (status === "retrying" || status === "sending") return "warning";
  return "neutral";
}

function interactionTypeKey(type: string): string {
  return ["text", "image", "voice", "file", "mixed"].includes(type) ? type : "mixed";
}

type Translate = ReturnType<typeof useAppTranslation>["t"];

function translateDynamic(t: Translate, key: string): string {
  return t(key as never) as string;
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
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupChannelId, setSetupChannelId] = useState<string | null>(null);

  function openSetup(channelId: string | null = null) {
    setSetupChannelId(channelId);
    setSetupOpen(true);
  }

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow={t("channelsPage.messaging")}
        title={t("channelsPage.title")}
        description={t("channelsPage.description")}
        actions={<Button size="sm" onClick={() => setupOpen ? setSetupOpen(false) : openSetup()}>{t("channelsPage.addWechat")}</Button>}
      />
      {setupOpen ? <IlinkSetupPanel channelId={setupChannelId} onClose={() => { setSetupOpen(false); setSetupChannelId(null); }} /> : null}
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
              onReconnect={(channelId) => openSetup(channelId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type IlinkWizard = {
  channelId: string;
  stage: "scan" | "activate" | "pair" | "done";
  status: string;
  imageUrl?: string;
  expiresAt?: string;
  pairCode?: string;
};

function IlinkSetupPanel({ channelId = null, onClose }: { channelId?: string | null; onClose: () => void }) {
  const { t } = useAppTranslation();
  const { execute, pending, error } = useAsyncAction();
  const [name, setName] = useState("");
  const [wizard, setWizard] = useState<IlinkWizard | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrPreview, setQrPreview] = useState<string>();

  async function startLogin(existingChannelId: string) {
    const started = await api.startIlinkLogin(existingChannelId) as { status?: string; qr?: { imageUrl?: string; expiresAt?: string } };
    setWizard({ channelId: existingChannelId, stage: "scan", status: String(started.status ?? "waiting_scan"), imageUrl: started.qr?.imageUrl, expiresAt: started.qr?.expiresAt });
  }

  useEffect(() => {
    if (!channelId) return undefined;
    void execute(() => startLogin(channelId));
    return undefined;
  }, [channelId]);

  useEffect(() => {
    const content = wizard?.imageUrl;
    if (!content) {
      setQrPreview(undefined);
      return undefined;
    }
    if (content.startsWith("data:image/")) {
      setQrPreview(content);
      return undefined;
    }
    let active = true;
    void QRCode.toDataURL(content, { width: 320, margin: 1, errorCorrectionLevel: "M" })
      .then((dataUrl) => { if (active) setQrPreview(dataUrl); })
      .catch(() => { if (active) setQrPreview(undefined); });
    return () => { active = false; };
  }, [wizard?.imageUrl]);

  useEffect(() => {
    if (!wizard || wizard.stage !== "scan") return undefined;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const result = await api.pollIlinkLogin(wizard.channelId) as { status?: string; qr?: { imageUrl?: string; expiresAt?: string }; account?: { status?: string } };
        if (!active) return;
        const status = String(result.status ?? result.account?.status ?? "waiting_scan");
        if (["authenticated", "pairing", "connected"].includes(status)) {
          setWizard((current) => current ? { ...current, stage: "activate", status } : current);
        } else {
          const expired = ["expired", "timeout", "refused", "reauth_required", "error"].includes(status);
          setWizard((current) => current ? {
            ...current,
            status,
            imageUrl: result.qr?.imageUrl ?? (expired ? undefined : current.imageUrl),
            expiresAt: result.qr?.expiresAt ?? current.expiresAt,
          } : current);
        }
      } catch {
        // The next poll surfaces transient network failures without losing the QR.
      } finally {
        if (active) timer = window.setTimeout(() => void poll(), 1_500);
      }
    };
    void poll();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [wizard?.channelId, wizard?.stage]);

  useEffect(() => {
    if (!wizard || wizard.stage !== "pair") return undefined;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const result = await api.pollIlinkLogin(wizard.channelId) as { account?: { status?: string } };
        if (active && result.account?.status === "connected") setWizard((current) => current ? { ...current, stage: "done", status: "connected" } : current);
      } catch {
        // Keep the binding step visible; the next poll can recover.
      } finally {
        if (active) timer = window.setTimeout(() => void poll(), 1_500);
      }
    };
    void poll();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [wizard?.channelId, wizard?.stage]);

  async function connect() {
    await execute(async () => {
      const registered = await api.registerChannel("wechat_ilink", name.trim() || t("channelsPage.channelNamePlaceholder"));
      await startLogin(registered.channel.id);
    });
  }

  async function reconnect() {
    if (!wizard) return;
    await execute(() => startLogin(wizard.channelId));
  }

  async function activate() {
    if (!wizard) return;
    await execute(async () => {
      const grant = await api.issueApprovalGrant("channel.enable", wizard.channelId);
      const activated = await api.activateIlinkChannel(wizard.channelId, grant.token) as { pairCode?: string; account?: { status?: string } };
      setWizard((current) => current ? { ...current, stage: "pair", status: String(activated.account?.status ?? "pairing"), pairCode: activated.pairCode } : current);
    });
  }

  async function copyPairCode() {
    if (!wizard?.pairCode) return;
    await navigator.clipboard?.writeText(`绑定 ${wizard.pairCode}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        {!wizard ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-56 flex-1 space-y-1 text-sm">
              <span className="text-muted-foreground">{t("channelsPage.channelName")}</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("channelsPage.channelNamePlaceholder")} disabled={pending} />
            </label>
            <Button onClick={() => void connect()} disabled={pending}>{pending ? t("channelsPage.connecting") : t("channelsPage.connect")}</Button>
            <Button variant="ghost" onClick={onClose} disabled={pending}>{t("channelsPage.dismiss")}</Button>
          </div>
        ) : null}

        {wizard?.stage === "scan" ? (
          <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
            <div className="flex min-h-44 items-center justify-center rounded-md border border-border bg-white p-2">
              {qrPreview ? <img src={qrPreview} alt={t("channelsPage.scanTitle")} className="h-40 w-40 object-contain" /> : <span className="text-center text-xs text-muted-foreground">{t("channelsPage.qrUnavailable")}</span>}
            </div>
            <div className="space-y-2">
              <h3 className="font-medium">{t("channelsPage.scanTitle")}</h3>
              <p className="text-sm text-muted-foreground">{t("channelsPage.scanHint")}</p>
              <Badge tone={["expired", "reauth_required", "error"].includes(wizard.status) ? "warning" : "neutral"}>{wizard.status === "scanned" ? t("channelsPage.scanned") : ["expired", "reauth_required", "error"].includes(wizard.status) ? t("channelsPage.setupFailed") : t("channelsPage.waitingScan")}</Badge>
              {["expired", "reauth_required", "error"].includes(wizard.status) ? <Button variant="secondary" size="sm" onClick={() => void reconnect()} disabled={pending}>{t("channelsPage.reconnect")}</Button> : null}
            </div>
          </div>
        ) : null}

        {wizard?.stage === "activate" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="font-medium">{t("channelsPage.authenticated")}</h3><p className="text-sm text-muted-foreground">{t("channelsPage.pairHint")}</p></div>
            <Button onClick={() => void activate()} disabled={pending}>{t("channelsPage.activate")}</Button>
          </div>
        ) : null}

        {wizard?.stage === "pair" ? (
          <div className="space-y-3">
            <h3 className="font-medium">{t("channelsPage.pairTitle")}</h3>
            <p className="text-sm text-muted-foreground">{t("channelsPage.pairHint")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md border border-border bg-muted px-3 py-2 text-sm">绑定 {wizard.pairCode}</code>
              <Button variant="secondary" size="sm" onClick={() => void copyPairCode()}>{copied ? t("channelsPage.copyDone") : t("channelsPage.copy")}</Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("channelsPage.pairWaiting")}</p>
          </div>
        ) : null}

        {wizard?.stage === "done" ? <p className="font-medium text-emerald-600">{t("channelsPage.pairDone")}</p> : null}
        {error ? <p className="text-sm text-destructive">{error || t("channelsPage.setupFailed")}</p> : null}
      </CardContent>
    </Card>
  );
}

function ChannelCard({ channel, deliveries, projects, tasks, onReconnect }: { channel: ChannelOperations; deliveries: ChannelDelivery[]; projects: ProjectSnapshot[]; tasks: ChannelTaskRequest[]; onReconnect: (channelId: string) => void }) {
  const { t } = useAppTranslation();
  const { execute, pending, error } = useAsyncAction();
  const [taskProject, setTaskProject] = useState(channel.taskProjectId ?? "");
  const [autoRoute, setAutoRoute] = useState(Boolean(channel.taskAutoRoute));
  const [dailyLimit, setDailyLimit] = useState(channel.taskDailyLimit ?? 50);
  const [interactionsOpen, setInteractionsOpen] = useState(false);
  const [interactionDirection, setInteractionDirection] = useState("all");
  const [interactionType, setInteractionType] = useState("all");
  const [interactionStatus, setInteractionStatus] = useState("all");
  const [interactionQuery, setInteractionQuery] = useState("");
  const [interactionCursor, setInteractionCursor] = useState<string | null>(null);
  const [interactionItems, setInteractionItems] = useState<ChannelInteraction[]>([]);
  const [interactionNextCursor, setInteractionNextCursor] = useState<string | null>(null);
  const [interactionLoading, setInteractionLoading] = useState(false);
  const [interactionError, setInteractionError] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = channel.taskDayDate === today ? (channel.taskDayCount ?? 0) : 0;

  useEffect(() => {
    if (!interactionsOpen) return undefined;
    let active = true;
    const load = async () => {
      setInteractionLoading(true);
      setInteractionError(false);
      try {
        const result = await api.listChannelInteractions(channel.id, {
          direction: interactionDirection,
          type: interactionType,
          status: interactionStatus,
          query: interactionQuery,
          cursor: interactionCursor,
          limit: 50,
        });
        if (!active) return;
        setInteractionItems((current) => interactionCursor ? [...current, ...result.interactions] : result.interactions);
        setInteractionNextCursor(result.nextCursor);
      } catch {
        if (active) setInteractionError(true);
      } finally {
        if (active) setInteractionLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (!interactionCursor) void load();
    }, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [channel.id, interactionDirection, interactionType, interactionStatus, interactionQuery, interactionCursor, interactionsOpen]);

  const failed = useMemo(() => deliveries.filter((d) => d.status === "failed_terminal"), [deliveries]);

  async function enable() {
    const grant = await api.issueApprovalGrant("channel.enable", channel.id);
    await execute(() => api.enableChannel(channel.id, grant.token));
  }

  async function disable() {
    await execute(() => api.disableChannel(channel.id));
  }

  async function disconnectIlink() {
    await execute(() => api.disconnectIlinkChannel(channel.id));
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

  function resetInteractionCursor() {
    setInteractionCursor(null);
    setInteractionItems([]);
    setInteractionNextCursor(null);
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
              <Badge tone="neutral">{channel.provider === "wechat_ilink" ? t("channelsPage.providerWechat") : channel.provider}</Badge>
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
            {channel.provider === "wechat_ilink" && channel.status !== "enabled" ? null : channel.status === "enabled" ? (
              <Button variant="secondary" size="sm" onClick={disable} disabled={pending}>
                {t("channelsPage.disable")}
              </Button>
            ) : (
              <Button size="sm" onClick={enable} disabled={pending}>
                {t("channelsPage.enable")}
              </Button>
            )}
            {channel.provider === "wechat_ilink" && channel.status !== "enabled" ? <Button variant="secondary" size="sm" onClick={() => onReconnect(channel.id)} disabled={pending}>{t("channelsPage.reconnect")}</Button> : null}
            {channel.provider === "wechat_ilink" ? <Button variant="ghost" size="sm" onClick={() => void disconnectIlink()} disabled={pending}>{t("channelsPage.disconnect")}</Button> : null}
            <Button variant="secondary" size="sm" onClick={() => setInteractionsOpen((open) => !open)}>
              {interactionsOpen ? t("channelsPage.hideInteractions") : t("channelsPage.viewInteractions")}
            </Button>
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

        {interactionsOpen ? <ChannelInteractionPanel
          t={t}
          interactions={interactionItems}
          nextCursor={interactionNextCursor}
          loading={interactionLoading}
          error={interactionError}
          direction={interactionDirection}
          type={interactionType}
          status={interactionStatus}
          query={interactionQuery}
          onDirectionChange={(value) => { setInteractionDirection(value); resetInteractionCursor(); }}
          onTypeChange={(value) => { setInteractionType(value); resetInteractionCursor(); }}
          onStatusChange={(value) => { setInteractionStatus(value); resetInteractionCursor(); }}
          onQueryChange={(value) => { setInteractionQuery(value); resetInteractionCursor(); }}
          onLoadMore={() => setInteractionCursor(interactionNextCursor)}
        /> : null}

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

function ChannelInteractionPanel({
  t,
  interactions,
  nextCursor,
  loading,
  error,
  direction,
  type,
  status,
  query,
  onDirectionChange,
  onTypeChange,
  onStatusChange,
  onQueryChange,
  onLoadMore,
}: {
  t: Translate;
  interactions: ChannelInteraction[];
  nextCursor: string | null;
  loading: boolean;
  error: boolean;
  direction: string;
  type: string;
  status: string;
  query: string;
  onDirectionChange: (value: string) => void;
  onTypeChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onLoadMore: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3" data-testid="channel-interactions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("channelsPage.interactions")}</p>
        <span className="text-xs text-muted-foreground">{t("channelsPage.showingInteractions", { count: interactions.length })}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <select className="h-8 rounded-md border border-border bg-background px-2 text-xs" value={direction} onChange={(event) => onDirectionChange(event.target.value)}>
          <option value="all">{t("channelsPage.allDirections")}</option>
          <option value="inbound">{t("channelsPage.inbound")}</option>
          <option value="outbound">{t("channelsPage.outbound")}</option>
        </select>
        <select className="h-8 rounded-md border border-border bg-background px-2 text-xs" value={type} onChange={(event) => onTypeChange(event.target.value)}>
          <option value="all">{t("channelsPage.allTypes")}</option>
          {(["text", "image", "voice", "file", "mixed"] as const).map((value) => <option key={value} value={value}>{translateDynamic(t, `channelsPage.${value}`)}</option>)}
        </select>
        <select className="h-8 rounded-md border border-border bg-background px-2 text-xs" value={status} onChange={(event) => onStatusChange(event.target.value)}>
          <option value="all">{t("channelsPage.allStatuses")}</option>
          <option value="imported">{t("channelsPage.inbound")}</option>
          <option value="delivered">{t("channelsPage.delivered")}</option>
          <option value="queued">{t("channelsPage.queued")}</option>
          <option value="sending">{t("channelsPage.sending")}</option>
          <option value="retrying">{t("channelsPage.retrying")}</option>
          <option value="failed_terminal">{t("channelsPage.failedTerminal")}</option>
        </select>
        <Input className="h-8 min-w-48 flex-1 text-xs" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t("channelsPage.searchInteractions")} />
      </div>
      {error ? <p className="text-xs text-destructive">{t("channelsPage.interactionLoadFailed")}</p> : null}
      {loading && !interactions.length ? <p className="text-xs text-muted-foreground">{t("channelsPage.interactionLoading")}</p> : null}
      {!loading && !error && !interactions.length ? <p className="text-xs text-muted-foreground">{t("channelsPage.interactionEmpty")}</p> : null}
      <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
        {interactions.map((interaction) => <InteractionRow key={`${interaction.direction}-${interaction.id}`} interaction={interaction} t={t} />)}
      </div>
      {nextCursor ? <Button variant="secondary" size="sm" onClick={onLoadMore} disabled={loading}>{t("channelsPage.loadMore")}</Button> : null}
    </div>
  );
}

function InteractionRow({ interaction, t }: { interaction: ChannelInteraction; t: Translate }) {
  const typeLabel = translateDynamic(t, `channelsPage.${interactionTypeKey(interaction.type)}`);
  const time = interaction.createdAt ? new Date(interaction.createdAt).toLocaleString() : "—";
  return (
    <div className={`rounded-md border p-3 text-xs ${interaction.direction === "outbound" ? "ml-4 border-primary/20 bg-primary/5" : "mr-4 border-border bg-background"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={interaction.direction === "inbound" ? "neutral" : "success"}>{translateDynamic(t, `channelsPage.${interaction.direction}`)}</Badge>
        <Badge tone="neutral">{typeLabel}</Badge>
        <Badge tone={interactionStatusTone(interaction.status)}>{interaction.status === "imported" ? t("channelsPage.inbound") : interaction.status === "failed_terminal" ? t("channelsPage.failedTerminal") : translateDynamic(t, `channelsPage.${interaction.status}`)}</Badge>
        <span className="ml-auto text-muted-foreground">{time}</span>
      </div>
      {interaction.content ? <p className="mt-2 whitespace-pre-wrap break-words text-sm">{interaction.content}</p> : <p className="mt-2 text-muted-foreground">{t("channelsPage.noContent")}</p>}
      {interaction.injectionSuspicious ? <p className="mt-2 text-amber-600">⚠ {t("channelsPage.flagged")}</p> : null}
      {interaction.attachments.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {interaction.attachments.map((asset) => {
            const href = asset.projectId && asset.path
              ? `/?section=documents&project=${encodeURIComponent(asset.projectId)}&document=${encodeURIComponent(asset.path)}`
              : undefined;
            return href
              ? <a key={`${asset.id ?? asset.name}-${asset.path}`} className="rounded border border-border px-2 py-1 text-primary hover:underline" href={href}>{asset.name} · {asset.family}</a>
              : <span key={`${asset.id ?? asset.name}-${asset.path ?? "asset"}`} className="rounded border border-border px-2 py-1">{asset.name} · {asset.family}</span>;
          })}
        </div>
      ) : null}
      {interaction.direction === "outbound" && interaction.lastErrorCode ? <p className="mt-2 text-destructive">{interaction.lastErrorCode} · {interaction.attempts ?? 0} attempts</p> : null}
    </div>
  );
}
