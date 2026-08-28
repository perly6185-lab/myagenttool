import { autoExecutionDateKey, evaluateAutoExecutionCandidate } from "./work-item-auto-scheduler-policy.mjs";

const QUEUED_REASONS = new Set([
  "waiting_for_turn",
  "waiting_capacity",
  "dependencies_unresolved",
  "artifacts_unavailable",
  "not_before_reached",
  "future_pull_forward_disabled",
]);

function latestExecutableBinding(item) {
  return [...(item?.executionBindings ?? [])].reverse().find((binding) =>
    ["auto_run", "application_invocation"].includes(binding.kind)) ?? null;
}

function targetFor(binding, state) {
  if (!binding) return null;
  const targetId = binding.targetId ?? binding.id;
  if (binding.kind === "auto_run") {
    return (state?.autoRuns ?? []).find((candidate) => candidate.id === targetId) ?? null;
  }
  return (state?.invocations ?? []).find((candidate) => candidate.id === targetId) ?? null;
}

export function normalizeExecutionStartFailure(reason) {
  const detail = String(reason ?? "execution_start_failed").slice(0, 500);
  if (detail.startsWith("At capacity:") || detail === "waiting_capacity") {
    return { status: "queued", reasonCode: "waiting_capacity", reasonDetail: detail };
  }
  const reasonCode = /^[a-z0-9_:-]+$/i.test(detail) ? detail.slice(0, 160) : "execution_start_failed";
  return { status: "blocked", reasonCode, reasonDetail: detail };
}

export function projectExecutionStartReceipt(item, state, { now = new Date().toISOString() } = {}) {
  const stored = item?.executionStartRequest ?? null;
  const legacy = !stored && item?.executionContractConfirmedAt && item?.executionPolicy === "auto"
    ? {
        schemaVersion: 1,
        id: `legacy:${item.id}:${item.executionContractConfirmedAt}`,
        status: "queued",
        requestedAt: item.executionContractConfirmedAt,
        requestedBy: item.lastModifiedBy ?? item.createdBy ?? null,
        confirmedRevision: item.revision ?? null,
        contractDigest: item.executionContractSnapshot?.digest ?? null,
        updatedAt: item.updatedAt ?? item.executionContractConfirmedAt,
      }
    : null;
  const request = stored ?? legacy;
  if (!request) return null;

  const base = {
    schemaVersion: 1,
    id: request.id,
    requestedAt: request.requestedAt ?? item.executionContractConfirmedAt ?? null,
    requestedBy: request.requestedBy ?? null,
    confirmedRevision: request.confirmedRevision ?? null,
    contractDigest: request.contractDigest ?? null,
    updatedAt: request.updatedAt ?? item.updatedAt ?? null,
    startedAt: request.startedAt ?? null,
    executionKind: request.executionKind ?? null,
    targetId: request.targetId ?? null,
    agentId: request.agentId ?? null,
    reasonCode: request.reasonCode ?? null,
    reasonDetail: request.reasonDetail ?? null,
    cancelledAt: request.cancelledAt ?? null,
    cancelledBy: request.cancelledBy ?? null,
  };
  if (request.status === "cancelled") {
    return { ...base, status: "cancelled", phase: null, canCancel: false };
  }

  const binding = latestExecutableBinding(item);
  if (binding) {
    const target = targetFor(binding, state);
    const targetId = binding.targetId ?? binding.id ?? null;
    return {
      ...base,
      status: target ? "started" : "blocked",
      phase: target?.status ?? null,
      startedAt: base.startedAt ?? binding.createdAt ?? target?.createdAt ?? null,
      executionKind: binding.kind,
      targetId,
      agentId: target?.agentId ?? base.agentId,
      reasonCode: target ? null : "execution_target_unavailable",
      reasonDetail: target ? null : "The recorded execution target is no longer available.",
      canCancel: false,
    };
  }
  if (item?.executionOperation?.status === "starting") {
    return {
      ...base,
      status: "starting",
      phase: "execution_admission",
      executionKind: item.executionOperation.kind ?? base.executionKind,
      agentId: item.executionOperation.agentId ?? base.agentId,
      reasonCode: null,
      reasonDetail: null,
      canCancel: false,
    };
  }
  if (item?.executionPolicy === "paused") {
    return { ...base, status: "paused", phase: null, reasonCode: "execution_paused", reasonDetail: null, canCancel: true };
  }
  if (["me", "requester", "internal"].includes(item?.waitingOn)) {
    return { ...base, status: "blocked", phase: null, reasonCode: "waiting_for_user", reasonDetail: null, canCancel: true };
  }

  const project = (state?.projects ?? []).find((candidate) => candidate.id === item.projectId) ?? null;
  const itemsById = new Map((state?.workItems ?? []).map((candidate) => [String(candidate.id), candidate]));
  const decision = evaluateAutoExecutionCandidate(item, {
    today: autoExecutionDateKey(now),
    now,
    project,
    itemsById,
  });
  if (decision.reasons.length === 0 && ["blocked", "queued"].includes(request.status)) {
    return { ...base, status: request.status, phase: null, canCancel: true };
  }
  const reasonCode = decision.reasons[0] ?? "waiting_for_turn";
  const status = reasonCode === "execution_paused"
    ? "paused"
    : decision.reasons.length === 0 || QUEUED_REASONS.has(reasonCode) ? "queued" : "blocked";
  return { ...base, status, phase: null, reasonCode, reasonDetail: null, canCancel: true };
}
