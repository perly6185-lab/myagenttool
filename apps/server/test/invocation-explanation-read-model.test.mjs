import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPublicState } from "../src/read-models/state.mjs";

function baseState(overrides = {}) {
  return {
    device: { id: "dev_local" },
    users: [],
    teams: [],
    projects: [{ id: "proj_a", ownerTeamId: "team_a", name: "Project A" }],
    applications: [],
    applicationRecoveryActions: [],
    invocations: [],
    compareRuns: [],
    events: [],
    traces: [],
    spans: [],
    auditSummaries: [],
    approvalRequests: [],
    policyDecisionRecords: [],
    troubleshootingReports: [],
    autoRuns: [],
    worktrees: [],
    projectTargets: [],
    codexImportedEvidenceRecords: [],
    terminalSessions: [],
    terminalEvidenceRecords: [],
    terminalBridgeActions: [],
    sshTargets: [],
    sshConnectionTests: [],
    ...overrides,
  };
}

function publicState(state) {
  return buildPublicState({
    namespace: "test",
    protocolVersion: "1",
    state,
    defaultProjectPath: "/tmp/project-a",
    currentProject: () => null,
    defaultAgent: () => null,
    loopRoutineReadModel: () => [],
    codexApprovalQueue: () => [],
    evidenceCenterRecords: () => [],
    ledgerSummary: () => null,
    budgetStatuses: () => [],
    teamBudgetStatuses: () => [],
    actor: { teamId: "team_a" },
  });
}

test("a channel-originated invocation reads as source type 'channel', not 'direct'", () => {
  const snapshot = publicState(baseState({
    invocations: [{
      id: "inv_ch",
      projectId: "proj_a",
      agentId: "agt_high",
      status: "running",
      delivery: { state: "not_required", deviceId: null },
      cancellation: { state: "none" },
      options: { metadata: { channel: { channelId: "chn_1", conversationId: "cnv_1", channelTaskRequestId: "ctr_1" } } },
      createdAt: "2026-07-05T01:00:00.000Z",
    }],
  }));
  const source = snapshot.invocations[0].explanation.source;
  assert.equal(source.type, "channel");
  assert.equal(source.channelId, "chn_1");
  assert.equal(source.channelTaskRequestId, "ctr_1");
});

test("public invocation explanation points pending local approval at the approval request", () => {
  const snapshot = publicState(baseState({
    invocations: [{
      id: "inv_approval",
      projectId: "proj_a",
      agentId: "agt_high",
      status: "waiting_for_local_approval",
      approvalRequestId: "apr_1",
      policyDecisionId: "pdr_1",
      delivery: { state: "not_required", deviceId: null },
      cancellation: { state: "none" },
      options: { metadata: {} },
      createdAt: "2026-07-05T01:00:00.000Z",
    }],
    approvalRequests: [{
      id: "apr_1",
      invocationId: "inv_approval",
      agentId: "agt_high",
      status: "pending",
      riskLevel: "high",
      riskTags: ["write_files"],
      createdAt: "2026-07-05T01:00:00.000Z",
    }],
    policyDecisionRecords: [{
      id: "pdr_1",
      invocationId: "inv_approval",
      agentId: "agt_high",
      decision: "requires_local_approval",
      reason: "High risk work needs local approval.",
      createdAt: "2026-07-05T01:00:00.000Z",
    }],
  }));

  const invocation = snapshot.invocations[0];
  assert.equal(invocation.explanation.state, "approval_pending");
  assert.equal(invocation.explanation.reason, "High risk work needs local approval.");
  assert.equal(invocation.explanation.waitingOn.type, "approval");
  assert.equal(invocation.explanation.waitingOn.id, "apr_1");
  assert.equal(invocation.explanation.approval.requestId, "apr_1");
  assert.equal(invocation.explanation.nextAction, "Approve or deny the local approval request.");
});

