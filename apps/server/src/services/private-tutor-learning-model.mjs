export const PRIVATE_TUTOR_KNOWLEDGE = [
  { id: "integer", title: "有理数运算", prerequisiteId: null, downstreamImpact: 4 },
  { id: "equation-meaning", title: "等式与方程", prerequisiteId: "integer", downstreamImpact: 3 },
  { id: "balance", title: "等式两边同乘同除", prerequisiteId: "equation-meaning", downstreamImpact: 5 },
  { id: "word-problem", title: "一元一次方程应用", prerequisiteId: "balance", downstreamImpact: 5 },
];

const KNOWLEDGE_BY_ID = new Map(PRIVATE_TUTOR_KNOWLEDGE.map((item) => [item.id, item]));

const MISCONCEPTIONS = {
  single_side_change: { label: "只改变了等式一边", recommendedStrategy: "concept_rebuild" },
  division_fluency: { label: "等式变形正确，但除法结果不稳定", recommendedStrategy: "fluency_practice" },
  negative_subtraction: { label: "减去负数时符号关系未站稳", recommendedStrategy: "prerequisite_repair" },
  equation_definition: { label: "还没有区分等式和含未知数的方程", recommendedStrategy: "concept_rebuild" },
  variable_isolation: { label: "还不清楚怎样让未知数单独留下", recommendedStrategy: "concept_rebuild" },
  equation_translation: { label: "文字关系还没有稳定转换为方程", recommendedStrategy: "concept_rebuild" },
  unresolved_method: { label: "当前方法还没有形成稳定证据", recommendedStrategy: "concept_rebuild" },
};

export function derivePrivateTutorLearnerModel({ snapshot, attempts, now, knowledgeDefinitions = PRIVATE_TUTOR_KNOWLEDGE }) {
  const at = now();
  const definitions = knowledgeDefinitions.map(normalizeKnowledgeDefinition);
  const knowledge = definitions.map((definition) => {
    const snapshotState = snapshot.knowledge.find((item) => item.id === definition.id) ?? {
      mastery: null,
      level: "unknown",
      evidenceCount: 0,
    };
    const evidence = attempts
      .filter((attempt) => attempt.knowledgeId === definition.id)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    const independentCorrect = evidence.filter((attempt) => attempt.correct && attempt.independent && !attempt.usedHint).length;
    const hintedCorrect = evidence.filter((attempt) => attempt.correct && attempt.usedHint).length;
    const incorrect = evidence.filter((attempt) => !attempt.correct).length;
    const latestEvidenceAt = evidence[0]?.createdAt ?? null;
    const misconception = inferMisconception(evidence, definition);
    return {
      id: definition.id,
      title: definition.title,
      mastery: snapshotState.mastery,
      level: snapshotState.level,
      confidence: confidenceFor(snapshotState.mastery, snapshotState.evidenceCount, independentCorrect),
      evidenceCount: snapshotState.evidenceCount,
      independentCorrect,
      hintedCorrect,
      incorrect,
      hintDependency: evidence.length ? Number((evidence.filter((attempt) => attempt.usedHint).length / evidence.length).toFixed(2)) : 0,
      latestEvidenceAt,
      forgettingRisk: forgettingRisk(latestEvidenceAt, at),
      misconception,
      prerequisiteId: definition.prerequisiteId,
      prerequisiteGap: false,
      downstreamImpact: definition.downstreamImpact,
      recentAttemptIds: evidence.slice(0, 5).map((attempt) => attempt.id),
    };
  });
  for (const item of knowledge) {
    const prerequisite = knowledge.find((candidate) => candidate.id === item.prerequisiteId);
    item.prerequisiteGap = item.mastery != null
      && item.mastery < 0.75
      && prerequisite?.mastery != null
      && prerequisite.mastery < 0.55;
  }
  return { at, knowledge };
}

