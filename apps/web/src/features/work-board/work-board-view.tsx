import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCopy, Inbox, KanbanSquare, ListTodo, Loader2, PauseCircle, Send, UserCheck, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { cn } from "@/lib/cn";
import { useConsoleState, useRefreshConsoleState } from "@/data/use-console-state";
import { api, useAsyncAction } from "@/data/use-console-actions";
import { useUiStore, type SectionKey } from "@/store/ui-store";
import type { ReportSchedule, WorkBoard, WorkItem, WorkPeriodKey, WorkReport, WorkState } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { mobileTodoCounts } from "@/components/layout/mobile-navigation-model";

// The Status board: six lenses over the same work (server read-model `workBoard`)
// so a supervisor can see, on one screen, what is 待决策 / 在等待 / 正在做 / 已做完 /
// 已失败 / 要跟进 without hopping between Approvals, Auto-runs, and Evidence. Every
// row deep-links to its native surface for the rich context and any action.

const LENS_ORDER: WorkState[] = ["pending_decision", "follow_up", "in_progress", "waiting", "failed", "done"];

type LensTone = "warning" | "danger" | "success" | "neutral" | "running";

const LENS_META: Record<WorkState, { icon: LucideIcon; tone: LensTone }> = {
  pending_decision: { icon: Inbox, tone: "warning" }, follow_up: { icon: AlertTriangle, tone: "warning" },
  in_progress: { icon: Loader2, tone: "running" }, waiting: { icon: PauseCircle, tone: "neutral" },
  failed: { icon: AlertTriangle, tone: "danger" }, done: { icon: CheckCircle2, tone: "success" },
};

const TONE_ACCENT: Record<LensTone, string> = {
  warning: "border-l-warning",
  danger: "border-l-destructive",
  success: "border-l-success",
  running: "border-l-primary",
  neutral: "border-l-muted-foreground/40",
};

function since(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "narrow" });
  if (secs < 60) return formatter.format(-secs, "second");
  const mins = Math.round(secs / 60);
  if (mins < 60) return formatter.format(-mins, "minute");
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return formatter.format(-hrs, "hour");
  return formatter.format(-Math.round(hrs / 24), "day");
}

const EMPTY_BOARD: WorkBoard["states"] = {
  pending_decision: { count: 0, items: [] },
  in_progress: { count: 0, items: [] },
  waiting: { count: 0, items: [] },
  done: { count: 0, items: [] },
  failed: { count: 0, items: [] },
  follow_up: { count: 0, items: [] },
};

export function WorkBoardView() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const setSection = useUiStore((s) => s.setSection);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSelectedApplicationId = useUiStore((s) => s.setSelectedApplicationId);
  const navigate = usePageNavigation();

  const board = state?.workBoard?.states ?? EMPTY_BOARD;
  const report = state?.workReport ?? null;
  const total = LENS_ORDER.reduce((n, key) => n + (board[key]?.count ?? 0), 0);
  const todoCounts = mobileTodoCounts(state);

  // Land on the native surface for context/action. Follow-up refusal rows and
  // 待决策 rows carry an invocation/application target; select it so the user
  // arrives on the right row rather than a cold list.
  const open = (item: WorkItem) => {
    if (item.section === "invocations" && item.targetId) setSelectedInvocationId(item.targetId);
    if (item.section === "applications" && item.targetId) setSelectedApplicationId(item.targetId);
    setSection(item.section as SectionKey);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <KanbanSquare className="size-5 text-muted-foreground" />
        <h1 className="shrink-0 whitespace-nowrap text-lg font-semibold">
          <span className="md:hidden">{t("todo.title")}</span>
          <span className="hidden md:inline">{t("workBoard.title")}</span>
        </h1>
        <Badge tone="neutral">{t("workBoard.items", { count: total })}</Badge>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">{t("workBoard.subtitle")}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 md:hidden" aria-label={t("todo.summary")}>
        <button
          type="button"
          onClick={() => navigate("autoRuns")}
          className="flex min-h-16 min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-muted/50"
        >
          <ListTodo className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-lg font-semibold tabular-nums">{todoCounts.active}</span>
            <span className="block text-xs text-muted-foreground">{t("todo.active")}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => navigate("approvals")}
          className="flex min-h-16 min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-muted/50"
        >
          <UserCheck className="size-5 shrink-0 text-warning" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-lg font-semibold tabular-nums">{todoCounts.attention}</span>
            <span className="block text-xs text-muted-foreground">{t("todo.attention")}</span>
          </span>
        </button>
      </div>

      {report ? <WorkReportStrip report={report} /> : null}
      {state?.reportSchedule ? (
        <ReportSchedulePanel
          schedule={state.reportSchedule}
          channels={(state.channelOperations ?? []).map((c) => ({ id: c.id, name: c.name }))}
          conversations={state.channelConversations ?? []}
        />
      ) : null}

      {total === 0 ? (
        <EmptyState title={t("workBoard.emptyTitle")} hint={t("workBoard.emptyHint")} />
      ) : (
        <div className="grid min-h-0 flex-1 auto-rows-min gap-3 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
          {LENS_ORDER.map((key) => (
            <LensColumn key={key} state={key} lens={board[key] ?? { count: 0, items: [] }} onOpen={open} />
          ))}
        </div>
      )}
    </div>
  );
}

