export function createEventLogRuntime({
  state,
  now,
  nextId,
  persistStateSoon,
  getCodexEventHandlers,
}) {
  function appendEvent(event) {
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
