// Workflow Memory V1.4 business-routine contracts.
//
// These values are deliberately separate from LoopRoutine (`routine.ts`):
// LoopRoutine describes repository automation, while a Business Routine is an
// evidence-backed piece of a user's daily work that materializes local Issues.

export const businessRoutineSchemaVersion = 1;

export const businessDocumentTypes = [
  "inquiry",
  "quotation",
  "order",
  "inquiry_ledger",
  "quotation_ledger",
  "order_ledger",
  "price_list",
  "customer_reference",
  "other_reference",
  "unknown",
];

export const businessEntityTypes = [
  "customer",
  "product",
  "inquiry",
  "quotation",
  "order",
];

// A document type is intrinsic to the business document. Its role is contextual:
// a quotation is an output of an inquiry routine and may be the trigger/input of
// an order routine without changing its document type.
export const routineArtifactRoles = ["trigger", "input", "output", "reference"];

export const routineStepKinds = [
  "extract",
  "retrieve",
  "generate",
  "ledger_upsert",
  "human_approval",
  "condition",
  "create_issue",
];

export const routineDefinitionStates = [
  "candidate",
  "draft",
  "published",
  "disabled",
  "superseded",
];

export const businessCaseStates = ["proposed", "confirmed", "active", "completed", "archived"];
export const businessCaseCandidateStates = ["proposed", "confirmed", "rejected", "superseded"];
export const businessCaseRelationshipKinds = ["precedes", "uses_reference", "registers", "handoff"];
export const routineDiscoveryCandidateStates = ["candidate", "superseded"];
export const routineStepRequirements = ["mandatory", "conditional"];
export const ledgerDefinitionStates = ["draft", "active", "disabled"];
export const ledgerApprovalPolicies = ["always", "updates_only"];
export const ledgerMutationActions = ["insert", "update", "no_op"];
export const routineRunStates = [
  "planned",
  "running",
  "awaiting_approval",
  "awaiting_condition",
  "succeeded",
  "failed",
  "cancelled",
];
export const routineStepRunStates = [
  "pending",
  "running",
  "awaiting_approval",
  "awaiting_condition",
  "succeeded",
  "skipped",
  "failed",
  "cancelled",
];

export const businessDocumentConfirmationStates = ["proposed", "confirmed", "corrected"];
export const businessDocumentAnalysisStates = ["deterministic", "hybrid", "degraded"];
export const businessFieldKeys = [
  "customer",
  "product",
  "quantity",
  "unit_price",
  "currency",
  "tax_rate",
  "delivery_terms",
  "amount",
  "document_date",
  "inquiry_number",
  "quotation_number",
  "order_number",
];
export const businessFieldConfirmationStates = ["proposed", "confirmed", "corrected"];

const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/;
const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;
const SENSITIVE_CONTRACT_KEYS = /(?:content|prompt|secret|token|password|credential)/i;
const SHA256_RE = /^[a-f0-9]{64}$/;

function isAbsoluteLocalPath(value) {
  const normalized = value.replaceAll("\\", "/");
  return normalized.startsWith("/") || WINDOWS_ABSOLUTE_RE.test(value);
}

function boundedText(value, maxLength) {
  const text = String(value ?? "").trim();
  return text && text.length <= maxLength ? text : null;
}

function safeId(value) {
  const text = boundedText(value, 200);
  return text && SAFE_ID_RE.test(text) ? text : null;
}

function safeRelativeLocation(value) {
  if (value == null || value === "") return null;
  const text = boundedText(value, 300);
  if (!text || isAbsoluteLocalPath(text)) return null;
  const segments = text.replaceAll("\\", "/").split("/");
  if (segments.includes("..") || text.includes("\n") || text.includes("\r")) return null;
  return text;
}

function uniqueStrings(values, { limit = 50, maxLength = 300 } = {}) {
  if (!Array.isArray(values) || values.length > limit) return null;
  const result = [...new Set(values.map((value) => boundedText(value, maxLength)).filter(Boolean))];
  return result.length <= limit ? result : null;
}

