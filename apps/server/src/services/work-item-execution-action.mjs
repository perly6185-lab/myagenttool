import { createHash } from "node:crypto";

const ACTION_KINDS = new Set(["retry_execution", "fix_with_ai", "rerun_verification", "answer_ai"]);
const RECEIPT_STATUSES = new Set(["accepted", "running", "succeeded", "failed", "safe_to_retry", "unknown"]);
const TERMINAL_RECEIPT_STATUSES = new Set(["succeeded", "failed", "safe_to_retry"]);
export const EXECUTION_ACTION_RECEIPT_LIMIT = 20;
export const EXECUTION_ACTION_IDEMPOTENCY_LEDGER_LIMIT = 2_000;
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

function ledgerEntryForReceipt(receipt) {
  return {
    schemaVersion: 1,
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

function ensureIdempotencyLedger(autoRun) {
  const ledger = Array.isArray(autoRun.executionActionIdempotencyLedger)
    ? autoRun.executionActionIdempotencyLedger
    : (autoRun.executionActionIdempotencyLedger = []);
  for (const receipt of [...(autoRun.executionActionReceipts ?? [])].reverse()) {
    if (!receipt?.idempotencyKey || !receipt.requestDigest) continue;
    let entry = ledger.find((candidate) => candidate.idempotencyKey === receipt.idempotencyKey) ?? null;
    if (!entry && ledger.length < EXECUTION_ACTION_IDEMPOTENCY_LEDGER_LIMIT) {
      entry = ledgerEntryForReceipt(receipt);
      ledger.push(entry);
    }
    if (entry) attachLedgerEntry(receipt, entry);
  }
  return ledger;
}

export function syncExecutionActionIdempotencyLedger(autoRun, receipt) {
  if (!autoRun || !receipt?.idempotencyKey || !receipt.requestDigest) return false;
  const ledger = ensureIdempotencyLedger(autoRun);
  let entry = receipt._executionActionLedgerEntry
    ?? ledger.find((candidate) => candidate.idempotencyKey === receipt.idempotencyKey)
    ?? null;
  if (!entry) {
    if (ledger.length >= EXECUTION_ACTION_IDEMPOTENCY_LEDGER_LIMIT) return false;
    entry = ledgerEntryForReceipt(receipt);
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

export function replayExecutionAction(autoRun, { kind, idempotencyKey = null, request = null } = {}) {
  const key = boundedText(idempotencyKey, 200);
  if (!key) return null;
  const recent = (autoRun?.executionActionReceipts ?? []).find((receipt) => receipt.idempotencyKey === key) ?? null;
  const ledgerEntry = (autoRun?.executionActionIdempotencyLedger ?? [])
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
    )),
  );
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
    const sourceUnchanged = Boolean(receipt.sourceTargetId)
      && (autoRun?.invocationId ?? null) === receipt.sourceTargetId;
    status = sourceUnchanged ? "safe_to_retry" : "unknown";
  }
  return status;
}

function visibleReceipt(receipt, { now = new Date().toISOString(), autoRun = null } = {}) {
  if (!receipt) return null;
  const status = projectedReceiptStatus(receipt, { now, autoRun });
  return {
    schemaVersion: 1,
    id: receipt.id,
    kind: receipt.kind,
    status,
    messageCode: status === "safe_to_retry" ? "safe_to_retry" : boundedText(receipt.messageCode, 120),
    impact: ["none", "proposed", "applied", "unknown"].includes(receipt.impact) ? receipt.impact : "unknown",
    nextOwner: ["unknown", "safe_to_retry"].includes(status)
      ? "me"
      : (["ai", "me", "system", "none"].includes(receipt.nextOwner) ? receipt.nextOwner : "me"),
    requestedAt: receipt.requestedAt ?? null,
    updatedAt: receipt.updatedAt ?? receipt.requestedAt ?? null,
    completedAt: receipt.completedAt ?? null,
    targetId: boundedText(receipt.targetId, 200),
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
  const existing = replayExecutionAction(autoRun, { kind, idempotencyKey: key, request });
  if (existing) {
    return { receipt: existing, replayed: true, workItem: boundWorkItem(state, autoRun) };
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
  const ledger = key ? ensureIdempotencyLedger(autoRun) : null;
  if (key && ledger.length >= EXECUTION_ACTION_IDEMPOTENCY_LEDGER_LIMIT) {
    throw actionError(
      "execution_action_idempotency_capacity",
      "The long-term action ledger is full. No new action was started; keep the existing ledger and archive this run before retrying.",
      409,
    );
  }
  (autoRun.executionActionReceipts ??= []).unshift(receipt);
  autoRun.executionActionReceipts = autoRun.executionActionReceipts.slice(0, EXECUTION_ACTION_RECEIPT_LIMIT);
  if (key) {
    const entry = ledgerEntryForReceipt(receipt);
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
  autoRun,
  findInvocation = () => null,
  findTargetInvocation = () => null,
  now = new Date().toISOString(),
  force = false,
} = {}) {
  if (!receipt || !autoRun) return { changed: false, receipt };
  if (TERMINAL_RECEIPT_STATUSES.has(receipt.status)) {
    syncExecutionActionIdempotencyLedger(autoRun, receipt);
    return { changed: false, receipt };
  }

  let changed = false;
  const finish = () => {
    syncExecutionActionIdempotencyLedger(autoRun, receipt);
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
    set("status", "succeeded");
    set("messageCode", receipt.messageCode === "request_accepted"
      ? (["retry_execution", "fix_with_ai"].includes(receipt.kind)
          ? (receipt.kind === "fix_with_ai" ? "ai_fix_started" : "retry_started")
          : receipt.kind === "rerun_verification" ? "verification_completed" : "answer_recorded")
      : receipt.messageCode);
    set("nextOwner", ["retry_execution", "fix_with_ai"].includes(receipt.kind) ? "ai" : "system");
    set("updatedAt", now);
    set("completedAt", now);
    return finish();
  }

  if (force || isStalePending(receipt, now) || receipt.status === "unknown") {
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
