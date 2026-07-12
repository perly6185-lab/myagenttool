import { SERVER_REFUSAL_EVENT_TYPES } from "./refusal-log.mjs";

const warnedRefusalBypass = new Set();

export function createEventLogRuntime({
  state,
  now,
  nextId,
  persistStateSoon,
  getCodexEventHandlers,
}) {
  // The structural chokepoint (refusal model Phase 2, #760): a refusal-typed
  // event may only reach the log via refuse(), which passes { viaRefuse: true }.
  // A denial that appends one directly has bypassed the single writer — throw
  // under REFUSAL_STRICT (the refusal test suite), warn otherwise so a stray
  // legacy path never turns a live refusal into a 500.
  function appendEvent(event, options = {}) {
    if (event && SERVER_REFUSAL_EVENT_TYPES.has(event.type) && !options.viaRefuse) {
      const message = `refusal-typed event "${event.type}" appended outside refuse() — route it through the single writer`;
      if (process.env.REFUSAL_STRICT === "1") {
        throw new Error(message);
      }
      if (!warnedRefusalBypass.has(event.type)) {
        warnedRefusalBypass.add(event.type);
        console.warn(`[refusal] ${message}`);
      }
    }
    const record = {
      id: nextId("evt_demo"),
      invocationId: event.invocationId,
      type: event.type,
      level: event.level,
      message: event.message,
      data: event.data ?? null,
      createdAt: now()
    };
    state.events.unshift(record);
    // Bounded global ring buffer. Raised 200→500 so a run's lifecycle events (the
    // per-run timeline filters these by data.autoRunId) survive across more
    // concurrent runs before eviction. Follow-up: per-key retention for true durability.
    state.events = state.events.slice(0, 500);
    const handlers = getCodexEventHandlers();
    handlers.updateCodexSessionFromEvent(record);
    handlers.createCodexEvidenceRecord(record);
    persistStateSoon();
    return record;
  }

  return { appendEvent };
}
