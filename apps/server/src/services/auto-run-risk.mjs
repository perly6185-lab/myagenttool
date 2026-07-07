// Merge-risk model for an auto-run (the risk-based merge policy). Pure and
// importable so the server route, the auto-merge policy, and the tests all read
// ONE definition of "low / medium / high". Signals are the ones the loop already
// produces: the verification gate, the acceptance judge, the PR's CI checks, and
// the B1a prompt-injection flag. (The AI diff-review, diff size, and sensitive-
// path signals join via `extra`.)
//
// Levels:
//   high   — a hard negative signal (verify failed / judge said not-solved /
//            CI failing / injection / AI review flagged). Never auto-mergeable.
//   low    — every signal is affirmatively green. The auto-merge candidate.
//   medium — no failures, but a signal is missing/unsettled (no verify command,
//            judge not run, CI pending, oversized/sensitive diff). Stays human.

const JUDGE_MIN_CONFIDENCE = 0.6;

// A conservative default sensitive-path set for the auto-merge guard: touching
// any of these makes a PR NOT auto-mergeable (falls to a human) regardless of
// size — a 5-line auth/CI/migration/dependency change outweighs a 500-line docs
// change. Operators can override the list in settings.
export const DEFAULT_SENSITIVE_PATHS = [
  ".github/workflows/**",
  "**/migrations/**",
  "**/package.json",
  "package.json",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/*.lock",
  "**/auth/**",
  "**/*.tf",
  "infra/**",
  "**/Dockerfile",
  "**/.env*",
];

// Minimal glob matcher, single pass: `**/` = zero-or-more directories, `**` =
// anything (incl. separators), `*` = a run within one segment; every other char
// is matched literally. Enough for path globs.
export function matchesGlob(path, pattern) {
  if (typeof path !== "string" || typeof pattern !== "string" || !pattern) return false;
  let body = "";
  let i = 0;
  while (i < pattern.length) {
    if (pattern.startsWith("**/", i)) {
      body += "(?:.*/)?";
      i += 3;
    } else if (pattern.startsWith("**", i)) {
      body += ".*";
      i += 2;
    } else if (pattern[i] === "*") {
      body += "[^/]*";
      i += 1;
    } else {
      const ch = pattern[i];
      body += /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
      i += 1;
    }
  }
  try {
    return new RegExp(`^${body}$`).test(path);
  } catch {
    return false;
  }
}

// First changed path that hits a sensitive pattern, or null. `files` is either a
// list of path strings or worktreeDiff-style `{path}` objects.
export function sensitivePathHit(files = [], patterns = []) {
  if (!Array.isArray(patterns) || !patterns.length) return null;
  for (const f of files ?? []) {
    const p = typeof f === "string" ? f : f?.path;
    if (!p) continue;
    for (const pat of patterns) {
      if (matchesGlob(p, pat)) return { path: p, pattern: pat };
    }
  }
  return null;
}

export function computeMergeRisk(run, { judgeMinConfidence = JUDGE_MIN_CONFIDENCE, extra = null } = {}) {
  const reasons = [];
  const highReasons = [];

  // Verification gate.
  const v = run?.verification;
  if (v && v.verified && !v.passed) highReasons.push("verification FAILED");
  const verifyGreen = Boolean(v && v.verified && v.passed);
  if (!v || !v.verified) reasons.push("verification not run");

  // Acceptance judge.
  const j = run?.judgment;
  if (j && j.solved === false) highReasons.push("acceptance judge did not confirm the change");
  const judgeGreen = Boolean(j && j.solved === true && (j.confidence == null || j.confidence >= judgeMinConfidence));
  if (!j) reasons.push("acceptance judge not run");
  else if (j.solved === true && j.confidence != null && j.confidence < judgeMinConfidence) reasons.push(`judge confidence ${Math.round(j.confidence * 100)}% below ${Math.round(judgeMinConfidence * 100)}%`);
  else if (j.solved === null) reasons.push("acceptance judge errored — no verdict");

  // PR CI checks.
  const pc = run?.prChecks;
  if (pc && pc.state === "FAILURE") highReasons.push(`${pc.failed ?? "some"} PR check(s) failing`);
  const checksGreen = Boolean(pc && pc.state === "SUCCESS");
  if (!pc || pc.total === 0 || pc.state === "NONE") reasons.push("no PR checks");
  else if (pc.state === "PENDING") reasons.push(`${pc.pending ?? "some"} PR check(s) still running`);

  // Prompt-injection (B1a).
  if (run?.promptInjection?.suspicious) highReasons.push("issue body flagged for prompt injection");

  // Optional extra signals: AI diff review + diff size + sensitive paths.
  let extraGreen = true;
  if (extra) {
    if (extra.review) {
      if (extra.review.status === "fail") highReasons.push(`AI review flagged risk${extra.review.summary ? `: ${extra.review.summary}` : ""}`);
      else if (extra.review.status !== "pass") { extraGreen = false; reasons.push("AI review not run"); }
    }
    if (extra.diffTooLarge) { extraGreen = false; reasons.push("diff exceeds the auto-merge size cap"); }
    if (extra.sensitivePath) { extraGreen = false; reasons.push(`touches a sensitive path (${extra.sensitivePath.pattern})`); }
  }

  let level;
  if (highReasons.length > 0) level = "high";
  else if (verifyGreen && judgeGreen && checksGreen && !run?.promptInjection?.suspicious && extraGreen) level = "low";
  else level = "medium";

  return {
    level,
    reasons: level === "high" ? highReasons : reasons,
    signals: { verifyGreen, judgeGreen, checksGreen, injection: Boolean(run?.promptInjection?.suspicious) },
  };
}
