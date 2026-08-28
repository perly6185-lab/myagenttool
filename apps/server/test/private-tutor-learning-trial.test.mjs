import assert from "node:assert/strict";
import test from "node:test";

import {
  completeExpiredPrivateTutorLearningTrials,
  latestPrivateTutorLearningTrialView,
  recordPrivateTutorFollowUpResolution,
  startPrivateTutorLearningTrial,
} from "../src/services/private-tutor-learning-trial.mjs";

test("a fourteen-day learning trial projects next-day recall, delayed review, and resolved follow-ups", () => {
  const state = trialState();
  const learner = { id: "learner_trial", ownerTeamId: "team_trial" };
  const started = startPrivateTutorLearningTrial(state, learner, { goal: "掌握方程平衡" }, {
    actorId: "usr_trial",
    contentPackage: { id: "course_math", version: "1.0.0", name: "真实方程课程" },
    now: () => "2026-08-01T08:00:00.000Z",
    nextId: (prefix) => `${prefix}_1`,
  });
  assert.equal(started.ok, true);
  assert.equal(started.trial.durationDays, 14);
  assert.equal(started.trial.endsAt, "2026-08-15T08:00:00.000Z");
  assert.equal(started.trial.observationDays, 2);
  assert.equal(started.trial.observationEndsAt, "2026-08-17T08:00:00.000Z");

  state.privateTutorSessions.push({
    id: "session_1", learnerId: learner.id, contentPackageId: "course_math", contentPackageVersion: "1.0.0",
    status: "completed", planId: "plan_1", planDayIndex: 1, targetKnowledgeId: "balance",
    completedAt: "2026-08-01T09:00:00.000Z", summary: { reviewAt: "2026-08-02T09:00:00.000Z" },
    followUps: [{ id: "follow_1", createdAt: "2026-08-01T08:30:00.000Z", resolution: "resolved" }],
  });
  state.privateTutorSessions.push({
    id: "session_future", learnerId: learner.id, contentPackageId: "course_math", contentPackageVersion: "1.0.0",
    status: "completed", planId: "plan_1", planDayIndex: 4, targetKnowledgeId: "future_knowledge",
    startedAt: "2026-08-04T09:00:00.000Z", completedAt: "2026-08-04T10:00:00.000Z",
    summary: { reviewAt: "2026-08-05T10:00:00.000Z" }, followUps: [],
  });
  state.privateTutorAttempts.push(
    { id: "attempt_recall", learnerId: learner.id, contentPackageId: "course_math", contentPackageVersion: "1.0.0", knowledgeId: "balance", independent: true, usedHint: false, evidenceEligible: true, correct: true, createdAt: "2026-08-02T10:00:00.000Z" },
    { id: "attempt_delayed", learnerId: learner.id, contentPackageId: "course_math", contentPackageVersion: "1.0.0", reviewScheduleId: "schedule_1", reviewPhase: "delayed", correct: true, createdAt: "2026-08-02T13:00:00.000Z" },
  );
  state.privateTutorReviewSchedules.push({
    id: "schedule_1", learnerId: learner.id, contentPackageId: "course_math", contentPackageVersion: "1.0.0",
    createdAt: "2026-08-01T08:15:00.000Z", phaseEvidence: [{ phase: "variation", correct: true, at: "2026-08-01T12:00:00.000Z" }],
  });

  const view = latestPrivateTutorLearningTrialView(state, learner.id, "2026-08-03T08:00:00.000Z");
  assert.deepEqual(view.metrics.planDays, { startedCount: 1, completedCount: 1, completionRate: 1 });
  assert.deepEqual(view.metrics.nextDayRecall, { opportunityCount: 1, attemptedCount: 1, correctCount: 1, retentionRate: 1 });
  assert.deepEqual(view.metrics.delayedReview, { opportunityCount: 1, attemptedCount: 1, correctCount: 1, retentionRate: 1 });
  assert.deepEqual(view.metrics.followUps, { askedCount: 1, feedbackCount: 1, resolvedCount: 1, resolutionRate: 1, feedbackCoverageRate: 1 });
  assert.equal(view.progress.dayIndex, 3);
  assert.equal(view.progress.activeDayCount, 2);
  assert.equal(JSON.stringify(view).includes("normalizedAnswer"), false);
});

