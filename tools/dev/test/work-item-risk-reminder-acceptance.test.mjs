import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateRiskReminderAcceptance,
  loadRiskReminderAcceptanceDataset,
  riskReminderAcceptanceDatasetDigest,
  validateRiskReminderAcceptanceDataset,
} from "../work-item-risk-reminder-acceptance.mjs";

const dataset = loadRiskReminderAcceptanceDataset();

function completeRecord({ participants = 5 } = {}) {
  const people = Array.from({ length: participants }, (_, index) => ({
    id: `participant-${String(index + 1).padStart(2, "0")}`,
    profile: "ordinary_user",
  }));
  return {
    schemaVersion: 1,
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
    datasetDigest: riskReminderAcceptanceDatasetDigest(dataset),
    surface: {
      version: dataset.surface.version,
      productCommit: "a".repeat(40),
      sourceState: "clean",
      locale: dataset.surface.locale,
      viewport: { width: 1440, height: 900 },
    },
    study: { completedAt: "2026-09-01T09:00:00.000Z", facilitatorAttestation: true, notes: "Controlled session." },
    participants: people,
    observations: people.flatMap((participant) => dataset.scenarios.map((scenario) => ({
      participantId: participant.id,
      scenarioId: scenario.id,
      professionalDetailsOpenedBeforeAnswers: false,
      durationBucket: "under_30s",
      answers: Object.fromEntries(dataset.questions.map((question) => [question.id, "correct"])),
      criticalMisconceptions: [],
    }))),
    findings: [],
  };
}

test("the acceptance dataset fixes eight sanitized scenarios and four questions", () => {
  const validation = validateRiskReminderAcceptanceDataset(dataset);
  assert.equal(validation.valid, true, validation.errors.join(", "));
  assert.equal(dataset.scenarios.length, 8);
  assert.deepEqual(dataset.questions.map((question) => question.id), ["what_happened", "why", "next_step", "action_impact"]);
  assert.equal(dataset.policy.minimumAnswerAccuracy, 0.9);
  assert.equal(validation.datasetDigest?.length, 64);
});

test("participant-visible scenarios cannot drift from the scoring dataset", () => {
  const changed = structuredClone(dataset);
  changed.scenarios[0].participantView.status = "Changed without updating the UI surface";
  const validation = validateRiskReminderAcceptanceDataset(changed);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("participant_surface_projection_mismatch"));
});

test("five complete ordinary-user sessions can clear the acceptance gate", () => {
  const report = evaluateRiskReminderAcceptance(completeRecord());
  assert.equal(report.metrics.totalAnswers, 160);
  assert.equal(report.metrics.independentAnswerAccuracy, 1);
  assert.equal(report.releaseReady, true, JSON.stringify(report, null, 2));
});

test("an incomplete participant matrix fails closed", () => {
  const record = completeRecord();
  record.observations.pop();
  const report = evaluateRiskReminderAcceptance(record);
  assert.equal(report.gates.completeScenarioCoverage, false);
  assert.ok(report.validationErrors.includes("observation_matrix_incomplete"));
  assert.equal(report.releaseReady, false);
});

test("the empty observation template is blocked without inventing usability findings", () => {
  const report = evaluateRiskReminderAcceptance({
    schemaVersion: 1,
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
    datasetDigest: riskReminderAcceptanceDatasetDigest(dataset),
    surface: {
      version: dataset.surface.version,
      productCommit: "a".repeat(40),
      sourceState: "clean",
      locale: dataset.surface.locale,
      viewport: { width: 1440, height: 900 },
    },
    study: { completedAt: null, facilitatorAttestation: false, notes: "" },
    participants: [],
    observations: [],
    findings: [],
  });
  assert.equal(report.gates.minimumParticipants, false);
  assert.equal(report.gates.completeScenarioCoverage, false);
  assert.deepEqual(report.findings, []);
  assert.equal(report.releaseReady, false);
});

