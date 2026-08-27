import assert from "node:assert/strict";
import test from "node:test";

import {
  beginExecutionAction,
  EXECUTION_ACTION_IDEMPOTENCY_LEDGER_LIMIT,
  latestExecutionActionReceipt,
  reconcileExecutionActionReceipt,
  replayExecutionAction,
  updateExecutionAction,
} from "../src/services/work-item-execution-action.mjs";

function harness() {
  let sequence = 0;
  let current = "2026-08-27T01:00:00.000Z";
  const autoRun = { id: "aur_1", status: "failed", invocationId: "inv_failed" };
  const state = {
    autoRuns: [autoRun],
    workItems: [{ id: "lwi_1", revision: 4, executionBindings: [{ kind: "auto_run", targetId: autoRun.id }] }],
  };
  return {
    state,
    autoRun,
    now: () => current,
    nextId: (prefix) => `${prefix}_${++sequence}`,
    advance(value) { current = value; },
  };
}

test("persists one bounded execution action and replays the same request key", () => {
  const h = harness();
  const started = beginExecutionAction({
    state: h.state,
    autoRun: h.autoRun,
    kind: "retry_execution",
    actor: { userId: "usr_1" },
    idempotencyKey: "retry-once",
    expectedWorkItemRevision: 4,
    expectedTargetStatus: "failed",
    request: { feedback: null },
    nextOwner: "ai",
    now: h.now,
    nextId: h.nextId,
  });
  updateExecutionAction(started.receipt, {
    status: "succeeded", messageCode: "retry_started", impact: "none", nextOwner: "ai", targetId: "inv_retry", now: h.now,
  });

  const replay = replayExecutionAction(h.autoRun, {
    kind: "retry_execution", idempotencyKey: "retry-once", request: { feedback: null },
  });
  assert.equal(replay.id, started.receipt.id);
  assert.equal(h.autoRun.executionActionReceipts.length, 1);
  assert.deepEqual(latestExecutionActionReceipt(h.autoRun, { now: h.now() }), {
    schemaVersion: 1,
    id: started.receipt.id,
    kind: "retry_execution",
    status: "succeeded",
    messageCode: "retry_started",
    impact: "none",
    nextOwner: "ai",
    requestedAt: "2026-08-27T01:00:00.000Z",
    updatedAt: "2026-08-27T01:00:00.000Z",
    completedAt: "2026-08-27T01:00:00.000Z",
    targetId: "inv_retry",
    errorCode: null,
    errorMessage: null,
    replayed: false,
  });
});

test("rejects stale review evidence before recording or executing an action", () => {
  const h = harness();
  assert.throws(() => beginExecutionAction({
    state: h.state,
    autoRun: h.autoRun,
    kind: "retry_execution",
    idempotencyKey: "stale-retry",
    expectedWorkItemRevision: 3,
    expectedTargetStatus: "failed",
    request: { feedback: null },
    now: h.now,
    nextId: h.nextId,
  }), (error) => {
    assert.equal(error.code, "execution_action_stale");
    assert.equal(error.status, 409);
    assert.equal(error.currentWorkItemRevision, 4);
    return true;
  });
  assert.deepEqual(h.autoRun.executionActionReceipts ?? [], []);
});

test("marks an abandoned accepted request safe to retry when its source target is unchanged", () => {
  const h = harness();
  beginExecutionAction({
    state: h.state,
    autoRun: h.autoRun,
    kind: "retry_execution",
    idempotencyKey: "lost-response",
    expectedWorkItemRevision: 4,
    expectedTargetStatus: "failed",
    request: { feedback: null },
    nextOwner: "ai",
    now: h.now,
    nextId: h.nextId,
  });
  h.advance("2026-08-27T01:11:00.000Z");

  const receipt = latestExecutionActionReceipt(h.autoRun, { now: h.now() });
  assert.equal(receipt.status, "safe_to_retry");
  assert.equal(receipt.impact, "none");
  assert.equal(receipt.nextOwner, "me");
  assert.equal(receipt.idempotencyKey, undefined);
  assert.equal(receipt.requestDigest, undefined);
});

