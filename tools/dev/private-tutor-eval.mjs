import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { conceptualAnchoredRubricGoldenCases, CONCEPTUAL_ANCHORED_RUBRIC_GOLDEN_SET_VERSION } from "../../apps/server/src/services/evaluation-sets/conceptual-anchored-rubric-v2.mjs";
import { languageCausalSemanticGoldenCases, LANGUAGE_CAUSAL_SEMANTIC_GOLDEN_SET_VERSION } from "../../apps/server/src/services/evaluation-sets/language-causal-semantic-v2.mjs";
import { mathLinearStepsGoldenCases, MATH_LINEAR_STEPS_GOLDEN_SET_VERSION } from "../../apps/server/src/services/evaluation-sets/math-linear-steps-v2.mjs";
import {
  privateTutorEvaluationMigrations,
  resolvePrivateTutorEvaluationMigration,
  samePrivateTutorEvaluationVersion,
} from "../../apps/server/src/services/private-tutor-evaluation-migrations.mjs";
import { conceptualSourceReasoningPackage } from "../../apps/server/src/services/packages/conceptual-source-reasoning.mjs";
import { demoMathFoundationsPackage } from "../../apps/server/src/services/packages/demo-math-foundations.mjs";
import { languageCausalExplanationsPackage } from "../../apps/server/src/services/packages/language-causal-explanations.mjs";
import { conceptualSubjectPlugin } from "../../apps/server/src/services/plugins/conceptual-plugin.mjs";
import { CONCEPTUAL_RUBRIC_EVALUATOR_VERSION } from "../../apps/server/src/services/plugins/conceptual-rubric-evaluator.mjs";
import { languageSubjectPlugin } from "../../apps/server/src/services/plugins/language-plugin.mjs";
import { LANGUAGE_SEMANTIC_EVALUATOR_VERSION } from "../../apps/server/src/services/plugins/language-semantic-evaluator.mjs";
import { mathSubjectPlugin, MATH_STEP_EVALUATOR_VERSION } from "../../apps/server/src/services/plugins/math-plugin.mjs";
import { runConceptualRubricConsistencyReplay, runLanguageCausalSemanticGoldenReplay, runMathLinearStepsGoldenReplay } from "../../apps/server/src/services/private-tutor-evaluation-replay.mjs";

export const PRIVATE_TUTOR_RELEASE_EVALUATION_VERSION = 2;
export const PRIVATE_TUTOR_BASELINE_SCHEMA_VERSION = 1;
export const PRIVATE_TUTOR_DATASET_FINGERPRINT = "27069321e7287d912826a4d82f2cfdbb4fa453ee628f909a9688b1020390d629";
export const PRIVATE_TUTOR_RELEASE_THRESHOLDS = Object.freeze({
  minimumPassRate: 1,
  maximumFalsePositiveCount: 0,
  maximumFalseNegativeCount: 0,
  maximumEvidenceLeakCount: 0,
  minimumAnchorAgreementRate: 1,
  minimumRepeatabilityRate: 1,
});

const BASELINE_URL = new URL("./fixtures/private-tutor-evaluation-baseline-v1.json", import.meta.url);
const DECISION_FIELDS = Object.freeze([
  "correct",
  "evidenceEligible",
  "reason",
  "classification",
  "semanticStatus",
  "scoreBand",
  "score",
  "anchorId",
  "confidence",
  "requiresReview",
]);
const METRIC_FIELDS = Object.freeze([
  "passRate",
  "falsePositiveCount",
  "falseNegativeCount",
  "evidenceLeakCount",
  "anchorAgreementRate",
  "repeatabilityRate",
]);

