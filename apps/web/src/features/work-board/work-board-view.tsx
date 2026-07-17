import { useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCopy, Inbox, KanbanSquare, Loader2, PauseCircle, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { cn } from "@/lib/cn";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore, type SectionKey } from "@/store/ui-store";
import type { DailyDigest, WorkBoard, WorkItem, WorkState } from "@/lib/console-state";

// The Status board: six lenses over the same work (server read-model `workBoard`)
// so a supervisor can see, on one screen, what is 待决策 / 在等待 / 正在做 / 已做完 /
// 已失败 / 要跟进 without hopping between Approvals, Auto-runs, and Evidence. Every
// row deep-links to its native surface for the rich context and any action.

const LENS_ORDER: WorkState[] = ["pending_decision", "follow_up", "in_progress", "waiting", "failed", "done"];

type LensTone = "warning" | "danger" | "success" | "neutral" | "running";

const LENS_META: Record<WorkState, { label: string; zh: string; icon: LucideIcon; tone: LensTone }> = {
  pending_decision: { label: "Pending decision", zh: "待决策", icon: Inbox, tone: "warning" },
  follow_up: { label: "Follow-up", zh: "要跟进", icon: AlertTriangle, tone: "warning" },
  in_progress: { label: "In progress", zh: "正在做", icon: Loader2, tone: "running" },
  waiting: { label: "Waiting", zh: "在等待", icon: PauseCircle, tone: "neutral" },
  failed: { label: "Failed", zh: "已失败", icon: AlertTriangle, tone: "danger" },
  done: { label: "Done", zh: "已做完", icon: CheckCircle2, tone: "success" },
};

const TONE_ACCENT: Record<LensTone, string> = {
  warning: "border-l-warning",
  danger: "border-l-destructive",
  success: "border-l-success",
  running: "border-l-primary",
  neutral: "border-l-muted-foreground/40",
};

function since(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
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
  const { data: state } = useConsoleState();
  const setSection = useUiStore((s) => s.setSection);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSelectedApplicationId = useUiStore((s) => s.setSelectedApplicationId);

  const board = state?.workBoard?.states ?? EMPTY_BOARD;
  const digest = state?.dailyDigest ?? null;
  const total = LENS_ORDER.reduce((n, key) => n + (board[key]?.count ?? 0), 0);

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
        <h1 className="text-lg font-semibold">Status</h1>
        <Badge tone="neutral">{total} items</Badge>
        <span className="ml-auto text-xs text-muted-foreground">Every work item by state · newest first</span>
      </div>

      {digest ? <DailyDigestStrip digest={digest} /> : null}

      {total === 0 ? (
        <EmptyState title="Nothing tracked yet" hint="Auto-runs, pending decisions, and recent refusals land here, grouped by state." />
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

// The "Today" strip: the daily report at the top of the board — a few flow
// numbers, the aging-attention nudges, and a one-click copy of the full
// server-rendered markdown report (reusable by a future scheduled channel post).
function DailyDigestStrip({ digest }: { digest: DailyDigest }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(digest.markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  const { flow, attention } = digest;
  const agingCount = attention.agingDecisions.length + attention.stuckRuns.length;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">Today</span>
          <span className="text-[11px] text-muted-foreground">{digest.date}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <DigestStat label="Opened" value={flow.opened} />
          <DigestStat label="Completed" value={flow.completed} tone={flow.completed ? "success" : undefined} />
          <DigestStat label="Failed" value={flow.failed} tone={flow.failed ? "danger" : undefined} />
          <DigestStat label="Refusals" value={flow.refusals} tone={flow.refusals ? "warning" : undefined} />
          {agingCount ? <DigestStat label="Aging >24h" value={agingCount} tone="warning" /> : null}
        </div>
        <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={copy} title="Copy the full markdown report">
          <ClipboardCopy className="mr-1 size-3" />
          {copied ? "Copied" : "Copy report"}
        </Button>
      </CardContent>
    </Card>
  );
}

function DigestStat({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" | "warning" }) {
  const toneClass =
    tone === "success" ? "text-success" : tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <span className="flex items-baseline gap-1">
      <span className={cn("font-semibold tabular-nums", toneClass)}>{value}</span>
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
  const meta = LENS_META[state];
  const Icon = meta.icon;
  return (
    <section className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2 px-0.5">
        <Icon className={cn("size-4 text-muted-foreground", state === "in_progress" && lens.count > 0 && "animate-spin")} />
        <span className="text-sm font-semibold">{meta.label}</span>
        <span className="text-xs text-muted-foreground">{meta.zh}</span>
        <Badge tone={lens.count ? meta.tone : "neutral"} className="ml-auto">{lens.count}</Badge>
      </div>
      {lens.items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">None</p>
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
                      const age = since(item.updatedAt);
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
            <li className="px-1 text-[10px] text-muted-foreground">+{lens.items.length - 50} more</li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
