import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { conceptualAnchoredRubricGoldenCases, CONCEPTUAL_ANCHORED_RUBRIC_GOLDEN_SET_VERSION } from "../../apps/server/src/services/evaluation-sets/conceptual-anchored-rubric-v2.mjs";
import { languageCausalSemanticGoldenCases, LANGUAGE_CAUSAL_SEMANTIC_GOLDEN_SET_VERSION } from "../../apps/server/src/services/evaluation-sets/language-causal-semantic-v2.mjs";
import { mathLinearStepsGoldenCases, MATH_LINEAR_STEPS_GOLDEN_SET_VERSION } from "../../apps/server/src/services/evaluation-sets/math-linear-steps-v2.mjs";
import { runConceptualRubricConsistencyReplay, runLanguageCausalSemanticGoldenReplay, runMathLinearStepsGoldenReplay } from "../../apps/server/src/services/private-tutor-evaluation-replay.mjs";

export const PRIVATE_TUTOR_RELEASE_EVALUATION_VERSION = 1;
export const PRIVATE_TUTOR_DATASET_FINGERPRINT = "27069321e7287d912826a4d82f2cfdbb4fa453ee628f909a9688b1020390d629";
export const PRIVATE_TUTOR_RELEASE_THRESHOLDS = Object.freeze({
  minimumPassRate: 1,
  maximumFalsePositiveCount: 0,
  maximumFalseNegativeCount: 0,
  maximumEvidenceLeakCount: 0,
  minimumAnchorAgreementRate: 1,
  minimumRepeatabilityRate: 1,
});

const DATASETS = Object.freeze([
  { name: "math-step", setVersion: MATH_LINEAR_STEPS_GOLDEN_SET_VERSION, cases: mathLinearStepsGoldenCases },
  { name: "language-semantic", setVersion: LANGUAGE_CAUSAL_SEMANTIC_GOLDEN_SET_VERSION, cases: languageCausalSemanticGoldenCases },
  { name: "conceptual-rubric", setVersion: CONCEPTUAL_ANCHORED_RUBRIC_GOLDEN_SET_VERSION, cases: conceptualAnchoredRubricGoldenCases },
]);

export function runPrivateTutorReleaseEvaluations() {
  return [
    ["math-step", runMathLinearStepsGoldenReplay()],
    ["language-semantic", runLanguageCausalSemanticGoldenReplay()],
    ["conceptual-rubric", runConceptualRubricConsistencyReplay()],
  ];
}

export function privateTutorDatasetFingerprint() {
  return createHash("sha256").update(JSON.stringify(DATASETS, bigintReplacer)).digest("hex");
}

