import { conceptualAnchoredRubricGoldenCases, CONCEPTUAL_ANCHORED_RUBRIC_GOLDEN_SET_VERSION } from "./evaluation-sets/conceptual-anchored-rubric-v2.mjs";
import { mathLinearStepsGoldenCases, MATH_LINEAR_STEPS_GOLDEN_SET_VERSION } from "./evaluation-sets/math-linear-steps-v2.mjs";
import { languageCausalSemanticGoldenCases, LANGUAGE_CAUSAL_SEMANTIC_GOLDEN_SET_VERSION } from "./evaluation-sets/language-causal-semantic-v2.mjs";
import { conceptualSubjectPlugin } from "./plugins/conceptual-plugin.mjs";
import { languageSubjectPlugin } from "./plugins/language-plugin.mjs";
import { mathSubjectPlugin } from "./plugins/math-plugin.mjs";

export function runPrivateTutorEvaluationReplay({ cases, evaluate, setVersion = "unversioned" }) {
  const rows = cases.map((fixture) => {
    let result;
    try {
      result = evaluate(fixture);
    } catch (error) {
      result = { accepted: false, error: "evaluation_replay_threw", detail: error instanceof Error ? error.message : String(error) };
    }
    const actualClassification = firstIncorrectClassification(result);
    const expectedMatched = expectedResultMatches(result, fixture.expected, actualClassification);
    return {
      id: fixture.id,
      expectedMatched,
      expectedCorrect: fixture.expected.correct,
      actualCorrect: result?.correct === true,
      expectedEvidenceEligible: fixture.expected.evidenceEligible,
      actualEvidenceEligible: result?.evidenceEligible !== false,
      expectedClassification: fixture.expected.firstIncorrectClassification ?? null,
      actualClassification,
      expectedSemanticStatus: fixture.expected.semanticStatus ?? null,
      actualSemanticStatus: result?.evaluation?.semanticStatus ?? null,
      expectedScoreBand: fixture.expected.scoreBand ?? null,
      actualScoreBand: result?.evaluation?.scoreBand ?? null,
      expectedAnchorId: fixture.expected.anchorId ?? null,
      actualAnchorId: result?.evaluation?.anchorId ?? null,
      expectedScore: fixture.expected.score ?? null,
      actualScore: result?.evaluation?.score ?? null,
      actualConfidence: result?.evaluation?.confidence ?? result?.confidence ?? null,
      actualRequiresReview: result?.evaluation?.requiresReview === true,
      reason: result?.reason ?? result?.error ?? "missing_result",
    };
  });
  const falsePositiveCount = rows.filter((row) => row.expectedCorrect === false && row.actualCorrect).length;
  const falseNegativeCount = rows.filter((row) => row.expectedCorrect === true && !row.actualCorrect).length;
  const evidenceLeakCount = rows.filter((row) => row.expectedEvidenceEligible === false && row.actualEvidenceEligible).length;
  const matchedCount = rows.filter((row) => row.expectedMatched).length;
  return {
    setVersion,
    total: rows.length,
    matchedCount,
    passRate: ratio(matchedCount, rows.length),
    falsePositiveCount,
    falsePositiveRate: ratio(falsePositiveCount, rows.filter((row) => row.expectedCorrect === false).length),
    falseNegativeCount,
    falseNegativeRate: ratio(falseNegativeCount, rows.filter((row) => row.expectedCorrect === true).length),
    evidenceLeakCount,
    passed: matchedCount === rows.length && falsePositiveCount === 0 && evidenceLeakCount === 0,
    failed: rows.filter((row) => !row.expectedMatched),
    rows,
  };
}

export function runMathLinearStepsGoldenReplay() {
  return runPrivateTutorEvaluationReplay({
    cases: mathLinearStepsGoldenCases,
    setVersion: MATH_LINEAR_STEPS_GOLDEN_SET_VERSION,
    evaluate: (fixture) => mathSubjectPlugin.evaluator({ rawAnswer: fixture.answer, responseKind: "answer", source: "screen" }, fixture.question),
  });
}

