import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePrivateTutorTextbookExperiment } from "../src/services/private-tutor-textbook-experiment.mjs";

test("measures unit recall, math routing errors, and review workload without retaining page text", () => {
  const manifest = {
    schemaVersion: "private-tutor-textbook-experiment-v1",
    id: "fixture",
    source: { title: "数学教材", relativePath: "fixture.pdf", sha256: "abc", pageCount: 3 },
    unitGroundTruth: [
      { unitNumber: 1, title: "大数的认识", printedPageNumber: "2", sourcePageNumber: 1 },
      { unitNumber: 2, title: "角的度量", printedPageNumber: "38", sourcePageNumber: 2 },
      { unitNumber: 3, title: "条形统计图", printedPageNumber: "94", sourcePageNumber: 3 },
    ],
    reviewCostModel: { secondsPerPage: 90 },
    thresholds: { minimumUnitRecallRate: 0.5, maximumMathMisclassificationRate: 0.5, maximumReviewPageRate: 0.5 },
  };
  const material = {
    pages: [
      { pageNumber: 1, text: "第一单元 大数的认识", confidence: 0.96, review: { status: "not_required", reasons: [] } },
      { pageNumber: 2, text: "第二单元 角的度量", confidence: 0.8, review: { status: "pending", reasons: ["low_page_confidence", "low_block_confidence"] } },
      { pageNumber: 3, text: "练习内容", confidence: 0.98, review: { status: "not_required", reasons: [] } },
    ],
    extraction: { ocr: { providerId: "fixture", providerVersion: "v1" } },
  };
  const draft = {
    aggregation: { strategy: "textbook_units_v1" },
    draftModules: [{ id: "m1", name: "第一单元 大数的认识" }, { id: "m2", name: "第二单元 角的度量" }],
  };
  const report = evaluatePrivateTutorTextbookExperiment({
    manifest,
    material,
    draft,
    subjectPredictions: [
      { id: "math", sourceKind: "recognized_textbook", expectedSubjectId: "math", actualSubjectId: "math", evaluationSubjectId: "math", confidence: 0.9 },
      { id: "general", sourceKind: "pdf_text", expectedSubjectId: "general", actualSubjectId: "math", evaluationSubjectId: "math", confidence: 0.8 },
    ],
    generatedAt: "2026-08-28T00:00:00.000Z",
  });

  assert.equal(report.metrics.unitRecall.ocrTitleRecallRate, 0.6667);
  assert.equal(report.metrics.unitRecall.pipelineRecallRate, 0.6667);
  assert.equal(report.metrics.mathSubjectRouting.misclassificationRate, 0.5);
  assert.equal(report.metrics.mathSubjectRouting.falsePositiveCount, 1);
  assert.equal(report.metrics.humanReviewCost.requiredPageCount, 1);
  assert.equal(report.metrics.humanReviewCost.pageRate, 0.3333);
  assert.equal(report.metrics.humanReviewCost.estimatedMinutes, 1.5);
  assert.equal(report.metrics.humanReviewCost.reasonCounts.low_block_confidence, 1);
  assert.equal(JSON.stringify(report).includes("练习内容"), false);
  assert.equal(report.passed, true);
});
