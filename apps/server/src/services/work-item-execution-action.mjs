import { createHash } from "node:crypto";

const DELIVERY_ACTION_KINDS = new Set([
  "create_pull_request",
  "update_pull_request",
  "apply_office_result",
  "apply_local_changes",
]);
const ACTION_KINDS = new Set([
  "retry_execution",
  "fix_with_ai",
  "rerun_verification",
  "answer_ai",
  ...DELIVERY_ACTION_KINDS,
]);
const RECEIPT_STATUSES = new Set(["accepted", "running", "succeeded", "failed", "safe_to_retry", "unknown"]);
const TERMINAL_RECEIPT_STATUSES = new Set(["succeeded", "failed", "safe_to_retry"]);
export const EXECUTION_ACTION_RECEIPT_LIMIT = 20;
export const EXECUTION_ACTION_IDEMPOTENCY_LEDGER_LIMIT = 2_000;
export const EXECUTION_ACTION_IDEMPOTENCY_ARCHIVE_AFTER_MS = 90 * 24 * 60 * 60_000;
export const EXECUTION_ACTION_IDEMPOTENCY_MIGRATION_KEY = "application_migration.execution_action_idempotency_records.v1";
const UNCERTAIN_AFTER_MS = 10 * 60_000;

function boundedText(value, max = 2_000) {
  if (value == null) return null;
  return String(value).trim().slice(0, max) || null;
}

function optionalRevision(value) {
  if (value == null || String(value).trim() === "") return null;
  const revision = Number(value);
  return Number.isInteger(revision) ? revision : null;
}

function actionError(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, details);
  return error;
}

function requestDigest(kind, request) {
  return createHash("sha256").update(JSON.stringify({ kind, request: request ?? null })).digest("hex");
}

function receiptSnapshot(receipt) {
  if (!receipt) return null;
  const snapshot = { ...receipt };
  delete snapshot.replayed;
  return snapshot;
}

function normalizedDeliveryCheckpoint(value) {
  if (!value || typeof value !== "object") return null;
  const mode = ["local_merge", "pull_request"].includes(value.mode) ? value.mode : null;
  const operationId = boundedText(value.operationId, 200);
  if (!mode || !operationId) return null;
  const result = value.result && typeof value.result === "object" ? value.result : {};
  return {
    schemaVersion: 1,
    mode,
    operationId,
    result: {
      baseBranch: boundedText(result.baseBranch, 200),
      commit: boundedText(result.commit, 200),
      deliveredAt: boundedText(result.deliveredAt, 100),
      number: Number.isInteger(result.number) ? result.number : null,
      url: boundedText(result.url, 2_000),
    },
  };
}

function ledgerRecordId(autoRunId, idempotencyKey) {
  return `eai_${createHash("sha256").update(`${autoRunId}\0${idempotencyKey}`).digest("hex").slice(0, 32)}`;
}

function ledgerEntryForReceipt(receipt, autoRun = null) {
  return {
    schemaVersion: 1,
    storageTier: "hot",
    ...(autoRun ? {
      id: ledgerRecordId(autoRun.id, receipt.idempotencyKey),
      autoRunId: autoRun.id,
      ownerTeamId: autoRun.teamId ?? autoRun.ownerTeamId ?? null,
      projectId: autoRun.projectId ?? null,
    } : {}),
    idempotencyKey: receipt.idempotencyKey,
    kind: receipt.kind,
    requestDigest: receipt.requestDigest,
    receiptId: receipt.id,
    requestedAt: receipt.requestedAt ?? null,
    updatedAt: receipt.updatedAt ?? receipt.requestedAt ?? null,
    receipt: receiptSnapshot(receipt),
  };
}

