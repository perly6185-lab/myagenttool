import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeWebPerformanceMetric, summarizeWebPerformance } from "../src/services/web-performance.mjs";
import { handleControlPlaneRoutes } from "../src/routes/control-plane.mjs";

test("normalizes and summarizes web performance by version", () => {
  assert.equal(normalizeWebPerformanceMetric({ name: "unknown", value: 1 }), null);
  const rows = [
    { name: "LCP", value: 2_000, rating: "good", version: "1.0" },
    { name: "LCP", value: 4_500, rating: "poor", version: "1.0" },
    { name: "LCP", value: 1_500, rating: "good", version: "2.0" },
  ];
  const summary = summarizeWebPerformance(rows, { version: "1.0" });
  assert.equal(summary.sampleCount, 2);
  assert.equal(summary.metrics.LCP.p75, 4_500);
  assert.equal(summary.metrics.LCP.poorRate, 50);
  assert.equal(summary.metrics.LCP.alerting, true);
});

test("accepts metrics and exposes only the actor team trend", async () => {
  const state = { webPerformanceMetrics: [
    { id: "foreign", name: "FCP", value: 900, rating: "good", version: "v1", teamId: "team_b" },
  ] };
  const responses = [];
  let sequence = 0;
  const common = {
    res: {},
    sendJson: (_res, status, payload) => responses.push({ status, payload }),
    readJson: async () => ({ name: "LCP", value: 2_400, rating: "good", path: "/?section=tasks", version: "v1" }),
    state,
    actor: { userId: "usr_a", teamId: "team_a", role: "operator" },
    now: () => "2026-07-24T00:00:00.000Z",
    nextId: () => `wpm_${++sequence}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
  };

  await handleControlPlaneRoutes({
    ...common,
    req: { method: "POST" },
    url: new URL("http://local/api/observability/web-performance"),
  });
  assert.equal(responses.at(-1).status, 202);
  assert.equal(state.webPerformanceMetrics.at(-1).teamId, "team_a");

  await handleControlPlaneRoutes({
    ...common,
    req: { method: "GET" },
    url: new URL("http://local/api/observability/web-performance?version=v1"),
  });
  assert.equal(responses.at(-1).status, 200);
  assert.equal(responses.at(-1).payload.sampleCount, 1);
  assert.equal(responses.at(-1).payload.recent.some((row) => row.id === "foreign"), false);
});
