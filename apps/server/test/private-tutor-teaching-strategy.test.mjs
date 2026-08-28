import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrivateTutorExperienceReport,
  buildPrivateTutorTeachingPolicy,
  recordPrivateTutorExperienceEvent,
  recordPrivateTutorSuggestionAdoption,
  recordPrivateTutorTeachingStrategyDecision,
} from "../src/services/private-tutor-teaching-strategy.mjs";

const AT = "2026-08-28T08:00:00.000Z";

test("teaching policy lowers difficulty and shortens review after repeated incorrect answers", () => {
  const state = baseState();
  state.privateTutorAttempts = [
    attempt("a1", false),
    attempt("a2", false),
    attempt("a3", true),
  ];
  const policy = buildPrivateTutorTeachingPolicy(state, {
    learnerId: "learner-1",
    contentPackageId: "pkg-1",
    targetKnowledgeId: "k1",
    strategy: "concept_rebuild",
    at: AT,
  });
  assert.equal(policy.questionDifficulty, "support");
  assert.equal(policy.explanationMode, "small_step");
  assert.equal(policy.hintGranularity, "micro_steps");
  assert.equal(policy.reviewIntervalHours, 8);
  assert.deepEqual(policy.reasonCodes, ["repeated_incorrect"]);
});

test("teaching policy raises transfer difficulty only with stable independent mastery", () => {
  const state = baseState();
  state.privateTutorLearnerModels = [{ learnerId: "learner-1", contentPackageId: "pkg-1", knowledge: [{ id: "k1", mastery: 0.9, forgettingRisk: 0.1, prerequisiteGap: false }] }];
  state.privateTutorAttempts = [attempt("a1", true, true), attempt("a2", true, true), attempt("a3", true, true), attempt("a4", true, true)];
  const policy = buildPrivateTutorTeachingPolicy(state, {
    learnerId: "learner-1",
    contentPackageId: "pkg-1",
    targetKnowledgeId: "k1",
    strategy: "transfer_challenge",
    at: AT,
  });
  assert.equal(policy.questionDifficulty, "challenge");
  assert.equal(policy.hintGranularity, "minimal");
  assert.equal(policy.reviewIntervalHours, 72);
});

test("strategy decisions and smoothness report track adoption without raw answers", () => {
  const state = baseState();
  const learner = { id: "learner-1", ownerTeamId: "team-1" };
  const session = {
    id: "session-1",
    learnerId: learner.id,
    contentPackageId: "pkg-1",
    contentPackageVersion: "1.0.0",
    planId: "plan-1",
    targetKnowledgeId: "k1",
    strategy: "concept_rebuild",
    status: "active",
    currentActivityIndex: 0,
    activities: [{ kind: "recall", status: "active", incorrectCount: 0, hintLevel: 0 }],
    startedAt: AT,
  };
  state.privateTutorSessions.push(session);
  state.privateTutorLearningPlans.push({ id: "plan-1", learnerId: learner.id, contentPackageId: "pkg-1", generatedAt: AT });
  state.privateTutorAuditEvents.push({ learnerId: learner.id, action: "learning_plan_rebalanced", details: { planId: "plan-1" }, createdAt: AT });
  const nextId = idFactory();
  const decision = recordPrivateTutorTeachingStrategyDecision(state, { learner, session, trigger: "session_started", at: AT, nextId });
  assert.equal(decision.policy.suggestion.expectedAction, "answer");
  recordPrivateTutorSuggestionAdoption(state, { learner, session, action: "answer", at: AT, nextId });
  recordPrivateTutorExperienceEvent(state, { learner, session, type: "session_started", at: AT, nextId });
  recordPrivateTutorExperienceEvent(state, { learner, session, type: "learning_step_completed", details: { activity: "recall" }, at: AT, nextId });
  recordPrivateTutorExperienceEvent(state, { learner, session, type: "session_interrupted", details: { activity: "recall" }, at: AT, nextId });
  const report = buildPrivateTutorExperienceReport(state, learner.id, { contentPackageId: "pkg-1", at: AT });
  assert.equal(report.smoothness.completedStepCount, 1);
  assert.equal(report.smoothness.interruptionRate, 1);
  assert.equal(report.smoothness.suggestionAdoptionRate, 1);
  assert.equal(report.smoothness.manualPlanAdjustmentRate, 1);
  assert.equal(report.teachingPersonalization.latestPolicy.questionDifficulty, "core");
  assert.equal(JSON.stringify({ decision, report }).includes("rawAnswer"), false);
});

function baseState() {
  return {
    privateTutorAttempts: [],
    privateTutorLearnerModels: [],
    privateTutorTeachingStrategyDecisions: [],
    privateTutorExperienceEvents: [],
    privateTutorSessions: [],
    privateTutorLearningPlans: [],
    privateTutorAuditEvents: [],
  };
}

function attempt(id, correct, independent = false) {
  return {
    id,
    learnerId: "learner-1",
    contentPackageId: "pkg-1",
    knowledgeId: "k1",
    context: "tutoring",
    evidenceEligible: true,
    correct,
    independent,
    usedHint: false,
  };
}

function idFactory() {
  let value = 0;
  return (prefix) => `${prefix}-${++value}`;
}