test("follow-up feedback is bounded to the session and an expired learning window enters observation", () => {
  const state = trialState();
  const session = { revision: 1, updatedAt: "2026-08-01T00:00:00.000Z", followUps: [{ id: "follow_1" }] };
  const recorded = recordPrivateTutorFollowUpResolution(session, { followUpId: "follow_1", resolution: "unresolved" }, { now: () => "2026-08-02T00:00:00.000Z" });
  assert.equal(recorded.ok, true);
  assert.equal(session.followUps[0].resolution, "unresolved");
  assert.equal(recordPrivateTutorFollowUpResolution(session, { followUpId: "other", resolution: "resolved" }, { now: () => "2026-08-02T00:00:00.000Z" }).error, "private_tutor_follow_up_not_found");

  startPrivateTutorLearningTrial(state, { id: "learner_trial", ownerTeamId: "team_trial" }, { goal: "完成课程" }, {
    actorId: "usr_trial", contentPackage: { id: "course_math", version: "1.0.0", name: "课程" },
    now: () => "2026-08-01T00:00:00.000Z", nextId: () => "trial_1",
  });
  state.privateTutorSessions.push({
    id: "session_missed_review", learnerId: "learner_trial", contentPackageId: "course_math", contentPackageVersion: "1.0.0",
    status: "completed", targetKnowledgeId: "balance", completedAt: "2026-08-01T08:00:00.000Z",
    summary: { reviewAt: "2026-08-02T08:00:00.000Z" }, followUps: [],
  });
  assert.equal(completeExpiredPrivateTutorLearningTrials(state, "2026-08-15T00:00:00.000Z"), true);
  const view = latestPrivateTutorLearningTrialView(state, "learner_trial", "2026-08-15T00:00:00.000Z");
  assert.equal(view.status, "observing");
  assert.equal(view.metrics.nextDayRecall.opportunityCount, 1);
  assert.equal(view.metrics.nextDayRecall.attemptedCount, 0);
  assert.equal(view.metrics.nextDayRecall.retentionRate, null);
  assert.equal(view.readiness.nextDayRecallReady, false);
  assert.equal(completeExpiredPrivateTutorLearningTrials(state, "2026-08-17T00:00:00.000Z"), true);
  assert.equal(latestPrivateTutorLearningTrialView(state, "learner_trial", "2026-08-17T00:00:00.000Z").status, "completed");
});

