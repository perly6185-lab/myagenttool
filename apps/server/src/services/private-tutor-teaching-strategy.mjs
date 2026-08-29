export const PRIVATE_TUTOR_TEACHING_POLICY_SCHEMA_VERSION = 1;
export const PRIVATE_TUTOR_EXPERIENCE_REPORT_SCHEMA_VERSION = 1;

const MANUAL_PLAN_ACTIONS = new Set([
  "learning_goal_confirmed",
  "learning_preferences_updated",
  "learning_plan_catch_up_confirmed",
  "learning_plan_rebalanced",
]);

export function buildPrivateTutorTeachingPolicy(state, {
  learnerId,
  contentPackageId = null,
  targetKnowledgeId,
  strategy = null,
  session = null,
  trigger = "session_started",
  at = new Date().toISOString(),
} = {}) {
  const attempts = (state.privateTutorAttempts ?? []).filter((row) =>
    row.learnerId === learnerId
    && samePackage(row.contentPackageId, contentPackageId)
    && row.knowledgeId === targetKnowledgeId
    && row.context === "tutoring"
    && row.evidenceEligible !== false).slice(0, 20);
  const model = (state.privateTutorLearnerModels ?? []).find((row) =>
    row.learnerId === learnerId && samePackage(row.contentPackageId, contentPackageId));
  const knowledge = model?.knowledge?.find((row) => row.id === targetKnowledgeId) ?? null;
  const incorrectRate = rate(attempts.filter((row) => row.correct === false).length, attempts.length) ?? 0;
  const hintRate = rate(attempts.filter((row) => row.usedHint === true).length, attempts.length) ?? 0;
  const independent = attempts.filter((row) => row.independent === true);
  const independentCorrectRate = rate(independent.filter((row) => row.correct === true).length, independent.length);
  const currentActivity = session?.activities?.[session.currentActivityIndex] ?? null;
  const recentIncorrect = currentActivity?.incorrectCount ?? 0;
  const recentHintLevel = currentActivity?.hintLevel ?? 0;
  const reasonCodes = [];
  let explanationMode = methodForStrategy(strategy);
  let questionDifficulty = "core";
  let hintGranularity = "progressive";
  let reviewIntervalHours = 24;

  if (knowledge?.prerequisiteGap || strategy === "prerequisite_repair" || incorrectRate >= 0.5 || recentIncorrect >= 2) {
    explanationMode = "small_step";
    questionDifficulty = "support";
    hintGranularity = "micro_steps";
    reviewIntervalHours = 8;
    reasonCodes.push(knowledge?.prerequisiteGap ? "prerequisite_gap" : "repeated_incorrect");
  } else if ((knowledge?.hintDependency ?? hintRate) >= 0.45 || hintRate >= 0.45 || recentHintLevel > 0) {
    explanationMode = "worked_example";
    questionDifficulty = "core";
    hintGranularity = "fading";
    reviewIntervalHours = 24;
    reasonCodes.push("hint_dependency");
  } else if ((knowledge?.forgettingRisk ?? 0) >= 0.6 || trigger === "review_due") {
    explanationMode = "contrast_case";
    questionDifficulty = "core";
    hintGranularity = "retrieval_cue";
    reviewIntervalHours = 12;
    reasonCodes.push("forgetting_risk");
  } else if ((knowledge?.mastery ?? 0) >= 0.8 && (independentCorrectRate ?? 0) >= 0.75) {
    explanationMode = "contrast_case";
    questionDifficulty = "challenge";
    hintGranularity = "minimal";
    reviewIntervalHours = 72;
    reasonCodes.push("stable_independent_mastery");
  } else {
    reasonCodes.push(attempts.length ? "recent_evidence_balanced" : "cold_start_preferences");
  }

  const suggestion = suggestionFor({ currentActivity, recentIncorrect, recentHintLevel, hintGranularity });
  return {
    schemaVersion: PRIVATE_TUTOR_TEACHING_POLICY_SCHEMA_VERSION,
    explanationMode,
    questionDifficulty,
    hintGranularity,
    reviewIntervalHours,
    reasonCodes: [...new Set(reasonCodes)],
    confidence: attempts.length >= 8 ? "high" : attempts.length >= 3 ? "medium" : "low",
    evidenceSummary: {
      attemptCount: attempts.length,
      incorrectRate: attempts.length ? incorrectRate : null,
      hintRate: attempts.length ? hintRate : null,
      independentAttemptCount: independent.length,
      independentCorrectRate,
      mastery: knowledge?.mastery ?? null,
      forgettingRisk: knowledge?.forgettingRisk ?? null,
      prerequisiteGap: knowledge?.prerequisiteGap === true,
    },
    suggestion,
    derivedAt: at,
  };
}

