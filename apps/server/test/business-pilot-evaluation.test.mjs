import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  evaluateCommercialPilotManifest,
  renderCommercialPilotMarkdown,
  validateCommercialPilotManifest,
} from "../src/services/business-pilot-evaluation.mjs";

const rehearsalPath = fileURLToPath(new URL(
  "./fixtures/workflow-memory/commercial-pilot-v1.5-rehearsal.json",
  import.meta.url,
));

function rehearsal() {
  return JSON.parse(readFileSync(rehearsalPath, "utf8"));
}

test("ten-case synthetic rehearsal proves the harness but cannot pass the formal gate", () => {
  const report = evaluateCommercialPilotManifest(rehearsal());
  assert.equal(report.validation.valid, true, JSON.stringify(report.validation));
  assert.equal(report.metrics.totalCaseCount, 10);
  assert.equal(report.metrics.formalCaseCount, 0);
  assert.equal(report.metrics.documents.top1, 1);
  assert.equal(report.metrics.relationships.top1, 1);
  assert.equal(report.metrics.relationships.top5, 1);
  assert.equal(report.metrics.outcomes.accuracy, 1);
  assert.equal(report.metrics.evidence.coverage, 1);
  assert.equal(report.metrics.duplicates.total, 0);
  assert.equal(report.metrics.approvals.coverage, 1);
  assert.equal(report.metrics.recovery.passRate, 1);
  assert.equal(report.metrics.safety.passRate, 1);
  assert.equal(report.coverage.passed, true);
  assert.equal(report.gate.rehearsalPassed, true);
  assert.equal(report.gate.passed, false);
  assert.equal(report.gate.decision, "no_go");
  assert.ok(report.gate.checks.some((check) =>
    check.key === "formal_case_count" && !check.passed));
});

test("consented deidentified cases require verified server provenance", () => {
  const manifest = rehearsal();
  manifest.pilotId = "deidentified-pilot";
  manifest.dataClassification = "deidentified";
  manifest.consent = {
    confirmed: true,
    recordedAt: "2026-07-30T00:00:00.000Z",
    scope: "Ten deidentified commercial cases approved for local V1.5 evaluation.",
  };
  const unverified = evaluateCommercialPilotManifest(manifest);
  assert.equal(unverified.formalEligible, false);
  assert.equal(unverified.gate.passed, false);
  manifest.evidenceReceipt = {
    id: "bper_verified",
    collectedAt: "2026-07-30T00:01:00.000Z",
  };
  const report = evaluateCommercialPilotManifest(manifest, { provenanceVerified: true });
  assert.equal(report.formalEligible, true);
  assert.equal(report.metrics.formalCaseCount, 10);
  assert.equal(report.gate.passed, true, JSON.stringify(report.gate, null, 2));
  assert.equal(report.gate.decision, "go");
});

test("pilot manifest rejects unknown fields and incomplete consent without echoing raw data", () => {
  const manifest = rehearsal();
  manifest.dataClassification = "real";
  manifest.consent = { confirmed: true };
  manifest.rawDocuments = ["customer secret"];
  manifest.cases[0].observed.rawContent = "do not report me";
  const validation = validateCommercialPilotManifest(manifest);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("manifest.rawDocuments: unexpected field"));
  assert.ok(validation.errors.includes("cases[0].observed.rawContent: unexpected field"));
  assert.ok(validation.errors.some((error) => error.startsWith("consent.recordedAt")));
  const report = evaluateCommercialPilotManifest(manifest);
  const markdown = renderCommercialPilotMarkdown(report);
  assert.doesNotMatch(JSON.stringify(report), /customer secret|do not report me/);
  assert.doesNotMatch(markdown, /customer secret|do not report me/);
  assert.equal(report.gate.rehearsalPassed, false);
});

test("formal gate fails closed on quality, approval, duplicate, safety, and recovery regressions", () => {
  const manifest = rehearsal();
  manifest.dataClassification = "deidentified";
  manifest.consent = {
    confirmed: true,
    recordedAt: "2026-07-30T00:00:00.000Z",
    scope: "Approved deidentified cases.",
  };
  manifest.evidenceReceipt = {
    id: "bper_regression",
    collectedAt: "2026-07-30T00:01:00.000Z",
  };
  manifest.cases[0].observed.duplicateLedgerRowCount = 1;
  manifest.cases[0].observed.outcome = "no_order";
  manifest.cases[1].observed.evidenceComplete = false;
  manifest.cases[1].observed.approvalCount = 0;
  manifest.cases[1].observed.approvalComplete = false;
  manifest.cases[3].observed.recoveries[0].passed = false;
  manifest.safetyScenarios[0].passed = false;
  manifest.releaseReview.privacy = false;
  const report = evaluateCommercialPilotManifest(manifest, {
    qualityGatePassed: false,
    provenanceVerified: true,
  });
  assert.equal(report.gate.passed, false);
  for (const key of [
    "quality_fixture_gate",
    "zero_duplicates",
    "case_outcome_accuracy",
    "evidence_coverage",
    "approval_coverage",
    "approval_integrity",
    "recovery_pass_rate",
    "safety_pass_rate",
    "release_review",
  ]) {
    assert.ok(report.gate.checks.some((check) => check.key === key && !check.passed), key);
  }
});

test("one case cannot compensate for another case's missing approval", () => {
  const manifest = rehearsal();
  manifest.cases[0].observed.approvalCount += 1;
  manifest.cases[1].observed.approvalCount -= 1;
  manifest.cases[1].observed.approvalComplete = false;
  const report = evaluateCommercialPilotManifest(manifest);
  assert.equal(report.metrics.approvals.coverage, 1);
  assert.equal(report.metrics.approvals.incompleteCaseCount, 1);
  assert.equal(
    report.gate.checks.find((check) => check.key === "approval_coverage").passed,
    true,
  );
  assert.equal(
    report.gate.checks.find((check) => check.key === "approval_integrity").passed,
    false,
  );
});

test("pilot report contains aggregate evidence and a plain go/no-go result", () => {
  const report = evaluateCommercialPilotManifest(rehearsal());
  const markdown = renderCommercialPilotMarkdown(report);
  assert.match(markdown, /Release decision: \*\*NO_GO\*\*/);
  assert.match(markdown, /Formal cases: 0/);
  assert.match(markdown, /formal_case_count/);
  assert.match(markdown, /does not contain raw pilot documents/);
});