function attachLedgerEntry(receipt, entry) {
  if (!receipt || !entry) return receipt;
  Object.defineProperty(receipt, "_executionActionLedgerEntry", {
    value: entry,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  return receipt;
}

function hotLedgerSize(ledger) {
  return ledger.filter((entry) => entry.storageTier !== "archive").length;
}

function ensureIdempotencyRecords(state, autoRun) {
  const durableRecords = state
    ? (state.executionActionIdempotencyRecords ??= [])
    : null;
  const ledger = durableRecords
    ? durableRecords.filter((entry) => entry.autoRunId === autoRun.id)
    : Array.isArray(autoRun.executionActionIdempotencyLedger)
      ? autoRun.executionActionIdempotencyLedger
      : [];
  if (durableRecords && Array.isArray(autoRun.executionActionIdempotencyLedger)) {
    for (const legacy of autoRun.executionActionIdempotencyLedger) {
      if (!legacy?.idempotencyKey || ledger.some((entry) => entry.idempotencyKey === legacy.idempotencyKey)) continue;
      const entry = {
        ...legacy,
        id: ledgerRecordId(autoRun.id, legacy.idempotencyKey),
        autoRunId: autoRun.id,
        ownerTeamId: autoRun.teamId ?? autoRun.ownerTeamId ?? null,
        projectId: autoRun.projectId ?? null,
      };
      durableRecords.push(entry);
      ledger.push(entry);
    }
    delete autoRun.executionActionIdempotencyLedger;
  }
  for (const receipt of [...(autoRun.executionActionReceipts ?? [])].reverse()) {
    if (!receipt?.idempotencyKey || !receipt.requestDigest) continue;
    let entry = ledger.find((candidate) => candidate.idempotencyKey === receipt.idempotencyKey) ?? null;
    if (!entry && hotLedgerSize(ledger) < EXECUTION_ACTION_IDEMPOTENCY_LEDGER_LIMIT) {
      entry = ledgerEntryForReceipt(receipt, durableRecords ? autoRun : null);
      if (durableRecords) durableRecords.push(entry);
      ledger.push(entry);
    }
    if (entry) attachLedgerEntry(receipt, entry);
  }
  return ledger;
}

export function executionActionIdempotencyMigrationNeeded(state) {
  const durableKeys = new Set((state?.executionActionIdempotencyRecords ?? []).map((entry) =>
    `${entry.autoRunId}\0${entry.idempotencyKey}`));
  return (state?.autoRuns ?? []).some((autoRun) => {
    if (Object.hasOwn(autoRun, "executionActionIdempotencyLedger")) return true;
    return (autoRun.executionActionReceipts ?? []).some((receipt) =>
      receipt?.idempotencyKey
      && receipt.requestDigest
      && !durableKeys.has(`${autoRun.id}\0${receipt.idempotencyKey}`));
  });
}

export function migrateExecutionActionIdempotencyRecords(state) {
  const before = (state?.executionActionIdempotencyRecords ?? []).length;
  let legacyRuns = 0;
  for (const autoRun of state?.autoRuns ?? []) {
    if (Object.hasOwn(autoRun, "executionActionIdempotencyLedger")) legacyRuns += 1;
    ensureIdempotencyRecords(state, autoRun);
  }
  return {
    migratedRecords: (state?.executionActionIdempotencyRecords ?? []).length - before,
    legacyRuns,
  };
}

function executionActionArchiveCandidates(state, {
  now = new Date().toISOString(),
  archiveAfterMs = EXECUTION_ACTION_IDEMPOTENCY_ARCHIVE_AFTER_MS,
  autoRunId = null,
} = {}) {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs) || !Number.isFinite(archiveAfterMs) || archiveAfterMs < 0) return [];
  const cutoff = nowMs - archiveAfterMs;
  return (state?.executionActionIdempotencyRecords ?? []).filter((entry) => {
    if (!entry || entry.storageTier === "archive") return false;
    if (autoRunId && entry.autoRunId !== autoRunId) return false;
    if (!TERMINAL_RECEIPT_STATUSES.has(entry.receipt?.status)) return false;
    const settledAt = Date.parse(entry.receipt?.completedAt ?? entry.updatedAt ?? entry.requestedAt ?? "");
    return Number.isFinite(settledAt) && settledAt <= cutoff;
  });
}

export function executionActionIdempotencyArchiveNeeded(state, options = {}) {
  return executionActionArchiveCandidates(state, options).length > 0;
}

