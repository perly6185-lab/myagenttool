import assert from "node:assert/strict";
import test from "node:test";

import { createWorkItemReviewCommandService } from "../src/services/work-item-review-command.mjs";

function deliveryHarness({ canProceed = true, operation = "apply_local_changes", completeFailures = 0 } = {}) {
  let sequence = 0;
  let promotionCount = 0;
  let transactionCount = 0;
  let completionAttempts = 0;
  let remainingCompleteFailures = completeFailures;
  const current = "2026-08-28T02:00:00.000Z";
  const item = {
    id: "lwi_1",
    localRef: "LOCAL-1",
    title: "Apply reviewed result",
    body: "Apply it safely.",
    revision: 4,
    status: "review",
    state: "open",
    completionGate: { ready: true },
    executionContractGate: { ready: true },
  };
  const autoRun = {
    id: "aur_1",
    status: "done",
    invocationId: "inv_1",
    localDelivery: { worktreeId: "wtr_1", deliveredAt: null },
  };
  const state = {
    autoRuns: [autoRun],
    executionActionIdempotencyRecords: [],
    workItems: [{ id: item.id, revision: item.revision, executionBindings: [{ kind: "auto_run", targetId: autoRun.id }] }],
  };
  const getWorkItem = () => ({
    ok: true,
    status: 200,
    body: {
      workItem: { ...item },
      observability: {
        latestRun: {
          id: autoRun.id,
          status: autoRun.status,
          localDelivery: { ...autoRun.localDelivery },
        },
        deliveryEvidence: {
          status: canProceed ? "ready" : "verification_missing",
          risk: canProceed ? "low" : "medium",
          blockingReasonCodes: canProceed ? [] : ["verification_required"],
          actionPreview: { operation, canProceed },
        },
      },
    },
  });
  const service = createWorkItemReviewCommandService({
    state,
    now: () => current,
    nextId: (prefix) => `${prefix}_${++sequence}`,
    store: { transaction: (fn) => { transactionCount += 1; return fn(); } },
    getWorkItem,
    retryAutoRun: async () => ({}),
    reverifyAutoRun: async () => ({}),
    answerClarify: async () => ({}),
    beginDelivery: () => ({ ok: true, status: 201, body: { operation: { id: "wdo_1" } } }),
    failDelivery: () => ({ ok: true }),
    completeDelivery: ({ result }) => {
      completionAttempts += 1;
      if (remainingCompleteFailures > 0) {
        remainingCompleteFailures -= 1;
        return { ok: false, status: 503, body: { error: "delivery_commit_temporarily_unavailable" } };
      }
      autoRun.localDelivery = { ...autoRun.localDelivery, deliveredAt: result.deliveredAt };
      item.revision += 1;
      item.status = "done";
      item.state = "closed";
      state.workItems[0].revision = item.revision;
      return {
        ok: true,
        status: 200,
        body: { workItem: { ...item }, autoRun, delivery: autoRun.localDelivery },
      };
    },
    promoteWorktreeToBase: async () => {
      promotionCount += 1;
      return { baseBranch: "main", commit: "abc123", deliveredAt: current };
    },
    promoteWorktreeToPullRequest: async () => {
      promotionCount += 1;
      return { number: 7, url: "https://example.test/pull/7", deliveredAt: current };
    },
  });
  return {
    service,
    state,
    autoRun,
    item,
    promotionCount: () => promotionCount,
    completionAttempts: () => completionAttempts,
    transactionCount: () => transactionCount,
  };
}

