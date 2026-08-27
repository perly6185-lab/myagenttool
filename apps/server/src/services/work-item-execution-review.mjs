import { resolveWorkItemExecution } from "./work-item-execution.mjs";
import { latestExecutionActionReceipt } from "./work-item-execution-action.mjs";

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
  const runtime = autoRun?.deliveryReport?.verification
    ?? autoRun?.verification
    ?? invocation?.result?.output?.verification
    ?? invocation?.result?.verification
    ?? null;
  const attempt = autoRun?.verificationAttempt ?? null;
  const records = [...(item?.verificationRecords ?? [])]
    .sort((left, right) => String(right.recordedAt ?? "").localeCompare(String(left.recordedAt ?? "")));
  return { runtime, attempt, records };
}

function normalizeCommands(verification) {
  return [...new Set([
    ...(Array.isArray(verification?.commands) ? verification.commands : []),
    verification?.command,
    verification?.verifyCommand,
  ].map((command) => boundedText(command, 500)).filter(Boolean))].slice(0, 20);
}

function projectVerification(item, autoRun, invocation, executionState) {
  const { runtime, attempt, records } = verificationSource(item, autoRun, invocation);
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
  }
  const checkedAt = latestTimestamp(
    attempt?.completedAt,
    runtime?.verifiedAt,
    autoRun?.deliveryReport?.completedAt,
    latestRecord?.recordedAt,
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
    summary: boundedText(runtime?.summary ?? runtime?.error ?? latestRecord?.summary),
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

function projectRiskReasons({ stateValue, attentionCode, verification, impact }) {
  const reasons = [];
  const add = (code, severity, scope) => {
    if (!reasons.some((reason) => reason.code === code)) reasons.push({ code, severity, scope });
  };
  if (stateValue === "failed") add("execution_failed", "high", "execution");
  if (attentionCode === "waiting_for_user") add("user_input_required", "medium", "execution");
  if (attentionCode === "waiting_for_approval") add("approval_required", "medium", "approval");
  if (verification.status === "failed") add("verification_failed", "high", "verification");
  if (verification.status === "not_configured") add("verification_not_configured", "medium", "verification");
  if (verification.status === "unavailable") add("verification_unavailable", "medium", "verification");
  if (impact.status === "unknown") add("external_impact_unknown", "medium", "external_impact");
  if (impact.status === "partial") add("office_batch_partial", "high", "external_impact");
  if (impact.status === "rolled_back") add("office_batch_rolled_back", "medium", "external_impact");
  if (impact.status === "proposed") add("pull_request_not_applied", "medium", "external_impact");
  return reasons.slice(0, 4);
}

function projectRecommendedAction({ stateValue, attentionCode, verification, deliveryEvidence }) {
  if (stateValue === "waiting") {
    if (attentionCode === "waiting_for_user") {
      return { kind: "answer_ai", reasonCode: "execution_waiting_for_user", requiresConfirmation: false, nextOwner: "me" };
    }
    if (attentionCode === "waiting_for_approval") {
      return { kind: "review_approval", reasonCode: "execution_waiting_for_approval", requiresConfirmation: true, nextOwner: "me" };
    }
    return { kind: "open_details", reasonCode: "execution_waiting", requiresConfirmation: false, nextOwner: "me" };
  }
  if (stateValue === "failed") {
    return { kind: "retry_execution", reasonCode: "execution_failed", requiresConfirmation: true, nextOwner: "me" };
  }
  if (stateValue === "cancelled") {
    return { kind: "open_details", reasonCode: "execution_cancelled", requiresConfirmation: false, nextOwner: "me" };
  }
  if (stateValue === "review_ready") {
    if (deliveryEvidence?.domain === "development"
      && (deliveryEvidence.status === "changes_requested" || verification.status === "failed")) {
      return { kind: "fix_with_ai", reasonCode: "review_requires_changes", requiresConfirmation: false, nextOwner: "ai" };
    }
    if (deliveryEvidence?.domain === "development" && verification.status === "unavailable") {
      return { kind: "rerun_verification", reasonCode: "verification_unavailable", requiresConfirmation: false, nextOwner: "system" };
    }
    return { kind: "review_result", reasonCode: "result_ready_for_review", requiresConfirmation: false, nextOwner: "me" };
  }
  if (stateValue === "completed") {
    return { kind: "view_result", reasonCode: "result_completed", requiresConfirmation: false, nextOwner: "none" };
  }
  return { kind: "open_details", reasonCode: "execution_in_progress", requiresConfirmation: false, nextOwner: "ai" };
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
  const actionReceipt = latestExecutionActionReceipt(autoRun, { now });
  const attentionCode = stateValue === "waiting"
    ? (autoRun?.status === "needs_input" ? "waiting_for_user" : executionState === "awaiting_approval" ? "waiting_for_approval" : startReceipt?.reasonCode ?? "waiting")
    : stateValue === "failed" ? boundedText(autoRun?.error ?? invocation?.result?.errorCode ?? startReceipt?.reasonCode, 160) ?? "execution_failed"
      : stateValue === "cancelled" ? "execution_cancelled" : null;
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
    needsAttention: attention,
    attentionCode,
    verification,
    impact,
    riskReasons: projectRiskReasons({ stateValue, attentionCode, verification, impact }),
    recommendedAction: projectRecommendedAction({ stateValue, attentionCode, verification, deliveryEvidence }),
    actionReceipt,
  };
}