export function evaluatePrivateTutorReleaseGate({ evaluations = runPrivateTutorReleaseEvaluations() } = {}) {
  const suites = evaluations.map(([name, evaluation]) => suiteReport(name, evaluation));
  const conceptual = suites.find((suite) => suite.name === "conceptual-rubric");
  const fingerprint = privateTutorDatasetFingerprint();
  const metrics = {
    totalCases: sum(suites, "total"),
    matchedCases: sum(suites, "matchedCount"),
    falsePositiveCount: sum(suites, "falsePositiveCount"),
    falseNegativeCount: sum(suites, "falseNegativeCount"),
    evidenceLeakCount: sum(suites, "evidenceLeakCount"),
    anchorAgreementRate: conceptual?.anchorAgreementRate ?? null,
    repeatabilityRate: conceptual?.repeatabilityRate ?? null,
  };
  const expectedSuiteNames = DATASETS.map((dataset) => dataset.name);
  const actualSuiteNames = suites.map((suite) => suite.name);
  const gates = {
    datasetFingerprint: fingerprint === PRIVATE_TUTOR_DATASET_FINGERPRINT,
    requiredSuites: expectedSuiteNames.length === actualSuiteNames.length && expectedSuiteNames.every((name) => actualSuiteNames.includes(name)),
    caseMatches: suites.every((suite) => suite.passRate >= PRIVATE_TUTOR_RELEASE_THRESHOLDS.minimumPassRate),
    falsePositives: metrics.falsePositiveCount <= PRIVATE_TUTOR_RELEASE_THRESHOLDS.maximumFalsePositiveCount,
    falseNegatives: metrics.falseNegativeCount <= PRIVATE_TUTOR_RELEASE_THRESHOLDS.maximumFalseNegativeCount,
    evidenceLeaks: metrics.evidenceLeakCount <= PRIVATE_TUTOR_RELEASE_THRESHOLDS.maximumEvidenceLeakCount,
    anchorAgreement: metrics.anchorAgreementRate !== null && metrics.anchorAgreementRate >= PRIVATE_TUTOR_RELEASE_THRESHOLDS.minimumAnchorAgreementRate,
    repeatability: metrics.repeatabilityRate !== null && metrics.repeatabilityRate >= PRIVATE_TUTOR_RELEASE_THRESHOLDS.minimumRepeatabilityRate,
  };
  return {
    schemaVersion: 1,
    evaluationVersion: PRIVATE_TUTOR_RELEASE_EVALUATION_VERSION,
    dataset: {
      fingerprint,
      expectedFingerprint: PRIVATE_TUTOR_DATASET_FINGERPRINT,
      suites: DATASETS.map((dataset) => ({ name: dataset.name, setVersion: dataset.setVersion, total: dataset.cases.length })),
    },
    thresholds: PRIVATE_TUTOR_RELEASE_THRESHOLDS,
    metrics,
    gates,
    suites,
    passed: Object.values(gates).every(Boolean) && suites.every((suite) => suite.passed),
  };
}

export async function writePrivateTutorReleaseReport(report, outputPath) {
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return absolutePath;
}

function suiteReport(name, evaluation) {
  return {
    name,
    setVersion: evaluation.setVersion,
    total: evaluation.total,
    matchedCount: evaluation.matchedCount,
    passRate: evaluation.passRate,
    falsePositiveCount: evaluation.falsePositiveCount,
    falseNegativeCount: evaluation.falseNegativeCount,
    evidenceLeakCount: evaluation.evidenceLeakCount,
    ...(evaluation.anchorAgreementRate === undefined ? {} : {
      anchorAgreementRate: evaluation.anchorAgreementRate,
      repeatabilityRate: evaluation.repeatabilityRate,
    }),
    passed: evaluation.passed === true,
    failures: evaluation.failed,
  };
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] ?? 0), 0);
}

function bigintReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function printHumanReport(report) {
  for (const suite of report.suites) {
    console.log(`Private tutor ${suite.name} eval ${suite.setVersion}: ${suite.matchedCount}/${suite.total} matched`);
    console.log(`False positives: ${suite.falsePositiveCount}; false negatives: ${suite.falseNegativeCount}; evidence leaks: ${suite.evidenceLeakCount}`);
    if (suite.anchorAgreementRate !== undefined) {
      console.log(`Anchor agreement: ${suite.anchorAgreementRate}; repeatability: ${suite.repeatabilityRate}`);
    }
    for (const failure of suite.failures) {
      console.error(`- ${failure.id}: ${failure.reason} (${failure.actualClassification ?? failure.actualSemanticStatus ?? failure.actualScoreBand ?? "no classification"})`);
    }
  }
  console.log(`Release gate: ${report.passed ? "PASS" : "FAIL"}; dataset ${report.dataset.fingerprint}`);
  for (const [name, passed] of Object.entries(report.gates)) console.log(`- ${name}: ${passed ? "pass" : "fail"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = evaluatePrivateTutorReleaseGate();
  const reportIndex = process.argv.indexOf("--report");
  const reportValue = reportIndex >= 0 ? process.argv[reportIndex + 1] : null;
  const reportPath = reportValue && !reportValue.startsWith("--") ? reportValue : null;
  if (reportIndex >= 0 && !reportPath) {
    console.error("--report requires an output path");
    process.exitCode = 2;
  } else {
    if (reportPath) await writePrivateTutorReleaseReport(report, reportPath);
    if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else printHumanReport(report);
    if (!report.passed) process.exitCode = 1;
  }
}