test("public invocation explanation carries application recovery state and result pointers", () => {
  const snapshot = publicState(baseState({
    invocations: [{
      id: "inv_app_failed",
      projectId: "proj_a",
      agentId: "agt_app",
      status: "failed",
      delivery: { state: "not_required", deviceId: null },
      cancellation: { state: "none" },
      result: { summary: "Validation failed." },
      options: {
        metadata: {
          source: "application_orchestration",
          applicationId: "app_docs",
          applicationName: "Docs",
          routineId: "routine_docs",
        },
      },
      createdAt: "2026-07-05T01:00:00.000Z",
    }, {
      id: "inv_recovery_result",
      projectId: "proj_a",
      agentId: "agt_app",
      status: "queued",
      delivery: { state: "queued", deviceId: "dev_local" },
      cancellation: { state: "none" },
      options: { metadata: {} },
      createdAt: "2026-07-05T01:03:00.000Z",
    }],
    applicationRecoveryActions: [{
      id: "rec_1",
      applicationId: "app_docs",
      routineId: "routine_docs",
      invocationId: "inv_app_failed",
      actionType: "regenerate_orchestration",
      status: "approval_pending",
      recoveryCategory: "validation_failed",
      approvalRequestId: "apr_recovery",
      resultInvocationId: "inv_recovery_result",
      createdAt: "2026-07-05T01:01:00.000Z",
      updatedAt: "2026-07-05T01:02:00.000Z",
    }],
  }));

  const failed = snapshot.invocations.find((item) => item.id === "inv_app_failed");
  assert.equal(failed.explanation.source.type, "application_orchestration");
  assert.equal(failed.explanation.recovery.actionRequestId, "rec_1");
  assert.equal(failed.explanation.recovery.category, "validation_failed");
  assert.equal(failed.explanation.waitingOn.id, "apr_recovery");
  assert.equal(failed.explanation.resultLocation.invocationId, "inv_recovery_result");

  const result = snapshot.invocations.find((item) => item.id === "inv_recovery_result");
  assert.equal(result.explanation.source.type, "recovery_result");
  assert.equal(result.explanation.source.invocationId, "inv_app_failed");
});

test("public invocation explanation captures compare, automation, auto-run, and troubleshooting sources", () => {
  const snapshot = publicState(baseState({
    invocations: [{
      id: "inv_compare_a",
      projectId: "proj_a",
      agentId: "agt_a",
      status: "running",
      compareRunId: "cmp_1",
      delivery: { state: "not_required", deviceId: null },
      cancellation: { state: "none" },
      options: { metadata: { compareRunId: "cmp_1" } },
      createdAt: "2026-07-05T01:00:00.000Z",
    }, {
      id: "inv_automation",
      projectId: "proj_a",
      agentId: "agt_a",
      status: "queued",
      delivery: { state: "queued", deviceId: "dev_local" },
      cancellation: { state: "none" },
      options: { metadata: { automationId: "atm_1", automationName: "Nightly", scheduled: true } },
      createdAt: "2026-07-05T01:01:00.000Z",
    }, {
      id: "inv_auto_run",
      projectId: "proj_a",
      agentId: "agt_a",
      status: "running",
      delivery: { state: "not_required", deviceId: null },
      cancellation: { state: "none" },
      options: { metadata: {} },
      createdAt: "2026-07-05T01:02:00.000Z",
    }, {
      id: "inv_failed",
      projectId: "proj_a",
      agentId: "agt_a",
      status: "failed",
      delivery: { state: "not_required", deviceId: null },
      cancellation: { state: "none" },
      options: { metadata: {} },
      createdAt: "2026-07-05T01:03:00.000Z",
    }, {
      id: "inv_troubleshooter",
      projectId: "proj_a",
      agentId: "agt_platform_troubleshooter",
      status: "succeeded",
      delivery: { state: "not_required", deviceId: null },
      cancellation: { state: "none" },
      result: { summary: "Troubleshooter report created." },
      options: { metadata: { targetInvocationId: "inv_failed" } },
      createdAt: "2026-07-05T01:04:00.000Z",
    }],
    compareRuns: [{
      id: "cmp_1",
      status: "running",
      childInvocationIds: ["inv_compare_a", "inv_compare_b"],
      preferredInvocationId: null,
      createdAt: "2026-07-05T01:00:00.000Z",
    }],
    autoRuns: [{
      id: "aur_1",
      projectId: "proj_a",
      invocationId: "inv_auto_run",
      worktreeId: "wt_1",
      status: "running",
      createdAt: "2026-07-05T01:02:00.000Z",
    }],
    troubleshootingReports: [{
      id: "trb_1",
      invocationId: "inv_failed",
      summary: "Troubleshooter reviewed inv_failed.",
      createdAt: "2026-07-05T01:05:00.000Z",
    }],
  }));

  assert.equal(snapshot.invocations.find((item) => item.id === "inv_compare_a").explanation.source.type, "compare_run");
  assert.equal(snapshot.invocations.find((item) => item.id === "inv_automation").explanation.source.type, "automation");
  assert.equal(snapshot.invocations.find((item) => item.id === "inv_automation").explanation.source.scheduled, true);
  assert.equal(snapshot.invocations.find((item) => item.id === "inv_auto_run").explanation.source.type, "auto_run");
  assert.equal(snapshot.invocations.find((item) => item.id === "inv_failed").explanation.resultLocation.reportId, "trb_1");
  assert.equal(snapshot.invocations.find((item) => item.id === "inv_troubleshooter").explanation.source.type, "troubleshooting");
});
