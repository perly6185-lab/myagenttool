// Deterministic, offline acceptance evaluator for workplace-profile extraction
// from local Office documents. Cases contain synthetic Office extraction
// snapshots; predictions contain only canonical trait ids and a bounded
// narrative. No provider or network access is involved.

import { readFileSync } from "node:fs";

import { isNonEmptyString, loadCaseSet } from "./util.mjs";

const OFFICE_FORMATS = new Set(["docx", "pptx", "xlsx"]);
const REQUIRED_SCENARIOS = new Set(["procurement", "warehouse", "business"]);

export const DEFAULT_PROFILE_ACCEPTANCE_THRESHOLDS = Object.freeze({
  minRecall: 0.8,
  minPrecision: 0.9,
  maxPrivacyViolations: 0,
  maxFalsePositives: 0,
});

export function validateProfileAcceptanceCase(raw, source) {
  const where = source ? ` (${source})` : "";
  if (!raw || typeof raw !== "object") {
    throw new Error(`Profile acceptance case must be a JSON object${where}.`);
  }
  if (!isNonEmptyString(raw.id)) {
    throw new Error(`Profile acceptance case needs a string id${where}.`);
  }
  if (!REQUIRED_SCENARIOS.has(raw.scenario)) {
    throw new Error(`Profile acceptance case ${raw.id} has unsupported scenario "${raw.scenario}"${where}.`);
  }

  const document = raw.document ?? {};
  const format = String(document.format ?? "").toLowerCase();
  if (!isNonEmptyString(document.filename) || !OFFICE_FORMATS.has(format)) {
    throw new Error(`Profile acceptance case ${raw.id} needs a local docx, pptx, or xlsx filename${where}.`);
  }
  if (!document.filename.toLowerCase().endsWith(`.${format}`) || /[/\\]/.test(document.filename)) {
    throw new Error(`Profile acceptance case ${raw.id} document filename must be a basename ending in .${format}${where}.`);
  }
  const records = Array.isArray(document.records) ? document.records : [];
  if (records.length === 0 || records.some((record) =>
    !isNonEmptyString(record?.location) || !isNonEmptyString(record?.text))) {
    throw new Error(`Profile acceptance case ${raw.id} needs non-empty Office extraction records${where}.`);
  }

  const oracle = raw.oracle ?? {};
  const expectedTraits = strictStringArray(oracle.expectedTraits, `${raw.id} expectedTraits${where}`);
  const falsePositiveTraits = strictStringArray(oracle.falsePositiveTraits, `${raw.id} falsePositiveTraits${where}`);
  const sensitiveTraitIds = strictStringArray(oracle.sensitiveTraitIds, `${raw.id} sensitiveTraitIds${where}`);
  const sensitiveFields = Array.isArray(oracle.sensitiveFields)
    ? oracle.sensitiveFields.map((field) => ({
      id: String(field?.id ?? ""),
      value: String(field?.value ?? ""),
      synthetic: field?.synthetic === true,
    }))
    : [];
  if (expectedTraits.length === 0) {
    throw new Error(`Profile acceptance case ${raw.id} needs expectedTraits${where}.`);
  }
  if (falsePositiveTraits.length === 0) {
    throw new Error(`Profile acceptance case ${raw.id} needs falsePositiveTraits${where}.`);
  }
  if (sensitiveTraitIds.length === 0 || sensitiveFields.length === 0) {
    throw new Error(`Profile acceptance case ${raw.id} needs sensitive fields and sensitive trait ids${where}.`);
  }
  if (sensitiveFields.some((field) =>
    !isNonEmptyString(field.id) || field.value.length < 4 || !field.synthetic)) {
    throw new Error(`Profile acceptance case ${raw.id} sensitive fields must be named, synthetic, and at least four characters${where}.`);
  }
  if (new Set(sensitiveFields.map((field) => field.id)).size !== sensitiveFields.length
    || new Set(sensitiveFields.map((field) => field.value)).size !== sensitiveFields.length) {
    throw new Error(`Profile acceptance case ${raw.id} sensitive field ids and values must be unique${where}.`);
  }
  const sourceText = records.map((record) => record.text).join("\n");
  if (sensitiveFields.some((field) => !sourceText.includes(field.value))) {
    throw new Error(`Profile acceptance case ${raw.id} must plant every sensitive value in its Office snapshot${where}.`);
  }
  const traitGroups = [expectedTraits, falsePositiveTraits, sensitiveTraitIds];
  if (new Set(traitGroups.flat()).size !== traitGroups.flat().length) {
    throw new Error(`Profile acceptance case ${raw.id} trait groups must not overlap${where}.`);
  }

  return {
    id: raw.id,
    scenario: raw.scenario,
    document: {
      filename: document.filename,
      format,
      records: records.map((record) => ({
        location: record.location,
        text: record.text,
      })),
    },
    oracle: {
      expectedTraits,
      falsePositiveTraits,
      sensitiveTraitIds,
      sensitiveFields,
    },
  };
}

