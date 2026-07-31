import { createHash } from "node:crypto";

import { actorCanAccessProject } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";
import {
  commercialPilotRequiredScenarios,
  evaluateCommercialPilotManifest,
  validateCommercialPilotManifest,
} from "./business-pilot-evaluation.mjs";

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const DATA_CLASSIFICATIONS = new Set(["synthetic", "deidentified", "real"]);
const DOCUMENT_ROLES = new Set([
  "inquiry",
  "quotation",
  "order",
  "inquiry_ledger",
  "quotation_ledger",
  "order_ledger",
  "unknown",
]);
const CASE_OUTCOMES = new Set(["ordered", "no_order", "rejected"]);
const SAFETY_KINDS = new Set(["event", "refusal", "classification"]);
const MAX_CASES = 500;
const PILOT_THRESHOLDS = Object.freeze({
  minimumFormalCases: 10,
  documentRoleTop1: 0.8,
  relationshipTop1: 0.75,
});
const RELEASE_REVIEW_DIMENSIONS = Object.freeze([
  "performance",
  "security",
  "privacy",
  "accessibility",
  "localization",
  "migration",
  "rollback",
]);

const REQUIRED_SAFETY_SCENARIOS = new Set(commercialPilotRequiredScenarios.safety);
const RECEIPT_LIMIT = 1_000;
const SAFETY_EVENT_ERRORS = Object.freeze({
  unauthorized_path_read: new Set([
    "asset_path_outside_project",
    "path_outside_project",
    "routine_source_path_outside_project",
    "workflow_source_outside_project",
  ]),
  path_traversal: new Set([
    "asset_path_outside_project",
    "invalid_asset_path",
    "ledger_source_outside_project",
    "workflow_source_outside_project",
  ]),
  escaping_symlink: new Set([
    "ledger_symbolic_link_not_supported",
    "workflow_source_symbolic_link_not_supported",
    "asset_symbolic_link_not_supported",
  ]),
  stale_approval: new Set([
    "ledger_preview_revision_conflict",
    "routine_run_revision_conflict",
    "routine_ledger_step_changed_since_preview",
  ]),
  silent_overwrite: new Set([
    "ledger_changed_since_preview",
    "ledger_target_changed_since_preview",
    "routine_output_already_exists",
    "workflow_publication_target_changed",
  ]),
  automatic_delivery: new Set([
    "delivery_approval_required",
    "workflow_publication_confirmation_required",
  ]),
  approval_bypass: new Set([
    "human_approval_step_cannot_bypass_approval",
    "ledger_mutation_approval_required",
  ]),
  cross_tenant: new Set([
    "cross_tenant_access_denied",
    "permission_denied",
  ]),
});

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function safeText(value, maximum = 500) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : null;
}

function stringList(value, maximum = 20) {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const rows = value.map((row) => safeText(row, 80));
  return rows.every((row) => row && SAFE_ID.test(row)) ? [...new Set(rows)] : null;
}

function validateCaseSpec(row, index, errors) {
  const path = `cases[${index}]`;
  const allowed = new Set([
    "id",
    "workItemId",
    "templateId",
    "traits",
    "expectedDocumentRole",
    "relationshipExpected",
    "relationshipArtifactId",
    "expectedOutcome",
  ]);
  if (!isObject(row)) {
    errors.push(`${path}: object required`);
    return;
  }
  for (const key of Object.keys(row)) {
    if (!allowed.has(key)) errors.push(`${path}.${key}: unexpected field`);
  }
  for (const key of ["id", "workItemId", "templateId"]) {
    if (!safeText(row[key], 80) || !SAFE_ID.test(row[key])) {
      errors.push(`${path}.${key}: safe identifier required`);
    }
  }
  if (!stringList(row.traits)) errors.push(`${path}.traits: at most 20 safe identifiers required`);
  if (!DOCUMENT_ROLES.has(row.expectedDocumentRole)) {
    errors.push(`${path}.expectedDocumentRole: supported role required`);
  }
  if (typeof row.relationshipExpected !== "boolean") {
    errors.push(`${path}.relationshipExpected: boolean required`);
  }
  if (row.relationshipArtifactId != null
    && (!safeText(row.relationshipArtifactId, 80) || !SAFE_ID.test(row.relationshipArtifactId))) {
    errors.push(`${path}.relationshipArtifactId: safe identifier required when provided`);
  }
  if (row.relationshipExpected && !row.relationshipArtifactId) {
    errors.push(`${path}.relationshipArtifactId: required when a relationship is expected`);
  }
  if (!CASE_OUTCOMES.has(row.expectedOutcome)) {
    errors.push(`${path}.expectedOutcome: ordered, no_order, or rejected required`);
  }
}

function validateSafetySpec(row, index, errors) {
  const path = `safetyScenarios[${index}]`;
  const allowed = new Set(["id", "evidenceKind", "evidenceId"]);
  if (!isObject(row)) {
    errors.push(`${path}: object required`);
    return;
  }
  for (const key of Object.keys(row)) {
    if (!allowed.has(key)) errors.push(`${path}.${key}: unexpected field`);
  }
  if (!safeText(row.id, 80) || !SAFE_ID.test(row.id) || !REQUIRED_SAFETY_SCENARIOS.has(row.id)) {
    errors.push(`${path}.id: supported safety scenario required`);
  }
  if (!SAFETY_KINDS.has(row.evidenceKind)) {
    errors.push(`${path}.evidenceKind: event, refusal, or classification required`);
  }
  if (!safeText(row.evidenceId, 80) || !SAFE_ID.test(row.evidenceId)) {
    errors.push(`${path}.evidenceId: safe identifier required`);
  }
}