test("dispatches retry, AI repair, verification, and clarification through one command boundary", async () => {
  const calls = [];
  const service = createWorkItemReviewCommandService({
    retryAutoRun: async (id, options) => { calls.push(["retry", id, options]); return { actionReceipt: { kind: options.feedback ? "fix_with_ai" : "retry_execution" } }; },
    reverifyAutoRun: async (id, options) => { calls.push(["verify", id, options]); return { actionReceipt: { kind: "rerun_verification" } }; },
    answerClarify: async (id, options) => { calls.push(["answer", id, options]); return { actionReceipt: { kind: "answer_ai" } }; },
  });
  const actor = { userId: "usr_1" };

  await service.execute({ kind: "retry_execution", targetId: "aur_1", request: { feedback: "ignored", idempotencyKey: "retry-1" } }, actor);
  await service.execute({ kind: "fix_with_ai", targetId: "aur_1", request: { feedback: "Fix the failed check.", idempotencyKey: "fix-1" } }, actor);
  await service.execute({ kind: "rerun_verification", targetId: "aur_1", request: { idempotencyKey: "verify-1" } }, actor);
  await service.execute({ kind: "answer_ai", targetId: "aur_1", request: { answers: "Use option A.", idempotencyKey: "answer-1" } }, actor);

  assert.deepEqual(calls.map(([kind]) => kind), ["retry", "retry", "verify", "answer"]);
  assert.equal(calls[0][2].feedback, null);
  assert.equal(calls[1][2].feedback, "Fix the failed check.");
  assert.equal(calls[2][2].actor, actor);
  assert.equal(calls[3][2].answers, "Use option A.");
});

test("returns one standard receipt for local and office delivery and replays its durable key", async () => {
  const h = deliveryHarness({ operation: "apply_office_result" });
  const command = {
    kind: "apply_office_result",
    targetId: h.item.id,
    request: {
      expectedWorkItemRevision: 4,
      expectedTargetStatus: "done",
      idempotencyKey: "deliver-once",
    },
  };

  const delivered = await h.service.execute(command, { userId: "usr_1" });
  assert.equal(delivered.actionReceipt.kind, "apply_office_result");
  assert.equal(delivered.actionReceipt.status, "succeeded");
  assert.equal(delivered.actionReceipt.messageCode, "office_result_applied");
  assert.equal(delivered.actionReceipt.impact, "applied");
  assert.equal(delivered.actionReceipt.targetId, "abc123");
  assert.equal(delivered.autoRun.executionActionReceipts, undefined);
  assert.equal(h.promotionCount(), 1);
  assert.equal(h.state.executionActionIdempotencyRecords.length, 1);
  assert.equal(h.transactionCount(), 4, "accepted, external start, external result checkpoint, and success commit transactionally");

  const replayed = await h.service.execute(command, { userId: "usr_1" });
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.actionReceipt.replayed, true);
  assert.equal(replayed.actionReceipt.id, delivered.actionReceipt.id);
  assert.equal(h.promotionCount(), 1);
});

test("records a failed standard receipt when delivery evidence blocks execution", async () => {
  const h = deliveryHarness({ canProceed: false });

  await assert.rejects(
    h.service.execute({
      kind: "apply_local_changes",
      targetId: h.item.id,
      request: { expectedWorkItemRevision: 4, idempotencyKey: "blocked-delivery" },
    }, { userId: "usr_1" }),
    (error) => {
      assert.equal(error.code, "work_item_delivery_evidence_not_ready");
      assert.equal(error.status, 409);
      assert.deepEqual(error.details.blockingReasonCodes, ["verification_required"]);
      assert.equal(error.actionReceipt.kind, "apply_local_changes");
      assert.equal(error.actionReceipt.status, "failed");
      assert.equal(error.actionReceipt.impact, "none");
      return true;
    },
  );
  assert.equal(h.promotionCount(), 0);

  await assert.rejects(
    h.service.execute({
      kind: "apply_local_changes",
      targetId: h.item.id,
      request: { expectedWorkItemRevision: 4, idempotencyKey: "blocked-delivery" },
    }, { userId: "usr_1" }),
    (error) => {
      assert.equal(error.code, "work_item_delivery_evidence_not_ready");
      assert.equal(error.actionReceipt.status, "failed");
      assert.equal(error.actionReceipt.replayed, true);
      return true;
    },
  );
  assert.equal(h.promotionCount(), 0);
});

