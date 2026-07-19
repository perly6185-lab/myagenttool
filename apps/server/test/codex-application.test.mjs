import assert from "node:assert/strict";
import { test } from "node:test";

import { buildEvidenceCenterRecords } from "../src/read-models/evidence-center.mjs";
import { createApplicationService } from "../src/services/applications.mjs";
import { createCapabilityService } from "../src/services/capabilities.mjs";
import { CODEX_APPLICATION_ID, createCodexApplicationRegistration } from "../src/services/codex-application.mjs";

function applicationService(state = { applications: [] }) {
  return createApplicationService({
    state,
    now: () => "2026-07-19T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
  });
}

test("Codex registers as a binary Application with governed review and exec facades", () => {
  const state = { applications: [] };
  const service = applicationService(state);
  const application = service.registerApplication(createCodexApplicationRegistration({ autoOnline: true }));
  assert.equal(application.id, CODEX_APPLICATION_ID);
  assert.equal(application.source.binary, "codex");
  assert.match(application.descriptorFingerprint, /^sha256:[0-9a-f]{64}$/u);
  const capabilities = service.listApplicationCapabilities(application.id);
  const review = capabilities.find((item) => item.name === "app.app_codex.review.diff");
  const exec = capabilities.find((item) => item.name === "app.app_codex.exec");
  assert.equal(review.metadata.execution.toolName, "codex.review.diff");
  assert.equal(review.metadata.resultPath.outputCollection, "codexReviewFindings");
  assert.deepEqual(review.metadata.interface, {
    family: "coding_agent",
    version: "1",
    provider: "codex",
    operation: "review.diff",
    mutation: "read_only",
    session: "isolated",
    approval: "allowed",
    resultCollection: "codexReviewFindings",
  });
  assert.equal(exec.metadata.execution.toolName, "codex.exec");
  assert.equal(exec.requiresApproval, true);
  assert.equal(service.registerApplication(createCodexApplicationRegistration({ autoOnline: true })).id, application.id);
  assert.equal(state.applications.length, 1);
});

test("Codex Application review delegates to the governed Tool and stamps result lineage", () => {
  const state = { applications: [] };
  const applications = applicationService(state);
  applications.registerApplication(createCodexApplicationRegistration({ autoOnline: true }));
  const invocation = { id: "inv_codex", options: { metadata: { tool: "codex.review.diff" } } };
  const capabilities = createCapabilityService({
    state,
    refuse: null,
    listTools: () => [{ name: "codex.review.diff", agents: [{ status: "available" }] }],
    getTool: (name) => name === "codex.review.diff" ? { name } : null,
    createToolInvocation: (name) => ({ status: 201, body: { tool: name, invocation } }),
    createInvocation: () => { throw new Error("unexpected direct invocation"); },
    completeInvocation: () => {},
    findAgent: () => null,
    listApplications: applications.listApplications,
    listApplicationCapabilities: applications.listApplicationCapabilities,
    invokeApplicationCapability: applications.invokeApplicationCapability,
    planApplicationWrapperInvocation: applications.planApplicationWrapperInvocation,
  });
  const result = capabilities.createCapabilityInvocation("app.app_codex.review.diff", { worktreeId: "wtr_1" });
  assert.equal(result.status, 201);
  assert.equal(invocation.options.metadata.providerType, "application");
  assert.equal(invocation.options.metadata.applicationId, CODEX_APPLICATION_ID);
  assert.equal(invocation.options.metadata.capability, "app.app_codex.review.diff");
});

test("Codex Application result lineage enters the Evidence Center", () => {
  const invocation = { id: "inv_codex", agentId: "agt_codex_review_diff" };
  const records = buildEvidenceCenterRecords({
    state: { auditSummaries: [{
      invocationId: invocation.id,
      agentId: invocation.agentId,
      status: "succeeded",
      completedAt: "2026-07-19T00:00:01.000Z",
      applicationResult: {
        applicationId: CODEX_APPLICATION_ID,
        capability: "app.app_codex.review.diff",
        applicationAction: "tool:codex.review.diff",
        outputCollection: "codexReviewFindings",
        importedRecordCount: 1,
        status: "succeeded",
      },
    }] },
    findInvocation: (id) => id === invocation.id ? invocation : null,
    codexSessionForInvocation: () => null,
    repoPathForEvidence: () => null,
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].type, "application_result");
  assert.match(records[0].detail, /collection=codexReviewFindings/u);
  assert.match(records[0].detail, /records=1/u);
});
