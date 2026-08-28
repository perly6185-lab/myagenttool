import assert from "node:assert/strict";
import test from "node:test";
import {
  answerPrivateTutorFollowUp,
  completePrivateTutorActivity,
  completePrivateTutorPlanDay,
  createPrivateTutorSession,
  pausePrivateTutorSession,
  privateTutorSessionView,
  recordPrivateTutorSessionAnswer,
  resumePrivateTutorSession,
  revealPrivateTutorHint,
} from "../src/services/private-tutor-session.mjs";
import { updatePrivateTutorLearningPreferences } from "../src/services/private-tutor-learning-preferences.mjs";

function fixture(pace = "standard", targetMinutes = null) {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 7, 20, 8, 0, tick++)).toISOString();
  return {
    now,
    session: createPrivateTutorSession({
      id: "ptsess_1",
      ownerTeamId: "team_a",
      learnerId: "learner_a",
      plan: { id: "plan_1", days: [{ knowledgeId: "balance", strategy: "concept_rebuild" }] },
      decision: { id: "decision_1", targetKnowledgeId: "balance", strategy: "concept_rebuild" },
      pace,
      targetMinutes,
      now,
    }),
  };
}

test("a standard session has the five teaching phases and exactly twenty planned minutes", () => {
  const { session } = fixture();
  const view = privateTutorSessionView(session);
  assert.deepEqual(view.progress.map((item) => item.kind), ["recall", "explain", "guided_practice", "independent_check", "summary"]);
  assert.equal(view.progress.reduce((total, item) => total + item.budgetMinutes, 0), 20);
  assert.equal(view.currentActivity.question.revisionId, "tutor-bal-recall-001-v1");
  assert.equal(view.currentActivity.visualScene.template, "equation_balance");
  assert.equal(view.currentActivity.visualScene.publication.mathValidated, true);
  assert.equal(JSON.stringify(view).includes("expectedRational"), false);
});

test("light and review modes keep the same safe phases within their shorter budgets", () => {
  for (const [pace, expectedMinutes] of [["easy", 5], ["review", 10]]) {
    const { session } = fixture(pace);
    const view = privateTutorSessionView(session);
    assert.equal(view.plannedMinutes, expectedMinutes);
    assert.equal(view.progress.reduce((total, item) => total + item.budgetMinutes, 0), expectedMinutes);
    assert.equal(view.progress.length, 5);
  }
});

test("a standard session scales its five safe phases to the persisted daily target", () => {
  const { session } = fixture("standard", 35);
  const view = privateTutorSessionView(session);
  assert.equal(view.plannedMinutes, 35);
  assert.equal(view.progress.reduce((total, item) => total + item.budgetMinutes, 0), 35);
  assert.equal(view.progress.every((item) => item.budgetMinutes >= 1), true);
});

test("a goal-budgeted plan day overrides the general daily target", () => {
  const now = () => "2026-08-20T08:00:00.000Z";
  const session = createPrivateTutorSession({
    id: "ptsess_goal_budget",
    ownerTeamId: "team_a",
    learnerId: "learner_a",
    plan: { id: "plan_goal", days: [{ dayIndex: 1, status: "planned", minutes: 25, knowledgeId: "balance", strategy: "concept_rebuild" }] },
    decision: { id: "decision_goal", targetKnowledgeId: "balance", strategy: "concept_rebuild" },
    pace: "standard",
    targetMinutes: 35,
    now,
  });
  assert.equal(session.plannedMinutes, 25);
  assert.equal(session.planDayIndex, 1);
});

test("finishing the only budgeted learning day preserves recovery days and completes the plan", () => {
  const plan = {
    status: "active",
    days: [
      { dayIndex: 1, status: "in_progress" },
      ...Array.from({ length: 6 }, (_, index) => ({ dayIndex: index + 2, status: "rest" })),
    ],
  };
  assert.equal(completePrivateTutorPlanDay(plan, { status: "completed", planDayIndex: 1 }, "2026-08-20T09:00:00.000Z"), true);
  assert.equal(plan.status, "completed");
  assert.equal(plan.days.slice(1).every((day) => day.status === "rest"), true);
});

