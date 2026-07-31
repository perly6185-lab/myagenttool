import assert from "node:assert/strict";
import test from "node:test";

import { createAutoRunService } from "../src/services/auto-run.mjs";

function fixture({
  status = "running",
  linkType = "local_issue",
  fetchIssueBody,
  maxCapacityRetryAttempts = 3,
  maxTimeoutRecoveryAttempts = 1,
  maxNoProgressTimeouts = 2,
  turnTimeoutSeconds = 900,
  totalExecutionBudgetSeconds = 2700,
  commitWorktreeChanges,
  verifyWorktree,
  acquireWorktreeReactionLease,
  releaseWorktreeReactionLease,
} = {}) {
  let currentTimeMs = Date.parse("2026-07-26T00:00:00.000Z");
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
    autoRunSettings: {
      maxRepairAttempts: 0,
      maxTimeoutRecoveryAttempts,
      maxNoProgressTimeouts,
      turnTimeoutSeconds,
      totalExecutionBudgetSeconds,
      maxCapacityRetryAttempts,
      globalMaxConcurrent: 1,
    },
    device: { unlinkState: "linked" },
  };
  const invocations = [];
  const events = [];
  const service = createAutoRunService({
    state,
    now: () => new Date(currentTimeMs).toISOString(),
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
    commitWorktreeChanges,
    verifyWorktree,
    acquireWorktreeReactionLease,
    releaseWorktreeReactionLease,
  });
  return {
    service,
    state,
    autoRun,
    worktree,
    workItem: state.workItems[0],
    invocations,
    events,
    advanceTime: (milliseconds) => {
      currentTimeMs += milliseconds;
    },
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
  assert.equal(autoRun.status, "blocked");
  assert.equal(autoRun.errorCode, "timeout_retries_exhausted");
  assert.equal(workItem.status, "blocked");
  assert.equal(invocations.length, 1, "timeout recovery is capped and cannot loop");
});

test("a lost app-server transport resumes on the same approved worktree", async () => {
  const { service, autoRun, worktree, invocations, events } = fixture();
  await service.advanceAutoRunForInvocation({
    id: "inv_1",
    status: "failed",
    result: { errorCode: "transport_closed" },
  });

  assert.equal(autoRun.status, "running");
  assert.equal(autoRun.worktreeId, worktree.id);
  assert.equal(autoRun.invocationId, "inv_2");
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].options.resumeFromInvocationId, "inv_1");
  assert.equal(invocations[0].options.preApproved, true);
  assert.equal(invocations[0].options.metadata.timeoutRecoveryReason, "transport_closed");
  assert.match(invocations[0].options.idempotencyKey, /transport-closed:inv_1:1$/);
  assert.ok(events.some((event) =>
    event.type === "auto_run_retried" && event.data?.reason === "transport_closed"));
});

test("a stale success reaction cannot settle a newer timeout continuation", async () => {
  let releaseVerification;
  let markVerificationStarted;
  let verificationSignal;
  const leases = [];
  const verificationStarted = new Promise((resolve) => {
    markVerificationStarted = resolve;
  });
  const verificationResult = new Promise((resolve) => {
    releaseVerification = resolve;
  });
  const { service, autoRun, invocations, events } = fixture({
    commitWorktreeChanges: async () => ({ hasCommits: true }),
    verifyWorktree: async ({ signal }) => {
      verificationSignal = signal;
      markVerificationStarted();
      return verificationResult;
    },
    acquireWorktreeReactionLease: (worktreeId, invocationId) => {
      leases.push(`acquire:${worktreeId}:${invocationId}`);
      return true;
    },
    releaseWorktreeReactionLease: (worktreeId, invocationId) => {
      leases.push(`release:${worktreeId}:${invocationId}`);
    },
  });

  const staleSuccessReaction = service.advanceAutoRunForInvocation({
    id: "inv_1",
    status: "succeeded",
    result: { summary: "old process reported success" },
  });
  await verificationStarted;

  await service.advanceAutoRunForInvocation({
    id: "inv_1",
    status: "failed",
    result: { errorCode: "transport_closed" },
  });
  assert.equal(autoRun.invocationId, "inv_2");
  assert.equal(autoRun.status, "running");
  assert.equal(invocations.length, 1);
  assert.equal(verificationSignal.aborted, true, "the stale verifier receives a real abort signal");

  releaseVerification({ passed: true, verified: true, summary: "checks passed" });
  assert.equal(await staleSuccessReaction, null);
  assert.equal(autoRun.invocationId, "inv_2");
  assert.equal(autoRun.status, "running", "the old completion cannot mark the continuation done");
  assert.equal(autoRun.localDelivery, undefined);
  assert.deepEqual(leases, [
    `acquire:${autoRun.worktreeId}:inv_1`,
    `release:${autoRun.worktreeId}:inv_1`,
  ]);
  assert.ok(events.some((event) =>
    event.type === "auto_run_reaction_superseded"
    && event.data?.staleInvocationId === "inv_1"
    && event.data?.currentInvocationId === "inv_2"));
});

