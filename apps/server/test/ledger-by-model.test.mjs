/*
 * cost_by_model — the ledger stamps the model on every row, so ledgerSummary
 * rolls spend up by model alongside byAgent/byProject/byCostOwner. This answers
 * "which model is the money going to" without re-deriving it from per-round
 * telemetry (AI Agent observability follow-up).
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createServerState } from "../src/runtime/state-factory.mjs";
import { createM3Service } from "../src/services/m3.mjs";

const now = () => "2026-07-16T00:00:00.000Z";
const PROJECT_DIR = mkdtempSync(join(tmpdir(), "by-model-"));

function m3For(state) {
  let id = 0;
  return createM3Service({ state, now, nextId: (p) => `${p}_${++id}`, appendEvent: () => {}, findAgent: () => null });
}

test("ledgerSummary rolls spend up by model", () => {
  const { state } = createServerState({ defaultProjectPath: PROJECT_DIR, now });
  state.projects = [{ id: "proj_a", name: "A", path: PROJECT_DIR, ownerTeamId: "team_a" }];
  const m3 = m3For(state);
  const invocation = { id: "inv_1", createdAt: now(), agentId: "agt_1", requestedBy: "usr_1", projectId: "proj_a" };

  m3.recordInvocationLedgerEntry({ invocation, cost: { amountUsd: 3, currency: "USD", model: "claude-opus-4-8", billable: true } });
  m3.recordInvocationLedgerEntry({ invocation, cost: { amountUsd: 2, currency: "USD", model: "claude-opus-4-8", billable: true } });
  m3.recordInvocationLedgerEntry({ invocation, cost: { amountUsd: 1, currency: "USD", model: "claude-haiku-4-5", billable: true } });

  const summary = m3.ledgerSummary();
  assert.ok(Array.isArray(summary.byModel), "byModel is present");
  // Sorted by entry count desc: opus (2 entries) before haiku (1 entry).
  assert.deepEqual(summary.byModel.map((row) => row.model), ["claude-opus-4-8", "claude-haiku-4-5"]);
  const opus = summary.byModel.find((row) => row.model === "claude-opus-4-8");
  assert.equal(opus.entries, 2);
  assert.equal(opus.knownCostUsd, 5, "opus spend is summed across its rows");
  const haiku = summary.byModel.find((row) => row.model === "claude-haiku-4-5");
  assert.equal(haiku.knownCostUsd, 1);
});

test("byModel keys on the explicit model, not the provider (AI-usage chargeback rows)", () => {
  const { state } = createServerState({ defaultProjectPath: PROJECT_DIR, now });
  const m3 = m3For(state);
  // An AI-usage ledger row: counterparty is the PROVIDER ("openai"), model is "gpt-4".
  // byModel must bucket by the model, not pollute the dimension with "openai".
  state.ledgerEntries = [
    { id: "led_1", model: "gpt-4", counterparty: "openai", provider: "openai", amountUsd: 3, status: "finalized", billable: true },
    { id: "led_2", model: "gpt-4", counterparty: "openai", provider: "openai", amountUsd: 2, status: "finalized", billable: true },
  ];
  const summary = m3.ledgerSummary();
  assert.deepEqual(summary.byModel.map((row) => row.model), ["gpt-4"], "bucketed by model, not provider");
  assert.equal(summary.byModel[0].knownCostUsd, 5);
});

test("voided/cancelled entries are counted but excluded from totals and every rollup", () => {
  const { state } = createServerState({ defaultProjectPath: PROJECT_DIR, now });
  const m3 = m3For(state);
  state.ledgerEntries = [
    { id: "led_ok", model: "gpt-4", counterparty: "gpt-4", autoRunId: "aur_1", amountUsd: 5, status: "finalized", billable: true },
    { id: "led_void", model: "gpt-4", counterparty: "gpt-4", autoRunId: "aur_1", amountUsd: 9, status: "voided", billable: true },
    { id: "led_cancel", model: "gpt-4", counterparty: "gpt-4", autoRunId: "aur_1", amountUsd: 7, status: "cancelled", billable: true },
  ];
  const summary = m3.ledgerSummary();
  assert.equal(summary.voidedEntries, 2, "both voided + cancelled are counted");
  assert.equal(summary.totalCostUsd, 5, "only the finalized entry contributes to the total");
  assert.equal(summary.byModel.find((r) => r.model === "gpt-4").knownCostUsd, 5, "voided spend not in byModel");
  assert.equal(summary.byAutoRun.find((r) => r.autoRunId === "aur_1").knownCostUsd, 5, "voided spend not in agent_run_cost_total");
  assert.equal(summary.billableEntries, 1, "a voided entry is not billable spend");
});

test("ledgerSummary rolls a whole auto-run's spend up (agent_run_cost_total)", () => {
  const { state } = createServerState({ defaultProjectPath: PROJECT_DIR, now });
  state.projects = [{ id: "proj_a", name: "A", path: PROJECT_DIR, ownerTeamId: "team_a" }];
  const m3 = m3For(state);
  // Two invocations of the SAME auto-run (develop + a repair), plus one manual
  // invocation with no autoRunId that must NOT land in any run's total.
  const inRun = (id) => ({ id, createdAt: now(), agentId: "agt_1", requestedBy: "usr_1", input: { metadata: { autoRunId: "aur_42", projectId: "proj_a" } } });
  m3.recordInvocationLedgerEntry({ invocation: inRun("inv_d"), cost: { amountUsd: 4, currency: "USD", model: "m", billable: true } });
  m3.recordInvocationLedgerEntry({ invocation: inRun("inv_r"), cost: { amountUsd: 2, currency: "USD", model: "m", billable: true } });
  m3.recordInvocationLedgerEntry({ invocation: { id: "inv_manual", createdAt: now(), requestedBy: "usr_1", input: { metadata: { projectId: "proj_a" } } }, cost: { amountUsd: 9, currency: "USD", model: "m", billable: true } });

  const summary = m3.ledgerSummary();
  assert.equal(summary.byAutoRun.length, 1, "manual spend (no autoRunId) is not a run bucket");
  const run = summary.byAutoRun[0];
  assert.equal(run.autoRunId, "aur_42");
  assert.equal(run.entries, 2);
  assert.equal(run.knownCostUsd, 6, "develop + repair summed as the run's total");
});