test("reconciles a crash after target binding as a completed retry admission", () => {
  const h = harness();
  const { receipt } = beginExecutionAction({
    state: h.state,
    autoRun: h.autoRun,
    kind: "retry_execution",
    idempotencyKey: "crash-after-bind",
    request: { feedback: null },
    now: h.now,
    nextId: h.nextId,
  });
  h.autoRun.invocationId = "inv_retry";
  receipt.targetId = "inv_retry";
  receipt.status = "running";
  h.advance("2026-08-27T01:11:00.000Z");

  const result = reconcileExecutionActionReceipt(receipt, {
    autoRun: h.autoRun,
    findInvocation: (id) => id === "inv_retry" ? { id, status: "running" } : null,
    now: h.now(),
  });

  assert.equal(result.changed, true);
  assert.equal(receipt.status, "succeeded");
  assert.equal(receipt.messageCode, "retry_started");
  assert.equal(latestExecutionActionReceipt(h.autoRun, { now: h.now() }).targetId, "inv_retry");
});

test("recovers a target created immediately before a crash by its receipt correlation", () => {
  const h = harness();
  const { receipt } = beginExecutionAction({
    state: h.state,
    autoRun: h.autoRun,
    kind: "retry_execution",
    idempotencyKey: "crash-after-create",
    request: { feedback: null },
    now: h.now,
    nextId: h.nextId,
  });
  const target = { id: "inv_unbound_retry", status: "queued" };

  reconcileExecutionActionReceipt(receipt, {
    autoRun: h.autoRun,
    findInvocation: () => null,
    findTargetInvocation: (candidate) => candidate.id === receipt.id ? target : null,
    now: h.now(),
  });

  assert.equal(receipt.targetId, target.id);
  assert.equal(receipt.status, "succeeded");
  assert.equal(receipt.messageCode, "retry_started");
});

test("reconciles a crash before target creation as safe to retry", () => {
  const h = harness();
  const { receipt } = beginExecutionAction({
    state: h.state,
    autoRun: h.autoRun,
    kind: "fix_with_ai",
    idempotencyKey: "crash-before-target",
    request: { feedback: "Fix the failed check." },
    now: h.now,
    nextId: h.nextId,
  });
  h.advance("2026-08-27T01:11:00.000Z");

  const result = reconcileExecutionActionReceipt(receipt, {
    autoRun: h.autoRun,
    findInvocation: () => null,
    now: h.now(),
  });

  assert.equal(result.changed, true);
  assert.equal(receipt.status, "safe_to_retry");
  assert.equal(receipt.impact, "none");
  assert.equal(receipt.completedAt, h.now());
});

test("keeps a legacy receipt unknown when no source target can prove a retry is safe", () => {
  const h = harness();
  h.autoRun.executionActionReceipts = [{
    id: "ear_legacy",
    kind: "retry_execution",
    status: "accepted",
    messageCode: "request_accepted",
    impact: "none",
    nextOwner: "ai",
    requestedAt: "2026-08-27T01:00:00.000Z",
    updatedAt: "2026-08-27T01:00:00.000Z",
  }];
  h.advance("2026-08-27T01:11:00.000Z");

  const result = reconcileExecutionActionReceipt(h.autoRun.executionActionReceipts[0], {
    autoRun: h.autoRun,
    findInvocation: () => null,
    now: h.now(),
  });

  assert.equal(result.receipt.status, "unknown");
  assert.equal(result.receipt.impact, "unknown");
});

test("refuses reuse of one action key for different input", () => {
  const h = harness();
  beginExecutionAction({
    state: h.state,
    autoRun: h.autoRun,
    kind: "fix_with_ai",
    idempotencyKey: "fix-key",
    request: { feedback: "Fix the failed test." },
    now: h.now,
    nextId: h.nextId,
  });
  assert.throws(() => replayExecutionAction(h.autoRun, {
    kind: "fix_with_ai", idempotencyKey: "fix-key", request: { feedback: "Change the API too." },
  }), (error) => error.code === "execution_action_idempotency_conflict" && error.status === 409);
});

