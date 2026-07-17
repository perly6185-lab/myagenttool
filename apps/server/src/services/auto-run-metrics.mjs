import { autoRunStates } from "./auto-run.mjs";
import { routingEvaluation } from "./auto-run-eval.mjs";
import { DEFAULT_SLO_TARGETS, summarizeAutoRunSlos } from "./auto-run-slo.mjs";

// Observability + evaluation for the autonomous auto-run loop. A pure summary of
// the auto-run records so the console can render live progress and a tracking
// dashboard (success rate, verification-gate outcomes, blocked reasons, and how
// long a run takes to reach a PR). Pure so it is trivially testable and can back
// both the API and any eval harness.

const ACTIVE_STATUSES = new Set(["materializing", "running", "awaiting_approval", "verifying", "publishing"]);
// Quality rates (article dimension 8: don't only watch success rate). A run in
// one of these states handed control back to a human.
const ESCALATION_STATUSES = new Set(["needs_input", "awaiting_approval", "blocked"]);

function percentile(sortedSeconds, fraction) {
  if (sortedSeconds.length === 0) return null;
  // Nearest-rank; clamp the index into range.
  const rank = Math.min(sortedSeconds.length - 1, Math.max(0, Math.ceil(fraction * sortedSeconds.length) - 1));
  return sortedSeconds[rank];
}

function topReasons(counts, limit = 5) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reason, count]) => ({ reason, count }));
}

/**
 * Summarize auto-run records for observation and evaluation.
 * - byStatus: count per lifecycle state (all states present, zero-filled).
 * - active: runs still in flight.
 * - outcomes / successRate: of the runs that reached a terminal state
 *   (pr_open | blocked | failed), how many opened a PR.
 * - verification: gate outcomes (passed | failed | unverified) across runs that
 *   reached the gate.
 * - blockedReasons: most common reasons a run was blocked (e.g. failed checks,
 *   no changes).
 * - timeToPr: seconds from start to pr_open (count, median, p90).
 */
export function summarizeAutoRuns(autoRuns = [], { sloTargets = null } = {}) {
  const byStatus = {};
  for (const status of autoRunStates) byStatus[status] = 0;

  let active = 0;
  // Quality rates: how often a human had to step in, and how often a develop run
  // needed a self-repair round (a machine "correction"). Denominators differ, so
  // count each population separately.
  let escalated = 0;
  let developRuns = 0;
  let repairedRuns = 0;
  const verification = { passed: 0, failed: 0, unverified: 0 };
  // Acceptance-judge verdicts (Phase B): solved / notSolved / unavailable.
  const judgments = { solved: 0, notSolved: 0, unavailable: 0 };
  const blockedReasonCounts = {};
  const timeToPrSeconds = [];
  // Routing decisions (slice 5 will evaluate them against outcomes).
  const decisions = {
    byPath: { develop: 0, design: 0, prototype: 0, clarify: 0 },
    byDecidedBy: { agent: 0, heuristic: 0 },
    // How the decision was reached: heuristic (no decider), fast-path (lexical
    // signal skipped the decider), agent, or fallback (decider failed).
    byVia: { heuristic: 0, "fast-path": 0, agent: 0, fallback: 0 },
  };

  for (const run of autoRuns) {
    byStatus[run.status] = (byStatus[run.status] ?? 0) + 1;
    if (ACTIVE_STATUSES.has(run.status)) active += 1;
    if (ESCALATION_STATUSES.has(run.status)) escalated += 1;
    // Only develop runs self-repair (design/clarify/etc. produce no diff to fix),
    // so the correction rate is over the develop population, not all runs.
    if ((run.decision?.path ?? "develop") === "develop") {
      developRuns += 1;
      if ((run.repairAttempts ?? 0) > 0) repairedRuns += 1;
    }

    if (run.decision?.path) {
      decisions.byPath[run.decision.path] = (decisions.byPath[run.decision.path] ?? 0) + 1;
      const by = run.decision.decidedBy === "agent" ? "agent" : "heuristic";
      decisions.byDecidedBy[by] += 1;
      const via = ["heuristic", "fast-path", "agent", "fallback"].includes(run.decision.via) ? run.decision.via : "heuristic";
      decisions.byVia[via] += 1;
    }

    if (run.verification) {
      if (!run.verification.verified) verification.unverified += 1;
      else if (run.verification.passed) verification.passed += 1;
      else verification.failed += 1;
    }

    if (run.judgment) {
      if (run.judgment.solved === true) judgments.solved += 1;
      else if (run.judgment.solved === false) judgments.notSolved += 1;
      else judgments.unavailable += 1;
    }

    if (run.status === "blocked" && run.error) {
      blockedReasonCounts[run.error] = (blockedReasonCounts[run.error] ?? 0) + 1;
    }

    if (run.status === "pr_open" && run.createdAt && run.updatedAt) {
      const seconds = (Date.parse(run.updatedAt) - Date.parse(run.createdAt)) / 1000;
      if (Number.isFinite(seconds) && seconds >= 0) timeToPrSeconds.push(seconds);
    }
  }

  const prOpen = byStatus.pr_open ?? 0;
  const blocked = byStatus.blocked ?? 0;
  const failed = byStatus.failed ?? 0;
  const reportPosted = byStatus.report_posted ?? 0;
  const needsInput = byStatus.needs_input ?? 0;
  // Change-shaped completions: a PR either opened or it didn't. Non-diff outcomes
  // (investigation/question) are tracked separately so they don't skew the rate.
  const terminal = prOpen + blocked + failed;
  timeToPrSeconds.sort((a, b) => a - b);

  return {
    total: autoRuns.length,
    active,
    byStatus,
    outcomes: { prOpen, blocked, failed, reportPosted, needsInput },
    // Fraction 0..1 of completed runs that opened a PR; null when there is no
    // completed run yet (avoids a fake 0% before any data exists).
    successRate: terminal > 0 ? prOpen / terminal : null,
    verification,
    judgments,
    decisions,
    // Was the routing right? Per-path alignment + PR dispositions (slice 5).
    routing: routingEvaluation(autoRuns),
    blockedReasons: topReasons(blockedReasonCounts),
    timeToPr: {
      count: timeToPrSeconds.length,
      medianSeconds: percentile(timeToPrSeconds, 0.5),
      p90Seconds: percentile(timeToPrSeconds, 0.9),
    },
    // A2: service-level objectives with target lines + meets/below verdicts.
    // Operator-tunable targets (settings.sloTargets) override the defaults.
    slo: summarizeAutoRunSlos(autoRuns, sloTargets ? { ...DEFAULT_SLO_TARGETS, ...sloTargets } : DEFAULT_SLO_TARGETS),
    // Dimension 8: quality is more than success rate. Each rate is null until its
    // population exists, so an empty loop never shows a fake 0%.
    // - humanEscalation: fraction of ALL runs that handed control to a human.
    // - selfRepair (machine correction): fraction of DEVELOP runs that needed a
    //   self-repair round after a failed check.
    // safetyIntervention / regeneration rates are intentionally omitted: neither
    // is stamped per-run yet (they need a run-level counter first).
    rates: {
      humanEscalation: autoRuns.length > 0 ? Number((escalated / autoRuns.length).toFixed(4)) : null,
      selfRepair: developRuns > 0 ? Number((repairedRuns / developRuns).toFixed(4)) : null,
    },
  };
}