const DATASETS = Object.freeze([
  dataset({
    name: "math-step",
    setVersion: MATH_LINEAR_STEPS_GOLDEN_SET_VERSION,
    cases: mathLinearStepsGoldenCases,
    versions: versionDescriptor(mathSubjectPlugin.version, demoMathFoundationsPackage.version, mathLinearStepsGoldenCases[0].question.mathContract.version, MATH_STEP_EVALUATOR_VERSION),
  }),
  dataset({
    name: "language-semantic",
    setVersion: LANGUAGE_CAUSAL_SEMANTIC_GOLDEN_SET_VERSION,
    cases: languageCausalSemanticGoldenCases,
    versions: versionDescriptor(languageSubjectPlugin.version, languageCausalExplanationsPackage.version, languageCausalSemanticGoldenCases[0].question.rubric.version, LANGUAGE_SEMANTIC_EVALUATOR_VERSION),
  }),
  dataset({
    name: "conceptual-rubric",
    setVersion: CONCEPTUAL_ANCHORED_RUBRIC_GOLDEN_SET_VERSION,
    cases: conceptualAnchoredRubricGoldenCases,
    versions: versionDescriptor(conceptualSubjectPlugin.version, conceptualSourceReasoningPackage.version, conceptualAnchoredRubricGoldenCases[0].question.rubric.version, CONCEPTUAL_RUBRIC_EVALUATOR_VERSION),
  }),
]);

export function runPrivateTutorReleaseEvaluations() {
  return [
    ["math-step", runMathLinearStepsGoldenReplay()],
    ["language-semantic", runLanguageCausalSemanticGoldenReplay()],
    ["conceptual-rubric", runConceptualRubricConsistencyReplay()],
  ];
}

export function privateTutorDatasetFingerprint() {
  return hash(DATASETS.map(({ name, setVersion, cases }) => ({ name, setVersion, cases })));
}

export function evaluatePrivateTutorQuality({ evaluations = runPrivateTutorReleaseEvaluations() } = {}) {
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
  const expectedSuiteNames = DATASETS.map((item) => item.name);
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
      suites: DATASETS.map((item) => ({ name: item.name, setVersion: item.setVersion, total: item.cases.length, versions: item.versions })),
    },
    thresholds: PRIVATE_TUTOR_RELEASE_THRESHOLDS,
    metrics,
    gates,
    suites,
    passed: Object.values(gates).every(Boolean) && suites.every((suite) => suite.passed),
  };
}

export function loadPrivateTutorEvaluationBaseline(path = BASELINE_URL) {
  const raw = path instanceof URL ? readFileSync(path, "utf8") : readFileSync(resolve(path), "utf8");
  return JSON.parse(raw);
}

export function buildPrivateTutorEvaluationBaseline(qualityReport, { baselineId = "private-tutor-evaluation-v2-2026-08-26" } = {}) {
  return {
    schemaVersion: PRIVATE_TUTOR_BASELINE_SCHEMA_VERSION,
    baselineId,
    evaluationVersion: qualityReport.evaluationVersion,
    datasetFingerprint: qualityReport.dataset.fingerprint,
    suites: qualityReport.suites.map((suite) => ({
      name: suite.name,
      setVersion: suite.setVersion,
      versions: suite.versions,
      total: suite.total,
      metrics: suiteMetrics(suite),
      decisions: suite.decisions,
    })),
  };
}

