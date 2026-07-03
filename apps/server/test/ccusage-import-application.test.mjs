/*
 * #355 Phase 3 (import parity): ccusage estimates import from the ccusage
 * Application's wrapper capability, not just the bespoke governed agent — with
 * identical semantics (source "ccusage", external_billed, non-authoritative).
 * A foreign application cannot spoof a ccusage import.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createCcusageImportService } from "../src/services/ccusage-imports.mjs";
import { CCUSAGE_APPLICATION_ID } from "../src/services/ccusage-application.mjs";

function svc() {
  const state = { importedUsageEstimates: [] };
  const events = [];
  const service = createCcusageImportService({
    state,
    now: () => "2026-07-03T00:00:00.000Z",
    nextId: (p) => `${p}_${state.importedUsageEstimates.length}`,
    appendEvent: (e) => events.push(e),
  });
  return { state, events, ...service };
}

const appInvocation = (applicationId) => ({
  id: "inv1",
  projectId: "p1",
  options: { metadata: { providerType: "application", applicationId, capability: "app.app_ccusage.wrapper.daily" } },
});

const ccusageResult = () => ({
  output: {
    source: "application",
    capability: "app.app_ccusage.wrapper.daily",
    report: [{ model: "gpt", totalCostUsd: 1.5, inputTokens: 10, outputTokens: 20 }],
  },
});

test("imports estimates delivered via the ccusage application wrapper capability", () => {
  const { state, events, recordCcusageImportedEstimates } = svc();
  const records = recordCcusageImportedEstimates({
    invocation: appInvocation(CCUSAGE_APPLICATION_ID),
    result: ccusageResult(),
    agent: { id: "agt_platform_application_wrapper" },
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "ccusage");
  assert.equal(records[0].amountSource, "imported_ccusage_report");
  assert.equal(records[0].economicModel, "external_billed");
  assert.equal(records[0].authoritative, false);
  assert.equal(records[0].estimatedCostUsd, 1.5);
  assert.equal(state.importedUsageEstimates.length, 1);
  assert.equal(events.at(-1).data.reportId, "daily"); // derived from the capability name
});

test("a foreign application cannot spoof a ccusage import", () => {
  const { recordCcusageImportedEstimates } = svc();
  const records = recordCcusageImportedEstimates({
    invocation: appInvocation("app_evil"),
    result: ccusageResult(),
    agent: { id: "agt_platform_application_wrapper" },
  });
  assert.deepEqual(records, []);
});

test("a non-application invocation with no governed ccusage agent still imports nothing", () => {
  const { recordCcusageImportedEstimates } = svc();
  const records = recordCcusageImportedEstimates({
    invocation: { id: "inv2", options: { metadata: {} } },
    result: { output: { source: "application", report: [{ totalCostUsd: 1 }] } },
    agent: { id: "agt_other" },
  });
  assert.deepEqual(records, []);
});
