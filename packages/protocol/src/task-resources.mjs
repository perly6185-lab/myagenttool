// Provider-neutral task resource, business ledger, and posting contracts.
// This layer only normalizes bounded domain data; connector credentials,
// provider object ids, and arbitrary query expressions do not belong here.

export const taskResourceSchemaVersion = 2;
export const taskTemplateSourceKinds = ["ledger_record", "ledger_record_set", "artifact", "local_content"];
export const taskTemplateMethodKinds = ["extract", "retrieve", "generate", "transform", "verify"];
export const taskTemplateFreshnessPolicies = ["current", "execution_snapshot", "either"];
export const taskTemplateInputPurposes = ["required", "reference"];
export const taskTemplateStates = ["draft", "published", "paused", "superseded"];
export const taskTemplateApprovalPolicies = ["none", "before_effect", "before_sensitive_write"];
export const taskRecordBindingDirections = ["input", "output"];
export const taskRecordBindingRoles = ["required", "reference", "primary_ledger", "related_ledger"];
export const taskRecordResolutionSources = ["explicit_user", "current_context", "intent_match", "template_default"];
export const taskRecordResolutionStates = ["resolved", "needs_confirmation", "stale", "unavailable"];
export const ledgerPostingPlanStates = ["proposed", "approved", "committed", "partially_committed", "invalidated", "cancelled"];
export const ledgerPostingActions = ["create", "update", "append_activity", "link_only"];

const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/;
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;
const SENSITIVE_KEY_RE = /(?:secret|token|password|credential|authorization|prompt)/i;

function text(value, maxLength) {
  const result = String(value ?? "").trim();
  return result && result.length <= maxLength ? result : null;
}

function id(value) {
  const result = text(value, 200);
  return result && SAFE_ID_RE.test(result) ? result : null;
}

function nullableText(value, maxLength) {
  return value == null ? null : text(value, maxLength);
}

function revision(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  return text(value, 200);
}

function uniqueTexts(values, { limit = 50, maxLength = 200, allowEmpty = true } = {}) {
  if (!Array.isArray(values) || values.length > limit) return null;
  const result = [...new Set(values.map((value) => text(value, maxLength)).filter(Boolean))];
  return allowEmpty || result.length > 0 ? result : null;
}

function enumValue(values, value) {
  return values.includes(value) ? value : null;
}

function timestamp(value) {
  const result = text(value, 80);
  return result && Number.isFinite(Date.parse(result)) ? new Date(result).toISOString() : null;
}

export function normalizeBusinessLedgerRecordRef(input) {
  if (!input || typeof input !== "object") return null;
  const ledgerDefinitionId = id(input.ledgerDefinitionId);
  const recordId = id(input.recordId);
  const recordType = id(input.recordType);
  const businessKey = nullableText(input.businessKey, 200);
  const title = text(input.title, 300);
  const recordRevision = revision(input.revision);
  const fingerprint = text(input.fingerprint, 71);
  const observedAt = timestamp(input.observedAt);
  if (!ledgerDefinitionId || !recordId || !recordType || !title
    || (input.businessKey != null && !businessKey)
    || (input.revision != null && recordRevision == null)
    || !fingerprint || !SHA256_RE.test(fingerprint) || !observedAt) return null;
  return { ledgerDefinitionId, recordId, recordType, businessKey, title, revision: recordRevision, fingerprint, observedAt };
}

function normalizeEvidenceRefs(values) {
  if (!Array.isArray(values) || values.length > 100) return null;
  const refs = [];
  for (const value of values) {
    if (!value || typeof value !== "object") return null;
    const artifactId = id(value.artifactId);
    const field = value.field == null ? null : id(value.field);
    if (!artifactId || (value.field != null && !field)) return null;
    refs.push({ artifactId, field });
  }
  return refs;
}

function normalizeSelection(value) {
  if (!value || typeof value !== "object") return null;
  const fieldKeys = uniqueTexts(value.fieldKeys ?? [], { limit: 100, maxLength: 200 });
  const queryId = nullableText(value.queryId, 200);
  const rowLimit = value.rowLimit == null ? null : Number(value.rowLimit);
  if (!fieldKeys || (value.queryId != null && !queryId)
    || (value.rowLimit != null && (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 1_000))) return null;
  return { fieldKeys, queryId, rowLimit };
}

function normalizeSnapshot(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object") return undefined;
  const snapshotRevision = revision(value.revision);
  const fingerprint = text(value.fingerprint, 71);
  const capturedAt = timestamp(value.capturedAt);
  const evidenceRefs = normalizeEvidenceRefs(value.evidenceRefs ?? []);
  if ((value.revision != null && snapshotRevision == null)
    || !fingerprint || !SHA256_RE.test(fingerprint) || !capturedAt || !evidenceRefs) return undefined;
  return { revision: snapshotRevision, fingerprint, capturedAt, evidenceRefs };
}

