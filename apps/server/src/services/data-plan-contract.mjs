import { createHash } from "node:crypto";

const REQUIREMENT_KINDS = new Set([
  "contact", "order", "quotation", "shipment", "after_sales", "return", "account", "receivable", "bank_transaction", "publish_target", "file",
]);
const RELATION_TYPES = new Set(["lookup", "join"]);
const SAFE_FIELD_RE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,119}$/;
const SENSITIVE_FIELD_RE = /(?:password|secret|token|credential|raw_?content|prompt)/i;
const MUTATION_OPERATIONS = new Set(["update", "insert", "delete"]);
const MUTATION_WRITE_MODES = new Set(["safe_copy_replace"]);

function text(value, max = 200) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, max) : null;
}

function fieldList(values, { maxItems = 20 } = {}) {
  if (!Array.isArray(values) || values.length > maxItems) return null;
  const fields = [...new Set(values.map((value) => text(value, 120)).filter(Boolean))];
  return fields.every((field) => SAFE_FIELD_RE.test(field) && !SENSITIVE_FIELD_RE.test(field))
    ? fields
    : null;
}

function requirementId(value, fallback) {
  return text(value, 80)?.replace(/[^a-zA-Z0-9_.-]/g, "_") || fallback;
}

export function normalizeDataRequirements(input = []) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 20) return null;
  const result = [];
  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const kind = text(item.kind, 60)?.toLowerCase();
    const fields = fieldList(item.fields ?? item.requiredFields ?? []);
    const id = requirementId(item.id, `${kind || "data"}_${index + 1}`);
    const label = text(item.label ?? item.name, 160) || kind || id;
    if (!kind || !REQUIREMENT_KINDS.has(kind) || !fields || !id) return null;
    result.push({
      id,
      kind,
      label,
      fields,
      required: item.required !== false,
      multiple: item.multiple === true,
      description: text(item.description, 300),
    });
  }
  return result;
}

export function normalizeDataRelations(input = [], requirements = []) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 20) return null;
  const ids = new Set(requirements.map((item) => item.id));
  const result = [];
  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const fromRequirementId = text(item.fromRequirementId ?? item.leftRequirementId, 80);
    const toRequirementId = text(item.toRequirementId ?? item.rightRequirementId, 80);
    const fromField = text(item.fromField ?? item.leftField, 120);
    const toField = text(item.toField ?? item.rightField, 120);
    const type = text(item.type ?? "lookup", 30)?.toLowerCase();
    if (!fromRequirementId || !toRequirementId || !ids.has(fromRequirementId) || !ids.has(toRequirementId)
      || !fromField || !toField || !SAFE_FIELD_RE.test(fromField) || !SAFE_FIELD_RE.test(toField)
      || SENSITIVE_FIELD_RE.test(fromField) || SENSITIVE_FIELD_RE.test(toField)
      || !RELATION_TYPES.has(type)) return null;
    result.push({
      id: requirementId(item.id, `relation_${index + 1}`),
      type,
      fromRequirementId,
      fromField,
      toRequirementId,
      toField,
      required: item.required !== false,
      description: text(item.description, 300),
    });
  }
  return result;
}

