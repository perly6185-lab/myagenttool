import { normalizeSemanticText } from "./authored-rubric.mjs";

const MAX_RESPONSE_LENGTH = 4_000;

export const CONCEPTUAL_RUBRIC_EVALUATOR_VERSION = "anchored-concept-rubric-v2";

export function evaluateAnchoredConceptRubric(rawAnswer, question) {
  const answer = String(rawAnswer ?? "").trim();
  const rubric = question.rubric ?? {};
  if (!answer || answer.length > MAX_RESPONSE_LENGTH) {
    return { accepted: false, error: "invalid_private_tutor_answer_format" };
  }
  if (rubric.profile !== CONCEPTUAL_RUBRIC_EVALUATOR_VERSION || !validRubric(rubric)) {
    return { accepted: false, error: "private_tutor_rubric_unavailable" };
  }

  const normalized = normalizeSemanticText(answer);
  const criteria = rubric.criteria.slice(0, 12).map((criterion) => scoreCriterion(normalized, criterion));
  const requiredSourceRefs = [...new Set((question.requiredSourceRefs ?? rubric.requiredSourceRefs ?? []).map(normalizeSourceRef).filter(Boolean))];
  const citedSourceRefs = extractSourceRefs(answer);
  const missingSourceRefs = requiredSourceRefs.filter((ref) => !citedSourceRefs.includes(ref));
  const knownSourceRefs = new Set((rubric.availableSourceRefs ?? requiredSourceRefs).map(normalizeSourceRef).filter(Boolean));
  const unknownSourceRefs = citedSourceRefs.filter((ref) => !knownSourceRefs.has(ref));
  const sourceWeight = boundedNumber(rubric.sourceWeight, 0.15);
  const contentScore = round(criteria.reduce((total, criterion) => total + criterion.awardedWeight, 0));
  const sourceScore = missingSourceRefs.length ? 0 : sourceWeight;
  const score = round(Math.min(1, contentScore + sourceScore));
  const scoreBand = bandForScore(score, rubric.bands);
  const passBand = rubric.passBand ?? "proficient";
  const correct = scoreBand === passBand && missingSourceRefs.length === 0 && unknownSourceRefs.length === 0;
  const reviewThreshold = boundedNumber(rubric.reviewThreshold, 0.75);
  const contentMaximum = round(rubric.criteria.reduce((total, criterion) => total + boundedNumber(criterion.weight, 0), 0));
  const contentComplete = criteria.every((criterion) => criterion.level === "full");
  const sourceReviewRequired = !correct && contentComplete && missingSourceRefs.length > 0;
  const unknownSourceReviewRequired = unknownSourceRefs.length > 0;
  const boundaryReviewRequired = !correct && score >= reviewThreshold;
  const requiresReview = sourceReviewRequired || unknownSourceReviewRequired || boundaryReviewRequired;
  const anchor = (rubric.anchors ?? []).find((item) => item.band === scoreBand) ?? null;
  const reason = correct
    ? "anchored_rubric_proficient"
    : requiresReview ? "anchored_rubric_review_required"
      : "anchored_rubric_incomplete";

  return {
    accepted: true,
    correct,
    responseKind: "answer",
    normalizedAnswer: answer.slice(0, MAX_RESPONSE_LENGTH),
    reason,
    evidenceEligible: correct,
    evidenceTier: correct ? "rubric_anchored" : "practice_only",
    confidence: correct ? 1 : requiresReview ? 0.75 : 1,
    evaluation: {
      profile: CONCEPTUAL_RUBRIC_EVALUATOR_VERSION,
      score,
      scoreBand,
      anchorId: anchor?.id ?? null,
      anchorDescription: anchor?.description ?? null,
      contentScore,
      contentMaximum,
      sourceScore,
      criteria,
      citedSourceRefs,
      missingSourceRefs,
      unknownSourceRefs,
      reviewReason: unknownSourceReviewRequired
        ? "unknown_source_reference"
        : sourceReviewRequired ? "missing_required_source"
          : boundaryReviewRequired ? "score_near_proficiency_boundary" : null,
      requiresReview,
      explanation: feedback({ correct, requiresReview, sourceReviewRequired, criteria, missingSourceRefs, unknownSourceRefs }),
    },
  };
}

function scoreCriterion(normalized, criterion) {
  const fullPhrase = firstMatch(normalized, criterion.acceptedPhrases);
  const partialPhrase = fullPhrase ? null : firstMatch(normalized, criterion.partialPhrases);
  const level = fullPhrase ? "full" : partialPhrase ? "partial" : "missing";
  const weight = boundedNumber(criterion.weight, 0);
  const partialCredit = boundedNumber(criterion.partialCredit, 0.5);
  return {
    id: criterion.id,
    label: criterion.label,
    level,
    weight,
    awardedWeight: round(level === "full" ? weight : level === "partial" ? weight * partialCredit : 0),
    matchedPhrase: fullPhrase ?? partialPhrase,
    sourceRef: criterion.sourceRef ?? null,
  };
}

function firstMatch(normalized, phrases = []) {
  return phrases.map(normalizeSemanticText).filter(Boolean).find((phrase) => normalized.includes(phrase)) ?? null;
}

function bandForScore(score, bands) {
  const configured = Array.isArray(bands)
    ? bands.filter((band) => Number.isFinite(Number(band.minScore))).toSorted((left, right) => Number(left.minScore) - Number(right.minScore))
    : [];
  return configured.filter((band) => score >= Number(band.minScore)).at(-1)?.id ?? "unscored";
}

function validRubric(rubric) {
  if (!Array.isArray(rubric.criteria) || !rubric.criteria.length || rubric.criteria.length > 12) return false;
  if (!Array.isArray(rubric.bands) || !rubric.bands.length || !rubric.bands.some((band) => band.id === rubric.passBand)) return false;
  if (!Array.isArray(rubric.anchors) || rubric.bands.some((band) => !rubric.anchors.some((anchor) => anchor.band === band.id && anchor.id))) return false;
  if (boundedNumber(rubric.sourceWeight, 0.15) > 0 && !(rubric.requiredSourceRefs?.length > 0)) return false;
  const contentMaximum = rubric.criteria.reduce((total, criterion) => total + boundedNumber(criterion.weight, 0), 0);
  return contentMaximum > 0 && contentMaximum + boundedNumber(rubric.sourceWeight, 0.15) <= 1.0001;
}

function feedback({ correct, requiresReview, sourceReviewRequired, criteria, missingSourceRefs, unknownSourceRefs }) {
  if (correct) return "概念、机制、应用和来源都达到熟练锚点。";
  if (unknownSourceRefs.length) return `来源标记 ${unknownSourceRefs.join("、")} 不在本题可核对范围内。`;
  if (sourceReviewRequired) return `内容已接近熟练锚点，但还需要补充可核对来源：${missingSourceRefs.join("、")}。`;
  const missing = criteria.filter((criterion) => criterion.level !== "full").map((criterion) => criterion.label);
  if (requiresReview) return `回答接近熟练锚点，建议复核：${missing.join("、")}。`;
  return `继续补充：${missing.join("、") || "完整的概念解释"}。`;
}

function extractSourceRefs(value) {
  return [...String(value).matchAll(/\[ref:([a-z0-9._-]{1,80})\]/gi)]
    .map((match) => match[1].toLowerCase())
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, 20);
}

function normalizeSourceRef(value) {
  return String(value ?? "").trim().toLowerCase();
}

function boundedNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback;
}

function round(value) {
  return Number(Number(value).toFixed(4));
}
