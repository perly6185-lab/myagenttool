import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlanningProjectService } from "../src/services/planning-projects.mjs";

const ACTOR_A = { userId: "usr_a", teamId: "team_a" };
const ACTOR_B = { userId: "usr_b", teamId: "team_b" };

function harness() {
  let counter = 0;
  const state = {
    planningProjects: [],
    planningProjectItems: [],
    workItems: [
      { id: "wi_a", localRef: "LOCAL-1", ownerTeamId: "team_a", title: "A", status: "backlog", priority: "p2", state: "open" },
      { id: "wi_b", localRef: "LOCAL-2", ownerTeamId: "team_b", title: "B", status: "ready", priority: "p1", state: "open" },
    ],
  };
  const service = createPlanningProjectService({
    state,
    now: () => "2026-07-24T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++counter}`,
  });
  return { state, service };
}

test("planning projects are team scoped and revision gated", () => {
  const { service } = harness();
  const created = service.createProject({ name: "Release", description: "Ship it" }, ACTOR_A);
  assert.equal(created.status, 201);
  assert.equal(service.listProjects({}, ACTOR_B).body.count, 0);
  assert.equal(service.getProject({ planningProjectId: created.body.project.id }, ACTOR_B).status, 404);
  assert.equal(service.updateProject({
    planningProjectId: created.body.project.id,
    expectedRevision: 2,
    name: "Wrong",
  }, ACTOR_A).status, 409);
  const updated = service.updateProject({
    planningProjectId: created.body.project.id,
    expectedRevision: 1,
    name: "Release 1",
  }, ACTOR_A);
  assert.equal(updated.body.project.revision, 2);
  assert.equal(updated.body.project.name, "Release 1");
});

test("work item membership is idempotent and rejects foreign items", () => {
  const { service } = harness();
  const project = service.createProject({ name: "Release" }, ACTOR_A).body.project;
  const added = service.addItem({ planningProjectId: project.id, workItemId: "wi_a" }, ACTOR_A);
  assert.equal(added.status, 201);
  assert.equal(service.addItem({ planningProjectId: project.id, workItemId: "wi_a" }, ACTOR_A).body.created, false);
  assert.equal(service.addItem({ planningProjectId: project.id, workItemId: "wi_b" }, ACTOR_A).status, 404);
  const detail = service.getProject({ planningProjectId: project.id }, ACTOR_A).body.project;
  assert.equal(detail.itemCount, 1);
  assert.equal(detail.openItemCount, 1);
  assert.equal(detail.completedItemCount, 0);
  assert.equal(detail.statusCounts.backlog, 1);
  assert.equal(detail.priorityCounts.p2, 1);
  assert.equal(detail.items[0].workItem.id, "wi_a");
  assert.equal(service.removeItem({ planningProjectId: project.id, workItemId: "wi_a" }, ACTOR_A).status, 200);
  assert.equal(service.getProject({ planningProjectId: project.id }, ACTOR_A).body.project.itemCount, 0);
});

test("archive and restore preserve project membership", () => {
  const { service } = harness();
  const project = service.createProject({ name: "Release" }, ACTOR_A).body.project;
  service.addItem({ planningProjectId: project.id, workItemId: "wi_a" }, ACTOR_A);
  const archived = service.setArchived({
    planningProjectId: project.id, expectedRevision: 1, archived: true,
  }, ACTOR_A);
  assert.ok(archived.body.project.archivedAt);
  assert.equal(service.listProjects({}, ACTOR_A).body.count, 0);
  const restored = service.setArchived({
    planningProjectId: project.id, expectedRevision: 2, archived: false,
  }, ACTOR_A);
  assert.equal(restored.body.project.archivedAt, null);
  assert.equal(service.getProject({ planningProjectId: project.id }, ACTOR_A).body.project.itemCount, 1);
});

test("project members support deterministic reorder and batch membership updates", () => {
  const { service, state } = harness();
  state.workItems.push({
    id: "wi_c", localRef: "LOCAL-3", ownerTeamId: "team_a", title: "C",
    status: "ready", priority: "p1", state: "open",
  });
  const project = service.createProject({ name: "Release" }, ACTOR_A).body.project;
  service.updateItems({ planningProjectId: project.id, addWorkItemIds: ["wi_a", "wi_c"] }, ACTOR_A);
  let detail = service.getProject({ planningProjectId: project.id }, ACTOR_A).body.project;
  assert.deepEqual(detail.items.map((row) => row.workItem.id), ["wi_a", "wi_c"]);
  const reordered = service.reorderItems({
    planningProjectId: project.id,
    expectedRevision: 2,
    workItemIds: ["wi_c", "wi_a"],
  }, ACTOR_A);
  assert.equal(reordered.status, 200);
  assert.deepEqual(reordered.body.project.items.map((row) => row.workItem.id), ["wi_c", "wi_a"]);
  assert.equal(service.reorderItems({
    planningProjectId: project.id,
    expectedRevision: 2,
    workItemIds: ["wi_a", "wi_c"],
  }, ACTOR_A).status, 409);
  detail = service.updateItems({
    planningProjectId: project.id, addWorkItemIds: [], removeWorkItemIds: ["wi_a"],
  }, ACTOR_A).body.project;
  assert.deepEqual(detail.items.map((row) => row.workItem.id), ["wi_c"]);
});

test("project portfolio summaries expose execution and schedule risk", () => {
  const { service, state } = harness();
  state.workItems[0].dueDate = "2026-07-20";
  state.workItems[0].dependencyIds = ["wi_dependency"];
  state.workItems[0].executionBindings = [{ kind: "auto_run", targetId: "aur_1" }];
  state.workItems.push({
    id: "wi_dependency", ownerTeamId: "team_a", status: "ready", state: "open",
  });
  state.autoRuns = [{ id: "aur_1", status: "failed" }];
  const project = service.createProject({ name: "At risk" }, ACTOR_A).body.project;
  service.addItem({ planningProjectId: project.id, workItemId: "wi_a" }, ACTOR_A);
  const summary = service.listProjects({}, ACTOR_A).body.projects[0];
  assert.equal(summary.blockedItemCount, 1);
  assert.equal(summary.overdueItemCount, 1);
  assert.equal(summary.failedRunCount, 1);
  assert.equal(summary.riskScore, 8);
  assert.equal(summary.health, "attention");
});

test("projects persist validated named views with server-owned identities", () => {
  const { service } = harness();
  const project = service.createProject({ name: "Release" }, ACTOR_A).body.project;
  const updated = service.updateProject({
    planningProjectId: project.id,
    expectedRevision: 1,
    savedViews: [{
      name: "Quarter risks",
      view: "roadmap",
      filters: { status: "blocked", priority: "all", milestone: "M3", due: "quarter" },
    }],
  }, ACTOR_A);
  assert.equal(updated.status, 200);
  assert.match(updated.body.project.savedViews[0].id, /^ppv_/);
  assert.equal(updated.body.project.savedViews[0].filters.due, "quarter");
  assert.equal(service.updateProject({
    planningProjectId: project.id,
    expectedRevision: 2,
    savedViews: [{ name: "", view: "roadmap", filters: {} }],
  }, ACTOR_A).status, 400);
});
