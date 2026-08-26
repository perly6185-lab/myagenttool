import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { SectionHeading } from "@/components/common/section-heading";
import { Button } from "@/components/ui/button";
import { request } from "@/lib/api/request";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { cn } from "@/lib/cn";

/** Mirrors the server's merged session row (session-manager.mjs listSessions). */
export interface SessionCard {
  site: string;
  displayName: string;
  authMethod: string;
  heartbeatTier: string;
  heartbeatIntervalMinutes: number | null;
  profileDir: string;
  status: "active" | "unknown" | "expired" | "needs_login";
  lastProbeAt: string | null;
  lastProbeOk: boolean | null;
  lastReauthAt: string | null;
  detail: string;
  runtimeAvailable?: boolean;
  connection?: {
    registered: boolean;
    ready: boolean;
    applicationStatus: string;
    agentStatus: string;
  };
}

const COPY = {
  zh: {
    title: "网站登录",
    subtitle: "维护需要登录的网站：查看登录态、探测健康、一键重登",
    empty: "没有已注册的站点。",
    probe: "探测",
    probing: "探测中…",
    reauth: "重登",
    connectWechat: "连接公众号",
    loginWechat: "扫码登录",
    reloginWechat: "重新登录",
    wechatReady: "草稿连接已就绪；只会保存到草稿箱，不会公开发布。",
    wechatNeedsLogin: "公众号执行器已就绪，还需要扫码登录；登录后会复用状态，无需每次扫码。",
    wechatNotConnected: "首次使用请连接公众号；会自动准备本地执行器并打开扫码登录页。",
    wechatRegistered: "公众号执行器已注册，但应用尚未启用。请到“应用”中启用后再保存草稿。",
    wechatUnavailable: "当前安装中缺少公众号本地执行器，暂时无法连接。",
    reauthing: "等待你在弹出的浏览器里登录…",
    lastProbe: "上次探测",
    lastReauth: "上次重登",
    never: "从未",
    interval: "每 {minutes} 分钟自动探测",
    manual: "仅手动探测",
    active: "已登录",
    needs_login: "需要重登",
    unknown: "未知",
    expired: "已失效",
    probeFailed: "探测失败",
    connectFailed: "连接失败",
    professionalDetails: "专业信息",
    hint: "重登会在这台电脑上打开浏览器窗口，登录完成前请勿关闭。",
  },
  en: {
    title: "Site logins",
    subtitle: "Maintain login-walled sites: health at a glance, probe on demand, one-key reseed",
    empty: "No registered sites.",
    probe: "Probe",
    probing: "Probing…",
    reauth: "Re-login",
    connectWechat: "Connect account",
    loginWechat: "Scan to sign in",
    reloginWechat: "Re-login",
    wechatReady: "Draft connection is ready. It can save drafts but cannot publish publicly.",
    wechatNeedsLogin: "The local runtime is ready. Scan once to sign in; the saved session will be reused.",
    wechatNotConnected: "Connect once to prepare the local runtime and open the QR sign-in page.",
    wechatRegistered: "The publisher is registered but its Application is not active. Enable it in Applications before saving drafts.",
    wechatUnavailable: "This installation does not include the local WeChat Official Account runtime.",
    reauthing: "Waiting for you to sign in the opened browser…",
    lastProbe: "Last probe",
    lastReauth: "Last re-login",
    never: "never",
    interval: "Auto-probe every {minutes} min",
    manual: "Manual probe only",
    active: "Logged in",
    needs_login: "Needs re-login",
    unknown: "Unknown",
    expired: "Expired",
    probeFailed: "Probe failed",
    connectFailed: "Connection failed",
    professionalDetails: "Technical details",
    hint: "Re-login opens a browser window on this machine — keep it open until you finish signing in.",
  },
} as const;

const STATUS_DOT: Record<SessionCard["status"], string> = {
  active: "bg-emerald-500",
  needs_login: "bg-amber-500",
  expired: "bg-amber-500",
  unknown: "bg-slate-400",
};

const SESSION_PROBE_TIMEOUT_MS = 5 * 60 * 1000;
const SESSION_LOGIN_TIMEOUT_MS = 10 * 60 * 1000 + 15 * 1000;

function formatTime(iso: string | null, never: string) {
  if (!iso) return never;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? never : date.toLocaleString();
}

export function wechatConnectionState(session: SessionCard) {
  if (session.site !== "wechat_official") return null;
  if (session.runtimeAvailable === false) return "unavailable";
  if (session.connection?.ready) return session.status === "active" ? "ready" : "needs_login";
  if (session.connection?.registered) return "registered";
  return "not_registered";
}

