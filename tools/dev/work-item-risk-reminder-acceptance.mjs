import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const datasetUrl = new URL("../../packages/protocol/src/risk-reminder-user-acceptance-v1.json", import.meta.url);
const participantSurfaceUrl = new URL("../../apps/web/src/features/tasks/risk-reminder-acceptance-surface-v1.json", import.meta.url);
const questionIds = ["what_happened", "why", "next_step", "action_impact"];
const answerRatings = new Set(["correct", "incorrect", "not_answered"]);
const durationBuckets = new Set(["under_30s", "30_to_60s", "over_60s", "not_recorded"]);
const prohibitedKeyPattern = /(name|email|phone|title|filename|filepath|command|output|transcript|rawanswer|content|credential|secret|token)/i;
const findingIssueCodes = new Set(["scenario_comprehension_below_target", "critical_misconception", "facilitator_observation"]);
const findingSeverities = new Set(["low", "medium", "high"]);
const findingStatuses = new Set(["open", "resolved"]);

export function loadRiskReminderAcceptanceDataset() {
  return JSON.parse(readFileSync(datasetUrl, "utf8"));
}

export function loadRiskReminderParticipantSurface() {
  return JSON.parse(readFileSync(participantSurfaceUrl, "utf8"));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function riskReminderAcceptanceDatasetDigest(dataset = loadRiskReminderAcceptanceDataset()) {
  return createHash("sha256").update(JSON.stringify(stableValue(dataset))).digest("hex");
}

export function validateRiskReminderAcceptanceDataset(dataset = loadRiskReminderAcceptanceDataset()) {
  const errors = [];
  const participantSurface = loadRiskReminderParticipantSurface();
  const scenarioIds = dataset?.scenarios?.map((scenario) => scenario.id) ?? [];
  const requiredIds = dataset?.policy?.requiredScenarioIds ?? [];
  if (dataset?.datasetId !== "risk-reminder-user-acceptance") errors.push("dataset_id_invalid");
  if (!/^\d+\.\d+\.\d+$/.test(dataset?.datasetVersion ?? "")) errors.push("dataset_version_invalid");
  if (scenarioIds.length !== 8 || new Set(scenarioIds).size !== scenarioIds.length) errors.push("scenario_catalog_invalid");
  if (requiredIds.length !== 8 || requiredIds.some((id) => !scenarioIds.includes(id))) errors.push("required_scenarios_missing");
  if (JSON.stringify(dataset?.questions?.map((question) => question.id)) !== JSON.stringify(questionIds)) errors.push("question_catalog_invalid");
  if (dataset?.policy?.minimumParticipants < 5) errors.push("minimum_participants_too_low");
  if (dataset?.policy?.minimumAnswerAccuracy !== 0.9) errors.push("answer_accuracy_threshold_invalid");
  if (dataset?.policy?.maximumCriticalMisconceptions !== 0) errors.push("critical_misconception_threshold_invalid");
  if (dataset?.surface?.version !== "risk-reminder-ui-v1"
    || dataset?.surface?.route !== "/_acceptance/risk-reminders"
    || dataset?.surface?.locale !== dataset?.language
    || dataset?.surface?.viewport?.minimumWidth < 1280
    || dataset?.surface?.viewport?.minimumHeight < 720
    || dataset?.surface?.viewport?.maximumWidth < dataset?.surface?.viewport?.minimumWidth
    || dataset?.surface?.viewport?.maximumHeight < dataset?.surface?.viewport?.minimumHeight) errors.push("surface_contract_invalid");
  if (participantSurface?.datasetId !== dataset?.datasetId
    || participantSurface?.datasetVersion !== dataset?.datasetVersion
    || JSON.stringify(participantSurface?.surface) !== JSON.stringify(dataset?.surface)
    || JSON.stringify(participantSurface?.scenarios) !== JSON.stringify((dataset?.scenarios ?? []).map(({ id, domain, participantView }) => ({ id, domain, participantView })))) errors.push("participant_surface_projection_mismatch");
  for (const scenario of dataset?.scenarios ?? []) {
    if (!scenario.participantView || !scenario.facilitatorGuide) errors.push(`scenario_incomplete:${scenario.id ?? "unknown"}`);
    if (questionIds.some((id) => typeof scenario.facilitatorGuide?.[id] !== "string")) errors.push(`facilitator_guide_incomplete:${scenario.id ?? "unknown"}`);
  }
  return { valid: errors.length === 0, errors, datasetDigest: errors.length ? null : riskReminderAcceptanceDatasetDigest(dataset) };
}

function findProhibitedObservationKeys(value, path = "") {
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => found.push(...findProhibitedObservationKeys(entry, `${path}[${index}]`)));
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (prohibitedKeyPattern.test(key) && !["datasetId", "datasetVersion"].includes(key)) found.push(nextPath);
      found.push(...findProhibitedObservationKeys(entry, nextPath));
    }
  }
  return found;
}

