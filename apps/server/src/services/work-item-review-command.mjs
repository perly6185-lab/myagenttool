import {
  beginExecutionAction,
  executionActionReceiptView,
  replayExecutionAction,
  updateExecutionAction,
} from "./work-item-execution-action.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const AUTO_RUN_ACTIONS = new Set(["retry_execution", "fix_with_ai", "rerun_verification", "answer_ai"]);
const DELIVERY_ACTIONS = new Set([
  "create_pull_request",
  "update_pull_request",
  "apply_office_result",
  "apply_local_changes",
]);

function commandError(code, message, status = 400, details = {}, actionReceipt = null) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  error.details = details;
  if (actionReceipt) error.actionReceipt = actionReceipt;
  return error;
}

function resultError(result, actionReceipt = null) {
  const body = result?.body ?? {};
  const { error = "review_command_failed", message = error, ...details } = body;
  return commandError(error, message, result?.status ?? 400, details, actionReceipt);
}

function publicAutoRun(autoRun) {
  if (!autoRun) return autoRun;
  const {
    executionActionReceipts: _executionActionReceipts,
    executionActionIdempotencyLedger: _executionActionIdempotencyLedger,
    ...visible
  } = autoRun;
  return visible;
}

function deliveryMode(kind) {
  return ["create_pull_request", "update_pull_request"].includes(kind)
    ? "pull_request"
    : "local_merge";
}

function deliverySuccess(kind, result) {
  if (["create_pull_request", "update_pull_request"].includes(kind)) {
    return {
      messageCode: kind === "update_pull_request" ? "pull_request_updated" : "pull_request_created",
      impact: "proposed",
      nextOwner: "me",
      targetId: result?.url ?? (result?.number == null ? null : `pull_request:${result.number}`),
    };
  }
  return {
    messageCode: kind === "apply_office_result" ? "office_result_applied" : "local_changes_applied",
    impact: "applied",
    nextOwner: "none",
    targetId: result?.commit ?? result?.baseBranch ?? null,
  };
}

function requireTargetId(command) {
  const targetId = String(command?.targetId ?? "").trim();
  if (!targetId) throw commandError("review_command_target_required", "A review command target is required.");
  return targetId;
}

/**
 * One application-service boundary for every mutating action projected by the
 * task review read model. HTTP routes remain compatibility adapters; all
 * admission checks, execution dispatch, and receipt semantics live here.
 */
