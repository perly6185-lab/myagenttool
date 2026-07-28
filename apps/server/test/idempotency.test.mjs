/*
 * Invocation-create idempotency (WS2 durable-state hardening): a client-provided
 * key dedups a retried create so one logical request never spawns two runs.
 * Scoped per requester (keys can't collide across tenants); no key preserves the
 * old always-create behavior; the key is a persisted field so dedup survives
 * restart. Because createInvocation is synchronous, the check-then-insert is
 * atomic in the event loop — this test locks that contract in.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createInvocationCreationRuntime } from "../src/services/invocations/creation.mjs";

const agent = {
  id: "agt_1",
  name: "Coder",
  adapter: { type: "cli" },
  location: { type: "local_device", deviceId: "dev_1" },
};

function runtime() {
  let n = 0;
  const state = {
    invocations: [],
    worktrees: [],
    projects: [{ id: "prj_1", name: "P", path: "/x" }],
    traces: [],
    spans: [],
    policyDecisionRecords: [],
    auditSummaries: [],
    agentSkills: [],
    device: { id: "dev_1" },
  };
  const svc = createInvocationCreationRuntime({
    state,
    now: () => "2026-07-04T00:00:00.000Z",
    nextId: (p) => `${p}_${++n}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    defaultAgent: () => agent,
    currentProject: () => state.projects[0],
    worktreeForProject: () => null,
    normalizeCodexApprovalMode: (value) => value ?? "ask",
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
    createAuditSummary: () => ({ id: "aud_1" }),
    recordAgentUsage: () => {},
    budgetGateForProject: () => ({ blocked: false }),
  });
  return { state, svc };
}

test("same key + same requester dedups: one run, the original returned", () => {
  const { state, svc } = runtime();
  const first = svc.createInvocation("task", agent, { idempotencyKey: "k1", actor: { userId: "u1" } });
  const second = svc.createInvocation("task", agent, { idempotencyKey: "k1", actor: { userId: "u1" } });
  assert.equal(second.id, first.id, "the retry returns the original invocation");
  assert.equal(state.invocations.length, 1, "no duplicate run was created");
  assert.equal(first.idempotencyKey, "k1", "the client key is persisted on the invocation");
});

test("different keys create distinct runs", () => {
  const { state, svc } = runtime();
  svc.createInvocation("task", agent, { idempotencyKey: "k1", actor: { userId: "u1" } });
  svc.createInvocation("task", agent, { idempotencyKey: "k2", actor: { userId: "u1" } });
  assert.equal(state.invocations.length, 2);
});

test("no key preserves always-create behavior", () => {
  const { state, svc } = runtime();
  svc.createInvocation("task", agent, { actor: { userId: "u1" } });
  svc.createInvocation("task", agent, { actor: { userId: "u1" } });
  assert.equal(state.invocations.length, 2, "without a key, every create is a new run");
});

test("same key across different requesters does NOT collide (tenant-scoped)", () => {
  const { state, svc } = runtime();
  const a = svc.createInvocation("task", agent, { idempotencyKey: "k1", actor: { userId: "u1" } });
  const b = svc.createInvocation("task", agent, { idempotencyKey: "k1", actor: { userId: "u2" } });
  assert.notEqual(b.id, a.id, "u2's key is independent of u1's");
  assert.equal(state.invocations.length, 2);
});

test("blank/whitespace key is treated as no key", () => {
  const { state, svc } = runtime();
  svc.createInvocation("task", agent, { idempotencyKey: "   ", actor: { userId: "u1" } });
  svc.createInvocation("task", agent, { idempotencyKey: "", actor: { userId: "u1" } });
  assert.equal(state.invocations.length, 2);
});

test("invocation inherits the registered Codex Agent permission mode unless the run overrides it", () => {
  const { svc } = runtime();
  const fullAgent = {
    ...agent,
    adapter: { ...agent.adapter, permissionMode: "full" },
  };

  const inherited = svc.createInvocation("trusted task", fullAgent, { actor: { userId: "u1" } });
  const overridden = svc.createInvocation("reviewed task", fullAgent, {
    actor: { userId: "u1" },
    approvalMode: "ask",
  });

  assert.equal(inherited.options.approvalMode, "full");
  assert.equal(overridden.options.approvalMode, "ask");
});