export function decidePrivateTutorStrategy({ model, attempts, previousDecision = null, scopeKnowledgeIds = null }) {
  const scope = normalizedScope(scopeKnowledgeIds);
  const measured = model.knowledge.filter((item) => item.mastery != null && (!scope || scope.has(item.id)));
  if (!measured.length) return null;
  const ranked = [...measured].sort((left, right) => priorityScore(right) - priorityScore(left));
  let target = ranked[0];
  let strategy;
  let reasonCode;
  let studentReason;
  if (target.prerequisiteGap) {
    target = model.knowledge.find((item) => item.id === target.prerequisiteId) ?? target;
    strategy = "prerequisite_repair";
    reasonCode = "prerequisite_gap";
    studentReason = `先把“${target.title}”补稳，后面的内容会更容易。`;
  } else if (target.misconception) {
    strategy = target.misconception.recommendedStrategy;
    reasonCode = `misconception:${target.misconception.id}`;
    studentReason = `最近的答案显示“${target.misconception.label}”，这次换一种更合适的方法。`;
  } else if (target.mastery >= 0.8) {
    strategy = "transfer_challenge";
    reasonCode = target.forgettingRisk >= 0.5 ? "delayed_retrieval_due" : "ready_for_transfer";
    studentReason = `“${target.title}”已经比较稳，换一道新情境确认真的会用。`;
  } else if (target.mastery >= 0.55) {
    strategy = "fluency_practice";
    reasonCode = "concept_present_needs_fluency";
    studentReason = `“${target.title}”已经理解，接下来用短练习让它更熟练。`;
  } else {
    strategy = "concept_rebuild";
    reasonCode = "concept_not_stable";
    studentReason = `“${target.title}”还没有站稳，我们用图和步骤重新理解。`;
  }

  const latestForTarget = attempts
    .filter((attempt) => attempt.knowledgeId === target.id)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, 2);
  const repeatedError = latestForTarget.length === 2 && latestForTarget.every((attempt) => !attempt.correct);
  if (repeatedError && previousDecision?.targetKnowledgeId === target.id && previousDecision.strategy === strategy) {
    strategy = alternateStrategy(strategy);
    reasonCode = "method_changed_after_repeated_error";
    studentReason = `刚才的方法没有帮你弄懂“${target.title}”，现在换一种讲法。`;
  }

  return {
    targetKnowledgeId: target.id,
    targetTitle: target.title,
    strategy,
    reasonCode,
    studentReason,
    misconception: target.misconception,
    evidenceAttemptIds: target.recentAttemptIds,
    exitConditions: exitConditions(strategy, target.id),
  };
}

export function buildPrivateTutorSevenDayPlan({ model, decision, now, reason = "diagnostic_completed", carryForwardKnowledgeId = null, scopeKnowledgeIds = null, dailyMinutes = 20, planIntensity = "standard", learningGoal = null, planWeekIndex = 1, effortEvidence = [] }) {
  if (!decision) return null;
  const scope = normalizedScope(scopeKnowledgeIds) ?? new Set(model.knowledge.map((item) => item.id));
  const scoped = model.knowledge.filter((item) => scope.has(item.id));
  const measured = scoped
    .filter((item) => item.mastery != null)
    .sort((left, right) => priorityScore(right) - priorityScore(left));
  const candidates = measured.length ? measured : scoped;
  const primary = candidates.find((item) => item.id === carryForwardKnowledgeId)
    ?? candidates.find((item) => item.id === decision.targetKnowledgeId)
    ?? candidates[0];
  if (!primary) return null;
  const alternatives = candidates.filter((item) => item.id !== primary.id);
  const secondary = alternatives[0] ?? primary;
  const tertiary = alternatives[1] ?? secondary;
  const plannedMinutes = Math.max(5, Math.min(180, Math.round(Number(dailyMinutes) || 20)));
  const intensity = ["relaxed", "standard", "intensive"].includes(planIntensity) ? planIntensity : "standard";
  const goal = normalizedLearningGoal(learningGoal);
  const schedule = weeklySchedule(plannedMinutes, goal?.weeklyMinutes ?? null);
  const goalForecast = buildPrivateTutorGoalForecast({
    model,
    scopeKnowledgeIds: [...scope],
    learningGoal: goal,
    weeklyMinutes: schedule.weeklyMinutes,
    at: generatedDate(now),
    effortEvidence,
  });
  const pattern = [
    { item: primary, activity: "teach", strategy: decision.strategy },
    { item: secondary, activity: "repair", strategy: basicStrategy(secondary) },
    { item: primary, activity: "independent_practice", strategy: "fluency_practice" },
    { item: tertiary, activity: intensity === "relaxed" ? "spaced_review" : "teach", strategy: basicStrategy(tertiary) },
    { item: primary, activity: "transfer", strategy: "transfer_challenge" },
    { item: secondary, activity: intensity === "intensive" ? "mixed_check" : "spaced_review", strategy: "transfer_challenge" },
    { item: primary, activity: "mixed_check", strategy: "transfer_challenge" },
  ];
  const generatedAt = goalForecast.generatedAt;
  let learningDayIndex = 0;
  const days = schedule.days.map((minutes, index) => {
    if (minutes === 0) {
      return {
        dayIndex: index + 1,
        date: addDays(generatedAt, index),
        status: "rest",
        knowledgeId: primary.id,
        knowledgeTitle: primary.title,
        activity: "rest",
        title: "休息或机动回顾",
        minutes: 0,
        strategy: decision.strategy,
        rationale: "按每周时间预算留出恢复空间；如果状态好，可以自由回想，不计为必做任务。",
      };
    }
    const { item, activity, strategy } = pattern[learningDayIndex % pattern.length];
    learningDayIndex += 1;
    return {
      dayIndex: index + 1,
      date: addDays(generatedAt, index),
      status: "planned",
      knowledgeId: item.id,
      knowledgeTitle: item.title,
      activity,
      title: activityTitle(activity, item.title),
      minutes,
      strategy,
      rationale: learningDayIndex === 1 ? decision.studentReason : rationale(activity, item.title),
    };
  });
  return {
    generatedAt,
    reason,
    dailyMinutes: plannedMinutes,
    weeklyMinutes: schedule.weeklyMinutes,
    planIntensity: intensity,
    learningGoal: goal,
    scopeKnowledgeIds: [...scope],
    goalForecast,
    goalRoadmap: buildPrivateTutorGoalRoadmap({
      model,
      scopeKnowledgeIds: [...scope],
      goalForecast,
      currentWeekIndex: planWeekIndex,
    }),
    studentReason: reason === "missed_day_rescheduled"
      ? "昨天没完成也没关系，计划已经顺延，今天从最合适的位置继续。"
      : goal?.note
        ? `${decision.studentReason} 这周围绕“${goal.note}”安排。`
        : decision.studentReason,
    days,
  };
}