export function comparePrivateTutorEvaluationBaseline(currentReport, baseline, { migrations = privateTutorEvaluationMigrations } = {}) {
  const baselineValid = validBaseline(baseline);
  const baselineSuites = new Map((baselineValid ? baseline.suites : []).map((suite) => [suite.name, suite]));
  const currentSuites = new Map(currentReport.suites.map((suite) => [suite.name, suite]));
  const suiteNames = [...new Set([...baselineSuites.keys(), ...currentSuites.keys()])].sort();
  const suites = suiteNames.map((name) => compareSuite(currentSuites.get(name), baselineSuites.get(name), migrations));
  const summary = {
    changedDecisionCount: sum(suites, "changedDecisionCount"),
    unexpectedDecisionChangeCount: sum(suites, "unexpectedDecisionChangeCount"),
    addedCaseCount: sum(suites, "addedCaseCount"),
    removedCaseCount: sum(suites, "removedCaseCount"),
    maximumAbsoluteScoreDrift: suites.reduce((maximum, suite) => Math.max(maximum, suite.maximumAbsoluteScoreDrift ?? 0), 0),
    migrationCount: suites.filter((suite) => suite.migration.status === "resolved").length,
    missingMigrationCount: suites.filter((suite) => suite.migration.status === "missing").length,
  };
  const gates = {
    baselineManifest: baselineValid,
    baselineDataset: baselineValid && baseline.datasetFingerprint === currentReport.dataset.fingerprint,
    suiteCoverage: suites.every((suite) => suite.currentPresent && suite.baselinePresent),
    migrationsResolved: suites.every((suite) => ["resolved", "not_required", "not_applicable"].includes(suite.migration.status)),
    evaluationSetVersions: suites.every((suite) => suite.setVersionStable),
    caseSetStable: summary.addedCaseCount === 0 && summary.removedCaseCount === 0,
    decisionDriftReviewed: summary.unexpectedDecisionChangeCount === 0,
    scoreDriftWithinLimit: suites.every((suite) => suite.scoreDriftWithinLimit),
  };
  return {
    baselineId: baseline?.baselineId ?? null,
    baselineFingerprint: baselineValid ? hash(baseline) : null,
    gates,
    summary,
    suites,
    passed: Object.values(gates).every(Boolean) && suites.every((suite) => suite.passed),
  };
}

export function evaluatePrivateTutorReleaseGate({
  evaluations = runPrivateTutorReleaseEvaluations(),
  baseline = loadPrivateTutorEvaluationBaseline(),
  migrations = privateTutorEvaluationMigrations,
} = {}) {
  const quality = evaluatePrivateTutorQuality({ evaluations });
  const versionDrift = comparePrivateTutorEvaluationBaseline(quality, baseline, { migrations });
  const gates = {
    ...quality.gates,
    ...Object.fromEntries(Object.entries(versionDrift.gates).map(([name, passed]) => [`versionDrift.${name}`, passed])),
  };
  return {
    ...quality,
    baseline: {
      id: versionDrift.baselineId,
      fingerprint: versionDrift.baselineFingerprint,
    },
    versionDrift,
    gates,
    passed: quality.passed && versionDrift.passed && Object.values(gates).every(Boolean),
  };
}

export async function writePrivateTutorReleaseReport(report, outputPath) {
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return absolutePath;
}

