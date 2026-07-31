import { createHash } from "node:crypto";

function revisionFor({ terminalId, sourceDate, schedulePlanRevision, candidates }) {
  return createHash("sha256").update(JSON.stringify({
    terminalId,
    sourceDate,
    schedulePlanRevision,
    candidates: candidates.map((item) => ({
      id: item.workItemId,
      revision: item.revision,
      status: item.status,
      plannedDate: item.plannedDate,
      schedulePlanSource: item.schedulePlanSource,
      manuallyPinned: item.manuallyPinned,
    })),
  })).digest("hex").slice(0, 24);
}

/**
 * Preview yesterday's unfinished current-terminal work without mutating it.
 * Executable work uses the capacity planner's earliest feasible date; planning
 * and attention work rolls into today without consuming terminal minutes.
 */
export function computeLocalScheduleRollover(capacity, schedulePreview) {
  const sourceDate = schedulePreview.horizon.yesterday;
  const today = schedulePreview.horizon.today;
  const scheduledDates = new Map(schedulePreview.days.flatMap((day) =>
    day.items.map((item) => [item.workItemId, day.date])));
  const scheduleReasons = new Map(schedulePreview.unscheduled.map((item) =>
    [item.workItemId, item.reason]));
  const candidates = (capacity?.work?.items ?? [])
    .filter((item) => item.plannedDate === sourceDate)
    .filter((item) => item.status !== "done")
    .sort((left, right) => String(left.workItemId).localeCompare(String(right.workItemId)));
  const moves = [];
  const confirmationRequired = [];
  const unscheduled = [];

  for (const item of candidates) {
    const targetDate = item.category === "executable"
      ? scheduledDates.get(item.workItemId)
      : today;
    if (!targetDate) {
      unscheduled.push({
        workItemId: item.workItemId,
        reason: scheduleReasons.get(item.workItemId) ?? "no_feasible_local_date",
      });
      continue;
    }
    const move = {
      workItemId: item.workItemId,
      localRef: item.localRef,
      title: item.title,
      status: item.status,
      sourceDate,
      targetDate,
      expectedRevision: item.revision,
      runningContextPreserved: item.status === "in_progress",
      previousPlanSource: item.schedulePlanSource,
      reason: "unfinished_from_previous_local_day",
    };
    if (item.manuallyPinned) confirmationRequired.push(move);
    else moves.push(move);
  }

  return {
    generatedAt: schedulePreview.generatedAt,
    rolloverRevision: revisionFor({
      terminalId: capacity?.terminal?.id ?? null,
      sourceDate,
      schedulePlanRevision: schedulePreview.planRevision,
      candidates,
    }),
    terminalId: capacity?.terminal?.id ?? null,
    sourceDate,
    targetDate: today,
    moves,
    confirmationRequired,
    unscheduled,
  };
}
