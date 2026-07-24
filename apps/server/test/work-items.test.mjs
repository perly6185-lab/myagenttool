import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { sameProjectPath } from "../src/services/projects.mjs";
import { createWorkItemService } from "../src/services/work-items.mjs";

const ACTOR_A = { userId: "usr_a", teamId: "team_a" };
const ACTOR_B = { userId: "usr_b", teamId: "team_b" };
const ACTOR_C = { userId: "usr_c", teamId: "team_a" };

function harness() {
  let counter = 0;
  const events = [];
  const state = {
    workItems: [],
    workItemComments: [],
    workItemActivities: [],
    projects: [
      { id: "prj_a", ownerTeamId: "team_a" },
      { id: "prj_b", ownerTeamId: "team_b" },
    ],
  };
  const service = createWorkItemService({
    state,
    now: () => "2026-07-24T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++counter}`,
    appendEvent: (event) => events.push(event),
  });
  return { state, events, service };
}

test("creates a local work item with server-owned identity and defaults", () => {
  const { service, events } = harness();
  const result = service.createWorkItem({
    projectId: "prj_a",
    title: "Local planning",
    ownerTeamId: "team_b",
  }, ACTOR_A);
  assert.equal(result.status, 201);
  assert.equal(result.body.workItem.localRef, "LOCAL-1");
  assert.equal(result.body.workItem.ownerTeamId, "team_a");
  assert.equal(result.body.workItem.createdBy, "usr_a");
  assert.equal(result.body.workItem.status, "backlog");
  assert.equal(result.body.workItem.revision, 1);
  assert.equal(events[0].type, "work_item_created");
});

test("exposes independent business, planning, and fact-derived execution states", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({
    projectId: "prj_a", title: "Three state model", status: "ready",
  }, ACTOR_A).body.workItem;
  assert.deepEqual(created.statusModel, {
    business: "open", planning: "ready", execution: "unclaimed",
  });
  assert.equal(created.businessState, created.state);
  assert.equal(created.planningStatus, created.status);

  service.claimWorkItem({ workItemId: created.id, agentId: "agt_a" }, ACTOR_A);
  assert.equal(service.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem.executionState, "claimed");

  state.workItems[0].executionBindings = [{
    kind: "auto_run", targetId: "ar_1", worktreeId: null, createdAt: "2026-07-24T00:00:00.000Z",
  }];
  state.autoRuns = [{ id: "ar_1", status: "running" }];
  for (const [runStatus, expected] of [
    ["running", "running"],
    ["awaiting_approval", "awaiting_approval"],
    ["verifying", "verifying"],
    ["failed", "failed"],
    ["done", "completed"],
  ]) {
    state.autoRuns[0].status = runStatus;
    assert.equal(
      service.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem.executionState,
      expected,
    );
  }
});

test("GitHub sync pulls one-sided changes and exposes two-sided conflicts", () => {
  const { service } = harness();
  let item = service.createWorkItem({ projectId: "prj_a", title: "Initial" }, ACTOR_A).body.workItem;
  const remote = {
    number: 42, title: "Initial", body: "", state: "open", labels: [],
    url: "https://github.com/acme/repo/issues/42", repository: "acme/repo",
    updatedAt: "2026-07-23T20:00:00.000Z",
  };
  assert.equal(service.bindGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, remote,
  }, ACTOR_A).status, 201);
  const pulled = service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "pull",
    remote: { ...remote, title: "Remote title", updatedAt: "2026-07-24T01:00:00.000Z" },
  }, ACTOR_A);
  assert.equal(pulled.body.action, "pulled");
  assert.equal(pulled.body.workItem.title, "Remote title");

  item = service.updateWorkItem({
    workItemId: item.id, expectedRevision: pulled.body.workItem.revision, title: "Local title",
  }, ACTOR_A).body.workItem;
  const conflict = service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "pull",
    remote: { ...remote, title: "Other remote title", updatedAt: "2026-07-24T02:00:00.000Z" },
  }, ACTOR_A);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "github_sync_conflict");
  assert.deepEqual(conflict.body.conflict.fields, ["title"]);
  assert.equal(service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "push",
  }, ACTOR_A).status, 409);
  const resolved = service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "resolve_local",
  }, ACTOR_A);
  assert.equal(resolved.body.action, "push_required");
  assert.equal(resolved.body.payload.title, "Local title");
});