export function normalizeMutationPolicy(input, requirements = []) {
  if (input == null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const operations = Array.isArray(input.operations)
    ? [...new Set(input.operations.map((value) => text(value, 30)?.toLowerCase()).filter(Boolean))]
    : ["update"];
  const targetRequirementIds = Array.isArray(input.targetRequirementIds)
    ? [...new Set(input.targetRequirementIds.map((value) => text(value, 80)).filter(Boolean))]
    : [];
  const keyFields = fieldList(input.keyFields ?? [], { maxItems: 10 });
  const mutableFields = fieldList(input.mutableFields ?? [], { maxItems: 50 });
  const maxRows = input.maxRows == null ? 100 : Number(input.maxRows);
  const writeMode = text(input.writeMode ?? "safe_copy_replace", 40);
  if (!operations.length || operations.some((operation) => !MUTATION_OPERATIONS.has(operation))
    || targetRequirementIds.some((id) => !requirements.some((requirement) => requirement.id === id))
    || !keyFields || !mutableFields
    || !Number.isInteger(maxRows) || maxRows < 1 || maxRows > 100_000
    || !MUTATION_WRITE_MODES.has(writeMode)) return null;
  return {
    operations,
    targetRequirementIds,
    keyFields,
    mutableFields,
    allowMultipleSources: input.allowMultipleSources === true,
    allowMultipleRows: input.allowMultipleRows === true,
    maxRows,
    requireUserConfirmation: input.requireUserConfirmation !== false,
    writeMode,
  };
}

export function normalizeDataContract({ dataRequirements = [], relations = [], mutationPolicy = null } = {}) {
  const requirements = normalizeDataRequirements(dataRequirements);
  if (!requirements) return null;
  const normalizedRelations = normalizeDataRelations(relations, requirements);
  if (!normalizedRelations) return null;
  const normalizedMutationPolicy = normalizeMutationPolicy(mutationPolicy, requirements);
  if (mutationPolicy != null && !normalizedMutationPolicy) return null;
  return { dataRequirements: requirements, relations: normalizedRelations, mutationPolicy: normalizedMutationPolicy };
}

function sourceFingerprint(source) {
  return source?.contentHash ?? source?.hash ?? source?.version ?? source?.fingerprint ?? null;
}

function sourceView(source) {
  return {
    sourceId: text(source?.id, 200),
    kind: text(source?.kind, 60),
    fileName: text(source?.fileName ?? source?.name, 300),
    revision: Number.isInteger(Number(source?.revision)) ? Number(source.revision) : null,
    fingerprint: text(sourceFingerprint(source), 200),
    rowCount: Number.isInteger(Number(source?.rowCount)) ? Number(source.rowCount) : null,
  };
}

function requirementCandidates(requirement, sources) {
  return sources.filter((source) => source.kind === requirement.kind && source.status !== "disabled");
}

export function buildRuntimeDataPlan({
  state,
  projectId,
  ownerTeamId,
  dataRequirements = [],
  relations = [],
  mutationPolicy = null,
} = {}) {
  const contract = normalizeDataContract({ dataRequirements, relations, mutationPolicy }) ?? { dataRequirements: [], relations: [], mutationPolicy: null };
  if (!contract.dataRequirements.length) {
    return { schemaVersion: 1, status: "not_required", requirements: [], relations: [], sources: [], mutationPolicy: contract.mutationPolicy, digest: digest({ status: "not_required", mutationPolicy: contract.mutationPolicy }) };
  }
  const sources = (state?.channelObjectFileSources ?? [])
    .filter((source) => source.ownerTeamId === ownerTeamId && source.projectId === projectId)
    .map((source) => ({ ...source, status: source.status ?? "active" }));
  const requirements = contract.dataRequirements.map((requirement) => {
    const candidates = requirementCandidates(requirement, sources).map(sourceView);
    const selected = candidates.length === 1 ? candidates[0] : null;
    return {
      ...requirement,
      state: candidates.length === 0 ? "missing" : candidates.length === 1 ? "ready" : "ambiguous",
      sourceId: selected?.sourceId ?? null,
      candidateSourceIds: candidates.map((source) => source.sourceId).filter(Boolean).slice(0, 10),
    };
  });
  const required = requirements.filter((requirement) => requirement.required);
  const status = required.some((requirement) => requirement.state === "missing")
    ? "needs_sources"
    : required.some((requirement) => requirement.state === "ambiguous")
      ? "ambiguous"
      : "ready";
  const selectedSources = [...new Map(
    requirements
      .filter((requirement) => requirement.sourceId)
      .map((requirement) => [requirement.sourceId, sources.find((source) => source.id === requirement.sourceId)])
      .filter(([, source]) => source)
      .map(([id, source]) => [id, sourceView(source)]),
  ).values()];
  const planRelations = contract.relations.map((relation) => {
    const from = requirements.find((requirement) => requirement.id === relation.fromRequirementId);
    const to = requirements.find((requirement) => requirement.id === relation.toRequirementId);
    const state = from?.state === "ready" && to?.state === "ready" ? "ready" : "waiting_for_sources";
    return { ...relation, state };
  });
  const plan = {
    schemaVersion: 1,
    status,
    requirements,
    relations: planRelations,
    mutationPolicy: contract.mutationPolicy,
    sources: selectedSources,
  };
  return { ...plan, digest: digest(plan) };
}

export function normalizeRuntimeDataPlan(input) {
  if (input == null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const status = ["not_required", "needs_sources", "ambiguous", "ready", "stale"].includes(input.status)
    ? input.status
    : "needs_sources";
  const requirements = Array.isArray(input.requirements)
    ? input.requirements.slice(0, 20).map((item, index) => ({
      id: requirementId(item?.id, `data_${index + 1}`),
      kind: text(item?.kind, 60) || "file",
      label: text(item?.label, 160) || "数据来源",
      fields: fieldList(item?.fields ?? []) ?? [],
      required: item?.required !== false,
      multiple: item?.multiple === true,
      description: text(item?.description, 300),
      state: ["missing", "ready", "ambiguous"].includes(item?.state) ? item.state : "missing",
      sourceId: text(item?.sourceId, 200),
      candidateSourceIds: Array.isArray(item?.candidateSourceIds)
        ? item.candidateSourceIds.slice(0, 10).map((value) => text(value, 200)).filter(Boolean)
        : [],
    }))
    : [];
  const relations = Array.isArray(input.relations)
    ? input.relations.slice(0, 20).map((item, index) => ({
      id: requirementId(item?.id, `relation_${index + 1}`),
      type: RELATION_TYPES.has(item?.type) ? item.type : "lookup",
      fromRequirementId: text(item?.fromRequirementId, 80),
      fromField: text(item?.fromField, 120),
      toRequirementId: text(item?.toRequirementId, 80),
      toField: text(item?.toField, 120),
      required: item?.required !== false,
      state: ["ready", "waiting_for_sources"].includes(item?.state) ? item.state : "waiting_for_sources",
      description: text(item?.description, 300),
    }))
    : [];
  const sources = Array.isArray(input.sources)
    ? input.sources.slice(0, 50).map(sourceView).filter((source) => source.sourceId)
    : [];
  return {
    schemaVersion: 1,
    status,
    requirements,
    relations,
    mutationPolicy: input.mutationPolicy && typeof input.mutationPolicy === "object"
      ? normalizeMutationPolicy(input.mutationPolicy, requirements)
      : null,
    sources,
    digest: text(input.digest, 128),
  };
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function dataPlanMatchesCurrent({ state, plan, projectId, ownerTeamId } = {}) {
  if (!plan || plan.status === "not_required") return { ok: true, current: plan };
  const current = buildRuntimeDataPlan({
    state,
    projectId,
    ownerTeamId,
    dataRequirements: plan.requirements,
    relations: plan.relations,
    mutationPolicy: plan.mutationPolicy ?? null,
  });
  return { ok: current.digest === plan.digest && current.status === plan.status, current };
}

export function dataPlanMissingLabels(plan) {
  return (plan?.requirements ?? [])
    .filter((requirement) => requirement.state !== "ready" && requirement.required)
    .map((requirement) => requirement.state === "ambiguous"
      ? `${requirement.label}（有多个来源）`
      : requirement.label)
    .slice(0, 10);
}
