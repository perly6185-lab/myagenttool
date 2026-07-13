import assert from "node:assert/strict";
import { test } from "node:test";

import { createM3Service } from "../src/services/m3.mjs";

const now = () => "2026-07-13T00:00:00.000Z";

function harness() {
  const state = { invocationRounds: [], aiUsageRecords: [], quotaPolicies: [], quotaDecisionRecords: [], ledgerEntries: [] };
  const alerts = [];
  const service = createM3Service({
    state, now,
    nextId: (p) => `${p}_${state.aiUsageRecords.length}`,
    appendEvent: () => {},
    findAgent: () => null,
    dispatchAlert: (alert) => alerts.push(alert),
  });
  return { state, alerts, service };
}

const opusRound = (invocationId, inputTokens) => ({
  invocationId, provider: "anthropic", model: "claude-opus-4-8",
  inputTokens, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, durationMs: 10,
});

test("a high-cost run fires a cost_anomaly alert (absolute threshold)", () => {
  const { state, alerts, service } = harness();
  state.invocationRounds = [opusRound("inv_1", 1_000_000)]; // $15 >= $5 default
  service.recordInvocationRoundUsage({ invocation: { id: "inv_1", requestedBy: "usr_a", status: "succeeded" } });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "cost_anomaly");
  assert.equal(alerts[0].severity, "high");
  assert.equal(alerts[0].data.reason, "absolute_threshold");
  assert.equal(alerts[0].data.costUsd, 15);
});

test("a normal-cost run with no history does not fire", () => {
  const { state, alerts, service } = harness();
  state.invocationRounds = [opusRound("inv_1", 100_000)]; // $1.5 < $5, no spike
  service.recordInvocationRoundUsage({ invocation: { id: "inv_1", requestedBy: "usr_a", status: "succeeded" } });
  assert.equal(alerts.length, 0);
});

test("an unpriced run never fires", () => {
  const { state, alerts, service } = harness();
  state.invocationRounds = [{ ...opusRound("inv_1", 1_000_000), model: "mystery-model" }];
  service.recordInvocationRoundUsage({ invocation: { id: "inv_1", requestedBy: "usr_a", status: "succeeded" } });
  assert.equal(alerts.length, 0);
});

test("a spike vs the subject's recent runs fires even under the absolute threshold", () => {
  const prev = process.env.COST_ANOMALY_USD_PER_RUN;
  process.env.COST_ANOMALY_USD_PER_RUN = "1000"; // disable the absolute trigger
  try {
    const { state, alerts, service } = harness();
    state.aiUsageRecords = [
      { id: "aiu_p1", userId: "usr_a", estimatedCost: "1" },
      { id: "aiu_p2", userId: "usr_a", estimatedCost: "1" },
    ];
    state.invocationRounds = [opusRound("inv_1", 300_000)]; // $4.5 >= 4 x $1 avg
    service.recordInvocationRoundUsage({ invocation: { id: "inv_1", requestedBy: "usr_a", status: "succeeded" } });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].data.reason, "spike_vs_recent");
  } finally {
    if (prev === undefined) delete process.env.COST_ANOMALY_USD_PER_RUN;
    else process.env.COST_ANOMALY_USD_PER_RUN = prev;
  }
});
