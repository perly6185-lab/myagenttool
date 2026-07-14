/*
 * #968 — a human approval/denial commits durably through the Store's unit of work.
 *
 * Crash model (as in invocation-durability): the store commits via a real
 * persistStateNow; appendEvent's debounce is a no-op. Before #968 the approval
 * runtime had NO barrier at all, so a granted approval or a denial persisted only
 * via that debounce — a crash left the run parked at waiting_for_local_approval,
 * losing the human's decision. Here approve/deny survive a reload from disk.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createInMemoryStore } from "../src/runtime/store/in-memory-store.mjs";
import { createInvocationApprovalRuntime } from "../src/services/invocations/approval.mjs";

const now = () => "2026-07-14T00:00:00.000Z";
const agent = { id: "agt_1", name: "Coder", adapter: { type: "cli" }, location: { type: "local_device", deviceId: "dev_1" } };

function withTmp(fn) {
  const root = join(tmpdir(), `myagenttool-approval-durability-${Date.now()}-${Math.floor(process.hrtime()[1] % 1e6)}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  try { return fn({ projectPath, stateStorePath }); } finally { rmSync(root, { recursive: true, force: true }); }
}

function runtime(projectPath, stateStorePath) {
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now });
  let n = 0;
  const nextId = (p) => `${p}_${++n}`;
  const persistence = createPersistenceRuntime({
    state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject, sameProjectPath: () => false,
  });
  const store = createInMemoryStore({ state, commit: () => persistence.persistStateNow() });
  const approval = createInvocationApprovalRuntime({
    state, now, nextId,
    appendEvent: (e) => state.events.unshift({ id: nextId("evt"), ...e }),
    findAgent: () => agent,
    uniqueStrings: (a) => [...new Set(a)],
    completeRootSpan: () => {},
    createAuditSummary: (inv, s) => ({ invocationId: inv.id, summary: s }),
    recordAgentUsage: () => {},
    startInvocationIfAllowed: () => {}, // no dispatch in this test
    store,
  });
  const reload = () => {
    const fresh = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({
      state: fresh.state, enabled: true, stateStorePath, schemaVersion: 1, now,
      defaultProject: fresh.defaultProject, sameProjectPath: () => false,
    }).restorePersistentState();
    return fresh.state;
  };
  return { state, approval, reload };
}

function parkWaiting(state) {
  const invocation = {
    id: "inv_1", agentId: "agt_1", requestedBy: "usr_1", status: "waiting_for_local_approval",
    delivery: { state: "not_required", deviceId: null, dispatchAttempts: 0, lastDispatchAt: null, acknowledgedAt: null },
    policyDecisionId: "pdr_1", options: {}, input: { task: "t" }, createdAt: now(), updatedAt: now(),
  };
  const approvalRequest = { id: "apr_1", invocationId: "inv_1", status: "pending", createdAt: now(), decidedAt: null, decidedBy: null };
  state.invocations.push(invocation);
  state.approvalRequests.push(approvalRequest);
  state.policyDecisionRecords.push({ id: "pdr_1", invocationId: "inv_1", decision: "requires_local_approval" });
  return { invocation, approvalRequest };
}

test("#968 a granted approval survives a crash (approval runtime had no barrier)", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const rt = runtime(projectPath, stateStorePath);
    const { invocation, approvalRequest } = parkWaiting(rt.state);

    rt.approval.approveInvocation(approvalRequest, invocation, { userId: "usr_boss" });

    const restored = rt.reload();
    assert.equal(restored.approvalRequests.find((a) => a.id === "apr_1").status, "approved", "the approval is durable");
    assert.equal(restored.approvalRequests.find((a) => a.id === "apr_1").decidedBy, "usr_boss");
    assert.equal(restored.invocations.find((i) => i.id === "inv_1").status, "queued", "the run is durably released to run");
    assert.equal(restored.policyDecisionRecords.find((p) => p.id === "pdr_1").decision, "allowed");
  });
});

test("#968 a denial survives a crash", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const rt = runtime(projectPath, stateStorePath);
    const { invocation, approvalRequest } = parkWaiting(rt.state);

    rt.approval.denyInvocation(approvalRequest, invocation, { userId: "usr_boss" });

    const restored = rt.reload();
    assert.equal(restored.approvalRequests.find((a) => a.id === "apr_1").status, "denied", "the denial is durable");
    assert.equal(restored.invocations.find((i) => i.id === "inv_1").status, "rejected");
    assert(restored.refusals.some((r) => r.subject?.id === "inv_1" && r.code === "approval_denied"), "the refusal is durable");
    assert(restored.auditSummaries.some((a) => a.invocationId === "inv_1"), "the audit is durable");
  });
});