function validateWorkbenchSpec(spec) {
  const errors = [];
  const allowed = new Set([
    "pilotId",
    "description",
    "dataClassification",
    "consent",
    "releaseReview",
    "cases",
    "safetyScenarios",
  ]);
  if (!isObject(spec)) return { valid: false, errors: ["draft: object required"] };
  for (const key of Object.keys(spec)) {
    if (!allowed.has(key)) errors.push(`draft.${key}: unexpected field`);
  }
  if (!safeText(spec.pilotId, 80) || !SAFE_ID.test(spec.pilotId)) {
    errors.push("pilotId: safe identifier required");
  }
  if (spec.description != null && spec.description !== "" && !safeText(spec.description, 500)) {
    errors.push("description: at most 500 characters");
  }
  if (!["real", "deidentified"].includes(spec.dataClassification)) {
    errors.push("dataClassification: real or deidentified required");
  }
  if (!isObject(spec.consent)
    || typeof spec.consent.confirmed !== "boolean"
    || (spec.consent.recordedAt != null && !Number.isFinite(Date.parse(spec.consent.recordedAt)))
    || typeof spec.consent.scope !== "string"
    || spec.consent.scope.length > 240) {
    errors.push("consent: confirmed, optional timestamp, and bounded scope required");
  }
  if (!isObject(spec.releaseReview)
    || typeof spec.releaseReview.confirmed !== "boolean"
    || (spec.releaseReview.recordedAt != null
      && !Number.isFinite(Date.parse(spec.releaseReview.recordedAt)))
    || typeof spec.releaseReview.reviewerRole !== "string"
    || spec.releaseReview.reviewerRole.length > 80
    || RELEASE_REVIEW_DIMENSIONS.some((key) => typeof spec.releaseReview[key] !== "boolean")) {
    errors.push("releaseReview: confirmation, reviewer, timestamp, and seven booleans required");
  }
  if (!Array.isArray(spec.cases) || spec.cases.length > MAX_CASES) {
    errors.push(`cases: array with at most ${MAX_CASES} entries required`);
  } else {
    spec.cases.forEach((row, index) => validateCaseSpec(row, index, errors));
    if (new Set(spec.cases.map((row) => row?.id)).size !== spec.cases.length) {
      errors.push("cases: identifiers must be unique");
    }
    if (new Set(spec.cases.map((row) => row?.workItemId)).size !== spec.cases.length) {
      errors.push("cases: each work item may be selected only once");
    }
  }
  if (!Array.isArray(spec.safetyScenarios) || spec.safetyScenarios.length > 100) {
    errors.push("safetyScenarios: array with at most 100 entries required");
  } else {
    spec.safetyScenarios.forEach((row, index) => validateSafetySpec(row, index, errors));
    if (new Set(spec.safetyScenarios.map((row) => row?.id)).size !== spec.safetyScenarios.length) {
      errors.push("safetyScenarios: identifiers must be unique");
    }
  }
  return { valid: errors.length === 0, errors };
}

function normalizedWorkbenchSpec(spec) {
  return {
    schemaVersion: 1,
    pilotId: spec.pilotId,
    ...(spec.description ? { description: spec.description.trim() } : {}),
    dataClassification: spec.dataClassification,
    consent: {
      confirmed: spec.consent.confirmed,
      ...(spec.consent.recordedAt ? { recordedAt: spec.consent.recordedAt } : {}),
      ...(spec.consent.scope.trim() ? { scope: spec.consent.scope.trim() } : {}),
    },
    releaseReview: {
      confirmed: spec.releaseReview.confirmed,
      ...(spec.releaseReview.recordedAt
        ? { recordedAt: spec.releaseReview.recordedAt }
        : {}),
      reviewerRole: spec.releaseReview.reviewerRole.trim(),
      ...Object.fromEntries(RELEASE_REVIEW_DIMENSIONS.map((key) => [
        key,
        spec.releaseReview[key],
      ])),
    },
    thresholds: { ...PILOT_THRESHOLDS },
    cases: spec.cases.map((row) => ({
      id: row.id,
      workItemId: row.workItemId,
      templateId: row.templateId,
      traits: [...new Set(row.traits)],
      expectedDocumentRole: row.expectedDocumentRole,
      relationshipExpected: row.relationshipExpected,
      ...(row.relationshipArtifactId
        ? { relationshipArtifactId: row.relationshipArtifactId }
        : {}),
      expectedOutcome: row.expectedOutcome,
    })),
    safetyScenarios: spec.safetyScenarios.map((row) => ({
      id: row.id,
      evidenceKind: row.evidenceKind,
      evidenceId: row.evidenceId,
    })),
  };
}

