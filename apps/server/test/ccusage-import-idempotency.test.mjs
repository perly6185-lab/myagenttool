import assert from "node:assert/strict";
import { test } from "node:test";

import { createCcusageImportService } from "../src/services/ccusage-imports.mjs";
import { CCUSAGE_APPLICATION_ID } from "../src/services/ccusage-application.mjs";

let idc = 0;
const now = () => "2026-07-13T00:00:00.000Z";

function svc() {
  const state = { importedUsageEstimates: [] };
  const events = [];
  const service = createCcusageImportService({ state, now, nextId: (p) => `${p}_${idc++}`, appendEvent: (e) => events.push(e) });
  return { state, events, service };
}

function invocationFor(report = "daily") {
  return {
    id: "inv_1", projectId: "prj", requestedBy: "usr_a",
    options: { metadata: { providerType: "application", applicationId: CCUSAGE_APPLICATION_ID, capability: `app.app_ccusage.wrapper.${report}` } },
  };
}
const result = (rows) => ({ output: { source: "application", report: rows } });
const total = (state) => state.importedUsageEstimates.reduce((sum, r) => sum + (r.estimatedCostUsd ?? 0), 0);

test("re-importing the same report is idempotent — no duplicate rows, stable total", () => {
  const { state, service } = svc();
  const rows = [
    { date: "2026-07-10", provider: "anthropic", model: "claude-opus", totalCostUsd: 1.5 },
    { date: "2026-07-11", provider: "anthropic", model: "claude-opus", totalCostUsd: 2.0 },
  ];
  service.recordCcusageImportedEstimates({ invocation: invocationFor(), result: result(rows), agent: null });
  service.recordCcusageImportedEstimates({ invocation: invocationFor(), result: result(rows), agent: null });
  service.recordCcusageImportedEstimates({ invocation: invocationFor(), result: result(rows), agent: null });
  assert.equal(state.importedUsageEstimates.length, 2, "three runs, still two rows");
  assert.equal(total(state), 3.5, "external total does not drift");
});

test("a changed value updates the row in place", () => {
  const { state, service } = svc();
  const row = (cost) => result([{ date: "2026-07-10", provider: "anthropic", model: "claude-opus", totalCostUsd: cost }]);
  service.recordCcusageImportedEstimates({ invocation: invocationFor(), result: row(1.5), agent: null });
  service.recordCcusageImportedEstimates({ invocation: invocationFor(), result: row(9.0), agent: null });
  assert.equal(state.importedUsageEstimates.length, 1);
  assert.equal(total(state), 9.0);
});

test("a new period adds a row without touching the old", () => {
  const { state, service } = svc();
  service.recordCcusageImportedEstimates({ invocation: invocationFor(), result: result([{ date: "2026-07-10", provider: "anthropic", model: "claude-opus", totalCostUsd: 1 }]), agent: null });
  service.recordCcusageImportedEstimates({ invocation: invocationFor(), result: result([{ date: "2026-07-11", provider: "anthropic", model: "claude-opus", totalCostUsd: 2 }]), agent: null });
  assert.equal(state.importedUsageEstimates.length, 2);
  assert.equal(total(state), 3);
});

test("a zero-row import still emits an event (ran, found nothing != never ran)", () => {
  const { state, events, service } = svc();
  const records = service.recordCcusageImportedEstimates({ invocation: invocationFor(), result: result([]), agent: null });
  assert.equal(records.length, 0);
  assert.equal(state.importedUsageEstimates.length, 0);
  const event = events.find((e) => e.type === "ccusage_imported_estimates_recorded");
  assert.ok(event, "an event fires even with no rows");
  assert.equal(event.data.importedRecordCount, 0);
  assert.ok(event.data.importedAt, "carries an import timestamp for freshness");
});

test("different reports (daily vs weekly) never collide", () => {
  const { state, service } = svc();
  service.recordCcusageImportedEstimates({ invocation: invocationFor("daily"), result: result([{ date: "2026-07-10", model: "m", totalCostUsd: 1 }]), agent: null });
  service.recordCcusageImportedEstimates({ invocation: invocationFor("weekly"), result: result([{ week: "2026-W28", model: "m", totalCostUsd: 5 }]), agent: null });
  assert.equal(state.importedUsageEstimates.length, 2);
});