test("pause and resume preserve the exact activity", () => {
  const { session, now } = fixture();
  const questionId = privateTutorSessionView(session).currentActivity.question.revisionId;
  assert.equal(pausePrivateTutorSession(session, now), true);
  assert.equal(session.status, "paused");
  assert.equal(resumePrivateTutorSession(session, now), true);
  assert.equal(privateTutorSessionView(session).currentActivity.question.revisionId, questionId);
});

test("two incorrect answers switch methods instead of adding more of the same", () => {
  const { session, now } = fixture();
  const originalMethod = session.teachingMethod;
  recordPrivateTutorSessionAnswer(session, { correct: false, attemptId: "a1", now });
  recordPrivateTutorSessionAnswer(session, { correct: false, attemptId: "a2", now });
  assert.notEqual(session.teachingMethod, originalMethod);
  assert.equal(session.methodSwitchCount, 1);
  assert.equal(session.intervention.type, "method_switch");
  assert.match(session.intervention.message, /换一种讲法/);
});

test("the summary distinguishes hinted practice from an independent new-question check", () => {
  const { session, now } = fixture();
  recordPrivateTutorSessionAnswer(session, { correct: true, attemptId: "recall", now });
  completePrivateTutorActivity(session, now);
  revealPrivateTutorHint(session, now);
  recordPrivateTutorSessionAnswer(session, { correct: true, attemptId: "guided", now });
  assert.equal(privateTutorSessionView(session).currentActivity.question.revisionId, "tutor-bal-transfer-001-v1");
  recordPrivateTutorSessionAnswer(session, { correct: true, attemptId: "transfer", now });
  completePrivateTutorActivity(session, now);
  assert.equal(session.status, "completed");
  assert.equal(session.summary.independentCompleted, true);
  assert.deepEqual(session.summary.hintedActivities, ["guided_practice"]);
  assert.equal(session.summary.evidenceCount, 3);
});

test("a personalized policy changes hint granularity and the actual review interval", () => {
  const now = () => "2026-08-20T08:00:00.000Z";
  const session = createPrivateTutorSession({
    id: "ptsess_policy",
    ownerTeamId: "team_a",
    learnerId: "learner_a",
    plan: { id: "plan_policy", days: [{ knowledgeId: "balance", strategy: "concept_rebuild" }] },
    decision: { id: "decision_policy", targetKnowledgeId: "balance", strategy: "concept_rebuild" },
    pace: "standard",
    now,
    teachingPolicy: { explanationMode: "small_step", questionDifficulty: "support", hintGranularity: "micro_steps", reviewIntervalHours: 8 },
  });
  revealPrivateTutorHint(session, now);
  assert.match(privateTutorSessionView(session).currentActivity.hint, /只看这一小步/);
  recordPrivateTutorSessionAnswer(session, { correct: true, attemptId: "recall", now });
  completePrivateTutorActivity(session, now);
  recordPrivateTutorSessionAnswer(session, { correct: true, attemptId: "guided", now });
  recordPrivateTutorSessionAnswer(session, { correct: true, attemptId: "transfer", now });
  completePrivateTutorActivity(session, now);
  assert.equal(session.summary.reviewAt, "2026-08-20T16:00:00.000Z");
});

function prefState(preferences = []) {
  return { privateTutorLearningPreferences: preferences };
}

const prefNow = () => "2026-08-25T00:00:00.000Z";
let prefId = 0;

