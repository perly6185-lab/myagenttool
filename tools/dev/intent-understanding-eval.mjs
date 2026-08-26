import { evaluateIntentUnderstanding } from "../../apps/server/src/services/intent-understanding-evaluation.mjs";

const evaluation = evaluateIntentUnderstanding();
console.log(`Intent evaluation: ${evaluation.passed}/${evaluation.total} passed`);
console.log(`Task-boundary accuracy: ${(evaluation.metrics.taskBoundaryAccuracy * 100).toFixed(1)}%`);
console.log(`Unintended-task rate: ${(evaluation.metrics.unintendedTaskRate * 100).toFixed(1)}%`);
console.log(`Clarification accuracy: ${(evaluation.metrics.clarificationAccuracy * 100).toFixed(1)}%`);
console.log(`Natural-expression accuracy: ${(evaluation.metrics.naturalExpressionAccuracy * 100).toFixed(1)}%`);
console.log(`Professional natural-language accuracy: ${(evaluation.metrics.professionalNaturalAccuracy * 100).toFixed(1)}%`);
console.log(`Professional boundary accuracy: ${(evaluation.metrics.professionalBoundaryAccuracy * 100).toFixed(1)}%`);
console.log(`Professional existing-result accuracy: ${(evaluation.metrics.professionalExistingAccuracy * 100).toFixed(1)}%`);
console.log(`Multi-instance accuracy: ${(evaluation.metrics.multiInstanceAccuracy * 100).toFixed(1)}%`);
console.log(`Publishing-safety accuracy: ${(evaluation.metrics.publishingSafetyAccuracy * 100).toFixed(1)}%`);
console.log(`Forbidden-task rate: ${(evaluation.metrics.harmfulForbiddenTaskRate * 100).toFixed(1)}%`);
for (const result of evaluation.failed) {
  console.error(`${result.id}: expected ${JSON.stringify(result.expectedKinds)}, got ${JSON.stringify(result.actualKinds)}; clarification=${result.clarification ?? "none"}; errors=${result.contractErrors.join(",") || "none"}`);
}
process.exitCode = evaluation.failed.length ? 1 : 0;
