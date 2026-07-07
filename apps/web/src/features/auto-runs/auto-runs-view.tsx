import { useCallback, useEffect, useState } from "react";
import { Bot, RefreshCw, GitPullRequest, GitMerge, GitBranch, ShieldCheck, ExternalLink, CircleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { api } from "@/data/use-console-actions";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/readable-labels";
import { AutoRunConfigCard } from "./auto-run-config-card";
import { AutoRunReadinessCard } from "./auto-run-readiness-card";
import { AutoRunOnboardingCard } from "./auto-run-onboarding-card";
import { useConsoleState } from "@/data/use-console-state";

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
  judgment?: { solved: boolean | null; confidence: number | null; summary?: string | null; gaps?: string[] } | null;
  report?: string | null;
  prState?: string | null;
  prChecks?: { total: number; passed: number; failed: number; pending: number; state: "NONE" | "SUCCESS" | "FAILURE" | "PENDING" } | null;
  pendingApproval?: { id: string; riskLevel: string | null; riskTags: string[]; summary: string | null } | null;
  promptInjection?: { suspicious: boolean; markers: string[] } | null;
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
  slo?: {
    slos: { key: string; label: string; value: number | null; target: number; direction: "gte" | "lte"; unit: "ratio" | "seconds"; meets: boolean | null }[];
    anyBelow: boolean;
  } | null;
}

function fmtSloValue(v: number | null, unit: "ratio" | "seconds"): string {
  if (v == null) return "—";
  return unit === "ratio" ? `${Math.round(v * 100)}%` : fmtDuration(v);
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

function checksChip(pc: AutoRunRecord["prChecks"]): { label: string; tone: Tone } {
  if (!pc || pc.total === 0) return { label: "no checks", tone: "neutral" };
  if (pc.state === "FAILURE") return { label: `checks ✗${pc.failed}`, tone: "danger" };
  if (pc.state === "PENDING") return { label: `checks ${pc.pending} pending`, tone: "warning" };
  return { label: `checks ${pc.passed}✓`, tone: "success" };
}

// Is merging this run risky (unverified / unjudged / checks not green)? Returns
// the reasons + a confirm message so the human merges INFORMED, not blind — the
// gap the live demo exposed (a zero-check unverified PR merged with a blank
// prompt). Merge stays a human decision; this just shows what they're deciding.
function mergeRisk(run: AutoRunRecord): { warn: boolean; confirmMsg: string } {
  const reasons: string[] = [];
  if (!run.verification?.verified) reasons.push("verification not run");
  else if (!run.verification.passed) reasons.push("verification FAILED");
  if (!run.judgment || run.judgment.solved !== true) reasons.push("acceptance judge did not confirm");
  const pc = run.prChecks;
  if (!pc || pc.total === 0) reasons.push("no PR checks");
  else if (pc.state === "FAILURE") reasons.push(`${pc.failed} PR check(s) failing`);
  else if (pc.state === "PENDING") reasons.push(`${pc.pending} PR check(s) still running`);
  if (reasons.length === 0) {
    return { warn: false, confirmMsg: `Merge PR #${run.prNumber}? Verified and checks are green.` };
  }
  return {
    warn: true,
    confirmMsg: `⚠ Merge PR #${run.prNumber} WITHOUT full verification?\n\n- ${reasons.join("\n- ")}\n\nThis is the human merge gate — merge anyway?`,
  };
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
  const { data: consoleState } = useConsoleState();
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

      <AutoRunOnboardingCard projectId={consoleState?.currentProjectId ?? null} />
      <AutoRunReadinessCard projectId={consoleState?.currentProjectId ?? null} />
      <AutoRunConfigCard />

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
          {summary.slo ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                SLOs
                {summary.slo.anyBelow ? <Badge tone="danger">below target</Badge> : <Badge tone="success">on target</Badge>}
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {summary.slo.slos.map((s) => (
                  <div key={s.key} className={cn("rounded-lg border px-3 py-2", s.meets === false ? "border-red-500/40 bg-red-500/5" : "border-border")}>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className={cn("mt-0.5 text-lg font-semibold tabular-nums", s.meets === false && "text-red-600 dark:text-red-400")}>{fmtSloValue(s.value, s.unit)}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {s.meets == null ? "no data" : s.meets ? "meets" : "below"} · target {s.direction === "gte" ? "≥" : "≤"} {fmtSloValue(s.target, s.unit)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
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
                    {run.promptInjection?.suspicious ? (
                      <Badge tone="danger" title={`Possible prompt injection in the issue body: ${run.promptInjection.markers.join(", ")}. Human review required.`}>⚠ injection?</Badge>
                    ) : null}
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
                    {run.prNumber && run.status === "pr_open" && run.prState !== "MERGED" && run.prState !== "CLOSED" ? (
                      (() => {
                        const chip = checksChip(run.prChecks);
                        const risk = mergeRisk(run);
                        return (
                          <>
                            <Badge tone={chip.tone} title="PR CI checks — refresh to update">{chip.label}</Badge>
                            <Button
                              variant={risk.warn ? "secondary" : "primary"}
                              size="sm"
                              className="h-6 px-2 text-xs"
                              title={risk.warn ? "Merge — but this run is not fully verified (see confirm)" : "Merge this PR — verified and checks green"}
                              onClick={() => {
                                // The merge stays human: a person confirms, in-tool, informed by
                                // the run's verification posture, before we merge.
                                if (!window.confirm(risk.confirmMsg)) return;
                                void api.mergeAutoRunPr(run.id).then(() => load()).catch(() => load());
                              }}
                            >
                              <GitMerge className={cn("mr-1 size-3", risk.warn && "text-amber-600 dark:text-amber-400")} /> Merge
                            </Button>
                          </>
                        );
                      })()
                    ) : null}
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
                  {run.judgment ? (
                    <span
                      className="inline-flex items-center gap-1"
                      title={`${run.judgment.summary ?? ""}${(run.judgment.gaps ?? []).map((g) => `\n- ${g}`).join("")}`}
                    >
                      ⚖ {run.judgment.solved === true ? "solves issue" : run.judgment.solved === false ? "does NOT solve issue" : "judge unavailable"}
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
                {run.status === "awaiting_approval" && run.pendingApproval ? (() => {
                  const appr = run.pendingApproval;
                  return (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
                      <span className="text-xs text-muted-foreground">
                        Needs your approval to run the agent
                        {appr.riskLevel ? ` · risk: ${appr.riskLevel}` : ""}
                        {(appr.riskTags ?? []).length ? ` (${appr.riskTags.join(", ")})` : ""}. The {run.decision?.path ?? "develop"} agent will edit code for this issue.
                      </span>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          className="h-6 px-2 text-xs"
                          onClick={() => void api.approveApproval(appr.id).then(() => load()).catch(() => load())}
                          title="Approve — release the agent to run"
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-6 px-2 text-xs"
                          onClick={() => {
                            if (!window.confirm("Deny this run? The agent will be blocked.")) return;
                            void api.denyApproval(appr.id).then(() => load()).catch(() => load());
                          }}
                          title="Deny — block this run"
                        >
                          Deny
                        </Button>
                      </div>
                    </div>
                  );
                })() : null}
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
