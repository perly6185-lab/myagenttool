/**
 * Bounded intent contract for natural-language channel messages.
 *
 * A classifier may suggest an intent, but this module is the trust boundary:
 * only the closed set below, a bounded confidence value, and a conversation-
 * local task reference can reach the conversation state machine.
 */

export const CHANNEL_INTENT_KINDS = Object.freeze([
  "greeting",
  "consultation",
  "new_task",
  "supplement",
  "revision",
  "confirm",
  "cancel",
  "query",
  "retry",
  "pause",
  "resume",
  "resend",
  "select",
  "status",
  "list",
  "help",
  "handoff",
  "ambiguous",
  "unknown",
]);

const CHANNEL_INTENT_KIND_SET = new Set(CHANNEL_INTENT_KINDS);
const TASK_REF = /^T-[A-Z0-9_-]{1,64}$/i;

function safeText(value, maxLength) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function safeRef(value, activeRefs = null) {
  const ref = safeText(value, 72).toUpperCase();
  if (!TASK_REF.test(ref)) return null;
  if (activeRefs && !activeRefs.has(ref)) return null;
  return ref;
}

function fallbackDecision(fallback) {
  const intent = CHANNEL_INTENT_KIND_SET.has(fallback?.intent) ? fallback.intent : "unknown";
  const confidence = Number(fallback?.confidence);
  return {
    intent,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    ref: safeRef(fallback?.ref),
    source: fallback?.source === "custom" ? "custom" : "deterministic",
  };
}

/**
 * Normalize and validate an adapter result. Invalid adapter output falls back
 * to the deterministic decision; no raw model output is persisted or executed.
 */
export function normalizeChannelIntentResult(input, { fallback = { intent: "unknown", confidence: 0 }, activeRefs = null } = {}) {
  const safeFallback = fallbackDecision(fallback);
  if (!input || typeof input !== "object") return safeFallback;
  const intent = String(input.intent ?? "").trim().toLowerCase();
  const confidence = Number(input.confidence);
  if (!CHANNEL_INTENT_KIND_SET.has(intent) || !Number.isFinite(confidence)) return safeFallback;
  return {
    intent,
    confidence: Math.max(0, Math.min(1, confidence)),
    ref: safeRef(input.ref, activeRefs),
    source: input.source === "deterministic" ? "deterministic" : "custom",
  };
}

export function channelIntentRequiresClarification(decision, threshold = 0.65) {
  return decision?.intent === "ambiguous"
    || decision?.intent === "unknown"
    || Number(decision?.confidence) < threshold;
}
