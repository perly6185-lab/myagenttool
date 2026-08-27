import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrivateTutorSevenDayPlan,
  decidePrivateTutorStrategy,
  derivePrivateTutorLearnerModel,
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
