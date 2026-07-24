/*
 * Local-first work items. These records deliberately live beside, rather than
 * inside, repository Projects: a repository is an execution boundary while a
 * work item is planning data that may later bind to GitHub or another tracker.
 */

import { actorCanAccessProject, LOCAL_TEAM_ID, LOCAL_USER_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const TYPES = new Set(["task", "bug", "feature", "initiative"]);
const STATUSES = new Set(["backlog", "ready", "in_progress", "review", "blocked", "done"]);
const PRIORITIES = new Set(["p0", "p1", "p2", "p3"]);
const MAX_TITLE = 300;
const MAX_BODY = 200_000;
const MAX_LABELS = 50;
const MAX_COMMENT = 100_000;
const MAX_MILESTONE = 200;

function strings(values, { limit = MAX_LABELS, maxLength = 100 } = {}) {
  if (!Array.isArray(values)) return null;
  const normalized = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
  if (normalized.length > limit || normalized.some((value) => value.length > maxLength)) return null;
  return normalized;
}

function validDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validateDraft(input, { partial = false } = {}) {
  const value = {};
  if (!partial || Object.hasOwn(input, "title")) {
    const title = String(input.title ?? "").trim();
    if (!title || title.length > MAX_TITLE) return { error: "invalid_work_item_title" };
    value.title = title;
  }
  if (!partial || Object.hasOwn(input, "body")) {
    const body = String(input.body ?? "");
    if (body.length > MAX_BODY) return { error: "work_item_body_too_large" };
    value.body = body;
  }
  for (const [field, allowed, fallback] of [
    ["type", TYPES, "task"],
    ["status", STATUSES, "backlog"],
    ["priority", PRIORITIES, "p2"],
  ]) {
    if (!partial || Object.hasOwn(input, field)) {
      const candidate = String(input[field] ?? fallback);
      if (!allowed.has(candidate)) return { error: `invalid_work_item_${field}` };
      value[field] = candidate;
    }
  }
  for (const field of ["labels", "assigneeIds"]) {
    if (!partial || Object.hasOwn(input, field)) {
      const normalized = strings(input[field] ?? []);
      if (!normalized) return { error: `invalid_work_item_${field}` };
      value[field] = normalized;
    }
  }
  if (!partial || Object.hasOwn(input, "acceptanceCriteria")) {
    const acceptanceCriteria = strings(input.acceptanceCriteria ?? [], { limit: 100, maxLength: 2_000 });
    if (!acceptanceCriteria) return { error: "invalid_work_item_acceptance_criteria" };
    value.acceptanceCriteria = acceptanceCriteria;
  }
  if (!partial || Object.hasOwn(input, "dueDate")) {
    const dueDate = input.dueDate == null || input.dueDate === "" ? null : String(input.dueDate);
    if (dueDate && !validDateOnly(dueDate)) return { error: "invalid_work_item_due_date" };
    value.dueDate = dueDate;
  }
  if (!partial || Object.hasOwn(input, "milestone")) {
    const milestone = input.milestone == null ? "" : String(input.milestone).trim();
    if (milestone.length > MAX_MILESTONE) return { error: "invalid_work_item_milestone" };
    value.milestone = milestone;
  }
  return { value };
}

export function createWorkItemService({
  state,
  now,
  nextId,
  appendEvent = () => {},
  persistStateSoon = () => {},
  store,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  const actorTeam = (actor) => actor?.teamId ?? LOCAL_TEAM_ID;
  const actorUser = (actor) => actor?.userId ?? LOCAL_USER_ID;
  const notFound = () => ({ ok: false, status: 404, body: { error: "work_item_not_found" } });
  const commentNotFound = () => ({ ok: false, status: 404, body: { error: "work_item_comment_not_found" } });

  function recordActivity(item, actor, action, details = {}) {
    const activity = {
      id: nextId("wia"),
      workItemId: item.id,
      ownerTeamId: item.ownerTeamId,
      projectId: item.projectId,
      action,
      actorId: actorUser(actor),
      createdAt: now(),
      details,
    };
    (state.workItemActivities ??= []).unshift(activity);
    return activity;
  }

  function findOwn(id, actor) {
    const item = (state.workItems ?? []).find((row) => row.id === String(id));
    return item && item.ownerTeamId === actorTeam(actor) ? item : null;
  }

  function applyPlanningAutomation(item, actor) {
    const matchingProjects = (state.planningProjects ?? []).filter((project) =>
      project.ownerTeamId === actorTeam(actor) && !project.archivedAt
      && (project.automationRules ?? []).some((rule) =>
        (!rule.status || rule.status === item.status)
        && (!rule.priority || rule.priority === item.priority)
        && (!rule.type || rule.type === item.type)
        && (!rule.label || item.labels.includes(rule.label))));
    for (const project of matchingProjects) {
      const memberships = (state.planningProjectItems ?? []).filter((row) =>
        row.ownerTeamId === actorTeam(actor) && row.planningProjectId === project.id);
      if (memberships.some((row) => row.workItemId === item.id)) continue;
      (state.planningProjectItems ??= []).push({
        id: nextId("ppi"),
        ownerTeamId: project.ownerTeamId,
        planningProjectId: project.id,
        workItemId: item.id,
        position: Math.max(0, ...memberships.map((row) => Number(row.position) || 0)) + 1_000,
        addedAt: now(),
        addedBy: "usr_planning_automation",
      });
      recordActivity(item, actor, "planning_auto_added", { planningProjectId: project.id });
      appendEvent({
        invocationId: null, type: "planning_project_item_auto_added", level: "info",
        message: `${item.localRef} automatically added to ${project.name}.`,
        data: { planningProjectId: project.id, workItemId: item.id, actorTeamId: actorTeam(actor) },
      });
    }
  }

  function workItemView(item, actor) {
    const memberships = (state.planningProjectItems ?? []).filter(
      (row) => row.workItemId === item.id && row.ownerTeamId === actorTeam(actor),
    );
    return {
      ...item,
      dependencyIds: item.dependencyIds ?? [],
      blockedBy: (item.dependencyIds ?? []).map((dependencyId) => {
        const dependency = findOwn(dependencyId, actor);
        return dependency ? {
          id: dependency.id,
          localRef: dependency.localRef,
          title: dependency.title,
          status: dependency.status,
          state: dependency.state,
          resolved: dependency.status === "done" || dependency.state === "closed",
        } : null;
      }).filter(Boolean),
      blocks: (state.workItems ?? [])
        .filter((candidate) => candidate.ownerTeamId === actorTeam(actor)
          && (candidate.dependencyIds ?? []).includes(item.id))
        .map((candidate) => ({
          id: candidate.id, localRef: candidate.localRef, title: candidate.title,
          status: candidate.status, state: candidate.state,
        })),
      planningProjects: memberships.map((membership) => {
        const project = (state.planningProjects ?? []).find(
          (row) => row.id === membership.planningProjectId && row.ownerTeamId === actorTeam(actor),
        );
        return project ? { id: project.id, name: project.name, archivedAt: project.archivedAt } : null;
      }).filter(Boolean),
    };
  }

  function listWorkItems(query = {}, actor = null) {
    const q = String(query.q ?? "").trim().toLowerCase();
    const planningProjectId = String(query.planningProjectId ?? "");
    const planningWorkItemIds = planningProjectId
      ? new Set((state.planningProjectItems ?? [])
        .filter((row) => row.ownerTeamId === actorTeam(actor) && row.planningProjectId === planningProjectId)
        .map((row) => row.workItemId))
      : null;
    const rows = (state.workItems ?? [])
      .filter((item) => item.ownerTeamId === actorTeam(actor))
      .filter((item) => !planningWorkItemIds || planningWorkItemIds.has(item.id))
      .filter((item) => !query.projectId || item.projectId === query.projectId)
      .filter((item) => !query.status || item.status === query.status)
      .filter((item) => !query.type || item.type === query.type)
      .filter((item) => !query.assigneeId || item.assigneeIds.includes(query.assigneeId))
      .filter((item) => query.includeArchived === "1" || !item.archivedAt)
      .filter((item) => !q || `${item.localRef} ${item.title} ${item.body} ${item.labels.join(" ")}`.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((item) => workItemView(item, actor));
    return { ok: true, status: 200, body: { workItems: rows, count: rows.length } };
  }

  function getWorkItem({ workItemId }, actor = null) {
    const item = findOwn(workItemId, actor);
    return item ? { ok: true, status: 200, body: { workItem: workItemView(item, actor) } } : notFound();
  }

  function createWorkItem(input = {}, actor = null) {
    const projectId = String(input.projectId ?? "");
    if (!projectId || !actorCanAccessProject(state, actor, projectId)) {
      return { ok: false, status: 404, body: { error: "project_not_found" } };
    }
    const validated = validateDraft(input);
    if (validated.error) return { ok: false, status: 400, body: { error: validated.error } };
    const teamId = actorTeam(actor);
    const localNumber = 1 + Math.max(0, ...(state.workItems ?? [])
      .filter((item) => item.ownerTeamId === teamId)
      .map((item) => Number(item.localNumber) || 0));
    const timestamp = now();
    const workItem = {
      id: nextId("lwi"),
      localNumber,
      localRef: `LOCAL-${localNumber}`,
      ownerTeamId: teamId,
      projectId,
      ...validated.value,
      dependencyIds: [],
      revision: 1,
      state: "open",
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      lastModifiedBy: actorUser(actor),
      externalBindings: [],
      executionBindings: [],
    };
    runTx(() => {
      (state.workItems ??= []).unshift(workItem);
      recordActivity(workItem, actor, "created", {
        title: workItem.title, type: workItem.type, status: workItem.status, priority: workItem.priority,
      });
      applyPlanningAutomation(workItem, actor);
      appendEvent({
        invocationId: null,
        type: "work_item_created",
        level: "info",
        message: `${workItem.localRef} created.`,
        data: { workItemId: workItem.id, localRef: workItem.localRef, projectId, actorTeamId: teamId },
      });
    });
    return { ok: true, status: 201, body: { workItem } };
  }

  function updateWorkItem({ workItemId, expectedRevision, ...changes } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    const validated = validateDraft(changes, { partial: true });
    if (validated.error) return { ok: false, status: 400, body: { error: validated.error } };
    if (Object.hasOwn(changes, "projectId")) {
      const projectId = String(changes.projectId ?? "");
      if (!projectId || !actorCanAccessProject(state, actor, projectId)) {
        return { ok: false, status: 404, body: { error: "project_not_found" } };
      }
      validated.value.projectId = projectId;
    }
    if (Object.hasOwn(changes, "dependencyIds")) {
      if (!Array.isArray(changes.dependencyIds)) {
        return { ok: false, status: 400, body: { error: "invalid_work_item_dependencies" } };
      }
      const dependencyIds = [...new Set(changes.dependencyIds.map(String))];
      if (dependencyIds.length > 50 || dependencyIds.includes(item.id)
        || dependencyIds.some((id) => !findOwn(id, actor))) {
        return { ok: false, status: 400, body: { error: "invalid_work_item_dependencies" } };
      }
      const reachesItem = (candidateId, visited = new Set()) => {
        if (candidateId === item.id) return true;
        if (visited.has(candidateId)) return false;
        visited.add(candidateId);
        const candidate = findOwn(candidateId, actor);
        return (candidate?.dependencyIds ?? []).some((id) => reachesItem(id, visited));
      };
      if (dependencyIds.some((id) => reachesItem(id))) {
        return { ok: false, status: 409, body: { error: "work_item_dependency_cycle" } };
      }
      validated.value.dependencyIds = dependencyIds;
    }
    const previous = Object.fromEntries(Object.keys(validated.value).map((key) => [key, item[key]]));
    runTx(() => {
      Object.assign(item, validated.value, {
        revision: item.revision + 1,
        updatedAt: now(),
        lastModifiedBy: actorUser(actor),
      });
      recordActivity(item, actor, "updated", {
        changes: Object.fromEntries(Object.entries(validated.value).map(([key, value]) => [
          key, { from: previous[key], to: value },
        ])),
      });
      applyPlanningAutomation(item, actor);
      appendEvent({
        invocationId: null,
        type: "work_item_updated",
        level: "info",
        message: `${item.localRef} updated.`,
        data: { workItemId: item.id, revision: item.revision, actorTeamId: actorTeam(actor) },
      });
    });
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor) } };
  }

  function bulkUpdateWorkItems({ items, changes } = {}, actor = null) {
    if (!Array.isArray(items) || items.length === 0 || items.length > 100 || !changes || typeof changes !== "object") {
      return { ok: false, status: 400, body: { error: "invalid_work_item_bulk_update" } };
    }
    const unique = new Map();
    for (const row of items) {
      const id = String(row?.id ?? "");
      if (!id || !Number.isInteger(row?.expectedRevision) || unique.has(id)) {
        return { ok: false, status: 400, body: { error: "invalid_work_item_bulk_update" } };
      }
      unique.set(id, row.expectedRevision);
    }
    const allowedChanges = Object.fromEntries(
      Object.entries(changes).filter(([key]) => ["status", "priority", "assigneeIds", "dueDate", "milestone"].includes(key)),
    );
    if (Object.keys(allowedChanges).length === 0 || Object.keys(allowedChanges).length !== Object.keys(changes).length) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_bulk_changes" } };
    }
    const validated = validateDraft(allowedChanges, { partial: true });
    if (validated.error) return { ok: false, status: 400, body: { error: validated.error } };
    const targets = [];
    for (const [id, expectedRevision] of unique) {
      const item = findOwn(id, actor);
      if (!item) return notFound();
      if (item.revision !== expectedRevision) {
        return {
          ok: false, status: 409,
          body: { error: "work_item_revision_conflict", workItemId: item.id, currentRevision: item.revision },
        };
      }
      targets.push(item);
    }
    runTx(() => {
      for (const item of targets) {
        const previous = Object.fromEntries(Object.keys(validated.value).map((key) => [key, item[key]]));
        Object.assign(item, validated.value, {
          revision: item.revision + 1,
          updatedAt: now(),
          lastModifiedBy: actorUser(actor),
        });
        recordActivity(item, actor, "bulk_updated", {
          changes: Object.fromEntries(Object.entries(validated.value).map(([key, value]) => [
            key, { from: previous[key], to: value },
          ])),
        });
      }
    });
    return {
      ok: true, status: 200,
      body: { workItems: targets.map((item) => workItemView(item, actor)), count: targets.length },
    };
  }

  function transitionWorkItem({ workItemId, expectedRevision, action } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    if (!["close", "reopen", "archive", "restore"].includes(action)) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_action" } };
    }
    const pastTense = { close: "closed", reopen: "reopened", archive: "archived", restore: "restored" }[action];
    runTx(() => {
      if (action === "close") item.state = "closed";
      if (action === "reopen") item.state = "open";
      if (action === "archive") item.archivedAt = now();
      if (action === "restore") item.archivedAt = null;
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, action, { state: item.state, archivedAt: item.archivedAt });
      appendEvent({
        invocationId: null,
        type: `work_item_${pastTense}`,
        level: "info",
        message: `${item.localRef} ${pastTense}.`,
        data: { workItemId: item.id, revision: item.revision, actorTeamId: actorTeam(actor) },
      });
    });
    return { ok: true, status: 200, body: { workItem: item } };
  }

  function listActivity({ workItemId } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const activities = (state.workItemActivities ?? [])
      .filter((row) => row.workItemId === item.id && row.ownerTeamId === actorTeam(actor))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, status: 200, body: { activities, count: activities.length } };
  }

  function listComments({ workItemId } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const comments = (state.workItemComments ?? [])
      .filter((row) => row.workItemId === item.id && row.ownerTeamId === actorTeam(actor))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { ok: true, status: 200, body: { comments, count: comments.length } };
  }

  function createComment({ workItemId, body } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const content = String(body ?? "").trim();
    if (!content || content.length > MAX_COMMENT) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_comment" } };
    }
    const timestamp = now();
    const comment = {
      id: nextId("wic"),
      workItemId: item.id,
      ownerTeamId: item.ownerTeamId,
      projectId: item.projectId,
      body: content,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      lastModifiedBy: actorUser(actor),
      deletedAt: null,
    };
    runTx(() => {
      (state.workItemComments ??= []).push(comment);
      recordActivity(item, actor, "commented", { commentId: comment.id });
      appendEvent({
        invocationId: null,
        type: "work_item_commented",
        level: "info",
        message: `${item.localRef} received a comment.`,
        data: { workItemId: item.id, commentId: comment.id, actorTeamId: actorTeam(actor) },
      });
    });
    return { ok: true, status: 201, body: { comment } };
  }

  function findOwnComment(item, commentId, actor) {
    return (state.workItemComments ?? []).find(
      (row) => row.id === String(commentId) && row.workItemId === item.id && row.ownerTeamId === actorTeam(actor),
    ) ?? null;
  }

  function updateComment({ workItemId, commentId, expectedRevision, body } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const comment = findOwnComment(item, commentId, actor);
    if (!comment || comment.deletedAt) return commentNotFound();
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (expectedRevision !== comment.revision) {
      return { ok: false, status: 409, body: { error: "work_item_comment_revision_conflict", currentRevision: comment.revision } };
    }
    const content = String(body ?? "").trim();
    if (!content || content.length > MAX_COMMENT) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_comment" } };
    }
    runTx(() => {
      comment.body = content;
      comment.revision += 1;
      comment.updatedAt = now();
      comment.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "comment_updated", { commentId: comment.id, revision: comment.revision });
    });
    return { ok: true, status: 200, body: { comment } };
  }

  function deleteComment({ workItemId, commentId, expectedRevision } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const comment = findOwnComment(item, commentId, actor);
    if (!comment || comment.deletedAt) return commentNotFound();
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (expectedRevision !== comment.revision) {
      return { ok: false, status: 409, body: { error: "work_item_comment_revision_conflict", currentRevision: comment.revision } };
    }
    runTx(() => {
      comment.body = null;
      comment.deletedAt = now();
      comment.updatedAt = comment.deletedAt;
      comment.revision += 1;
      comment.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "comment_deleted", { commentId: comment.id });
    });
    return { ok: true, status: 200, body: { comment } };
  }

  function recordExecutionBinding({ workItemId, kind, targetId, worktreeId = null } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!["worktree", "auto_run"].includes(kind) || !targetId) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_execution_binding" } };
    }
    const binding = { kind, targetId: String(targetId), worktreeId: worktreeId ? String(worktreeId) : null, createdAt: now() };
    runTx(() => {
      item.executionBindings = [...(item.executionBindings ?? []), binding];
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, kind === "worktree" ? "worktree_created" : "auto_run_started", binding);
    });
    return { ok: true, status: 200, body: { workItem: item, binding } };
  }

  return {
    listWorkItems, getWorkItem, createWorkItem, updateWorkItem, bulkUpdateWorkItems, transitionWorkItem,
    listActivity, listComments, createComment, updateComment, deleteComment,
    recordExecutionBinding,
  };
}
