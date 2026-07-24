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
  assert.deepEqual(detail.activity.slice(0, 2).map((entry) => entry.action), ["item_added", "created"]);
  assert.equal(service.removeItem({ planningProjectId: project.id, workItemId: "wi_a" }, ACTOR_A).status, 200);
  const afterRemoval = service.getProject({ planningProjectId: project.id }, ACTOR_A).body.project;
  assert.equal(afterRemoval.itemCount, 0);
  assert.equal(afterRemoval.activity[0].action, "item_removed");
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
  state.workItems[0].estimatePoints = 5;
  state.workItems[0].dependencyIds = ["wi_dependency"];
  state.workItems[0].executionBindings = [{ kind: "auto_run", targetId: "aur_1" }];
  state.workItems.push({
    id: "wi_dependency", ownerTeamId: "team_a", status: "ready", state: "open",
  });
  state.autoRuns = [{ id: "aur_1", status: "failed" }];
  const project = service.createProject({ name: "At risk", capacityPoints: 3 }, ACTOR_A).body.project;
  service.addItem({ planningProjectId: project.id, workItemId: "wi_a" }, ACTOR_A);
  const summary = service.listProjects({}, ACTOR_A).body.projects[0];
  assert.equal(summary.blockedItemCount, 1);
  assert.equal(summary.overdueItemCount, 1);
  assert.equal(summary.failedRunCount, 1);
  assert.equal(summary.riskScore, 11);
  assert.equal(summary.health, "attention");
  assert.equal(summary.plannedPoints, 5);
  assert.equal(summary.capacityUtilization, 167);
  assert.equal(summary.overCapacity, true);
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

test("projects can be duplicated as reusable configuration templates", () => {
  const { service } = harness();
  const source = service.createProject({
    name: "Source", description: "Release workflow", color: "violet",
  }, ACTOR_A).body.project;
  const configured = service.updateProject({
    planningProjectId: source.id,
    expectedRevision: 1,
    savedViews: [{
      name: "Risks", view: "board",
      filters: { status: "blocked", priority: "all", milestone: "", due: "all" },
    }],
  }, ACTOR_A).body.project;
  service.addItem({ planningProjectId: source.id, workItemId: "wi_a" }, ACTOR_A);
  const copy = service.createProject({
    name: "Source copy", templateProjectId: source.id,
  }, ACTOR_A);
  assert.equal(copy.status, 201);
  assert.equal(copy.body.project.description, "Release workflow");
  assert.equal(copy.body.project.color, "violet");
  assert.equal(copy.body.project.savedViews[0].name, "Risks");
  assert.notEqual(copy.body.project.savedViews[0].id, configured.savedViews[0].id);
  assert.equal(copy.body.project.itemCount, 0);
  assert.equal(service.createProject({
    name: "No access", templateProjectId: "missing",
  }, ACTOR_A).status, 404);
});

test("projects validate and persist automation rules", () => {
  const { service } = harness();
  const project = service.createProject({ name: "Triage" }, ACTOR_A).body.project;
  const updated = service.updateProject({
    planningProjectId: project.id,
    expectedRevision: 1,
    automationRules: [{ status: "ready", priority: "p1", type: "bug", label: "release" }],
  }, ACTOR_A);
  assert.equal(updated.status, 200);
  assert.match(updated.body.project.automationRules[0].id, /^par_/);
  assert.equal(service.updateProject({
    planningProjectId: project.id,
    expectedRevision: 2,
    automationRules: [{ status: "", priority: "", type: "", label: "" }],
  }, ACTOR_A).status, 400);
});

test("project creation imports validated template configuration", () => {
  const { service } = harness();
  const imported = service.createProject({
    name: "Imported",
    savedViews: [{
      name: "Ready", view: "list",
      filters: { status: "ready", priority: "all", milestone: "", due: "all" },
    }],
    automationRules: [{ status: "ready", priority: "", type: "", label: "" }],
  }, ACTOR_A);
  assert.equal(imported.status, 201);
  assert.match(imported.body.project.savedViews[0].id, /^ppv_/);
  assert.match(imported.body.project.automationRules[0].id, /^par_/);
  assert.equal(service.createProject({
    name: "Invalid import", savedViews: [{}],
  }, ACTOR_A).status, 400);
});

