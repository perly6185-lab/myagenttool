export const PRIVATE_TUTOR_LEARNING_TRIAL_DAYS = 14;
export const PRIVATE_TUTOR_LEARNING_TRIAL_OBSERVATION_DAYS = 2;
export const PRIVATE_TUTOR_LEARNING_TRIAL_MINIMUM_SAMPLES = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export function startPrivateTutorLearningTrial(state, learner, input, {
  actorId,
  contentPackage,
  now,
  nextId,
}) {
  completeExpiredPrivateTutorLearningTrials(state, now());
  const active = currentPrivateTutorLearningTrial(state, learner.id);
  if (active) return { ok: false, status: 409, error: "private_tutor_learning_trial_already_active" };
  if (!contentPackage) return { ok: false, status: 409, error: "private_tutor_learning_trial_content_required" };
  const goal = String(input?.goal ?? "").replace(/\s+/g, " ").trim();
  if (goal.length < 2 || goal.length > 160) {
    return { ok: false, status: 400, error: "invalid_private_tutor_learning_trial_goal" };
  }
  const startedAt = now();
  const trial = {
    id: nextId("ptlt"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    contentPackageId: contentPackage.id,
    contentPackageVersion: contentPackage.version,
    contentPackageName: contentPackage.name,
    goal,
    durationDays: PRIVATE_TUTOR_LEARNING_TRIAL_DAYS,
    observationDays: PRIVATE_TUTOR_LEARNING_TRIAL_OBSERVATION_DAYS,
    status: "active",
    startedBy: actorId,
    startedAt,
    endsAt: addDays(startedAt, PRIVATE_TUTOR_LEARNING_TRIAL_DAYS),
    observationEndsAt: addDays(startedAt, PRIVATE_TUTOR_LEARNING_TRIAL_DAYS + PRIVATE_TUTOR_LEARNING_TRIAL_OBSERVATION_DAYS),
    stoppedAt: null,
    completedAt: null,
    updatedAt: startedAt,
  };
  state.privateTutorLearningTrials.unshift(trial);
  return { ok: true, trial: privateTutorLearningTrialView(state, trial, startedAt) };
}

export function stopPrivateTutorLearningTrial(state, learnerId, { now }) {
  const at = now();
  completeExpiredPrivateTutorLearningTrials(state, at);
  const trial = currentPrivateTutorLearningTrial(state, learnerId);
  if (!trial) return { ok: false, status: 404, error: "private_tutor_learning_trial_not_active" };
  Object.assign(trial, { status: "stopped", stoppedAt: at, updatedAt: at });
  return { ok: true, trial: privateTutorLearningTrialView(state, trial, at) };
}

export function latestPrivateTutorLearningTrialView(state, learnerId, at) {
  const trial = state.privateTutorLearningTrials.find((row) => row.learnerId === learnerId) ?? null;
  return trial ? privateTutorLearningTrialView(state, trial, at) : null;
}

export function completeExpiredPrivateTutorLearningTrials(state, at) {
  let changed = false;
  for (const trial of state.privateTutorLearningTrials ?? []) {
    if (!["active", "observing"].includes(trial.status)) continue;
    const atTime = Date.parse(at);
    const observationEndsAt = observationEndsAtOf(trial);
    if (atTime >= Date.parse(observationEndsAt)) {
      Object.assign(trial, { status: "completed", completedAt: observationEndsAt, updatedAt: at });
      changed = true;
    } else if (trial.status === "active" && atTime >= Date.parse(trial.endsAt)) {
      Object.assign(trial, { status: "observing", updatedAt: at });
      changed = true;
    }
  }
  return changed;
}

export function recordPrivateTutorFollowUpResolution(session, input, { now }) {
  const followUpId = String(input?.followUpId ?? "").trim();
  const resolution = String(input?.resolution ?? "").trim();
  if (!followUpId || !["resolved", "unresolved"].includes(resolution)) {
    return { ok: false, status: 400, error: "invalid_private_tutor_follow_up_resolution" };
  }
  const followUp = (session.followUps ?? []).find((row) => row.id === followUpId);
  if (!followUp) return { ok: false, status: 404, error: "private_tutor_follow_up_not_found" };
  const at = now();
  followUp.resolution = resolution;
  followUp.resolutionRecordedAt = at;
  session.revision += 1;
  session.updatedAt = at;
  return { ok: true, followUp };
}

function currentPrivateTutorLearningTrial(state, learnerId) {
  return (state.privateTutorLearningTrials ?? []).find((row) => row.learnerId === learnerId && ["active", "observing"].includes(row.status)) ?? null;
}

function privateTutorLearningTrialView(state, trial, at) {
  const observationEndsAt = observationEndsAtOf(trial);
  const observationEnd = [at, trial.stoppedAt, trial.completedAt, observationEndsAt]
    .filter(Boolean)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
  const inObservationWindow = (value) => {
    const time = Date.parse(value);
    return Number.isFinite(time) && time >= Date.parse(trial.startedAt) && time <= Date.parse(observationEnd);
  };
  const inLearningWindow = (value) => {
    const time = Date.parse(value);
    return Number.isFinite(time) && time >= Date.parse(trial.startedAt) && time <= Date.parse(trial.endsAt);
  };
  const samePackage = (row) => row.contentPackageId === trial.contentPackageId
    && (!row.contentPackageVersion || row.contentPackageVersion === trial.contentPackageVersion);
  const allSessions = (state.privateTutorSessions ?? []).filter((row) => row.learnerId === trial.learnerId
    && samePackage(row) && inLearningWindow(row.startedAt ?? row.completedAt) && inObservationWindow(row.startedAt ?? row.completedAt));
  const sessions = allSessions.filter((row) => row.status === "completed" && inObservationWindow(row.completedAt));
  const attempts = (state.privateTutorAttempts ?? []).filter((row) => row.learnerId === trial.learnerId
    && samePackage(row) && inObservationWindow(row.createdAt));
  const schedules = (state.privateTutorReviewSchedules ?? []).filter((row) => row.learnerId === trial.learnerId
    && samePackage(row) && inLearningWindow(row.createdAt) && inObservationWindow(row.createdAt));
  const activeDays = new Set([
    ...allSessions.map((row) => String(row.startedAt ?? row.completedAt).slice(0, 10)),
    ...attempts.filter((row) => inLearningWindow(row.createdAt)).map((row) => String(row.createdAt).slice(0, 10)),
  ]);
  const planDays = planDayMetrics(allSessions);
  const nextDayRecall = nextDayRecallMetrics(sessions, attempts, observationEnd);
  const delayedReview = delayedReviewMetrics(schedules, attempts, observationEnd);
  const followUps = followUpMetrics(allSessions, trial, observationEnd);
  const learningProgressEnd = [observationEnd, trial.endsAt]
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
  const dayIndex = Math.max(1, Math.min(trial.durationDays, Math.floor((Date.parse(learningProgressEnd) - Date.parse(trial.startedAt)) / DAY_MS) + 1));
  return {
    id: trial.id,
    learnerId: trial.learnerId,
    contentPackageId: trial.contentPackageId,
    contentPackageVersion: trial.contentPackageVersion,
    contentPackageName: trial.contentPackageName,
    goal: trial.goal,
    durationDays: trial.durationDays,
    observationDays: trial.observationDays ?? PRIVATE_TUTOR_LEARNING_TRIAL_OBSERVATION_DAYS,
    status: trial.status,
    startedAt: trial.startedAt,
    endsAt: trial.endsAt,
    observationEndsAt,
    stoppedAt: trial.stoppedAt,
    completedAt: trial.completedAt,
    progress: {
      dayIndex,
      activeDayCount: activeDays.size,
      daysRemaining: trial.status === "active" ? Math.max(0, trial.durationDays - dayIndex) : 0,
      completedSessionCount: sessions.length,
    },
    metrics: { planDays, nextDayRecall, delayedReview, followUps },
    readiness: {
      minimumSampleCount: PRIVATE_TUTOR_LEARNING_TRIAL_MINIMUM_SAMPLES,
      nextDayRecallReady: nextDayRecall.attemptedCount >= PRIVATE_TUTOR_LEARNING_TRIAL_MINIMUM_SAMPLES,
      delayedReviewReady: delayedReview.attemptedCount >= PRIVATE_TUTOR_LEARNING_TRIAL_MINIMUM_SAMPLES,
      followUpResolutionReady: followUps.feedbackCount >= PRIVATE_TUTOR_LEARNING_TRIAL_MINIMUM_SAMPLES,
    },
    generatedAt: at,
  };
}

function planDayMetrics(sessions) {
  const started = new Set(sessions.filter((row) => row.planId && Number.isInteger(row.planDayIndex))
    .map((row) => `${row.planId}:${row.planDayIndex}`));
  const completed = new Set(sessions.filter((row) => row.status === "completed" && row.planId && Number.isInteger(row.planDayIndex))
    .map((row) => `${row.planId}:${row.planDayIndex}`));
  return { startedCount: started.size, completedCount: completed.size, completionRate: rate(completed.size, started.size) };
}

function nextDayRecallMetrics(sessions, attempts, observationEnd) {
  const opportunities = sessions
    .filter((row) => row.summary?.reviewAt && Date.parse(row.summary.reviewAt) <= Date.parse(observationEnd))
    .sort((left, right) => Date.parse(left.summary.reviewAt) - Date.parse(right.summary.reviewAt));
  const unused = new Set(attempts.map((row) => row.id));
  let attemptedCount = 0;
  let correctCount = 0;
  for (const session of opportunities) {
    const from = Date.parse(session.summary.reviewAt);
    const until = from + (48 * 60 * 60 * 1000);
    const attempt = attempts
      .filter((row) => unused.has(row.id)
        && row.knowledgeId === session.targetKnowledgeId
        && row.independent === true
        && row.usedHint !== true
        && row.evidenceEligible !== false
        && Date.parse(row.createdAt) >= from
        && Date.parse(row.createdAt) <= until)
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))[0];
    if (!attempt) continue;
    unused.delete(attempt.id);
    attemptedCount += 1;
    if (attempt.correct === true) correctCount += 1;
  }
  return { opportunityCount: opportunities.length, attemptedCount, correctCount, retentionRate: rate(correctCount, attemptedCount) };
}

