import {
  privateTutorDoubleAnnotationCases,
  PRIVATE_TUTOR_DOUBLE_ANNOTATION_PROTOCOL,
  PRIVATE_TUTOR_DOUBLE_ANNOTATION_SET_VERSION,
} from "./evaluation-sets/private-tutor-double-annotation-v1.mjs";
import { runPrivateTutorEvaluationReplay } from "./private-tutor-evaluation-replay.mjs";
import { conceptualSubjectPlugin } from "./plugins/conceptual-plugin.mjs";
import { languageSubjectPlugin } from "./plugins/language-plugin.mjs";

export function runPrivateTutorDoubleAnnotationEvaluation({ cases = privateTutorDoubleAnnotationCases } = {}) {
  const normalized = cases.map((fixture) => ({
    ...fixture,
    expected: Object.fromEntries(Object.entries(fixture.adjudication).filter(([, value]) => value !== null)),
  }));
  const replay = runPrivateTutorEvaluationReplay({
    cases: normalized,
    setVersion: PRIVATE_TUTOR_DOUBLE_ANNOTATION_SET_VERSION,
    evaluate: (fixture) => evaluatorFor(fixture.subject).evaluator(fixture.input, fixture.question),
  });
  const complete = cases.filter(hasCompleteIndependentAnnotation);
  const exactAgreements = complete.filter((fixture) => fixture.annotations[0].correct === fixture.annotations[1].correct);
  const scored = complete.filter((fixture) => fixture.annotations.every((annotation) => annotation.scoreBand));
  const scoreBandAgreements = scored.filter((fixture) => fixture.annotations[0].scoreBand === fixture.annotations[1].scoreBand);
  const adjudicated = complete.filter((fixture) => validAdjudication(fixture.adjudication));
  return {
    ...replay,
    protocol: PRIVATE_TUTOR_DOUBLE_ANNOTATION_PROTOCOL,
    doubleAnnotatedCount: complete.length,
    exactAgreementCount: exactAgreements.length,
    exactAgreementRate: ratio(exactAgreements.length, complete.length),
    interRaterKappa: cohenKappa(complete),
    scoreBandAgreementCount: scoreBandAgreements.length,
    scoreBandAgreementRate: ratio(scoreBandAgreements.length, scored.length),
    adjudicatedCount: adjudicated.length,
    adjudicationCompletionRate: ratio(adjudicated.length, cases.length),
    adjudicatedEvaluatorAgreementRate: replay.passRate,
    passed: replay.passed && complete.length === cases.length && adjudicated.length === cases.length,
  };
}

function evaluatorFor(subject) {
  if (subject === "language") return languageSubjectPlugin;
  if (subject === "conceptual") return conceptualSubjectPlugin;
  throw new Error("unsupported_double_annotation_subject");
}

function hasCompleteIndependentAnnotation(fixture) {
  return Array.isArray(fixture.annotations)
    && fixture.annotations.length === 2
    && fixture.annotations.every((annotation) => annotation.annotatorId && typeof annotation.correct === "boolean")
    && fixture.annotations[0].annotatorId !== fixture.annotations[1].annotatorId;
}

function validAdjudication(value) {
  return Boolean(value?.adjudicatorId)
    && typeof value.correct === "boolean"
    && typeof value.evidenceEligible === "boolean"
    && typeof value.requiresReview === "boolean"
    && Boolean(value.reason);
}

function cohenKappa(cases) {
  if (!cases.length) return 0;
  const observed = cases.filter((fixture) => fixture.annotations[0].correct === fixture.annotations[1].correct).length / cases.length;
  const firstPositive = cases.filter((fixture) => fixture.annotations[0].correct).length / cases.length;
  const secondPositive = cases.filter((fixture) => fixture.annotations[1].correct).length / cases.length;
  const expected = firstPositive * secondPositive + (1 - firstPositive) * (1 - secondPositive);
  return expected === 1 ? 1 : Number(((observed - expected) / (1 - expected)).toFixed(4));
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}