export function normalizeTaskRecordBinding(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "invalid_task_record_binding" };
  const bindingId = id(input.id);
  const slotKey = nullableText(input.slotKey, 200);
  const direction = enumValue(taskRecordBindingDirections, input.direction);
  const role = enumValue(taskRecordBindingRoles, input.role);
  const ledgerDefinitionId = id(input.ledgerDefinitionId);
  const record = input.record == null ? null : normalizeBusinessLedgerRecordRef(input.record);
  const selection = normalizeSelection(input.selection ?? {});
  const snapshot = normalizeSnapshot(input.snapshot);
  const resolution = input.resolution && typeof input.resolution === "object" ? input.resolution : null;
  const source = enumValue(taskRecordResolutionSources, resolution?.source);
  const confidence = Number(resolution?.confidence);
  const resolutionState = enumValue(taskRecordResolutionStates, resolution?.state);
  const reasons = uniqueTexts(resolution?.reasons ?? [], { limit: 20, maxLength: 300 });
  const directionRoleValid = (direction === "input" && ["required", "reference"].includes(role))
    || (direction === "output" && ["primary_ledger", "related_ledger"].includes(role));
  if (!bindingId || (input.slotKey != null && !slotKey) || !direction || !role || !directionRoleValid
    || !ledgerDefinitionId || (record && record.ledgerDefinitionId !== ledgerDefinitionId)
    || !selection || snapshot === undefined || !source || !Number.isFinite(confidence)
    || confidence < 0 || confidence > 1 || !resolutionState || !reasons) {
    return { ok: false, error: "invalid_task_record_binding" };
  }
  return {
    ok: true,
    value: {
      id: bindingId,
      slotKey,
      direction,
      role,
      record,
      ledgerDefinitionId,
      selection,
      snapshot,
      resolution: { source, confidence, state: resolutionState, reasons },
    },
  };
}

function normalizeOutcome(value) {
  if (!value || typeof value !== "object") return null;
  const label = text(value.label, 300);
  const artifactKinds = uniqueTexts(value.artifactKinds ?? [], { limit: 30, maxLength: 100, allowEmpty: false });
  const acceptanceCriteria = uniqueTexts(value.acceptanceCriteria ?? [], { limit: 50, maxLength: 500, allowEmpty: false });
  return label && artifactKinds && acceptanceCriteria ? { label, artifactKinds, acceptanceCriteria } : null;
}

function normalizeInputSlots(values) {
  if (!Array.isArray(values) || values.length > 50) return null;
  const slots = [];
  const keys = new Set();
  for (const value of values) {
    if (!value || typeof value !== "object") return null;
    const key = id(value.key);
    const label = text(value.label, 300);
    const sourceKinds = uniqueTexts(value.sourceKinds ?? [], { limit: taskTemplateSourceKinds.length, maxLength: 40, allowEmpty: false });
    const recordTypes = uniqueTexts(value.recordTypes ?? [], { limit: 50, maxLength: 100 });
    const artifactKinds = uniqueTexts(value.artifactKinds ?? [], { limit: 50, maxLength: 100 });
    const cardinality = ["one", "many"].includes(value.cardinality) ? value.cardinality : null;
    const freshness = enumValue(taskTemplateFreshnessPolicies, value.freshness);
    const purpose = enumValue(taskTemplateInputPurposes, value.purpose);
    if (!key || keys.has(key) || !label || !sourceKinds
      || sourceKinds.some((kind) => !taskTemplateSourceKinds.includes(kind))
      || !recordTypes || !artifactKinds || typeof value.required !== "boolean"
      || !cardinality || !freshness || !purpose) return null;
    keys.add(key);
    slots.push({ key, label, sourceKinds, recordTypes, artifactKinds, required: value.required, cardinality, freshness, purpose });
  }
  return slots;
}

function normalizeMethods(values) {
  if (!Array.isArray(values) || values.length > 50) return null;
  const methods = [];
  const keys = new Set();
  for (const value of values) {
    if (!value || typeof value !== "object") return null;
    const key = id(value.key);
    const kind = enumValue(taskTemplateMethodKinds, value.kind);
    const label = text(value.label, 300);
    if (!key || keys.has(key) || !kind || !label || typeof value.required !== "boolean") return null;
    keys.add(key);
    methods.push({ key, kind, label, required: value.required });
  }
  return methods;
}