export function buildPrivateTutorGoalRoadmap({ model, scopeKnowledgeIds = null, goalForecast, currentWeekIndex = 1 }) {
  const scope = normalizedScope(scopeKnowledgeIds) ?? new Set(model?.knowledge?.map((item) => item.id) ?? []);
  const weekIndex = Math.max(1, Math.round(Number(currentWeekIndex) || 1));
  const capacity = Math.max(5, Number(goalForecast?.weeklyCapacityMinutes) || 140);
  const effortProfile = goalForecast?.effortProfile ?? derivePrivateTutorEffortProfile([]);
  const tasks = (model?.knowledge ?? [])
    .filter((item) => scope.has(item.id) && estimatedGoalMinutes(item) > 0)
    .sort((left, right) => priorityScore(right) - priorityScore(left))
    .map((item) => ({
      knowledgeId: item.id,
      title: item.title,
      remainingMinutes: Math.max(5, Math.round(estimatedGoalMinutes(item) * effortFactorForKnowledge(effortProfile, item.id))),
    }));
  const totalWeekCount = Math.max(0, Number(goalForecast?.estimatedWeekCount) || 0);
  const visibleWeekCount = Math.min(totalWeekCount, 52);
  const mutableTasks = tasks.map((item) => ({ ...item }));
  let taskIndex = 0;
  let cumulativePlannedMinutes = 0;
  let cumulativeCompletedKnowledgeCount = Number(goalForecast?.masteredKnowledgeCount) || 0;
  const milestones = [];
  for (let offset = 0; offset < visibleWeekCount; offset += 1) {
    let available = capacity;
    const knowledgeGoals = [];
    while (available > 0 && taskIndex < mutableTasks.length) {
      const task = mutableTasks[taskIndex];
      const allocatedMinutes = Math.min(available, task.remainingMinutes);
      task.remainingMinutes -= allocatedMinutes;
      available -= allocatedMinutes;
      cumulativePlannedMinutes += allocatedMinutes;
      const expectedComplete = task.remainingMinutes === 0;
      knowledgeGoals.push({
        knowledgeId: task.knowledgeId,
        title: task.title,
        plannedMinutes: allocatedMinutes,
        expectedComplete,
      });
      if (expectedComplete) {
        cumulativeCompletedKnowledgeCount += 1;
        taskIndex += 1;
      }
    }
    const plannedMinutes = capacity - available;
    milestones.push({
      weekIndex: weekIndex + offset,
      startDate: addDays(goalForecast.generatedAt, offset * 7),
      endDate: addDays(goalForecast.generatedAt, offset * 7 + 6),
      status: offset === 0 ? "current" : "upcoming",
      plannedMinutes,
      cumulativePlannedMinutes,
      expectedCompletedKnowledgeCount: cumulativeCompletedKnowledgeCount,
      knowledgeGoals,
    });
  }
  return {
    schemaVersion: 2,
    generatedAt: goalForecast.generatedAt,
    currentWeekIndex: weekIndex,
    estimatedWeekCount: totalWeekCount,
    projectedFinalWeekIndex: totalWeekCount ? weekIndex + totalWeekCount - 1 : weekIndex,
    scopeKnowledgeCount: goalForecast.scopeKnowledgeCount,
    completedKnowledgeCount: goalForecast.masteredKnowledgeCount,
    targetDate: goalForecast.targetDate,
    status: goalForecast.status,
    milestones,
    hiddenMilestoneCount: Math.max(0, totalWeekCount - visibleWeekCount),
  };
}

