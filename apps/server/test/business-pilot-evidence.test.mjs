import assert from "node:assert/strict";
import test from "node:test";

import {
  createBusinessPilotEvidenceService,
  validateCommercialPilotEvidenceSpec,
} from "../src/services/business-pilot-evidence.mjs";

const ACTOR_A = { userId: "usr_a", teamId: "team_a" };
const ACTOR_B = { userId: "usr_b", teamId: "team_b" };
const ACTOR_VIEWER = { userId: "usr_viewer", teamId: "team_a", role: "viewer" };

function stateFixture() {
  return {
    projects: [
      { id: "prj_a", ownerTeamId: "team_a" },
      { id: "prj_b", ownerTeamId: "team_b" },
    ],
    workItems: [{
      id: "wit_case_a",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      routineDefinitionId: "rtd_quote",
      routineVersion: 1,
      businessCaseId: "bcs_a",
    }],
    routineRuns: [{
      id: "rtr_a",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      workItemId: "wit_case_a",
      routineDefinitionId: "rtd_quote",
      routineVersion: 1,
      businessCaseId: "bcs_a",
      triggerArtifactIds: ["wfa_inquiry"],
      status: "succeeded",
      actionReceipts: [{ action: "retry", stepKey: "quotation" }],
      recoveryReceipts: [
        {
          kind: "step_retry",
          stepKey: "quotation",
          previousErrorCode: "routine_step_interrupted",
          retriedAt: "2026-07-30T00:00:01.000Z",
        },
        {
          kind: "device_capacity",
          queuedAt: "2026-07-30T00:00:00.000Z",
          releasedAt: "2026-07-30T00:00:01.000Z",
          startedStepKeys: ["quotation"],
        },
      ],
      stepRuns: [
        {
          stepKey: "quotation",
          kind: "generate",
          state: "succeeded",
          outputRefs: [{ kind: "file", relativePath: "drafts/quotation.md" }],
        },
        {
          stepKey: "approval",
          kind: "human_approval",
          state: "succeeded",
          approval: { state: "approved", decidedBy: "usr_a" },
          outputRefs: [],
        },
        { stepKey: "ledger", kind: "ledger_upsert", state: "succeeded", outputRefs: [] },
      ],
    }],
    routineDefinitions: [{
      id: "rtd_quote",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      version: 1,
      steps: [
        {
          key: "quotation",
          kind: "generate",
          label: "Prepare quotation",
          configuration: { documentTypes: ["quotation"] },
        },
        { key: "approval", kind: "human_approval", label: "Approve quotation" },
        { key: "ledger", kind: "ledger_upsert", label: "Register quotation" },
      ],
    }],
    businessCases: [{
      id: "bcs_a",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      businessKey: "RFQ-001",
      artifactBindings: [],
      artifactFingerprints: {},
    }],
    businessCaseCandidates: [{
      id: "bcc_a",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      businessCaseId: "bcs_a",
      state: "confirmed",
      links: [
        { fromArtifactId: "wfa_inquiry", toArtifactId: "wfa_quote", score: 0.92 },
        { fromArtifactId: "wfa_inquiry", toArtifactId: "wfa_other", score: 0.71 },
      ],
    }],
    workflowArtifacts: [{
      id: "wfa_inquiry",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      fingerprint: "a".repeat(64),
    }],
    businessDocumentClassifications: [{
      id: "bdc_inquiry",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      artifactId: "wfa_inquiry",
      artifactFingerprint: "a".repeat(64),
      documentType: "inquiry",
      confirmationState: "corrected",
      fieldProposals: [{ key: "customer", confirmationState: "corrected" }],
      riskSignals: ["instruction_like_content", "prompt_injection_ignore_previous"],
    }],
    ledgerMutationAudits: [{
      id: "lma_a",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      routineRunId: "rtr_a",
      routineStepKey: "ledger",
      ledgerDefinitionId: "ldg_quote",
      businessKey: "RFQ-001",
      action: "insert",
      approverId: "usr_a",
    }],
    events: [
      {
        id: "evt_restart",
        type: "routine_step_retried",
        data: { actorTeamId: "team_a", routineRunId: "rtr_a" },
      },
      {
        id: "evt_wait",
        type: "routine_step_waiting_for_capacity",
        data: { actorTeamId: "team_a", routineRunId: "rtr_a" },
      },
      {
        id: "evt_release",
        type: "routine_capacity_released",
        data: { actorTeamId: "team_a", routineRunId: "rtr_a" },
      },
    ],
    refusals: [],
  };
}

