import { createHash } from "node:crypto";

import {
  businessCaseStates,
  businessDocumentTypes,
  businessEntityTypes,
  businessRoutineSchemaVersion,
  ledgerDefinitionStates,
  normalizeBusinessDocumentClassification,
  normalizeLocalIssueRoutineBinding,
  normalizeRoutineEvidenceRefs,
  normalizeRoutineSteps,
  routineArtifactRoles,
} from "@myagenttool/protocol/business-routine";

import { actorCanAccessProject, LOCAL_TEAM_ID, LOCAL_USER_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { assetResourceClass, resolveAssetCapabilities } from "./asset-capabilities.mjs";
import {
  copyLocalLearnedTemplateOutput,
  inspectLocalQuotationTemplate,
  quotationDraftRelativePath,
  writeLocalQuotationDraft,
} from "./business-routine-executors.mjs";
import { normalizeDataContract } from "./data-plan-contract.mjs";
import { projectRoutineDefinitionToTaskTemplate } from "./task-template-runtime.mjs";

export const businessRoutineCollectionKeys = [
  "businessDocumentClassifications",
  "businessDocumentAnalysisJobs",
  "businessEntities",
  "businessCaseCandidates",
  "businessCases",
  "routineDiscoveryCandidates",
  "routineDefinitions",
  "routineRuns",
  "ledgerDefinitions",
  "ledgerUpsertPreviews",
  "ledgerMutationAudits",
];

const DEFINITION_TRANSITIONS = {
  candidate: { review: "draft" },
  draft: { publish: "published" },
  published: { disable: "disabled", supersede: "superseded" },
  disabled: { supersede: "superseded" },
  superseded: {},
};

const STEP_TRANSITIONS = {
  pending: { start: "running", skip: "skipped", cancel: "cancelled" },
  running: { await_approval: "awaiting_approval", succeed: "succeeded", fail: "failed", cancel: "cancelled" },
  awaiting_approval: { approve: "succeeded", reject: "failed", cancel: "cancelled" },
  failed: { retry: "pending", cancel: "cancelled" },
  succeeded: {},
  skipped: {},
  cancelled: {},
};
const READ_ONLY_STEP_KINDS = new Set(["extract", "retrieve"]);
const DEVICE_CAPACITY_STEP_KINDS = new Set(["extract", "retrieve", "generate", "create_issue"]);
const EXECUTABLE_STEP_KINDS = new Set(["retrieve", "generate", "create_issue"]);
const AUTO_ADVANCE_EXECUTABLE_STEP_KINDS = new Set(["extract", ...EXECUTABLE_STEP_KINDS]);
const AUTO_ADVANCE_STEP_LIMIT = 20;
const EXECUTOR_IDS = {
  extract: "local.confirmed-business-facts.v1",
  retrieve: "local.reference-retrieval.v1",
  generate: "local.markdown-quotation-draft.v1",
  create_issue: "local.confirmed-order-issue.v1",
};
const CONFIRMED_TEMPLATE_QUOTATION_EXECUTOR_ID = "local.confirmed-template-quotation.v2";
const LEARNED_TEMPLATE_OUTPUT_EXECUTOR_ID = "local.learned-template-output.v1";
const ALLOWED_EXECUTOR_IDS = {
  extract: new Set([EXECUTOR_IDS.extract]),
  retrieve: new Set([EXECUTOR_IDS.retrieve]),
  generate: new Set([
    EXECUTOR_IDS.generate,
    CONFIRMED_TEMPLATE_QUOTATION_EXECUTOR_ID,
    LEARNED_TEMPLATE_OUTPUT_EXECUTOR_ID,
  ]),
  create_issue: new Set([EXECUTOR_IDS.create_issue]),
};
const DEFAULT_QUOTATION_REQUIRED_FIELDS = [
  "customer",
  "product",
  "quantity",
  "unit_price",
  "currency",
  "tax_rate",
  "delivery_terms",
];
const QUOTATION_FIELD_LABELS = {
  customer: "Customer",
  product: "Product or service",
  quantity: "Quantity",
  unit_price: "Unit price",
  currency: "Currency",
  tax_rate: "Tax rate",
  delivery_terms: "Delivery date or terms",
  amount: "Total amount",
  inquiry_number: "Inquiry number",
};
const REFERENCE_DOCUMENT_TYPES = new Set([
  "price_list",
  "customer_reference",
  "other_reference",
]);

const ROUTINE_TYPE_LABELS = Object.freeze({
  inquiry: "inquiry",
  contract_review: "contract review",
  purchase_request: "purchase request",
  customer_complaint: "customer complaint",
  weekly_report: "weekly report",
  project_acceptance: "project acceptance",
});

const SAFE_FIELD_RE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,119}$/;
const SENSITIVE_FIELD_RE = /(?:password|secret|token|credential|raw_?content|prompt)/i;
const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

function text(value, max = 200) {
  const normalized = String(value ?? "").trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function stringList(values, { maxItems = 100, maxLength = 200 } = {}) {
  if (!Array.isArray(values) || values.length > maxItems) return null;
  const normalized = [...new Set(values.map((value) => text(value, maxLength)).filter(Boolean))];
  return normalized.length <= maxItems ? normalized : null;
}

function fieldTransitions(value) {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  const entries = Object.entries(value);
  if (entries.length > 20) return null;
  for (const [field, mapping] of entries) {
    if (!SAFE_FIELD_RE.test(field) || SENSITIVE_FIELD_RE.test(field)
      || !mapping || typeof mapping !== "object" || Array.isArray(mapping)) return null;
    const transitions = {};
    const values = Object.entries(mapping);
    if (values.length > 100) return null;
    for (const [from, targets] of values) {
      const source = text(from, 200);
      const allowed = stringList(targets, { maxItems: 50, maxLength: 200 });
      if (!source || !allowed) return null;
      transitions[source] = allowed;
    }
    result[field] = transitions;
  }
  return result;
}

export function normalizeRoutineTriggerType(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
  return businessDocumentTypes.includes(normalized) ? normalized : null;
}

function routineSelectionFailure(error, documentType, routineCount) {
  const ambiguous = error === "workflow_intake_routine_selection_required";
  return {
    status: 409,
    body: {
      error,
      documentType,
      routineCount,
      recovery: ambiguous
        ? "请只保留一个触发类型匹配的已发布工作流程，或调整流程的触发类型后再试。"
        : "请先发布一个触发类型与这项工作一致的工作流程，再重新运行。",
      assistance: {
        kind: ambiguous ? "routine_selection" : "workflow_setup",
        reason: error,
        action: ambiguous ? "resolve_routine_conflict" : "publish_matching_routine",
        title: ambiguous ? "找到多个可用工作流程" : "还没有可用的工作流程",
        explanation: ambiguous
          ? "AI 无法安全判断应该采用哪一套规矩，因此没有创建任务。"
          : "AI 没有找到触发类型与这项工作一致的已发布流程，因此没有自行猜测。",
        instruction: ambiguous
          ? "请检查这些流程的触发类型，只保留一个明确匹配的已发布版本。"
          : "请从历史工作中确认并发布对应流程，然后重新处理这项工作。",
        continuation: "流程唯一匹配后，AI 会自动创建 Local Issue，并按固定版本继续执行。",
      },
    },
  };
}

export function selectPublishedBusinessRoutine(definitions, documentType) {
  const normalizedType = normalizeRoutineTriggerType(documentType);
  if (!normalizedType) {
    return routineSelectionFailure("workflow_intake_routine_not_available", null, 0);
  }
  const matches = (Array.isArray(definitions) ? definitions : [])
    .filter((definition) => definition?.state === "published"
      && definition.evidenceHealth?.state !== "blocked"
      && Array.isArray(definition.triggerDocumentTypes)
      && definition.triggerDocumentTypes.some((trigger) =>
        normalizeRoutineTriggerType(trigger) === normalizedType))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  if (matches.length !== 1) {
    return routineSelectionFailure(
      matches.length ? "workflow_intake_routine_selection_required" : "workflow_intake_routine_not_available",
      normalizedType,
      matches.length,
    );
  }
  return {
    status: 200,
    body: { documentType: normalizedType, routineDefinition: matches[0], routineCount: 1 },
  };
}

function confidence(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
}

function routineStepConfigurationError(steps) {
  for (const step of steps) {
    const executableError = executableStepConfigurationError(step);
    if (executableError) return executableError;
  }
  const invalidCondition = steps.find((step) =>
    step.kind === "condition" && !text(step.configuration?.condition, 1_000));
  if (invalidCondition) return "routine_step_condition_required";
  const conditionalKeys = new Set(steps.filter((step) => step.kind === "condition").map((step) => step.key));
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of steps) {
      if (!conditionalKeys.has(step.key)
        && step.dependsOn.some((dependency) => conditionalKeys.has(dependency))) {
        conditionalKeys.add(step.key);
        changed = true;
      }
    }
  }
  return steps.some((step) =>
    step.kind !== "condition" && conditionalKeys.has(step.key) && step.required)
    ? "routine_conditional_descendant_must_be_optional"
    : null;
}

function relativePath(value) {
  const path = text(value, 1_000)?.replaceAll("\\", "/");
  if (!path || path.startsWith("/") || WINDOWS_ABSOLUTE_RE.test(path) || path.split("/").includes("..")) return null;
  return path;
}

function executorIdFor(step) {
  const configured = text(step?.configuration?.executorId, 200);
  return configured ?? EXECUTOR_IDS[step?.kind] ?? null;
}

function executableStepConfigurationError(step) {
  if (!EXECUTABLE_STEP_KINDS.has(step.kind)) return null;
  const executorId = executorIdFor(step);
  if (!ALLOWED_EXECUTOR_IDS[step.kind]?.has(executorId)) return "routine_step_executor_not_allowed";
  if (step.kind === "generate"
    && executorId !== LEARNED_TEMPLATE_OUTPUT_EXECUTOR_ID
    && !/(?:quotation|quote|报价)/i.test(`${step.key} ${step.label}`)) {
    return "routine_generate_executor_not_configured";
  }
  if (step.kind === "create_issue"
    && !/(?:order|订单)/i.test(`${step.key} ${step.label}`)) {
    return "routine_issue_executor_not_configured";
  }
  const outputDirectory = step.configuration?.outputDirectory;
  if (outputDirectory != null && !relativePath(outputDirectory)) {
    return "routine_output_directory_invalid";
  }
  const documentTypes = step.configuration?.documentTypes;
  if (documentTypes != null && (
    !Array.isArray(documentTypes)
    || documentTypes.length > 20
    || documentTypes.some((value) => !businessDocumentTypes.includes(value))
  )) {
    return "routine_retrieval_document_types_invalid";
  }
  if (executorId === CONFIRMED_TEMPLATE_QUOTATION_EXECUTOR_ID) {
    const requiredFields = step.configuration?.requiredFields;
    if (requiredFields != null && (
      !Array.isArray(requiredFields)
      || !requiredFields.length
      || requiredFields.length > 20
      || requiredFields.some((value) =>
        !text(value, 120) || !SAFE_FIELD_RE.test(value) || SENSITIVE_FIELD_RE.test(value))
    )) {
      return "routine_quotation_required_fields_invalid";
    }
    const templateArtifactIds = step.configuration?.templateArtifactIds;
    if (templateArtifactIds != null && (
      !Array.isArray(templateArtifactIds)
      || templateArtifactIds.length > 20
      || templateArtifactIds.some((value) => !text(value, 200))
    )) {
      return "routine_quotation_template_artifacts_invalid";
    }
  }
  if (executorId === LEARNED_TEMPLATE_OUTPUT_EXECUTOR_ID) {
    const contract = step.configuration?.templateContract;
    if (!contract || typeof contract !== "object"
      || !text(contract.outputFileName, 300)
      || !text(contract.outputFormat, 20)
      || !Array.isArray(contract.outputArtifactIds)
      || contract.outputArtifactIds.length < 1
      || contract.outputArtifactIds.length > 20
      || contract.outputArtifactIds.some((value) => !text(value, 200))) {
      return "routine_template_output_contract_invalid";
    }
  }
  return null;
}

function normalizeFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 100) return null;
  const fields = {};
  for (const [key, candidate] of entries) {
    if (!SAFE_FIELD_RE.test(key) || SENSITIVE_FIELD_RE.test(key)) return null;
    if (candidate == null || typeof candidate === "boolean") {
      fields[key] = candidate;
    } else if (typeof candidate === "number" && Number.isFinite(candidate)) {
      fields[key] = candidate;
    } else if (typeof candidate === "string" && candidate.length <= 1_000) {
      fields[key] = candidate;
    } else {
      return null;
    }
  }
  return fields;
}

function normalizeFieldMappings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 100) return null;
  const mappings = {};
  const targets = new Set();
  for (const [key, target] of entries) {
    const normalizedTarget = text(target, 200);
    if (!SAFE_FIELD_RE.test(key) || SENSITIVE_FIELD_RE.test(key) || !normalizedTarget
      || /[\0\r\n]/.test(normalizedTarget) || targets.has(normalizedTarget)) return null;
    mappings[key] = normalizedTarget;
    targets.add(normalizedTarget);
  }
  return mappings;
}

function hashKey(parts) {
  return createHash("sha256")
    .update(JSON.stringify(parts.map((part) => String(part ?? ""))))
    .digest("hex");
}

export function routineIdempotencyKeys({
  ownerTeamId,
  routineDefinitionId,
  routineVersion,
  businessKey,
  stepKey = null,
  outputPath = null,
  ledgerDefinitionId = null,
  sourceFingerprints = [],
} = {}) {
  const base = [
    businessRoutineSchemaVersion,
    ownerTeamId,
    routineDefinitionId,
    routineVersion,
    businessKey,
  ];
  if (sourceFingerprints.length) base.push([...new Set(sourceFingerprints)].sort());
  return {
    issue: `business-routine:issue:v1:${hashKey(base)}`,
    step: stepKey ? `business-routine:step:v1:${hashKey([...base, stepKey])}` : null,
    outputPublication: `business-routine:publish:v1:${hashKey([...base, outputPath ?? "*"])}`,
    ledgerUpsert: ledgerDefinitionId
      ? `business-routine:ledger:v1:${hashKey([...base, ledgerDefinitionId])}`
      : null,
  };
}

export function migrateBusinessRoutineState(state) {
  for (const key of businessRoutineCollectionKeys) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  const artifactById = new Map((state.workflowArtifacts ?? []).map((artifact) => [artifact.id, artifact]));
  for (const classification of state.businessDocumentClassifications) {
    const artifactFingerprint = classification.artifactFingerprint
      ?? artifactById.get(classification.artifactId)?.fingerprint
      ?? null;
    classification.fieldProposals ??= [];
    classification.riskSignals ??= [];
    classification.extractorVersion ??= 1;
    classification.analysisState ??= "deterministic";
    classification.degradedReason ??= null;
    classification.artifactFingerprint = artifactFingerprint;
    classification.analysisKey ??= artifactFingerprint;
  }
  for (const businessCase of state.businessCases) {
    businessCase.artifactFingerprints ??= Object.fromEntries(
      (businessCase.artifactBindings ?? []).map((binding) => [
        binding.artifactId,
        artifactById.get(binding.artifactId)?.fingerprint ?? "",
      ]),
    );
  }
  for (const definition of state.routineDefinitions) {
    definition.description ??= "";
    definition.discoveryCandidateId ??= null;
    if (!Array.isArray(definition.historicalCaseIds)) definition.historicalCaseIds = [];
    if (!definition.evidenceFingerprints
      || typeof definition.evidenceFingerprints !== "object"
      || Array.isArray(definition.evidenceFingerprints)) {
      definition.evidenceFingerprints = Object.fromEntries(
        [...new Set((definition.evidenceRefs ?? []).map((ref) => ref.artifactId))].map((artifactId) => [
          artifactId,
          artifactById.get(artifactId)?.fingerprint ?? "",
        ]),
      );
    }
  }
  for (const [runIndex, run] of state.routineRuns.entries()) {
    run.actionReceipts ??= [];
    run.recoveryReceipts ??= [];
    run.recoveryIntent ??= null;
    run.waitingReason ??= null;
    run.capacityQueue ??= run.waitingReason === "device_capacity"
      ? {
          state: "waiting",
          queuedAt: run.updatedAt ?? run.createdAt ?? null,
          sequence: runIndex + 1,
        }
      : null;
    run.cancellationRequestedAt ??= null;
    run.sourceFingerprints ??= (run.triggerArtifactIds ?? [])
      .map((artifactId) => {
        const businessCase = state.businessCases.find((row) => row.id === run.businessCaseId);
        return businessCase?.artifactFingerprints?.[artifactId]
          ?? artifactById.get(artifactId)?.fingerprint
          ?? null;
      })
      .filter(Boolean)
      .sort();
    for (const stepRun of run.stepRuns ??= []) {
      stepRun.attempts ??= stepRun.startedAt ? 1 : 0;
      stepRun.outputRefs ??= [];
      stepRun.approval ??= null;
      stepRun.conditionOutcome ??= null;
      stepRun.quotationInputs ??= null;
      stepRun.quotationReview ??= null;
      stepRun.ledgerDefinitionId ??= null;
      if (stepRun.state === "running") {
        stepRun.state = "failed";
        stepRun.errorCode = "routine_step_interrupted";
        stepRun.completedAt ??= run.updatedAt ?? run.createdAt ?? null;
        run.status = "failed";
        run.waitingReason = "routine_step_interrupted";
        run.capacityQueue = null;
      }
    }
  }
  for (const definition of state.ledgerDefinitions) {
    definition.documentType ??= definition.businessKeyField?.startsWith("quotation")
      ? "quotation_ledger"
      : definition.businessKeyField?.startsWith("order")
        ? "order_ledger"
        : "inquiry_ledger";
    definition.headerRow ??= 1;
    definition.table ??= null;
    definition.fallbackBusinessKeyFields ??= [];
    definition.requiredFields ??= [definition.businessKeyField].filter(Boolean);
    definition.formattingPolicy ??= {
      preserveStylesAndFormulas: true,
      csvDelimiter: ",",
    };
    definition.writePolicy ??= {
      approval: "always",
      allowInsert: true,
      allowUpdate: true,
    };
    definition.writePolicy.fieldTransitions ??= {};
  }
  return state;
}