test("a duplicate terminal notification does not abort its active success reaction", async () => {
  let releaseVerification;
  let markVerificationStarted;
  let verificationSignal;
  let commitCalls = 0;
  let verificationCalls = 0;
  const verificationStarted = new Promise((resolve) => {
    markVerificationStarted = resolve;
  });
  const verificationResult = new Promise((resolve) => {
    releaseVerification = resolve;
  });
  const { service, autoRun } = fixture({
    commitWorktreeChanges: async () => {
      commitCalls += 1;
      return { hasCommits: true };
    },
    verifyWorktree: async ({ signal }) => {
      verificationCalls += 1;
      verificationSignal = signal;
      markVerificationStarted();
      return verificationResult;
    },
    acquireWorktreeReactionLease: () => true,
    releaseWorktreeReactionLease: () => {},
  });
  const invocation = {
    id: "inv_1",
    status: "succeeded",
    result: { summary: "completed" },
  };

  const activeReaction = service.advanceAutoRunForInvocation(invocation);
  await verificationStarted;
  const duplicateResult = await service.advanceAutoRunForInvocation(invocation);

  assert.equal(duplicateResult, null);
  assert.equal(verificationSignal.aborted, false);
  assert.equal(commitCalls, 1);
  assert.equal(verificationCalls, 1);

  releaseVerification({ passed: true, verified: true, summary: "checks passed" });
  await activeReaction;
  assert.equal(autoRun.status, "done");
});

test("a progressing long task can use three bounded timeout continuations", async () => {
  const { service, autoRun, invocations } = fixture({
    maxTimeoutRecoveryAttempts: 3,
    turnTimeoutSeconds: 1200,
    totalExecutionBudgetSeconds: 7200,
  });

  for (let index = 0; index < 3; index += 1) {
    const sourceId = index === 0 ? "inv_1" : `inv_${index + 1}`;
    const source = index === 0 ? {} : invocations[index - 1];
    await service.advanceAutoRunForInvocation({
      ...source,
      id: sourceId,
      status: "timed_out",
      result: {
        errorCode: "execution_timeout",
        output: { latestMessage: `Completed checkpoint ${index + 1}.` },
        continuationCheckpoint: { changedFiles: [`src/step-${index + 1}.mjs`] },
      },
    });
    assert.equal(autoRun.status, "running");
    assert.equal(autoRun.timeoutRecoveryAttempts, index + 1);
  }

  assert.equal(invocations.length, 3);
  assert.ok(invocations.every((invocation) => invocation.options.timeoutSeconds === 1200));
  assert.equal(invocations[1].options.preApproved, true, "approval authority follows the exact continuation chain");
  assert.equal(autoRun.executionBudget.noProgressStreak, 0);
  assert.equal(autoRun.executionStage, "implementation");
});

