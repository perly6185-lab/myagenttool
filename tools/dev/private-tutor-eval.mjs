import { runMathLinearStepsGoldenReplay } from "../../apps/server/src/services/private-tutor-evaluation-replay.mjs";

const evaluation = runMathLinearStepsGoldenReplay();
console.log(`Private tutor math-step eval ${evaluation.setVersion}: ${evaluation.matchedCount}/${evaluation.total} matched`);
console.log(`False positives: ${evaluation.falsePositiveCount}; false negatives: ${evaluation.falseNegativeCount}; evidence leaks: ${evaluation.evidenceLeakCount}`);
for (const failure of evaluation.failed) console.error(`- ${failure.id}: ${failure.reason} (${failure.actualClassification ?? "no classification"})`);
process.exitCode = evaluation.passed ? 0 : 1;
