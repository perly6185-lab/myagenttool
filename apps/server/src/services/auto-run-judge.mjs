import { runDeciderCommand } from "./decision-command.mjs";

// The acceptance judge (decision-agent plan Phase B): before a develop run's PR
// opens, an operator-configured one-shot command reads the issue + the actual
// diff and judges "does this change solve THIS issue?" — the quality dimension
// the verification command (build/tests) cannot see. Same trust boundary as the
// decider/verify commands: env-configured argv, no shell, never agent-proposed.
//
// Verdict semantics (conservative for autonomy, honest about infra):
//   solved:false  -> the PR is BLOCKED with the judge's gaps for a human.
//   solved:true   -> the PR opens, judgment recorded as evidence in the body.
//   unconfigured  -> the step is skipped (evidence says "not run").
//   judge broken  -> the PR still opens, labelled "judge errored" — an infra
//                    failure must not silently block delivery, only a real
//                    negative verdict does.

export function resolveJudgeCommand(env = process.env) {
  const raw = env.MYAGENTTOOL_AUTORUN_JUDGE_COMMAND_JSON;
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

export function judgeTimeoutMs(env = process.env) {
  const raw = Number(env.MYAGENTTOOL_AUTORUN_JUDGE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 1000 && raw <= 600_000 ? raw : 120_000;
}

/** Validate a raw judge verdict; null if unusable (treated as judge failure). */
export function normalizeJudgment(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.solved !== "boolean") return null;
  const confidence = Number(raw.confidence);
  return {
    solved: raw.solved,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 2000) : "",
    gaps: Array.isArray(raw.gaps)
      ? raw.gaps.filter((g) => typeof g === "string" && g.trim()).slice(0, 10)
      : [],
  };
}

/**
 * Run the judge command with the issue + diff context. Resolves to a normalized
 * judgment, or null on any failure (unusable output, timeout, spawn error).
 */
export async function runAcceptanceJudge({ command, link, issueBody, diff, timeoutMs = judgeTimeoutMs() }) {
  const raw = await runDeciderCommand({
    command,
    input: {
      link,
      issueBody: typeof issueBody === "string" ? issueBody.slice(0, 8000) : null,
      // Diffs can be huge; the judge needs the shape, not every byte.
      diff: typeof diff === "string" ? diff.slice(0, 60_000) : "",
    },
    timeoutMs,
  });
  return normalizeJudgment(raw);
}

/** The PR-body evidence section for the acceptance judgment. */
export function judgmentEvidence(judgment) {
  if (judgment === undefined) return "- Acceptance judgment: not run (no judge command configured)";
  if (judgment === null) return "- Acceptance judgment: judge errored — verdict unavailable (PR opened anyway)";
  const head = `- Acceptance judgment: ${judgment.solved ? "solved" : "NOT solved"} (confidence ${Math.round(judgment.confidence * 100)}%)`;
  const summary = judgment.summary ? `\n  - ${judgment.summary}` : "";
  const gaps = judgment.gaps.length ? `\n${judgment.gaps.map((g) => `  - gap: ${g}`).join("\n")}` : "";
  return `${head}${summary}${gaps}`;
}
