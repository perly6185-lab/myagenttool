import {
  INFLIGHT_STATUSES,
  invocationDirKey,
  isBridgeExecuted,
} from "../services/invocations/dispatch-eligibility.mjs";
import { computeInvocationDispatchHealth } from "./invocation-dispatch-health.mjs";

const POINT_MINUTES = 60;
const DEFAULT_MINUTES = 60;
const MIN_ESTIMATE_MINUTES = 15;
const MAX_ESTIMATE_MINUTES = 8 * 60;

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function clampMinutes(value) {
  return Math.max(MIN_ESTIMATE_MINUTES, Math.min(MAX_ESTIMATE_MINUTES, Math.round(value)));
}

function invocationIdsForWorkItem(item, state) {
  const ids = new Set();
  for (const binding of item.executionBindings ?? []) {
    if (binding.kind === "application_invocation") {
      if (binding.id) ids.add(binding.id);
      if (binding.targetId) ids.add(binding.targetId);
      continue;
    }
    if (binding.kind !== "auto_run" || !binding.targetId) continue;
    const run = (state.autoRuns ?? []).find((candidate) => candidate.id === binding.targetId);
    if (run?.invocationId) ids.add(run.invocationId);
    for (const attempt of run?.failoverHistory ?? []) {
      if (attempt.fromInvocationId) ids.add(attempt.fromInvocationId);
      if (attempt.toInvocationId) ids.add(attempt.toInvocationId);
    }
  }
  return ids;
}

function historicalDurations(item, state) {
  const invocationIds = invocationIdsForWorkItem(item, state);
  const durations = [];
  for (const invocation of state.invocations ?? []) {
    if (!invocationIds.has(invocation.id) || !invocation.completedAt) continue;
    const startedAt = invocation.startedAt
      ?? invocation.delivery?.acknowledgedAt
      ?? invocation.createdAt;
    const startedMs = Date.parse(startedAt ?? "");
    const completedMs = Date.parse(invocation.completedAt);
    if (!Number.isFinite(startedMs) || !Number.isFinite(completedMs) || completedMs < startedMs) continue;
    durations.push(Math.max(1, Math.round((completedMs - startedMs) / 60_000)));
  }
  return durations;
}

function estimateWorkItem(item, state) {
  const history = historicalDurations(item, state);
  if (history.length > 0) {
    return {
      minutes: clampMinutes(median(history)),
      source: "history",
      confidence: history.length >= 3 ? "high" : "medium",
      sampleSize: history.length,
    };
  }
  const points = Number(item.estimatePoints);
  if (Number.isFinite(points) && points > 0) {
    return {
      minutes: clampMinutes(points * POINT_MINUTES),
      source: "estimate_points",
      confidence: "medium",
      sampleSize: 0,
    };
  }
  return {
    minutes: DEFAULT_MINUTES,
    source: "default",
    confidence: "low",
    sampleSize: 0,
  };
}

function worktreeIdsForItem(item) {
  return [...new Set((item.executionBindings ?? []).flatMap((binding) => {
    if (binding.worktreeId) return [binding.worktreeId];
    if (binding.kind === "worktree" && binding.targetId) return [binding.targetId];
    return [];
  }))];
}

function classifyWork(item) {
  if (["blocked", "review"].includes(item.status)
    || ["waiting_capability", "waiting_approval", "refusal"].includes(item.queueReadiness?.state)) {
    return "attention";
  }
  if (["ready", "in_progress"].includes(item.status)) return "executable";
  return "backlog";
}

function readinessFor(item, { bridgeAvailable, availableSlots, busyWorktreeIds }) {
  if (["waiting_capability", "waiting_approval", "refusal"].includes(item.queueReadiness?.state)) {
    return { state: item.queueReadiness.state, reason: item.queueReadiness.reason ?? item.queueReadiness.state };
  }
  if (item.status === "blocked") return { state: "blocked", reason: "work_item_blocked" };
  if (item.status === "review") return { state: "attention", reason: "review_required" };
  if (worktreeIdsForItem(item).some((id) => busyWorktreeIds.has(id))) {
    return { state: "waiting_worktree", reason: "worktree_busy" };
  }
  if (!bridgeAvailable) return { state: "waiting_terminal", reason: "terminal_unavailable" };
  if (availableSlots === 0) return { state: "waiting_capacity", reason: "terminal_at_capacity" };
  return { state: "ready", reason: "dispatchable" };
}

