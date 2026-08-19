import { createHash } from "node:crypto";
import { analyzeChannelOperationIntent, normalizeChannelOperationIntent } from "./channel-operation-intent.mjs";

const FILE_HINT_RE = /(?:\.csv\b|\.xlsx?\b|excel|表格|工作簿|sheet|数据表|清单)/i;
const MUTATION_RE = /(?:修改|更新|改(?:一下|为|成)|替换|回填|写入|写回|批量|删除|清空|新增|追加|覆盖|调整|纠正|同步回)/i;
const OPERATION_RE = [
  [/(?:删除|清空|移除)/i, "delete"],
  [/(?:新增|追加)/i, "insert"],
  [/(?:覆盖|替换|改成|修改|更新|回填|写入|写回|调整|纠正)/i, "update"],
];
const MULTI_ROW_RE = /(?:批量|多条|全部|所有匹配)/i;

function clean(value, max = 300) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, max) : null;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceSnapshot(source) {
  return {
    sourceId: clean(source?.id, 200),
    fileName: clean(source?.fileName ?? source?.name, 300),
    revision: Number.isInteger(Number(source?.revision)) ? Number(source.revision) : null,
    contentHash: clean(source?.contentHash ?? source?.hash ?? source?.fingerprint, 200),
    rowCount: Number.isInteger(Number(source?.rowCount)) ? Number(source.rowCount) : null,
    requirementIds: Array.isArray(source?.requirementIds)
      ? source.requirementIds.slice(0, 10).map((value) => clean(value, 80)).filter(Boolean)
      : [],
  };
}

function operationFor(text) {
  return OPERATION_RE.find(([pattern]) => pattern.test(text))?.[1] ?? "update";
}

const SAFE_FIELD_RE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,119}$/;
const SENSITIVE_FIELD_RE = /(?:password|secret|token|credential|raw_?content|prompt)/i;
const SELECTOR_OPERATORS = new Set(["equals", "in", "predicate", "all"]);
const CHANGE_OPERATIONS = new Set(["set", "clear", "derive"]);

function safeField(value) {
  const field = clean(value, 120);
  return field && SAFE_FIELD_RE.test(field) && !SENSITIVE_FIELD_RE.test(field) ? field : null;
}

function normalizedPolicy(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const operations = Array.isArray(input.operations)
    ? [...new Set(input.operations.map((value) => clean(value, 30)?.toLowerCase()))]
    : ["update"];
  const keyFields = Array.isArray(input.keyFields) ? input.keyFields.map(safeField) : [];
  const mutableFields = Array.isArray(input.mutableFields) ? input.mutableFields.map(safeField) : [];
  if (operations.some((value) => !["update", "insert", "delete"].includes(value))
    || keyFields.some((value) => !value)
    || mutableFields.some((value) => !value)) return null;
  return {
    operations: [...new Set(operations)],
    targetRequirementIds: Array.isArray(input.targetRequirementIds)
      ? input.targetRequirementIds.slice(0, 20).map((value) => clean(value, 80)).filter(Boolean)
      : [],
    keyFields: [...new Set(keyFields)].slice(0, 10),
    mutableFields: [...new Set(mutableFields)].slice(0, 50),
    allowMultipleSources: input.allowMultipleSources === true,
    allowMultipleRows: input.allowMultipleRows === true,
    maxRows: Number.isInteger(Number(input.maxRows)) ? Math.max(1, Math.min(100_000, Number(input.maxRows))) : 100,
    requireUserConfirmation: input.requireUserConfirmation !== false,
    writeMode: "safe_copy_replace",
  };
}

