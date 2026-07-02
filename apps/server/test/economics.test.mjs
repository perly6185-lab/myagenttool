/*
 * Unit tests for the money-critical economics math: per-project ledger spend,
 * budget status (remaining / over), and the capLedgerEntries invariant. These
 * feed budgets/billing, so a summation or trimming bug silently mis-states spend
 * — the exact failure the capLedgerEntries comment warns about.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { capLedgerEntries, createM3Service } from "../src/services/m3.mjs";

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
