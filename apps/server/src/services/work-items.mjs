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
const GITHUB_SYNC_FIELDS = ["title", "body", "state", "labels"];
const VERIFICATION_KINDS = new Set(["test", "lint", "typecheck", "manual", "review"]);
const VERIFICATION_STATUSES = new Set(["passed", "failed"]);

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
  if (!partial || Object.hasOwn(input, "estimatePoints")) {
    const estimatePoints = input.estimatePoints == null || input.estimatePoints === "" ? 0 : Number(input.estimatePoints);
    if (!Number.isInteger(estimatePoints) || estimatePoints < 0 || estimatePoints > 1_000) {
      return { error: "invalid_work_item_estimate_points" };
    }
    value.estimatePoints = estimatePoints;
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
      project.activity = [{
        id: nextId("ppa"),
        action: "item_auto_added",
        actorId: "usr_planning_automation",
        createdAt: now(),
        details: { workItemId: item.id, localRef: item.localRef },
      }, ...(project.activity ?? [])].slice(0, 100);
      recordActivity(item, actor, "planning_auto_added", { planningProjectId: project.id });
      appendEvent({
        invocationId: null, type: "planning_project_item_auto_added", level: "info",
        message: `${item.localRef} automatically added to ${project.name}.`,
        data: { planningProjectId: project.id, workItemId: item.id, actorTeamId: actorTeam(actor) },
      });
    }
  }

  function executionState(item) {
    const latestBinding = [...(item.executionBindings ?? [])]
      .reverse()
      .find((binding) => binding.kind === "auto_run");
    const run = latestBinding
      ? (state.autoRuns ?? []).find((candidate) => candidate.id === latestBinding.targetId)
      : null;
    if (run) {
      if (["materializing", "running", "publishing"].includes(run.status)) return "running";
      if (["awaiting_approval", "needs_input"].includes(run.status)) return "awaiting_approval";
      if (["verifying", "pr_open", "report_posted", "plan_proposed"].includes(run.status)) return "verifying";
      if (["blocked", "failed"].includes(run.status)) return "failed";
      if (["done", "decomposed"].includes(run.status)) return "completed";
    }
    const claimActive = item.claim?.status === "active"
      && Date.parse(item.claim.leaseExpiresAt) > Date.parse(now());
    return claimActive ? "claimed" : "unclaimed";
  }

  function completionGate(item) {
    if (!(item.acceptanceCriteria ?? []).length) return { ready: true, missingCriteria: [], verificationRequired: false };
    const passed = new Set((item.acceptanceResults ?? [])
      .filter((result) => result.status === "passed")
      .map((result) => result.criterion));
    const missingCriteria = item.acceptanceCriteria.filter((criterion) => !passed.has(criterion));
    const verificationRequired = !(item.verificationRecords ?? []).some((record) => record.status === "passed");
    return { ready: missingCriteria.length === 0 && !verificationRequired, missingCriteria, verificationRequired };
  }

  function workItemView(item, actor) {
    const { createIdempotencyKey: _createIdempotencyKey, ...publicItem } = item;
    const derivedExecutionState = executionState(item);
    const memberships = (state.planningProjectItems ?? []).filter(
      (row) => row.workItemId === item.id && row.ownerTeamId === actorTeam(actor),
    );
    const parent = item.parentId ? findOwn(item.parentId, actor) : null;
    const subIssues = (state.workItems ?? []).filter(
      (candidate) => candidate.ownerTeamId === actorTeam(actor) && candidate.parentId === item.id,
    );
    const completedSubIssues = subIssues.filter(
      (candidate) => candidate.status === "done" || candidate.state === "closed",
    ).length;
    return {
      ...publicItem,
      businessState: item.state,
      planningStatus: item.status,
      executionState: derivedExecutionState,
      statusModel: {
        business: item.state,
        planning: item.status,
        execution: derivedExecutionState,
      },
      completionGate: completionGate(item),
      parent: parent ? {
        id: parent.id, localRef: parent.localRef, title: parent.title,
        status: parent.status, state: parent.state,
      } : null,
      subIssues: subIssues.map((candidate) => ({
        id: candidate.id, localRef: candidate.localRef, title: candidate.title,
        status: candidate.status, state: candidate.state,
      })),
      subIssuesSummary: {
        total: subIssues.length,
        completed: completedSubIssues,
        percentCompleted: subIssues.length ? Math.round((completedSubIssues / subIssues.length) * 100) : 0,
      },
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

  function githubBinding(item) {
    return (item.externalBindings ?? []).find((binding) => binding.kind === "github_issue") ?? null;
  }

  function normalizeGithubSnapshot(input = {}) {
    const number = Number(input.number);
    const title = String(input.title ?? "").trim();
    const body = String(input.body ?? "");
    const remoteState = String(input.state ?? "").toLowerCase();
    const labels = strings(input.labels ?? []);
    const updatedAt = String(input.updatedAt ?? "");
    if (!Number.isInteger(number) || number < 1 || !title || title.length > MAX_TITLE
      || body.length > MAX_BODY || !["open", "closed"].includes(remoteState)
      || !labels || !Number.isFinite(Date.parse(updatedAt))) return null;
    return {
      number, title, body, state: remoteState, labels,
      url: input.url == null ? null : String(input.url),
      repository: input.repository == null ? null : String(input.repository),
      updatedAt,
    };
  }

  function bindGithubIssue({ workItemId, expectedRevision, remote } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    const snapshot = normalizeGithubSnapshot(remote);
    if (!snapshot) return { ok: false, status: 400, body: { error: "invalid_github_issue_snapshot" } };
    if (githubBinding(item)) return { ok: false, status: 409, body: { error: "github_issue_already_bound" } };
    const duplicate = (state.workItems ?? []).find((candidate) =>
      candidate.ownerTeamId === actorTeam(actor) && candidate.projectId === item.projectId
      && (candidate.externalBindings ?? []).some((binding) =>
        binding.kind === "github_issue" && binding.number === snapshot.number));
    if (duplicate) return { ok: false, status: 409, body: { error: "github_issue_already_linked", workItemId: duplicate.id } };
    const binding = {
      kind: "github_issue", number: snapshot.number, url: snapshot.url, repository: snapshot.repository,
      syncedLocalRevision: item.revision, remoteUpdatedAt: snapshot.updatedAt,
      baseline: Object.fromEntries(GITHUB_SYNC_FIELDS.map((field) => [field, snapshot[field]])),
      conflict: null, lastSyncedAt: now(),
    };
    runTx(() => {
      item.externalBindings.push(binding);
      recordActivity(item, actor, "github_linked", { number: snapshot.number, url: snapshot.url });
    });
    return { ok: true, status: 201, body: { workItem: workItemView(item, actor), binding } };
  }

  function syncGithubIssue({ workItemId, expectedRevision, direction, remote, pushedRemoteUpdatedAt } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const binding = githubBinding(item);
    if (!binding) return { ok: false, status: 409, body: { error: "github_issue_not_bound" } };
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    if (["resolve_local", "resolve_remote"].includes(direction)) {
      if (!binding.conflict) return { ok: false, status: 409, body: { error: "github_sync_conflict_not_found" } };
      const conflict = binding.conflict;
      runTx(() => {
        if (direction === "resolve_remote") {
          Object.assign(item, conflict.remote, {
            revision: item.revision + 1, updatedAt: now(), lastModifiedBy: actorUser(actor),
          });
        }
        binding.conflict = null;
        binding.syncedLocalRevision = item.revision;
        recordActivity(item, actor, direction === "resolve_remote" ? "github_conflict_remote_selected" : "github_conflict_local_selected", {
          number: binding.number, fields: conflict.fields,
        });
      });
      const payload = Object.fromEntries(GITHUB_SYNC_FIELDS.map((field) => [field, item[field]]));
      return {
        ok: true, status: 200,
        body: { action: direction === "resolve_remote" ? "resolved_remote" : "push_required", issueNumber: binding.number, payload, workItem: workItemView(item, actor) },
      };
    }
    if (direction === "push") {
      if (binding.conflict) return { ok: false, status: 409, body: { error: "github_sync_conflict", conflict: binding.conflict } };
      const payload = Object.fromEntries(GITHUB_SYNC_FIELDS.map((field) => [field, item[field]]));
      if (!pushedRemoteUpdatedAt) {
        return { ok: true, status: 200, body: { action: "push_required", issueNumber: binding.number, payload, workItem: workItemView(item, actor) } };
      }
      if (!Number.isFinite(Date.parse(String(pushedRemoteUpdatedAt)))) {
        return { ok: false, status: 400, body: { error: "invalid_github_sync_confirmation" } };
      }
      runTx(() => {
        binding.baseline = structuredClone(payload);
        binding.syncedLocalRevision = item.revision;
        binding.remoteUpdatedAt = String(pushedRemoteUpdatedAt);
        binding.lastSyncedAt = now();
        recordActivity(item, actor, "github_pushed", { number: binding.number });
      });
      return { ok: true, status: 200, body: { action: "pushed", workItem: workItemView(item, actor) } };
    }
    if (direction !== "pull") return { ok: false, status: 400, body: { error: "invalid_github_sync_direction" } };
    const snapshot = normalizeGithubSnapshot({ ...remote, number: binding.number });
    if (!snapshot) return { ok: false, status: 400, body: { error: "invalid_github_issue_snapshot" } };
    const localChanged = item.revision !== binding.syncedLocalRevision;
    const remoteChanged = snapshot.updatedAt !== binding.remoteUpdatedAt;
    if (!remoteChanged) {
      return { ok: true, status: 200, body: { action: "unchanged", workItem: workItemView(item, actor) } };
    }
    if (localChanged && remoteChanged) {
      const fields = GITHUB_SYNC_FIELDS.filter((field) =>
        JSON.stringify(item[field]) !== JSON.stringify(binding.baseline?.[field])
        && JSON.stringify(snapshot[field]) !== JSON.stringify(binding.baseline?.[field])
        && JSON.stringify(item[field]) !== JSON.stringify(snapshot[field]));
      if (fields.length) {
        const conflict = {
          detectedAt: now(), fields,
          local: Object.fromEntries(fields.map((field) => [field, item[field]])),
          remote: Object.fromEntries(fields.map((field) => [field, snapshot[field]])),
        };
        runTx(() => {
          binding.conflict = conflict;
          recordActivity(item, actor, "github_conflict_detected", { number: binding.number, fields });
        });
        return { ok: false, status: 409, body: { error: "github_sync_conflict", conflict } };
      }
    }
    const merged = Object.fromEntries(GITHUB_SYNC_FIELDS.map((field) => [
      field,
      localChanged && JSON.stringify(item[field]) !== JSON.stringify(binding.baseline?.[field])
        ? item[field]
        : snapshot[field],
    ]));
    runTx(() => {
      Object.assign(item, merged, {
        revision: item.revision + 1, updatedAt: now(), lastModifiedBy: actorUser(actor),
      });
      binding.baseline = Object.fromEntries(GITHUB_SYNC_FIELDS.map((field) => [field, snapshot[field]]));
      binding.syncedLocalRevision = item.revision;
      binding.remoteUpdatedAt = snapshot.updatedAt;
      binding.lastSyncedAt = now();
      binding.conflict = null;
      recordActivity(item, actor, "github_pulled", { number: binding.number });
    });
    return { ok: true, status: 200, body: { action: "pulled", workItem: workItemView(item, actor) } };
  }

  function createWorkItem(input = {}, actor = null) {
    const projectId = String(input.projectId ?? "");
    if (!projectId || !actorCanAccessProject(state, actor, projectId)) {
      return { ok: false, status: 404, body: { error: "project_not_found" } };
    }
    const idempotencyKey = input.idempotencyKey == null ? null : String(input.idempotencyKey).trim();
    if (idempotencyKey != null && (!idempotencyKey || idempotencyKey.length > 200)) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_idempotency_key" } };
    }
    const replay = idempotencyKey ? (state.workItems ?? []).find(
      (item) => item.ownerTeamId === actorTeam(actor)
        && item.createdBy === actorUser(actor)
        && item.createIdempotencyKey === idempotencyKey,
    ) : null;
    if (replay) return { ok: true, status: 200, body: { workItem: workItemView(replay, actor), replayed: true } };
    const validated = validateDraft(input);
    if (validated.error) return { ok: false, status: 400, body: { error: validated.error } };
    const parentId = input.parentId == null || input.parentId === "" ? null : String(input.parentId);
    const parent = parentId ? findOwn(parentId, actor) : null;
    if (parentId && (!parent || parent.projectId !== projectId)) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_parent" } };
    }
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
      parentId,
      createIdempotencyKey: idempotencyKey,
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
    return { ok: true, status: 201, body: { workItem: workItemView(workItem, actor) } };
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
    if (validated.value.status === "done") {
      const gate = completionGate(item);
      if (!gate.ready) return { ok: false, status: 409, body: { error: "work_item_acceptance_incomplete", ...gate } };
    }
    if (Object.hasOwn(changes, "projectId")) {
      const projectId = String(changes.projectId ?? "");
      if (!projectId || !actorCanAccessProject(state, actor, projectId)) {
        return { ok: false, status: 404, body: { error: "project_not_found" } };
      }
      const relatedIds = [item.parentId, ...(state.workItems ?? [])
        .filter((candidate) => candidate.ownerTeamId === actorTeam(actor) && candidate.parentId === item.id)
        .map((candidate) => candidate.id)].filter(Boolean);
      if (relatedIds.some((id) => findOwn(id, actor)?.projectId !== projectId)) {
        return { ok: false, status: 409, body: { error: "work_item_hierarchy_project_conflict" } };
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
    if (Object.hasOwn(changes, "parentId")) {
      const parentId = changes.parentId == null || changes.parentId === "" ? null : String(changes.parentId);
      const parent = parentId ? findOwn(parentId, actor) : null;
      if (parentId === item.id || (parentId && (!parent || parent.projectId !== (validated.value.projectId ?? item.projectId)))) {
        return { ok: false, status: 400, body: { error: "invalid_work_item_parent" } };
      }
      let candidate = parent;
      const visited = new Set();
      while (candidate) {
        if (candidate.id === item.id) {
          return { ok: false, status: 409, body: { error: "work_item_parent_cycle" } };
        }
        if (visited.has(candidate.id)) break;
        visited.add(candidate.id);
        candidate = candidate.parentId ? findOwn(candidate.parentId, actor) : null;
      }
      validated.value.parentId = parentId;
    }
    const previous = Object.fromEntries(Object.keys(validated.value).map((key) => [key, item[key]]));
    runTx(() => {
      Object.assign(item, validated.value, {
        revision: item.revision + 1,
        updatedAt: now(),
        lastModifiedBy: actorUser(actor),
      });
      if (validated.value.acceptanceCriteria) {
        item.acceptanceResults = (item.acceptanceResults ?? [])
          .filter((result) => validated.value.acceptanceCriteria.includes(result.criterion));
      }
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
      Object.entries(changes).filter(([key]) => ["status", "priority", "assigneeIds", "dueDate", "milestone", "estimatePoints"].includes(key)),
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
    if (validated.value.status === "done") {
      const blocked = targets.find((item) => !completionGate(item).ready);
      if (blocked) return {
        ok: false, status: 409,
        body: { error: "work_item_acceptance_incomplete", workItemId: blocked.id, ...completionGate(blocked) },
      };
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
    if (action === "close") {
      const gate = completionGate(item);
      if (!gate.ready) return { ok: false, status: 409, body: { error: "work_item_acceptance_incomplete", ...gate } };
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

  function recordVerification({
    workItemId, expectedRevision, kind, status, command = null, summary = "", acceptanceResults = [], evidence = [],
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (expectedRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    if (!VERIFICATION_KINDS.has(kind) || !VERIFICATION_STATUSES.has(status)
      || typeof summary !== "string" || summary.length > 10_000
      || (command != null && (typeof command !== "string" || command.length > 2_000))
      || !Array.isArray(acceptanceResults) || !Array.isArray(evidence) || evidence.length > 100) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_verification" } };
    }
    const criteria = new Set(item.acceptanceCriteria ?? []);
    const normalizedResults = acceptanceResults.map((result) => ({
      criterion: String(result?.criterion ?? ""),
      status: String(result?.status ?? ""),
      note: String(result?.note ?? ""),
    }));
    if (normalizedResults.some((result) => !criteria.has(result.criterion)
      || !["passed", "failed", "not_tested"].includes(result.status) || result.note.length > 5_000)) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_acceptance_result" } };
    }
    const normalizedEvidence = evidence.map((entry) => ({
      kind: String(entry?.kind ?? ""),
      ref: String(entry?.ref ?? ""),
      summary: String(entry?.summary ?? ""),
    }));
    if (normalizedEvidence.some((entry) => !["url", "artifact", "commit", "log", "run"].includes(entry.kind)
      || !entry.ref || entry.ref.length > 2_000 || entry.summary.length > 5_000)) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_evidence" } };
    }
    const record = {
      id: nextId("wvr"), kind, status, command, summary,
      evidence: normalizedEvidence, recordedAt: now(), recordedBy: actorUser(actor),
    };
    runTx(() => {
      (item.verificationRecords ??= []).unshift(record);
      const byCriterion = new Map((item.acceptanceResults ?? []).map((result) => [result.criterion, result]));
      for (const result of normalizedResults) byCriterion.set(result.criterion, { ...result, verificationId: record.id, updatedAt: now() });
      item.acceptanceResults = [...byCriterion.values()];
      item.revision += 1;
      item.updatedAt = now();
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "verification_recorded", { verificationId: record.id, kind, status });
    });
    return { ok: true, status: 201, body: { verification: record, workItem: workItemView(item, actor) } };
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

  function claimWorkItem({
    workItemId, agentId = null, leaseMinutes = 30, idempotencyKey = null,
  } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const minutes = Number(leaseMinutes);
    const key = idempotencyKey == null ? null : String(idempotencyKey).trim();
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1_440 || (key != null && (!key || key.length > 200))) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_claim" } };
    }
    const holderId = actorUser(actor);
    const timestamp = now();
    const previousClaim = item.claim ?? null;
    const active = item.claim?.status === "active" && Date.parse(item.claim.leaseExpiresAt) > Date.parse(timestamp);
    if (active && item.claim.claimedBy !== holderId) {
      return { ok: false, status: 409, body: { error: "work_item_already_claimed", claim: item.claim } };
    }
    const claim = {
      id: active && item.claim.claimedBy === holderId ? item.claim.id : nextId("wcl"),
      status: "active",
      claimedBy: holderId,
      agentId: agentId ? String(agentId) : null,
      idempotencyKey: key,
      claimedAt: active && item.claim.claimedBy === holderId ? item.claim.claimedAt : timestamp,
      renewedAt: timestamp,
      leaseExpiresAt: new Date(Date.parse(timestamp) + minutes * 60_000).toISOString(),
    };
    runTx(() => {
      item.claim = claim;
      item.revision += 1;
      item.updatedAt = timestamp;
      item.lastModifiedBy = holderId;
      recordActivity(item, actor, active ? "claim_renewed" : previousClaim?.claimedBy ? "claim_taken_over" : "claimed", {
        claimId: claim.id, agentId: claim.agentId, leaseExpiresAt: claim.leaseExpiresAt,
      });
    });
    return { ok: true, status: active ? 200 : 201, body: { workItem: workItemView(item, actor), claim } };
  }

  function releaseWorkItemClaim({ workItemId, idempotencyKey = null } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    if (!item.claim || item.claim.status !== "active") {
      return { ok: true, status: 200, body: { workItem: workItemView(item, actor), released: false } };
    }
    if (item.claim.claimedBy !== actorUser(actor)) {
      return { ok: false, status: 409, body: { error: "work_item_claim_owned_by_other", claim: item.claim } };
    }
    if (idempotencyKey != null && String(idempotencyKey).trim().length > 200) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_claim" } };
    }
    runTx(() => {
      item.claim = { ...item.claim, status: "released", releasedAt: now(), releasedBy: actorUser(actor) };
      item.revision += 1;
      item.updatedAt = item.claim.releasedAt;
      item.lastModifiedBy = actorUser(actor);
      recordActivity(item, actor, "claim_released", { claimId: item.claim.id });
    });
    return { ok: true, status: 200, body: { workItem: workItemView(item, actor), released: true } };
  }

  return {
    listWorkItems, getWorkItem, createWorkItem, updateWorkItem, bulkUpdateWorkItems, transitionWorkItem,
    listActivity, listComments, createComment, updateComment, deleteComment,
    recordExecutionBinding, claimWorkItem, releaseWorkItemClaim, bindGithubIssue, syncGithubIssue,
    recordVerification,
  };
}
