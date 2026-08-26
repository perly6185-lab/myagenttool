import { normalizeTaskTemplateContractV2 } from "@myagenttool/protocol/task-resources";

const ROUTINE_METHOD_KINDS = new Set(["extract", "retrieve", "generate"]);
const TEMPLATE_STATE = {
  candidate: "draft",
  draft: "draft",
  published: "published",
  disabled: "paused",
  superseded: "superseded",
};

function text(value, max = 300) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, max) : null;
}

function unique(values, max = 50) {
  return [...new Set(values.map((value) => text(value, 120)).filter(Boolean))].slice(0, max);
}

function taskKindFor(definition) {
  const explicit = text(definition.taskKind, 120);
  if (explicit) return explicit.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const trigger = text(definition.triggerDocumentTypes?.[0], 80) ?? "other_reference";
  return `business_${trigger.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
}

function inputSlotsFor(definition, templateContract) {
  const requirements = Array.isArray(definition.dataRequirements)
    ? definition.dataRequirements.slice(0, 50)
    : [];
  if (!requirements.length && templateContract?.inputSummary) {
    return [{
      key: "inputs",
      label: text(templateContract.inputSummary, 300) ?? "任务资料",
      sourceKinds: ["artifact"],
      recordTypes: [],
      artifactKinds: unique(templateContract.inputFormats ?? []),
      required: true,
      cardinality: "one",
      freshness: "execution_snapshot",
      purpose: "required",
    }];
  }
  return requirements.map((requirement, index) => {
    const kind = text(requirement?.kind, 100);
    const isFile = kind === "file";
    const recordTypes = unique(requirement?.recordTypes ?? (isFile ? [] : [kind]));
    const artifactKinds = unique(requirement?.artifactKinds ?? (isFile ? templateContract?.inputFormats ?? [] : []));
    return {
      key: text(requirement?.id, 100) ?? `input_${index + 1}`,
      label: text(requirement?.label ?? requirement?.name ?? kind, 300) ?? `任务资料 ${index + 1}`,
      sourceKinds: isFile ? ["artifact"] : ["ledger_record"],
      recordTypes,
      artifactKinds,
      required: requirement?.required !== false,
      cardinality: requirement?.multiple === true ? "many" : "one",
      freshness: requirement?.freshness ?? "either",
      purpose: requirement?.required === false ? "reference" : "required",
    };
  });
}

function ledgerRoutingFor(definition) {
  const requirements = Array.isArray(definition.dataRequirements) ? definition.dataRequirements : [];
  const targets = new Set(definition.mutationPolicy?.targetRequirementIds ?? []);
  const targetTypes = requirements
    .filter((requirement) => targets.has(requirement?.id) && requirement?.kind && requirement.kind !== "file")
    .map((requirement) => requirement.kind);
  const primaryRecordType = targetTypes[0] ?? null;
  return {
    primaryRecordType,
    relatedRecordTypes: unique(targetTypes.slice(1)),
  };
}

/**
 * Project the existing routine storage shape into the single-task contract.
 * This is intentionally read-only: it does not make a routine executable or
 * expose connector details. Unsupported multi-task routines fail closed.
 */
export function projectRoutineDefinitionToTaskTemplate(definition) {
  if (!definition || typeof definition !== "object") {
    return { ok: false, error: "invalid_task_template_source" };
  }
  const steps = Array.isArray(definition.steps) ? definition.steps : [];
  if (steps.some((step) => step?.kind === "create_issue")) {
    return { ok: false, error: "task_template_contains_create_issue" };
  }
  const generateSteps = steps.filter((step) => step?.kind === "generate");
  if (generateSteps.length > 1) {
    return { ok: false, error: "task_template_multiple_outputs" };
  }
  const unsupported = steps.find((step) => ![
    ...ROUTINE_METHOD_KINDS,
    "ledger_upsert",
    "human_approval",
    "condition",
  ].includes(step?.kind));
  if (unsupported) return { ok: false, error: "task_template_unsupported_method" };

  const generate = generateSteps[0] ?? null;
  const templateContract = definition.templateContract
    ?? generate?.configuration?.templateContract
    ?? null;
  const outcomeLabel = text(
    templateContract?.outputSummary
      ?? templateContract?.outputFileName
      ?? generate?.label
      ?? definition.name,
    300,
  );
  const outputFormat = text(templateContract?.outputFormat, 100);
  const outcome = {
    label: outcomeLabel ?? "任务结果",
    artifactKinds: unique([outputFormat ?? "document"]),
    acceptanceCriteria: [`完成并检查${outcomeLabel ?? "任务结果"}`],
  };
  const mutationRequired = Boolean(definition.mutationPolicy)
    || steps.some((step) => step?.kind === "ledger_upsert");
  const externalEffect = definition.externalEffect === true;
  const contract = {
    schemaVersion: 2,
    id: text(definition.id, 120),
    familyId: text(definition.familyId ?? definition.id, 120),
    version: Number.isInteger(definition.version) && definition.version > 0 ? definition.version : 1,
    taskKind: taskKindFor(definition),
    domain: text(definition.domain, 120) ?? "business",
    name: text(definition.name, 300),
    outcome,
    inputSlots: inputSlotsFor(definition, templateContract),
    ledgerRouting: ledgerRoutingFor(definition),
    method: steps
      .filter((step) => ROUTINE_METHOD_KINDS.has(step?.kind))
      .map((step) => ({
        key: text(step.key, 120),
        kind: step.kind,
        label: text(step.label, 300),
        required: step.required !== false,
      })),
    externalEffect,
    approvalPolicy: externalEffect
      ? "before_effect"
      : mutationRequired ? "before_sensitive_write" : "none",
    state: TEMPLATE_STATE[definition.state] ?? "draft",
  };
  if (!contract.id || !contract.name) return { ok: false, error: "invalid_task_template_source" };
  const normalized = normalizeTaskTemplateContractV2(contract);
  return normalized.ok ? normalized : { ok: false, error: normalized.error };
}