export function derivePrivateTutorPlanProgress(plan, { at } = {}) {
  const today = generatedDate(() => at ?? new Date().toISOString()).slice(0, 10);
  const learningDays = (plan?.days ?? []).filter((day) => Number(day.minutes) > 0 && day.status !== "rescheduled");
  const dueDays = learningDays.filter((day) => String(day.date).slice(0, 10) < today);
  const overdueDays = dueDays.filter((day) => !["completed", "rescheduled"].includes(day.status));
  const scheduledElapsedMinutes = dueDays.reduce((total, day) => total + Number(day.minutes || 0), 0);
  const completedElapsedMinutes = dueDays.filter((day) => day.status === "completed")
    .reduce((total, day) => total + Number(day.minutes || 0), 0);
  const behindMinutes = overdueDays.reduce((total, day) => total + Number(day.minutes || 0), 0);
  const futureBufferDays = (plan?.days ?? []).filter((day) => day.status === "rest" && String(day.date).slice(0, 10) >= today);
  const recoverableDayCount = Math.min(overdueDays.length, futureBufferDays.length);
  const dailyMinutes = Math.max(5, Number(plan?.dailyMinutes) || 20);
  let status = "no_due_work";
  if (dueDays.length && behindMinutes === 0) status = "on_track";
  else if (behindMinutes > 0 && (overdueDays.length >= 2 || behindMinutes >= dailyMinutes * 2)) status = "behind";
  else if (behindMinutes > 0) status = "attention";
  return {
    schemaVersion: 1,
    calculatedAt: generatedDate(() => at ?? new Date().toISOString()),
    status,
    scheduledElapsedMinutes,
    completedElapsedMinutes,
    behindMinutes,
    overdueDayCount: overdueDays.length,
    overdueDayIndexes: overdueDays.map((day) => day.dayIndex),
    recoverableDayCount,
    catchUpAvailable: recoverableDayCount > 0,
    nextPlannedDate: learningDays.find((day) => day.status === "planned" && String(day.date).slice(0, 10) >= today)?.date ?? null,
  };
}

export function buildPrivateTutorCatchUpPlanPreview(plan, { at } = {}) {
  const progress = derivePrivateTutorPlanProgress(plan, { at });
  const today = progress.calculatedAt.slice(0, 10);
  const overdueDays = progress.overdueDayIndexes
    .map((dayIndex) => plan?.days?.find((day) => day.dayIndex === dayIndex))
    .filter(Boolean);
  const bufferDays = (plan?.days ?? []).filter((day) => day.status === "rest" && String(day.date).slice(0, 10) >= today);
  const assignments = overdueDays.slice(0, bufferDays.length).map((source, index) => ({
    sourceDayIndex: source.dayIndex,
    sourceDate: source.date,
    targetDayIndex: bufferDays[index].dayIndex,
    targetDate: bufferDays[index].date,
    minutes: source.minutes,
    knowledgeId: source.knowledgeId,
    knowledgeTitle: source.knowledgeTitle,
    title: source.title,
  }));
  return {
    schemaVersion: 1,
    planId: plan?.id ?? null,
    expectedPlanRevision: Number(plan?.revision) || 0,
    generatedAt: progress.calculatedAt,
    progress,
    assignments,
    recoveredMinutes: assignments.reduce((total, item) => total + Number(item.minutes || 0), 0),
    remainingBehindMinutes: Math.max(0, progress.behindMinutes - assignments.reduce((total, item) => total + Number(item.minutes || 0), 0)),
    canConfirm: assignments.length > 0,
  };
}

export function applyPrivateTutorCatchUpPlan(plan, preview, { at } = {}) {
  if (!plan || !preview?.canConfirm || plan.id !== preview.planId || Number(plan.revision) !== Number(preview.expectedPlanRevision)) return null;
  for (const assignment of preview.assignments) {
    const source = plan.days.find((day) => day.dayIndex === assignment.sourceDayIndex);
    const target = plan.days.find((day) => day.dayIndex === assignment.targetDayIndex);
    if (!source || !target || target.status !== "rest" || ["completed", "rescheduled"].includes(source.status)) return null;
    const originalMinutes = Number(source.minutes || assignment.minutes);
    source.status = "rescheduled";
    source.originalMinutes = originalMinutes;
    source.minutes = 0;
    source.rescheduledToDayIndex = target.dayIndex;
    target.status = "planned";
    target.knowledgeId = source.knowledgeId;
    target.knowledgeTitle = source.knowledgeTitle;
    target.activity = "catch_up";
    target.title = `机动补上：${source.knowledgeTitle}`;
    target.minutes = originalMinutes;
    target.strategy = source.strategy;
    target.rationale = `把第 ${source.dayIndex} 天未完成的任务移到机动日；原学习证据和其他安排保持不变。`;
    target.catchUpSourceDayIndex = source.dayIndex;
  }
  plan.reason = "catch_up_confirmed";
  plan.revision = Number(plan.revision ?? 0) + 1;
  plan.updatedAt = generatedDate(() => at ?? new Date().toISOString());
  return plan;
}

