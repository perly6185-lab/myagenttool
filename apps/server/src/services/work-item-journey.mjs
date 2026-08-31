const ACTIVE_RUN_STATUSES = new Set([
  "materializing", "queued", "running", "verifying", "publishing", "waiting_capacity",
]);
const FAILED_RUN_STATUSES = new Set(["failed", "blocked", "timed_out", "rejected", "expired"]);
const CANCELLED_RUN_STATUSES = new Set(["cancelled"]);
const PENDING_DELIVERY_STATUSES = new Set(["queued", "sending", "retrying", "sent_unconfirmed"]);
const FAILED_DELIVERY_STATUSES = new Set(["failed", "failed_terminal"]);

function bounded(value, max = 200) {
  const normalized = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, max) : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function action(kind, { target = "task", required = false } = {}) {
  return { kind, target, required };
}

function resultFacts({ outcome, resultVerification, completionAssessment, deliveryStatus }) {
  const verificationStatus = resultVerification?.status
    ?? (completionAssessment?.evidenceComplete === true ? "passed" : null);
  return {
    available: outcome?.status === "available" || completionAssessment?.evidenceComplete === true,
    verificationStatus: bounded(verificationStatus, 60) ?? "unknown",
    verified: verificationStatus === "passed" || completionAssessment?.evidenceComplete === true,
    deliveryStatus: bounded(deliveryStatus, 60),
    delivered: deliveryStatus === "delivered",
  };
}

function projection({
  origin,
  stage,
  status,
  waitingFor = null,
  reasonCodes = [],
  nextAction,
  result,
  item,
  thread,
  latestRun,
  delivery,
  updatedAt,
}) {
  return {
    schemaVersion: 1,
    origin,
    stage,
    status,
    waitingFor,
    requiresUserAction: nextAction.required === true,
    reasonCodes: unique(reasonCodes).slice(0, 20),
    nextAction,
    result,
    refs: {
      workItemId: item?.id ?? null,
      threadId: thread?.id ?? item?.channelOrigin?.threadId ?? null,
      autoRunId: latestRun?.id ?? thread?.autoRunId ?? null,
      deliveryId: delivery?.id ?? thread?.lastDeliveryId ?? null,
    },
    updatedAt: updatedAt ?? item?.updatedAt ?? latestRun?.updatedAt ?? thread?.updatedAt ?? null,
  };
}

/**
 * One ordinary-user interpretation of canonical task facts. The projection is
 * deliberately pure and is never persisted: WorkItem, Auto-run, approval,
 * verification, and Channel delivery records remain the only sources of truth.
 */
