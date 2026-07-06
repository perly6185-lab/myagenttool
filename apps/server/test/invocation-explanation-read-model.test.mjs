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

test("public automation snapshot carries health summary from visible runs", () => {
  const snapshot = publicState(baseState({
    automations: [{
      id: "atm_app_daily",
      name: "ccusage daily",
      enabled: true,
      kind: "application_capability",
      projectId: "proj_a",
      schedule: { kind: "daily", time: "09:00", label: "Daily at 09:00" },
      nextRunAt: "2026-07-06T09:00:00.000Z",
      agentId: "agt_platform_application_wrapper",
      prompt: "Run application capability app.app_ccusage.wrapper.daily.",
      lastRunAt: "2026-07-05T11:00:00.000Z",
      lastInvocationId: "inv_auto_failed_new",
      runCount: 2,
      target: {
        type: "application_capability",
        applicationId: "app_ccusage",
        capabilityName: "app.app_ccusage.wrapper.daily",
      },
    }],
    invocations: [{
      id: "inv_auto_failed_new",
      projectId: "proj_a",
      agentId: "agt_platform_application_wrapper",
      status: "failed",
      result: { summary: "Wrapper command exited 1." },
      delivery: { state: "not_required", deviceId: null },
      cancellation: { state: "none" },
      options: { metadata: { automationId: "atm_app_daily", automationName: "ccusage daily", scheduled: true } },
      createdAt: "2026-07-05T11:00:00.000Z",
    }, {
      id: "inv_auto_failed_old",
      projectId: "proj_a",
      agentId: "agt_platform_application_wrapper",
      status: "failed",
      delivery: { state: "not_required", deviceId: null },
      cancellation: { state: "none" },
      options: { metadata: { automationId: "atm_app_daily", automationName: "ccusage daily", scheduled: true } },
      createdAt: "2026-07-05T10:00:00.000Z",
    }],
    auditSummaries: [{
      invocationId: "inv_auto_failed_new",
      errorSummary: "Wrapper command exited 1.",
    }],
  }));

  const automation = snapshot.automations.find((item) => item.id === "atm_app_daily");
  assert.equal(automation.healthSummary.status, "failing");
  assert.equal(automation.healthSummary.failureStreak, 2);
  assert.equal(automation.healthSummary.latestRun.invocationId, "inv_auto_failed_new");
  assert.equal(automation.healthSummary.latestRun.errorSummary, "Wrapper command exited 1.");
  assert.equal(automation.healthSummary.lastErrorSummary, "Wrapper command exited 1.");
  assert.match(automation.healthSummary.nextAction, /Pause the schedule/);
});

test("public application snapshot aggregates application automation health", () => {
  const snapshot = publicState(baseState({
    applications: [{
      id: "app_ccusage",
      name: "ccusage",
      kind: "npm",
      source: { type: "npm", package: "@acme/ccusage" },
      status: "active",
      projectId: "proj_a",
      ownerTeamId: "team_a",
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z",
    }],
    automations: [{
      id: "atm_failed",
      name: "Daily report",
      enabled: true,
      kind: "application_capability",
      projectId: "proj_a",
      schedule: { kind: "daily", time: "09:00", label: "Daily at 09:00" },
      nextRunAt: "2026-07-06T09:00:00.000Z",
      agentId: "agt_platform_application_wrapper",
      prompt: "Run daily report.",
      target: {
        type: "application_capability",
        applicationId: "app_ccusage",
        capabilityName: "app.app_ccusage.wrapper.daily",
      },
      createdAt: "2026-07-05T09:00:00.000Z",
      updatedAt: "2026-07-05T09:00:00.000Z",
    }, {
      id: "atm_waiting",
      name: "Weekly export",
      enabled: true,
      kind: "application_capability",
      projectId: "proj_a",
      schedule: { kind: "weekdays", time: "10:00", label: "Weekdays at 10:00" },
      nextRunAt: "2026-07-06T10:00:00.000Z",
      agentId: "agt_platform_application_wrapper",
      prompt: "Run weekly export.",
      target: {
        type: "application_capability",
        applicationId: "app_ccusage",
        capabilityName: "app.app_ccusage.wrapper.export",
      },
      createdAt: "2026-07-05T10:00:00.000Z",
      updatedAt: "2026-07-05T10:00:00.000Z",
    }, {
      id: "atm_paused",
      name: "Paused cleanup",
      enabled: false,
      kind: "application_capability",
      projectId: "proj_a",
      schedule: { kind: "daily", time: "11:00", label: "Daily at 11:00" },
      nextRunAt: null,
      agentId: "agt_platform_application_wrapper",
      prompt: "Run cleanup.",
      target: {
        type: "application_capability",
        applicationId: "app_ccusage",
        capabilityName: "app.app_ccusage.wrapper.cleanup",
      },
      createdAt: "2026-07-05T11:00:00.000Z",
      updatedAt: "2026-07-05T11:00:00.000Z",
    }],
    invocations: [{
      id: "inv_failed",
      projectId: "proj_a",
      agentId: "agt_platform_application_wrapper",
      status: "failed",
      result: { summary: "Wrapper command exited 1." },
      delivery: { state: "not_required", deviceId: null },
      cancellation: { state: "none" },
      options: { metadata: { automationId: "atm_failed", scheduled: true } },
      createdAt: "2026-07-05T09:01:00.000Z",
    }, {
      id: "inv_waiting",
      projectId: "proj_a",
      agentId: "agt_platform_application_wrapper",
      status: "waiting_for_local_approval",
      approvalRequestId: "apr_waiting",
      delivery: { state: "not_required", deviceId: null },
      cancellation: { state: "none" },
      options: { metadata: { automationId: "atm_waiting", scheduled: true } },
      createdAt: "2026-07-05T10:01:00.000Z",
    }],
    auditSummaries: [{
      invocationId: "inv_failed",
      errorSummary: "Wrapper command exited 1.",
    }],
  }));

  const application = snapshot.applications.find((item) => item.id === "app_ccusage");
  assert.equal(application.healthSummary.automationCounts.failing, 1);
  assert.equal(application.healthSummary.automationCounts.waitingForApproval, 1);
  assert.equal(application.healthSummary.automationCounts.paused, 1);
  assert.equal(application.healthSummary.automationCounts.attention, 2);
  assert.equal(application.healthSummary.latestAutomationAttention.automationId, "atm_failed");
  assert.equal(application.healthSummary.latestAutomationAttention.name, "Daily report");
  assert.equal(application.healthSummary.latestAutomationAttention.status, "failing");
  assert.equal(application.healthSummary.latestAutomationAttention.latestInvocationId, "inv_failed");
  assert.equal(application.healthSummary.latestAutomationAttention.lastErrorSummary, "Wrapper command exited 1.");
});
