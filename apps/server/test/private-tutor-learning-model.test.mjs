import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPrivateTutorCatchUpPlan,
  buildPrivateTutorCatchUpPlanPreview,
  buildPrivateTutorGoalForecast,
  buildPrivateTutorSevenDayPlan,
  decidePrivateTutorStrategy,
  derivePrivateTutorEffortProfile,
  derivePrivateTutorLearnerModel,
  derivePrivateTutorPlanProgress,
  rollPrivateTutorFuturePlan,
  resolvePrivateTutorGoalScopeKnowledgeIds,
} from "../src/services/private-tutor-learning-model.mjs";

const now = () => "2026-08-20T08:00:00.000Z";

test("the same weak knowledge point gets different methods for different misconceptions", () => {
  const snapshot = snapshotWith({ balance: 0.35 });
  const conceptualAttempts = [attempt("a1", "balance", "diag-bal-01-v1", false, "a")];
  const fluencyAttempts = [attempt("a2", "balance", "diag-bal-02-v1", false, "4")];
  const conceptual = decidePrivateTutorStrategy({
    model: derivePrivateTutorLearnerModel({ snapshot, attempts: conceptualAttempts, now }),
    attempts: conceptualAttempts,
  });
  const fluency = decidePrivateTutorStrategy({
    model: derivePrivateTutorLearnerModel({ snapshot, attempts: fluencyAttempts, now }),
    attempts: fluencyAttempts,
  });
  assert.equal(conceptual.targetKnowledgeId, "balance");
  assert.equal(conceptual.strategy, "concept_rebuild");
  assert.equal(conceptual.misconception.id, "single_side_change");
  assert.equal(fluency.targetKnowledgeId, "balance");
  assert.equal(fluency.strategy, "fluency_practice");
  assert.equal(fluency.misconception.id, "division_fluency");
});

test("a downstream weakness with an unstable prerequisite repairs the prerequisite first", () => {
  const snapshot = snapshotWith({ balance: 0.42, "word-problem": 0.3 });
  const model = derivePrivateTutorLearnerModel({ snapshot, attempts: [], now });
  const decision = decidePrivateTutorStrategy({ model, attempts: [] });
  assert.equal(model.knowledge.find((item) => item.id === "word-problem").prerequisiteGap, true);
  assert.equal(decision.targetKnowledgeId, "balance");
  assert.equal(decision.strategy, "prerequisite_repair");
  assert.equal(decision.reasonCode, "prerequisite_gap");
});

test("two repeated errors switch away from an ineffective method", () => {
  const snapshot = snapshotWith({ balance: 0.35 });
  const attempts = [
    attempt("a2", "balance", "diag-bal-01-v1", false, "a", "2026-08-20T07:59:00.000Z"),
    attempt("a1", "balance", "diag-bal-01-v1", false, "a", "2026-08-20T07:58:00.000Z"),
  ];
  const model = derivePrivateTutorLearnerModel({ snapshot, attempts, now });
  const decision = decidePrivateTutorStrategy({
    model,
    attempts,
    previousDecision: { targetKnowledgeId: "balance", strategy: "concept_rebuild" },
  });
  assert.equal(decision.strategy, "prerequisite_repair");
  assert.equal(decision.reasonCode, "method_changed_after_repeated_error");
});

test("unknown knowledge is not ranked as weak and every mastery field has explainable confidence", () => {
  const snapshot = snapshotWith({ integer: null, balance: 0.5 });
  const model = derivePrivateTutorLearnerModel({ snapshot, attempts: [], now });
  const unknown = model.knowledge.find((item) => item.id === "integer");
  assert.equal(unknown.level, "unknown");
  assert.equal(unknown.confidence, 0);
  const decision = decidePrivateTutorStrategy({ model, attempts: [] });
  assert.notEqual(decision.targetKnowledgeId, "integer");
});