test("GitHub push uses a two-step payload and confirmation baseline", () => {
  const { service } = harness();
  let item = service.createWorkItem({ projectId: "prj_a", title: "Initial" }, ACTOR_A).body.workItem;
  service.bindGithubIssue({
    workItemId: item.id, expectedRevision: item.revision,
    remote: {
      number: 7, title: "Initial", body: "", state: "open", labels: [],
      updatedAt: "2026-07-23T20:00:00.000Z",
    },
  }, ACTOR_A);
  item = service.updateWorkItem({
    workItemId: item.id, expectedRevision: item.revision, title: "Publish me",
  }, ACTOR_A).body.workItem;
  const required = service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "push",
  }, ACTOR_A);
  assert.equal(required.body.action, "push_required");
  assert.equal(required.body.payload.title, "Publish me");
  const confirmed = service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "push",
    pushedRemoteUpdatedAt: "2026-07-24T03:00:00.000Z",
  }, ACTOR_A);
  assert.equal(confirmed.body.action, "pushed");
});

test("structured acceptance and verification gate completion", () => {
  const { service } = harness();
  let item = service.createWorkItem({
    projectId: "prj_a", title: "Verified delivery",
    acceptanceCriteria: ["Tests pass", "Docs updated"],
  }, ACTOR_A).body.workItem;
  const blocked = service.updateWorkItem({
    workItemId: item.id, expectedRevision: item.revision, status: "done",
  }, ACTOR_A);
  assert.equal(blocked.status, 409);
  assert.deepEqual(blocked.body.missingCriteria, ["Tests pass", "Docs updated"]);
  assert.equal(blocked.body.verificationRequired, true);

  const recorded = service.recordVerification({
    workItemId: item.id, expectedRevision: item.revision,
    kind: "test", status: "passed", command: "pnpm test", summary: "All suites passed.",
    acceptanceResults: [
      { criterion: "Tests pass", status: "passed", note: "321 tests" },
      { criterion: "Docs updated", status: "passed", note: "README checked" },
    ],
    evidence: [
      { kind: "commit", ref: "abc123", summary: "Implementation" },
      { kind: "log", ref: "run:test-1", summary: "Test output" },
    ],
  }, ACTOR_A);
  assert.equal(recorded.status, 201);
  assert.equal(recorded.body.workItem.completionGate.ready, true);
  assert.equal(recorded.body.workItem.verificationRecords[0].recordedBy, "usr_a");
  item = recorded.body.workItem;
  assert.equal(service.updateWorkItem({
    workItemId: item.id, expectedRevision: item.revision, status: "done",
  }, ACTOR_A).status, 200);
});

test("verification rejects unknown criteria and malformed evidence", () => {
  const { service } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a", title: "Evidence", acceptanceCriteria: ["Known"],
  }, ACTOR_A).body.workItem;
  assert.equal(service.recordVerification({
    workItemId: item.id, expectedRevision: item.revision, kind: "test", status: "passed",
    acceptanceResults: [{ criterion: "Unknown", status: "passed" }],
  }, ACTOR_A).body.error, "invalid_work_item_acceptance_result");
  assert.equal(service.recordVerification({
    workItemId: item.id, expectedRevision: item.revision, kind: "test", status: "passed",
    evidence: [{ kind: "secret", ref: "x" }],
  }, ACTOR_A).body.error, "invalid_work_item_evidence");
});

