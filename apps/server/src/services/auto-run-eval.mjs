// Routing evaluation (ISSUE_DECISION_AGENT_PLAN.md slice 5): was the routing
// right? Cross-tab each decided path against what its run actually did, and
// fold in the PR's final disposition (merged / closed) once known. This is the
// data that tunes the fast path and the confidence threshold.
//
// Alignment per path (from run outcomes alone):
//   develop   — aligned when a PR opened; misaligned when the run produced no
//               changes (blocked): the issue was not change-shaped after all.
//   design / prototype — aligned when the deliverable was a report; "diverted"
//               when the run opened a PR anyway (it made a real diff — a signal
//               the issue may have been develop-shaped).
//   clarify   — aligned when it parked for input.
// Everything still in flight (or failed for infra reasons) is inconclusive.

const PATHS = ["develop", "design", "prototype", "clarify"];

function alignmentFor(path, status) {
  if (path === "develop") {
    if (status === "pr_open") return "aligned";
    if (status === "blocked") return "misaligned";
    return "inconclusive";
  }
  if (path === "design" || path === "prototype") {
    if (status === "report_posted") return "aligned";
    if (status === "pr_open") return "diverted";
    return "inconclusive";
  }
  if (path === "clarify") {
    if (status === "needs_input") return "aligned";
    if (status === "pr_open") return "diverted";
    return "inconclusive";
  }
  return "inconclusive";
}

/**
 * Evaluate routing quality across auto-run records. Returns per-path outcome
 * counts, an overall alignment rate over conclusive runs (null before data),
 * and PR dispositions (merged/closed) per path once refreshed.
 */
export function routingEvaluation(autoRuns = []) {
  const byPath = {};
  for (const path of PATHS) {
    byPath[path] = { total: 0, aligned: 0, misaligned: 0, diverted: 0, inconclusive: 0, prMerged: 0, prClosed: 0 };
  }
  let aligned = 0;
  let conclusive = 0;

  for (const run of autoRuns) {
    const path = run.decision?.path;
    if (!PATHS.includes(path)) continue;
    const bucket = byPath[path];
    bucket.total += 1;
    const verdict = alignmentFor(path, run.status);
    bucket[verdict] += 1;
    if (verdict !== "inconclusive") {
      conclusive += 1;
      if (verdict === "aligned") aligned += 1;
    }
    if (run.prState === "MERGED") bucket.prMerged += 1;
    else if (run.prState === "CLOSED") bucket.prClosed += 1;
  }

  return {
    byPath,
    conclusive,
    alignmentRate: conclusive > 0 ? aligned / conclusive : null,
  };
}

/**
 * Refresh the final disposition of opened PRs (merged / closed / still open) on
 * the auto-run records — the outcome signal the evaluation needs. Bounded and
 * throttled; read-only gh; a fetch failure just leaves the run unchanged.
 */
export async function refreshPrDispositions({
  state,
  fetchPrState,
  fetchPrChecks,
  now = () => new Date().toISOString(),
  maxChecks = 10,
  minIntervalMs = 10 * 60 * 1000,
} = {}) {
  if (typeof fetchPrState !== "function") return { checked: 0, updated: 0 };
  const nowMs = Date.parse(now());
  let checked = 0;
  let updated = 0;
  for (const run of state.autoRuns ?? []) {
    if (checked >= maxChecks) break;
    if (run.status !== "pr_open" || !Number.isFinite(run.prNumber)) continue;
    if (run.prState === "MERGED" || run.prState === "CLOSED") continue; // terminal
    const last = run.prStateCheckedAt ? Date.parse(run.prStateCheckedAt) : 0;
    if (Number.isFinite(last) && nowMs - last < minIntervalMs) continue;
    const project = (state.projects ?? []).find((item) => item.id === run.projectId) ?? null;
    if (!project?.path) continue;
    checked += 1;
    try {
      const prState = await fetchPrState({ prNumber: run.prNumber, repoPath: project.path });
      run.prStateCheckedAt = now();
      if (prState && ["OPEN", "MERGED", "CLOSED"].includes(prState) && prState !== run.prState) {
        run.prState = prState;
        updated += 1;
      }
      // CI check posture so the console can show it before a human merges.
      if (typeof fetchPrChecks === "function" && run.prState !== "MERGED" && run.prState !== "CLOSED") {
        const prChecks = await fetchPrChecks({ prNumber: run.prNumber, repoPath: project.path });
        if (prChecks) run.prChecks = prChecks;
      }
    } catch {
      run.prStateCheckedAt = now();
    }
  }
  return { checked, updated };
}
