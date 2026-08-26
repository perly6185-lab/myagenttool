import assert from "node:assert/strict";
import test from "node:test";
import {
  currentPrivateTutorReviewQuestion,
  privateTutorReviewBook,
  recordPrivateTutorErrorEvidence,
  recordPrivateTutorReviewResult,
} from "../src/services/private-tutor-review.mjs";

function fixture() {
  let sequence = 0;
  let current = "2026-08-20T08:00:00.000Z";
  return {
    state: { privateTutorErrorCases: [], privateTutorErrorThemes: [], privateTutorReviewSchedules: [] },
    learner: { id: "learner-a", ownerTeamId: "family-a" },
    now: () => current,
    setNow: (value) => { current = value; },
    nextId: (prefix) => `${prefix}_${++sequence}`,
  };
}

function wrong(overrides = {}) {
  return {
    id: "attempt-1", learnerId: "learner-a", knowledgeId: "balance",
    questionRevisionId: "tutor-bal-guided-001-v1", correct: false, independent: false,
    usedHint: false, source: "screen", recognitionConfidence: null, responseKind: "answer",
    normalizedAnswer: "4", createdAt: "2026-08-20T08:00:00.000Z", ...overrides,
  };
}

test("the same question can produce learner-specific misconception themes", () => {
  const first = fixture();
  const second = fixture();
  second.learner.id = "learner-b";
  recordPrivateTutorErrorEvidence({ ...first, attempt: wrong() });
  recordPrivateTutorErrorEvidence({ ...second, attempt: wrong({ learnerId: "learner-b", normalizedAnswer: "8" }) });
  assert.equal(first.state.privateTutorErrorThemes[0].misconceptionId, "division_fluency");
  assert.equal(second.state.privateTutorErrorThemes[0].misconceptionId, "variable_isolation");
});

test("a theme needs correction, new questions, and a 24-hour delayed check before mastery", () => {
  const data = fixture();
  const created = recordPrivateTutorErrorEvidence({ ...data, attempt: wrong() });
  const schedule = created.schedule;
  assert.equal(currentPrivateTutorReviewQuestion(data.state, schedule).revisionId, "tutor-bal-guided-001-v1");

  for (const [phase, attemptId] of [["correction", "r1"], ["similar", "r2"], ["variation", "r3"]]) {
    assert.equal(schedule.phase, phase);
    recordPrivateTutorReviewResult({ state: data.state, schedule, attempt: { id: attemptId, correct: true }, now: data.now });
  }
  assert.equal(schedule.phase, "delayed");
  assert.equal(schedule.dueAt, "2026-08-21T08:00:00.000Z");
  assert.equal(privateTutorReviewBook(data.state, data.learner.id, data.now()).themes[0].status, "working");

  data.setNow("2026-08-21T08:00:00.000Z");
  recordPrivateTutorReviewResult({ state: data.state, schedule, attempt: { id: "r4", correct: true }, now: data.now });
  assert.equal(schedule.status, "completed");
  assert.equal(data.state.privateTutorErrorThemes[0].status, "mastered");
});

test("a repeated error reopens a mastered theme instead of losing its history", () => {
  const data = fixture();
  const first = recordPrivateTutorErrorEvidence({ ...data, attempt: wrong() });
  first.theme.status = "mastered";
  first.schedule.status = "completed";
  const reopened = recordPrivateTutorErrorEvidence({ ...data, attempt: wrong({ id: "attempt-2" }) });
  assert.equal(reopened.theme.id, first.theme.id);
  assert.equal(reopened.theme.reopenedCount, 1);
  assert.equal(reopened.theme.occurrenceCount, 2);
  assert.equal(reopened.schedule.phase, "correction");
});