function normalizeLedgerRouting(value) {
  if (!value || typeof value !== "object") return null;
  const primaryRecordType = nullableText(value.primaryRecordType, 100);
  const relatedRecordTypes = uniqueTexts(value.relatedRecordTypes ?? [], { limit: 50, maxLength: 100 });
  if ((value.primaryRecordType != null && !primaryRecordType) || !relatedRecordTypes
    || (primaryRecordType && relatedRecordTypes.includes(primaryRecordType))) return null;
  return { primaryRecordType, relatedRecordTypes };
}

export function normalizeTaskTemplateContractV2(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "invalid_task_template_contract_v2" };
  const templateId = id(input.id);
  const familyId = id(input.familyId);
  const version = Number(input.version);
  const taskKind = id(input.taskKind);
  const domain = id(input.domain);
  const name = text(input.name, 300);
  const outcome = normalizeOutcome(input.outcome);
  const inputSlots = normalizeInputSlots(input.inputSlots ?? []);
  const ledgerRouting = normalizeLedgerRouting(input.ledgerRouting);
  const method = normalizeMethods(input.method ?? []);
  const approvalPolicy = enumValue(taskTemplateApprovalPolicies, input.approvalPolicy);
  const state = enumValue(taskTemplateStates, input.state);
  if (input.schemaVersion != null && input.schemaVersion !== taskResourceSchemaVersion) {
    return { ok: false, error: "unsupported_task_template_schema_version" };
  }
  if (!templateId || !familyId || !Number.isInteger(version) || version < 1 || !taskKind || !domain || !name
    || !outcome || !inputSlots || !ledgerRouting || !method || typeof input.externalEffect !== "boolean"
    || !approvalPolicy || !state || (input.externalEffect && approvalPolicy === "none")) {
    return { ok: false, error: "invalid_task_template_contract_v2" };
  }
  return {
    ok: true,
    value: {
      schemaVersion: taskResourceSchemaVersion,
      id: templateId,
      familyId,
      version,
      taskKind,
      domain,
      name,
      outcome,
      inputSlots,
      ledgerRouting,
      method,
      externalEffect: input.externalEffect,
      approvalPolicy,
      state,
    },
  };
}

function safeJsonValue(value, depth = 0) {
  if (value == null || typeof value === "string" || typeof value === "boolean") {
    return typeof value === "string" && value.length > 2_000 ? undefined : value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (depth >= 3 || Array.isArray(value)) return undefined;
  return undefined;
}

function normalizeFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 100) return null;
  const fields = {};
  for (const [key, raw] of entries) {
    const field = id(key);
    const normalized = safeJsonValue(raw);
    if (!field || SENSITIVE_KEY_RE.test(field) || normalized === undefined) return null;
    fields[field] = normalized;
  }
  return fields;
}

function normalizePostingOperation(value) {
  if (!value || typeof value !== "object") return null;
  const ledgerDefinitionId = id(value.ledgerDefinitionId);
  const recordId = value.recordId == null ? null : id(value.recordId);
  const action = enumValue(ledgerPostingActions, value.action);
  const fields = normalizeFields(value.fields ?? {});
  const sourceEvidence = normalizeEvidenceRefs(value.sourceEvidence ?? []);
  if (!ledgerDefinitionId || !action || (value.recordId != null && !recordId) || !fields || !sourceEvidence?.length
    || typeof value.approvalRequired !== "boolean"
    || (action === "create" && recordId !== null)
    || (action !== "create" && recordId === null)) return null;
  return { ledgerDefinitionId, recordId, action, fields, sourceEvidence, approvalRequired: value.approvalRequired };
}

export function normalizeLedgerPostingPlan(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "invalid_ledger_posting_plan" };
  const workItemId = id(input.workItemId);
  const resultRevision = Number(input.resultRevision);
  const primary = input.primary == null ? null : normalizePostingOperation(input.primary);
  const relatedValues = Array.isArray(input.related) ? input.related : null;
  const related = relatedValues?.map(normalizePostingOperation) ?? null;
  const state = enumValue(ledgerPostingPlanStates, input.state);
  if (input.schemaVersion != null && input.schemaVersion !== taskResourceSchemaVersion) {
    return { ok: false, error: "unsupported_ledger_posting_plan_schema_version" };
  }
  if (!workItemId || !Number.isInteger(resultRevision) || resultRevision < 1
    || (input.primary != null && !primary) || !related || related.length > 50 || related.some((operation) => !operation) || !state) {
    return { ok: false, error: "invalid_ledger_posting_plan" };
  }
  return { ok: true, value: { schemaVersion: taskResourceSchemaVersion, workItemId, resultRevision, primary, related, state } };
}
