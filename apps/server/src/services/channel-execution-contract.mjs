import { createHash } from "node:crypto";

export const CHANNEL_EXECUTION_CONTRACT_VERSION = 1;

function boundedString(value, max = 400) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => boundedString(value, 200)).filter(Boolean))].sort();
}

/**
 * Freeze only the execution identity. Large previews and generated content stay
 * in their existing records; this bounded snapshot is the durable answer to
 * “which confirmed version did we execute?”
 */
export function freezeChannelExecutionContract({
  thread,
  resultData = null,
  workItemId = null,
  channelTaskRequestId = null,
  confirmedByEventId = null,
  confirmedAt,
  idempotencyKey,
} = {}) {
  const snapshot = {
    schemaVersion: CHANNEL_EXECUTION_CONTRACT_VERSION,
    threadId: boundedString(thread?.id, 200),
    taskKind: boundedString(resultData?.taskKind ?? thread?.taskKind, 80),
    intentId: boundedString(resultData?.intentId ?? thread?.intentId, 200),
    intentStatement: boundedString(resultData?.intentStatement ?? thread?.intentStatement ?? thread?.summary, 500),
    workGoalId: boundedString(resultData?.workGoalId ?? thread?.workGoalId, 200),
    workItemId: boundedString(workItemId ?? resultData?.workItemId ?? thread?.workItemId, 200),
    channelTaskRequestId: boundedString(channelTaskRequestId ?? resultData?.channelTaskRequestId ?? thread?.channelTaskRequestId, 200),
    dependencyIds: uniqueIds(resultData?.dependencyIds ?? thread?.dependencyIds),
    artifactDigest: boundedString(
      resultData?.artifactContract?.digest
        ?? thread?.artifactContract?.digest
        ?? resultData?.previewDigest
        ?? thread?.riskPreviewDigest,
      200,
    ),
    platformId: boundedString(resultData?.platformTarget?.id ?? thread?.platformTarget?.id, 100),
    previewDigest: boundedString(resultData?.previewDigest ?? thread?.riskPreviewDigest, 200),
  };
  return {
    schemaVersion: CHANNEL_EXECUTION_CONTRACT_VERSION,
    digest: digest(snapshot),
    snapshot,
    confirmedAt: confirmedAt ?? null,
    confirmedByEventId: boundedString(confirmedByEventId, 200),
    idempotencyKey: boundedString(idempotencyKey, 240),
  };
}

export function beginChannelExecutionAttempt(current, { operationKey, startedAt } = {}) {
  const previous = current && typeof current === "object" ? current : {};
  return {
    count: Math.max(0, Number(previous.count) || 0) + 1,
    operationKey: boundedString(operationKey, 240),
    startedAt: startedAt ?? null,
    finishedAt: null,
    outcome: "started",
    error: null,
  };
}

export function finishChannelExecutionAttempt(current, { outcome, finishedAt, error = null } = {}) {
  return {
    ...(current && typeof current === "object" ? current : {}),
    finishedAt: finishedAt ?? null,
    outcome: boundedString(outcome, 60) ?? "unknown",
    error: boundedString(error, 240),
  };
}