test("keeps old idempotency keys after their receipts leave the recent-20 display window", () => {
  const h = harness();
  const started = [];
  for (let index = 0; index < 21; index += 1) {
    const action = beginExecutionAction({
      state: h.state,
      autoRun: h.autoRun,
      kind: "retry_execution",
      idempotencyKey: `retry-${index}`,
      request: { feedback: `attempt-${index}` },
      now: h.now,
      nextId: h.nextId,
    });
    updateExecutionAction(action.receipt, {
      status: "succeeded",
      messageCode: "retry_started",
      nextOwner: "ai",
      targetId: `inv_retry_${index}`,
      now: h.now,
    });
    started.push(action.receipt);
  }

  assert.equal(h.autoRun.executionActionReceipts.length, 20);
  assert.equal(h.autoRun.executionActionReceipts.some((receipt) => receipt.id === started[0].id), false);
  assert.equal(h.autoRun.executionActionIdempotencyLedger.length, 21);

  const replay = replayExecutionAction(h.autoRun, {
    kind: "retry_execution",
    idempotencyKey: "retry-0",
    request: { feedback: "attempt-0" },
  });
  assert.equal(replay.id, started[0].id);
  assert.equal(replay.targetId, "inv_retry_0");
  assert.equal(replay.status, "succeeded");
  assert.throws(() => replayExecutionAction(h.autoRun, {
    kind: "retry_execution",
    idempotencyKey: "retry-0",
    request: { feedback: "different-request" },
  }), (error) => error.code === "execution_action_idempotency_conflict");
});

test("fails closed instead of evicting old keys when the long-term ledger reaches capacity", () => {
  const h = harness();
  const first = beginExecutionAction({
    state: h.state,
    autoRun: h.autoRun,
    kind: "retry_execution",
    idempotencyKey: "oldest-key",
    request: { feedback: null },
    now: h.now,
    nextId: h.nextId,
  });
  while (h.autoRun.executionActionIdempotencyLedger.length < EXECUTION_ACTION_IDEMPOTENCY_LEDGER_LIMIT) {
    const index = h.autoRun.executionActionIdempotencyLedger.length;
    h.autoRun.executionActionIdempotencyLedger.push({ idempotencyKey: `seed-${index}` });
  }

  assert.equal(replayExecutionAction(h.autoRun, {
    kind: "retry_execution",
    idempotencyKey: "oldest-key",
    request: { feedback: null },
  }).id, first.receipt.id);
  assert.throws(() => beginExecutionAction({
    state: h.state,
    autoRun: h.autoRun,
    kind: "retry_execution",
    idempotencyKey: "new-key-after-capacity",
    request: { feedback: null },
    now: h.now,
    nextId: h.nextId,
  }), (error) => error.code === "execution_action_idempotency_capacity" && error.status === 409);
  assert.equal(h.autoRun.executionActionIdempotencyLedger[0].idempotencyKey, "oldest-key");
  assert.equal(h.autoRun.executionActionReceipts.length, 1);
});

test("fails closed when an existing ledger key has lost its result snapshot", () => {
  const h = harness();
  h.autoRun.executionActionIdempotencyLedger = [{
    idempotencyKey: "damaged-key",
    kind: "retry_execution",
    requestDigest: "damaged-digest",
  }];

  assert.throws(() => beginExecutionAction({
    state: h.state,
    autoRun: h.autoRun,
    kind: "retry_execution",
    idempotencyKey: "damaged-key",
    request: { feedback: null },
    now: h.now,
    nextId: h.nextId,
  }), (error) => error.code === "execution_action_idempotency_evidence_missing" && error.status === 409);
  assert.deepEqual(h.autoRun.executionActionReceipts ?? [], []);
});