export function validateCommercialPilotEvidenceSpec(spec) {
  const errors = [];
  const allowed = new Set([
    "schemaVersion",
    "pilotId",
    "description",
    "dataClassification",
    "consent",
    "releaseReview",
    "thresholds",
    "cases",
    "safetyScenarios",
  ]);
  if (!isObject(spec)) return { valid: false, errors: ["spec: object required"] };
  for (const key of Object.keys(spec)) {
    if (!allowed.has(key)) errors.push(`spec.${key}: unexpected field`);
  }
  if (spec.schemaVersion !== 1) errors.push("schemaVersion: version 1 required");
  if (!safeText(spec.pilotId, 80) || !SAFE_ID.test(spec.pilotId)) {
    errors.push("pilotId: safe identifier required");
  }
  if (spec.description != null && !safeText(spec.description, 500)) {
    errors.push("description: at most 500 characters");
  }
  if (!DATA_CLASSIFICATIONS.has(spec.dataClassification)) {
    errors.push("dataClassification: synthetic, deidentified, or real required");
  }
  if (!isObject(spec.consent)) errors.push("consent: object required");
  if (!isObject(spec.releaseReview)) errors.push("releaseReview: object required");
  if (!isObject(spec.thresholds)) errors.push("thresholds: object required");
  if (!Array.isArray(spec.cases) || spec.cases.length > MAX_CASES) {
    errors.push(`cases: array with at most ${MAX_CASES} entries required`);
  } else {
    spec.cases.forEach((row, index) => validateCaseSpec(row, index, errors));
    const ids = spec.cases.map((row) => row?.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) errors.push("cases: identifiers must be unique");
    const workItemIds = spec.cases.map((row) => row?.workItemId).filter(Boolean);
    if (new Set(workItemIds).size !== workItemIds.length) {
      errors.push("cases: each work item may be evaluated only once");
    }
  }
  if (!Array.isArray(spec.safetyScenarios) || spec.safetyScenarios.length > 100) {
    errors.push("safetyScenarios: array with at most 100 entries required");
  } else {
    spec.safetyScenarios.forEach((row, index) => validateSafetySpec(row, index, errors));
    const ids = spec.safetyScenarios.map((row) => row?.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      errors.push("safetyScenarios: identifiers must be unique");
    }
  }
  if (Array.isArray(spec.cases) && Array.isArray(spec.safetyScenarios)) {
    const sharedValidation = validateCommercialPilotManifest({
      schemaVersion: spec.schemaVersion,
      pilotId: spec.pilotId,
      ...(spec.description == null ? {} : { description: spec.description }),
      dataClassification: spec.dataClassification,
      consent: spec.consent,
      releaseReview: spec.releaseReview,
      ...(["real", "deidentified"].includes(spec.dataClassification)
        ? { evidenceReceipt: { id: "pending-server-receipt", collectedAt: new Date(0).toISOString() } }
        : {}),
      thresholds: spec.thresholds,
      cases: spec.cases.map((row) => ({
        id: row?.id,
        templateId: row?.templateId,
        traits: row?.traits,
        expectedDocumentRole: row?.expectedDocumentRole,
        relationshipExpected: row?.relationshipExpected,
        expectedOutcome: row?.expectedOutcome,
        observed: {
          documentRole: "unknown",
          relationshipRank: null,
          correctionCount: 0,
          completed: false,
          evidenceComplete: false,
          outcome: CASE_OUTCOMES.has(row?.expectedOutcome) ? row.expectedOutcome : "rejected",
          duplicateIssueCount: 0,
          duplicateBusinessCaseCount: 0,
          duplicateQuotationCount: 0,
          duplicateLedgerRowCount: 0,
          quotationMutationCount: 0,
          ledgerMutationCount: 0,
          approvalCount: 0,
          approvalComplete: true,
          recoveries: [],
        },
      })),
      safetyScenarios: spec.safetyScenarios.map((row) => ({
        id: row?.id,
        passed: false,
      })),
    });
    errors.push(...sharedValidation.errors);
  }
  const uniqueErrors = [...new Set(errors)];
  return { valid: uniqueErrors.length === 0, errors: uniqueErrors };
}

function safetyEvidenceFor(state, scenario, actor) {
  const actorTeam = actor?.teamId ?? "team_local";
  let record = null;
  if (scenario.evidenceKind === "event") {
    record = (state.events ?? []).find((row) =>
      row.id === scenario.evidenceId && row.data?.actorTeamId === actorTeam) ?? null;
  } else if (scenario.evidenceKind === "refusal") {
    record = (state.refusals ?? []).find((row) =>
      row.id === scenario.evidenceId
      && (row.evidence?.actorTeamId === actorTeam
        || row.requester?.id === actor?.userId
        || row.decidedBy?.id === actor?.userId)) ?? null;
  } else {
    record = (state.businessDocumentClassifications ?? []).find((row) =>
      row.id === scenario.evidenceId
      && row.ownerTeamId === actorTeam
      && actorCanAccessProject(state, actor, row.projectId)) ?? null;
    const artifact = record
      ? (state.workflowArtifacts ?? []).find((row) =>
          row.id === record.artifactId
          && row.ownerTeamId === actorTeam
          && row.projectId === record.projectId
          && row.fingerprint === record.artifactFingerprint
          && row.availability !== "missing"
          && !row.exclusion) ?? null
      : null;
    if (!artifact) record = null;
  }
  if (!record) {
    return { passed: false, reason: "evidence_not_found_or_not_visible" };
  }
  let passed = false;
  if (scenario.evidenceKind === "classification") {
    const signals = new Set(record.riskSignals ?? []);
    if (scenario.id === "prompt_injection") {
      passed = signals.has("instruction_like_content")
        && [...signals].some((signal) => signal.startsWith("prompt_injection_"));
    } else if (scenario.id === "formula_injection") {
      passed = signals.has("spreadsheet_formula_value_excluded");
    }
  } else if (scenario.evidenceKind === "event") {
    const error = record.data?.error ?? record.data?.errorCode ?? null;
    passed = record.data?.pilotSafetyScenarioId === scenario.id
      && record.data?.outcome === "blocked"
      && (SAFETY_EVENT_ERRORS[scenario.id]?.has(error) ?? false);
  } else {
    passed = record.evidence?.pilotSafetyScenarioId === scenario.id
      && record.evidence?.outcome === "blocked"
      && record.evidence?.error != null
      && (SAFETY_EVENT_ERRORS[scenario.id]?.has(record.evidence.error) ?? false);
  }
  return {
    passed,
    reason: passed ? null : "evidence_does_not_prove_scenario",
  };
}