function specFixture() {
  return {
    schemaVersion: 1,
    pilotId: "pilot-auto-evidence",
    description: "System-derived pilot evidence.",
    dataClassification: "synthetic",
    consent: { confirmed: false },
    releaseReview: {
      confirmed: false,
      recordedAt: "2026-07-30T00:00:00.000Z",
      reviewerRole: "pilot reviewer",
      performance: false,
      security: false,
      privacy: false,
      accessibility: false,
      localization: false,
      migration: false,
      rollback: false,
    },
    thresholds: {
      minimumFormalCases: 10,
      documentRoleTop1: 0.9,
      relationshipTop1: 0.8,
    },
    cases: [{
      id: "case-01",
      workItemId: "wit_case_a",
      templateId: "markdown-a",
      traits: ["restart", "concurrency"],
      expectedDocumentRole: "inquiry",
      relationshipExpected: true,
      relationshipArtifactId: "wfa_quote",
      expectedOutcome: "ordered",
    }],
    safetyScenarios: [{
      id: "prompt_injection",
      evidenceKind: "classification",
      evidenceId: "bdc_inquiry",
    }],
  };
}

test("collector derives observations from governed runtime evidence", () => {
  const serviceState = stateFixture();
  const service = createBusinessPilotEvidenceService({ state: serviceState });
  const result = service.collect(specFixture(), ACTOR_A);
  assert.equal(result.status, 200);
  assert.equal(result.body.evidence.state, "incomplete");
  assert.ok(result.body.evidence.missing.includes("minimum_formal_cases"));
  assert.ok(result.body.evidence.missing.includes("complete_safety_evidence") === false);
  assert.equal(result.body.evidence.cases[0].routineRunId, "rtr_a");
  assert.deepEqual(result.body.manifest.cases[0].observed, {
    documentRole: "inquiry",
    relationshipRank: 1,
    correctionCount: 1,
    completed: true,
    evidenceComplete: true,
    outcome: "no_order",
    duplicateIssueCount: 0,
    duplicateBusinessCaseCount: 0,
    duplicateQuotationCount: 0,
    duplicateLedgerRowCount: 0,
    quotationMutationCount: 1,
    ledgerMutationCount: 1,
    approvalCount: 2,
    approvalComplete: true,
    recoveries: [
      { id: "restart", passed: true },
      { id: "concurrency", passed: true },
    ],
  });
  assert.deepEqual(result.body.manifest.safetyScenarios, [
    { id: "prompt_injection", passed: true },
  ]);
  assert.equal(result.body.report.formalEligible, false);
  assert.equal(result.body.report.gate.decision, "no_go");
  assert.equal(service.verify({ manifest: result.body.manifest }, ACTOR_A).body.verified, true);
  const tampered = structuredClone(result.body.manifest);
  tampered.cases[0].observed.completed = false;
  assert.equal(service.verify({ manifest: tampered }, ACTOR_A).status, 404);
  assert.equal(service.verify({ manifest: result.body.manifest }, ACTOR_B).status, 404);
  const restartedService = createBusinessPilotEvidenceService({ state: serviceState });
  assert.equal(
    restartedService.verify({ manifest: result.body.manifest }, ACTOR_A).body.verified,
    true,
  );
});

test("collector rejects operator-supplied observed results", () => {
  const spec = specFixture();
  spec.cases[0].observed = { completed: true };
  const validation = validateCommercialPilotEvidenceSpec(spec);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("cases[0].observed: unexpected field"));
});

test("collector rejects unexpected nested fields instead of reflecting them", () => {
  const spec = specFixture();
  spec.consent.rawCustomerDocument = "must not be echoed";
  const result = createBusinessPilotEvidenceService({ state: stateFixture() })
    .collect(spec, ACTOR_A);
  assert.equal(result.status, 400);
  assert.ok(result.body.validation.errors.includes(
    "consent.rawCustomerDocument: unexpected field",
  ));
  assert.doesNotMatch(JSON.stringify(result), /must not be echoed/);
});

test("collector gives the same not-found result for missing and foreign work items", () => {
  const service = createBusinessPilotEvidenceService({ state: stateFixture() });
  const foreign = service.collect(specFixture(), ACTOR_B);
  assert.deepEqual(foreign, {
    status: 404,
    body: { error: "pilot_case_execution_not_found" },
  });
  const missingSpec = specFixture();
  missingSpec.cases[0].workItemId = "wit_missing";
  const missing = service.collect(missingSpec, ACTOR_A);
  assert.deepEqual(missing, foreign);
});

