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
const invocation = {
  id: "inv_1", projectId: "prj", requestedBy: "usr_a",
  options: { metadata: { providerType: "application", applicationId: CCUSAGE_APPLICATION_ID, capability: "app.app_ccusage.wrapper.daily" } },
};
const result = (report) => ({ output: { source: "application", report } });

test("an unrecognized report shape is dropped, not stored as an all-null phantom row", () => {
  const { state, service } = svc();
  const records = service.recordCcusageImportedEstimates({ invocation, result: result({ meta: "x", note: "no usage here" }), agent: null });
  assert.equal(records.length, 0);
  assert.equal(state.importedUsageEstimates.length, 0);
});

test("a bare single-row summary that carries a usage signal is kept", () => {
  const { state, service } = svc();
  service.recordCcusageImportedEstimates({ invocation, result: result({ date: "2026-07-10", model: "claude-opus", totalCostUsd: 3.2 }), agent: null });
  assert.equal(state.importedUsageEstimates.length, 1);
  assert.equal(state.importedUsageEstimates[0].estimatedCostUsd, 3.2);
});

test("truncating a >1000-row report is observable — droppedRowCount + a warn event", () => {
  const { state, events, service } = svc();
  const rows = Array.from({ length: 1001 }, (_, i) => ({ date: `2026-07-${i}`, model: "m", totalCostUsd: 0.001 }));
  const records = service.recordCcusageImportedEstimates({ invocation, result: result(rows), agent: null });
  assert.equal(records.length, 1000, "capped at 1000");
  assert.equal(records[0].droppedRowCount, 1, "the drop is recorded on the row");
  const event = events.find((e) => e.type === "ccusage_imported_estimates_recorded");
  assert.equal(event.level, "warn", "truncation warns");
  assert.match(event.message, /dropped 1/);
});

test("a large raw row is bounded before it is persisted", () => {
  const { state, service } = svc();
  service.recordCcusageImportedEstimates({ invocation, result: result([{ date: "2026-07-10", model: "m", totalCostUsd: 1, blob: "x".repeat(5000) }]), agent: null });
  const raw = state.importedUsageEstimates[0].raw;
  assert.equal(raw.truncated, true);
  assert.ok(raw.preview.length <= 4000);
  assert.ok(!("blob" in raw), "the oversized field is not persisted verbatim");
});