// Archiving is deliberately a logical storage tier, not deletion. The compact
// tombstone remains in the authoritative collection and replay searches it just
// like a hot record, so an old request key can never become executable again.
// Archived records stop consuming the per-run hot capacity budget.
export function archiveExecutionActionIdempotencyRecords(state, options = {}) {
  const archivedAt = options.now ?? new Date().toISOString();
  const candidates = executionActionArchiveCandidates(state, { ...options, now: archivedAt });
  for (const entry of candidates) {
    entry.storageTier = "archive";
    entry.archivedAt = archivedAt;
    entry.retentionClass = "exactly_once_tombstone";
  }
  return { archivedRecords: candidates.length, archivedAt: candidates.length ? archivedAt : null };
}

export function syncExecutionActionIdempotencyLedger(autoRun, receipt, state = null) {
  if (!autoRun || !receipt?.idempotencyKey || !receipt.requestDigest) return false;
  const ledger = ensureIdempotencyRecords(state, autoRun);
  let entry = receipt._executionActionLedgerEntry
    ?? ledger.find((candidate) => candidate.idempotencyKey === receipt.idempotencyKey)
    ?? null;
  if (!entry) {
    if (hotLedgerSize(ledger) >= EXECUTION_ACTION_IDEMPOTENCY_LEDGER_LIMIT) return false;
    entry = ledgerEntryForReceipt(receipt, state ? autoRun : null);
    if (state) state.executionActionIdempotencyRecords.push(entry);
    ledger.push(entry);
  } else {
    entry.kind = receipt.kind;
    entry.requestDigest = receipt.requestDigest;
    entry.receiptId = receipt.id;
    entry.requestedAt = receipt.requestedAt ?? null;
    entry.updatedAt = receipt.updatedAt ?? receipt.requestedAt ?? null;
    entry.receipt = receiptSnapshot(receipt);
  }
  attachLedgerEntry(receipt, entry);
  return true;
}

function boundWorkItem(state, autoRun) {
  const directId = autoRun?.localIssueId ?? autoRun?.executionChainId ?? null;
  const direct = directId ? (state.workItems ?? []).find((item) => item.id === directId) : null;
  if (direct) return direct;
  return [...(state.workItems ?? [])].reverse().find((item) => {
    const bindings = (item.executionBindings ?? []).filter((binding) => binding.kind === "auto_run");
    return bindings.at(-1)?.targetId === autoRun.id;
  }) ?? null;
}

export function replayExecutionAction(autoRun, {
  kind,
  idempotencyKey = null,
  request = null,
  state = null,
} = {}) {
  const key = boundedText(idempotencyKey, 200);
  if (!key) return null;
  const recent = (autoRun?.executionActionReceipts ?? []).find((receipt) => receipt.idempotencyKey === key) ?? null;
  const ledgerEntry = ensureIdempotencyRecords(state, autoRun)
    .find((entry) => entry.idempotencyKey === key) ?? null;
  if (!recent && ledgerEntry && !ledgerEntry.receipt) {
    throw actionError(
      "execution_action_idempotency_evidence_missing",
      "This action key exists in the long-term ledger, but its result cannot be reconstructed. No action was started.",
      409,
    );
  }
  const existing = recent ?? (ledgerEntry?.receipt ? { ...ledgerEntry.receipt } : null);
  if (!existing) return null;
  const existingKind = ledgerEntry?.kind ?? existing.kind;
  const existingDigest = ledgerEntry?.requestDigest ?? existing.requestDigest;
  if (existingKind !== kind || existingDigest !== requestDigest(kind, request)) {
    throw actionError("execution_action_idempotency_conflict", "This action key was already used for a different request.", 409);
  }
  if (!recent && ledgerEntry) attachLedgerEntry(existing, ledgerEntry);
  return existing;
}