test("development and office delivery resume from the external-result checkpoint without repeating the side effect", async () => {
  for (const kind of ["create_pull_request", "apply_office_result"]) {
    const h = deliveryHarness({ operation: kind, completeFailures: 1 });
    const command = {
      kind,
      targetId: h.item.id,
      request: {
        expectedWorkItemRevision: 4,
        expectedTargetStatus: "done",
        idempotencyKey: `${kind}-recover-once`,
      },
    };

    await assert.rejects(h.service.execute(command, { userId: "usr_1" }), (error) => {
      assert.equal(error.code, "delivery_commit_temporarily_unavailable");
      assert.equal(error.actionReceipt.status, "unknown");
      assert.equal(error.actionReceipt.impact, "unknown");
      return true;
    });
    assert.equal(h.promotionCount(), 1);
    assert.equal(h.completionAttempts(), 1);
    assert.equal(h.autoRun.executionActionReceipts[0].externalActionAttemptCount, 1);
    assert.equal(h.autoRun.executionActionReceipts[0].deliveryRecovery.requiredAt, "2026-08-28T02:00:00.000Z");
    assert.equal(h.autoRun.executionActionReceipts[0].deliveryRecovery.recoveredAt, null);

    await assert.rejects(h.service.execute({
      ...command,
      request: { ...command.request, idempotencyKey: `${kind}-unsafe-second-key` },
    }, { userId: "usr_1" }), (error) => {
      assert.equal(error.code, "execution_action_delivery_unresolved");
      assert.equal(error.actionReceipt.status, "unknown");
      return true;
    });
    assert.equal(h.promotionCount(), 1, "a different request key cannot repeat an unresolved external action");

    const recovered = await h.service.execute(command, { userId: "usr_1" });
    assert.equal(recovered.replayed, true);
    assert.equal(recovered.actionReceipt.status, "succeeded");
    assert.equal(recovered.actionReceipt.messageCode, kind === "create_pull_request"
      ? "pull_request_created"
      : "office_result_applied");
    assert.equal(h.promotionCount(), 1, "recovery commits the checkpoint instead of repeating delivery");
    assert.equal(h.completionAttempts(), 2);
    assert.equal(h.autoRun.executionActionReceipts[0].externalActionAttemptCount, 1);
    assert.equal(h.autoRun.executionActionReceipts[0].deliveryRecovery.attempts, 1);
    assert.equal(h.autoRun.executionActionReceipts[0].deliveryRecovery.recoveredAt, "2026-08-28T02:00:00.000Z");
  }
});

test("records failed checkpoint recovery attempts until a later replay succeeds", async () => {
  const h = deliveryHarness({ operation: "apply_local_changes", completeFailures: 2 });
  const command = {
    kind: "apply_local_changes",
    targetId: h.item.id,
    request: { expectedWorkItemRevision: 4, expectedTargetStatus: "done", idempotencyKey: "recover-after-two" },
  };

  await assert.rejects(h.service.execute(command, { userId: "usr_1" }), (error) => {
    assert.equal(error.actionReceipt.status, "unknown");
    return true;
  });
  await assert.rejects(h.service.execute(command, { userId: "usr_1" }), (error) => {
    assert.equal(error.code, "work_item_delivery_recovery_pending");
    assert.equal(error.actionReceipt.status, "unknown");
    return true;
  });
  assert.equal(h.autoRun.executionActionReceipts[0].deliveryRecovery.attempts, 1);
  assert.equal(h.autoRun.executionActionReceipts[0].deliveryRecovery.recoveredAt, null);

  const recovered = await h.service.execute(command, { userId: "usr_1" });
  assert.equal(recovered.actionReceipt.status, "succeeded");
  assert.equal(h.autoRun.executionActionReceipts[0].deliveryRecovery.attempts, 2);
  assert.equal(h.promotionCount(), 1);
});
