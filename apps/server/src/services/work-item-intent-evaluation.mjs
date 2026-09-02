import { createHash } from "node:crypto";
import {
  normalizeWorkItemIntentEvaluationThresholds,
  workItemIntentEvaluationFields,
  workItemIntentEvaluationSchemaVersion,
} from "@myagenttool/protocol/work-item-intent-evaluation";
import { WORK_ITEM_INTENT_FIELD_ACCURACY_SET_V1 } from "./evaluation-sets/work-item-intent-field-accuracy-v1.mjs";
import {
  buildWorkItemIntentContract,
  workItemIntentResolutionScopeDigest,
} from "./work-item-intent-contract.mjs";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function equal(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function mismatchPaths(expected, actual, prefix = "") {
  if (equal(expected, actual)) return [];
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return [prefix || "$root"];
    const paths = [];
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      paths.push(...mismatchPaths(expected[index], actual[index], `${prefix}[${index}]`));
    }
    return paths.length ? paths : [prefix || "$root"];
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    const paths = [];
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      paths.push(...mismatchPaths(expected[key], actual[key], prefix ? `${prefix}.${key}` : key));
    }
    return paths.length ? paths : [prefix || "$root"];
  }
  return [prefix || "$root"];
}

function canonicalAction(value) {
  return { ...value, forbiddenActions: [...(value?.forbiddenActions ?? [])].sort() };
}

function canonicalMaterials(value) {
  const materialKey = (material) => `${material?.purpose ?? ""}:${material?.id ?? ""}`;
  return {
    inputs: [...(value?.inputs ?? [])].sort((left, right) => materialKey(left).localeCompare(materialKey(right))),
    changeTargets: [...(value?.changeTargets ?? [])].sort((left, right) => String(left?.id ?? "").localeCompare(String(right?.id ?? ""))),
    source: value?.source,
  };
}

function actualFields(contract) {
  return {
    goal: { value: contract.goal, source: contract.sources.goal },
    action: canonicalAction({ ...contract.action, source: contract.sources.action }),
    materials: canonicalMaterials({ ...contract.materials, source: contract.sources.materials }),
    output: { value: contract.expectedOutput, source: contract.sources.expectedOutput },
    delivery: { ...contract.delivery, source: contract.sources.delivery },
  };
}

function expectedFields(expected) {
  return {
    goal: expected.goal,
    action: canonicalAction(expected.action),
    materials: canonicalMaterials(expected.materials),
    output: expected.output,
    delivery: expected.delivery,
  };
}

function validateDataset(dataset) {
  const errors = [];
  if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) return ["dataset_invalid"];
  if (dataset.schemaVersion !== 1) errors.push("dataset_schema_version_invalid");
  if (!String(dataset.id ?? "").trim()) errors.push("dataset_id_required");
  if (!Number.isInteger(dataset.version) || dataset.version < 1) errors.push("dataset_version_invalid");
  if (!Array.isArray(dataset.cases) || !dataset.cases.length) return [...errors, "dataset_cases_required"];
  const ids = new Set();
  for (const [index, fixture] of dataset.cases.entries()) {
    const id = String(fixture?.id ?? "").trim();
    if (!id) errors.push(`case_${index}_id_required`);
    else if (ids.has(id)) errors.push(`case_${id}_duplicate`);
    else ids.add(id);
    if (!fixture?.item || typeof fixture.item !== "object" || Array.isArray(fixture.item)) errors.push(`case_${id || index}_item_invalid`);
    if (!fixture?.expected || typeof fixture.expected !== "object" || Array.isArray(fixture.expected)) {
      errors.push(`case_${id || index}_expected_invalid`);
      continue;
    }
    for (const field of workItemIntentEvaluationFields) {
      if (!fixture.expected[field] || typeof fixture.expected[field] !== "object" || Array.isArray(fixture.expected[field])) {
        errors.push(`case_${id || index}_${field}_expected_required`);
      }
    }
  }
  return errors;
}

function withResolution(fixture) {
  const item = structuredClone(fixture.item);
  if (!fixture.resolution) return item;
  item.intentClarificationResolutions = [{
    code: fixture.resolution.code,
    choiceId: fixture.resolution.choiceId,
    scopeDigest: workItemIntentResolutionScopeDigest(item, fixture.resolution.code),
  }];
  return item;
}

function unsafeActionExpansion(expected, actual) {
  if (expected.accessMode === "read_only" && actual.accessMode !== "read_only") return true;
  const actualForbidden = new Set(actual.forbiddenActions ?? []);
  return (expected.forbiddenActions ?? []).some((action) => !actualForbidden.has(action));
}

