import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildChannelIntentReplayCases,
  channelIntentLearningSummary,
} from "../../apps/server/src/services/channel-intent-learning.mjs";
import { evaluateChannelIntentReplayCases } from "../../apps/server/src/services/channel-intent-replay-evaluation.mjs";

const defaultBaselinePath = fileURLToPath(new URL("./fixtures/channel-intent-replay-baseline.json", import.meta.url));
const inputPath = process.argv.slice(2).find((value) => !value.startsWith("--")) ?? defaultBaselinePath;
const jsonOutput = process.argv.includes("--json");

try {
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  const samples = input.channelIntentLearningSamples
    ?? input.state?.channelIntentLearningSamples
    ?? null;
  const replayCases = Array.isArray(input.cases)
    ? input.cases
    : Array.isArray(input.replayCases) ? input.replayCases : buildChannelIntentReplayCases(samples ?? []);
  const evaluation = evaluateChannelIntentReplayCases(replayCases);
  const output = {
    schemaVersion: 1,
    generatedFrom: samples ? "redacted_reviewed_channel_samples" : input.source ?? "replay_cases",
    inputPath,
    ...(samples ? { learningSummary: channelIntentLearningSummary(samples) } : {}),
    evaluation,
  };
  if (jsonOutput) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    const percent = (value) => value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
    console.log(`Channel intent replay: ${evaluation.passed}/${evaluation.evaluated} evaluable cases passed (${evaluation.skipped} skipped)`);
    console.log(`Task-boundary accuracy: ${percent(evaluation.metrics.taskBoundaryAccuracy)}`);
    console.log(`Unintended-task rate: ${percent(evaluation.metrics.unintendedTaskRate)}`);
    console.log(`Clarification accuracy: ${percent(evaluation.metrics.clarificationAccuracy)}`);
    for (const result of evaluation.failed) {
      console.error(`${result.id}: expected ${JSON.stringify(result.expectedKinds)}, got ${JSON.stringify(result.actualKinds)}; clarification=${result.actualClarification ?? "none"}; errors=${result.contractErrors.join(",") || "none"}`);
    }
  }
  process.exitCode = evaluation.failed.length ? 1 : 0;
} catch (error) {
  console.error(`Unable to replay Channel intent samples: ${String(error?.message ?? error)}`);
  process.exitCode = 1;
}
