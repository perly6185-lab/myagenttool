import { createHash } from "node:crypto";

const PRIORITY_RANK = { p0: 0, p1: 1, p2: 2, p3: 3 };

function timestamp(value, fallback = Number.MAX_SAFE_INTEGER) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compareUrgent(left, right) {
  const due = timestamp(left.dueDate) - timestamp(right.dueDate);
  if (due !== 0) return due;
  const arrival = timestamp(left.createdAt) - timestamp(right.createdAt);
  if (arrival !== 0) return arrival;
  return String(left.workItemId).localeCompare(String(right.workItemId));
}

function compareVictims(left, right) {
  const priority = (PRIORITY_RANK[right.priority] ?? 2) - (PRIORITY_RANK[left.priority] ?? 2);
  if (priority !== 0) return priority;
  const due = timestamp(right.dueDate, 0) - timestamp(left.dueDate, 0);
  if (due !== 0) return due;
  const arrival = timestamp(right.createdAt, 0) - timestamp(left.createdAt, 0);
  if (arrival !== 0) return arrival;
  return String(right.workItemId).localeCompare(String(left.workItemId));
}

/*
 * #1614: like planRevision, digest only what changes the insertion/displacement
 * CONTENT. availableSlots/inFlight and per-item readiness only affect the
 * activation label (immediate vs next_eligible), which apply recomputes
 * server-side at POST time anyway — hashing them made every dispatch
 * start/finish a spurious 409 urgent_plan_stale.
 */
function revisionFor(capacity, schedulePreview, urgentItems) {
  return createHash("sha256").update(JSON.stringify({
    terminalId: capacity?.terminal?.id ?? null,
    schedulePlanRevision: schedulePreview.planRevision,
    urgentItems: urgentItems.map((item) => ({
      id: item.workItemId,
      revision: item.revision,
      dueDate: item.dueDate,
      createdAt: item.createdAt,
      plannedDate: item.plannedDate,
    })),
  })).digest("hex").slice(0, 24);
}

