export const PRIVATE_TUTOR_TEXTBOOK_EXPERIMENT_SCHEMA_VERSION = "private-tutor-textbook-experiment-v1";

export function evaluatePrivateTutorTextbookExperiment({
  manifest,
  material,
  draft = null,
  subjectPredictions = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  validateInputs(manifest, material);
  const units = evaluateUnits(manifest.unitGroundTruth, material.pages, draft);
  const subject = evaluateSubjects(subjectPredictions);
  const review = evaluateReviewCost(material.pages, manifest.reviewCostModel);
  const thresholds = {
    minimumUnitRecallRate: boundedRate(manifest.thresholds?.minimumUnitRecallRate, 0.9),
    maximumMathMisclassificationRate: boundedRate(manifest.thresholds?.maximumMathMisclassificationRate, 0),
    maximumReviewPageRate: boundedRate(manifest.thresholds?.maximumReviewPageRate, 0.25),
  };
  const gates = {
    sourcePageCoverage: material.pages.length === manifest.source.pageCount,
    unitRecall: units.pipelineRecallRate >= thresholds.minimumUnitRecallRate,
    mathMisclassification: subject.misclassificationRate <= thresholds.maximumMathMisclassificationRate,
    reviewWorkload: review.pageRate <= thresholds.maximumReviewPageRate,
  };
  return {
    schemaVersion: PRIVATE_TUTOR_TEXTBOOK_EXPERIMENT_SCHEMA_VERSION,
    experimentId: manifest.id,
    generatedAt,
    source: {
      title: manifest.source.title,
      relativePath: manifest.source.relativePath,
      sha256: manifest.source.sha256,
      pageCount: material.pages.length,
      expectedPageCount: manifest.source.pageCount,
      providerId: material.extraction?.ocr?.providerId ?? null,
      providerVersion: material.extraction?.ocr?.providerVersion ?? null,
      pageSchemaVersion: material.pages[0]?.schemaVersion ?? null,
    },
    metrics: {
      unitRecall: units,
      mathSubjectRouting: subject,
      humanReviewCost: review,
    },
    thresholds,
    gates,
    passed: Object.values(gates).every(Boolean),
  };
}

function evaluateUnits(groundTruth, pages, draft) {
  const modules = Array.isArray(draft?.draftModules) ? draft.draftModules : [];
  const unitAggregationEnabled = draft?.aggregation?.strategy === "textbook_units_v1";
  const rows = groundTruth.map((unit) => {
    const expectedTitle = normalized(unit.title);
    const sourcePage = pages.find((page) => Number(page.pageNumber) === Number(unit.sourcePageNumber));
    const pageText = normalized(sourcePage?.text);
    const ocrTitleMatched = Boolean(expectedTitle && pageText.includes(expectedTitle));
    const matchedModule = unitAggregationEnabled
      ? modules.find((module) => normalized(module.name).includes(expectedTitle))
      : null;
    return {
      unitNumber: unit.unitNumber,
      title: unit.title,
      printedPageNumber: unit.printedPageNumber,
      sourcePageNumber: unit.sourcePageNumber,
      ocrTitleMatched,
      pipelineModuleMatched: Boolean(matchedModule),
      matchedModuleId: matchedModule?.id ?? null,
    };
  });
  const expectedCount = rows.length;
  const ocrMatchedCount = rows.filter((row) => row.ocrTitleMatched).length;
  const pipelineMatchedCount = rows.filter((row) => row.pipelineModuleMatched).length;
  return {
    expectedCount,
    ocrMatchedCount,
    ocrTitleRecallRate: rate(ocrMatchedCount, expectedCount),
    pipelineMatchedCount,
    pipelineRecallRate: rate(pipelineMatchedCount, expectedCount),
    aggregationStrategy: draft?.aggregation?.strategy ?? null,
    generatedModuleCount: modules.length,
    rows,
  };
}

function evaluateSubjects(predictions) {
  const rows = predictions.map((prediction) => {
    const expectedMath = prediction.expectedSubjectId === "math";
    const actualMath = prediction.actualSubjectId === "math" || prediction.evaluationSubjectId === "math";
    return {
      id: prediction.id,
      sourceKind: prediction.sourceKind,
      expectedSubjectId: prediction.expectedSubjectId,
      actualSubjectId: prediction.actualSubjectId,
      evaluationSubjectId: prediction.evaluationSubjectId,
      confidence: prediction.confidence,
      signals: prediction.signals ?? [],
      matched: expectedMath === actualMath,
      errorType: expectedMath === actualMath ? null : expectedMath ? "math_false_negative" : "math_false_positive",
    };
  });
  const falsePositiveCount = rows.filter((row) => row.errorType === "math_false_positive").length;
  const falseNegativeCount = rows.filter((row) => row.errorType === "math_false_negative").length;
  const errorCount = falsePositiveCount + falseNegativeCount;
  return {
    caseCount: rows.length,
    matchedCount: rows.length - errorCount,
    errorCount,
    falsePositiveCount,
    falseNegativeCount,
    misclassificationRate: rate(errorCount, rows.length),
    rows,
  };
}

function evaluateReviewCost(pages, model = {}) {
  const secondsPerPage = Math.max(1, Math.round(Number(model.secondsPerPage) || 90));
  const pending = pages.filter((page) => page.review?.status === "pending");
  const reasonCounts = {};
  const rows = pending.map((page) => {
    const reasons = [...new Set(page.review?.reasons ?? [])].sort();
    for (const reason of reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    return {
      pageNumber: page.pageNumber,
      printedPageNumber: page.printedPageNumber ?? null,
      confidence: page.confidence ?? null,
      reasons,
    };
  });
  const estimatedSeconds = pending.length * secondsPerPage;
  return {
    totalPageCount: pages.length,
    requiredPageCount: pending.length,
    pageRate: rate(pending.length, pages.length),
    secondsPerPageAssumption: secondsPerPage,
    estimatedMinutes: Number((estimatedSeconds / 60).toFixed(1)),
    observedMinutes: null,
    observedStatus: "not_measured",
    reasonCounts,
    rows,
  };
}

function validateInputs(manifest, material) {
  if (manifest?.schemaVersion !== PRIVATE_TUTOR_TEXTBOOK_EXPERIMENT_SCHEMA_VERSION) {
    throw new Error("invalid_private_tutor_textbook_experiment_manifest");
  }
  if (!manifest.source?.relativePath || !Number.isInteger(manifest.source?.pageCount) || manifest.source.pageCount < 1) {
    throw new Error("invalid_private_tutor_textbook_experiment_source");
  }
  if (!Array.isArray(manifest.unitGroundTruth) || manifest.unitGroundTruth.length === 0) {
    throw new Error("invalid_private_tutor_textbook_experiment_units");
  }
  if (!Array.isArray(material?.pages) || material.pages.length === 0) {
    throw new Error("invalid_private_tutor_textbook_experiment_material");
  }
}

function normalized(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function rate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

function boundedRate(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}
