import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { privateTutorEvaluationMigrations, resolvePrivateTutorEvaluationMigration } from "../../../apps/server/src/services/private-tutor-evaluation-migrations.mjs";
import { runPrivateTutorDoubleAnnotationEvaluation } from "../../../apps/server/src/services/private-tutor-double-annotation.mjs";
import { parseWorkflowJobs } from "../ci-simulate.mjs";
import {
  buildPrivateTutorEvaluationBaseline,
  comparePrivateTutorEvaluationBaseline,
  evaluatePrivateTutorQuality,
  evaluatePrivateTutorReleaseGate,
  loadPrivateTutorEvaluationBaseline,
  PRIVATE_TUTOR_DATASET_FINGERPRINT,
  PRIVATE_TUTOR_RELEASE_THRESHOLDS,
  privateTutorDatasetFingerprint,
  runPrivateTutorReleaseEvaluations,
} from "../private-tutor-eval.mjs";

test("private tutor release evaluation uses a fixed three-suite dataset", () => {
  const report = evaluatePrivateTutorReleaseGate();
  assert.equal(privateTutorDatasetFingerprint(), PRIVATE_TUTOR_DATASET_FINGERPRINT);
  assert.deepEqual(report.dataset.suites.map(({ name, setVersion, total }) => ({ name, setVersion, total })), [
    { name: "math-step", setVersion: "1.0.0", total: 14 },
    { name: "language-semantic", setVersion: "1.0.0", total: 19 },
    { name: "conceptual-rubric", setVersion: "1.0.0", total: 11 },
  ]);
  assert.deepEqual(report.dataset.suites.map((suite) => suite.versions.evaluatorVersion), ["2.0.0", "2.0.0", "2.0.0"]);
  assert.equal(report.dataset.doubleAnnotation.setVersion, "1.0.0");
  assert.equal(report.dataset.doubleAnnotation.total, 12);
  assert.equal(report.metrics.totalCases, 56);
});

test("the committed baseline exactly matches the current versioned decisions", () => {
  const baseline = loadPrivateTutorEvaluationBaseline();
  const generated = buildPrivateTutorEvaluationBaseline(evaluatePrivateTutorQuality());
  assert.deepEqual(baseline, generated);
  assert.equal(baseline.suites.reduce((total, suite) => total + suite.decisions.length, 0), 44);
});

test("a malformed baseline manifest fails closed", () => {
  const baseline = structuredClone(loadPrivateTutorEvaluationBaseline());
  baseline.suites[0].total -= 1;
  const report = evaluatePrivateTutorReleaseGate({ baseline });
  assert.equal(report.gates["versionDrift.baselineManifest"], false);
  assert.equal(report.versionDrift.baselineFingerprint, null);
  assert.equal(report.passed, false);
});

test("private tutor release evaluation clears every strict quality gate", () => {
  const report = evaluatePrivateTutorReleaseGate();
  assert.equal(PRIVATE_TUTOR_RELEASE_THRESHOLDS.minimumPassRate, 1);
  assert.equal(PRIVATE_TUTOR_RELEASE_THRESHOLDS.maximumFalsePositiveCount, 0);
  assert.equal(PRIVATE_TUTOR_RELEASE_THRESHOLDS.maximumFalseNegativeCount, 0);
  assert.equal(PRIVATE_TUTOR_RELEASE_THRESHOLDS.maximumEvidenceLeakCount, 0);
  assert.equal(PRIVATE_TUTOR_RELEASE_THRESHOLDS.minimumAnchorAgreementRate, 1);
  assert.equal(PRIVATE_TUTOR_RELEASE_THRESHOLDS.minimumRepeatabilityRate, 1);
  assert.equal(PRIVATE_TUTOR_RELEASE_THRESHOLDS.minimumDoubleAnnotatedCases, 12);
  assert.equal(PRIVATE_TUTOR_RELEASE_THRESHOLDS.minimumInterRaterKappa, 0.6);
  assert.equal(PRIVATE_TUTOR_RELEASE_THRESHOLDS.minimumAdjudicationCompletionRate, 1);
  assert.equal(PRIVATE_TUTOR_RELEASE_THRESHOLDS.minimumAdjudicatedEvaluatorAgreementRate, 1);
  assert.equal(report.metrics.matchedCases, 56);
  assert.equal(report.metrics.doubleAnnotatedCases, 12);
  assert.equal(report.metrics.interRaterExactAgreementRate, 0.8333);
  assert.equal(report.metrics.interRaterKappa, 0.6667);
  assert.equal(report.metrics.scoreBandAgreementRate, 1);
  assert.equal(report.metrics.adjudicationCompletionRate, 1);
  assert.equal(report.metrics.adjudicatedEvaluatorAgreementRate, 1);
  assert.equal(report.versionDrift.summary.changedDecisionCount, 0);
  assert.equal(report.versionDrift.summary.maximumAbsoluteScoreDrift, 0);
  assert.equal(report.versionDrift.passed, true);
  assert.equal(report.passed, true, JSON.stringify(report, null, 2));
  assert.equal(Object.values(report.gates).every(Boolean), true);
});

