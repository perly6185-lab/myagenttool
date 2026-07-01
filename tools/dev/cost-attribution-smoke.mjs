// Regression smoke for Claude cost attribution (#190 + review fix #192):
// an agent-reported run cost becomes a finalized ledger entry that counts toward
// the budget, an unknown cost creates nothing, and spend survives past the
// 200-entry ledger cap (the under-count fix).
import assert from "node:assert/strict";
import { createM3Service } from "../../apps/server/src/services/m3.mjs";

let passed = 0;
const ok = (msg) => { passed += 1; console.log(`  ok - ${msg}`); };

function service(state) {
  let n = 0;
  return createM3Service({ state, now: () => new Date().toISOString(), nextId: (p) => `${p}_${++n}`, appendEvent: () => {} });
}
const baseState = () => ({
  device: {}, projects: [{ id: "p1" }], currentProjectId: "p1", ledgerEntries: [],
  budgets: [{ projectId: "p1", limitUsd: 100, policy: "warn", currency: "USD" }],
  quotaDecisionRecords: [], aiUsageRecords: [], quotaPolicies: [],
});
const invocation = (id) => ({ id, projectId: "p1", input: {} });

// A. Reported cost => finalized ledger entry counting toward the budget.
{
  const state = baseState();
  const m3 = service(state);
  const entry = m3.recordInvocationLedgerEntry({
    invocation: invocation("inv_1"),
    cost: { model: "claude-opus", amountUsd: 0.0123, amountSource: "reported", billable: true, inputTokens: 100, outputTokens: 200 },
    agent: null,
  });
  assert.ok(entry, "entry created for a reported cost");
  assert.equal(entry.amountSource, "reported");
  assert.equal(entry.status, "finalized");
  assert.equal(entry.projectId, "p1");
  const bs = m3.budgetStatusFor("p1");
  assert.ok(Math.abs(bs.spentUsd - 0.0123) < 1e-9, "budget spend reflects the reported cost");
  ok("reported cost -> finalized ledger entry + budget spend");
}

// B. Unknown cost creates nothing.
{
  const state = baseState();
  const m3 = service(state);
  const entry = m3.recordInvocationLedgerEntry({
    invocation: invocation("inv_2"),
    cost: { model: "codex", billable: true, unknown: true },
    agent: null,
  });
  assert.equal(entry, null, "no entry for an unknown cost");
  assert.equal(state.ledgerEntries.length, 0);
  ok("unknown cost -> no ledger entry");
}

// C. Spend survives past the 200-entry ledger cap (#192).
{
  const state = baseState();
  const m3 = service(state);
  for (let i = 0; i < 250; i++) {
    m3.recordInvocationLedgerEntry({
      invocation: invocation(`inv_${i}`),
      cost: { model: "claude", amountUsd: 0.01, billable: true },
      agent: null,
    });
  }
  const spend = m3.budgetStatusFor("p1").spentUsd;
  assert.ok(Math.abs(spend - 2.5) < 1e-6, `250 x $0.01 = $2.50 preserved past the cap, got ${spend}`);
  ok("budget spend preserved across 250 entries (not capped at 200)");
}

console.log(`\ncost-attribution-smoke: ${passed} checks passed`);
