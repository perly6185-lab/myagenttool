import { createHash } from "node:crypto";

export const TASK_PLAN_CONTRACT_VERSION = 2;
const MAX_TASKS = 20;
const EXTERNAL_TASK_KINDS = new Set([
  "content_publish",
  "wechat_draft_sync",
  "software_deployment",
  "business_communication",
  "business_scheduling",
]);

function bounded(value, max = 200) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function hasCycle(tasksByKey) {
  const visiting = new Set();
  const visited = new Set();
  const visit = (key) => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    const cyclic = (tasksByKey.get(key)?.requires ?? []).some((dependency) => visit(dependency));
    visiting.delete(key);
    visited.add(key);
    return cyclic;
  };
  return [...tasksByKey.keys()].some(visit);
}

export function validateTaskPlan(plan, { requireTasks = true } = {}) {
  const errors = [];
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : null;
  if (!tasks) errors.push("tasks_not_array");
  if (tasks && tasks.length > MAX_TASKS) errors.push("too_many_tasks");
  if (requireTasks && tasks && tasks.length === 0) errors.push("no_tasks");

  const tasksByKey = new Map();
  const intentIds = new Set();
  for (const task of tasks ?? []) {
    const key = bounded(task?.key, 120);
    const kind = bounded(task?.kind, 80);
    if (!/^[A-Za-z][A-Za-z0-9:_-]{0,119}$/.test(key)) errors.push("invalid_task_key");
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(kind)) errors.push("invalid_task_kind");
    if (tasksByKey.has(key)) errors.push("duplicate_task_key");
    tasksByKey.set(key, task);
    if (task?.intentId) intentIds.add(bounded(task.intentId, 200));
    if (!bounded(task?.title, 160)) errors.push("missing_task_title");
    if (!Array.isArray(task?.requires)) errors.push("requires_not_array");
    if (!task?.artifactContract
      || !Array.isArray(task.artifactContract.produces)
      || !Array.isArray(task.artifactContract.consumes)) errors.push("missing_artifact_contract");
    if (EXTERNAL_TASK_KINDS.has(kind) && task.approvalRequired !== true) errors.push("external_task_without_approval");
    if (task?.approvalRequired === true && !task?.gate) errors.push("approval_without_gate");
  }
  if (intentIds.size > 1) errors.push("mixed_intent_ids");

  for (const task of tasks ?? []) {
    const key = bounded(task?.key, 120);
    const consumes = new Set((task?.artifactContract?.consumes ?? []).map((kind) => bounded(kind, 100)).filter(Boolean));
    for (const dependency of Array.isArray(task?.requires) ? task.requires : []) {
      const dependencyKey = bounded(dependency, 120);
      if (!tasksByKey.has(dependencyKey)) errors.push("dangling_dependency");
      if (dependencyKey === key) errors.push("self_dependency");
      const producer = tasksByKey.get(dependencyKey);
      if (producer) {
        const produced = (producer?.artifactContract?.produces ?? []).map((kind) => bounded(kind, 100)).filter(Boolean);
        if (!produced.some((kind) => consumes.has(kind))) errors.push("dependency_without_artifact_handoff");
      }
    }
  }
  if (tasksByKey.size && hasCycle(tasksByKey)) errors.push("cyclic_dependency");

  const uniqueErrors = [...new Set(errors)];
  const summary = {
    version: TASK_PLAN_CONTRACT_VERSION,
    taskCount: tasks?.length ?? 0,
    tasks: (tasks ?? []).map((task) => ({
      key: bounded(task?.key, 120),
      kind: bounded(task?.kind, 80),
      requires: Array.isArray(task?.requires) ? task.requires.map((dependency) => bounded(dependency, 120)) : [],
      consumes: (task?.artifactContract?.consumes ?? []).map((kind) => bounded(kind, 100)),
      produces: (task?.artifactContract?.produces ?? []).map((kind) => bounded(kind, 100)),
      approvalRequired: task?.approvalRequired === true,
    })),
    digest: digest({
      statement: bounded(plan?.goal?.statement ?? plan?.intent?.statement, 4_000),
      tasks: (tasks ?? []).map((task) => ({
        key: bounded(task?.key, 120),
        kind: bounded(task?.kind, 80),
        requires: (task?.requires ?? []).map((dependency) => bounded(dependency, 120)),
        consumes: (task?.artifactContract?.consumes ?? []).map((kind) => bounded(kind, 100)),
        produces: (task?.artifactContract?.produces ?? []).map((kind) => bounded(kind, 100)),
        approvalRequired: task?.approvalRequired === true,
        gate: bounded(task?.gate, 80) || null,
      })),
    }),
  };
  return {
    ok: uniqueErrors.length === 0,
    errors: uniqueErrors,
    summary,
    confidence: uniqueErrors.length === 0 ? (plan?.clarification ? 0.65 : tasks?.length ? 0.95 : 0) : 0,
  };
}
