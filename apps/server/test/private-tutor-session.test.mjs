import assert from "node:assert/strict";
import test from "node:test";
import {
  completePrivateTutorActivity,
  createPrivateTutorSession,
  pausePrivateTutorSession,
  privateTutorSessionView,
  recordPrivateTutorSessionAnswer,
  resumePrivateTutorSession,
  revealPrivateTutorHint,
} from "../src/services/private-tutor-session.mjs";
import { updatePrivateTutorLearningPreferences } from "../src/services/private-tutor-learning-preferences.mjs";

function fixture(pace = "standard") {
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
