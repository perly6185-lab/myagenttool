import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  evaluateCommercialRoutineFixture,
} from "../src/services/business-routine-evaluation.mjs";

const fixturePath = fileURLToPath(new URL(
  "./fixtures/workflow-memory/commercial-routine-v1.4.json",
  import.meta.url,
));

function fixture() {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

test("commercial routine release fixture meets the deterministic quality gate", () => {
  const report = evaluateCommercialRoutineFixture(fixture());
  assert.equal(report.gate.passed, true, JSON.stringify(report, null, 2));
  assert.ok(report.evidence.caseCount >= 3);
  assert.ok(report.evidence.orderedCaseCount >= 1);
  assert.ok(report.evidence.noOrderCaseCount >= 1);
  assert.ok(report.evidence.duplicateBusinessKeys.some((row) =>
    row.businessKey === "INQ-001" && row.artifactIds.length === 2));
  assert.equal(report.metrics.documents.forcedGuessCount, 0);
  assert.equal(report.metrics.relationships.top5, 1);
  assert.equal(report.metrics.routine.precision, 1);
  assert.equal(report.metrics.routine.recall, 1);
  assert.equal(report.metrics.routine.requirementAccuracy, 1);
  assert.equal(report.metrics.safety.detectionRate, 1);
});

test("commercial routine fixture names every required safety and recovery scenario", () => {
  const report = evaluateCommercialRoutineFixture(fixture());
  assert.deepEqual(new Set(report.evidence.safetyScenarioIds), new Set([
    "path-traversal",
    "escaping-symlink",
    "secret-like-field",
    "prompt-injection",
    "malicious-formula",
    "stale-approval",
    "cross-tenant",
    "unsupported-provider-transfer",
  ]));
  assert.deepEqual(new Set(report.evidence.recoveryScenarioIds), new Set([
    "duplicate-intake",
    "scan-restart",
    "step-restart",
    "concurrent-ledger-edit",
    "post-rename-recovery",
  ]));
});

test("commercial routine gate fails closed when expected truth drifts", () => {
  const changed = fixture();
  changed.expectedRoutine.steps.push({
    key: "unsupported_silent_send",
    requirement: "mandatory",
  });
  const report = evaluateCommercialRoutineFixture(changed);
  assert.equal(report.gate.passed, false);
  assert.ok(report.metrics.routine.missingStepKeys.includes("unsupported_silent_send"));
  assert.ok(report.gate.checks.some((check) =>
    check.key === "routine_step_recall" && !check.passed));
});
