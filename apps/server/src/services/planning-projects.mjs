import { LOCAL_TEAM_ID, LOCAL_USER_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const MAX_NAME = 200;
const MAX_DESCRIPTION = 20_000;
const MAX_SAVED_VIEWS = 20;
const PLANNING_VIEWS = new Set(["list", "board", "roadmap", "insights", "executions"]);
const DUE_FILTERS = new Set(["all", "overdue", "upcoming", "month", "quarter", "unscheduled"]);
const WORK_ITEM_STATUSES = new Set(["", "backlog", "ready", "in_progress", "review", "blocked", "done"]);
const WORK_ITEM_PRIORITIES = new Set(["", "p0", "p1", "p2", "p3"]);
const WORK_ITEM_TYPES = new Set(["", "task", "bug", "feature", "initiative"]);
const PROJECT_STATUSES = new Set(["planned", "active", "on_hold", "completed"]);
const RECOMMENDED_ACTION_POLICY = {
  recover_failed_runs: { risk: "high", approvalRequired: true },
  resolve_blocked_items: { risk: "high", approvalRequired: true },
  recover_schedule: { risk: "medium", approvalRequired: false },
  rebalance_capacity: { risk: "medium", approvalRequired: false },
  refresh_status: { risk: "low", approvalRequired: false },
  assign_owner: { risk: "medium", approvalRequired: false },
  set_target_date: { risk: "medium", approvalRequired: false },
};

function validDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function normalizeProjectDate(value) {
  if (value == null || value === "") return null;
  const date = String(value);
  return validDateOnly(date) ? date : undefined;
}

function normalizeProjectOwner(value) {
  if (value == null || value === "") return null;
  const ownerId = String(value).trim();
  return ownerId && ownerId.length <= 200 ? ownerId : undefined;
}

function normalizeProjectTags(value) {
  if (!Array.isArray(value) || value.length > 20) return null;
  const seen = new Set();
  const tags = [];
  for (const candidate of value) {
    const tag = String(candidate ?? "").trim();
    const key = tag.toLowerCase();
    if (!tag || tag.length > 50 || seen.has(key)) return null;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function normalizeSavedViews(value, nextId) {
  if (!Array.isArray(value) || value.length > MAX_SAVED_VIEWS) return null;
  const names = new Set();
  const result = [];
  for (const candidate of value) {
    const name = String(candidate?.name ?? "").trim();
    const view = String(candidate?.view ?? "");
    const filters = candidate?.filters;
    const normalizedName = name.toLowerCase();
    if (!name || name.length > 100 || names.has(normalizedName) || !PLANNING_VIEWS.has(view)
      || !filters || typeof filters !== "object" || !DUE_FILTERS.has(filters.due)
      || typeof filters.status !== "string" || typeof filters.priority !== "string"
      || typeof filters.milestone !== "string" || filters.milestone.length > 200) return null;
    names.add(normalizedName);
    result.push({
      id: String(candidate.id ?? "").trim() || nextId("ppv"),
      name,
      view,
      filters: {
        status: filters.status.slice(0, 40),
        priority: filters.priority.slice(0, 40),
        milestone: filters.milestone,
        due: filters.due,
      },
    });
  }
  return result;
}

function normalizeAutomationRules(value, nextId) {
  if (!Array.isArray(value) || value.length > 20) return null;
  const result = [];
  for (const candidate of value) {
    const status = String(candidate?.status ?? "");
    const priority = String(candidate?.priority ?? "");
    const type = String(candidate?.type ?? "");
    const label = String(candidate?.label ?? "").trim();
    if (!WORK_ITEM_STATUSES.has(status) || !WORK_ITEM_PRIORITIES.has(priority)
      || !WORK_ITEM_TYPES.has(type) || label.length > 100
      || (!status && !priority && !type && !label)) return null;
    result.push({
      id: String(candidate.id ?? "").trim() || nextId("par"),
      status, priority, type, label,
    });
  }
  return result;
}

export function createPlanningProjectService({
  state, now, nextId, appendEvent = () => {}, persistStateSoon = () => {}, store,
  validateApprovalToken = () => ({ approved: false, reason: "approval_unavailable" }),
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  const teamOfActor = (actor) => actor?.teamId ?? LOCAL_TEAM_ID;
  const userOfActor = (actor) => actor?.userId ?? LOCAL_USER_ID;
  const notFound = () => ({ ok: false, status: 404, body: { error: "planning_project_not_found" } });
  const recordActivity = (project, actor, action, details = {}) => {
    const entry = {
      id: nextId("ppa"),
      action,
      actorId: userOfActor(actor),
      createdAt: now(),
      details,
    };
    project.activity = [entry, ...(project.activity ?? [])].slice(0, 100);
    return entry;
  };

  function findOwn(id, actor) {
    const project = (state.planningProjects ?? []).find((row) => row.id === String(id));
    return project && project.ownerTeamId === teamOfActor(actor) ? project : null;
  }

  function visibleMemberships(projectId, actor) {
    return (state.planningProjectItems ?? []).filter(
      (row) => row.planningProjectId === projectId && row.ownerTeamId === teamOfActor(actor),
    ).sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0) || a.addedAt.localeCompare(b.addedAt));
  }

  function projectView(project, actor, { includeItems = false } = {}) {
    const { watcherIds: _watcherIds, ...publicProject } = project;
    const memberships = visibleMemberships(project.id, actor);
    const workItems = memberships.map((membership) => (state.workItems ?? []).find(
      (item) => item.id === membership.workItemId && item.ownerTeamId === teamOfActor(actor),
    )).filter(Boolean);
    const statusCounts = Object.fromEntries(
      ["backlog", "ready", "in_progress", "review", "blocked", "done"]
        .map((status) => [status, workItems.filter((item) => item.status === status).length]),
    );
    const priorityCounts = Object.fromEntries(
      ["p0", "p1", "p2", "p3"].map((priority) => [priority, workItems.filter((item) => item.priority === priority).length]),
    );
    const today = now().slice(0, 10);
    const blockedItemCount = workItems.filter((item) => (item.dependencyIds ?? []).some((dependencyId) => {
      const dependency = (state.workItems ?? []).find(
        (row) => row.id === dependencyId && row.ownerTeamId === teamOfActor(actor),
      );
      return dependency && dependency.status !== "done" && dependency.state !== "closed";
    })).length;
    const overdueItemCount = workItems.filter(
      (item) => item.dueDate && item.dueDate < today && item.status !== "done" && item.state !== "closed",
    ).length;
    const linkedRuns = workItems.flatMap((item) => item.executionBindings ?? [])
      .filter((binding) => binding.kind === "auto_run")
      .map((binding) => (state.autoRuns ?? []).find((run) => run.id === binding.targetId))
      .filter(Boolean);
    const activeRunCount = linkedRuns.filter((run) =>
      ["materializing", "running", "awaiting_approval", "verifying", "publishing"].includes(run.status)).length;
    const failedRunCount = linkedRuns.filter((run) => ["failed", "blocked"].includes(run.status)).length;
    const plannedPoints = workItems.filter((item) => item.status !== "done" && item.state !== "closed")
      .reduce((sum, item) => sum + (Number(item.estimatePoints) || 0), 0);
    const capacityPoints = Number(project.capacityPoints) || 0;
    const overCapacity = capacityPoints > 0 && plannedPoints > capacityPoints;
    const projectOverdue = Boolean(project.status !== "completed" && project.targetDate && project.targetDate < today
      && workItems.some((item) => item.status !== "done" && item.state !== "closed"));
    const daysRemaining = project.targetDate
      ? Math.ceil((Date.parse(`${project.targetDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
      : null;
    const statusReferenceAt = project.statusUpdatedAt ?? project.createdAt ?? project.updatedAt;
    const daysSinceStatusUpdate = statusReferenceAt
      ? Math.max(0, Math.floor((Date.parse(now()) - Date.parse(statusReferenceAt)) / 86_400_000))
      : null;
    const staleStatus = project.status === "active"
      && daysSinceStatusUpdate != null && daysSinceStatusUpdate > 14;
    const unowned = !project.ownerId;
    const rawRiskScore = blockedItemCount * 3 + overdueItemCount * 2 + failedRunCount * 3
      + (overCapacity ? 3 : 0) + (projectOverdue ? 3 : 0) + (unowned ? 1 : 0) + (staleStatus ? 2 : 0);
    const riskScore = project.status === "completed" ? 0 : rawRiskScore;
    const recommendedActions = (project.status === "completed" ? [] : [
      failedRunCount ? { code: "recover_failed_runs", count: failedRunCount } : null,
      blockedItemCount ? { code: "resolve_blocked_items", count: blockedItemCount } : null,
      projectOverdue ? { code: "recover_schedule", count: Math.abs(daysRemaining ?? 0) } : null,
      overCapacity ? { code: "rebalance_capacity", count: Math.max(0, plannedPoints - capacityPoints) } : null,
      staleStatus ? { code: "refresh_status", count: daysSinceStatusUpdate ?? 0 } : null,
      unowned ? { code: "assign_owner", count: 1 } : null,
      !project.targetDate && project.status === "active" ? { code: "set_target_date", count: 1 } : null,
    ].filter(Boolean)).map((action) => ({ ...action, ...RECOMMENDED_ACTION_POLICY[action.code] }));
    return {
      ...publicProject,
      itemCount: memberships.length,
      openItemCount: workItems.filter((item) => item.state === "open").length,
      completedItemCount: workItems.filter((item) => item.status === "done" || item.state === "closed").length,
      statusCounts,
      priorityCounts,
      blockedItemCount,
      overdueItemCount,
      activeRunCount,
      failedRunCount,
      riskScore,
      recommendedActions,
      plannedPoints,
      capacityPoints,
      overCapacity,
      capacityUtilization: capacityPoints > 0 ? Math.round((plannedPoints / capacityPoints) * 100) : null,
      projectOverdue,
      daysRemaining,
      daysSinceStatusUpdate,
      staleStatus,
      watching: (project.watcherIds ?? []).includes(userOfActor(actor)),
      unowned,
      health: project.status === "completed" ? "healthy"
        : riskScore > 0 ? "attention" : activeRunCount > 0 ? "active" : "healthy",
      ...(includeItems ? {
        items: memberships.map((membership) => ({
          membership,
          workItem: (state.workItems ?? []).find(
            (item) => item.id === membership.workItemId && item.ownerTeamId === teamOfActor(actor),
          ) ?? null,
        })).filter((row) => row.workItem),
      } : {}),
    };
  }

  function listProjects(query = {}, actor = null) {
    const q = String(query.q ?? "").trim().toLowerCase();
    const projects = (state.planningProjects ?? [])
      .filter((row) => row.ownerTeamId === teamOfActor(actor))
      .filter((row) => query.includeArchived === "1" || !row.archivedAt)
      .filter((row) => !q || `${row.name} ${row.description} ${row.ownerId ?? ""} ${(row.tags ?? []).join(" ")}`
        .toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((row) => projectView(row, actor));
    return { ok: true, status: 200, body: { projects, count: projects.length } };
  }

  function getProject({ planningProjectId } = {}, actor = null) {
    const project = findOwn(planningProjectId, actor);
    return project
      ? { ok: true, status: 200, body: { project: projectView(project, actor, { includeItems: true }) } }
      : notFound();
  }

  function createProject({
    name, description, color, capacityPoints, startDate, targetDate, ownerId, status, tags, statusSummary, pinned, watching,
    templateProjectId = null, savedViews, automationRules,
  } = {}, actor = null) {
    const template = templateProjectId ? findOwn(templateProjectId, actor) : null;
    if (templateProjectId && !template) return notFound();
    const normalizedName = String(name ?? "").trim();
    const normalizedDescription = String(description ?? template?.description ?? "");
    if (!normalizedName || normalizedName.length > MAX_NAME) {
      return { ok: false, status: 400, body: { error: "invalid_planning_project_name" } };
    }
    if (normalizedDescription.length > MAX_DESCRIPTION) {
      return { ok: false, status: 400, body: { error: "planning_project_description_too_large" } };
    }
    const importedViews = savedViews === undefined ? null : normalizeSavedViews(savedViews, nextId);
    if (savedViews !== undefined && !importedViews) {
      return { ok: false, status: 400, body: { error: "invalid_planning_project_saved_views" } };
    }
    const importedRules = automationRules === undefined ? null : normalizeAutomationRules(automationRules, nextId);
    if (automationRules !== undefined && !importedRules) {
      return { ok: false, status: 400, body: { error: "invalid_planning_project_automation_rules" } };
    }
    const normalizedCapacity = capacityPoints === undefined ? Number(template?.capacityPoints) || 0 : Number(capacityPoints);
    if (!Number.isInteger(normalizedCapacity) || normalizedCapacity < 0 || normalizedCapacity > 1_000_000) {
      return { ok: false, status: 400, body: { error: "invalid_planning_project_capacity_points" } };
    }
    const normalizedStartDate = normalizeProjectDate(startDate === undefined ? template?.startDate : startDate);
    const normalizedTargetDate = normalizeProjectDate(targetDate === undefined ? template?.targetDate : targetDate);
    const normalizedOwnerId = normalizeProjectOwner(ownerId === undefined
      ? template?.ownerId ?? userOfActor(actor)
      : ownerId);
    const normalizedStatus = String(status ?? template?.status ?? "active");
    const normalizedTags = normalizeProjectTags(tags === undefined ? template?.tags ?? [] : tags);
    const normalizedStatusSummary = String(statusSummary ?? "").trim();
    if (!PROJECT_STATUSES.has(normalizedStatus) || !normalizedTags || normalizedStatusSummary.length > 1_000
      || normalizedOwnerId === undefined
      || normalizedStartDate === undefined || normalizedTargetDate === undefined
      || (normalizedStartDate && normalizedTargetDate && normalizedStartDate > normalizedTargetDate)) {
      return { ok: false, status: 400, body: { error: "invalid_planning_project_schedule" } };
    }
    const timestamp = now();
    const project = {
      id: nextId("ppj"),
      ownerTeamId: teamOfActor(actor),
      name: normalizedName,
      description: normalizedDescription,
      color: String(color ?? template?.color ?? "indigo").slice(0, 40),
      capacityPoints: normalizedCapacity,
      startDate: normalizedStartDate,
      targetDate: normalizedTargetDate,
      ownerId: normalizedOwnerId,
      status: normalizedStatus,
      tags: normalizedTags,
      statusSummary: normalizedStatusSummary,
      statusUpdatedAt: normalizedStatusSummary ? timestamp : null,
      checkIns: normalizedStatusSummary ? [{
        id: nextId("ppc"),
        summary: normalizedStatusSummary,
        authorId: userOfActor(actor),
        createdAt: timestamp,
      }] : [],
      pinned: Boolean(pinned),
      watcherIds: watching ? [userOfActor(actor)] : [],
      savedViews: importedViews ?? (template?.savedViews ?? []).map((view) => ({ ...view, id: nextId("ppv") })),
      automationRules: importedRules ?? (template?.automationRules ?? []).map((rule) => ({ ...rule, id: nextId("par") })),
      activity: [],
      revision: 1,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: userOfActor(actor),
      lastModifiedBy: userOfActor(actor),
    };
    runTx(() => {
      (state.planningProjects ??= []).unshift(project);
      recordActivity(project, actor, "created", { templateProjectId: template?.id ?? null });
      appendEvent({
        invocationId: null, type: "planning_project_created", level: "info",
        message: `Planning project ${project.name} created.`,
        data: { planningProjectId: project.id, templateProjectId: template?.id ?? null, actorTeamId: project.ownerTeamId },
      });
    });
    return { ok: true, status: 201, body: { project: projectView(project, actor) } };
  }

  function updateProject({ planningProjectId, expectedRevision, ...changes } = {}, actor = null) {
    const project = findOwn(planningProjectId, actor);
    if (!project) return notFound();
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (project.revision !== expectedRevision) {
      return { ok: false, status: 409, body: { error: "planning_project_revision_conflict", currentRevision: project.revision } };
    }
    const patch = {};
    if (Object.hasOwn(changes, "name")) {
      const name = String(changes.name ?? "").trim();
      if (!name || name.length > MAX_NAME) return { ok: false, status: 400, body: { error: "invalid_planning_project_name" } };
      patch.name = name;
    }
    if (Object.hasOwn(changes, "description")) {
      const description = String(changes.description ?? "");
      if (description.length > MAX_DESCRIPTION) return { ok: false, status: 400, body: { error: "planning_project_description_too_large" } };
      patch.description = description;
    }
    if (Object.hasOwn(changes, "color")) patch.color = String(changes.color ?? "indigo").slice(0, 40);
    if (Object.hasOwn(changes, "ownerId")) {
      const ownerId = normalizeProjectOwner(changes.ownerId);
      if (ownerId === undefined) {
        return { ok: false, status: 400, body: { error: "invalid_planning_project_owner" } };
      }
      patch.ownerId = ownerId;
    }
    if (Object.hasOwn(changes, "status")) {
      const status = String(changes.status ?? "");
      if (!PROJECT_STATUSES.has(status)) {
        return { ok: false, status: 400, body: { error: "invalid_planning_project_status" } };
      }
      patch.status = status;
    }
    if (Object.hasOwn(changes, "tags")) {
      const tags = normalizeProjectTags(changes.tags);
      if (!tags) return { ok: false, status: 400, body: { error: "invalid_planning_project_tags" } };
      patch.tags = tags;
    }
    if (Object.hasOwn(changes, "statusSummary")) {
      const statusSummary = String(changes.statusSummary ?? "").trim();
      if (statusSummary.length > 1_000) {
        return { ok: false, status: 400, body: { error: "planning_project_status_summary_too_large" } };
      }
      const statusTimestamp = now();
      patch.statusSummary = statusSummary;
      patch.statusUpdatedAt = statusTimestamp;
      if (statusSummary && statusSummary !== project.statusSummary) {
        patch.checkIns = [{
          id: nextId("ppc"),
          summary: statusSummary,
          authorId: userOfActor(actor),
          createdAt: statusTimestamp,
        }, ...(project.checkIns ?? [])].slice(0, 50);
      }
    }
    if (Object.hasOwn(changes, "pinned")) patch.pinned = Boolean(changes.pinned);
    if (Object.hasOwn(changes, "watching")) {
      const watcherIds = new Set(project.watcherIds ?? []);
      if (changes.watching) watcherIds.add(userOfActor(actor));
      else watcherIds.delete(userOfActor(actor));
      patch.watcherIds = [...watcherIds];
    }
    if (Object.hasOwn(changes, "savedViews")) {
      const savedViews = normalizeSavedViews(changes.savedViews, nextId);
      if (!savedViews) return { ok: false, status: 400, body: { error: "invalid_planning_project_saved_views" } };
      patch.savedViews = savedViews;
    }
    if (Object.hasOwn(changes, "automationRules")) {
      const automationRules = normalizeAutomationRules(changes.automationRules, nextId);
      if (!automationRules) return { ok: false, status: 400, body: { error: "invalid_planning_project_automation_rules" } };
      patch.automationRules = automationRules;
    }
    if (Object.hasOwn(changes, "capacityPoints")) {
      const capacityPoints = Number(changes.capacityPoints);
      if (!Number.isInteger(capacityPoints) || capacityPoints < 0 || capacityPoints > 1_000_000) {
        return { ok: false, status: 400, body: { error: "invalid_planning_project_capacity_points" } };
      }
      patch.capacityPoints = capacityPoints;
    }
    if (Object.hasOwn(changes, "startDate") || Object.hasOwn(changes, "targetDate")) {
      const startDate = Object.hasOwn(changes, "startDate") ? normalizeProjectDate(changes.startDate) : project.startDate ?? null;
      const targetDate = Object.hasOwn(changes, "targetDate") ? normalizeProjectDate(changes.targetDate) : project.targetDate ?? null;
      if (startDate === undefined || targetDate === undefined || (startDate && targetDate && startDate > targetDate)) {
        return { ok: false, status: 400, body: { error: "invalid_planning_project_schedule" } };
      }
      patch.startDate = startDate;
      patch.targetDate = targetDate;
    }
    runTx(() => {
      Object.assign(project, patch, {
        revision: project.revision + 1, updatedAt: now(), lastModifiedBy: userOfActor(actor),
      });
      recordActivity(project, actor, "updated", { fields: Object.keys(patch) });
    });
    return { ok: true, status: 200, body: { project: projectView(project, actor) } };
  }

  function setArchived({ planningProjectId, expectedRevision, archived } = {}, actor = null) {
    const project = findOwn(planningProjectId, actor);
    if (!project) return notFound();
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (project.revision !== expectedRevision) {
      return { ok: false, status: 409, body: { error: "planning_project_revision_conflict", currentRevision: project.revision } };
    }
    runTx(() => {
      project.archivedAt = archived ? now() : null;
      project.revision += 1;
      project.updatedAt = now();
      project.lastModifiedBy = userOfActor(actor);
      recordActivity(project, actor, archived ? "archived" : "restored");
    });
    return { ok: true, status: 200, body: { project: projectView(project, actor) } };
  }

  function addItem({ planningProjectId, workItemId } = {}, actor = null) {
    const project = findOwn(planningProjectId, actor);
    if (!project) return notFound();
    const workItem = (state.workItems ?? []).find(
      (row) => row.id === String(workItemId) && row.ownerTeamId === teamOfActor(actor),
    );
    if (!workItem) return { ok: false, status: 404, body: { error: "work_item_not_found" } };
    const existing = visibleMemberships(project.id, actor).find((row) => row.workItemId === workItem.id);
    if (existing) return { ok: true, status: 200, body: { membership: existing, created: false } };
    const membership = {
      id: nextId("ppi"),
      ownerTeamId: project.ownerTeamId,
      planningProjectId: project.id,
      workItemId: workItem.id,
      position: Math.max(0, ...visibleMemberships(project.id, actor).map((row) => Number(row.position) || 0)) + 1_000,
      addedAt: now(),
      addedBy: userOfActor(actor),
    };
    runTx(() => {
      (state.planningProjectItems ??= []).push(membership);
      recordActivity(project, actor, "item_added", { workItemId: workItem.id, localRef: workItem.localRef });
      appendEvent({
        invocationId: null, type: "planning_project_item_added", level: "info",
        message: `${workItem.localRef} added to ${project.name}.`,
        data: { planningProjectId: project.id, workItemId: workItem.id, actorTeamId: project.ownerTeamId },
      });
    });
    return { ok: true, status: 201, body: { membership, created: true } };
  }

  function removeItem({ planningProjectId, workItemId } = {}, actor = null) {
    const project = findOwn(planningProjectId, actor);
    if (!project) return notFound();
    const index = (state.planningProjectItems ?? []).findIndex(
      (row) => row.planningProjectId === project.id && row.workItemId === String(workItemId) && row.ownerTeamId === teamOfActor(actor),
    );
    if (index < 0) return { ok: false, status: 404, body: { error: "planning_project_item_not_found" } };
    let membership;
    runTx(() => {
      [membership] = state.planningProjectItems.splice(index, 1);
      recordActivity(project, actor, "item_removed", { workItemId: membership.workItemId });
    });
    return { ok: true, status: 200, body: { membership } };
  }

  function reorderItems({ planningProjectId, expectedRevision, workItemIds } = {}, actor = null) {
    const project = findOwn(planningProjectId, actor);
    if (!project) return notFound();
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required" } };
    }
    if (project.revision !== expectedRevision) {
      return { ok: false, status: 409, body: { error: "planning_project_revision_conflict", currentRevision: project.revision } };
    }
    const memberships = visibleMemberships(project.id, actor);
    const ids = Array.isArray(workItemIds) ? workItemIds.map(String) : [];
    if (ids.length !== memberships.length || new Set(ids).size !== ids.length
      || ids.some((id) => !memberships.some((row) => row.workItemId === id))) {
      return { ok: false, status: 400, body: { error: "invalid_planning_project_item_order" } };
    }
    runTx(() => {
      ids.forEach((workItemId, index) => {
        memberships.find((row) => row.workItemId === workItemId).position = (index + 1) * 1_000;
      });
      project.revision += 1;
      project.updatedAt = now();
      project.lastModifiedBy = userOfActor(actor);
      recordActivity(project, actor, "items_reordered", { workItemIds: ids });
    });
    return { ok: true, status: 200, body: { project: projectView(project, actor, { includeItems: true }) } };
  }

  function updateItems({ planningProjectId, addWorkItemIds = [], removeWorkItemIds = [] } = {}, actor = null) {
    const project = findOwn(planningProjectId, actor);
    if (!project) return notFound();
    const addIds = [...new Set(Array.isArray(addWorkItemIds) ? addWorkItemIds.map(String) : [])];
    const removeIds = [...new Set(Array.isArray(removeWorkItemIds) ? removeWorkItemIds.map(String) : [])];
    if (addIds.length + removeIds.length === 0 || addIds.length + removeIds.length > 100
      || addIds.some((id) => removeIds.includes(id))) {
      return { ok: false, status: 400, body: { error: "invalid_planning_project_item_update" } };
    }
    const ownItems = new Map((state.workItems ?? [])
      .filter((row) => row.ownerTeamId === teamOfActor(actor))
      .map((row) => [row.id, row]));
    if (addIds.some((id) => !ownItems.has(id))) {
      return { ok: false, status: 404, body: { error: "work_item_not_found" } };
    }
    const current = visibleMemberships(project.id, actor);
    let nextPosition = Math.max(0, ...current.map((row) => Number(row.position) || 0));
    runTx(() => {
      state.planningProjectItems = (state.planningProjectItems ?? []).filter(
        (row) => !(row.planningProjectId === project.id && row.ownerTeamId === teamOfActor(actor) && removeIds.includes(row.workItemId)),
      );
      for (const workItemId of addIds) {
        if (current.some((row) => row.workItemId === workItemId)) continue;
        nextPosition += 1_000;
        state.planningProjectItems.push({
          id: nextId("ppi"), ownerTeamId: project.ownerTeamId, planningProjectId: project.id,
          workItemId, position: nextPosition, addedAt: now(), addedBy: userOfActor(actor),
        });
      }
      project.revision += 1;
      project.updatedAt = now();
      project.lastModifiedBy = userOfActor(actor);
      recordActivity(project, actor, "items_updated", { addWorkItemIds: addIds, removeWorkItemIds: removeIds });
    });
    return { ok: true, status: 200, body: { project: projectView(project, actor, { includeItems: true }) } };
  }

  function executeRecommendedAction({
    planningProjectId, expectedRevision, code, idempotencyKey, confirmed = false,
    approvalToken = null, parameters = {},
  } = {}, actor = null) {
    const project = findOwn(planningProjectId, actor);
    if (!project) return notFound();
    if (expectedRevision !== project.revision) {
      return { ok: false, status: 409, body: { error: "planning_project_revision_conflict", currentRevision: project.revision } };
    }
    const key = String(idempotencyKey ?? "").trim();
    if (!key || key.length > 200) return { ok: false, status: 400, body: { error: "invalid_recommended_action_idempotency_key" } };
    const replay = (project.recommendedActionExecutions ?? []).find((execution) => execution.idempotencyKey === key);
    if (replay) return { ok: true, status: 200, body: { execution: replay, project: projectView(project, actor), replayed: true } };
    const policy = RECOMMENDED_ACTION_POLICY[code];
    const recommendation = projectView(project, actor).recommendedActions.find((action) => action.code === code);
    if (!policy || !recommendation) return { ok: false, status: 409, body: { error: "recommended_action_no_longer_applicable" } };
    if (!confirmed) return { ok: false, status: 400, body: { error: "recommended_action_confirmation_required", risk: policy.risk } };
    let approval = null;
    if (policy.approvalRequired) {
      approval = validateApprovalToken(approvalToken, {
        action: `planning:${code}`, targetId: project.id, actor, allowLegacy: false,
      });
      if (!approval.approved) {
        const existing = (project.recommendedActionApprovalRequests ?? []).find((request) =>
          request.idempotencyKey === key && request.status === "pending");
        if (existing) return { ok: true, status: 200, body: { approvalRequest: existing, project: projectView(project, actor), replayed: true } };
        const approvalRequest = {
          id: nextId("par"), planningProjectId: project.id, code, idempotencyKey: key,
          parameters: structuredClone(parameters), status: "pending",
          requestedBy: userOfActor(actor), requestedAt: now(), decidedAt: null, decidedBy: null,
        };
        runTx(() => {
          (project.recommendedActionApprovalRequests ??= []).unshift(approvalRequest);
          recordActivity(project, actor, "recommended_action_approval_requested", {
            approvalRequestId: approvalRequest.id, code, risk: policy.risk,
          });
        });
        return { ok: true, status: 202, body: { approvalRequest, project: projectView(project, actor) } };
      }
    }
    const changes = {};
    if (code === "refresh_status") changes.statusUpdatedAt = now();
    if (code === "assign_owner") {
      const ownerId = normalizeProjectOwner(parameters.ownerId);
      if (!ownerId) return { ok: false, status: 400, body: { error: "recommended_action_owner_required" } };
      changes.ownerId = ownerId;
    }
    if (["set_target_date", "recover_schedule"].includes(code)) {
      const targetDate = normalizeProjectDate(parameters.targetDate);
      if (!targetDate) return { ok: false, status: 400, body: { error: "recommended_action_target_date_required" } };
      changes.targetDate = targetDate;
    }
    if (code === "rebalance_capacity") {
      const capacityPoints = Number(parameters.capacityPoints);
      if (!Number.isInteger(capacityPoints) || capacityPoints < 1 || capacityPoints > 1_000_000) {
        return { ok: false, status: 400, body: { error: "recommended_action_capacity_required" } };
      }
      changes.capacityPoints = capacityPoints;
    }
    const execution = {
      id: nextId("pra"), code, risk: policy.risk, approvalRequired: policy.approvalRequired,
      approvalGrantId: approval?.grantId ?? null, idempotencyKey: key,
      requestedBy: userOfActor(actor), requestedAt: now(),
      status: Object.keys(changes).length ? "completed" : "queued",
      parameters: structuredClone(parameters),
      result: Object.keys(changes).length ? { changes } : { queuedFor: code },
    };
    runTx(() => {
      Object.assign(project, changes);
      (project.recommendedActionExecutions ??= []).unshift(execution);
      project.revision += 1;
      project.updatedAt = now();
      project.lastModifiedBy = userOfActor(actor);
      recordActivity(project, actor, "recommended_action_executed", {
        executionId: execution.id, code, status: execution.status, risk: policy.risk,
      });
      appendEvent({
        invocationId: null, type: "planning_recommended_action_executed", level: "info",
        message: `${code} ${execution.status} for ${project.name}.`,
        data: { planningProjectId: project.id, executionId: execution.id, code, actorTeamId: teamOfActor(actor) },
      });
    });
    return { ok: true, status: 201, body: { execution, project: projectView(project, actor, { includeItems: true }) } };
  }

  function decideRecommendedAction({ planningProjectId, approvalRequestId, decision } = {}, actor = null) {
    const project = findOwn(planningProjectId, actor);
    if (!project) return notFound();
    const request = (project.recommendedActionApprovalRequests ?? []).find((candidate) => candidate.id === approvalRequestId);
    if (!request) return { ok: false, status: 404, body: { error: "recommended_action_approval_not_found" } };
    if (request.status !== "pending") return { ok: true, status: 200, body: { approvalRequest: request, replayed: true } };
    if (!["approved", "denied"].includes(decision)) {
      return { ok: false, status: 400, body: { error: "invalid_recommended_action_approval_decision" } };
    }
    let execution = null;
    runTx(() => {
      request.status = decision;
      request.decidedAt = now();
      request.decidedBy = userOfActor(actor);
      if (decision === "approved") {
        execution = {
          id: nextId("pra"), code: request.code, risk: "high", approvalRequired: true,
          approvalRequestId: request.id, idempotencyKey: request.idempotencyKey,
          requestedBy: request.requestedBy, requestedAt: request.requestedAt,
          status: "queued", parameters: request.parameters, result: { queuedFor: request.code },
        };
        (project.recommendedActionExecutions ??= []).unshift(execution);
      }
      project.revision += 1;
      project.updatedAt = now();
      recordActivity(project, actor, decision === "approved"
        ? "recommended_action_approval_resumed" : "recommended_action_approval_denied", {
        approvalRequestId: request.id, executionId: execution?.id ?? null, code: request.code,
      });
    });
    return { ok: true, status: 200, body: { approvalRequest: request, execution, project: projectView(project, actor, { includeItems: true }) } };
  }

  return {
    listProjects, getProject, createProject, updateProject, setArchived,
    addItem, removeItem, reorderItems, updateItems, executeRecommendedAction, decideRecommendedAction,
  };
}