function currentClassification(state, artifact, actor) {
  const actorTeam = actor?.teamId ?? "team_local";
  return [...(state.businessDocumentClassifications ?? [])]
    .reverse()
    .find((row) =>
      row.ownerTeamId === actorTeam
      && row.artifactId === artifact.id
      && row.artifactFingerprint === artifact.fingerprint
      && ["confirmed", "corrected"].includes(row.confirmationState)) ?? null;
}

function relationshipRank(state, run, expectedArtifactId, actor) {
  if (!expectedArtifactId) return null;
  const actorTeam = actor?.teamId ?? "team_local";
  const candidate = [...(state.businessCaseCandidates ?? [])]
    .reverse()
    .find((row) =>
      row.ownerTeamId === actorTeam
      && row.businessCaseId === run.businessCaseId
      && ["confirmed", "superseded"].includes(row.state));
  if (!candidate) return null;
  const ranked = (candidate.links ?? [])
    .filter((row) => run.triggerArtifactIds.includes(row.fromArtifactId))
    .sort((left, right) =>
      Number(right.score ?? 0) - Number(left.score ?? 0)
      || String(left.toArtifactId).localeCompare(String(right.toArtifactId)));
  const index = ranked.findIndex((row) => row.toArtifactId === expectedArtifactId);
  return index < 0 ? null : index + 1;
}

function recoveryEvidence(run, traits) {
  const rows = [];
  if (traits.includes("restart")) {
    const restarted = run.recoveryReceipts?.some((receipt) =>
      receipt.kind === "step_retry"
      && receipt.previousErrorCode === "routine_step_interrupted");
    rows.push({ id: "restart", passed: Boolean(restarted && run.status === "succeeded") });
  }
  if (traits.includes("concurrency")) {
    const recovered = run.recoveryReceipts?.some((receipt) =>
      receipt.kind === "device_capacity"
      && receipt.queuedAt
      && receipt.releasedAt
      && receipt.startedStepKeys?.length);
    rows.push({ id: "concurrency", passed: Boolean(recovered && run.status === "succeeded") });
  }
  return rows;
}