function hasReachedTarget(receipt, autoRun) {
  return Boolean(
    (receipt.targetId && autoRun?.invocationId === receipt.targetId)
    || (receipt.kind === "rerun_verification" && autoRun?.verificationAttempt?.requestedAt === receipt.requestedAt)
    || (receipt.kind === "answer_ai" && (
      autoRun?.clarificationResume?.startedAt === receipt.requestedAt
      || autoRun?.clarifyAnswer?.at === receipt.requestedAt
    ))
    || (["create_pull_request", "update_pull_request"].includes(receipt.kind)
      && Boolean(autoRun?.localDelivery?.promotedAt || autoRun?.prNumber || autoRun?.prUrl))
    || (["apply_office_result", "apply_local_changes"].includes(receipt.kind)
      && Boolean(autoRun?.localDelivery?.deliveredAt)),
  );
}

function deliveryCompletion(receipt, autoRun) {
  if (!DELIVERY_ACTION_KINDS.has(receipt?.kind)) return null;
  if (["create_pull_request", "update_pull_request"].includes(receipt.kind)) {
    return {
      messageCode: receipt.kind === "update_pull_request" ? "pull_request_updated" : "pull_request_created",
      impact: "proposed",
      nextOwner: "me",
      targetId: autoRun?.prUrl
        ?? autoRun?.localDelivery?.prUrl
        ?? (autoRun?.prNumber == null ? null : `pull_request:${autoRun.prNumber}`),
    };
  }
  return {
    messageCode: receipt.kind === "apply_office_result" ? "office_result_applied" : "local_changes_applied",
    impact: "applied",
    nextOwner: "none",
    targetId: autoRun?.localDelivery?.deliveredCommit ?? autoRun?.localDelivery?.baseBranch ?? null,
  };
}

function isStalePending(receipt, now) {
  const requestedAt = Date.parse(receipt?.requestedAt ?? "");
  return ["accepted", "running"].includes(receipt?.status)
    && Number.isFinite(requestedAt)
    && Date.parse(now) - requestedAt >= UNCERTAIN_AFTER_MS;
}

function projectedReceiptStatus(receipt, { now, autoRun }) {
  let status = RECEIPT_STATUSES.has(receipt.status) ? receipt.status : "unknown";
  const reachedTarget = hasReachedTarget(receipt, autoRun);
  if (["accepted", "running"].includes(status) && reachedTarget) {
    if (receipt.kind === "rerun_verification" && autoRun?.verificationAttempt?.status === "running") return "running";
    if (receipt.kind === "answer_ai" && autoRun?.clarificationResume?.status === "processing") return "running";
    return "succeeded";
  }
  if (isStalePending(receipt, now)) {
    // Delivery can cross a process boundary after mutating git, a remote PR, or
    // an office artifact. Absence of completion evidence cannot prove that it
    // is safe to repeat, even when the source invocation did not change.
    if (DELIVERY_ACTION_KINDS.has(receipt.kind)) return "unknown";
    const sourceUnchanged = Boolean(receipt.sourceTargetId)
      && (autoRun?.invocationId ?? null) === receipt.sourceTargetId;
    status = sourceUnchanged ? "safe_to_retry" : "unknown";
  }
  return status;
}

function visibleReceipt(receipt, { now = new Date().toISOString(), autoRun = null } = {}) {
  if (!receipt) return null;
  const status = projectedReceiptStatus(receipt, { now, autoRun });
  const completedDelivery = status === "succeeded" && hasReachedTarget(receipt, autoRun)
    ? deliveryCompletion(receipt, autoRun)
    : null;
  return {
    schemaVersion: 1,
    id: receipt.id,
    kind: receipt.kind,
    status,
    messageCode: status === "safe_to_retry"
      ? "safe_to_retry"
      : completedDelivery?.messageCode ?? boundedText(receipt.messageCode, 120),
    impact: completedDelivery?.impact
      ?? (["none", "proposed", "applied", "unknown"].includes(receipt.impact) ? receipt.impact : "unknown"),
    nextOwner: ["unknown", "safe_to_retry"].includes(status)
      ? "me"
      : completedDelivery?.nextOwner
        ?? (["ai", "me", "system", "none"].includes(receipt.nextOwner) ? receipt.nextOwner : "me"),
    requestedAt: receipt.requestedAt ?? null,
    updatedAt: receipt.updatedAt ?? receipt.requestedAt ?? null,
    completedAt: receipt.completedAt ?? null,
    targetId: boundedText(completedDelivery?.targetId ?? receipt.targetId, 200),
    errorCode: boundedText(receipt.errorCode, 160),
    errorMessage: boundedText(receipt.errorMessage, 500),
    replayed: receipt.replayed === true,
  };
}

