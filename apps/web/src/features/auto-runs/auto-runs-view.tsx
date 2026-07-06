import { useCallback, useEffect, useState } from "react";
import { Bot, RefreshCw, GitPullRequest, GitBranch, ShieldCheck, ExternalLink, CircleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { api } from "@/data/use-console-actions";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/readable-labels";

interface AutoRunLink {
  type: "issue" | "pr";
  number: number;
  title: string;
  url: string | null;
}
interface AutoRunRecord {
  id: string;
  status: string;
  link?: AutoRunLink | null;
  intent?: string | null;
  decision?: { path: string; decidedBy: string; confidence: number; rationale?: string | null } | null;
  branchName?: string | null;
  prNumber?: number | null;
  prUrl?: string | null;
  verification?: { passed: boolean; verified: boolean; summary?: string | null } | null;
  childIssues?: { number: number; url: string | null }[] | null;
  report?: string | null;
  prState?: string | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
interface AutoRunSummary {
  total: number;
  active: number;
  byStatus: Record<string, number>;
  outcomes: { prOpen: number; blocked: number; failed: number; reportPosted: number; needsInput: number };
  successRate: number | null;
  verification: { passed: number; failed: number; unverified: number };
  routing?: { alignmentRate: number | null; conclusive: number } | null;
  blockedReasons: { reason: string; count: number }[];
  timeToPr: { count: number; medianSeconds: number | null; p90Seconds: number | null };
}

const STATUS_LABEL: Record<string, string> = {
  materializing: "Creating worktree",
  running: "Agent running",
  awaiting_approval: "Needs approval",
  verifying: "Verifying",
  publishing: "Publishing",
  pr_open: "PR open",
  report_posted: "Report posted",
  needs_input: "Needs input",
  blocked: "Blocked",
  failed: "Failed",
};
function statusTone(status: string): Tone {
  if (status === "pr_open" || status === "report_posted") return "success";
  if (status === "failed") return "danger";
  if (status === "blocked" || status === "awaiting_approval" || status === "needs_input") return "warning";
  return "running";
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
  awaiting_approval: 1,
  verifying: 2,
  publishing: 3,
  pr_open: 4,
};

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Stepper({ status }: { status: string }) {
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
              {stage.label}
            </span>
            {i < STAGES.length - 1 ? <span className="text-muted-foreground/40">›</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export function AutoRunsView() {
  const [runs, setRuns] = useState<AutoRunRecord[]>([]);
  const [summary, setSummary] = useState<AutoRunSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      // Manual refresh also refreshes PR dispositions (bounded gh reads); the
      // 10s poll never does, so it stays cheap.
      const data = (await api.listAutoRuns(refresh)) as { autoRuns?: AutoRunRecord[]; summary?: AutoRunSummary };
      setRuns(data.autoRuns ?? []);
      setSummary(data.summary ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Poll so the loop is observable in near-real-time without a manual refresh.
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const rate = summary?.successRate;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Bot className="size-5" /> Auto-runs
          </h1>
          <p className="text-sm text-muted-foreground">Autonomous issue → worktree → agent → PR runs, and how the loop is performing.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load(true)} disabled={loading}>
          <RefreshCw className={cn("mr-1 size-3.5", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {summary ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Total runs" value={String(summary.total)} hint={`${summary.active} in flight`} />
            <StatTile
              label="PR success rate"
              value={rate == null ? "—" : `${Math.round(rate * 100)}%`}
              hint={`${summary.outcomes.prOpen} PR · ${summary.outcomes.blocked} blocked · ${summary.outcomes.failed} failed`}
            />
            <StatTile
              label="Verification"
              value={`${summary.verification.passed}✓`}
              hint={`${summary.verification.failed} failed · ${summary.verification.unverified} unverified`}
            />
            <StatTile
              label="Time to PR (median)"
              value={fmtDuration(summary.timeToPr.medianSeconds)}
              hint={`p90 ${fmtDuration(summary.timeToPr.p90Seconds)} · n=${summary.timeToPr.count}`}
            />
            <StatTile
              label="Routing alignment"
              value={summary.routing?.alignmentRate == null ? "—" : `${Math.round(summary.routing.alignmentRate * 100)}%`}
              hint={`over ${summary.routing?.conclusive ?? 0} conclusive run(s)`}
            />
          </div>
          {summary.outcomes.reportPosted + summary.outcomes.needsInput > 0 ? (
            <p className="text-xs text-muted-foreground">
              Non-diff outcomes: {summary.outcomes.reportPosted} investigation report(s), {summary.outcomes.needsInput} needing input.
            </p>
          ) : null}
          {summary.blockedReasons.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <CircleAlert className="size-4" /> Top blocked reasons
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {summary.blockedReasons.map((r) => (
                  <div key={r.reason} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-muted-foreground">{r.reason}</span>
                    <Badge tone="warning">{r.count}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {runs.length === 0 && !loading ? (
        <EmptyState
          title="No auto-runs yet"
          hint="Click Auto on a Task issue, or enable label-based auto-triggering, to start an autonomous run."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {runs.map((run) => (
            <Card key={run.id}>
              <CardContent className="flex flex-col gap-2 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge tone={statusTone(run.status)}>{STATUS_LABEL[run.status] ?? run.status}</Badge>
                    {run.link ? (
                      <span className="truncate text-sm font-medium">
                        {run.link.type === "pr" ? "PR" : "Issue"} #{run.link.number}: {run.link.title}
                      </span>
                    ) : (
                      <span className="truncate text-sm text-muted-foreground">{run.id}</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {run.prUrl ? (
                      <a href={run.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        <GitPullRequest className="size-3.5" /> PR #{run.prNumber}
                      </a>
                    ) : null}
                    {run.prState === "MERGED" ? <Badge tone="success">merged</Badge> : null}
                    {run.prState === "CLOSED" ? <Badge tone="warning">closed</Badge> : null}
                    {(run.childIssues ?? []).map((child) =>
                      child.url ? (
                        <a key={child.number} href={child.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline" title="Pending-decision child issue">
                          → #{child.number}
                        </a>
                      ) : (
                        <span key={child.number} className="text-xs text-muted-foreground">→ #{child.number}</span>
                      ),
                    )}
                    {run.link?.url ? (
                      <a href={run.link.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Open on GitHub">
                        <ExternalLink className="size-4" />
                      </a>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <Stepper status={run.status} />
                  {run.decision ? (
                    <span
                      className="rounded bg-muted px-1.5 py-0.5 font-medium"
                      title={`${run.decision.rationale ?? ""} (by ${run.decision.decidedBy}, confidence ${Math.round((run.decision.confidence ?? 0) * 100)}%)`}
                    >
                      {run.decision.path}
                    </span>
                  ) : null}
                  {run.branchName ? (
                    <span className="inline-flex items-center gap-1">
                      <GitBranch className="size-3" /> {run.branchName}
                    </span>
                  ) : null}
                  {run.verification ? (
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck className="size-3" />
                      {run.verification.verified ? (run.verification.passed ? "verified" : "check failed") : "unverified"}
                    </span>
                  ) : null}
                </div>
                {run.status === "failed" || run.status === "blocked" ? (
                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        void api.retryAutoRun(run.id).then(() => load()).catch(() => load());
                      }}
                      title="Retry this run on its existing worktree"
                    >
                      <RefreshCw className="mr-1 size-3" /> Retry
                    </Button>
                  </div>
                ) : null}
                {run.report && (run.status === "report_posted" || run.status === "needs_input") ? (
                  <p className="line-clamp-3 whitespace-pre-wrap rounded bg-muted/50 px-2 py-1 text-xs text-muted-foreground">{run.report}</p>
                ) : null}
                {run.error ? <p className="text-xs text-amber-600 dark:text-amber-400">{run.error}</p> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