test("human attention queue aggregates conflicts, approvals, and failed evidence", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a", title: "Needs a human", status: "review", acceptanceCriteria: ["Ship safely"],
  }, ACTOR_A).body.workItem;
  state.workItems[0].externalBindings = [{
    kind: "github_issue", number: 3, conflict: { detectedAt: "2026-07-24T01:00:00.000Z", fields: ["title"] },
  }];
  state.workItems[0].executionBindings = [{ kind: "auto_run", targetId: "ar_3" }];
  state.autoRuns = [{
    id: "ar_3", status: "awaiting_approval", createdAt: "2026-07-24T00:30:00.000Z",
  }];
  state.workItems[0].verificationRecords = [{
    id: "wvr_bad", status: "failed", summary: "Tests failed", recordedAt: "2026-07-24T00:45:00.000Z",
  }];
  const attention = service.listAttention({}, ACTOR_A).body;
  assert.equal(attention.count, 4);
  assert.deepEqual(new Set(attention.items.slice(0, 3).map((row) => row.kind)), new Set([
    "github_conflict", "verification_failed", "execution_approval",
  ]));
  assert.equal(attention.items[3].kind, "acceptance_blocked");
  assert.equal(service.listAttention({}, ACTOR_B).body.count, 0);
  assert.equal(attention.items.every((row) => row.workItemId === item.id), true);
  assert.equal(attention.items.every((row) => row.dueAt && row.slaStatus && Array.isArray(row.history)), true);
  assert.equal(service.listAttention({ kind: "github_conflict" }, ACTOR_A).body.count, 1);
});

test("team scoping hides foreign work items and foreign projects", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "A" }, ACTOR_A).body.workItem;
  assert.equal(service.listWorkItems({}, ACTOR_A).body.count, 1);
  assert.equal(service.listWorkItems({}, ACTOR_B).body.count, 0);
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_B).status, 404);
  assert.equal(service.createWorkItem({ projectId: "prj_b", title: "No" }, ACTOR_A).status, 404);
});

test("updates are revision-gated and validate structured fields", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "A" }, ACTOR_A).body.workItem;
  assert.equal(service.updateWorkItem({ workItemId: item.id, title: "B" }, ACTOR_A).body.error, "expected_revision_required");
  assert.equal(service.updateWorkItem({ workItemId: item.id, expectedRevision: 9, title: "B" }, ACTOR_A).status, 409);
  assert.equal(service.updateWorkItem({ workItemId: item.id, expectedRevision: 1, priority: "urgent" }, ACTOR_A).status, 400);
  const updated = service.updateWorkItem({
    workItemId: item.id,
    expectedRevision: 1,
    title: "B",
    status: "ready",
    labels: ["local", "local"],
    acceptanceCriteria: ["It persists"],
  }, ACTOR_A);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.workItem.revision, 2);
  assert.deepEqual(updated.body.workItem.labels, ["local"]);
});

test("planning fields validate and bulk updates are atomic", () => {
  const { service } = harness();
  const first = service.createWorkItem({
    projectId: "prj_a", title: "First", dueDate: "2026-08-01", milestone: "M3", estimatePoints: 5,
  }, ACTOR_A).body.workItem;
  const second = service.createWorkItem({ projectId: "prj_a", title: "Second" }, ACTOR_A).body.workItem;
  assert.equal(first.dueDate, "2026-08-01");
  assert.equal(first.milestone, "M3");
  assert.equal(first.estimatePoints, 5);
  assert.equal(service.updateWorkItem({
    workItemId: first.id, expectedRevision: 1, dueDate: "08/01/2026",
  }, ACTOR_A).status, 400);
  const conflict = service.bulkUpdateWorkItems({
    items: [{ id: first.id, expectedRevision: 1 }, { id: second.id, expectedRevision: 9 }],
    changes: { status: "ready" },
  }, ACTOR_A);
  assert.equal(conflict.status, 409);
  assert.equal(service.getWorkItem({ workItemId: first.id }, ACTOR_A).body.workItem.status, "backlog");
  const updated = service.bulkUpdateWorkItems({
    items: [{ id: first.id, expectedRevision: 1 }, { id: second.id, expectedRevision: 1 }],
    changes: { status: "ready", milestone: "M4", estimatePoints: 8 },
  }, ACTOR_A);
  assert.equal(updated.body.count, 2);
  assert.equal(updated.body.workItems.every((item) =>
    item.status === "ready" && item.milestone === "M4" && item.estimatePoints === 8), true);
  assert.equal(service.updateWorkItem({
    workItemId: first.id, expectedRevision: 2, estimatePoints: -1,
  }, ACTOR_A).status, 400);
});

