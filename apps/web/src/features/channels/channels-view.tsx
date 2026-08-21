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
import type { ChannelConversation, ChannelDelivery, ChannelDiagnostics, ChannelInteraction, ChannelLifecycleSummary, ChannelNotificationPolicy, ChannelOperations, ChannelTaskRequest, ChannelTaskRevision, ChannelTaskThread, DeviceSnapshot, ProjectSnapshot } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";
import { installChannelTranslations } from "@/lib/i18n/channel-resources";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useUiStore } from "@/store/ui-store";
import { ArticleExtractorPluginsPanel } from "./article-extractor-plugins-panel";

installChannelTranslations();

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

type Translate = ReturnType<typeof useAppTranslation>["t"];

function healthLabel(t: Translate, health: string): string {
  if (health === "attention") return t("channelsPage.healthAttention");
  if (health === "idle") return t("channelsPage.healthIdle");
  return t("channelsPage.healthOk");
}

function readinessLabel(t: Translate, scope: string): string {
  const labels: Record<string, string> = {
    account: "channelsPage.readinessAccount",
    session: "channelsPage.readinessSession",
    worker: "channelsPage.readinessWorker",
  };
  return t((labels[scope] ?? scope) as never) as string;
}

function ilinkConnectionLabel(t: Translate, channel: ChannelOperations): string | null {
  if (channel.provider !== "wechat_ilink") return null;
  if (channel.status === "enabled" && channel.readiness.session && !channel.readiness.worker && channel.health === "attention") return t("channelsPage.connectionRetrying");
  if (channel.readiness.worker) return t("channelsPage.connectionConnected");
  if (channel.readiness.session) return t("channelsPage.connectionAuthorized");
  if (channel.readiness.account) return t("channelsPage.connectionNeedsLogin");
  return t("channelsPage.connectionUnregistered");
}

function ilinkRuntimeStatusLabel(account: ChannelOperations["ilinkAccount"]): string {
  const labels: Record<string, string> = {
    disconnected: "未连接",
    waiting_scan: "等待扫码",
    scanned: "已扫码，等待确认",
    verification_required: "等待验证码",
    authenticated: "已授权，等待启动",
    reconnecting: "重新连接中",
    pairing: "等待绑定",
    connected: "已绑定并在线",
    error: "连接异常",
    reauth_required: "需要重新授权",
    expired: "二维码已过期",
    stopped: "已停止",
  };
  const status = String(account?.status ?? "").trim();
  return labels[status] ?? (status || "未建立连接");
}

function ilinkRuntimeErrorLabel(error: string | null | undefined): string | null {
  if (!error) return null;
  const labels: Record<string, string> = {
    network_error: "无法连接腾讯 iLink 服务，请检查网络后重试",
    timeout: "连接腾讯 iLink 服务超时，请稍后重试",
    ilink_qr_expired: "二维码已过期，请重新扫码",
    ilink_already_bound: "该账号已绑定其他 ClawBot，请先解除原连接",
    ilink_verify_code_required: "需要输入微信返回的验证码",
    ilink_verify_code_blocked: "验证码尝试次数已用完，请重新扫码",
    auth_expired: "授权已失效，请重新扫码授权",
    message_processing_failed: "上一条消息处理失败，系统正在自动重试",
    worker_error: "消息接收服务异常，系统正在自动重试",
  };
  return labels[error] ?? `最近连接提示：${error}`;
}

function readableChannelError(error: string | null, t: Translate): string | null {
  if (!error) return null;
  if (error.includes("channel_already_registered")) return t("channelsPage.channelAlreadyRegistered");
  if (error.includes("ilink_already_bound")) return t("channelsPage.alreadyBound");
  if (error.includes("ilink_verify_code_blocked")) return t("channelsPage.verificationBlocked");
  if (error.includes("network_error") || error.includes("qr_unavailable") || error.includes("qr_status_failed") || error.includes("transport_error")) return t("channelsPage.qrNetworkFailed");
  if (error.includes("ilink_qr_missing")) return t("channelsPage.qrUnavailable");
  if (error.includes("ilink_baseurl_invalid") || error.includes("ilink_redirect_invalid") || error.includes("ilink_login_missing_token")) return t("channelsPage.setupFailed");
  if (error.includes("ilink_qr_expired")) return t("channelsPage.qrExpired");
  if (error.includes("approval_required")) return t("channelsPage.setupFailed");
  return t("channelsPage.setupFailed");
}

function readableTaskError(error: string | null, t: Translate): string | null {
  if (!error) return null;
  if (error.includes("terminal_binding_required")) return t("channelsPage.taskDeviceRequired");
  if (error.includes("terminal_not_found")) return t("channelsPage.taskDeviceMissing");
  if (error.includes("project_not_found")) return t("channelsPage.taskProjectMissing");
  if (error.includes("approval_required")) return t("channelsPage.setupFailed");
  return t("channelsPage.taskSetupFailed");
}

function taskDeviceLabel(t: Translate, device: DeviceSnapshot): string {
  const status = device.status === "online"
    ? t("channelsPage.healthOk")
    : `${t("channelsPage.healthAttention")} · ${t("channelsPage.queued")}`;
  const runtimes = device.runtimeReadiness ?? [];
  const bridgeReady = runtimes.some((runtime) => runtime.status === "available" && runtime.authenticationStatus !== "unauthenticated");
  const bridgeLabel = runtimes.length === 0 ? "Bridge 状态未知" : bridgeReady ? "Bridge 可用" : "Bridge 待准备";
  return `${device.name} · ${status} · ${bridgeLabel}`;
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

const taskThreadStatusLabels: Record<string, string> = {
  awaiting_confirmation: "等待你确认",
  waiting_approval: "等待确认",
  queued: "排队中",
  running: "执行中",
  waiting_user: "等待你补充信息",
  needs_attention: "需要关注",
  paused: "已暂停",
  human_takeover: "人工处理中",
  succeeded: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};

function taskThreadStatusLabel(status: string, waitingFor?: string | null): string {
  if (status === "awaiting_confirmation" && waitingFor === "draft_input") return "等待补充需求";
  if (status === "waiting_approval" && waitingFor === "approval") return "等待桌面审批";
  if (status === "waiting_approval" && waitingFor === "data_sources") return "等待数据文件";
  if (status === "waiting_approval" && waitingFor === "data_review") return "等待数据复核";
  if (status === "waiting_approval" && waitingFor === "data_mutation") return "等待变更范围";
  if (status === "waiting_approval" && waitingFor === "execution_input") return "等待执行资料";
  return taskThreadStatusLabels[status] ?? status.replaceAll("_", " ");
}

function waitingForLabel(value: string): string {
  if (value === "confirmation") return "你确认";
  if (value === "draft_input") return "补充任务要求";
  if (value === "approval") return "桌面审批";
  if (value === "user_input") return "你补充信息";
  if (value === "data_sources") return "选择数据文件";
  if (value === "data_review") return "确认数据关联";
  if (value === "data_mutation") return "明确文件变更范围";
  if (value === "execution_input") return "补充执行资料";
  if (value === "attention") return "等待任务恢复";
  if (value === "human") return "人工处理";
  return value.replaceAll("_", " ");
}

function revisionTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    data_correction: "数据修正",
    interpretation_correction: "理解修正",
    template_correction: "模板修正",
    execution_correction: "执行修正",
    output_style_correction: "输出格式",
    acceptance_correction: "验收标准",
  };
  return labels[type] ?? type.replaceAll("_", " ");
}

function revisionStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    awaiting_confirmation: "待确认",
    confirmed: "已确认",
    cancelled: "已取消",
    failed: "处理失败",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

function translateDynamic(t: Translate, key: string): string {
  return t(key as never) as string;
}

function diagnosticTime(value: string | null | undefined): string {
  if (!value) return "暂无";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "暂无" : date.toLocaleString();
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
  const existingWechat = channels.find((channel) => channel.provider === "wechat_ilink");
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupChannelId, setSetupChannelId] = useState<string | null>(null);

  function openSetup(channelId: string | null = null) {
    const existingWechat = channels.find((channel) => channel.provider === "wechat_ilink");
    setSetupChannelId(channelId ?? existingWechat?.id ?? null);
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
      {setupOpen ? <IlinkSetupPanel channelId={setupChannelId} existingChannelId={existingWechat?.id ?? null} onClose={() => { setSetupOpen(false); setSetupChannelId(null); }} /> : null}
      {state?.channelIntentMetrics && state.channelIntentMetrics.total > 0 ? (
        <details className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground" data-testid="channel-intent-metrics">
          <summary className="cursor-pointer">高级诊断：意图理解</summary>
          <p className="mt-2">意图识别：{state.channelIntentMetrics.total} 次，低置信度 {state.channelIntentMetrics.lowConfidence ?? 0} 次，需澄清 {state.channelIntentMetrics.ambiguous ?? 0} 次{state.channelIntentMetrics.policyVersion ? `，策略 ${state.channelIntentMetrics.policyVersion}` : ""}</p>
          {state.channelIntentMetrics.bridge?.attempts ? <p className="mt-1">Bridge：{state.channelIntentMetrics.bridge.succeeded ?? 0} 成功 / {state.channelIntentMetrics.bridge.failed ?? 0} 失败，平均 {state.channelIntentMetrics.bridge.averageLatencyMs ?? "—"} ms{state.channelIntentMetrics.bridge.circuitOpen ? "，已自动降级本地识别" : ""}</p> : null}
          {state.channelIntentMetrics.experience ? <p className="mt-1">体验闭环：针对性澄清 {state.channelIntentMetrics.experience.targetedClarifications ?? 0}，明确只读 {state.channelIntentMetrics.experience.directReadOnlyTasks ?? 0}（本地直达 {state.channelIntentMetrics.experience.directLocalReadOnlyResults ?? 0}），复用/清理重复任务 {(state.channelIntentMetrics.experience.duplicateTasksReused ?? 0) + (state.channelIntentMetrics.experience.staleDuplicatesReconciled ?? 0)}，执行后续补充 {state.channelIntentMetrics.experience.activeFollowUpsQueued ?? 0}，重试通知去重 {state.channelIntentMetrics.experience.retryStartDuplicatesSuppressed ?? 0}，媒体回执 {state.channelIntentMetrics.experience.mediaReceipts ?? 0}</p> : null}
        </details>
      ) : null}
      {channels.length > 0 ? <QuickStartGuide /> : null}
      <details className="rounded-lg border border-border px-4 py-3" data-testid="channel-advanced-settings">
        <summary className="cursor-pointer text-sm font-medium">高级设置</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">普通分享流程不需要配置这些选项。只有需要管理特殊站点时才打开。</p>
          <ArticleExtractorPluginsPanel />
        </div>
      </details>
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
              conversations={(state?.channelConversations ?? []).filter((conversation) => conversation.channelId === channel.id)}
              deliveries={(state?.channelDeliveries ?? []).filter((d) => d.channelId === channel.id)}
              devices={state?.devices ?? []}
              projects={(state?.projects ?? []).filter((p) => p.status !== "archived")}
              tasks={(state?.channelTaskRequests ?? []).filter((task) => task.channelId === channel.id)}
              threads={(state?.channelTaskThreads ?? []).filter((thread) => thread.channelId === channel.id)}
              revisions={(state?.channelTaskRevisions ?? []).filter((revision) => revision.channelId === channel.id)}
              notificationPolicies={(state?.channelNotificationPolicies ?? []).filter((policy) => policy.channelId === channel.id)}
              lifecycleSummaries={(state?.channelLifecycleSummaries ?? []).filter((summary) => summary.projectId === channel.taskProjectId)}
              onReconnect={(channelId) => openSetup(channelId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QuickStartGuide() {
  return (
    <details className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3" data-testid="channel-quick-start">
      <summary className="cursor-pointer text-sm font-medium">快速上手：像聊天一样使用</summary>
      <div className="mt-3 grid gap-3 text-xs text-muted-foreground sm:grid-cols-3">
        <div><p className="font-medium text-foreground">1. 直接说需求</p><p className="mt-1">例如：帮我整理这份客户反馈。</p></div>
        <div><p className="font-medium text-foreground">2. 安全开始</p><p className="mt-1">明确的只读请求直接处理；修改或发送前会先展示影响并请你确认。</p></div>
        <div><p className="font-medium text-foreground">3. 随时补充和看进度</p><p className="mt-1">可以问“现在做到哪了”，也可以继续发送文字、图片、语音或文件。</p></div>
      </div>
    </details>
  );
}

type IlinkWizard = {
  channelId: string;
  stage: "scan" | "activate" | "pair" | "pair_expired" | "done";
  status: string;
  imageUrl?: string;
  expiresAt?: string;
  pairCode?: string;
  pairExpiresAt?: string;
};

function IlinkSetupPanel({ channelId = null, existingChannelId = null, onClose }: { channelId?: string | null; existingChannelId?: string | null; onClose: () => void }) {
  const { t } = useAppTranslation();
  const { execute, pending, error } = useAsyncAction();
  const [name, setName] = useState("");
  const [wizard, setWizard] = useState<IlinkWizard | null>(null);
  const [copied, setCopied] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [qrPreview, setQrPreview] = useState<string>();
  const [qrSecondsLeft, setQrSecondsLeft] = useState<number | null>(null);
  const [pairSecondsLeft, setPairSecondsLeft] = useState<number | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  async function startLogin(existingChannelId: string) {
    const started = await api.startIlinkLogin(existingChannelId) as { status?: string; qr?: { imageUrl?: string; expiresAt?: string } };
    setPollError(null);
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
    if (!wizard?.expiresAt || wizard.stage !== "scan") {
      setQrSecondsLeft(null);
      return undefined;
    }
    const update = () => {
      const seconds = Math.max(0, Math.ceil((Date.parse(wizard.expiresAt as string) - Date.now()) / 1_000));
      setQrSecondsLeft(seconds);
      if (seconds === 0) {
        setWizard((current) => current && current.status !== "expired"
          ? { ...current, status: "expired", imageUrl: undefined }
          : current);
      }
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [wizard?.stage, wizard?.expiresAt]);

  useEffect(() => {
    if (!wizard || wizard.stage !== "scan" || wizard.status === "verification_required") return undefined;
    let active = true;
    let timer: number | undefined;
    let terminal = false;
    const poll = async () => {
      try {
        const result = await api.pollIlinkLogin(wizard.channelId) as { status?: string; qr?: { imageUrl?: string; expiresAt?: string }; account?: { status?: string } };
        if (!active) return;
        setPollError(null);
        const status = String(result.status ?? result.account?.status ?? "waiting_scan");
        if (["authenticated", "pairing", "connected"].includes(status)) {
          setWizard((current) => current ? { ...current, stage: "activate", status } : current);
        } else {
          const expired = ["expired", "timeout", "refused", "reauth_required", "error"].includes(status);
          terminal = expired;
          setWizard((current) => current ? {
            ...current,
            status,
            imageUrl: result.qr?.imageUrl ?? (expired ? undefined : current.imageUrl),
            expiresAt: result.qr?.expiresAt ?? current.expiresAt,
          } : current);
        }
      } catch {
        if (active) setPollError(t("channelsPage.qrPollNetworkFailed"));
      } finally {
        if (active && !terminal) timer = window.setTimeout(() => void poll(), 1_500);
      }
    };
    void poll();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [wizard?.channelId, wizard?.stage, wizard?.status]);

  useEffect(() => {
    if (!wizard?.pairExpiresAt || wizard.stage !== "pair") {
      setPairSecondsLeft(null);
      return undefined;
    }
    const update = () => setPairSecondsLeft(Math.max(0, Math.ceil((Date.parse(wizard.pairExpiresAt as string) - Date.now()) / 1_000)));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [wizard?.stage, wizard?.pairExpiresAt]);

  async function submitVerificationCode() {
    if (!wizard || !verificationCode.trim()) return;
    await execute(async () => {
      const result = await api.pollIlinkLogin(wizard.channelId, verificationCode) as { status?: string; account?: { status?: string } };
      const status = String(result.status ?? result.account?.status ?? "verification_required");
      setVerificationCode("");
      setWizard((current) => current ? {
        ...current,
        status,
        stage: ["authenticated", "pairing", "connected"].includes(status) ? "activate" : current.stage,
      } : current);
    });
  }

  useEffect(() => {
    if (!wizard || wizard.stage !== "pair") return undefined;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const result = await api.pollIlinkLogin(wizard.channelId) as { account?: { status?: string; pairingStatus?: string } };
        const pairingExpired = result.account?.status === "pairing_expired" || result.account?.pairingStatus === "expired";
        if (active && pairingExpired) setWizard((current) => current ? { ...current, stage: "pair_expired", status: "pairing_expired", pairCode: undefined } : current);
        else if (active && result.account?.status === "connected") setWizard((current) => current ? { ...current, stage: "done", status: "connected" } : current);
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
      const activated = await api.activateIlinkChannel(wizard.channelId, grant.token) as { pairCode?: string; pairingExpiresAt?: string; account?: { status?: string } };
      setWizard((current) => current ? { ...current, stage: "pair", status: String(activated.account?.status ?? "pairing"), pairCode: activated.pairCode, pairExpiresAt: activated.pairingExpiresAt } : current);
    });
  }

  function continueWithExisting() {
    if (!existingChannelId) return;
    void execute(() => startLogin(existingChannelId));
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
              {qrPreview && wizard.status !== "expired" ? <img src={qrPreview} alt={t("channelsPage.scanTitle")} className="h-40 w-40 object-contain" /> : <span className="text-center text-xs text-muted-foreground">{wizard.status === "expired" ? t("channelsPage.qrExpired") : t("channelsPage.qrUnavailable")}</span>}
            </div>
            <div className="space-y-2">
              <h3 className="font-medium">{t("channelsPage.scanTitle")}</h3>
              <p className="text-sm text-muted-foreground">{t("channelsPage.scanHint")}</p>
              <Badge tone={["expired", "reauth_required", "error", "verification_required"].includes(wizard.status) ? "warning" : "neutral"}>{wizard.status === "scanned" ? t("channelsPage.scanned") : wizard.status === "verification_required" ? t("channelsPage.verificationRequired") : ["expired", "reauth_required", "error"].includes(wizard.status) ? t("channelsPage.qrExpired") : t("channelsPage.waitingScan")}</Badge>
              {qrSecondsLeft !== null && wizard.status !== "expired" ? <p className="text-xs text-muted-foreground">{t("channelsPage.qrExpiresIn", { seconds: qrSecondsLeft })}</p> : null}
              {pollError ? <p className="text-xs text-amber-600">{pollError}</p> : null}
              {wizard.status === "verification_required" ? (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">{t("channelsPage.verificationHint")}</p>
                  <div className="flex gap-2">
                    <Input value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder={t("channelsPage.verificationCode")} inputMode="numeric" disabled={pending} />
                    <Button size="sm" onClick={() => void submitVerificationCode()} disabled={pending || !verificationCode.trim()}>{t("channelsPage.verify")}</Button>
                  </div>
                </div>
              ) : null}
              {["expired", "reauth_required", "error"].includes(wizard.status) || pollError || !qrPreview ? <Button variant="secondary" size="sm" onClick={() => void reconnect()} disabled={pending}>{pollError ? t("channelsPage.retryNow") : t("channelsPage.reconnect")}</Button> : null}
            </div>
          </div>
        ) : null}

        {wizard?.stage === "activate" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="font-medium">{t("channelsPage.authenticated")}</h3><p className="text-sm text-muted-foreground">{t("channelsPage.activateHint")}</p></div>
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
            <p className="text-xs text-muted-foreground">{t("channelsPage.pairWaiting")}{pairSecondsLeft !== null ? ` · ${t("channelsPage.pairExpiresIn", { seconds: pairSecondsLeft })}` : ""}</p>
          </div>
        ) : null}

        {wizard?.stage === "pair_expired" ? (
          <div className="space-y-3">
            <h3 className="font-medium">{t("channelsPage.pairingExpired")}</h3>
            <p className="text-sm text-muted-foreground">{t("channelsPage.pairingExpiredHint")}</p>
            <Button onClick={() => void activate()} disabled={pending}>{t("channelsPage.regeneratePairCode")}</Button>
          </div>
        ) : null}

        {wizard?.stage === "done" ? <p className="font-medium text-emerald-600">{t("channelsPage.pairDone")}</p> : null}
        {error ? <div className="flex flex-wrap items-center gap-2 text-sm text-destructive"><span>{readableChannelError(error, t) || t("channelsPage.setupFailed")}</span>{error.includes("channel_already_registered") && existingChannelId ? <Button variant="secondary" size="sm" onClick={continueWithExisting} disabled={pending}>{t("channelsPage.useExisting")}</Button> : null}</div> : null}
      </CardContent>
    </Card>
  );
}

function ChannelCard({ channel, conversations, devices, deliveries, projects, tasks, threads, revisions, notificationPolicies, lifecycleSummaries, onReconnect }: { channel: ChannelOperations; conversations: ChannelConversation[]; devices: DeviceSnapshot[]; deliveries: ChannelDelivery[]; projects: ProjectSnapshot[]; tasks: ChannelTaskRequest[]; threads: ChannelTaskThread[]; revisions: ChannelTaskRevision[]; notificationPolicies: ChannelNotificationPolicy[]; lifecycleSummaries: ChannelLifecycleSummary[]; onReconnect: (channelId: string) => void }) {
  const { t } = useAppTranslation();
  const { execute, pending, error } = useAsyncAction();
  const [taskProject, setTaskProject] = useState(channel.taskProjectId ?? "");
  const [taskTerminalId, setTaskTerminalId] = useState(channel.taskTerminalId ?? "");
  const [operationMode, setOperationMode] = useState<"personal" | "team">(channel.operationMode === "team" ? "team" : "personal");
  const [autoRoute, setAutoRoute] = useState(Boolean(channel.taskAutoRoute));
  const [dailyLimit, setDailyLimit] = useState(channel.taskDailyLimit ?? 50);
  const [interactionsOpen, setInteractionsOpen] = useState(false);
  const [interactionConversationId, setInteractionConversationId] = useState("");
  const [interactionDirection, setInteractionDirection] = useState("all");
  const [interactionType, setInteractionType] = useState("all");
  const [interactionStatus, setInteractionStatus] = useState("all");
  const [interactionQuery, setInteractionQuery] = useState("");
  const [interactionCursor, setInteractionCursor] = useState<string | null>(null);
  const [interactionItems, setInteractionItems] = useState<ChannelInteraction[]>([]);
  const [interactionNextCursor, setInteractionNextCursor] = useState<string | null>(null);
  const [interactionLoading, setInteractionLoading] = useState(false);
  const [interactionError, setInteractionError] = useState(false);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [diagnosticError, setDiagnosticError] = useState(false);
  const [notificationConversationId, setNotificationConversationId] = useState(conversations[0]?.id ?? "");
  const [notificationMode, setNotificationMode] = useState<ChannelNotificationPolicy["mode"]>("progress");
  const [notificationInterval, setNotificationInterval] = useState(10);
  const [notificationQuiet, setNotificationQuiet] = useState(false);
  const [notificationTimezone, setNotificationTimezone] = useState("local");
  const [humanReplyDrafts, setHumanReplyDrafts] = useState<Record<string, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const setSection = useUiStore((state) => state.setSection);
  const openWorkItem = useUiStore((state) => state.openWorkItem);
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = channel.taskDayDate === today ? (channel.taskDayCount ?? 0) : 0;
  const connectionLabel = ilinkConnectionLabel(t, channel);
  const selectedTaskDevice = devices.find((device) => device.id === taskTerminalId) ?? null;
  const sharedMaterials = useMemo(() => {
    const rows = conversations.flatMap((conversation) => {
      const context = conversation.sharedContentContext;
      const activeIds = new Set(context?.activeItemIds ?? []);
      return (context?.items ?? [])
        .filter((item) => activeIds.has(item.id) && item.status !== "failed")
        .map((item) => ({ ...item, contextStatus: context?.status ?? "ready", conversationId: conversation.id }));
    });
    return [...new Map(rows.map((item) => [item.canonicalUrl, item])).values()].slice(-5).reverse();
  }, [conversations]);
  const failedSharedMaterials = useMemo(() => {
    const rows = conversations.flatMap((conversation) => {
      const context = conversation.sharedContentContext;
      return (context?.retryUrls ?? []).map((canonicalUrl) => ({
        id: `failed:${canonicalUrl}`,
        title: "链接正文暂时无法读取",
        canonicalUrl,
        conversationId: conversation.id,
      }));
    });
    return [...new Map(rows.map((item) => [item.canonicalUrl, item])).values()].slice(-5).reverse();
  }, [conversations]);

  useEffect(() => {
    if (!notificationConversationId && conversations[0]?.id) setNotificationConversationId(conversations[0].id);
    const saved = notificationPolicies.find((policy) => policy.conversationId === notificationConversationId && !policy.threadId);
    if (saved) {
      setNotificationMode(saved.mode);
      setNotificationInterval(saved.progressIntervalMinutes);
      setNotificationQuiet(Boolean(saved.quietHours?.enabled));
      setNotificationTimezone(saved.quietHours?.timezone || "local");
    }
  }, [conversations, notificationConversationId, notificationPolicies]);

  useEffect(() => {
    if (!taskProject) {
      if (taskTerminalId) setTaskTerminalId("");
      return;
    }
    if (!taskTerminalId) {
      const online = devices.filter((device) => device.status === "online");
      const automatic = online.length === 1 ? online[0] : devices.length === 1 ? devices[0] : null;
      if (automatic) setTaskTerminalId(automatic.id);
    }
  }, [devices, taskProject, taskTerminalId]);

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
          conversationId: interactionConversationId || undefined,
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
  }, [channel.id, interactionDirection, interactionType, interactionStatus, interactionQuery, interactionConversationId, interactionCursor, interactionsOpen]);

  const failed = useMemo(() => deliveries.filter((d) => d.status === "failed_terminal"), [deliveries]);
  const taskThreadIds = useMemo(() => new Set(threads.map((thread) => thread.id)), [threads]);
  const taskByThreadId = useMemo(() => new Map(tasks.filter((task) => task.threadId).map((task) => [task.threadId as string, task])), [tasks]);
  const legacyTasks = useMemo(() => tasks.filter((task) => !task.threadId || !taskThreadIds.has(task.threadId)), [tasks, taskThreadIds]);
  const deliveryByThreadId = useMemo(() => {
    const latest = new Map<string, ChannelDelivery>();
    for (const delivery of deliveries) {
      const threadId = delivery.taskContext?.threadId;
      if (!threadId) continue;
      const previous = latest.get(threadId);
      if (!previous || String(delivery.updatedAt ?? delivery.createdAt ?? "") > String(previous.updatedAt ?? previous.createdAt ?? "")) latest.set(threadId, delivery);
    }
    return latest;
  }, [deliveries]);
  const taskSummaryParts = channel.taskSummary ? [
    channel.taskSummary.queued > 0 ? `排队 ${channel.taskSummary.queued}` : null,
    channel.taskSummary.running > 0 ? `执行中 ${channel.taskSummary.running}` : null,
    channel.taskSummary.waitingApproval > 0 ? `待确认 ${channel.taskSummary.waitingApproval}` : null,
    channel.taskSummary.waitingUser > 0 ? `待补充 ${channel.taskSummary.waitingUser}` : null,
    channel.taskSummary.needsAttention > 0 ? `需要关注 ${channel.taskSummary.needsAttention}` : null,
    channel.taskSummary.humanTakeover > 0 ? `人工跟进 ${channel.taskSummary.humanTakeover}` : null,
    channel.taskSummary.failed > 0 ? `失败 ${channel.taskSummary.failed}` : null,
    channel.taskSummary.succeeded > 0 ? `已完成 ${channel.taskSummary.succeeded}` : null,
  ].filter(Boolean) : [];

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

  function disconnectWithConfirmation() {
    if (window.confirm(t("channelsPage.disconnectConfirm"))) void disconnectIlink();
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
    await execute(() => api.setChannelTaskProject(channel.id, taskProject || null, autoRoute, dailyLimit, grant.token, operationMode, taskTerminalId || null));
  }

  async function saveNotificationPolicy() {
    if (!notificationConversationId) return;
    await execute(() => api.setChannelNotificationPolicy(channel.id, {
      conversationId: notificationConversationId,
      patch: {
        mode: notificationMode,
        progressIntervalMinutes: notificationInterval,
        quietHours: { enabled: notificationQuiet, start: "22:00", end: "08:00", timezone: notificationTimezone },
      },
    }));
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

  async function sendHumanReply(targetId: string) {
    const content = String(humanReplyDrafts[targetId] ?? "").trim();
    if (!content) return;
    await execute(async () => {
      const result = await api.replyChannelTask(targetId, content);
      setHumanReplyDrafts((current) => ({ ...current, [targetId]: "" }));
      return result;
    });
  }

  async function exportDiagnostics() {
    setDiagnosticLoading(true);
    setDiagnosticError(false);
    try {
      const diagnostics: ChannelDiagnostics = await api.getChannelDiagnostics(channel.id);
      const blob = new Blob([JSON.stringify(diagnostics, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `myagenttool-channel-diagnostics-${channel.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setDiagnosticError(true);
    } finally {
      setDiagnosticLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{channel.name}</span>
              <Badge tone="neutral">{channel.provider === "wechat_ilink" ? t("channelsPage.providerWechat") : channel.provider}</Badge>
              <Badge tone={statusTone(channel.status)}>{connectionLabel ?? channel.status}</Badge>
              <Badge tone={healthTone(channel.health)}>{healthLabel(t, channel.health)}</Badge>
            </div>
            {advancedOpen ? <p className="text-xs text-muted-foreground">
              {channel.counts.identities} identities · {channel.counts.conversations} conversations · {channel.counts.events} events
              {channel.counts.injectionFlagged > 0 ? ` · ${channel.counts.injectionFlagged} flagged` : ""}
            </p> : null}
            {channel.taskSummary && channel.taskSummary.total > 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="channel-task-summary">
                任务：{taskSummaryParts.join(" · ")}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1 text-xs text-muted-foreground" title="允许本人在微信中确认普通授权；高风险操作仍必须在桌面端审批中心处理。">
              <input type="checkbox" checked={Boolean(channel.allowSelfApprove)} onChange={(e) => toggleSelfApprove(e.target.checked)} disabled={pending} />
              允许微信确认普通授权
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
            {channel.provider === "wechat_ilink" ? <Button variant="ghost" size="sm" onClick={disconnectWithConfirmation} disabled={pending}>{t("channelsPage.disconnect")}</Button> : null}
            {advancedOpen ? <Button variant="ghost" size="sm" onClick={() => void exportDiagnostics()} disabled={pending || diagnosticLoading}>
              {diagnosticLoading ? "导出中…" : "导出诊断"}
            </Button> : null}
            <Button variant="secondary" size="sm" onClick={() => setInteractionsOpen((open) => !open)}>
              {interactionsOpen ? t("channelsPage.hideInteractions") : t("channelsPage.viewInteractions")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAdvancedOpen((open) => !open)}>{advancedOpen ? "收起高级信息" : "高级信息"}</Button>
          </div>
        </div>

        {advancedOpen ? <div className="grid gap-2 sm:grid-cols-3">
          {Object.entries(channel.readiness).filter(([scope]) => scope !== "workerHealthy").map(([scope, ok]) => (
            <div key={scope} className="flex items-center gap-2 text-xs">
              <Badge tone={ok ? "success" : "danger"}>{ok ? t("channelsPage.ready") : t("channelsPage.missing")}</Badge>
              <span className="text-muted-foreground">{readinessLabel(t, scope)}</span>
            </div>
          ))}
        </div> : null}

        {advancedOpen ? <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs" data-testid="channel-diagnostics-summary">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <span>最后入站：{diagnosticTime(channel.lastInboundAt)}</span>
            <span>最后出站：{diagnosticTime(channel.lastOutboundAt)}</span>
            <span>最后送达：{diagnosticTime(channel.lastDeliveredAt)}</span>
            {channel.lastFailureAt ? <span className="text-destructive">最近失败：{diagnosticTime(channel.lastFailureAt)}{channel.lastFailureCode ? `（${channel.lastFailureCode}）` : ""}</span> : null}
          </div>
          {channel.pipeline ? (
            <p className="mt-1 text-muted-foreground">
              链路：入站 {Object.entries(channel.pipeline.inbound).map(([status, count]) => `${status === "imported" ? "已接收" : status} ${count}`).join(" · ") || "暂无"}；出站 {Object.entries(channel.pipeline.outbound).map(([status, count]) => `${status === "delivered" ? "已送达" : status === "failed_terminal" ? "发送失败" : status} ${count}`).join(" · ") || "暂无"}
            </p>
          ) : null}
          {diagnosticError ? <p className="mt-1 text-destructive">诊断导出失败，请稍后重试。</p> : null}
        </div> : null}

        {advancedOpen && channel.provider === "wechat_ilink" ? (
          <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs" data-testid="ilink-runtime-summary">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>iLink：{ilinkRuntimeStatusLabel(channel.ilinkAccount)}</span>
              <span>最近轮询：{diagnosticTime(channel.ilinkAccount?.lastPollAt)}</span>
              <span>最近收消息：{diagnosticTime(channel.ilinkAccount?.lastMessageAt)}</span>
              {channel.ilinkAccount?.workerFailureCount ? <span className="text-amber-600">连续重试：{channel.ilinkAccount.workerFailureCount} 次</span> : null}
            </div>
            {ilinkRuntimeErrorLabel(channel.ilinkAccount?.lastError) ? <p className="mt-1 text-amber-600">{ilinkRuntimeErrorLabel(channel.ilinkAccount?.lastError)}</p> : null}
            {channel.ilinkAccount?.nextRetryAt ? <p className="mt-1 text-muted-foreground">预计下次自动重试：{diagnosticTime(channel.ilinkAccount.nextRetryAt)}</p> : null}
          </div>
        ) : null}

        {sharedMaterials.length || failedSharedMaterials.length ? (
          <details className="rounded-md border border-border px-3 py-2" data-testid="channel-shared-materials">
            <summary className="cursor-pointer text-sm font-medium">最近分享的资料（{sharedMaterials.length + failedSharedMaterials.length}）</summary>
            <div className="mt-3 space-y-2">
              {sharedMaterials.map((item) => (
                <div key={`${item.conversationId}:${item.id}`} className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.title}</span>
                    <Badge tone={item.contextStatus === "analyzing" ? "warning" : item.contextStatus === "analyzed" ? "success" : "neutral"}>
                      {item.contextStatus === "analyzing" ? "分析中" : item.contextStatus === "analyzed" ? "已分析" : "已读取"}
                    </Badge>
                    <Badge tone={item.archiveStatus === "saved" ? "success" : item.archiveStatus === "not_saved" ? "warning" : "neutral"}>
                      {item.archiveStatus === "saved" ? "已收纳" : item.archiveStatus === "not_saved" ? "未收纳" : "仅预览"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">{[item.author, item.publishedAt, item.provider].filter(Boolean).join(" · ")}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <a className="break-all text-primary hover:underline" href={item.canonicalUrl} target="_blank" rel="noreferrer">查看原文</a>
                    {item.knowledgeItemId ? <Button variant="ghost" size="sm" onClick={() => setSection("localLibrary")}>查看我的资料</Button> : null}
                  </div>
                </div>
              ))}
              {failedSharedMaterials.map((item) => (
                <div key={`${item.conversationId}:${item.id}`} className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.title}</span>
                    <Badge tone="danger">读取失败</Badge>
                  </div>
                  <p className="mt-1 break-all text-muted-foreground">{item.canonicalUrl}</p>
                  <p className="mt-1 text-amber-600">请在微信回复“重试”重新读取；原资料仍保留在本地。</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <a className="break-all text-primary hover:underline" href={item.canonicalUrl} target="_blank" rel="noreferrer">查看原文</a>
                  </div>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        <details className="rounded-md border border-border px-3 py-2" data-testid="channel-notification-settings">
          <summary className="cursor-pointer text-sm font-medium">任务提醒（长任务默认开启）</summary>
          <div className="mt-3 grid gap-3 text-xs sm:grid-cols-[minmax(0,1fr)_160px_110px_140px_auto] sm:items-end">
            <label className="space-y-1"><span className="text-muted-foreground">会话</span><select className="h-9 w-full rounded-md border border-border bg-background px-2" value={notificationConversationId} onChange={(event) => setNotificationConversationId(event.target.value)} disabled={!conversations.length || pending}><option value="">暂无会话</option>{conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.externalUserId ?? conversation.id}</option>)}</select></label>
            <label className="space-y-1"><span className="text-muted-foreground">提醒方式</span><select className="h-9 w-full rounded-md border border-border bg-background px-2" value={notificationMode} onChange={(event) => setNotificationMode(event.target.value as ChannelNotificationPolicy["mode"])} disabled={!notificationConversationId || pending}><option value="important">重要节点</option><option value="progress">包含进展</option><option value="digest">进展汇总</option><option value="off">关闭主动提醒</option></select></label>
            <label className="space-y-1"><span className="text-muted-foreground">进展间隔（分钟）</span><Input type="number" min={5} max={240} value={notificationInterval} onChange={(event) => setNotificationInterval(Math.max(5, Math.min(240, Number(event.target.value) || 10)))} disabled={!notificationConversationId || pending} /></label>
            <label className="space-y-1"><span className="text-muted-foreground">提醒时区</span><select className="h-9 w-full rounded-md border border-border bg-background px-2" value={notificationTimezone} onChange={(event) => setNotificationTimezone(event.target.value)} disabled={!notificationConversationId || pending}><option value="local">跟随电脑</option><option value="Asia/Shanghai">北京时间</option><option value="Asia/Hong_Kong">香港时间</option><option value="America/Los_Angeles">美国西部时间</option></select></label>
            <Button size="sm" onClick={() => void saveNotificationPolicy()} disabled={!notificationConversationId || pending}>保存</Button>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={notificationQuiet} onChange={(event) => setNotificationQuiet(event.target.checked)} disabled={!notificationConversationId || pending} />晚上 22:00 至次日 08:00 免打扰（按所选时区，重要消息结束后补发）</label>
          <p className="mt-2 text-xs text-muted-foreground">长任务超过 5 分钟后默认限频反馈，通常每 10 分钟最多一次；排队、等待设备、执行、完成和失败都会说明。MyAgentTool 需要保持运行。</p>
          <p className="mt-1 text-xs text-muted-foreground">也可以在微信里直接说“每半小时告诉我进展”“只告诉我完成和失败”或“停止提醒”。</p>
        </details>

        {advancedOpen && channel.taskProjectId && lifecycleSummaries.length > 0 ? (
          <details className="rounded-md border border-border px-3 py-2 text-xs" data-testid="channel-lifecycle-summary">
            <summary className="cursor-pointer font-medium">业务链快照（本地文件最近导入）</summary>
            <div className="mt-2 space-y-2">
              {lifecycleSummaries.slice(0, 8).map((summary) => (
                <div key={`${summary.projectId}:${summary.label}`} className="rounded border border-border bg-muted/20 px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{summary.customer ?? summary.label}</span>
                    {summary.orderNumber ? <span className="text-muted-foreground">订单 {summary.orderNumber}</span> : null}
                    <Badge tone={summary.state === "closed" ? "success" : "neutral"}>{summary.state === "closed" ? "已完结" : summary.state === "active" ? "处理中" : "待补充标识"}</Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {Object.values(summary.stages).map((stage) => `${stage.label}${stage.count && stage.count > 1 ? ` ${stage.count}条` : ""}：${stage.status ?? "待确认"}`).join(" · ")}
                  </p>
                  {summary.totals && (summary.totals.receivableAmount || summary.totals.collectedAmount || summary.totals.returnAmount || summary.totals.shipmentQuantity || summary.totals.returnQuantity) ? (
                    <p className="mt-1 text-muted-foreground">
                      金额：应收 {summary.totals.receivableAmount ?? 0}，已收 {summary.totals.collectedAmount ?? 0}，退货 {summary.totals.returnAmount ?? 0}；数量：已发 {summary.totals.shipmentQuantity ?? 0}，退货 {summary.totals.returnQuantity ?? 0}
                    </p>
                  ) : null}
                  {summary.warnings?.length ? <p className="mt-1 text-amber-600">需确认：{summary.warnings.join("；")}</p> : null}
                  {summary.sources.length > 0 ? <p className="mt-1 text-[11px] text-muted-foreground">来源：{summary.sources.join("、")}</p> : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {advancedOpen && channel.capabilityAllowlist.length > 0 && (
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
          conversationId={interactionConversationId}
          conversations={conversations}
          onDirectionChange={(value) => { setInteractionDirection(value); resetInteractionCursor(); }}
          onTypeChange={(value) => { setInteractionType(value); resetInteractionCursor(); }}
          onStatusChange={(value) => { setInteractionStatus(value); resetInteractionCursor(); }}
          onQueryChange={(value) => { setInteractionQuery(value); resetInteractionCursor(); }}
          onConversationChange={(value) => { setInteractionConversationId(value); resetInteractionCursor(); }}
          onLoadMore={() => setInteractionCursor(interactionNextCursor)}
        /> : null}

        {advancedOpen ? <>
        {/* /task target: the project inbound tasks are filed into as tracked
            GitHub issues. Approval-gated (mints a grant), same as enable. */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t("channelsPage.taskProject")}</span>
          <select
            className="h-7 rounded-md border border-border bg-background px-1.5"
            value={operationMode}
            onChange={(e) => setOperationMode(e.target.value === "team" ? "team" : "personal")}
            disabled={pending}
            aria-label="任务模式"
          >
            <option value="personal">个人模式</option>
            <option value="team">团队模式</option>
          </select>
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
          {taskProject ? (
            <select
              className="h-7 rounded-md border border-border bg-background px-1.5"
              value={taskTerminalId}
              onChange={(e) => setTaskTerminalId(e.target.value)}
              disabled={pending || devices.length === 0}
              aria-label={t("channelsPage.taskDevice")}
              data-testid="channel-task-device"
            >
              <option value="">{devices.length === 0 ? t("channelsPage.taskDeviceRequired") : `— ${t("channelsPage.taskDevicePlaceholder")} —`}</option>
              {devices.map((device) => <option key={device.id} value={device.id}>{taskDeviceLabel(t, device)}</option>)}
            </select>
          ) : <select
            className="h-7 rounded-md border border-border bg-background px-1.5"
            value=""
            disabled
            aria-label={t("channelsPage.taskDevice")}
            data-testid="channel-task-device"
          >
            <option value="">{t("channelsPage.taskProjectHint")}</option>
          </select>}
          {taskProject && devices.length === 1 ? <span className="text-muted-foreground">（仅一台设备，已自动选择）</span> : null}
          {taskProject && devices.length > 1 && !taskTerminalId ? <span className="w-full text-amber-600 sm:w-auto">{t("channelsPage.taskDeviceRequired")}</span> : null}
          {taskProject && devices.length === 0 ? <span className="w-full text-amber-600 sm:w-auto">{t("channelsPage.taskDeviceRequired")}</span> : null}
          {taskProject && selectedTaskDevice && selectedTaskDevice.status !== "online" ? <span className="w-full text-amber-600 sm:w-auto">{t("channelsPage.healthAttention")}：{t("channelsPage.queued")}，设备上线后自动开始。</span> : null}
          {!taskProject ? <span className="w-full text-amber-600 sm:w-auto">{t("channelsPage.taskProjectHint")}</span> : null}
          <label className="flex items-center gap-1 text-muted-foreground">
            <input type="checkbox" checked={autoRoute} onChange={(e) => setAutoRoute(e.target.checked)} disabled={pending || !taskProject || operationMode === "personal"} />
            {operationMode === "personal" ? "确认后自动排队" : t("channelsPage.autoRoute")}
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
            disabled={pending || (Boolean(taskProject) && devices.length > 1 && !taskTerminalId) || ((channel.taskProjectId ?? "") === taskProject && (channel.taskTerminalId ?? "") === taskTerminalId && (channel.operationMode === "team" ? "team" : "personal") === operationMode && Boolean(channel.taskAutoRoute) === autoRoute && (channel.taskDailyLimit ?? 50) === dailyLimit)}
          >
            {t("channelsPage.save")}
          </Button>
          {channel.taskProjectId ? (
            <Badge tone="success">{operationMode === "personal" ? "个人模式" : channel.taskAutoRoute ? t("channelsPage.autoRoute") : t("channelsPage.capture")}</Badge>
          ) : (
            <span className="text-muted-foreground">{t("channelsPage.unbound")}</span>
          )}
        </div>
        </> : null}

        {legacyTasks.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3" data-testid="channel-task-operations">
            <p className="text-xs font-medium">{t("channelsPage.tasks")}</p>
            {legacyTasks.slice().reverse().slice(0, 10).map((task) => (
              <div key={task.id} className="grid gap-2 rounded-md border border-border p-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={task.stage.includes("failed") || task.stage === "run_blocked" ? "danger" : task.stage === "run_succeeded" ? "success" : "neutral"}>{advancedOpen ? task.stage.replaceAll("_", " ") : task.stage.includes("failed") || task.stage === "run_blocked" ? "需要处理" : task.stage === "run_succeeded" ? "已完成" : "进行中"}</Badge>
                    {advancedOpen ? <>
                      <a className="text-primary underline-offset-2 hover:underline" href={task.issueUrl ?? undefined} target="_blank" rel="noreferrer">Issue #{task.issueNumber}</a>
                      {task.invocationId ? <span className="font-mono text-muted-foreground">{task.invocationId}</span> : null}
                      {task.deliveryStatus ? <span className="text-muted-foreground">delivery {task.deliveryStatus.replaceAll("_", " ")}</span> : null}
                    </> : null}
                  </div>
                  <p className="truncate font-medium" title={task.title}>{task.title}</p>
                  {task.resultSummary ? <p className="line-clamp-2 text-muted-foreground">{task.resultSummary}</p> : null}
                </div>
                <div className="flex flex-wrap items-start gap-1.5">
                  {task.status === "pending" ? <><Button size="sm" onClick={() => taskAction(task, "route")} disabled={pending}>{t("channelsPage.route")}</Button><Button variant="ghost" size="sm" onClick={() => taskAction(task, "dismiss")} disabled={pending}>{t("channelsPage.dismiss")}</Button></> : null}
                  {task.actions.retry ? <Button variant="secondary" size="sm" onClick={() => taskAction(task, "retry")} disabled={pending}>{t("channelsPage.retry")}</Button> : null}
                  {advancedOpen && task.actions.reroute ? <Button variant="secondary" size="sm" onClick={() => taskAction(task, "reroute")} disabled={pending}>{t("channelsPage.reroute")}</Button> : null}
                  {task.actions.takeover ? <Button variant="ghost" size="sm" onClick={() => taskAction(task, "takeover")} disabled={pending}>{t("channelsPage.takeover")}</Button> : null}
                </div>
                {task.status === "human_takeover" && (!task.threadId || !taskThreadIds.has(task.threadId)) ? <HumanReplyBox
                  value={humanReplyDrafts[task.id] ?? ""}
                  onChange={(value) => setHumanReplyDrafts((current) => ({ ...current, [task.id]: value }))}
                  onSend={() => void sendHumanReply(task.id)}
                  disabled={pending}
                /> : null}
              </div>
            ))}
          </div>
        )}

        {threads.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3" data-testid="channel-task-threads">
            <p className="text-xs font-medium">任务对话</p>
            {threads.slice().reverse().slice(0, 10).map((thread) => (
              <div key={thread.id} className="rounded-md border border-border p-3 text-xs">
                {(() => {
                  const task = taskByThreadId.get(thread.id);
                  const threadDelivery = deliveryByThreadId.get(thread.id);
                  const threadRevisions = revisions.filter((revision) => revision.threadId === thread.id).sort((left, right) => right.revision - left.revision);
                  return (
                    <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={thread.status === "queued" || thread.status === "succeeded" ? "success" : thread.status === "failed" ? "danger" : thread.status === "human_takeover" || thread.status === "needs_attention" || thread.status === "paused" ? "warning" : "neutral"}>{taskThreadStatusLabel(thread.status, thread.waitingFor)}</Badge>
                  <span className="text-muted-foreground">当前会话任务</span>
                  {thread.status === "queued" && Number(thread.queueAheadCount ?? 0) > 0 ? <span className="text-muted-foreground">前面还有 {thread.queueAheadCount} 个任务</span> : null}
                  {thread.status === "queued" && Number(thread.queuePosition ?? 0) > 0 ? <span className="text-muted-foreground">排第 {thread.queuePosition} 位</span> : null}
                  {thread.waitingFor ? <span className="text-muted-foreground">等待：{waitingForLabel(thread.waitingFor)}</span> : null}
                  {task?.status === "pending" ? <><Button size="sm" onClick={() => taskAction(task, "route")} disabled={pending}>{t("channelsPage.route")}</Button><Button variant="ghost" size="sm" onClick={() => taskAction(task, "dismiss")} disabled={pending}>{t("channelsPage.dismiss")}</Button></> : null}
                  {task?.actions.retry ? <Button variant="secondary" size="sm" onClick={() => taskAction(task, "retry")} disabled={pending}>{t("channelsPage.retry")}</Button> : null}
                  {task?.actions.reroute ? <Button variant="secondary" size="sm" onClick={() => taskAction(task, "reroute")} disabled={pending}>{t("channelsPage.reroute")}</Button> : null}
                  {task?.actions.takeover ? <Button variant="ghost" size="sm" onClick={() => taskAction(task, "takeover")} disabled={pending}>{t("channelsPage.takeover")}</Button> : null}
                </div>
                <p className="mt-1 line-clamp-2 text-muted-foreground">{thread.summary}</p>
                {thread.workItemId ? <Button className="mt-2" variant="secondary" size="sm" onClick={() => { openWorkItem(thread.workItemId!, { section: "overview" }); setSection("task"); }}>查看任务</Button> : null}
                {thread.status === "awaiting_confirmation" ? <p className="mt-1 text-amber-600">请在微信回复“确认”开始，也可以继续补充或回复“取消”。</p> : null}
                {thread.status === "waiting_user" ? <p className="mt-1 text-amber-600">等待你补充信息，直接在微信回复即可。</p> : null}
                {thread.status === "waiting_approval" && ["approval", "delivery"].includes(thread.waitingFor ?? "") ? (
                  <Button className="mt-2" variant="secondary" size="sm" onClick={() => setSection("approvals")}>前往审批</Button>
                ) : null}
                {thread.lastProgressSummary ? <p className="mt-1 text-muted-foreground">进展：{thread.lastProgressSummary}</p> : null}
                {thread.nextAction ? <p className="mt-1 text-muted-foreground">下一步：{thread.nextAction}</p> : null}
                {thread.lastDeliveryStatus ? <p className="mt-1 text-muted-foreground">消息：{thread.lastDeliveryStatus === "delivered" ? "已发送" : thread.lastDeliveryStatus === "retrying" ? "发送失败，自动重试中" : thread.lastDeliveryStatus === "failed_terminal" ? "发送失败，请重试" : thread.lastDeliveryStatus === "queued" ? "等待发送" : thread.lastDeliveryStatus}</p> : null}
                {thread.resultSummary ? <p className="mt-1 line-clamp-3 text-muted-foreground">{thread.resultSummary}</p> : null}
                {threadRevisions.length > 0 ? (
                  <details className="mt-2 text-[11px] text-muted-foreground">
                    <summary className="cursor-pointer">修订记录（{threadRevisions.length}）</summary>
                    <div className="mt-1 space-y-1 border-l border-border pl-2">
                      {threadRevisions.slice(0, 8).map((revision) => <p key={revision.id}>第 {revision.revision} 次 · {revisionTypeLabel(revision.type)} · {revisionStatusLabel(revision.status)}{revision.feedback ? ` · ${revision.feedback}` : ""}</p>)}
                    </div>
                  </details>
                ) : null}
                {threadDelivery?.status === "failed_terminal" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-destructive">
                    <span>结果消息未送达：{threadDelivery.lastErrorCode ?? thread.lastDeliveryError ?? "发送失败"}</span>
                    <Button variant="secondary" size="sm" onClick={() => void retry(threadDelivery.id)} disabled={pending}>重试发送</Button>
                  </div>
                ) : threadDelivery?.status === "retrying" ? (
                  <p className="mt-1 text-amber-600">结果消息发送失败，正在自动重试。</p>
                ) : null}
                {thread.statusHistory?.length ? <p className="mt-1 text-[11px] text-muted-foreground">{thread.statusHistory.slice(-4).map((entry) => taskThreadStatusLabel(entry.status)).join(" → ")}</p> : null}
                {thread.shortRef ? <details className="mt-2 text-[11px] text-muted-foreground"><summary className="cursor-pointer">高级信息</summary><p className="mt-1 font-mono">任务引用：{thread.shortRef}</p></details> : null}
                {thread.status === "human_takeover" ? <HumanReplyBox
                  value={humanReplyDrafts[thread.id] ?? ""}
                  onChange={(value) => setHumanReplyDrafts((current) => ({ ...current, [thread.id]: value }))}
                  onSend={() => void sendHumanReply(thread.id)}
                  disabled={pending}
                /> : null}
                {thread.messages?.length ? (
                  <details className="mt-2 text-muted-foreground">
                    <summary className="cursor-pointer">交互记录（{thread.messages.length + (threadDelivery ? 1 : 0)}）</summary>
                    <div className="mt-1 space-y-1 border-l border-border pl-2">
                      {thread.messages.slice(-6).map((message) => <p key={message.eventId}>{message.content || "[media]"}</p>)}
                      {threadDelivery ? <p className={threadDelivery.status === "failed_terminal" ? "text-destructive" : "text-primary"}>系统回复：{threadDelivery.content ?? threadDelivery.status}</p> : null}
                    </div>
                  </details>
                ) : null}
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        )}

        {failed.length > 0 && (
          <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-xs font-medium text-destructive">
              有 {failed.length} 条消息发送失败
            </p>
            {failed.map((delivery) => (
              <div key={delivery.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono text-muted-foreground">
                  已尝试 {delivery.attempts} 次{advancedOpen ? ` · ${delivery.id} · 错误 ${delivery.lastErrorCode ?? "—"}` : ""}
                </span>
                <Button variant="secondary" size="sm" onClick={() => retry(delivery.id)} disabled={pending}>
                  重试发送
                </Button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-xs text-destructive">{readableTaskError(error, t)}</p>}
      </CardContent>
    </Card>
  );
}

function HumanReplyBox({ value, onChange, onSend, disabled }: { value: string; onChange: (value: string) => void; onSend: () => void; disabled: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Input
        className="min-w-64 flex-1 text-xs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="回复用户…"
        disabled={disabled}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }}
      />
      <Button variant="secondary" size="sm" onClick={onSend} disabled={disabled || !value.trim()}>发送给用户</Button>
    </div>
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
  conversationId,
  conversations,
  onDirectionChange,
  onTypeChange,
  onStatusChange,
  onQueryChange,
  onConversationChange,
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
  conversationId: string;
  conversations: ChannelConversation[];
  onDirectionChange: (value: string) => void;
  onTypeChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onConversationChange: (value: string) => void;
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
        {conversations.length > 0 ? (
          <select className="h-8 rounded-md border border-border bg-background px-2 text-xs" value={conversationId} onChange={(event) => onConversationChange(event.target.value)} aria-label="选择会话">
            <option value="">全部会话</option>
            {conversations.map((conversation, index) => <option key={conversation.id} value={conversation.id}>用户会话 {index + 1}</option>)}
          </select>
        ) : null}
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
      {interaction.mediaFailure?.failed?.length ? (
        <p className="mt-2 text-amber-600">
          ⚠ 附件接收不完整：{interaction.mediaFailure.failed.map((item) => item.filename || "附件").join("、")}，任务未开始
        </p>
      ) : null}
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