export function buildPrivateTutorGoalForecast({ model, scopeKnowledgeIds = null, learningGoal = null, weeklyMinutes = 140, at, effortEvidence = [] }) {
  const generatedAt = generatedDate(() => at);
  const scope = normalizedScope(scopeKnowledgeIds) ?? new Set(model?.knowledge?.map((item) => item.id) ?? []);
  const knowledge = (model?.knowledge ?? []).filter((item) => scope.has(item.id));
  const masteredKnowledgeCount = knowledge.filter((item) => item.level === "mastered" && Number(item.forgettingRisk ?? 0) < 0.5).length;
  const effortProfile = derivePrivateTutorEffortProfile(effortEvidence);
  const baselineRemainingMinutes = knowledge.reduce((total, item) => total + estimatedGoalMinutes(item), 0);
  const estimatedRemainingMinutes = Math.round(knowledge.reduce((total, item) => (
    total + estimatedGoalMinutes(item) * effortFactorForKnowledge(effortProfile, item.id)
  ), 0));
  const optimisticRemainingMinutes = estimatedRemainingMinutes === 0 ? 0 : Math.max(5, Math.round(estimatedRemainingMinutes * (1 - effortProfile.uncertaintyRate)));
  const conservativeRemainingMinutes = estimatedRemainingMinutes === 0 ? 0 : Math.round(estimatedRemainingMinutes * (1 + effortProfile.uncertaintyRate));
  const capacity = Math.max(5, Math.round(Number(weeklyMinutes) || 140));
  const goal = normalizedLearningGoal(learningGoal);
  const targetDate = goal?.targetDate ?? null;
  const estimatedWeekCount = estimatedRemainingMinutes > 0 ? Math.max(1, Math.ceil(estimatedRemainingMinutes / capacity)) : 0;
  const projectedCompletionDate = estimatedRemainingMinutes > 0
    ? addDays(generatedAt, Math.max(0, Math.ceil((estimatedRemainingMinutes / capacity) * 7) - 1))
    : generatedAt.slice(0, 10);
  const optimisticCompletionDate = optimisticRemainingMinutes > 0
    ? addDays(generatedAt, Math.max(0, Math.ceil((optimisticRemainingMinutes / capacity) * 7) - 1))
    : generatedAt.slice(0, 10);
  const conservativeCompletionDate = conservativeRemainingMinutes > 0
    ? addDays(generatedAt, Math.max(0, Math.ceil((conservativeRemainingMinutes / capacity) * 7) - 1))
    : generatedAt.slice(0, 10);
  const daysRemaining = targetDate ? differenceInUtcDays(generatedAt, targetDate) : null;
  const availableMinutesUntilTarget = daysRemaining == null
    ? null
    : Math.max(0, Math.floor(capacity * (Math.max(0, daysRemaining) + 1) / 7));
  const requiredWeeklyMinutes = daysRemaining == null || estimatedRemainingMinutes === 0
    ? 0
    : Math.ceil(estimatedRemainingMinutes / Math.max((daysRemaining + 1) / 7, 1 / 7));
  let status = "no_target_date";
  let reasonCode = "target_date_not_set";
  if (estimatedRemainingMinutes === 0) {
    status = "achieved";
    reasonCode = "goal_evidence_stable";
  } else if (daysRemaining != null && daysRemaining < 0) {
    status = "overdue";
    reasonCode = "target_date_passed";
  } else if (daysRemaining != null && availableMinutesUntilTarget < optimisticRemainingMinutes) {
    status = "infeasible";
    reasonCode = "weekly_capacity_below_estimate";
  } else if (daysRemaining != null && availableMinutesUntilTarget < conservativeRemainingMinutes) {
    status = "at_risk";
    reasonCode = "capacity_has_little_buffer";
  } else if (daysRemaining != null) {
    status = "on_track";
    reasonCode = "capacity_covers_estimate";
  }
  return {
    schemaVersion: 1,
    assumptionVersion: "knowledge-effort-v1",
    generatedAt,
    status,
    reasonCode,
    targetDate,
    scopeKnowledgeCount: knowledge.length,
    masteredKnowledgeCount,
    remainingKnowledgeCount: Math.max(0, knowledge.length - masteredKnowledgeCount),
    baselineRemainingMinutes,
    optimisticRemainingMinutes,
    estimatedRemainingMinutes,
    conservativeRemainingMinutes,
    weeklyCapacityMinutes: capacity,
    estimatedWeekCount,
    projectedCompletionDate,
    completionWindow: {
      optimistic: optimisticCompletionDate,
      likely: projectedCompletionDate,
      conservative: conservativeCompletionDate,
    },
    daysRemaining,
    availableMinutesUntilTarget,
    requiredWeeklyMinutes,
    effortProfile,
  };
}

