import assert from "node:assert/strict";
import test from "node:test";
import {
  initialDiagnosticQuestion,
  privateTutorQuestion,
  privateTutorSeedQuestionRevisions,
} from "../src/services/private-tutor-assessment.mjs";
import {
  activePrivateTutorQuestionRevision,
  createPrivateTutorQuestionRevision,
  disablePrivateTutorQuestionRevision,
  publishPrivateTutorQuestionRevision,
  reviewPrivateTutorQuestionRevision,
  rollbackPrivateTutorQuestion,
  seedPrivateTutorQuestionContent,
  submitPrivateTutorQuestionRevision,
} from "../src/services/private-tutor-content.mjs";
import { currentPrivateTutorReviewQuestion } from "../src/services/private-tutor-review.mjs";

test("an immutable question revision needs two independent approvals before publication", () => {
  const { state, now, nextId } = fixture();
  const input = {
    questionId: "diag-eqm-02",
    context: "diagnostic",
    knowledgeId: "equation-meaning",
    difficulty: 2,
    kind: "numeric",
    prompt: "x + 5 = 11，x 是多少？",
    expectedAnswer: "6",
    allowVariableAssignment: true,
  };
  const created = createPrivateTutorQuestionRevision(state, input, { actorId: "author", now, nextId });
  assert.equal(created.ok, true);
  assert.equal(created.revision.version, 2);
  input.prompt = "外部修改不应污染已创建修订";
  assert.equal(state.privateTutorQuestionRevisions[0].prompt, "x + 5 = 11，x 是多少？");
  assert.equal(privateTutorQuestion(created.revision.id, state), null, "draft content must not be usable");

  assert.equal(publishPrivateTutorQuestionRevision(state, created.revision.id, { actorId: "author", now, nextId }).error,
    "private_tutor_question_revision_not_approved");
  assert.equal(submitPrivateTutorQuestionRevision(state, created.revision.id, { actorId: "author", now, nextId }).ok, true);
  assert.equal(reviewPrivateTutorQuestionRevision(state, created.revision.id, { decision: "approved", evidence: "作者自审" }, { actorId: "author", now, nextId }).error,
    "private_tutor_question_self_review_forbidden");
  const first = reviewPrivateTutorQuestionRevision(state, created.revision.id, { decision: "approved", evidence: "验算和题意复核通过" }, { actorId: "reviewer-a", now, nextId });
  assert.equal(first.revision.status, "in_review");
  assert.equal(publishPrivateTutorQuestionRevision(state, created.revision.id, { actorId: "author", now, nextId }).error,
    "private_tutor_question_revision_not_approved");
  const second = reviewPrivateTutorQuestionRevision(state, created.revision.id, { decision: "approved", evidence: "独立复核通过" }, { actorId: "reviewer-b", now, nextId });
  assert.equal(second.revision.status, "approved");

  const published = publishPrivateTutorQuestionRevision(state, created.revision.id, { actorId: "publisher", now, nextId });
  assert.equal(published.ok, true);
  assert.equal(initialDiagnosticQuestion(state).revisionId, created.revision.id);
  assert.equal(initialDiagnosticQuestion(state).prompt, "x + 5 = 11，x 是多少？");
  assert.equal(privateTutorQuestion(created.revision.id, state).expectedRational.numerator, 6n);
});

test("disable removes an active revision and rollback explicitly restores a safe prior release", () => {
  const { state, now, nextId } = fixture();
  const original = activePrivateTutorQuestionRevision(state, "diag-eqm-02");
  const created = createPrivateTutorQuestionRevision(state, {
    questionId: "diag-eqm-02",
    context: "diagnostic",
    knowledgeId: "equation-meaning",
    difficulty: 2,
    kind: "numeric",
    prompt: "x + 8 = 15，x 是多少？",
    expectedAnswer: "7",
  }, { actorId: "author", now, nextId });
  submitPrivateTutorQuestionRevision(state, created.revision.id, { actorId: "author", now, nextId });
  for (const reviewerId of ["reviewer-a", "reviewer-b"]) {
    reviewPrivateTutorQuestionRevision(state, created.revision.id, { decision: "approved", evidence: `${reviewerId} checked` }, { actorId: reviewerId, now, nextId });
  }
  publishPrivateTutorQuestionRevision(state, created.revision.id, { actorId: "publisher", now, nextId });
  const disabled = disablePrivateTutorQuestionRevision(state, created.revision.id, { reason: "发现题干歧义" }, { actorId: "publisher", now, nextId });
  assert.equal(disabled.activeRevisionId, null);
  assert.equal(initialDiagnosticQuestion(state), null);
  assert.equal(privateTutorQuestion(created.revision.id, state), null);

  const rolledBack = rollbackPrivateTutorQuestion(state, "diag-eqm-02", { revisionId: original.id, reason: "恢复已审核稳定版本" }, { actorId: "publisher", now, nextId });
  assert.equal(rolledBack.ok, true);
  assert.equal(initialDiagnosticQuestion(state).revisionId, original.id);
  assert.equal(activePrivateTutorQuestionRevision(state, "diag-eqm-02").id, original.id);
});

test("a disabled revision is removed from original-error correction as well as new question selection", () => {
  const { state, now, nextId } = fixture();
  state.privateTutorErrorThemes.push({ id: "theme-1", learnerId: "learner-1", knowledgeId: "balance", errorCaseIds: ["case-1"] });
  state.privateTutorErrorCases.push({ id: "case-1", learnerId: "learner-1", questionRevisionId: "demo-balance-001-v1" });
  const schedule = { id: "schedule-1", learnerId: "learner-1", themeId: "theme-1", phase: "correction" };
  assert.equal(currentPrivateTutorReviewQuestion(state, schedule).revisionId, "demo-balance-001-v1");
  disablePrivateTutorQuestionRevision(state, "demo-balance-001-v1", { reason: "发现安全问题" }, { actorId: "publisher", now, nextId });
  assert.equal(currentPrivateTutorReviewQuestion(state, schedule), null);
});

function fixture() {
  let sequence = 0;
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 7, 21, 0, 0, tick++)).toISOString();
  const nextId = (prefix) => `${prefix}_${++sequence}`;
  const state = {
    privateTutorQuestionRevisions: [],
    privateTutorQuestionReviews: [],
    privateTutorContentEvents: [],
    privateTutorErrorThemes: [],
    privateTutorErrorCases: [],
  };
  const seededAt = now();
  seedPrivateTutorQuestionContent(state, privateTutorSeedQuestionRevisions(seededAt), seededAt);
  return { state, now, nextId };
}
