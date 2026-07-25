import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, RefreshCw, GitPullRequest, GitMerge, GitBranch, ShieldCheck, ExternalLink, CircleAlert, Check, X, Minus, Loader2, Rocket, ScrollText, FolderGit2, History, LayoutList, Columns3, FileText, FilePen, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/common/empty-state";
import { api, useAsyncAction } from "@/data/use-console-actions";
import { ApiError } from "@/lib/api-client";
import { reconcileFileLedger, displayPath } from "./file-ledger";
import { cn } from "@/lib/cn";
import { shortTime, type Tone } from "@/lib/readable-labels";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { AutoRunReadinessCard } from "./auto-run-readiness-card";
import { AutoRunOnboardingCard } from "./auto-run-onboarding-card";
import { ReportView } from "./report-view";
import { DesignPanel } from "./design-panel";
import { DesignApproval } from "./design-approval";
import { ClarifyAnswer } from "./clarify-answer";
import { DecompositionApproval } from "./decomposition-approval";
import { EpicRollup } from "./epic-rollup";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore } from "@/store/ui-store";
import { EventTimeline } from "@/features/invocations/event-timeline";
import { RunTranscriptSection, isTerminalRunStatus } from "@/features/invocations/run-transcript";
import type { InvocationEventSnapshot, DeploymentSnapshot } from "@/lib/console-state";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { InvocationDispatchHealth } from "@/features/devices/invocation-dispatch-health";

