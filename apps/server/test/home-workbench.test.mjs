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

test("home workbench presents AI clarification as a direct answer, never an approval", () => {
  const result = model([item({
    executionBindings: [{ kind: "auto_run", targetId: "aur_question", createdAt: NOW }],
  })], {
    autoRuns: [{
      id: "aur_question",
      status: "needs_input",
      phase: "waiting_for_input",
      updatedAt: NOW,
      decision: {
        path: "clarify",
        clarifyingQuestions: ["Should the report include archived projects?"],
        suggestedActions: [{ id: "include", label: "Include archived projects" }],
      },
    }],
  });

  const row = result.items[0];
  assert.equal(row.executionState, "claimed");
  assert.equal(row.attentionReason, "ai_needs_input");
  assert.equal(row.secondaryReasons.includes("approval_required"), false);
  assert.deepEqual(row.nextAction, {
    kind: "answer_ai", label: "answer_ai", targetId: "lwi_1", section: "task",
  });
  assert.equal(row.userAction.kind, "answer_question");
  assert.equal(row.userAction.instruction, "Should the report include archived projects?");
  assert.equal(row.userAction.resumeAfterAction, true);
  assert.equal(result.summary.approvals, 0);
});

test("home workbench identifies the concrete prerequisite that blocks a task", () => {
  const dependency = item({ id: "foundation", localRef: "LOCAL-7", title: "Finish data model", waitingOn: "none" });
  const blocked = item({
    id: "delivery",
    localRef: "LOCAL-8",
    title: "Build dashboard",
    status: "blocked",
    waitingOn: "none",
    dependencyIds: [dependency.id],
  });
  const result = model([dependency, blocked]);
  const row = result.items.find((candidate) => candidate.workItemId === blocked.id);

  assert.equal(row.attentionReason, "dependency_blocked");
  assert.equal(row.needsAttention, true);
  assert.equal(row.userAction.kind, "resolve_dependency");
  assert.deepEqual(row.userAction.dependency, {
    id: dependency.id, localRef: dependency.localRef, title: dependency.title,
  });
  assert.deepEqual(row.userAction.target, { section: "task", id: dependency.id });
});

test("home workbench projects an Issue-bound article import as managed execution", () => {
  const result = model([item({
    id: "article-import",
    localRef: "LOCAL-5",
    status: "done",
    state: "closed",
    executionBindings: [{ kind: "article_import", targetId: "article_import_1", createdAt: NOW }],
  })], {
    articleImportJobs: [{
      id: "article_import_1",
      workItemId: "article-import",
      state: "completed",
      createdAt: "2026-08-03T03:58:00.000Z",
      completedAt: NOW,
      result: { markdownPath: "docs/imported/article.md" },
    }],
  });

  const row = result.items[0];
  assert.equal(row.executionKind, "article_import");
  assert.equal(row.executionState, "completed");
  assert.equal(row.executionUpdatedAt, NOW);
  assert.equal(row.userStatus, "completed");
  assert.equal(row.ai, null, "a system import must not be mislabeled as an Agent run");
});

