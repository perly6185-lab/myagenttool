import assert from "node:assert/strict";
import test from "node:test";
import { privateTutorQuestion } from "../src/services/private-tutor-assessment.mjs";
import { normalizePrivateTutorSpeech } from "../src/services/private-tutor-voice.mjs";

test("normalizes common spoken Chinese math without evaluating it", () => {
  const question = privateTutorQuestion("tutor-bal-guided-001-v1");
  assert.deepEqual(normalizePrivateTutorSpeech({ transcript: "x 等于 五", confidence: 0.96, question }), {
    accepted: true,
    transcript: "x 等于 五",
    normalizedExpression: "x=5",
    confidence: 0.96,
    status: "ready",
    requiresConfirmation: false,
    reasonCodes: [],
  });
  assert.equal(normalizePrivateTutorSpeech({ transcript: "负三", confidence: 0.9, question }).normalizedExpression, "-3");
  assert.equal(normalizePrivateTutorSpeech({ transcript: "x 是五", confidence: 0.9, question }).normalizedExpression, "x=5");
  assert.equal(normalizePrivateTutorSpeech({ transcript: "二分之一", confidence: 0.9, question }).normalizedExpression, "1/2");
  assert.equal(normalizePrivateTutorSpeech({ transcript: "十六", confidence: 0.9, question }).normalizedExpression, "16");
});

test("normalizes spoken choices against the current question", () => {
  const question = privateTutorQuestion("tutor-eqm-recall-001-v1");
  assert.equal(normalizePrivateTutorSpeech({ transcript: "选 B", confidence: 0.98, question }).normalizedExpression, "b");
  assert.equal(normalizePrivateTutorSpeech({ transcript: "我选 B 选项", confidence: 0.98, question }).normalizedExpression, "b");
  assert.equal(normalizePrivateTutorSpeech({ transcript: "第二个", confidence: 0.98, question }).normalizedExpression, "b");
});

test("low confidence and differing alternatives always require confirmation", () => {
  const question = privateTutorQuestion("tutor-bal-guided-001-v1");
  const low = normalizePrivateTutorSpeech({ transcript: "五", confidence: 0.54, question });
  assert.equal(low.status, "confirmation_required");
  assert.deepEqual(low.reasonCodes, ["low_confidence"]);

  const ambiguous = normalizePrivateTutorSpeech({ transcript: "五", confidence: 0.94, alternatives: ["四"], question });
  assert.equal(ambiguous.status, "confirmation_required");
  assert.deepEqual(ambiguous.reasonCodes, ["alternative_mismatch"]);
});

test("unsupported speech stays outside deterministic grading", () => {
  const question = privateTutorQuestion("tutor-bal-guided-001-v1");
  const result = normalizePrivateTutorSpeech({ transcript: "我觉得应该往左边移动", confidence: 0.99, question });
  assert.equal(result.status, "unsupported");
  assert.equal(result.normalizedExpression, null);
  assert.equal(result.requiresConfirmation, true);
});