test("the observation tail includes day-fourteen reviews but excludes new sessions", () => {
  const state = trialState();
  const learner = { id: "learner_tail", ownerTeamId: "team_trial" };
  startPrivateTutorLearningTrial(state, learner, { goal: "完成最后一天复测" }, {
    actorId: "usr_trial", contentPackage: { id: "course_math", version: "1.0.0", name: "课程" },
    now: () => "2026-08-01T08:00:00.000Z", nextId: () => "trial_tail",
  });
  state.privateTutorSessions.push(
    {
      id: "session_day_14", learnerId: learner.id, contentPackageId: "course_math", contentPackageVersion: "1.0.0",
      status: "completed", planId: "plan_tail", planDayIndex: 14, targetKnowledgeId: "balance",
      startedAt: "2026-08-14T09:00:00.000Z", completedAt: "2026-08-14T10:00:00.000Z",
      summary: { reviewAt: "2026-08-15T10:00:00.000Z" },
      followUps: [{ id: "follow_tail", createdAt: "2026-08-14T09:30:00.000Z", resolution: "resolved", resolutionRecordedAt: "2026-08-15T12:00:00.000Z" }],
    },
    {
      id: "session_after_learning", learnerId: learner.id, contentPackageId: "course_math", contentPackageVersion: "1.0.0",
      status: "completed", planId: "plan_tail", planDayIndex: 15, targetKnowledgeId: "new_lesson",
      startedAt: "2026-08-15T09:00:00.000Z", completedAt: "2026-08-15T10:00:00.000Z",
      summary: { reviewAt: "2026-08-16T10:00:00.000Z" }, followUps: [],
    },
  );
  state.privateTutorReviewSchedules.push({
    id: "schedule_tail", learnerId: learner.id, contentPackageId: "course_math", contentPackageVersion: "1.0.0",
    createdAt: "2026-08-14T10:00:00.000Z", phaseEvidence: [{ phase: "variation", correct: true, at: "2026-08-14T12:00:00.000Z" }],
  });
  state.privateTutorAttempts.push(
    { id: "recall_tail", learnerId: learner.id, contentPackageId: "course_math", contentPackageVersion: "1.0.0", knowledgeId: "balance", independent: true, usedHint: false, evidenceEligible: true, correct: true, createdAt: "2026-08-15T11:00:00.000Z" },
    { id: "delayed_tail", learnerId: learner.id, contentPackageId: "course_math", contentPackageVersion: "1.0.0", reviewScheduleId: "schedule_tail", reviewPhase: "delayed", correct: true, createdAt: "2026-08-15T13:00:00.000Z" },
  );

  assert.equal(completeExpiredPrivateTutorLearningTrials(state, "2026-08-15T14:00:00.000Z"), true);
  const observing = latestPrivateTutorLearningTrialView(state, learner.id, "2026-08-15T14:00:00.000Z");
  assert.equal(observing.status, "observing");
  assert.equal(startPrivateTutorLearningTrial(state, learner, { goal: "不能重叠开始" }, {
    actorId: "usr_trial", contentPackage: { id: "course_math", version: "1.0.0", name: "课程" },
    now: () => "2026-08-15T14:00:00.000Z", nextId: () => "trial_overlapping",
  }).error, "private_tutor_learning_trial_already_active");
  assert.equal(observing.progress.completedSessionCount, 1);
  assert.deepEqual(observing.metrics.planDays, { startedCount: 1, completedCount: 1, completionRate: 1 });
  assert.deepEqual(observing.metrics.nextDayRecall, { opportunityCount: 1, attemptedCount: 1, correctCount: 1, retentionRate: 1 });
  assert.deepEqual(observing.metrics.delayedReview, { opportunityCount: 1, attemptedCount: 1, correctCount: 1, retentionRate: 1 });
  assert.equal(observing.metrics.followUps.resolutionRate, 1);
});

test("synthetic steady, intermittent, and sparse learners keep honest sample readiness", () => {
  const steady = simulatedTrialView({
    learnerId: "steady", recall: [true, true, true, true], delayed: [true, true, true, true], followUps: ["resolved", "resolved", "resolved", "resolved"],
  });
  assert.equal(steady.metrics.nextDayRecall.retentionRate, 1);
  assert.equal(steady.metrics.delayedReview.retentionRate, 1);
  assert.equal(steady.metrics.followUps.resolutionRate, 1);
  assert.deepEqual(steady.readiness, { minimumSampleCount: 3, nextDayRecallReady: true, delayedReviewReady: true, followUpResolutionReady: true });

  const intermittent = simulatedTrialView({
    learnerId: "intermittent", recall: [true, null, false, null], delayed: [true, null, true, null], followUps: ["resolved", null, "unresolved", null],
  });
  assert.deepEqual(intermittent.metrics.nextDayRecall, { opportunityCount: 4, attemptedCount: 2, correctCount: 1, retentionRate: 0.5 });
  assert.deepEqual(intermittent.metrics.delayedReview, { opportunityCount: 4, attemptedCount: 2, correctCount: 2, retentionRate: 1 });
  assert.equal(intermittent.readiness.nextDayRecallReady, false);
  assert.equal(intermittent.readiness.delayedReviewReady, false);
  assert.equal(intermittent.readiness.followUpResolutionReady, false);

  const sparse = simulatedTrialView({ learnerId: "sparse", recall: [true], delayed: [true], followUps: ["resolved"] });
  assert.equal(sparse.metrics.nextDayRecall.retentionRate, 1);
  assert.equal(sparse.readiness.nextDayRecallReady, false);
  assert.equal(sparse.readiness.delayedReviewReady, false);
  assert.equal(sparse.readiness.followUpResolutionReady, false);
});

