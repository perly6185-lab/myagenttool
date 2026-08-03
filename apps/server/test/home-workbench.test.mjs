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
    executionState: "awaiting_approval",
    commitmentDate: "2026-08-02T04:00:00.000Z",
    nextFollowUpAt: "2026-08-03T03:00:00.000Z",
  })]);
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

test("home workbench sorts severely overdue work before approvals and failures", () => {
  const result = model([
    item({ id: "failed", executionState: "failed" }),
    item({ id: "approval", executionState: "awaiting_approval" }),
    item({ id: "recent-overdue", commitmentDate: "2026-08-03T03:00:00.000Z" }),
    item({ id: "old-overdue", commitmentDate: "2026-08-01T03:00:00.000Z" }),
  ]);
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