export function recordPrivateTutorTeachingStrategyDecision(state, {
  learner,
  session,
  trigger,
  policy = null,
  at,
  nextId,
} = {}) {
  ensureCollections(state);
  const derived = buildPrivateTutorTeachingPolicy(state, {
    learnerId: learner.id,
    contentPackageId: session.contentPackageId,
    targetKnowledgeId: session.targetKnowledgeId,
    strategy: session.strategy,
    session,
    trigger,
    at,
  });
  const value = policy ? { ...policy, suggestion: derived.suggestion, derivedAt: at } : derived;
  const id = nextId("pttsd");
  const suggestion = value.suggestion ? { ...value.suggestion, id: `${id}:suggestion` } : null;
  const decision = {
    id,
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    contentPackageId: session.contentPackageId ?? null,
    contentPackageVersion: session.contentPackageVersion ?? null,
    sessionId: session.id,
    targetKnowledgeId: session.targetKnowledgeId,
    trigger,
    policy: { ...value, suggestion },
    createdAt: at,
  };
  state.privateTutorTeachingStrategyDecisions.unshift(decision);
  session.teachingPolicy = decision.policy;
  session.teachingStrategyDecisionId = decision.id;
  session.teachingMethod = decision.policy.explanationMode;
  if (suggestion) {
    recordPrivateTutorExperienceEvent(state, {
      learner,
      session,
      type: "suggestion_presented",
      details: { suggestionId: suggestion.id, suggestionType: suggestion.type },
      dedupeKey: `suggestion_presented:${suggestion.id}`,
      at,
      nextId,
    });
  }
  return decision;
}

export function recordPrivateTutorSuggestionAdoption(state, {
  learner,
  session,
  action,
  at,
  nextId,
} = {}) {
  const suggestion = session?.teachingPolicy?.suggestion;
  if (!suggestion || suggestion.expectedAction !== action) return null;
  return recordPrivateTutorExperienceEvent(state, {
    learner,
    session,
    type: "suggestion_adopted",
    details: { suggestionId: suggestion.id, suggestionType: suggestion.type, action },
    dedupeKey: `suggestion_adopted:${suggestion.id}`,
    at,
    nextId,
  });
}