interface AutoRunLink {
  type: "issue" | "pr";
  number: number;
  title: string;
  url: string | null;
}
export interface AutoRunRecord {
  id: string;
  status: string;
  terminalId?: string | null;
  projectId?: string | null;
  link?: AutoRunLink | null;
  intent?: string | null;
  decision?: { path: string; decidedBy: string; confidence: number; rationale?: string | null; via?: string | null; clarifyingQuestions?: string[] | null; evidence?: { policyVersion: string; modelVersion: string | null; minConfidence: number; inputDigest: string } | null } | null;
  routingOverride?: { recommendedPath: string | null; actualPath: string; reason: string; actorId: string; recordedAt: string; revision: number } | null;
  branchName?: string | null;
  worktreeId?: string | null;
  invocationId?: string | null;
  failoverAttempts?: number;
  failoverHistory?: FailoverTransition[] | null;
  failoverOutcome?: FailoverOutcome | null;
  mergeRisk?: { level: "low" | "medium" | "high"; reasons: string[] } | null;
  prNumber?: number | null;
  prUrl?: string | null;
  verification?: { passed: boolean; verified: boolean; summary?: string | null } | null;
  childIssues?: { number: number; url?: string | null; title?: string | null }[] | null;
  judgment?: { solved: boolean | null; confidence: number | null; summary?: string | null; gaps?: string[] } | null;
  report?: string | null;
  designArtifacts?: string[] | null;
  screenshots?: string[] | null;
  designApproval?: { status: "approved" | "rejected"; by?: string | null; at?: string | null; feedback?: string | null } | null;
  clarifyAnswer?: { by?: string | null; at?: string | null; text?: string | null } | null;
  // Epic decomposition (S2/S3): the proposed plan + the human approval outcome.
  decompositionPlan?: { tree?: { issues?: { title: string }[] } | null; failures?: string[]; approvalReasons?: string[]; overlap?: { flagged?: { a: number; b: number; aTitle?: string | null; bTitle?: string | null; score: number }[]; maxOverlap?: number } | null; truncated?: boolean; proposedCount?: number; parseError?: string | null } | null;
  decompositionApproval?: { status: "approving" | "approved" | "rejected"; by?: string | null; at?: string | null; created?: number; feedback?: string | null } | null;
  childRollup?: { total: number; started: number; notStarted: number; done: number; merged: number; prOpen: number; failed: number; inProgress: number; redundant: number; items: { number: number; title?: string | null; status?: string | null; prState?: string | null; issueState?: string | null; done?: boolean; redundant?: boolean }[] } | null;
  prState?: string | null;
  prChecks?: { total: number; passed: number; failed: number; pending: number; state: "NONE" | "SUCCESS" | "FAILURE" | "PENDING" } | null;
  pendingApproval?: { id: string; riskLevel: string | null; riskTags: string[]; summary: string | null } | null;
  promptInjection?: { suspicious: boolean; markers: string[] } | null;
  // D1 deploy stage + H1 self-healing: outcome of the post-merge deploy / rollback.
  deployment?: { status: "deployed" | "failed" | "rolled_back"; at?: string; summary?: string | null; prNumber?: number | null } | null;
  // H2 self-healing: the remediation issue filed after a failed deploy (fix-forward).
  remediationIssue?: { number: number; url?: string | null; culpritPr?: number | null } | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
export interface FailoverTransition {
  attempt: number;
  reason: string;
  fromAgentId?: string | null;
  toAgentId?: string | null;
  fromInvocationId?: string | null;
  toInvocationId?: string | null;
  worktreeId?: string | null;
  at?: string | null;
}
export interface FailoverOutcome extends Partial<FailoverTransition> {
  status: "recovered" | "exhausted" | "alternate_unavailable" | "worktree_unavailable" | "device_unlinked" | "start_failed" | string;
  maxAttempts?: number;
  error?: string | null;
}

const FAILOVER_REASON_LABEL: Record<string, string> = {
  dispatch_timeout: "dispatch timed out",
  orphaned: "run was orphaned",
  stuck: "run stopped responding",
};
const FAILOVER_STATUS_LABEL: Record<string, string> = {
  recovered: "Recovered on another agent",
  exhausted: "Failover limit reached",
  alternate_unavailable: "No healthy alternate agent",
  worktree_unavailable: "Worktree unavailable",
  device_unlinked: "Device is unlinked",
  start_failed: "Alternate agent could not start",
};

export function failoverSummary(outcome?: FailoverOutcome | null): string | null {
  if (!outcome) return null;
  const status = FAILOVER_STATUS_LABEL[outcome.status] ?? outcome.status;
  const reason = outcome.reason ? FAILOVER_REASON_LABEL[outcome.reason] ?? outcome.reason : null;
  return reason ? `${status} after ${reason}` : status;
}
/** D2 deploy metrics served alongside the auto-runs summary. */
interface DeploymentSummary {
  total: number;
  deployed: number;
  failed: number;
  changeFailureRate: number | null;
  recoveryHours: { median: number | null; count: number };
  deployFrequencyPerWeek: number | null;
  lastDeployAt: string | null;
}
interface AutoRunSummary {
  total: number;
  active: number;
  byStatus: Record<string, number>;
  outcomes: { prOpen: number; blocked: number; failed: number; reportPosted: number; needsInput: number };
  successRate: number | null;
  verification: { passed: number; failed: number; unverified: number };
  routing?: { alignmentRate: number | null; conclusive: number } | null;
  routingHealth?: {
    total: number;
    confidenceTotal: number;
    fallback: number;
    fallbackRate: number | null;
    lowConfidence: number;
    lowConfidenceRate: number | null;
    failed?: number;
    failureRate?: number | null;
    humanOverrides?: number;
    humanOverrideRate?: number | null;
    latency: { count: number; medianMs: number | null; p90Ms: number | null };
    confidenceBuckets: { key: string; total: number; conclusive: number; alignmentRate: number | null }[];
    signals: { key: string; severity: "warning" | "danger"; value: number; threshold: number }[];
    thresholds: { minSamples: number; fallbackRate: number; lowConfidenceRate: number; failureRate?: number; humanOverrideRate?: number; latencyP90Ms: number };
    byProject: { projectId: string; total: number; fallbackRate: number | null; alignmentRate: number | null }[];
    daily: { date: string; total: number; fallbackRate: number | null; alignmentRate: number | null }[];
  } | null;
  blockedReasons: { reason: string; count: number }[];
  timeToPr: { count: number; medianSeconds: number | null; p90Seconds: number | null };
  slo?: {
    slos: { key: string; label: string; value: number | null; target: number; direction: "gte" | "lte"; unit: "ratio" | "seconds"; meets: boolean | null }[];
    anyBelow: boolean;
  } | null;
  rates?: { humanEscalation: number | null; selfRepair: number | null } | null;
}

function fmtSloValue(v: number | null, unit: "ratio" | "seconds"): string {
  if (v == null) return "—";
  return unit === "ratio" ? `${Math.round(v * 100)}%` : fmtDuration(v);
}

function RoutingFeedback({ run, onSaved }: { run: AutoRunRecord; onSaved: () => void }) {
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
          {["develop", "design", "prototype", "clarify", "decompose"].map((value) => <option key={value} value={value}>{value}</option>)}
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

function statusTone(status: string): Tone {
  if (status === "pr_open" || status === "report_posted") return "success";
  if (status === "failed") return "danger";
  if (status === "blocked" || status === "awaiting_approval" || status === "needs_input") return "warning";
  if (status === "cancelled") return "neutral";
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
// The linear stepper only describes the DEVELOP route. Off-route runs (design /
// clarify / decompose → report_posted / needs_input / plan_proposed / decomposed)
// and failed/blocked runs have no position in it, so we HIDE it for them instead
// of rendering every node grey (which reads as "stuck at the very start" — the run
// A audit's "all-grey stepper" defect). Their status badge + route panels + error
// carry the state; the true per-stage lifecycle comes from the event timeline (next).
function hasDevelopStepper(status: string): boolean {
  return STAGE_INDEX[status] !== undefined;
}

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

const RISK_TONE: Record<"low" | "medium" | "high", Tone> = { low: "success", medium: "warning", high: "danger" };

function RiskBadge({ level, reasons }: { level: "low" | "medium" | "high"; reasons?: string[] }) {
  const { t } = useAppTranslation();
  return (
    <Badge tone={RISK_TONE[level]} title={reasons && reasons.length ? reasons.join("; ") : t("autoRuns.mergeRisk", { level: t(`labels.risk.${level}`) })}>
      {t("autoRuns.risk")}: {t(`labels.risk.${level}`)}
    </Badge>
  );
}

function checksChip(pc: AutoRunRecord["prChecks"]): { label: string; tone: Tone } {
  if (!pc || pc.total === 0) return { label: "no checks", tone: "neutral" };
  if (pc.state === "FAILURE") return { label: `checks ✗${pc.failed}`, tone: "danger" };
  if (pc.state === "PENDING") return { label: `checks ${pc.pending} pending`, tone: "warning" };
  return { label: `checks ${pc.passed}✓`, tone: "success" };
}

// Is merging this run risky (unverified / unjudged / checks not green)? The merge
// dialog shows the full posture (see postureRows); this drives the button's
// warn styling + the "Merge anyway" wording. Merge stays a human decision.
export function mergeRisk(run: AutoRunRecord): { warn: boolean } {
  if (run.verification && run.verification.verified && !run.verification.passed) return { warn: true };
  if (!run.verification?.verified) return { warn: true };
  if (!run.judgment || run.judgment.solved !== true) return { warn: true };
  if (run.judgment.confidence != null && run.judgment.confidence < 0.6) return { warn: true };
  const pc = run.prChecks;
  if (!pc || pc.total === 0 || pc.state === "FAILURE" || pc.state === "PENDING") return { warn: true };
  return { warn: false };
}

type PostureState = "ok" | "warn" | "bad" | "muted";

// The three signals a human weighs before merging, each as a row for the dialog.
export function postureRows(run: AutoRunRecord): { key: string; label: string; state: PostureState; detail: string }[] {
  const rows: { key: string; label: string; state: PostureState; detail: string }[] = [];
  if (!run.verification?.verified) rows.push({ key: "verify", label: "Verification", state: "muted", detail: "not run" });
  else if (run.verification.passed) rows.push({ key: "verify", label: "Verification", state: "ok", detail: "passed" });
  else rows.push({ key: "verify", label: "Verification", state: "bad", detail: "FAILED" });

  if (!run.judgment) rows.push({ key: "judge", label: "Acceptance judge", state: "muted", detail: "not run" });
  else if (run.judgment.solved === true) {
    const c = run.judgment.confidence;
    // Mirror the server's 0.6 confidence floor — a solved-but-low-confidence
    // verdict is not "green" (else the row contradicts the medium badge). (audit)
    const lowConf = c != null && c < 0.6;
    rows.push({ key: "judge", label: "Acceptance judge", state: lowConf ? "warn" : "ok", detail: `solved${c != null ? ` (${Math.round(c * 100)}%)` : ""}${lowConf ? " — below 60%" : ""}` });
  } else if (run.judgment.solved === false) rows.push({ key: "judge", label: "Acceptance judge", state: "bad", detail: "did not confirm" });
  else rows.push({ key: "judge", label: "Acceptance judge", state: "warn", detail: "errored — no verdict" });

  const pc = run.prChecks;
  if (!pc || pc.total === 0) rows.push({ key: "checks", label: "PR checks", state: "muted", detail: "none" });
  else if (pc.state === "FAILURE") rows.push({ key: "checks", label: "PR checks", state: "bad", detail: `${pc.failed} failing` });
  else if (pc.state === "PENDING") rows.push({ key: "checks", label: "PR checks", state: "warn", detail: `${pc.pending} pending` });
  else rows.push({ key: "checks", label: "PR checks", state: "ok", detail: `${pc.passed} green` });
  return rows;
}

function PostureIcon({ state }: { state: PostureState }) {
  if (state === "ok") return <Check className="size-3.5" />;
  if (state === "bad") return <X className="size-3.5" />;
  if (state === "warn") return <CircleAlert className="size-3.5" />;
  return <Minus className="size-3.5" />;
}

interface WorktreeDiff {
  files: { path: string; untracked?: boolean }[];
  base: string;
  diff: string;
  truncated: boolean;
}

// A diff can be up to the server's ~1MB cap (tens of thousands of lines). Render
// at most DIFF_MAX_LINES DOM nodes — without a cap a big diff mounts 20k+ divs
// synchronously and freezes the tab the moment a human clicks "Show changes".
const DIFF_MAX_LINES = 800;

// Unified diff with minimal +/- colouring, scrollable so a big diff never blows
// out the dialog. Gives the human the actual change to review without leaving
// for GitHub.
function DiffLines({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  const shown = lines.slice(0, DIFF_MAX_LINES);
  const hidden = lines.length - shown.length;
  return (
    <div className="flex flex-col gap-1">
      <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/30 p-2 text-[11px] leading-relaxed">
        {shown.map((ln, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre",
              ln.startsWith("+") && !ln.startsWith("+++") && "text-emerald-600 dark:text-emerald-400",
              ln.startsWith("-") && !ln.startsWith("---") && "text-red-600 dark:text-red-400",
              (ln.startsWith("@@") || ln.startsWith("diff ") || ln.startsWith("index ")) && "text-muted-foreground",
            )}
          >
            {ln || " "}
          </div>
        ))}
      </pre>
      {hidden > 0 ? (
        <span className="text-xs text-muted-foreground">
          {hidden.toLocaleString()} more line{hidden === 1 ? "" : "s"} not shown — open the PR to see the full diff.
        </span>
      ) : null}
    </div>
  );
}

// Durable, status-independent diff peek for a run's worktree. MergeControl has an
// identical peek, but it unmounts the instant the PR merges — yet the auto-run
// worktree is preserved and GET /api/worktrees/:id/diff still serves it, so this
// keeps "what did this run change?" answerable AFTER merge too (browsability G1).
function WorktreeDiffPeek({ worktreeId }: { worktreeId: string }) {
  const { t } = useAppTranslation();
  const [show, setShow] = useState(false);
  const [diff, setDiff] = useState<WorktreeDiff | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error" | "done">("idle");
  async function toggle() {
    if (show) {
      setShow(false);
      return;
    }
    setShow(true);
    if (diff || state === "loading") return;
    setState("loading");
    try {
      setDiff((await api.worktreeDiff(worktreeId)) as WorktreeDiff);
      setState("done");
    } catch {
      setState("error");
    }
  }
  return (
    <div className="flex w-full flex-col gap-1.5">
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
      >
        <GitBranch className="size-3" /> {t(show ? "autoRunDetail.hideChanges" : "autoRunDetail.showChanges")}
        {diff ? ` (${diff.files.length} file${diff.files.length === 1 ? "" : "s"}${diff.truncated ? ", truncated" : ""})` : ""}
      </button>
      {show ? (
        state === "loading" ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> {t("autoRunDetail.loadingDiff")}</span>
        ) : state === "error" ? (
          <span className="text-xs text-red-600 dark:text-red-400">{t("autoRunDetail.diffUnavailable")}</span>
        ) : diff && diff.diff ? (
          <DiffLines diff={diff.diff} />
        ) : (
          <span className="text-xs text-muted-foreground">{t("autoRunDetail.noChanges")}</span>
        )
      ) : null}
    </div>
  );
}

// Which files the agent READ vs WROTE this run. Writes already show in the git diff,
// but a file the agent only *read* leaves no other trace — captured from its tool_use
// stream (server accumulates invocation.fileLedger). On expand we fetch the diff once
// to cross-check writes: a write not in the diff was a no-op edit; a changed file with
// no tracked write came from outside the explicit file tools (e.g. a Bash command).
function RunFilesPeek({ invocationId, worktreeId }: { invocationId: string; worktreeId?: string | null }) {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const [show, setShow] = useState(false);
  const [changed, setChanged] = useState<string[] | null>(null);
  const invocation = (state?.invocations ?? []).find((i) => i.id === invocationId) ?? null;
  const ledger = invocation?.fileLedger ?? null;
  const total = (ledger?.reads?.length ?? 0) + (ledger?.writes?.length ?? 0);
  async function toggle() {
    if (show) {
      setShow(false);
      return;
    }
    setShow(true);
    if (changed != null || !worktreeId) return;
    try {
      const diff = (await api.worktreeDiff(worktreeId)) as { files?: { path: string }[] };
      setChanged((diff.files ?? []).map((f) => f.path));
    } catch {
      setChanged([]); // best-effort: no cross-check, still show the lists
    }
  }
  if (!ledger || total === 0) return null; // nothing captured (e.g. a non-Claude agent) → hide
  const view = reconcileFileLedger(ledger, changed);
  return (
    <div className="flex w-full flex-col gap-1.5">
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
      >
        <FileText className="size-3" /> {t(show ? "autoRunDetail.hideFiles" : "autoRunDetail.files")} ({t("autoRunDetail.fileCounts", { written: view.writeCount, read: view.readCount })}
        {view.truncated ? "+" : ""})
      </button>
      {show ? (
        <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/30 p-2">
          {view.writeCount > 0 ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("autoRunDetail.wrote")}</span>
              <ul className="flex flex-col gap-0.5">
                {view.writes.map((w) => (
                  <li key={w.path} className="flex items-center gap-1.5 font-mono text-xs" title={w.path}>
                    <FilePen className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span className="truncate">{displayPath(w.path)}</span>
                    {w.inDiff === false ? <span className="shrink-0 text-[10px] text-muted-foreground">({t("autoRunDetail.noChange")})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {view.readCount > 0 ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("autoRunDetail.read")}</span>
              <ul className="flex flex-col gap-0.5">
                {view.reads.map((p) => (
                  <li key={p} className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground" title={p}>
                    <Eye className="size-3 shrink-0" />
                    <span className="truncate">{displayPath(p)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {view.diffOnly.length > 0 ? (
            <span className="text-[11px] text-muted-foreground">
              {t("autoRunDetail.outsideTools", { count: view.diffOnly.length })}
            </span>
          ) : null}
          {view.truncated ? <span className="text-[11px] text-muted-foreground">{t("autoRunDetail.listTruncated")}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// Inward traceability from a run: jump to its agent transcript (invocationId) and
// its worktree in the workspace (files + full diff). The IDs are already on the
// record + wire; the console previously only linked OUTWARD to GitHub.
function RunTraceLinks({ run }: { run: AutoRunRecord }) {
  const { t } = useAppTranslation();
  const setSection = useUiStore((s) => s.setSection);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSelectedWorktreeId = useUiStore((s) => s.setSelectedWorktreeId);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  if (!run.invocationId && !run.worktreeId) return null;
  return (
    <>
      {run.invocationId ? (
        <button
          type="button"
          onClick={() => {
            setSelectedInvocationId(run.invocationId ?? null);
            setSection("invocations");
          }}
          className="inline-flex items-center gap-1 hover:text-foreground"
          title={t("autoRunDetail.transcriptHint")}
        >
          <ScrollText className="size-3" /> {t("autoRunDetail.transcript")}
        </button>
      ) : null}
      {run.worktreeId ? (
        <button
          type="button"
          onClick={() => {
            if (run.projectId) setSelectedProjectId(run.projectId);
            setSelectedWorktreeId(run.worktreeId ?? null);
            setSection("projects");
          }}
          className="inline-flex items-center gap-1 hover:text-foreground"
          title={t("autoRunDetail.workspaceHint")}
        >
          <FolderGit2 className="size-3" /> {t("autoRunDetail.workspace")}
        </button>
      ) : null}
    </>
  );
}

function FailoverTrace({ run }: { run: AutoRunRecord }) {
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
function RunTimeline({ runId, invocationId, terminal, events }: { runId: string; invocationId?: string | null; terminal?: boolean; events: InvocationEventSnapshot[] }) {
  const [open, setOpen] = useState(false);
  const runEvents = useMemo(
    () =>
      events
        .filter((e) => e.data?.autoRunId === runId)
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)),
    [events, runId],
  );
  if (runEvents.length === 0) return null;
  return (
    <div className="flex w-full flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
      >
        <History className="size-3" /> {open ? "Hide timeline" : `Timeline (${runEvents.length})`}
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

// Stage BOARD (执行看板): group in-flight runs into pipeline lanes so a supervisor
// sees the loop's shape at a glance, not a flat scroll. Lane order puts the two
// human-relevant lanes (Attention, Needs you) first.
type LaneKey = "attention" | "needs_you" | "running" | "pr_open" | "done";
const LANES: { key: LaneKey; label: string }[] = [
  { key: "attention", label: "Attention" },
  { key: "needs_you", label: "Needs you" },
  { key: "running", label: "Running" },
  { key: "pr_open", label: "PR open" },
  { key: "done", label: "Done" },
];
export function runLane(run: AutoRunRecord): LaneKey {
  if (run.status === "failed" || run.status === "blocked" || run.deployment?.status === "failed" || run.deployment?.status === "rolled_back") return "attention";
  if (run.status === "awaiting_approval" || run.status === "needs_input" || run.status === "report_posted" || run.status === "plan_proposed") return "needs_you";
  if (run.status === "cancelled" || run.deployment?.status === "deployed" || run.prState === "MERGED" || run.prState === "CLOSED" || run.status === "decomposed") return "done";
  if (run.status === "pr_open") return "pr_open";
  return "running"; // materializing / running / verifying / publishing + any other in-flight
}

export function localQueueSnapshot(runs: AutoRunRecord[]) {
  const running = runs.filter((run) => ["running", "verifying", "publishing"].includes(run.status));
  const next = runs.find((run) => run.status === "materializing") ?? null;
  const waiting = runs.filter((run) =>
    ["awaiting_approval", "needs_input", "blocked", "failed"].includes(run.status));
  return { running, next, waiting, attentionCount: waiting.length };
}
function RunChip({ run }: { run: AutoRunRecord }) {
  const { t } = useAppTranslation();
  const label = run.link ? `#${run.link.number} ${run.link.title}` : run.id;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-2 text-xs">
      <div className="flex items-center gap-1.5">
        <Badge tone={statusTone(run.status)}>{t(`autoRuns.status.${run.status}` as never, { defaultValue: run.status })}</Badge>
        {(run.failoverAttempts ?? 0) > 0 ? <Badge tone="warning">failover {run.failoverAttempts}</Badge> : null}
        {run.prUrl ? (
          <a href={run.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
            <GitPullRequest className="size-3" />#{run.prNumber}
          </a>
        ) : null}
        {run.deployment ? (
          <span className={run.deployment.status === "deployed" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"} title={run.deployment.summary ?? undefined}>
            <Rocket className="inline size-3" />
          </span>
        ) : null}
      </div>
      <span className="truncate font-medium text-foreground" title={label}>{label}</span>
      {run.decision ? <span className="text-muted-foreground">{run.decision.path}</span> : null}
    </div>
  );
}
function RunBoard({ runs }: { runs: AutoRunRecord[] }) {
  const byLane = useMemo(() => {
    const m: Record<LaneKey, AutoRunRecord[]> = { attention: [], needs_you: [], running: [], pr_open: [], done: [] };
    for (const run of runs) m[runLane(run)].push(run);
    return m;
  }, [runs]);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {LANES.map((lane) => (
        <div key={lane.key} className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-2">
          <div className="flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            <span>{lane.label}</span>
            <span className="rounded bg-muted px-1.5 tabular-nums">{byLane[lane.key].length}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {byLane[lane.key].map((run) => <RunChip key={run.id} run={run} />)}
            {byLane[lane.key].length === 0 ? <span className="px-1 py-2 text-[11px] text-muted-foreground/40">—</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// Deploy LOG (可追溯性): render the raw deployment records — which reach the client
// in the state snapshot but were previously shown NOWHERE (only the aggregate DORA
// tiles were) — each as a deploy → PR → issue breadcrumb by joining autoRunId to the
// run. Closes the audit's worst traceability break ("from a deploy you reach nothing").
function DeployList({ deployments, runs }: { deployments: DeploymentSnapshot[]; runs: AutoRunRecord[] }) {
  const [open, setOpen] = useState(false);
  const runsById = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs]);
  const sorted = useMemo(
    () => deployments.slice().sort((a, b) => ((a.at ?? "") < (b.at ?? "") ? 1 : (a.at ?? "") > (b.at ?? "") ? -1 : 0)),
    [deployments],
  );
  if (sorted.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
      >
        <History className="size-3" /> {open ? "Hide deploy log" : `Deploy log (${sorted.length})`}
      </button>
      {open ? (
        <ul className="flex flex-col gap-1">
          {sorted.map((d) => {
            const run = d.autoRunId ? runsById.get(d.autoRunId) : undefined;
            const tone = d.status === "deployed" ? "success" : d.status === "rolled_back" ? "warning" : "danger";
            const label = d.status === "deployed" ? "deployed" : d.status === "rolled_back" ? "rolled back" : "deploy failed";
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-border px-2.5 py-1.5 text-xs">
                <Badge tone={tone}>{label}</Badge>
                {d.at ? <span className="tabular-nums text-muted-foreground">{shortTime(d.at)}</span> : null}
                {d.prNumber ? (
                  run?.prUrl ? (
                    <a href={run.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                      <GitPullRequest className="size-3" />#{d.prNumber}
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-muted-foreground"><GitPullRequest className="size-3" />#{d.prNumber}</span>
                  )
                ) : null}
                {run?.link ? (
                  run.link.url ? (
                    <a href={run.link.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">→ issue #{run.link.number}</a>
                  ) : (
                    <span className="text-muted-foreground">→ issue #{run.link.number}</span>
                  )
                ) : null}
                {d.summary ? (
                  <span className="w-full truncate text-muted-foreground [overflow-wrap:anywhere]" title={d.summary}>{d.summary}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// The merge moment — the one human decision in the autonomous loop. Replaces the
// blank window.confirm with an informed dialog: refreshes PR checks on open (so
// the shown posture matches the server's require-green gate), lets the human peek
// the diff, disables while the merge runs, and surfaces the REAL failure reason
// instead of swallowing it. Merge stays a human click.
function MergeControl({ run, onDone }: { run: AutoRunRecord; onDone: (refresh?: boolean) => Promise<void> | void }) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState<WorktreeDiff | null>(null);
  const [diffState, setDiffState] = useState<"idle" | "loading" | "error" | "done">("idle");
  const { execute, pending, error, reset } = useAsyncAction();
  const chip = checksChip(run.prChecks);
  // The server computes the authoritative risk level; fall back to the local
  // heuristic only if the field is absent (older payloads).
  const level = run.mergeRisk?.level ?? (mergeRisk(run).warn ? "medium" : "low");
  const risk = { warn: level !== "low" };

  const openDialog = async () => {
    // Fresh dialog each open: drop a stale merge error + a stale/expanded diff so
    // a reopen never shows last time's failure banner or an out-of-date diff.
    reset();
    setShowDiff(false);
    setDiff(null);
    setDiffState("idle");
    setOpen(true);
    setRefreshing(true);
    try {
      await onDone(true); // pull fresh checks so the posture matches the server gate
    } finally {
      setRefreshing(false);
    }
  };
  const toggleDiff = async () => {
    const next = !showDiff;
    setShowDiff(next);
    // Fetch on first expand, and allow a retry after a failed fetch.
    if (next && (diffState === "idle" || diffState === "error") && run.worktreeId) {
      setDiffState("loading");
      try {
        setDiff((await api.worktreeDiff(run.worktreeId)) as WorktreeDiff);
        setDiffState("done");
      } catch {
        setDiffState("error");
      }
    }
  };
  const doMerge = async () => {
    const ok = await execute(() => api.mergeAutoRunPr(run.id));
    if (ok) {
      setOpen(false);
      void onDone();
    }
  };

  const primaryVariant = risk.warn ? "secondary" : "primary";
  const colorFor = (s: PostureState) =>
    cn(
      "flex items-center gap-1 text-xs font-medium",
      s === "ok" && "text-emerald-600 dark:text-emerald-400",
      s === "bad" && "text-red-600 dark:text-red-400",
      s === "warn" && "text-amber-600 dark:text-amber-400",
      s === "muted" && "text-muted-foreground",
    );

  return (
    <>
      {run.mergeRisk ? <RiskBadge level={run.mergeRisk.level} reasons={run.mergeRisk.reasons} /> : null}
      <Badge tone={chip.tone} title={t("autoRunDetail.checksHint")}>{chip.label}</Badge>
      <Button
        variant={primaryVariant}
        size="sm"
        className="h-6 px-2 text-xs"
        title={t(risk.warn ? "autoRunDetail.mergeReviewHint" : "autoRunDetail.mergeGreenHint")}
        onClick={() => void openDialog()}
      >
        <GitMerge className={cn("mr-1 size-3", risk.warn && "text-amber-600 dark:text-amber-400")} /> {t("autoRunDetail.merge")}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("autoRunDetail.mergePr", { number: run.prNumber ?? "—" })}
        description={t("autoRunDetail.mergeDescription")}
        closeDisabled={pending}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="truncate">{run.link ? `#${run.link.number} ${run.link.title}` : ""}</span>
            {refreshing ? (
              <span className="flex shrink-0 items-center gap-1"><Loader2 className="size-3 animate-spin" /> {t("autoRunDetail.refreshingChecks")}</span>
            ) : null}
          </div>
          {run.mergeRisk ? (
            <div className="flex items-center gap-2 text-xs">
              <RiskBadge level={run.mergeRisk.level} reasons={run.mergeRisk.reasons} />
              {run.mergeRisk.reasons.length ? <span className="truncate text-muted-foreground">{run.mergeRisk.reasons.join("; ")}</span> : null}
            </div>
          ) : null}
          <ul className="flex flex-col gap-1.5">
            {postureRows(run).map((r) => (
              <li key={r.key} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-sm">
                <span>{r.label}</span>
                <span className={colorFor(r.state)}><PostureIcon state={r.state} /> {r.detail}</span>
              </li>
            ))}
          </ul>
          {run.worktreeId ? (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => void toggleDiff()}
                className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
              >
                <GitBranch className="size-3" /> {t(showDiff ? "autoRunDetail.hideChanges" : "autoRunDetail.showChanges")}
                {diff ? ` (${diff.files.length} file${diff.files.length === 1 ? "" : "s"}${diff.truncated ? ", truncated" : ""})` : ""}
              </button>
              {showDiff ? (
                diffState === "loading" ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> {t("autoRunDetail.loadingDiff")}</span>
                ) : diffState === "error" ? (
                  <span className="text-xs text-red-600 dark:text-red-400">{t("autoRunDetail.diffRetry")}</span>
                ) : diff && diff.diff ? (
                  <DiffLines diff={diff.diff} />
                ) : (
                  <span className="text-xs text-muted-foreground">{t("autoRunDetail.noChanges")}</span>
                )
              ) : null}
            </div>
          ) : null}
          {risk.warn ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {t("autoRunDetail.notVerified")}
            </p>
          ) : (
            <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
              {t("autoRunDetail.verifiedGreen")}
            </p>
          )}
          {error ? (
            <p className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {t("autoRunDetail.mergeFailed")}: {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>{t("autoRunDetail.cancel")}</Button>
            <Button variant={primaryVariant} size="sm" onClick={() => void doMerge()} disabled={pending || refreshing}>
              {pending ? (
                <><Loader2 className="mr-1 size-3.5 animate-spin" /> {t("autoRunDetail.merging")}</>
              ) : (
                <><GitMerge className="mr-1 size-3.5" /> {t(risk.warn ? "autoRunDetail.mergeAnyway" : "autoRunDetail.mergeSquash")}</>
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function Stepper({ status }: { status: string }) {
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

export function AutoRunsView() {
  const { t } = useAppTranslation();
  const { data: consoleState } = useConsoleState();
  const [runs, setRuns] = useState<AutoRunRecord[]>([]);
  const [summary, setSummary] = useState<AutoRunSummary | null>(null);
  const [deployments, setDeployments] = useState<DeploymentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const [focusedRunId, setFocusedRunId] = useState<string | null>(null);

  const load = useCallback(async (refresh = false, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      // Manual refresh also refreshes PR dispositions (bounded gh reads); the
      // 10s poll never does, so it stays cheap.
      const data = (await api.listAutoRuns(refresh)) as { autoRuns?: AutoRunRecord[]; summary?: AutoRunSummary; deployments?: DeploymentSummary };
      setRuns(data.autoRuns ?? []);
      setSummary(data.summary ?? null);
      setDeployments(data.deployments ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  // Poll so the loop is observable in near-real-time without wasting requests
  // in a background tab; returning to it triggers an immediate catch-up.
  useVisibleInterval(() => {
    void load(false, true);
  }, 10_000);
  useEffect(() => {
    const refresh = () => void load(false, true);
    window.addEventListener("myagenttool:state-change", refresh);
    return () => window.removeEventListener("myagenttool:state-change", refresh);
  }, [load]);

  useEffect(() => {
    if (!runs.length) return;
    const autoRunId = new URLSearchParams(window.location.search).get("autoRun");
    if (!autoRunId) return;
    setFocusedRunId(autoRunId);
    requestAnimationFrame(() => {
      document.getElementById(`auto-run-${autoRunId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const url = new URL(window.location.href);
    url.searchParams.delete("autoRun");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    const timer = window.setTimeout(() => setFocusedRunId(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [runs]);

  const rate = summary?.successRate;
  const queue = useMemo(() => localQueueSnapshot(runs), [runs]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Bot className="size-5" /> {t("autoRuns.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("autoRuns.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5" role="group" aria-label={t("autoRuns.view")}>
            <button
              type="button"
              aria-pressed={viewMode === "list"}
              onClick={() => setViewMode("list")}
              title={t("autoRuns.listHint")}
              className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs", viewMode === "list" ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <LayoutList className="size-3.5" /> {t("autoRuns.list")}
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "board"}
              onClick={() => setViewMode("board")}
              title={t("autoRuns.boardHint")}
              className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs", viewMode === "board" ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <Columns3 className="size-3.5" /> {t("autoRuns.board")}
            </button>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void load(true)} disabled={loading}>
            <RefreshCw className={cn("mr-1 size-3.5", loading && "animate-spin")} /> {t("autoRuns.refresh")}
          </Button>
        </div>
      </div>

      <section aria-label={t("devicesPage.dispatchQueue")} className="grid gap-3 sm:grid-cols-3">
        <StatTile label={t("autoRuns.status.running")} value={String(queue.running.length)} hint={queue.running[0]?.link?.title ?? t("workBoard.none")} />
        <StatTile label={t("workBoard.next")} value={queue.next ? "1" : "—"} hint={queue.next?.link?.title ?? t("devicesPage.queueClear")} />
        <StatTile
          label={t("devicesPage.whyWaiting")}
          value={String(queue.attentionCount)}
          hint={queue.waiting[0]
            ? t(`runLabels.resultSummary.${queue.waiting[0].status === "awaiting_approval" ? "waiting_for_local_approval" : queue.waiting[0].status === "failed" ? "failed" : "default"}` as never)
            : t("workBoard.none")}
        />
      </section>
      <InvocationDispatchHealth />

      <AutoRunOnboardingCard projectId={consoleState?.currentProjectId ?? null} />
      <AutoRunReadinessCard projectId={consoleState?.currentProjectId ?? null} />
      {summary ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label={t("autoRuns.totalRuns")} value={String(summary.total)} hint={t("autoRuns.inFlight", { count: summary.active })} />
            <StatTile
              label={t("autoRuns.prSuccess")}
              value={rate == null ? "—" : `${Math.round(rate * 100)}%`}
              hint={t("autoRuns.outcomeSummary", { pr: summary.outcomes.prOpen, blocked: summary.outcomes.blocked, failed: summary.outcomes.failed })}
            />
            <StatTile
              label={t("autoRuns.verification")}
              value={`${summary.verification.passed}✓`}
              hint={t("autoRuns.verificationSummary", { failed: summary.verification.failed, unverified: summary.verification.unverified })}
            />
            <StatTile
              label={t("autoRuns.timeToPr")}
              value={fmtDuration(summary.timeToPr.medianSeconds)}
              hint={`p90 ${fmtDuration(summary.timeToPr.p90Seconds)} · n=${summary.timeToPr.count}`}
            />
            <StatTile
              label={t("autoRuns.routing")}
              value={summary.routing?.alignmentRate == null ? "—" : `${Math.round(summary.routing.alignmentRate * 100)}%`}
              hint={t("autoRuns.conclusive", { count: summary.routing?.conclusive ?? 0 })}
            />
            <StatTile
              label={t("autoRuns.humanEscalation")}
              value={summary.rates?.humanEscalation == null ? "—" : `${Math.round(summary.rates.humanEscalation * 100)}%`}
              hint={t("autoRuns.humanEscalationHint")}
            />
            <StatTile
              label={t("autoRuns.selfRepair")}
              value={summary.rates?.selfRepair == null ? "—" : `${Math.round(summary.rates.selfRepair * 100)}%`}
              hint={t("autoRuns.selfRepairHint")}
            />
          </div>
          {summary.routingHealth && summary.routingHealth.total > 0 ? (
            <section className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium">{t("autoRunRoutingHealth.title")}</h3>
                {summary.routingHealth.signals.length ? (
                  <Badge tone="danger">{t("autoRunRoutingHealth.signalCount", { count: summary.routingHealth.signals.length })}</Badge>
                ) : (
                  <Badge tone="success">{t("autoRunRoutingHealth.healthy")}</Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {t("autoRunRoutingHealth.sample", { count: summary.routingHealth.total })}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <StatTile
                  label={t("autoRunRoutingHealth.fallback")}
                  value={summary.routingHealth.fallbackRate == null ? "—" : `${Math.round(summary.routingHealth.fallbackRate * 100)}%`}
                  hint={`${summary.routingHealth.fallback}/${summary.routingHealth.total}`}
                />
                <StatTile
                  label={t("autoRunRoutingHealth.lowConfidence")}
                  value={summary.routingHealth.lowConfidenceRate == null ? "—" : `${Math.round(summary.routingHealth.lowConfidenceRate * 100)}%`}
                  hint={`${summary.routingHealth.lowConfidence}/${summary.routingHealth.confidenceTotal} agent`}
                />
                <StatTile
                  label={t("autoRunRoutingHealth.medianLatency")}
                  value={summary.routingHealth.latency.medianMs == null ? "—" : `${summary.routingHealth.latency.medianMs} ms`}
                  hint={`n=${summary.routingHealth.latency.count}`}
                />
                <StatTile
                  label={t("autoRunRoutingHealth.p90Latency")}
                  value={summary.routingHealth.latency.p90Ms == null ? "—" : `${summary.routingHealth.latency.p90Ms} ms`}
                  hint={t("autoRunRoutingHealth.threshold", { value: summary.routingHealth.thresholds.latencyP90Ms })}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {summary.routingHealth.confidenceBuckets.map((bucket) => (
                  <div key={bucket.key} className="rounded-md bg-muted p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <strong>{t(`autoRunRoutingHealth.bucket.${bucket.key}` as never)}</strong>
                      <span>{bucket.alignmentRate == null ? "—" : `${Math.round(bucket.alignmentRate * 100)}%`}</span>
                    </div>
                    <p className="text-muted-foreground">
                      {t("autoRunRoutingHealth.conclusive", { conclusive: bucket.conclusive, total: bucket.total })}
                    </p>
                  </div>
                ))}
              </div>
              {summary.routingHealth.signals.map((signal) => (
                <div key={signal.key} className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs">
                  <strong>{t(`autoRunRoutingHealth.signal.${signal.key}` as never)}</strong>
                  <span className="ml-2 text-muted-foreground">
                    {signal.key === "latency"
                      ? `${Math.round(signal.value)} ms > ${signal.threshold} ms`
                      : `${Math.round(signal.value * 100)}% ≥ ${Math.round(signal.threshold * 100)}%`}
                  </span>
                </div>
              ))}
              {summary.routingHealth.daily.length > 1 ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">{t("routingTrend.title")}</p>
                  <div className="flex gap-1 overflow-x-auto pb-1">
                    {summary.routingHealth.daily.map((day) => (
                      <div key={day.date} className="min-w-28 rounded bg-muted p-2 text-[10px]">
                        <strong>{day.date.slice(5)}</strong>
                        <p>{day.total} · {t("routingTrend.align")} {day.alignmentRate == null ? "—" : `${Math.round(day.alignmentRate * 100)}%`}</p>
                        <p>{t("routingTrend.fallback")} {day.fallbackRate == null ? "—" : `${Math.round(day.fallbackRate * 100)}%`}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {summary.routingHealth.byProject.length > 1 ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">{t("routingTrend.projects")}</p>
                  <div className="flex flex-wrap gap-1">
                    {summary.routingHealth.byProject.map((project) => (
                      <Badge key={project.projectId} tone="neutral">
                        {consoleState?.projects?.find((candidate) => candidate.id === project.projectId)?.name ?? project.projectId}
                        {" · "}{project.total} · {project.alignmentRate == null ? "—" : `${Math.round(project.alignmentRate * 100)}%`}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
          {deployments && deployments.total > 0 ? (
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Rocket className="size-4" /> {t("autoRuns.deploys")}
                <span className="text-xs font-normal text-muted-foreground">
                  {t("autoRuns.deploySummary", { deployed: deployments.deployed, failed: deployments.failed })}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <StatTile
                  label={t("autoRuns.deployFrequency")}
                  value={deployments.deployFrequencyPerWeek == null ? "—" : `${deployments.deployFrequencyPerWeek}/wk`}
                  hint={t("autoRuns.deployTotal", { count: deployments.total })}
                />
                <StatTile
                  label={t("autoRuns.changeFailure")}
                  value={deployments.changeFailureRate == null ? "—" : `${Math.round(deployments.changeFailureRate * 100)}%`}
                  hint={t("autoRuns.changeFailureHint")}
                />
                <StatTile
                  label={t("autoRuns.recoveryMedian")}
                  value={deployments.recoveryHours.median == null ? "—" : `${deployments.recoveryHours.median}h`}
                  hint={`over ${deployments.recoveryHours.count} recovery(ies)`}
                />
              </div>
              <DeployList deployments={consoleState?.deployments ?? []} runs={runs} />
            </div>
          ) : null}
          {summary.outcomes.reportPosted + summary.outcomes.needsInput > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("autoRuns.nonDiff", { reports: summary.outcomes.reportPosted, input: summary.outcomes.needsInput })}
            </p>
          ) : null}
          {summary.slo ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                {t("autoRuns.slos")}
                {summary.slo.anyBelow ? <Badge tone="danger">{t("autoRuns.belowTarget")}</Badge> : <Badge tone="success">{t("autoRuns.onTarget")}</Badge>}
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {summary.slo.slos.map((s) => (
                  <div key={s.key} className={cn("rounded-lg border px-3 py-2", s.meets === false ? "border-red-500/40 bg-red-500/5" : "border-border")}>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className={cn("mt-0.5 text-lg font-semibold tabular-nums", s.meets === false && "text-red-600 dark:text-red-400")}>{fmtSloValue(s.value, s.unit)}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {t(s.meets == null ? "autoRuns.noData" : s.meets ? "autoRuns.meets" : "autoRuns.below")} · {t("autoRuns.target")} {s.direction === "gte" ? "≥" : "≤"} {fmtSloValue(s.target, s.unit)}
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
                  <CircleAlert className="size-4" /> {t("autoRuns.blockedReasons")}
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
          title={t("autoRuns.empty")}
          hint={t("autoRuns.emptyHint")}
        />
      ) : viewMode === "board" ? (
        <RunBoard runs={runs} />
      ) : (
        <div className="flex flex-col gap-2">
          {runs.map((run) => (
            <Card key={run.id} id={`auto-run-${run.id}`}
              className={cn("scroll-mt-16 transition-shadow", focusedRunId === run.id && "ring-2 ring-primary shadow-lg")}>
              <CardContent className="flex flex-col gap-2 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge tone={statusTone(run.status)}>{t(`autoRuns.status.${run.status}` as never, { defaultValue: run.status })}</Badge>
                    {run.promptInjection?.suspicious ? (
                      <Badge tone="danger" title={t("autoRuns.injectionHint", { markers: run.promptInjection.markers.join(", ") })}>{t("autoRuns.injection")}</Badge>
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
                    {run.prState === "MERGED" ? <Badge tone="success">{t("autoRuns.merged")}</Badge> : null}
                    {run.deployment ? (
                      <Badge
                        tone={run.deployment.status === "deployed" ? "success" : run.deployment.status === "rolled_back" ? "warning" : "danger"}
                        title={[run.deployment.summary, run.deployment.at].filter(Boolean).join(" · ") || undefined}
                      >
                        {t(`autoRuns.deployment.${run.deployment.status}` as never)}
                      </Badge>
                    ) : null}
                    {run.remediationIssue ? (
                      run.remediationIssue.url ? (
                        <a
                          href={run.remediationIssue.url}
                          target="_blank"
                          rel="noreferrer"
                          title={run.remediationIssue.culpritPr ? `Fix-forward remediation for the failed deploy of PR #${run.remediationIssue.culpritPr}` : "Remediation issue for the failed deploy"}
                        >
                          <Badge tone="warning">
                            <Rocket className="mr-1 size-3" />
                            remediating #{run.remediationIssue.number}
                          </Badge>
                        </a>
                      ) : (
                        <Badge tone="warning" title={run.remediationIssue.culpritPr ? `Fix-forward for PR #${run.remediationIssue.culpritPr}` : undefined}>
                          <Rocket className="mr-1 size-3" />
                          remediating #{run.remediationIssue.number}
                        </Badge>
                      )
                    ) : null}
                    {run.prState === "CLOSED" ? <Badge tone="warning">{t("autoRuns.closed")}</Badge> : null}
                    {run.prNumber && run.status === "pr_open" && run.prState !== "MERGED" && run.prState !== "CLOSED" ? (
                      <MergeControl run={run} onDone={load} />
                    ) : null}
                    {(run.childIssues ?? []).map((child) =>
                      child.url ? (
                        <a key={child.number} href={child.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline" title={t("autoRunLinks.pendingDecisionIssue")}>
                          → #{child.number}
                        </a>
                      ) : (
                        <span key={child.number} className="text-xs text-muted-foreground">→ #{child.number}</span>
                      ),
                    )}
                    {run.link?.url ? (
                      <a href={run.link.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title={t("autoRunLinks.openGithub")}>
                        <ExternalLink className="size-4" />
                      </a>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {hasDevelopStepper(run.status) ? <Stepper status={run.status} /> : null}
                  {run.decision ? (
                    <span
                      className="rounded bg-muted px-1.5 py-0.5 font-medium"
                      title={`${run.decision.rationale ?? ""} (${run.decision.via ? `${run.decision.via}, ` : ""}by ${run.decision.decidedBy}, confidence ${Math.round((run.decision.confidence ?? 0) * 100)}%)`}
                    >
                      {run.decision.path}
                      {run.decision.via ? <span className="ml-1 font-normal text-muted-foreground">· {run.decision.via}</span> : null}
                    </span>
                  ) : null}
                  {run.decision ? <RoutingFeedback run={run} onSaved={() => void load()} /> : null}
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
                  <RunTraceLinks run={run} />
                </div>
                <FailoverTrace run={run} />
                {run.worktreeId ? <WorktreeDiffPeek worktreeId={run.worktreeId} /> : null}
                {run.invocationId ? <RunFilesPeek invocationId={run.invocationId} worktreeId={run.worktreeId} /> : null}
                <RunTimeline
                  runId={run.id}
                  invocationId={run.invocationId}
                  terminal={(() => {
                    const inv = (consoleState?.invocations ?? []).find((i) => i.id === run.invocationId);
                    // Unknown invocation (evicted old run) is treated as finished.
                    return inv ? isTerminalRunStatus(inv.status) : true;
                  })()}
                  events={consoleState?.events ?? []}
                />
                {run.status === "failed" || run.status === "blocked" ? (
                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        void api.retryAutoRun(run.id).then(() => load()).catch(() => load());
                      }}
                      title={t("autoRuns.retryHint")}
                    >
                      <RefreshCw className="mr-1 size-3" /> {t("autoRuns.retry")}
                    </Button>
                  </div>
                ) : null}
                {["materializing", "running", "verifying", "publishing"].includes(run.status) ? (
                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        if (!window.confirm("Cancel this run? The running agent is stopped and the run is marked cancelled (its worktree is kept).")) return;
                        void api.cancelAutoRun(run.id).then(() => load()).catch(() => load());
                      }}
                      title={t("autoRuns.cancelHint")}
                    >
                      <X className="mr-1 size-3" /> {t("autoRuns.cancel")}
                    </Button>
                  </div>
                ) : null}
                {run.status === "awaiting_approval" && run.pendingApproval ? (() => {
                  const appr = run.pendingApproval;
                  return (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
                      <span className="text-xs text-muted-foreground">
                        {t("autoRuns.needsApproval")}
                        {appr.riskLevel ? ` · risk: ${appr.riskLevel}` : ""}
                        {(appr.riskTags ?? []).length ? ` (${appr.riskTags.join(", ")})` : ""}. The {run.decision?.path ?? "develop"} agent will edit code for this issue.
                      </span>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          className="h-6 px-2 text-xs"
                          onClick={() => void api.approveApproval(appr.id).then(() => load()).catch(() => load())}
                          title={t("autoRuns.approveHint")}
                        >
                          {t("autoRuns.approve")}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-6 px-2 text-xs"
                          onClick={() => {
                            if (!window.confirm("Deny this run? The agent will be blocked.")) return;
                            void api.denyApproval(appr.id).then(() => load()).catch(() => load());
                          }}
                          title={t("autoRuns.denyHint")}
                        >
                          {t("autoRuns.deny")}
                        </Button>
                      </div>
                    </div>
                  );
                })() : null}
                {run.report && (run.status === "report_posted" || run.status === "needs_input") ? (
                  <ReportView report={run.report} />
                ) : null}
                {run.designArtifacts?.length && run.worktreeId ? (
                  <DesignPanel worktreeId={run.worktreeId} artifacts={run.designArtifacts} />
                ) : null}
                {run.screenshots?.length && run.worktreeId ? (
                  <DesignPanel worktreeId={run.worktreeId} artifacts={run.screenshots} title={t("autoRuns.screenshots")} />
                ) : null}
                {run.status === "report_posted" && run.decision?.path === "design" ? (
                  <DesignApproval run={run} onDone={load} />
                ) : null}
                {run.status === "needs_input" && run.decision?.path === "clarify" ? (
                  <ClarifyAnswer run={run} onDone={load} />
                ) : null}
                {run.status === "plan_proposed" && run.decision?.path === "decompose" ? (
                  <DecompositionApproval run={run} onDone={load} />
                ) : null}
                {run.status === "decomposed" && run.childIssues?.length ? (
                  <EpicRollup run={run} onDone={load} />
                ) : null}
                {run.deployment && (run.deployment.status === "failed" || run.deployment.status === "rolled_back") && run.deployment.summary ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Deploy {run.deployment.status === "rolled_back" ? "rolled back" : "failed"}: {run.deployment.summary}
                  </p>
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