const PERIOD_ORDER: WorkPeriodKey[] = ["day", "week", "month", "quarter"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Config for the scheduled work-report → channel push. Admin-plane (only rendered
// when the server exposes `reportSchedule`, i.e. an unscoped/local viewer). Posts
// to a conversation's user — WeCom has no group broadcast here, so the target is
// picked from conversations someone has already opened with the bot.
function ReportSchedulePanel({
  schedule,
  channels,
  conversations,
}: {
  schedule: ReportSchedule;
  channels: { id: string; name: string }[];
  conversations: { id: string; channelId: string; externalUserId: string }[];
}) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ReportSchedule>(schedule);
  const { execute, pending, error } = useAsyncAction();
  const refresh = useRefreshConsoleState();
  const [posted, setPosted] = useState<string | null>(null);

  const set = <K extends keyof ReportSchedule>(k: K, v: ReportSchedule[K]) => setForm((f) => ({ ...f, [k]: v }));
  const convOptions = conversations.filter((c) => !form.channelId || c.channelId === form.channelId);

  const save = () =>
    execute(async () => {
      await api.setReportSchedule({
        enabled: form.enabled,
        channelId: form.channelId,
        conversationId: form.conversationId,
        periodKey: form.periodKey,
        coverage: form.coverage,
        cadence: form.cadence,
        weekday: form.weekday,
        time: form.time,
      });
      await refresh();
    });

  const postNow = async () => {
    setPosted(null);
    const ok = await execute(async () => {
      const r = (await api.postReportNow()) as { posted?: boolean; reason?: string; chunks?: number };
      setPosted(r?.posted ? t("workBoard.posted", { count: r.chunks ?? 0 }) : t("workBoard.notPosted", { reason: r?.reason ?? "unknown" }));
    });
    if (ok) void refresh();
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Send className="size-4 text-muted-foreground" />
          <span className="text-xs font-semibold">{t("workBoard.schedule")}</span>
          <Badge tone={schedule.enabled ? "success" : "neutral"}>{schedule.enabled ? t("workBoard.on") : t("workBoard.off")}</Badge>
          {schedule.enabled && schedule.nextRunAt ? (
            <span className="text-[11px] text-muted-foreground">{t("workBoard.next", { time: schedule.nextRunAt.replace("T", " ").slice(0, 16) })}</span>
          ) : null}
          {schedule.lastPostedAt ? (
            <span className="text-[11px] text-muted-foreground">· {t("workBoard.last", { time: schedule.lastPostedAt.replace("T", " ").slice(0, 16) })}</span>
          ) : null}
          <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={() => setOpen((v) => !v)}>
            {open ? t("workBoard.close") : t("workBoard.configure")}
          </Button>
        </div>

        {open ? (
          <div className="flex flex-col gap-2 border-t border-border pt-2 text-xs">
            {channels.length === 0 ? (
              <p className="text-muted-foreground">{t("workBoard.noChannels")}</p>
            ) : conversations.length === 0 ? (
              <p className="text-muted-foreground">{t("workBoard.noConversations")}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
                {t("workBoard.enabled")}
              </label>

              <Field label={t("workBoard.channel")}>
                <select className={selectCls} value={form.channelId ?? ""} onChange={(e) => set("channelId", e.target.value || null)}>
                  <option value="">{t("workBoard.pick")}</option>
                  {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>

              <Field label={t("workBoard.to")}>
                <select className={selectCls} value={form.conversationId ?? ""} onChange={(e) => set("conversationId", e.target.value || null)}>
                  <option value="">{t("workBoard.pick")}</option>
                  {convOptions.map((c) => <option key={c.id} value={c.id}>{c.externalUserId}</option>)}
                </select>
              </Field>

              <Field label={t("workBoard.report")}>
                <select className={selectCls} value={form.periodKey} onChange={(e) => set("periodKey", e.target.value as WorkPeriodKey)}>
                  {PERIOD_ORDER.map((k) => <option key={k} value={k}>{t(`workBoard.period.${k}`)}</option>)}
                </select>
              </Field>

              <Field label={t("workBoard.cover")}>
                <select className={selectCls} value={form.coverage} onChange={(e) => set("coverage", e.target.value as "previous" | "current")}>
                  <option value="previous">{t("workBoard.previous")}</option><option value="current">{t("workBoard.current")}</option>
                </select>
              </Field>

              <Field label={t("workBoard.cadence")}>
                <select className={selectCls} value={form.cadence} onChange={(e) => set("cadence", e.target.value as "daily" | "weekly")}>
                  <option value="daily">{t("workBoard.daily")}</option><option value="weekly">{t("workBoard.weekly")}</option>
                </select>
              </Field>

              {form.cadence === "weekly" ? (
                <Field label={t("workBoard.day")}>
                  <select className={selectCls} value={form.weekday} onChange={(e) => set("weekday", Number(e.target.value))}>
                    {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                </Field>
              ) : null}

              <Field label={t("workBoard.time")}>
                <input type="time" className={selectCls} value={form.time} onChange={(e) => set("time", e.target.value)} />
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" disabled={pending} onClick={save}>
                {pending ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}{t("workBoard.save")}
              </Button>
              <Button variant="secondary" size="sm" className="h-7 px-2.5 text-xs" disabled={pending || !form.channelId || !form.conversationId} onClick={postNow} title={t("workBoard.postTitle")}>
                <Send className="mr-1 size-3" />{t("workBoard.postNow")}
              </Button>
              {posted ? <span className="text-[11px] text-muted-foreground">{posted}</span> : null}
              {error ? <span className="text-[11px] text-destructive">{error}</span> : null}
              <span className="ml-auto text-[11px] text-muted-foreground">{t("workBoard.serverTime")}</span>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

const selectCls = "h-7 rounded-md border border-border bg-background px-1.5 text-xs";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </span>
  );
}

// The report strip at the top of the board — a day/week/month/quarter switch
// over the flow numbers, the aging-attention nudge, and a one-click copy of the
// selected period's server-rendered markdown (reusable by a scheduled channel post).
function WorkReportStrip({ report }: { report: WorkReport }) {
  const { t } = useAppTranslation();
  const [period, setPeriod] = useState<WorkPeriodKey>("day");
  const [copied, setCopied] = useState(false);
  const current = report.periods[period];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(current.markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  const { flow } = current;
  const agingCount = report.attention.agingDecisions.length + report.attention.stuckRuns.length;
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="inline-flex rounded-md border border-border p-0.5">
            {PERIOD_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                className={cn(
                  "rounded px-2 py-0.5 text-xs capitalize transition-colors",
                  period === key ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`workBoard.period.${key}`)}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-muted-foreground">{current.label} · {t("workBoard.since", { date: current.startDate })}</span>
          <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={copy} title={t("workBoard.copyTitle")}>
            <ClipboardCopy className="mr-1 size-3" />
            {copied ? t("workBoard.copied") : t("workBoard.copy")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <DigestStat label={t("workBoard.opened")} value={flow.opened} />
          <DigestStat label={t("workBoard.completed")} value={flow.completed} tone={flow.completed ? "success" : undefined} />
          <DigestStat label={t("workBoard.failed")} value={flow.failed} tone={flow.failed ? "danger" : undefined} />
          <DigestStat
            label={flow.refusalsPartial ? t("workBoard.refusalsPartial") : t("workBoard.refusals")}
            value={flow.refusals}
            tone={flow.refusals ? "warning" : undefined}
            title={flow.refusalsPartial ? t("workBoard.refusalHint") : undefined}
          />
          {agingCount ? <DigestStat label={t("workBoard.aging")} value={agingCount} tone="warning" /> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function DigestStat({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: number | null;
  tone?: "success" | "danger" | "warning";
  title?: string;
}) {
  const toneClass =
    tone === "success" ? "text-success" : tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <span className="flex items-baseline gap-1" title={title}>
      <span className={cn("font-semibold tabular-nums", toneClass)}>{value == null ? "—" : value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function LensColumn({
  state,
  lens,
  onOpen,
}: {
  state: WorkState;
  lens: { count: number; items: WorkItem[] };
  onOpen: (item: WorkItem) => void;
}) {
  const { t, i18n } = useAppTranslation();
  const meta = LENS_META[state];
  const Icon = meta.icon;
  return (
    <section className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2 px-0.5">
        <Icon className={cn("size-4 text-muted-foreground", state === "in_progress" && lens.count > 0 && "animate-spin")} />
        <span className="text-sm font-semibold">{t(`workBoard.lens.${state}`)}</span>
        <Badge tone={lens.count ? meta.tone : "neutral"} className="ml-auto">{lens.count}</Badge>
      </div>
      {lens.items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">{t("workBoard.none")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {lens.items.slice(0, 50).map((item) => (
            <li key={item.id}>
              <Card
                role="button"
                tabIndex={0}
                onClick={() => onOpen(item)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(item))}
                className={cn("cursor-pointer border-l-2 transition-colors hover:bg-muted/40", TONE_ACCENT[meta.tone])}
              >
                <CardContent className="flex flex-col gap-0.5 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.title}</span>
                    {(() => {
                      const age = since(item.updatedAt, i18n.resolvedLanguage ?? "en-US");
                      return age ? <span className="shrink-0 text-[10px] text-muted-foreground">{age}</span> : null;
                    })()}
                  </div>
                  {item.reason ? (
                    <p className="truncate text-[11px] text-muted-foreground">{item.reason}</p>
                  ) : item.subtitle ? (
                    <p className="truncate text-[11px] text-muted-foreground">{item.subtitle}</p>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
          {lens.items.length > 50 ? (
            <li className="px-1 text-[10px] text-muted-foreground">{t("workBoard.more", { count: lens.items.length - 50 })}</li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