function unexpectedKeys(value, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).filter((key) => !allowedKeys.includes(key));
}

export function evaluateRiskReminderAcceptance(record, dataset = loadRiskReminderAcceptanceDataset()) {
  const datasetValidation = validateRiskReminderAcceptanceDataset(dataset);
  const validationErrors = [...datasetValidation.errors];
  const scenarioIds = dataset.policy.requiredScenarioIds;
  const scenarioSet = new Set(scenarioIds);
  const criticalSet = new Set(dataset.criticalMisconceptions);
  const participants = Array.isArray(record?.participants) ? record.participants : [];
  const observations = Array.isArray(record?.observations) ? record.observations : [];
  const submittedFindings = Array.isArray(record?.findings) ? record.findings : [];
  const participantIds = participants.map((participant) => participant.id);
  const participantSet = new Set(participantIds);
  const surface = record?.surface;
  const surfaceBindingValid = surface?.version === dataset.surface.version
    && /^[a-f0-9]{40}$/.test(surface?.productCommit ?? "")
    && surface?.sourceState === "clean"
    && surface?.locale === dataset.surface.locale
    && Number.isInteger(surface?.viewport?.width)
    && Number.isInteger(surface?.viewport?.height)
    && surface.viewport.width >= dataset.surface.viewport.minimumWidth
    && surface.viewport.width <= dataset.surface.viewport.maximumWidth
    && surface.viewport.height >= dataset.surface.viewport.minimumHeight
    && surface.viewport.height <= dataset.surface.viewport.maximumHeight;

  if (record?.schemaVersion !== 1) validationErrors.push("record_schema_version_invalid");
  if (record?.datasetId !== dataset.datasetId
    || record?.datasetVersion !== dataset.datasetVersion
    || record?.datasetDigest !== datasetValidation.datasetDigest) validationErrors.push("dataset_binding_mismatch");
  if (!record?.study?.completedAt || Number.isNaN(Date.parse(record.study.completedAt))) validationErrors.push("study_completion_missing");
  if (record?.study?.facilitatorAttestation !== true) validationErrors.push("facilitator_attestation_missing");
  if (!surfaceBindingValid) validationErrors.push("acceptance_surface_binding_invalid");
  if (participantIds.length !== participantSet.size) validationErrors.push("duplicate_participant_id");
  if (participants.some((participant) => participant.profile !== dataset.policy.requiredParticipantProfile)) validationErrors.push("participant_profile_invalid");
  if (participants.some((participant) => !/^participant-\d{2,}$/.test(participant.id ?? ""))) validationErrors.push("participant_id_not_anonymous");
  if (unexpectedKeys(record, ["schemaVersion", "datasetId", "datasetVersion", "datasetDigest", "surface", "study", "participants", "observations", "findings"]).length) validationErrors.push("record_field_not_allowed");
  if (unexpectedKeys(surface, ["version", "productCommit", "sourceState", "locale", "viewport"]).length
    || unexpectedKeys(surface?.viewport, ["width", "height"]).length) validationErrors.push("surface_field_not_allowed");
  if (unexpectedKeys(record?.study, ["completedAt", "facilitatorAttestation", "notes"]).length) validationErrors.push("study_field_not_allowed");
  if (typeof record?.study?.notes === "string" && record.study.notes.length > 500) validationErrors.push("study_notes_too_long");
  if (participants.some((participant) => unexpectedKeys(participant, ["id", "profile"]).length)) validationErrors.push("participant_field_not_allowed");
  if (observations.some((observation) => unexpectedKeys(observation, ["participantId", "scenarioId", "professionalDetailsOpenedBeforeAnswers", "durationBucket", "answers", "criticalMisconceptions"]).length)) validationErrors.push("observation_field_not_allowed");
  if (observations.some((observation) => unexpectedKeys(observation.answers, questionIds).length)) validationErrors.push("answer_field_not_allowed");
  if (submittedFindings.some((finding) => unexpectedKeys(finding, ["scenarioId", "issueCode", "severity", "status", "summary"]).length)) validationErrors.push("finding_field_not_allowed");
  if (submittedFindings.some((finding) => !scenarioSet.has(finding.scenarioId)
    || !findingIssueCodes.has(finding.issueCode)
    || !findingSeverities.has(finding.severity)
    || !findingStatuses.has(finding.status)
    || typeof finding.summary !== "string"
    || finding.summary.length < 1
    || finding.summary.length > 200)) validationErrors.push("finding_invalid");
  if (findProhibitedObservationKeys({ surface, study: record?.study, participants, observations, findings: submittedFindings }).length) validationErrors.push("sensitive_observation_field_present");

  const observationKeys = new Set();
  let correctAnswers = 0;
  let correctWithoutProfessionalDetails = 0;
  let totalAnswers = 0;
  let criticalMisconceptionCount = 0;
  const scenarioMetrics = new Map(scenarioIds.map((id) => [id, {
    scenarioId: id,
    observations: 0,
    correctAnswers: 0,
    correctWithoutProfessionalDetails: 0,
    totalAnswers: 0,
  }]));

  for (const observation of observations) {
    const key = `${observation.participantId}:${observation.scenarioId}`;
    if (observationKeys.has(key)) validationErrors.push(`duplicate_observation:${key}`);
    observationKeys.add(key);
    if (!participantSet.has(observation.participantId)) validationErrors.push(`unknown_participant:${observation.participantId ?? "missing"}`);
    if (!scenarioSet.has(observation.scenarioId)) validationErrors.push(`unknown_scenario:${observation.scenarioId ?? "missing"}`);
    if (typeof observation.professionalDetailsOpenedBeforeAnswers !== "boolean") validationErrors.push(`professional_detail_flag_missing:${key}`);
    if (!durationBuckets.has(observation.durationBucket)) validationErrors.push(`duration_bucket_invalid:${key}`);
    const metric = scenarioMetrics.get(observation.scenarioId);
    if (metric) metric.observations += 1;
    for (const questionId of questionIds) {
      const rating = observation.answers?.[questionId];
      if (!answerRatings.has(rating)) validationErrors.push(`answer_rating_invalid:${key}:${questionId}`);
      totalAnswers += 1;
      if (metric) metric.totalAnswers += 1;
      if (rating === "correct") {
        correctAnswers += 1;
        if (metric) metric.correctAnswers += 1;
        if (observation.professionalDetailsOpenedBeforeAnswers === false) {
          correctWithoutProfessionalDetails += 1;
          if (metric) metric.correctWithoutProfessionalDetails += 1;
        }
      }
    }
    const misconceptions = Array.isArray(observation.criticalMisconceptions) ? observation.criticalMisconceptions : [];
    for (const misconception of misconceptions) {
      if (!criticalSet.has(misconception)) validationErrors.push(`unknown_critical_misconception:${key}:${misconception}`);
      else criticalMisconceptionCount += 1;
    }
  }

  const expectedObservationCount = participants.length * scenarioIds.length;
  if (observations.length !== expectedObservationCount) validationErrors.push("observation_matrix_incomplete");
  for (const participantId of participantIds) {
    for (const scenarioId of scenarioIds) {
      if (!observationKeys.has(`${participantId}:${scenarioId}`)) validationErrors.push(`observation_missing:${participantId}:${scenarioId}`);
    }
  }

  const answerAccuracy = totalAnswers ? correctAnswers / totalAnswers : 0;
  const independentAnswerAccuracy = totalAnswers ? correctWithoutProfessionalDetails / totalAnswers : 0;
  const completedParticipants = participants.length;
  const gates = {
    datasetValid: datasetValidation.valid,
    recordValid: validationErrors.length === 0,
    surfaceBindingValid,
    minimumParticipants: completedParticipants >= dataset.policy.minimumParticipants,
    completeScenarioCoverage: participants.length > 0
      && observations.length === expectedObservationCount
      && scenarioIds.every((scenarioId) => participants.every((participant) => observationKeys.has(`${participant.id}:${scenarioId}`))),
    minimumAnswerAccuracy: independentAnswerAccuracy >= dataset.policy.minimumAnswerAccuracy,
    noCriticalMisconceptions: criticalMisconceptionCount <= dataset.policy.maximumCriticalMisconceptions,
  };
  const findings = scenarioIds.flatMap((scenarioId) => {
    const metric = scenarioMetrics.get(scenarioId);
    const independentAccuracy = metric.totalAnswers ? metric.correctWithoutProfessionalDetails / metric.totalAnswers : 0;
    return metric.observations > 0 && independentAccuracy < dataset.policy.minimumAnswerAccuracy
      ? [{ scenarioId, issueCode: "scenario_comprehension_below_target", accuracy: independentAccuracy }]
      : [];
  });

  return {
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
    datasetDigest: datasetValidation.datasetDigest,
    surface: surfaceBindingValid ? {
      version: surface.version,
      productCommit: surface.productCommit,
      sourceState: surface.sourceState,
      locale: surface.locale,
      viewport: { width: surface.viewport.width, height: surface.viewport.height },
    } : null,
    releaseReady: Object.values(gates).every(Boolean),
    gates,
    validationErrors: [...new Set(validationErrors)].sort(),
    metrics: {
      completedParticipants,
      observationCount: observations.length,
      expectedObservationCount,
      correctAnswers,
      correctWithoutProfessionalDetails,
      totalAnswers,
      answerAccuracy,
      independentAnswerAccuracy,
      criticalMisconceptionCount,
      scenarios: [...scenarioMetrics.values()].map((metric) => ({
        ...metric,
        accuracy: metric.totalAnswers ? metric.correctAnswers / metric.totalAnswers : 0,
        independentAccuracy: metric.totalAnswers ? metric.correctWithoutProfessionalDetails / metric.totalAnswers : 0,
      })),
    },
    findings,
  };
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function parseArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function printParticipantScenarios(dataset) {
  const safeView = {
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
    datasetDigest: riskReminderAcceptanceDatasetDigest(dataset),
    surface: dataset.surface,
    questions: dataset.questions,
    scenarios: dataset.scenarios.map(({ id, domain, participantView }) => ({ id, domain, participantView })),
  };
  if (process.argv.includes("--json")) console.log(JSON.stringify(safeView, null, 2));
  else for (const scenario of safeView.scenarios) console.log(`${scenario.id}\n${JSON.stringify(scenario.participantView, null, 2)}\n`);
}

function runCli() {
  const dataset = loadRiskReminderAcceptanceDataset();
  if (process.argv.includes("--check-dataset")) {
    const validation = validateRiskReminderAcceptanceDataset(dataset);
    console.log(JSON.stringify(validation, null, 2));
    process.exitCode = validation.valid ? 0 : 1;
    return;
  }
  if (process.argv.includes("--scenarios")) {
    printParticipantScenarios(dataset);
    return;
  }
  const responsePath = parseArgument("--responses");
  if (!responsePath) {
    console.error("Usage: pnpm accept:risk-reminders -- --responses <observations.json> [--json]");
    process.exitCode = 2;
    return;
  }
  const record = JSON.parse(readFileSync(resolve(responsePath), "utf8"));
  const report = evaluateRiskReminderAcceptance(record, dataset);
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Risk reminder user acceptance: ${report.releaseReady ? "PASS" : "BLOCKED"}`);
    console.log(`Dataset: ${report.datasetId}@${report.datasetVersion} (${report.datasetDigest ?? "invalid"})`);
    console.log(`Participants: ${report.metrics.completedParticipants}; scenario observations: ${report.metrics.observationCount}/${report.metrics.expectedObservationCount}`);
    console.log(`Correct without professional details: ${report.metrics.correctWithoutProfessionalDetails}/${report.metrics.totalAnswers} (${percent(report.metrics.independentAnswerAccuracy)})`);
    console.log(`Critical misconceptions: ${report.metrics.criticalMisconceptionCount}`);
    for (const error of report.validationErrors) console.error(`record: ${error}`);
    for (const finding of report.findings) console.error(`finding: ${finding.scenarioId} ${percent(finding.accuracy)}`);
  }
  process.exitCode = report.releaseReady ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