export function createWorkItemReviewCommandService({
  state,
  now = () => new Date().toISOString(),
  nextId,
  store = null,
  persistStateSoon = () => {},
  getWorkItem,
  retryAutoRun,
  reverifyAutoRun,
  answerClarify,
  restartLegacyExecutionAsAutoRun,
  promoteWorktreeToBase,
  promoteWorktreeToPullRequest,
  beginDelivery,
  failDelivery,
  completeDelivery,
} = {}) {
  const runTx = makeRunTx({ store, persistStateSoon });

  async function executeLegacyRestartCommand(command, actor) {
    const workItemId = requireTargetId(command);
    const request = command.request ?? {};
    const idempotencyKey = String(request.idempotencyKey ?? "").trim();
    if (!idempotencyKey) throw commandError("idempotency_key_required", "A recovery idempotency key is required.");
    if (!Number.isInteger(request.expectedWorkItemRevision)) {
      throw commandError("expected_revision_required", "The reviewed task revision is required.");
    }
    if (typeof restartLegacyExecutionAsAutoRun !== "function") {
      throw commandError("legacy_execution_recovery_unavailable", "Legacy execution recovery is unavailable.", 503);
    }

    const actionRequest = {
      restartAsAutoRun: true,
      workItemId,
      sourceTargetId: String(request.sourceTargetId ?? "").trim() || null,
    };
    const existingEntry = (state.executionActionIdempotencyRecords ?? []).find((entry) =>
      entry.idempotencyKey === idempotencyKey
      && entry.receipt?.recoveryWorkItemId === workItemId) ?? null;
    if (existingEntry) {
      const existingRun = (state.autoRuns ?? []).find((candidate) => candidate.id === existingEntry.autoRunId) ?? {
        id: existingEntry.autoRunId,
        localIssueId: workItemId,
        status: request.expectedTargetStatus ?? "failed",
        executionActionReceipts: [],
      };
      const replay = replayExecutionAction(existingRun, {
        kind: "retry_execution",
        idempotencyKey,
        request: actionRequest,
        state,
      });
      return {
        autoRun: publicAutoRun((state.autoRuns ?? []).find((candidate) => candidate.id === existingEntry.autoRunId) ?? null),
        actionReceipt: executionActionReceiptView(replay, { now: now(), autoRun: existingRun, replayed: true }),
        replayed: true,
      };
    }

    const detail = getWorkItem({ workItemId }, actor);
    if (!detail?.ok) throw resultError(detail);
    const item = detail.body.workItem;
    const sourceReview = detail.body.observability?.executionReview ?? null;
    const pseudoRun = {
      id: `legacy-recovery:${workItemId}`,
      localIssueId: workItemId,
      executionChainId: workItemId,
      projectId: item.projectId ?? null,
      teamId: item.ownerTeamId ?? null,
      status: sourceReview?.targetStatus ?? "failed",
      invocationId: sourceReview?.targetId ?? null,
      executionActionReceipts: [],
    };
    const { receipt } = runTx(() => beginExecutionAction({
      state,
      autoRun: pseudoRun,
      kind: "retry_execution",
      actor,
      idempotencyKey,
      expectedWorkItemRevision: request.expectedWorkItemRevision,
      expectedTargetStatus: request.expectedTargetStatus,
      request: actionRequest,
      nextOwner: "ai",
      now,
      nextId,
    }));
    receipt.recoveryWorkItemId = workItemId;
    receipt.recoverySourceKind = "application_invocation";
    runTx(() => updateExecutionAction(receipt, {
      status: "running",
      messageCode: "legacy_recovery_starting",
      impact: "none",
      nextOwner: "ai",
      targetId: null,
      now,
    }));

    try {
      const recovered = await restartLegacyExecutionAsAutoRun({
        workItemId,
        actor,
        timezoneOffset: request.timezoneOffset,
        recoveryRequestId: receipt.id,
        sourceTargetId: actionRequest.sourceTargetId,
        agentId: request.agentId,
        baseBranch: request.baseBranch,
      });
      const autoRun = recovered.autoRun;
      runTx(() => {
        autoRun.executionActionReceipts = [
          receipt,
          ...(autoRun.executionActionReceipts ?? []).filter((candidate) => candidate.id !== receipt.id),
        ].slice(0, 20);
        const ledgerEntry = (state.executionActionIdempotencyRecords ?? []).find((entry) => entry.receiptId === receipt.id);
        if (ledgerEntry) {
          ledgerEntry.autoRunId = autoRun.id;
          ledgerEntry.ownerTeamId = autoRun.teamId ?? null;
          ledgerEntry.projectId = autoRun.projectId ?? null;
        }
        updateExecutionAction(receipt, {
          status: "succeeded",
          messageCode: "legacy_execution_restarted_as_auto_run",
          impact: "none",
          nextOwner: "ai",
          targetId: autoRun.id,
          now,
        });
      });
      return {
        autoRun: publicAutoRun(autoRun),
        actionReceipt: executionActionReceiptView(receipt, { now: now(), autoRun }),
        replayed: recovered.replayed === true,
      };
    } catch (error) {
      runTx(() => updateExecutionAction(receipt, {
        status: "failed",
        messageCode: "legacy_execution_recovery_failed",
        impact: "none",
        nextOwner: "me",
        errorCode: error?.code ?? "legacy_execution_recovery_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        now,
      }));
      const normalized = error instanceof Error
        ? error
        : commandError("legacy_execution_recovery_failed", String(error));
      normalized.actionReceipt = executionActionReceiptView(receipt, { now: now(), autoRun: pseudoRun });
      throw normalized;
    }
  }

  async function executeAutoRunCommand(command, actor) {
    if (command.kind === "retry_execution" && command.request?.restartAsAutoRun === true) {
      return executeLegacyRestartCommand(command, actor);
    }
    const targetId = requireTargetId(command);
    const request = command.request ?? {};
    const common = {
      actor,
      terminalId: request.terminalId,
      idempotencyKey: request.idempotencyKey,
      expectedWorkItemRevision: request.expectedWorkItemRevision,
      expectedTargetStatus: request.expectedTargetStatus,
    };
    if (["retry_execution", "fix_with_ai"].includes(command.kind)) {
      const feedback = String(request.feedback ?? "").trim();
      if (command.kind === "fix_with_ai" && !feedback) {
        throw commandError("review_command_feedback_required", "AI repair requires review feedback.");
      }
      return retryAutoRun(targetId, {
        ...common,
        timezoneOffset: request.timezoneOffset,
        feedback: command.kind === "fix_with_ai" ? feedback : null,
      });
    }
    if (command.kind === "rerun_verification") return reverifyAutoRun(targetId, common);
    return answerClarify(targetId, {
      actor,
      answers: request.answers,
      selectedAction: request.selectedAction,
      repoUrl: request.repoUrl,
      idempotencyKey: request.idempotencyKey,
      expectedWorkItemRevision: request.expectedWorkItemRevision,
      expectedTargetStatus: request.expectedTargetStatus,
    });
  }

  async function executeDeliveryCommand(command, actor) {
    const workItemId = requireTargetId(command);
    const request = command.request ?? {};
    const detail = getWorkItem({ workItemId }, actor);
    if (!detail?.ok) throw resultError(detail);
    const item = detail.body.workItem;
    const projectedRun = detail.body.observability?.latestRun ?? null;
    const autoRun = (state.autoRuns ?? []).find((candidate) => candidate.id === projectedRun?.id) ?? null;
    if (!autoRun) throw commandError("auto_run_not_found", "The task execution could not be found.", 404);

    const mode = deliveryMode(command.kind);
    const actionRequest = { mode, baseBranch: request.baseBranch == null ? null : String(request.baseBranch) };
    const replay = replayExecutionAction(autoRun, {
      kind: command.kind,
      idempotencyKey: request.idempotencyKey,
      request: actionRequest,
      state,
    });
    if (replay) {
      let actionReceipt = executionActionReceiptView(replay, { now: now(), autoRun, replayed: true });
      if (replay.deliveryCheckpoint && actionReceipt.status !== "succeeded") {
        const checkpoint = replay.deliveryCheckpoint;
        const recovered = completeDelivery({
          workItemId,
          mode: checkpoint.mode,
          autoRunId: autoRun.id,
          operationId: checkpoint.operationId,
          result: checkpoint.result,
        }, actor);
        if (recovered.ok) {
          runTx(() => updateExecutionAction(replay, {
            status: "succeeded",
            ...deliverySuccess(command.kind, checkpoint.result),
            deliveryRecovery: "recovered",
            now,
          }));
          actionReceipt = executionActionReceiptView(replay, { now: now(), autoRun, replayed: true });
          return {
            ...recovered.body,
            autoRun: publicAutoRun(recovered.body.autoRun),
            actionReceipt,
            replayed: true,
          };
        }
        runTx(() => updateExecutionAction(replay, {
          status: "unknown",
          messageCode: "delivery_recovery_pending",
          impact: replay.impact ?? "unknown",
          nextOwner: "me",
          errorCode: recovered.body?.error ?? "delivery_commit_failed",
          errorMessage: "The external delivery succeeded, but its local completion receipt still could not be committed.",
          deliveryRecovery: "attempt_failed",
          now,
        }));
        actionReceipt = executionActionReceiptView(replay, { now: now(), autoRun, replayed: true });
        throw commandError(
          "work_item_delivery_recovery_pending",
          "The external delivery succeeded, but its local completion receipt still could not be committed.",
          409,
          { recoveryError: recovered.body?.error ?? "delivery_commit_failed" },
          actionReceipt,
        );
      }
      if (actionReceipt.status === "failed") {
        throw commandError(
          actionReceipt.errorCode ?? "work_item_delivery_failed",
          actionReceipt.errorMessage ?? "The delivery action failed.",
          409,
          {},
          actionReceipt,
        );
      }
      return {
        workItem: item,
        autoRun: projectedRun,
        delivery: projectedRun?.localDelivery ?? null,
        actionReceipt,
        replayed: true,
      };
    }
    if (!Number.isInteger(request.expectedWorkItemRevision)) {
      throw commandError("expected_revision_required", "The reviewed task revision is required.");
    }

    const { receipt } = runTx(() => beginExecutionAction({
      state,
      autoRun,
      kind: command.kind,
      actor,
      idempotencyKey: request.idempotencyKey,
      expectedWorkItemRevision: request.expectedWorkItemRevision,
      expectedTargetStatus: request.expectedTargetStatus,
      request: actionRequest,
      nextOwner: "system",
      now,
      nextId,
    }));
    let externalActionStarted = false;

    const fail = (error, { impact = "none", fallbackCode = "review_command_failed" } = {}) => {
      const normalized = error?.body
        ? resultError(error)
        : error instanceof Error
          ? error
          : commandError(fallbackCode, String(error ?? fallbackCode));
      runTx(() => updateExecutionAction(receipt, {
        status: impact === "unknown" ? "unknown" : "failed",
        messageCode: impact === "unknown" ? "delivery_result_unknown" : normalized.code ?? fallbackCode,
        impact,
        nextOwner: "me",
        errorCode: normalized.code ?? fallbackCode,
        errorMessage: normalized.message,
        deliveryRecovery: receipt.deliveryCheckpoint ? "required" : null,
        now,
      }));
      normalized.actionReceipt = executionActionReceiptView(receipt, { now: now(), autoRun });
      return normalized;
    };

    try {
      if (!item.completionGate?.ready) {
        throw resultError({ status: 409, body: { error: "work_item_acceptance_incomplete", ...item.completionGate } });
      }
      if (!item.executionContractGate?.ready) {
        throw resultError({ status: 409, body: { error: "work_item_execution_contract_required", ...item.executionContractGate } });
      }
      const worktreeId = projectedRun?.localDelivery?.worktreeId ?? null;
      if (!worktreeId || projectedRun?.status !== "done" || projectedRun.localDelivery?.deliveredAt) {
        throw commandError("work_item_delivery_not_ready", "The task delivery is not ready.", 409);
      }
      const evidence = detail.body.observability?.deliveryEvidence ?? null;
      if (!evidence || evidence.actionPreview?.canProceed !== true) {
        throw resultError({
          status: 409,
          body: {
            error: "work_item_delivery_evidence_not_ready",
            status: evidence?.status ?? "evidence_missing",
            risk: evidence?.risk ?? "unknown",
            blockingReasonCodes: evidence?.blockingReasonCodes ?? ["delivery_evidence_required"],
            deliveryEvidence: evidence,
          },
        });
      }
      if (evidence.actionPreview.operation !== command.kind) {
        throw commandError(
          "review_command_stale",
          "The available delivery action changed after this review was loaded.",
          409,
          { currentActionKind: evidence.actionPreview.operation },
        );
      }

      const admission = beginDelivery({
        workItemId,
        expectedRevision: request.expectedWorkItemRevision,
        mode,
        autoRunId: autoRun.id,
      }, actor);
      if (!admission.ok) throw resultError(admission);
      const operationId = admission.body.operation.id;
      externalActionStarted = true;
      runTx(() => updateExecutionAction(receipt, {
        status: "running",
        messageCode: "delivery_running",
        impact: "unknown",
        nextOwner: "system",
        targetId: operationId,
        externalActionAttempt: true,
        now,
      }));

      let result;
      try {
        result = mode === "local_merge"
          ? await promoteWorktreeToBase(worktreeId)
          : await promoteWorktreeToPullRequest(worktreeId, {
            title: item.title,
            body: `Delivers ${item.localRef}.\n\n${item.body ?? ""}`.trim(),
            base: request.baseBranch,
          });
      } catch (error) {
        failDelivery({ workItemId, operationId, error: error?.message ?? String(error) }, actor);
        throw commandError("work_item_delivery_failed", error?.message ?? String(error), 409);
      }

      const externalResult = deliverySuccess(command.kind, result);
      runTx(() => updateExecutionAction(receipt, {
        status: "running",
        messageCode: "delivery_external_action_succeeded",
        impact: externalResult.impact,
        nextOwner: "system",
        targetId: externalResult.targetId,
        deliveryCheckpoint: { operationId, mode, result },
        now,
      }));

      const completed = completeDelivery({
        workItemId,
        mode,
        autoRunId: autoRun.id,
        operationId,
        result,
      }, actor);
      if (!completed.ok) {
        throw resultError(completed);
      }
      runTx(() => updateExecutionAction(receipt, {
        status: "succeeded",
        ...deliverySuccess(command.kind, result),
        now,
      }));
      return {
        ...completed.body,
        autoRun: publicAutoRun(completed.body.autoRun),
        actionReceipt: executionActionReceiptView(receipt, { now: now(), autoRun }),
        replayed: false,
      };
    } catch (error) {
      if (error?.actionReceipt) throw error;
      throw fail(error, { impact: externalActionStarted ? "unknown" : "none", fallbackCode: "work_item_delivery_failed" });
    }
  }

  async function execute(command = {}, actor = null) {
    if (AUTO_RUN_ACTIONS.has(command.kind)) return executeAutoRunCommand(command, actor);
    if (DELIVERY_ACTIONS.has(command.kind)) return executeDeliveryCommand(command, actor);
    throw commandError("review_command_kind_invalid", "The review action is not supported.");
  }

  return { execute };
}