test("scores below 90 percent cannot pass even when the record is complete", () => {
  const record = completeRecord();
  for (const observation of record.observations.slice(0, 5)) {
    for (const question of dataset.questions) observation.answers[question.id] = "incorrect";
  }
  const report = evaluateRiskReminderAcceptance(record);
  assert.equal(report.metrics.independentAnswerAccuracy, 0.875);
  assert.equal(report.gates.minimumAnswerAccuracy, false);
  assert.equal(report.releaseReady, false);
});

test("a study cannot be replayed against mutated same-version scenarios", () => {
  const record = completeRecord();
  record.datasetDigest = "0".repeat(64);
  const report = evaluateRiskReminderAcceptance(record);
  assert.ok(report.validationErrors.includes("dataset_binding_mismatch"));
  assert.equal(report.releaseReady, false);
});

test("a study must bind the exact UI surface, candidate commit, locale, and viewport", () => {
  const invalidCommit = completeRecord();
  invalidCommit.surface.productCommit = "dev";
  assert.ok(evaluateRiskReminderAcceptance(invalidCommit).validationErrors.includes("acceptance_surface_binding_invalid"));
  const wrongLocale = completeRecord();
  wrongLocale.surface.locale = "en-US";
  assert.ok(evaluateRiskReminderAcceptance(wrongLocale).validationErrors.includes("acceptance_surface_binding_invalid"));
  const narrowViewport = completeRecord();
  narrowViewport.surface.viewport.width = 1024;
  assert.ok(evaluateRiskReminderAcceptance(narrowViewport).validationErrors.includes("acceptance_surface_binding_invalid"));
  const dirtyBuild = completeRecord();
  dirtyBuild.surface.sourceState = "dirty";
  assert.ok(evaluateRiskReminderAcceptance(dirtyBuild).validationErrors.includes("acceptance_surface_binding_invalid"));
});

test("opening professional details does not count toward independent comprehension", () => {
  const record = completeRecord();
  for (const observation of record.observations.slice(0, 5)) observation.professionalDetailsOpenedBeforeAnswers = true;
  const report = evaluateRiskReminderAcceptance(record);
  assert.equal(report.metrics.answerAccuracy, 1);
  assert.equal(report.metrics.independentAnswerAccuracy, 0.875);
  assert.equal(report.releaseReady, false);
});

test("either critical misconception blocks an otherwise perfect study", () => {
  for (const misconception of dataset.criticalMisconceptions) {
    const record = completeRecord();
    record.observations[0].criticalMisconceptions.push(misconception);
    const report = evaluateRiskReminderAcceptance(record);
    assert.equal(report.metrics.criticalMisconceptionCount, 1);
    assert.equal(report.gates.noCriticalMisconceptions, false);
    assert.equal(report.releaseReady, false);
  }
});

test("sensitive or verbatim observation fields are rejected", () => {
  const record = completeRecord();
  record.observations[0].rawAnswer = "participant verbatim response";
  const report = evaluateRiskReminderAcceptance(record);
  assert.ok(report.validationErrors.includes("sensitive_observation_field_present"));
  assert.ok(report.validationErrors.includes("observation_field_not_allowed"));
  assert.equal(report.releaseReady, false);
});

test("participant identities and arbitrary finding fields fail closed", () => {
  const record = completeRecord();
  record.participants[0].id = "Alice";
  for (const observation of record.observations) {
    if (observation.participantId === "participant-01") observation.participantId = "Alice";
  }
  record.findings.push({
    scenarioId: "development_ready",
    issueCode: "custom_issue",
    severity: "medium",
    status: "open",
    summary: "Needs review.",
  });
  const report = evaluateRiskReminderAcceptance(record);
  assert.ok(report.validationErrors.includes("participant_id_not_anonymous"));
  assert.ok(report.validationErrors.includes("finding_invalid"));
  assert.equal(report.releaseReady, false);
});