export function loadProfileAcceptanceSet(dir) {
  const cases = loadCaseSet(dir, {
    validate: validateProfileAcceptanceCase,
    label: "Profile acceptance",
  });
  const scenarios = new Set(cases.map((caseObj) => caseObj.scenario));
  const missing = [...REQUIRED_SCENARIOS].filter((scenario) => !scenarios.has(scenario));
  if (missing.length > 0) {
    throw new Error(`Profile acceptance set is missing required scenarios: ${missing.join(", ")}.`);
  }
  return cases;
}

export function loadProfilePredictions(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Profile predictions are not valid JSON (${path}): ${error.message}`);
  }
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.predictions)) {
    throw new Error("Profile predictions need schemaVersion 1 and a predictions array.");
  }
  const seen = new Set();
  return raw.predictions.map((prediction, index) => {
    if (!isNonEmptyString(prediction?.caseId)) {
      throw new Error(`Profile prediction ${index + 1} needs a caseId.`);
    }
    if (seen.has(prediction.caseId)) {
      throw new Error(`Duplicate profile prediction caseId: ${prediction.caseId}.`);
    }
    seen.add(prediction.caseId);
    const traits = strictStringArray(prediction.traits, `prediction ${prediction.caseId} traits`);
    return {
      caseId: prediction.caseId,
      traits,
      narrative: typeof prediction.narrative === "string" ? prediction.narrative : "",
    };
  });
}

export function evaluateProfileAcceptance({
  cases,
  predictions,
  thresholds = DEFAULT_PROFILE_ACCEPTANCE_THRESHOLDS,
} = {}) {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error("evaluateProfileAcceptance requires at least one case.");
  }
  if (!Array.isArray(predictions)) {
    throw new Error("evaluateProfileAcceptance requires a predictions array.");
  }
  const normalizedThresholds = normalizeThresholds(thresholds);
  const caseIds = new Set(cases.map((caseObj) => caseObj.id));
  const predictionsByCase = new Map(predictions.map((prediction) => [prediction.caseId, prediction]));
  const unexpectedCaseIds = [...predictionsByCase.keys()].filter((caseId) => !caseIds.has(caseId)).sort();

  let expectedCount = 0;
  let predictedCount = 0;
  let truePositiveCount = 0;
  let falsePositiveCount = 0;
  let privacyViolationCount = 0;
  let unsupportedTraitCount = 0;
  const results = [];
  const byScenario = {};

  for (const caseObj of cases) {
    const prediction = predictionsByCase.get(caseObj.id) ?? {
      caseId: caseObj.id,
      traits: [],
      narrative: "",
    };
    const predicted = new Set(prediction.traits);
    const expected = new Set(caseObj.oracle.expectedTraits);
    const plantedFalsePositives = new Set(caseObj.oracle.falsePositiveTraits);
    const sensitiveTraits = new Set(caseObj.oracle.sensitiveTraitIds);
    const matchedTraits = [...predicted].filter((trait) => expected.has(trait)).sort();
    const missedTraits = [...expected].filter((trait) => !predicted.has(trait)).sort();
    const plantedFalsePositiveHits = [...predicted].filter((trait) => plantedFalsePositives.has(trait)).sort();
    const sensitiveTraitHits = [...predicted].filter((trait) => sensitiveTraits.has(trait)).sort();
    const unsupportedTraits = [...predicted].filter((trait) =>
      !expected.has(trait) && !plantedFalsePositives.has(trait) && !sensitiveTraits.has(trait)).sort();
    const leakedFieldIds = findLeakedFieldIds(prediction, caseObj.oracle.sensitiveFields);

    expectedCount += expected.size;
    predictedCount += predicted.size;
    truePositiveCount += matchedTraits.length;
    falsePositiveCount += plantedFalsePositiveHits.length;
    unsupportedTraitCount += unsupportedTraits.length;
    privacyViolationCount += sensitiveTraitHits.length + leakedFieldIds.length;

    const scenario = (byScenario[caseObj.scenario] ??= {
      cases: 0,
      expected: 0,
      predicted: 0,
      truePositives: 0,
      falsePositives: 0,
      privacyViolations: 0,
    });
    scenario.cases += 1;
    scenario.expected += expected.size;
    scenario.predicted += predicted.size;
    scenario.truePositives += matchedTraits.length;
    scenario.falsePositives += plantedFalsePositiveHits.length + unsupportedTraits.length + sensitiveTraitHits.length;
    scenario.privacyViolations += sensitiveTraitHits.length + leakedFieldIds.length;

    results.push({
      id: caseObj.id,
      scenario: caseObj.scenario,
      document: caseObj.document.filename,
      matchedTraits,
      missedTraits,
      falsePositiveTraits: plantedFalsePositiveHits,
      unsupportedTraits,
      sensitiveTraitHits,
      leakedFieldIds,
    });
  }

  const totalFalsePredictions = predictedCount - truePositiveCount;
  const recall = expectedCount === 0 ? 0 : truePositiveCount / expectedCount;
  const precision = predictedCount === 0 ? 0 : truePositiveCount / predictedCount;
  for (const scenario of Object.values(byScenario)) {
    scenario.recall = scenario.expected === 0 ? 0 : scenario.truePositives / scenario.expected;
    scenario.precision = scenario.predicted === 0 ? 0 : scenario.truePositives / scenario.predicted;
  }
  const passed = recall >= normalizedThresholds.minRecall
    && precision >= normalizedThresholds.minPrecision
    && privacyViolationCount <= normalizedThresholds.maxPrivacyViolations
    && falsePositiveCount <= normalizedThresholds.maxFalsePositives
    && unexpectedCaseIds.length === 0;

  return {
    passed,
    thresholds: normalizedThresholds,
    totals: {
      cases: cases.length,
      expectedTraits: expectedCount,
      predictedTraits: predictedCount,
      truePositives: truePositiveCount,
      falsePredictions: totalFalsePredictions,
    },
    metrics: {
      recall,
      precision,
      falsePositiveCount,
      unsupportedTraitCount,
      privacyViolationCount,
    },
    unexpectedCaseIds,
    byScenario,
    results,
  };
}

export function formatProfileAcceptanceReport(summary, { setDir, predictionsPath } = {}) {
  const pct = (value) => `${(value * 100).toFixed(1)}%`;
  const lines = [
    "# 画像隐私与质量离线验收",
    "",
    `Result: ${summary.passed ? "PASS" : "FAIL"}`,
    `Recall: ${pct(summary.metrics.recall)} (minimum ${pct(summary.thresholds.minRecall)})`,
    `Precision: ${pct(summary.metrics.precision)} (minimum ${pct(summary.thresholds.minPrecision)})`,
    `Privacy violations: ${summary.metrics.privacyViolationCount} (maximum ${summary.thresholds.maxPrivacyViolations})`,
    `Planted false positives: ${summary.metrics.falsePositiveCount} (maximum ${summary.thresholds.maxFalsePositives})`,
    `Unsupported traits: ${summary.metrics.unsupportedTraitCount}`,
    setDir ? `Set: ${setDir}` : null,
    predictionsPath ? `Predictions: ${predictionsPath}` : null,
    "",
    "| Case | Scenario | Recall | False positives | Privacy |",
    "| --- | --- | ---: | ---: | ---: |",
    ...summary.results.map((result) => {
      const expected = result.matchedTraits.length + result.missedTraits.length;
      const recall = expected === 0 ? 0 : result.matchedTraits.length / expected;
      const falsePositives = result.falsePositiveTraits.length
        + result.unsupportedTraits.length
        + result.sensitiveTraitHits.length;
      const privacy = result.sensitiveTraitHits.length + result.leakedFieldIds.length;
      return `| ${result.id} | ${result.scenario} | ${pct(recall)} | ${falsePositives} | ${privacy} |`;
    }),
    "",
  ].filter((line) => line !== null);
  return `${lines.join("\n")}\n`;
}

function findLeakedFieldIds(prediction, sensitiveFields) {
  const output = normalizeLeakText(JSON.stringify(prediction));
  return sensitiveFields
    .filter((field) => output.includes(normalizeLeakText(field.value)))
    .map((field) => field.id)
    .sort();
}

function normalizeLeakText(value) {
  return String(value).normalize("NFKC").toLowerCase().replace(/[\s"'`.,:;|/\\()[\]{}<>_-]+/g, "");
}

function strictStringArray(value, label) {
  if (!Array.isArray(value)
    || value.some((item) => !isNonEmptyString(item))
    || new Set(value.map((item) => item.trim())).size !== value.length) {
    throw new Error(`Profile ${label} must be a unique, non-empty string array.`);
  }
  return value.map((item) => item.trim());
}

function normalizeThresholds(thresholds) {
  const normalized = {
    ...DEFAULT_PROFILE_ACCEPTANCE_THRESHOLDS,
    ...(thresholds ?? {}),
  };
  for (const key of ["minRecall", "minPrecision"]) {
    if (!Number.isFinite(normalized[key]) || normalized[key] < 0 || normalized[key] > 1) {
      throw new Error(`${key} must be a number between 0 and 1.`);
    }
  }
  for (const key of ["maxPrivacyViolations", "maxFalsePositives"]) {
    if (!Number.isInteger(normalized[key]) || normalized[key] < 0) {
      throw new Error(`${key} must be a non-negative integer.`);
    }
  }
  return normalized;
}