export function createBusinessRoutineService({
  state,
  now = () => new Date().toISOString(),
  nextId = (prefix) => `${prefix}_${Date.now().toString(36)}`,
  appendEvent = () => {},
  persistStateSoon = () => {},
  createWorkItem = null,
  recordWorkItemVerification = null,
  releaseRoutineLedgerReservations = () => {},
  store,
} = {}) {
  migrateBusinessRoutineState(state);
  const runTx = makeRunTx({ store, persistStateSoon });
  const actorTeam = (actor) => actor?.teamId ?? LOCAL_TEAM_ID;
  const actorUser = (actor) => actor?.userId ?? LOCAL_USER_ID;
  const visible = (row, actor) => row?.ownerTeamId === actorTeam(actor);
  const projectFor = (projectId, actor) =>
    actorCanAccessProject(state, actor, projectId)
      ? state.projects?.find((project) => project.id === projectId) ?? null
      : null;
  const sourceFor = (sourceId, actor, { active = false } = {}) => {
    const source = state.workflowSources?.find((row) => row.id === sourceId && visible(row, actor)) ?? null;
    if (!source || (active && source.state !== "active")) return null;
    return source;
  };
  const artifactFor = (artifactId, actor) =>
    state.workflowArtifacts?.find((row) => row.id === artifactId && visible(row, actor)) ?? null;
  const evidenceBelongsTo = (evidenceRefs, context, actor) =>
    evidenceRefs.every((ref) => {
      const artifact = artifactFor(ref.artifactId, actor);
      return artifact?.projectId === context.projectId && artifact?.sourceId === context.sourceId;
    });

  function event(type, message, record, actor, extra = {}) {
    appendEvent({
      invocationId: null,
      type,
      level: type.includes("disabled") || type.includes("failed") ? "warning" : "info",
      message,
      data: {
        projectId: record.projectId,
        sourceId: record.sourceId,
        actorTeamId: actorTeam(actor),
        actorId: actorUser(actor),
        ...extra,
      },
    });
  }

  function activeContext(input, actor) {
    const projectId = text(input?.projectId);
    const sourceId = text(input?.sourceId);
    const project = projectId ? projectFor(projectId, actor) : null;
    const source = sourceId ? sourceFor(sourceId, actor, { active: true }) : null;
    if (!project || !source || source.projectId !== project.id) {
      return { error: "business_routine_context_not_found" };
    }
    return { project, source, projectId, sourceId };
  }

  const workItemFor = (workItemId, actor) =>
    state.workItems?.find((row) =>
      row.id === workItemId
      && row.ownerTeamId === actorTeam(actor)
      && actorCanAccessProject(state, actor, row.projectId)) ?? null;

  function currentClassification(artifact, actor, documentType = null) {
    return [...state.businessDocumentClassifications]
      .reverse()
      .find((row) =>
        row.artifactId === artifact.id
        && visible(row, actor)
        && row.projectId === artifact.projectId
        && row.sourceId === artifact.sourceId
        && (!documentType || normalizeRoutineTriggerType(row.documentType)
          === normalizeRoutineTriggerType(documentType))
        && ["confirmed", "corrected"].includes(row.confirmationState)
        && row.artifactFingerprint === artifact.fingerprint) ?? null;
  }

  function currentCaseFor(context, actor) {
    const businessCase = state.businessCases.find((row) =>
      row.id === context.run.businessCaseId
      && visible(row, actor)
      && row.projectId === context.run.projectId
      && row.sourceId === context.run.sourceId);
    if (!businessCase || !["confirmed", "active", "completed"].includes(businessCase.state)) {
      return null;
    }
    return businessCase;
  }

  function extractConfirmedRoutineFacts(context, actor) {
    const businessCase = currentCaseFor(context, actor);
    if (!businessCase) return { ok: false, error: "routine_business_case_not_current" };
    const triggerArtifacts = (context.run.triggerArtifactIds ?? [])
      .map((artifactId) => artifactFor(artifactId, actor));
    if (!triggerArtifacts.length || triggerArtifacts.some((artifact) =>
      !artifact
      || artifact.availability === "missing"
      || artifact.exclusion
      || businessCase.artifactFingerprints?.[artifact.id] !== artifact.fingerprint)) {
      return { ok: false, error: "routine_extract_evidence_not_current" };
    }
    const classifications = triggerArtifacts.map((artifact) => currentClassification(artifact, actor));
    if (classifications.some((classification) => !classification)) {
      return { ok: false, error: "routine_extract_confirmation_required" };
    }
    const entities = (businessCase.entityIds ?? []).map((entityId) =>
      state.businessEntities.find((row) =>
        row.id === entityId
        && visible(row, actor)
        && row.projectId === context.run.projectId
        && row.sourceId === context.run.sourceId))
      .filter(Boolean);
    if (!entities.length || !entities.some((entity) => Object.keys(entity.fields ?? {}).length > 0)) {
      return { ok: false, error: "routine_extract_confirmation_required" };
    }
    return {
      ok: true,
      outputRefs: triggerArtifacts.map((artifact) => ({
        kind: "artifact",
        artifactId: artifact.id,
        summary: `Confirmed business facts from ${artifact.relativePath ?? artifact.name ?? artifact.id}.`,
      })),
    };
  }
  function retrieveRoutineReferences(context, step, actor) {
    const businessCase = currentCaseFor(context, actor);
    if (!businessCase) {
      return { ok: false, error: "routine_business_case_not_current" };
    }
    const configuredTypes = step.configuration?.documentTypes;
    const acceptedTypes = new Set(
      Array.isArray(configuredTypes) && configuredTypes.length
        ? configuredTypes
        : REFERENCE_DOCUMENT_TYPES,
    );
    const candidates = [];
    for (const artifact of state.workflowArtifacts) {
      if (
        !visible(artifact, actor)
        || artifact.projectId !== context.run.projectId
        || artifact.sourceId !== context.run.sourceId
        || artifact.availability === "missing"
        || artifact.exclusion
      ) {
        continue;
      }
      const binding = businessCase.artifactBindings.find((row) => row.artifactId === artifact.id);
      const classification = currentClassification(artifact, actor);
      const documentType = binding?.documentType ?? classification?.documentType ?? null;
      if (!acceptedTypes.has(documentType)) continue;
      if (binding && businessCase.artifactFingerprints?.[artifact.id] !== artifact.fingerprint) {
        return { ok: false, error: "routine_reference_evidence_changed" };
      }
      if (!classification && !binding) continue;
      candidates.push({
        artifact,
        documentType,
        caseBound: Boolean(binding),
      });
    }
    candidates.sort((left, right) =>
      Number(right.caseBound) - Number(left.caseBound)
      || String(left.artifact.relativePath ?? left.artifact.id)
        .localeCompare(String(right.artifact.relativePath ?? right.artifact.id)));
    const selected = candidates.slice(0, 20);
    if (!selected.length) {
      return { ok: false, error: "routine_references_not_found" };
    }
    return {
      ok: true,
      outputRefs: selected.map(({ artifact, documentType }) => ({
        kind: "artifact",
        artifactId: artifact.id,
        summary: `${documentType}: ${artifact.relativePath ?? artifact.name ?? "reference"}`,
      })),
    };
  }

  function routineQuotationFields(context, actor) {
    const businessCase = currentCaseFor(context, actor);
    if (!businessCase) return null;
    const fields = {};
    for (const entityId of businessCase.entityIds ?? []) {
      const entity = state.businessEntities.find((row) =>
        row.id === entityId
        && visible(row, actor)
        && row.projectId === context.run.projectId
        && row.sourceId === context.run.sourceId);
      for (const [key, value] of Object.entries(entity?.fields ?? {})) {
        if (SAFE_FIELD_RE.test(key) && !SENSITIVE_FIELD_RE.test(key) && fields[key] == null) {
          fields[key] = value;
        }
      }
    }
    for (const binding of businessCase.artifactBindings ?? []) {
      const artifact = artifactFor(binding.artifactId, actor);
      if (!artifact
        || artifact.availability === "missing"
        || artifact.exclusion
        || businessCase.artifactFingerprints?.[artifact.id] !== artifact.fingerprint) {
        continue;
      }
      const classification = currentClassification(artifact, actor);
      for (const proposal of classification?.fieldProposals ?? []) {
        if (fields[proposal.key] == null) {
          fields[proposal.key] = proposal.normalizedValue ?? proposal.value;
        }
      }
    }
    fields.inquiry_number ??= context.run.businessKey;
    return { businessCase, fields };
  }

  function quotationRequiredFields(step) {
    const configured = stringList(step.configuration?.requiredFields, {
      maxItems: 20,
      maxLength: 120,
    });
    return configured?.length ? configured : DEFAULT_QUOTATION_REQUIRED_FIELDS;
  }

  function quotationExecutionSuffix(context, step) {
    return hashKey([
      context.run.id,
      context.run.routineDefinitionId,
      context.run.routineVersion,
      step.key,
    ]).slice(0, 8);
  }

  function normalizedFactValue(value) {
    return text(value, 1_000)?.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase() ?? null;
  }

  function quotationTemplateOptions(context, step, actor) {
    const source = sourceFor(context.run.sourceId, actor, { active: true });
    const project = projectFor(context.run.projectId, actor);
    if (!source || !project || !text(project.path, 4_000)) return [];
    const configuredIds = new Set(step.configuration?.templateArtifactIds ?? []);
    const explicitlyConfigured = configuredIds.size > 0;
    return state.workflowArtifacts
      .filter((artifact) => {
        if (!visible(artifact, actor)
          || artifact.projectId !== context.run.projectId
          || artifact.sourceId !== context.run.sourceId
          || artifact.availability === "missing"
          || artifact.exclusion) {
          return false;
        }
        if (explicitlyConfigured) return configuredIds.has(artifact.id);
        return /\.(?:md|docx|xlsx)$/i.test(artifact.relativePath ?? "")
          && /(?:template|模板|quotation|quote|报价)/i.test(artifact.relativePath ?? artifact.name ?? "");
      })
      .sort((left, right) =>
        String(left.relativePath ?? left.id).localeCompare(String(right.relativePath ?? right.id)))
      .slice(0, 20)
      .map((artifact) => {
        const inspection = inspectLocalQuotationTemplate({
          projectPath: project.path,
          sourceRelativePath: source.relativePath,
          templateRelativePath: artifact.relativePath,
          expectedFingerprint: artifact.fingerprint,
          sourceReadMode: source.readMode,
        });
        return {
          artifactId: artifact.id,
          label: artifact.relativePath ?? artifact.name ?? artifact.id,
          format: inspection.format ?? String(artifact.extension ?? "").toLowerCase(),
          supported: inspection.ok === true,
          reason: inspection.ok ? null : inspection.error,
          fingerprint: artifact.fingerprint,
          placeholderKeys: inspection.ok ? inspection.placeholderKeys : [],
        };
      });
  }

  function buildQuotationReview(context, step, stepRun, actor) {
    const businessCase = currentCaseFor(context, actor);
    const source = sourceFor(context.run.sourceId, actor, { active: true });
    if (!businessCase || !source) return null;
    const candidates = new Map();
    const addCandidate = (key, value, sourceSummary, evidenceArtifactIds = []) => {
      if (!SAFE_FIELD_RE.test(key) || SENSITIVE_FIELD_RE.test(key)) return;
      const normalized = normalizedFactValue(value);
      const visibleValue = text(value, 1_000);
      if (!normalized || !visibleValue) return;
      const rows = candidates.get(key) ?? [];
      rows.push({
        value: visibleValue,
        normalized,
        sourceSummary,
        evidenceArtifactIds: [...new Set(evidenceArtifactIds)].slice(0, 20),
      });
      candidates.set(key, rows);
    };
    for (const entityId of businessCase.entityIds ?? []) {
      const entity = state.businessEntities.find((row) =>
        row.id === entityId
        && visible(row, actor)
        && row.projectId === context.run.projectId
        && row.sourceId === context.run.sourceId);
      if (!entity) continue;
      for (const [key, value] of Object.entries(entity.fields ?? {})) {
        const matchingEvidenceArtifactIds = (entity.evidenceRefs ?? [])
          .filter((ref) => !ref.field || ref.field === key)
          .map((ref) => ref.artifactId);
        const evidenceArtifactIds = matchingEvidenceArtifactIds.length
          ? matchingEvidenceArtifactIds
          : (entity.evidenceRefs ?? []).map((ref) => ref.artifactId);
        addCandidate(key, value, "Confirmed business record", evidenceArtifactIds);
      }
    }
    for (const binding of businessCase.artifactBindings ?? []) {
      const artifact = artifactFor(binding.artifactId, actor);
      if (!artifact
        || artifact.availability === "missing"
        || artifact.exclusion
        || businessCase.artifactFingerprints?.[artifact.id] !== artifact.fingerprint) {
        continue;
      }
      const classification = currentClassification(artifact, actor);
      for (const proposal of classification?.fieldProposals ?? []) {
        addCandidate(
          proposal.key,
          proposal.normalizedValue ?? proposal.value,
          artifact.relativePath ?? artifact.name ?? "Confirmed document",
          [artifact.id],
        );
      }
    }
    addCandidate("inquiry_number", context.run.businessKey, "Routine business key");

    const answers = stepRun.quotationInputs?.answers ?? {};
    for (const [key, answer] of Object.entries(answers)) {
      if (answer?.value != null) {
        candidates.set(key, [{
          value: answer.value,
          normalized: normalizedFactValue(answer.value),
          sourceSummary: "Confirmed by user",
          evidenceArtifactIds: [],
        }]);
      }
    }

    const templateOptions = quotationTemplateOptions(context, step, actor);
    const selectedTemplate = templateOptions.find((option) =>
      option.artifactId === stepRun.quotationInputs?.templateArtifactId
      && option.fingerprint === stepRun.quotationInputs?.templateFingerprint
      && option.supported) ?? null;
    const requiredFactKeys = [...new Set([
      ...quotationRequiredFields(step),
      ...(selectedTemplate?.placeholderKeys ?? []),
    ])];
    const fields = requiredFactKeys.map((key) => {
      const rows = candidates.get(key) ?? [];
      const byValue = new Map();
      for (const row of rows) {
        if (!row.normalized) continue;
        const existing = byValue.get(row.normalized);
        if (existing) {
          existing.sourceSummaries.push(row.sourceSummary);
          existing.evidenceArtifactIds.push(...row.evidenceArtifactIds);
        } else {
          byValue.set(row.normalized, {
            value: row.value,
            sourceSummaries: [row.sourceSummary],
            evidenceArtifactIds: [...row.evidenceArtifactIds],
          });
        }
      }
      const values = [...byValue.values()];
      const state = values.length === 0 ? "missing" : values.length === 1 ? "confirmed" : "conflict";
      return {
        key,
        label: QUOTATION_FIELD_LABELS[key] ?? key.replaceAll("_", " "),
        state,
        value: state === "confirmed" ? values[0].value : null,
        conflictingValues: state === "conflict" ? values.map((row) => row.value).slice(0, 5) : [],
        sourceSummaries: [...new Set(values.flatMap((row) => row.sourceSummaries))].slice(0, 10),
        evidenceArtifactIds: [...new Set(values.flatMap((row) => row.evidenceArtifactIds))].slice(0, 20),
      };
    });
    const draftRevision = Math.max(1, Number(stepRun.quotationInputs?.draftRevision) || 1);
    const plannedOutputPath = quotationDraftRelativePath({
      sourceRelativePath: source.relativePath,
      outputDirectory: step.configuration?.outputDirectory,
      businessKey: context.run.businessKey,
      routineVersion: context.run.routineVersion,
      executionSuffix: quotationExecutionSuffix(context, step),
      draftRevision,
      format: selectedTemplate?.format ?? "markdown",
    });
    const ready = fields.every((field) => field.state === "confirmed") && Boolean(selectedTemplate);
    return {
      status: stepRun.outputRefs?.some((output) => output.kind === "file")
        ? "generated"
        : ready ? "ready" : "needs_input",
      fields,
      templateOptions: templateOptions.map(({ fingerprint: _fingerprint, ...option }) => option),
      selectedTemplate: selectedTemplate ? {
        artifactId: selectedTemplate.artifactId,
        label: selectedTemplate.label,
        format: selectedTemplate.format,
      } : null,
      plannedOutputPath,
      draftRevision,
      draftPreview: null,
    };
  }

  function generateQuotationDraft(context, step, actor) {
    const source = sourceFor(context.run.sourceId, actor, { active: true });
    const project = projectFor(context.run.projectId, actor);
    const collected = routineQuotationFields(context, actor);
    if (!source || !project || !collected) {
      return { ok: false, error: "routine_generate_context_not_found" };
    }
    if (!text(project.path, 4_000)) {
      return { ok: false, error: "routine_output_root_unavailable" };
    }
    const evidencePaths = collected.businessCase.artifactBindings
      .map((binding) => artifactFor(binding.artifactId, actor))
      .filter((artifact) =>
        artifact
        && artifact.availability !== "missing"
        && !artifact.exclusion
        && collected.businessCase.artifactFingerprints?.[artifact.id] === artifact.fingerprint)
      .map((artifact) => artifact.relativePath ?? artifact.name ?? "source document");
    const stepRun = context.run.stepRuns.find((row) => row.stepKey === step.key);
    const confirmedTemplateMode = executorIdFor(step) === CONFIRMED_TEMPLATE_QUOTATION_EXECUTOR_ID;
    const review = confirmedTemplateMode
      ? buildQuotationReview(context, step, stepRun, actor)
      : null;
    if (confirmedTemplateMode && (!review || review.status !== "ready")) {
      return {
        ok: false,
        needsInput: true,
        error: "routine_quotation_facts_required",
        quotationReview: review,
      };
    }
    const selectedTemplateArtifact = confirmedTemplateMode
      ? artifactFor(stepRun.quotationInputs.templateArtifactId, actor)
      : null;
    if (confirmedTemplateMode && (
      !selectedTemplateArtifact
      || selectedTemplateArtifact.projectId !== context.run.projectId
      || selectedTemplateArtifact.sourceId !== context.run.sourceId
      || selectedTemplateArtifact.availability === "missing"
      || selectedTemplateArtifact.exclusion
      || selectedTemplateArtifact.fingerprint !== stepRun.quotationInputs.templateFingerprint
    )) {
      return { ok: false, error: "routine_template_drifted" };
    }
    const fields = confirmedTemplateMode
      ? Object.fromEntries(review.fields.map((field) => [field.key, field.value]))
      : collected.fields;
    const written = writeLocalQuotationDraft({
      projectPath: project.path,
      sourceRelativePath: source.relativePath,
      outputDirectory: step.configuration?.outputDirectory,
      businessKey: context.run.businessKey,
      routineVersion: context.run.routineVersion,
      executionSuffix: quotationExecutionSuffix(context, step),
      draftRevision: confirmedTemplateMode ? review.draftRevision : null,
      fields,
      evidencePaths,
      templateRelativePath: selectedTemplateArtifact?.relativePath,
      templateFingerprint: selectedTemplateArtifact?.fingerprint,
      sourceReadMode: source.readMode,
    });
    return written.ok
      ? {
          ok: true,
          quotationReview: confirmedTemplateMode
            ? {
                ...review,
                status: "generated",
                plannedOutputPath: written.relativePath,
                draftPreview: written.preview,
              }
            : null,
          outputRefs: [
            {
              kind: "file",
              relativePath: written.relativePath,
              summary: `Quotation draft for ${context.run.businessKey}.`,
            },
            ...(confirmedTemplateMode ? [{
              kind: "note",
              summary: `Confirmed template: ${review.selectedTemplate.label}.`,
            }, ...review.fields.map((field) => ({
              kind: "note",
              summary: `${field.label}: ${field.value} · ${field.sourceSummaries.join(", ")}`,
            }))] : []),
          ],
        }
      : written;
  }

  function generateLearnedTemplateOutput(context, step, actor) {
    const source = sourceFor(context.run.sourceId, actor, { active: true });
    const project = projectFor(context.run.projectId, actor);
    const businessCase = currentCaseFor(context, actor);
    const contract = step.configuration?.templateContract;
    const templateArtifactId = contract?.outputArtifactIds?.[0];
    const templateArtifact = artifactFor(templateArtifactId, actor);
    if (!source || !project || !businessCase || !templateArtifact || !text(project.path, 4_000)) {
      return { ok: false, error: "routine_generate_context_not_found" };
    }
    if (templateArtifact.projectId !== context.run.projectId
      || templateArtifact.sourceId !== context.run.sourceId
      || templateArtifact.availability === "missing"
      || templateArtifact.exclusion
      || businessCase.artifactFingerprints?.[templateArtifact.id] !== templateArtifact.fingerprint) {
      return { ok: false, error: "routine_template_drifted" };
    }
    const written = copyLocalLearnedTemplateOutput({
      projectPath: project.path,
      sourceRelativePath: source.relativePath,
      templateRelativePath: templateArtifact.relativePath,
      outputDirectory: step.configuration?.outputDirectory,
      outputFileName: contract.outputFileName,
      businessKey: context.run.businessKey,
      executionSuffix: quotationExecutionSuffix(context, step),
    });
    return written.ok ? {
      ok: true,
      outputRefs: [{
        kind: "file",
        relativePath: written.relativePath,
        summary: `${contract.outputSummary ?? contract.outputFileName} created from the confirmed output sample.`,
      }, ...(contract.uncertainFields?.length ? [{
        kind: "note",
        summary: `Confirm fields without a learned source: ${contract.uncertainFields.join(", ")}.`,
      }] : [])],
    } : written;
  }

  function confirmedOrderArtifacts(context, actor) {
    const businessCase = currentCaseFor(context, actor);
    if (!businessCase) return [];
    return businessCase.artifactBindings
      .filter((binding) => binding.documentType === "order")
      .map((binding) => artifactFor(binding.artifactId, actor))
      .filter((artifact) =>
        artifact
        && artifact.availability !== "missing"
        && !artifact.exclusion
        && businessCase.artifactFingerprints?.[artifact.id] === artifact.fingerprint
        && currentClassification(artifact, actor, "order"));
  }

  function ensureOrderChildIssue(context, orderArtifacts, actor) {
    if (typeof createWorkItem !== "function") {
      return { ok: false, status: 503, error: "routine_issue_materializer_unavailable" };
    }
    if (!orderArtifacts.length) {
      return { ok: false, status: 409, error: "confirmed_order_trigger_required" };
    }
    const orderKey = `business-routine:order-issue:v1:${hashKey([
      actorTeam(actor),
      context.workItem.id,
      context.run.businessCaseId,
      ...orderArtifacts.map((artifact) => artifact.fingerprint).sort(),
    ])}`;
    const created = createWorkItem({
      projectId: context.run.projectId,
      title: `Order Processing — ${context.run.businessKey}`,
      body: `Follow-up from ${context.workItem.localRef}. Process the confirmed order for ${context.run.businessKey}.`,
      type: "task",
      status: "ready",
      priority: "p1",
      labels: ["routine-work", "order-processing"],
      acceptanceCriteria: ["Register the confirmed order"],
      parentId: context.workItem.id,
      idempotencyKey: orderKey,
      routineDefinitionId: context.run.routineDefinitionId,
      routineVersion: context.run.routineVersion,
      businessCaseId: context.run.businessCaseId,
      businessKey: context.run.businessKey,
      triggerArtifactIds: orderArtifacts.map((artifact) => artifact.id),
    }, actor, { allowPinnedRoutineChild: true });
    if (!created?.ok) {
      return {
        ok: false,
        status: created?.status ?? 500,
        error: created?.body?.error ?? "order_issue_create_failed",
      };
    }
    return { ok: true, workItem: created.body.workItem, replayed: Boolean(created.body.replayed) };
  }

  function publicRoutineWorkItem(workItem) {
    const { createIdempotencyKey: _createIdempotencyKey, ...publicWorkItem } = workItem;
    return publicWorkItem;
  }

  function normalizeRoutineOutputRefs(values) {
    if (!Array.isArray(values) || values.length > 50) return null;
    const rows = [];
    for (const value of values) {
      if (!value || typeof value !== "object") return null;
      const kind = ["artifact", "file", "note"].includes(value.kind) ? value.kind : null;
      const artifactId = value.artifactId == null ? null : text(value.artifactId);
      const path = value.relativePath == null ? null : relativePath(value.relativePath);
      const summary = text(value.summary, 500);
      if (!kind || !summary
        || (kind === "artifact" && !artifactId)
        || (kind === "file" && !path)
        || (kind === "note" && (artifactId || path))) {
        return null;
      }
      rows.push({ kind, artifactId, relativePath: path, summary });
    }
    return rows;
  }

  function syncRoutineCompletion(context, actor) {
    if (context.run.status !== "succeeded"
      || typeof recordWorkItemVerification !== "function"
      || context.workItem.verificationRecords?.some((record) =>
        record.evidence?.some((entry) => entry.kind === "run" && entry.ref === context.run.id))) {
      return;
    }
    const result = recordWorkItemVerification({
      workItemId: context.workItem.id,
      expectedRevision: context.workItem.revision,
      kind: "manual",
      status: "passed",
      summary: `Routine ${context.definition.name} v${context.definition.version} completed.`,
      acceptanceResults: (context.workItem.acceptanceCriteria ?? []).map((criterion) => {
        const step = context.definition.steps.find((candidate) =>
          candidate.required && candidate.label === criterion);
        const stepRun = step
          ? context.run.stepRuns.find((candidate) => candidate.stepKey === step.key)
          : null;
        return {
          criterion,
          status: stepRun?.state === "succeeded" ? "passed" : "not_tested",
          note: stepRun?.state === "succeeded"
            ? "The required routine step completed."
            : "The required routine step did not complete.",
        };
      }),
      evidence: [
        {
          kind: "run",
          ref: context.run.id,
          summary: "Completed business routine run.",
        },
        ...context.run.stepRuns.flatMap((stepRun) =>
          (stepRun.outputRefs ?? [])
            .filter((output) => output.kind === "artifact" && output.artifactId)
            .map((output) => ({
              kind: "artifact",
              ref: output.artifactId,
              summary: output.summary,
            }))),
      ].slice(0, 100),
    }, actor);
    if (!result?.ok) {
      event("routine_completion_gate_sync_failed",
        "Routine completed but its Issue completion evidence could not be synchronized.",
        context.run, actor, {
          routineRunId: context.run.id,
          workItemId: context.workItem.id,
          error: result?.body?.error ?? "work_item_verification_failed",
        });
    }
  }

  function recomputeRoutineRunStatus(run) {
    const states = run.stepRuns.map((row) => row.state);
    if (run.cancellationRequestedAt) run.status = "cancelled";
    else if (states.every((value) => ["succeeded", "skipped"].includes(value))) run.status = "succeeded";
    else if (states.some((value) => value === "failed")) run.status = "failed";
    else if (states.some((value) => value === "awaiting_approval")) run.status = "awaiting_approval";
    else if (states.some((value) => value === "awaiting_condition")) run.status = "awaiting_condition";
    else if (states.some((value) => value === "running")) run.status = "running";
    else run.status = "planned";
  }

  function receiptFor(run, idempotencyKey) {
    const key = text(idempotencyKey, 200);
    return key ? run.actionReceipts.find((row) => row.key === key) ?? null : null;
  }

  function recordReceipt(run, idempotencyKey, action, stepKey = null, payloadHash = null) {
    const key = text(idempotencyKey, 200);
    if (!key) return;
    run.actionReceipts.push({ key, action, stepKey, payloadHash, revision: run.revision });
    if (run.actionReceipts.length > 100) run.actionReceipts.splice(0, run.actionReceipts.length - 100);
  }

  function routineDeviceLimit(run) {
    const workItem = workItemFor(run.workItemId, { teamId: run.ownerTeamId });
    const device = state.devices?.find((row) => row.id === workItem?.terminalId);
    const configured = Number(device?.maxConcurrency);
    return Number.isInteger(configured) ? Math.max(1, Math.min(8, configured)) : 1;
  }

  function routineDeviceKey(run) {
    const workItem = workItemFor(run.workItemId, { teamId: run.ownerTeamId });
    return `${run.ownerTeamId}:${workItem?.terminalId ?? `work-item:${run.workItemId}`}`;
  }

  function nextCapacityQueueSequence() {
    return state.routineRuns.reduce(
      (maximum, candidate) => Math.max(maximum, Number(candidate.capacityQueue?.sequence) || 0),
      0,
    ) + 1;
  }

  function markRoutineWaitingForCapacity(run, timestamp) {
    run.waitingReason = "device_capacity";
    if (run.capacityQueue?.state !== "waiting") {
      run.capacityQueue = {
        state: "waiting",
        queuedAt: timestamp,
        sequence: nextCapacityQueueSequence(),
      };
    }
  }

  function clearRoutineCapacityWait(run) {
    if (run.waitingReason === "device_capacity") run.waitingReason = null;
    run.capacityQueue = null;
  }

  function waitingRoutineRunsOnDevice(run) {
    const deviceKey = routineDeviceKey(run);
    return state.routineRuns
      .filter((candidate) =>
        candidate.ownerTeamId === run.ownerTeamId
        && routineDeviceKey(candidate) === deviceKey
        && candidate.waitingReason === "device_capacity"
        && candidate.capacityQueue?.state === "waiting"
        && !candidate.cancellationRequestedAt
        && !["succeeded", "cancelled", "failed"].includes(candidate.status))
      .sort((left, right) =>
        (Number(left.capacityQueue.sequence) || 0) - (Number(right.capacityQueue.sequence) || 0)
        || String(left.capacityQueue.queuedAt ?? "").localeCompare(String(right.capacityQueue.queuedAt ?? ""))
        || left.id.localeCompare(right.id));
  }

  function activeRoutineStepsOnDevice(run) {
    const workItem = workItemFor(run.workItemId, { teamId: run.ownerTeamId });
    if (!workItem?.terminalId) {
      const definition = state.routineDefinitions.find((row) =>
        row.id === run.routineDefinitionId
        && row.version === run.routineVersion
        && row.ownerTeamId === run.ownerTeamId);
      const kindByStep = new Map(definition?.steps.map((step) => [step.key, step.kind]) ?? []);
      return run.stepRuns.filter((stepRun) =>
        stepRun.state === "running"
        && DEVICE_CAPACITY_STEP_KINDS.has(kindByStep.get(stepRun.stepKey))).length;
    }
    return state.routineRuns
      .filter((candidate) => {
        const candidateItem = workItemFor(candidate.workItemId, { teamId: run.ownerTeamId });
        return candidate.ownerTeamId === run.ownerTeamId && candidateItem?.terminalId === workItem.terminalId;
      })
      .flatMap((candidate) => {
        const definition = state.routineDefinitions.find((row) =>
          row.id === candidate.routineDefinitionId
          && row.version === candidate.routineVersion
          && row.ownerTeamId === candidate.ownerTeamId);
        const kindByStep = new Map(definition?.steps.map((step) => [step.key, step.kind]) ?? []);
        return candidate.stepRuns.filter((stepRun) =>
          stepRun.state === "running"
          && DEVICE_CAPACITY_STEP_KINDS.has(kindByStep.get(stepRun.stepKey)));
      })
      .length;
  }

  function scheduleRoutineRun(run, definition, timestamp, {
    ignoreQueue = false,
    maxStarts = null,
  } = {}) {
    if (run.cancellationRequestedAt || run.stepRuns.some((row) => row.state === "failed")) {
      recomputeRoutineRunStatus(run);
      return [];
    }
    const runByKey = new Map(run.stepRuns.map((stepRun) => [stepRun.stepKey, stepRun]));
    const eligible = definition.steps.filter((step) => {
      const stepRun = runByKey.get(step.key);
      return stepRun?.state === "pending" && step.dependsOn.every((dependency) =>
        ["succeeded", "skipped"].includes(runByKey.get(dependency)?.state));
    });
    const started = [];
    for (const step of eligible) {
      const stepRun = runByKey.get(step.key);
      if (step.kind === "human_approval") {
        stepRun.state = "awaiting_approval";
        started.push(step.key);
        break;
      }
      if (step.kind === "condition") {
        stepRun.state = "awaiting_condition";
        started.push(step.key);
        break;
      }
    }
    if (started.length) {
      clearRoutineCapacityWait(run);
      recomputeRoutineRunStatus(run);
      return started;
    }
    if (!eligible.length) {
      clearRoutineCapacityWait(run);
      recomputeRoutineRunStatus(run);
      return [];
    }
    const localOnly = eligible.find((step) => !DEVICE_CAPACITY_STEP_KINDS.has(step.kind));
    if (localOnly) {
      const stepRun = runByKey.get(localOnly.key);
      stepRun.state = "running";
      stepRun.startedAt ??= timestamp;
      stepRun.completedAt = null;
      stepRun.errorCode = null;
      stepRun.attempts += 1;
      clearRoutineCapacityWait(run);
      recomputeRoutineRunStatus(run);
      return [localOnly.key];
    }
    if (!ignoreQueue) {
      const ownSequence = Number(run.capacityQueue?.sequence) || Number.POSITIVE_INFINITY;
      const earlierWaiter = waitingRoutineRunsOnDevice(run).find((candidate) =>
        candidate.id !== run.id
        && (Number(candidate.capacityQueue?.sequence) || 0) < ownSequence);
      if (earlierWaiter) {
        markRoutineWaitingForCapacity(run, timestamp);
        recomputeRoutineRunStatus(run);
        return [];
      }
    }
    const active = activeRoutineStepsOnDevice(run);
    let available = Math.max(0, routineDeviceLimit(run) - active);
    if (!available) {
      markRoutineWaitingForCapacity(run, timestamp);
      recomputeRoutineRunStatus(run);
      return [];
    }
    const readOnly = eligible.filter((step) => READ_ONLY_STEP_KINDS.has(step.kind));
    const startLimit = Number.isInteger(maxStarts)
      ? Math.max(1, Math.min(available, maxStarts))
      : available;
    const selected = readOnly.length ? readOnly.slice(0, startLimit) : eligible.slice(0, 1);
    for (const step of selected) {
      const stepRun = runByKey.get(step.key);
      stepRun.state = "running";
      stepRun.startedAt ??= timestamp;
      stepRun.completedAt = null;
      stepRun.errorCode = null;
      stepRun.attempts += 1;
      started.push(step.key);
      available -= 1;
      if (!available) break;
    }
    if (started.length) clearRoutineCapacityWait(run);
    recomputeRoutineRunStatus(run);
    return started;
  }

  function drainRoutineDeviceQueue(referenceRun, timestamp, actor = null) {
    const awakened = [];
    const visited = new Set();
    while (activeRoutineStepsOnDevice(referenceRun) < routineDeviceLimit(referenceRun)) {
      const candidate = waitingRoutineRunsOnDevice(referenceRun)
        .find((row) => !visited.has(row.id));
      if (!candidate) break;
      visited.add(candidate.id);
      const definition = state.routineDefinitions.find((row) =>
        row.id === candidate.routineDefinitionId
        && row.version === candidate.routineVersion
        && row.ownerTeamId === candidate.ownerTeamId);
      if (!definition) {
        candidate.waitingReason = "routine_definition_unavailable";
        candidate.capacityQueue = null;
        continue;
      }
      const capacityWait = candidate.capacityQueue
        ? {
            queuedAt: candidate.capacityQueue.queuedAt ?? null,
            sequence: candidate.capacityQueue.sequence ?? null,
          }
        : null;
      const startedStepKeys = scheduleRoutineRun(candidate, definition, timestamp, {
        ignoreQueue: true,
        maxStarts: 1,
      });
      candidate.revision += 1;
      candidate.updatedAt = timestamp;
      candidate.updatedBy = actorUser(actor);
      if (capacityWait && startedStepKeys.length) {
        candidate.recoveryReceipts.push({
          kind: "device_capacity",
          queuedAt: capacityWait.queuedAt,
          releasedAt: timestamp,
          startedStepKeys: startedStepKeys.slice(0, 20),
        });
        candidate.recoveryReceipts = candidate.recoveryReceipts.slice(-50);
      }
      awakened.push({ routineRunId: candidate.id, startedStepKeys });
      event("routine_capacity_released",
        startedStepKeys.length
          ? "Waiting routine work automatically resumed when device capacity became available."
          : "Waiting routine work was re-evaluated when device capacity became available.",
        candidate, actor, {
          routineRunId: candidate.id,
          workItemId: candidate.workItemId,
          startedStepKeys,
          deviceLimit: routineDeviceLimit(candidate),
        });
    }
    return awakened;
  }

  function recordDocumentClassification(input = {}, actor = null) {
    const context = activeContext(input, actor);
    if (context.error) return { status: 404, body: { error: context.error } };
    const normalized = normalizeBusinessDocumentClassification({
      ...input,
      documentType: normalizeRoutineTriggerType(input.documentType) ?? input.documentType,
    });
    if (!normalized.ok) return { status: 400, body: { error: normalized.error } };
    const artifact = artifactFor(normalized.value.artifactId, actor);
    if (!artifact || artifact.projectId !== context.projectId || artifact.sourceId !== context.sourceId) {
      return { status: 404, body: { error: "business_document_artifact_not_found" } };
    }
    if (artifact.availability === "missing" || artifact.exclusion) {
      return { status: 409, body: { error: "business_document_artifact_unavailable" } };
    }
    if (artifact.fingerprint !== normalized.value.artifactFingerprint) {
      return { status: 409, body: { error: "business_document_artifact_changed" } };
    }
    const allEvidence = [
      ...normalized.value.evidenceRefs,
      ...normalized.value.fieldProposals.flatMap((field) => field.evidenceRefs),
    ];
    if (!evidenceBelongsTo(allEvidence, context, actor)) {
      return { status: 404, body: { error: "business_document_evidence_not_found" } };
    }
    const existing = state.businessDocumentClassifications.find((row) =>
      visible(row, actor) && row.artifactId === artifact.id);
    if (existing && input.expectedRevision !== existing.revision) {
      return {
        status: 409,
        body: { error: "business_document_classification_revision_conflict", currentRevision: existing.revision },
      };
    }
    const timestamp = now();
    if (existing) {
      runTx(() => {
        Object.assign(existing, normalized.value, {
          revision: existing.revision + 1,
          updatedAt: timestamp,
          updatedBy: actorUser(actor),
        });
        event("business_document_classification_updated", "Business document classification updated.", existing, actor, {
          classificationId: existing.id,
          artifactId: artifact.id,
          documentType: existing.documentType,
          confirmationState: existing.confirmationState,
          fieldCount: existing.fieldProposals.length,
          riskSignalCount: existing.riskSignals.length,
          revision: existing.revision,
        });
      });
      return { status: 200, body: { classification: existing } };
    }
    const classification = {
      id: nextId("bdc"),
      ownerTeamId: actorTeam(actor),
      projectId: context.projectId,
      sourceId: context.sourceId,
      ...normalized.value,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      state.businessDocumentClassifications.push(classification);
      event("business_document_classification_recorded", "Business document classification recorded.", classification, actor, {
        classificationId: classification.id,
        artifactId: artifact.id,
        documentType: classification.documentType,
        confirmationState: classification.confirmationState,
        fieldCount: classification.fieldProposals.length,
        riskSignalCount: classification.riskSignals.length,
      });
    });
    return { status: 201, body: { classification } };
  }

  function createBusinessEntity(input = {}, actor = null) {
    const context = activeContext(input, actor);
    if (context.error) return { status: 404, body: { error: context.error } };
    const normalizedEntityType = normalizeRoutineTriggerType(input.entityType);
    const entityType = businessEntityTypes.includes(input.entityType)
      ? input.entityType
      : businessEntityTypes.includes(normalizedEntityType) ? normalizedEntityType : null;
    const businessKey = text(input.businessKey, 200);
    const fields = normalizeFields(input.fields ?? {});
    const evidenceRefs = normalizeRoutineEvidenceRefs(input.evidenceRefs ?? []);
    const score = confidence(input.confidence ?? 1);
    if (!entityType || !businessKey || !fields || !evidenceRefs || score == null) {
      return { status: 400, body: { error: "invalid_business_entity" } };
    }
    if (!evidenceBelongsTo(evidenceRefs, context, actor)) {
      return { status: 404, body: { error: "business_entity_evidence_not_found" } };
    }
    const idempotencyKey = `business-entity:v1:${hashKey([
      actorTeam(actor), context.sourceId, entityType, businessKey,
    ])}`;
    const replay = state.businessEntities.find((row) =>
      visible(row, actor) && row.idempotencyKey === idempotencyKey);
    if (replay) {
      if (input.expectedRevision == null) {
        return { status: 200, body: { entity: replay, replayed: true } };
      }
      if (input.expectedRevision !== replay.revision) {
        return {
          status: 409,
          body: { error: "business_entity_revision_conflict", currentRevision: replay.revision },
        };
      }
      const timestamp = now();
      runTx(() => {
        Object.assign(replay, {
          fields,
          evidenceRefs,
          confidence: score,
          revision: replay.revision + 1,
          updatedAt: timestamp,
          updatedBy: actorUser(actor),
        });
        event("business_entity_updated", "Business entity updated.", replay, actor, {
          businessEntityId: replay.id,
          entityType,
          revision: replay.revision,
        });
      });
      return { status: 200, body: { entity: replay, replayed: false, updated: true } };
    }
    const timestamp = now();
    const entity = {
      id: nextId("bent"),
      schemaVersion: businessRoutineSchemaVersion,
      ownerTeamId: actorTeam(actor),
      projectId: context.projectId,
      sourceId: context.sourceId,
      entityType,
      businessKey,
      fields,
      evidenceRefs,
      confidence: score,
      idempotencyKey,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      state.businessEntities.push(entity);
      event("business_entity_created", "Business entity created.", entity, actor, {
        businessEntityId: entity.id,
        entityType,
      });
    });
    return { status: 201, body: { entity, replayed: false } };
  }

  function createBusinessCase(input = {}, actor = null) {
    const context = activeContext(input, actor);
    if (context.error) return { status: 404, body: { error: context.error } };
    const businessKey = text(input.businessKey, 200);
    const entityIds = stringList(input.entityIds ?? []);
    const evidenceRefs = normalizeRoutineEvidenceRefs(input.evidenceRefs ?? []);
    const score = confidence(input.confidence ?? 1);
    const stateValue = businessCaseStates.includes(input.state) ? input.state : "proposed";
    if (!businessKey || !entityIds || !evidenceRefs || score == null
      || !Array.isArray(input.artifactBindings) || !input.artifactBindings.length
      || input.artifactBindings.length > 100) {
      return { status: 400, body: { error: "invalid_business_case" } };
    }
    const entities = entityIds.map((id) =>
      state.businessEntities.find((row) => row.id === id && visible(row, actor)));
    if (entities.some((entity) => !entity || entity.sourceId !== context.sourceId)) {
      return { status: 404, body: { error: "business_case_entity_not_found" } };
    }
    if (!evidenceBelongsTo(evidenceRefs, context, actor)) {
      return { status: 404, body: { error: "business_case_evidence_not_found" } };
    }
    const artifactBindings = [];
    for (const binding of input.artifactBindings) {
      const artifactId = text(binding?.artifactId);
      const documentType = normalizeRoutineTriggerType(binding?.documentType);
      const roles = stringList(binding?.roles ?? [], { maxItems: 4 });
      const artifact = artifactId ? artifactFor(artifactId, actor) : null;
      if (!artifact || artifact.sourceId !== context.sourceId || !documentType || !roles?.length
        || roles.some((role) => !routineArtifactRoles.includes(role))) {
        return { status: 400, body: { error: "invalid_business_case_artifact_binding" } };
      }
      artifactBindings.push({ artifactId, documentType, roles });
    }
    const idempotencyKey = `business-case:v1:${hashKey([
      actorTeam(actor), context.sourceId, businessKey,
    ])}`;
    const replay = state.businessCases.find((row) =>
      visible(row, actor) && row.idempotencyKey === idempotencyKey);
    if (replay) return { status: 200, body: { businessCase: replay, replayed: true } };
    const timestamp = now();
    const businessCase = {
      id: nextId("bcs"),
      schemaVersion: businessRoutineSchemaVersion,
      ownerTeamId: actorTeam(actor),
      projectId: context.projectId,
      sourceId: context.sourceId,
      businessKey,
      state: stateValue,
      entityIds,
      artifactBindings,
      artifactFingerprints: Object.fromEntries(artifactBindings.map((binding) => [
        binding.artifactId,
        artifactFor(binding.artifactId, actor)?.fingerprint ?? "",
      ])),
      evidenceRefs,
      confidence: score,
      idempotencyKey,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      state.businessCases.push(businessCase);
      event("business_case_created", "Business case created.", businessCase, actor, {
        businessCaseId: businessCase.id,
        artifactCount: artifactBindings.length,
      });
    });
    return { status: 201, body: { businessCase, replayed: false } };
  }

  function createRoutineDefinition(input = {}, actor = null) {
    const context = activeContext(input, actor);
    if (context.error) return { status: 404, body: { error: context.error } };
    const name = text(input.name, 200);
    const description = input.description == null ? "" : String(input.description).trim().slice(0, 1_000);
    const discoveryCandidateId = input.discoveryCandidateId == null ? null : text(input.discoveryCandidateId);
    const historicalCaseIds = stringList(input.historicalCaseIds ?? []);
    const rawTriggerDocumentTypes = stringList(
      input.triggerDocumentTypes ?? [],
      { maxItems: 20, maxLength: 50 },
    );
    const triggerDocumentTypes = rawTriggerDocumentTypes
      ? [...new Set(rawTriggerDocumentTypes.map(normalizeRoutineTriggerType))]
      : null;
    const steps = normalizeRoutineSteps(input.steps);
    const dataContract = normalizeDataContract({
      dataRequirements: input.dataRequirements ?? [],
      relations: input.relations ?? [],
      mutationPolicy: input.mutationPolicy ?? null,
    });
    const evidenceRefs = normalizeRoutineEvidenceRefs(input.evidenceRefs ?? []);
    const score = confidence(input.confidence ?? 1);
    const requestedState = ["candidate", "draft"].includes(input.state) ? input.state : "candidate";
    const configurationError = steps.ok ? routineStepConfigurationError(steps.value) : null;
    if (!name || !historicalCaseIds || !triggerDocumentTypes?.length
      || triggerDocumentTypes.some((type) => !type)
      || !steps.ok || configurationError || !evidenceRefs || score == null || !dataContract) {
      return {
        status: 400,
        body: {
          error: steps.error ?? configurationError ?? "invalid_routine_definition",
          recovery: configurationError ? "Describe when the conditional step should run." : undefined,
        },
      };
    }
    if (!evidenceBelongsTo(evidenceRefs, context, actor)
      || steps.value.some((step) => !evidenceBelongsTo(step.evidenceRefs, context, actor))) {
      return { status: 404, body: { error: "routine_definition_evidence_not_found" } };
    }
    const idempotencyKey = `routine-definition:v1:${hashKey([
      actorTeam(actor),
      context.sourceId,
      name,
      discoveryCandidateId ?? "",
      historicalCaseIds.slice().sort(),
      evidenceRefs.map((ref) => ref.artifactId).sort(),
    ])}`;
    const replay = state.routineDefinitions.find((row) =>
      visible(row, actor) && row.idempotencyKey === idempotencyKey);
    if (replay) return { status: 200, body: { routineDefinition: replay, replayed: true } };
    const timestamp = now();
    const id = nextId("rtd");
    const routineDefinition = {
      id,
      familyId: id,
      schemaVersion: businessRoutineSchemaVersion,
      ownerTeamId: actorTeam(actor),
      projectId: context.projectId,
      sourceId: context.sourceId,
      name,
      description,
      version: 1,
      state: requestedState,
      discoveryCandidateId,
      historicalCaseIds,
      triggerDocumentTypes,
      steps: steps.value,
      templateContract: steps.value.find((step) => step.kind === "generate")?.configuration?.templateContract ?? null,
      dataRequirements: dataContract.dataRequirements,
      relations: dataContract.relations,
      mutationPolicy: dataContract.mutationPolicy,
      evidenceRefs,
      evidenceFingerprints: Object.fromEntries(
        [...new Set([
          ...evidenceRefs.map((ref) => ref.artifactId),
          ...steps.value.flatMap((step) => step.evidenceRefs.map((ref) => ref.artifactId)),
        ])].map((artifactId) => [artifactId, artifactFor(artifactId, actor)?.fingerprint ?? ""]),
      ),
      confidence: score,
      supersedesId: null,
      supersededById: null,
      idempotencyKey,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      state.routineDefinitions.push(routineDefinition);
      event("routine_definition_created", "Business routine definition created.", routineDefinition, actor, {
        routineDefinitionId: id,
        state: routineDefinition.state,
        version: 1,
      });
    });
    return { status: 201, body: { routineDefinition, replayed: false } };
  }

  function transitionRoutineDefinition({
    routineDefinitionId,
    expectedRevision,
    action,
    supersededById = null,
    confirmed = false,
  } = {}, actor = null) {
    const definition = state.routineDefinitions.find((row) =>
      row.id === routineDefinitionId && visible(row, actor));
    if (!definition) return { status: 404, body: { error: "routine_definition_not_found" } };
    if (expectedRevision !== definition.revision) {
      return {
        status: 409,
        body: {
          error: "routine_definition_revision_conflict",
          currentRevision: definition.revision,
          recovery: "Refresh the work type and reapply the intended change.",
        },
      };
    }
    if (!sourceFor(definition.sourceId, actor, { active: action !== "disable" && action !== "supersede" })) {
      return { status: 409, body: { error: "routine_definition_source_revoked" } };
    }
    if (action === "publish") {
      return publishRoutineDefinition({
        routineDefinitionId,
        expectedRevision,
        confirmed,
      }, actor);
    }
    const nextState = DEFINITION_TRANSITIONS[definition.state]?.[action] ?? null;
    if (!nextState) {
      return { status: 409, body: { error: "invalid_routine_definition_transition", currentState: definition.state } };
    }
    let replacement = null;
    if (action === "supersede") {
      replacement = state.routineDefinitions.find((row) =>
        row.id === supersededById && visible(row, actor) && row.familyId === definition.familyId
        && row.state === "published");
      if (!replacement) return { status: 400, body: { error: "invalid_routine_definition_replacement" } };
    }
    runTx(() => {
      definition.state = nextState;
      definition.supersededById = replacement?.id ?? definition.supersededById;
      definition.revision += 1;
      definition.updatedAt = now();
      definition.updatedBy = actorUser(actor);
      event(`routine_definition_${nextState}`, `Business routine definition ${nextState}.`, definition, actor, {
        routineDefinitionId: definition.id,
        state: nextState,
        version: definition.version,
        supersededById: replacement?.id ?? null,
      });
    });
    return { status: 200, body: { routineDefinition: definition } };
  }

  function routineDefinitionHealth(definition, actor) {
    const taskLearnedTemplate = definition.origin?.kind === "my_template_draft";
    const source = taskLearnedTemplate ? null : sourceFor(definition.sourceId, actor, { active: true });
    if (!taskLearnedTemplate && !source) {
      return { state: "blocked", issues: ["Source access was revoked."], recovery: "Restore source access." };
    }
    if (taskLearnedTemplate) {
      return { state: "valid", issues: [], recovery: null };
    }
    const issues = [];
    if (definition.discoveryCandidateId) {
      const candidate = state.routineDiscoveryCandidates.find((row) =>
        row.id === definition.discoveryCandidateId
        && visible(row, actor)
        && row.projectId === definition.projectId
        && row.sourceId === definition.sourceId);
      if (!candidate || candidate.state !== "candidate") {
        issues.push("The discovered work pattern is no longer current.");
      }
    }
    for (const [artifactId, fingerprint] of Object.entries(definition.evidenceFingerprints ?? {})) {
      const artifact = artifactFor(artifactId, actor);
      if (!artifact || artifact.availability === "missing" || artifact.exclusion) {
        issues.push("Historical evidence is missing or excluded.");
      } else if (artifact.fingerprint !== fingerprint) {
        issues.push("Historical evidence changed after this draft was created.");
      }
    }
    const historicalCaseIds = definition.historicalCaseIds ?? [];
    if (definition.discoveryCandidateId || historicalCaseIds.length) {
      const historicalCases = historicalCaseIds.map((caseId) =>
        state.businessCases.find((row) =>
          row.id === caseId
          && visible(row, actor)
          && row.projectId === definition.projectId
          && row.sourceId === definition.sourceId));
      const healthyCaseCount = historicalCases.filter((businessCase) =>
        businessCase
        && ["confirmed", "active", "completed"].includes(businessCase.state)
        && Array.isArray(businessCase.artifactBindings)
        && businessCase.artifactBindings.every((binding) => {
          const artifact = artifactFor(binding.artifactId, actor);
          return artifact
            && artifact.projectId === definition.projectId
            && artifact.sourceId === definition.sourceId
            && artifact.availability !== "missing"
            && !artifact.exclusion
            && businessCase.artifactFingerprints?.[artifact.id] === artifact.fingerprint;
        })).length;
      if (historicalCases.some((businessCase) => !businessCase)) {
        issues.push("A historical business case is no longer available.");
      }
      if (healthyCaseCount !== historicalCases.filter(Boolean).length) {
        issues.push("A historical business case is no longer confirmed or its evidence changed.");
      }
      const requiredHealthyCases = source?.purpose === "template_learning"
        || definition.templateScope === "team"
        || definition.templateLearningTaskId
        || definition.templateMaturity === "trial" ? 1 : 3;
      if (healthyCaseCount < requiredHealthyCases) {
        issues.push(`At least ${requiredHealthyCases} healthy confirmed historical case${requiredHealthyCases === 1 ? " is" : "s are"} required.`);
      }
    }
    const configurationError = routineStepConfigurationError(definition.steps ?? []);
    if (configurationError) {
      issues.push("A conditional step is missing its business condition.");
    }
    return issues.length
      ? { state: "blocked", issues: [...new Set(issues)], recovery: "Review changed evidence and create a fresh draft." }
      : { state: "valid", issues: [], recovery: null };
  }

  function listRoutineDefinitions({ sourceId = null } = {}, actor = null) {
    if (sourceId && !sourceFor(sourceId, actor)) {
      return { status: 404, body: { error: "workflow_source_not_found" } };
    }
    const routineDefinitions = state.routineDefinitions
      .filter((row) => visible(row, actor) && (!sourceId || row.sourceId === sourceId))
      .map((row) => ({ ...row, evidenceHealth: routineDefinitionHealth(row, actor) }));
    return { status: 200, body: { routineDefinitions, count: routineDefinitions.length } };
  }

  function listTaskTemplates({ projectId = null, sourceId = null, includeNonPublished = false } = {}, actor = null) {
    if (sourceId && !sourceFor(sourceId, actor)) {
      return { status: 404, body: { error: "workflow_source_not_found" } };
    }
    if (projectId && !projectFor(projectId, actor)) {
      return { status: 404, body: { error: "project_not_found" } };
    }
    const taskTemplates = [];
    for (const definition of state.routineDefinitions) {
      if (!visible(definition, actor)
        || (projectId && definition.projectId !== projectId)
        || (sourceId && definition.sourceId !== sourceId)
        || (!includeNonPublished && definition.state !== "published")) continue;
      const projected = projectRoutineDefinitionToTaskTemplate(definition);
      if (projected.ok) taskTemplates.push(projected.value);
    }
    return { status: 200, body: { taskTemplates, count: taskTemplates.length } };
  }

  function selectPublishedRoutineForTrigger({ projectId, sourceId, documentType } = {}, actor = null) {
    const context = activeContext({ projectId, sourceId }, actor);
    if (context.error) return { status: 404, body: { error: context.error } };
    const listed = listRoutineDefinitions({ sourceId }, actor);
    if (listed.status >= 400) return listed;
    return selectPublishedBusinessRoutine(
      listed.body.routineDefinitions.filter((definition) => definition.projectId === projectId),
      documentType,
    );
  }

  function createRoutineDraftFromDiscovery({ discoveryCandidateId } = {}, actor = null) {
    const candidate = state.routineDiscoveryCandidates.find((row) =>
      row.id === discoveryCandidateId && visible(row, actor));
    if (!candidate) return { status: 404, body: { error: "routine_discovery_candidate_not_found" } };
    if (candidate.state !== "candidate") {
      return { status: 409, body: { error: "routine_discovery_candidate_not_current" } };
    }
    if (candidate.confirmedCaseIds.length < (candidate.minimumCaseCount ?? 3)) {
      return {
        status: 409,
        body: {
          error: "insufficient_confirmed_business_cases",
          recovery: `Confirm at least ${candidate.minimumCaseCount ?? 3} comparable business cases, then discover again.`,
        },
      };
    }
    const cases = candidate.confirmedCaseIds.map((caseId) =>
      state.businessCases.find((row) => row.id === caseId && visible(row, actor)));
    const evidenceChanged = cases.some((businessCase) =>
      !businessCase
      || !["confirmed", "active", "completed"].includes(businessCase.state)
      || businessCase.artifactBindings.some((binding) => {
        const artifact = artifactFor(binding.artifactId, actor);
        return !artifact
          || artifact.availability === "missing"
          || artifact.exclusion
          || businessCase.artifactFingerprints?.[artifact.id] !== artifact.fingerprint;
      }));
    if (evidenceChanged) {
      return {
        status: 409,
        body: {
          error: "routine_discovery_evidence_changed",
          recovery: "Re-analyze changed files and confirm the affected business cases.",
        },
      };
    }
    const created = createRoutineDefinition({
      projectId: candidate.projectId,
      sourceId: candidate.sourceId,
      name: candidate.name ?? "Commercial inquiry and quotation",
      description: candidate.description
        ?? "Register an inquiry, retrieve references, prepare and approve a quotation, then hand off a confirmed order.",
      state: "draft",
      discoveryCandidateId: candidate.id,
      historicalCaseIds: candidate.confirmedCaseIds,
      triggerDocumentTypes: candidate.triggerDocumentTypes,
      steps: candidate.steps.map((step) => ({
        key: step.key,
        kind: step.kind,
        label: step.label,
        required: step.required,
        dependsOn: step.dependsOn,
        evidenceRefs: step.evidenceRefs,
        configuration: {
          ...step.configuration,
          requirement: step.requirement,
          coverage: step.coverage,
          ...(step.kind === "condition" && !text(step.configuration?.condition, 1_000)
            ? { condition: step.label }
            : {}),
          ...(step.kind === "generate" && /(?:quotation|quote|报价)/i.test(`${step.key} ${step.label}`)
            ? {
                executorId: CONFIRMED_TEMPLATE_QUOTATION_EXECUTOR_ID,
                requiredFields: DEFAULT_QUOTATION_REQUIRED_FIELDS,
              }
            : {}),
        },
      })),
      evidenceRefs: candidate.evidenceRefs,
      confidence: candidate.confidence,
      dataRequirements: candidate.dataRequirements ?? [],
      relations: candidate.relations ?? [],
      mutationPolicy: candidate.mutationPolicy ?? null,
    }, actor);
    if ([200, 201].includes(created.status) && created.body?.routineDefinition) {
      created.body.routineDefinition.templateMaturity = "stable";
      if (candidate.templateContract) {
        created.body.routineDefinition.templateContract = candidate.templateContract;
      }
      const source = state.workflowSources.find((row) => row.id === candidate.sourceId);
      if (source?.purpose === "template_learning") {
        const replacement = created.body.routineDefinition;
        runTx(() => {
          for (const previous of state.routineDefinitions.filter((row) =>
            row.id !== replacement.id
            && row.ownerTeamId === replacement.ownerTeamId
            && row.sourceId === replacement.sourceId
            && row.state === "draft")) {
            previous.state = "superseded";
            previous.supersededById = replacement.id;
            previous.revision += 1;
            previous.updatedAt = now();
            previous.updatedBy = actorUser(actor);
          }
        });
      }
    }
    return created;
  }

  function updateRoutineDefinition({
    routineDefinitionId,
    expectedRevision,
    name,
    description,
    triggerDocumentTypes,
    steps,
    dataRequirements,
    relations,
    mutationPolicy,
  } = {}, actor = null) {
    const definition = state.routineDefinitions.find((row) =>
      row.id === routineDefinitionId && visible(row, actor));
    if (!definition) return { status: 404, body: { error: "routine_definition_not_found" } };
    if (expectedRevision !== definition.revision) {
      return {
        status: 409,
        body: {
          error: "routine_definition_revision_conflict",
          currentRevision: definition.revision,
          recovery: "Refresh the work type and reapply the intended change.",
        },
      };
    }
    if (!["candidate", "draft"].includes(definition.state)) {
      return { status: 409, body: { error: "published_routine_definition_is_immutable" } };
    }
    const nextName = name == null ? definition.name : text(name, 200);
    const nextDescription = description == null
      ? definition.description
      : text(description, 1_000);
    const rawNextTriggers = triggerDocumentTypes == null
      ? definition.triggerDocumentTypes
      : stringList(triggerDocumentTypes, { maxItems: 20, maxLength: 50 });
    const nextTriggers = rawNextTriggers
      ? [...new Set(rawNextTriggers.map(normalizeRoutineTriggerType))]
      : null;
    const nextSteps = steps == null ? { ok: true, value: definition.steps } : normalizeRoutineSteps(steps);
    const nextDataContract = normalizeDataContract({
      dataRequirements: dataRequirements == null ? definition.dataRequirements ?? [] : dataRequirements,
      relations: relations == null ? definition.relations ?? [] : relations,
      mutationPolicy: mutationPolicy == null ? definition.mutationPolicy ?? null : mutationPolicy,
    });
    const configurationError = nextSteps.ok ? routineStepConfigurationError(nextSteps.value) : null;
    if (!nextName || !nextDescription || !nextTriggers?.length
      || nextTriggers.some((type) => !type)
      || !nextSteps.ok
      || configurationError
      || !nextDataContract
      || nextSteps.value.some((step) => !evidenceBelongsTo(step.evidenceRefs, definition, actor))) {
      return {
        status: 400,
        body: {
          error: nextSteps.error ?? configurationError ?? "invalid_routine_definition_update",
          recovery: configurationError
            ? "Describe when the conditional step should run."
            : "Review the trigger, step order, conditions, and evidence.",
        },
      };
    }
    runTx(() => {
      Object.assign(definition, {
        name: nextName,
        description: nextDescription,
        triggerDocumentTypes: nextTriggers,
        steps: nextSteps.value,
        templateContract: nextSteps.value.find((step) => step.kind === "generate")?.configuration?.templateContract
          ?? definition.templateContract
          ?? null,
        dataRequirements: nextDataContract.dataRequirements,
        relations: nextDataContract.relations,
        mutationPolicy: nextDataContract.mutationPolicy,
        evidenceFingerprints: Object.fromEntries(
          [...new Set([
            ...definition.evidenceRefs.map((ref) => ref.artifactId),
            ...nextSteps.value.flatMap((step) => step.evidenceRefs.map((ref) => ref.artifactId)),
          ])].map((artifactId) => [artifactId, artifactFor(artifactId, actor)?.fingerprint ?? ""]),
        ),
        revision: definition.revision + 1,
        updatedAt: now(),
        updatedBy: actorUser(actor),
      });
      event("routine_definition_updated", "Business routine draft updated.", definition, actor, {
        routineDefinitionId: definition.id,
        version: definition.version,
        stepCount: definition.steps.length,
      });
    });
    return { status: 200, body: { routineDefinition: definition } };
  }

  function createRoutineDefinitionVersion({
    routineDefinitionId,
    expectedRevision,
  } = {}, actor = null) {
    const base = state.routineDefinitions.find((row) =>
      row.id === routineDefinitionId && visible(row, actor));
    if (!base) return { status: 404, body: { error: "routine_definition_not_found" } };
    if (expectedRevision !== base.revision) {
      return {
        status: 409,
        body: {
          error: "routine_definition_revision_conflict",
          currentRevision: base.revision,
          recovery: "Refresh the work type before creating a new version.",
        },
      };
    }
    if (!["published", "disabled"].includes(base.state)) {
      return { status: 409, body: { error: "routine_definition_version_requires_published_base" } };
    }
    const existingDraft = state.routineDefinitions.find((row) =>
      visible(row, actor) && row.familyId === base.familyId && row.state === "draft");
    if (existingDraft) return { status: 200, body: { routineDefinition: existingDraft, replayed: true } };
    const timestamp = now();
    const id = nextId("rtd");
    const version = Math.max(...state.routineDefinitions
      .filter((row) => visible(row, actor) && row.familyId === base.familyId)
      .map((row) => row.version)) + 1;
    const draft = {
      ...base,
      id,
      familyId: base.familyId,
      version,
      state: "draft",
      supersedesId: base.id,
      supersededById: null,
      idempotencyKey: `routine-definition-version:v1:${hashKey([base.familyId, version])}`,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      state.routineDefinitions.push(draft);
      event("routine_definition_version_created", "New business routine draft created.", draft, actor, {
        routineDefinitionId: draft.id,
        familyId: draft.familyId,
        version,
        supersedesId: base.id,
      });
    });
    return { status: 201, body: { routineDefinition: draft, replayed: false } };
  }

  function publishRoutineDefinition({
    routineDefinitionId,
    expectedRevision,
    confirmed = false,
  } = {}, actor = null) {
    const definition = state.routineDefinitions.find((row) =>
      row.id === routineDefinitionId && visible(row, actor));
    if (!definition) return { status: 404, body: { error: "routine_definition_not_found" } };
    if (expectedRevision !== definition.revision) {
      return {
        status: 409,
        body: {
          error: "routine_definition_revision_conflict",
          currentRevision: definition.revision,
          recovery: "Refresh the work type before enabling it.",
        },
      };
    }
    if (definition.state !== "draft") {
      return { status: 409, body: { error: "routine_definition_not_publishable" } };
    }
    if (confirmed !== true) {
      return { status: 400, body: { error: "routine_definition_publication_confirmation_required" } };
    }
    const health = routineDefinitionHealth(definition, actor);
    if (health.state !== "valid") {
      return { status: 409, body: { error: "routine_definition_evidence_not_valid", evidenceHealth: health } };
    }
    const previous = definition.supersedesId
      ? state.routineDefinitions.find((row) => row.id === definition.supersedesId && visible(row, actor))
      : null;
    if (definition.supersedesId && (!previous
      || previous.familyId !== definition.familyId
      || previous.version >= definition.version
      || !["published", "disabled"].includes(previous.state))) {
      return { status: 409, body: { error: "routine_definition_replacement_not_current" } };
    }
    const otherPublished = state.routineDefinitions.find((row) =>
      visible(row, actor)
      && row.familyId === definition.familyId
      && row.id !== definition.id
      && row.state === "published"
      && row.id !== previous?.id);
    if (otherPublished) {
      return { status: 409, body: { error: "routine_definition_family_already_published" } };
    }
    runTx(() => {
      definition.state = "published";
      definition.revision += 1;
      definition.updatedAt = now();
      definition.updatedBy = actorUser(actor);
      if (previous) {
        previous.state = "superseded";
        previous.supersededById = definition.id;
        previous.revision += 1;
        previous.updatedAt = definition.updatedAt;
        previous.updatedBy = actorUser(actor);
      }
      event("routine_definition_published", "Business routine version published.", definition, actor, {
        routineDefinitionId: definition.id,
        familyId: definition.familyId,
        version: definition.version,
        supersedesId: previous?.id ?? null,
      });
    });
    return { status: 200, body: { routineDefinition: definition, superseded: previous } };
  }

  function createLedgerDefinition(input = {}, actor = null) {
    const context = activeContext(input, actor);
    if (context.error) return { status: 404, body: { error: context.error } };
    const name = text(input.name, 200);
    const documentType = ["inquiry_ledger", "quotation_ledger", "order_ledger"].includes(input.documentType)
      ? input.documentType
      : input.businessKeyField === "quotation_number"
        ? "quotation_ledger"
        : input.businessKeyField === "order_number"
          ? "order_ledger"
          : input.businessKeyField === "inquiry_number"
            ? "inquiry_ledger"
            : null;
    const format = ["csv", "xlsx"].includes(input.format) ? input.format : null;
    const path = relativePath(input.relativePath);
    const sheet = input.sheet == null || input.sheet === "" ? null : text(input.sheet, 200);
    const table = input.table == null || input.table === "" ? null : text(input.table, 200);
    const businessKeyField = text(input.businessKeyField, 120);
    const fieldMappings = normalizeFieldMappings(input.fieldMappings);
    const headerRow = Number.isInteger(input.headerRow) && input.headerRow >= 1 && input.headerRow <= 100
      ? input.headerRow
      : 1;
    const fallbackBusinessKeyFields = input.fallbackBusinessKeyFields == null
      ? []
      : stringList(input.fallbackBusinessKeyFields, { maxItems: 5, maxLength: 120 });
    const requiredFields = input.requiredFields == null
      ? [businessKeyField].filter(Boolean)
      : stringList(input.requiredFields, { maxItems: 100, maxLength: 120 });
    const csvDelimiter = [",", ";", "\t"].includes(input.formattingPolicy?.csvDelimiter)
      ? input.formattingPolicy.csvDelimiter
      : ",";
    const approvalPolicy = ["always", "updates_only"].includes(input.writePolicy?.approval)
      ? input.writePolicy.approval
      : "always";
    const allowInsert = input.writePolicy?.allowInsert !== false;
    const allowUpdate = input.writePolicy?.allowUpdate !== false;
    const transitions = fieldTransitions(input.writePolicy?.fieldTransitions);
    const requestedState = ledgerDefinitionStates.includes(input.state) ? input.state : "draft";
    if (!name || !documentType || !format || !path || (input.sheet != null && input.sheet !== "" && !sheet)
      || (input.table != null && input.table !== "" && !table)
      || (format === "csv" && (sheet || table)) || (format === "xlsx" && !sheet)
      || !businessKeyField || !SAFE_FIELD_RE.test(businessKeyField)
      || SENSITIVE_FIELD_RE.test(businessKeyField) || !fieldMappings || requestedState !== "draft"
      || !fallbackBusinessKeyFields || !requiredFields?.length
      || !transitions
      || [...requiredFields, ...fallbackBusinessKeyFields].some((field) =>
        !SAFE_FIELD_RE.test(field) || SENSITIVE_FIELD_RE.test(field))
      || !requiredFields.includes(businessKeyField)
      || requiredFields.some((field) => !Object.hasOwn(fieldMappings, field))
      || !Object.hasOwn(fieldMappings, businessKeyField)
      || (!allowInsert && !allowUpdate)
      || !path.toLowerCase().endsWith(`.${format}`)) {
      return { status: 400, body: { error: "invalid_ledger_definition" } };
    }
    const idempotencyKey = `ledger-definition:v1:${hashKey([
      actorTeam(actor), context.sourceId, path, sheet ?? "", businessKeyField,
      table ?? "",
    ])}`;
    const replay = state.ledgerDefinitions.find((row) =>
      visible(row, actor) && row.idempotencyKey === idempotencyKey);
    if (replay) return { status: 200, body: { ledgerDefinition: replay, replayed: true } };
    const timestamp = now();
    const ledgerDefinition = {
      id: nextId("ldg"),
      schemaVersion: businessRoutineSchemaVersion,
      ownerTeamId: actorTeam(actor),
      projectId: context.projectId,
      sourceId: context.sourceId,
      name,
      state: requestedState,
      documentType,
      format,
      relativePath: path,
      sheet,
      table,
      headerRow,
      businessKeyField,
      fallbackBusinessKeyFields,
      fieldMappings,
      requiredFields,
      formattingPolicy: {
        preserveStylesAndFormulas: true,
        csvDelimiter,
      },
      writePolicy: {
        approval: approvalPolicy,
        allowInsert,
        allowUpdate,
        fieldTransitions: transitions,
      },
      idempotencyKey,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      state.ledgerDefinitions.push(ledgerDefinition);
      event("ledger_definition_created", "Ledger definition created.", ledgerDefinition, actor, {
        ledgerDefinitionId: ledgerDefinition.id,
        format,
      });
    });
    return { status: 201, body: { ledgerDefinition, replayed: false } };
  }

  function createRoutineRun(input = {}, actor = null) {
    const definition = state.routineDefinitions.find((row) =>
      row.id === input.routineDefinitionId && visible(row, actor));
    const businessCase = state.businessCases.find((row) =>
      row.id === input.businessCaseId && visible(row, actor));
    if (!definition || !businessCase || definition.projectId !== businessCase.projectId
      || definition.sourceId !== businessCase.sourceId) {
      return { status: 404, body: { error: "routine_run_context_not_found" } };
    }
    if (input.routineVersion !== definition.version) {
      return { status: 409, body: { error: "routine_definition_not_published_or_version_mismatch" } };
    }
    const binding = normalizeLocalIssueRoutineBinding({
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessCaseId: businessCase.id,
      businessKey: businessCase.businessKey,
      triggerArtifactIds: input.triggerArtifactIds,
    });
    if (!binding.ok) return { status: 400, body: { error: binding.error } };
    const triggerArtifacts = binding.value.triggerArtifactIds.map((artifactId) =>
      artifactFor(artifactId, actor));
    if (triggerArtifacts.some((artifact) =>
      !artifact || artifact.projectId !== definition.projectId || artifact.sourceId !== definition.sourceId
      || artifact.availability === "missing" || artifact.exclusion)) {
      return { status: 404, body: { error: "routine_run_trigger_artifact_not_found" } };
    }
    if (triggerArtifacts.some((artifact) =>
      businessCase.artifactFingerprints?.[artifact.id] !== artifact.fingerprint)) {
      return { status: 409, body: { error: "routine_run_trigger_evidence_changed" } };
    }
    const keys = routineIdempotencyKeys({
      ownerTeamId: actorTeam(actor),
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessKey: businessCase.businessKey,
      sourceFingerprints: triggerArtifacts.map((artifact) => artifact.fingerprint),
    });
    const legacyKeys = routineIdempotencyKeys({
      ownerTeamId: actorTeam(actor),
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessKey: businessCase.businessKey,
    });
    const workItemId = input.workItemId == null ? null : text(input.workItemId);
    if (input.workItemId != null && !workItemId) {
      return { status: 400, body: { error: "invalid_routine_run_work_item" } };
    }
    if (workItemId) {
      const workItem = state.workItems?.find((row) =>
        row.id === workItemId
        && row.ownerTeamId === actorTeam(actor)
        && row.projectId === definition.projectId);
      if (!workItem
        || workItem.routineDefinitionId !== definition.id
        || workItem.routineVersion !== definition.version
        || workItem.businessCaseId !== businessCase.id
        || workItem.businessKey !== businessCase.businessKey) {
        return { status: 409, body: { error: "routine_run_work_item_binding_mismatch" } };
      }
    }
    const replay = state.routineRuns.find((row) =>
      visible(row, actor) && [keys.issue, legacyKeys.issue].includes(row.issueIdempotencyKey));
    if (replay) {
      if (workItemId && replay.workItemId && replay.workItemId !== workItemId) {
        return { status: 409, body: { error: "routine_run_already_bound_to_another_work_item" } };
      }
      if (workItemId && !replay.workItemId) {
        runTx(() => {
          replay.workItemId = workItemId;
          replay.revision += 1;
          replay.updatedAt = now();
          replay.updatedBy = actorUser(actor);
        });
      }
      return { status: 200, body: { routineRun: replay, replayed: true } };
    }
    if (!sourceFor(definition.sourceId, actor, { active: true })) {
      return { status: 409, body: { error: "routine_run_source_revoked" } };
    }
    if (definition.state !== "published") {
      return { status: 409, body: { error: "routine_definition_not_published_or_version_mismatch" } };
    }
    if (!["confirmed", "active"].includes(businessCase.state)) {
      return { status: 409, body: { error: "routine_business_case_not_confirmed" } };
    }
    const timestamp = now();
    const routineRun = {
      id: nextId("rtr"),
      schemaVersion: businessRoutineSchemaVersion,
      ownerTeamId: actorTeam(actor),
      projectId: definition.projectId,
      sourceId: definition.sourceId,
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessCaseId: businessCase.id,
      businessKey: businessCase.businessKey,
      triggerArtifactIds: binding.value.triggerArtifactIds,
      sourceFingerprints: triggerArtifacts.map((artifact) => artifact.fingerprint).sort(),
      workItemId,
      status: "planned",
      issueIdempotencyKey: keys.issue,
      outputPublicationIdempotencyKey: keys.outputPublication,
      stepRuns: definition.steps.map((step) => ({
        stepKey: step.key,
        kind: step.kind,
        state: "pending",
        idempotencyKey: routineIdempotencyKeys({
          ownerTeamId: actorTeam(actor),
          routineDefinitionId: definition.id,
          routineVersion: definition.version,
          businessKey: businessCase.businessKey,
          stepKey: step.key,
          sourceFingerprints: triggerArtifacts.map((artifact) => artifact.fingerprint),
        }).step,
        startedAt: null,
        completedAt: null,
        errorCode: null,
        attempts: 0,
        outputRefs: [],
        approval: null,
        conditionOutcome: null,
        quotationInputs: null,
        quotationReview: null,
      })),
      actionReceipts: [],
      recoveryReceipts: [],
      recoveryIntent: null,
      waitingReason: null,
      cancellationRequestedAt: null,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      state.routineRuns.push(routineRun);
      event("routine_run_created", "Business routine run created.", routineRun, actor, {
        routineRunId: routineRun.id,
        routineDefinitionId: definition.id,
        routineVersion: definition.version,
        businessCaseId: businessCase.id,
      });
    });
    return { status: 201, body: { routineRun, binding: binding.value, replayed: false } };
  }

  function routineExecutionContext(workItemId, actor) {
    const workItem = workItemFor(workItemId, actor);
    if (!workItem?.routineDefinitionId) return { error: "routine_work_item_not_found", status: 404 };
    const definition = state.routineDefinitions.find((row) =>
      row.id === workItem.routineDefinitionId
      && row.version === workItem.routineVersion
      && visible(row, actor));
    const run = state.routineRuns.find((row) =>
      row.workItemId === workItem.id
      && row.routineDefinitionId === workItem.routineDefinitionId
      && row.routineVersion === workItem.routineVersion
      && visible(row, actor));
    if (!definition || !run) return { error: "routine_work_item_execution_not_found", status: 404 };
    return { workItem, definition, run };
  }

  function routineExecutionView(context) {
    const runByKey = new Map(context.run.stepRuns.map((row) => [row.stepKey, row]));
    const availableOrderTriggers = state.businessDocumentClassifications
      .filter((classification) =>
        classification.ownerTeamId === context.run.ownerTeamId
        && classification.projectId === context.run.projectId
        && classification.sourceId === context.run.sourceId
        && classification.documentType === "order"
        && ["confirmed", "corrected"].includes(classification.confirmationState))
      .map((classification) => {
        const artifact = state.workflowArtifacts.find((row) =>
          row.id === classification.artifactId
          && row.ownerTeamId === context.run.ownerTeamId
          && row.fingerprint === classification.artifactFingerprint
          && row.availability !== "missing"
          && !row.exclusion);
        return artifact ? {
          artifactId: artifact.id,
          label: artifact.relativePath ?? artifact.name ?? artifact.id,
        } : null;
      })
      .filter(Boolean)
      .slice(0, 20);
    const publicStepRun = (stepRun) => {
      if (!stepRun) return null;
      const {
        idempotencyKey: _idempotencyKey,
        quotationInputs: _quotationInputs,
        ...visibleStepRun
      } = stepRun;
      return visibleStepRun;
    };
    const availableLedgers = state.ledgerDefinitions
      .filter((definition) =>
        definition.ownerTeamId === context.run.ownerTeamId
        && definition.projectId === context.run.projectId
        && definition.sourceId === context.run.sourceId
        && definition.state === "active")
      .map((definition) => ({
        id: definition.id,
        name: definition.name,
        documentType: definition.documentType,
        format: definition.format,
        relativePath: definition.relativePath,
        sheet: definition.sheet,
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, 100);
    return {
      workItemId: context.workItem.id,
      sourceId: context.run.sourceId,
      definition: {
        id: context.definition.id,
        name: context.definition.name,
        version: context.definition.version,
      },
      run: {
        id: context.run.id,
        status: context.run.status,
        revision: context.run.revision,
        waitingReason: context.run.waitingReason,
        cancellationRequestedAt: context.run.cancellationRequestedAt,
        capacity: {
          limit: routineDeviceLimit(context.run),
          active: activeRoutineStepsOnDevice(context.run),
          state: context.run.waitingReason === "device_capacity" ? "waiting" : "ready",
          position: context.run.waitingReason === "device_capacity"
            ? waitingRoutineRunsOnDevice(context.run)
              .findIndex((candidate) => candidate.id === context.run.id) + 1
            : null,
          waitingSince: context.run.capacityQueue?.queuedAt ?? null,
        },
      },
      assistance: routineAssistance(context),
      recovery: context.run.recoveryIntent
        ? {
            kind: context.run.recoveryIntent.kind,
            stepKey: context.run.recoveryIntent.stepKey,
            requestedAt: context.run.recoveryIntent.requestedAt,
          }
        : null,
      availableLedgers,
      availableOrderTriggers,
      steps: context.definition.steps.map((step) => {
        const { executorId: _executorId, ...publicConfiguration } = step.configuration ?? {};
        const stepRun = runByKey.get(step.key);
        if (step.kind === "ledger_upsert"
          && !publicConfiguration.ledgerDefinitionId
          && stepRun?.ledgerDefinitionId) {
          publicConfiguration.ledgerDefinitionId = stepRun.ledgerDefinitionId;
        }
        return {
          key: step.key,
          label: step.label,
          kind: step.kind,
          required: step.required,
          dependsOn: step.dependsOn,
          configuration: publicConfiguration,
          run: publicStepRun(stepRun),
        };
      }),
    };
  }

  function getRoutineWorkItemExecution({ workItemId } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    return { status: 200, body: { execution: routineExecutionView(context) } };
  }

  function listRoutineWorkQueue({
    projectId = null,
    sourceId = null,
    includeCompleted = false,
    limit = 20,
  } = {}, actor = null) {
    const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const priority = {
      awaiting_approval: 0,
      awaiting_condition: 1,
      failed: 2,
      running: 3,
      planned: 4,
      succeeded: 5,
      cancelled: 6,
    };
    const items = state.routineRuns
      .filter((run) =>
        visible(run, actor)
        && actorCanAccessProject(state, actor, run.projectId)
        && (!projectId || run.projectId === projectId)
        && (!sourceId || run.sourceId === sourceId)
        && (includeCompleted || !["succeeded", "cancelled"].includes(run.status)))
      .map((run) => {
        const workItem = workItemFor(run.workItemId, actor);
        const definition = state.routineDefinitions.find((row) =>
          row.id === run.routineDefinitionId
          && row.version === run.routineVersion
          && visible(row, actor));
        if (!workItem || !definition) return null;
        const execution = routineExecutionView({ workItem, definition, run });
        const activeStep = execution.steps.find((step) =>
          ["running", "awaiting_approval", "awaiting_condition", "failed"].includes(step.run.state));
        const ledgerWait = state.ledgerUpsertPreviews
          .filter((preview) =>
            preview.ownerTeamId === run.ownerTeamId
            && preview.routineRunId === run.id
            && preview.state === "waiting")
          .sort((left, right) =>
            (Number(left.queueSequence) || 0) - (Number(right.queueSequence) || 0))[0] ?? null;
        const completedSteps = execution.steps.filter((step) =>
          ["succeeded", "skipped"].includes(step.run.state)).length;
        const visibleWaitingReason = run.waitingReason ?? (ledgerWait ? "ledger_reservation" : null);
        let nextAction = "start";
        if (run.waitingReason === "device_capacity") nextAction = "wait_capacity";
        else if (ledgerWait) nextAction = "wait_ledger";
        else if (activeStep?.run.state === "awaiting_approval") nextAction = "review_approval";
        else if (activeStep?.run.state === "awaiting_condition") nextAction = "decide_condition";
        else if (activeStep?.run.state === "failed") nextAction = "retry_step";
        else if (activeStep?.kind === "ledger_upsert") nextAction = "review_ledger";
        else if (activeStep?.run.state === "running") nextAction = "continue_step";
        return {
          workItemId: workItem.id,
          localRef: workItem.localRef,
          title: workItem.title,
          projectId: run.projectId,
          sourceId: run.sourceId,
          businessKey: run.businessKey,
          definitionName: definition.name,
          routineVersion: definition.version,
          status: run.status,
          revision: run.revision,
          waitingReason: visibleWaitingReason,
          ledgerQueuePosition: ledgerWait?.queuePosition ?? null,
          capacity: execution.run.capacity,
          progress: {
            completed: completedSteps,
            total: execution.steps.length,
          },
          currentStep: activeStep
            ? {
                key: activeStep.key,
                label: activeStep.label,
                kind: activeStep.kind,
                state: activeStep.run.state,
              }
            : null,
          nextAction,
          updatedAt: run.updatedAt,
        };
      })
      .filter(Boolean)
      .sort((left, right) =>
        (priority[left.status] ?? 9) - (priority[right.status] ?? 9)
        || (left.capacity.position ?? 0) - (right.capacity.position ?? 0)
        || right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, boundedLimit);
    return {
      status: 200,
      body: {
        items,
        summary: {
          total: items.length,
          running: items.filter((item) => item.status === "running").length,
          waiting: items.filter((item) => Boolean(item.waitingReason)).length,
          needsAction: items.filter((item) =>
            ["review_approval", "decide_condition", "retry_step", "review_ledger", "continue_step"]
              .includes(item.nextAction)).length,
        },
      },
    };
  }

  function materializeRoutineIssue({
    routineDefinitionId,
    businessCaseId,
    triggerArtifactIds,
  } = {}, actor = null) {
    if (typeof createWorkItem !== "function") {
      return { status: 503, body: { error: "routine_issue_materializer_unavailable" } };
    }
    const definition = state.routineDefinitions.find((row) =>
      row.id === routineDefinitionId && visible(row, actor));
    const businessCase = state.businessCases.find((row) =>
      row.id === businessCaseId && visible(row, actor));
    if (!definition || !businessCase
      || definition.projectId !== businessCase.projectId
      || definition.sourceId !== businessCase.sourceId) {
      return { status: 404, body: { error: "routine_issue_context_not_found" } };
    }
    const binding = normalizeLocalIssueRoutineBinding({
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessCaseId: businessCase.id,
      businessKey: businessCase.businessKey,
      triggerArtifactIds,
    });
    if (!binding.ok) return { status: 400, body: { error: binding.error } };
    const expectedKeys = routineIdempotencyKeys({
      ownerTeamId: actorTeam(actor),
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessKey: businessCase.businessKey,
      sourceFingerprints: binding.value.triggerArtifactIds
        .map((artifactId) => businessCase.artifactFingerprints?.[artifactId])
        .filter(Boolean),
    });
    const expectedFingerprints = binding.value.triggerArtifactIds
      .map((artifactId) => businessCase.artifactFingerprints?.[artifactId])
      .filter(Boolean)
      .sort();
    const legacyKeys = routineIdempotencyKeys({
      ownerTeamId: actorTeam(actor),
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessKey: businessCase.businessKey,
    });
    const existingRun = state.routineRuns.find((row) =>
      visible(row, actor)
      && row.sourceId === definition.sourceId
      && row.businessKey === businessCase.businessKey
      && (
        JSON.stringify(row.sourceFingerprints ?? []) === JSON.stringify(expectedFingerprints)
        || [expectedKeys.issue, legacyKeys.issue].includes(row.issueIdempotencyKey)
      ));
    const existingWorkItem = existingRun?.workItemId
      ? workItemFor(existingRun.workItemId, actor)
      : null;
    if (existingWorkItem && !existingWorkItem.parentId) {
      const existingDefinition = state.routineDefinitions.find((row) =>
        row.id === existingRun.routineDefinitionId
        && row.version === existingRun.routineVersion
        && visible(row, actor));
      if (!existingDefinition) {
        return { status: 409, body: { error: "routine_issue_pinned_definition_missing" } };
      }
      return {
        status: 200,
        body: {
          workItem: publicRoutineWorkItem(existingWorkItem),
          execution: routineExecutionView({
            workItem: existingWorkItem,
            definition: existingDefinition,
            run: existingRun,
          }),
          replayed: true,
        },
      };
    }
    if (definition.state !== "published") {
      return { status: 409, body: { error: "routine_definition_not_available_for_new_issues" } };
    }
    const triggers = binding.value.triggerArtifactIds.map((artifactId) => artifactFor(artifactId, actor));
    if (triggers.some((artifact) =>
      !artifact
      || artifact.projectId !== definition.projectId
      || artifact.sourceId !== definition.sourceId
      || artifact.availability === "missing"
      || artifact.exclusion
      || businessCase.artifactFingerprints?.[artifact.id] !== artifact.fingerprint)) {
      return {
        status: 409,
        body: {
          error: "routine_issue_trigger_evidence_not_current",
          recovery: "Re-analyze and reconfirm the source document before creating its task.",
        },
      };
    }
    const idempotencyKey = expectedKeys.issue;
    const source = sourceFor(definition.sourceId, actor, { active: true });
    const terminalId = state.devices?.[0]?.id ?? null;
    const inputAssets = terminalId ? triggers.map((artifact) => {
      const path = [source?.relativePath, artifact.relativePath].filter(Boolean).join("/");
      const capabilities = resolveAssetCapabilities(path);
      return {
        id: artifact.id,
        path,
        family: capabilities.family,
        terminalId,
        size: artifact.size ?? null,
        resourceClass: assetResourceClass(artifact.size),
        hash: artifact.fingerprint,
        version: artifact.fingerprint.slice(0, 16),
        worktreeId: null,
        capabilities: capabilities.capabilities,
        readiness: { state: "ready", reason: "available_on_owning_terminal" },
      };
    }) : [];
    const primaryTriggerType = definition.triggerDocumentTypes
      .map(normalizeRoutineTriggerType)
      .find((value) => value && value !== "unknown") ?? "unknown";
    const routineTypeLabel = ROUTINE_TYPE_LABELS[primaryTriggerType]
      ?? primaryTriggerType.replaceAll("_", " ");
    const created = createWorkItem({
      projectId: definition.projectId,
      title: `Process ${routineTypeLabel} — ${businessCase.businessKey}`,
      body: `${definition.description}\n\nThis task is pinned to ${definition.name} v${definition.version}.`,
      type: "task",
      status: "ready",
      priority: "p1",
      labels: [
        "routine-work",
        `workflow-${primaryTriggerType.replaceAll("_", "-")}`,
        ...(primaryTriggerType === "inquiry" ? ["commercial-inquiry"] : []),
      ],
      acceptanceCriteria: definition.steps.filter((step) => step.required).map((step) => step.label),
      idempotencyKey,
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessCaseId: businessCase.id,
      businessKey: businessCase.businessKey,
      triggerArtifactIds: binding.value.triggerArtifactIds,
      inputAssets,
      requiredCapabilities: inputAssets.length ? ["inspect"] : [],
    }, actor);
    if (!created?.ok) return { status: created?.status ?? 500, body: created?.body ?? { error: "routine_issue_create_failed" } };
    const runResult = createRoutineRun({
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessCaseId: businessCase.id,
      triggerArtifactIds: binding.value.triggerArtifactIds,
      workItemId: created.body.workItem.id,
    }, actor);
    if (runResult.status >= 400) return runResult;
    const context = {
      workItem: created.body.workItem,
      definition,
      run: runResult.body.routineRun,
    };
    return {
      status: created.status === 201 || runResult.status === 201 ? 201 : 200,
      body: {
        workItem: publicRoutineWorkItem(created.body.workItem),
        execution: routineExecutionView(context),
        replayed: created.body.replayed === true && runResult.body.replayed === true,
      },
    };
  }

  function validateRoutineAction(
    context,
    expectedRevision,
    idempotencyKey,
    action,
    stepKey = null,
    payloadHash = null,
  ) {
    const replay = receiptFor(context.run, idempotencyKey);
    if (replay) {
      if (replay.action !== action
        || replay.stepKey !== stepKey
        || (payloadHash && replay.payloadHash !== payloadHash)) {
        return { status: 409, body: { error: "routine_action_idempotency_conflict" } };
      }
      return {
        status: 200,
        body: { execution: routineExecutionView(context), replayed: true },
      };
    }
    if (!text(idempotencyKey, 200)) {
      return { status: 400, body: { error: "routine_action_idempotency_key_required" } };
    }
    if (expectedRevision !== context.run.revision) {
      return {
        status: 409,
        body: {
          error: "routine_run_revision_conflict",
          currentRevision: context.run.revision,
          recovery: "Refresh the task before trying the action again.",
        },
      };
    }
    return null;
  }

  function startRoutineWorkItem({
    workItemId,
    expectedRevision,
    idempotencyKey,
  } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const blocked = validateRoutineAction(context, expectedRevision, idempotencyKey, "start");
    if (blocked) return blocked;
    if (["succeeded", "cancelled"].includes(context.run.status)) {
      return { status: 409, body: { error: "routine_run_not_startable", currentState: context.run.status } };
    }
    if (context.run.stepRuns.some((row) => row.state === "failed")) {
      return {
        status: 409,
        body: { error: "routine_run_requires_step_retry", recovery: "Retry the failed step to continue." },
      };
    }
    if (!sourceFor(context.run.sourceId, actor, { active: true })) {
      return { status: 409, body: { error: "routine_run_source_revoked" } };
    }
    let startedStepKeys = [];
    let awakenedRuns = [];
    runTx(() => {
      const timestamp = now();
      startedStepKeys = scheduleRoutineRun(context.run, context.definition, timestamp);
      context.run.revision += 1;
      context.run.updatedAt = timestamp;
      context.run.updatedBy = actorUser(actor);
      recordReceipt(context.run, idempotencyKey, "start");
      event("routine_run_started", "Routine work started.", context.run, actor, {
        routineRunId: context.run.id,
        workItemId: context.workItem.id,
        startedStepKeys,
        waitingReason: context.run.waitingReason,
      });
      awakenedRuns = drainRoutineDeviceQueue(context.run, timestamp, actor);
    });
    return {
      status: 200,
      body: {
        execution: routineExecutionView(context),
        startedStepKeys,
        awakenedRuns,
        replayed: false,
      },
    };
  }

  function completeRoutineStep({
    workItemId,
    stepKey,
    expectedRevision,
    idempotencyKey,
    succeeded = true,
    errorCode = null,
    outputRefs = [],
    ledgerMutationId = null,
    executorId = null,
    quotationReview = null,
  } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const blocked = validateRoutineAction(context, expectedRevision, idempotencyKey, "complete", stepKey);
    if (blocked) return blocked;
    const step = context.definition.steps.find((row) => row.key === stepKey);
    const stepRun = context.run.stepRuns.find((row) => row.stepKey === stepKey);
    if (!step || !stepRun) return { status: 404, body: { error: "routine_step_not_found" } };
    if (EXECUTABLE_STEP_KINDS.has(step.kind) && executorId !== executorIdFor(step)) {
      return { status: 409, body: { error: "routine_step_requires_governed_executor" } };
    }
    if (step.kind === "ledger_upsert") {
      const mutation = state.ledgerMutationAudits.find((row) =>
        row.id === ledgerMutationId
        && row.ownerTeamId === context.run.ownerTeamId
        && row.routineRunId === context.run.id
        && row.routineStepKey === step.key);
      if (!mutation) {
        return { status: 409, body: { error: "ledger_step_requires_previewed_mutation" } };
      }
    }
    if (stepRun.state !== "running" || ["human_approval", "condition"].includes(step.kind)) {
      return { status: 409, body: { error: "routine_step_not_completable", currentState: stepRun.state } };
    }
    const normalizedOutputs = normalizeRoutineOutputRefs(outputRefs);
    if (!normalizedOutputs) return { status: 400, body: { error: "invalid_routine_step_outputs" } };
    if (normalizedOutputs.some((row) => {
      if (!row.artifactId) return false;
      const artifact = artifactFor(row.artifactId, actor);
      return !artifact
        || artifact.projectId !== context.run.projectId
        || artifact.sourceId !== context.run.sourceId
        || artifact.availability === "missing"
        || artifact.exclusion;
    })) {
      return { status: 404, body: { error: "routine_step_output_artifact_not_found" } };
    }
    let startedStepKeys = [];
    let awakenedRuns = [];
    runTx(() => {
      const timestamp = now();
      stepRun.state = succeeded === true ? "succeeded" : "failed";
      stepRun.completedAt = timestamp;
      stepRun.errorCode = succeeded === true ? null : text(errorCode, 200) ?? "routine_step_failed";
      stepRun.outputRefs = normalizedOutputs;
      if (quotationReview) stepRun.quotationReview = quotationReview;
      if (succeeded === true) startedStepKeys = scheduleRoutineRun(context.run, context.definition, timestamp);
      else recomputeRoutineRunStatus(context.run);
      context.run.revision += 1;
      context.run.updatedAt = timestamp;
      context.run.updatedBy = actorUser(actor);
      recordReceipt(context.run, idempotencyKey, "complete", stepKey);
      event(succeeded === true ? "routine_step_completed" : "routine_step_failed",
        succeeded === true ? "Routine step completed." : "Routine step failed.",
        context.run, actor, {
          routineRunId: context.run.id,
          workItemId: context.workItem.id,
          stepKey,
          outputCount: normalizedOutputs.length,
          errorCode: stepRun.errorCode,
          startedStepKeys,
      });
      awakenedRuns = drainRoutineDeviceQueue(context.run, timestamp, actor);
      const currentAwakening = awakenedRuns.find((row) => row.routineRunId === context.run.id);
      if (currentAwakening?.startedStepKeys.length) {
        startedStepKeys = [...new Set([...startedStepKeys, ...currentAwakening.startedStepKeys])];
      }
    });
    syncRoutineCompletion(context, actor);
    return {
      status: 200,
      body: {
        execution: routineExecutionView(context),
        startedStepKeys,
        awakenedRuns,
        replayed: false,
      },
    };
  }

  function executeRoutineStep({
    workItemId,
    stepKey,
    expectedRevision,
    idempotencyKey,
  } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const blocked = validateRoutineAction(
      context,
      expectedRevision,
      idempotencyKey,
      "complete",
      stepKey,
    );
    if (blocked) return blocked;
    const step = context.definition.steps.find((row) => row.key === stepKey);
    const stepRun = context.run.stepRuns.find((row) => row.stepKey === stepKey);
    if (!step || !stepRun) return { status: 404, body: { error: "routine_step_not_found" } };
    if (!AUTO_ADVANCE_EXECUTABLE_STEP_KINDS.has(step.kind)) {
      return { status: 409, body: { error: "routine_step_has_no_executor" } };
    }
    if (stepRun.state !== "running") {
      return {
        status: 409,
        body: { error: "routine_step_not_executable", currentState: stepRun.state },
      };
    }
    if (!ALLOWED_EXECUTOR_IDS[step.kind]?.has(executorIdFor(step))) {
      return { status: 409, body: { error: "routine_step_executor_not_allowed" } };
    }
    if (!sourceFor(context.run.sourceId, actor, { active: true })) {
      return { status: 409, body: { error: "routine_run_source_revoked" } };
    }

    let result;
    let childWorkItem = null;
    if (step.kind === "extract") {
      result = extractConfirmedRoutineFacts(context, actor);
    } else if (step.kind === "retrieve") {
      result = retrieveRoutineReferences(context, step, actor);
    } else if (step.kind === "generate") {
      result = executorIdFor(step) === LEARNED_TEMPLATE_OUTPUT_EXECUTOR_ID
        ? generateLearnedTemplateOutput(context, step, actor)
        : generateQuotationDraft(context, step, actor);
    } else {
      const created = ensureOrderChildIssue(context, confirmedOrderArtifacts(context, actor), actor);
      result = created.ok
        ? {
            ok: true,
            outputRefs: [{
              kind: "note",
              summary: `Created or reused order work ${created.workItem.localRef}.`,
            }],
          }
        : { ok: false, error: created.error, status: created.status };
      childWorkItem = created.ok ? created.workItem : null;
    }

    if (result.needsInput) {
      runTx(() => {
        const timestamp = now();
        stepRun.quotationReview = result.quotationReview;
        stepRun.errorCode = null;
        context.run.waitingReason = "routine_quotation_facts_required";
        context.run.revision += 1;
        context.run.updatedAt = timestamp;
        context.run.updatedBy = actorUser(actor);
        recordReceipt(context.run, idempotencyKey, "complete", stepKey);
        event("routine_quotation_input_requested",
          "Quotation generation is waiting for confirmed facts and a template.",
          context.run, actor, {
            routineRunId: context.run.id,
            workItemId: context.workItem.id,
            stepKey,
            missingFieldCount: result.quotationReview?.fields
              ?.filter((field) => field.state === "missing").length ?? 0,
            conflictFieldCount: result.quotationReview?.fields
              ?.filter((field) => field.state === "conflict").length ?? 0,
          });
      });
      return {
        status: 200,
        body: { execution: routineExecutionView(context), startedStepKeys: [], replayed: false },
      };
    }

    const completed = completeRoutineStep({
      workItemId,
      stepKey,
      expectedRevision,
      idempotencyKey,
      succeeded: result.ok,
      errorCode: result.ok ? null : result.error,
      outputRefs: result.outputRefs ?? [],
      executorId: executorIdFor(step),
      quotationReview: result.quotationReview,
    }, actor);
    if (completed.status >= 400) return completed;
    return {
      status: completed.status,
      body: {
        ...completed.body,
        ...(childWorkItem ? { childWorkItem: publicRoutineWorkItem(childWorkItem) } : {}),
      },
    };
  }

  function routineAssistance(context) {
    const runByKey = new Map(context.run.stepRuns.map((row) => [row.stepKey, row]));
    const activeStep = context.definition.steps.find((step) => {
      const state = runByKey.get(step.key)?.state;
      return ["running", "awaiting_approval", "awaiting_condition", "failed"].includes(state);
    }) ?? null;
    const stepRun = activeStep ? runByKey.get(activeStep.key) : null;
    const base = activeStep ? { stepKey: activeStep.key, stepLabel: activeStep.label } : {
      stepKey: null,
      stepLabel: null,
    };
    if (context.run.status === "succeeded") return null;
    if (context.run.status === "cancelled") {
      return { ...base, kind: "cancelled", reason: "routine_cancelled", action: "none" };
    }
    if (stepRun?.state === "failed" && String(stepRun.errorCode ?? "").startsWith("routine_extract_")) {
      return {
        ...base,
        kind: "needs_review",
        reason: stepRun.errorCode,
        action: "review_extracted_facts",
      };
    }
    if (stepRun?.state === "failed" || context.run.status === "failed") {
      return {
        ...base,
        kind: "failed",
        reason: stepRun?.errorCode ?? context.run.waitingReason ?? "routine_step_failed",
        action: "retry_step",
      };
    }
    if (context.run.waitingReason === "routine_quotation_facts_required") {
      return {
        ...base,
        kind: "needs_input",
        reason: context.run.waitingReason,
        action: "provide_input",
      };
    }
    if (stepRun?.state === "awaiting_approval") {
      return { ...base, kind: "awaiting_approval", reason: "human_approval_required", action: "review_approval" };
    }
    if (stepRun?.state === "awaiting_condition") {
      return { ...base, kind: "awaiting_condition", reason: "business_condition_required", action: "decide_condition" };
    }
    if (activeStep?.kind === "ledger_upsert") {
      return { ...base, kind: "ledger_write", reason: "ledger_review_required", action: "review_ledger" };
    }
    if (context.run.waitingReason === "device_capacity") {
      return { ...base, kind: "waiting", reason: "device_capacity", action: "wait" };
    }
    if (activeStep && !AUTO_ADVANCE_EXECUTABLE_STEP_KINDS.has(activeStep.kind)) {
      return { ...base, kind: "manual_step", reason: "routine_step_requires_user", action: "complete_step" };
    }
    if (context.run.waitingReason) {
      return { ...base, kind: "waiting", reason: context.run.waitingReason, action: "wait" };
    }
    return null;
  }

  /**
   * Continues only the fixed, local governed executors. The method deliberately
   * stops before approvals, business decisions, ledger mutations, unknown/manual
   * steps, missing quotation facts, failures, and capacity waits.
   */
  function advanceRoutineWorkItem({
    workItemId,
    maxSteps = AUTO_ADVANCE_STEP_LIMIT,
  } = {}, actor = null) {
    let context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const boundedLimit = Math.max(1, Math.min(AUTO_ADVANCE_STEP_LIMIT, Number(maxSteps) || AUTO_ADVANCE_STEP_LIMIT));
    const advancedStepKeys = [];

    if (context.run.status === "planned") {
      const started = startRoutineWorkItem({
        workItemId,
        expectedRevision: context.run.revision,
        idempotencyKey: `routine-auto:start:${context.run.id}`,
      }, actor);
      if (started.status >= 400) return started;
      context = routineExecutionContext(workItemId, actor);
    }

    for (let attempt = 0; attempt < boundedLimit; attempt += 1) {
      if (["succeeded", "cancelled", "failed"].includes(context.run.status)
        || context.run.waitingReason) break;
      const runByKey = new Map(context.run.stepRuns.map((row) => [row.stepKey, row]));
      const step = context.definition.steps.find((candidate) =>
        runByKey.get(candidate.key)?.state === "running");
      if (!step || !AUTO_ADVANCE_EXECUTABLE_STEP_KINDS.has(step.kind)) break;
      const stepRun = runByKey.get(step.key);
      const executed = executeRoutineStep({
        workItemId,
        stepKey: step.key,
        expectedRevision: context.run.revision,
        idempotencyKey: `routine-auto:step:${context.run.id}:${step.key}:${stepRun.attempts}:${context.run.revision}`,
      }, actor);
      if (executed.status >= 400) return executed;
      context = routineExecutionContext(workItemId, actor);
      if (context.run.stepRuns.find((row) => row.stepKey === step.key)?.state === "succeeded") {
        advancedStepKeys.push(step.key);
      }
    }

    const assistance = routineAssistance(context);
    return {
      status: 200,
      body: {
        execution: routineExecutionView(context),
        advancedStepKeys,
        assistance,
        completed: context.run.status === "succeeded",
      },
    };
  }

  function materializeAdaptiveRoutineSuggestion({
    projectId,
    sourceId,
    observationId,
    artifactId,
    documentType,
  } = {}, actor = null) {
    const selection = selectPublishedRoutineForTrigger({ projectId, sourceId, documentType }, actor);
    if (selection.status >= 400) return selection;
    const normalizedType = selection.body.documentType;
    const definition = selection.body.routineDefinition;
    const observation = state.workflowIntakeObservations?.find((row) =>
      row.id === observationId
      && row.artifactId === artifactId
      && row.projectId === projectId
      && row.sourceId === sourceId
      && visible(row, actor));
    const artifact = artifactFor(artifactId, actor);
    if (!observation || observation.state !== "ready" || !artifact
      || artifact.projectId !== projectId || artifact.sourceId !== sourceId
      || !/^[a-f0-9]{64}$/i.test(String(artifact.fingerprint ?? ""))
      || artifact.availability === "missing" || artifact.exclusion) {
      return {
        status: 409,
        body: {
          error: "workflow_intake_observation_not_ready",
          recovery: "请重新扫描并确认来源文件，确认完成后 AI 会继续创建任务。",
          assistance: {
            kind: "needs_review",
            reason: "workflow_intake_observation_not_ready",
            action: "review_source_file",
            title: "来源文件还不能安全处理",
            explanation: "文件可能仍在变化、已被排除，或尚未完成识别确认。",
            instruction: "请检查该文件并完成识别确认。",
            continuation: "确认后，AI 会重新匹配工作流程并继续。",
          },
        },
      };
    }
    const classification = [...state.businessDocumentClassifications]
      .reverse()
      .find((row) => row.artifactId === artifact.id
        && visible(row, actor)
        && row.projectId === projectId
        && row.sourceId === sourceId
        && ["confirmed", "corrected"].includes(row.confirmationState)
        && !(row.riskSignals ?? []).length
        && row.artifactFingerprint === artifact.fingerprint
        && normalizeRoutineTriggerType(row.documentType) === normalizedType);
    if (!classification) {
      return {
        status: 409,
        body: {
          error: "adaptive_work_classification_confirmation_required",
          recovery: "请先确认这份文件的工作类型，再重新运行。",
          assistance: {
            kind: "needs_review",
            reason: "adaptive_work_classification_confirmation_required",
            action: "confirm_document_type",
            title: "工作类型还需要确认",
            explanation: "AI 只会对已经人工确认、且文件内容未变化的类型自动执行。",
            instruction: "请确认文件类型，或修正为正确的工作类型。",
            continuation: "确认后，AI 会按唯一匹配的已发布流程创建任务。",
          },
        },
      };
    }
    const identityProposal = (classification.fieldProposals ?? []).find((field) =>
      ["confirmed", "corrected"].includes(field.confirmationState)
      && /(?:number|_id|period|title|name)$/i.test(field.key)
      && text(field.normalizedValue ?? field.value, 120));
    const identity = text(identityProposal?.normalizedValue ?? identityProposal?.value, 120)
      ?? String(artifact.fingerprint ?? artifact.id).slice(0, 24);
    const businessKey = `${normalizedType}:${identity}`.slice(0, 200);
    const evidenceRefs = [
      ...(classification.evidenceRefs ?? []),
      ...(classification.fieldProposals ?? []).flatMap((field) => field.evidenceRefs ?? []),
    ];
    const boundedEvidence = evidenceRefs.length
      ? evidenceRefs.slice(0, 100)
      : [{ artifactId: artifact.id, kind: "confirmed_document_type", field: null }];
    const fields = Object.fromEntries((classification.fieldProposals ?? [])
      .filter((field) => ["confirmed", "corrected"].includes(field.confirmationState)
        && SAFE_FIELD_RE.test(field.key)
        && !SENSITIVE_FIELD_RE.test(field.key)
        && ["string", "number", "boolean"].includes(typeof (field.normalizedValue ?? field.value)))
      .slice(0, 98)
      .map((field) => [field.key, field.normalizedValue ?? field.value]));
    fields.document_type = normalizedType;
    fields.source_file = String(artifact.relativePath ?? artifact.id).slice(0, 1_000);
    const entityResult = createBusinessEntity({
      projectId,
      sourceId,
      entityType: normalizedType,
      businessKey,
      fields,
      evidenceRefs: boundedEvidence,
      confidence: classification.confidence,
    }, actor);
    if (entityResult.status >= 400) return entityResult;
    const caseResult = createBusinessCase({
      projectId,
      sourceId,
      businessKey,
      state: "confirmed",
      entityIds: [entityResult.body.entity.id],
      artifactBindings: [{
        artifactId: artifact.id,
        documentType: normalizedType,
        roles: ["trigger", "input"],
      }],
      evidenceRefs: boundedEvidence,
      confidence: classification.confidence,
    }, actor);
    if (caseResult.status >= 400) return caseResult;
    const businessCase = caseResult.body.businessCase;
    const currentTrigger = businessCase.artifactBindings?.find((binding) =>
      binding.roles?.includes("trigger"));
    if (currentTrigger?.artifactId !== artifact.id
      || businessCase.artifactFingerprints?.[artifact.id] !== artifact.fingerprint) {
      return {
        status: 409,
        body: {
          error: "workflow_intake_business_identity_conflict",
          recovery: "请检查是否为同一项工作的重复文件，并确认应该使用哪个版本。",
          assistance: {
            kind: "needs_input",
            reason: "workflow_intake_business_identity_conflict",
            action: "review_business_identity",
            title: "发现同一工作编号的不同文件",
            explanation: "AI 无法判断新文件是重复件、更新版，还是另一项工作。",
            instruction: "请确认要采用的文件版本。",
            continuation: "确认后，AI 会使用选定版本继续，且不会重复创建任务。",
          },
        },
      };
    }
    const materialized = materializeRoutineIssue({
      routineDefinitionId: definition.id,
      businessCaseId: businessCase.id,
      triggerArtifactIds: [artifact.id],
    }, actor);
    if (materialized.status >= 400) return materialized;
    return {
      status: materialized.status,
      body: {
        ...materialized.body,
        routineDefinition: {
          id: definition.id,
          familyId: definition.familyId,
          name: definition.name,
          version: definition.version,
          triggerDocumentTypes: definition.triggerDocumentTypes,
        },
        businessCase,
        replayed: Boolean(materialized.body.replayed),
      },
    };
  }

  function confirmQuotationInputs({
    workItemId,
    stepKey,
    expectedRevision,
    idempotencyKey,
    templateArtifactId,
    answers,
    confirmed,
  } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const inputPayloadHash = hashKey([
      templateArtifactId,
      confirmed,
      JSON.stringify(
        answers && typeof answers === "object" && !Array.isArray(answers)
          ? Object.entries(answers).sort(([left], [right]) => left.localeCompare(right))
          : answers,
      ),
    ]);
    const blocked = validateRoutineAction(
      context,
      expectedRevision,
      idempotencyKey,
      "quotation_inputs",
      stepKey,
      inputPayloadHash,
    );
    if (blocked) return blocked;
    const step = context.definition.steps.find((row) => row.key === stepKey);
    const stepRun = context.run.stepRuns.find((row) => row.stepKey === stepKey);
    if (!step || !stepRun) return { status: 404, body: { error: "routine_step_not_found" } };
    if (step.kind !== "generate"
      || executorIdFor(step) !== CONFIRMED_TEMPLATE_QUOTATION_EXECUTOR_ID
      || stepRun.state !== "running") {
      return {
        status: 409,
        body: { error: "routine_quotation_inputs_not_accepted", currentState: stepRun.state },
      };
    }
    if (confirmed !== true) {
      return { status: 400, body: { error: "routine_quotation_input_confirmation_required" } };
    }
    const currentReview = buildQuotationReview(context, step, stepRun, actor);
    const selectedTemplate = currentReview?.templateOptions.find((option) =>
      option.artifactId === templateArtifactId && option.supported);
    const templateArtifact = selectedTemplate ? artifactFor(selectedTemplate.artifactId, actor) : null;
    if (!selectedTemplate || !templateArtifact) {
      return { status: 409, body: { error: "routine_quotation_template_not_confirmable" } };
    }
    const acceptedFields = new Set([
      ...quotationRequiredFields(step),
      ...(selectedTemplate.placeholderKeys ?? []),
    ]);
    if (!answers || typeof answers !== "object" || Array.isArray(answers)
      || Object.keys(answers).length > acceptedFields.size) {
      return { status: 400, body: { error: "routine_quotation_answers_invalid" } };
    }
    const normalizedAnswers = {};
    for (const [key, value] of Object.entries(answers)) {
      const normalizedValue = text(value, 1_000);
      if (!acceptedFields.has(key)
        || !SAFE_FIELD_RE.test(key)
        || SENSITIVE_FIELD_RE.test(key)
        || !normalizedValue
        || /[\0]/.test(normalizedValue)
        || /^[=+@]/.test(normalizedValue)) {
        return { status: 400, body: { error: "routine_quotation_answers_invalid" } };
      }
      normalizedAnswers[key] = {
        value: normalizedValue,
        confirmedAt: now(),
        confirmedBy: actorUser(actor),
      };
    }
    runTx(() => {
      const timestamp = now();
      stepRun.quotationInputs = {
        answers: {
          ...(stepRun.quotationInputs?.answers ?? {}),
          ...normalizedAnswers,
        },
        templateArtifactId: templateArtifact.id,
        templateFingerprint: templateArtifact.fingerprint,
        templateConfirmedAt: timestamp,
        templateConfirmedBy: actorUser(actor),
        draftRevision: Math.max(1, Number(stepRun.quotationInputs?.draftRevision) || 1),
      };
      stepRun.quotationReview = buildQuotationReview(context, step, stepRun, actor);
      context.run.waitingReason = stepRun.quotationReview?.status === "ready"
        ? null
        : "routine_quotation_facts_required";
      context.run.revision += 1;
      context.run.updatedAt = timestamp;
      context.run.updatedBy = actorUser(actor);
      recordReceipt(
        context.run,
        idempotencyKey,
        "quotation_inputs",
        stepKey,
        inputPayloadHash,
      );
      event("routine_quotation_inputs_confirmed",
        "Quotation facts and template selection were confirmed.",
        context.run, actor, {
          routineRunId: context.run.id,
          workItemId: context.workItem.id,
          stepKey,
          answerCount: Object.keys(normalizedAnswers).length,
          templateArtifactId: templateArtifact.id,
          ready: stepRun.quotationReview?.status === "ready",
        });
    });
    return {
      status: 200,
      body: { execution: routineExecutionView(context), replayed: false },
    };
  }

  function bindRoutineLedger({
    workItemId,
    stepKey,
    ledgerDefinitionId,
    expectedRevision,
    idempotencyKey,
  } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const normalizedLedgerId = text(ledgerDefinitionId);
    const blocked = validateRoutineAction(
      context,
      expectedRevision,
      idempotencyKey,
      "bind_ledger",
      stepKey,
      normalizedLedgerId,
    );
    if (blocked) return blocked;
    const step = context.definition.steps.find((row) => row.key === stepKey);
    const stepRun = context.run.stepRuns.find((row) => row.stepKey === stepKey);
    if (!step || !stepRun) return { status: 404, body: { error: "routine_step_not_found" } };
    if (step.kind !== "ledger_upsert" || stepRun.state !== "running") {
      return {
        status: 409,
        body: { error: "routine_ledger_binding_not_allowed", currentState: stepRun.state },
      };
    }
    const configuredLedgerId = text(step.configuration?.ledgerDefinitionId);
    if (configuredLedgerId && configuredLedgerId !== normalizedLedgerId) {
      return { status: 409, body: { error: "routine_ledger_definition_mismatch" } };
    }
    const ledgerDefinition = state.ledgerDefinitions.find((row) =>
      row.id === normalizedLedgerId
      && visible(row, actor)
      && row.projectId === context.run.projectId
      && row.sourceId === context.run.sourceId);
    if (!ledgerDefinition) {
      return { status: 404, body: { error: "routine_ledger_definition_not_found" } };
    }
    if (ledgerDefinition.state !== "active") {
      return { status: 409, body: { error: "routine_ledger_definition_not_active" } };
    }
    runTx(() => {
      const timestamp = now();
      stepRun.ledgerDefinitionId = ledgerDefinition.id;
      context.run.revision += 1;
      context.run.updatedAt = timestamp;
      context.run.updatedBy = actorUser(actor);
      recordReceipt(
        context.run,
        idempotencyKey,
        "bind_ledger",
        stepKey,
        ledgerDefinition.id,
      );
      event("routine_ledger_bound", "Ledger selected for this routine work item.", context.run, actor, {
        routineRunId: context.run.id,
        workItemId: context.workItem.id,
        stepKey,
        ledgerDefinitionId: ledgerDefinition.id,
      });
    });
    return {
      status: 200,
      body: {
        execution: routineExecutionView(context),
        ledgerDefinition: {
          id: ledgerDefinition.id,
          name: ledgerDefinition.name,
          format: ledgerDefinition.format,
          relativePath: ledgerDefinition.relativePath,
          sheet: ledgerDefinition.sheet,
        },
        replayed: false,
      },
    };
  }

  function requestRoutineStepReview({
    workItemId,
    stepKey,
    expectedRevision,
    idempotencyKey,
  } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const blocked = validateRoutineAction(
      context,
      expectedRevision,
      idempotencyKey,
      "request_source_review",
      stepKey,
    );
    if (blocked) return blocked;
    const step = context.definition.steps.find((row) => row.key === stepKey);
    const stepRun = context.run.stepRuns.find((row) => row.stepKey === stepKey);
    if (!step || !stepRun) return { status: 404, body: { error: "routine_step_not_found" } };
    if (step.kind !== "extract"
      || stepRun.state !== "failed"
      || !String(stepRun.errorCode ?? "").startsWith("routine_extract_")) {
      return {
        status: 409,
        body: { error: "routine_source_review_not_required", currentState: stepRun.state },
      };
    }
    runTx(() => {
      const timestamp = now();
      context.run.recoveryIntent = {
        kind: "retry_after_source_review",
        stepKey,
        requestedAt: timestamp,
        requestedBy: actorUser(actor),
      };
      context.run.revision += 1;
      context.run.updatedAt = timestamp;
      context.run.updatedBy = actorUser(actor);
      recordReceipt(context.run, idempotencyKey, "request_source_review", stepKey);
      event("routine_source_review_requested",
        "Source review requested before retrying routine extraction.", context.run, actor, {
          routineRunId: context.run.id,
          workItemId: context.workItem.id,
          stepKey,
        });
    });
    return {
      status: 200,
      body: { execution: routineExecutionView(context), replayed: false },
    };
  }

  function resumeRoutineRecovery({
    workItemId,
    expectedRevision,
    idempotencyKey,
  } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const intent = context.run.recoveryIntent;
    if (!intent) {
      return {
        status: 200,
        body: { execution: routineExecutionView(context), resumed: false, awaitingReview: false },
      };
    }
    if (expectedRevision !== context.run.revision) {
      return {
        status: 409,
        body: { error: "routine_run_revision_conflict", currentRevision: context.run.revision },
      };
    }
    const stepRun = context.run.stepRuns.find((row) => row.stepKey === intent.stepKey);
    if (!stepRun || stepRun.state !== "failed"
      || !String(stepRun.errorCode ?? "").startsWith("routine_extract_")) {
      runTx(() => {
        context.run.recoveryIntent = null;
        context.run.revision += 1;
        context.run.updatedAt = now();
        context.run.updatedBy = actorUser(actor);
      });
      return {
        status: 200,
        body: { execution: routineExecutionView(context), resumed: false, awaitingReview: false },
      };
    }
    const confirmedFacts = extractConfirmedRoutineFacts(context, actor);
    if (!confirmedFacts.ok) {
      return {
        status: 202,
        body: {
          execution: routineExecutionView(context),
          resumed: false,
          awaitingReview: true,
          reason: confirmedFacts.error,
        },
      };
    }
    const retried = retryRoutineStep({
      workItemId,
      stepKey: intent.stepKey,
      expectedRevision: context.run.revision,
      idempotencyKey,
    }, actor);
    if (retried.status >= 400) return retried;
    return {
      ...retried,
      body: { ...retried.body, resumed: true, awaitingReview: false },
    };
  }

  function retryRoutineStep({
    workItemId,
    stepKey,
    expectedRevision,
    idempotencyKey,
  } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const blocked = validateRoutineAction(context, expectedRevision, idempotencyKey, "retry", stepKey);
    if (blocked) return blocked;
    const stepRun = context.run.stepRuns.find((row) => row.stepKey === stepKey);
    if (!stepRun) return { status: 404, body: { error: "routine_step_not_found" } };
    if (stepRun.state !== "failed") {
      return { status: 409, body: { error: "routine_step_not_retryable", currentState: stepRun.state } };
    }
    const previousErrorCode = stepRun.errorCode;
    let startedStepKeys = [];
    let awakenedRuns = [];
    runTx(() => {
      const timestamp = now();
      stepRun.state = "pending";
      stepRun.completedAt = null;
      stepRun.errorCode = null;
      if (context.run.recoveryIntent?.stepKey === stepKey) context.run.recoveryIntent = null;
      context.run.waitingReason = null;
      startedStepKeys = scheduleRoutineRun(context.run, context.definition, timestamp);
      context.run.revision += 1;
      context.run.updatedAt = timestamp;
      context.run.updatedBy = actorUser(actor);
      recordReceipt(context.run, idempotencyKey, "retry", stepKey);
      context.run.recoveryReceipts.push({
        kind: "step_retry",
        stepKey,
        previousErrorCode,
        retriedAt: timestamp,
      });
      context.run.recoveryReceipts = context.run.recoveryReceipts.slice(-50);
      event("routine_step_retried", "Routine step retried.", context.run, actor, {
        routineRunId: context.run.id,
        workItemId: context.workItem.id,
        stepKey,
        attempt: stepRun.attempts,
        previousErrorCode,
      });
      awakenedRuns = drainRoutineDeviceQueue(context.run, timestamp, actor);
      const currentAwakening = awakenedRuns.find((row) => row.routineRunId === context.run.id);
      if (currentAwakening?.startedStepKeys.length) {
        startedStepKeys = [...new Set([...startedStepKeys, ...currentAwakening.startedStepKeys])];
      }
    });
    return {
      status: 200,
      body: {
        execution: routineExecutionView(context),
        startedStepKeys,
        awakenedRuns,
        replayed: false,
      },
    };
  }

  function decideRoutineApproval({
    workItemId,
    stepKey,
    expectedRevision,
    idempotencyKey,
    approved,
  } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const blocked = validateRoutineAction(context, expectedRevision, idempotencyKey, "approval", stepKey);
    if (blocked) return blocked;
    const step = context.definition.steps.find((row) => row.key === stepKey);
    const stepRun = context.run.stepRuns.find((row) => row.stepKey === stepKey);
    if (!step || !stepRun) return { status: 404, body: { error: "routine_step_not_found" } };
    if (step.kind !== "human_approval" || stepRun.state !== "awaiting_approval" || typeof approved !== "boolean") {
      return { status: 409, body: { error: "routine_approval_not_decidable", currentState: stepRun.state } };
    }
    let startedStepKeys = [];
    let awakenedRuns = [];
    runTx(() => {
      const timestamp = now();
      stepRun.state = approved ? "succeeded" : "failed";
      stepRun.completedAt = timestamp;
      stepRun.errorCode = approved ? null : "routine_approval_rejected";
      stepRun.approval = {
        state: approved ? "approved" : "rejected",
        decidedAt: timestamp,
        decidedBy: actorUser(actor),
      };
      if (approved) startedStepKeys = scheduleRoutineRun(context.run, context.definition, timestamp);
      else recomputeRoutineRunStatus(context.run);
      context.run.revision += 1;
      context.run.updatedAt = timestamp;
      context.run.updatedBy = actorUser(actor);
      recordReceipt(context.run, idempotencyKey, "approval", stepKey);
      event(approved ? "routine_step_approved" : "routine_step_rejected",
        approved ? "Routine step approved." : "Routine step rejected.",
        context.run, actor, {
          routineRunId: context.run.id,
          workItemId: context.workItem.id,
          stepKey,
          startedStepKeys,
      });
      awakenedRuns = drainRoutineDeviceQueue(context.run, timestamp, actor);
      const currentAwakening = awakenedRuns.find((row) => row.routineRunId === context.run.id);
      if (currentAwakening?.startedStepKeys.length) {
        startedStepKeys = [...new Set([...startedStepKeys, ...currentAwakening.startedStepKeys])];
      }
    });
    syncRoutineCompletion(context, actor);
    return {
      status: 200,
      body: {
        execution: routineExecutionView(context),
        startedStepKeys,
        awakenedRuns,
        replayed: false,
      },
    };
  }

  function descendantsOf(definition, rootKey) {
    const descendants = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      for (const step of definition.steps) {
        if (!descendants.has(step.key)
          && step.dependsOn.some((key) => key === rootKey || descendants.has(key))) {
          descendants.add(step.key);
          changed = true;
        }
      }
    }
    return descendants;
  }

  function decideRoutineCondition({
    workItemId,
    stepKey,
    expectedRevision,
    idempotencyKey,
    outcome,
    triggerArtifactIds = [],
  } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const blocked = validateRoutineAction(context, expectedRevision, idempotencyKey, "condition", stepKey);
    if (blocked) return blocked;
    const step = context.definition.steps.find((row) => row.key === stepKey);
    const stepRun = context.run.stepRuns.find((row) => row.stepKey === stepKey);
    if (!step || !stepRun) return { status: 404, body: { error: "routine_step_not_found" } };
    if (step.kind !== "condition" || stepRun.state !== "awaiting_condition" || typeof outcome !== "boolean") {
      return { status: 409, body: { error: "routine_condition_not_decidable", currentState: stepRun.state } };
    }
    const isOrderCondition = /order/i.test(`${step.key} ${step.label} ${step.configuration?.condition ?? ""}`);
    let orderArtifacts = [];
    let childWorkItem = null;
    if (outcome && isOrderCondition) {
      const ids = stringList(triggerArtifactIds, { maxItems: 20 });
      orderArtifacts = ids?.map((artifactId) => artifactFor(artifactId, actor)) ?? [];
      const valid = ids?.length && orderArtifacts.length === ids.length && orderArtifacts.every((artifact) => {
        const classification = state.businessDocumentClassifications.find((row) =>
          row.artifactId === artifact.id
          && visible(row, actor)
          && row.projectId === context.run.projectId
          && row.sourceId === context.run.sourceId
          && row.documentType === "order"
          && ["confirmed", "corrected"].includes(row.confirmationState)
          && row.artifactFingerprint === artifact.fingerprint);
        return artifact.availability !== "missing" && !artifact.exclusion && Boolean(classification);
      });
      if (!valid) {
        return {
          status: 409,
          body: {
            error: "confirmed_order_trigger_required",
            recovery: "Confirm a current order document before continuing.",
          },
        };
      }
      const businessCase = state.businessCases.find((row) =>
        row.id === context.run.businessCaseId && visible(row, actor));
      const timestamp = now();
      runTx(() => {
        for (const artifact of orderArtifacts) {
          if (!businessCase.artifactBindings.some((binding) => binding.artifactId === artifact.id)) {
            businessCase.artifactBindings.push({
              artifactId: artifact.id,
              documentType: "order",
              roles: ["trigger", "input"],
            });
          }
          businessCase.artifactFingerprints[artifact.id] = artifact.fingerprint;
        }
        businessCase.state = "active";
        businessCase.revision += 1;
        businessCase.updatedAt = timestamp;
        businessCase.updatedBy = actorUser(actor);
      });
      const created = ensureOrderChildIssue(context, orderArtifacts, actor);
      if (!created.ok) {
        return { status: created.status, body: { error: created.error } };
      }
      childWorkItem = created.workItem;
    }
    let startedStepKeys = [];
    let awakenedRuns = [];
    runTx(() => {
      const timestamp = now();
      stepRun.state = "succeeded";
      stepRun.conditionOutcome = outcome;
      stepRun.completedAt = timestamp;
      stepRun.errorCode = null;
      if (!outcome) {
        const descendants = descendantsOf(context.definition, stepKey);
        for (const candidate of context.run.stepRuns) {
          if (descendants.has(candidate.stepKey) && candidate.state === "pending") {
            candidate.state = "skipped";
            candidate.completedAt = timestamp;
          }
        }
      }
      startedStepKeys = scheduleRoutineRun(context.run, context.definition, timestamp);
      context.run.revision += 1;
      context.run.updatedAt = timestamp;
      context.run.updatedBy = actorUser(actor);
      recordReceipt(context.run, idempotencyKey, "condition", stepKey);
      event("routine_condition_decided", "Routine condition decided.", context.run, actor, {
        routineRunId: context.run.id,
        workItemId: context.workItem.id,
        stepKey,
        outcome,
        orderArtifactIds: orderArtifacts.map((artifact) => artifact.id),
        childWorkItemId: childWorkItem?.id ?? null,
      });
      awakenedRuns = drainRoutineDeviceQueue(context.run, timestamp, actor);
      const currentAwakening = awakenedRuns.find((row) => row.routineRunId === context.run.id);
      if (currentAwakening?.startedStepKeys.length) {
        startedStepKeys = [...new Set([...startedStepKeys, ...currentAwakening.startedStepKeys])];
      }
    });
    syncRoutineCompletion(context, actor);
    return {
      status: 200,
      body: {
        execution: routineExecutionView(context),
        childWorkItem: childWorkItem ? publicRoutineWorkItem(childWorkItem) : null,
        startedStepKeys,
        awakenedRuns,
        replayed: false,
      },
    };
  }

  function cancelRoutineWorkItem({
    workItemId,
    expectedRevision,
    idempotencyKey,
  } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const blocked = validateRoutineAction(context, expectedRevision, idempotencyKey, "cancel");
    if (blocked) return blocked;
    if (["succeeded", "cancelled"].includes(context.run.status)) {
      return { status: 409, body: { error: "routine_run_not_cancellable", currentState: context.run.status } };
    }
    let awakenedRuns = [];
    runTx(() => {
      const timestamp = now();
      context.run.cancellationRequestedAt = timestamp;
      for (const stepRun of context.run.stepRuns) {
        if (["pending", "running", "awaiting_approval", "awaiting_condition"].includes(stepRun.state)) {
          stepRun.state = "cancelled";
          stepRun.completedAt = timestamp;
          stepRun.errorCode = null;
        }
      }
      clearRoutineCapacityWait(context.run);
      recomputeRoutineRunStatus(context.run);
      context.run.revision += 1;
      context.run.updatedAt = timestamp;
      context.run.updatedBy = actorUser(actor);
      recordReceipt(context.run, idempotencyKey, "cancel");
      event("routine_run_cancelled", "Routine work cancelled.", context.run, actor, {
        routineRunId: context.run.id,
        workItemId: context.workItem.id,
      });
      awakenedRuns = drainRoutineDeviceQueue(context.run, timestamp, actor);
    });
    releaseRoutineLedgerReservations({ routineRunId: context.run.id }, actor);
    return {
      status: 200,
      body: { execution: routineExecutionView(context), awakenedRuns, replayed: false },
    };
  }

  function transitionRoutineStep({
    routineRunId,
    stepKey,
    expectedRevision,
    action,
    errorCode = null,
  } = {}, actor = null) {
    const run = state.routineRuns.find((row) => row.id === routineRunId && visible(row, actor));
    if (!run) return { status: 404, body: { error: "routine_run_not_found" } };
    if (expectedRevision !== run.revision) {
      return { status: 409, body: { error: "routine_run_revision_conflict", currentRevision: run.revision } };
    }
    const stepRun = run.stepRuns.find((row) => row.stepKey === stepKey);
    const definition = state.routineDefinitions.find((row) =>
      row.id === run.routineDefinitionId && row.version === run.routineVersion && visible(row, actor));
    const step = definition?.steps.find((row) => row.key === stepKey);
    if (!stepRun || !step) return { status: 404, body: { error: "routine_step_not_found" } };
    if (action === "succeed" && step.kind === "human_approval") {
      return { status: 409, body: { error: "human_approval_step_cannot_bypass_approval" } };
    }
    if (action === "succeed" && step.kind === "condition") {
      return { status: 409, body: { error: "condition_step_cannot_bypass_decision" } };
    }
    const nextState = STEP_TRANSITIONS[stepRun.state]?.[action] ?? null;
    if (!nextState) {
      return { status: 409, body: { error: "invalid_routine_step_transition", currentState: stepRun.state } };
    }
    if (action === "await_approval" && step.kind !== "human_approval") {
      return { status: 409, body: { error: "routine_step_does_not_require_approval" } };
    }
    if (action === "start") {
      const unmet = step.dependsOn.filter((dependency) => {
        const dependencyRun = run.stepRuns.find((row) => row.stepKey === dependency);
        return !["succeeded", "skipped"].includes(dependencyRun?.state);
      });
      if (unmet.length) return { status: 409, body: { error: "routine_step_dependencies_incomplete", unmet } };
      if (!sourceFor(run.sourceId, actor, { active: true })) {
        return { status: 409, body: { error: "routine_run_source_revoked" } };
      }
      const earlierWaiter = waitingRoutineRunsOnDevice(run)
        .some((candidate) => candidate.id !== run.id);
      if (DEVICE_CAPACITY_STEP_KINDS.has(step.kind)
        && (activeRoutineStepsOnDevice(run) >= routineDeviceLimit(run) || earlierWaiter)) {
        const timestamp = now();
        let awakenedRuns = [];
        runTx(() => {
          markRoutineWaitingForCapacity(run, timestamp);
          recomputeRoutineRunStatus(run);
          run.revision += 1;
          run.updatedAt = timestamp;
          run.updatedBy = actorUser(actor);
          event("routine_step_waiting_for_capacity",
            "Business routine step is waiting for local device capacity.",
            run, actor, {
              routineRunId: run.id,
              stepKey,
              deviceLimit: routineDeviceLimit(run),
            });
          awakenedRuns = drainRoutineDeviceQueue(run, timestamp, actor);
        });
        return {
          status: 202,
          body: { routineRun: run, stepRun, awakenedRuns },
        };
      }
    }
    if (action === "skip" && step.required) {
      return { status: 409, body: { error: "required_routine_step_cannot_skip" } };
    }
    const timestamp = now();
    let awakenedRuns = [];
    runTx(() => {
      stepRun.state = nextState;
      if (nextState === "running" && !stepRun.startedAt) stepRun.startedAt = timestamp;
      if (["succeeded", "skipped", "failed", "cancelled"].includes(nextState)) stepRun.completedAt = timestamp;
      stepRun.errorCode = nextState === "failed" ? text(errorCode, 200) ?? "routine_step_failed" : null;
      recomputeRoutineRunStatus(run);
      run.revision += 1;
      run.updatedAt = timestamp;
      run.updatedBy = actorUser(actor);
      event("routine_step_transitioned", "Business routine step transitioned.", run, actor, {
        routineRunId: run.id,
        stepKey,
        action,
        state: nextState,
        revision: run.revision,
      });
      if (["succeeded", "skipped", "failed", "cancelled"].includes(nextState)) {
        awakenedRuns = drainRoutineDeviceQueue(run, timestamp, actor);
      }
    });
    return { status: 200, body: { routineRun: run, stepRun, awakenedRuns } };
  }

  function validateRoutineLedgerStep({
    routineRunId,
    stepKey,
    ledgerDefinitionId,
    businessKey,
    expectedRunRevision = null,
  } = {}, actor = null) {
    const run = state.routineRuns.find((row) => row.id === routineRunId && visible(row, actor));
    const definition = run
      ? state.routineDefinitions.find((row) =>
        row.id === run.routineDefinitionId
        && row.version === run.routineVersion
        && visible(row, actor))
      : null;
    const step = definition?.steps.find((row) => row.key === stepKey);
    const stepRun = run?.stepRuns.find((row) => row.stepKey === stepKey);
    if (!run || !definition || !step || !stepRun) {
      return { ok: false, status: 404, error: "routine_ledger_step_not_found" };
    }
    if (expectedRunRevision != null && expectedRunRevision !== run.revision) {
      return { ok: false, status: 409, error: "routine_ledger_step_changed_since_preview" };
    }
    if (step.kind !== "ledger_upsert" || stepRun.state !== "running") {
      return { ok: false, status: 409, error: "routine_ledger_step_not_writable" };
    }
    const configuredLedgerDefinitionId = step.configuration?.ledgerDefinitionId
      ?? stepRun.ledgerDefinitionId
      ?? null;
    if (configuredLedgerDefinitionId && configuredLedgerDefinitionId !== ledgerDefinitionId) {
      return { ok: false, status: 409, error: "routine_ledger_definition_mismatch" };
    }
    return {
      ok: true,
      routineRunRevision: run.revision,
      routineVersion: run.routineVersion,
      businessCaseId: run.businessCaseId,
      businessKey: run.businessKey,
      triggerArtifactIds: [...run.triggerArtifactIds],
    };
  }

  function completeRoutineLedgerStep({
    routineRunId,
    stepKey,
    ledgerDefinitionId,
    mutation,
    expectedRunRevision,
  } = {}, actor = null) {
    const checked = validateRoutineLedgerStep({
      routineRunId,
      stepKey,
      ledgerDefinitionId,
      businessKey: mutation?.businessKey,
      expectedRunRevision,
    }, actor);
    if (!checked.ok) {
      const run = state.routineRuns.find((row) => row.id === routineRunId && visible(row, actor));
      const stepRun = run?.stepRuns.find((row) => row.stepKey === stepKey);
      if (stepRun?.outputRefs?.some((output) =>
        output.kind === "note" && output.summary === `Ledger mutation ${mutation?.id} committed.`)) {
        return { ok: true, replayed: true };
      }
      return checked;
    }
    const run = state.routineRuns.find((row) => row.id === routineRunId && visible(row, actor));
    const ledgerDefinition = state.ledgerDefinitions.find((row) =>
      row.id === ledgerDefinitionId && visible(row, actor));
    const completed = completeRoutineStep({
      workItemId: run.workItemId,
      stepKey,
      expectedRevision: run.revision,
      idempotencyKey: `ledger-mutation:${mutation.id}`,
      succeeded: true,
      ledgerMutationId: mutation.id,
      outputRefs: [
        {
          kind: "file",
          relativePath: ledgerDefinition.relativePath,
          summary: `${mutation.action === "no_op" ? "Verified" : "Updated"} ${ledgerDefinition.name}.`,
        },
        {
          kind: "note",
          summary: `Ledger mutation ${mutation.id} committed.`,
        },
      ],
    }, actor);
    return completed.status < 400
      ? { ok: true, execution: completed.body.execution, replayed: completed.body.replayed }
      : { ok: false, status: completed.status, error: completed.body.error };
  }

  const recoverableCapacityRuns = state.routineRuns.filter((run) =>
    run.waitingReason === "device_capacity"
    && run.capacityQueue?.state === "waiting"
    && !run.cancellationRequestedAt
    && !["succeeded", "cancelled", "failed"].includes(run.status));
  if (recoverableCapacityRuns.length) {
    runTx(() => {
      const timestamp = now();
      const recoveredDevices = new Set();
      for (const run of recoverableCapacityRuns) {
        const deviceKey = routineDeviceKey(run);
        if (recoveredDevices.has(deviceKey)) continue;
        recoveredDevices.add(deviceKey);
        drainRoutineDeviceQueue(run, timestamp);
      }
    });
  }

  return {
    recordDocumentClassification,
    createBusinessEntity,
    createBusinessCase,
    createRoutineDefinition,
    createRoutineDraftFromDiscovery,
    listRoutineDefinitions,
    listTaskTemplates,
    selectPublishedRoutineForTrigger,
    updateRoutineDefinition,
    createRoutineDefinitionVersion,
    publishRoutineDefinition,
    transitionRoutineDefinition,
    createLedgerDefinition,
    materializeRoutineIssue,
    materializeAdaptiveRoutineSuggestion,
    createRoutineRun,
    getRoutineWorkItemExecution,
    listRoutineWorkQueue,
    startRoutineWorkItem,
    advanceRoutineWorkItem,
    executeRoutineStep,
    confirmQuotationInputs,
    bindRoutineLedger,
    requestRoutineStepReview,
    resumeRoutineRecovery,
    completeRoutineStep,
    retryRoutineStep,
    decideRoutineApproval,
    decideRoutineCondition,
    cancelRoutineWorkItem,
    transitionRoutineStep,
    validateRoutineLedgerStep,
    completeRoutineLedgerStep,
  };
}
