// AI diff-review step for the risk-based merge policy. A separate operator-
// configured one-shot command (same trust boundary as the decider/judge:
// env-configured argv, no shell, never agent-proposed) that reads the issue +
// the diff and returns whether the change is safe to auto-merge. UNLIKE the
// judge, a "fail" here does NOT block the PR — it only feeds the merge-risk
// model, so a flagged diff falls to a human merge instead of auto-merging.

import { runDeciderCommand } from "./decision-command.mjs";

export function resolveReviewCommand(env = process.env) {
  const raw = env.MYAGENTTOOL_AUTORUN_REVIEW_COMMAND_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((item) => typeof item === "string" && item.length > 0)) {
      return parsed;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function reviewTimeoutMs(env = process.env) {
  const raw = Number(env.MYAGENTTOOL_AUTORUN_REVIEW_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 1000 && raw <= 600_000 ? raw : 120_000;
}

/**
 * Normalize a raw review verdict. Accepts either `{approve:boolean}` or
 * `{risk:"low"|"medium"|"high"}`; maps to a stable `{status:"pass"|"fail", ...}`.
 * Returns null if unusable (treated as review-errored → not a pass → not low).
 */
export function normalizeReview(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  let status;
  const risk = typeof raw.risk === "string" ? raw.risk.trim().toLowerCase() : null;
  if (typeof raw.approve === "boolean") status = raw.approve ? "pass" : "fail";
  else if (risk) status = risk === "low" ? "pass" : "fail";
  else return null;
  return {
    status,
    risk: risk ?? (status === "pass" ? "low" : "high"),
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 2000) : "",
    issues: Array.isArray(raw.issues) ? raw.issues.filter((i) => typeof i === "string" && i.trim()).slice(0, 10) : [],
  };
}

export async function runDiffReview({ command, link, issueBody, diff, timeoutMs = reviewTimeoutMs() }) {
  const raw = await runDeciderCommand({
    command,
    input: {
      link,
      issueBody: typeof issueBody === "string" ? issueBody.slice(0, 8000) : null,
      diff: typeof diff === "string" ? diff.slice(0, 60_000) : "",
    },
    timeoutMs,
  });
  return normalizeReview(raw);
}

/** PR-body evidence line for the AI review. */
export function reviewEvidence(review) {
  if (review === undefined) return "- AI diff review: not run (no review command configured)";
  if (review === null) return "- AI diff review: errored — no verdict (does not block)";
  const head = `- AI diff review: ${review.status === "pass" ? "pass" : "FLAGGED"}${review.risk ? ` (risk ${review.risk})` : ""}`;
  const summary = review.summary ? `\n  - ${review.summary}` : "";
  const issues = review.issues.length ? `\n${review.issues.map((i) => `  - ${i}`).join("\n")}` : "";
  return `${head}${summary}${issues}`;
}
