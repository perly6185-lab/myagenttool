import { classifyIntentFromText } from "./auto-run-intent.mjs";

// The issue decision step (ISSUE_DECISION_AGENT_PLAN.md slice 1). An injectable
// decider (later: the LLM decision agent) proposes a structured decision; this
// module validates it and applies the confidence gates. The model decides, the
// code routes: nothing here executes side effects.
//
// Contract: { path, spawnChildIssues, confidence, rationale, clarifyingQuestions,
// decidedBy }. Paths:
//   develop   — concrete, scoped change: go straight to the change flow.
//   design    — open solution space: the deliverable is a design, not a diff.
//   prototype — deep uncertainty: a runnable spike is worth more than analysis.
//   clarify   — under-specified: ask specific questions instead of guessing.

export const AUTO_RUN_PATHS = ["develop", "design", "prototype", "clarify"];

// Paths whose output is not a product diff. A low-confidence agent decision may
// not send work down these (or spawn issues) — it degrades to clarify instead.
const HEAVY_PATHS = new Set(["design", "prototype"]);

const INTENT_TO_PATH = { change: "develop", investigation: "design", question: "clarify" };
// Legacy `intent` field kept on records for continuity with pre-decision runs.
const PATH_TO_INTENT = { develop: "change", design: "investigation", prototype: "investigation", clarify: "question" };

export function decisionConfig(env = process.env) {
  const raw = Number(env.MYAGENTTOOL_AUTORUN_DECISION_MIN_CONFIDENCE);
  return { minConfidence: Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.6 };
}

export function intentForPath(path) {
  return PATH_TO_INTENT[path] ?? "change";
}

/** Today's title heuristic mapped onto the decision contract. Always available. */
export function heuristicDecision(link) {
  const intent = classifyIntentFromText(link?.title ?? "");
  return {
    path: INTENT_TO_PATH[intent] ?? "develop",
    spawnChildIssues: false,
    confidence: 0.3,
    rationale: `Title heuristic classified this as "${intent}".`,
    clarifyingQuestions: [],
    decidedBy: "heuristic",
  };
}

/** Validate a raw (agent-produced) decision against the contract; null if unusable. */
export function normalizeDecision(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!AUTO_RUN_PATHS.includes(raw.path)) return null;
  const confidence = Number(raw.confidence);
  return {
    path: raw.path,
    spawnChildIssues: raw.spawnChildIssues === true,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    rationale: typeof raw.rationale === "string" ? raw.rationale.slice(0, 2000) : "",
    clarifyingQuestions: Array.isArray(raw.clarifyingQuestions)
      ? raw.clarifyingQuestions.filter((q) => typeof q === "string" && q.trim()).slice(0, 5)
      : [],
    decidedBy: "agent",
  };
}

/**
 * Resolve the decision for an issue: ask the injected decider, validate, apply
 * the confidence gates, fall back to the heuristic on any failure. Never throws.
 *
 * Gates apply to AGENT decisions only — the heuristic is the trusted floor (it
 * is exactly today's behavior), so gating it would change behavior when no
 * agent is configured.
 */
export async function resolveDecision({ link, decideIssuePath, minConfidence = decisionConfig().minConfidence } = {}) {
  if (typeof decideIssuePath !== "function") return heuristicDecision(link);
  let decision = null;
  try {
    decision = normalizeDecision(await decideIssuePath({ link }));
  } catch {
    decision = null;
  }
  if (!decision) return heuristicDecision(link);
  if (decision.confidence < minConfidence && (HEAVY_PATHS.has(decision.path) || decision.spawnChildIssues)) {
    return {
      ...decision,
      path: "clarify",
      spawnChildIssues: false,
      rationale: `${decision.rationale ? `${decision.rationale} ` : ""}(Degraded to clarify: confidence ${decision.confidence.toFixed(2)} below ${minConfidence} for a heavy path.)`,
    };
  }
  return decision;
}