export function executionActionReceiptView(receipt, {
  now = new Date().toISOString(),
  autoRun = null,
  replayed = false,
} = {}) {
  const visible = visibleReceipt(receipt, { now, autoRun });
  return visible ? { ...visible, replayed } : null;
}

export function beginExecutionAction({
  state,
  autoRun,
  kind,
  actor = null,
  idempotencyKey = null,
  expectedWorkItemRevision = null,
  expectedTargetStatus = null,
  request = null,
  nextOwner = "system",
  now,
  nextId,
} = {}) {
  if (!autoRun) throw actionError("auto_run_not_found", "Auto-run not found.", 404);
  if (!ACTION_KINDS.has(kind)) throw actionError("execution_action_kind_invalid", "The execution action is not supported.");
  const key = boundedText(idempotencyKey, 200);
  const digest = requestDigest(kind, request);
  const existing = replayExecutionAction(autoRun, { kind, idempotencyKey: key, request, state });
  if (existing) {
    return { receipt: existing, replayed: true, workItem: boundWorkItem(state, autoRun) };
  }
  if (DELIVERY_ACTION_KINDS.has(kind)) {
    const unresolved = [
      ...(autoRun.executionActionReceipts ?? []),
      ...ensureIdempotencyRecords(state, autoRun).map((entry) => entry.receipt).filter(Boolean),
    ].find((receipt) => DELIVERY_ACTION_KINDS.has(receipt.kind)
      && (["accepted", "running", "unknown"].includes(receipt.status)
        || (receipt.status === "failed" && receipt.impact === "unknown")));
    if (unresolved) {
      throw actionError(
        "execution_action_delivery_unresolved",
        "A previous delivery may already have changed the target. Reconcile it before starting another delivery.",
        409,
        { actionReceipt: visibleReceipt(unresolved, { now: now(), autoRun }) },
      );
    }
  }

  const workItem = boundWorkItem(state, autoRun);
  const requestedAt = now();
  const receipt = {
    schemaVersion: 1,
    id: nextId("ear"),
    kind,
    status: "accepted",
    messageCode: "request_accepted",
    impact: "none",
    nextOwner,
    requestedAt,
    updatedAt: requestedAt,
    completedAt: null,
    requestedBy: actor?.userId ?? "usr_local",
    idempotencyKey: key,
    requestDigest: digest,
    expectedWorkItemRevision: optionalRevision(expectedWorkItemRevision),
    expectedTargetStatus: boundedText(expectedTargetStatus, 80),
    sourceTargetId: boundedText(autoRun.invocationId, 200),
    targetId: null,
    errorCode: null,
    errorMessage: null,
    replayed: false,
  };
  const staleRevision = receipt.expectedWorkItemRevision != null
    && (!workItem || Number(workItem.revision) !== receipt.expectedWorkItemRevision);
  const staleTarget = receipt.expectedTargetStatus && autoRun.status !== receipt.expectedTargetStatus;
  if (staleRevision || staleTarget) {
    receipt.status = "failed";
    receipt.messageCode = "stale_state";
    receipt.errorCode = "execution_action_stale";
    receipt.errorMessage = "The task or execution changed after this review was loaded.";
    receipt.completedAt = requestedAt;
    throw actionError("execution_action_stale", receipt.errorMessage, 409, {
      currentWorkItemRevision: workItem?.revision ?? null,
      currentTargetStatus: autoRun.status ?? null,
      actionReceipt: visibleReceipt(receipt, { now: requestedAt, autoRun }),
    });
  }
  const ledger = key ? ensureIdempotencyRecords(state, autoRun) : null;
  if (key && state) {
    archiveExecutionActionIdempotencyRecords(state, { now: requestedAt, autoRunId: autoRun.id });
  }
  const activeLedgerSize = ledger ? hotLedgerSize(ledger) : 0;
  if (key && activeLedgerSize >= EXECUTION_ACTION_IDEMPOTENCY_LEDGER_LIMIT) {
    throw actionError(
      "execution_action_idempotency_capacity",
      "The active long-term action ledger is full. No new action was started; old keys were retained to prevent duplicate execution.",
      409,
    );
  }
  (autoRun.executionActionReceipts ??= []).unshift(receipt);
  autoRun.executionActionReceipts = autoRun.executionActionReceipts.slice(0, EXECUTION_ACTION_RECEIPT_LIMIT);
  if (key) {
    const entry = ledgerEntryForReceipt(receipt, state ? autoRun : null);
    if (state) state.executionActionIdempotencyRecords.push(entry);
    ledger.push(entry);
    attachLedgerEntry(receipt, entry);
  }
  return { receipt, replayed: false, workItem };
}

