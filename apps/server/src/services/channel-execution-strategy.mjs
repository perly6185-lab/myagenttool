/*
 * Internal execution boundary for natural-language channel tasks.
 *
 * The user describes a goal every time, but the executor must not invent a
 * new write procedure every time.  This small, serializable contract records
 * which governed path may handle the task:
 *
 *   reusable_operation  - a registered business/file operation owns it
 *   governed_bridge     - Bridge may plan within the existing capability gate
 *   blocked              - no safe path is available yet
 *
 * This is intentionally not exposed as a technical choice in iLink replies.
 * It is evidence for the desktop trace and a guard before auto-routing.
 */

import { createHash } from "node:crypto";
import { analyzeChannelOperationIntent, normalizeChannelOperationIntent } from "./channel-operation-intent.mjs";

const FILE_MUTATION_PATTERN = /(?:\.csv\b|\.xlsx?\b|表格|台账|文件).*(?:改|修改|更新|删除|新增|写入|变更)|(?:改|修改|更新|删除|新增|写入|变更).*(?:\.csv\b|\.xlsx?\b|表格|台账|文件)/i;

function text(value, max = 300) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function channelRequestLooksLikeFileMutation(value, operationIntent = null) {
  const intent = normalizeChannelOperationIntent(operationIntent) ?? analyzeChannelOperationIntent(value);
  if (intent.accessMode === "read_only") return false;
  if (intent.mutatesExistingData) return true;
  return FILE_MUTATION_PATTERN.test(text(value, 4_000));
}

export function selectChannelExecutionStrategy({
  goal = "",
  selectedTemplate = null,
  selectedDefinition = null,
  dataPlan = null,
  dataMutationPreview = null,
  ledgerMutationPreview = null,
  paymentReconciliationPreview = null,
  operationIntent = null,
  riskLevel = "low",
  generatedAt = null,
} = {}) {
  const hasLedgerOperation = Boolean(ledgerMutationPreview)
    || Boolean(dataMutationPreview && dataMutationPreview.status !== "not_required");
  const hasReusableDataOperation = Boolean(selectedDefinition)
    && (hasLedgerOperation || Boolean(paymentReconciliationPreview) || Boolean(dataPlan?.requirements?.length));
  const normalizedOperationIntent = normalizeChannelOperationIntent(operationIntent)
    ?? analyzeChannelOperationIntent(goal);
  const fileMutationWithoutOperation = channelRequestLooksLikeFileMutation(goal, normalizedOperationIntent)
    && !ledgerMutationPreview;

  let strategy = "governed_bridge";
  let operation = "bridge_capability_plan";
  let boundary = "governed_bridge";
  let safeToAutoRoute = true;
  let reason = "通用任务交由已授权的 Bridge 能力规划和执行";

  if (hasReusableDataOperation) {
    strategy = "reusable_operation";
    operation = ledgerMutationPreview?.kind === "batch"
      ? "ledger_batch_mutation"
      : ledgerMutationPreview
        ? "ledger_record_mutation"
        : paymentReconciliationPreview
          ? "payment_reconciliation"
          : "registered_data_operation";
    boundary = "local_connector";
    reason = "复用已登记的数据操作、文件身份校验和业务校验";
  } else if (fileMutationWithoutOperation) {
    strategy = "blocked";
    operation = "safe_file_operation_required";
    boundary = "none";
    safeToAutoRoute = false;
    reason = "文件修改尚未匹配到可复用的安全操作，不能临时发明写回脚本";
  } else if (selectedTemplate) {
    reason = "复用已确认的工作方式，并由 Bridge 在能力边界内执行";
  }

  const contract = {
    schemaVersion: 1,
    strategy,
    operation,
    boundary,
    safeToAutoRoute,
    dynamicScript: strategy === "reusable_operation" ? "forbidden" : "capability_bound",
    source: selectedTemplate ? "matched_work_mode" : "natural_language_fallback",
    reason,
    requiresConfirmation: strategy === "blocked"
      || hasLedgerOperation
      || ["external_communication", "financial", "destructive"].includes(riskLevel),
    dataPlanStatus: text(dataPlan?.status, 40) || "not_required",
    accessMode: normalizedOperationIntent.accessMode,
    operationIntent: normalizedOperationIntent,
    generatedAt: text(generatedAt, 50) || new Date().toISOString(),
  };
  contract.digest = digest({ ...contract, digest: undefined });
  return contract;
}

export function normalizeChannelExecutionStrategy(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const strategy = ["reusable_operation", "governed_bridge", "blocked"].includes(input.strategy)
    ? input.strategy : "blocked";
  const operation = text(input.operation, 80) || "unknown";
  const boundary = ["local_connector", "governed_bridge", "none"].includes(input.boundary)
    ? input.boundary : "none";
  const normalized = {
    schemaVersion: 1,
    strategy,
    operation,
    boundary,
    safeToAutoRoute: strategy !== "blocked" && input.safeToAutoRoute === true,
    dynamicScript: input.dynamicScript === "forbidden" ? "forbidden" : "capability_bound",
    source: ["matched_work_mode", "natural_language_fallback"].includes(input.source)
      ? input.source : "natural_language_fallback",
    reason: text(input.reason, 500) || "尚未找到安全执行路径",
    requiresConfirmation: input.requiresConfirmation === true,
    dataPlanStatus: text(input.dataPlanStatus, 40) || "not_required",
    accessMode: ["read_only", "write", "unknown"].includes(input.accessMode)
      ? input.accessMode
      : normalizeChannelOperationIntent(input.operationIntent)?.accessMode ?? "unknown",
    operationIntent: normalizeChannelOperationIntent(input.operationIntent),
    generatedAt: text(input.generatedAt, 50) || null,
    digest: text(input.digest, 128) || null,
  };
  return normalized;
}
