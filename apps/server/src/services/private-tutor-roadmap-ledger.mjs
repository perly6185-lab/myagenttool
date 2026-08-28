export function recordPrivateTutorRoadmapSnapshot(state, {
  learner,
  plan,
  reason = null,
  at,
  nextId,
}) {
  if (!learner || !plan) return null;
  state.privateTutorRoadmapLedgers ??= [];
  const recordedAt = iso(at);
  const goalSignature = stableGoalSignature(plan.learningGoal, plan.scopeKnowledgeIds);
  let ledger = state.privateTutorRoadmapLedgers.find((row) => row.learnerId === learner.id
    && row.contentPackageId === plan.contentPackageId
    && row.activationId === (plan.activationId ?? null)
    && row.status === "active");
  if (ledger && ledger.goalSignature !== goalSignature) {
    ledger.status = "superseded";
    ledger.supersededAt = recordedAt;
    ledger.updatedAt = recordedAt;
    ledger = null;
  }
  if (!ledger) {
    ledger = {
      id: nextId("ptrl"),
      ownerTeamId: learner.ownerTeamId,
      learnerId: learner.id,
      contentPackageId: plan.contentPackageId ?? null,
      contentPackageVersion: plan.contentPackageVersion ?? null,
      subjectId: plan.subjectId ?? null,
      activationId: plan.activationId ?? null,
      status: "active",
      revision: 0,
      goalSignature,
      learningGoal: clone(plan.learningGoal ?? null),
      scopeKnowledgeIds: [...(plan.scopeKnowledgeIds ?? [])],
      baseline: baselineSnapshot(plan, recordedAt),
      snapshots: [],
      weeklyReviews: [],
      createdAt: recordedAt,
      updatedAt: recordedAt,
      supersededAt: null,
    };
    state.privateTutorRoadmapLedgers.unshift(ledger);
  }

  const snapshot = compactPlanSnapshot(plan, reason ?? plan.reason, recordedAt, nextId);
  const latest = ledger.snapshots[0] ?? null;
  if (latest?.planId === snapshot.planId && latest.planRevision === snapshot.planRevision) return ledger;
  if (latest && snapshot.weekIndex > latest.weekIndex && !ledger.weeklyReviews.some((row) => row.weekIndex === latest.weekIndex)) {
    ledger.weeklyReviews.unshift(buildClosedWeekReview(ledger, latest, snapshot, recordedAt, nextId));
  }
  ledger.snapshots.unshift(snapshot);
  ledger.revision += 1;
  ledger.updatedAt = recordedAt;
  return ledger;
}

export function buildPrivateTutorRoadmapLedgerView(state, learnerId, { contentPackageId = null, activationId = null, at } = {}) {
  const ledgers = (state.privateTutorRoadmapLedgers ?? []).filter((row) => row.learnerId === learnerId);
  const ledger = ledgers.find((row) => row.status === "active"
    && (!contentPackageId || row.contentPackageId === contentPackageId)
    && (!activationId || row.activationId === activationId)) ?? null;
  if (!ledger) return null;
  const currentSnapshot = ledger.snapshots[0] ?? null;
  return {
    schemaVersion: 1,
    id: ledger.id,
    learnerId: ledger.learnerId,
    contentPackageId: ledger.contentPackageId,
    contentPackageVersion: ledger.contentPackageVersion,
    status: ledger.status,
    revision: ledger.revision,
    learningGoal: clone(ledger.learningGoal),
    scopeKnowledgeIds: [...ledger.scopeKnowledgeIds],
    baseline: clone(ledger.baseline),
    currentReview: currentSnapshot ? buildCurrentWeekReview(ledger, currentSnapshot, iso(at)) : null,
    weeklyReviews: clone(ledger.weeklyReviews.slice(0, 26)),
    routeVersions: ledger.snapshots.slice(0, 24).map((snapshot) => ({
      id: snapshot.id,
      recordedAt: snapshot.recordedAt,
      reason: snapshot.reason,
      planId: snapshot.planId,
      planRevision: snapshot.planRevision,
      weekIndex: snapshot.weekIndex,
      forecastStatus: snapshot.forecastStatus,
      projectedCompletionDate: snapshot.projectedCompletionDate,
      estimatedRemainingMinutes: snapshot.estimatedRemainingMinutes,
      completedDayCount: snapshot.days.filter((day) => day.status === "completed").length,
      rescheduledDayCount: snapshot.days.filter((day) => day.status === "rescheduled").length,
    })),
    createdAt: ledger.createdAt,
    updatedAt: ledger.updatedAt,
  };
}

function baselineSnapshot(plan, recordedAt) {
  return {
    recordedAt,
    planId: plan.id,
    planRevision: plan.revision,
    weekIndex: weekIndexOf(plan),
    weeklyMinutes: Number(plan.weeklyMinutes ?? 0),
    targetDate: plan.goalForecast?.targetDate ?? null,
    completionWindow: clone(plan.goalForecast?.completionWindow ?? null),
    projectedCompletionDate: plan.goalForecast?.projectedCompletionDate ?? null,
    estimatedRemainingMinutes: Number(plan.goalForecast?.estimatedRemainingMinutes ?? 0),
    estimatedWeekCount: Number(plan.goalRoadmap?.estimatedWeekCount ?? 0),
    milestones: clone(plan.goalRoadmap?.milestones ?? []),
  };
}

