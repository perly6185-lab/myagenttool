import { createHash } from "node:crypto";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_OUTPUT_REFS = 100;
const MAX_RETRIES = 3;

export function createApplicationExecutionContract({
  resolution,
  workItem,
  principalId,
  approvalId = null,
  input = {},
  inputAssets = [],
  outputContract = null,
} = {}) {
  if (!resolution?.capability?.name || !["ready", "waiting_approval"].includes(resolution.state)) throw contractError("resolution_not_executable");
  if (!workItem?.id || !workItem.terminalId || resolution.terminalId !== workItem.terminalId) throw contractError("execution_terminal_mismatch");
  if (!principalId || !workItem.projectId) throw contractError("execution_scope_required");
  if (resolution.approval?.required && !approvalId) throw contractError("execution_approval_required");
  const normalizedInput = boundedJson(input, MAX_INPUT_BYTES, "execution_input_too_large");
  const assets = normalizeAssetRefs(inputAssets, workItem);
  const contract = {
    version: 1,
    taskId: workItem.id,
    queueEntryId: workItem.queueEntryId ?? workItem.id,
    traceId: workItem.traceId ?? workItem.id,
    terminalId: workItem.terminalId,
    projectId: workItem.projectId,
    worktreeId: workItem.worktreeId ?? null,
    principalId: String(principalId).slice(0, 200),
    effectiveAuthority: resolution.capability.riskLevel === "high" ? "elevated_governed" : "local_governed",
    applicationId: resolution.capability.applicationId,
    capabilityId: resolution.capability.name,
    approvalId: approvalId ? String(approvalId).slice(0, 200) : null,
    input: normalizedInput,
    inputAssets: assets,
    outputContract: normalizeOutputContract(outputContract),
    retry: { attempt: 0, maxAttempts: MAX_RETRIES, terminalId: workItem.terminalId },
    readiness: resolution.readiness ?? null,
  };
  return Object.freeze({ ...contract, fingerprint: fingerprint(contract) });
}

export function nextLocalApplicationRetry(contract, { transient, errorCode } = {}) {
  if (!contract?.fingerprint || !contract.terminalId || !contract.applicationId) throw contractError("invalid_execution_contract");
  const attempt = Number(contract.retry?.attempt ?? 0);
  const maxAttempts = Math.min(MAX_RETRIES, Number(contract.retry?.maxAttempts ?? MAX_RETRIES));
  if (!transient || attempt >= maxAttempts) {
    return {
      state: "human_attention",
      reason: transient ? "application_retry_exhausted" : "permanent_application_failure",
      errorCode: safeCode(errorCode),
      terminalId: contract.terminalId,
      applicationId: contract.applicationId,
      attempt,
    };
  }
  return {
    state: "retry",
    reason: "transient_application_failure",
    errorCode: safeCode(errorCode),
    terminalId: contract.terminalId,
    applicationId: contract.applicationId,
    approvalId: contract.approvalId,
    attempt: attempt + 1,
    maxAttempts,
    delayMs: Math.min(30_000, 1_000 * (2 ** attempt)),
  };
}

export function normalizeApplicationResult({ contract, status, summary = "", outputRefs = [], advancedEvidence = null } = {}) {
  if (!contract?.fingerprint) throw contractError("invalid_execution_contract");
  const normalizedStatus = ["succeeded", "failed", "cancelled", "timed_out", "refused"].includes(status) ? status : "failed";
  return {
    status: normalizedStatus,
    summary: String(summary).replace(/(token|secret|password|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 5_000),
    outputRefs: (Array.isArray(outputRefs) ? outputRefs : []).slice(0, MAX_OUTPUT_REFS).map((ref) => ({
      assetId: String(ref?.assetId ?? "").slice(0, 200),
      hash: String(ref?.hash ?? "").slice(0, 200),
      version: String(ref?.version ?? "").slice(0, 200),
    })).filter((ref) => ref.assetId && ref.hash && ref.version),
    evidence: advancedEvidence == null ? null : boundedJson(advancedEvidence, 32 * 1024, "advanced_evidence_too_large"),
    taskId: contract.taskId,
    traceId: contract.traceId,
    terminalId: contract.terminalId,
    applicationId: contract.applicationId,
    capabilityId: contract.capabilityId,
    contractFingerprint: contract.fingerprint,
  };
}

function normalizeAssetRefs(inputAssets, workItem) {
  return (Array.isArray(inputAssets) ? inputAssets : []).slice(0, 100).map((asset) => {
    if (asset?.terminalId !== workItem.terminalId || asset?.projectId !== workItem.projectId) throw contractError("asset_execution_scope_mismatch");
    return {
      id: String(asset.id).slice(0, 200),
      path: String(asset.path).slice(0, 1_000),
      hash: String(asset.hash).slice(0, 200),
      version: String(asset.version).slice(0, 200),
    };
  });
}

function normalizeOutputContract(value) {
  if (!value) return { collection: "invocations", assetFamilies: [] };
  const collection = ["invocations", "applicationResults", "reviewFindings"].includes(value.collection)
    ? value.collection
    : "invocations";
  return { collection, assetFamilies: (Array.isArray(value.assetFamilies) ? value.assetFamilies : []).map(String).slice(0, 20) };
}

function boundedJson(value, maxBytes, code) {
  const serialized = JSON.stringify(value ?? {});
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) throw contractError(code);
  return JSON.parse(serialized);
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function safeCode(value) {
  return String(value ?? "application_failure").replace(/[^a-z0-9_.-]/gi, "_").slice(0, 100);
}

function contractError(code) {
  return Object.assign(new Error(code), { code });
}
