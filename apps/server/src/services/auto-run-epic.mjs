// Epic decomposition rollup (Slice 4). A decomposed epic's child issues each become
// their OWN auto-run once a human labels the child `auto` — so the epic's progress
// can be rolled up IN-MEMORY from those child auto-runs, no gh polling. Pure: given
// the epic run and the full auto-run list, it matches each child issue number to its
// latest same-project auto-run and aggregates. A child with no auto-run yet is
// "not started" (waiting on the human to label it).

/**
 * @param {object} epicRun - a decomposed epic auto-run (carries childIssues[]).
 * @param {object[]} autoRuns - all auto-runs (state.autoRuns).
 * @returns {{total,started,notStarted,merged,prOpen,failed,inProgress,items}}
 */
export function summarizeEpicChildren(epicRun, autoRuns = []) {
  const children = Array.isArray(epicRun?.childIssues) ? epicRun.childIssues : [];
  const projectId = epicRun?.projectId ?? null;

  // Latest same-project auto-run per issue number (a child may have been retried).
  const latestByNumber = new Map();
  for (const run of Array.isArray(autoRuns) ? autoRuns : []) {
    if (run?.link?.type !== "issue" || !Number.isFinite(run?.link?.number)) continue;
    if (projectId && run.projectId && run.projectId !== projectId) continue;
    if (run.id === epicRun?.id) continue; // never count the epic itself
    const prev = latestByNumber.get(run.link.number);
    if (!prev || String(run.updatedAt ?? "") >= String(prev.updatedAt ?? "")) latestByNumber.set(run.link.number, run);
  }

  let started = 0;
  let merged = 0;
  let done = 0;
  let prOpen = 0;
  let failed = 0;
  let inProgress = 0;
  const items = children.map((child) => {
    const run = latestByNumber.get(child.number) ?? null;
    const status = run?.status ?? null;
    const prState = run?.prState ?? null;
    // A child is DONE when its ISSUE is closed — true however it merged (its own
    // auto-run OR a human-override PR outside the loop). issueState is populated by
    // the reconcile refresh; absent (older records) we fall back to prState.
    const isDone = child.issueState === "CLOSED" || prState === "MERGED";
    if (isDone) done += 1;
    if (run) {
      started += 1;
      if (prState === "MERGED") merged += 1;
      else if (status === "pr_open") prOpen += 1;
      else if (status === "failed" || status === "blocked") failed += 1;
      else inProgress += 1;
    }
    return { number: child.number, title: child.title ?? null, status, prState, issueState: child.issueState ?? null, done: isDone };
  });

  return {
    total: children.length,
    started,
    notStarted: children.length - started,
    done,
    merged,
    prOpen,
    failed,
    inProgress,
    items,
  };
}

/**
 * Reconcile a decomposed epic's rollup with GitHub: fetch each OPEN child issue's
 * state and mark it CLOSED when it merged (through its auto-run OR a human-override
 * PR). Bounded + throttled + read-only; CLOSED is terminal (never re-fetched);
 * never throws (fetchIssueState returns null on failure). Injected deps keep it
 * testable without gh.
 */
export async function refreshEpicChildStates({ state, now, fetchIssueState, projectPathFor, throttleMs = 300_000, maxRuns = 20 } = {}) {
  if (typeof fetchIssueState !== "function" || typeof projectPathFor !== "function") return { checked: 0, changed: false };
  const nowMs = Date.parse(now?.() ?? "") || 0;
  const runs = (state?.autoRuns ?? []).filter((r) => r?.status === "decomposed" && Array.isArray(r?.childIssues) && r.childIssues.length);
  let checked = 0;
  let changed = false;
  for (const run of runs.slice(0, maxRuns)) {
    const open = run.childIssues.filter((c) => c.issueState !== "CLOSED");
    if (!open.length) continue; // all children already terminal
    const last = Date.parse(run.childStatesRefreshedAt ?? "") || 0;
    if (nowMs && last && nowMs - last < throttleMs) continue; // throttle per epic
    const repoPath = projectPathFor(run.projectId);
    if (!repoPath) continue;
    for (const child of open) {
      let st = null;
      try { st = await fetchIssueState({ issueNumber: child.number, repoPath }); } catch { st = null; }
      if (st && st !== child.issueState) {
        child.issueState = st;
        changed = true;
      }
    }
    run.childStatesRefreshedAt = now?.() ?? null;
    checked += 1;
  }
  return { checked, changed };
}