export function derivePrivateTutorEffortProfile(sessions = []) {
  const observations = (Array.isArray(sessions) ? sessions : []).flatMap((session) => {
    const actualMinutes = observedPrivateTutorSessionMinutes(session);
    const plannedMinutes = Number(session?.plannedMinutes ?? 0);
    if (!Number.isFinite(actualMinutes) || actualMinutes < 1 || !Number.isFinite(plannedMinutes) || plannedMinutes < 1) return [];
    return [{
      knowledgeId: String(session.targetKnowledgeId ?? ""),
      ratio: Math.max(0.5, Math.min(2, actualMinutes / plannedMinutes)),
    }];
  });
  const ratios = observations.map((item) => item.ratio);
  const calibrationFactor = ratios.length ? rounded(median(ratios), 2) : 1;
  const deviation = ratios.length ? median(ratios.map((ratio) => Math.abs(ratio - calibrationFactor))) : 0.3;
  const uncertaintyRate = rounded(ratios.length >= 8 ? Math.max(0.12, Math.min(0.3, deviation * 1.5)) : ratios.length >= 3 ? 0.2 : 0.3, 2);
  const knowledgeFactors = [...new Set(observations.map((item) => item.knowledgeId).filter(Boolean))].map((knowledgeId) => {
    const values = observations.filter((item) => item.knowledgeId === knowledgeId).map((item) => item.ratio);
    return { knowledgeId, sampleCount: values.length, factor: rounded(values.length >= 2 ? median(values) : calibrationFactor, 2) };
  });
  return {
    schemaVersion: 1,
    modelVersion: "observed-session-effort-v1",
    sampleCount: observations.length,
    calibrationFactor,
    uncertaintyRate,
    confidence: observations.length >= 8 ? "high" : observations.length >= 3 ? "medium" : "low",
    source: observations.length ? "completed_session_timing" : "default_assumptions",
    knowledgeFactors,
  };
}

export function rollPrivateTutorFuturePlan(plan, generated, { modelId = null, decisionId = null, now } = {}) {
  if (!plan || !generated || !Array.isArray(plan.days) || !Array.isArray(generated.days)) return plan;
  const replacements = generated.days.filter((day) => day.status === "planned");
  let replacementIndex = 0;
  plan.days = plan.days.map((day) => {
    if (day.status !== "planned") return day;
    const replacement = replacements[replacementIndex++] ?? replacements.at(-1);
    if (!replacement) return day;
    return {
      ...replacement,
      dayIndex: day.dayIndex,
      date: day.date,
    };
  });
  plan.modelId = modelId ?? plan.modelId;
  plan.decisionId = decisionId ?? plan.decisionId;
  plan.reason = "tutoring_session_completed";
  plan.studentReason = generated.studentReason;
  plan.dailyMinutes = generated.dailyMinutes;
  plan.weeklyMinutes = plan.days.reduce(
    (total, day) => total + Number(day.minutes || 0),
    0
  );
  plan.planIntensity = generated.planIntensity;
  plan.learningGoal = generated.learningGoal;
  plan.scopeKnowledgeIds = generated.scopeKnowledgeIds;
  plan.goalForecast = generated.goalForecast;
  plan.goalRoadmap = generated.goalRoadmap;
  plan.revision = Number(plan.revision ?? 0) + 1;
  plan.status = plan.days.every((day) => ["completed", "rest", "rescheduled"].includes(day.status)) ? "completed" : "active";
  plan.updatedAt = now ?? generated.generatedAt;
  return plan;
}

export function resolvePrivateTutorGoalScopeKnowledgeIds(contentPackage, learningGoal) {
  if (learningGoal?.contentPackageId && learningGoal.contentPackageId !== contentPackage?.id) return null;
  const requested = new Set((learningGoal?.targetTopicIds ?? []).map((id) => String(id).trim()).filter(Boolean));
  if (!requested.size) return null;
  const definitions = contentPackage?.knowledgeComponents ?? [];
  const definitionsById = new Map(definitions.map((item) => [item.id, item]));
  const selected = new Set(definitions.filter((item) => requested.has(item.id)).map((item) => item.id));
  for (const module of contentPackage?.modules ?? []) {
    for (const topic of module.topics ?? []) {
      if (!requested.has(topic.id)) continue;
      for (const knowledgeId of topic.knowledgeComponentIds ?? []) {
        if (definitionsById.has(knowledgeId)) selected.add(knowledgeId);
      }
    }
  }
  if (!selected.size) return null;
  const pending = [...selected];
  while (pending.length) {
    const knowledgeId = pending.pop();
    const definition = definitionsById.get(knowledgeId);
    for (const prerequisiteId of definition?.prerequisiteKnowledgeIds ?? []) {
      if (!definitionsById.has(prerequisiteId) || selected.has(prerequisiteId)) continue;
      selected.add(prerequisiteId);
      pending.push(prerequisiteId);
    }
  }
  return definitions.map((item) => item.id).filter((id) => selected.has(id));
}

