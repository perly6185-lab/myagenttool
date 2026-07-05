/*
 * #355 Phase 3 (import parity): ccusage estimates import from the ccusage
 * Application's wrapper capability, not just the bespoke governed agent — with
 * identical semantics (source "ccusage", external_billed, non-authoritative).
 * A foreign application cannot spoof a ccusage import.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildEvidenceCenterRecords } from "../src/read-models/evidence-center.mjs";
import { buildPublicState } from "../src/read-models/state.mjs";
import { createApplicationService } from "../src/services/applications.mjs";
import { createCcusageImportService } from "../src/services/ccusage-imports.mjs";
import { CCUSAGE_APPLICATION_ID, createCcusageApplicationRegistration } from "../src/services/ccusage-application.mjs";
import { createInvocationCompletionRuntime } from "../src/services/invocations/completion.mjs";

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

test("application wrapper completion links imported results across invocation, app, audit, and evidence center", () => {
  let id = 0;
  const state = {
    projects: [{ id: "prj_ccusage", ownerTeamId: "team_local" }],
    currentProjectId: "prj_ccusage",
    applications: [],
    agents: [{
      id: "agt_platform_application_wrapper",
      name: "Application Wrapper Runner",
      economics: { model: "free", costOwner: "usr_local", currency: "USD" },
    }],
    invocations: [],
    compareRuns: [],
    events: [],
    spans: [],
    auditSummaries: [],
    agentUsageSummaries: [],
    importedUsageEstimates: [],
    ledgerEntries: [],
  };
  const appendEvent = (event) => state.events.push({ id: `evt_${++id}`, createdAt: "2026-07-03T00:00:00.000Z", ...event });
  const appSvc = createApplicationService({
    state,
    now: () => "2026-07-03T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent,
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
  });
  appSvc.registerApplication(createCcusageApplicationRegistration());
  const invocation = {
    id: "inv_app_ccusage",
    agentId: "agt_platform_application_wrapper",
    requestedBy: "usr_local",
    projectId: "prj_ccusage",
    status: "running",
    input: { task: "Run application capability app.app_ccusage.wrapper.daily." },
    options: {
      metadata: {
        providerType: "application",
        applicationId: CCUSAGE_APPLICATION_ID,
        capability: "app.app_ccusage.wrapper.daily",
        applicationWrapper: {
          outputCollection: "importedUsageEstimates",
          resultImport: { source: "ccusage", kind: "usage_estimates", amountSource: "imported_ccusage_report" },
        },
      },
    },
    delivery: { deviceId: "dev_local_001" },
    cancellation: { state: "none" },
    createdAt: "2026-07-03T00:00:00.000Z",
  };
  state.invocations.push(invocation);
  const { recordCcusageImportedEstimates } = createCcusageImportService({
    state,
    now: () => "2026-07-03T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent,
  });
  const completion = createInvocationCompletionRuntime({
    state,
    now: () => "2026-07-03T00:00:00.000Z",
    appendEvent,
    persistStateSoon: () => {},
    namespace: "test",
    protocolVersion: "0",
    findAgent: (agentId) => state.agents.find((agent) => agent.id === agentId) ?? null,
    findInvocation: (invocationId) => state.invocations.find((item) => item.id === invocationId) ?? null,
    closeCodexSession: () => {},
    isTerminal: (status) => ["succeeded", "failed", "cancelled", "timed_out", "expired", "rejected"].includes(status),
    recordInvocationLedgerEntry: () => null,
    recordCcusageImportedEstimates,
  });

  completion.completeInvocation(invocation, {
    status: "succeeded",
    summary: "Application wrapper daily report completed.",
    result: {
      output: {
        source: "application",
        capability: "app.app_ccusage.wrapper.daily",
        report: [{ date: "2026-07-03", provider: "openai", model: "gpt-5", totalCostUsd: 0.25, totalTokens: 100 }],
      },
    },
  });

  const imported = state.importedUsageEstimates[0];
  assert.ok(imported, "completion should import the ccusage row");
  assert.equal(invocation.result.applicationResult.outputCollection, "importedUsageEstimates");
  assert.deepEqual(invocation.result.applicationResult.importedRecordIds, [imported.id]);
  assert.equal(invocation.options.metadata.applicationResult.importedRecordCount, 1);
  assert.equal(state.auditSummaries[0].applicationResult.importedRecordIds[0], imported.id);
  assert.equal(appSvc.findApplication(CCUSAGE_APPLICATION_ID).latestResult.importedRecordIds[0], imported.id);
  assert(state.events.some((event) => event.type === "application_result_recorded"));

  const evidenceCenterRecords = () => buildEvidenceCenterRecords({
    state,
    findInvocation: (invocationId) => state.invocations.find((item) => item.id === invocationId) ?? null,
    codexSessionForInvocation: () => null,
    repoPathForEvidence: () => null,
  });
  const publicState = buildPublicState({
    namespace: "test",
    protocolVersion: "0",
    state,
    defaultProjectPath: "/tmp/repo",
    currentProject: () => state.projects[0],
    defaultAgent: () => null,
    loopRoutineReadModel: () => [],
    codexApprovalQueue: () => [],
    evidenceCenterRecords,
    ledgerSummary: () => null,
    budgetStatuses: () => [],
    teamBudgetStatuses: () => [],
  });
  assert.equal(publicState.applications.find((app) => app.id === CCUSAGE_APPLICATION_ID).latestResult.importedRecordIds[0], imported.id);
  assert(publicState.evidenceCenterRecords.some((record) => record.id === imported.id && record.type === "usage_estimate"));
});