test("project capacity is validated and revision gated", () => {
  const { service } = harness();
  const project = service.createProject({ name: "Capacity", capacityPoints: 20 }, ACTOR_A).body.project;
  assert.equal(project.capacityPoints, 20);
  const updated = service.updateProject({
    planningProjectId: project.id, expectedRevision: 1, capacityPoints: 30,
  }, ACTOR_A);
  assert.equal(updated.body.project.capacityPoints, 30);
  assert.equal(service.createProject({ name: "Invalid", capacityPoints: -1 }, ACTOR_A).status, 400);
});

test("project schedule is validated and exposes delivery risk", () => {
  const { service } = harness();
  const project = service.createProject({
    name: "Scheduled", startDate: "2026-07-01", targetDate: "2026-07-20",
  }, ACTOR_A).body.project;
  service.addItem({ planningProjectId: project.id, workItemId: "wi_a" }, ACTOR_A);
  const detail = service.getProject({ planningProjectId: project.id }, ACTOR_A).body.project;
  assert.equal(detail.startDate, "2026-07-01");
  assert.equal(detail.targetDate, "2026-07-20");
  assert.equal(detail.projectOverdue, true);
  assert.equal(detail.daysRemaining, -4);
  assert.equal(detail.riskScore, 3);
  assert.equal(detail.health, "attention");
  assert.equal(service.createProject({
    name: "Invalid schedule", startDate: "2026-08-01", targetDate: "2026-07-31",
  }, ACTOR_A).status, 400);
  assert.equal(service.updateProject({
    planningProjectId: project.id, expectedRevision: 1,
    startDate: "not-a-date",
  }, ACTOR_A).status, 400);
});

test("project ownership defaults to the creator and can be reassigned or cleared", () => {
  const { service } = harness();
  const project = service.createProject({ name: "Owned" }, ACTOR_A).body.project;
  assert.equal(project.ownerId, "usr_a");
  assert.equal(project.unowned, false);
  const reassigned = service.updateProject({
    planningProjectId: project.id, expectedRevision: 1, ownerId: "usr_release",
  }, ACTOR_A).body.project;
  assert.equal(reassigned.ownerId, "usr_release");
  const cleared = service.updateProject({
    planningProjectId: project.id, expectedRevision: 2, ownerId: null,
  }, ACTOR_A).body.project;
  assert.equal(cleared.unowned, true);
  assert.equal(cleared.riskScore, 1);
  assert.equal(cleared.health, "attention");
  assert.equal(service.updateProject({
    planningProjectId: project.id, expectedRevision: 3, ownerId: "x".repeat(201),
  }, ACTOR_A).status, 400);
});

test("project status is validated and completed projects suppress delivery risk", () => {
  const { service } = harness();
  const project = service.createProject({
    name: "Lifecycle", status: "planned", targetDate: "2026-07-20",
  }, ACTOR_A).body.project;
  assert.equal(project.status, "planned");
  service.addItem({ planningProjectId: project.id, workItemId: "wi_a" }, ACTOR_A);
  const completed = service.updateProject({
    planningProjectId: project.id, expectedRevision: 1, status: "completed",
  }, ACTOR_A).body.project;
  assert.equal(completed.projectOverdue, false);
  assert.equal(completed.riskScore, 0);
  assert.equal(completed.health, "healthy");
  assert.equal(service.updateProject({
    planningProjectId: project.id, expectedRevision: 2, status: "unknown",
  }, ACTOR_A).status, 400);
  assert.equal(service.createProject({ name: "Invalid", status: "unknown" }, ACTOR_A).status, 400);
});
