import { createHash } from "node:crypto";

const WORK_MODE_STATES = new Set(["matched", "needs_confirmation", "generic"]);
const DATA_STATES = new Set(["missing", "ready", "ambiguous"]);

function clean(value, max = 400) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, max) : null;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const DATA_LABELS = {
  contact: "联系人资料",
  order: "订单资料",
  quotation: "报价资料",
  shipment: "发货资料",
  after_sales: "售后资料",
  return: "退货资料",
  account: "账户资料",
  receivable: "应收资料",
  bank_transaction: "流水资料",
  publish_target: "发布平台资料",
  file: "文件资料",
};

export function workModeDataLabel(requirement) {
  return clean(requirement?.label, 160)
    ?? DATA_LABELS[String(requirement?.kind ?? "").toLowerCase()]
    ?? "业务资料";
}

/**
 * A user-facing, immutable description of how this task was understood.
 * It deliberately contains labels, versions and digests only; raw rows,
 * credentials and prompt content never enter the snapshot.
 */
export function buildWorkModeSnapshot({
  goal = "",
  outputExpectation = null,
  selectedTemplate = null,
  templateMatch = null,
  selectedDefinition = null,
  dataPlan = null,
  dataRelationPreview = null,
  dataMutationPreview = null,
  riskLevel = "low",
  executionPreview = null,
  generatedAt = null,
} = {}) {
  const candidates = Array.isArray(templateMatch?.candidates)
    ? templateMatch.candidates.slice(0, 3).map((candidate) => ({
      name: clean(candidate?.name, 160),
      expectedOutput: clean(candidate?.expectedOutput, 200),
      definitionId: clean(candidate?.definitionId, 200),
      version: Number.isInteger(Number(candidate?.version)) ? Number(candidate.version) : null,
    })).filter((candidate) => candidate.name || candidate.expectedOutput)
    : [];
  const hasTemplate = Boolean(selectedTemplate?.definitionId);
  const state = hasTemplate
    ? "matched"
    : templateMatch?.state === "ambiguous" || templateMatch?.decision?.kind === "confirm_output"
      ? "needs_confirmation"
      : "generic";
  const name = clean(selectedTemplate?.name, 160)
    ?? (state === "needs_confirmation" ? "待确认的工作方式" : "临时工作方式");
  const requirements = (dataPlan?.requirements ?? []).slice(0, 20).map((requirement) => ({
    id: clean(requirement?.id, 80),
    label: workModeDataLabel(requirement),
    kind: clean(requirement?.kind, 60),
    required: requirement?.required !== false,
    multiple: requirement?.multiple === true,
    state: DATA_STATES.has(requirement?.state) ? requirement.state : "missing",
    sourceId: clean(requirement?.sourceId, 200),
    fields: Array.isArray(requirement?.fields)
      ? requirement.fields.slice(0, 20).map((field) => clean(field, 120)).filter(Boolean)
      : [],
  }));
  const sources = (dataPlan?.sources ?? []).slice(0, 50).map((source) => ({
    sourceId: clean(source?.sourceId, 200),
    fileName: clean(source?.fileName, 300),
    revision: Number.isInteger(Number(source?.revision)) ? Number(source.revision) : null,
    fingerprint: clean(source?.fingerprint ?? source?.contentHash, 200),
  })).filter((source) => source.sourceId || source.fileName);
  const relations = (dataPlan?.relations ?? []).slice(0, 20).map((relation) => ({
    id: clean(relation?.id, 80),
    fromRequirementId: clean(relation?.fromRequirementId, 80),
    fromField: clean(relation?.fromField, 120),
    toRequirementId: clean(relation?.toRequirementId, 80),
    toField: clean(relation?.toField, 120),
    state: clean(relation?.state, 40) ?? "waiting_for_sources",
  }));
  const mutation = dataMutationPreview && dataMutationPreview.status !== "not_required"
    ? {
      required: true,
      status: clean(dataMutationPreview.status, 40) ?? "needs_review",
      targetCount: Number.isInteger(Number(dataMutationPreview.estimatedAffectedRows))
        ? Math.max(0, Number(dataMutationPreview.estimatedAffectedRows)) : null,
      digest: clean(dataMutationPreview.digest, 128),
    }
    : { required: false, status: "not_required", targetCount: 0, digest: null };
  const confirmationRequired = ["external_communication", "financial", "destructive"].includes(riskLevel)
    || mutation.required
    || ["needs_sources", "ambiguous", "stale"].includes(dataPlan?.status)
    || dataRelationPreview?.status === "needs_review"
    || state === "needs_confirmation";
  const trace = {
    templateDefinitionId: clean(selectedTemplate?.definitionId, 200),
    templateFamilyId: clean(selectedTemplate?.templateId, 200),
    templateVersion: Number.isInteger(Number(selectedTemplate?.version)) ? Number(selectedTemplate.version) : null,
    templateMatchReason: clean(templateMatch?.decision?.reason ?? templateMatch?.decision?.kind, 120),
    dataPlanDigest: clean(dataPlan?.digest, 128),
    relationDigest: clean(dataRelationPreview?.digest, 128),
    executionDigest: clean(executionPreview?.digest, 128),
  };
  const snapshot = {
    schemaVersion: 1,
    state,
    source: hasTemplate ? "my_template" : state === "needs_confirmation" ? "suggested" : "generic",
    name,
    version: trace.templateVersion,
    confidence: clean(templateMatch?.decision?.confidence, 30) ?? (hasTemplate ? "medium" : "low"),
    goal: clean(goal, 4_000) ?? "",
    expectedOutput: clean(outputExpectation ?? selectedTemplate?.expectedOutput, 1_000),
    inputs: selectedDefinition?.templateContract?.inputSummary
      ? clean(selectedDefinition.templateContract.inputSummary, 500)
      : null,
    data: {
      status: clean(dataPlan?.status, 40) ?? "not_required",
      requirements,
      sources,
      relations,
      relationStatus: clean(dataRelationPreview?.status, 40) ?? "not_required",
    },
    mutation,
    confirmationRequired,
    candidates,
    trace,
    generatedAt: clean(generatedAt, 50),
  };
  snapshot.digest = digest({ ...snapshot, digest: undefined });
  return snapshot;
}

