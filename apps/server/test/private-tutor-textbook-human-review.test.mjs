import assert from "node:assert/strict";
import test from "node:test";

import {
  createPrivateTutorTextbookHumanReviewRecord,
  evaluatePrivateTutorTextbookHumanReviews,
} from "../src/services/private-tutor-textbook-human-review.mjs";

test("records attested human timing without retaining textbook text", () => {
  const record = createPrivateTutorTextbookHumanReviewRecord({
    task: { pageNumber: 3, printedPageNumber: null, confidence: 0.99, reasons: ["low_block_confidence"], text: "原始识别文字" },
    input: {
      sessionId: "session-1",
      startedAt: "2026-08-28T00:00:00.000Z",
      durationSeconds: 42,
      correctedText: "修正识别文字",
      correctedPrintedPageNumber: "",
      triggerDecision: "valid_trigger",
      falseTriggerReasons: [],
      note: "发现一个错字",
      reviewerAttestation: true,
    },
    now: "2026-08-28T00:00:42.000Z",
  });
  assert.equal(record.textEdited, true);
  assert.equal(record.durationSeconds, 42);
  assert.ok(record.changedCharacterEstimate > 0);
  assert.equal(JSON.stringify(record).includes("原始识别文字"), false);
  assert.equal(JSON.stringify(record).includes("修正识别文字"), false);
});

test("requires a reason for false or mixed trigger decisions", () => {
  assert.throws(() => createPrivateTutorTextbookHumanReviewRecord({
    task: { pageNumber: 1, text: "文字", reasons: ["low_block_confidence"] },
    input: { durationSeconds: 10, correctedText: "文字", triggerDecision: "false_trigger", reviewerAttestation: true },
  }), /textbook_review_false_trigger_reason_required/);
});

test("summarizes modification, timing, false-trigger causes, and a conservative threshold decision", () => {
  const targets = Array.from({ length: 10 }, (_, index) => ({
    pageNumber: index + 1,
    reasons: ["low_block_confidence"],
    confidence: 0.8,
  }));
  const reviews = targets.map((target, index) => createPrivateTutorTextbookHumanReviewRecord({
    task: { ...target, text: `原文${index}` },
    input: {
      durationSeconds: 20 + index,
      correctedText: index === 0 ? "修正文" : `原文${index}`,
      correctedPrintedPageNumber: "",
      triggerDecision: index < 8 ? "false_trigger" : "valid_trigger",
      falseTriggerReasons: index < 8 ? ["decorative_or_nonsemantic_block"] : [],
      reviewerAttestation: true,
    },
  }));
  const summary = evaluatePrivateTutorTextbookHumanReviews({ targets, reviews });
  assert.equal(summary.reviewedPageCount, 10);
  assert.equal(summary.modificationRate, 0.1);
  assert.equal(summary.falseTriggerRate, 0.8);
  assert.equal(summary.falseTriggerReasonCounts.decorative_or_nonsemantic_block, 8);
  assert.equal(summary.thresholdRecommendation.decision, "consider_reason_specific_tuning");
  assert.equal(summary.thresholdRecommendation.changeGlobalThreshold, false);
});
