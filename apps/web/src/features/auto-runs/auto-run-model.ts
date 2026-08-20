import type { InvocationEventSnapshot } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";

interface AutoRunLink {
  type: "issue" | "pr";
  number: number;
  title: string;
  url: string | null;
}

export interface AutoRunRecord {
  id: string;
  status: string;
  agentId?: string | null;
  terminalId?: string | null;
  projectId?: string | null;
  link?: AutoRunLink | null;
  intent?: string | null;
  decision?: { path: string; workKind?: string | null; decidedBy: string; confidence: number; rationale?: string | null; via?: string | null; clarifyingQuestions?: string[] | null; evidence?: { policyVersion: string; modelVersion: string | null; minConfidence: number; inputDigest: string } | null } | null;
  routingOverride?: { recommendedPath: string | null; actualPath: string; reason: string; actorId: string; recordedAt: string; revision: number } | null;
  branchName?: string | null;
  worktreeId?: string | null;
  invocationId?: string | null;
  failoverAttempts?: number;
  failoverHistory?: FailoverTransition[] | null;
  failoverOutcome?: FailoverOutcome | null;
  executionStage?: "analysis" | "implementation" | "verification" | string | null;
  phase?: "queued" | "understanding" | "waiting_for_input" | "planning" | "implementing" | "verifying" | "review_ready" | "failed" | "cancelled" | null;
  timeoutRecoveryAttempts?: number;
  executionBudget?: {
    turnTimeoutSeconds?: number;
    totalBudgetSeconds?: number;
    elapsedSeconds?: number;
    noProgressStreak?: number;
  } | null;
  capacityRetry?: {
    status?: string;
    attempt?: number;
    maxAttempts?: number;
    retryAt?: string | null;
    lastError?: string | null;
  } | null;
  mergeRisk?: { level: "low" | "medium" | "high"; reasons: string[] } | null;
  prNumber?: number | null;
  prUrl?: string | null;
  verification?: {
    passed: boolean;
    verified: boolean;
    summary?: string | null;
    commands?: string[];
    verifiedAt?: string | null;
  } | null;
  childIssues?: { number: number; url?: string | null; title?: string | null }[] | null;
  judgment?: { solved: boolean | null; confidence: number | null; summary?: string | null; gaps?: string[] } | null;
  report?: string | null;
  designArtifacts?: string[] | null;
  screenshots?: string[] | null;
  designApproval?: { status: "approved" | "rejected"; by?: string | null; at?: string | null; feedback?: string | null } | null;
  clarifyAnswer?: { by?: string | null; at?: string | null; text?: string | null } | null;
  decompositionPlan?: { tree?: { issues?: { title: string }[] } | null; failures?: string[]; approvalReasons?: string[]; overlap?: { flagged?: { a: number; b: number; aTitle?: string | null; bTitle?: string | null; score: number }[]; maxOverlap?: number } | null; truncated?: boolean; proposedCount?: number; parseError?: string | null } | null;
  decompositionApproval?: { status: "approving" | "approved" | "rejected"; by?: string | null; at?: string | null; created?: number; feedback?: string | null } | null;
  childRollup?: { total: number; started: number; notStarted: number; done: number; merged: number; prOpen: number; failed: number; inProgress: number; redundant: number; items: { number: number; title?: string | null; status?: string | null; prState?: string | null; issueState?: string | null; done?: boolean; redundant?: boolean }[] } | null;
  prState?: string | null;
  prChecks?: { total: number; passed: number; failed: number; pending: number; state: "NONE" | "SUCCESS" | "FAILURE" | "PENDING" } | null;
  pendingApproval?: { id: string; riskLevel: string | null; riskTags: string[]; summary: string | null } | null;
  promptInjection?: { suspicious: boolean; markers: string[] } | null;
  deployment?: { status: "deployed" | "failed" | "rolled_back"; at?: string; summary?: string | null; prNumber?: number | null } | null;
  remediationIssue?: { number: number; url?: string | null; culpritPr?: number | null } | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AutoRunAttempt {
  attempt: number;
  total: number;
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

export interface DeploymentSummary {
  total: number;
  deployed: number;
  failed: number;
  changeFailureRate: number | null;
  recoveryHours: { median: number | null; count: number };
  deployFrequencyPerWeek: number | null;
  lastDeployAt: string | null;
}

export interface AutoRunSummary {
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

export function statusTone(status: string): Tone {
  if (status === "done" || status === "pr_open" || status === "report_posted") return "success";
  if (status === "failed") return "danger";
  if (["blocked", "waiting_capacity", "awaiting_approval", "needs_input"].includes(status)) return "warning";
  if (status === "cancelled") return "neutral";
  return "running";
}

export type PostureState = "ok" | "warn" | "bad" | "muted";

export function mergeRisk(run: AutoRunRecord): { warn: boolean } {
  if (run.verification && run.verification.verified && !run.verification.passed) return { warn: true };
  if (!run.verification?.verified) return { warn: true };
  if (!run.judgment || run.judgment.solved !== true) return { warn: true };
  if (run.judgment.confidence != null && run.judgment.confidence < 0.6) return { warn: true };
  const checks = run.prChecks;
  if (!checks || checks.total === 0 || checks.state === "FAILURE" || checks.state === "PENDING") return { warn: true };
  return { warn: false };
}

export function postureRows(run: AutoRunRecord): { key: string; label: string; state: PostureState; detail: string }[] {
  const rows: { key: string; label: string; state: PostureState; detail: string }[] = [];
  if (!run.verification?.verified) rows.push({ key: "verify", label: "Verification", state: "muted", detail: "not run" });
  else if (run.verification.passed) rows.push({ key: "verify", label: "Verification", state: "ok", detail: "passed" });
  else rows.push({ key: "verify", label: "Verification", state: "bad", detail: "FAILED" });

  if (!run.judgment) rows.push({ key: "judge", label: "Acceptance judge", state: "muted", detail: "not run" });
  else if (run.judgment.solved === true) {
    const confidence = run.judgment.confidence;
    const lowConfidence = confidence != null && confidence < 0.6;
    rows.push({ key: "judge", label: "Acceptance judge", state: lowConfidence ? "warn" : "ok", detail: `solved${confidence != null ? ` (${Math.round(confidence * 100)}%)` : ""}${lowConfidence ? " — below 60%" : ""}` });
  } else if (run.judgment.solved === false) rows.push({ key: "judge", label: "Acceptance judge", state: "bad", detail: "did not confirm" });
  else rows.push({ key: "judge", label: "Acceptance judge", state: "warn", detail: "errored — no verdict" });

  const checks = run.prChecks;
  if (!checks || checks.total === 0) rows.push({ key: "checks", label: "PR checks", state: "muted", detail: "none" });
  else if (checks.state === "FAILURE") rows.push({ key: "checks", label: "PR checks", state: "bad", detail: `${checks.failed} failing` });
  else if (checks.state === "PENDING") rows.push({ key: "checks", label: "PR checks", state: "warn", detail: `${checks.pending} pending` });
  else rows.push({ key: "checks", label: "PR checks", state: "ok", detail: `${checks.passed} green` });
  return rows;
}

export function eventsForRun(events: InvocationEventSnapshot[], runId: string, invocationId?: string | null) {
  return events
    .filter((event) => event.data?.autoRunId === runId || Boolean(invocationId && event.invocationId === invocationId))
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

export type AutoRunLane = "attention" | "needs_you" | "running" | "pr_open" | "done";

export function runLane(run: AutoRunRecord): AutoRunLane {
  if (run.status === "failed" || run.status === "blocked" || run.deployment?.status === "failed" || run.deployment?.status === "rolled_back") return "attention";
  if (["awaiting_approval", "needs_input", "report_posted", "plan_proposed"].includes(run.status)) return "needs_you";
  if (run.status === "cancelled" || run.deployment?.status === "deployed" || run.prState === "MERGED" || run.prState === "CLOSED" || run.status === "decomposed") return "done";
  if (run.status === "pr_open") return "pr_open";
  return "running";
}

export function localQueueSnapshot(runs: AutoRunRecord[]) {
  const running = runs.filter((run) => ["running", "verifying", "publishing"].includes(run.status));
  const queued = runs.filter((run) => ["materializing", "waiting_capacity"].includes(run.status));
  const next = queued[0] ?? null;
  const waiting = runs.filter((run) => ["awaiting_approval", "needs_input", "blocked", "failed"].includes(run.status));
  return { running, queued, next, waiting, attentionCount: waiting.length };
}
