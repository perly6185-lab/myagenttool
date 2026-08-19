// Intent classification for an auto-run. Not every issue is a "make this change"
// task: some are investigations (produce findings, not a diff) and some are
// open questions (need a human decision). Classifying the intent lets the
// reaction route a no-diff outcome correctly — an investigation that produced a
// summary is a SUCCESS (report), not a dead-end "blocked".
//
// This is a conservative title heuristic (the default). A richer LLM classifier
// can be injected to override it; it should return one of AUTO_RUN_INTENTS.

export const AUTO_RUN_INTENTS = ["change", "investigation", "question", "exploration", "reading"];

// A title that reads as a decision to be made, not work to be done.
const QUESTION_LEAD_RE = /^\s*(should we|shall we|can we|do we|is it worth|worth it to|which\b|what should|how should|when should)\b/i;
// Words that signal "find out / evaluate / design", where the deliverable is
// findings or a design artifact (not shipped code). `mockup`/`wireframe` route a
// "Design a … mockup" task to the design path (found by a live run — bare "design"
// is deliberately excluded, it's too ambiguous with "redesign/implement the design").
const INVESTIGATION_RE = /\b(investigate|investigation|research|explore|exploration|spike|evaluate|assess|analyze|analyse|audit|survey|figure out|look into|understand|scope out|find out|compare options|prototype|mockup|mock-up|wireframe|wireframes)\b/i;
// A title that already commits to a concrete change: an imperative build verb up
// front. When the TITLE is change-shaped, an incidental "analyze/investigate"
// mention in the BODY must NOT flip the whole issue to design — the ask is the
// change; the analysis is just a step of it. This is the false-positive guard on
// body-aware routing (else "Add a limiter; first analyze traffic" → design → no
// code). Title-level investigation words still win (checked before the guard).
const CHANGE_LEAD_RE = /^\s*(add|fix|implement|create|build|make|update|upgrade|remove|delete|drop|refactor|rename|move|migrate|support|enable|disable|wire|hook up|integrate|replace|introduce|extend|expose|persist|render|handle|prevent|guard|harden|patch|bump|port)\b/i;

/** Classify an issue's intent from its title (and optionally body). */
export function classifyIntentFromText(title, body = "") {
  const text = String(title ?? "").trim();
  if (/\?\s*$/.test(text) || QUESTION_LEAD_RE.test(text)) return "question";
  // "onboard"/"experience"/"try out" are exploration intents, routed to the
  // evaluate path (an experiential assessment, not a design deliverable).
  // "evaluate"/"evaluation" are deliberately NOT here — INVESTIGATION_RE already
  // covers them, and the explosive regex was catching investigation body text.
  const EXPLORATION_RE = /\b(onboard(?:ing)?|experience\s+report|try\s+out|trial\s+run|walkthrough|usage\s+report|quick\s+start)\b/i;
  if (EXPLORATION_RE.test(text) || EXPLORATION_RE.test(String(body ?? "").slice(0, 400))) return "exploration";
  if (INVESTIGATION_RE.test(text)) return "investigation";
  // Body-aware fallback: a NEUTRAL title (no clear change verb) whose body reads
  // as an investigation routes to design. A change-shaped title is never
  // overridden by the body — that's the guard against false positives.
  if (!CHANGE_LEAD_RE.test(text) && INVESTIGATION_RE.test(String(body ?? ""))) return "investigation";
  return "change";
}

export function isAutoRunIntent(value) {
  return AUTO_RUN_INTENTS.includes(value);
}
