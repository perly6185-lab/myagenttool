/*
 * #890.1 tail — budget reservations on the manual/API invocation-creation path.
 *
 * 890.1 held budget at auto-run admission; a plain createInvocation used only the
 * finalized-spend gate, so two manual/API runs starting near a block limit could
 * both pass. These tests wire the real m3 reserveBudget into the creation runtime
 * and prove: a concurrent manual accept is refused, an auto-run-initiated run is
 * NOT double-held, the hold releases on completion, and the estimate-0 default is
 * behaviour-preserving.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createInvocationCompletionRuntime } from "../src/services/invocations/completion.mjs";
import { createInvocationCreationRuntime } from "../src/services/invocations/creation.mjs";
import { createM3Service } from "../src/services/m3.mjs";

const now = () => "2026-07-14T00:00:00.000Z";
const TERMINAL = new Set(["succeeded", "failed", "timed_out", "cancelled", "rejected", "expired"]);
const isTerminal = (s) => TERMINAL.has(s);

const agent = {
  id: "agt_1",
  name: "Coder",
  adapter: { type: "cli" },
  location: { type: "local_device", deviceId: "dev_1" },
  economics: { model: "external_metered", costOwner: "usr_local", currency: "USD", budgetPoolId: null },
};

function harness({ reservationEstimateUsd = 0, limitUsd = 10, policy = "block" } = {}) {
  let n = 0;
  const nextId = (p) => `${p}_${++n}`;
  const state = {
    invocations: [], worktrees: [], traces: [], spans: [], events: [],
    policyDecisionRecords: [], auditSummaries: [], refusals: [], agentSkills: [],
    budgets: [], budgetReservations: [], ledgerEntries: [], agentUsageSummaries: [],
    projects: [{ id: "prj_1", name: "P", path: "/x", ownerTeamId: "team_a" }],
    teams: [{ id: "team_a" }], users: [{ id: "usr_local", teamId: "team_a" }],
    device: { id: "dev_1" },
    autoRunSettings: { reservationEstimateUsd },
    currentProjectId: "prj_1",
  };
  const appendEvent = (event) => state.events.unshift({ id: nextId("evt"), createdAt: now(), ...event });
  const m3 = createM3Service({ state, now, nextId, appendEvent, findAgent: () => agent });
  m3.upsertBudget({ projectId: "prj_1", limitUsd, policy });

  const creation = createInvocationCreationRuntime({
    state, now, nextId, appendEvent, persistStateSoon: () => {}, persistStateNow: () => {},
    defaultAgent: () => agent,
    currentProject: () => state.projects[0],
    worktreeForProject: () => null,
    normalizeCodexApprovalMode: () => null,
    normalizeCodexSessionMode: () => null,
    normalizeCodexWorkspacePolicy: () => null,
    createManagedCodexWorkspace: () => null,
    createManagedCodexSession: () => null,
    resolveResumeCodexSessionId: () => null,
    evaluateInvocationPolicy: () => ({ decision: "allow", reason: "ok", riskLevel: "low", riskTags: [] }),
    enforcePlatformAiQuota: () => null,
    createPolicyDecisionRecord: (invocation) => {
      const record = { id: `pdr_${invocation.id}`, decision: "allowed", reason: "ok" };
      state.policyDecisionRecords.push(record);
      return record;
    },
    createApprovalRequest: () => ({ id: "apr_1" }),
    completeRootSpan: () => {},
    createAuditSummary: (invocation, summary) => ({ id: `aud_${invocation.id}`, invocationId: invocation.id, summary }),
    recordAgentUsage: () => {},
    budgetGateForProject: m3.budgetGateForProject,
    reserveBudget: m3.reserveBudget,
  });

  const completion = createInvocationCompletionRuntime({
    state, now, appendEvent, persistStateSoon: () => {}, persistStateNow: () => {},
    namespace: "test", protocolVersion: "0.0.0",
    findAgent: () => agent,
    findInvocation: (id) => state.invocations.find((i) => i.id === id) ?? null,
    closeCodexSession: () => {},
    isTerminal,
    recordInvocationLedgerEntry: m3.recordInvocationLedgerEntry,
    releaseReservationsForInvocation: m3.releaseReservationsForInvocation,
  });

  return { state, m3, creation, completion };
}

test("#890.1-tail two concurrent manual accepts can't jointly exceed a block budget", () => {
  const h = harness({ reservationEstimateUsd: 6, limitUsd: 10 });
  const first = h.creation.createInvocation("t", agent, { actor: { userId: "usr_local" } });
  assert.notEqual(first.status, "rejected", "the first run is accepted and holds $6");
  assert.equal(h.m3.budgetStatusFor("prj_1").reservedUsd, 6);

  const second = h.creation.createInvocation("t", agent, { actor: { userId: "usr_local" } });
  assert.equal(second.status, "rejected", "the second run would reach $12 > $10 → refused at admission");
  assert(h.state.refusals.some((r) => r.subject?.id === second.id && r.code === "over_budget"), "refusal recorded");
  // The refused run wrote no hold.
  assert.equal(h.m3.budgetStatusFor("prj_1").reservedUsd, 6);
});

test("#890.1-tail an auto-run-initiated invocation is NOT double-held", () => {
  const h = harness({ reservationEstimateUsd: 6, limitUsd: 10 });
  // metadata.autoRunId present → the auto-run path already reserved; creation skips.
  const inv = h.creation.createInvocation("t", agent, { actor: { userId: "usr_local" }, metadata: { autoRunId: "aur_1" } });
  assert.notEqual(inv.status, "rejected");
  assert.equal(h.m3.budgetStatusFor("prj_1").reservedUsd, 0, "no hold placed by creation for an auto-run run");
});

test("#890.1-tail completing a manual run releases its hold", () => {
  const h = harness({ reservationEstimateUsd: 6, limitUsd: 10 });
  const inv = h.creation.createInvocation("t", agent, { actor: { userId: "usr_local" } });
  assert.equal(h.m3.budgetStatusFor("prj_1").reservedUsd, 6);

  h.completion.completeInvocation(inv, { status: "succeeded", result: { cost: { amountUsd: 1, currency: "USD", model: "demo", billable: true } } });
  assert.equal(h.m3.budgetStatusFor("prj_1").reservedUsd, 0, "the hold is released on completion");
  // A second run now fits (finalized spend $1 + $6 hold = $7 < $10).
  const next = h.creation.createInvocation("t", agent, { actor: { userId: "usr_local" } });
  assert.notEqual(next.status, "rejected");
});

test("#890.1-tail estimate 0 (default) places no hold and accepts normally", () => {
  const h = harness({ reservationEstimateUsd: 0, limitUsd: 10 });
  const a = h.creation.createInvocation("t", agent, { actor: { userId: "usr_local" } });
  const b = h.creation.createInvocation("t", agent, { actor: { userId: "usr_local" } });
  assert.notEqual(a.status, "rejected");
  assert.notEqual(b.status, "rejected");
  assert.equal(h.m3.budgetStatusFor("prj_1").reservedUsd, 0);
});