function inferMisconception(evidence, definition) {
  const wrong = evidence.filter((attempt) => !attempt.correct);
  if (!wrong.length) return null;
  const ids = wrong.map((attempt) => misconceptionIdForAttempt(attempt));
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const [id, evidenceCount] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  const packageDefinition = definition.misconceptions?.find((item) => item.id === id)
    ?? definition.misconceptions?.[0];
  const resolved = MISCONCEPTIONS[id] ?? (packageDefinition ? {
    label: packageDefinition.label,
    recommendedStrategy: packageDefinition.recommendedStrategy ?? "concept_rebuild",
  } : MISCONCEPTIONS.unresolved_method);
  return { id: packageDefinition?.id ?? id, ...resolved, evidenceCount };
}

function normalizeKnowledgeDefinition(definition) {
  return {
    ...definition,
    title: definition.title ?? definition.name ?? definition.id,
    prerequisiteId: definition.prerequisiteId ?? definition.prerequisiteKnowledgeIds?.[0] ?? null,
    downstreamImpact: Number(definition.downstreamImpact ?? 1),
    misconceptions: definition.misconceptions ?? [],
  };
}

function normalizedScope(scopeKnowledgeIds) {
  if (!Array.isArray(scopeKnowledgeIds) || !scopeKnowledgeIds.length) return null;
  return new Set(scopeKnowledgeIds.map((id) => String(id).trim()).filter(Boolean));
}

function normalizedLearningGoal(goal) {
  if (!goal || typeof goal !== "object") return null;
  const weeklyMinutes = Number.isFinite(Number(goal.weeklyMinutes))
    ? Math.max(5, Math.min(1_260, Math.round(Number(goal.weeklyMinutes))))
    : null;
  return {
    contentPackageId: typeof goal.contentPackageId === "string" ? goal.contentPackageId.trim().slice(0, 200) || null : null,
    targetTopicIds: Array.isArray(goal.targetTopicIds) ? [...new Set(goal.targetTopicIds.map((id) => String(id).trim()).filter(Boolean))] : [],
    weeklyMinutes,
    targetDate: typeof goal.targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(goal.targetDate) ? goal.targetDate : null,
    note: typeof goal.note === "string" ? goal.note.trim().slice(0, 200) : "",
  };
}

function estimatedGoalMinutes(item) {
  if (item.level === "mastered" && Number(item.forgettingRisk ?? 0) < 0.5) return 0;
  let minutes = item.level === "mastered" ? 20 : item.level === "learning" ? 45 : item.level === "needs_support" ? 75 : 60;
  if (item.prerequisiteGap) minutes += 15;
  if (item.misconception) minutes += 15;
  return minutes;
}

function effortFactorForKnowledge(profile, knowledgeId) {
  return profile.knowledgeFactors.find((item) => item.knowledgeId === knowledgeId)?.factor ?? profile.calibrationFactor;
}

function observedPrivateTutorSessionMinutes(session) {
  if (session?.status !== "completed") return null;
  const activitySeconds = (session.activities ?? []).reduce((total, activity) => {
    const started = Date.parse(activity.startedAt ?? "");
    const completed = Date.parse(activity.completedAt ?? "");
    if (!Number.isFinite(started) || !Number.isFinite(completed) || completed <= started) return total;
    const cap = Math.max(60, Number(activity.budgetMinutes ?? 1) * 60 * 2);
    return total + Math.min(cap, (completed - started) / 1_000);
  }, 0);
  if (activitySeconds >= 60) return activitySeconds / 60;
  const started = Date.parse(session.startedAt ?? "");
  const completed = Date.parse(session.completedAt ?? "");
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed <= started) return null;
  const wallMinutes = (completed - started) / 60_000;
  const cap = Math.max(5, Number(session.plannedMinutes ?? 20) * 2);
  return Math.min(cap, wallMinutes);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((left, right) => left - right);
  if (!sorted.length) return 1;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rounded(value, digits) {
  return Number(Number(value).toFixed(digits));
}

function generatedDate(now) {
  const value = typeof now === "function" ? now() : now;
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString();
}

