import assert from "node:assert/strict";
import { test } from "node:test";

import { createM3Service } from "../src/services/m3.mjs";

const now = () => "2026-07-13T00:00:00.000Z";

function m3() {
  const state = { quotaPolicies: [], invocationRounds: [], aiUsageRecords: [], ledgerEntries: [], quotaDecisionRecords: [] };
  const events = [];
  const service = createM3Service({ state, now, nextId: (p) => `${p}_${state.quotaPolicies.length}_${Math.max(state.aiUsageRecords.length, 0)}`, appendEvent: (e) => events.push(e), findAgent: () => null });
  return { state, events, service };
}

test("createQuotaPolicy defaults to the request meter but accepts token/usd meters", () => {
  const { service } = m3();
  assert.equal(service.createQuotaPolicy({ subjectId: "usr_b" }).meter, "requests");
  const usd = service.createQuotaPolicy({ subjectId: "usr_a", meter: "usd", enforcement: "warn" });
  assert.equal(usd.meter, "usd");
  assert.equal(usd.enforcement, "warn");
  assert.equal(service.createQuotaPolicy({ subjectId: "u", meter: "bogus" }).meter, "requests", "unknown meter falls back");
});

test("a completed BYOK run accrues real USD against the subject's usd policy", () => {
  const { state, service } = m3();
  const policy = service.createQuotaPolicy({ subjectId: "usr_a", meter: "usd", limit: 100, provider: "any" });
  // claude-opus at $15/MTok input; 1M input tokens -> $15.
  state.invocationRounds = [
    { invocationId: "inv_1", provider: "anthropic", model: "claude-opus-4-8", inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, durationMs: 10 },
  ];
  service.recordInvocationRoundUsage({ invocation: { id: "inv_1", requestedBy: "usr_a", status: "succeeded" } });
  assert.equal(policy.used, 15, "the run's measured cost is charged to the window");
});

test("a token-metered policy accrues total tokens", () => {
  const { state, service } = m3();
  const policy = service.createQuotaPolicy({ subjectId: "usr_a", meter: "total_tokens", limit: 1_000_000, provider: "any" });
  state.invocationRounds = [
    { invocationId: "inv_1", provider: "anthropic", model: "claude-opus-4-8", inputTokens: 300, outputTokens: 120, cachedTokens: 0, reasoningTokens: 0, durationMs: 10 },
  ];
  service.recordInvocationRoundUsage({ invocation: { id: "inv_1", requestedBy: "usr_a", status: "succeeded" } });
  assert.equal(policy.used, 420);
});

test("checkUsageQuota blocks a spent block-policy, warns a spent warn-policy, allows under limit", () => {
  const { service } = m3();
  const p = service.createQuotaPolicy({ subjectId: "usr_a", meter: "usd", limit: 10, used: 12, enforcement: "block" });
  const blocked = service.checkUsageQuota({ subjectId: "usr_a" });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.allowed, false);

  p.enforcement = "warn";
  const warned = service.checkUsageQuota({ subjectId: "usr_a" });
  assert.equal(warned.blocked, false);
  assert.equal(warned.allowed, true);
  assert.equal(warned.warnOnly, true);

  p.used = 5;
  assert.equal(service.checkUsageQuota({ subjectId: "usr_a" }).allowed, true);
});

test("a request-metered policy does not accrue token/usd usage (backward compatible)", () => {
  const { state, service } = m3();
  const policy = service.createQuotaPolicy({ subjectId: "usr_a", meter: "requests", limit: 100 });
  state.invocationRounds = [
    { invocationId: "inv_1", provider: "anthropic", model: "claude-opus-4-8", inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, durationMs: 10 },
  ];
  service.recordInvocationRoundUsage({ invocation: { id: "inv_1", requestedBy: "usr_a", status: "succeeded" } });
  assert.equal(policy.used, 0, "request meter is not charged by the metered accrual path");
  // A foreign subject's policy is never charged.
  assert.equal(service.checkUsageQuota({ subjectId: "usr_other" }).allowed, true);
});