test("collector derives ordered and rejected outcomes from runtime branches", () => {
  const orderedState = stateFixture();
  orderedState.routineRuns[0].stepRuns.push({
    stepKey: "order_signal",
    kind: "condition",
    state: "succeeded",
    conditionOutcome: true,
    outputRefs: [],
  });
  orderedState.workItems.push({
    id: "wit_order_child",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    parentId: "wit_case_a",
    labels: ["routine-work", "order-processing"],
  });
  orderedState.workflowArtifacts.push({
    id: "wfa_order",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    sourceId: "wfs_a",
    fingerprint: "b".repeat(64),
    availability: "available",
    exclusion: false,
  });
  orderedState.businessDocumentClassifications.push({
    id: "bdc_order",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    sourceId: "wfs_a",
    artifactId: "wfa_order",
    artifactFingerprint: "b".repeat(64),
    documentType: "order",
    confirmationState: "confirmed",
  });
  orderedState.businessCases[0].artifactBindings.push({
    artifactId: "wfa_order",
    documentType: "order",
    roles: ["input"],
  });
  orderedState.businessCases[0].artifactFingerprints.wfa_order = "b".repeat(64);
  const orderedSpec = specFixture();
  orderedSpec.cases[0].expectedOutcome = "ordered";
  const ordered = createBusinessPilotEvidenceService({ state: orderedState })
    .collect(orderedSpec, ACTOR_A);
  assert.equal(ordered.body.manifest.cases[0].observed.outcome, "ordered");

  const rejectedState = stateFixture();
  rejectedState.routineRuns[0].status = "failed";
  rejectedState.routineRuns[0].stepRuns
    .find((row) => row.stepKey === "approval").approval.state = "rejected";
  const rejectedSpec = specFixture();
  rejectedSpec.cases[0].expectedOutcome = "rejected";
  const rejected = createBusinessPilotEvidenceService({ state: rejectedState })
    .collect(rejectedSpec, ACTOR_A);
  assert.equal(rejected.body.manifest.cases[0].observed.outcome, "rejected");
  assert.equal(rejected.body.manifest.cases[0].observed.completed, true);
});

test("collector does not infer an order from a generic child issue alone", () => {
  const state = stateFixture();
  state.routineRuns[0].stepRuns.push({
    stepKey: "order_signal",
    kind: "condition",
    state: "succeeded",
    conditionOutcome: true,
    outputRefs: [],
  });
  state.workItems.push({
    id: "wit_generic_child",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    parentId: "wit_case_a",
    labels: ["routine-work"],
  });
  const result = createBusinessPilotEvidenceService({ state }).collect(specFixture(), ACTOR_A);
  assert.equal(result.body.manifest.cases[0].observed.outcome, "no_order");
  assert.equal(result.body.manifest.cases[0].observed.evidenceComplete, false);
  assert.ok(result.body.evidence.cases[0].missing.includes(
    "confirmed_order_outcome_evidence",
  ));
});

test("collector distinguishes an ordinary retry from restart recovery", () => {
  const state = stateFixture();
  state.routineRuns[0].recoveryReceipts[0].previousErrorCode = "routine_step_failed";
  const result = createBusinessPilotEvidenceService({ state }).collect(specFixture(), ACTOR_A);
  assert.deepEqual(result.body.manifest.cases[0].observed.recoveries[0], {
    id: "restart",
    passed: false,
  });
  assert.ok(result.body.evidence.cases[0].missing.includes("successful_recovery_trace"));
});

test("collector counts duplicate issues, cases, quotations, and ledger rows", () => {
  const state = stateFixture();
  state.workItems.push({
    ...state.workItems[0],
    id: "wit_duplicate",
  });
  state.businessCases.push({
    ...state.businessCases[0],
    id: "bcs_duplicate",
  });
  state.routineRuns[0].stepRuns[0].outputRefs.push({
    kind: "file",
    relativePath: "drafts/quotation-copy.md",
  });
  state.ledgerMutationAudits.push({
    ...state.ledgerMutationAudits[0],
    id: "lma_duplicate",
  });
  const result = createBusinessPilotEvidenceService({ state }).collect(specFixture(), ACTOR_A);
  const observed = result.body.manifest.cases[0].observed;
  assert.equal(observed.duplicateIssueCount, 1);
  assert.equal(observed.duplicateBusinessCaseCount, 1);
  assert.equal(observed.duplicateQuotationCount, 1);
  assert.equal(observed.duplicateLedgerRowCount, 1);
  assert.equal(observed.approvalComplete, false);
  assert.equal(result.body.report.metrics.duplicates.total, 4);
});

