import assert from "node:assert/strict";
import test from "node:test";

import { createCodexApprovalRecoveryService } from "../src/services/codex-approval-recovery.mjs";

function fixture({ runStatus = "failed", invocationStatus = "timed_out" } = {}) {
  const request = {
    id: "cdx_appr_1",
    invocationId: "inv_1",
    status: "timed_out",
    updatedAt: "2026-07-26T00:00:00.000Z",
  };
  const invocation = { id: "inv_1", status: invocationStatus };
  const run = { id: "aur_1", invocationId: invocation.id, status: runStatus };
  const state = {
    autoRuns: [run],
    invocations: [invocation],
    codexApprovalBrokerRequests: [request],
  };
  const retries = [];
  const events = [];
  let ticks = 0;
  const service = createCodexApprovalRecoveryService({
    state,
    now: () => `2026-07-26T00:00:0${ticks++}.000Z`,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
    findInvocation: (id) => state.invocations.find((row) => row.id === id),
    retryAutoRun: async (autoRunId, options) => {
      retries.push({ autoRunId, options });
      run.status = "running";
      run.invocationId = "inv_2";
      return { autoRun: run, invocation: { id: "inv_2", status: "queued" } };
    },
  });
  return { service, state, request, invocation, run, retries, events };
}

test("a late approval resumes a failed auto-run once on its existing recovery path", async () => {
  const { service, request, retries, events } = fixture();

  const recovery = await service.recoverTimedOutApproval(request, { userId: "usr_owner" });
  assert.equal(recovery.status, "resumed");
  assert.equal(recovery.resumedInvocationId, "inv_2");
  assert.equal(retries.length, 1);
  assert.equal(retries[0].autoRunId, "aur_1");
  assert.deepEqual(retries[0].options.actor, { userId: "usr_owner" });
  assert.equal(retries[0].options.approvalRecoveryRequestId, "cdx_appr_1");
  assert.match(retries[0].options.approvalRecoveryClaimToken, /^cdx_appr_1:1:/);
  assert.equal(events.at(0).type, "codex_approval_granted");
  assert.equal(events.at(0).data.lateApproval, true);

  const again = await service.recoverTimedOutApproval(request, { userId: "usr_owner" });
  assert.equal(again.status, "resumed");
  assert.equal(retries.length, 1, "repeated clicks cannot create duplicate recovery invocations");
});

test("a late approval waits for bridge completion, then resumes without a race", async () => {
  const { service, request, invocation, run, retries } = fixture({
    runStatus: "running",
    invocationStatus: "running",
  });

  const waiting = await service.recoverTimedOutApproval(request, { userId: "usr_owner" });
  assert.equal(waiting.status, "waiting_for_terminal");
  assert.equal(retries.length, 0);

  invocation.status = "timed_out";
  run.status = "failed";
  await service.resumeForSettledInvocation(invocation);
  assert.equal(request.lateApprovalRecovery.status, "resumed");
  assert.equal(retries.length, 1);
});

test("startup reconciliation recovers a durable starting claim after a restart", async () => {
  const { service, request, run, retries } = fixture();
  request.lateApprovalRecovery = {
    status: "starting",
    autoRunId: run.id,
    sourceInvocationId: request.invocationId,
    requestedAt: "2026-07-26T00:00:00.000Z",
    requestedBy: "usr_owner",
    startedAt: "2026-07-26T00:00:01.000Z",
    attempt: 1,
    claimToken: "old-process-claim",
    targetInvocationId: null,
  };

  await service.reconcilePendingRecoveries();
  assert.equal(request.lateApprovalRecovery.status, "resumed");
  assert.equal(retries.length, 1);
  assert.notEqual(retries[0].options.approvalRecoveryClaimToken, "old-process-claim");
});

test("startup reconciliation adopts an already-bound recovery invocation without duplicating it", async () => {
  const { service, state, request, run, retries } = fixture({ runStatus: "running" });
  state.invocations.push({ id: "inv_2", status: "queued" });
  run.invocationId = "inv_2";
  request.lateApprovalRecovery = {
    status: "starting",
    autoRunId: run.id,
    sourceInvocationId: request.invocationId,
    requestedBy: "usr_owner",
    startedAt: "2026-07-26T00:00:01.000Z",
    claimToken: "old-process-claim",
    targetInvocationId: "inv_2",
  };

  await service.reconcilePendingRecoveries();
  assert.equal(request.lateApprovalRecovery.status, "resumed");
  assert.equal(request.lateApprovalRecovery.resumedInvocationId, "inv_2");
  assert.equal(retries.length, 0);
});

test("a late approval cannot restart an auto-run that was cancelled", async () => {
  const { service, request, retries } = fixture({
    runStatus: "cancelled",
    invocationStatus: "timed_out",
  });

  const recovery = await service.recoverTimedOutApproval(request, { userId: "usr_owner" });
  assert.equal(recovery.status, "unavailable");
  assert.match(recovery.error, /cancelled.*not retryable/i);
  assert.equal(retries.length, 0);
});