test("the seven-day plan uses 20-minute days and carries a missed goal forward without failure language", () => {
  const snapshot = snapshotWith({ balance: 0.35 });
  const attempts = [attempt("a1", "balance", "diag-bal-01-v1", false, "a")];
  const model = derivePrivateTutorLearnerModel({ snapshot, attempts, now });
  const decision = decidePrivateTutorStrategy({ model, attempts });
  const initial = buildPrivateTutorSevenDayPlan({ model, decision, now });
  assert.equal(initial.days.length, 7);
  assert.equal(initial.days.every((day) => day.minutes === 20 && day.status === "planned"), true);
  const rescheduled = buildPrivateTutorSevenDayPlan({
    model,
    decision,
    now,
    reason: "missed_day_rescheduled",
    carryForwardKnowledgeId: initial.days[0].knowledgeId,
  });
  assert.equal(rescheduled.days[0].knowledgeId, initial.days[0].knowledgeId);
  assert.match(rescheduled.studentReason, /没关系|顺延/);
  assert.equal(rescheduled.studentReason.includes("失败"), false);
});

test("the seven-day plan uses the learner's persisted time and intensity", () => {
  const model = derivePrivateTutorLearnerModel({ snapshot: snapshotWith({ balance: 0.35 }), attempts: [], now });
  const decision = decidePrivateTutorStrategy({ model, attempts: [] });
  const plan = buildPrivateTutorSevenDayPlan({ model, decision, now, dailyMinutes: 35, planIntensity: "intensive" });
  assert.equal(plan.dailyMinutes, 35);
  assert.equal(plan.planIntensity, "intensive");
  assert.equal(plan.days.every((day) => day.minutes === 35), true);
  assert.equal(plan.days.some((day) => day.activity === "mixed_check"), true);
});

test("a weekly goal scopes strategy and creates recovery days within the time budget", () => {
  const model = derivePrivateTutorLearnerModel({ snapshot: snapshotWith({ integer: 0.2, balance: 0.45 }), attempts: [], now });
  const decision = decidePrivateTutorStrategy({ model, attempts: [], scopeKnowledgeIds: ["balance"] });
  assert.equal(decision.targetKnowledgeId, "balance");
  const plan = buildPrivateTutorSevenDayPlan({
    model,
    decision,
    now,
    scopeKnowledgeIds: ["balance"],
    dailyMinutes: 20,
    learningGoal: { targetTopicIds: ["topic-balance"], weeklyMinutes: 60, targetDate: "2026-10-01", note: "掌握等式平衡" },
  });
  assert.equal(plan.weeklyMinutes, 60);
  assert.equal(plan.days.filter((day) => day.status === "planned").length, 3);
  assert.equal(plan.days.filter((day) => day.status === "rest").length, 4);
  assert.equal(plan.days.reduce((sum, day) => sum + day.minutes, 0), 60);
  assert.deepEqual(plan.scopeKnowledgeIds, ["balance"]);
  assert.equal(plan.learningGoal.targetDate, "2026-10-01");
  assert.equal(plan.goalForecast.status, "on_track");
  assert.equal(plan.goalRoadmap.currentWeekIndex, 1);
  assert.equal(plan.goalRoadmap.schemaVersion, 2);
  assert.equal(plan.goalRoadmap.milestones.length, plan.goalRoadmap.estimatedWeekCount);
  assert.equal(plan.goalRoadmap.milestones[0].status, "current");
  assert.equal(plan.goalRoadmap.milestones[0].knowledgeGoals.some((item) => item.knowledgeId === "balance"), true);
  assert.match(plan.studentReason, /掌握等式平衡/);
});

