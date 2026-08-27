import assert from "node:assert/strict";
import test from "node:test";

import { createServerState } from "../src/runtime/state-factory.mjs";

import {
  buildDiagnosticResult,
  initialDiagnosticQuestion,
  initialQuickDiagnosticQuestion,
  judgePrivateTutorAnswer,
  privateTutorQuickDiagnosticConfig,
  privateTutorQuestion,
  publicQuestion,
  selectNextDiagnosticQuestion,
  selectNextQuickDiagnosticQuestion,
} from "../src/services/private-tutor-assessment.mjs";

test("deterministic judging accepts equivalent rational forms without evaluating code", () => {
  for (const rawAnswer of ["5", "5.0", "10/2", "(2 + 8) / 2", "x = 5"]) {
    const result = judgePrivateTutorAnswer("demo-balance-001-v1", { rawAnswer });
    assert.equal(result.accepted, true, rawAnswer);
    assert.equal(result.correct, true, rawAnswer);
    assert.equal(result.normalizedAnswer, "5", rawAnswer);
  }
  assert.equal(judgePrivateTutorAnswer("demo-balance-001-v1", { rawAnswer: "4" }).correct, false);
  assert.deepEqual(
    judgePrivateTutorAnswer("demo-balance-001-v1", { rawAnswer: "process.exit()" }),
    { accepted: false, error: "invalid_private_tutor_answer_format" },
  );
});

test("choice judging and public questions never expose the answer key", () => {
  const question = privateTutorQuestion("diag-bal-01-v1");
  const publicView = publicQuestion(question);
  assert.equal(JSON.stringify(publicView).includes("expectedChoice"), false);
  assert.equal(judgePrivateTutorAnswer(question.id, { rawAnswer: "b" }).correct, true);
  assert.equal(judgePrivateTutorAnswer(question.id, { rawAnswer: "a" }).correct, false);
});

test("an incorrect anchor immediately checks its prerequisite", () => {
  const first = initialDiagnosticQuestion();
  assert.equal(first.knowledgeId, "equation-meaning");
  const next = selectNextDiagnosticQuestion([{
    questionRevisionId: first.revisionId,
    knowledgeId: first.knowledgeId,
    difficulty: first.difficulty,
    correct: false,
    responseKind: "answer",
  }]);
  assert.equal(next.knowledgeId, "integer");
  assert.equal(next.difficulty, 1);
});

test("adaptive diagnostic reaches two pieces of evidence per knowledge point in the target band", () => {
  const answers = [];
  let question = initialDiagnosticQuestion();
  while (question) {
    answers.push({
      questionRevisionId: question.revisionId,
      knowledgeId: question.knowledgeId,
      difficulty: question.difficulty,
      correct: true,
      responseKind: "answer",
    });
    question = selectNextDiagnosticQuestion(answers);
  }
  assert.ok(answers.length >= 12 && answers.length <= 18);
  const result = buildDiagnosticResult(answers);
  assert.equal(result.knowledge.every((item) => item.evidenceCount >= 2), true);
  assert.equal(result.knowledge.every((item) => item.level !== "unknown"), true);
});

test("unmeasured knowledge remains unknown and explicit dont-know is evidence, not missing data", () => {
  const result = buildDiagnosticResult([{
    questionRevisionId: "diag-eqm-02-v1",
    knowledgeId: "equation-meaning",
    difficulty: 2,
    correct: false,
    responseKind: "dont_know",
  }]);
  assert.equal(result.knowledge.find((item) => item.knowledgeId === "integer").level, "unknown");
  const measured = result.knowledge.find((item) => item.knowledgeId === "equation-meaning");
  assert.equal(measured.level, "needs_support");
  assert.equal(measured.dontKnowCount, 1);
});

test("quick diagnostic stays on one selected knowledge point and stops after three questions", () => {
  const { state } = createServerState({
    defaultProjectPath: process.cwd(),
    now: () => "2026-08-27T00:00:00.000Z",
  });
  const packageId = "demo-math-foundations-v1";
  const config = privateTutorQuickDiagnosticConfig(state, packageId, "balance");
  assert.deepEqual(config, { minQuestions: 3, maxQuestions: 3, targetSeconds: 135 });

  const answers = [];
  let question = initialQuickDiagnosticQuestion(state, packageId, "balance");
  while (question) {
    answers.push({
      questionRevisionId: question.revisionId,
      knowledgeId: question.knowledgeId,
      difficulty: question.difficulty,
      correct: true,
      responseKind: "answer",
    });
    question = selectNextQuickDiagnosticQuestion(answers, state, packageId, "balance");
  }
  assert.equal(answers.length, 3);
  assert.deepEqual(answers.map((answer) => answer.knowledgeId), ["balance", "balance", "balance"]);
  assert.deepEqual(answers.map((answer) => answer.difficulty), [1, 2, 3]);
  assert.equal(privateTutorQuickDiagnosticConfig(state, packageId, "missing"), null);
});
