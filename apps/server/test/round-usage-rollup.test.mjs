import assert from "node:assert/strict";
import { test } from "node:test";

import { createM3Service } from "../src/services/m3.mjs";

const now = () => "2026-07-13T00:00:00.000Z";
const stub = { now, nextId: (p) => `${p}_test`, appendEvent: () => {}, findAgent: () => null };

function m3With(rounds) {
  const state = {
    invocationRounds: rounds,
    aiUsageRecords: [],
    quotaDecisionRecords: [],
    quotaPolicies: [],
    ledgerEntries: [],
  };
  return { state, m3: createM3Service({ state, ...stub }) };
}

const succeeded = { id: "inv_1", requestedBy: "usr_a", agentId: "agt_1", status: "succeeded", delivery: {} };

test("recordInvocationRoundUsage sums this invocation's rounds into one authoritative record", () => {
  // Newest-first (unshift order), plus a foreign invocation's round that must be ignored.
  const rounds = [
    { invocationId: "inv_1", provider: "anthropic", model: "claude-opus-4-8", inputTokens: 20, outputTokens: 8, cachedTokens: 4, reasoningTokens: 0, durationMs: 3000 },
    { invocationId: "inv_1", provider: "anthropic", model: "claude-opus-4-8", inputTokens: 100, outputTokens: 50, cachedTokens: 25, reasoningTokens: 1, durationMs: 5000 },
    { invocationId: "inv_other", provider: "openai", model: "codex", inputTokens: 999, outputTokens: 999, cachedTokens: 0, reasoningTokens: 0, durationMs: 1000 },
  ];
  const { state, m3 } = m3With(rounds);
  const rec = m3.recordInvocationRoundUsage({ invocation: succeeded, ledgerEntryIds: ["led_x"] });

  assert.ok(rec);
  assert.equal(rec.derivedFrom, "rounds");
  assert.equal(rec.roundCount, 2);
  assert.equal(rec.inputTokens, 120);
  assert.equal(rec.outputTokens, 58);
  assert.equal(rec.cachedTokens, 29);
  assert.equal(rec.reasoningTokens, 1);
  assert.equal(rec.latencyMs, 8000);
  assert.equal(rec.provider, "anthropic");
  assert.equal(rec.model, "claude-opus-4-8");
  assert.equal(rec.status, "succeeded");
  assert.deepEqual(rec.ledgerEntryIds, ["led_x"]);
  assert.equal(rec.invocationId, "inv_1");

  assert.equal(state.aiUsageRecords.length, 1);
  // The invocation's rounds link back to the aggregate; the foreign round does not.
  assert.equal(state.invocationRounds[0].usageRecordId, rec.id);
  assert.equal(state.invocationRounds[2].usageRecordId, undefined);
});

test("round usage inherits project, team, and auto-run attribution from invocation metadata", () => {
  const { state, m3 } = m3With([
    { invocationId: "inv_1", provider: "openai", model: "codex", inputTokens: 10, outputTokens: 2, durationMs: 10 },
  ]);
  state.projects = [{ id: "prj_1", ownerTeamId: "team_1" }];
  const rec = m3.recordInvocationRoundUsage({
    invocation: {
      ...succeeded,
      input: { metadata: { projectId: "prj_1", autoRunId: "aur_1" } },
    },
  });
  assert.equal(rec.projectId, "prj_1");
  assert.equal(rec.teamId, "team_1");
  assert.equal(rec.autoRunId, "aur_1");
});

test("an invocation with no rounds produces no usage record", () => {
  const { state, m3 } = m3With([]);
  const rec = m3.recordInvocationRoundUsage({ invocation: succeeded });
  assert.equal(rec, null);
  assert.equal(state.aiUsageRecords.length, 0);
});

test("a failed invocation maps to a failed usage status; missing durations give null latency", () => {
  const rounds = [
    { invocationId: "inv_1", provider: "anthropic", model: "m", inputTokens: 1, outputTokens: 1, cachedTokens: 0, reasoningTokens: 0, durationMs: null },
  ];
  const { m3 } = m3With(rounds);
  const rec = m3.recordInvocationRoundUsage({ invocation: { ...succeeded, status: "failed" } });
  assert.equal(rec.status, "failed");
  assert.equal(rec.latencyMs, null);
});

test("a model named on a later round wins over an earlier 'unknown' placeholder", () => {
  const rounds = [
    { invocationId: "inv_1", provider: "anthropic", model: "claude-opus-4-8", inputTokens: 1, outputTokens: 1, cachedTokens: 0, reasoningTokens: 0, durationMs: 10 },
    { invocationId: "inv_1", provider: "unknown", model: "unknown", inputTokens: 1, outputTokens: 1, cachedTokens: 0, reasoningTokens: 0, durationMs: 10 },
  ];
  const { m3 } = m3With(rounds);
  const rec = m3.recordInvocationRoundUsage({ invocation: succeeded });
  assert.equal(rec.model, "claude-opus-4-8");
  assert.equal(rec.provider, "anthropic");
});
