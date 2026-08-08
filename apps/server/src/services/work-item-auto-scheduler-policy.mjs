const PRIORITY_RANK = Object.freeze({ p0: 0, p1: 1, p2: 2, p3: 3 });
const ELIGIBLE_STATUSES = new Set(["ready", "in_progress"]);
const USER_WAIT_STATES = new Set(["me", "requester", "internal"]);
const ACTIVE_EXECUTION_STATES = new Set([
  "claimed",
  "running",
  "awaiting_approval",
  "verifying",
]);

function dateOnly(value) {
  if (typeof value !== "string") return null;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return match?.[0] ?? null;
}

function timestamp(value, fallback = Number.MAX_SAFE_INTEGER) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolvedExecutionPolicy(item, project) {
  const policy = item?.executionPolicy ?? "inherit";
  if (policy !== "inherit") return policy;
  return project?.autoExecutionEnabled === true ? "auto" : "manual";
}

function unresolvedDependencies(item, itemsById) {
  return (item?.dependencyIds ?? []).filter((dependencyId) => {
    const dependency = itemsById.get(String(dependencyId));
    return !dependency || (dependency.status !== "done" && dependency.state !== "closed");
  });
}

function deadlineBucket(item, today) {
  const dueDate = dateOnly(item?.dueDate ?? item?.commitmentDate);
  if (!dueDate) return 4;
  if (dueDate < today) return 0;
  if (dueDate === today) return 1;
  const days = Math.floor((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days <= 2) return 2;
  if (days <= 7) return 3;
  return 4;
}

function planBucket(item, today) {
  const plannedDate = dateOnly(item?.plannedDate);
  if (!plannedDate) return 3;
  if (plannedDate < today) return 0;
  if (plannedDate === today) return 1;
  return 2;
}

function rankFor(item, today) {
  return [
    item?.priority === "p0" ? 0 : 1,
    deadlineBucket(item, today),
    PRIORITY_RANK[item?.priority] ?? PRIORITY_RANK.p2,
    planBucket(item, today),
    dateOnly(item?.dueDate ?? item?.commitmentDate) ?? "9999-12-31",
    dateOnly(item?.plannedDate) ?? "9999-12-31",
    timestamp(item?.updatedAt),
    timestamp(item?.createdAt),
    String(item?.id ?? item?.workItemId ?? ""),
  ];
}

export function autoExecutionDispatchScore(item, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const rank = rankFor(item, dateOnly(today) ?? new Date().toISOString().slice(0, 10));
  return (Number(rank[0]) * 1_000_000)
    + (Number(rank[1]) * 10_000)
    + (Number(rank[2]) * 100)
    + Number(rank[3]);
}

function compareRank(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === right[index]) continue;
    return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

export function evaluateAutoExecutionCandidate(item, {
  today,
  now = new Date().toISOString(),
  project = null,
  itemsById = new Map(),
} = {}) {
  const reasons = [];
  const policy = resolvedExecutionPolicy(item, project);
  if (policy !== "auto") reasons.push(policy === "paused" ? "execution_paused" : "automatic_execution_disabled");
  if (item?.state !== "open" || item?.archivedAt) reasons.push("work_item_not_open");
  if (!ELIGIBLE_STATUSES.has(item?.status)) reasons.push("planning_status_not_executable");
  if (USER_WAIT_STATES.has(item?.waitingOn)) reasons.push("waiting_for_user");
  if (ACTIVE_EXECUTION_STATES.has(item?.executionState)) reasons.push("active_execution");
  if (item?.executionOperation?.status === "starting") reasons.push("execution_starting");
  const dependencies = unresolvedDependencies(item, itemsById);
  if (dependencies.length) reasons.push("dependencies_unresolved");
  const notBefore = timestamp(item?.notBefore, null);
  const nowMs = timestamp(now, Date.now());
  if (notBefore != null && notBefore > nowMs) reasons.push("not_before_reached");

  const normalizedToday = dateOnly(today ?? now) ?? new Date(nowMs).toISOString().slice(0, 10);
  if (dateOnly(item?.plannedDate) > normalizedToday && project?.futurePullForwardEnabled === false) {
    reasons.push("future_pull_forward_disabled");
  }
  return {
    workItemId: String(item?.id ?? item?.workItemId ?? ""),
    eligible: reasons.length === 0,
    reasons,
    executionPolicy: policy,
    unresolvedDependencyIds: dependencies,
    rank: rankFor(item, normalizedToday),
  };
}

export function planAutoExecutionQueue(items = [], {
  projects = [],
  today,
  now = new Date().toISOString(),
} = {}) {
  const itemsById = new Map(items.map((item) => [String(item.id ?? item.workItemId), item]));
  const projectsById = new Map(projects.map((project) => [String(project.id), project]));
  const decisions = items.map((item) => evaluateAutoExecutionCandidate(item, {
    today,
    now,
    project: projectsById.get(String(item.projectId)) ?? null,
    itemsById,
  }));
  const byId = new Map(decisions.map((decision) => [decision.workItemId, decision]));
  const eligible = items
    .filter((item) => byId.get(String(item.id ?? item.workItemId))?.eligible)
    .sort((left, right) => compareRank(
      byId.get(String(left.id ?? left.workItemId)).rank,
      byId.get(String(right.id ?? right.workItemId)).rank,
    ));
  return {
    eligible,
    decisions,
    next: eligible[0] ?? null,
  };
}

export const autoExecutionPriorityRank = PRIORITY_RANK;