function normalizeScopeTarget(input, sourceMap, policy) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "目标文件范围无效" };
  const sourceId = clean(input.sourceId ?? input.id, 200);
  const source = sourceMap.get(sourceId);
  const revision = Number.isInteger(Number(input.revision)) ? Number(input.revision) : null;
  const contentHash = clean(input.contentHash ?? input.hash ?? input.fingerprint, 200);
  if (!sourceId || !source || revision == null || source.revision !== revision
    || (contentHash && source.contentHash && contentHash !== source.contentHash)
    || (policy?.targetRequirementIds?.length
      && !source.requirementIds?.some((requirementId) => policy.targetRequirementIds.includes(requirementId)))) {
    return { ok: false, error: "目标文件版本已变化或不在当前数据范围内" };
  }
  const selectorInput = input.selector;
  if (!selectorInput || typeof selectorInput !== "object" || Array.isArray(selectorInput)) {
    return { ok: false, error: "缺少记录定位方式" };
  }
  const field = safeField(selectorInput.field);
  const operator = clean(selectorInput.operator ?? "equals", 30)?.toLowerCase();
  const criteriaDigest = clean(selectorInput.criteriaDigest ?? selectorInput.digest, 128);
  const matchCount = Number.isInteger(Number(selectorInput.matchCount)) ? Number(selectorInput.matchCount) : null;
  const allMatching = selectorInput.allMatching === true || operator === "all";
  if (!operator || !SELECTOR_OPERATORS.has(operator) || !criteriaDigest || matchCount == null || matchCount < 0 || matchCount > 100_000
    || (!allMatching && !field) || (policy?.keyFields?.length && field && !policy.keyFields.includes(field))) {
    return { ok: false, error: "记录定位方式不符合模板边界" };
  }
  const expectedRows = Number.isInteger(Number(input.expectedRows)) ? Number(input.expectedRows) : matchCount;
  if (expectedRows < 0 || expectedRows > 100_000 || expectedRows !== matchCount) {
    return { ok: false, error: "预计影响条数与记录匹配结果不一致" };
  }
  return {
    ok: true,
    value: {
      sourceId,
      revision,
      contentHash: source.contentHash ?? contentHash ?? null,
      selector: { field, operator, criteriaDigest, matchCount, allMatching },
      expectedRows,
    },
  };
}

function validateDataMutationScope(input, { policy = null, sourceSnapshots = [], operation = "update" } = {}) {
  if (input == null) return { ok: true, value: null, errors: [] };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, value: null, errors: ["变更范围结构无效"] };
  const policyValue = normalizedPolicy(input.policy ?? policy);
  const sourceMap = new Map((sourceSnapshots ?? []).filter((source) => source?.sourceId).map((source) => [source.sourceId, source]));
  const rawTargets = Array.isArray(input.targets) ? input.targets.slice(0, 20) : [];
  const errors = [];
  if (!policyValue || !policyValue.operations.includes(operation)) errors.push("模板未允许当前变更操作");
  if (!rawTargets.length) errors.push("至少需要绑定一个目标文件和记录范围");
  if (rawTargets.length > 1 && !policyValue?.allowMultipleSources) errors.push("模板不允许多个文件同时变更");
  const targets = rawTargets.map((target) => normalizeScopeTarget(target, sourceMap, policyValue));
  for (const target of targets) if (!target.ok) errors.push(target.error);
  const changes = Array.isArray(input.changes) ? input.changes.slice(0, 50) : [];
  if (!changes.length) errors.push("至少需要绑定一个字段变更");
  const normalizedChanges = changes.map((change) => {
    const field = safeField(change?.field);
    const changeOperation = clean(change?.operation ?? "set", 30)?.toLowerCase();
    const valueDigest = clean(change?.valueDigest ?? change?.digest, 128);
    const valueProvided = change?.valueProvided === true || Boolean(valueDigest);
    if (!field || !CHANGE_OPERATIONS.has(changeOperation)
      || (policyValue?.mutableFields?.length && !policyValue.mutableFields.includes(field))
      || (changeOperation !== "clear" && !valueProvided)) {
      errors.push(`字段变更不符合模板边界：${field ?? "未命名字段"}`);
      return null;
    }
    return { field, operation: changeOperation, valueDigest: valueDigest ?? null, valueProvided };
  }).filter(Boolean);
  const expectedAffectedRows = Number.isInteger(Number(input.expectedAffectedRows))
    ? Number(input.expectedAffectedRows)
    : targets.reduce((sum, target) => sum + (target.ok ? target.value.expectedRows : 0), 0);
  const allowAllMatching = input.allowAllMatching === true || targets.some((target) => target.ok && target.value.selector.allMatching);
  if (expectedAffectedRows < 0 || expectedAffectedRows > 100_000
    || expectedAffectedRows !== targets.reduce((sum, target) => sum + (target.ok ? target.value.expectedRows : 0), 0)) {
    errors.push("预计影响条数与各文件范围不一致");
  }
  if (policyValue && expectedAffectedRows > policyValue.maxRows) errors.push("预计影响条数超过模板上限");
  if (allowAllMatching && !policyValue?.allowMultipleRows) errors.push("模板不允许修改全部匹配记录");
  const value = {
    schemaVersion: 1,
    operation,
    targets: targets.filter((target) => target.ok).map((target) => target.value),
    changes: normalizedChanges,
    expectedAffectedRows: Math.max(0, Math.min(100_000, expectedAffectedRows)),
    allowAllMatching,
  };
  return { ok: errors.length === 0, value: errors.length === 0 ? value : null, errors: [...new Set(errors)].slice(0, 10) };
}

