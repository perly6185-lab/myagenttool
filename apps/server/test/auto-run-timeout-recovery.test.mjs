import assert from "node:assert/strict";
import test from "node:test";

import { createAutoRunService } from "../src/services/auto-run.mjs";

function fixture({
  status = "running",
  linkType = "local_issue",
  fetchIssueBody,
} = {}) {
  const agent = {
    id: "agt_1",
    name: "Coder",
    status: "active",
    location: { type: "local_device", deviceId: "dev_1" },
    adapter: { type: "cli", timeoutSeconds: 900 },
  };
  const worktree = {
    id: "wtr_1",
    projectId: "prj_1",
    sourceProjectId: "prj_1",
    terminalId: "dev_1",
    branchName: "local-1-work",
  };
  const autoRun = {
    id: "aur_1",
    status,
    invocationId: "inv_1",
    worktreeId: worktree.id,
    projectId: "prj_1",
    terminalId: "dev_1",
    agentId: agent.id,
    link: { type: linkType, number: 1, title: "Long task", state: "open" },
    decision: { path: "develop" },
    issueBody: "APPROVED ORIGINAL BODY",
    repairAttempts: 0,
    timeoutRecoveryAttempts: 0,
  };
  const state = {
    projects: [{ id: "prj_1", name: "Project", path: "C:\\repo" }],
    worktrees: [worktree],
    autoRuns: [autoRun],
    workItems: [{
      id: "lwi_1",
      ownerTeamId: "team_1",
      projectId: "prj_1",
      status: status === "failed" ? "blocked" : "in_progress",
      state: "open",
      revision: 1,
      executionBindings: [{ kind: "auto_run", targetId: autoRun.id }],
    }],
    workItemActivities: [],
    codexApprovalBrokerRequests: [{
      id: "cdx_1",
      invocationId: "inv_1",
      toolName: "Bash",
      status: "approved",
      decidedBy: "usr_owner",
    }],
    autoRunSettings: { maxRepairAttempts: 0, maxTimeoutRecoveryAttempts: 1 },
    device: { unlinkState: "linked" },
  };
  const invocations = [];
  const events = [];
  const service = createAutoRunService({
    state,
    now: () => "2026-07-26T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_next`,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
    findAgent: (id) => (id === agent.id ? agent : null),
    defaultAgent: () => agent,
    createInvocation: (task, selectedAgent, options) => {
      const invocation = {
        id: `inv_${invocations.length + 2}`,
        status: "queued",
        input: { task },
        options,
        agentId: selectedAgent.id,
      };
      invocations.push(invocation);
      return invocation;
    },
    startInvocationIfAllowed: () => {},
    fetchIssueBody,
  });
  return {
    service,
    state,
    autoRun,
    worktree,
    workItem: state.workItems[0],
    invocations,
    events,
  };
}

test("a genuine execution timeout gets one bounded approved continuation", async () => {
  const { service, state, autoRun, workItem, invocations } = fixture();
  await service.advanceAutoRunForInvocation({
    id: "inv_1",
    status: "timed_out",
    result: { errorCode: "execution_timeout" },
  });

  assert.equal(autoRun.status, "running");
  assert.equal(autoRun.invocationId, "inv_2");
  assert.equal(autoRun.timeoutRecoveryAttempts, 1);
  assert.equal(workItem.status, "in_progress");
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].options.timeoutSeconds, 900);
  assert.equal(invocations[0].options.preApproved, true);
  assert.equal(invocations[0].options.codexSessionMode, "continue_last");
  assert.equal(invocations[0].options.resumeFromInvocationId, "inv_1");
  assert.match(invocations[0].options.idempotencyKey, /execution-timeout:inv_1:1$/);
  assert.equal(invocations[0].options.metadata.codexApprovalContinuationRequestId, "cdx_1");
  assert.equal(invocations[0].options.metadata.timeoutRecoverySourceInvocationId, "inv_1");
  assert.equal(state.codexApprovalBrokerRequests[0].continuationGrant.targetInvocationId, invocations[0].id);
  assert.match(invocations[0].input.task, /do not rerun the last command verbatim/i);
  assert.equal(autoRun.timeoutRecovery.targetInvocationId, "inv_2");
  assert.equal(autoRun.timeoutRecovery.status, "dispatched");

  await service.advanceAutoRunForInvocation({
    id: "inv_2",
    status: "timed_out",
    result: { errorCode: "execution_timeout" },
  });
  assert.equal(autoRun.status, "failed");
  assert.equal(workItem.status, "blocked");
  assert.equal(invocations.length, 1, "timeout recovery is capped and cannot loop");
});

