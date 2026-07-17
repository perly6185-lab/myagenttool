import { useState } from "react";
import { GitCompare, Loader2, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { cn } from "@/lib/cn";
import { useConsoleState, useRefreshConsoleState } from "@/data/use-console-state";
import { api, useAsyncAction } from "@/data/use-console-actions";
import { Transcript } from "@/features/invocations/transcript";
import type { WorktreeReview } from "@/lib/console-state";
import { RunTranscriptSection, isTerminalRunStatus } from "@/features/invocations/run-transcript";

// #128 Phase 4: run ONE task on 2+ agents and compare their transcripts side by side.
// The server (createCompareRun / POST /api/compare-runs) already fans out, tracks the
// group, and picks a preferred child; this view is the composer + the side-by-side.

export function CompareView() {
  const { data: state } = useConsoleState();
  const refresh = useRefreshConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const [task, setTask] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const agents = state?.agents ?? [];
  const compareRuns = state?.compareRuns ?? [];
  const invocations = state?.invocations ?? [];
  const events = state?.events ?? [];
  const active = compareRuns.find((c) => c.id === activeId) ?? compareRuns[0] ?? null;

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const agentName = (agentId?: string) => agents.find((a) => a.id === agentId)?.name ?? agentId ?? "agent";

  const start = async () => {
    if (!task.trim() || selected.length < 2) return;
    // Pass the current project so each agent runs in its OWN worktree (P4.2) — this
    // is what lets the diffs be compared + a winner promoted. No project => shared.
    const ok = await execute(() => api.startCompareRun(task.trim(), selected, state?.currentProjectId ?? null));
    if (ok) {
      setActiveId(null); // fall back to the newest compare run (server unshifts it)
      setTask("");
      void refresh();
    }
  };

  const prefer = async (invocationId: string) => {
    if (!active) return;
    if (await execute(() => api.setCompareRunPreferred(active.id, invocationId))) void refresh();
  };
  const promote = async () => {
    if (!active) return;
    if (await execute(() => api.promoteCompareRun(active.id))) void refresh();
  };
  const review = async (worktreeId: string, verdict: "approved" | "changes_requested") => {
    if (await execute(() => api.reviewWorktree(worktreeId, { verdict }))) void refresh();
  };

  // Latest review per worktree (server list is newest-first → keep the first seen).
  const reviewByWorktree = new Map<string, WorktreeReview>();
  for (const r of state?.worktreeReviews ?? []) if (!reviewByWorktree.has(r.worktreeId)) reviewByWorktree.set(r.worktreeId, r);

  const children = active
    ? active.childInvocationIds.map((id) => invocations.find((i) => i.id === id)).filter((x): x is NonNullable<typeof x> => Boolean(x))
    : [];

  return (
    <div className="flex h-full flex-col gap-3">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-1.5 text-base"><GitCompare className="size-4" /> Compare agents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            rows={2}
            placeholder="One task to run on every selected agent…"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
          <div className="flex flex-wrap gap-1.5">
            {agents.length === 0 ? (
              <span className="text-xs text-muted-foreground">No agents registered.</span>
            ) : agents.map((a) => (
              <label key={a.id} className={cn("flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs", selected.includes(a.id) ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted-foreground")}>
                <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggle(a.id)} className="size-3" />
                {a.name ?? a.id}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => void start()} disabled={pending || !task.trim() || selected.length < 2}>
              {pending ? <Loader2 className="mr-1 size-4 animate-spin" /> : <GitCompare className="mr-1 size-4" />} Compare on {selected.length} agent(s)
            </Button>
            {selected.length < 2 ? <span className="text-xs text-muted-foreground">Select at least 2 agents.</span> : null}
          </div>
          {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
        </CardContent>
      </Card>

      {compareRuns.length ? (
        <div className="flex flex-wrap gap-1.5">
          {compareRuns.slice(0, 8).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveId(c.id)}
              title={c.task}
              className={cn("truncate rounded-md border px-2 py-1 text-xs", c.id === active?.id ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
            >
              {c.task.length > 34 ? `${c.task.slice(0, 34)}…` : c.task} · {c.status}
            </button>
          ))}
        </div>
      ) : null}

      {active ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {active.preferredInvocationId ? (() => {
            const preferredChild = children.find((c) => c.id === active.preferredInvocationId);
            const preferredReview = preferredChild?.worktreeId ? reviewByWorktree.get(preferredChild.worktreeId) : undefined;
            const approved = preferredReview?.verdict === "approved";
            return (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs">
                <Trophy className="size-3.5 text-success" />
                <span>Preferred: <b>{agentName(preferredChild?.agentId)}</b></span>
                {active.promotion?.prNumber ? (
                  <a className="text-primary underline" href={active.promotion.prUrl ?? "#"} target="_blank" rel="noreferrer">promoted → PR #{active.promotion.prNumber}</a>
                ) : active.isolated ? (
                  <>
                    <Button variant="primary" size="sm" className="h-6 px-2 text-xs" disabled={pending || !approved} onClick={() => void promote()}>
                      {pending ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Trophy className="mr-1 size-3" />} Promote winner → PR
                    </Button>
                    {!approved ? (
                      <span className="text-warning">{preferredReview?.verdict === "changes_requested" ? "changes requested — re-approve to promote" : "approve the winner's diff to promote"}</span>
                    ) : null}
                  </>
                ) : <span className="text-muted-foreground">(shared compare — nothing to promote)</span>}
              </div>
            );
          })() : null}
          <div className="grid min-h-0 flex-1 gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, children.length)}, minmax(0, 1fr))` }}>
            {children.map((inv) => {
              const invEvents = events.filter((e) => e.invocationId === inv.id);
              const preferred = active.preferredInvocationId === inv.id;
              return (
                <Card key={inv.id} className={cn("flex min-h-0 flex-col", preferred && "ring-1 ring-primary")}>
                  <CardHeader className="flex-row items-center justify-between gap-2 py-2">
                    <CardTitle className="truncate text-sm">{agentName(inv.agentId)}</CardTitle>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {preferred ? <Badge tone="success"><Trophy className="mr-1 size-3" />preferred</Badge> : (
                        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" disabled={pending} onClick={() => void prefer(inv.id)}>prefer</Button>
                      )}
                      <span className="text-xs text-muted-foreground">{inv.status}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                    <Transcript events={invEvents} summary={inv.result?.summary ? { text: inv.result.summary, status: inv.status } : undefined} />
                    {/* #1086: judge agents by their actual work, not just events. */}
                    <RunTranscriptSection invocationId={inv.id} terminal={isTerminalRunStatus(inv.status)} defaultOpen={false} />
                    {inv.worktreeId ? (
                      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs">
                        <span className="text-muted-foreground">Review:</span>
                        {(() => { const rv = reviewByWorktree.get(inv.worktreeId); return rv ? <Badge tone={rv.verdict === "approved" ? "success" : "warning"}>{rv.verdict === "approved" ? "approved" : "changes requested"}</Badge> : <span className="text-muted-foreground">none</span>; })()}
                        <Button variant="ghost" size="sm" className="ml-auto h-6 px-1.5 text-[11px]" disabled={pending} onClick={() => void review(inv.worktreeId!, "approved")}>Approve</Button>
                        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" disabled={pending} onClick={() => void review(inv.worktreeId!, "changes_requested")}>Request changes</Button>
                      </div>
                    ) : null}
                    {inv.worktreeId ? <CompareDiff worktreeId={inv.worktreeId} /> : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState title="No comparison yet" hint="Enter a task, pick 2+ agents, and Compare to run them side by side." />
      )}
    </div>
  );
}

type CompareDiffData = { files: { path: string }[]; base: string; diff: string; truncated: boolean };

// Lazily fetch and render one child worktree's unified diff so the two agents'
// code changes can be compared side by side (P4.2). Collapsed by default — a
// compare run can fan out several agents and each diff can be large.
function CompareDiff({ worktreeId }: { worktreeId: string }) {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<CompareDiffData | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !diff && !loading) {
      setLoading(true);
      try {
        setDiff((await api.worktreeDiff(worktreeId)) as CompareDiffData);
      } catch {
        setDiff(null);
      } finally {
        setLoading(false);
      }
    }
  };

  const lines = diff ? diff.diff.split("\n").slice(0, 600) : [];
  const clipped = diff ? diff.diff.split("\n").length - lines.length : 0;

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex w-full items-center justify-between px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <span>{open ? "Hide" : "Show"} diff{diff ? ` · ${diff.files.length} file(s)` : ""}</span>
        {loading ? <Loader2 className="size-3 animate-spin" /> : null}
      </button>
      {open && diff ? (
        diff.diff.trim() ? (
          <pre className="max-h-72 overflow-auto border-t border-border px-2 py-1 font-mono text-[11px] leading-tight">
            {lines.map((line, i) => (
              <div key={i} className={cn("whitespace-pre-wrap", diffLineClass(line))}>{line || " "}</div>
            ))}
            {clipped > 0 || diff.truncated ? (
              <div className="text-muted-foreground">… {clipped > 0 ? `${clipped} more line(s)` : "diff truncated"}</div>
            ) : null}
          </pre>
        ) : (
          <div className="border-t border-border px-2 py-1 text-[11px] text-muted-foreground">No changes on this branch.</div>
        )
      ) : null}
    </div>
  );
}

// Colorize one unified-diff line (mirrors the worktree Changes view).
function diffLineClass(line: string): string {
  if (line.startsWith("@@")) return "text-sky-500 bg-muted/50";
  if (
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("new file") ||
    line.startsWith("deleted file") ||
    line.startsWith("rename ") ||
    line.startsWith("similarity ")
  ) {
    return "text-muted-foreground";
  }
  if (line[0] === "+") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (line[0] === "-") return "bg-destructive/10 text-destructive";
  return "text-muted-foreground";
}