export function normalizeDataMutationScope(input, options = {}) {
  return validateDataMutationScope(input, options).value;
}

export function detectsDataMutationIntent(text, operationIntent = null) {
  const value = String(text ?? "");
  const intent = normalizeChannelOperationIntent(operationIntent) ?? analyzeChannelOperationIntent(value);
  if (intent.accessMode === "read_only") return false;
  if (intent.mutatesExistingData && FILE_HINT_RE.test(value)) return true;
  return FILE_HINT_RE.test(value) && MUTATION_RE.test(value);
}

export function buildDataMutationPreview({ state, projectId, ownerTeamId, text, operationIntent = null, dataPlan = null, dataMutationScope = null } = {}) {
  const value = clean(text, 4_000) ?? "";
  const normalizedOperationIntent = normalizeChannelOperationIntent(operationIntent)
    ?? analyzeChannelOperationIntent(value);
  if (normalizedOperationIntent.accessMode === "read_only") return null;
  const filePlanDetected = (dataPlan?.sources ?? []).some((source) => source.kind === "file");
  if (!detectsDataMutationIntent(value, normalizedOperationIntent)
    && !(filePlanDetected && normalizedOperationIntent.mutatesExistingData)) return null;
  const sources = (state?.channelObjectFileSources ?? [])
    .filter((source) => source.ownerTeamId === ownerTeamId
      && source.projectId === projectId
      && source.status !== "disabled")
    .map(sourceSnapshot)
    .filter((source) => source.sourceId);
  const plannedSourceIds = new Set((dataPlan?.sources ?? []).map((source) => source.sourceId).filter(Boolean));
  const plannedSources = plannedSourceIds.size
    ? sources.filter((source) => plannedSourceIds.has(source.sourceId))
    : [];
  const sourceCandidates = plannedSources.length ? plannedSources : sources;
  const requirementIdsBySource = new Map();
  for (const requirement of dataPlan?.requirements ?? []) {
    if (requirement.sourceId) {
      requirementIdsBySource.set(requirement.sourceId, [
        ...(requirementIdsBySource.get(requirement.sourceId) ?? []),
        requirement.id,
      ]);
    }
  }
  for (const source of sourceCandidates) source.requirementIds = requirementIdsBySource.get(source.sourceId) ?? source.requirementIds ?? [];
  const mentionedSources = sourceCandidates.filter((source) => source.fileName
    && value.toLocaleLowerCase().includes(source.fileName.toLocaleLowerCase()));
  const targetSources = mentionedSources.length ? mentionedSources : sourceCandidates;
  const mutationPolicy = dataPlan?.mutationPolicy ?? null;
  const scopeValidation = validateDataMutationScope(dataMutationScope, {
    policy: mutationPolicy,
    sourceSnapshots: sourceCandidates,
    operation: operationFor(value),
  });
  const requiredFields = [];
  if (!sourceCandidates.length) requiredFields.push("需要上传或选择 CSV/Excel 文件");
  if (!mentionedSources.length && sourceCandidates.length > 1) requiredFields.push("需要明确修改哪几个文件");
  requiredFields.push("需要说明如何定位记录（唯一编号或筛选条件）");
  requiredFields.push("需要说明修改哪些字段及新值");
  requiredFields.push("需要确认是否允许批量修改全部匹配记录");
  if (!mutationPolicy) requiredFields.push("任务模板尚未声明允许修改的文件、定位字段和可修改字段");
  if (dataMutationScope != null && !scopeValidation.ok) requiredFields.push(...scopeValidation.errors);
  const policyBlocked = mutationPolicy && (
    !mutationPolicy.operations.includes(operationFor(value))
    || (targetSources.length > 1 && !mutationPolicy.allowMultipleSources)
    || (MULTI_ROW_RE.test(value) && !mutationPolicy.allowMultipleRows)
  );
  if (policyBlocked) requiredFields.push("当前任务模板不允许这类多文件或多记录变更，请调整模板边界");
  const status = !sourceCandidates.length
    ? "needs_sources"
    : policyBlocked || (dataMutationScope != null && !scopeValidation.ok) ? "policy_blocked"
      : scopeValidation.value ? "ready" : "needs_review";
  const boundScope = scopeValidation.value;
  const result = {
    schemaVersion: 1,
    status,
    operation: operationFor(value),
    targetSourceIds: targetSources.map((source) => source.sourceId).slice(0, 20),
    targetSources: targetSources.slice(0, 20),
    sourceSnapshot: sourceCandidates.slice(0, 50),
    templatePolicy: mutationPolicy,
    targetStatus: mentionedSources.length === 1 ? "explicit" : sources.length === 1 ? "single_candidate" : "ambiguous",
    dataMutationScope: boundScope,
    rowSelector: boundScope?.targets.map((target) => ({
      sourceId: target.sourceId,
      revision: target.revision,
      field: target.selector.field,
      operator: target.selector.operator,
      criteriaDigest: target.selector.criteriaDigest,
      matchCount: target.selector.matchCount,
      allMatching: target.selector.allMatching,
    })) ?? null,
    fieldChanges: boundScope?.changes ?? [],
    estimatedAffectedRows: boundScope?.expectedAffectedRows ?? null,
    maxAffectedRows: mutationPolicy?.maxRows ?? null,
    requiredFields: status === "ready" ? [] : [...new Set(requiredFields)].slice(0, 10),
    writeMode: "not_authorized",
  };
  return { ...result, digest: digest(result) };
}