function safeConfiguration(value, depth = 0) {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    return value.length <= 2_000 && !isAbsoluteLocalPath(value)
      ? value
      : undefined;
  }
  if (depth >= 5) return undefined;
  if (Array.isArray(value)) {
    if (value.length > 100) return undefined;
    const rows = value.map((item) => safeConfiguration(item, depth + 1));
    return rows.some((item) => item === undefined) ? undefined : rows;
  }
  if (typeof value !== "object") return undefined;
  const entries = Object.entries(value);
  if (entries.length > 100) return undefined;
  const output = {};
  for (const [key, item] of entries) {
    if (!safeId(key) || SENSITIVE_CONTRACT_KEYS.test(key)) return undefined;
    if (/path/i.test(key) && typeof item === "string" && isAbsoluteLocalPath(item)) {
      return undefined;
    }
    const normalized = safeConfiguration(item, depth + 1);
    if (normalized === undefined) return undefined;
    output[key] = normalized;
  }
  return output;
}

export function normalizeRoutineEvidenceRefs(values) {
  if (!Array.isArray(values) || values.length > 100) return null;
  const refs = [];
  for (const value of values) {
    if (!value || typeof value !== "object") return null;
    const artifactId = safeId(value.artifactId);
    const kind = safeId(value.kind ?? "artifact");
    const field = value.field == null ? null : safeId(value.field);
    const location = safeRelativeLocation(value.location);
    if (!artifactId || !kind || (value.field != null && !field)
      || (value.location != null && value.location !== "" && !location)) {
      return null;
    }
    refs.push({ artifactId, kind, field, location });
  }
  return refs;
}

export function normalizeBusinessFieldProposals(values) {
  if (!Array.isArray(values) || values.length > 100) return null;
  const proposals = [];
  const keys = new Set();
  for (const value of values) {
    if (!value || typeof value !== "object") return null;
    const key = businessFieldKeys.includes(value.key) ? value.key : null;
    const fieldValue = boundedText(value.value, 1_000);
    const normalizedValue = value.normalizedValue == null
      ? null
      : boundedText(value.normalizedValue, 1_000);
    const confidence = Number(value.confidence);
    const evidenceRefs = normalizeRoutineEvidenceRefs(value.evidenceRefs ?? []);
    const confirmationState = businessFieldConfirmationStates.includes(value.confirmationState)
      ? value.confirmationState
      : "proposed";
    if (!key || keys.has(key) || !fieldValue
      || (value.normalizedValue != null && !normalizedValue)
      || !Number.isFinite(confidence) || confidence < 0 || confidence > 1
      || !evidenceRefs?.length) {
      return null;
    }
    keys.add(key);
    proposals.push({
      key,
      value: fieldValue,
      normalizedValue,
      confidence,
      evidenceRefs,
      confirmationState,
    });
  }
  return proposals;
}

export function normalizeBusinessDocumentClassification(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "invalid_business_document_classification" };
  const artifactId = safeId(input.artifactId);
  const documentType = businessDocumentTypes.includes(input.documentType) ? input.documentType : null;
  const confidence = Number(input.confidence);
  const reasons = uniqueStrings(input.reasons ?? [], { limit: 20, maxLength: 300 });
  const evidenceRefs = normalizeRoutineEvidenceRefs(input.evidenceRefs ?? []);
  const confirmationState = businessDocumentConfirmationStates.includes(input.confirmationState)
    ? input.confirmationState
    : "proposed";
  const fieldProposals = normalizeBusinessFieldProposals(input.fieldProposals ?? []);
  const riskSignals = uniqueStrings(input.riskSignals ?? [], { limit: 20, maxLength: 100 });
  const analysisState = businessDocumentAnalysisStates.includes(input.analysisState)
    ? input.analysisState
    : "deterministic";
  const artifactFingerprint = boundedText(input.artifactFingerprint, 64);
  const analysisKey = input.analysisKey == null
    ? artifactFingerprint
    : boundedText(input.analysisKey, 64);
  const degradedReason = input.degradedReason == null
    ? null
    : safeId(input.degradedReason);
  const provider = input.provider == null ? null : boundedText(input.provider, 100);
  const model = input.model == null ? null : boundedText(input.model, 200);
  if (!artifactId || !documentType || !Number.isFinite(confidence) || confidence < 0 || confidence > 1
    || !reasons || !evidenceRefs || !fieldProposals || !riskSignals
    || !artifactFingerprint || !SHA256_RE.test(artifactFingerprint)
    || !analysisKey || !SHA256_RE.test(analysisKey)
    || (input.degradedReason != null && !degradedReason)
    || (input.provider != null && !provider) || (input.model != null && !model)) {
    return { ok: false, error: "invalid_business_document_classification" };
  }
  return {
    ok: true,
    value: {
      schemaVersion: businessRoutineSchemaVersion,
      artifactId,
      documentType,
      confidence,
      reasons,
      evidenceRefs,
      fieldProposals,
      riskSignals,
      confirmationState,
      classifierVersion: Math.max(1, Number.parseInt(input.classifierVersion ?? 1, 10) || 1),
      extractorVersion: Math.max(1, Number.parseInt(input.extractorVersion ?? 1, 10) || 1),
      analysisState,
      artifactFingerprint,
      analysisKey,
      degradedReason,
      provider,
      model,
    },
  };
}

