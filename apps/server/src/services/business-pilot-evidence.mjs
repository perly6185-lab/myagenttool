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
const RELEASE_REVIEW_STATUSES = new Set(["pending", "passed", "failed"]);
const COLLECTION_LIMIT = 1_000;

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

function validateReleaseReviewItems(releaseReview, errors) {
  if (releaseReview.items == null) return;
  if (!isObject(releaseReview.items)) {
    errors.push("releaseReview.items: object required");
    return;
  }
  for (const key of Object.keys(releaseReview.items)) {
    if (!RELEASE_REVIEW_DIMENSIONS.includes(key)) {
      errors.push(`releaseReview.items.${key}: unexpected review dimension`);
    }
  }
  for (const dimension of RELEASE_REVIEW_DIMENSIONS) {
    const item = releaseReview.items[dimension];
    const path = `releaseReview.items.${dimension}`;
    if (!isObject(item)) {
      errors.push(`${path}: review item required`);
      continue;
    }
    for (const key of Object.keys(item)) {
      if (!["status", "reviewerId", "reviewerRole", "reviewedAt", "note", "evidenceIds"].includes(key)) {
        errors.push(`${path}.${key}: unexpected field`);
      }
    }
    if (!RELEASE_REVIEW_STATUSES.has(item.status)) {
      errors.push(`${path}.status: pending, passed, or failed required`);
    }
    if (typeof item.reviewerRole !== "string" || item.reviewerRole.length > 80) {
      errors.push(`${path}.reviewerRole: at most 80 characters required`);
    }
    if (item.reviewerId != null
      && (!safeText(item.reviewerId, 80) || !SAFE_ID.test(item.reviewerId))) {
      errors.push(`${path}.reviewerId: safe reviewer identifier required when provided`);
    }
    if (item.reviewedAt != null && !Number.isFinite(Date.parse(item.reviewedAt))) {
      errors.push(`${path}.reviewedAt: valid ISO timestamp required when provided`);
    }
    if (typeof item.note !== "string" || item.note.length > 500) {
      errors.push(`${path}.note: at most 500 characters required`);
    }
    if (!Array.isArray(item.evidenceIds)
      || item.evidenceIds.length > 20
      || item.evidenceIds.some((value) => !safeText(value, 80) || !SAFE_ID.test(value))) {
      errors.push(`${path}.evidenceIds: at most 20 safe identifiers required`);
    }
    if (item.status !== "pending") {
      if (!safeText(item.reviewerId, 80) || !SAFE_ID.test(item.reviewerId)) {
        errors.push(`${path}.reviewerId: reviewer identity required after review`);
      }
      if (!safeText(item.reviewerRole, 80) || item.reviewerRole.trim().length < 3) {
        errors.push(`${path}.reviewerRole: reviewer role required after review`);
      }
      if (!item.reviewedAt) errors.push(`${path}.reviewedAt: timestamp required after review`);
      if (!safeText(item.note, 500) || item.note.trim().length < 3) {
        errors.push(`${path}.note: review explanation required after review`);
      }
      if (!Array.isArray(item.evidenceIds) || item.evidenceIds.length === 0) {
        errors.push(`${path}.evidenceIds: at least one evidence reference required after review`);
      }
    }
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
  } else {
    validateReleaseReviewItems(spec.releaseReview, errors);
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
  const reviewItems = Object.fromEntries(RELEASE_REVIEW_DIMENSIONS.map((key) => {
    const item = spec.releaseReview.items?.[key];
    return [key, {
      status: RELEASE_REVIEW_STATUSES.has(item?.status) ? item.status : "pending",
      reviewerRole: safeText(item?.reviewerRole, 80) ?? "",
      reviewerId: safeText(item?.reviewerId, 80) ?? null,
      reviewedAt: item?.reviewedAt ?? null,
      note: safeText(item?.note, 500) ?? "",
      evidenceIds: Array.isArray(item?.evidenceIds) ? [...new Set(item.evidenceIds)] : [],
    }];
  }));
  const hasReviewItems = isObject(spec.releaseReview.items);
  const allReviewItemsPassed = RELEASE_REVIEW_DIMENSIONS.every((key) =>
    reviewItems[key].status === "passed");
  const distinctReviewers = new Set(RELEASE_REVIEW_DIMENSIONS
    .map((key) => reviewItems[key].reviewerId)
    .filter(Boolean));
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
      confirmed: hasReviewItems
        ? allReviewItemsPassed && distinctReviewers.size >= 2
        : spec.releaseReview.confirmed,
      ...(spec.releaseReview.recordedAt
        ? { recordedAt: spec.releaseReview.recordedAt }
        : {}),
      reviewerRole: spec.releaseReview.reviewerRole.trim(),
      ...Object.fromEntries(RELEASE_REVIEW_DIMENSIONS.map((key) => [
        key,
        hasReviewItems ? reviewItems[key].status === "passed" : spec.releaseReview[key],
      ])),
      ...(hasReviewItems ? { items: reviewItems } : {}),
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

function evidenceSpecForWorkbench(spec) {
  const { items: _items, ...releaseReview } = spec.releaseReview;
  return { ...spec, releaseReview };
}

function defaultReleaseReviewItems() {
  return Object.fromEntries(RELEASE_REVIEW_DIMENSIONS.map((key) => [key, {
    status: "pending",
    reviewerRole: "",
    reviewerId: null,
    reviewedAt: null,
    note: "",
    evidenceIds: [],
  }]));
}

function defaultWorkbenchReleaseReview(recordedAt = null) {
  return {
    confirmed: false,
    ...(recordedAt ? { recordedAt } : {}),
    reviewerRole: recordedAt ? "independent reviewers" : "",
    ...Object.fromEntries(RELEASE_REVIEW_DIMENSIONS.map((key) => [key, false])),
    items: defaultReleaseReviewItems(),
  };
}

function workbenchTruthDigest(spec) {
  const { releaseReview: _releaseReview, ...truth } = spec;
  return manifestDigest(truth);
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

function evidenceProjectId(state, record, evidenceKind) {
  const explicitProjectId = record?.projectId
    ?? record?.data?.projectId
    ?? record?.evidence?.projectId
    ?? (record?.subject?.kind === "project" ? record.subject.id : null);
  if (explicitProjectId) return explicitProjectId;
  const routineRunId = record?.data?.routineRunId ?? record?.evidence?.routineRunId;
  if (routineRunId) {
    return (state.routineRuns ?? []).find((row) => row.id === routineRunId)?.projectId ?? null;
  }
  const artifactId = record?.data?.artifactId ?? record?.evidence?.artifactId;
  if (artifactId) {
    return (state.workflowArtifacts ?? []).find((row) => row.id === artifactId)?.projectId ?? null;
  }
  if (evidenceKind === "refusal" && record?.invocationId) {
    return (state.invocations ?? []).find((row) => row.id === record.invocationId)?.projectId ?? null;
  }
  return null;
}

function safetyEvidenceFor(state, scenario, actor, projectId = null) {
  const actorTeam = actor?.teamId ?? "team_local";
  let record = null;
  if (scenario.evidenceKind === "event") {
    record = (state.events ?? []).find((row) =>
      row.id === scenario.evidenceId
      && row.data?.actorTeamId === actorTeam
      && (!projectId || evidenceProjectId(state, row, "event") === projectId)) ?? null;
  } else if (scenario.evidenceKind === "refusal") {
    record = (state.refusals ?? []).find((row) =>
      row.id === scenario.evidenceId
      && (row.evidence?.actorTeamId === actorTeam
        || row.requester?.id === actor?.userId
        || row.decidedBy?.id === actor?.userId)
      && (!projectId || evidenceProjectId(state, row, "refusal") === projectId)) ?? null;
  } else {
    record = (state.businessDocumentClassifications ?? []).find((row) =>
      row.id === scenario.evidenceId
      && row.ownerTeamId === actorTeam
      && (!projectId || row.projectId === projectId)
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
  createWorkItem = null,
} = {}) {
  state.businessPilotEvidenceReceipts ??= [];
  state.businessPilotDrafts ??= [];
  state.businessPilotCollections ??= [];
  state.businessPilotRollouts ??= [];
  const runTx = makeRunTx({ store, persistStateSoon });
  const actorTeam = (actor) => actor?.teamId ?? "team_local";
  const actorCanManagePilot = (actor) =>
    actor?.role == null || ["owner", "admin"].includes(actor.role);
  const actorCanReviewPilot = (actor) =>
    actor?.role == null || ["owner", "admin", "operator"].includes(actor.role);

  const projectFor = (projectId, actor) =>
    (state.projects ?? []).find((row) =>
      row.id === projectId && actorCanAccessProject(state, actor, row.id)) ?? null;

  const draftFor = (projectId, actor) =>
    state.businessPilotDrafts.find((row) =>
      row.projectId === projectId && row.ownerTeamId === actorTeam(actor)) ?? null;

  const rolloutFor = (projectId, actor) =>
    state.businessPilotRollouts.find((row) =>
      row.projectId === projectId && row.ownerTeamId === actorTeam(actor)) ?? null;

  function rolloutView(projectId, actor) {
    const row = rolloutFor(projectId, actor);
    return {
      mode: row?.mode ?? "shadow",
      revision: row?.revision ?? 0,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  function defaultWorkbenchSpec(projectId) {
    const safeProjectId = String(projectId ?? "").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 50);
    return {
      pilotId: `pilot-${safeProjectId || "local"}`,
      description: "",
      dataClassification: "deidentified",
      consent: { confirmed: false, recordedAt: null, scope: "" },
      releaseReview: defaultWorkbenchReleaseReview(),
      cases: [],
      safetyScenarios: [],
    };
  }

  function workbenchProgress(spec, actor, projectId) {
    const templates = new Set(spec.cases.map((row) => row.templateId));
    const outcomes = new Set(spec.cases.map((row) => row.expectedOutcome));
    const traits = new Set(spec.cases.flatMap((row) => row.traits));
    const safety = spec.safetyScenarios.map((row) => ({
      id: row.id,
      ...safetyEvidenceFor(state, row, actor, projectId),
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
    if (isObject(spec.releaseReview.items)
      && new Set(RELEASE_REVIEW_DIMENSIONS
        .map((key) => spec.releaseReview.items[key]?.reviewerId)
        .filter(Boolean)).size < 2) {
      missing.push("independent_release_reviewers");
    }
    if (cases.some((row) => row.state !== "complete")) missing.push("complete_case_evidence");
    const collectionValidation = validateCommercialPilotEvidenceSpec(
      evidenceSpecForWorkbench(spec),
    );
    return {
      caseCount: spec.cases.length,
      requiredCaseCount: PILOT_THRESHOLDS.minimumFormalCases,
      completeCaseCount: cases.filter((row) => row.state === "complete").length,
      templateCount: templates.size,
      requiredTemplateCount: 2,
      outcomes: [...outcomes].sort(),
      traits: requiredTraits.map((id) => ({ id, complete: traits.has(id) })),
      safety,
      releaseReview: RELEASE_REVIEW_DIMENSIONS.map((id) => {
        const item = spec.releaseReview.items?.[id];
        return {
          id,
          complete: item ? item.status === "passed" : spec.releaseReview[id],
          status: item?.status ?? (spec.releaseReview[id] ? "passed" : "pending"),
          reviewerRole: item?.reviewerRole ?? spec.releaseReview.reviewerRole ?? "",
          reviewerId: item?.reviewerId ?? null,
          reviewedAt: item?.reviewedAt ?? spec.releaseReview.recordedAt ?? null,
          evidenceCount: item?.evidenceIds?.length ?? 0,
        };
      }),
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
      .map((row) => {
        const run = [...(state.routineRuns ?? [])].reverse().find((candidate) =>
          candidate.workItemId === row.id
          && candidate.ownerTeamId === actorTeam(actor)
          && candidate.projectId === projectId) ?? null;
        const triggerArtifact = (run?.triggerArtifactIds ?? []).map((artifactId) =>
          (state.workflowArtifacts ?? []).find((artifact) =>
            artifact.id === artifactId
            && artifact.ownerTeamId === actorTeam(actor)
            && artifact.projectId === projectId
            && artifact.availability !== "missing"
            && !artifact.exclusion)).find(Boolean) ?? null;
        const classification = triggerArtifact
          ? currentClassification(state, triggerArtifact, actor)
          : null;
        const templateArtifactId = (run?.stepRuns ?? []).map((stepRun) =>
          stepRun.quotationInputs?.templateArtifactId).find(Boolean) ?? null;
        const suggestedTemplateId = templateArtifactId
          ?? run?.routineDefinitionId
          ?? "default-a";
        const proposal = caseEvidence(state, {
          id: `proposal-${row.id}`,
          workItemId: row.id,
          templateId: suggestedTemplateId,
          traits: [],
          expectedDocumentRole: classification?.documentType ?? "unknown",
          relationshipExpected: false,
          expectedOutcome: "no_order",
        }, actor);
        const suggestedTraits = [];
        if ((proposal.observed?.duplicateIssueCount ?? 0) > 0
          || (proposal.observed?.duplicateBusinessCaseCount ?? 0) > 0
          || (proposal.observed?.duplicateQuotationCount ?? 0) > 0
          || (proposal.observed?.duplicateLedgerRowCount ?? 0) > 0) {
          suggestedTraits.push("duplicate");
        }
        const quotationReviewFields = (run?.stepRuns ?? [])
          .flatMap((stepRun) => stepRun.quotationReview?.fields ?? []);
        if (quotationReviewFields.some((field) => field.state === "missing")) {
          suggestedTraits.push("missing_fact");
        }
        if (quotationReviewFields.some((field) => field.state === "conflict")
          || (proposal.observed?.correctionCount ?? 0) > 0) {
          suggestedTraits.push("conflicting_fact");
        }
        if (recoveryEvidence(run, ["restart"])[0]?.passed) {
          suggestedTraits.push("restart");
        }
        if (recoveryEvidence(run, ["concurrency"])[0]?.passed) {
          suggestedTraits.push("concurrency");
        }
        const missing = proposal.error ? [proposal.error] : proposal.evidence.missing;
        const nextAction = missing.some((reason) => [
          "current_trigger_artifacts",
          "confirmed_trigger_classification",
          "ranked_relationship",
        ].includes(reason)) ? "assets" : "process";
        return {
          id: row.id,
          localRef: safeText(row.localRef, 80),
          title: safeText(row.title, 160),
          status: row.status,
          businessCaseId: row.businessCaseId ?? null,
          suggestedTemplateId,
          suggestedDocumentRole: proposal.observed?.documentRole ?? "unknown",
          suggestedOutcome: proposal.observed?.outcome ?? "rejected",
          suggestedTraits,
          evidenceState: proposal.error ? "missing" : proposal.evidence.state,
          missing,
          nextAction,
        };
      });
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
        }, actor, projectId);
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

  function gapIdempotencyKey(projectId, pilotId, gapKey, actor) {
    const digest = createHash("sha256")
      .update(`${actorTeam(actor)}:${projectId}:${pilotId}:${gapKey}`)
      .digest("hex")
      .slice(0, 32);
    return `commercial-pilot-gap:v1:${digest}`;
  }

  function workbenchGapDescriptors(spec, progress, projectId, actor) {
    const descriptors = [];
    const add = (key, title, reasons, parentId = null) => {
      if (!reasons.length) return;
      const idempotencyKey = gapIdempotencyKey(projectId, spec.pilotId, key, actor);
      const issue = (state.workItems ?? []).find((row) =>
        row.ownerTeamId === actorTeam(actor)
        && row.projectId === projectId
        && row.createIdempotencyKey === idempotencyKey) ?? null;
      descriptors.push({
        key,
        title,
        reasons: [...new Set(reasons)],
        parentId,
        issue: issue ? {
          id: issue.id,
          localRef: issue.localRef,
          status: issue.status,
        } : null,
      });
    };
    add("coverage", "Complete formal pilot case coverage", progress.missing.filter((reason) =>
      reason === "minimum_formal_cases"
      || reason === "minimum_template_coverage"
      || reason === "ordered_outcome"
      || reason === "no_order_outcome"
      || reason.startsWith("trait:")));
    add("authorization", "Complete formal pilot authorization", progress.missing.filter((reason) =>
      reason.startsWith("consent_")));
    add("release-review", "Complete independent release reviews", progress.missing.filter((reason) =>
      reason.startsWith("release_") || reason === "independent_release_reviewers"));
    for (const scenario of commercialPilotRequiredScenarios.safety) {
      add(`safety-${scenario}`, `Prove pilot safety scenario: ${scenario}`, progress.missing.filter((reason) =>
        reason === `safety:${scenario}`));
    }
    for (const row of progress.cases) {
      add(`case-${row.id}`, `Complete pilot evidence for ${row.id}`, row.missing, row.workItemId);
    }
    return descriptors;
  }

  function workbenchView(projectId, actor) {
    const row = draftFor(projectId, actor);
    const spec = row?.spec ?? normalizedWorkbenchSpec(defaultWorkbenchSpec(projectId));
    const currentDigest = collectionEvidenceDigest(spec, actor, projectId);
    const history = state.businessPilotCollections
      .filter((collection) =>
        collection.ownerTeamId === actorTeam(actor)
        && collection.projectId === projectId)
      .slice(-100)
      .reverse()
      .map((collection) => collectionSummary(collection, currentDigest));
    const progress = workbenchProgress(spec, actor, projectId);
    return {
      draft: {
        id: row?.id ?? null,
        projectId,
        ...spec,
        revision: row?.revision ?? 0,
        updatedAt: row?.updatedAt ?? null,
        lastCollection: row?.lastCollection ?? null,
      },
      progress,
      eligible: eligibleWorkbenchData(projectId, actor),
      requiredSafetyScenarios: [...commercialPilotRequiredScenarios.safety],
      history,
      gaps: workbenchGapDescriptors(spec, progress, projectId, actor),
      rollout: rolloutView(projectId, actor),
      permissions: {
        canManage: actorCanManagePilot(actor),
        canReview: actorCanReviewPilot(actor),
      },
    };
  }

  function getWorkbench({ projectId } = {}, actor = null) {
    if (!actorCanReviewPilot(actor)) {
      return { status: 403, body: { error: "commercial_pilot_review_forbidden" } };
    }
    if (!projectFor(projectId, actor)) {
      return { status: 404, body: { error: "project_not_found" } };
    }
    return { status: 200, body: workbenchView(projectId, actor) };
  }

  function prepareWorkbench({
    projectId,
    expectedRevision = 0,
    confirmed,
    dataClassification = "deidentified",
    consentScope = "",
    pilotId = null,
    description = null,
  } = {}, actor = null) {
    if (!actorCanManagePilot(actor)) {
      return { status: 403, body: { error: "commercial_pilot_review_forbidden" } };
    }
    if (!projectFor(projectId, actor)) {
      return { status: 404, body: { error: "project_not_found" } };
    }
    if (rolloutView(projectId, actor).mode === "off") {
      return { status: 409, body: { error: "commercial_pilot_rollout_disabled" } };
    }
    if (confirmed !== true || !safeText(consentScope, 240)
      || !["deidentified", "real"].includes(dataClassification)) {
      return { status: 400, body: { error: "commercial_pilot_prepare_confirmation_required" } };
    }
    const current = draftFor(projectId, actor);
    if (Number(expectedRevision) !== Number(current?.revision ?? 0)) {
      return {
        status: 409,
        body: {
          error: "commercial_pilot_workbench_revision_conflict",
          currentRevision: current?.revision ?? 0,
        },
      };
    }
    const eligible = eligibleWorkbenchData(projectId, actor);
    const remaining = [...eligible.workItems].filter((row) => row.evidenceState !== "missing");
    const selected = [];
    const templates = new Set();
    const outcomes = new Set();
    while (remaining.length && selected.length < PILOT_THRESHOLDS.minimumFormalCases) {
      remaining.sort((left, right) => {
        const score = (row) =>
          (row.evidenceState === "complete" ? 100 : 0)
          + (outcomes.has(row.suggestedOutcome) ? 0 : 20)
          + (templates.has(row.suggestedTemplateId) ? 0 : 10)
          + (row.suggestedTraits?.length ?? 0);
        return score(right) - score(left) || String(left.id).localeCompare(String(right.id));
      });
      const row = remaining.shift();
      selected.push(row);
      templates.add(row.suggestedTemplateId);
      outcomes.add(row.suggestedOutcome);
    }
    const base = current?.spec ?? normalizedWorkbenchSpec(defaultWorkbenchSpec(projectId));
    const draft = {
      pilotId: pilotId ?? base.pilotId,
      description: description ?? base.description ?? "Governed local commercial pilot.",
      dataClassification,
      consent: {
        confirmed: true,
        recordedAt: now(),
        scope: consentScope.trim(),
      },
      releaseReview: structuredClone(base.releaseReview),
      cases: selected.map((row, index) => ({
        id: `case-${String(index + 1).padStart(2, "0")}`,
        workItemId: row.id,
        templateId: row.suggestedTemplateId,
        traits: row.suggestedTraits,
        expectedDocumentRole: row.suggestedDocumentRole,
        relationshipExpected: false,
        expectedOutcome: row.suggestedOutcome,
      })),
      safetyScenarios: eligible.safetyEvidence.map((row) => ({ ...row })),
    };
    const saved = saveWorkbench({ projectId, expectedRevision, draft }, actor);
    if (saved.status !== 200) return saved;
    return {
      status: 200,
      body: {
        ...saved.body,
        automation: {
          selectedCaseCount: selected.length,
          matchedSafetyCount: draft.safetyScenarios.length,
          eligibleCaseCount: eligible.workItems.length,
          readyCaseCount: eligible.workItems.filter((row) => row.evidenceState === "complete").length,
        },
      },
    };
  }

  function createWorkbenchGapIssues({ projectId, expectedRevision, confirmed } = {}, actor = null) {
    if (!actorCanManagePilot(actor)) {
      return { status: 403, body: { error: "commercial_pilot_review_forbidden" } };
    }
    if (!projectFor(projectId, actor)) {
      return { status: 404, body: { error: "project_not_found" } };
    }
    if (rolloutView(projectId, actor).mode === "off") {
      return { status: 409, body: { error: "commercial_pilot_rollout_disabled" } };
    }
    const draft = draftFor(projectId, actor);
    if (!draft) {
      return { status: 409, body: { error: "commercial_pilot_workbench_not_saved" } };
    }
    if (draft.revision !== expectedRevision) {
      return { status: 409, body: {
        error: "commercial_pilot_workbench_revision_conflict",
        currentRevision: draft.revision,
      } };
    }
    if (confirmed !== true) {
      return { status: 400, body: { error: "commercial_pilot_gap_issue_confirmation_required" } };
    }
    if (typeof createWorkItem !== "function") {
      return { status: 503, body: { error: "commercial_pilot_gap_issue_materializer_unavailable" } };
    }
    const progress = workbenchProgress(draft.spec, actor, projectId);
    const gaps = workbenchGapDescriptors(draft.spec, progress, projectId, actor);
    const issues = [];
    for (const gap of gaps) {
      if (gap.issue) {
        issues.push({ ...gap.issue, gapKey: gap.key, replayed: true });
        continue;
      }
      const created = createWorkItem({
        projectId,
        title: gap.title,
        body: [
          `Formal pilot: ${draft.spec.pilotId}`,
          `Gap: ${gap.key}`,
          "",
          ...gap.reasons.map((reason) => `- ${reason}`),
        ].join("\n"),
        type: "task",
        status: "ready",
        priority: "p1",
        labels: ["workflow-memory", "pilot-evidence-gap"],
        assigneeIds: [],
        acceptanceCriteria: gap.reasons.map((reason) => `Resolve ${reason}`),
        parentId: gap.parentId,
        idempotencyKey: gapIdempotencyKey(projectId, draft.spec.pilotId, gap.key, actor),
      }, actor);
      if (!created?.ok) {
        return { status: created?.status ?? 500, body: created?.body ?? {
          error: "commercial_pilot_gap_issue_create_failed",
        } };
      }
      issues.push({
        id: created.body.workItem.id,
        localRef: created.body.workItem.localRef,
        status: created.body.workItem.status,
        gapKey: gap.key,
        replayed: Boolean(created.body.replayed),
      });
    }
    return { status: 200, body: { ...workbenchView(projectId, actor), issues } };
  }

  function submitWorkbenchReview({
    projectId,
    dimension,
    expectedRevision,
    status,
    note,
    evidenceIds,
  } = {}, actor = null) {
    if (!actorCanReviewPilot(actor)) {
      return { status: 403, body: { error: "commercial_pilot_review_forbidden" } };
    }
    if (!projectFor(projectId, actor)) {
      return { status: 404, body: { error: "project_not_found" } };
    }
    if (rolloutView(projectId, actor).mode === "off") {
      return { status: 409, body: { error: "commercial_pilot_rollout_disabled" } };
    }
    const draft = draftFor(projectId, actor);
    if (!draft) {
      return { status: 409, body: { error: "commercial_pilot_workbench_not_saved" } };
    }
    if (draft.revision !== expectedRevision) {
      return { status: 409, body: {
        error: "commercial_pilot_workbench_revision_conflict",
        currentRevision: draft.revision,
      } };
    }
    if (!RELEASE_REVIEW_DIMENSIONS.includes(dimension)
      || !["passed", "failed"].includes(status)
      || !safeText(note, 500)
      || note.trim().length < 3
      || !Array.isArray(evidenceIds)
      || evidenceIds.length === 0
      || evidenceIds.length > 20
      || evidenceIds.some((value) => !safeText(value, 80) || !SAFE_ID.test(value))) {
      return { status: 400, body: { error: "commercial_pilot_review_submission_invalid" } };
    }
    const userId = safeText(actor?.userId, 80) && SAFE_ID.test(actor.userId)
      ? actor.userId
      : "user_local";
    const reviewItems = isObject(draft.spec.releaseReview.items)
      ? structuredClone(draft.spec.releaseReview.items)
      : defaultReleaseReviewItems();
    reviewItems[dimension] = {
      status,
      reviewerId: userId,
      reviewerRole: safeText(actor?.role, 80) ?? "workspace owner",
      reviewedAt: now(),
      note: note.trim(),
      evidenceIds: [...new Set(evidenceIds)],
    };
    const allPassed = RELEASE_REVIEW_DIMENSIONS.every((key) =>
      reviewItems[key]?.status === "passed");
    const { schemaVersion: _schemaVersion, thresholds: _thresholds, ...input } = draft.spec;
    input.releaseReview = {
      ...input.releaseReview,
      reviewerRole: "independent reviewers",
      items: reviewItems,
      recordedAt: allPassed ? now() : null,
      confirmed: false,
    };
    const validation = validateWorkbenchSpec(input);
    if (!validation.valid) {
      return { status: 400, body: {
        error: "invalid_commercial_pilot_workbench",
        validation,
      } };
    }
    const spec = normalizedWorkbenchSpec(input);
    const timestamp = now();
    runTx(() => {
      draft.spec = spec;
      draft.lastCollection = null;
      draft.lastCollectionDigest = null;
      draft.revision += 1;
      draft.updatedAt = timestamp;
      draft.updatedBy = userId;
    });
    return { status: 200, body: {
      ...workbenchView(projectId, actor),
      review: { dimension, status, reviewerId: userId },
    } };
  }

  function updateWorkbenchRollout({ projectId, expectedRevision = 0, mode } = {}, actor = null) {
    if (!actorCanManagePilot(actor)) {
      return { status: 403, body: { error: "commercial_pilot_review_forbidden" } };
    }
    if (!projectFor(projectId, actor)) {
      return { status: 404, body: { error: "project_not_found" } };
    }
    if (!["off", "shadow", "enabled"].includes(mode)) {
      return { status: 400, body: { error: "commercial_pilot_rollout_mode_invalid" } };
    }
    const existing = rolloutFor(projectId, actor);
    if (Number(expectedRevision) !== Number(existing?.revision ?? 0)) {
      return { status: 409, body: {
        error: "commercial_pilot_rollout_revision_conflict",
        currentRevision: existing?.revision ?? 0,
      } };
    }
    const timestamp = now();
    runTx(() => {
      if (existing) {
        existing.mode = mode;
        existing.revision += 1;
        existing.updatedAt = timestamp;
        existing.updatedBy = actor?.userId ?? "user_local";
      } else {
        state.businessPilotRollouts.push({
          id: nextId("bpro"),
          ownerTeamId: actorTeam(actor),
          projectId,
          mode,
          revision: 1,
          updatedAt: timestamp,
          updatedBy: actor?.userId ?? "user_local",
        });
      }
    });
    return { status: 200, body: { rollout: rolloutView(projectId, actor) } };
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
    for (const dimension of RELEASE_REVIEW_DIMENSIONS) {
      const submitted = draft.releaseReview.items?.[dimension];
      if (submitted?.status === "pending" || submitted == null) continue;
      const recorded = existing?.spec.releaseReview.items?.[dimension];
      if (!recorded || canonicalJson(submitted) !== canonicalJson(recorded)) {
        return { status: 400, body: { error: "commercial_pilot_review_submission_required" } };
      }
    }
    const truthChanged = !existing
      || workbenchTruthDigest(spec) !== workbenchTruthDigest(existing.spec);
    spec.releaseReview = truthChanged || !isObject(existing?.spec.releaseReview.items)
      ? defaultWorkbenchReleaseReview(now())
      : structuredClone(existing.spec.releaseReview);
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
      if (safetyEvidenceFor(state, row, actor, projectId).reason
        === "evidence_not_found_or_not_visible") {
        return { status: 404, body: { error: "pilot_safety_evidence_not_found" } };
      }
    }
    const timestamp = now();
    runTx(() => {
      if (existing) {
        existing.spec = spec;
        existing.lastCollection = null;
        existing.lastCollectionDigest = null;
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
    if (!receipt || receipt.revokedAt || receipt.manifestDigest !== manifestDigest(manifest)) {
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

  function collectionEvidenceDigest(spec, actor, projectId = null) {
    return manifestDigest({
      spec,
      cases: spec.cases.map((row) => {
        const result = caseEvidence(state, row, actor);
        return result.error
          ? { id: row.id, error: result.error }
          : { id: row.id, observed: result.observed, evidence: result.evidence };
      }),
      safetyScenarios: spec.safetyScenarios.map((scenario) => ({
        id: scenario.id,
        ...safetyEvidenceFor(state, scenario, actor, projectId),
      })),
    });
  }

  function collectionSummary(collection, currentDigest = null) {
    return {
      id: collection.id,
      pilotId: collection.pilotId,
      draftRevision: collection.draftRevision,
      evidenceReceiptId: collection.evidenceReceiptId,
      collectedAt: collection.collectedAt,
      collectedBy: collection.collectedBy,
      evidenceState: collection.collection.evidence.state,
      decision: collection.collection.report.gate.decision,
      caseCount: collection.collection.manifest.cases.length,
      safetyPassed: collection.collection.manifest.safetyScenarios
        .filter((scenario) => scenario.passed).length,
      safetyTotal: collection.collection.manifest.safetyScenarios.length,
      current: !collection.revokedAt && currentDigest === collection.evidenceDigest,
      revokedAt: collection.revokedAt ?? null,
    };
  }

  function collect(spec, actor = null, { projectId = null } = {}) {
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
      const result = safetyEvidenceFor(state, scenario, actor, projectId);
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
    if (rolloutView(projectId, actor).mode === "off") {
      return { status: 409, body: { error: "commercial_pilot_rollout_disabled" } };
    }
    const draft = draftFor(projectId, actor);
    if (!draft) {
      return { status: 409, body: { error: "commercial_pilot_workbench_not_saved" } };
    }
    const digest = collectionEvidenceDigest(draft.spec, actor, projectId);
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
    const collectionSpec = evidenceSpecForWorkbench(draft.spec);
    const validation = validateCommercialPilotEvidenceSpec(collectionSpec);
    if (!validation.valid) {
      return {
        status: 409,
        body: {
          error: "commercial_pilot_workbench_incomplete",
          validation,
          progress: workbenchProgress(draft.spec, actor, projectId),
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
    const result = collect(collectionSpec, actor, { projectId });
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
      state.businessPilotCollections.push({
        id: nextId("bpc"),
        ownerTeamId: actorTeam(actor),
        projectId,
        pilotId: draft.spec.pilotId,
        draftRevision: draft.revision,
        evidenceDigest: digest,
        evidenceReceiptId: result.body.manifest.evidenceReceipt.id,
        collectedAt: timestamp,
        collectedBy: actor?.userId ?? "user_local",
        collection: structuredClone(collection),
        revokedAt: null,
        revokedBy: null,
      });
      state.businessPilotCollections = state.businessPilotCollections.slice(-COLLECTION_LIMIT);
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

  function getWorkbenchCollection({ projectId, collectionId } = {}, actor = null) {
    if (!actorCanReviewPilot(actor)) {
      return { status: 403, body: { error: "commercial_pilot_review_forbidden" } };
    }
    if (!projectFor(projectId, actor)) {
      return { status: 404, body: { error: "project_not_found" } };
    }
    const collection = state.businessPilotCollections.find((row) =>
      row.id === collectionId
      && row.projectId === projectId
      && row.ownerTeamId === actorTeam(actor));
    if (!collection) {
      return { status: 404, body: { error: "commercial_pilot_collection_not_found" } };
    }
    const draft = draftFor(projectId, actor);
    const currentDigest = draft
      ? collectionEvidenceDigest(draft.spec, actor, projectId)
      : null;
    return {
      status: 200,
      body: {
        collection: collectionSummary(collection, currentDigest),
        report: collection.collection.report,
        verification: collection.collection.verification,
      },
    };
  }

  function compareWorkbenchCollections({ projectId, fromId, toId } = {}, actor = null) {
    const fromResult = getWorkbenchCollection({ projectId, collectionId: fromId }, actor);
    if (fromResult.status !== 200) return fromResult;
    const toResult = getWorkbenchCollection({ projectId, collectionId: toId }, actor);
    if (toResult.status !== 200) return toResult;
    const from = fromResult.body.collection;
    const to = toResult.body.collection;
    return {
      status: 200,
      body: {
        from,
        to,
        changes: {
          evidenceStateChanged: from.evidenceState !== to.evidenceState,
          decisionChanged: from.decision !== to.decision,
          caseCount: to.caseCount - from.caseCount,
          safetyPassed: to.safetyPassed - from.safetyPassed,
        },
      },
    };
  }

  function exportWorkbenchCollection({ projectId, collectionId, format = "markdown" } = {}, actor = null) {
    const detail = getWorkbenchCollection({ projectId, collectionId }, actor);
    if (detail.status !== 200) return detail;
    if (!["markdown", "json"].includes(format)) {
      return { status: 400, body: { error: "commercial_pilot_export_format_invalid" } };
    }
    const summary = detail.body.collection;
    const safeReport = {
      schemaVersion: 1,
      pilotId: summary.pilotId,
      collectedAt: summary.collectedAt,
      evidenceState: summary.evidenceState,
      decision: summary.decision,
      caseCount: summary.caseCount,
      safety: { passed: summary.safetyPassed, total: summary.safetyTotal },
      current: summary.current,
      revokedAt: summary.revokedAt,
    };
    const content = format === "json"
      ? `${JSON.stringify(safeReport, null, 2)}\n`
      : [
          `# Commercial pilot ${summary.pilotId}`,
          "",
          `- Collected: ${summary.collectedAt}`,
          `- Evidence: ${summary.evidenceState}`,
          `- Decision: ${summary.decision}`,
          `- Cases: ${summary.caseCount}`,
          `- Safety: ${summary.safetyPassed}/${summary.safetyTotal}`,
          `- Current: ${summary.current ? "yes" : "no"}`,
          ...(summary.revokedAt ? [`- Revoked: ${summary.revokedAt}`] : []),
          "",
          "This aggregate report contains no source document text or absolute local paths.",
          "",
        ].join("\n");
    return {
      status: 200,
      body: {
        filename: `${summary.pilotId}-${collectionId}.${format === "json" ? "json" : "md"}`,
        mediaType: format === "json" ? "application/json" : "text/markdown",
        content,
      },
    };
  }

  function revokeWorkbenchCollection({ projectId, collectionId } = {}, actor = null) {
    if (!actorCanManagePilot(actor)) {
      return { status: 403, body: { error: "commercial_pilot_review_forbidden" } };
    }
    const detail = getWorkbenchCollection({ projectId, collectionId }, actor);
    if (detail.status !== 200) return detail;
    const collection = state.businessPilotCollections.find((row) => row.id === collectionId);
    if (collection.revokedAt) {
      return { status: 200, body: { collection: collectionSummary(collection, null), replayed: true } };
    }
    const timestamp = now();
    runTx(() => {
      collection.revokedAt = timestamp;
      collection.revokedBy = actor?.userId ?? "user_local";
      const receipt = state.businessPilotEvidenceReceipts.find((row) =>
        row.id === collection.evidenceReceiptId && row.ownerTeamId === actorTeam(actor));
      if (receipt) {
        receipt.revokedAt = timestamp;
        receipt.revokedBy = actor?.userId ?? "user_local";
      }
      const draft = draftFor(projectId, actor);
      if (draft?.lastCollection?.manifest?.evidenceReceipt?.id === collection.evidenceReceiptId) {
        draft.lastCollection = null;
        draft.lastCollectionDigest = null;
        draft.revision += 1;
        draft.updatedAt = timestamp;
        draft.updatedBy = actor?.userId ?? "user_local";
      }
    });
    return { status: 200, body: { collection: collectionSummary(collection, null), replayed: false } };
  }

  return {
    collect,
    verify,
    getWorkbench,
    saveWorkbench,
    prepareWorkbench,
    createWorkbenchGapIssues,
    submitWorkbenchReview,
    updateWorkbenchRollout,
    collectWorkbench,
    getWorkbenchCollection,
    compareWorkbenchCollections,
    exportWorkbenchCollection,
    revokeWorkbenchCollection,
  };
}
