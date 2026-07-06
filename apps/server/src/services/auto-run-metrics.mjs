import { autoRunStates } from "./auto-run.mjs";

// Observability + evaluation for the autonomous auto-run loop. A pure summary of
// the auto-run records so the console can render live progress and a tracking
// dashboard (success rate, verification-gate outcomes, blocked reasons, and how
// long a run takes to reach a PR). Pure so it is trivially testable and can back
// both the API and any eval harness.

const ACTIVE_STATUSES = new Set(["materializing", "running", "awaiting_approval", "verifying", "publishing"]);

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
export function summarizeAutoRuns(autoRuns = []) {
  const byStatus = {};
  for (const status of autoRunStates) byStatus[status] = 0;

  let active = 0;
  const verification = { passed: 0, failed: 0, unverified: 0 };
  const blockedReasonCounts = {};
  const timeToPrSeconds = [];
  // Routing decisions (slice 5 will evaluate them against outcomes).
  const decisions = { byPath: { develop: 0, design: 0, prototype: 0, clarify: 0 }, byDecidedBy: { agent: 0, heuristic: 0 } };

  for (const run of autoRuns) {
    byStatus[run.status] = (byStatus[run.status] ?? 0) + 1;
    if (ACTIVE_STATUSES.has(run.status)) active += 1;

    if (run.decision?.path) {
      decisions.byPath[run.decision.path] = (decisions.byPath[run.decision.path] ?? 0) + 1;
      const by = run.decision.decidedBy === "agent" ? "agent" : "heuristic";
      decisions.byDecidedBy[by] += 1;
    }

    if (run.verification) {
      if (!run.verification.verified) verification.unverified += 1;
      else if (run.verification.passed) verification.passed += 1;
      else verification.failed += 1;
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
    decisions,
    blockedReasons: topReasons(blockedReasonCounts),
    timeToPr: {
      count: timeToPrSeconds.length,
      medianSeconds: percentile(timeToPrSeconds, 0.5),
      p90Seconds: percentile(timeToPrSeconds, 0.9),
    },
  };
}
