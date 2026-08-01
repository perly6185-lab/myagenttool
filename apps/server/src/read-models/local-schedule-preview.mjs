import { createHash } from "node:crypto";

const PRIORITY_RANK = { p0: 0, p1: 1, p2: 2, p3: 3 };
const DEFAULT_WORKDAY_MINUTES = 8 * 60;
const DEFAULT_UTILIZATION = 0.75;
const DEFAULT_URGENT_RESERVE = 0.2;

function dateKey(value, timeZone = null) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateValue, days) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function timestamp(value, fallback = Number.MAX_SAFE_INTEGER) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compareCandidates(left, right, horizon) {
  const leftPinned = left.manuallyPinned && horizon.includes(left.plannedDate) ? 0 : 1;
  const rightPinned = right.manuallyPinned && horizon.includes(right.plannedDate) ? 0 : 1;
  if (leftPinned !== rightPinned) return leftPinned - rightPinned;
  const leftP0 = left.priority === "p0" ? 0 : 1;
  const rightP0 = right.priority === "p0" ? 0 : 1;
  if (leftP0 !== rightP0) return leftP0 - rightP0;
  const leftDue = timestamp(left.dueDate);
  const rightDue = timestamp(right.dueDate);
  if (leftDue !== rightDue) return leftDue - rightDue;
  const leftRollover = left.carriedFromDate || (left.plannedDate && left.plannedDate < horizon[0]) ? 0 : 1;
  const rightRollover = right.carriedFromDate || (right.plannedDate && right.plannedDate < horizon[0]) ? 0 : 1;
  if (leftRollover !== rightRollover) return leftRollover - rightRollover;
  const priority = (PRIORITY_RANK[left.priority] ?? 2) - (PRIORITY_RANK[right.priority] ?? 2);
  if (priority !== 0) return priority;
  const waitAge = timestamp(left.updatedAt) - timestamp(right.updatedAt);
  if (waitAge !== 0) return waitAge;
  const creation = timestamp(left.createdAt) - timestamp(right.createdAt);
  if (creation !== 0) return creation;
  return String(left.workItemId).localeCompare(String(right.workItemId));
}

function planRevision(capacity, horizon, assumptions) {
  const input = {
    terminalId: capacity.terminal?.id ?? null,
    terminalStatus: capacity.terminal?.status ?? null,
    maxConcurrency: capacity.capacity.maxConcurrency,
    inFlight: capacity.capacity.inFlight,
    horizon,
    assumptions,
    workItems: capacity.work.items.map((item) => ({
      id: item.workItemId,
      sourceKind: item.sourceKind ?? "work_item",
      sourceId: item.sourceId ?? item.workItemId,
      revision: item.revision,
      status: item.status,
      runtimeState: item.runtimeState ?? null,
      priority: item.priority,
      dueDate: item.dueDate,
      plannedDate: item.plannedDate,
      carriedFromDate: item.carriedFromDate,
      schedulePlanSource: item.schedulePlanSource,
      manuallyPinned: item.manuallyPinned,
      estimate: item.estimate,
      readiness: item.readiness,
    })),
  };
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24);
}

/**
 * Deterministic preview for the current terminal. Yesterday remains a result
 * lane in the UI, so new capacity is allocated only to today and tomorrow.
 * No work item is mutated; apply is a separate, revision-gated command.
 */
export function computeLocalSchedulePreview(capacity, {
  now = () => new Date().toISOString(),
  workdayMinutes = DEFAULT_WORKDAY_MINUTES,
  utilization = DEFAULT_UTILIZATION,
  urgentReserve = DEFAULT_URGENT_RESERVE,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
} = {}) {
  const generatedAt = typeof now === "function" ? now() : new Date().toISOString();
  const today = dateKey(generatedAt, timeZone);
  const horizon = [today, addDays(today, 1)];
  const maxConcurrency = Math.max(1, Number(capacity?.capacity?.maxConcurrency) || 1);
  const grossMinutes = Math.max(0, Math.floor(maxConcurrency * workdayMinutes * utilization));
  const allocatableMinutes = Math.max(0, Math.floor(grossMinutes * (1 - urgentReserve)));
  const assumptions = { workdayMinutes, utilization, urgentReserve, timeZone, grossMinutes, allocatableMinutes };
  const days = horizon.map((date) => ({
    date,
    capacityMinutes: allocatableMinutes,
    plannedMinutes: 0,
    availableMinutes: allocatableMinutes,
    items: [],
  }));
  const unscheduled = [];
  const attention = [];
  const candidates = [];

  for (const item of capacity?.work?.items ?? []) {
    if (item.category === "attention") {
      attention.push({ workItemId: item.workItemId, reason: item.readiness.reason || "attention_required" });
      continue;
    }
    if (item.category !== "executable" || !["ready", "in_progress"].includes(item.status)) {
      unscheduled.push({ workItemId: item.workItemId, reason: "not_ready" });
      continue;
    }
    if (item.manuallyPinned && item.plannedDate && item.plannedDate > horizon.at(-1)) {
      unscheduled.push({ workItemId: item.workItemId, reason: "pinned_outside_horizon", plannedDate: item.plannedDate });
      continue;
    }
    candidates.push(item);
  }

  candidates.sort((left, right) => compareCandidates(left, right, horizon));
  for (const item of candidates) {
    const minutes = Math.max(1, Number(item.estimate?.minutes) || 60);
    const pinnedDayIndex = item.manuallyPinned ? horizon.indexOf(item.plannedDate) : -1;
    const earliestDayIndex = item.readiness.state === "waiting_worktree" ? 1 : 0;
    const dayIndexes = pinnedDayIndex >= 0
      ? [pinnedDayIndex]
      : days.map((_, index) => index).filter((index) => index >= earliestDayIndex);
    const dayIndex = dayIndexes.find((index) => days[index].availableMinutes >= minutes);
    if (dayIndex == null) {
      unscheduled.push({
        workItemId: item.workItemId,
        reason: pinnedDayIndex >= 0 ? "pinned_capacity_exceeded" : "capacity_exhausted",
        ...(pinnedDayIndex >= 0 ? { plannedDate: item.plannedDate } : {}),
      });
      continue;
    }
    const row = {
      workItemId: item.workItemId,
      sourceKind: item.sourceKind ?? "work_item",
      sourceId: item.sourceId ?? item.workItemId,
      localRef: item.localRef,
      title: item.title,
      priority: item.priority,
      status: item.status,
      runtimeState: item.runtimeState ?? null,
      estimatedMinutes: minutes,
      estimateConfidence: item.estimate.confidence,
      previousPlannedDate: item.plannedDate,
      pinned: pinnedDayIndex >= 0,
      expectedRevision: item.revision,
    };
    days[dayIndex].items.push(row);
    days[dayIndex].plannedMinutes += minutes;
    days[dayIndex].availableMinutes -= minutes;
  }

  return {
    generatedAt,
    planRevision: planRevision(capacity, horizon, assumptions),
    terminalId: capacity?.terminal?.id ?? null,
    horizon: { yesterday: addDays(today, -1), today, tomorrow: horizon[1] },
    assumptions,
    days,
    attention,
    unscheduled,
  };
}
