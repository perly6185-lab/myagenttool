/*
 * Durable-state slice 2: traces are bounded + archived. Traces had NO count cap
 * (only time-reap, off by default), so state.traces grew unbounded. createTrace
 * now routes the traces array through the injected capWithArchive, so over-cap
 * (oldest) traces are archived, not dropped. (Spans are capped in the
 * round-telemetry cap step — covered by round-telemetry.test.mjs.)
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createInvocationCreationRuntime } from "../src/services/invocations/creation.mjs";
import { createM3Service } from "../src/services/m3.mjs";

const now = () => "2026-07-17T00:00:00.000Z";
const agent = {
  id: "agt_1",
  name: "Coder",
  adapter: { type: "cli" },
  location: { type: "local_device", deviceId: "dev_1" },
  economics: { model: "external_metered", costOwner: "usr_local", currency: "USD", budgetPoolId: null },
};

function buildCreation(capWithArchive) {
  let n = 0;
  const nextId = (p) => `${p}_${(n += 1)}`;
  const state = {
    invocations: [], worktrees: [], traces: [], spans: [], events: [],
    policyDecisionRecords: [], auditSummaries: [], refusals: [], agentSkills: [],
    budgets: [], budgetReservations: [], ledgerEntries: [], agentUsageSummaries: [],
    projects: [{ id: "prj_1", name: "P", path: "/x", ownerTeamId: "team_a" }],
    teams: [{ id: "team_a" }], users: [{ id: "usr_local", teamId: "team_a" }],
    device: { id: "dev_1" }, autoRunSettings: {}, currentProjectId: "prj_1",
  };
  const appendEvent = (event) => state.events.unshift({ id: nextId("evt"), createdAt: now(), ...event });
  const m3 = createM3Service({ state, now, nextId, appendEvent, findAgent: () => agent });
  const creation = createInvocationCreationRuntime({
    state, now, nextId, appendEvent, persistStateSoon: () => {}, persistStateNow: () => {},
    capWithArchive,
    defaultAgent: () => agent, currentProject: () => state.projects[0], worktreeForProject: () => null,
    normalizeCodexApprovalMode: () => null, normalizeCodexSessionMode: () => null, normalizeCodexWorkspacePolicy: () => null,
    createManagedCodexWorkspace: () => null, createManagedCodexSession: () => null, resolveResumeCodexSessionId: () => null,
    evaluateInvocationPolicy: () => ({ decision: "allow", reason: "ok", riskLevel: "low", riskTags: [] }),
    enforcePlatformAiQuota: () => null,
    createPolicyDecisionRecord: (invocation) => { const r = { id: `pdr_${invocation.id}`, decision: "allowed", reason: "ok" }; state.policyDecisionRecords.push(r); return r; },
    createApprovalRequest: () => ({ id: "apr_1" }), completeRootSpan: () => {},
    createAuditSummary: (invocation, summary) => ({ id: `aud_${invocation.id}`, invocationId: invocation.id, summary }),
    recordAgentUsage: () => {}, budgetGateForProject: m3.budgetGateForProject, reserveBudget: m3.reserveBudget,
  });
  return { state, creation };
}

test("createInvocation caps the traces array through the injected archive", () => {
  const capCalls = [];
  const { state, creation } = buildCreation((list, max, collection) => {
    capCalls.push({ collection, max });
    return Array.isArray(list) ? list.slice(0, max) : [];
  });
  const inv = creation.createInvocation("t", agent, { actor: { userId: "usr_local" } });
  assert.ok(inv, "an invocation is created");
  assert.equal(state.traces.length, 1, "a trace was created");
  assert.ok(capCalls.some((c) => c.collection === "traces" && c.max === 10000), "traces are capped via the injected archive");
});

test("with no archive injected, trace creation still works (back-compat default)", () => {
  const { state, creation } = buildCreation(undefined);
  const inv = creation.createInvocation("t", agent, { actor: { userId: "usr_local" } });
  assert.ok(inv);
  assert.equal(state.traces.length, 1);
});