test("an unreviewed per-answer score change is reported and blocks release", () => {
  const evaluations = structuredClone(runPrivateTutorReleaseEvaluations());
  const conceptual = evaluations.find(([name]) => name === "conceptual-rubric")[1];
  conceptual.rows.find((row) => row.id === "proficient-grounded-zh").actualScore = 0.7;
  const report = evaluatePrivateTutorReleaseGate({ evaluations });
  const drift = report.versionDrift.suites.find((suite) => suite.name === "conceptual-rubric");
  assert.equal(report.gates.caseMatches, true, "golden expectations still pass in this simulated regression");
  assert.equal(drift.changedDecisionCount, 1);
  assert.deepEqual(drift.changedDecisions[0].changedFields, ["score"]);
  assert.equal(drift.changedDecisions[0].scoreDelta, -0.3);
  assert.equal(drift.maximumAbsoluteScoreDrift, 0.3);
  assert.equal(report.gates["versionDrift.decisionDriftReviewed"], false);
  assert.equal(report.gates["versionDrift.scoreDriftWithinLimit"], false);
  assert.equal(report.passed, false);
});

test("an evaluator version change without a registered migration blocks release", () => {
  const baseline = structuredClone(loadPrivateTutorEvaluationBaseline());
  baseline.suites.find((suite) => suite.name === "math-step").versions.evaluatorVersion = "1.9.0";
  const report = evaluatePrivateTutorReleaseGate({ baseline });
  const math = report.versionDrift.suites.find((suite) => suite.name === "math-step");
  assert.equal(math.migration.status, "missing");
  assert.equal(report.gates["versionDrift.migrationsResolved"], false);
  assert.equal(report.passed, false);
});

test("an incomplete migration or changed evaluation-set version cannot clear the gate", () => {
  const quality = evaluatePrivateTutorQuality();
  const baseline = structuredClone(loadPrivateTutorEvaluationBaseline());
  const baselineMath = baseline.suites.find((suite) => suite.name === "math-step");
  const currentMath = quality.suites.find((suite) => suite.name === "math-step");
  baselineMath.versions.evaluatorVersion = "1.9.0";
  baselineMath.setVersion = "0.9.0";
  const migration = {
    id: "pending-math-migration",
    suite: "math-step",
    from: baselineMath.versions,
    to: currentMath.versions,
    compatibility: "breaking",
    status: "pending_review",
    reviewedDecisionChangeIds: [],
    maximumAbsoluteScoreDrift: 0,
  };
  const report = evaluatePrivateTutorReleaseGate({ baseline, migrations: [migration] });
  const math = report.versionDrift.suites.find((suite) => suite.name === "math-step");
  assert.equal(math.migration.status, "incomplete");
  assert.equal(math.setVersionStable, false);
  assert.equal(report.gates["versionDrift.migrationsResolved"], false);
  assert.equal(report.gates["versionDrift.evaluationSetVersions"], false);
  assert.equal(report.passed, false);
});

test("a registered migration can approve named decision and score drift", () => {
  const quality = evaluatePrivateTutorQuality();
  const baseline = structuredClone(loadPrivateTutorEvaluationBaseline());
  const baselineSuite = baseline.suites.find((suite) => suite.name === "conceptual-rubric");
  baselineSuite.versions.evaluatorVersion = "1.9.0";
  baselineSuite.decisions.find((decision) => decision.id === "developing-missing-source").score = 0.8;
  const currentSuite = quality.suites.find((suite) => suite.name === "conceptual-rubric");
  const migration = {
    id: "test-reviewed-concept-migration",
    suite: "conceptual-rubric",
    from: baselineSuite.versions,
    to: currentSuite.versions,
    compatibility: "breaking",
    status: "completed",
    reviewedDecisionChangeIds: ["developing-missing-source"],
    maximumAbsoluteScoreDrift: 0.05,
  };
  const drift = comparePrivateTutorEvaluationBaseline(quality, baseline, { migrations: [migration] });
  const conceptual = drift.suites.find((suite) => suite.name === "conceptual-rubric");
  assert.equal(conceptual.migration.status, "resolved");
  assert.equal(conceptual.changedDecisionCount, 1);
  assert.equal(conceptual.unexpectedDecisionChangeCount, 0);
  assert.equal(conceptual.maximumAbsoluteScoreDrift, 0.05);
  assert.equal(drift.passed, true);
});

