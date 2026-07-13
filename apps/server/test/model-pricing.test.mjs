import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createM3Service,
  estimateCostUsdFromTokens,
  modelPrices,
  priceForModel,
} from "../src/services/m3.mjs";

test("priceForModel matches the longest model prefix, else null", () => {
  assert.equal(priceForModel("claude-opus-4-8")?.model, "claude-opus");
  assert.equal(priceForModel("claude-sonnet-5")?.model, "claude-sonnet");
  assert.equal(priceForModel("claude-haiku-4-5")?.model, "claude-haiku");
  assert.equal(priceForModel("gpt-5.3")?.model, "gpt");
  assert.equal(priceForModel("codex")?.model, "codex");
  assert.equal(priceForModel("mistral-large"), null, "unmatched model is not priced");
  assert.equal(priceForModel(""), null);
  assert.equal(priceForModel(null), null);
});

test("estimateCostUsdFromTokens prices from measured tokens; unpriced stays 0", () => {
  // claude-opus default: input $15 / cached $1.5 / output $75 per MTok.
  assert.equal(estimateCostUsdFromTokens({ model: "claude-opus-4-8", inputTokens: 1_000_000 }), 15);
  assert.equal(estimateCostUsdFromTokens({ model: "claude-opus-4-8", outputTokens: 1_000_000 }), 75);
  // Cached input is billed at the cheaper cached rate, not the full input rate.
  assert.equal(
    estimateCostUsdFromTokens({ model: "claude-opus-4-8", inputTokens: 1_000_000, cachedInputTokens: 200_000 }),
    (800_000 * 15 + 200_000 * 1.5) / 1_000_000,
  );
  // codex still prices (backward compatible with the prior codex-only table).
  assert.equal(estimateCostUsdFromTokens({ model: "codex", inputTokens: 1_000_000 }), 1.75);
  // Unmatched model → 0 (never a guessed price).
  assert.equal(estimateCostUsdFromTokens({ model: "mystery-model", inputTokens: 1_000_000 }), 0);
});

test("modelPrices exposes a read-only table covering the seeded families", () => {
  const models = modelPrices().map((p) => p.model);
  for (const family of ["claude-opus", "claude-sonnet", "claude-haiku", "gpt", "codex"]) {
    assert.ok(models.includes(family), `missing ${family}`);
  }
  const opus = modelPrices().find((p) => p.model === "claude-opus");
  assert.equal(opus.currency, "USD");
  assert.match(opus.id, /^prc_/);
  assert.equal(opus.source, "default");
});

// --- integration: the rounds-derived usage record now carries a real cost ----

const now = () => "2026-07-13T00:00:00.000Z";
const stub = { now, nextId: (p) => `${p}_t`, appendEvent: () => {}, findAgent: () => null };

function m3With(rounds) {
  const state = { invocationRounds: rounds, aiUsageRecords: [], quotaDecisionRecords: [], quotaPolicies: [], ledgerEntries: [] };
  return createM3Service({ state, ...stub });
}

test("recordInvocationRoundUsage prices a Claude run from its tokens", () => {
  const m3 = m3With([
    { invocationId: "inv_1", provider: "anthropic", model: "claude-opus-4-8", inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, durationMs: 10 },
  ]);
  const rec = m3.recordInvocationRoundUsage({ invocation: { id: "inv_1", status: "succeeded" } });
  assert.equal(rec.estimatedCost, "15");
});

test("recordInvocationRoundUsage leaves an unpriced model's cost unknown", () => {
  const m3 = m3With([
    { invocationId: "inv_1", provider: "x", model: "mystery-model", inputTokens: 5000, outputTokens: 1000, cachedTokens: 0, reasoningTokens: 0, durationMs: 10 },
  ]);
  const rec = m3.recordInvocationRoundUsage({ invocation: { id: "inv_1", status: "succeeded" } });
  assert.equal(rec.estimatedCost, "unknown");
});