export function updateExecutionAction(receipt, {
  status,
  messageCode,
  impact = receipt?.impact ?? "none",
  nextOwner = receipt?.nextOwner ?? "system",
  targetId = receipt?.targetId ?? null,
  errorCode = null,
  errorMessage = null,
  deliveryCheckpoint = undefined,
  deliveryRecovery = null,
  externalActionAttempt = false,
  now,
} = {}) {
  if (!receipt) return null;
  const updatedAt = now();
  receipt.status = RECEIPT_STATUSES.has(status) ? status : "unknown";
  receipt.messageCode = boundedText(messageCode, 120) ?? receipt.messageCode;
  receipt.impact = ["none", "proposed", "applied", "unknown"].includes(impact) ? impact : "unknown";
  receipt.nextOwner = ["ai", "me", "system", "none"].includes(nextOwner) ? nextOwner : "me";
  receipt.targetId = boundedText(targetId, 200);
  receipt.errorCode = boundedText(errorCode, 160);
  receipt.errorMessage = boundedText(errorMessage, 500);
  if (deliveryCheckpoint !== undefined) {
    receipt.deliveryCheckpoint = normalizedDeliveryCheckpoint(deliveryCheckpoint);
  }
  if (externalActionAttempt) {
    receipt.externalActionAttemptCount = Math.max(0, Number(receipt.externalActionAttemptCount) || 0) + 1;
    receipt.lastExternalActionAttemptAt = updatedAt;
  }
  if (["required", "attempt_failed", "recovered"].includes(deliveryRecovery)) {
    const recovery = receipt.deliveryRecovery && typeof receipt.deliveryRecovery === "object"
      ? receipt.deliveryRecovery
      : { schemaVersion: 1, requiredAt: updatedAt, attempts: 0, recoveredAt: null, lastAttemptAt: null };
    recovery.requiredAt ??= updatedAt;
    if (deliveryRecovery === "attempt_failed" || deliveryRecovery === "recovered") {
      recovery.attempts = Math.max(0, Number(recovery.attempts) || 0) + 1;
      recovery.lastAttemptAt = updatedAt;
    }
    if (deliveryRecovery === "recovered") recovery.recoveredAt = updatedAt;
    receipt.deliveryRecovery = recovery;
  }
  receipt.updatedAt = updatedAt;
  receipt.completedAt = TERMINAL_RECEIPT_STATUSES.has(receipt.status) ? updatedAt : null;
  const ledgerEntry = receipt._executionActionLedgerEntry;
  if (ledgerEntry) {
    ledgerEntry.kind = receipt.kind;
    ledgerEntry.requestDigest = receipt.requestDigest;
    ledgerEntry.receiptId = receipt.id;
    ledgerEntry.requestedAt = receipt.requestedAt ?? null;
    ledgerEntry.updatedAt = receipt.updatedAt ?? receipt.requestedAt ?? null;
    ledgerEntry.receipt = receiptSnapshot(receipt);
  }
  return receipt;
}