test("progress alerts count only expired learning days and catch-up confirmation moves whole work into a future buffer day", () => {
  const model = derivePrivateTutorLearnerModel({ snapshot: snapshotWith({ balance: 0.35 }), attempts: [], now });
  const decision = decidePrivateTutorStrategy({ model, attempts: [], scopeKnowledgeIds: ["balance"] });
  const plan = {
    id: "plan-catch-up",
    revision: 1,
    status: "active",
    ...buildPrivateTutorSevenDayPlan({
      model,
      decision,
      now,
      scopeKnowledgeIds: ["balance"],
      dailyMinutes: 20,
      learningGoal: { weeklyMinutes: 60 },
    }),
  };
  const progress = derivePrivateTutorPlanProgress(plan, { at: "2026-08-22T08:00:00.000Z" });
  assert.equal(progress.overdueDayCount, 1);
  assert.equal(progress.behindMinutes, 20);
  assert.equal(progress.catchUpAvailable, true);

  const preview = buildPrivateTutorCatchUpPlanPreview(plan, { at: "2026-08-22T08:00:00.000Z" });
  assert.equal(preview.canConfirm, true);
  assert.equal(preview.assignments.length, 1);
  assert.equal(preview.assignments[0].sourceDayIndex, 1);
  assert.equal(preview.assignments[0].targetDate, "2026-08-22");
  const applied = applyPrivateTutorCatchUpPlan(plan, preview, { at: "2026-08-22T08:05:00.000Z" });
  assert.equal(applied.revision, 2);
  assert.equal(applied.reason, "catch_up_confirmed");
  assert.equal(applied.days[0].status, "rescheduled");
  assert.equal(applied.days[0].minutes, 0);
  assert.equal(applied.days[2].status, "planned");
  assert.equal(applied.days[2].catchUpSourceDayIndex, 1);
  assert.equal(derivePrivateTutorPlanProgress(applied, { at: "2026-08-22T08:06:00.000Z" }).behindMinutes, 0);
});

test("goal forecasting exposes an infeasible deadline and the weekly capacity needed", () => {
  const model = derivePrivateTutorLearnerModel({ snapshot: snapshotWith({ balance: 0.35 }), attempts: [], now });
  const forecast = buildPrivateTutorGoalForecast({
    model,
    scopeKnowledgeIds: ["balance"],
    learningGoal: { targetDate: "2026-08-22" },
    weeklyMinutes: 60,
    at: now(),
  });
  assert.equal(forecast.status, "infeasible");
  assert.equal(forecast.scopeKnowledgeCount, 1);
  assert.equal(forecast.estimatedRemainingMinutes > forecast.availableMinutesUntilTarget, true);
  assert.equal(forecast.requiredWeeklyMinutes > forecast.weeklyCapacityMinutes, true);
  assert.equal(forecast.projectedCompletionDate > forecast.targetDate, true);
});

test("completed session timing calibrates the learner's likely and conservative effort window", () => {
  const sessions = [1, 2, 3].map((index) => ({
    id: `session-${index}`,
    status: "completed",
    targetKnowledgeId: "balance",
    plannedMinutes: 20,
    startedAt: `2026-08-${10 + index}T08:00:00.000Z`,
    completedAt: `2026-08-${10 + index}T08:30:00.000Z`,
    activities: [{ budgetMinutes: 20, startedAt: `2026-08-${10 + index}T08:00:00.000Z`, completedAt: `2026-08-${10 + index}T08:30:00.000Z` }],
  }));
  const profile = derivePrivateTutorEffortProfile(sessions);
  assert.equal(profile.sampleCount, 3);
  assert.equal(profile.calibrationFactor, 1.5);
  assert.equal(profile.confidence, "medium");

  const model = derivePrivateTutorLearnerModel({ snapshot: snapshotWith({ balance: 0.35 }), attempts: [], now });
  const forecast = buildPrivateTutorGoalForecast({ model, scopeKnowledgeIds: ["balance"], weeklyMinutes: 60, at: now(), effortEvidence: sessions });
  assert.equal(forecast.effortProfile.calibrationFactor, 1.5);
  assert.equal(forecast.optimisticRemainingMinutes < forecast.estimatedRemainingMinutes, true);
  assert.equal(forecast.conservativeRemainingMinutes > forecast.estimatedRemainingMinutes, true);
  assert.equal(forecast.completionWindow.optimistic < forecast.completionWindow.likely, true);
  assert.equal(forecast.completionWindow.likely < forecast.completionWindow.conservative, true);
});

test("a continued plan advances the long-term week index", () => {
  const model = derivePrivateTutorLearnerModel({ snapshot: snapshotWith({ balance: 0.35 }), attempts: [], now });
  const decision = decidePrivateTutorStrategy({ model, attempts: [], scopeKnowledgeIds: ["balance"] });
  const plan = buildPrivateTutorSevenDayPlan({ model, decision, now, scopeKnowledgeIds: ["balance"], planWeekIndex: 3 });
  assert.equal(plan.goalRoadmap.currentWeekIndex, 3);
});