test("safety evidence fails closed when the referenced record does not prove the scenario", () => {
  const spec = specFixture();
  spec.safetyScenarios[0] = {
    id: "formula_injection",
    evidenceKind: "classification",
    evidenceId: "bdc_inquiry",
  };
  const result = createBusinessPilotEvidenceService({ state: stateFixture() })
    .collect(spec, ACTOR_A);
  assert.equal(result.status, 200);
  assert.equal(result.body.evidence.state, "incomplete");
  assert.deepEqual(result.body.manifest.safetyScenarios, [
    { id: "formula_injection", passed: false },
  ]);
  assert.deepEqual(result.body.evidence.safetyScenarios[0].missing, [
    "evidence_does_not_prove_scenario",
  ]);
});

test("safety evidence requires a typed blocked outcome, not matching free text", () => {
  const state = stateFixture();
  state.events.push({
    id: "evt_approval_bypass",
    type: "routine_action_refused",
    data: {
      actorTeamId: "team_a",
      message: "approval_bypass human_approval_step_cannot_bypass_approval blocked",
    },
  });
  const spec = specFixture();
  spec.safetyScenarios[0] = {
    id: "approval_bypass",
    evidenceKind: "event",
    evidenceId: "evt_approval_bypass",
  };
  let result = createBusinessPilotEvidenceService({ state }).collect(spec, ACTOR_A);
  assert.equal(result.body.manifest.safetyScenarios[0].passed, false);

  Object.assign(state.events.at(-1).data, {
    pilotSafetyScenarioId: "approval_bypass",
    outcome: "blocked",
    error: "human_approval_step_cannot_bypass_approval",
  });
  result = createBusinessPilotEvidenceService({ state }).collect(spec, ACTOR_A);
  assert.equal(result.body.manifest.safetyScenarios[0].passed, true);
});

test("classification safety evidence must match a current available artifact", () => {
  const state = stateFixture();
  state.workflowArtifacts[0].fingerprint = "c".repeat(64);
  const result = createBusinessPilotEvidenceService({ state }).collect(specFixture(), ACTOR_A);
  assert.equal(result.body.manifest.safetyScenarios[0].passed, false);
  assert.deepEqual(result.body.evidence.safetyScenarios[0].missing, [
    "evidence_not_found_or_not_visible",
  ]);
});

test("collector verifies the complete structured safety scenario matrix", () => {
  const state = stateFixture();
  state.businessDocumentClassifications[0].riskSignals.push(
    "spreadsheet_formula_value_excluded",
  );
  const eventScenarios = {
    unauthorized_path_read: "asset_path_outside_project",
    path_traversal: "invalid_asset_path",
    escaping_symlink: "ledger_symbolic_link_not_supported",
    stale_approval: "ledger_preview_revision_conflict",
    silent_overwrite: "ledger_target_changed_since_preview",
    automatic_delivery: "delivery_approval_required",
    approval_bypass: "human_approval_step_cannot_bypass_approval",
    cross_tenant: "permission_denied",
  };
  for (const [id, error] of Object.entries(eventScenarios)) {
    state.events.push({
      id: `evt_${id}`,
      type: "pilot_safety_scenario_blocked",
      data: {
        actorTeamId: "team_a",
        pilotSafetyScenarioId: id,
        outcome: "blocked",
        error,
      },
    });
  }
  const spec = specFixture();
  spec.safetyScenarios = [
    {
      id: "prompt_injection",
      evidenceKind: "classification",
      evidenceId: "bdc_inquiry",
    },
    {
      id: "formula_injection",
      evidenceKind: "classification",
      evidenceId: "bdc_inquiry",
    },
    ...Object.keys(eventScenarios).map((id) => ({
      id,
      evidenceKind: "event",
      evidenceId: `evt_${id}`,
    })),
  ];
  const result = createBusinessPilotEvidenceService({ state }).collect(spec, ACTOR_A);
  assert.equal(result.status, 200);
  assert.equal(result.body.manifest.safetyScenarios.length, 10);
  assert.ok(result.body.manifest.safetyScenarios.every((scenario) => scenario.passed));
  assert.ok(result.body.evidence.safetyScenarios.every((scenario) =>
    scenario.state === "complete"));
  assert.equal(result.body.evidence.missing.includes("complete_safety_evidence"), false);
});

