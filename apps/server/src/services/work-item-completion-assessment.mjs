const TERMINAL_RUN_STATUSES = new Set([
  "done", "pr_open", "report_posted", "failed", "blocked", "cancelled", "timed_out", "rejected", "expired",
]);

const CHECK_PRIORITY = { matched: 0, pending: 1, unknown: 2, mismatch: 3 };
const RECOVERY_ACTION_KINDS = new Set(["retry_execution", "fix_with_ai", "rerun_verification"]);

function aggregateChecks(checks) {
  if (!checks.length) return "unknown";
  return checks.reduce((worst, check) =>
    CHECK_PRIORITY[check.status] > CHECK_PRIORITY[worst] ? check.status : worst, "matched");
}

function stage(key, checks) {
  const selected = checks.filter((check) => check.key === key || (Array.isArray(key) && key.includes(check.key)));
  return {
    status: aggregateChecks(selected),
    reasonCodes: selected.filter((check) => check.status !== "matched").map((check) => check.reasonCode),
  };
}

function reasonCodesFor(planActual) {
  return [...new Set((planActual?.checks ?? [])
    .filter((check) => check.status === "mismatch" || check.status === "unknown")
    .map((check) => check.reasonCode)
    .filter(Boolean))];
}

/**
 * Projects one ordinary-user answer to "is this task really complete?" from
 * existing lifecycle state and immutable execution receipts. This projection
 * stores no parallel truth and never upgrades missing evidence into success.
 */
export function assessWorkItemCompletion({ item = null, latestRun = null, planActual = null, completionGate = null } = {}) {
  if (!item) return null;
  const declaredComplete = item.status === "done" || item.state === "closed";
  const stopped = Boolean(latestRun?.deliveryStopped);
  const terminalRun = Boolean(latestRun && TERMINAL_RUN_STATUSES.has(latestRun.status));
  const checks = Array.isArray(planActual?.checks) ? planActual.checks : [];
  const manualEvidenceComplete = !latestRun && completionGate?.ready === true;
  const evidenceComplete = planActual?.status === "matched" || manualEvidenceComplete;

  let status = "pending";
  if (stopped) status = "stopped";
  else if (evidenceComplete) status = declaredComplete ? "completed" : "ready_to_complete";
  else if (planActual?.status === "attention" || latestRun?.status === "failed" || latestRun?.status === "blocked") status = "needs_attention";
  else if (planActual?.status === "unverified" || (declaredComplete && !evidenceComplete) || (terminalRun && !planActual)) status = "unverified";

  const reasonCodes = reasonCodesFor(planActual);
  if (stopped) reasonCodes.unshift("delivery_stopped_by_user");
  if (!latestRun && completionGate && completionGate.ready !== true) {
    if (completionGate.missingCriteria?.length) reasonCodes.push("acceptance_incomplete");
    if (completionGate.verificationRequired) reasonCodes.push("verification_required");
    if (completionGate.resultVerificationRequired) reasonCodes.push("result_verification_required");
  }
  if ((declaredComplete || terminalRun) && !evidenceComplete && !reasonCodes.length) reasonCodes.push("completion_evidence_missing");

  // A normal final sign-off is part of the happy path, not an intervention.
  // Count only exception handling or an execution that explicitly waits for a
  // person before it can continue.
  const humanInterventionRequired = ["needs_attention", "unverified", "stopped"].includes(status)
    || (status === "pending" && ["me", "requester"].includes(item.waitingOn));

  return {
    schemaVersion: 1,
    status,
    declaredComplete,
    evidenceComplete,
    falseCompletion: declaredComplete && !evidenceComplete,
    requiresUserAction: ["ready_to_complete", "needs_attention", "unverified", "stopped"].includes(status),
    humanInterventionRequired,
    reasonCodes: [...new Set(reasonCodes)],
    stages: latestRun ? {
      intent: stage("method", checks),
      materials: stage("materials", checks),
      execution: stage(["output", "action"], checks),
      verification: stage("verification", checks),
      delivery: stage("delivery", checks),
    } : {
      acceptance: {
        status: completionGate?.missingCriteria?.length ? "mismatch" : completionGate ? "matched" : "unknown",
        reasonCodes: completionGate?.missingCriteria?.length ? ["acceptance_incomplete"] : [],
      },
      verification: {
        status: completionGate?.verificationRequired || completionGate?.resultVerificationRequired ? "mismatch" : completionGate ? "matched" : "unknown",
        reasonCodes: [
          ...(completionGate?.verificationRequired ? ["verification_required"] : []),
          ...(completionGate?.resultVerificationRequired ? ["result_verification_required"] : []),
        ],
      },
    },
  };
}

export function taskCompletionMetrics(assessments = []) {
  const tracked = assessments.filter(Boolean);
  const settled = tracked.filter((assessment) =>
    ["completed", "needs_attention", "unverified", "stopped"].includes(assessment.status));
  const completed = settled.filter((assessment) => assessment.status === "completed").length;
  const falseCompletions = tracked.filter((assessment) => assessment.falseCompletion).length;
  const requiringUserAction = tracked.filter((assessment) => assessment.requiresUserAction).length;
  return {
    tracked: tracked.length,
    settled: settled.length,
    completed,
    falseCompletions,
    requiringUserAction,
    completionRate: settled.length ? completed / settled.length : null,
    falseCompletionRate: tracked.length ? falseCompletions / tracked.length : null,
  };
}