test("historical v1 to v2 migrations preserve old evidence and require replay", () => {
  assert.equal(privateTutorEvaluationMigrations.length, 3);
  assert.equal(new Set(privateTutorEvaluationMigrations.map((migration) => migration.suite)).size, 3);
  for (const migration of privateTutorEvaluationMigrations) {
    assert.equal(resolvePrivateTutorEvaluationMigration(migration.suite, migration.from, migration.to), migration);
    assert.equal(migration.compatibility, "breaking");
    assert.equal(migration.historicalEvidencePolicy, "preserve_original_decision");
    assert.equal(migration.migrationPolicy, "versioned_replay_and_review_required");
  }
});

test("a mismatch, false positive, or evidence leak blocks the release gate", () => {
  const evaluations = structuredClone(runPrivateTutorReleaseEvaluations());
  const math = evaluations.find(([name]) => name === "math-step")[1];
  math.matchedCount -= 1;
  math.passRate = math.matchedCount / math.total;
  math.falsePositiveCount = 1;
  math.falseNegativeCount = 1;
  math.evidenceLeakCount = 1;
  math.passed = false;
  const report = evaluatePrivateTutorReleaseGate({ evaluations });
  assert.equal(report.gates.caseMatches, false);
  assert.equal(report.gates.falsePositives, false);
  assert.equal(report.gates.falseNegatives, false);
  assert.equal(report.gates.evidenceLeaks, false);
  assert.equal(report.passed, false);
});

test("conceptual anchor disagreement or nondeterminism blocks the release gate", () => {
  const evaluations = structuredClone(runPrivateTutorReleaseEvaluations());
  const conceptual = evaluations.find(([name]) => name === "conceptual-rubric")[1];
  conceptual.anchorAgreementRate = 0.99;
  conceptual.repeatabilityRate = 0.99;
  const report = evaluatePrivateTutorReleaseGate({ evaluations });
  assert.equal(report.gates.anchorAgreement, false);
  assert.equal(report.gates.repeatability, false);
  assert.equal(report.passed, false);
});

test("insufficient double annotation consistency or unfinished adjudication blocks release", () => {
  const doubleAnnotation = structuredClone(runPrivateTutorDoubleAnnotationEvaluation());
  doubleAnnotation.doubleAnnotatedCount = 11;
  doubleAnnotation.interRaterKappa = 0.5;
  doubleAnnotation.adjudicationCompletionRate = 0.9;
  doubleAnnotation.adjudicatedEvaluatorAgreementRate = 0.99;
  const report = evaluatePrivateTutorReleaseGate({ doubleAnnotation });
  assert.equal(report.gates.doubleAnnotationCoverage, false);
  assert.equal(report.gates.interRaterConsistency, false);
  assert.equal(report.gates.adjudicationComplete, false);
  assert.equal(report.gates.adjudicatedEvaluatorAgreement, false);
  assert.equal(report.passed, false);
});

test("omitting a required subject suite blocks the release gate", () => {
  const evaluations = runPrivateTutorReleaseEvaluations().filter(([name]) => name !== "language-semantic");
  const report = evaluatePrivateTutorReleaseGate({ evaluations });
  assert.equal(report.gates.requiredSuites, false);
  assert.equal(report.passed, false);
});

test("CI and release workflows both enforce and retain the private tutor report", async () => {
  const ciYaml = await readFile(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const ciJobs = parseWorkflowJobs(ciYaml);
  const evalGate = ciJobs.get("eval-gates");
  assert.ok(evalGate);
  assert.deepEqual(
    evalGate.steps.find((step) => step.name === "Private tutor evaluation release gate")?.run,
    ["pnpm release:private-tutor -- --report .myagenttool/evaluations/private-tutor-release.json"],
  );
  const ciArtifact = evalGate.steps.find((step) => step.name === "Upload private tutor evaluation evidence");
  assert.equal(ciArtifact?.uses, "actions/upload-artifact@v4");

  const releaseYaml = await readFile(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(releaseYaml, /- name: Private tutor evaluation release gate\s+run: pnpm release:private-tutor -- --report \.myagenttool\/release-candidate\/private-tutor-evaluation\.json/);
  assert.match(releaseYaml, /path: \.myagenttool\/release-candidate\/\*\.json/);
});