function differenceInUtcDays(from, targetDate) {
  const fromDate = new Date(from);
  const fromDay = Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate());
  return Math.round((Date.parse(`${targetDate}T00:00:00.000Z`) - fromDay) / 86_400_000);
}

function weeklySchedule(dailyMinutes, requestedWeeklyMinutes) {
  if (requestedWeeklyMinutes == null) return { weeklyMinutes: dailyMinutes * 7, days: Array(7).fill(dailyMinutes) };
  const weeklyMinutes = Math.max(5, Math.min(requestedWeeklyMinutes, dailyMinutes * 7));
  const learningDayCount = Math.max(1, Math.min(7, Math.ceil(weeklyMinutes / dailyMinutes)));
  const slots = evenlySpacedSlots(learningDayCount);
  const base = Math.floor(weeklyMinutes / learningDayCount);
  let remainder = weeklyMinutes - base * learningDayCount;
  const days = Array(7).fill(0);
  for (const slot of slots) {
    days[slot] = base + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
  }
  return { weeklyMinutes, days };
}

function evenlySpacedSlots(count) {
  if (count >= 7) return [0, 1, 2, 3, 4, 5, 6];
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, index) => Math.round(index * 6 / (count - 1)));
}

function misconceptionIdForAttempt(attempt) {
  if (attempt.questionRevisionId === "diag-bal-01-v1") return "single_side_change";
  if (["diag-bal-02-v1", "diag-bal-03-v1", "demo-balance-001-v1"].includes(attempt.questionRevisionId)) return "division_fluency";
  if (attempt.questionRevisionId === "diag-int-03-v1") return "negative_subtraction";
  if (attempt.questionRevisionId === "diag-eqm-01-v1") return "equation_definition";
  if (String(attempt.knowledgeId) === "equation-meaning") return "variable_isolation";
  if (String(attempt.knowledgeId) === "word-problem") return "equation_translation";
  return "unresolved_method";
}

function confidenceFor(mastery, evidenceCount, independentCorrect) {
  if (mastery == null) return 0;
  return Math.min(0.95, Number((0.25 + Math.min(5, evidenceCount) * 0.12 + Math.min(3, independentCorrect) * 0.03).toFixed(2)));
}

function forgettingRisk(latestEvidenceAt, at) {
  if (!latestEvidenceAt) return 0;
  const days = Math.max(0, (Date.parse(at) - Date.parse(latestEvidenceAt)) / 86_400_000);
  if (days >= 14) return 0.8;
  if (days >= 7) return 0.55;
  if (days >= 3) return 0.3;
  return 0.1;
}

function priorityScore(item) {
  return (1 - item.mastery) * 2
    + item.forgettingRisk
    + item.downstreamImpact * 0.12
    + (item.prerequisiteGap ? 0.8 : 0)
    + (item.misconception ? 0.35 : 0);
}

function basicStrategy(item) {
  if (item.prerequisiteGap) return "prerequisite_repair";
  if (item.misconception) return item.misconception.recommendedStrategy;
  if (item.mastery >= 0.8) return "transfer_challenge";
  if (item.mastery >= 0.55) return "fluency_practice";
  return "concept_rebuild";
}

function alternateStrategy(strategy) {
  return {
    prerequisite_repair: "concept_rebuild",
    concept_rebuild: "prerequisite_repair",
    fluency_practice: "concept_rebuild",
    transfer_challenge: "concept_rebuild",
  }[strategy];
}

function exitConditions(strategy, knowledgeId) {
  const common = [`在 ${knowledgeId} 上独立完成一道新题`, "24 小时后复测仍能说明原因"];
  if (strategy === "prerequisite_repair") return ["前置知识连续两次独立正确", ...common];
  if (strategy === "concept_rebuild") return ["能用自己的话解释关键关系", ...common];
  if (strategy === "fluency_practice") return ["短组练习正确率稳定且不依赖提示", ...common];
  return ["能在新情境中迁移使用", ...common];
}

function activityTitle(activity, knowledgeTitle) {
  return {
    teach: `弄懂：${knowledgeTitle}`,
    repair: `补稳：${knowledgeTitle}`,
    independent_practice: `自己试试：${knowledgeTitle}`,
    transfer: `换个情境：${knowledgeTitle}`,
    spaced_review: `隔天回想：${knowledgeTitle}`,
    mixed_check: `综合复测：${knowledgeTitle}`,
  }[activity];
}

function rationale(activity, title) {
  if (activity === "spaced_review") return `隔一段时间再回想“${title}”，确认不是短时记住。`;
  if (activity === "transfer" || activity === "mixed_check") return `换一道新题验证“${title}”能否真正迁移。`;
  return `根据当前证据继续巩固“${title}”。`;
}

function addDays(isoDate, offset) {
  const date = new Date(isoDate);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