export function dataMutationPreviewMatchesCurrent({ state, preview, projectId, ownerTeamId } = {}) {
  if (!preview || preview.status === "not_required") return { ok: true, current: preview ?? null };
  const currentSources = (state?.channelObjectFileSources ?? [])
    .filter((source) => source.ownerTeamId === ownerTeamId
      && source.projectId === projectId
      && source.status !== "disabled")
    .map(sourceSnapshot)
    .map((source) => {
      const original = (preview.sourceSnapshot ?? []).find((candidate) => candidate.sourceId === source.sourceId);
      return original?.requirementIds?.length ? { ...source, requirementIds: original.requirementIds } : source;
    })
    .filter((source) => (preview.sourceSnapshot ?? []).some((original) => original.sourceId === source.sourceId));
  const current = {
    ...preview,
    sourceSnapshot: currentSources,
    targetSources: currentSources.filter((source) => (preview.targetSourceIds ?? []).includes(source.sourceId)),
  };
  const comparable = {
    ...current,
    digest: undefined,
  };
  const original = { ...preview, digest: undefined };
  const currentDigest = digest(comparable);
  const originalDigest = digest(original);
  return {
    ok: currentDigest === originalDigest,
    current: { ...current, digest: currentDigest },
  };
}

export function normalizeDataMutationPreview(input) {
  if (input == null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const requestedStatus = ["needs_sources", "needs_review", "policy_blocked", "ready", "stale", "not_required"].includes(input.status)
    ? input.status : "needs_review";
  const source = (value) => ({
    sourceId: clean(value?.sourceId ?? value?.id, 200),
    fileName: clean(value?.fileName ?? value?.name, 300),
    revision: Number.isInteger(Number(value?.revision)) ? Number(value.revision) : null,
    contentHash: clean(value?.contentHash ?? value?.hash ?? value?.fingerprint, 200),
    rowCount: Number.isInteger(Number(value?.rowCount)) ? Number(value.rowCount) : null,
    requirementIds: Array.isArray(value?.requirementIds)
      ? value.requirementIds.slice(0, 10).map((item) => clean(item, 80)).filter(Boolean)
      : [],
  });
  const sourceSnapshot = Array.isArray(input.sourceSnapshot) ? input.sourceSnapshot.slice(0, 50).map(source).filter((item) => item.sourceId) : [];
  const templatePolicy = input.templatePolicy && typeof input.templatePolicy === "object"
    ? normalizedPolicy(input.templatePolicy)
    : null;
  const scopeValidation = validateDataMutationScope(input.dataMutationScope, {
    policy: templatePolicy,
    sourceSnapshots: sourceSnapshot,
    operation: ["update", "insert", "delete"].includes(input.operation) ? input.operation : "update",
  });
  const dataMutationScope = scopeValidation.value;
  const status = requestedStatus === "ready" && !dataMutationScope ? "policy_blocked" : requestedStatus;
  return {
    schemaVersion: 1,
    status,
    operation: ["update", "insert", "delete"].includes(input.operation) ? input.operation : "update",
    targetSourceIds: Array.isArray(input.targetSourceIds) ? input.targetSourceIds.slice(0, 20).map((id) => clean(id, 200)).filter(Boolean) : [],
    targetSources: Array.isArray(input.targetSources) ? input.targetSources.slice(0, 20).map(source).filter((item) => item.sourceId) : [],
    sourceSnapshot,
    templatePolicy,
    targetStatus: ["explicit", "single_candidate", "ambiguous"].includes(input.targetStatus) ? input.targetStatus : "ambiguous",
    dataMutationScope,
    rowSelector: dataMutationScope?.targets.map((target) => ({
      sourceId: target.sourceId,
      revision: target.revision,
      field: target.selector.field,
      operator: target.selector.operator,
      criteriaDigest: target.selector.criteriaDigest,
      matchCount: target.selector.matchCount,
      allMatching: target.selector.allMatching,
    })) ?? null,
    fieldChanges: dataMutationScope?.changes ?? [],
    estimatedAffectedRows: dataMutationScope?.expectedAffectedRows ?? null,
    maxAffectedRows: templatePolicy?.maxRows ?? null,
    requiredFields: Array.isArray(input.requiredFields) ? input.requiredFields.slice(0, 10).map((item) => clean(item, 200)).filter(Boolean) : [],
    writeMode: ["ledger_single_record", "ledger_batch"].includes(input.executionMode)
      && input.writeMode === "safe_copy_replace"
      && status === "ready"
      && Boolean(dataMutationScope)
      ? "safe_copy_replace"
      : "not_authorized",
    digest: clean(input.digest, 128),
  };
}