test("a topic goal includes required prerequisites but excludes unrelated knowledge", () => {
  const scope = resolvePrivateTutorGoalScopeKnowledgeIds({
    knowledgeComponents: [
      { id: "foundation", prerequisiteKnowledgeIds: [] },
      { id: "target", prerequisiteKnowledgeIds: ["foundation"] },
      { id: "unrelated", prerequisiteKnowledgeIds: [] },
    ],
    modules: [{ id: "module", topics: [{ id: "topic-target", knowledgeComponentIds: ["target"] }] }],
  }, { targetTopicIds: ["topic-target"] });
  assert.deepEqual(scope, ["foundation", "target"]);
});

test("a goal bound to another content package does not leak its topic scope", () => {
  const scope = resolvePrivateTutorGoalScopeKnowledgeIds({
    id: "package-current",
    knowledgeComponents: [{ id: "target", prerequisiteKnowledgeIds: [] }],
    modules: [{ topics: [{ id: "topic-target", knowledgeComponentIds: ["target"] }] }],
  }, { contentPackageId: "package-other", targetTopicIds: ["topic-target"] });
  assert.equal(scope, null);
});

test("rolling replanning preserves started evidence and replaces only future days", () => {
  const model = derivePrivateTutorLearnerModel({ snapshot: snapshotWith({ balance: 0.35 }), attempts: [], now });
  const initialDecision = decidePrivateTutorStrategy({ model, attempts: [] });
  const initial = { id: "plan_rolling", revision: 1, status: "active", modelId: "model_old", decisionId: "decision_old", ...buildPrivateTutorSevenDayPlan({ model, decision: initialDecision, now }) };
  initial.days[0] = { ...initial.days[0], status: "completed", completedAt: now() };
  initial.days[1] = { ...initial.days[1], status: "in_progress", startedAt: now() };
  const completedTitle = initial.days[0].title;
  const inProgressTitle = initial.days[1].title;
  const nextDecision = { ...initialDecision, targetKnowledgeId: "word-problem", targetTitle: "一元一次方程应用", strategy: "transfer_challenge", studentReason: "改用应用题迁移。" };
  const generated = buildPrivateTutorSevenDayPlan({ model, decision: nextDecision, now, scopeKnowledgeIds: ["word-problem"] });
  rollPrivateTutorFuturePlan(initial, generated, { modelId: "model_new", decisionId: "decision_new", now: now() });
  assert.equal(initial.days[0].title, completedTitle);
  assert.equal(initial.days[0].status, "completed");
  assert.equal(initial.days[1].title, inProgressTitle);
  assert.equal(initial.days[1].status, "in_progress");
  assert.equal(initial.days.slice(2).every((day) => day.knowledgeId === "word-problem"), true);
  assert.equal(initial.modelId, "model_new");
  assert.equal(initial.decisionId, "decision_new");
  assert.equal(initial.revision, 2);
});

function snapshotWith(overrides) {
  const defaults = { integer: 0.85, "equation-meaning": 0.82, balance: 0.8, "word-problem": 0.84 };
  return {
    learnerId: "lrn_test",
    knowledge: Object.entries({ ...defaults, ...overrides }).map(([id, mastery]) => ({
      id,
      mastery,
      level: mastery == null ? "unknown" : mastery >= 0.8 ? "mastered" : mastery >= 0.55 ? "learning" : "needs_support",
      evidenceCount: mastery == null ? 0 : 3,
    })),
  };
}

function attempt(id, knowledgeId, questionRevisionId, correct, normalizedAnswer, createdAt = "2026-08-20T07:59:00.000Z") {
  return {
    id,
    learnerId: "lrn_test",
    knowledgeId,
    questionRevisionId,
    correct,
    normalizedAnswer,
    independent: true,
    usedHint: false,
    durationSeconds: 30,
    createdAt,
  };
}