test("teaching preferences reframe the explanation without touching questions or grading", () => {
  const { session } = fixture();
  const plain = privateTutorSessionView(session);

  const state = prefState();
  updatePrivateTutorLearningPreferences(state, "learner_a", {
    teacherStyle: "socratic_questioning",
    explanationDepth: "professional_depth",
    followUpStyle: "direct_check",
  }, { now: prefNow, nextId: (p) => `${p}_${++prefId}` });

  const styled = privateTutorSessionView(session, state);
  // The question and answer path stay identical...
  assert.equal(styled.currentActivity.question.revisionId, plain.currentActivity.question.revisionId);
  assert.deepEqual(styled.currentActivity.question, plain.currentActivity.question);
  // ...while the view surfaces the preferences and the explanation gains the frames.
  assert.equal(styled.teachingPreferences.teacherStyle, "socratic_questioning");
  assert.equal(styled.teachingPreferences.explanationDepth, "professional_depth");

  // Explain-phase instruction carries both frames; other phases stay clean.
  session.activities.forEach((a, i) => { if (a.kind !== "explain") session.activities[i] = { ...a, status: "completed" }; });
  session.currentActivityIndex = session.activities.findIndex((a) => a.kind === "explain");
  const explainPlain = privateTutorSessionView(session).currentActivity.instruction;
  const explainStyled = privateTutorSessionView(session, state).currentActivity.instruction;
  assert.ok(explainStyled.startsWith(explainPlain));
  assert.match(explainStyled, /连续追问/);
  assert.match(explainStyled, /专业标准深入/);
  assert.match(explainStyled, /直接用一个检查问题/);

  const recallIndex = session.activities.findIndex((a) => a.kind === "recall");
  session.currentActivityIndex = recallIndex;
  const recallStyled = privateTutorSessionView(session, state).currentActivity.instruction;
  assert.equal(recallStyled, privateTutorSessionView(session).currentActivity.instruction);
});

test("grading outcome is identical regardless of teaching preferences", () => {
  const { session, now } = fixture();
  const state = prefState();
  updatePrivateTutorLearningPreferences(state, "learner_a", { teacherStyle: "case_driven" }, { now: prefNow, nextId: (p) => `${p}_${++prefId}` });

  recordPrivateTutorSessionAnswer(session, { correct: false, attemptId: "g1", now });
  recordPrivateTutorSessionAnswer(session, { correct: false, attemptId: "g2", now });
  // Method-switch intervention is driven by answer correctness only, never by style.
  assert.equal(session.methodSwitchCount, 1);
  assert.equal(session.intervention.type, "method_switch");
  assert.equal(privateTutorSessionView(session, state).teachingPreferences.teacherStyle, "case_driven");
});

test("session view without preferences state keeps prior behavior", () => {
  const { session } = fixture();
  const view = privateTutorSessionView(session);
  assert.equal(view.teachingPreferences, null);
  assert.equal(view.currentActivity.instruction.includes("讲解方式："), false);
});

test("a learner can request another explanation without creating mastery evidence", () => {
  const { session, now } = fixture();
  const originalMethod = session.teachingMethod;
  const originalActivity = session.currentActivityIndex;
  const originalEvidence = [...session.evidenceAttemptIds];
  const result = answerPrivateTutorFollowUp(session, {
    mode: "explain_again",
    question: "",
    state: {},
    now,
    nextId: (prefix) => `${prefix}_1`,
  });

  assert.equal(result.ok, true);
  assert.notEqual(session.teachingMethod, originalMethod);
  assert.equal(session.currentActivityIndex, originalActivity);
  assert.deepEqual(session.evidenceAttemptIds, originalEvidence);
  assert.equal(result.followUp.evidenceEligible, false);
  assert.equal(result.followUp.grounding, "reviewed_curriculum");
  assert.match(result.followUp.response, /不会读取题目答案/);
  assert.equal(privateTutorSessionView(session).followUps.length, 1);
});

