import { useMemo, useState } from "react";
import { History, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EventTimeline } from "@/features/invocations/event-timeline";
import { RunTranscriptSection } from "@/features/invocations/run-transcript";
import { api } from "@/data/use-console-actions";
import type { InvocationEventSnapshot } from "@/lib/console-state";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useUiStore } from "@/store/ui-store";
import { eventsForRun, failoverSummary, type AutoRunRecord } from "./auto-run-model";

export function AutoRunRoutingFeedback({ run, onSaved }: { run: AutoRunRecord; onSaved: () => void }) {
  const { t } = useAppTranslation();
  const [path, setPath] = useState(run.routingOverride?.actualPath ?? run.decision?.path ?? "develop");
  const [reason, setReason] = useState(run.routingOverride?.reason ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-primary">{t("routingFeedback.title")}</summary>
      <div className="mt-2 flex flex-wrap gap-2 rounded bg-muted p-2">
        <Select className="h-7 w-32 text-xs" value={path} onChange={(event) => setPath(event.target.value)}>
          {["develop", "office", "general", "design", "creative", "content", "prototype", "clarify", "decompose"].map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
        <Input className="h-7 min-w-48 flex-1 text-xs" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("routingFeedback.reason")} />
        <Button size="sm" disabled={saving || !reason.trim()} onClick={() => {
          setSaving(true);
          setError("");
          void api.recordAutoRunRoutingOverride(run.id, path, reason, run.routingOverride?.revision ?? 0)
            .then(() => onSaved())
            .catch((caught: unknown) => {
              if (caught instanceof ApiError && caught.status === 409) {
                setError(t("routingFeedback.conflict"));
                onSaved();
                return;
              }
              setError(caught instanceof Error ? caught.message : t("routingFeedback.failed"));
            })
            .finally(() => setSaving(false));
        }}>{t("routingFeedback.save")}</Button>
      </div>
      {error ? <p className="mt-1 text-red-600">{error}</p> : null}
      {run.routingOverride ? <p className="mt-1 text-muted-foreground">{run.routingOverride.actorId} · {run.routingOverride.recordedAt}</p> : null}
    </details>
  );
}
// Happy-path stepper; off-path states (awaiting_approval/blocked/failed) render
// as the badge instead. Index tells us how far a run got.
const STAGES: { key: string; label: string }[] = [
  { key: "materializing", label: "Worktree" },
  { key: "running", label: "Agent" },
  { key: "verifying", label: "Verify" },
  { key: "publishing", label: "Publish" },
  { key: "pr_open", label: "PR" },
];
const STAGE_INDEX: Record<string, number> = {
  materializing: 0,
  running: 1,
  waiting_capacity: 1,
  awaiting_approval: 1,
  verifying: 2,
  publishing: 3,
  pr_open: 4,
};
// The linear stepper only describes the DEVELOP route. Off-route runs (design /
// clarify / decompose → report_posted / needs_input / plan_proposed / decomposed)
// and failed/blocked runs have no position in it, so we HIDE it for them instead
// of rendering every node grey (which reads as "stuck at the very start" — the run
// A audit's "all-grey stepper" defect). Their status badge + route panels + error
// carry the state; the true per-stage lifecycle comes from the event timeline (next).
export function hasDevelopStepper(status: string): boolean {
  return STAGE_INDEX[status] !== undefined;
}

export function AutoRunFailoverTrace({ run }: { run: AutoRunRecord }) {
  const setSection = useUiStore((s) => s.setSection);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const history = run.failoverHistory ?? [];
  const summary = failoverSummary(run.failoverOutcome);
  if (!summary && history.length === 0) return null;
  function openInvocation(invocationId?: string | null) {
    if (!invocationId) return;
    setSelectedInvocationId(invocationId);
    setSection("invocations");
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs">
      <RefreshCw className="size-3.5 text-amber-600 dark:text-amber-400" />
      <span className="font-medium">{summary ?? `${history.length} failover attempt${history.length === 1 ? "" : "s"}`}</span>
      {history.map((transition) => (
        <span key={`${transition.at ?? transition.attempt}-${transition.toInvocationId ?? "unknown"}`} className="inline-flex items-center gap-1 text-muted-foreground">
          <span>#{transition.attempt} {transition.fromAgentId ?? "unknown"} → {transition.toAgentId ?? "unknown"}</span>
          {transition.fromInvocationId ? (
            <button type="button" className="text-primary hover:underline" onClick={() => openInvocation(transition.fromInvocationId)}>
              previous run
            </button>
          ) : null}
          {transition.toInvocationId ? (
            <button type="button" className="text-primary hover:underline" onClick={() => openInvocation(transition.toInvocationId)}>
              recovered run
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}

// Per-run lifecycle TIMELINE (execution 过程). The server records every pipeline
// transition as an `auto_run_*` event keyed by data.autoRunId; the client already
// receives them in the state snapshot, so we filter + order them here (oldest→newest)
// and reuse the invocations EventTimeline. Hidden when a run has no events (evicted
// from the bounded ring buffer, or none yet).
export function AutoRunTimeline({ runId, invocationId, terminal, events }: { runId: string; invocationId?: string | null; terminal?: boolean; events: InvocationEventSnapshot[] }) {
  const [open, setOpen] = useState(false);
  const runEvents = useMemo(
    () => eventsForRun(events, runId, invocationId),
    [events, invocationId, runId],
  );
  if (runEvents.length === 0) return null;
  const latest = runEvents.at(-1)!;
  const latestAgeSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(latest.createdAt)) / 1_000));
  const latestAge = latestAgeSeconds < 60
    ? `${latestAgeSeconds}s`
    : `${Math.floor(latestAgeSeconds / 60)}m`;
  return (
    <div className="flex w-full flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
      >
        <History className="size-3" />
        {open ? "收起实时过程" : `实时过程 (${runEvents.length})`}
        <span className={cn("ml-1", latestAgeSeconds <= 120 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
          · 最近活动 {latestAge} 前
        </span>
      </button>
      {open ? (
        <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
          {/* #1074/#1086: the agent's own work (thinking / tool IN-OUT / Markdown)
              beside the lifecycle events. The terminal gate is the stale-null-race
              fix: expanding mid-run must not fetch (and cache) a pre-completion null. */}
          <RunTranscriptSection invocationId={invocationId} terminal={terminal} defaultOpen={false} />
          <EventTimeline events={runEvents} />
        </div>
      ) : null}
    </div>
  );
}

export function AutoRunStepper({ status }: { status: string }) {
  const { t } = useAppTranslation();
  const reached = STAGE_INDEX[status] ?? -1;
  const failedHere = status === "failed" || status === "blocked";
  return (
    <div className="flex items-center gap-1">
      {STAGES.map((stage, i) => {
        const done = reached > i || status === "pr_open";
        const current = reached === i && status !== "pr_open";
        return (
          <div key={stage.key} className="flex items-center gap-1">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                done && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                current && !failedHere && "bg-blue-500/15 text-blue-600 dark:text-blue-400",
                current && failedHere && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                !done && !current && "bg-muted text-muted-foreground",
              )}
            >
              {t(`autoRuns.stage.${stage.key}` as never)}
            </span>
            {i < STAGES.length - 1 ? <span className="text-muted-foreground/40">›</span> : null}
          </div>
        );
      })}
    </div>
  );
}