/** Current-terminal-only P0 insertion preview. No running work is displaced. */
export function computeLocalScheduleUrgent(capacity, schedulePreview) {
  const today = schedulePreview.horizon.today;
  const tomorrow = schedulePreview.horizon.tomorrow;
  const byId = new Map((capacity?.work?.items ?? []).map((item) => [item.workItemId, item]));
  const urgentItems = (capacity?.work?.items ?? [])
    .filter((item) => item.priority === "p0" && item.category === "executable")
    .filter((item) => item.status === "ready")
    .filter((item) => !(item.schedulePlanSource === "urgent_insert" && item.plannedDate === today))
    .sort(compareUrgent);
  const urgentIds = new Set(urgentItems.map((item) => item.workItemId));
  const todayPlan = schedulePreview.days.find((day) => day.date === today);
  const tomorrowPlan = schedulePreview.days.find((day) => day.date === tomorrow);
  const normalToday = (todayPlan?.items ?? []).filter((item) => !urgentIds.has(item.workItemId));
  const normalTomorrow = (tomorrowPlan?.items ?? []).filter((item) => !urgentIds.has(item.workItemId));
  let todayMinutes = normalToday.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  let tomorrowAvailable = Math.max(0, (tomorrowPlan?.capacityMinutes ?? 0)
    - normalTomorrow.reduce((sum, item) => sum + item.estimatedMinutes, 0));
  const grossMinutes = schedulePreview.assumptions.grossMinutes;
  const victimRows = normalToday
    .map((row) => ({ row, source: byId.get(row.workItemId) }))
    .filter(({ source }) => source && source.priority !== "p0" && source.status === "ready")
    .sort((left, right) => compareVictims(left.source, right.source));
  const orderedVictims = [
    ...victimRows.filter(({ source }) => !source.manuallyPinned),
    ...victimRows.filter(({ source }) => source.manuallyPinned),
  ];
  const usedVictims = new Set();
  const insertions = [];
  const displacements = [];
  const confirmationRequired = [];
  const unscheduled = [];

  for (const [queueOrder, urgent] of urgentItems.entries()) {
    if (urgent.manuallyPinned && urgent.plannedDate && urgent.plannedDate !== today) {
      unscheduled.push({ workItemId: urgent.workItemId, reason: "urgent_item_pinned" });
      continue;
    }
    const minutes = Math.max(1, Number(urgent.estimate?.minutes) || 60);
    const chosen = [];
    const pinnedChosen = [];
    let freed = 0;
    if (todayMinutes + minutes > grossMinutes) {
      for (const candidate of orderedVictims) {
        if (usedVictims.has(candidate.row.workItemId)) continue;
        if (candidate.row.estimatedMinutes > tomorrowAvailable) continue;
        const displacement = {
          workItemId: candidate.row.workItemId,
          localRef: candidate.row.localRef,
          title: candidate.row.title,
          priority: candidate.row.priority,
          expectedRevision: candidate.row.expectedRevision,
          sourceDate: today,
          targetDate: tomorrow,
          estimatedMinutes: candidate.row.estimatedMinutes,
          manuallyPinned: Boolean(candidate.source.manuallyPinned),
          forWorkItemId: urgent.workItemId,
          reason: "displaced_by_p0",
        };
        if (candidate.source.manuallyPinned) pinnedChosen.push(displacement);
        else chosen.push(displacement);
        freed += candidate.row.estimatedMinutes;
        if (todayMinutes + minutes - freed <= grossMinutes) break;
      }
    }
    if (todayMinutes + minutes - freed > grossMinutes) {
      unscheduled.push({ workItemId: urgent.workItemId, reason: "urgent_capacity_exhausted" });
      continue;
    }
    const activation = urgent.readiness.state === "waiting_worktree"
      ? "head_after_worktree_unlock"
      : !capacity.terminal?.bridgeAvailable
        ? "waiting_terminal"
        : (capacity.capacity.availableSlots > 0 ? "immediate" : "next_eligible");
    const requiresPinnedConfirmation = pinnedChosen.length > 0;
    insertions.push({
      workItemId: urgent.workItemId,
      localRef: urgent.localRef,
      title: urgent.title,
      dueDate: urgent.dueDate,
      createdAt: urgent.createdAt,
      expectedRevision: urgent.revision,
      targetDate: today,
      estimatedMinutes: minutes,
      queueOrder,
      activation,
      requiresPinnedConfirmation,
      reason: activation === "immediate" ? "p0_idle_slot"
        : activation === "next_eligible" ? "p0_next_after_active_work"
          : activation === "head_after_worktree_unlock" ? "p0_waiting_for_same_worktree"
            : "p0_waiting_for_terminal",
    });
    for (const displacement of [...chosen, ...pinnedChosen]) {
      usedVictims.add(displacement.workItemId);
      tomorrowAvailable -= displacement.estimatedMinutes;
      todayMinutes -= displacement.estimatedMinutes;
      if (displacement.manuallyPinned) confirmationRequired.push(displacement);
      else displacements.push(displacement);
    }
    todayMinutes += minutes;
  }

  return {
    generatedAt: schedulePreview.generatedAt,
    urgentRevision: revisionFor(capacity, schedulePreview, urgentItems),
    terminalId: capacity?.terminal?.id ?? null,
    date: today,
    capacity: {
      grossMinutes,
      routineMinutes: schedulePreview.assumptions.allocatableMinutes,
      urgentReserveMinutes: grossMinutes - schedulePreview.assumptions.allocatableMinutes,
      availableSlots: capacity?.capacity?.availableSlots ?? 0,
      inFlight: capacity?.capacity?.inFlight ?? 0,
    },
    insertions,
    displacements,
    confirmationRequired,
    unscheduled,
  };
}