function compactPlanSnapshot(plan, reason, recordedAt, nextId) {
  return {
    id: nextId("ptrs"),
    recordedAt,
    reason: reason ?? "plan_updated",
    planId: plan.id,
    planRevision: Number(plan.revision ?? 0),
    weekIndex: weekIndexOf(plan),
    weeklyMinutes: Number(plan.weeklyMinutes ?? 0),
    forecastStatus: plan.goalForecast?.status ?? null,
    projectedCompletionDate: plan.goalForecast?.projectedCompletionDate ?? null,
    estimatedRemainingMinutes: Number(plan.goalForecast?.estimatedRemainingMinutes ?? 0),
    days: (plan.days ?? []).map((day) => ({
      dayIndex: day.dayIndex,
      date: String(day.date).slice(0, 10),
      status: day.status,
      minutes: Number(day.minutes ?? 0),
      originalMinutes: Number(day.originalMinutes ?? 0),
      knowledgeId: day.knowledgeId,
      knowledgeTitle: day.knowledgeTitle,
    })),
  };
}

function buildClosedWeekReview(ledger, snapshot, nextSnapshot, at, nextId) {
  const target = plannedTargetForWeek(ledger, snapshot);
  const actual = completedMinutes(snapshot.days);
  const deviation = actual - target;
  return {
    id: nextId("ptrw"),
    weekIndex: snapshot.weekIndex,
    startDate: snapshot.days[0]?.date ?? null,
    endDate: snapshot.days.at(-1)?.date ?? null,
    plannedMinutes: target,
    completedMinutes: actual,
    deviationMinutes: deviation,
    completionRate: target ? rounded(actual / target, 4) : null,
    status: actual >= target ? "completed" : actual > 0 ? "partial" : "missed",
    reasonCodes: reviewReasonCodes(snapshot, target, actual),
    completedKnowledgeIds: [...new Set(snapshot.days.filter((day) => day.status === "completed").map((day) => day.knowledgeId).filter(Boolean))],
    nextAction: nextActionFromSnapshot(nextSnapshot),
    closedAt: at,
  };
}

function buildCurrentWeekReview(ledger, snapshot, at) {
  const today = at.slice(0, 10);
  const eligible = snapshot.days.filter((day) => day.status !== "rescheduled" && (day.date < today || day.status === "completed"));
  const plannedToDateMinutes = eligible.reduce((total, day) => total + Number(day.status === "rescheduled" ? 0 : day.minutes || 0), 0);
  const completedToDateMinutes = completedMinutes(eligible);
  const deviationMinutes = completedToDateMinutes - plannedToDateMinutes;
  const overdueDayCount = eligible.filter((day) => Number(day.minutes) > 0 && !["completed", "rescheduled"].includes(day.status)).length;
  const fullTarget = plannedTargetForWeek(ledger, snapshot);
  return {
    weekIndex: snapshot.weekIndex,
    startDate: snapshot.days[0]?.date ?? null,
    endDate: snapshot.days.at(-1)?.date ?? null,
    fullWeekPlannedMinutes: fullTarget,
    plannedToDateMinutes,
    completedToDateMinutes,
    deviationMinutes,
    overdueDayCount,
    status: overdueDayCount ? "behind" : plannedToDateMinutes ? "on_track" : "not_started",
    reasonCodes: reviewReasonCodes(snapshot, plannedToDateMinutes, completedToDateMinutes),
    nextAction: nextActionFromSnapshot(snapshot),
    calculatedAt: at,
  };
}

function plannedTargetForWeek(ledger, snapshot) {
  const milestone = ledger.baseline?.milestones?.find((item) => item.weekIndex === snapshot.weekIndex);
  return Number(milestone?.plannedMinutes ?? snapshot.weeklyMinutes ?? 0);
}

function completedMinutes(days) {
  return days.filter((day) => day.status === "completed").reduce((total, day) => total + Number(day.minutes || day.originalMinutes || 0), 0);
}

function reviewReasonCodes(snapshot, planned, actual) {
  const reasons = [];
  if (snapshot.days.some((day) => day.status === "rescheduled")) reasons.push("schedule_adjusted");
  if (actual < planned && snapshot.days.some((day) => Number(day.minutes) > 0 && !["completed", "rescheduled"].includes(day.status))) reasons.push("missed_learning_days");
  if (["new_learning_evidence", "tutoring_session_completed", "tutoring_session_evidence"].includes(snapshot.reason)) reasons.push("learning_evidence_replan");
  if (snapshot.reason === "catch_up_confirmed") reasons.push("buffer_day_used");
  if (!reasons.length) reasons.push(actual >= planned ? "plan_completed" : "awaiting_activity");
  return reasons;
}

function nextActionFromSnapshot(snapshot) {
  const next = snapshot?.days?.find((day) => day.status === "planned" && Number(day.minutes) > 0);
  return next ? {
    type: "continue_plan",
    dayIndex: next.dayIndex,
    date: next.date,
    knowledgeId: next.knowledgeId,
    label: `继续“${next.knowledgeTitle}”`,
  } : { type: "review_goal", dayIndex: null, date: null, knowledgeId: null, label: "复核下一阶段目标" };
}

function stableGoalSignature(goal, scopeKnowledgeIds) {
  const normalized = {
    contentPackageId: goal?.contentPackageId ?? null,
    targetTopicIds: [...(goal?.targetTopicIds ?? [])].sort(),
    weeklyMinutes: goal?.weeklyMinutes ?? null,
    targetDate: goal?.targetDate ?? null,
    note: goal?.note ?? "",
    scopeKnowledgeIds: [...(scopeKnowledgeIds ?? [])].sort(),
  };
  return JSON.stringify(normalized);
}

function weekIndexOf(plan) {
  return Math.max(1, Number(plan.goalRoadmap?.currentWeekIndex) || 1);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function iso(value) {
  const raw = typeof value === "function" ? value() : value;
  const parsed = Date.parse(raw ?? "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function rounded(value, digits) {
  return Number(Number(value).toFixed(digits));
}
