// Intent classification for an auto-run. Not every issue is a "make this change"
// task: some are investigations (produce findings, not a diff) and some are
// open questions (need a human decision). Classifying the intent lets the
// reaction route a no-diff outcome correctly — an investigation that produced a
// summary is a SUCCESS (report), not a dead-end "blocked".
//
// This is a conservative title heuristic (the default). A richer LLM classifier
// can be injected to override it; it should return one of AUTO_RUN_INTENTS.

export const AUTO_RUN_INTENTS = ["change", "investigation", "question"];

// A title that reads as a decision to be made, not work to be done.
const QUESTION_LEAD_RE = /^\s*(should we|shall we|can we|do we|is it worth|worth it to|which\b|what should|how should|when should)\b/i;
// Words that signal "find out / evaluate / design", where the deliverable is
// findings or a design artifact (not shipped code). `mockup`/`wireframe` route a
// "Design a … mockup" task to the design path (found by a live run — bare "design"
// is deliberately excluded, it's too ambiguous with "redesign/implement the design").
const INVESTIGATION_RE = /\b(investigate|investigation|research|explore|exploration|spike|evaluate|assess|analyze|analyse|audit|survey|figure out|look into|understand|scope out|find out|compare options|prototype|mockup|mock-up|wireframe|wireframes)\b/i;

/** Classify an issue's intent from its title (and optionally body). */
export function classifyIntentFromText(title, body = "") {
  const text = String(title ?? "").trim();
  if (/\?\s*$/.test(text) || QUESTION_LEAD_RE.test(text)) return "question";
  if (INVESTIGATION_RE.test(text) || INVESTIGATION_RE.test(String(body ?? ""))) return "investigation";
  return "change";
}

export function isAutoRunIntent(value) {
  return AUTO_RUN_INTENTS.includes(value);
}
