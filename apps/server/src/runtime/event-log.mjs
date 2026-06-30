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
    state.events = state.events.slice(0, 200);
    const handlers = getCodexEventHandlers();
    handlers.updateCodexSessionFromEvent(record);
    handlers.createCodexEvidenceRecord(record);
    persistStateSoon();
    return record;
  }

  return { appendEvent };
}
