import { createHash } from "node:crypto";

export const PRIVATE_TUTOR_TEXTBOOK_HUMAN_REVIEW_SCHEMA_VERSION = "private-tutor-textbook-human-review-v1";

const TRIGGER_DECISIONS = new Set(["valid_trigger", "false_trigger", "mixed", "uncertain"]);
const FALSE_TRIGGER_REASONS = new Set([
  "decorative_or_nonsemantic_block",
  "blank_or_back_matter",
  "formula_not_requiring_structure",
  "layout_only_math",
  "confidence_too_conservative",
  "other",
]);

export function createPrivateTutorTextbookHumanReviewRecord({ task, input, now = new Date().toISOString() } = {}) {
  if (!task || !Number.isInteger(Number(task.pageNumber))) throw new Error("invalid_textbook_review_task");
  const triggerDecision = String(input?.triggerDecision ?? "");
  if (!TRIGGER_DECISIONS.has(triggerDecision)) throw new Error("invalid_textbook_review_trigger_decision");
  const durationSeconds = Math.round(Number(input?.durationSeconds));
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 7_200) {
    throw new Error("invalid_textbook_review_duration");
  }
  if (input?.reviewerAttestation !== true) throw new Error("textbook_review_attestation_required");
  const correctedText = boundedText(input.correctedText, 500_000).trim();
  if (!correctedText) throw new Error("invalid_textbook_review_text");
  const originalText = String(task.text ?? "").trim();
  const originalPrintedPageNumber = String(task.printedPageNumber ?? "").trim();
  const correctedPrintedPageNumber = boundedText(input.correctedPrintedPageNumber, 40).trim();
  const falseTriggerReasons = [...new Set(Array.isArray(input.falseTriggerReasons) ? input.falseTriggerReasons : [])]
    .filter((reason) => FALSE_TRIGGER_REASONS.has(reason)).sort();
  if (["false_trigger", "mixed"].includes(triggerDecision) && falseTriggerReasons.length === 0) {
    throw new Error("textbook_review_false_trigger_reason_required");
  }
  return {
    schemaVersion: PRIVATE_TUTOR_TEXTBOOK_HUMAN_REVIEW_SCHEMA_VERSION,
    pageNumber: Number(task.pageNumber),
    printedPageNumber: originalPrintedPageNumber || null,
    initialReasons: [...new Set(task.reasons ?? [])].sort(),
    initialConfidence: Number.isFinite(Number(task.confidence)) ? Number(task.confidence) : null,
    sessionId: boundedText(input.sessionId, 120).trim() || null,
    startedAt: validIso(input.startedAt) ? new Date(input.startedAt).toISOString() : null,
    completedAt: now,
    durationSeconds,
    triggerDecision,
    falseTriggerReasons,
    note: boundedText(input.note, 500).trim(),
    textEdited: correctedText !== originalText,
    printedPageNumberEdited: correctedPrintedPageNumber !== originalPrintedPageNumber,
    originalTextHash: sha256(originalText),
    correctedTextHash: sha256(correctedText),
    changedCharacterEstimate: changedCharacterEstimate(originalText, correctedText),
    reviewerAttestation: true,
  };
}