test("pilot workbench persists human truth, projects honest gaps, and replays collection", () => {
  const state = stateFixture();
  let ids = 0;
  const service = createBusinessPilotEvidenceService({
    state,
    now: () => "2026-07-30T12:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++ids}`,
  });
  const initial = service.getWorkbench({ projectId: "prj_a" }, ACTOR_A);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.draft.revision, 0);
  assert.equal(initial.body.eligible.workItems[0].id, "wit_case_a");
  assert.deepEqual(initial.body.eligible.safetyEvidence, [{
    id: "prompt_injection",
    evidenceKind: "classification",
    evidenceId: "bdc_inquiry",
  }]);
  assert.equal(initial.body.progress.caseCount, 0);
  assert.ok(initial.body.progress.missing.includes("minimum_formal_cases"));
  assert.equal(service.getWorkbench({ projectId: "prj_a" }, ACTOR_B).status, 404);
  assert.equal(service.getWorkbench({ projectId: "prj_a" }, ACTOR_VIEWER).status, 403);

  const draft = {
    pilotId: "pilot-workbench",
    description: "De-identified local commercial pilot.",
    dataClassification: "deidentified",
    consent: {
      confirmed: true,
      recordedAt: "2026-07-30T11:00:00.000Z",
      scope: "Local Workflow Memory V1.5 pilot only",
    },
    releaseReview: {
      confirmed: false,
      recordedAt: "2026-07-30T11:30:00.000Z",
      reviewerRole: "workspace owner",
      performance: false,
      security: false,
      privacy: false,
      accessibility: false,
      localization: false,
      migration: false,
      rollback: false,
    },
    cases: [{
      id: "case-01",
      workItemId: "wit_case_a",
      templateId: "markdown-a",
      traits: ["restart", "concurrency"],
      expectedDocumentRole: "inquiry",
      relationshipExpected: false,
      expectedOutcome: "no_order",
    }],
    safetyScenarios: [{
      id: "prompt_injection",
      evidenceKind: "classification",
      evidenceId: "bdc_inquiry",
    }],
  };
  const saved = service.saveWorkbench({
    projectId: "prj_a",
    expectedRevision: 0,
    draft,
  }, ACTOR_A);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.draft.revision, 1);
  assert.equal(saved.body.progress.caseCount, 1);
  assert.equal(saved.body.progress.completeCaseCount, 1);
  assert.equal(saved.body.progress.safety[0].passed, true);
  assert.ok(saved.body.progress.missing.includes("minimum_formal_cases"));

  const stale = service.saveWorkbench({
    projectId: "prj_a",
    expectedRevision: 0,
    draft,
  }, ACTOR_A);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "commercial_pilot_workbench_revision_conflict");
  const injected = structuredClone(draft);
  injected.cases[0].observed = { completed: true };
  assert.equal(service.saveWorkbench({
    projectId: "prj_a",
    expectedRevision: 1,
    draft: injected,
  }, ACTOR_A).status, 400);
  state.projects.push({ id: "prj_c", ownerTeamId: "team_a" });
  const crossProject = service.saveWorkbench({
    projectId: "prj_c",
    expectedRevision: 0,
    draft,
  }, ACTOR_A);
  assert.equal(crossProject.status, 404);
  assert.equal(crossProject.body.error, "pilot_case_execution_not_found");

  const collected = service.collectWorkbench({
    projectId: "prj_a",
    expectedRevision: 1,
  }, ACTOR_A);
  assert.equal(collected.status, 200);
  assert.equal(collected.body.replayed, false);
  assert.equal(collected.body.collection.evidence.state, "incomplete");
  assert.equal(collected.body.collection.verification.verified, true);
  assert.equal(collected.body.draft.revision, 2);
  const coalesced = service.collectWorkbench({
    projectId: "prj_a",
    expectedRevision: 1,
  }, ACTOR_A);
  assert.equal(coalesced.status, 200);
  assert.equal(coalesced.body.replayed, true);
  const replay = service.collectWorkbench({
    projectId: "prj_a",
    expectedRevision: 2,
  }, ACTOR_A);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(state.businessPilotEvidenceReceipts.length, 1);

  const restarted = createBusinessPilotEvidenceService({ state });
  const restored = restarted.getWorkbench({ projectId: "prj_a" }, ACTOR_A);
  assert.equal(restored.body.draft.revision, 2);
  assert.equal(restored.body.draft.lastCollection.evidence.pilotId, "pilot-workbench");
});