export function reconcileExecutionActionReceipt(receipt, {
  state = null,
  autoRun,
  findInvocation = () => null,
  findTargetInvocation = () => null,
  now = new Date().toISOString(),
  force = false,
} = {}) {
  if (!receipt || !autoRun) return { changed: false, receipt };
  if (TERMINAL_RECEIPT_STATUSES.has(receipt.status)) {
    syncExecutionActionIdempotencyLedger(autoRun, receipt, state);
    return { changed: false, receipt };
  }

  let changed = false;
  const finish = () => {
    syncExecutionActionIdempotencyLedger(autoRun, receipt, state);
    return { changed, receipt };
  };
  const set = (key, value) => {
    if ((receipt[key] ?? null) === (value ?? null)) return;
    receipt[key] = value;
    changed = true;
  };
  if (["retry_execution", "fix_with_ai"].includes(receipt.kind)
    && !receipt.targetId
    && receipt.sourceTargetId
    && autoRun.invocationId
    && autoRun.invocationId !== receipt.sourceTargetId) {
    set("targetId", autoRun.invocationId);
  }

  const correlatedInvocation = !receipt.targetId && typeof findTargetInvocation === "function"
    ? findTargetInvocation(receipt)
    : null;
  if (correlatedInvocation?.id) set("targetId", correlatedInvocation.id);

  const targetInvocation = receipt.targetId && typeof findInvocation === "function"
    ? findInvocation(receipt.targetId) ?? correlatedInvocation
    : correlatedInvocation;
  const reachedTarget = hasReachedTarget(receipt, autoRun) || Boolean(targetInvocation);
  if (reachedTarget) {
    const stillProcessing = (receipt.kind === "rerun_verification" && autoRun.verificationAttempt?.status === "running")
      || (receipt.kind === "answer_ai" && autoRun.clarificationResume?.status === "processing");
    if (stillProcessing) {
      set("status", "running");
      set("messageCode", receipt.kind === "rerun_verification" ? "verification_running" : "answer_processing");
      set("nextOwner", "system");
      if (changed) set("updatedAt", now);
      return finish();
    }
    const completedDelivery = deliveryCompletion(receipt, autoRun);
    set("status", "succeeded");
    set("messageCode", completedDelivery?.messageCode ?? (receipt.messageCode === "request_accepted"
      ? (["retry_execution", "fix_with_ai"].includes(receipt.kind)
          ? (receipt.kind === "fix_with_ai" ? "ai_fix_started" : "retry_started")
          : receipt.kind === "rerun_verification" ? "verification_completed" : "answer_recorded")
      : receipt.messageCode));
    set("impact", completedDelivery?.impact ?? receipt.impact);
    set("nextOwner", completedDelivery?.nextOwner
      ?? (["retry_execution", "fix_with_ai"].includes(receipt.kind) ? "ai" : "system"));
    if (completedDelivery?.targetId) set("targetId", completedDelivery.targetId);
    set("updatedAt", now);
    set("completedAt", now);
    return finish();
  }

  if (force || isStalePending(receipt, now) || receipt.status === "unknown") {
    if (DELIVERY_ACTION_KINDS.has(receipt.kind)) {
      set("status", "unknown");
      set("messageCode", "delivery_result_unknown");
      set("impact", "unknown");
      set("nextOwner", "me");
      if (changed) set("updatedAt", now);
      return finish();
    }
    const sourceUnchanged = Boolean(receipt.sourceTargetId)
      && (autoRun.invocationId ?? null) === receipt.sourceTargetId;
    set("status", sourceUnchanged ? "safe_to_retry" : "unknown");
    set("messageCode", sourceUnchanged ? "safe_to_retry" : "action_result_unknown");
    set("impact", sourceUnchanged ? "none" : "unknown");
    set("nextOwner", "me");
    if (changed) {
      set("updatedAt", now);
      set("completedAt", sourceUnchanged ? now : null);
    }
  }
  return finish();
}

export function latestExecutionActionReceipt(autoRun, { now = new Date().toISOString() } = {}) {
  const latest = [...(autoRun?.executionActionReceipts ?? [])]
    .sort((left, right) => String(right.requestedAt ?? "").localeCompare(String(left.requestedAt ?? "")))[0] ?? null;
  return executionActionReceiptView(latest, { now, autoRun });
}

export { actionError as executionActionError };
