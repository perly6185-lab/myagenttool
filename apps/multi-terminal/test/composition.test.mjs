import test from "node:test";
import assert from "node:assert/strict";
import { createCompositionService, projectTerminalSnapshot, recoveryTrend } from "../src/composition.mjs";
import { assertNoSchedulingOverride, assertPublicTerminalPath, ownerOperation, resourceRef } from "../src/contract.mjs";

const terminal = { id: "mac-studio", name: "工作室", apiUrl: "http://127.0.0.1:4310", consoleUrl: "http://127.0.0.1:4173" };

test("snapshot preserves terminal ownership and independent queue counts", () => {
  const row = projectTerminalSnapshot(terminal, { tasks: [
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
  const result = await service.proxyAction({ terminalId: terminal.id, resourceType: "invocations", localResourceId: "inv_1", action: "cancel" });
  assert.equal(result.status, 503);
  assert.equal(result.migrated, false);
  assert.deepEqual(calls.map((call) => call.path), ["/api/invocations/inv_1/cancel"]);
});

test("owner operations map to existing single-terminal APIs", () => {
  assert.equal(ownerOperation({ resourceType: "invocations", localResourceId: "inv_1", action: "cancel" }).path, "/api/invocations/inv_1/cancel");
  assert.equal(ownerOperation({ resourceType: "application-runs", localResourceId: "inv_1", action: "retry", body: { applicationId: "app_1", routineId: "routine_1" } }).path, "/api/applications/app_1/orchestrations/routine_1/runs/inv_1/recovery/actions");
  assert.equal(ownerOperation({ resourceType: "deliveries", localResourceId: "delivery_1", action: "replay", body: { provider: "gitea" } }).path, "/api/work-items/gitea/deliveries/delivery_1/replay");
  assert.equal(ownerOperation({ resourceType: "applications", localResourceId: "app_1", action: "maintenance" }).path, "/api/applications/app_1/refresh");
  assert.throws(() => ownerOperation({ resourceType: "invocations", localResourceId: "inv_1", action: "retry" }), /unsupported/);
});

test("overview exposes no global scheduling capability", async () => {
  const service = createCompositionService({ terminals: [terminal], request: async (_terminal, operation) => ({
    ok: true,
    status: 200,
    json: async () => ({ tasks: [] }),
  }) });
  const overview = await service.overview();
  assert.deepEqual(overview.scheduling, { supported: false, globalQueue: false, migration: false, failover: false });
});

test("overview reads only public summaries, never bridge, credentials, or files", async () => {
  const paths = [];
  const service = createCompositionService({ terminals: [terminal], request: async (_terminal, operation) => {
    paths.push(operation.path);
    return { ok: true, status: 200, json: async () => ({ tasks: [] }) };
  } });
  await service.overview();
  assert.deepEqual(paths, ["/api/terminal-observation/v1"]);
  assert.equal(paths.some((path) => path.startsWith("/api/bridge") || path.includes("credential") || path.includes("files")), false);
});

test("end-to-end owner recovery keeps cross-asset trace and deep link on the same terminal", async () => {
  let studioOnline = false;
  const terminals = [
    terminal,
    { id: "laptop", name: "笔记本", apiUrl: "https://laptop.example/", consoleUrl: "https://laptop-console.example/" },
  ];
  const request = async (owner, operation) => {
    if (owner.id === "mac-studio" && !studioOnline) throw new Error("offline");
    if (operation.path === "/api/terminal-observation/v1") return {
      ok: true, status: 200, json: async () => ({ namespace: "local", protocolVersion: "1", capabilities: [], tasks: owner.id === "mac-studio" ? [{
        id: "wi_assets", title: "Excel 到 PPT 报告", executionState: "failed",
        inputAssets: [{ family: "spreadsheet" }], outputAssets: [{ family: "presentation" }, { family: "image" }],
        observability: { trace: { traceId: "trace_assets" } },
      }] : [] }),
    };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const service = createCompositionService({ terminals, request });
  const offline = await service.overview();
  assert.equal(offline.terminals.find((row) => row.id === "mac-studio").status, "offline");
  assert.equal(offline.terminals.find((row) => row.id === "laptop").tasks.length, 0, "work is not failed over");
  studioOnline = true;
  const recovered = await service.overview();
  const task = recovered.terminals.find((row) => row.id === "mac-studio").tasks[0];
  assert.deepEqual(task.assetFamilies, ["spreadsheet", "presentation", "image"]);
  assert.equal(task.traceId, "trace_assets");
  assert.match(task.deepLink, /tasks\/wi_assets$/);
  assert.equal(task.terminalId, "mac-studio");
});