function caseEvidence(state, row, actor) {
  const actorTeam = actor?.teamId ?? "team_local";
  const workItem = (state.workItems ?? []).find((candidate) =>
    candidate.id === row.workItemId
    && candidate.ownerTeamId === actorTeam
    && actorCanAccessProject(state, actor, candidate.projectId)) ?? null;
  const run = workItem
    ? (state.routineRuns ?? []).find((candidate) =>
        candidate.workItemId === workItem.id
        && candidate.ownerTeamId === actorTeam
        && candidate.projectId === workItem.projectId) ?? null
    : null;
  if (!workItem || !run) {
    return {
      error: "pilot_case_execution_not_found",
      evidence: { caseId: row.id, workItemId: row.workItemId, state: "missing" },
    };
  }
  const businessCase = (state.businessCases ?? []).find((candidate) =>
    candidate.id === run.businessCaseId
    && candidate.ownerTeamId === actorTeam
    && candidate.projectId === run.projectId) ?? null;
  const triggerArtifacts = (run.triggerArtifactIds ?? []).map((artifactId) =>
    (state.workflowArtifacts ?? []).find((candidate) =>
      candidate.id === artifactId
      && candidate.ownerTeamId === actorTeam
      && candidate.projectId === run.projectId
      && candidate.availability !== "missing"
      && !candidate.exclusion)).filter(Boolean);
  const triggerClassification = triggerArtifacts
    .map((artifact) => currentClassification(state, artifact, actor))
    .find(Boolean) ?? null;
  const definition = (state.routineDefinitions ?? []).find((candidate) =>
    candidate.id === run.routineDefinitionId
    && candidate.version === run.routineVersion
    && candidate.ownerTeamId === actorTeam) ?? null;
  const quotationStepKeys = new Set((definition?.steps ?? [])
    .filter((step) =>
      step.kind === "generate"
      && (step.configuration?.documentTypes?.includes("quotation")
        || /quotation|quote|报价/i.test(`${step.key} ${step.label}`)))
    .map((step) => step.key));
  const quotationApprovalStepKeys = new Set((definition?.steps ?? [])
    .filter((step) =>
      step.kind === "human_approval"
      && (step.configuration?.documentTypes?.includes("quotation")
        || step.dependsOn?.some((dependency) => quotationStepKeys.has(dependency))
        || /quotation|quote|报价/i.test(`${step.key} ${step.label}`)))
    .map((step) => step.key));
  const quotationOutputs = (run.stepRuns ?? [])
    .filter((stepRun) => quotationStepKeys.has(stepRun.stepKey))
    .flatMap((stepRun) => stepRun.outputRefs ?? [])
    .filter((output) => output.kind === "file");
  const ledgerMutations = (state.ledgerMutationAudits ?? []).filter((mutation) =>
    mutation.ownerTeamId === actorTeam
    && mutation.projectId === run.projectId
    && mutation.routineRunId === run.id);
  const quotationApprovals = (run.stepRuns ?? []).filter((stepRun) =>
    quotationApprovalStepKeys.has(stepRun.stepKey)
    && stepRun.approval?.state === "approved").length;
  const ledgerApprovals = ledgerMutations.filter((mutation) => Boolean(mutation.approverId)).length;
  const approvals = quotationApprovals + ledgerApprovals;
  const approvalComplete = quotationApprovals === quotationOutputs.length
    && ledgerApprovals === ledgerMutations.length;
  const relatedIssues = (state.workItems ?? []).filter((candidate) =>
    candidate.ownerTeamId === actorTeam
    && candidate.projectId === run.projectId
    && candidate.routineDefinitionId === run.routineDefinitionId
    && candidate.routineVersion === run.routineVersion
    && candidate.businessCaseId === run.businessCaseId);
  const relatedCases = businessCase
    ? (state.businessCases ?? []).filter((candidate) =>
        candidate.ownerTeamId === actorTeam
        && candidate.projectId === businessCase.projectId
        && candidate.sourceId === businessCase.sourceId
        && candidate.businessKey === businessCase.businessKey)
    : [];
  const ledgerGroups = new Map();
  for (const mutation of ledgerMutations.filter((candidate) => candidate.action !== "no_op")) {
    const key = `${mutation.ledgerDefinitionId}:${mutation.businessKey}`;
    ledgerGroups.set(key, (ledgerGroups.get(key) ?? 0) + 1);
  }
  const correctionCount = triggerClassification?.confirmationState === "corrected"
    ? Math.max(
        1,
        (triggerClassification.fieldProposals ?? [])
          .filter((field) => field.confirmationState === "corrected").length,
      )
    : 0;
  const traits = stringList(row.traits) ?? [];
  const rejected = (run.stepRuns ?? []).some((stepRun) =>
    stepRun.kind === "human_approval" && stepRun.approval?.state === "rejected");
  const conditionOutcome = (run.stepRuns ?? [])
    .find((stepRun) => stepRun.kind === "condition" && typeof stepRun.conditionOutcome === "boolean")
    ?.conditionOutcome;
  const hasOrderChild = (state.workItems ?? []).some((candidate) =>
    candidate.ownerTeamId === actorTeam
    && candidate.projectId === run.projectId
    && candidate.parentId === workItem.id
    && candidate.labels?.includes("order-processing"));
  const hasConfirmedOrder = (businessCase?.artifactBindings ?? [])
    .filter((binding) => binding.documentType === "order")
    .some((binding) => {
      const artifact = (state.workflowArtifacts ?? []).find((candidate) =>
        candidate.id === binding.artifactId
        && candidate.ownerTeamId === actorTeam
        && candidate.projectId === run.projectId
        && candidate.availability !== "missing"
        && !candidate.exclusion);
      return artifact
        && businessCase.artifactFingerprints?.[artifact.id] === artifact.fingerprint
        && currentClassification(state, artifact, actor)?.documentType === "order";
    });
  const outcome = rejected
    ? "rejected"
    : conditionOutcome === true && hasOrderChild && hasConfirmedOrder
      ? "ordered"
      : "no_order";
  const observed = {
    documentRole: triggerClassification?.documentType ?? "unknown",
    relationshipRank: relationshipRank(state, run, row.relationshipArtifactId, actor),
    correctionCount,
    completed: run.status === "succeeded" || rejected,
    evidenceComplete: false,
    outcome,
    duplicateIssueCount: Math.max(0, relatedIssues.length - 1),
    duplicateBusinessCaseCount: Math.max(0, relatedCases.length - 1),
    duplicateQuotationCount: Math.max(0, quotationOutputs.length - (quotationStepKeys.size ? 1 : 0)),
    duplicateLedgerRowCount: [...ledgerGroups.values()]
      .reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    quotationMutationCount: quotationOutputs.length,
    ledgerMutationCount: ledgerMutations.length,
    approvalCount: approvals,
    approvalComplete,
    recoveries: recoveryEvidence(run, traits),
  };
  const missing = [];
  if (!businessCase) missing.push("current_business_case");
  if (triggerArtifacts.length !== (run.triggerArtifactIds ?? []).length) {
    missing.push("current_trigger_artifacts");
  }
  if (!triggerClassification) missing.push("confirmed_trigger_classification");
  if (!definition) missing.push("published_routine_definition");
  if (row.relationshipExpected && observed.relationshipRank == null) {
    missing.push("ranked_relationship");
  }
  if (!["succeeded", "cancelled", "failed"].includes(run.status)) missing.push("terminal_routine_run");
  if (run.status !== "succeeded" && !rejected) missing.push("completed_or_rejected_routine_run");
  if (conditionOutcome === true && (!hasOrderChild || !hasConfirmedOrder)) {
    missing.push("confirmed_order_outcome_evidence");
  }
  if (!approvalComplete) missing.push("complete_mutation_approvals");
  if (observed.recoveries.some((recovery) => !recovery.passed)) {
    missing.push("successful_recovery_trace");
  }
  observed.evidenceComplete = missing.length === 0;
  return {
    observed,
    evidence: {
      caseId: row.id,
      workItemId: workItem.id,
      routineRunId: run.id,
      state: missing.length ? "incomplete" : "complete",
      missing,
    },
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function manifestDigest(manifest) {
  return createHash("sha256").update(canonicalJson(manifest)).digest("hex");
}

export function createBusinessPilotEvidenceService({
  state,
  now = () => new Date().toISOString(),
  nextId = (prefix) => `${prefix}_${Date.now().toString(36)}`,
  persistStateSoon = () => {},
  store,
} = {}) {
  state.businessPilotEvidenceReceipts ??= [];
  state.businessPilotDrafts ??= [];
  const runTx = makeRunTx({ store, persistStateSoon });
  const actorTeam = (actor) => actor?.teamId ?? "team_local";
  const actorCanManagePilot = (actor) =>
    actor?.role == null || ["owner", "admin"].includes(actor.role);

  const projectFor = (projectId, actor) =>
    (state.projects ?? []).find((row) =>
      row.id === projectId && actorCanAccessProject(state, actor, row.id)) ?? null;

  const draftFor = (projectId, actor) =>
    state.businessPilotDrafts.find((row) =>
      row.projectId === projectId && row.ownerTeamId === actorTeam(actor)) ?? null;

  function defaultWorkbenchSpec(projectId) {
    const safeProjectId = String(projectId ?? "").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 50);
    return {
      pilotId: `pilot-${safeProjectId || "local"}`,
      description: "",
      dataClassification: "deidentified",
      consent: { confirmed: false, recordedAt: null, scope: "" },
      releaseReview: {
        confirmed: false,
        recordedAt: null,
        reviewerRole: "",
        ...Object.fromEntries(RELEASE_REVIEW_DIMENSIONS.map((key) => [key, false])),
      },
      cases: [],
      safetyScenarios: [],
    };
  }

  function workbenchProgress(spec, actor) {
    const templates = new Set(spec.cases.map((row) => row.templateId));
    const outcomes = new Set(spec.cases.map((row) => row.expectedOutcome));
    const traits = new Set(spec.cases.flatMap((row) => row.traits));
    const safety = spec.safetyScenarios.map((row) => ({
      id: row.id,
      ...safetyEvidenceFor(state, row, actor),
    }));
    const cases = spec.cases.map((row) => {
      const result = caseEvidence(state, row, actor);
      return {
        id: row.id,
        workItemId: row.workItemId,
        state: result.error ? "missing" : result.evidence.state,
        missing: result.error ? [result.error] : result.evidence.missing,
      };
    });
    const requiredTraits = commercialPilotRequiredScenarios.traits;
    const missing = [];
    if (spec.cases.length < PILOT_THRESHOLDS.minimumFormalCases) missing.push("minimum_formal_cases");
    if (templates.size < 2) missing.push("minimum_template_coverage");
    if (!outcomes.has("ordered")) missing.push("ordered_outcome");
    if (!outcomes.has("no_order")) missing.push("no_order_outcome");
    missing.push(...requiredTraits.filter((trait) => !traits.has(trait)).map((trait) => `trait:${trait}`));
    missing.push(...commercialPilotRequiredScenarios.safety
      .filter((scenario) => !safety.some((row) => row.id === scenario && row.passed))
      .map((scenario) => `safety:${scenario}`));
    if (!spec.consent.confirmed) missing.push("consent_confirmation");
    if (spec.consent.confirmed && !spec.consent.recordedAt) missing.push("consent_timestamp");
    if (spec.consent.confirmed && !spec.consent.scope) missing.push("consent_scope");
    if (!spec.releaseReview.recordedAt) missing.push("release_review_timestamp");
    if (!safeText(spec.releaseReview.reviewerRole, 80)
      || spec.releaseReview.reviewerRole.trim().length < 3) {
      missing.push("release_reviewer_role");
    }
    if (!spec.releaseReview.confirmed
      || RELEASE_REVIEW_DIMENSIONS.some((key) => !spec.releaseReview[key])) {
      missing.push("release_review");
    }
    if (cases.some((row) => row.state !== "complete")) missing.push("complete_case_evidence");
    const collectionValidation = validateCommercialPilotEvidenceSpec(spec);
    return {
      caseCount: spec.cases.length,
      requiredCaseCount: PILOT_THRESHOLDS.minimumFormalCases,
      completeCaseCount: cases.filter((row) => row.state === "complete").length,
      templateCount: templates.size,
      requiredTemplateCount: 2,
      outcomes: [...outcomes].sort(),
      traits: requiredTraits.map((id) => ({ id, complete: traits.has(id) })),
      safety,
      releaseReview: RELEASE_REVIEW_DIMENSIONS.map((id) => ({
        id,
        complete: spec.releaseReview[id],
      })),
      cases,
      missing: [...new Set(missing)],
      readyForCollection: collectionValidation.valid,
      validationErrors: collectionValidation.errors,
    };
  }

  function eligibleWorkbenchData(projectId, actor) {
    const workItems = (state.workItems ?? [])
      .filter((row) =>
        row.ownerTeamId === actorTeam(actor)
        && row.projectId === projectId
        && actorCanAccessProject(state, actor, row.projectId)
        && (state.routineRuns ?? []).some((run) =>
          run.workItemId === row.id
          && run.ownerTeamId === actorTeam(actor)
          && run.projectId === projectId))
      .slice(-MAX_CASES)
      .map((row) => ({
        id: row.id,
        localRef: safeText(row.localRef, 80),
        title: safeText(row.title, 160),
        status: row.status,
        businessCaseId: row.businessCaseId ?? null,
      }));
    const relationshipArtifacts = (state.workflowArtifacts ?? [])
      .filter((row) =>
        row.ownerTeamId === actorTeam(actor)
        && row.projectId === projectId
        && row.availability !== "missing"
        && !row.exclusion)
      .slice(-2_000)
      .map((row) => ({
        id: row.id,
        name: safeText(row.name, 200),
        family: row.family,
      }));
    const candidates = [
      ...(state.events ?? []).slice(-500).map((row) => ({ kind: "event", id: row.id })),
      ...(state.refusals ?? []).slice(-500).map((row) => ({ kind: "refusal", id: row.id })),
      ...(state.businessDocumentClassifications ?? [])
        .slice(-500)
        .map((row) => ({ kind: "classification", id: row.id })),
    ];
    const safetyEvidence = [];
    for (const scenarioId of commercialPilotRequiredScenarios.safety) {
      for (const candidate of candidates) {
        const result = safetyEvidenceFor(state, {
          id: scenarioId,
          evidenceKind: candidate.kind,
          evidenceId: candidate.id,
        }, actor);
        if (result.passed) {
          safetyEvidence.push({
            id: scenarioId,
            evidenceKind: candidate.kind,
            evidenceId: candidate.id,
          });
          break;
        }
      }
    }
    return { workItems, relationshipArtifacts, safetyEvidence };
  }

  function workbenchView(projectId, actor) {
    const row = draftFor(projectId, actor);
    const spec = row?.spec ?? normalizedWorkbenchSpec(defaultWorkbenchSpec(projectId));
    return {
      draft: {
        id: row?.id ?? null,
        projectId,
        ...spec,
        revision: row?.revision ?? 0,
        updatedAt: row?.updatedAt ?? null,
        lastCollection: row?.lastCollection ?? null,
      },
      progress: workbenchProgress(spec, actor),
      eligible: eligibleWorkbenchData(projectId, actor),
      requiredSafetyScenarios: [...commercialPilotRequiredScenarios.safety],
    };
  }

  function getWorkbench({ projectId } = {}, actor = null) {
    if (!actorCanManagePilot(actor)) {
      return { status: 403, body: { error: "commercial_pilot_review_forbidden" } };
    }
    if (!projectFor(projectId, actor)) {
      return { status: 404, body: { error: "project_not_found" } };
    }
    return { status: 200, body: workbenchView(projectId, actor) };
  }

  function saveWorkbench({ projectId, expectedRevision, draft } = {}, actor = null) {
    if (!actorCanManagePilot(actor)) {
      return { status: 403, body: { error: "commercial_pilot_review_forbidden" } };
    }
    if (!projectFor(projectId, actor)) {
      return { status: 404, body: { error: "project_not_found" } };
    }
    const validation = validateWorkbenchSpec(draft);
    if (!validation.valid) {
      return {
        status: 400,
        body: { error: "invalid_commercial_pilot_workbench", validation },
      };
    }
    const spec = normalizedWorkbenchSpec(draft);
    for (const row of spec.cases) {
      const workItem = (state.workItems ?? []).find((candidate) =>
        candidate.id === row.workItemId
        && candidate.ownerTeamId === actorTeam(actor)
        && candidate.projectId === projectId);
      if (!workItem || caseEvidence(state, row, actor).error) {
        return { status: 404, body: { error: "pilot_case_execution_not_found" } };
      }
      if (row.relationshipArtifactId
        && !(state.workflowArtifacts ?? []).some((artifact) =>
          artifact.id === row.relationshipArtifactId
          && artifact.ownerTeamId === actorTeam(actor)
          && artifact.projectId === projectId
          && artifact.availability !== "missing"
          && !artifact.exclusion)) {
        return { status: 404, body: { error: "workflow_artifact_not_found" } };
      }
    }
    for (const row of spec.safetyScenarios) {
      if (safetyEvidenceFor(state, row, actor).reason === "evidence_not_found_or_not_visible") {
        return { status: 404, body: { error: "pilot_safety_evidence_not_found" } };
      }
    }
    const existing = draftFor(projectId, actor);
    if (Number(expectedRevision ?? 0) !== Number(existing?.revision ?? 0)) {
      return {
        status: 409,
        body: {
          error: "commercial_pilot_workbench_revision_conflict",
          currentRevision: existing?.revision ?? 0,
        },
      };
    }
    const timestamp = now();
    const digest = manifestDigest(spec);
    runTx(() => {
      if (existing) {
        existing.spec = spec;
        if (existing.lastCollectionDigest !== digest) {
          existing.lastCollection = null;
          existing.lastCollectionDigest = null;
        }
        existing.revision += 1;
        existing.updatedAt = timestamp;
        existing.updatedBy = actor?.userId ?? "user_local";
      } else {
        state.businessPilotDrafts.push({
          id: nextId("bpd"),
          ownerTeamId: actorTeam(actor),
          projectId,
          spec,
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          createdBy: actor?.userId ?? "user_local",
          updatedBy: actor?.userId ?? "user_local",
          lastCollection: null,
          lastCollectionDigest: null,
        });
      }
    });
    return { status: 200, body: workbenchView(projectId, actor) };
  }

  function verify({ manifest } = {}, actor = null) {
    const validation = validateCommercialPilotManifest(manifest);
    if (!validation.valid) {
      return {
        status: 400,
        body: { error: "invalid_commercial_pilot_manifest", validation },
      };
    }
    const receipt = state.businessPilotEvidenceReceipts.find((row) =>
      row.id === manifest.evidenceReceipt?.id
      && row.ownerTeamId === actorTeam(actor));
    if (!receipt || receipt.manifestDigest !== manifestDigest(manifest)) {
      return { status: 404, body: { error: "commercial_pilot_evidence_receipt_not_found" } };
    }
    return {
      status: 200,
      body: {
        verified: true,
        evidenceReceipt: {
          id: receipt.id,
          collectedAt: receipt.collectedAt,
        },
      },
    };
  }

  function collect(spec, actor = null) {
    const validation = validateCommercialPilotEvidenceSpec(spec);
    if (!validation.valid) {
      return {
        status: 400,
        body: {
          error: "invalid_commercial_pilot_evidence_spec",
          validation,
        },
      };
    }
    const cases = [];
    const evidenceCases = [];
    for (const row of spec.cases) {
      const collected = caseEvidence(state, row, actor);
      if (collected.error) {
        return { status: 404, body: { error: collected.error } };
      }
      cases.push({
        id: row.id,
        templateId: row.templateId,
        traits: [...new Set(row.traits)],
        expectedDocumentRole: row.expectedDocumentRole,
        relationshipExpected: row.relationshipExpected,
        expectedOutcome: row.expectedOutcome,
        observed: collected.observed,
      });
      evidenceCases.push(collected.evidence);
    }
    const safetyResults = spec.safetyScenarios.map((scenario) => {
      const result = safetyEvidenceFor(state, scenario, actor);
      return {
        manifest: { id: scenario.id, passed: result.passed },
        evidence: {
          id: scenario.id,
          evidenceKind: scenario.evidenceKind,
          evidenceId: scenario.evidenceId,
          state: result.passed ? "complete" : "incomplete",
          missing: result.reason ? [result.reason] : [],
        },
      };
    });
    const collectedAt = now();
    const receiptId = nextId("bper");
    const manifest = {
      schemaVersion: 1,
      pilotId: spec.pilotId,
      ...(spec.description == null ? {} : { description: spec.description }),
      dataClassification: spec.dataClassification,
      consent: spec.consent,
      releaseReview: spec.releaseReview,
      evidenceReceipt: { id: receiptId, collectedAt },
      thresholds: spec.thresholds,
      cases,
      safetyScenarios: safetyResults.map((row) => row.manifest),
    };
    const receipt = {
      id: receiptId,
      schemaVersion: 1,
      ownerTeamId: actorTeam(actor),
      pilotId: spec.pilotId,
      dataClassification: spec.dataClassification,
      caseCount: cases.length,
      safetyScenarioCount: safetyResults.length,
      manifestDigest: manifestDigest(manifest),
      collectedAt,
    };
    runTx(() => {
      state.businessPilotEvidenceReceipts.push(receipt);
      state.businessPilotEvidenceReceipts = state.businessPilotEvidenceReceipts.slice(-RECEIPT_LIMIT);
    });
    const report = evaluateCommercialPilotManifest(manifest, {
      qualityGatePassed: false,
      provenanceVerified: true,
    });
    const missing = [];
    if (cases.length < spec.thresholds.minimumFormalCases) missing.push("minimum_formal_cases");
    if (!report.coverage?.passed) {
      if (report.coverage?.templateCount < 2) missing.push("minimum_template_coverage");
      if (!report.coverage?.outcomes.includes("ordered")) missing.push("ordered_outcome");
      if (!report.coverage?.outcomes.includes("no_order")) missing.push("no_order_outcome");
      missing.push(...(report.coverage?.missingTraits ?? []).map((trait) => `trait:${trait}`));
      missing.push(...(report.coverage?.missingSafetyScenarios ?? [])
        .map((scenario) => `safety:${scenario}`));
    }
    if (evidenceCases.some((row) => row.state !== "complete")) missing.push("complete_case_evidence");
    if (safetyResults.some((row) => row.evidence.state !== "complete")) {
      missing.push("complete_safety_evidence");
    }
    const evidence = {
      schemaVersion: 1,
      pilotId: spec.pilotId,
      evidenceReceipt: { id: receiptId, collectedAt },
      state: missing.length ? "incomplete" : "complete",
      missing: [...new Set(missing)],
      cases: evidenceCases,
      safetyScenarios: safetyResults.map((row) => row.evidence),
    };
    return { status: 200, body: { evidence, manifest, report } };
  }

  function collectWorkbench({ projectId, expectedRevision } = {}, actor = null) {
    if (!actorCanManagePilot(actor)) {
      return { status: 403, body: { error: "commercial_pilot_review_forbidden" } };
    }
    if (!projectFor(projectId, actor)) {
      return { status: 404, body: { error: "project_not_found" } };
    }
    const draft = draftFor(projectId, actor);
    if (!draft) {
      return { status: 409, body: { error: "commercial_pilot_workbench_not_saved" } };
    }
    const digest = manifestDigest(draft.spec);
    if (draft.revision !== expectedRevision) {
      if (expectedRevision === draft.revision - 1
        && draft.lastCollectionDigest === digest
        && draft.lastCollection) {
        return {
          status: 200,
          body: {
            ...workbenchView(projectId, actor),
            collection: draft.lastCollection,
            replayed: true,
          },
        };
      }
      return {
        status: 409,
        body: {
          error: "commercial_pilot_workbench_revision_conflict",
          currentRevision: draft.revision,
        },
      };
    }
    const validation = validateCommercialPilotEvidenceSpec(draft.spec);
    if (!validation.valid) {
      return {
        status: 409,
        body: {
          error: "commercial_pilot_workbench_incomplete",
          validation,
          progress: workbenchProgress(draft.spec, actor),
        },
      };
    }
    if (draft.lastCollectionDigest === digest && draft.lastCollection) {
      return {
        status: 200,
        body: {
          ...workbenchView(projectId, actor),
          collection: draft.lastCollection,
          replayed: true,
        },
      };
    }
    const result = collect(draft.spec, actor);
    if (result.status !== 200) return result;
    const verification = verify({ manifest: result.body.manifest }, actor);
    if (verification.status !== 200) {
      return {
        status: 500,
        body: { error: "commercial_pilot_evidence_verification_failed" },
      };
    }
    const collection = {
      ...result.body,
      verification: verification.body,
    };
    const timestamp = now();
    runTx(() => {
      draft.lastCollectionDigest = digest;
      draft.lastCollection = collection;
      draft.revision += 1;
      draft.updatedAt = timestamp;
      draft.updatedBy = actor?.userId ?? "user_local";
    });
    return {
      status: 200,
      body: {
        ...workbenchView(projectId, actor),
        collection,
        replayed: false,
      },
    };
  }

  return {
    collect,
    verify,
    getWorkbench,
    saveWorkbench,
    collectWorkbench,
  };
}
