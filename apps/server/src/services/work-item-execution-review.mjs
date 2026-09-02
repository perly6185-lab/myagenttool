import { projectWorkItemReviewIntent } from "@myagenttool/protocol/work-item-review-intent";

import { resolveWorkItemExecution } from "./work-item-execution.mjs";
import { latestExecutionActionReceipt } from "./work-item-execution-action.mjs";
import { projectWorkItemReviewActions } from "./work-item-review-actions.mjs";
import { projectWorkItemRiskReview } from "./work-item-risk-review.mjs";
import { requiredRuntimeVerificationKinds } from "./work-item-result-verification.mjs";

const STAGE_KEYS = ["accepted", "preparing", "working", "verifying", "review"];
const TERMINAL_FAILURES = new Set(["failed", "blocked", "timed_out", "rejected", "expired"]);

function boundedText(value, max = 2_000) {
  if (value == null) return null;
  return String(value).trim().slice(0, max) || null;
}

function timestamp(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function latestTimestamp(...values) {
  return values.filter((value) => timestamp(value) != null)
    .sort((left, right) => timestamp(right) - timestamp(left))[0] ?? null;
}

function verificationSource(item, autoRun, invocation) {
  const runtimeCandidate = autoRun?.deliveryReport?.verification
    ?? autoRun?.verification
    ?? invocation?.result?.output?.verification
    ?? invocation?.result?.verification
    ?? null;
  const attempt = autoRun?.verificationAttempt ?? null;
  const records = [...(item?.verificationRecords ?? [])]
    .sort((left, right) => String(right.recordedAt ?? "").localeCompare(String(left.recordedAt ?? "")));
  const requiredRuntimeKinds = requiredRuntimeVerificationKinds(item);
  const resultVerification = !requiredRuntimeKinds.length ? item?.resultVerification ?? null : null;
  const runtimeConclusive = runtimeCandidate?.verified === true
    || runtimeCandidate?.testsPassed === true
    || runtimeCandidate?.checkPassed === true
    || runtimeCandidate?.checkPassed === false
    || Number.isInteger(runtimeCandidate?.exitCode)
    || Number.isInteger(runtimeCandidate?.testExitCode);
  const resultConclusive = resultVerification?.status === "passed" || resultVerification?.status === "failed";
  const runtime = resultConclusive && !runtimeConclusive ? null : runtimeCandidate;
  return { runtime, attempt, records, resultVerification };
}

function normalizeCommands(verification) {
  return [...new Set([
    ...(Array.isArray(verification?.commands) ? verification.commands : []),
    verification?.command,
    verification?.verifyCommand,
  ].map((command) => boundedText(command, 500)).filter(Boolean))].slice(0, 20);
}

function projectVerification(item, autoRun, invocation, executionState) {
  const { runtime, attempt, records, resultVerification } = verificationSource(item, autoRun, invocation);
  const latestRecord = records[0] ?? null;
  const commands = normalizeCommands(runtime);
  const runtimeVerified = runtime?.verified === true
    || runtime?.testsPassed === true
    || runtime?.checkPassed === true
    || runtime?.checkPassed === false
    || Number.isInteger(runtime?.exitCode)
    || Number.isInteger(runtime?.testExitCode);
  const runtimePassed = runtime?.passed === true
    || runtime?.testsPassed === true
    || runtime?.checkPassed === true
    || runtime?.exitCode === 0
    || runtime?.testExitCode === 0;
  let status = "pending";
  if (attempt?.status === "running" || (executionState === "verifying" && !runtime && !latestRecord)) {
    status = "running";
  } else if (attempt?.status === "unavailable") {
    status = "unavailable";
  } else if (runtime) {
    status = runtimeVerified ? (runtimePassed ? "passed" : "failed") : "not_configured";
  } else if (latestRecord) {
    status = latestRecord.status === "passed" ? "passed" : "failed";
  } else if (resultVerification?.status === "passed" || resultVerification?.status === "failed") {
    status = resultVerification.status;
  }
  const checkedAt = latestTimestamp(
    attempt?.completedAt,
    runtime?.verifiedAt,
    autoRun?.deliveryReport?.completedAt,
    latestRecord?.recordedAt,
    resultVerification?.checkedAt,
  );
  const durationMs = timestamp(attempt?.requestedAt) != null && timestamp(attempt?.completedAt) != null
    ? Math.max(0, timestamp(attempt.completedAt) - timestamp(attempt.requestedAt))
    : null;
  const checks = records.slice(0, 20).map((record) => ({
    id: record.id,
    kind: record.kind,
    status: record.status,
    command: boundedText(record.command, 500),
    summary: boundedText(record.summary),
    recordedAt: record.recordedAt ?? null,
    evidenceCount: Array.isArray(record.evidence) ? record.evidence.length : 0,
  }));
  if (!checks.length && resultVerification) {
    checks.push(...[...(resultVerification.checks ?? []), ...(resultVerification.verificationChecks ?? [])]
      .slice(0, 20)
      .map((check, index) => ({
        id: check.id ?? `result_verification:${index + 1}`,
        kind: check.kind ?? "result",
        status: check.status,
        command: null,
        summary: boundedText(check.summary),
        recordedAt: resultVerification.checkedAt ?? null,
        evidenceCount: (check.outputAssetIds?.length ?? 0) + (check.executionArtifactIds?.length ?? 0) + (check.verificationIds?.length ?? 0),
      })));
  }
  const evidenceCount = checks.reduce((total, check) => total + check.evidenceCount, 0);
  return {
    status,
    verified: status === "passed" || status === "failed",
    passed: status === "passed" ? true : status === "failed" ? false : null,
    commands,
    command: commands.at(-1) ?? boundedText(latestRecord?.command, 500),
    exitCode: Number.isInteger(runtime?.exitCode)
      ? runtime.exitCode
      : Number.isInteger(runtime?.testExitCode) ? runtime.testExitCode : null,
    summary: boundedText(runtime?.summary ?? runtime?.error ?? latestRecord?.summary ?? resultVerification?.summary),
    checkedAt,
    durationMs,
    evidenceCount,
    checks,
  };
}

function phaseStage(autoRun, executionState, startReceipt) {
  const phase = autoRun?.phase ?? null;
  if (!autoRun && startReceipt?.status === "starting") return "preparing";
  if (!autoRun && executionState === "unclaimed") {
    return "accepted";
  }
  if (["understanding", "planning"].includes(phase)) return "preparing";
  if (["review_ready"].includes(phase) || executionState === "completed") return "review";
  if (["verifying"].includes(phase) || executionState === "verifying") return "verifying";
  return "working";
}

function reviewState(item, autoRun, invocation, executionState, startReceipt, stage) {
  const targetStatus = autoRun?.status ?? invocation?.status ?? null;
  if (item?.state === "closed" || item?.status === "done") return "completed";
  if (targetStatus === "cancelled" || startReceipt?.status === "cancelled") return "cancelled";
  if (TERMINAL_FAILURES.has(targetStatus) || executionState === "failed") return "failed";
  if (autoRun?.status === "needs_input" || executionState === "awaiting_approval") return "waiting";
  if (stage === "review") return "review_ready";
  if (stage === "verifying") return "verifying";
  if (stage === "working") return "working";
  if (stage === "preparing") return "preparing";
  if (["blocked", "paused"].includes(startReceipt?.status ?? "")) return "waiting";
  return "queued";
}

function projectImpact(autoRun, deliveryEvidence, reviewStateValue) {
  const batch = deliveryEvidence?.actionPreview?.officeDetails?.batch ?? null;
  if (batch && !batch.countConsistent) return { status: "unknown", reasonCode: "office_batch_evidence_inconsistent" };
  if (batch?.state === "rolled_back") return { status: "rolled_back", reasonCode: "office_batch_rolled_back" };
  if (batch && (batch.failedCount > 0 || batch.state === "partial")) return { status: "partial", reasonCode: "office_batch_partial" };
  if (batch?.state === "committed") return { status: "applied", reasonCode: "office_batch_applied" };
  if (["pr_open", "publishing"].includes(autoRun?.status ?? "")
    || autoRun?.localDelivery?.prNumber
    || autoRun?.localDelivery?.prUrl
    || autoRun?.localDelivery?.promotedAt) {
    return { status: "proposed", reasonCode: "pull_request_created" };
  }
  if (autoRun?.localDelivery?.deliveredAt || autoRun?.localDelivery?.deliveredCommit) {
    return { status: "applied", reasonCode: "local_delivery_applied" };
  }
  if (deliveryEvidence?.actionPreview) return { status: "prepared", reasonCode: "result_waiting_for_confirmation" };
  if (["queued", "preparing", "working", "waiting", "verifying"].includes(reviewStateValue)) {
    return { status: "none", reasonCode: "changes_isolated_until_confirmation" };
  }
  return { status: "unknown", reasonCode: "external_impact_not_recorded" };
}

export function projectWorkItemExecutionReview({
  item,
  state,
  startReceipt = null,
  deliveryEvidence = null,
  now = new Date().toISOString(),
} = {}) {
  if (!item) return null;
  const resolved = resolveWorkItemExecution(item, state, { now });
  const { binding, autoRun, invocation, agent, executionState } = resolved;
  if (!binding && !startReceipt) return null;
  const stage = phaseStage(autoRun, executionState, startReceipt);
  const stateValue = reviewState(item, autoRun, invocation, executionState, startReceipt, stage);
  const currentIndex = STAGE_KEYS.indexOf(stage);
  const completed = stateValue === "completed";
  const attention = ["waiting", "failed", "cancelled"].includes(stateValue);
  const startedAt = latestTimestamp(
    invocation?.startedAt,
    autoRun?.executionBudget?.startedAt,
    binding?.createdAt,
    startReceipt?.startedAt,
  );
  const stageTimes = {
    accepted: startReceipt?.requestedAt ?? binding?.createdAt ?? autoRun?.createdAt ?? invocation?.createdAt ?? null,
    preparing: binding?.createdAt ?? autoRun?.createdAt ?? invocation?.createdAt ?? null,
    working: invocation?.startedAt ?? autoRun?.executionBudget?.startedAt ?? startedAt,
    verifying: autoRun?.verificationAttempt?.requestedAt ?? autoRun?.verification?.verifiedAt ?? null,
    review: autoRun?.deliveryReport?.completedAt ?? invocation?.completedAt ?? (stage === "review" ? autoRun?.updatedAt : null),
  };
  const stages = STAGE_KEYS.map((key, index) => ({
    key,
    status: completed || index < currentIndex ? "complete"
      : index === currentIndex ? (attention ? "attention" : "current") : "pending",
    at: stageTimes[key] ?? null,
  }));
  const targetStatus = autoRun?.status ?? invocation?.status ?? startReceipt?.status ?? null;
  const verification = projectVerification(item, autoRun, invocation, executionState);
  const impact = projectImpact(autoRun, deliveryEvidence, stateValue);
  const frozenIntentContract = autoRun?.executionContract?.intentContract
    ?? item?.executionContractSnapshot?.intentContract
    ?? item?.executionIntentContractSnapshot
    ?? null;
  const reviewIntent = projectWorkItemReviewIntent({
    intentContract: frozenIntentContract,
    deliveryEvidence,
  });
  const actionReceipt = latestExecutionActionReceipt(autoRun, { now });
  const attentionCode = stateValue === "waiting"
    ? (autoRun?.status === "needs_input" ? "waiting_for_user" : executionState === "awaiting_approval" ? "waiting_for_approval" : startReceipt?.reasonCode ?? "waiting")
    : stateValue === "failed" ? boundedText(autoRun?.error ?? invocation?.result?.errorCode ?? startReceipt?.reasonCode, 160) ?? "execution_failed"
      : stateValue === "cancelled" ? "execution_cancelled" : null;
  const riskReview = projectWorkItemRiskReview({
    state: stateValue,
    attentionCode,
    verification,
    impact,
    deliveryEvidence,
  });
  const actionAvailability = projectWorkItemReviewActions({
    state: stateValue,
    attentionCode,
    targetStatus,
    executionKind: binding?.kind ?? startReceipt?.executionKind ?? null,
    verification,
    deliveryEvidence,
    actionReceipt,
    recommendedAction: riskReview.recommendedAction,
    hasWorktree: Boolean(autoRun?.worktreeId ?? deliveryEvidence?.actionPreview?.worktreeId),
  });
  return {
    schemaVersion: 1,
    state: stateValue,
    stage,
    stages,
    executionKind: binding?.kind ?? startReceipt?.executionKind ?? null,
    targetId: binding?.targetId ?? binding?.id ?? startReceipt?.targetId ?? null,
    targetStatus,
    agentId: autoRun?.agentId ?? invocation?.agentId ?? startReceipt?.agentId ?? null,
    agentName: agent?.name ?? null,
    acceptedAt: startReceipt?.requestedAt ?? stageTimes.accepted,
    startedAt,
    updatedAt: latestTimestamp(autoRun?.updatedAt, invocation?.updatedAt, startReceipt?.updatedAt) ?? now,
    completedAt: autoRun?.deliveryReport?.completedAt ?? invocation?.completedAt ?? (completed ? item.completedAt ?? item.updatedAt ?? null : null),
    needsAttention: riskReview.needsAttention,
    attentionCode,
    verification,
    impact,
    reviewIntent,
    riskReasons: riskReview.riskReasons,
    recommendedAction: riskReview.recommendedAction,
    actionAvailability,
    actionReceipt,
  };
}