test("dependencies expose blocking state and reject cycles", () => {
  const { service } = harness();
  const foundation = service.createWorkItem({ projectId: "prj_a", title: "Foundation" }, ACTOR_A).body.workItem;
  const delivery = service.createWorkItem({ projectId: "prj_a", title: "Delivery" }, ACTOR_A).body.workItem;
  const linked = service.updateWorkItem({
    workItemId: delivery.id,
    expectedRevision: 1,
    dependencyIds: [foundation.id],
  }, ACTOR_A);
  assert.equal(linked.status, 200);
  assert.equal(linked.body.workItem.blockedBy[0].resolved, false);
  assert.equal(service.getWorkItem({ workItemId: foundation.id }, ACTOR_A).body.workItem.blocks[0].id, delivery.id);

  const cycle = service.updateWorkItem({
    workItemId: foundation.id,
    expectedRevision: 1,
    dependencyIds: [delivery.id],
  }, ACTOR_A);
  assert.equal(cycle.status, 409);
  assert.equal(cycle.body.error, "work_item_dependency_cycle");

  service.updateWorkItem({
    workItemId: foundation.id,
    expectedRevision: 1,
    status: "done",
  }, ACTOR_A);
  assert.equal(service.getWorkItem({ workItemId: delivery.id }, ACTOR_A).body.workItem.blockedBy[0].resolved, true);
});

test("parent and sub-issues expose progress and reject hierarchy cycles", () => {
  const { service, state } = harness();
  state.projects.push({ id: "prj_c", ownerTeamId: "team_a" });
  const parent = service.createWorkItem({
    projectId: "prj_a", title: "Parent", type: "initiative",
  }, ACTOR_A).body.workItem;
  const first = service.createWorkItem({
    projectId: "prj_a", title: "Child one", parentId: parent.id,
  }, ACTOR_A).body.workItem;
  const second = service.createWorkItem({
    projectId: "prj_a", title: "Child two", parentId: parent.id, status: "done",
  }, ACTOR_A).body.workItem;
  assert.equal(first.parent.id, parent.id);
  const detail = service.getWorkItem({ workItemId: parent.id }, ACTOR_A).body.workItem;
  assert.equal(detail.subIssuesSummary.total, 2);
  assert.equal(detail.subIssuesSummary.completed, 1);
  assert.equal(detail.subIssuesSummary.percentCompleted, 50);
  assert.deepEqual(detail.subIssues.map((item) => item.id).sort(), [first.id, second.id].sort());
  assert.equal(service.updateWorkItem({
    workItemId: parent.id, expectedRevision: 1, parentId: first.id,
  }, ACTOR_A).status, 409);
  assert.equal(service.createWorkItem({
    projectId: "prj_c", title: "Wrong project", parentId: parent.id,
  }, ACTOR_A).status, 400);
});

