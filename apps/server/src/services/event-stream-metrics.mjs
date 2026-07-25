export function ensureEventStreamMetrics(state, teamId = "team_local") {
  state.eventStreamMetrics ??= { byTeam: {} };
  state.eventStreamMetrics.byTeam[teamId] ??= {
    activeConnections: 0,
    connections: 0,
    disconnects: 0,
    reconnects: 0,
    eventsSent: 0,
    eventLatencyTotalMs: 0,
    eventLatencyMaxMs: 0,
  };
  return state.eventStreamMetrics.byTeam[teamId];
}

export function eventStreamSummary(metrics) {
  const events = metrics?.eventsSent ?? 0;
  const connections = metrics?.connections ?? 0;
  return {
    ...metrics,
    disconnectRate: connections ? Math.round(((metrics.disconnects ?? 0) / connections) * 10_000) / 100 : 0,
    averageEventLatencyMs: events ? Math.round((metrics.eventLatencyTotalMs / events) * 100) / 100 : null,
  };
}

/** Hot events are newest-first; SSE replay must be oldest-first. */
export function eventsAfter(events, lastEventId) {
  if (!lastEventId) return [];
  const cursor = events.findIndex((event) => event.id === lastEventId);
  if (cursor <= 0) return [];
  return events.slice(0, cursor).reverse();
}
