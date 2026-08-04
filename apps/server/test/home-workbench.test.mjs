import assert from "node:assert/strict";
import test from "node:test";
import { homeWorkbenchReadModel } from "../src/read-models/home-workbench.mjs";

const NOW = "2026-08-03T04:00:00.000Z";

function item(overrides = {}) {
  return {
    id: "lwi_1", localRef: "LOCAL-1", title: "Ship homepage", projectId: "prj_1",
    revision: 1, priority: "p2", status: "ready", state: "open", archivedAt: null,
    assigneeIds: ["usr_me"], requesterRelation: "customer", requesterName: "Alex",
    requesterOrganization: "Acme", requesterUserId: null, waitingOn: "me",
    executionState: "unclaimed", dueDate: null, plannedDate: null,
    commitmentDate: null, nextFollowUpAt: null, executionBindings: [],
    updatedAt: NOW, ...overrides,
  };
}

function model(workItems, state = {}) {
  return homeWorkbenchReadModel({
    state: { users: [{ id: "usr_me", name: "Me" }], ...state },
    workItems,
    now: NOW,
    timezoneOffset: -480,
  });
}

test("home workbench derives ordered primary and secondary attention reasons", () => {
  const result = model([item({
    executionState: "failed",
    executionBindings: [{ kind: "application_invocation", id: "inv_attention" }],
    commitmentDate: "2026-08-02T04:00:00.000Z",
    nextFollowUpAt: "2026-08-03T03:00:00.000Z",
  })], {
    invocations: [{ id: "inv_attention", status: "waiting_for_local_approval", updatedAt: NOW }],
  });
  assert.equal(result.items[0].attentionReason, "overdue");
  assert.equal(result.items[0].revision, 1);
  assert.deepEqual(result.items[0].secondaryReasons, ["approval_required", "follow_up_due"]);
  assert.equal(result.items[0].needsAttention, true);
  assert.equal(result.items[0].nextAction.kind, "open_approval");
  assert.equal(result.summary.approvals, 1);
});

test("home workbench projects canonical AI and approval navigation", () => {
  const result = model([item({
    executionState: "awaiting_approval",
    executionBindings: [{ kind: "auto_run", targetId: "aur_1" }],
  })], {
    autoRuns: [{ id: "aur_1", invocationId: "inv_1", agentId: "agt_1", status: "awaiting_approval", updatedAt: NOW }],
    invocations: [{ id: "inv_1", agentId: "agt_1", status: "waiting_for_local_approval", updatedAt: NOW }],
    agents: [{ id: "agt_1", name: "Codex" }],
    approvalRequests: [{ id: "apr_1", invocationId: "inv_1", status: "pending" }],
  });
  assert.deepEqual(result.items[0].nextAction, {
    kind: "open_approval", label: "review_approval", targetId: "apr_1", section: "approvals",
  });
  assert.deepEqual(result.items[0].ai, {
    autoRunId: "aur_1", invocationId: "inv_1", agentId: "agt_1", agentName: "Codex",
    status: "awaiting_approval", updatedAt: NOW,
  });
});

test("home workbench uses only the newest execution binding for state and navigation", () => {
  const result = model([item({
    executionState: "failed",
    executionBindings: [
      { kind: "auto_run", targetId: "aur_old", createdAt: "2026-08-01T04:00:00.000Z" },
      { kind: "application_invocation", id: "inv_new", createdAt: "2026-08-02T04:00:00.000Z" },
    ],
  })], {
    autoRuns: [{ id: "aur_old", invocationId: "inv_old", status: "failed", updatedAt: "2026-08-01T05:00:00.000Z" }],
    invocations: [
      { id: "inv_old", status: "failed", updatedAt: "2026-08-01T05:00:00.000Z" },
      { id: "inv_new", agentId: "agt_1", status: "running", updatedAt: NOW },
    ],
    agents: [{ id: "agt_1", name: "Codex" }],
  });
  assert.equal(result.items[0].attentionReason, "ai_running");
  assert.equal(result.items[0].executionState, "running");
  assert.equal(result.items[0].nextAction.targetId, "inv_new");
  assert.equal(result.items[0].nextAction.section, "invocations");
  assert.equal(result.items[0].ai.status, "running");
  assert.equal(result.items[0].ai.autoRunId, null);
});

test("home workbench aggregates relationship and waiting counts", () => {
  const result = model([
    item({ id: "customer", requesterRelation: "customer", waitingOn: "requester" }),
    item({ id: "boss", requesterRelation: "boss", requesterName: "Boss", waitingOn: "internal" }),
    item({ id: "self", requesterRelation: "self", requesterName: null, waitingOn: "ai" }),
  ]);
  assert.equal(result.summary.byRelation.customer, 1);
  assert.equal(result.summary.byRelation.boss, 1);
  assert.equal(result.summary.byWaitingOn.requester, 1);
  assert.equal(result.summary.byWaitingOn.ai, 1);
});

test("home workbench exposes compact report status without report content", () => {
  const result = model([item({ revision: 3 })], {
    workItemReportDrafts: [{
      id: "wrd_1", workItemId: "lwi_1", ownerTeamId: undefined,
      status: "draft", source: { workItemRevision: 2 },
      content: "Private report body", createdAt: NOW, updatedAt: NOW,
    }],
  });
  assert.deepEqual(result.items[0].report, {
    id: "wrd_1", status: "draft", stale: true, updatedAt: NOW,
  });
  assert.equal(JSON.stringify(result.items[0]).includes("Private report body"), false);
});

test("home workbench sorts severely overdue work before approvals and failures", () => {
  const result = model([
    item({ id: "failed", executionState: "running", executionBindings: [{ kind: "auto_run", targetId: "aur_failed" }] }),
    item({ id: "approval", executionState: "failed", executionBindings: [{ kind: "auto_run", targetId: "aur_approval" }] }),
    item({ id: "recent-overdue", commitmentDate: "2026-08-03T03:00:00.000Z" }),
    item({ id: "old-overdue", commitmentDate: "2026-08-01T03:00:00.000Z" }),
  ], {
    autoRuns: [
      { id: "aur_failed", status: "failed", updatedAt: NOW },
      { id: "aur_approval", status: "awaiting_approval", updatedAt: NOW },
    ],
  });
  assert.deepEqual(result.items.map((row) => row.workItemId), ["old-overdue", "recent-overdue", "approval", "failed"]);
});

test("home workbench excludes completed, closed, and archived work", () => {
  const result = model([
    item({ id: "done", status: "done" }),
    item({ id: "closed", state: "closed" }),
    item({ id: "archived", archivedAt: NOW }),
  ]);
  assert.equal(result.summary.total, 0);
});