export function recordPrivateTutorExperienceEvent(state, {
  learner,
  session = null,
  planId = null,
  type,
  details = {},
  dedupeKey = null,
  at,
  nextId,
} = {}) {
  ensureCollections(state);
  if (dedupeKey) {
    const existing = state.privateTutorExperienceEvents.find((row) => row.learnerId === learner.id && row.dedupeKey === dedupeKey);
    if (existing) return existing;
  }
  const event = {
    id: nextId("ptexp"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    contentPackageId: session?.contentPackageId ?? null,
    contentPackageVersion: session?.contentPackageVersion ?? null,
    sessionId: session?.id ?? null,
    planId: planId ?? session?.planId ?? null,
    type,
    details: sanitizeDetails(details),
    dedupeKey,
    createdAt: at,
  };
  state.privateTutorExperienceEvents.unshift(event);
  return event;
}

export function buildPrivateTutorExperienceReport(state, learnerId, {
  contentPackageId = null,
  at = new Date().toISOString(),
  windowDays = 30,
} = {}) {
  ensureCollections(state);
  const windowStart = new Date(Date.parse(at) - windowDays * 86_400_000).toISOString();
  const inWindow = (value) => value && Date.parse(value) >= Date.parse(windowStart) && Date.parse(value) <= Date.parse(at);
  const sessions = (state.privateTutorSessions ?? []).filter((row) => row.learnerId === learnerId
    && samePackage(row.contentPackageId, contentPackageId) && inWindow(row.startedAt));
  const sessionIds = new Set(sessions.map((row) => row.id));
  const events = state.privateTutorExperienceEvents.filter((row) => row.learnerId === learnerId
    && (!row.contentPackageId || samePackage(row.contentPackageId, contentPackageId))
    && inWindow(row.createdAt));
  const instrumentedSessionIds = new Set(events.filter((row) => row.type === "session_started").map((row) => row.sessionId).filter(Boolean));
  const observedSessions = sessions.filter((row) => instrumentedSessionIds.has(row.id));
  const completedStepCount = events.filter((row) => row.type === "learning_step_completed").length;
  const totalStepCount = observedSessions.reduce((sum, row) => sum + (row.activities?.length ?? 0), 0);
  const interruptedSessionCount = new Set(events.filter((row) => row.type === "session_interrupted").map((row) => row.sessionId).filter(Boolean)).size;
  const presented = uniqueSuggestions(events, "suggestion_presented");
  const adopted = uniqueSuggestions(events, "suggestion_adopted");
  const learnerPlans = (state.privateTutorLearningPlans ?? []).filter((row) => row.learnerId === learnerId);
  const planById = new Map(learnerPlans.map((row) => [row.id, row]));
  const audits = (state.privateTutorAuditEvents ?? []).filter((row) => {
    if (row.learnerId !== learnerId || !MANUAL_PLAN_ACTIONS.has(row.action) || !inWindow(row.createdAt)) return false;
    const plan = planById.get(row.details?.planId);
    return Boolean(plan && samePackage(plan.contentPackageId, contentPackageId));
  });
  const plans = learnerPlans.filter((row) =>
    samePackage(row.contentPackageId, contentPackageId) && inWindow(row.generatedAt ?? row.updatedAt));
  const adjustedPlanIds = new Set(audits.map((row) => row.details?.planId).filter(Boolean));
  const observedPlanIds = new Set([...plans.map((row) => row.id), ...adjustedPlanIds]);
  const decisions = state.privateTutorTeachingStrategyDecisions.filter((row) => row.learnerId === learnerId
    && samePackage(row.contentPackageId, contentPackageId) && inWindow(row.createdAt));
  const latestDecision = decisions.find((row) => !row.sessionId || sessionIds.has(row.sessionId)) ?? decisions[0] ?? null;
  return {
    schemaVersion: PRIVATE_TUTOR_EXPERIENCE_REPORT_SCHEMA_VERSION,
    learnerId,
    contentPackageId,
    window: { days: windowDays, startedAt: windowStart, endedAt: at },
    teachingPersonalization: {
      decisionCount: decisions.length,
      latestPolicy: latestDecision?.policy ?? null,
      distinctExplanationModeCount: new Set(decisions.map((row) => row.policy?.explanationMode).filter(Boolean)).size,
      distinctDifficultyCount: new Set(decisions.map((row) => row.policy?.questionDifficulty).filter(Boolean)).size,
    },
    smoothness: {
      startedSessionCount: observedSessions.length,
      completedSessionCount: observedSessions.filter((row) => row.status === "completed").length,
      completedStepCount,
      totalStepCount,
      stepCompletionRate: rate(completedStepCount, totalStepCount),
      interruptedSessionCount,
      interruptionRate: rate(interruptedSessionCount, observedSessions.length),
      manuallyAdjustedPlanCount: adjustedPlanIds.size,
      observedPlanCount: observedPlanIds.size,
      manualPlanAdjustmentRate: rate(adjustedPlanIds.size, observedPlanIds.size),
      suggestionPresentedCount: presented.size,
      suggestionAdoptedCount: adopted.size,
      suggestionAdoptionRate: rate(adopted.size, presented.size),
    },
    readiness: {
      minimumSessionCount: 5,
      minimumSuggestionCount: 5,
      smoothnessReady: observedSessions.length >= 5,
      suggestionAdoptionReady: presented.size >= 5,
    },
    generatedAt: at,
  };
}

function suggestionFor({ currentActivity, recentIncorrect, recentHintLevel, hintGranularity }) {
  if (!currentActivity) return null;
  if (["explain", "summary"].includes(currentActivity.kind)) {
    return { type: "continue_when_ready", label: "理解后继续下一步", expectedAction: "continue" };
  }
  if (recentIncorrect > 0 && recentHintLevel === 0) {
    return { type: "use_personalized_hint", label: hintGranularity === "micro_steps" ? "先看一个最小提示" : "看一条提示后再试", expectedAction: "hint" };
  }
  return { type: "attempt_independently", label: "先独立作答，我会按结果调整", expectedAction: "answer" };
}

function methodForStrategy(strategy) {
  return {
    prerequisite_repair: "small_step",
    concept_rebuild: "visual_model",
    fluency_practice: "worked_example",
    transfer_challenge: "contrast_case",
  }[strategy] ?? "visual_model";
}

function sanitizeDetails(details) {
  const allowed = ["activity", "action", "suggestionId", "suggestionType", "reason", "stepIndex"];
  return Object.fromEntries(allowed.flatMap((key) => {
    const value = details?.[key];
    if (value == null || !["string", "number", "boolean"].includes(typeof value)) return [];
    return [[key, typeof value === "string" ? value.slice(0, 120) : value]];
  }));
}

function uniqueSuggestions(events, type) {
  return new Set(events.filter((row) => row.type === type).map((row) => row.details?.suggestionId).filter(Boolean));
}

function samePackage(left, right) {
  return left == null || right == null ? left == null && right == null : left === right;
}

function rate(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

function ensureCollections(state) {
  for (const key of ["privateTutorTeachingStrategyDecisions", "privateTutorExperienceEvents"]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
}