function compareSuite(current, baseline, migrations) {
  if (!current || !baseline) {
    return {
      name: current?.name ?? baseline?.name ?? "unknown",
      currentPresent: Boolean(current),
      baselinePresent: Boolean(baseline),
      migration: { status: "not_applicable", id: null },
      setVersionStable: false,
      metricDeltas: {},
      changedDecisions: [],
      changedDecisionCount: 0,
      unexpectedDecisionChangeCount: 0,
      addedCaseIds: current?.decisions.map((decision) => decision.id) ?? [],
      removedCaseIds: baseline?.decisions.map((decision) => decision.id) ?? [],
      addedCaseCount: current?.decisions.length ?? 0,
      removedCaseCount: baseline?.decisions.length ?? 0,
      maximumAbsoluteScoreDrift: 0,
      scoreDriftWithinLimit: false,
      passed: false,
    };
  }
  const versionChanged = !samePrivateTutorEvaluationVersion(baseline.versions, current.versions);
  const migration = versionChanged
    ? resolvePrivateTutorEvaluationMigration(current.name, baseline.versions, current.versions, migrations)
    : null;
  const migrationReport = versionChanged
    ? migration?.status === "completed"
      ? { status: "resolved", id: migration.id, compatibility: migration.compatibility }
      : { status: migration ? "incomplete" : "missing", id: migration?.id ?? null }
    : { status: "not_required", id: null };
  const setVersionStable = baseline.setVersion === current.setVersion;
  const baselineDecisions = new Map(baseline.decisions.map((decision) => [decision.id, decision]));
  const currentDecisions = new Map(current.decisions.map((decision) => [decision.id, decision]));
  const addedCaseIds = [...currentDecisions.keys()].filter((id) => !baselineDecisions.has(id));
  const removedCaseIds = [...baselineDecisions.keys()].filter((id) => !currentDecisions.has(id));
  const changedDecisions = [...currentDecisions.entries()].flatMap(([id, currentDecision]) => {
    const baselineDecision = baselineDecisions.get(id);
    if (!baselineDecision) return [];
    const changedFields = DECISION_FIELDS.filter((field) => !sameValue(baselineDecision[field], currentDecision[field]));
    if (!changedFields.length) return [];
    const baselineScore = finiteNumber(baselineDecision.score);
    const currentScore = finiteNumber(currentDecision.score);
    return [{
      id,
      changedFields,
      baseline: baselineDecision,
      current: currentDecision,
      scoreDelta: baselineScore === null || currentScore === null ? null : round(currentScore - baselineScore),
    }];
  });
  const reviewedDecisionChangeIds = new Set(migration?.reviewedDecisionChangeIds ?? []);
  const unexpectedDecisionChanges = changedDecisions.filter((change) => !reviewedDecisionChangeIds.has(change.id));
  const maximumAbsoluteScoreDrift = changedDecisions.reduce((maximum, change) => Math.max(maximum, Math.abs(change.scoreDelta ?? 0)), 0);
  const allowedScoreDrift = migration?.maximumAbsoluteScoreDrift ?? 0;
  const scoreDriftWithinLimit = maximumAbsoluteScoreDrift <= allowedScoreDrift;
  const metricDeltas = Object.fromEntries(METRIC_FIELDS.map((field) => [field, metricDelta(baseline.metrics[field], current[field])]));
  const passed = !["missing", "incomplete"].includes(migrationReport.status)
    && setVersionStable
    && addedCaseIds.length === 0
    && removedCaseIds.length === 0
    && unexpectedDecisionChanges.length === 0
    && scoreDriftWithinLimit;
  return {
    name: current.name,
    currentPresent: true,
    baselinePresent: true,
    setVersion: { baseline: baseline.setVersion, current: current.setVersion },
    setVersionStable,
    versions: { baseline: baseline.versions, current: current.versions },
    migration: migrationReport,
    metricDeltas,
    changedDecisions,
    changedDecisionCount: changedDecisions.length,
    unexpectedDecisionChangeIds: unexpectedDecisionChanges.map((change) => change.id),
    unexpectedDecisionChangeCount: unexpectedDecisionChanges.length,
    addedCaseIds,
    removedCaseIds,
    addedCaseCount: addedCaseIds.length,
    removedCaseCount: removedCaseIds.length,
    maximumAbsoluteScoreDrift,
    allowedMaximumAbsoluteScoreDrift: allowedScoreDrift,
    scoreDriftWithinLimit,
    passed,
  };
}

function suiteReport(name, evaluation) {
  const definition = DATASETS.find((item) => item.name === name);
  return {
    name,
    setVersion: evaluation.setVersion,
    versions: definition?.versions ?? null,
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
    decisions: evaluation.rows.map(decisionReport),
  };
}

function decisionReport(row) {
  return {
    id: row.id,
    correct: row.actualCorrect,
    evidenceEligible: row.actualEvidenceEligible,
    reason: row.reason,
    requiresReview: row.actualRequiresReview,
    ...(row.actualClassification === null ? {} : { classification: row.actualClassification }),
    ...(row.actualSemanticStatus === null ? {} : { semanticStatus: row.actualSemanticStatus }),
    ...(row.actualScoreBand === null ? {} : { scoreBand: row.actualScoreBand }),
    ...(row.actualScore === null ? {} : { score: row.actualScore }),
    ...(row.actualAnchorId === null ? {} : { anchorId: row.actualAnchorId }),
    ...(row.actualConfidence === null ? {} : { confidence: row.actualConfidence }),
  };
}

