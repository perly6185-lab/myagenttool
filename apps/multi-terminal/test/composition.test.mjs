import test from "node:test";
import assert from "node:assert/strict";
import { createCompositionService, projectTerminalSnapshot, recoveryTrend } from "../src/composition.mjs";
import { assertNoSchedulingOverride, assertPublicTerminalPath, resourceRef } from "../src/contract.mjs";

const terminal = { id: "mac-studio", name: "工作室", apiUrl: "http://127.0.0.1:4310", consoleUrl: "http://127.0.0.1:4173" };

test("snapshot preserves terminal ownership and independent queue counts", () => {
  const row = projectTerminalSnapshot(terminal, { workItems: [
    { id: "wi_1", title: "文档", executionState: "running" },
    { id: "wi_2", title: "视频", executionState: "failed" },
  ] });
  assert.equal(row.tasks[0].ref, "mac-studio:wi_1");
  assert.equal(row.tasks[0].terminalId, "mac-studio");
  assert.equal(row.counts.running, 1);
  assert.equal(row.counts.failed, 1);
  assert.match(row.tasks[0].deepLink, /tasks\/wi_1$/);
});

test("recovery trend is honest with small samples and calculates representative percentiles", () => {
  assert.equal(recoveryTrend([{ at: "2026-01-01", hours: 2 }]).status, "insufficient_data");
  const trend = recoveryTrend([1, 2, 3, 4, 25].map((hours, index) => ({ at: `2026-01-0${index + 1}`, hours })));
  assert.equal(trend.medianHours, 3);
  assert.equal(trend.p95Hours, 25);
  assert.equal(trend.status, "healthy");
});

test("contract denies private endpoints and every scheduling override", () => {
  assert.throws(() => assertPublicTerminalPath("/api/bridge/actions"), /private/);
  assert.throws(() => assertNoSchedulingOverride({ targetTerminalId: "other" }), /unsupported/);
  assert.throws(() => resourceRef("../bad", "wi_1"), /invalid/);
});

test("proxy action stays on owner and reports offline without migration", async () => {
  const calls = [];
  const service = createCompositionService({ terminals: [terminal], request: async (_terminal, operation) => {
    calls.push(operation);
    throw new Error("offline");
  } });
  const result = await service.proxyAction({ terminalId: terminal.id, resourceType: "work-items", localResourceId: "wi_1", action: "retry" });
  assert.equal(result.status, 503);
  assert.equal(result.migrated, false);
  assert.deepEqual(calls.map((call) => call.path), ["/api/work-items/wi_1/retry"]);
});

test("overview exposes no global scheduling capability", async () => {
  const service = createCompositionService({ terminals: [terminal], request: async (_terminal, operation) => ({
    ok: true,
    status: 200,
    json: async () => operation.path.startsWith("/api/work-items") ? { workItems: [] } : {},
  }) });
  const overview = await service.overview();
  assert.deepEqual(overview.scheduling, { supported: false, globalQueue: false, migration: false, failover: false });
});

test("overview reads only public summaries, never bridge, credentials, or files", async () => {
  const paths = [];
  const service = createCompositionService({ terminals: [terminal], request: async (_terminal, operation) => {
    paths.push(operation.path);
    return { ok: true, status: 200, json: async () => operation.path.startsWith("/api/work-items") ? { workItems: [] } : {} };
  } });
  await service.overview();
  assert.deepEqual(paths.sort(), ["/api/observability/operations", "/api/state", "/api/work-items?limit=100"]);
  assert.equal(paths.some((path) => path.startsWith("/api/bridge") || path.includes("credential") || path.includes("files")), false);
});
