import assert from "node:assert/strict";
import { test } from "node:test";

import { buildEvidenceCenterRecords } from "../src/read-models/evidence-center.mjs";
import { createApplicationService } from "../src/services/applications.mjs";
import { createCapabilityService } from "../src/services/capabilities.mjs";
import { CLAUDE_APPLICATION_ID, createClaudeApplicationRegistration } from "../src/services/claude-application.mjs";

function applicationService(state = { applications: [] }) {
  return createApplicationService({
    state,
    now: () => "2026-07-14T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
  });
}

test("Claude registers as a binary Application with a governed review facade", () => {
  const state = { applications: [] };
  const service = applicationService(state);
  const application = service.registerApplication(createClaudeApplicationRegistration({ autoOnline: true }));
  assert.equal(application.id, CLAUDE_APPLICATION_ID);
  assert.equal(application.source.type, "binary");
  assert.equal(application.source.binary, "claude");
  assert.match(application.descriptorFingerprint, /^sha256:[0-9a-f]{64}$/u);
  const capability = service.listApplicationCapabilities(application.id)
    .find((item) => item.name === "app.app_claude.review.diff");
  assert.equal(capability.kind, "tool_facade");
  assert.equal(capability.metadata.execution.toolName, "claude.review.diff");
  assert.equal(capability.metadata.resultPath.outputCollection, "claudeReviewFindings");
  assert.deepEqual(capability.metadata.interface, {
    family: "coding_agent",
    version: "1",
    provider: "claude",
    operation: "review.diff",
    mutation: "read_only",
    session: "isolated",
    approval: "allowed",
    resultCollection: "claudeReviewFindings",
  });
  assert.equal(capability.requiresApproval, false);
  const replay = service.registerApplication(createClaudeApplicationRegistration({ autoOnline: true }));
  assert.equal(replay.id, application.id);
  assert.equal(state.applications.length, 1);
});

test("Claude Application capability delegates to the governed Tool and stamps result lineage", () => {
  const state = { applications: [] };
  const applications = applicationService(state);
  applications.registerApplication(createClaudeApplicationRegistration({ autoOnline: true }));
  const invocation = { id: "inv_claude", options: { metadata: { tool: "claude.review.diff" } } };
  const capabilities = createCapabilityService({
    state,
    refuse: null,
    listTools: () => [{ name: "claude.review.diff", agents: [{ status: "available" }] }],
    getTool: (name) => name === "claude.review.diff" ? { name } : null,
    createToolInvocation: (name) => ({ status: 201, body: { tool: name, invocation } }),
    createInvocation: () => { throw new Error("unexpected direct invocation"); },
    completeInvocation: () => {},
    findAgent: () => null,
    listApplications: applications.listApplications,
    listApplicationCapabilities: applications.listApplicationCapabilities,
    invokeApplicationCapability: applications.invokeApplicationCapability,
    planApplicationWrapperInvocation: applications.planApplicationWrapperInvocation,
  });
  const result = capabilities.createCapabilityInvocation("app.app_claude.review.diff", { worktreeId: "wtr_1" });
  assert.equal(result.status, 201);
  assert.equal(invocation.options.metadata.providerType, "application");
  assert.equal(invocation.options.metadata.applicationId, CLAUDE_APPLICATION_ID);
  assert.equal(invocation.options.metadata.capability, "app.app_claude.review.diff");
});

test("Claude Application result lineage enters the Evidence Center", () => {
  const invocation = { id: "inv_claude", agentId: "agt_claude_review_diff" };
  // Sourced from the durable audit summary, not the 500-capped event stream, so
  // the lineage row outlives event eviction (see evidence-center.mjs).
  const records = buildEvidenceCenterRecords({
    state: {
      auditSummaries: [{
        invocationId: invocation.id,
        agentId: invocation.agentId,
        status: "succeeded",
        completedAt: "2026-07-14T00:00:01.000Z",
        applicationResult: {
          applicationId: CLAUDE_APPLICATION_ID,
          capability: "app.app_claude.review.diff",
          applicationAction: "tool:claude.review.diff",
          outputCollection: "claudeReviewFindings",
          importedRecordCount: 1,
          status: "succeeded",
        },
      }],
    },
    findInvocation: (id) => id === invocation.id ? invocation : null,
    codexSessionForInvocation: () => null,
    repoPathForEvidence: () => null,
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].type, "application_result");
  assert.equal(records[0].source, "imported_application_result");
  assert.equal(records[0].invocationId, invocation.id);
  assert.match(records[0].detail, /collection=claudeReviewFindings/u);
  assert.match(records[0].detail, /records=1/u);
});