test("agent claims renew, conflict, expire, transfer, and release safely", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Claim me" }, ACTOR_A).body.workItem;
  const claimed = service.claimWorkItem({
    workItemId: item.id, agentId: "agt_a", leaseMinutes: 30, idempotencyKey: "claim-1",
  }, ACTOR_A);
  assert.equal(claimed.status, 201);
  assert.equal(claimed.body.claim.claimedBy, "usr_a");
  const renewed = service.claimWorkItem({
    workItemId: item.id, agentId: "agt_a", leaseMinutes: 60, idempotencyKey: "claim-1",
  }, ACTOR_A);
  assert.equal(renewed.status, 200);
  assert.equal(service.claimWorkItem({ workItemId: item.id }, ACTOR_C).status, 409);
  state.workItems[0].claim.leaseExpiresAt = "2026-07-23T00:00:00.000Z";
  const takeover = service.claimWorkItem({ workItemId: item.id, agentId: "agt_c" }, ACTOR_C);
  assert.equal(takeover.status, 201);
  assert.equal(takeover.body.claim.claimedBy, "usr_c");
  assert.equal(service.releaseWorkItemClaim({ workItemId: item.id }, ACTOR_A).status, 409);
  assert.equal(service.releaseWorkItemClaim({ workItemId: item.id }, ACTOR_C).body.released, true);
  assert.equal(service.releaseWorkItemClaim({ workItemId: item.id }, ACTOR_C).body.released, false);
});

test("agent create idempotency prevents duplicate local issues", () => {
  const { service, state } = harness();
  const first = service.createWorkItem({
    projectId: "prj_a", title: "Exactly once", idempotencyKey: "create-1",
  }, ACTOR_A);
  const replay = service.createWorkItem({
    projectId: "prj_a", title: "Ignored replay body", idempotencyKey: "create-1",
  }, ACTOR_A);
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.workItem.id, first.body.workItem.id);
  assert.equal(state.workItems.length, 1);
  const otherActor = service.createWorkItem({
    projectId: "prj_a", title: "Separate actor", idempotencyKey: "create-1",
  }, ACTOR_C);
  assert.equal(otherActor.status, 201);
  assert.equal(state.workItems.length, 2);
});

test("planning automation adds matching work items once", () => {
  const { service, state } = harness();
  state.planningProjects = [{
    id: "ppj_1", ownerTeamId: "team_a", name: "Urgent bugs", archivedAt: null,
    automationRules: [{ id: "par_1", status: "", priority: "p0", type: "bug", label: "release" }],
  }];
  state.planningProjectItems = [];
  const item = service.createWorkItem({
    projectId: "prj_a", title: "Ship blocker", type: "bug", priority: "p0", labels: ["release"],
  }, ACTOR_A).body.workItem;
  assert.equal(state.planningProjectItems.length, 1);
  assert.equal(state.planningProjectItems[0].workItemId, item.id);
  assert.equal(state.planningProjects[0].activity[0].action, "item_auto_added");
  service.updateWorkItem({
    workItemId: item.id, expectedRevision: 1, status: "ready",
  }, ACTOR_A);
  assert.equal(state.planningProjectItems.length, 1);
  assert.equal(service.listActivity({ workItemId: item.id }, ACTOR_A).body.activities
    .some((row) => row.action === "planning_auto_added"), true);
});

test("close, reopen, archive and restore preserve the record", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "A" }, ACTOR_A).body.workItem;
  const closed = service.transitionWorkItem({ workItemId: item.id, expectedRevision: 1, action: "close" }, ACTOR_A);
  assert.equal(closed.body.workItem.state, "closed");
  const archived = service.transitionWorkItem({ workItemId: item.id, expectedRevision: 2, action: "archive" }, ACTOR_A);
  assert.ok(archived.body.workItem.archivedAt);
  assert.equal(service.listWorkItems({}, ACTOR_A).body.count, 0);
  const restored = service.transitionWorkItem({ workItemId: item.id, expectedRevision: 3, action: "restore" }, ACTOR_A);
  assert.equal(restored.body.workItem.archivedAt, null);
  const reopened = service.transitionWorkItem({ workItemId: item.id, expectedRevision: 4, action: "reopen" }, ACTOR_A);
  assert.equal(reopened.body.workItem.state, "open");
});

