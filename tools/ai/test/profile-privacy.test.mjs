import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluateProfileAcceptance,
  formatProfileAcceptanceReport,
  loadProfileAcceptanceSet,
  loadProfilePredictions,
} from "../src/evals/profile-privacy.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const setDirectory = resolve(testDirectory, "../evals/profile-privacy/cases");
const predictionsPath = resolve(testDirectory, "../evals/profile-privacy/baseline-predictions.json");

test("profile acceptance set covers three Office work scenarios with privacy and false-positive traps", () => {
  const cases = loadProfileAcceptanceSet(setDirectory);
  assert.deepEqual([...new Set(cases.map((caseObj) => caseObj.scenario))].sort(), [
    "business",
    "procurement",
    "warehouse",
  ]);
  assert.ok(cases.every((caseObj) => ["docx", "pptx", "xlsx"].includes(caseObj.document.format)));
  assert.ok(cases.every((caseObj) => caseObj.oracle.sensitiveFields.length >= 2));
  assert.ok(cases.every((caseObj) => caseObj.oracle.falsePositiveTraits.length >= 2));
  assert.ok(cases.flatMap((caseObj) => caseObj.oracle.sensitiveFields).every((field) => field.synthetic));
});

test("checked-in baseline passes deterministically without echoing sensitive values", () => {
  const cases = loadProfileAcceptanceSet(setDirectory);
  const predictions = loadProfilePredictions(predictionsPath);
  const first = evaluateProfileAcceptance({ cases, predictions });
  const second = evaluateProfileAcceptance({ cases, predictions });
  assert.deepEqual(first, second);
  assert.equal(first.passed, true);
  assert.equal(first.metrics.recall, 1);
  assert.equal(first.metrics.precision, 1);
  assert.equal(first.metrics.privacyViolationCount, 0);
  assert.equal(first.metrics.falsePositiveCount, 0);

  const report = formatProfileAcceptanceReport(first);
  for (const field of cases.flatMap((caseObj) => caseObj.oracle.sensitiveFields)) {
    assert.equal(report.includes(field.value), false, `report leaked ${field.id}`);
  }
});

test("evaluator catches sensitive traits, obfuscated value echoes, and planted misclassification", () => {
  const cases = loadProfileAcceptanceSet(setDirectory);
  const predictions = loadProfilePredictions(predictionsPath);
  const tampered = structuredClone(predictions);
  tampered[0].traits.push("work.management.people_manager", "personal.contact.phone");
  tampered[0].narrative += " 联系值 SYNTH PHONE PROC 001";

  const summary = evaluateProfileAcceptance({ cases, predictions: tampered });
  const result = summary.results.find((item) => item.id === "ppq-001-procurement");
  assert.equal(summary.passed, false);
  assert.equal(summary.metrics.falsePositiveCount, 1);
  assert.equal(summary.metrics.privacyViolationCount, 2);
  assert.deepEqual(result.falsePositiveTraits, ["work.management.people_manager"]);
  assert.deepEqual(result.sensitiveTraitHits, ["personal.contact.phone"]);
  assert.deepEqual(result.leakedFieldIds, ["supplier_contact_phone"]);
});

test("missing cases reduce recall and unexpected case ids fail the acceptance gate", () => {
  const cases = loadProfileAcceptanceSet(setDirectory);
  const predictions = loadProfilePredictions(predictionsPath).slice(0, 2);
  predictions.push({
    caseId: "not-in-corpus",
    traits: ["work.unknown"],
    narrative: "",
  });
  const summary = evaluateProfileAcceptance({ cases, predictions });
  assert.equal(summary.metrics.recall, 2 / 3);
  assert.deepEqual(summary.unexpectedCaseIds, ["not-in-corpus"]);
  assert.equal(summary.passed, false);
});
