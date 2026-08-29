import assert from "node:assert/strict";
import test from "node:test";

import { buildPrivateTutorLearningHistory } from "../src/services/private-tutor-learning-history.mjs";

test("builds versioned chapter history from plans, sessions, attempts, reviews, and activations", () => {
  const state = fixture();
  const history = buildPrivateTutorLearningHistory(state, "learner_history", {
    at: "2026-08-26T08:00:00.000Z",
  });

  assert.equal(history.schemaVersion, 1);
  assert.equal(history.summary.packageCount, 2);
  assert.equal(history.summary.chapterCount, 2);
  assert.equal(history.summary.startedPlanDayCount, 3);
  assert.equal(history.summary.completedPlanDayCount, 3);
  assert.equal(history.summary.planDayCompletionRate, 1);
  assert.equal(history.summary.practiceAttemptCount, 4);
  assert.equal(history.summary.eligibleEvidenceCount, 3);
  assert.equal(history.summary.evidenceEligibilityRate, 0.75);
  assert.equal(history.summary.independentCorrectRate, 0.75);
  assert.equal(history.summary.completedReviewCount, 1);
  assert.equal(history.summary.dueReviewCount, 1);
  assert.equal(history.summary.upcomingReviewCount, 1);
  assert.equal(history.summary.sourceRubricRequiredReviewCount, 1);
  assert.equal(history.summary.sourceRubricCompletedReviewCount, 1);
  assert.equal(history.summary.sourceRubricReviewCompletionRate, 1);

  const math = history.packages.find((item) => item.packageId === "demo-math-foundations-v1");
  assert.ok(math);
  assert.equal(math.packageVersion, "1.0.0");
  assert.equal(math.activationCount, 1);
  assert.equal(math.chapters[0].moduleName, "一元一次方程与等式性质");
  assert.equal(math.chapters[0].summary.completedSessionCount, 3);
  assert.equal(math.chapters[0].summary.currentPlan.completedDays, 2);
  assert.equal(math.chapters[0].summary.currentPlan.scheduledDays, 4);
  assert.equal(math.chapters[0].summary.currentPlan.restDays, 1);
  assert.equal(math.recentSessions.length, 3);
  assert.equal(math.recentSessions[0].knowledgeTitle, "方程应用");
  assert.equal(JSON.stringify(history).includes("secret learner answer"), false);
});

test("keeps unavailable historical versions separate without borrowing current chapter definitions", () => {
  const state = fixture();
  state.privateTutorAttempts.push(attempt({
    id: "old-version-attempt",
    packageId: "demo-math-foundations-v1",
    packageVersion: "0.9.0",
    knowledgeId: "legacy-equation",
    createdAt: "2026-07-01T08:00:00.000Z",
  }));

  const history = buildPrivateTutorLearningHistory(state, "learner_history", {
    at: "2026-08-26T08:00:00.000Z",
  });
  const historical = history.packages.find((item) => item.packageVersion === "0.9.0");
  const current = history.packages.find((item) => item.packageVersion === "1.0.0");

  assert.equal(history.summary.packageCount, 3);
  assert.equal(historical.contentDefinitionAvailable, false);
  assert.equal(historical.chapters[0].moduleId, "unmapped");
  assert.equal(historical.chapters[0].summary.practiceAttemptCount, 1);
  assert.equal(current.chapters[0].summary.practiceAttemptCount, 3);
});

test("does not expose foreign personal-material metadata through malformed history references", () => {
  const state = fixture();
  state.privateTutorContentPackages.push({
    id: "pkg-user-foreign",
    name: "另一账号的私密教材名",
    subjectId: "general",
    domain: "private",
    sourceType: "user_material",
    version: "1.0.0",
    license: "private",
    learningProfileId: "usr_foreign",
    status: "published",
  });
  state.privateTutorAttempts.push(attempt({
    id: "malformed-foreign-reference",
    packageId: "pkg-user-foreign",
    packageVersion: "1.0.0",
    knowledgeId: "foreign-knowledge",
    createdAt: "2026-08-26T07:00:00.000Z",
  }));

  const history = buildPrivateTutorLearningHistory(state, "learner_history", {
    at: "2026-08-26T08:00:00.000Z",
    learningProfileId: "usr_history",
  });
  const foreign = history.packages.find((item) => item.packageId === "pkg-user-foreign");

  assert.equal(foreign.packageName, "pkg-user-foreign");
  assert.equal(foreign.contentDefinitionAvailable, false);
  assert.equal(JSON.stringify(history).includes("另一账号的私密教材名"), false);
});