export function runLanguageCausalSemanticGoldenReplay() {
  return runPrivateTutorEvaluationReplay({
    cases: languageCausalSemanticGoldenCases,
    setVersion: LANGUAGE_CAUSAL_SEMANTIC_GOLDEN_SET_VERSION,
    evaluate: (fixture) => languageSubjectPlugin.evaluator(fixture.input, fixture.question),
  });
}

export function runConceptualAnchoredRubricGoldenReplay() {
  return runPrivateTutorEvaluationReplay({
    cases: conceptualAnchoredRubricGoldenCases,
    setVersion: CONCEPTUAL_ANCHORED_RUBRIC_GOLDEN_SET_VERSION,
    evaluate: evaluateConceptualFixture,
  });
}

export function runConceptualRubricConsistencyReplay() {
  const replay = runConceptualAnchoredRubricGoldenReplay();
  const repeated = conceptualAnchoredRubricGoldenCases.map((fixture) => {
    const first = evaluateConceptualFixture(fixture);
    const second = evaluateConceptualFixture(fixture);
    return stableConceptDecision(first) === stableConceptDecision(second);
  });
  const anchorAgreementCount = replay.rows.filter((row) => row.expectedScoreBand === row.actualScoreBand && row.expectedAnchorId === row.actualAnchorId).length;
  const repeatableCount = repeated.filter(Boolean).length;
  const anchorAgreementRate = ratio(anchorAgreementCount, replay.total);
  const repeatabilityRate = ratio(repeatableCount, repeated.length);
  return {
    ...replay,
    anchorAgreementCount,
    anchorAgreementRate,
    repeatableCount,
    repeatabilityRate,
    passed: replay.passed && anchorAgreementRate === 1 && repeatabilityRate === 1,
  };
}

function expectedResultMatches(result, expected, actualClassification) {
  for (const key of ["accepted", "correct", "evidenceEligible", "reason"]) {
    if (expected[key] !== undefined && result?.[key] !== expected[key]) return false;
  }
  if (expected.firstIncorrectClassification !== undefined && expected.firstIncorrectClassification !== actualClassification) return false;
  if (expected.semanticStatus !== undefined && expected.semanticStatus !== result?.evaluation?.semanticStatus) return false;
  if (expected.scoreBand !== undefined && expected.scoreBand !== result?.evaluation?.scoreBand) return false;
  if (expected.anchorId !== undefined && expected.anchorId !== result?.evaluation?.anchorId) return false;
  if (expected.score !== undefined) {
    const actualScore = Number(result?.evaluation?.score);
    if (!Number.isFinite(actualScore) || Math.abs(expected.score - actualScore) > 0.0001) return false;
  }
  if (expected.reviewReason !== undefined && expected.reviewReason !== (result?.evaluation?.reviewReason ?? null)) return false;
  if (expected.requiresReview !== undefined && expected.requiresReview !== (result?.evaluation?.requiresReview === true)) return false;
  const confidence = result?.evaluation?.confidence ?? result?.confidence;
  if (expected.confidenceAtLeast !== undefined && !(confidence >= expected.confidenceAtLeast)) return false;
  if (expected.confidenceAtMost !== undefined && !(confidence <= expected.confidenceAtMost)) return false;
  return true;
}

function evaluateConceptualFixture(fixture) {
  return conceptualSubjectPlugin.evaluator(fixture.input, fixture.question);
}

function stableConceptDecision(result) {
  return JSON.stringify({
    accepted: result?.accepted,
    correct: result?.correct,
    evidenceEligible: result?.evidenceEligible,
    reason: result?.reason,
    score: result?.evaluation?.score,
    scoreBand: result?.evaluation?.scoreBand,
    anchorId: result?.evaluation?.anchorId,
    reviewReason: result?.evaluation?.reviewReason,
    requiresReview: result?.evaluation?.requiresReview,
  });
}

function firstIncorrectClassification(result) {
  const index = result?.evaluation?.firstIncorrectStep;
  return Number.isInteger(index) ? result.evaluation.steps?.[index]?.classification ?? null : null;
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}