function trialState() {
  return {
    privateTutorLearningTrials: [],
    privateTutorSessions: [],
    privateTutorAttempts: [],
    privateTutorReviewSchedules: [],
  };
}

function simulatedTrialView({ learnerId, recall, delayed, followUps }) {
  const state = trialState();
  const learner = { id: learnerId, ownerTeamId: "team_simulation" };
  startPrivateTutorLearningTrial(state, learner, { goal: "模拟真实课程" }, {
    actorId: "usr_simulation", contentPackage: { id: "course_simulation", version: "1.0.0", name: "模拟课程" },
    now: () => "2026-08-01T00:00:00.000Z", nextId: () => `trial_${learnerId}`,
  });
  for (let index = 0; index < recall.length; index += 1) {
    const day = index + 1;
    const knowledgeId = `knowledge_${day}`;
    const dayText = String(day).padStart(2, "0");
    const nextDayText = String(day + 1).padStart(2, "0");
    state.privateTutorSessions.push({
      id: `session_${learnerId}_${day}`, learnerId, contentPackageId: "course_simulation", contentPackageVersion: "1.0.0",
      status: "completed", planId: `plan_${learnerId}`, planDayIndex: day, targetKnowledgeId: knowledgeId,
      startedAt: `2026-08-${dayText}T08:00:00.000Z`, completedAt: `2026-08-${dayText}T09:00:00.000Z`,
      summary: { reviewAt: `2026-08-${nextDayText}T09:00:00.000Z` },
      followUps: [{ id: `follow_${learnerId}_${day}`, createdAt: `2026-08-${dayText}T08:30:00.000Z`, ...(followUps[index] ? { resolution: followUps[index], resolutionRecordedAt: `2026-08-${nextDayText}T08:00:00.000Z` } : {}) }],
    });
    state.privateTutorReviewSchedules.push({
      id: `schedule_${learnerId}_${day}`, learnerId, contentPackageId: "course_simulation", contentPackageVersion: "1.0.0",
      createdAt: `2026-08-${dayText}T09:00:00.000Z`, phaseEvidence: [{ phase: "variation", correct: true, at: `2026-08-${dayText}T10:00:00.000Z` }],
    });
    if (recall[index] != null) state.privateTutorAttempts.push({
      id: `recall_${learnerId}_${day}`, learnerId, contentPackageId: "course_simulation", contentPackageVersion: "1.0.0",
      knowledgeId, independent: true, usedHint: false, evidenceEligible: true, correct: recall[index], createdAt: `2026-08-${nextDayText}T09:30:00.000Z`,
    });
    if (delayed[index] != null) state.privateTutorAttempts.push({
      id: `delayed_${learnerId}_${day}`, learnerId, contentPackageId: "course_simulation", contentPackageVersion: "1.0.0",
      reviewScheduleId: `schedule_${learnerId}_${day}`, reviewPhase: "delayed", correct: delayed[index], createdAt: `2026-08-${nextDayText}T10:30:00.000Z`,
    });
  }
  return latestPrivateTutorLearningTrialView(state, learnerId, "2026-08-07T23:00:00.000Z");
}