test("a historical timed_out record without execution_timeout is not auto-resumed", async () => {
  const { service, autoRun, invocations } = fixture();
  await service.advanceAutoRunForInvocation({
    id: "inv_1",
    status: "timed_out",
    result: {},
  });
  assert.equal(autoRun.status, "failed");
  assert.equal(invocations.length, 0);
});

test("an approval timeout blocks for a human decision and never fails over or auto-executes", async () => {
  const { service, autoRun, workItem, invocations } = fixture();
  await service.advanceAutoRunForInvocation({
    id: "inv_1",
    status: "timed_out",
    result: { errorCode: "approval_timeout" },
  });

  assert.equal(autoRun.status, "failed");
  assert.equal(autoRun.errorCode, "approval_timeout");
  assert.equal(workItem.status, "blocked");
  assert.equal(invocations.length, 0);
});

test("late approval retry uses the stored body and carries an exact continuation grant", async () => {
  const { service, state, autoRun, workItem, invocations } = fixture({ status: "failed" });
  state.codexApprovalBrokerRequests = [{
    id: "cdx_late",
    invocationId: "inv_1",
    toolName: "Bash",
    status: "timed_out",
    lateApprovalRecovery: {
      status: "starting",
      autoRunId: autoRun.id,
      claimToken: "claim_late",
    },
  }];

  const result = await service.retryAutoRun(autoRun.id, {
    actor: { userId: "usr_owner" },
    approvalRecoveryRequestId: "cdx_late",
    approvalRecoveryClaimToken: "claim_late",
  });
  assert.equal(result.invocation.id, "inv_2");
  assert.equal(invocations[0].options.preApproved, true);
  assert.equal(invocations[0].options.timeoutSeconds, 900);
  assert.equal(invocations[0].options.metadata.codexApprovalContinuationRequestId, "cdx_late");
  assert.match(invocations[0].input.task, /APPROVED ORIGINAL BODY/);
  assert.equal(
    state.codexApprovalBrokerRequests[0].lateApprovalRecovery.targetInvocationId,
    "inv_2",
  );
  assert.equal(workItem.status, "in_progress", "the bound local issue leaves blocked when recovery starts");
});

test("a normal retry of a local issue keeps its stored acceptance context", async () => {
  const { service, autoRun, invocations } = fixture({ status: "failed" });
  await service.retryAutoRun(autoRun.id, { actor: { userId: "usr_owner" } });
  assert.match(invocations[0].input.task, /APPROVED ORIGINAL BODY/);
});

test("a retry after approval_timeout resumes the newest execution-timeout checkpoint in the same run", async () => {
  const { service, state, autoRun, invocations } = fixture({ status: "failed" });
  state.invocations = [
    {
      id: "inv_approval_timeout",
      status: "failed",
      result: { errorCode: "approval_timeout" },
      worktreeId: "wtr_1",
      options: { metadata: { autoRunId: "aur_1", worktreeId: "wtr_1" } },
      requestedBy: "usr_owner",
    },
    {
      id: "inv_execution_timeout",
      status: "timed_out",
      result: { errorCode: "execution_timeout", output: { latestMessage: "Finished orientation." } },
      worktreeId: "wtr_1",
      options: { metadata: { autoRunId: "aur_1", worktreeId: "wtr_1" } },
      requestedBy: "usr_owner",
    },
    {
      id: "inv_foreign_timeout",
      status: "timed_out",
      result: { errorCode: "execution_timeout" },
      worktreeId: "wtr_other",
      options: { metadata: { autoRunId: "aur_other", worktreeId: "wtr_other" } },
    },
  ];
  state.codexApprovalBrokerRequests.unshift({
    id: "cdx_execution_timeout",
    invocationId: "inv_execution_timeout",
    toolName: "Bash",
    status: "approved",
    decidedBy: "usr_owner",
  });
  autoRun.invocationId = "inv_approval_timeout";

  await service.retryAutoRun(autoRun.id, { actor: { userId: "usr_owner" } });

  assert.equal(invocations[0].options.codexSessionMode, "continue_last");
  assert.equal(invocations[0].options.resumeFromInvocationId, "inv_execution_timeout");
  assert.equal(invocations[0].options.preApproved, true);
  assert.equal(invocations[0].options.metadata.codexApprovalContinuationRequestId, "cdx_execution_timeout");
  assert.equal(invocations[0].options.metadata.timeoutRecoverySourceInvocationId, "inv_execution_timeout");
  assert.match(invocations[0].input.task, /Finished orientation/);
  assert.equal(
    state.codexApprovalBrokerRequests[0].continuationGrant.targetInvocationId,
    invocations[0].id,
  );
});