test("home workbench uses only the newest execution binding for state and navigation", () => {
  const result = model([item({
    executionState: "failed",
    waitingOn: "ai",
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
    item({ id: "child", requesterRelation: "child", requesterName: null, waitingOn: "none" }),
  ]);
  assert.equal(result.summary.byRelation.customer, 1);
  assert.equal(result.summary.byRelation.boss, 1);
  assert.equal(result.summary.byRelation.child, 1);
  assert.equal(result.summary.byWaitingOn.requester, 1);
  assert.equal(result.summary.byWaitingOn.ai, 1);
  assert.equal(result.items.find((row) => row.workItemId === "customer").needsAttention, false);
  assert.equal(result.items.find((row) => row.workItemId === "boss").needsAttention, false);
});

test("home workbench only asks for participation when a person can act", () => {
  const result = model([
    item({ id: "mine", waitingOn: "me" }),
    item({ id: "requester-early", waitingOn: "requester", nextFollowUpAt: "2026-08-04T03:00:00.000Z" }),
    item({ id: "requester-due", waitingOn: "requester", nextFollowUpAt: "2026-08-03T03:00:00.000Z" }),
    item({
      id: "ai-running", waitingOn: "ai", dueDate: "2026-08-01",
      nextFollowUpAt: "2026-08-03T03:00:00.000Z", executionState: "running",
      executionBindings: [{ kind: "application_invocation", id: "inv_ai_running" }],
    }),
  ], {
    invocations: [{ id: "inv_ai_running", status: "running", updatedAt: NOW }],
  });

  const byId = Object.fromEntries(result.items.map((row) => [row.workItemId, row]));
  assert.equal(byId.mine.attentionReason, "user_action_required");
  assert.equal(byId.mine.needsAttention, true);
  assert.equal(byId.mine.nextAction.kind, "record_progress");
  assert.equal(byId["requester-early"].attentionReason, null);
  assert.equal(byId["requester-early"].needsAttention, false);
  assert.equal(byId["requester-due"].attentionReason, "follow_up_due");
  assert.equal(byId["requester-due"].needsAttention, true);
  assert.equal(byId["ai-running"].attentionReason, "ai_running");
  assert.equal(byId["ai-running"].needsAttention, false);
});

test("review waiting on me stays actionable when only a worktree claim is active", () => {
  const result = model([item({
    id: "worktree-review",
    status: "review",
    waitingOn: "me",
    claim: {
      status: "active",
      claimedBy: "worktree:wtr_1",
      leaseExpiresAt: "2026-08-03T05:00:00.000Z",
    },
  })]);

  const row = result.items[0];
  assert.equal(row.planningStatus, "review");
  assert.equal(row.executionState, "claimed");
  assert.equal(row.waitingOn, "me");
  assert.equal(row.attentionReason, "user_action_required");
  assert.equal(row.needsAttention, true);
  assert.equal(row.nextAction.kind, "record_progress");
  assert.equal(row.ai, null);
});

test("a posted AI report is a result-review task even when execution projection still says verifying", () => {
  const result = model([item({
    id: "article-review",
    localRef: "LOCAL-64",
    status: "review",
    waitingOn: "me",
    executionState: "verifying",
    executionBindings: [{ kind: "auto_run", targetId: "aur_article", createdAt: NOW }],
  })], {
    autoRuns: [{
      id: "aur_article",
      invocationId: "inv_article",
      status: "report_posted",
      phase: "review_ready",
      report: "# Article report\n\nThe platform turns AI work into a repeatable delivery loop.",
      updatedAt: NOW,
    }],
    invocations: [{ id: "inv_article", status: "succeeded", updatedAt: NOW }],
  });

  const row = result.items[0];
  assert.equal(row.executionState, "verifying", "the expert execution projection remains available");
  assert.equal(row.userStatus, "ready_for_review");
  assert.equal(row.attentionReason, "review_ready");
  assert.equal(row.needsAttention, true);
  assert.deepEqual(row.nextAction, {
    kind: "review_result", label: "review_result", targetId: "article-review", section: "task",
  });
  assert.equal(row.result.status, "available");
  assert.equal(row.result.needsReview, true);
  assert.match(row.result.summary, /repeatable delivery loop/);
});

test("a completed local delivery keeps its readable result on the home card", () => {
  const result = model([item({
    id: "completed-delivery",
    localRef: "LOCAL-59",
    status: "review",
    state: "closed",
    completedAt: NOW,
    waitingOn: "me",
    executionBindings: [{ kind: "auto_run", targetId: "aur_delivery", createdAt: NOW }],
  })], {
    autoRuns: [{
      id: "aur_delivery",
      invocationId: "inv_delivery",
      status: "done",
      link: { type: "local_issue", number: 59, title: "Review DMA protocol" },
      localDelivery: { worktreeId: "wtr_delivery", branchName: "delivery-59" },
      updatedAt: NOW,
    }],
    invocations: [{
      id: "inv_delivery",
      status: "succeeded",
      result: { output: { latestMessage: "The protocol review and quotation checklist are ready." } },
      completedAt: NOW,
      updatedAt: NOW,
    }],
  });

  const row = result.items[0];
  assert.equal(row.userStatus, "completed");
  assert.equal(row.result.status, "available");
  assert.equal(row.result.needsReview, false);
  assert.match(row.result.summary, /quotation checklist are ready/);
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

test("home workbench keeps recent completed work visible but excludes archived work", () => {
  const result = model([
    item({ id: "done", status: "done" }),
    item({ id: "closed", state: "closed" }),
    item({ id: "archived", archivedAt: NOW }),
  ]);
  assert.equal(result.summary.total, 2);
  assert.deepEqual(result.items.map((row) => row.workItemId), ["closed", "done"]);
  assert.equal(result.items[0].planningStatus, "done");
  assert.equal(result.items[0].executionState, "completed");
  assert.equal(result.items[0].waitingOn, "none");
  assert.equal(result.items[0].completedAt, NOW);
});

test("home workbench drops completed work outside the recent visibility window", () => {
  const result = model([item({ id: "old", state: "closed", updatedAt: "2026-06-01T04:00:00.000Z" })]);
  assert.equal(result.summary.total, 0);
});
