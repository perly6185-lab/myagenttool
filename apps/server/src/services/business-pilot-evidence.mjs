import { actorCanAccessProject } from "../runtime/auth.mjs";
import {
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

const SAFETY_MARKERS = Object.freeze({
  unauthorized_path_read: ["unauthorized_path", "path_not_allowed", "outside_project"],
  path_traversal: ["path_traversal", "outside_project", "unsafe_path"],
  escaping_symlink: ["symlink", "symbolic_link"],
  prompt_injection: ["prompt_injection", "instruction_like_content"],
  formula_injection: ["formula_injection", "unsafe_formula", "spreadsheet_formula"],
  stale_approval: ["stale_approval", "approval_expired", "revision_conflict"],
  silent_overwrite: ["overwrite", "changed_since_preview", "target_exists"],
  automatic_delivery: ["automatic_delivery", "delivery_approval_required", "delivery_refused"],
  approval_bypass: ["approval_bypass", "approval_required", "cannot_bypass_approval"],
  cross_tenant: ["cross_tenant", "tenant", "permission_denied"],
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
  if (!safeText(row.id, 80) || !SAFE_ID.test(row.id) || !SAFETY_MARKERS[row.id]) {
    errors.push(`${path}.id: supported safety scenario required`);
  }
  if (!SAFETY_KINDS.has(row.evidenceKind)) {
    errors.push(`${path}.evidenceKind: event, refusal, or classification required`);
  }
  if (!safeText(row.evidenceId, 80) || !SAFE_ID.test(row.evidenceId)) {
    errors.push(`${path}.evidenceId: safe identifier required`);
  }
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

function flattenedTokens(value) {
  const tokens = [];
  const visit = (candidate, depth = 0) => {
    if (depth > 5 || candidate == null) return;
    if (typeof candidate === "string" || typeof candidate === "number"
      || typeof candidate === "boolean") {
      tokens.push(String(candidate).toLowerCase());
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.slice(0, 100).forEach((row) => visit(row, depth + 1));
      return;
    }
    if (isObject(candidate)) {
      Object.entries(candidate).slice(0, 100).forEach(([key, row]) => {
        tokens.push(key.toLowerCase());
        visit(row, depth + 1);
      });
    }
  };
  visit(value);
  return tokens.join(" ");
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
  }
  if (!record) {
    return { passed: false, reason: "evidence_not_found_or_not_visible" };
  }
  const haystack = flattenedTokens(record);
  const markerMatched = SAFETY_MARKERS[scenario.id].some((marker) => haystack.includes(marker));
  const governedDenial = scenario.evidenceKind === "refusal"
    || [
      "refus",
      "denied",
      "blocked",
      "reject",
      "failed",
      "not_found",
      "required",
      "unsafe",
      "conflict",
    ].some((marker) => haystack.includes(marker));
  const classificationProof = scenario.evidenceKind === "classification"
    && ["prompt_injection", "formula_injection"].includes(scenario.id);
  const passed = markerMatched && (governedDenial || classificationProof);
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

function eventForRun(state, run, type) {
  return (state.events ?? []).some((row) =>
    row.type === type
    && row.data?.actorTeamId === run.ownerTeamId
    && row.data?.routineRunId === run.id);
}

function recoveryEvidence(state, run, traits) {
  const rows = [];
  if (traits.includes("restart")) {
    const retried = run.actionReceipts?.some((receipt) => receipt.action === "retry")
      || eventForRun(state, run, "routine_step_retried");
    rows.push({ id: "restart", passed: Boolean(retried && run.status === "succeeded") });
  }
  if (traits.includes("concurrency")) {
    const waited = eventForRun(state, run, "routine_step_waiting_for_capacity");
    const released = eventForRun(state, run, "routine_capacity_released");
    rows.push({ id: "concurrency", passed: waited && released && run.status === "succeeded" });
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
      && candidate.projectId === run.projectId)).filter(Boolean);
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
  const approvals = (run.stepRuns ?? []).filter((stepRun) =>
    quotationApprovalStepKeys.has(stepRun.stepKey)
    && stepRun.approval?.state === "approved").length
    + ledgerMutations.filter((mutation) => Boolean(mutation.approverId)).length;
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
    && candidate.parentId === workItem.id);
  const outcome = rejected
    ? "rejected"
    : conditionOutcome === true || hasOrderChild
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
    recoveries: recoveryEvidence(state, run, traits),
  };
  const missing = [];
  if (!triggerClassification) missing.push("confirmed_trigger_classification");
  if (!definition) missing.push("published_routine_definition");
  if (row.relationshipExpected && observed.relationshipRank == null) {
    missing.push("ranked_relationship");
  }
  if (!["succeeded", "cancelled", "failed"].includes(run.status)) missing.push("terminal_routine_run");
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

export function createBusinessPilotEvidenceService({ state } = {}) {
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
    const manifest = {
      schemaVersion: 1,
      pilotId: spec.pilotId,
      ...(spec.description == null ? {} : { description: spec.description }),
      dataClassification: spec.dataClassification,
      consent: spec.consent,
      releaseReview: spec.releaseReview,
      thresholds: spec.thresholds,
      cases,
      safetyScenarios: safetyResults.map((row) => row.manifest),
    };
    const report = evaluateCommercialPilotManifest(manifest, { qualityGatePassed: false });
    const evidence = {
      schemaVersion: 1,
      pilotId: spec.pilotId,
      state: evidenceCases.every((row) => row.state === "complete")
        && safetyResults.every((row) => row.evidence.state === "complete")
        ? "complete"
        : "incomplete",
      cases: evidenceCases,
      safetyScenarios: safetyResults.map((row) => row.evidence),
    };
    return { status: 200, body: { evidence, manifest, report } };
  }

  return { collect };
}