/**
 * Current-terminal-only planning input. This deliberately does not select or
 * rank another terminal: the device in `state.device` is the complete scope.
 */
export function computeLocalScheduleCapacity(state, {
  findAgent,
  now = () => new Date().toISOString(),
  visibleInvocation = () => true,
  visibleProject = () => true,
  visibleWorkItem = () => true,
} = {}) {
  const generatedAt = typeof now === "function" ? now() : new Date().toISOString();
  const device = state?.device ?? null;
  const deviceId = device?.id ?? null;
  const dispatch = computeInvocationDispatchHealth(state, {
    findAgent,
    now: () => generatedAt,
    visibleInvocation,
    visibleProject,
  });
  const bridgeAvailable = Boolean(device && device.status === "online" && device.unlinkState === "linked");
  const availableSlots = Math.max(0, dispatch.capacity.maxConcurrency - dispatch.capacity.inFlight);
  const inFlight = (state?.invocations ?? []).filter((invocation) =>
    INFLIGHT_STATUSES.includes(invocation.status)
      && isBridgeExecuted(invocation, { findAgent, deviceId }));
  const busyWorktreeIds = new Set(inFlight.map((invocation) => invocation.worktreeId).filter(Boolean));
  const busyDirs = new Set(inFlight.map(invocationDirKey).filter((value) => value !== "__default__"));

  const workItems = (state?.workItems ?? [])
    .filter((item) => item.state !== "closed" && item.status !== "done" && !item.archivedAt)
    .filter((item) => !deviceId || !item.terminalId || item.terminalId === deviceId)
    .filter(visibleWorkItem)
    .map((item) => {
      const category = classifyWork(item);
      return {
        workItemId: item.id,
        localRef: item.localRef ?? null,
        title: item.title ?? "",
        projectId: item.projectId ?? null,
        status: item.status ?? "backlog",
        priority: item.priority ?? "p2",
        dueDate: item.dueDate ?? null,
        plannedDate: item.plannedDate ?? null,
        carriedFromDate: item.carriedFromDate ?? null,
        schedulePlanSource: item.schedulePlanSource ?? null,
        scheduleReason: item.scheduleReason ?? null,
        scheduleOrder: Number.isFinite(item.scheduleOrder) ? item.scheduleOrder : null,
        manuallyPinned: Boolean(item.plannedDate && (!item.schedulePlanSource || item.schedulePlanSource === "manual")),
        revision: Number(item.revision) || 0,
        createdAt: item.createdAt ?? null,
        updatedAt: item.updatedAt ?? null,
        category,
        estimate: estimateWorkItem(item, state),
        readiness: readinessFor(item, { bridgeAvailable, availableSlots, busyWorktreeIds }),
        worktreeIds: worktreeIdsForItem(item),
      };
    });

  const countByCategory = (category) => workItems.filter((item) => item.category === category).length;
  return {
    generatedAt,
    terminal: device ? {
      id: device.id,
      name: device.name ?? null,
      status: device.status ?? "unknown",
      unlinkState: device.unlinkState ?? "unknown",
      bridgeAvailable,
    } : null,
    capacity: {
      ...dispatch.capacity,
      availableSlots,
      queueDepth: dispatch.queue.depth,
      worktreeLocks: busyWorktreeIds.size || busyDirs.size,
    },
    work: {
      total: workItems.length,
      executable: countByCategory("executable"),
      attention: countByCategory("attention"),
      backlog: countByCategory("backlog"),
      items: workItems,
    },
    assumptions: {
      pointMinutes: POINT_MINUTES,
      defaultMinutes: DEFAULT_MINUTES,
      estimateRangeMinutes: { min: MIN_ESTIMATE_MINUTES, max: MAX_ESTIMATE_MINUTES },
    },
  };
}
