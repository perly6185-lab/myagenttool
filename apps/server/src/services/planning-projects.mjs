import { LOCAL_TEAM_ID, LOCAL_USER_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const MAX_NAME = 200;
const MAX_DESCRIPTION = 20_000;

export function createPlanningProjectService({
  state, now, nextId, appendEvent = () => {}, persistStateSoon = () => {}, store,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  const teamOfActor = (actor) => actor?.teamId ?? LOCAL_TEAM_ID;
  const userOfActor = (actor) => actor?.userId ?? LOCAL_USER_ID;
  const notFound = () => ({ ok: false, status: 404, body: { error: "planning_project_not_found" } });

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
    const riskScore = blockedItemCount * 3 + overdueItemCount * 2 + failedRunCount * 3;
    return {
      ...project,
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
      health: riskScore > 0 ? "attention" : activeRunCount > 0 ? "active" : "healthy",
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
      .filter((row) => !q || `${row.name} ${row.description}`.toLowerCase().includes(q))
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

  function createProject({ name, description = "", color = "indigo" } = {}, actor = null) {
    const normalizedName = String(name ?? "").trim();
    const normalizedDescription = String(description ?? "");
    if (!normalizedName || normalizedName.length > MAX_NAME) {
      return { ok: false, status: 400, body: { error: "invalid_planning_project_name" } };
    }
    if (normalizedDescription.length > MAX_DESCRIPTION) {
      return { ok: false, status: 400, body: { error: "planning_project_description_too_large" } };
    }
    const timestamp = now();
    const project = {
      id: nextId("ppj"),
      ownerTeamId: teamOfActor(actor),
      name: normalizedName,
      description: normalizedDescription,
      color: String(color ?? "indigo").slice(0, 40),
      revision: 1,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: userOfActor(actor),
      lastModifiedBy: userOfActor(actor),
    };
    runTx(() => {
      (state.planningProjects ??= []).unshift(project);
      appendEvent({
        invocationId: null, type: "planning_project_created", level: "info",
        message: `Planning project ${project.name} created.`,
        data: { planningProjectId: project.id, actorTeamId: project.ownerTeamId },
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
    runTx(() => Object.assign(project, patch, {
      revision: project.revision + 1, updatedAt: now(), lastModifiedBy: userOfActor(actor),
    }));
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
    });
    return { ok: true, status: 200, body: { project: projectView(project, actor, { includeItems: true }) } };
  }

  return {
    listProjects, getProject, createProject, updateProject, setArchived,
    addItem, removeItem, reorderItems, updateItems,
  };
}