export function evaluatePrivateTutorTextbookHumanReviews({ targets = [], reviews = [] } = {}) {
  const targetRows = targets.map((target) => ({
    pageNumber: Number(target.pageNumber),
    printedPageNumber: target.printedPageNumber ?? null,
    reasons: [...new Set(target.reasons ?? [])].sort(),
    confidence: Number.isFinite(Number(target.confidence)) ? Number(target.confidence) : null,
  })).filter((target) => Number.isInteger(target.pageNumber));
  const targetNumbers = new Set(targetRows.map((target) => target.pageNumber));
  const byPage = new Map();
  for (const review of reviews) {
    if (review?.schemaVersion !== PRIVATE_TUTOR_TEXTBOOK_HUMAN_REVIEW_SCHEMA_VERSION) continue;
    const pageNumber = Number(review.pageNumber);
    if (targetNumbers.has(pageNumber)) byPage.set(pageNumber, review);
  }
  const rows = targetRows.map((target) => ({ ...target, review: byPage.get(target.pageNumber) ?? null }));
  const reviewed = rows.filter((row) => row.review);
  const modified = reviewed.filter((row) => row.review.textEdited || row.review.printedPageNumberEdited);
  const falseTriggers = reviewed.filter((row) => row.review.triggerDecision === "false_trigger");
  const mixedTriggers = reviewed.filter((row) => row.review.triggerDecision === "mixed");
  const durations = reviewed.map((row) => Number(row.review.durationSeconds)).filter(Number.isFinite).sort((a, b) => a - b);
  const reasonBreakdown = reasonBreakdownFor(rows);
  const falseTriggerReasonCounts = {};
  for (const row of reviewed) {
    for (const reason of row.review.falseTriggerReasons ?? []) {
      falseTriggerReasonCounts[reason] = (falseTriggerReasonCounts[reason] ?? 0) + 1;
    }
  }
  const lowConfidenceRows = rows.filter((row) => row.reasons.some((reason) => ["low_page_confidence", "low_block_confidence"].includes(reason)));
  const reviewedLowConfidence = lowConfidenceRows.filter((row) => row.review);
  const lowConfidenceFalseOrMixed = reviewedLowConfidence.filter((row) => ["false_trigger", "mixed"].includes(row.review.triggerDecision));
  const lowConfidenceModified = reviewedLowConfidence.filter((row) => row.review.textEdited || row.review.printedPageNumberEdited);
  const lowConfidenceMetrics = {
    targetPageCount: lowConfidenceRows.length,
    reviewedPageCount: reviewedLowConfidence.length,
    completionRate: rate(reviewedLowConfidence.length, lowConfidenceRows.length),
    falseOrMixedTriggerCount: lowConfidenceFalseOrMixed.length,
    falseOrMixedTriggerRate: rate(lowConfidenceFalseOrMixed.length, reviewedLowConfidence.length),
    modifiedPageCount: lowConfidenceModified.length,
    modificationRate: rate(lowConfidenceModified.length, reviewedLowConfidence.length),
  };
  const recommendation = thresholdRecommendation(lowConfidenceMetrics);
  return {
    schemaVersion: PRIVATE_TUTOR_TEXTBOOK_HUMAN_REVIEW_SCHEMA_VERSION,
    targetPageCount: rows.length,
    reviewedPageCount: reviewed.length,
    remainingPageCount: rows.length - reviewed.length,
    completionRate: rate(reviewed.length, rows.length),
    modifiedPageCount: modified.length,
    modificationRate: rate(modified.length, reviewed.length),
    textModifiedPageCount: reviewed.filter((row) => row.review.textEdited).length,
    printedPageNumberModifiedCount: reviewed.filter((row) => row.review.printedPageNumberEdited).length,
    falseTriggerPageCount: falseTriggers.length,
    falseTriggerRate: rate(falseTriggers.length, reviewed.length),
    mixedTriggerPageCount: mixedTriggers.length,
    observedSeconds: durations.reduce((sum, value) => sum + value, 0),
    observedMinutes: Number((durations.reduce((sum, value) => sum + value, 0) / 60).toFixed(1)),
    medianSecondsPerPage: percentile(durations, 0.5),
    p90SecondsPerPage: percentile(durations, 0.9),
    reasonBreakdown,
    falseTriggerReasonCounts,
    lowConfidenceMetrics,
    thresholdRecommendation: recommendation,
    rows: rows.map((row) => ({
      pageNumber: row.pageNumber,
      printedPageNumber: row.printedPageNumber,
      reasons: row.reasons,
      confidence: row.confidence,
      reviewed: Boolean(row.review),
      ...(row.review ? {
        durationSeconds: row.review.durationSeconds,
        triggerDecision: row.review.triggerDecision,
        falseTriggerReasons: row.review.falseTriggerReasons,
        textEdited: row.review.textEdited,
        printedPageNumberEdited: row.review.printedPageNumberEdited,
        changedCharacterEstimate: row.review.changedCharacterEstimate,
        completedAt: row.review.completedAt,
      } : {}),
    })),
  };
}

function thresholdRecommendation(metrics) {
  if (metrics.reviewedPageCount < metrics.targetPageCount) {
    return {
      decision: "insufficient_human_review",
      changeGlobalThreshold: false,
      rationale: `仍有 ${metrics.targetPageCount - metrics.reviewedPageCount} 个低置信度触发页未完成真人复核。`,
    };
  }
  if (metrics.reviewedPageCount < 10) {
    return {
      decision: "insufficient_low_confidence_sample",
      changeGlobalThreshold: false,
      rationale: "低置信度真人样本少于 10 页，暂不调整全局门槛。",
    };
  }
  if (metrics.falseOrMixedTriggerRate >= 0.7 && metrics.modificationRate <= 0.1) {
    return {
      decision: "consider_reason_specific_tuning",
      changeGlobalThreshold: false,
      rationale: "误触发比例较高但实际修改较少；优先按块类型或误触发原因收窄规则，不直接下调全局置信度门槛。",
    };
  }
  return {
    decision: "retain_current_threshold",
    changeGlobalThreshold: false,
    rationale: "当前真人修改率或有效触发比例不支持放宽低置信度门槛。",
  };
}

function reasonBreakdownFor(rows) {
  const result = {};
  for (const row of rows) {
    for (const reason of row.reasons) {
      result[reason] ??= { targetPageCount: 0, reviewedPageCount: 0, modifiedPageCount: 0, falseTriggerPageCount: 0, mixedTriggerPageCount: 0 };
      const bucket = result[reason];
      bucket.targetPageCount += 1;
      if (!row.review) continue;
      bucket.reviewedPageCount += 1;
      if (row.review.textEdited || row.review.printedPageNumberEdited) bucket.modifiedPageCount += 1;
      if (row.review.triggerDecision === "false_trigger") bucket.falseTriggerPageCount += 1;
      if (row.review.triggerDecision === "mixed") bucket.mixedTriggerPageCount += 1;
    }
  }
  for (const bucket of Object.values(result)) {
    bucket.modificationRate = rate(bucket.modifiedPageCount, bucket.reviewedPageCount);
    bucket.falseTriggerRate = rate(bucket.falseTriggerPageCount, bucket.reviewedPageCount);
  }
  return result;
}

function changedCharacterEstimate(before, after) {
  if (before === after) return 0;
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  return Math.max(before.length - prefix - suffix, after.length - prefix - suffix);
}

function percentile(sorted, quantile) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
}

function boundedText(value, max) {
  return String(value ?? "").replaceAll("\0", "").slice(0, max);
}

function validIso(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function rate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}