function fixture() {
  return {
    privateTutorContentPackages: [],
    privateTutorModules: [],
    privateTutorTopics: [],
    privateTutorKnowledgeComponents: [],
    privateTutorSubjectPlugins: [],
    privateTutorAttempts: [
      attempt({ id: "a1", knowledgeId: "integer", correct: true, createdAt: "2026-08-22T08:00:00.000Z" }),
      attempt({ id: "a2", knowledgeId: "balance", correct: false, evidenceEligible: false, createdAt: "2026-08-24T08:00:00.000Z" }),
      attempt({ id: "a3", knowledgeId: "word-problem", correct: true, createdAt: "2026-08-25T08:00:00.000Z" }),
      attempt({
        id: "rubric-a1",
        packageId: "conceptual-source-reasoning-v1",
        packageVersion: "2.0.0",
        knowledgeId: "source-grounded-explanation",
        correct: true,
        createdAt: "2026-08-23T08:00:00.000Z",
        evaluation: { rubricVersion: "2.0.0", reviewStatus: "completed" },
      }),
    ],
    privateTutorSessions: [
      session({ id: "s1", day: 1, knowledgeId: "integer", reviewAt: "2026-08-21T08:00:00.000Z", completedAt: "2026-08-20T08:20:00.000Z" }),
      session({ id: "s2", day: 2, knowledgeId: "balance", reviewAt: "2026-08-25T08:00:00.000Z", completedAt: "2026-08-24T08:20:00.000Z" }),
      session({ id: "s3", day: 3, knowledgeId: "word-problem", reviewAt: "2026-08-27T08:00:00.000Z", completedAt: "2026-08-26T07:20:00.000Z" }),
    ],
    privateTutorLearningPlans: [{
      id: "plan-1",
      learnerId: "learner_history",
      contentPackageId: "demo-math-foundations-v1",
      contentPackageVersion: "1.0.0",
      status: "active",
      generatedAt: "2026-08-20T08:00:00.000Z",
      updatedAt: "2026-08-26T07:20:00.000Z",
      days: [
        { dayIndex: 1, knowledgeId: "integer", status: "completed" },
        { dayIndex: 2, knowledgeId: "balance", status: "completed" },
        { dayIndex: 3, knowledgeId: "word-problem", status: "in_progress" },
        { dayIndex: 4, knowledgeId: "equation-meaning", status: "planned" },
        { dayIndex: 5, knowledgeId: "equation-meaning", status: "rest" },
      ],
    }],
    privateTutorAssessments: [],
    privateTutorPackageActivations: [{
      id: "activation-1",
      learnerId: "learner_history",
      packageId: "demo-math-foundations-v1",
      packageVersion: "1.0.0",
      activatedAt: "2026-08-20T07:00:00.000Z",
    }],
  };
}

function attempt({
  id,
  packageId = "demo-math-foundations-v1",
  packageVersion = "1.0.0",
  knowledgeId,
  correct = true,
  evidenceEligible = true,
  createdAt,
  evaluation = null,
}) {
  return {
    id,
    learnerId: "learner_history",
    contentPackageId: packageId,
    contentPackageVersion: packageVersion,
    knowledgeId,
    correct,
    independent: true,
    usedHint: false,
    evidenceEligible,
    normalizedAnswer: "secret learner answer",
    evaluation,
    createdAt,
  };
}

function session({ id, day, knowledgeId, reviewAt, completedAt }) {
  return {
    id,
    learnerId: "learner_history",
    contentPackageId: "demo-math-foundations-v1",
    contentPackageVersion: "1.0.0",
    planId: "plan-1",
    planDayIndex: day,
    targetKnowledgeId: knowledgeId,
    targetTitle: { integer: "有理数运算", balance: "等式平衡", "word-problem": "方程应用" }[knowledgeId],
    status: "completed",
    startedAt: completedAt.replace(":20:", ":00:"),
    completedAt,
    updatedAt: completedAt,
    summary: { practiceCount: 3, evidenceCount: 2, reviewAt },
  };
}