test("list supports project, status, type, assignee and text filters", () => {
  const { service } = harness();
  service.createWorkItem({
    projectId: "prj_a",
    title: "Repair release",
    type: "bug",
    status: "blocked",
    assigneeIds: ["usr_a"],
    labels: ["release"],
  }, ACTOR_A);
  service.createWorkItem({ projectId: "prj_a", title: "Write docs" }, ACTOR_A);
  assert.equal(service.listWorkItems({ q: "release" }, ACTOR_A).body.count, 1);
  assert.equal(service.listWorkItems({ status: "blocked", type: "bug", assigneeId: "usr_a" }, ACTOR_A).body.count, 1);
  assert.equal(service.listWorkItems({ status: "done" }, ACTOR_A).body.count, 0);
});

test("list filters by planning project and returns reverse memberships", () => {
  const { service, state } = harness();
  const first = service.createWorkItem({ projectId: "prj_a", title: "In roadmap" }, ACTOR_A).body.workItem;
  service.createWorkItem({ projectId: "prj_a", title: "Unplanned" }, ACTOR_A);
  state.planningProjects = [{
    id: "ppj_1", ownerTeamId: "team_a", name: "Roadmap", archivedAt: null,
  }];
  state.planningProjectItems = [{
    id: "ppi_1", ownerTeamId: "team_a", planningProjectId: "ppj_1", workItemId: first.id,
  }];
  const result = service.listWorkItems({ planningProjectId: "ppj_1" }, ACTOR_A);
  assert.equal(result.body.count, 1);
  assert.equal(result.body.workItems[0].planningProjects[0].name, "Roadmap");
  assert.equal(service.getWorkItem({ workItemId: first.id }, ACTOR_A).body.workItem.planningProjects[0].id, "ppj_1");
});

