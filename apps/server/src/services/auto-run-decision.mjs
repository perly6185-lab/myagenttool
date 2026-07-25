import { createHash } from "node:crypto";
import { classifyIntentFromText } from "./auto-run-intent.mjs";
import { isSpawnedChildBody } from "./auto-run-spawn.mjs";

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
//   decompose — an epic/initiative: break it into governed child issues (a plan,
//               not a diff). Opt-in (epicDecomposition); EPIC_DECOMPOSITION_PLAN.md.

export const AUTO_RUN_PATHS = ["develop", "design", "prototype", "clarify", "decompose"];
export const ROUTING_POLICY_VERSION = "2026-07-25.1";

// Paths whose output is not a product diff. A low-confidence agent decision may
// not send work down these (or spawn issues) — it degrades to clarify instead.
const HEAVY_PATHS = new Set(["design", "prototype", "decompose"]);

const INTENT_TO_PATH = { change: "develop", investigation: "design", question: "clarify" };
// Legacy `intent` field kept on records for continuity with pre-decision runs.
const PATH_TO_INTENT = { develop: "change", design: "investigation", prototype: "investigation", clarify: "question", decompose: "investigation" };

/**
 * Deterministic epic/initiative detector. An epic is a PARENT of work, not a work
 * item — its title is `[Epic]`/`[Initiative]` or its Project Fields say so. Used
 * (only when epicDecomposition is on) to route to the decompose path regardless of
 * what the develop-shaped title heuristic would otherwise say.
 */
export function isEpicIssue({ link, issueBody } = {}) {
  if (/^\s*\[(epic|initiative)\]/i.test(String(link?.title ?? ""))) return true;
  return /(^|\n)\s*type:\s*(epic|initiative)\b/i.test(String(issueBody ?? ""));
}

export function epicDecision() {
  return {
    path: "decompose",
    spawnChildIssues: true,
    confidence: 0.95,
    rationale: "Epic/Initiative detected — decompose into governed child issues.",
    clarifyingQuestions: [],
    decidedBy: "heuristic",
    via: "epic-detector",
  };
}

export function decisionConfig(env = process.env) {
  const raw = Number(env.MYAGENTTOOL_AUTORUN_DECISION_MIN_CONFIDENCE);
  return {
    minConfidence: Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.6,
    // Hybrid fast path (on by default): strong lexical signals skip the decider;
    // only ambiguous "change-shaped" titles pay the LLM hop.
    fastPath: env.MYAGENTTOOL_AUTORUN_DECIDER_FAST_PATH !== "0",
    modelVersion: String(env.MYAGENTTOOL_AUTORUN_DECIDER_MODEL_VERSION ?? "").trim() || null,
  };
}

export function intentForPath(path) {
  return PATH_TO_INTENT[path] ?? "change";
}

/** Today's title+body heuristic mapped onto the decision contract. Always available. */
export function heuristicDecision(link, issueBody = null) {
  const intent = classifyIntentFromText(link?.title ?? "", issueBody ?? "");
  return {
    path: INTENT_TO_PATH[intent] ?? "develop",
    spawnChildIssues: false,
    confidence: 0.3,
    rationale: `Title heuristic classified this as "${intent}".`,
    clarifyingQuestions: [],
    decidedBy: "heuristic",
    via: "heuristic",
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
export async function resolveDecision({
  link,
  issueBody = null,
  decideIssuePath,
  minConfidence = decisionConfig().minConfidence,
  fastPath = decisionConfig().fastPath,
  modelVersion = decisionConfig().modelVersion,
  epicDecomposition = false,
} = {}) {
  const finalize = (decision) => ({
    ...decision,
    evidence: {
      policyVersion: ROUTING_POLICY_VERSION,
      modelVersion,
      minConfidence,
      inputDigest: createHash("sha256").update(JSON.stringify({
        type: link?.type ?? null,
        number: link?.number ?? null,
        title: link?.title ?? "",
        body: issueBody ?? "",
      })).digest("hex"),
    },
  });
  // Opt-in epic decomposition wins over every other route: an epic is never a
  // single develop/design run. Deterministic — no decider hop, no LLM variance.
  // GATED on a NON-child body: a spawned child (depth-1 marker) with an [Epic]-
  // shaped title must NOT re-decompose into grandchildren. (review: depth-1 gate)
  if (epicDecomposition && !isSpawnedChildBody(issueBody) && isEpicIssue({ link, issueBody })) return finalize(epicDecision());
  // The fallback floor reads the body too (best-effort when no agent is
  // configured); the change-title guard keeps a clear change from being flipped.
  if (typeof decideIssuePath !== "function") return finalize(heuristicDecision(link, issueBody));

  // Hybrid fast path: question/investigation TITLES are strong lexical signals
  // the heuristic reads reliably — skip the decider hop. Deliberately title-only:
  // a mere body mention is weaker and should pay the decider, not fast-path. The
  // weak default ("looks like a change") is exactly where ambiguity lives.
  if (fastPath) {
    const quick = heuristicDecision(link);
    if (quick.path !== "develop") {
      return finalize({ ...quick, via: "fast-path", rationale: `${quick.rationale} (Fast path: strong lexical signal, decider skipped.)` });
    }
  }

  const startedAt = Date.now();
  let decision = null;
  try {
    decision = normalizeDecision(await decideIssuePath({ link, issueBody }));
  } catch {
    decision = null;
  }
  const latencyMs = Date.now() - startedAt;
  // Decider errored: fall back TITLE-ONLY, matching the fast path. Reading the body
  // here would make the SAME issue route differently on a transient decider hiccup
  // (develop→PR when it answers, design→no-code when it times out). The body-aware
  // heuristic is reserved for the no-decider deployment above, where it's stable.
  if (!decision) return finalize({ ...heuristicDecision(link), via: "fallback", latencyMs });
  decision = { ...decision, via: "agent", latencyMs };
  if (decision.confidence < minConfidence && (HEAVY_PATHS.has(decision.path) || decision.spawnChildIssues)) {
    return finalize({
      ...decision,
      path: "clarify",
      spawnChildIssues: false,
      rationale: `${decision.rationale ? `${decision.rationale} ` : ""}(Degraded to clarify: confidence ${decision.confidence.toFixed(2)} below ${minConfidence} for a heavy path.)`,
    });
  }
  // A low-confidence DEVELOP decision that the agent ITSELF flagged with open
  // questions degrades to clarify — cheaper to ask than to burn a run on a guess.
  // Guarded tightly: a confident develop, or one with no questions, still proceeds
  // (a human reviews the diff regardless), and the heuristic floor — which never
  // raises questions — is never gated. Asking needlessly is friction, so we only
  // ask when the decider explicitly said it lacks what it needs.
  if (decision.path === "develop" && decision.confidence < minConfidence && decision.clarifyingQuestions.length > 0) {
    return finalize({
      ...decision,
      path: "clarify",
      spawnChildIssues: false,
      rationale: `${decision.rationale ? `${decision.rationale} ` : ""}(Degraded to clarify: develop confidence ${decision.confidence.toFixed(2)} below ${minConfidence} with open questions.)`,
    });
  }
  return finalize(decision);
}
