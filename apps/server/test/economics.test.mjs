/*
 * Unit tests for the money-critical economics math: per-project ledger spend,
 * budget status (remaining / over), and the capLedgerEntries invariant. These
 * feed budgets/billing, so a summation or trimming bug silently mis-states spend
 * — the exact failure the capLedgerEntries comment warns about.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { capLedgerEntries, createM3Service } from "../src/services/m3.mjs";
import { capLifecycleAuditRecords } from "../src/services/retention.mjs";

const now = () => "2026-07-01T00:00:00.000Z";
const stub = {
  now,
  nextId: (p) => `${p}_test`,
  appendEvent: () => {},
  findAgent: () => null,
};

function serviceWith(ledgerEntries, budgets = []) {
  const state = {
    projects: [{ id: "projA", name: "A" }, { id: "projB", name: "B" }],
    budgets,
    ledgerEntries,
  };
  return { state, m3: createM3Service({ state, ...stub }) };
}

test("budgetStatusFor: sums finalized + estimated, skips voided/unknown/foreign", () => {
  const { m3 } = serviceWith([
    { projectId: "projA", amountUsd: 10, status: "finalized" }, // reported → finalized
    { projectId: "projA", amountUsd: 5, status: "estimated" }, // estimated
    { projectId: "projA", amountUsd: 100, status: "voided" }, // dropped
    { projectId: "projA", amountUsd: 0 }, // unknown (amount ≤ 0) → dropped
    { projectId: "projB", amountUsd: 50, status: "finalized" }, // other project
  ]);
  const s = m3.budgetStatusFor("projA");
  assert.equal(s.finalizedUsd, 10);
  assert.equal(s.estimatedUsd, 5);
  assert.equal(s.spentUsd, 15);
});

test("budgetStatusFor: remaining + over reflect the limit", () => {
  const entries = [{ projectId: "projA", amountUsd: 15, status: "finalized" }];
  const under = serviceWith(entries, [{ id: "b", projectId: "projA", limitUsd: 20, policy: "block" }]).m3.budgetStatusFor("projA");
  assert.equal(under.limitUsd, 20);
  assert.equal(under.remainingUsd, 5);
  assert.equal(under.over, false);
  assert.equal(under.exists, true);

  const over = serviceWith(entries, [{ id: "b", projectId: "projA", limitUsd: 12, policy: "block" }]).m3.budgetStatusFor("projA");
  assert.equal(over.remainingUsd, -3);
  assert.equal(over.over, true);
});

test("budgetStatusFor: no budget → exists false, no limit, not over", () => {
  const s = serviceWith([{ projectId: "projA", amountUsd: 999, status: "finalized" }]).m3.budgetStatusFor("projA");
  assert.equal(s.exists, false);
  assert.equal(s.limitUsd, null);
  assert.equal(s.over, false);
});

test("capLedgerEntries: bounds informational rows but NEVER drops a spend-bearing one", () => {
  const spend = Array.from({ length: 5 }, (_, i) => ({ id: `spend_${i}`, projectId: "projA", amountUsd: 10, status: "finalized" }));
  const info = Array.from({ length: 300 }, (_, i) => ({ id: `info_${i}`, projectId: "projA", amountUsd: 0 }));
  const state = { ledgerEntries: [...spend, ...info] };

  capLedgerEntries(state, 200);

  const kept = state.ledgerEntries;
  assert.equal(kept.filter((e) => e.id.startsWith("spend_")).length, 5, "all 5 spend entries survive");
  assert.equal(kept.filter((e) => e.id.startsWith("info_")).length, 200, "informational rows capped at 200");
  assert.equal(kept.length, 205);
});

test("capLedgerEntries: spend re-sum is unchanged after trimming (no silent under-count)", () => {
  const spend = [{ id: "s1", projectId: "projA", amountUsd: 40, status: "finalized" }];
  const info = Array.from({ length: 500 }, (_, i) => ({ id: `info_${i}`, projectId: "projA", amountUsd: 0 }));
  const { state, m3 } = serviceWith([...spend, ...info]);
  const before = m3.budgetStatusFor("projA").spentUsd;
  capLedgerEntries(state, 200);
  const after = m3.budgetStatusFor("projA").spentUsd;
  assert.equal(before, 40);
  assert.equal(after, 40, "trimming must not change spend");
});

test("capLifecycleAuditRecords: bounds routine rows but keeps recovery evidence", () => {
  const routine = Array.from({ length: 150 }, (_, i) => ({
    id: `routine_${i}`,
    operation: "health_check",
    status: i % 2 === 0 ? "queued" : "running",
    createdAt: new Date(Date.UTC(2026, 6, 1, 0, i, 0)).toISOString(),
  }));
  const state = {
    lifecycleAuditRecords: [
      ...routine.slice(0, 75),
      {
        id: "old_failed",
        operation: "update",
        status: "failed",
        result: { summary: "Desktop Bridge command failed.", rollbackAvailable: true },
        completedAt: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "old_rollback",
        operation: "rollback",
        status: "queued",
        rollback: { strategy: "reinstall_previous" },
        createdAt: "2026-06-01T00:01:00.000Z",
      },
      ...routine.slice(75),
    ],
  };

  capLifecycleAuditRecords(state, 100);

  assert.equal(state.lifecycleAuditRecords.filter((item) => item.id.startsWith("routine_")).length, 100);
  assert.ok(state.lifecycleAuditRecords.some((item) => item.id === "old_failed"), "failed result evidence survives");
  assert.ok(state.lifecycleAuditRecords.some((item) => item.id === "old_rollback"), "rollback evidence survives");
  assert.equal(state.lifecycleAuditRecords.length, 102);
});

test("teamBudgetStatuses: rolls per-project spend up to the owning team (M4)", () => {
  const state = {
    teams: [{ id: "team_a", name: "Alpha" }, { id: "team_b", name: "Beta" }],
    projects: [
      { id: "a1", ownerTeamId: "team_a" },
      { id: "a2", ownerTeamId: "team_a" },
      { id: "b1", ownerTeamId: "team_b" },
    ],
    budgets: [],
    ledgerEntries: [
      { projectId: "a1", amountUsd: 10, status: "finalized" },
      { projectId: "a2", amountUsd: 5, status: "finalized" },
      { projectId: "a2", amountUsd: 3, status: "estimated" },
      { projectId: "b1", amountUsd: 100, status: "finalized" },
    ],
  };
  const m3 = createM3Service({ state, ...stub });
  const rows = m3.teamBudgetStatuses();
  const alpha = rows.find((r) => r.teamId === "team_a");
  const beta = rows.find((r) => r.teamId === "team_b");
  assert.equal(alpha.teamName, "Alpha");
  assert.equal(alpha.projectCount, 2);
  assert.equal(alpha.finalizedUsd, 15);
  assert.equal(alpha.estimatedUsd, 3);
  assert.equal(alpha.spentUsd, 18, "team A = 10 + 5 + 3 across its two projects");
  assert.equal(beta.spentUsd, 100);
  assert.equal(beta.projectCount, 1);
});

function twoTeamMoneyState() {
  return {
    teams: [{ id: "team_a", name: "Alpha" }],
    projects: [
      { id: "a1", ownerTeamId: "team_a" },
      { id: "a2", ownerTeamId: "team_a" },
    ],
    budgets: [],
    ledgerEntries: [
      { projectId: "a1", amountUsd: 30, status: "finalized" },
      { projectId: "a2", amountUsd: 30, status: "finalized" },
    ],
  };
}

test("upsertBudget: creates a team pool (teamId XOR projectId enforced)", () => {
  const state = twoTeamMoneyState();
  const m3 = createM3Service({ state, ...stub });
  const pool = m3.upsertBudget({ teamId: "team_a", limitUsd: 50, policy: "block" });
  assert.equal(pool.teamId, "team_a");
  assert.equal(pool.limitUsd, 50);
  assert.throws(() => m3.upsertBudget({ limitUsd: 5 }), /exactly one of projectId or teamId/);
  assert.throws(() => m3.upsertBudget({ teamId: "team_a", projectId: "a1", limitUsd: 5 }), /exactly one/);
  assert.throws(() => m3.upsertBudget({ teamId: "team_nope", limitUsd: 5 }), /known teamId/);
});

test("teamBudgetStatuses: the pool contributes limit/remaining/over", () => {
  const state = twoTeamMoneyState();
  const m3 = createM3Service({ state, ...stub });
  m3.upsertBudget({ teamId: "team_a", limitUsd: 50, policy: "block" });
  const row = m3.teamBudgetStatusFor("team_a");
  assert.equal(row.exists, true);
  assert.equal(row.limitUsd, 50);
  assert.equal(row.spentUsd, 60, "30 + 30 across the team's projects");
  assert.equal(row.remainingUsd, -10);
  assert.equal(row.over, true);
});

test("teamBudgetStatuses: active project reservations reduce team headroom", () => {
  const state = twoTeamMoneyState();
  state.ledgerEntries = [];
  state.budgetReservations = [
    { id: "r1", projectId: "a1", amountUsd: 30, status: "active" },
    { id: "r2", projectId: "a2", amountUsd: 25, status: "active" },
    { id: "r3", projectId: "a2", amountUsd: 100, status: "released" },
  ];
  const m3 = createM3Service({ state, ...stub });
  m3.upsertBudget({ teamId: "team_a", limitUsd: 50, policy: "block" });
  const row = m3.teamBudgetStatusFor("team_a");
  assert.equal(row.spentUsd, 0);
  assert.equal(row.reservedUsd, 55);
  assert.equal(row.admissionUsd, 55);
  assert.equal(row.remainingUsd, -5);
  assert.equal(row.admissionOver, true);
});

test("budgetGateForProject: blocks when the team pool is over with a block policy", () => {
  const state = twoTeamMoneyState();
  const m3 = createM3Service({ state, ...stub });
  m3.upsertBudget({ teamId: "team_a", limitUsd: 50, policy: "block" });
  const gate = m3.budgetGateForProject("a1");
  assert.equal(gate.blocked, true);
  assert.match(gate.reason, /Team budget exceeded/);
});

test("budgetGateForProject: a warn-policy pool never blocks; under-limit never blocks", () => {
  const state = twoTeamMoneyState();
  const m3 = createM3Service({ state, ...stub });
  m3.upsertBudget({ teamId: "team_a", limitUsd: 50, policy: "warn" });
  assert.equal(m3.budgetGateForProject("a1").blocked, false, "warn policy is informational");
  m3.upsertBudget({ teamId: "team_a", limitUsd: 500, policy: "block" });
  assert.equal(m3.budgetGateForProject("a1").blocked, false, "under the limit");
});

test("budgetGateForProject: a project-level block budget also gates", () => {
  const state = twoTeamMoneyState();
  const m3 = createM3Service({ state, ...stub });
  m3.upsertBudget({ projectId: "a1", limitUsd: 10, policy: "block" });
  assert.equal(m3.budgetGateForProject("a1").blocked, true);
  assert.match(m3.budgetGateForProject("a1").reason, /Project budget exceeded/);
  assert.equal(m3.budgetGateForProject("a2").blocked, false, "sibling project unaffected");
});

// --- Codex token-based cost estimation (API-billed, reported no USD) ---
test("estimateCostUsdFromTokens: prices codex tokens, cheaper cached input, ignores unknown models", async () => {
  const { estimateCostUsdFromTokens } = await import("../src/services/m3.mjs");
  // Default gpt-5.3-codex rates: input 1.75, cachedInput 0.175, output 14 (USD/1M).
  // (11285-8576)*1.75 + 8576*0.175 + 49*14, all / 1e6.
  const usd = estimateCostUsdFromTokens({ model: "codex", inputTokens: 11285, cachedInputTokens: 8576, outputTokens: 49 });
  const expected = ((11285 - 8576) * 1.75 + 8576 * 0.175 + 49 * 14) / 1_000_000;
  assert.ok(Math.abs(usd - expected) < 1e-9, `estimate ${usd} !== ${expected}`);
  assert.ok(usd > 0);
  // Cached input is discounted: all-cached input costs less than if it were fresh.
  const allCached = estimateCostUsdFromTokens({ model: "codex", inputTokens: 1000, cachedInputTokens: 1000, outputTokens: 0 });
  const noneCached = estimateCostUsdFromTokens({ model: "codex", inputTokens: 1000, cachedInputTokens: 0, outputTokens: 0 });
  assert.ok(allCached < noneCached, "cached input should be cheaper");
  // No rate table for an unknown model → unpriceable (0), so it falls back to unmetered.
  assert.equal(estimateCostUsdFromTokens({ model: "mystery", inputTokens: 5000, outputTokens: 100 }), 0);
  assert.equal(estimateCostUsdFromTokens({ inputTokens: 5000 }), 0);
});
