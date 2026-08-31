const TERMINAL_RUN_STATUSES = new Set([
  "done", "pr_open", "report_posted", "failed", "blocked", "cancelled", "timed_out", "rejected", "expired",
]);

const CHECK_PRIORITY = { matched: 0, pending: 1, unknown: 2, mismatch: 3 };
const RECOVERY_ACTION_KINDS = new Set([
  "retry_execution", "fix_with_ai", "rerun_verification", "retry_channel_delivery",
]);
const FORCED_HUMAN_REASON_CODES = new Set([
  "approval_required", "clarification_required", "execution_input_required", "user_input_required",
]);
const DEVELOPMENT_TASK_KINDS = /^(software_|coding_|code_|development_)/;
const OFFICE_TASK_KINDS = /^(business_document|business_communication|business_scheduling|office_)/;
const MATERIAL_TASK_KINDS = /^(knowledge_|material_|local_content_)/;

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

export function workItemMetricCategory(item = null) {
  if (!item) return "task";
  const taskKind = String(item.taskKind ?? "").trim().toLowerCase();
  const domain = String(item.channelTaskContract?.domain ?? "").trim().toLowerCase();
  if (domain === "development" || DEVELOPMENT_TASK_KINDS.test(taskKind)) return "development";
  if (domain === "office" || OFFICE_TASK_KINDS.test(taskKind)) return "office";
  if (MATERIAL_TASK_KINDS.test(taskKind)
    || (item.localContentRefs ?? []).length
    || (item.taskResourceRefs ?? []).length
    || (item.inputAssets ?? []).length) return "material";
  if (item.channelTaskContract?.source === "channel" || item.channelOrigin?.channelId) return "channel";
  return "task";
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

  const exceptionHandlingRequired = ["needs_attention", "unverified", "stopped"].includes(status);
  // An exception is not automatically a forced human intervention: it may be
  // recoverable by AI or policy. Count a person only when the durable task truth
  // explicitly waits for them, or when the blocker itself requires a human
  // decision/input. A normal sign-off and a voluntary recovery click are not
  // forced intervention.
  const humanInterventionRequired = ["me", "requester"].includes(item.waitingOn)
    || reasonCodes.some((code) => FORCED_HUMAN_REASON_CODES.has(code));

  return {
    schemaVersion: 2,
    workItemId: item.id ?? null,
    category: workItemMetricCategory(item),
    status,
    declaredComplete,
    evidenceComplete,
    falseCompletion: declaredComplete && !evidenceComplete,
    requiresUserAction: ["ready_to_complete", "needs_attention", "unverified", "stopped"].includes(status),
    exceptionHandlingRequired,
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

function receiptInitiationSource(receipt) {
  if (["user", "system", "automation"].includes(receipt?.initiationSource)) return receipt.initiationSource;
  return receipt?.requestedBy ? "user" : "unknown";
}

function receiptDurationMs(receipt) {
  const start = Date.parse(receipt?.deliveryRecovery?.requiredAt ?? receipt?.requestedAt ?? "");
  const end = Date.parse(receipt?.deliveryRecovery?.recoveredAt ?? receipt?.completedAt ?? "");
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

function categoryMetrics(samples, recoveryReceipts) {
  const result = {};
  for (const category of ["development", "office", "material", "channel", "task"]) {
    const selected = samples.filter((sample) => sample.category === category);
    if (!selected.length) continue;
    const settled = selected.filter((sample) =>
      ["completed", "needs_attention", "unverified", "stopped"].includes(sample.assessment?.status));
    const completed = settled.filter((sample) => sample.assessment?.status === "completed");
    const ids = new Set(selected.map((sample) => sample.workItemId).filter(Boolean));
    const recoveries = recoveryReceipts.filter((receipt) => ids.has(receipt.workItemId));
    result[category] = {
      tracked: selected.length,
      settled: settled.length,
      completed: completed.length,
      finalCompletionRate: settled.length ? completed.length / settled.length : null,
      forcedHumanInterventions: selected.filter((sample) => sample.assessment?.humanInterventionRequired).length,
      recoveryRequired: recoveries.length,
      recoverySucceeded: recoveries.filter((receipt) => receipt.status === "succeeded" || receipt.deliveryRecovery?.recoveredAt).length,
    };
  }
  return result;
}

/**
 * Quantitative acceptance over durable task truth and action receipts. Recovery
 * is only sampled after an external action succeeded but local completion had
 * to be resumed. External retries are counted from attempts recorded before
 * invoking the side effect, so a local checkpoint replay does not inflate it.
 */
export function taskCompletionQualityMetrics({ assessments = [], receipts = [], samples = [] } = {}) {
  const tracked = assessments.filter(Boolean);
  const completion = taskCompletionMetrics(tracked);
  const actionReceipts = distinctReceipts(receipts);
  const deliveryRecoveries = actionReceipts.filter((receipt) => receipt.deliveryRecovery?.requiredAt);
  const commandRecoveries = actionReceipts.filter((receipt) => RECOVERY_ACTION_KINDS.has(receipt.kind));
  const recoveryReceipts = distinctReceipts([...deliveryRecoveries, ...commandRecoveries]);
  const recoveryRequired = recoveryReceipts.length;
  const recoverySucceeded = recoveryReceipts.filter((receipt) =>
    receipt.deliveryRecovery?.recoveredAt || receipt.status === "succeeded").length;
  const humanInterventions = tracked.filter((assessment) => assessment.humanInterventionRequired).length;
  const exceptionHandling = tracked.filter((assessment) => assessment.exceptionHandlingRequired).length;
  const userRecoveryReceipts = recoveryReceipts.filter((receipt) => receiptInitiationSource(receipt) === "user");
  const automaticRecoveryReceipts = recoveryReceipts.filter((receipt) =>
    ["system", "automation"].includes(receiptInitiationSource(receipt)));
  const successfulAutomaticRecoveries = automaticRecoveryReceipts.filter((receipt) =>
    receipt.deliveryRecovery?.recoveredAt || receipt.status === "succeeded");
  const userRecoveryTaskIds = new Set(userRecoveryReceipts.map((receipt) => receipt.workItemId).filter(Boolean));
  const automaticRecoveryTaskIds = new Set(automaticRecoveryReceipts.map((receipt) => receipt.workItemId).filter(Boolean));
  const mappedSamples = samples.length
    ? samples.filter((sample) => sample?.assessment)
    : tracked.map((assessment) => ({
      workItemId: assessment.workItemId ?? null,
      category: assessment.category ?? "task",
      assessment,
    }));
  const recoveredTaskIds = new Set(recoveryReceipts.map((receipt) => receipt.workItemId).filter(Boolean));
  const firstAttemptSettled = mappedSamples.filter((sample) =>
    ["completed", "needs_attention", "unverified", "stopped"].includes(sample.assessment.status));
  const firstAttemptCompleted = firstAttemptSettled.filter((sample) =>
    sample.assessment.status === "completed" && !recoveredTaskIds.has(sample.workItemId)).length;
  const firstAttemptCompletionRate = firstAttemptSettled.length
    ? firstAttemptCompleted / firstAttemptSettled.length
    : null;
  const recoveryDurations = recoveryReceipts
    .map(receiptDurationMs)
    .filter((value) => value != null);
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
    firstAttemptCompletionRate: 0.80,
    completionRate: 0.90,
    recoverySuccessRate: 0.90,
    maximumHumanInterventionRate: 0.15,
    maximumDuplicateExternalActions: 0,
  };
  const checks = {
    firstAttemptCompletionRate: acceptanceCheck(firstAttemptCompletionRate, targets.firstAttemptCompletionRate),
    completionRate: acceptanceCheck(completion.completionRate, targets.completionRate),
    recoverySuccessRate: acceptanceCheck(recoverySuccessRate, targets.recoverySuccessRate),
    humanInterventionRate: acceptanceCheck(humanInterventionRate, targets.maximumHumanInterventionRate, "max"),
    duplicateExternalActions: externalActionAttempts
      ? acceptanceCheck(duplicateExternalActions, targets.maximumDuplicateExternalActions, "max")
      : { status: "insufficient_data", target: targets.maximumDuplicateExternalActions },
  };
  const evaluable = Object.values(checks).filter((check) => check.status !== "insufficient_data");

  return {
    schemaVersion: 2,
    completion: {
      ...completion,
      firstAttempt: {
        settled: firstAttemptSettled.length,
        completed: firstAttemptCompleted,
        rate: firstAttemptCompletionRate,
        check: checks.firstAttemptCompletionRate,
      },
      final: {
        settled: completion.settled,
        completed: completion.completed,
        rate: completion.completionRate,
        check: checks.completionRate,
      },
      check: checks.completionRate,
    },
    recovery: {
      required: recoveryRequired,
      succeeded: recoverySucceeded,
      pending: recoveryRequired - recoverySucceeded,
      successRate: recoverySuccessRate,
      durationMs: {
        samples: recoveryDurations.length,
        average: recoveryDurations.length
          ? Math.round(recoveryDurations.reduce((total, value) => total + value, 0) / recoveryDurations.length)
          : null,
        maximum: recoveryDurations.length ? Math.max(...recoveryDurations) : null,
      },
      check: checks.recoverySuccessRate,
    },
    humanIntervention: {
      count: humanInterventions,
      rate: humanInterventionRate,
      exceptionHandlingCount: exceptionHandling,
      userInitiatedRecovery: {
        actions: userRecoveryReceipts.length,
        tasks: userRecoveryTaskIds.size,
        rate: tracked.length ? userRecoveryTaskIds.size / tracked.length : null,
      },
      check: checks.humanInterventionRate,
    },
    automaticRecovery: {
      actions: automaticRecoveryReceipts.length,
      tasks: automaticRecoveryTaskIds.size,
      succeeded: successfulAutomaticRecoveries.length,
      successRate: automaticRecoveryReceipts.length
        ? successfulAutomaticRecoveries.length / automaticRecoveryReceipts.length
        : null,
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
    byCategory: categoryMetrics(mappedSamples, recoveryReceipts),
    definitions: {
      firstAttemptCompletionRate: "Evidence-confirmed tasks completed without a recovery action divided by settled tasks.",
      completionRate: "Evidence-confirmed completed tasks divided by settled tasks after recovery.",
      recoverySuccessRate: "Failed-run retries and checkpoint recoveries succeeded divided by recoveries started or required.",
      humanInterventionRate: "Tasks explicitly blocked on human input or approval divided by tracked tasks; exception states, voluntary recovery clicks, and normal sign-off are excluded.",
      userInitiatedRecovery: "Recovery commands deliberately started by a user; reported separately from forced human intervention.",
      automaticRecovery: "Recovery commands started by system policy or automation.",
      duplicateExternalActions: "External side-effect attempts after the first attempt on the same action receipt.",
    },
  };
}
