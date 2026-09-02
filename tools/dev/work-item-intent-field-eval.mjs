import { evaluateWorkItemIntentFields } from "../../apps/server/src/services/work-item-intent-evaluation.mjs";

const evaluation = evaluateWorkItemIntentFields();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(evaluation, null, 2));
} else {
  const percent = (value) => `${(value * 100).toFixed(1)}%`;
  console.log(`Work-item intent field evaluation: ${evaluation.passed}/${evaluation.total} exact cases passed`);
  console.log(`Dataset: ${evaluation.datasetId}@${evaluation.datasetVersion} (${evaluation.datasetDigest ?? "invalid"})`);
  console.log(`Goal accuracy: ${percent(evaluation.metrics.fieldAccuracy.goal)}`);
  console.log(`Action accuracy: ${percent(evaluation.metrics.fieldAccuracy.action)}`);
  console.log(`Materials accuracy: ${percent(evaluation.metrics.fieldAccuracy.materials)}`);
  console.log(`Output accuracy: ${percent(evaluation.metrics.fieldAccuracy.output)}`);
  console.log(`Delivery accuracy: ${percent(evaluation.metrics.fieldAccuracy.delivery)}`);
  console.log(`Macro field accuracy: ${percent(evaluation.metrics.macroFieldAccuracy)}`);
  console.log(`Unsafe action expansion rate: ${percent(evaluation.metrics.unsafeActionExpansionRate)}`);
  for (const result of evaluation.failed) {
    for (const field of result.failedFields) {
      console.error(`${result.id}.${field}: mismatch at ${result.fields[field].mismatchPaths.join(", ")}`);
    }
  }
  for (const failure of evaluation.gateFailures) console.error(`gate: ${failure}`);
}
process.exitCode = evaluation.releaseReady ? 0 : 1;
