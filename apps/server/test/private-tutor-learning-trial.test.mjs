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

  state.privateTutorSessions.push({
    id: "session_1", learnerId: learner.id, contentPackageId: "course_math", contentPackageVersion: "1.0.0",
    status: "completed", planId: "plan_1", planDayIndex: 1, targetKnowledgeId: "balance",
    completedAt: "2026-08-01T09:00:00.000Z", summary: { reviewAt: "2026-08-02T09:00:00.000Z" },
    followUps: [{ id: "follow_1", createdAt: "2026-08-01T08:30:00.000Z", resolution: "resolved" }],
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

test("follow-up feedback is bounded to the session and expired trials complete without invented samples", () => {
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
  assert.equal(view.status, "completed");
  assert.equal(view.metrics.nextDayRecall.opportunityCount, 1);
  assert.equal(view.metrics.nextDayRecall.attemptedCount, 0);
  assert.equal(view.metrics.nextDayRecall.retentionRate, null);
  assert.equal(view.readiness.nextDayRecallReady, false);
});

function trialState() {
  return {
    privateTutorLearningTrials: [],
    privateTutorSessions: [],
    privateTutorAttempts: [],
    privateTutorReviewSchedules: [],
  };
}