function gateFailures(metrics, thresholds, total) {
  const failures = [];
  if (total < thresholds.minimumCaseCount) failures.push("dataset_case_count_below_minimum");
  const checks = [
    ["exact_case_accuracy_below_threshold", metrics.exactCaseAccuracy, thresholds.exactCaseAccuracy],
    ["macro_field_accuracy_below_threshold", metrics.macroFieldAccuracy, thresholds.macroFieldAccuracy],
    ["goal_accuracy_below_threshold", metrics.fieldAccuracy.goal, thresholds.goalAccuracy],
    ["action_accuracy_below_threshold", metrics.fieldAccuracy.action, thresholds.actionAccuracy],
    ["materials_accuracy_below_threshold", metrics.fieldAccuracy.materials, thresholds.materialsAccuracy],
    ["output_accuracy_below_threshold", metrics.fieldAccuracy.output, thresholds.outputAccuracy],
    ["delivery_accuracy_below_threshold", metrics.fieldAccuracy.delivery, thresholds.deliveryAccuracy],
  ];
  for (const [code, actual, threshold] of checks) if (actual < threshold) failures.push(code);
  if (metrics.unsafeActionExpansionRate > thresholds.unsafeActionExpansionRate) {
    failures.push("unsafe_action_expansion_rate_above_threshold");
  }
  return failures;
}

export function evaluateWorkItemIntentFields({
  dataset = WORK_ITEM_INTENT_FIELD_ACCURACY_SET_V1,
  buildContract = buildWorkItemIntentContract,
  thresholds: thresholdOverrides = null,
} = {}) {
  const thresholds = normalizeWorkItemIntentEvaluationThresholds(thresholdOverrides);
  const datasetErrors = validateDataset(dataset);
  if (datasetErrors.length) {
    return {
      schemaVersion: workItemIntentEvaluationSchemaVersion,
      datasetId: String(dataset?.id ?? "invalid"),
      datasetVersion: Number(dataset?.version) || 0,
      datasetDigest: null,
      datasetValid: false,
      datasetErrors,
      total: Array.isArray(dataset?.cases) ? dataset.cases.length : 0,
      passed: 0,
      failed: [],
      metrics: {
        exactCaseAccuracy: 0,
        macroFieldAccuracy: 0,
        fieldAccuracy: Object.fromEntries(workItemIntentEvaluationFields.map((field) => [field, 0])),
        unsafeActionExpansionRate: 0,
      },
      thresholds,
      gateFailures: ["dataset_invalid"],
      releaseReady: false,
      results: [],
    };
  }

  const results = dataset.cases.map((fixture) => {
    const contract = buildContract(withResolution(fixture));
    const expected = expectedFields(fixture.expected);
    const actual = actualFields(contract);
    const fields = Object.fromEntries(workItemIntentEvaluationFields.map((field) => {
      const pass = equal(expected[field], actual[field]);
      return [field, {
        field,
        pass,
        expected: expected[field],
        actual: actual[field],
        mismatchPaths: pass ? [] : mismatchPaths(expected[field], actual[field]),
      }];
    }));
    const failedFields = workItemIntentEvaluationFields.filter((field) => !fields[field].pass);
    return {
      id: fixture.id,
      pass: failedFields.length === 0,
      tags: [...(fixture.tags ?? [])],
      contractDigest: contract.digest,
      contractStatus: contract.status,
      fields,
      failedFields,
      unsafeActionExpansion: unsafeActionExpansion(expected.action, actual.action),
    };
  });
  const total = results.length;
  const fieldAccuracy = Object.fromEntries(workItemIntentEvaluationFields.map((field) => [
    field,
    total ? results.filter((result) => result.fields[field].pass).length / total : 1,
  ]));
  const dangerousActionCases = results.filter((result) => {
    const expected = result.fields.action.expected;
    return expected.accessMode === "read_only" || expected.forbiddenActions.length > 0;
  });
  const metrics = {
    exactCaseAccuracy: total ? results.filter((result) => result.pass).length / total : 1,
    macroFieldAccuracy: workItemIntentEvaluationFields.reduce((sum, field) => sum + fieldAccuracy[field], 0) / workItemIntentEvaluationFields.length,
    fieldAccuracy,
    unsafeActionExpansionRate: dangerousActionCases.length
      ? dangerousActionCases.filter((result) => result.unsafeActionExpansion).length / dangerousActionCases.length
      : 0,
  };
  const failures = gateFailures(metrics, thresholds, total);
  return {
    schemaVersion: workItemIntentEvaluationSchemaVersion,
    datasetId: dataset.id,
    datasetVersion: dataset.version,
    datasetDigest: digest(dataset),
    datasetValid: true,
    datasetErrors: [],
    total,
    passed: results.filter((result) => result.pass).length,
    failed: results.filter((result) => !result.pass),
    metrics,
    thresholds,
    gateFailures: failures,
    releaseReady: failures.length === 0,
    coverage: {
      tagCount: new Set(dataset.cases.flatMap((fixture) => fixture.tags ?? [])).size,
      channelCases: dataset.cases.filter((fixture) => fixture.tags?.includes("channel")).length,
      desktopCases: dataset.cases.filter((fixture) => fixture.tags?.includes("desktop")).length,
      materialCases: dataset.cases.filter((fixture) => fixture.tags?.includes("materials")).length,
      dangerousActionCases: dangerousActionCases.length,
    },
    results,
  };
}

export { WORK_ITEM_INTENT_FIELD_ACCURACY_SET_V1 };
