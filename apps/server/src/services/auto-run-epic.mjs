// Epic decomposition rollup (Slice 4). A decomposed epic's child issues each become
// their OWN auto-run once a human labels the child `auto` — so the epic's progress
// can be rolled up IN-MEMORY from those child auto-runs, no gh polling. Pure: given
// the epic run and the full auto-run list, it matches each child issue number to its
// latest same-project auto-run and aggregates. A child with no auto-run yet is
// "not started" (waiting on the human to label it).

// Outcome-based overlap (S5.1): a child that RAN and the acceptance judge blocked as
// "the behavior already exists / the diff only adds docs+tests" is a CONFIRMED
// overlap — the ground truth for the S5 proposal-time overlap PREDICTION. Detected
// from the judge's verdict text (matches the real devdemo #28 block).
const REDUNDANCY_MARKERS = /already (implemented|exists|present|handled|covered|done)|no (new )?(implementation|impl|code)\b|diff only adds|only adds?\b.{0,40}(documentation|docs|tests?)|duplicate|redundant|nothing (new )?to (implement|change)|no (code|behaviou?r) change/i;

export function isRedundancyBlock(judgment) {
  if (!judgment || judgment.solved !== false) return false;
  const text = [judgment.summary, ...(Array.isArray(judgment.gaps) ? judgment.gaps : [])].filter(Boolean).join(" ");
  return REDUNDANCY_MARKERS.test(text);
}

/**
 * @param {object} epicRun - a decomposed epic auto-run (carries childIssues[]).
 * @param {object[]} autoRuns - all auto-runs (state.autoRuns).
 * @returns {{total,started,notStarted,done,merged,prOpen,failed,inProgress,redundant,items}}
 */
export function summarizeEpicChildren(epicRun, autoRuns = []) {
  const children = Array.isArray(epicRun?.childIssues) ? epicRun.childIssues : [];
  const projectId = epicRun?.projectId ?? null;

  // Latest same-project auto-run per issue number (a child may have been retried).
  const latestByNumber = new Map();
  for (const run of Array.isArray(autoRuns) ? autoRuns : []) {
    if (run?.link?.type !== "issue" || !Number.isFinite(run?.link?.number)) continue;
    if (projectId && run.projectId !== projectId) continue; // exclude foreign + unknown-project runs
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
  let redundant = 0;
  const items = children.map((child) => {
    const run = latestByNumber.get(child.number) ?? null;
    const status = run?.status ?? null;
    const prState = run?.prState ?? null;
    // A child is DONE when its ISSUE is closed — true however it merged (its own
    // auto-run OR a human-override PR outside the loop). issueState is populated by
    // the reconcile refresh; absent (older records) we fall back to prState.
    const isDone = child.issueState === "CLOSED" || prState === "MERGED";
    // Confirmed overlap: the run was judge-blocked as already-covered (S5.1).
    const isRedundant = Boolean(run) && isRedundancyBlock(run.judgment);
    if (isDone) done += 1;
    if (isRedundant) redundant += 1;
    if (run) {
      started += 1;
      if (prState === "MERGED") merged += 1;
      else if (status === "pr_open") prOpen += 1;
      else if (status === "failed" || status === "blocked") failed += 1;
      else inProgress += 1;
    }
    return { number: child.number, title: child.title ?? null, status, prState, issueState: child.issueState ?? null, done: isDone, redundant: isRedundant };
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
    redundant,
    items,
  };
}

// Decomposition-quality: score how much the proposed children OVERLAP (S5). The
// live epic run showed the decompose agent can create a child whose scope another
// child already covers (a later child then becomes docs/tests-only and the judge
// blocks it). We surface that at PROPOSAL time so a human can reject/merge children
// before spawning. Deterministic + advisory (never a gate).

// Generic + governance boilerplate — dropped so the score reflects DOMAIN overlap
// (greet, language, fallback…), not shared scaffolding (task, add, implement…).
const OVERLAP_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "its", "into", "from", "when", "your", "you",
  "add", "adds", "added", "adding", "implement", "implements", "implementation", "introduce",
  "support", "supports", "create", "creates", "update", "updates", "change", "changes",
  "task", "issue", "issues", "feature", "work", "acceptance", "criteria", "project", "fields",
  "milestone", "area", "type", "risk", "platform", "priority", "backlog", "defined", "all", "none",
  "todo", "should", "must", "will", "can", "new", "existing", "use", "uses", "using", "via",
]);

function stemToken(word) {
  return word.length > 4 ? word.replace(/(ings|ing|ed|es|s)$/, "") : word;
}

function specTokens(spec) {
  const text = [spec?.title, spec?.problem, spec?.userStory, ...(spec?.acceptanceCriteria ?? [])]
    .filter(Boolean).join(" ").toLowerCase();
  const set = new Set();
  for (const raw of text.match(/[a-z0-9]+/g) ?? []) {
    if (raw.length < 3 || OVERLAP_STOPWORDS.has(raw)) continue;
    set.add(stemToken(raw));
  }
  return set;
}

// Overlap coefficient (|A∩B| / min(|A|,|B|)) — more sensitive than Jaccard when one
// child's scope is a SUBSET of another's, which is exactly the redundant-child case.
function overlapCoefficient(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / Math.min(a.size, b.size);
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} tree - a decomposition tree (issues[]).
 * @param {{threshold?: number}} opts - flag pairs at/above this overlap (default 0.5).
 * @returns {{pairs, flagged, maxOverlap, perChild, threshold}}
 */
export function scoreDecompositionOverlap(tree, { threshold = 0.5 } = {}) {
  const issues = Array.isArray(tree?.issues) ? tree.issues : [];
  const tokens = issues.map(specTokens);
  const pairs = [];
  for (let i = 0; i < issues.length; i += 1) {
    for (let j = i + 1; j < issues.length; j += 1) {
      pairs.push({ a: i, b: j, aTitle: issues[i]?.title ?? null, bTitle: issues[j]?.title ?? null, score: round2(overlapCoefficient(tokens[i], tokens[j])) });
    }
  }
  const flagged = pairs.filter((p) => p.score >= threshold).sort((x, y) => y.score - x.score);
  const maxOverlap = pairs.reduce((m, p) => Math.max(m, p.score), 0);
  const perChild = issues.map((_, i) => round2(Math.max(0, ...pairs.filter((p) => p.a === i || p.b === i).map((p) => p.score))));
  return { pairs, flagged, maxOverlap, perChild, threshold };
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