test("two consecutive timeout checkpoints without progress stop the continuation loop", async () => {
  const { service, autoRun, invocations } = fixture({
    maxTimeoutRecoveryAttempts: 3,
    totalExecutionBudgetSeconds: 7200,
  });
  const timeout = (id, source = {}) => service.advanceAutoRunForInvocation({
    ...source,
    id,
    status: "timed_out",
    result: {
      errorCode: "execution_timeout",
      output: { latestMessage: "Still inspecting the same area." },
      continuationCheckpoint: { changedFiles: [] },
    },
  });

  await timeout("inv_1");
  await timeout("inv_2", invocations[0]);
  assert.equal(autoRun.status, "running");
  assert.equal(autoRun.executionBudget.noProgressStreak, 1);
  await timeout("inv_3", invocations[1]);

  assert.equal(autoRun.status, "blocked");
  assert.equal(autoRun.errorCode, "timeout_no_progress");
  assert.equal(autoRun.executionBudget.noProgressStreak, 2);
  assert.equal(invocations.length, 2);
});

test("the total task budget stops an otherwise progressing continuation", async () => {
  const { service, autoRun, invocations, advanceTime } = fixture({
    maxTimeoutRecoveryAttempts: 3,
    totalExecutionBudgetSeconds: 600,
  });
  await service.advanceAutoRunForInvocation({
    id: "inv_1",
    status: "timed_out",
    result: {
      errorCode: "execution_timeout",
      output: { latestMessage: "First checkpoint." },
    },
  });
  advanceTime(600_000);
  await service.advanceAutoRunForInvocation({
    ...invocations[0],
    id: "inv_2",
    status: "timed_out",
    result: {
      errorCode: "execution_timeout",
      output: { latestMessage: "Second checkpoint." },
    },
  });

  assert.equal(autoRun.status, "blocked");
  assert.equal(autoRun.errorCode, "timeout_budget_exhausted");
  assert.equal(invocations.length, 1);
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

test("model capacity waits durably, releases its slot, and resumes the same worktree", async () => {
  const { service, autoRun, workItem, invocations, events, advanceTime } = fixture();
  await service.advanceAutoRunForInvocation({
    id: "inv_1",
    status: "failed",
    requestedBy: "usr_owner",
    summary: "Selected model is at capacity. Please try a different model.",
    result: { errorCode: "provider_capacity" },
  });

  assert.equal(autoRun.status, "waiting_capacity");
  assert.equal(autoRun.errorCode, "provider_capacity");
  assert.equal(autoRun.capacityRetry.attempt, 1);
  assert.equal(autoRun.capacityRetry.delayMs, 30_000);
  assert.equal(workItem.status, "in_progress");
  assert.equal(invocations.length, 0);

  const early = await service.reapStuckAutoRuns();
  assert.equal(early.capacityRetried, 0);
  advanceTime(30_000);
  const due = await service.reapStuckAutoRuns();

  assert.equal(due.capacityRetried, 1);
  assert.equal(autoRun.status, "running");
  assert.equal(autoRun.invocationId, "inv_2");
  assert.equal(autoRun.capacityRetry.status, "dispatched");
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].options.preApproved, true);
  assert.equal(invocations[0].options.codexSessionMode, "continue_last");
  assert.equal(invocations[0].options.resumeFromInvocationId, "inv_1");
  assert.equal(invocations[0].options.metadata.worktreeId, "wtr_1");
  assert.equal(invocations[0].options.metadata.capacityRetryAttempt, 1);
  assert.match(invocations[0].input.task, /existing worktree/i);
  assert.ok(events.some((event) => event.type === "auto_run_capacity_waiting"));
  assert.ok(events.some((event) => event.type === "auto_run_capacity_retried"));
});

test("model-capacity retries are bounded and become blocked instead of looping forever", async () => {
  const { service, autoRun, workItem, invocations, advanceTime } = fixture({
    maxCapacityRetryAttempts: 1,
  });
  await service.advanceAutoRunForInvocation({
    id: "inv_1",
    status: "failed",
    result: { errorCode: "provider_capacity" },
  });
  advanceTime(30_000);
  await service.reapStuckAutoRuns();
  assert.equal(invocations.length, 1);

  await service.advanceAutoRunForInvocation({
    id: "inv_2",
    status: "failed",
    result: { errorCode: "provider_capacity" },
  });

  assert.equal(autoRun.status, "blocked");
  assert.equal(autoRun.errorCode, "provider_capacity");
  assert.equal(autoRun.capacityRetry.status, "exhausted");
  assert.equal(workItem.status, "blocked");
  assert.equal(invocations.length, 1);
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
