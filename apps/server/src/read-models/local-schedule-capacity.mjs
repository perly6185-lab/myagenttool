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
const RUNTIME_EXECUTABLE_STATES = new Set([
  "materializing", "running", "waiting_capacity", "verifying", "publishing", "decomposed",
]);
const RUNTIME_ATTENTION_REASONS = new Map([
  ["failed", "auto_run_failed"],
  ["blocked", "auto_run_blocked"],
  ["needs_input", "auto_run_needs_input"],
  ["awaiting_approval", "auto_run_awaiting_approval"],
  ["plan_proposed", "auto_run_decision_required"],
  ["report_posted", "auto_run_decision_required"],
  ["pr_open", "auto_run_pr_open"],
]);

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

function autoRunScheduleKey(run) {
  return `autorun:${run.id}`;
}

function autoRunTitle(run) {
  if (run?.link?.number) return `#${run.link.number}${run.link.title ? ` ${run.link.title}` : ""}`;
  return String(run?.name ?? run?.id ?? "Auto-run");
}

function autoRunWorktreeIds(run) {
  return [...new Set([run?.worktreeId, run?.worktree?.id].filter(Boolean))];
}

function autoRunPriority(run) {
  return ["p0", "p1", "p2", "p3"].includes(run?.priority) ? run.priority : "p2";
}

function autoRunPlanningStatus(run) {
  if (RUNTIME_EXECUTABLE_STATES.has(run?.status)) {
    return ["materializing", "running", "verifying", "publishing", "decomposed"].includes(run.status)
      ? "in_progress"
      : "ready";
  }
  if (RUNTIME_ATTENTION_REASONS.has(run?.status)) return "blocked";
  return "backlog";
}

function autoRunCategory(run) {
  if (RUNTIME_EXECUTABLE_STATES.has(run?.status)) return "executable";
  if (RUNTIME_ATTENTION_REASONS.has(run?.status)) return "attention";
  return "backlog";
}

function autoRunReadiness(run, { bridgeAvailable, availableSlots, busyWorktreeIds }) {
  const attentionReason = RUNTIME_ATTENTION_REASONS.get(run?.status);
  if (attentionReason) return { state: "attention", reason: attentionReason };
  if (!RUNTIME_EXECUTABLE_STATES.has(run?.status)) {
    return { state: "not_ready", reason: "auto_run_not_ready" };
  }
  if (autoRunWorktreeIds(run).some((id) => busyWorktreeIds.has(id))) {
    return { state: "waiting_worktree", reason: "worktree_busy" };
  }
  if (!bridgeAvailable) return { state: "waiting_terminal", reason: "terminal_unavailable" };
  if (availableSlots === 0) return { state: "waiting_capacity", reason: "terminal_at_capacity" };
  return { state: "ready", reason: "dispatchable" };
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
  visibleAutoRun = () => true,
  visibleRuntimeSchedule = () => true,
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

  const visibleLocalItems = (state?.workItems ?? []).filter(visibleWorkItem);
  const workItems = visibleLocalItems
    .filter((item) => item.state !== "closed" && item.status !== "done" && !item.archivedAt)
    .filter((item) => !deviceId || !item.terminalId || item.terminalId === deviceId)
    .map((item) => {
      const category = classifyWork(item);
      return {
        workItemId: item.id,
        sourceKind: "work_item",
        sourceId: item.id,
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

  const boundAutoRunIds = new Set(visibleLocalItems.flatMap((item) =>
    (item.executionBindings ?? [])
      .filter((binding) => binding.kind === "auto_run" && binding.targetId)
      .map((binding) => binding.targetId)));
  const runtimeSchedules = new Map((state?.runtimeWorkSchedules ?? [])
    .filter(visibleRuntimeSchedule)
    .map((schedule) => [`${schedule.kind}:${schedule.targetId}`, schedule]));
  const runtimeItems = (state?.autoRuns ?? [])
    .filter((run) => run?.id && !["done", "cancelled"].includes(run.status))
    .filter((run) => !boundAutoRunIds.has(run.id))
    .filter((run) => !deviceId || !run.terminalId || run.terminalId === deviceId)
    .filter(visibleAutoRun)
    .map((run) => {
      const schedule = runtimeSchedules.get(`auto_run:${run.id}`) ?? null;
      return {
        workItemId: autoRunScheduleKey(run),
        sourceKind: "auto_run",
        sourceId: run.id,
        localRef: run?.link?.number ? `#${run.link.number}` : null,
        title: autoRunTitle(run),
        projectId: run.projectId ?? null,
        status: autoRunPlanningStatus(run),
        runtimeState: run.status ?? "unknown",
        priority: autoRunPriority(run),
        dueDate: run?.link?.dueDate ?? run?.dueDate ?? null,
        plannedDate: schedule?.plannedDate ?? null,
        carriedFromDate: schedule?.carriedFromDate ?? null,
        schedulePlanSource: schedule?.schedulePlanSource ?? null,
        scheduleReason: schedule?.scheduleReason ?? null,
        scheduleOrder: Number.isFinite(schedule?.scheduleOrder) ? schedule.scheduleOrder : null,
        manuallyPinned: schedule?.schedulePlanSource === "manual",
        revision: Number(schedule?.revision) || 0,
        createdAt: run.createdAt ?? null,
        updatedAt: run.updatedAt ?? run.createdAt ?? null,
        category: autoRunCategory(run),
        estimate: estimateWorkItem({ executionBindings: [{ kind: "auto_run", targetId: run.id }] }, state),
        readiness: autoRunReadiness(run, { bridgeAvailable, availableSlots, busyWorktreeIds }),
        worktreeIds: autoRunWorktreeIds(run),
      };
    });
  workItems.push(...runtimeItems);

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
