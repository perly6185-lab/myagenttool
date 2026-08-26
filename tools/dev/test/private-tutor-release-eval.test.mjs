import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseWorkflowJobs } from "../ci-simulate.mjs";
import {
  evaluatePrivateTutorReleaseGate,
  PRIVATE_TUTOR_DATASET_FINGERPRINT,
  PRIVATE_TUTOR_RELEASE_THRESHOLDS,
  privateTutorDatasetFingerprint,
  runPrivateTutorReleaseEvaluations,
} from "../private-tutor-eval.mjs";

test("private tutor release evaluation uses a fixed three-suite dataset", () => {
  const report = evaluatePrivateTutorReleaseGate();
  assert.equal(privateTutorDatasetFingerprint(), PRIVATE_TUTOR_DATASET_FINGERPRINT);
  assert.deepEqual(report.dataset.suites, [
    { name: "math-step", setVersion: "1.0.0", total: 14 },
    { name: "language-semantic", setVersion: "1.0.0", total: 19 },
    { name: "conceptual-rubric", setVersion: "1.0.0", total: 11 },
  ]);
  assert.equal(report.metrics.totalCases, 44);
});

test("private tutor release evaluation clears every strict quality gate", () => {
  const report = evaluatePrivateTutorReleaseGate();
  assert.equal(PRIVATE_TUTOR_RELEASE_THRESHOLDS.minimumPassRate, 1);
  assert.equal(PRIVATE_TUTOR_RELEASE_THRESHOLDS.maximumFalsePositiveCount, 0);
  assert.equal(PRIVATE_TUTOR_RELEASE_THRESHOLDS.maximumFalseNegativeCount, 0);
  assert.equal(PRIVATE_TUTOR_RELEASE_THRESHOLDS.maximumEvidenceLeakCount, 0);
  assert.equal(PRIVATE_TUTOR_RELEASE_THRESHOLDS.minimumAnchorAgreementRate, 1);
  assert.equal(PRIVATE_TUTOR_RELEASE_THRESHOLDS.minimumRepeatabilityRate, 1);
  assert.equal(report.metrics.matchedCases, 44);
  assert.equal(report.passed, true, JSON.stringify(report, null, 2));
  assert.equal(Object.values(report.gates).every(Boolean), true);
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
