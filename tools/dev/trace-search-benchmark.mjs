import { performance } from "node:perf_hooks";
import { searchTraceRecords } from "../../apps/server/src/read-models/trace-search.mjs";

const count = Math.max(1, Number.parseInt(process.env.TRACE_BENCHMARK_RECORDS ?? "100000", 10));
const budgetMs = Math.max(1, Number.parseInt(process.env.TRACE_BENCHMARK_BUDGET_MS ?? "2000", 10));
const state = {
  projects: [{ id: "bench_project", ownerTeamId: "bench_team" }],
  users: [],
  events: [],
  evidenceLedger: [],
  applicationResults: [],
  channelDeliveries: [],
  invocations: Array.from({ length: count }, (_, index) => ({
    id: `inv_bench_${String(index).padStart(6, "0")}`,
    projectId: "bench_project",
    agentId: index % 2 ? "agent_docs" : "agent_code",
    status: index % 7 ? "succeeded" : "failed",
    input: { task: index === count - 1 ? "needle quarterly review" : `bounded task ${index}` },
    createdAt: new Date(1_700_000_000_000 + index * 1_000).toISOString(),
  })),
};
const started = performance.now();
const result = searchTraceRecords({ state, actor: { teamId: "bench_team" }, query: "needle", limit: 25 });
const durationMs = performance.now() - started;
if (result.total !== 1) throw new Error(`Trace benchmark correctness failed: expected 1, got ${result.total}`);
console.log(JSON.stringify({ records: count, matches: result.total, durationMs: Number(durationMs.toFixed(2)), budgetMs }));
if (durationMs > budgetMs) {
  console.error(`Trace benchmark exceeded ${budgetMs}ms budget.`);
  process.exitCode = 1;
}
