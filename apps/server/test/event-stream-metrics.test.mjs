import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureEventStreamMetrics, eventStreamSummary, eventsAfter } from "../src/services/event-stream-metrics.mjs";

test("event stream metrics are isolated by team and derive reliability", () => {
  const state = {};
  const first = ensureEventStreamMetrics(state, "team_a");
  first.connections = 4;
  first.disconnects = 1;
  first.eventsSent = 2;
  first.eventLatencyTotalMs = 60;
  first.eventLatencyMaxMs = 40;
  ensureEventStreamMetrics(state, "team_b").connections = 9;

  assert.deepEqual(eventStreamSummary(first), {
    ...first,
    disconnectRate: 25,
    averageEventLatencyMs: 30,
  });
  assert.equal(state.eventStreamMetrics.byTeam.team_b.connections, 9);
});

test("replays only events after the SSE cursor in chronological order", () => {
  const events = [{ id: "evt_3" }, { id: "evt_2" }, { id: "evt_1" }];
  assert.deepEqual(eventsAfter(events, "evt_1").map((event) => event.id), ["evt_2", "evt_3"]);
  assert.deepEqual(eventsAfter(events, "evt_3"), []);
  assert.deepEqual(eventsAfter(events, "missing"), []);
});