function distinctReceipts(receipts) {
  const selected = new Map();
  for (const receipt of receipts ?? []) {
    if (!receipt?.id) continue;
    const existing = selected.get(receipt.id);
    if (!existing || String(receipt.updatedAt ?? "") >= String(existing.updatedAt ?? "")) {
      selected.set(receipt.id, receipt);
    }
  }
  return [...selected.values()];
}

function acceptanceCheck(value, target, direction = "min") {
  if (value == null) return { status: "insufficient_data", target };
  const passed = direction === "max" ? value <= target : value >= target;
  return { status: passed ? "passed" : "attention", target };
}

/**
 * Quantitative acceptance over durable task truth and action receipts. Recovery
 * is only sampled after an external action succeeded but local completion had
 * to be resumed. External retries are counted from attempts recorded before
 * invoking the side effect, so a local checkpoint replay does not inflate it.
 */
export function taskCompletionQualityMetrics({ assessments = [], receipts = [] } = {}) {
  const tracked = assessments.filter(Boolean);
  const completion = taskCompletionMetrics(tracked);
  const actionReceipts = distinctReceipts(receipts);
  const deliveryRecoveries = actionReceipts.filter((receipt) => receipt.deliveryRecovery?.requiredAt);
  const commandRecoveries = actionReceipts.filter((receipt) => RECOVERY_ACTION_KINDS.has(receipt.kind));
  const recoveryRequired = deliveryRecoveries.length + commandRecoveries.length;
  const recoverySucceeded = deliveryRecoveries.filter((receipt) => receipt.deliveryRecovery?.recoveredAt).length
    + commandRecoveries.filter((receipt) => receipt.status === "succeeded").length;
  const humanInterventions = tracked.filter((assessment) => assessment.humanInterventionRequired).length;
  const externalActionAttempts = actionReceipts.reduce(
    (total, receipt) => total + Math.max(0, Number(receipt.externalActionAttemptCount) || 0),
    0,
  );
  const duplicateExternalActions = actionReceipts.reduce(
    (total, receipt) => total + Math.max(0, (Number(receipt.externalActionAttemptCount) || 0) - 1),
    0,
  );
  const unresolvedExternalActions = actionReceipts.filter((receipt) =>
    receipt.deliveryCheckpoint
    && receipt.status !== "succeeded"
    && !receipt.deliveryRecovery?.recoveredAt).length;
  const recoverySuccessRate = recoveryRequired ? recoverySucceeded / recoveryRequired : null;
  const humanInterventionRate = tracked.length ? humanInterventions / tracked.length : null;
  const targets = {
    completionRate: 0.95,
    recoverySuccessRate: 0.95,
    maximumHumanInterventionRate: 0.10,
    maximumDuplicateExternalActions: 0,
  };
  const checks = {
    completionRate: acceptanceCheck(completion.completionRate, targets.completionRate),
    recoverySuccessRate: acceptanceCheck(recoverySuccessRate, targets.recoverySuccessRate),
    humanInterventionRate: acceptanceCheck(humanInterventionRate, targets.maximumHumanInterventionRate, "max"),
    duplicateExternalActions: externalActionAttempts
      ? acceptanceCheck(duplicateExternalActions, targets.maximumDuplicateExternalActions, "max")
      : { status: "insufficient_data", target: targets.maximumDuplicateExternalActions },
  };
  const evaluable = Object.values(checks).filter((check) => check.status !== "insufficient_data");

  return {
    schemaVersion: 1,
    completion: {
      ...completion,
      check: checks.completionRate,
    },
    recovery: {
      required: recoveryRequired,
      succeeded: recoverySucceeded,
      pending: recoveryRequired - recoverySucceeded,
      successRate: recoverySuccessRate,
      check: checks.recoverySuccessRate,
    },
    humanIntervention: {
      count: humanInterventions,
      rate: humanInterventionRate,
      check: checks.humanInterventionRate,
    },
    externalActions: {
      attempts: externalActionAttempts,
      duplicateCount: duplicateExternalActions,
      unresolvedCount: unresolvedExternalActions,
      check: checks.duplicateExternalActions,
    },
    acceptance: {
      status: !evaluable.length
        ? "insufficient_data"
        : evaluable.some((check) => check.status === "attention") ? "attention" : "passed",
      checks,
    },
    definitions: {
      completionRate: "Evidence-confirmed completed tasks divided by settled tasks.",
      recoverySuccessRate: "Failed-run retries and checkpoint recoveries succeeded divided by recoveries started or required.",
      humanInterventionRate: "Tasks needing exception handling divided by tracked tasks; normal final sign-off is excluded.",
      duplicateExternalActions: "External side-effect attempts after the first attempt on the same action receipt.",
    },
  };
}