test("work items survive a persistent-state restart", () => {
  const root = join(tmpdir(), `myagenttool-work-items-${Date.now()}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state.json");
  mkdirSync(projectPath, { recursive: true });
  try {
    const now = () => "2026-07-24T00:00:00.000Z";
    const first = createServerState({ defaultProjectPath: projectPath, now });
    first.state.workItems.push({
      id: "lwi_1", localNumber: 1, localRef: "LOCAL-1",
      ownerTeamId: "team_local", projectId: first.defaultProject.id,
      title: "Persist me", body: "", type: "task", status: "backlog", priority: "p2",
      labels: [], assigneeIds: [], acceptanceCriteria: [], dueDate: "2026-08-15", milestone: "M3",
      revision: 1, state: "open",
      archivedAt: null, externalBindings: [], executionBindings: [], createdAt: now(), updatedAt: now(),
      createdBy: "usr_local", lastModifiedBy: "usr_local",
    });
    first.state.workItemComments.push({
      id: "wic_1", workItemId: "lwi_1", ownerTeamId: "team_local",
      projectId: first.defaultProject.id, body: "Still here", revision: 1,
      createdAt: now(), updatedAt: now(), createdBy: "usr_local",
      lastModifiedBy: "usr_local", deletedAt: null,
    });
    first.state.workItemActivities.push({
      id: "wia_1", workItemId: "lwi_1", ownerTeamId: "team_local",
      projectId: first.defaultProject.id, action: "commented", actorId: "usr_local",
      createdAt: now(), details: { commentId: "wic_1" },
    });
    first.state.planningProjects.push({
      id: "ppj_1", ownerTeamId: "team_local", name: "Roadmap", description: "",
      color: "indigo", revision: 1, archivedAt: null, createdAt: now(), updatedAt: now(),
      createdBy: "usr_local", lastModifiedBy: "usr_local",
    });
    first.state.planningProjectItems.push({
      id: "ppi_1", ownerTeamId: "team_local", planningProjectId: "ppj_1",
      workItemId: "lwi_1", position: 2000, addedAt: now(), addedBy: "usr_local",
    });
    createPersistenceRuntime({
      state: first.state, enabled: true, stateStorePath, schemaVersion: 1,
      now, defaultProject: first.defaultProject, sameProjectPath,
    }).savePersistentState();

    const second = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({
      state: second.state, enabled: true, stateStorePath, schemaVersion: 1,
      now, defaultProject: second.defaultProject, sameProjectPath,
    }).restorePersistentState();
    assert.equal(second.state.workItems.length, 1);
    assert.equal(second.state.workItems[0].localRef, "LOCAL-1");
    assert.equal(second.state.workItems[0].dueDate, "2026-08-15");
    assert.equal(second.state.workItems[0].milestone, "M3");
    assert.equal(second.state.planningProjectItems[0].position, 2000);
    assert.equal(second.state.workItemComments[0].body, "Still here");
    assert.equal(second.state.workItemActivities[0].action, "commented");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("comments support create, edit and soft-delete with revision conflicts", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Discuss" }, ACTOR_A).body.workItem;
  const created = service.createComment({ workItemId: item.id, body: " First note " }, ACTOR_A);
  assert.equal(created.status, 201);
  assert.equal(created.body.comment.body, "First note");
  assert.equal(service.createComment({ workItemId: item.id, body: " " }, ACTOR_A).status, 400);
  assert.equal(service.updateComment({
    workItemId: item.id, commentId: created.body.comment.id, expectedRevision: 9, body: "No",
  }, ACTOR_A).status, 409);
  const updated = service.updateComment({
    workItemId: item.id, commentId: created.body.comment.id, expectedRevision: 1, body: "Edited",
  }, ACTOR_A);
  assert.equal(updated.body.comment.revision, 2);
  assert.equal(updated.body.comment.body, "Edited");
  const deleted = service.deleteComment({
    workItemId: item.id, commentId: created.body.comment.id, expectedRevision: 2,
  }, ACTOR_A);
  assert.equal(deleted.body.comment.body, null);
  assert.ok(deleted.body.comment.deletedAt);
  assert.equal(service.updateComment({
    workItemId: item.id, commentId: created.body.comment.id, expectedRevision: 3, body: "Restore",
  }, ACTOR_A).status, 404);
});

test("comments and activity are team scoped and form a dedicated timeline", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Timeline" }, ACTOR_A).body.workItem;
  service.updateWorkItem({ workItemId: item.id, expectedRevision: 1, status: "ready" }, ACTOR_A);
  service.createComment({ workItemId: item.id, body: "Ready to start" }, ACTOR_A);
  const activity = service.listActivity({ workItemId: item.id }, ACTOR_A);
  assert.deepEqual(new Set(activity.body.activities.map((row) => row.action)), new Set(["created", "updated", "commented"]));
  assert.equal(service.listComments({ workItemId: item.id }, ACTOR_A).body.count, 1);
  assert.equal(service.listActivity({ workItemId: item.id }, ACTOR_B).status, 404);
  assert.equal(service.listComments({ workItemId: item.id }, ACTOR_B).status, 404);
});

test("execution bindings attach worktrees and auto-runs to the local issue", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Execute locally" }, ACTOR_A).body.workItem;
  const worktree = service.recordExecutionBinding({
    workItemId: item.id, kind: "worktree", targetId: "wtr_1", worktreeId: "wtr_1",
  }, ACTOR_A);
  assert.equal(worktree.status, 200);
  assert.equal(worktree.body.workItem.executionBindings.length, 1);
  const run = service.recordExecutionBinding({
    workItemId: item.id, kind: "auto_run", targetId: "aur_1", worktreeId: "wtr_2",
  }, ACTOR_A);
  assert.equal(run.body.workItem.executionBindings.length, 2);
  assert.equal(service.listActivity({ workItemId: item.id }, ACTOR_A).body.activities[0].action, "auto_run_started");
  assert.equal(service.recordExecutionBinding({
    workItemId: item.id, kind: "auto_run", targetId: "aur_evil",
  }, ACTOR_B).status, 404);
});
