import {
  refusalCategories,
  refusalCodes,
  refusalCodesByCategory,
} from "@myagenttool/protocol";

// Refusal model Phase 2 (#760). `refuse()` is the SINGLE writer for the device's
// veto: it records a first-class refusal into `state.refusals[]` AND fires the
// existing event, unchanged. Coverage is structural — "did we cover every gate?"
// becomes "is there a code path that denies without calling refuse()?", a
// question about one function. The event-log guard (see event-log.mjs) enforces
// it: a refusal-typed event appended outside refuse() is caught.
//
// Design of record: docs/vision/REFUSAL_MODEL.md.

// The refusal event types the SERVER emits (loop_* refusals live in tools/ai and
// never flow through this appendEvent). A type in this set may only reach the
// event log via refuse(). `local_execution_refused` is here because the desktop
// executor — a decider too — reports it up over /api/bridge/events.
export const SERVER_REFUSAL_EVENT_TYPES = new Set([
  "bridge_delivery_refused",
  "bridge_lifecycle_refused",
  "bridge_operation_refused",
  "delivery_refused",
  "local_execution_refused",
  "invocation_rejected",
  "local_approval_denied",
  "codex_approval_denied",
  "auto_run_denied",
  "auto_run_design_rejected",
  "auto_run_decomposition_rejected",
  "application_orchestration_recovery_action_rejected",
  "permission_denied",
]);

const REFUSALS_CAP = 200;

function assertTaxonomy(category, code) {
  if (!refusalCategories.includes(category)) {
    throw new Error(`refuse(): unknown category "${category}"`);
  }
  if (!refusalCodes.includes(code)) {
    throw new Error(`refuse(): unknown code "${code}"`);
  }
  if (!refusalCodesByCategory[category].includes(code)) {
    throw new Error(`refuse(): ${category}/${code} is not in the closed taxonomy`);
  }
}

export function createRefusalRuntime({ state, now, nextId, appendEvent, persistStateSoon = () => {} }) {
  if (!Array.isArray(state.refusals)) {
    state.refusals = [];
  }

  /**
   * Record a refusal and fire its existing event, unchanged.
   *
   * @param {object} args
   * @param {{kind: string, id: string|null}} args.subject
   * @param {{kind: string, id: string|null}} args.requester
   * @param {string} args.category   one of refusalCategories
   * @param {string} args.code       one of refusalCodes (must match category)
   * @param {{kind: string, id: string|null}} args.decidedBy
   * @param {string} args.summary    one line, for a person
   * @param {object} [args.evidence] gate-specific proof, verbatim, NOT normalized
   * @param {string} [args.remedy]   what would make this succeed
   * @param {string|null} [args.retryAfter] ISO time, or null if retry cannot help
   * @param {string|null} [args.appealTo]   who can overturn it, or null
   * @param {object|null} [args.event] the existing event payload to fire (unchanged)
   * @returns {{refusal: object, event: object|null}}
   */
  function refuse({
    subject,
    requester,
    category,
    code,
    decidedBy,
    summary,
    evidence = {},
    remedy = "",
    retryAfter = null,
    appealTo = null,
    event = null,
  }) {
    assertTaxonomy(category, code);
    // Fire the existing event FIRST so ordering in state.events is byte-identical
    // to before this refactor. `viaRefuse` tells the event-log guard this denial
    // came through the single writer.
    const firedEvent = event ? appendEvent(event, { viaRefuse: true }) : null;
    const refusal = {
      id: nextId("ref_demo"),
      at: now(),
      subject: subject ?? { kind: "invocation", id: null },
      requester: requester ?? { kind: "control_plane", id: null },
      category,
      code,
      decidedBy: decidedBy ?? { kind: "policy_engine", id: null },
      summary: summary ?? "",
      evidence: evidence && typeof evidence === "object" ? evidence : {},
      remedy: remedy ?? "",
      retryAfter: retryAfter ?? null,
      appealTo: appealTo ?? null,
      // Denormalized for read-model scoping — mirrors the fired event's invocation.
      invocationId: event?.invocationId ?? (subject?.kind === "invocation" ? subject.id : null) ?? null,
    };
    state.refusals.unshift(refusal);
    // Bounded ring buffer — same pattern as state.events. retentionSettings holds
    // the operator-facing day policy; this count cap is the hard growth stop.
    if (state.refusals.length > REFUSALS_CAP) {
      state.refusals = state.refusals.slice(0, REFUSALS_CAP);
    }
    persistStateSoon();
    return { refusal, event: firedEvent };
  }

  /**
   * Pick the refusal that must win when several gates would refuse the same
   * request, in the pinned evaluation order not_granted → policy → state → human.
   * An ungranted + over-budget request reports not_granted, never over_budget.
   */
  function firstRefusal(candidates) {
    const valid = (candidates ?? []).filter(Boolean);
    valid.sort(
      (a, b) => refusalCategories.indexOf(a.category) - refusalCategories.indexOf(b.category),
    );
    return valid[0] ?? null;
  }

  return { refuse, firstRefusal };
}
