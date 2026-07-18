import { performance } from "node:perf_hooks";
import { computeInvocationDispatchHealth } from "../../apps/server/src/read-models/invocation-dispatch-health.mjs";

const queuedCount = positiveInt(process.env.RUNTIME_HEALTH_QUEUED, 20_000);
const settledCount = positiveInt(process.env.RUNTIME_HEALTH_SETTLED, 5_000);
const agent = { id: "agt_bench", name: "Benchmark", location: { type: "local_device", deviceId: "dev_bench" }, adapter: { type: "cli" }, health: { status: "healthy" } };
const createdAt = "2026-07-18T00:00:00.000Z";
const invocations = [];

for (let index = 0; index < queuedCount; index += 1) {
  invocations.push({ id: `queued_${index}`, agentId: agent.id, status: "queued", createdAt, options: { metadata: { worktreePath: `/worktrees/${index}` } }, delivery: { state: "queued", dispatchAttempts: 0 } });
}
for (let index = 0; index < settledCount; index += 1) {
  invocations.push({ id: `settled_${index}`, agentId: agent.id, status: "succeeded", createdAt, delivery: { state: "acknowledged", dispatchAttempts: index % 10 === 0 ? 2 : 1, acknowledgedAt: "2026-07-18T00:00:01.000Z" } });
}

const started = performance.now();
const result = computeInvocationDispatchHealth({ device: { id: "dev_bench", maxConcurrency: 64 }, invocations, autoRuns: [], issueClaims: [] }, { findAgent: () => agent, now: () => "2026-07-18T00:10:00.000Z" });
const durationMs = Math.round((performance.now() - started) * 100) / 100;
const report = { schemaVersion: 1, queuedCount, settledCount, totalInvocations: invocations.length, durationMs, invocationsPerSecond: Math.round((invocations.length / durationMs) * 1000), queueDepth: result.queue.depth, sampleSize: result.stats.sampleSize };
console.log(JSON.stringify(report));

if (result.queue.depth !== queuedCount || result.stats.sampleSize !== settledCount) process.exit(1);

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
