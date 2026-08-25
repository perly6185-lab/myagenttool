import { evaluateIntentUnderstanding } from "../../apps/server/src/services/intent-understanding-evaluation.mjs";

const evaluation = evaluateIntentUnderstanding();
console.log(`Intent evaluation: ${evaluation.passed}/${evaluation.total} passed`);
console.log(`Task-boundary accuracy: ${(evaluation.metrics.taskBoundaryAccuracy * 100).toFixed(1)}%`);
console.log(`Unintended-task rate: ${(evaluation.metrics.unintendedTaskRate * 100).toFixed(1)}%`);
console.log(`Clarification accuracy: ${(evaluation.metrics.clarificationAccuracy * 100).toFixed(1)}%`);
console.log(`Natural-expression accuracy: ${(evaluation.metrics.naturalExpressionAccuracy * 100).toFixed(1)}%`);
for (const result of evaluation.failed) {
  console.error(`${result.id}: expected ${JSON.stringify(result.expectedKinds)}, got ${JSON.stringify(result.actualKinds)}; clarification=${result.clarification ?? "none"}; errors=${result.contractErrors.join(",") || "none"}`);
}
process.exitCode = evaluation.failed.length ? 1 : 0;
