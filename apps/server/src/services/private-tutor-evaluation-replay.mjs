import { mathLinearStepsGoldenCases, MATH_LINEAR_STEPS_GOLDEN_SET_VERSION } from "./evaluation-sets/math-linear-steps-v2.mjs";
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

function expectedResultMatches(result, expected, actualClassification) {
  for (const key of ["accepted", "correct", "evidenceEligible", "reason"]) {
    if (expected[key] !== undefined && result?.[key] !== expected[key]) return false;
  }
  return expected.firstIncorrectClassification === undefined
    || expected.firstIncorrectClassification === actualClassification;
}

function firstIncorrectClassification(result) {
  const index = result?.evaluation?.firstIncorrectStep;
  return Number.isInteger(index) ? result.evaluation.steps?.[index]?.classification ?? null : null;
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}