export function normalizeWorkModeSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const mode = buildWorkModeSnapshot({
    goal: input.goal,
    outputExpectation: input.expectedOutput,
    selectedTemplate: input.source === "my_template" ? {
      definitionId: input.trace?.templateDefinitionId,
      templateId: input.trace?.templateFamilyId,
      version: input.version,
      name: input.name,
      expectedOutput: input.expectedOutput,
    } : null,
    templateMatch: { state: input.state === "needs_confirmation" ? "ambiguous" : "matched", decision: { confidence: input.confidence } },
    dataPlan: {
      status: input.data?.status,
      requirements: input.data?.requirements,
      sources: input.data?.sources,
      relations: input.data?.relations,
    },
    dataRelationPreview: { status: input.data?.relationStatus },
    dataMutationPreview: input.mutation?.required ? { status: input.mutation.status, estimatedAffectedRows: input.mutation.targetCount, digest: input.mutation.digest } : null,
    riskLevel: input.confirmationRequired ? "destructive" : "low",
    executionPreview: { digest: input.trace?.executionDigest },
    generatedAt: input.generatedAt,
  });
  mode.state = WORK_MODE_STATES.has(input.state) ? input.state : mode.state;
  mode.source = ["my_template", "suggested", "generic"].includes(input.source) ? input.source : mode.source;
  mode.name = clean(input.name, 160) ?? mode.name;
  mode.version = Number.isInteger(Number(input.version)) ? Number(input.version) : mode.version;
  mode.confidence = clean(input.confidence, 30) ?? mode.confidence;
  mode.inputs = clean(input.inputs, 500) ?? mode.inputs;
  mode.confirmationRequired = input.confirmationRequired === true || mode.confirmationRequired;
  mode.candidates = Array.isArray(input.candidates)
    ? input.candidates.slice(0, 3).map((candidate) => ({
      name: clean(candidate?.name, 160),
      expectedOutput: clean(candidate?.expectedOutput, 200),
      definitionId: clean(candidate?.definitionId, 200),
      version: Number.isInteger(Number(candidate?.version)) ? Number(candidate.version) : null,
    })).filter((candidate) => candidate.name || candidate.expectedOutput)
    : mode.candidates;
  mode.trace = {
    ...mode.trace,
    templateDefinitionId: clean(input.trace?.templateDefinitionId, 200) ?? mode.trace.templateDefinitionId,
    templateFamilyId: clean(input.trace?.templateFamilyId, 200) ?? mode.trace.templateFamilyId,
    templateVersion: Number.isInteger(Number(input.trace?.templateVersion)) ? Number(input.trace.templateVersion) : mode.trace.templateVersion,
    templateMatchReason: clean(input.trace?.templateMatchReason, 120) ?? mode.trace.templateMatchReason,
    dataPlanDigest: clean(input.trace?.dataPlanDigest, 128) ?? mode.trace.dataPlanDigest,
    relationDigest: clean(input.trace?.relationDigest, 128) ?? mode.trace.relationDigest,
    executionDigest: clean(input.trace?.executionDigest, 128) ?? mode.trace.executionDigest,
  };
  if (input.mutation && typeof input.mutation === "object") {
    mode.mutation = {
      required: input.mutation.required === true,
      status: clean(input.mutation.status, 40) ?? mode.mutation.status,
      targetCount: Number.isInteger(Number(input.mutation.targetCount)) ? Math.max(0, Number(input.mutation.targetCount)) : mode.mutation.targetCount,
      digest: clean(input.mutation.digest, 128) ?? mode.mutation.digest,
    };
  }
  mode.digest = clean(input.digest, 128) ?? mode.digest;
  return mode;
}
