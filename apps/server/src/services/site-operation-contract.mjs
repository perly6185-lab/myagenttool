import { createHash } from "node:crypto";
import { normalizeSiteCapabilityManifest, siteCapabilityOperation } from "./site-capability-contract.mjs";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_EVIDENCE_REFS = 20;
const RESULT_STATUSES = new Set([
  "succeeded",
  "failed",
  "needs_user_action",
  "unconfirmed",
  "session_expired",
  "site_layout_changed",
]);
const SIDE_EFFECT_STATES = new Set(["not_started", "started", "confirmed", "unknown"]);

export function createSiteOperationContract({
  manifest,
  operationId,
  workItem,
  principalId,
  accountId,
  approvalId = null,
  input = {},
  inputAssets = [],
} = {}) {
  const plugin = normalizeSiteCapabilityManifest(manifest);
  const operation = siteCapabilityOperation(plugin, operationId);
  if (!operation) throw operationError("site_operation_not_supported");
  if (!workItem?.id || !workItem?.projectId || !workItem?.terminalId || !workItem?.ownerTeamId || !principalId || !accountId) {
    throw operationError("site_operation_scope_required");
  }
  if (operation.requiresApproval && !approvalId) throw operationError("site_operation_approval_required");
  const normalizedInput = boundedJson(input, MAX_INPUT_BYTES, "site_operation_input_too_large");
  const assets = normalizeAssetRefs(inputAssets, workItem);
  const body = {
    version: 1,
    pluginId: plugin.id,
    pluginVersion: plugin.version,
    executorId: plugin.executorId,
    operationId: operation.id,
    operationMode: operation.mode,
    riskLevel: operation.riskLevel,
    taskId: String(workItem.id),
    ownerTeamId: String(workItem.ownerTeamId).slice(0, 200),
    traceId: String(workItem.traceId ?? workItem.id),
    projectId: String(workItem.projectId),
    terminalId: String(workItem.terminalId),
    principalId: String(principalId).slice(0, 200),
    accountId: String(accountId).slice(0, 200),
    approvalId: approvalId ? String(approvalId).slice(0, 200) : null,
    input: normalizedInput,
    inputAssets: assets,
  };
  return Object.freeze({ ...body, fingerprint: fingerprint(body) });
}

export function normalizeSiteOperationResult({ contract, result } = {}) {
  if (!contract?.fingerprint) throw operationError("invalid_site_operation_contract");
  const status = RESULT_STATUSES.has(result?.status) ? result.status : "failed";
  let sideEffectState = SIDE_EFFECT_STATES.has(result?.sideEffectState)
    ? result.sideEffectState
    : contract.operationMode === "read" ? "not_started" : status === "succeeded" ? "confirmed" : "not_started";
  if (status === "unconfirmed") sideEffectState = "unknown";
  if (status === "succeeded" && contract.operationMode === "write") sideEffectState = "confirmed";
  return Object.freeze({
    status,
    sideEffectState,
    summary: redact(result?.summary).slice(0, 2_000),
    errorCode: safeCode(result?.errorCode),
    retryable: result?.retryable === true && sideEffectState === "not_started",
    userAction: normalizeUserAction(result?.userAction),
    remoteObject: normalizeRemoteObject(result?.remoteObject),
    receipt: boundedJson(result?.receipt ?? {}, 32 * 1024, "site_operation_receipt_too_large"),
    evidenceRefs: normalizeEvidenceRefs(result?.evidenceRefs),
    contractFingerprint: contract.fingerprint,
    pluginId: contract.pluginId,
    operationId: contract.operationId,
    taskId: contract.taskId,
    ownerTeamId: contract.ownerTeamId,
    accountId: contract.accountId,
    terminalId: contract.terminalId,
  });
}

export function nextSiteOperationAction(result) {
  if (!result?.contractFingerprint) throw operationError("invalid_site_operation_result");
  if (result.status === "succeeded") return { state: "completed", action: "none" };
  if (result.status === "unconfirmed" || result.sideEffectState === "unknown") {
    return { state: "human_attention", action: "reconcile", reason: "site_operation_outcome_unknown" };
  }
  if (result.status === "needs_user_action" || result.status === "session_expired") {
    return { state: "paused", action: "user_takeover", reason: result.status };
  }
  if (result.status === "site_layout_changed") {
    return { state: "human_attention", action: "inspect_plugin", reason: "site_layout_changed" };
  }
  if (result.retryable) return { state: "retry", action: "retry", reason: result.errorCode ?? "transient_site_failure" };
  return { state: "human_attention", action: "inspect_failure", reason: result.errorCode ?? "site_operation_failed" };
}

function normalizeAssetRefs(inputAssets, workItem) {
  return (Array.isArray(inputAssets) ? inputAssets : []).slice(0, 100).map((asset) => {
    if (!asset?.id || asset?.terminalId !== workItem.terminalId || asset?.projectId !== workItem.projectId) {
      throw operationError("site_operation_asset_scope_mismatch");
    }
    return {
      id: String(asset.id).slice(0, 200),
      path: String(asset.path ?? "").slice(0, 1_000),
      hash: String(asset.hash ?? "").slice(0, 200),
      version: String(asset.version ?? "").slice(0, 200),
      kind: String(asset.kind ?? asset.family ?? "unknown").slice(0, 100),
    };
  });
}

function normalizeRemoteObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = String(value.id ?? "").trim().slice(0, 500);
  const type = String(value.type ?? "").trim().slice(0, 100);
  if (!id || !type) return null;
  return { id, type, version: String(value.version ?? "").trim().slice(0, 300) || null };
}

function normalizeUserAction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = String(value.kind ?? "").trim().slice(0, 100);
  if (!kind) return null;
  return { kind, message: redact(value.message).slice(0, 500) };
}

function normalizeEvidenceRefs(value) {
  return (Array.isArray(value) ? value : []).slice(0, MAX_EVIDENCE_REFS).map((ref) => ({
    assetId: String(ref?.assetId ?? "").slice(0, 200),
    hash: String(ref?.hash ?? "").slice(0, 200),
  })).filter((ref) => ref.assetId && ref.hash);
}

function boundedJson(value, maxBytes, code) {
  const serialized = JSON.stringify(value ?? {});
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) throw operationError(code);
  return JSON.parse(serialized);
}

function redact(value) {
  return String(value ?? "").replace(/(token|secret|password|authorization|cookie)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

function safeCode(value) {
  const code = String(value ?? "").replace(/[^a-z0-9_.-]/gi, "_").slice(0, 100);
  return code || null;
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function operationError(code) {
  return Object.assign(new Error(code), { code });
}