test("manual timeout retry carries an unconsumed approved child through the exact recovery thread", async () => {
  const { service, state, autoRun, invocations } = fixture({ status: "failed" });
  state.invocations = [
    {
      id: "inv_cancelled_continuation",
      status: "cancelled",
      worktreeId: "wtr_1",
      requestedBy: "usr_owner",
      options: {
        codexResumeSessionId: "thread_exact",
        metadata: { autoRunId: "aur_1", worktreeId: "wtr_1" },
      },
    },
    {
      id: "inv_execution_timeout",
      status: "timed_out",
      result: { errorCode: "execution_timeout", output: { latestMessage: "Commit already exists." } },
      worktreeId: "wtr_1",
      requestedBy: "usr_owner",
      options: {
        codexResumeSessionId: "thread_exact",
        metadata: { autoRunId: "aur_1", worktreeId: "wtr_1" },
      },
    },
    {
      id: "inv_foreign",
      status: "cancelled",
      worktreeId: "wtr_other",
      requestedBy: "usr_owner",
      options: {
        codexResumeSessionId: "thread_exact",
        metadata: { autoRunId: "aur_other", worktreeId: "wtr_other" },
      },
    },
  ];
  state.codexApprovalBrokerRequests = [
    {
      id: "cdx_foreign_child",
      invocationId: "inv_foreign",
      toolName: "Bash",
      status: "approved",
      recoveredFromApprovalRequestId: "cdx_foreign_parent",
      decidedBy: "usr_owner",
    },
    {
      id: "cdx_exact_child",
      invocationId: "inv_cancelled_continuation",
      toolName: "Bash",
      status: "approved",
      recoveredFromApprovalRequestId: "cdx_exact_parent",
      decidedBy: "usr_owner",
    },
    {
      id: "cdx_exact_parent",
      invocationId: "inv_execution_timeout",
      toolName: "Bash",
      status: "approved",
      decidedBy: "usr_owner",
      continuationGrant: {
        targetInvocationId: "inv_cancelled_continuation",
        autoRunId: "aur_1",
        worktreeId: "wtr_1",
      },
    },
  ];
  autoRun.invocationId = "inv_cancelled_continuation";

  await service.retryAutoRun(autoRun.id, { actor: { userId: "usr_owner" } });

  assert.equal(invocations[0].options.preApproved, true);
  assert.equal(invocations[0].options.resumeFromInvocationId, "inv_execution_timeout");
  assert.equal(
    invocations[0].options.metadata.codexApprovalContinuationRequestId,
    "cdx_exact_child",
  );
  assert.equal(
    state.codexApprovalBrokerRequests[1].continuationGrant.targetInvocationId,
    invocations[0].id,
  );
});

test("a late-approval recovery wins safely against a concurrent manual retry", async () => {
  let releaseIssueFetch;
  const issueBody = new Promise((resolve) => {
    releaseIssueFetch = resolve;
  });
  const { service, state, autoRun, invocations } = fixture({
    status: "failed",
    linkType: "issue",
    fetchIssueBody: () => issueBody,
  });
  state.codexApprovalBrokerRequests = [{
    id: "cdx_late",
    invocationId: "inv_1",
    toolName: "Bash",
    status: "timed_out",
    lateApprovalRecovery: {
      status: "starting",
      autoRunId: autoRun.id,
      claimToken: "claim_late",
    },
  }];

  const manualRetry = service.retryAutoRun(autoRun.id, {
    actor: { userId: "usr_owner" },
  });
  const recovered = await service.retryAutoRun(autoRun.id, {
    actor: { userId: "usr_owner" },
    approvalRecoveryRequestId: "cdx_late",
    approvalRecoveryClaimToken: "claim_late",
  });
  releaseIssueFetch("LIVE EDITED BODY");

  assert.equal(recovered.invocation.id, "inv_2");
  await assert.rejects(manualRetry, /another retry has already started/i);
  assert.equal(invocations.length, 1, "the race creates exactly one continuation invocation");
});