export function normalizeRoutineSteps(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
    return { ok: false, error: "invalid_routine_steps" };
  }
  const steps = [];
  const keys = new Set();
  for (const value of values) {
    if (!value || typeof value !== "object") return { ok: false, error: "invalid_routine_step" };
    const key = safeId(value.key);
    const kind = routineStepKinds.includes(value.kind) ? value.kind : null;
    const label = boundedText(value.label, 200);
    const dependsOn = uniqueStrings(value.dependsOn ?? [], { limit: 50, maxLength: 200 });
    const evidenceRefs = normalizeRoutineEvidenceRefs(value.evidenceRefs ?? []);
    const configuration = safeConfiguration(value.configuration ?? {});
    if (!key || keys.has(key) || !kind || !label || !dependsOn || !evidenceRefs || configuration === undefined) {
      return { ok: false, error: "invalid_routine_step" };
    }
    keys.add(key);
    steps.push({
      key,
      kind,
      label,
      required: value.required !== false,
      dependsOn,
      evidenceRefs,
      configuration,
    });
  }
  if (steps.some((step) => step.dependsOn.includes(step.key)
    || step.dependsOn.some((dependency) => !keys.has(dependency)))) {
    return { ok: false, error: "invalid_routine_step_dependency" };
  }
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const visiting = new Set();
  const visited = new Set();
  const cycle = (key) => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    if (byKey.get(key).dependsOn.some(cycle)) return true;
    visiting.delete(key);
    visited.add(key);
    return false;
  };
  if (steps.some((step) => cycle(step.key))) {
    return { ok: false, error: "routine_step_dependency_cycle" };
  }
  return { ok: true, value: steps };
}

export function normalizeLocalIssueRoutineBinding(input) {
  if (input == null) return { ok: true, value: null };
  if (!input || typeof input !== "object") return { ok: false, error: "invalid_work_item_routine_binding" };
  const routineDefinitionId = safeId(input.routineDefinitionId);
  const routineVersion = Number(input.routineVersion);
  const businessCaseId = safeId(input.businessCaseId);
  const businessKey = boundedText(input.businessKey, 200);
  const triggerArtifactIds = uniqueStrings(input.triggerArtifactIds ?? [], { limit: 100, maxLength: 200 });
  if (!routineDefinitionId || !Number.isInteger(routineVersion) || routineVersion < 1
    || !businessCaseId || !businessKey || !triggerArtifactIds || triggerArtifactIds.length === 0
    || triggerArtifactIds.some((id) => !safeId(id))) {
    return { ok: false, error: "invalid_work_item_routine_binding" };
  }
  return {
    ok: true,
    value: {
      schemaVersion: businessRoutineSchemaVersion,
      routineDefinitionId,
      routineVersion,
      businessCaseId,
      businessKey,
      triggerArtifactIds,
    },
  };
}