function delayedReviewMetrics(schedules, attempts, observationEnd) {
  const opportunities = schedules.map((schedule) => {
    const variation = (schedule.phaseEvidence ?? []).find((row) => row.phase === "variation" && row.correct === true);
    if (!variation) return null;
    return { schedule, dueAt: new Date(Date.parse(variation.at) + DAY_MS).toISOString() };
  }).filter((item) => item && Date.parse(item.dueAt) <= Date.parse(observationEnd));
  let attemptedCount = 0;
  let correctCount = 0;
  for (const item of opportunities) {
    const delayed = attempts.find((row) => row.reviewScheduleId === item.schedule.id
      && row.reviewPhase === "delayed"
      && Date.parse(row.createdAt) >= Date.parse(item.dueAt)
      && Date.parse(row.createdAt) <= Date.parse(observationEnd));
    if (!delayed) continue;
    attemptedCount += 1;
    if (delayed.correct === true) correctCount += 1;
  }
  return { opportunityCount: opportunities.length, attemptedCount, correctCount, retentionRate: rate(correctCount, attemptedCount) };
}

function followUpMetrics(sessions, trial, observationEnd) {
  const values = sessions.flatMap((session) => session.followUps ?? []).filter((row) => {
    const created = Date.parse(row.createdAt);
    return created >= Date.parse(trial.startedAt)
      && created <= Date.parse(trial.endsAt)
      && created <= Date.parse(observationEnd);
  });
  const feedback = values.filter((row) => {
    if (!["resolved", "unresolved"].includes(row.resolution)) return false;
    const recordedAt = Date.parse(row.resolutionRecordedAt ?? row.createdAt);
    return recordedAt <= Date.parse(observationEnd);
  });
  const resolved = feedback.filter((row) => row.resolution === "resolved");
  return {
    askedCount: values.length,
    feedbackCount: feedback.length,
    resolvedCount: resolved.length,
    resolutionRate: rate(resolved.length, feedback.length),
    feedbackCoverageRate: rate(feedback.length, values.length),
  };
}

function rate(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

function addDays(iso, days) {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString();
}

function observationEndsAtOf(trial) {
  return trial.observationEndsAt
    ?? addDays(trial.endsAt, trial.observationDays ?? PRIVATE_TUTOR_LEARNING_TRIAL_OBSERVATION_DAYS);
}