export function SessionsView() {
  const { i18n } = useAppTranslation();
  const copy = COPY[i18n.language.startsWith("zh") ? "zh" : "en"];
  const queryClient = useQueryClient();

  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: () => request<{ sessions: SessionCard[] }>("GET", "/api/sessions"),
    refetchInterval: 60_000,
  });

  const probeMutation = useMutation({
    mutationFn: (site: string) => request("POST", `/api/sessions/${encodeURIComponent(site)}/probe`, undefined, true, SESSION_PROBE_TIMEOUT_MS),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });

  const reauthMutation = useMutation({
    mutationFn: (site: string) => request("POST", `/api/sessions/${encodeURIComponent(site)}/reauth`, undefined, true, SESSION_LOGIN_TIMEOUT_MS),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });

  const busySite = (site: string) =>
    (probeMutation.isPending && probeMutation.variables === site) ||
    (reauthMutation.isPending && reauthMutation.variables === site);

  const sessions = sessionsQuery.data?.sessions ?? [];
  const focusedSite = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("site");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <SectionHeading title={copy.title} description={copy.subtitle} />
      {sessions.length === 0 && !sessionsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">{copy.empty}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sessions.map((session) => {
            const busy = busySite(session.site);
            const wechatState = wechatConnectionState(session);
            const statusLabel =
              session.status === "active"
                ? copy.active
                : session.status === "needs_login"
                  ? copy.needs_login
                  : session.status === "expired"
                    ? copy.expired
                    : copy.unknown;
            return (
              <div
                key={session.site}
                id={`session-${session.site}`}
                className={cn("rounded-lg border p-4 space-y-3", focusedSite === session.site && "border-primary ring-2 ring-primary/30")}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[session.status])} aria-hidden />
                    <span className="font-medium truncate">{session.displayName}</span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{statusLabel}</span>
                </div>
                <p className="text-xs text-muted-foreground break-all">{session.detail}</p>
                {wechatState && (
                  <p className={cn(
                    "text-xs",
                    wechatState === "ready" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400",
                  )}>
                    {wechatState === "ready"
                      ? copy.wechatReady
                      : wechatState === "needs_login"
                        ? copy.wechatNeedsLogin
                      : wechatState === "registered"
                        ? copy.wechatRegistered
                        : wechatState === "unavailable"
                          ? copy.wechatUnavailable
                          : copy.wechatNotConnected}
                  </p>
                )}
                {session.site === "wechat_official" && session.connection && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none">{copy.professionalDetails}</summary>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                      <dt>Application</dt>
                      <dd>{session.connection.applicationStatus}</dd>
                      <dt>Agent</dt>
                      <dd>{session.connection.agentStatus}</dd>
                    </dl>
                  </details>
                )}
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <dt>{copy.lastProbe}</dt>
                  <dd>{formatTime(session.lastProbeAt, copy.never)}</dd>
                  <dt>{copy.lastReauth}</dt>
                  <dd>{formatTime(session.lastReauthAt, copy.never)}</dd>
                </dl>
                <p className="text-xs text-muted-foreground">
                  {session.heartbeatTier === "logged_in"
                    ? copy.interval.replace("{minutes}", String(session.heartbeatIntervalMinutes))
                    : copy.manual}
                </p>
                {reauthMutation.isPending && reauthMutation.variables === session.site && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">{copy.reauthing}</p>
                )}
                {probeMutation.variables === session.site && probeMutation.isError && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {copy.probeFailed}: {String((probeMutation.error as Error | null)?.message ?? "")}
                  </p>
                )}
                {reauthMutation.variables === session.site && reauthMutation.isError && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {copy.connectFailed}: {String((reauthMutation.error as Error | null)?.message ?? "")}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => probeMutation.mutate(session.site)}
                  >
                    <RefreshCw className="size-3.5" aria-hidden />
                    {probeMutation.isPending && probeMutation.variables === session.site ? copy.probing : copy.probe}
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy || wechatState === "unavailable"}
                    onClick={() => reauthMutation.mutate(session.site)}
                  >
                    {reauthMutation.isPending && reauthMutation.variables === session.site
                      ? copy.reauthing
                      : session.site === "wechat_official"
                        ? session.status === "active" ? copy.reloginWechat : session.status === "needs_login" ? copy.loginWechat : copy.connectWechat
                        : copy.reauth}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{copy.hint}</p>
    </div>
  );
}
