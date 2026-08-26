import { runConceptualRubricConsistencyReplay, runLanguageCausalSemanticGoldenReplay, runMathLinearStepsGoldenReplay } from "../../apps/server/src/services/private-tutor-evaluation-replay.mjs";

const evaluations = [
  ["math-step", runMathLinearStepsGoldenReplay()],
  ["language-semantic", runLanguageCausalSemanticGoldenReplay()],
  ["conceptual-rubric", runConceptualRubricConsistencyReplay()],
];
for (const [name, evaluation] of evaluations) {
  console.log(`Private tutor ${name} eval ${evaluation.setVersion}: ${evaluation.matchedCount}/${evaluation.total} matched`);
  console.log(`False positives: ${evaluation.falsePositiveCount}; false negatives: ${evaluation.falseNegativeCount}; evidence leaks: ${evaluation.evidenceLeakCount}`);
  if (evaluation.anchorAgreementRate !== undefined) {
    console.log(`Anchor agreement: ${evaluation.anchorAgreementRate}; repeatability: ${evaluation.repeatabilityRate}`);
  }
  for (const failure of evaluation.failed) {
    console.error(`- ${failure.id}: ${failure.reason} (${failure.actualClassification ?? failure.actualSemanticStatus ?? "no classification"})`);
  }
}
process.exitCode = evaluations.every(([, evaluation]) => evaluation.passed) ? 0 : 1;