test("follow-up answers quote only the active published source and never expose an answer key", () => {
  const now = () => "2026-08-25T01:00:00.000Z";
  const knowledge = {
    id: "grounded-concept",
    name: "来源约束",
    prerequisiteKnowledgeIds: [],
    sourceRefs: [{ sectionId: "sec_2", pageNumber: 7, excerpt: "可靠回答需要区分原文信息与自己的推断。", sourceHash: "hash", origin: "source" }],
    teachingContent: { explanation: "只依据可核验来源回答。", keyPoints: ["先定位原文", "再标明推断边界"] },
    tutoringQuestions: [
      { id: "grounded-recall-v1", expectedAnswer: "never expose this" },
      { id: "grounded-guided-v1", expectedAnswer: "never expose this" },
      { id: "grounded-transfer-v1", expectedAnswer: "never expose this" },
    ],
  };
  const state = {
    privateTutorContentPackages: [{
      id: "grounded-package",
      name: "来源教材",
      subjectId: "conceptual",
      evaluationSubjectId: "conceptual",
      domain: "reasoning",
      sourceType: "user_material",
      version: "1.0.0",
      status: "published",
      knowledgeComponents: [knowledge],
      modules: [],
    }],
    privateTutorModules: [],
    privateTutorTopics: [],
    privateTutorKnowledgeComponents: [],
    privateTutorSubjectPlugins: [],
  };
  const session = createPrivateTutorSession({
    id: "ptsess_grounded",
    ownerTeamId: "team_a",
    learnerId: "learner_a",
    plan: { id: "plan_grounded", days: [{ knowledgeId: knowledge.id, strategy: "concept_rebuild" }] },
    decision: { id: "decision_grounded", targetKnowledgeId: knowledge.id, strategy: "concept_rebuild" },
    pace: "standard",
    now,
    state,
    contentPackageId: "grounded-package",
  });

  const result = answerPrivateTutorFollowUp(session, {
    mode: "question",
    question: "这段话最重要的边界是什么？",
    state,
    now,
    nextId: (prefix) => `${prefix}_grounded`,
  });

  assert.equal(result.ok, true);
  assert.equal(result.followUp.grounding, "source_excerpt");
  assert.deepEqual(result.followUp.sourceRefs, [{ sectionId: "sec_2", pageNumber: 7, excerpt: "可靠回答需要区分原文信息与自己的推断。" }]);
  assert.match(result.followUp.response, /可靠回答需要区分原文信息与自己的推断/);
  assert.match(result.followUp.response, /资料没有覆盖的结论，我不会补写/);
  assert.equal(result.followUp.response.includes("never expose this"), false);
  assert.equal(session.evidenceAttemptIds.length, 0);
});

test("free-form follow-up questions are bounded before session state changes", () => {
  const { session, now } = fixture();
  const revision = session.revision;
  const result = answerPrivateTutorFollowUp(session, {
    mode: "question",
    question: "x".repeat(501),
    state: {},
    now,
    nextId: (prefix) => `${prefix}_1`,
  });
  assert.deepEqual(result, { ok: false, error: "invalid_private_tutor_follow_up_question" });
  assert.equal(session.revision, revision);
  assert.equal(session.followUps.length, 0);
});

test("asking for help on the transfer check prevents it from being summarized as independent", () => {
  const { session, now } = fixture();
  recordPrivateTutorSessionAnswer(session, { correct: true, attemptId: "recall", now });
  completePrivateTutorActivity(session, now);
  recordPrivateTutorSessionAnswer(session, { correct: true, attemptId: "guided", now });
  assert.equal(privateTutorSessionView(session).currentActivity.kind, "independent_check");

  answerPrivateTutorFollowUp(session, {
    mode: "question",
    question: "这一步该从哪里开始？",
    state: {},
    now,
    nextId: (prefix) => `${prefix}_transfer`,
  });
  assert.equal(privateTutorSessionView(session).currentActivity.followUpCount, 1);
  recordPrivateTutorSessionAnswer(session, { correct: true, attemptId: "transfer", now });
  completePrivateTutorActivity(session, now);

  assert.equal(session.status, "completed");
  assert.equal(session.summary.independentCompleted, false);
  assert.match(session.summary.nextStep, /小提示/);
});