export function projectWorkItemJourney({
  item = null,
  latestRun = null,
  invocation = null,
  thread = null,
  delivery = null,
  contextSummary = null,
  completionAssessment = null,
  resultVerification = null,
  outcome = null,
  attention = [],
  updatedAt = null,
} = {}) {
  if (!item && !thread) return null;
  const origin = contextSummary?.origin?.kind
    ?? (item?.channelOrigin?.channelId || thread?.channelId ? "channel" : "task");
  const runStatus = bounded(latestRun?.status, 60);
  const invocationStatus = bounded(invocation?.status, 60);
  const threadStatus = bounded(thread?.status, 60);
  const deliveryStatus = bounded(delivery?.status ?? contextSummary?.delivery?.status ?? thread?.lastDeliveryStatus, 60);
  const result = resultFacts({ outcome, resultVerification, completionAssessment, deliveryStatus });
  const completionStatus = bounded(completionAssessment?.status, 60);
  const completionReasons = completionAssessment?.reasonCodes ?? [];
  const attentionKinds = (attention ?? []).map((entry) => bounded(entry?.kind, 80)).filter(Boolean);
  const declaredComplete = item?.state === "closed" || item?.status === "done";
  const factUpdatedAt = [item?.updatedAt, latestRun?.updatedAt, invocation?.updatedAt ?? invocation?.completedAt,
    thread?.updatedAt, delivery?.updatedAt ?? delivery?.createdAt]
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  const base = { origin, result, item, thread, latestRun, delivery, updatedAt: updatedAt ?? factUpdatedAt };

  if (threadStatus === "cancelled" || CANCELLED_RUN_STATUSES.has(runStatus)) {
    return projection({ ...base, stage: "cancelled", status: "cancelled", reasonCodes: ["task_cancelled"], nextAction: action("none") });
  }

  // Delivery is part of completion, not a secondary notification detail. A
  // newer failed or pending delivery must therefore outrank a stale completed
  // lifecycle projection.
  if (FAILED_DELIVERY_STATUSES.has(deliveryStatus)) {
    return projection({
      ...base, stage: "delivery_failed", status: "attention", waitingFor: "delivery_retry",
      reasonCodes: ["channel_delivery_failed"],
      nextAction: action("retry_delivery", { target: "channel", required: true }),
    });
  }

  if (PENDING_DELIVERY_STATUSES.has(deliveryStatus)
    && (threadStatus === "succeeded" || result.available || declaredComplete)) {
    return projection({
      ...base, stage: "delivering", status: "active", waitingFor: "delivery",
      reasonCodes: [deliveryStatus === "sent_unconfirmed" ? "channel_delivery_unconfirmed" : "channel_delivery_pending"],
      nextAction: action(deliveryStatus === "sent_unconfirmed" ? "retry_delivery" : "wait", {
        target: deliveryStatus === "sent_unconfirmed" ? "channel" : "task",
        required: deliveryStatus === "sent_unconfirmed",
      }),
    });
  }

  if (completionStatus === "completed") {
    return projection({ ...base, stage: "completed", status: "completed", reasonCodes: completionReasons, nextAction: action("none") });
  }

  if (completionStatus === "stopped") {
    return projection({
      ...base, stage: "stopped", status: "attention", waitingFor: "user_decision",
      reasonCodes: completionReasons.length ? completionReasons : ["delivery_stopped_by_user"],
      nextAction: action("review_result", { required: true }),
    });
  }

  if (completionStatus === "needs_attention" || completionStatus === "unverified") {
    const verificationFailed = resultVerification?.status === "failed"
      || completionReasons.some((reason) => /verification|result|output|evidence/.test(reason));
    return projection({
      ...base, stage: verificationFailed ? "verification_failed" : "needs_attention", status: "attention",
      waitingFor: "user_decision",
      reasonCodes: completionReasons.length ? completionReasons : ["completion_evidence_missing"],
      nextAction: verificationFailed
        ? action("create_repair_task", { required: true })
        : action("inspect_failure", { required: true }),
    });
  }

  if (resultVerification?.status === "failed") {
    return projection({
      ...base, stage: "verification_failed", status: "attention", waitingFor: "user_decision",
      reasonCodes: ["result_verification_failed"],
      nextAction: action("create_repair_task", { required: true }),
    });
  }

  if (completionStatus === "ready_to_complete") {
    return projection({
      ...base, stage: "ready_to_complete", status: "ready", waitingFor: "result_review",
      reasonCodes: completionReasons,
      nextAction: action("review_result", { required: true }),
    });
  }

  if (threadStatus === "awaiting_confirmation") {
    return projection({
      ...base, stage: "awaiting_confirmation", status: "waiting", waitingFor: "channel_confirmation",
      reasonCodes: ["channel_confirmation_required"],
      nextAction: action("confirm_in_channel", { target: "channel", required: true }),
    });
  }

  if (threadStatus === "waiting_user" || runStatus === "needs_input" || attentionKinds.includes("execution_input")) {
    return projection({
      ...base, stage: "waiting_input", status: "waiting", waitingFor: "user_input",
      reasonCodes: ["user_input_required"],
      nextAction: action(origin === "channel" ? "reply_in_channel" : "answer_ai", { target: origin === "channel" ? "channel" : "task", required: true }),
    });
  }

  if (threadStatus === "waiting_approval"
    || runStatus === "awaiting_approval"
    || invocationStatus === "waiting_for_local_approval"
    || attentionKinds.includes("execution_approval")) {
    return projection({
      ...base, stage: "waiting_approval", status: "waiting", waitingFor: "approval",
      reasonCodes: ["approval_required"],
      nextAction: action("open_approval", { target: "approval", required: true }),
    });
  }

  if (threadStatus === "waiting_upstream") {
    return projection({
      ...base, stage: "waiting_upstream", status: "waiting", waitingFor: "upstream_artifacts",
      reasonCodes: ["upstream_artifacts_pending"], nextAction: action("wait"),
    });
  }

  if (threadStatus === "paused") {
    return projection({
      ...base, stage: "paused", status: "waiting", waitingFor: "user_resume",
      reasonCodes: ["task_paused"],
      nextAction: action(origin === "channel" ? "reply_in_channel" : "resume_execution", { target: origin === "channel" ? "channel" : "task", required: true }),
    });
  }

  if (FAILED_RUN_STATUSES.has(runStatus) || threadStatus === "failed" || threadStatus === "needs_attention") {
    return projection({
      ...base, stage: "execution_failed", status: "attention", waitingFor: "recovery",
      reasonCodes: [bounded(latestRun?.errorCode, 100) ?? bounded(thread?.attentionReason, 100) ?? "execution_failed"],
      nextAction: action("retry_execution", { required: true }),
    });
  }

  if (ACTIVE_RUN_STATUSES.has(runStatus) || ["queued", "running"].includes(threadStatus)) {
    const stage = runStatus === "verifying" ? "verifying"
      : runStatus === "materializing" ? "preparing"
        : runStatus === "waiting_capacity" || threadStatus === "queued" ? "queued"
          : "executing";
    return projection({ ...base, stage, status: "active", reasonCodes: [], nextAction: action("wait") });
  }

  if (threadStatus === "succeeded" || result.available || declaredComplete) {
    const verified = result.verified;
    const delivered = origin !== "channel" || result.delivered;
    if (declaredComplete && verified && delivered) {
      return projection({ ...base, stage: "completed", status: "completed", reasonCodes: [], nextAction: action("none") });
    }
    return projection({
      ...base, stage: "ready_to_complete", status: "ready", waitingFor: "result_review",
      reasonCodes: verified ? (delivered ? [] : ["channel_delivery_not_proven"]) : ["completion_evidence_missing"],
      nextAction: action("review_result", { required: true }),
    });
  }

  return projection({
    ...base, stage: "not_started", status: "pending", reasonCodes: [],
    nextAction: action("start_execution", { required: true }),
  });
}
