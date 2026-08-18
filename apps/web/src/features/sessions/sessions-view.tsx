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
}

const COPY = {
  zh: {
    title: "网站登录",
    subtitle: "维护需要登录的网站：查看登录态、探测健康、一键重登",
    empty: "没有已注册的站点。",
    probe: "探测",
    probing: "探测中…",
    reauth: "重登",
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
    hint: "重登会在这台电脑上打开浏览器窗口，登录完成前请勿关闭。",
  },
  en: {
    title: "Site logins",
    subtitle: "Maintain login-walled sites: health at a glance, probe on demand, one-key reseed",
    empty: "No registered sites.",
    probe: "Probe",
    probing: "Probing…",
    reauth: "Re-login",
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
    hint: "Re-login opens a browser window on this machine — keep it open until you finish signing in.",
  },
} as const;

const STATUS_DOT: Record<SessionCard["status"], string> = {
  active: "bg-emerald-500",
  needs_login: "bg-amber-500",
  expired: "bg-amber-500",
  unknown: "bg-slate-400",
};

function formatTime(iso: string | null, never: string) {
  if (!iso) return never;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? never : date.toLocaleString();
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
    mutationFn: (site: string) => request("POST", `/api/sessions/${encodeURIComponent(site)}/probe`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });

  const reauthMutation = useMutation({
    mutationFn: (site: string) => request("POST", `/api/sessions/${encodeURIComponent(site)}/reauth`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });

  const busySite = (site: string) =>
    (probeMutation.isPending && probeMutation.variables === site) ||
    (reauthMutation.isPending && reauthMutation.variables === site);

  const sessions = sessionsQuery.data?.sessions ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <SectionHeading title={copy.title} description={copy.subtitle} />
      {sessions.length === 0 && !sessionsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">{copy.empty}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sessions.map((session) => {
            const busy = busySite(session.site);
            const statusLabel =
              session.status === "active"
                ? copy.active
                : session.status === "needs_login"
                  ? copy.needs_login
                  : session.status === "expired"
                    ? copy.expired
                    : copy.unknown;
            return (
              <div key={session.site} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[session.status])} aria-hidden />
                    <span className="font-medium truncate">{session.displayName}</span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{statusLabel}</span>
                </div>
                <p className="text-xs text-muted-foreground break-all">{session.detail}</p>
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
                  <Button size="sm" disabled={busy} onClick={() => reauthMutation.mutate(session.site)}>
                    {reauthMutation.isPending && reauthMutation.variables === session.site ? copy.reauthing : copy.reauth}
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