function suiteMetrics(suite) {
  return Object.fromEntries(METRIC_FIELDS.map((field) => [field, suite[field] ?? null]));
}

function validBaseline(baseline) {
  if (baseline?.schemaVersion !== PRIVATE_TUTOR_BASELINE_SCHEMA_VERSION || !baseline.baselineId || !baseline.datasetFingerprint || !Array.isArray(baseline.suites)) return false;
  if (new Set(baseline.suites.map((suite) => suite.name)).size !== baseline.suites.length) return false;
  return baseline.suites.every((suite) => suite.name && suite.versions && suite.metrics && Array.isArray(suite.decisions)
    && suite.total === suite.decisions.length
    && suite.decisions.every((decision) => decision.id)
    && new Set(suite.decisions.map((decision) => decision.id)).size === suite.decisions.length);
}

function dataset({ name, setVersion, cases, versions }) {
  return Object.freeze({ name, setVersion, cases, versions: Object.freeze(versions) });
}

function versionDescriptor(evaluatorVersion, contentPackageVersion, rubricVersion, profile) {
  return { evaluatorVersion, contentPackageVersion, rubricVersion, profile };
}

function metricDelta(baseline, current) {
  const left = finiteNumber(baseline);
  const right = finiteNumber(current);
  return left === null || right === null ? null : round(right - left);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] ?? 0), 0);
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value, bigintReplacer)).digest("hex");
}

function bigintReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function round(value) {
  return Number(Number(value).toFixed(4));
}

function printHumanReport(report) {
  for (const suite of report.suites) {
    console.log(`Private tutor ${suite.name} eval ${suite.setVersion}: ${suite.matchedCount}/${suite.total} matched`);
    console.log(`False positives: ${suite.falsePositiveCount}; false negatives: ${suite.falseNegativeCount}; evidence leaks: ${suite.evidenceLeakCount}`);
    if (suite.anchorAgreementRate !== undefined) console.log(`Anchor agreement: ${suite.anchorAgreementRate}; repeatability: ${suite.repeatabilityRate}`);
    for (const failure of suite.failures) {
      console.error(`- ${failure.id}: ${failure.reason} (${failure.actualClassification ?? failure.actualSemanticStatus ?? failure.actualScoreBand ?? "no classification"})`);
    }
  }
  console.log(`Version drift: ${report.versionDrift.passed ? "PASS" : "FAIL"}; changed decisions ${report.versionDrift.summary.changedDecisionCount}; maximum score drift ${report.versionDrift.summary.maximumAbsoluteScoreDrift}`);
  console.log(`Release gate: ${report.passed ? "PASS" : "FAIL"}; dataset ${report.dataset.fingerprint}`);
  for (const [name, passed] of Object.entries(report.gates)) console.log(`- ${name}: ${passed ? "pass" : "fail"}`);
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  return value && !value.startsWith("--") ? value : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baselineArgument = argumentValue("--baseline");
  const reportPath = argumentValue("--report");
  const baselineCandidatePath = argumentValue("--baseline-candidate");
  const missingValueFlags = [
    ["--baseline", baselineArgument],
    ["--report", reportPath],
    ["--baseline-candidate", baselineCandidatePath],
  ].filter(([flag, value]) => process.argv.includes(flag) && !value).map(([flag]) => flag);
  if (missingValueFlags.length) {
    console.error(`${missingValueFlags.join(", ")} requires a path`);
    process.exitCode = 2;
  } else {
    const baseline = baselineArgument ? JSON.parse(await readFile(resolve(baselineArgument), "utf8")) : loadPrivateTutorEvaluationBaseline();
    const report = evaluatePrivateTutorReleaseGate({ baseline });
    if (reportPath) await writePrivateTutorReleaseReport(report, reportPath);
    if (baselineCandidatePath) {
      await writePrivateTutorReleaseReport(buildPrivateTutorEvaluationBaseline(report), baselineCandidatePath);
    }
    if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else printHumanReport(report);
    if (!report.passed) process.exitCode = 1;
  }
}
