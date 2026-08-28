import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrivateTutorRoadmapLedgerView,
  recordPrivateTutorRoadmapSnapshot,
} from "../src/services/private-tutor-roadmap-ledger.mjs";

test("the roadmap ledger preserves its baseline and closes a week with planned-versus-actual evidence", () => {
  const state = { privateTutorRoadmapLedgers: [] };
  const learner = { id: "learner-ledger", ownerTeamId: "team-personal" };
  let sequence = 0;
  const nextId = (prefix) => `${prefix}_${++sequence}`;
  const first = plan({ id: "plan-week-1", revision: 1, weekIndex: 1 });
  recordPrivateTutorRoadmapSnapshot(state, { learner, plan: first, reason: "learning_goal_confirmed", at: "2026-08-20T08:00:00.000Z", nextId });
  first.revision = 2;
  first.reason = "catch_up_confirmed";
  first.days[0].status = "completed";
  first.days[1].status = "completed";
  recordPrivateTutorRoadmapSnapshot(state, { learner, plan: first, reason: first.reason, at: "2026-08-25T08:00:00.000Z", nextId });

  const second = plan({ id: "plan-week-2", revision: 3, weekIndex: 2 });
  recordPrivateTutorRoadmapSnapshot(state, { learner, plan: second, reason: "next_week_started", at: "2026-08-27T08:00:00.000Z", nextId });
  const view = buildPrivateTutorRoadmapLedgerView(state, learner.id, { contentPackageId: "math-v1", activationId: "activation-1", at: "2026-08-28T08:00:00.000Z" });

  assert.equal(view.baseline.planId, "plan-week-1");
  assert.equal(view.routeVersions.length, 3);
  assert.equal(view.weeklyReviews.length, 1);
  assert.equal(view.weeklyReviews[0].weekIndex, 1);
  assert.equal(view.weeklyReviews[0].plannedMinutes, 60);
  assert.equal(view.weeklyReviews[0].completedMinutes, 40);
  assert.equal(view.weeklyReviews[0].deviationMinutes, -20);
  assert.equal(view.weeklyReviews[0].status, "partial");
  assert.equal(view.weeklyReviews[0].reasonCodes.includes("missed_learning_days"), true);
  assert.equal(view.weeklyReviews[0].nextAction.knowledgeId, "balance");
  assert.equal("rawAnswer" in JSON.parse(JSON.stringify(view)), false);
});

test("a changed learning goal seals the previous ledger instead of rewriting its baseline", () => {
  const state = { privateTutorRoadmapLedgers: [] };
  const learner = { id: "learner-ledger", ownerTeamId: "team-personal" };
  let sequence = 0;
  const nextId = (prefix) => `${prefix}_${++sequence}`;
  const original = plan({ id: "plan-original", revision: 1, weekIndex: 1 });
  recordPrivateTutorRoadmapSnapshot(state, { learner, plan: original, at: "2026-08-20T08:00:00.000Z", nextId });
  const changed = plan({ id: "plan-changed", revision: 2, weekIndex: 1 });
  changed.learningGoal = { ...changed.learningGoal, weeklyMinutes: 40, targetDate: "2026-10-15" };
  changed.weeklyMinutes = 40;
  recordPrivateTutorRoadmapSnapshot(state, { learner, plan: changed, reason: "learning_goal_confirmed", at: "2026-08-21T08:00:00.000Z", nextId });

  assert.equal(state.privateTutorRoadmapLedgers.length, 2);
  assert.equal(state.privateTutorRoadmapLedgers[1].status, "superseded");
  assert.equal(state.privateTutorRoadmapLedgers[1].baseline.weeklyMinutes, 60);
  assert.equal(state.privateTutorRoadmapLedgers[0].status, "active");
  assert.equal(state.privateTutorRoadmapLedgers[0].baseline.weeklyMinutes, 40);
});

function plan({ id, revision, weekIndex }) {
  return {
    id,
    revision,
    ownerTeamId: "team-personal",
    learnerId: "learner-ledger",
    contentPackageId: "math-v1",
    contentPackageVersion: "1.0.0",
    subjectId: "math",
    activationId: "activation-1",
    status: "active",
    reason: "learning_goal_confirmed",
    learningGoal: { contentPackageId: "math-v1", targetTopicIds: ["topic-balance"], weeklyMinutes: 60, targetDate: "2026-10-01", note: "掌握等式" },
    scopeKnowledgeIds: ["balance"],
    weeklyMinutes: 60,
    goalForecast: {
      status: "on_track",
      targetDate: "2026-10-01",
      projectedCompletionDate: "2026-09-15",
      estimatedRemainingMinutes: 120,
      completionWindow: { optimistic: "2026-09-10", likely: "2026-09-15", conservative: "2026-09-20" },
    },
    goalRoadmap: {
      currentWeekIndex: weekIndex,
      estimatedWeekCount: 2,
      milestones: [
        { weekIndex, plannedMinutes: 60, knowledgeGoals: [{ knowledgeId: "balance", title: "等式平衡", plannedMinutes: 60, expectedComplete: false }] },
        { weekIndex: weekIndex + 1, plannedMinutes: 60, knowledgeGoals: [{ knowledgeId: "balance", title: "等式平衡", plannedMinutes: 60, expectedComplete: true }] },
      ],
    },
    days: [
      { dayIndex: 1, date: weekIndex === 1 ? "2026-08-20" : "2026-08-27", status: "planned", minutes: 20, knowledgeId: "balance", knowledgeTitle: "等式平衡" },
      { dayIndex: 2, date: weekIndex === 1 ? "2026-08-22" : "2026-08-29", status: "planned", minutes: 20, knowledgeId: "balance", knowledgeTitle: "等式平衡" },
      { dayIndex: 3, date: weekIndex === 1 ? "2026-08-24" : "2026-08-31", status: "planned", minutes: 20, knowledgeId: "balance", knowledgeTitle: "等式平衡" },
      { dayIndex: 4, date: weekIndex === 1 ? "2026-08-26" : "2026-09-02", status: "rest", minutes: 0, knowledgeId: "balance", knowledgeTitle: "等式平衡" },
    ],
  };
}
