import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import {
  businessRoutineCollectionKeys,
  createBusinessRoutineService,
  normalizeRoutineTriggerType,
  routineIdempotencyKeys,
  selectPublishedBusinessRoutine,
} from "../src/services/business-routines.mjs";
import {
  copyLocalLearnedTemplateOutput,
  inspectLocalQuotationTemplate,
  writeLocalQuotationDraft,
} from "../src/services/business-routine-executors.mjs";
import { projectRoutineDefinitionToTaskTemplate } from "../src/services/task-template-runtime.mjs";
import { sameProjectPath } from "../src/services/projects.mjs";

const ACTOR_A = { userId: "usr_a", teamId: "team_a" };
const ACTOR_B = { userId: "usr_b", teamId: "team_b" };

function workflowArtifactFingerprint(relativePath, absolutePath) {
  const stats = statSync(absolutePath);
  return createHash("sha256")
    .update(`${relativePath}\0${stats.size}\0${Math.trunc(stats.mtimeMs)}\0`)
    .update(readFileSync(absolutePath, "utf8"))
    .digest("hex");
}

function harness() {
  let id = 0;
  const events = [];
  const releasedReservations = [];
  const nextId = (prefix) => `${prefix}_${++id}`;
  const state = {
    projects: [
      { id: "prj_a", ownerTeamId: "team_a" },
      { id: "prj_b", ownerTeamId: "team_b" },
    ],
    workflowSources: [
      { id: "wfs_a", ownerTeamId: "team_a", projectId: "prj_a", state: "active" },
      { id: "wfs_b", ownerTeamId: "team_b", projectId: "prj_b", state: "active" },
    ],
    workflowArtifacts: [
      {
        id: "wfa_inquiry", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_a",
        availability: "available", fingerprint: "a".repeat(64), relativePath: "inquiries/RFQ-2026-001.md",
      },
      {
        id: "wfa_quote", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_a",
        availability: "available", fingerprint: "b".repeat(64), relativePath: "quotations/QUO-2026-001.md",
      },
      {
        id: "wfa_foreign", ownerTeamId: "team_b", projectId: "prj_b", sourceId: "wfs_b",
        availability: "available", fingerprint: "c".repeat(64), relativePath: "foreign.md",
      },
      {
        id: "wfa_order", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_a",
        availability: "available", fingerprint: "d".repeat(64), relativePath: "orders/PO-2026-001.md",
      },
      {
        id: "wfa_price", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_a",
        availability: "available", fingerprint: "f".repeat(64), relativePath: "references/price-list.md",
      },
    ],
    devices: [{ id: "dev_a", ownerTeamId: "team_a", maxConcurrency: 2 }],
    workItems: [],
  };
  const createWorkItem = (input, actor) => {
    const replay = state.workItems.find((row) =>
      row.ownerTeamId === actor.teamId && row.createIdempotencyKey === input.idempotencyKey);
    if (replay) return { ok: true, status: 200, body: { workItem: replay, replayed: true } };
    const workItem = {
      id: nextId("lwi"),
      localRef: `LOCAL-${state.workItems.length + 1}`,
      localNumber: state.workItems.length + 1,
      ownerTeamId: actor.teamId,
      terminalId: "dev_a",
      revision: 1,
      ...input,
      createIdempotencyKey: input.idempotencyKey,
    };
    state.workItems.push(workItem);
    return { ok: true, status: 201, body: { workItem } };
  };
  const createService = () => createBusinessRoutineService({
    state,
    now: () => "2026-07-29T00:00:00.000Z",
    nextId,
    appendEvent: (event) => events.push(event),
    createWorkItem,
    releaseRoutineLedgerReservations: (input) => releasedReservations.push(input),
  });
  const service = createService();
  return { state, events, releasedReservations, service, recreateService: createService };
}

function createCaseAndDefinition(service) {
  const entity = service.createBusinessEntity({
    projectId: "prj_a",
    sourceId: "wfs_a",
    entityType: "inquiry",
    businessKey: "RFQ-2026-001",
    fields: { inquiry_number: "RFQ-2026-001", quantity: 20 },
    evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "field", field: "inquiry_number" }],
    confidence: 0.96,
  }, ACTOR_A).body.entity;
  const businessCase = service.createBusinessCase({
    projectId: "prj_a",
    sourceId: "wfs_a",
    businessKey: "RFQ-2026-001",
    state: "confirmed",
    entityIds: [entity.id],
    artifactBindings: [
      { artifactId: "wfa_inquiry", documentType: "inquiry", roles: ["trigger", "input"] },
      { artifactId: "wfa_quote", documentType: "quotation", roles: ["output"] },
    ],
    evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "business_key", field: "inquiry_number" }],
    confidence: 0.93,
  }, ACTOR_A).body.businessCase;
  let definition = service.createRoutineDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Commercial inquiry and quotation",
    triggerDocumentTypes: ["inquiry"],
    steps: [
      { key: "extract", kind: "extract", label: "Extract inquiry" },
      { key: "quote", kind: "generate", label: "Generate quotation", dependsOn: ["extract"] },
      {
        key: "order",
        kind: "create_issue",
        label: "Create order issue",
        required: false,
        dependsOn: ["quote"],
      },
    ],
    evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "historical_case" }],
    confidence: 0.9,
  }, ACTOR_A).body.routineDefinition;
  definition = service.transitionRoutineDefinition({
    routineDefinitionId: definition.id,
    expectedRevision: definition.revision,
    action: "review",
  }, ACTOR_A).body.routineDefinition;
  definition = service.transitionRoutineDefinition({
    routineDefinitionId: definition.id,
    expectedRevision: definition.revision,
    action: "publish",
    confirmed: true,
  }, ACTOR_A).body.routineDefinition;
  return { entity, businessCase, definition };
}

test("lists only valid published routines as single-task templates", () => {
  const { state, service } = harness();
  state.routineDefinitions.push(
    {
      id: "rtd_valid", familyId: "rtd_valid", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_a",
      name: "客户方案", version: 1, state: "published", triggerDocumentTypes: ["customer_reference"],
      dataRequirements: [{ id: "customer", kind: "contact", label: "客户", required: true }],
      mutationPolicy: null, steps: [{ key: "generate", kind: "generate", label: "生成方案", required: true }],
    },
    {
      id: "rtd_recipe", familyId: "rtd_recipe", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_a",
      name: "方案与后续任务", version: 1, state: "published", triggerDocumentTypes: ["customer_reference"],
      dataRequirements: [], mutationPolicy: null,
      steps: [{ key: "create", kind: "create_issue", label: "创建后续任务", required: true }],
    },
  );
  const listed = service.listTaskTemplates({ projectId: "prj_a" }, ACTOR_A);
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.taskTemplates.map((template) => template.id), ["rtd_valid"]);
  assert.equal(listed.body.taskTemplates[0].state, "published");
  assert.equal(projectRoutineDefinitionToTaskTemplate(state.routineDefinitions[1]).ok, false);
});

test("published Routine selection normalizes common work-type names and fails closed", () => {
  const aliases = [
    ["contract-review", "contract review", "contract_review"],
    ["purchase request", "purchase-request", "purchase_request"],
    ["customer-complaint", "customer complaint", "customer_complaint"],
    ["weekly report", "weekly-report", "weekly_report"],
    ["project-acceptance", "project acceptance", "project_acceptance"],
  ];
  for (const [trigger, incoming, canonical] of aliases) {
    assert.equal(normalizeRoutineTriggerType(trigger), canonical);
    const selected = selectPublishedBusinessRoutine([{
      id: `routine_${canonical}`,
      state: "published",
      triggerDocumentTypes: [trigger],
      evidenceHealth: { state: "valid" },
    }], incoming);
    assert.equal(selected.status, 200);
    assert.equal(selected.body.documentType, canonical);
  }

  const missing = selectPublishedBusinessRoutine([], "weekly report");
  assert.equal(missing.status, 409);
  assert.equal(missing.body.error, "workflow_intake_routine_not_available");
  assert.match(missing.body.assistance.instruction, /发布/);

  const ambiguous = selectPublishedBusinessRoutine([
    { id: "rtd_b", state: "published", triggerDocumentTypes: ["contract_review"] },
    { id: "rtd_a", state: "published", triggerDocumentTypes: ["contract-review"] },
  ], "contract review");
  assert.equal(ambiguous.status, 409);
  assert.equal(ambiguous.body.error, "workflow_intake_routine_selection_required");
  assert.equal(ambiguous.body.routineCount, 2);
  assert.match(ambiguous.body.assistance.explanation, /无法安全判断/);
});

test("a confirmed non-inquiry document materializes one pinned Routine Issue idempotently", () => {
  const { state, service } = harness();
  state.workflowArtifacts.push({
    id: "wfa_contract",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    sourceId: "wfs_a",
    availability: "available",
    fingerprint: "e".repeat(64),
    relativePath: "contracts/CTR-2026-009.md",
  });
  state.workflowIntakeObservations = [{
    id: "wio_contract",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    sourceId: "wfs_a",
    artifactId: "wfa_contract",
    state: "ready",
  }];
  assert.equal(service.recordDocumentClassification({
    projectId: "prj_a",
    sourceId: "wfs_a",
    artifactId: "wfa_contract",
    artifactFingerprint: "e".repeat(64),
    documentType: "contract review",
    confidence: 0.98,
    reasons: ["Confirmed from historical contract-review work"],
    evidenceRefs: [{ artifactId: "wfa_contract", kind: "document_type" }],
    fieldProposals: [],
    riskSignals: [],
    confirmationState: "confirmed",
  }, ACTOR_A).status, 201);
  assert.equal(state.businessDocumentClassifications.at(-1).documentType, "contract_review");
  let definition = service.createRoutineDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Contract review",
    triggerDocumentTypes: ["contract-review"],
    steps: [
      { key: "extract", kind: "extract", label: "Read confirmed contract facts" },
      {
        key: "review",
        kind: "human_approval",
        label: "Review contract conclusion",
        dependsOn: ["extract"],
      },
    ],
    evidenceRefs: [{ artifactId: "wfa_contract", kind: "historical_example" }],
    confidence: 0.95,
  }, ACTOR_A).body.routineDefinition;
  assert.deepEqual(definition.triggerDocumentTypes, ["contract_review"]);
  definition = service.transitionRoutineDefinition({
    routineDefinitionId: definition.id,
    expectedRevision: definition.revision,
    action: "review",
  }, ACTOR_A).body.routineDefinition;
  definition = service.transitionRoutineDefinition({
    routineDefinitionId: definition.id,
    expectedRevision: definition.revision,
    action: "publish",
    confirmed: true,
  }, ACTOR_A).body.routineDefinition;

  const input = {
    projectId: "prj_a",
    sourceId: "wfs_a",
    observationId: "wio_contract",
    artifactId: "wfa_contract",
    documentType: "contract review",
  };
  const first = service.materializeAdaptiveRoutineSuggestion(input, ACTOR_A);
  assert.equal(first.status, 201);
  assert.equal(first.body.workItem.routineDefinitionId, definition.id);
  assert.match(first.body.workItem.title, /^Process contract review/);
  assert.ok(first.body.workItem.labels.includes("workflow-contract-review"));
  const replay = service.materializeAdaptiveRoutineSuggestion(input, ACTOR_A);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.workItem.id, first.body.workItem.id);
  assert.equal(state.workItems.length, 1);
});

test("records bounded document semantics independently from contextual roles", () => {
  const { service, state } = harness();
  const classified = service.recordDocumentClassification({
    projectId: "prj_a",
    sourceId: "wfs_a",
    artifactId: "wfa_quote",
    artifactFingerprint: "b".repeat(64),
    documentType: "quotation",
    confidence: 0.91,
    reasons: ["Quotation number found"],
    evidenceRefs: [{
      artifactId: "wfa_quote",
      kind: "field",
      field: "quotation_number",
      content: "raw content must not persist",
    }],
    confirmationState: "confirmed",
  }, ACTOR_A);
  assert.equal(classified.status, 201);
  assert.equal(classified.body.classification.documentType, "quotation");
  assert.equal(classified.body.classification.evidenceRefs[0].content, undefined);
  assert.equal(state.businessDocumentClassifications.length, 1);

  const { businessCase } = createCaseAndDefinition(service);
  assert.deepEqual(businessCase.artifactBindings.find((row) => row.artifactId === "wfa_quote"), {
    artifactId: "wfa_quote",
    documentType: "quotation",
    roles: ["output"],
  });
});

test("routine definition transitions reject stale revisions and foreign tenants", () => {
  const { service } = harness();
  const created = service.createRoutineDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Inquiry",
    triggerDocumentTypes: ["inquiry"],
    steps: [{ key: "extract", kind: "extract", label: "Extract" }],
    evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "case" }],
    confidence: 0.9,
  }, ACTOR_A).body.routineDefinition;

  assert.equal(service.transitionRoutineDefinition({
    routineDefinitionId: created.id,
    expectedRevision: 0,
    action: "review",
  }, ACTOR_A).body.error, "routine_definition_revision_conflict");
  assert.equal(service.transitionRoutineDefinition({
    routineDefinitionId: created.id,
    expectedRevision: created.revision,
    action: "review",
  }, ACTOR_B).status, 404);

  const reviewed = service.transitionRoutineDefinition({
    routineDefinitionId: created.id,
    expectedRevision: created.revision,
    action: "review",
  }, ACTOR_A);
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.routineDefinition.state, "draft");
  assert.equal(service.transitionRoutineDefinition({
    routineDefinitionId: created.id,
    expectedRevision: reviewed.body.routineDefinition.revision,
    action: "publish",
  }, ACTOR_A).body.error, "routine_definition_publication_confirmation_required");
  assert.equal(service.transitionRoutineDefinition({
    routineDefinitionId: created.id,
    expectedRevision: reviewed.body.routineDefinition.revision,
    action: "review",
  }, ACTOR_A).body.error, "invalid_routine_definition_transition");
});

test("discovered task types are editable drafts, explicitly published, immutable, and version pinned", () => {
  const { service, state } = harness();
  for (const index of [1, 2, 3]) {
    state.businessCases.push({
      id: `bcs_history_${index}`,
      ownerTeamId: ACTOR_A.teamId,
      projectId: "prj_a",
      sourceId: "wfs_a",
      businessKey: `RFQ-${index}`,
      state: "confirmed",
      artifactBindings: [
        { artifactId: "wfa_inquiry", documentType: "inquiry", roles: ["trigger"] },
        { artifactId: "wfa_quote", documentType: "quotation", roles: ["output"] },
      ],
      artifactFingerprints: {
        wfa_inquiry: "a".repeat(64),
        wfa_quote: "b".repeat(64),
      },
      revision: 1,
    });
  }
  state.routineDiscoveryCandidates.push({
    id: "rdc_1",
    ownerTeamId: ACTOR_A.teamId,
    projectId: "prj_a",
    sourceId: "wfs_a",
    state: "candidate",
    triggerDocumentTypes: ["inquiry"],
    confirmedCaseIds: ["bcs_history_1", "bcs_history_2", "bcs_history_3"],
    steps: [
      {
        key: "register",
        kind: "ledger_upsert",
        label: "Register the inquiry",
        required: true,
        requirement: "mandatory",
        coverage: 1,
        dependsOn: [],
        evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "coverage" }],
        configuration: {},
      },
      {
        key: "quote",
        kind: "generate",
        label: "Prepare the quotation",
        required: true,
        requirement: "mandatory",
        coverage: 1,
        dependsOn: ["register"],
        evidenceRefs: [{ artifactId: "wfa_quote", kind: "coverage" }],
        configuration: {},
      },
    ],
    evidenceRefs: [
      { artifactId: "wfa_inquiry", kind: "routine" },
      { artifactId: "wfa_quote", kind: "routine" },
    ],
    confidence: 0.92,
  });

  const created = service.createRoutineDraftFromDiscovery({
    discoveryCandidateId: "rdc_1",
  }, ACTOR_A);
  assert.equal(created.status, 201);
  assert.equal(created.body.routineDefinition.state, "draft");
  assert.equal(created.body.routineDefinition.historicalCaseIds.length, 3);

  const updated = service.updateRoutineDefinition({
    routineDefinitionId: created.body.routineDefinition.id,
    expectedRevision: created.body.routineDefinition.revision,
    name: "Commercial inquiry and quotation",
    description: "Prepare a reviewed quote from a confirmed inquiry.",
    steps: created.body.routineDefinition.steps,
  }, ACTOR_A);
  assert.equal(updated.status, 200);
  const invalidCondition = service.updateRoutineDefinition({
    routineDefinitionId: updated.body.routineDefinition.id,
    expectedRevision: updated.body.routineDefinition.revision,
    steps: updated.body.routineDefinition.steps.map((step, index) => index === 0
      ? { ...step, kind: "condition", configuration: {} }
      : step),
  }, ACTOR_A);
  assert.equal(invalidCondition.status, 400);
  assert.equal(invalidCondition.body.error, "routine_step_condition_required");
  const requiredConditionalDescendant = service.updateRoutineDefinition({
    routineDefinitionId: updated.body.routineDefinition.id,
    expectedRevision: updated.body.routineDefinition.revision,
    steps: updated.body.routineDefinition.steps.map((step, index) => index === 0
      ? { ...step, kind: "condition", configuration: { condition: "An order was received." } }
      : step),
  }, ACTOR_A);
  assert.equal(requiredConditionalDescendant.status, 400);
  assert.equal(requiredConditionalDescendant.body.error, "routine_conditional_descendant_must_be_optional");
  assert.equal(service.publishRoutineDefinition({
    routineDefinitionId: updated.body.routineDefinition.id,
    expectedRevision: updated.body.routineDefinition.revision,
    confirmed: false,
  }, ACTOR_A).status, 400);
  state.businessCases.find((row) => row.id === "bcs_history_1").state = "archived";
  const staleHistory = service.publishRoutineDefinition({
    routineDefinitionId: updated.body.routineDefinition.id,
    expectedRevision: updated.body.routineDefinition.revision,
    confirmed: true,
  }, ACTOR_A);
  assert.equal(staleHistory.status, 409);
  assert.equal(staleHistory.body.error, "routine_definition_evidence_not_valid");
  state.businessCases.find((row) => row.id === "bcs_history_1").state = "confirmed";
  const published = service.publishRoutineDefinition({
    routineDefinitionId: updated.body.routineDefinition.id,
    expectedRevision: updated.body.routineDefinition.revision,
    confirmed: true,
  }, ACTOR_A);
  assert.equal(published.status, 200);
  assert.equal(published.body.routineDefinition.state, "published");
  assert.equal(service.updateRoutineDefinition({
    routineDefinitionId: published.body.routineDefinition.id,
    expectedRevision: published.body.routineDefinition.revision,
    name: "Mutated published version",
  }, ACTOR_A).body.error, "published_routine_definition_is_immutable");

  const next = service.createRoutineDefinitionVersion({
    routineDefinitionId: published.body.routineDefinition.id,
    expectedRevision: published.body.routineDefinition.revision,
  }, ACTOR_A);
  assert.equal(next.status, 201);
  assert.equal(next.body.routineDefinition.version, 2);
  const publishedNext = service.publishRoutineDefinition({
    routineDefinitionId: next.body.routineDefinition.id,
    expectedRevision: next.body.routineDefinition.revision,
    confirmed: true,
  }, ACTOR_A);
  assert.equal(publishedNext.status, 200);
  assert.equal(published.body.routineDefinition.state, "superseded");
  assert.equal(published.body.routineDefinition.supersededById, publishedNext.body.routineDefinition.id);
  const disabled = service.transitionRoutineDefinition({
    routineDefinitionId: publishedNext.body.routineDefinition.id,
    expectedRevision: publishedNext.body.routineDefinition.revision,
    action: "disable",
  }, ACTOR_A);
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.routineDefinition.state, "disabled");
  assert.equal(service.transitionRoutineDefinition({
    routineDefinitionId: disabled.body.routineDefinition.id,
    expectedRevision: disabled.body.routineDefinition.revision,
    action: "enable",
  }, ACTOR_A).body.error, "invalid_routine_definition_transition");
});

test("routine runs pin versions, enforce dependencies, and use stable opaque idempotency keys", () => {
  const { service, state, events } = harness();
  const { businessCase, definition } = createCaseAndDefinition(service);
  const created = service.createRoutineRun({
    routineDefinitionId: definition.id,
    routineVersion: definition.version,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A);
  assert.equal(created.status, 201);
  assert.equal(created.body.routineRun.routineVersion, 1);
  assert.ok(created.body.routineRun.issueIdempotencyKey.startsWith("business-routine:issue:v1:"));
  assert.ok(!created.body.routineRun.issueIdempotencyKey.includes("RFQ-2026-001"));

  const replay = service.createRoutineRun({
    routineDefinitionId: definition.id,
    routineVersion: definition.version,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(state.routineRuns.length, 1);

  let run = created.body.routineRun;
  assert.equal(service.transitionRoutineStep({
    routineRunId: run.id,
    stepKey: "quote",
    expectedRevision: run.revision,
    action: "start",
  }, ACTOR_A).body.error, "routine_step_dependencies_incomplete");
  assert.equal(service.transitionRoutineStep({
    routineRunId: run.id,
    stepKey: "extract",
    expectedRevision: 0,
    action: "start",
  }, ACTOR_A).body.error, "routine_run_revision_conflict");
  assert.equal(service.transitionRoutineStep({
    routineRunId: run.id,
    stepKey: "extract",
    expectedRevision: run.revision,
    action: "start",
  }, ACTOR_B).status, 404);

  run = service.transitionRoutineStep({
    routineRunId: run.id,
    stepKey: "extract",
    expectedRevision: run.revision,
    action: "start",
  }, ACTOR_A).body.routineRun;
  run = service.transitionRoutineStep({
    routineRunId: run.id,
    stepKey: "extract",
    expectedRevision: run.revision,
    action: "succeed",
  }, ACTOR_A).body.routineRun;
  run = service.transitionRoutineStep({
    routineRunId: run.id,
    stepKey: "quote",
    expectedRevision: run.revision,
    action: "start",
  }, ACTOR_A).body.routineRun;
  run = service.transitionRoutineStep({
    routineRunId: run.id,
    stepKey: "quote",
    expectedRevision: run.revision,
    action: "succeed",
  }, ACTOR_A).body.routineRun;
  run = service.transitionRoutineStep({
    routineRunId: run.id,
    stepKey: "order",
    expectedRevision: run.revision,
    action: "skip",
  }, ACTOR_A).body.routineRun;
  assert.equal(run.status, "succeeded");
  assert.ok(events.some((event) => event.type === "routine_step_transitioned"));
  state.workflowSources[0].state = "revoked";
  assert.equal(service.createRoutineRun({
    routineDefinitionId: definition.id,
    routineVersion: definition.version,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A).body.replayed, true);
});

test("routine runs require a confirmed case and human approval cannot be bypassed", () => {
  const { service } = harness();
  const { businessCase, definition } = createCaseAndDefinition(service);
  businessCase.state = "proposed";
  assert.equal(service.createRoutineRun({
    routineDefinitionId: definition.id,
    routineVersion: definition.version,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A).body.error, "routine_business_case_not_confirmed");

  businessCase.state = "confirmed";
  definition.steps = [
    { key: "extract", kind: "extract", label: "Extract", required: true, dependsOn: [] },
    {
      key: "approve",
      kind: "human_approval",
      label: "Approve",
      required: true,
      dependsOn: ["extract"],
    },
  ];
  let run = service.createRoutineRun({
    routineDefinitionId: definition.id,
    routineVersion: definition.version,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A).body.routineRun;
  run = service.transitionRoutineStep({
    routineRunId: run.id,
    stepKey: "extract",
    expectedRevision: run.revision,
    action: "start",
  }, ACTOR_A).body.routineRun;
  assert.equal(service.transitionRoutineStep({
    routineRunId: run.id,
    stepKey: "extract",
    expectedRevision: run.revision,
    action: "await_approval",
  }, ACTOR_A).body.error, "routine_step_does_not_require_approval");
  run = service.transitionRoutineStep({
    routineRunId: run.id,
    stepKey: "extract",
    expectedRevision: run.revision,
    action: "succeed",
  }, ACTOR_A).body.routineRun;
  run = service.transitionRoutineStep({
    routineRunId: run.id,
    stepKey: "approve",
    expectedRevision: run.revision,
    action: "start",
  }, ACTOR_A).body.routineRun;
  assert.equal(service.transitionRoutineStep({
    routineRunId: run.id,
    stepKey: "approve",
    expectedRevision: run.revision,
    action: "succeed",
  }, ACTOR_A).body.error, "human_approval_step_cannot_bypass_approval");
  run = service.transitionRoutineStep({
    routineRunId: run.id,
    stepKey: "approve",
    expectedRevision: run.revision,
    action: "await_approval",
  }, ACTOR_A).body.routineRun;
  run = service.transitionRoutineStep({
    routineRunId: run.id,
    stepKey: "approve",
    expectedRevision: run.revision,
    action: "approve",
  }, ACTOR_A).body.routineRun;
  assert.equal(run.status, "succeeded");
});

test("routine Issues materialize once and schedule dependency-safe work with bounded read concurrency", () => {
  const { service, state } = harness();
  const { businessCase } = createCaseAndDefinition(service);
  let definition = service.createRoutineDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Process commercial inquiry",
    description: "Prepare and approve a quotation from an inquiry.",
    triggerDocumentTypes: ["inquiry"],
    steps: [
      { key: "extract", kind: "extract", label: "Read inquiry fields" },
      { key: "references", kind: "retrieve", label: "Retrieve references" },
      { key: "quote", kind: "generate", label: "Prepare quotation", dependsOn: ["extract", "references"] },
      { key: "approve", kind: "human_approval", label: "Approve quotation", dependsOn: ["quote"] },
      {
        key: "order_signal",
        kind: "condition",
        label: "Check for order",
        required: false,
        dependsOn: ["approve"],
        configuration: { condition: "A confirmed customer order was received." },
      },
      {
        key: "order_handoff",
        kind: "create_issue",
        label: "Create order follow-up",
        required: false,
        dependsOn: ["order_signal"],
      },
    ],
    evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "historical_case" }],
    confidence: 0.9,
  }, ACTOR_A).body.routineDefinition;
  definition = service.transitionRoutineDefinition({
    routineDefinitionId: definition.id,
    expectedRevision: definition.revision,
    action: "review",
  }, ACTOR_A).body.routineDefinition;
  definition = service.publishRoutineDefinition({
    routineDefinitionId: definition.id,
    expectedRevision: definition.revision,
    confirmed: true,
  }, ACTOR_A).body.routineDefinition;

  const created = service.materializeRoutineIssue({
    routineDefinitionId: definition.id,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A);
  assert.equal(created.status, 201);
  assert.equal(created.body.workItem.title, "Process inquiry — RFQ-2026-001");
  assert.equal(created.body.workItem.routineVersion, 1);
  assert.equal(created.body.execution.sourceId, "wfs_a");
  assert.equal(created.body.workItem.createIdempotencyKey, undefined);
  assert.equal(created.body.execution.run.actionReceipts, undefined);
  const replay = service.materializeRoutineIssue({
    routineDefinitionId: definition.id,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(state.workItems.filter((row) => row.routineDefinitionId === definition.id).length, 1);

  let execution = service.startRoutineWorkItem({
    workItemId: created.body.workItem.id,
    expectedRevision: created.body.execution.run.revision,
    idempotencyKey: "start-1",
  }, ACTOR_A).body.execution;
  assert.deepEqual(
    execution.steps.filter((step) => step.run.state === "running").map((step) => step.key).sort(),
    ["extract", "references"],
  );
  assert.equal(service.startRoutineWorkItem({
    workItemId: created.body.workItem.id,
    expectedRevision: 1,
    idempotencyKey: "start-1",
  }, ACTOR_A).body.replayed, true);

  execution = service.completeRoutineStep({
    workItemId: created.body.workItem.id,
    stepKey: "extract",
    expectedRevision: execution.run.revision,
    idempotencyKey: "complete-extract",
    outputRefs: [{ kind: "note", summary: "Inquiry fields extracted." }],
  }, ACTOR_A).body.execution;
  assert.equal(execution.steps.find((step) => step.key === "quote").run.state, "pending");
  execution = service.completeRoutineStep({
    workItemId: created.body.workItem.id,
    stepKey: "references",
    expectedRevision: execution.run.revision,
    idempotencyKey: "complete-references",
    executorId: "local.reference-retrieval.v1",
  }, ACTOR_A).body.execution;
  assert.equal(execution.steps.find((step) => step.key === "quote").run.state, "running");
  execution = service.completeRoutineStep({
    workItemId: created.body.workItem.id,
    stepKey: "quote",
    expectedRevision: execution.run.revision,
    idempotencyKey: "fail-quote",
    succeeded: false,
    errorCode: "quotation_generation_interrupted",
    executorId: "local.markdown-quotation-draft.v1",
  }, ACTOR_A).body.execution;
  assert.equal(execution.run.status, "failed");
  execution = service.retryRoutineStep({
    workItemId: created.body.workItem.id,
    stepKey: "quote",
    expectedRevision: execution.run.revision,
    idempotencyKey: "retry-quote",
  }, ACTOR_A).body.execution;
  assert.equal(execution.steps.find((step) => step.key === "quote").run.attempts, 2);
  execution = service.completeRoutineStep({
    workItemId: created.body.workItem.id,
    stepKey: "quote",
    expectedRevision: execution.run.revision,
    idempotencyKey: "complete-quote",
    executorId: "local.markdown-quotation-draft.v1",
  }, ACTOR_A).body.execution;
  assert.equal(execution.run.status, "awaiting_approval");
  assert.equal(service.transitionRoutineStep({
    routineRunId: execution.run.id,
    stepKey: "approve",
    expectedRevision: execution.run.revision,
    action: "succeed",
  }, ACTOR_A).body.error, "human_approval_step_cannot_bypass_approval");
  execution = service.decideRoutineApproval({
    workItemId: created.body.workItem.id,
    stepKey: "approve",
    expectedRevision: execution.run.revision,
    idempotencyKey: "approve-quote",
    approved: true,
  }, ACTOR_A).body.execution;
  assert.equal(execution.run.status, "awaiting_condition");
  execution = service.decideRoutineCondition({
    workItemId: created.body.workItem.id,
    stepKey: "order_signal",
    expectedRevision: execution.run.revision,
    idempotencyKey: "no-order",
    outcome: false,
  }, ACTOR_A).body.execution;
  assert.equal(execution.run.status, "succeeded");
  assert.equal(execution.steps.find((step) => step.key === "order_handoff").run.state, "skipped");
});

test("governed executors retrieve current evidence, write one quotation draft, and reuse the order child Issue", () => {
  const root = join(tmpdir(), `myagenttool-routine-executors-${Date.now()}`);
  const sourceRoot = join(root, "commercial");
  mkdirSync(sourceRoot, { recursive: true });
  try {
    const { service, state } = harness();
    state.projects.find((project) => project.id === "prj_a").path = root;
    state.workflowSources.find((source) => source.id === "wfs_a").relativePath = "commercial";
    state.businessDocumentClassifications.push(
      {
        id: "bdc_price",
        ownerTeamId: "team_a",
        projectId: "prj_a",
        sourceId: "wfs_a",
        artifactId: "wfa_price",
        artifactFingerprint: "f".repeat(64),
        documentType: "price_list",
        confirmationState: "confirmed",
      },
      {
        id: "bdc_order",
        ownerTeamId: "team_a",
        projectId: "prj_a",
        sourceId: "wfs_a",
        artifactId: "wfa_order",
        artifactFingerprint: "d".repeat(64),
        documentType: "order",
        confirmationState: "confirmed",
      },
    );
    const { businessCase } = createCaseAndDefinition(service);
    businessCase.artifactBindings.push({
      artifactId: "wfa_price",
      documentType: "price_list",
      roles: ["reference"],
    });
    businessCase.artifactFingerprints.wfa_price = "f".repeat(64);
    let definition = service.createRoutineDefinition({
      projectId: "prj_a",
      sourceId: "wfs_a",
      name: "Executable commercial inquiry",
      triggerDocumentTypes: ["inquiry"],
      steps: [
        {
          key: "references",
          kind: "retrieve",
          label: "Retrieve approved references",
          configuration: { documentTypes: ["price_list"] },
        },
        {
          key: "quotation",
          kind: "generate",
          label: "Prepare quotation",
          dependsOn: ["references"],
          configuration: { outputDirectory: "drafts/quotations" },
        },
        {
          key: "approve",
          kind: "human_approval",
          label: "Approve quotation",
          dependsOn: ["quotation"],
        },
        {
          key: "order_signal",
          kind: "condition",
          label: "Check for order",
          required: false,
          dependsOn: ["approve"],
          configuration: { condition: "A confirmed customer order was received." },
        },
        {
          key: "order_handoff",
          kind: "create_issue",
          label: "Create order follow-up",
          required: false,
          dependsOn: ["order_signal"],
        },
      ],
      evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "historical_case" }],
      confidence: 0.9,
    }, ACTOR_A).body.routineDefinition;
    definition = service.transitionRoutineDefinition({
      routineDefinitionId: definition.id,
      expectedRevision: definition.revision,
      action: "review",
    }, ACTOR_A).body.routineDefinition;
    definition = service.publishRoutineDefinition({
      routineDefinitionId: definition.id,
      expectedRevision: definition.revision,
      confirmed: true,
    }, ACTOR_A).body.routineDefinition;
    const materialized = service.materializeRoutineIssue({
      routineDefinitionId: definition.id,
      businessCaseId: businessCase.id,
      triggerArtifactIds: ["wfa_inquiry"],
    }, ACTOR_A).body;

    let execution = service.startRoutineWorkItem({
      workItemId: materialized.workItem.id,
      expectedRevision: materialized.execution.run.revision,
      idempotencyKey: "start-executors",
    }, ACTOR_A).body.execution;
    assert.equal(execution.steps.find((step) => step.key === "references").run.state, "running");
    execution = service.executeRoutineStep({
      workItemId: materialized.workItem.id,
      stepKey: "references",
      expectedRevision: execution.run.revision,
      idempotencyKey: "execute-references",
    }, ACTOR_A).body.execution;
    assert.equal(execution.steps.find((step) => step.key === "references").run.outputRefs[0].artifactId, "wfa_price");
    assert.equal(execution.steps.find((step) => step.key === "references").run.idempotencyKey, undefined);
    assert.equal(execution.steps.find((step) => step.key === "quotation").run.state, "running");
    assert.equal(service.completeRoutineStep({
      workItemId: materialized.workItem.id,
      stepKey: "quotation",
      expectedRevision: execution.run.revision,
      idempotencyKey: "manual-quotation-bypass",
    }, ACTOR_A).body.error, "routine_step_requires_governed_executor");

    const generated = service.executeRoutineStep({
      workItemId: materialized.workItem.id,
      stepKey: "quotation",
      expectedRevision: execution.run.revision,
      idempotencyKey: "execute-quotation",
    }, ACTOR_A);
    execution = generated.body.execution;
    const quotationOutput = execution.steps
      .find((step) => step.key === "quotation").run.outputRefs[0];
    assert.match(quotationOutput.relativePath, /^commercial\/drafts\/quotations\/quotation-RFQ-2026-001-r1-[a-f0-9]{8}\.md$/);
    assert.match(readFileSync(join(root, quotationOutput.relativePath), "utf8"), /Draft only/);
    assert.equal(execution.run.status, "awaiting_approval");
    const replay = service.executeRoutineStep({
      workItemId: materialized.workItem.id,
      stepKey: "quotation",
      expectedRevision: 1,
      idempotencyKey: "execute-quotation",
    }, ACTOR_A);
    assert.equal(replay.body.replayed, true);
    assert.equal(readdirSync(join(sourceRoot, "drafts/quotations")).length, 1);

    execution = service.decideRoutineApproval({
      workItemId: materialized.workItem.id,
      stepKey: "approve",
      expectedRevision: execution.run.revision,
      idempotencyKey: "approve-generated-quotation",
      approved: true,
    }, ACTOR_A).body.execution;
    const condition = service.decideRoutineCondition({
      workItemId: materialized.workItem.id,
      stepKey: "order_signal",
      expectedRevision: execution.run.revision,
      idempotencyKey: "confirmed-order-for-executor",
      outcome: true,
      triggerArtifactIds: ["wfa_order"],
    }, ACTOR_A);
    execution = condition.body.execution;
    assert.equal(execution.steps.find((step) => step.key === "order_handoff").run.state, "running");
    const handedOff = service.executeRoutineStep({
      workItemId: materialized.workItem.id,
      stepKey: "order_handoff",
      expectedRevision: execution.run.revision,
      idempotencyKey: "execute-order-handoff",
    }, ACTOR_A);
    assert.equal(handedOff.body.execution.run.status, "succeeded");
    assert.equal(handedOff.body.childWorkItem.id, condition.body.childWorkItem.id);
    assert.equal(state.workItems.filter((item) => item.parentId === materialized.workItem.id).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("automatic routine advancement runs governed safe steps and pauses for human approval", () => {
  const { service, state } = harness();
  const { businessCase } = createCaseAndDefinition(service);
  state.businessDocumentClassifications.push({
    id: "bdc_inquiry_current",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    sourceId: "wfs_a",
    artifactId: "wfa_inquiry",
    artifactFingerprint: "a".repeat(64),
    documentType: "inquiry",
    confirmationState: "confirmed",
    confidence: 1,
    riskSignals: [],
    fieldProposals: [],
    revision: 1,
  }, {
    id: "bdc_price_current",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    sourceId: "wfs_a",
    artifactId: "wfa_price",
    artifactFingerprint: "f".repeat(64),
    documentType: "price_list",
    confirmationState: "confirmed",
    confidence: 1,
    riskSignals: [],
    fieldProposals: [],
    revision: 1,
  });
  let definition = service.createRoutineDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Safe automatic inquiry preparation",
    triggerDocumentTypes: ["inquiry"],
    steps: [{
      key: "extract",
      kind: "extract",
      label: "Use confirmed inquiry facts",
    }, {
      key: "references",
      kind: "retrieve",
      label: "Retrieve approved references",
      dependsOn: ["extract"],
      configuration: { documentTypes: ["price_list"] },
    }, {
      key: "approve",
      kind: "human_approval",
      label: "Approve external delivery",
      dependsOn: ["references"],
    }],
    evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "historical_case" }],
    confidence: 0.95,
  }, ACTOR_A).body.routineDefinition;
  definition = service.transitionRoutineDefinition({
    routineDefinitionId: definition.id,
    expectedRevision: definition.revision,
    action: "review",
  }, ACTOR_A).body.routineDefinition;
  definition = service.transitionRoutineDefinition({
    routineDefinitionId: definition.id,
    expectedRevision: definition.revision,
    action: "publish",
    confirmed: true,
  }, ACTOR_A).body.routineDefinition;
  const materialized = service.materializeRoutineIssue({
    routineDefinitionId: definition.id,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A);

  const advanced = service.advanceRoutineWorkItem({
    workItemId: materialized.body.workItem.id,
  }, ACTOR_A);
  assert.equal(advanced.status, 200);
  assert.deepEqual(advanced.body.advancedStepKeys, ["extract", "references"]);
  assert.equal(advanced.body.execution.run.status, "awaiting_approval");
  assert.deepEqual(advanced.body.assistance, {
    stepKey: "approve",
    stepLabel: "Approve external delivery",
    kind: "awaiting_approval",
    reason: "human_approval_required",
    action: "review_approval",
  });
  assert.equal(
    advanced.body.execution.steps.find((step) => step.key === "references").run.state,
    "succeeded",
  );
  assert.equal(
    advanced.body.execution.steps.find((step) => step.key === "extract").run.state,
    "succeeded",
  );
});

test("automatic extraction fails closed when confirmed source facts are unavailable", () => {
  const { service } = harness();
  const { businessCase, definition } = createCaseAndDefinition(service);
  const materialized = service.materializeRoutineIssue({
    routineDefinitionId: definition.id,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A);

  const advanced = service.advanceRoutineWorkItem({
    workItemId: materialized.body.workItem.id,
  }, ACTOR_A);
  assert.equal(advanced.status, 200);
  assert.equal(advanced.body.execution.run.status, "failed");
  assert.deepEqual(advanced.body.advancedStepKeys, []);
  assert.deepEqual(advanced.body.assistance, {
    stepKey: "extract",
    stepLabel: "Extract inquiry",
    kind: "needs_review",
    reason: "routine_extract_confirmation_required",
    action: "review_extracted_facts",
  });
});

test("source review intent persists and resumes extraction only after facts are confirmed", () => {
  const { service, state, recreateService } = harness();
  const { businessCase, definition } = createCaseAndDefinition(service);
  const materialized = service.materializeRoutineIssue({
    routineDefinitionId: definition.id,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A);
  const failed = service.advanceRoutineWorkItem({
    workItemId: materialized.body.workItem.id,
  }, ACTOR_A);

  const requested = service.requestRoutineStepReview({
    workItemId: materialized.body.workItem.id,
    stepKey: "extract",
    expectedRevision: failed.body.execution.run.revision,
    idempotencyKey: "review-extract-once",
  }, ACTOR_A);
  assert.equal(requested.status, 200);
  assert.deepEqual(requested.body.execution.recovery, {
    kind: "retry_after_source_review",
    stepKey: "extract",
    requestedAt: "2026-07-29T00:00:00.000Z",
  });

  const restoredService = recreateService();
  const restored = restoredService.getRoutineWorkItemExecution({
    workItemId: materialized.body.workItem.id,
  }, ACTOR_A);
  assert.equal(restored.body.execution.recovery.stepKey, "extract");
  const stillWaiting = restoredService.resumeRoutineRecovery({
    workItemId: materialized.body.workItem.id,
    expectedRevision: restored.body.execution.run.revision,
    idempotencyKey: "resume-extract-before-confirmation",
  }, ACTOR_A);
  assert.equal(stillWaiting.status, 202);
  assert.equal(stillWaiting.body.awaitingReview, true);
  assert.equal(stillWaiting.body.execution.run.status, "failed");

  state.businessDocumentClassifications.push({
    id: "bdc_confirmed_after_review",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    sourceId: "wfs_a",
    artifactId: "wfa_inquiry",
    artifactFingerprint: "a".repeat(64),
    documentType: "inquiry",
    confirmationState: "confirmed",
    confidence: 1,
    riskSignals: [],
    fieldProposals: [],
    revision: 1,
  });
  const resumed = restoredService.resumeRoutineRecovery({
    workItemId: materialized.body.workItem.id,
    expectedRevision: restored.body.execution.run.revision,
    idempotencyKey: "resume-extract-after-confirmation",
  }, ACTOR_A);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.resumed, true);
  assert.equal(resumed.body.execution.recovery, null);
  assert.equal(
    resumed.body.execution.steps.find((step) => step.key === "extract").run.state,
    "running",
  );
});

test("a running task can persistently bind an active ledger without changing its published definition", () => {
  const { service, state } = harness();
  const { businessCase } = createCaseAndDefinition(service);
  let definition = service.createRoutineDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Register inquiry",
    triggerDocumentTypes: ["inquiry"],
    steps: [{ key: "register", kind: "ledger_upsert", label: "Register inquiry" }],
    evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "historical_case" }],
    confidence: 0.9,
  }, ACTOR_A).body.routineDefinition;
  definition = service.transitionRoutineDefinition({
    routineDefinitionId: definition.id,
    expectedRevision: definition.revision,
    action: "review",
  }, ACTOR_A).body.routineDefinition;
  definition = service.transitionRoutineDefinition({
    routineDefinitionId: definition.id,
    expectedRevision: definition.revision,
    action: "publish",
    confirmed: true,
  }, ACTOR_A).body.routineDefinition;
  state.ledgerDefinitions.push({
    id: "ldg_active",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Inquiry ledger",
    state: "active",
    documentType: "inquiry_ledger",
    format: "csv",
    relativePath: "ledgers/inquiries.csv",
    sheet: null,
  });
  state.ledgerDefinitions.push({
    id: "ldg_foreign",
    ownerTeamId: "team_b",
    projectId: "prj_b",
    sourceId: "wfs_b",
    name: "Foreign ledger",
    state: "active",
    documentType: "inquiry_ledger",
    format: "csv",
    relativePath: "foreign.csv",
    sheet: null,
  });
  const materialized = service.materializeRoutineIssue({
    routineDefinitionId: definition.id,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A);
  const started = service.startRoutineWorkItem({
    workItemId: materialized.body.workItem.id,
    expectedRevision: materialized.body.execution.run.revision,
    idempotencyKey: "start-ledger-binding",
  }, ACTOR_A);
  assert.deepEqual(started.body.execution.availableLedgers.map((ledger) => ledger.id), ["ldg_active"]);

  const bound = service.bindRoutineLedger({
    workItemId: materialized.body.workItem.id,
    stepKey: "register",
    ledgerDefinitionId: "ldg_active",
    expectedRevision: started.body.execution.run.revision,
    idempotencyKey: "bind-ledger-on-task",
  }, ACTOR_A);
  assert.equal(bound.status, 200);
  assert.equal(bound.body.execution.steps[0].configuration.ledgerDefinitionId, "ldg_active");
  assert.equal(definition.steps[0].configuration.ledgerDefinitionId, undefined);
  assert.equal(
    state.routineRuns.find((run) => run.id === bound.body.execution.run.id)
      .stepRuns[0].ledgerDefinitionId,
    "ldg_active",
  );
  assert.equal(service.validateRoutineLedgerStep({
    routineRunId: bound.body.execution.run.id,
    stepKey: "register",
    ledgerDefinitionId: "ldg_active",
  }, ACTOR_A).ok, true);
  assert.equal(service.validateRoutineLedgerStep({
    routineRunId: bound.body.execution.run.id,
    stepKey: "register",
    ledgerDefinitionId: "ldg_foreign",
  }, ACTOR_A).error, "routine_ledger_definition_mismatch");
});

test("confirmed-template quotations block missing and conflicting facts before rendering an audited draft", () => {
  const root = join(tmpdir(), `myagenttool-confirmed-quotation-${Date.now()}`);
  const sourceRoot = join(root, "commercial");
  const templateRelativePath = "templates/quotation-template.md";
  const templatePath = join(sourceRoot, templateRelativePath);
  mkdirSync(join(sourceRoot, "templates"), { recursive: true });
  writeFileSync(templatePath, [
    "# Quotation",
    "",
    "| Customer | Product | Quantity | Unit price | Currency | Tax | Delivery |",
    "| --- | --- | ---: | ---: | --- | --- | --- |",
    "| {{customer}} | {{product}} | {{quantity}} | {{unit_price}} | {{currency}} | {{tax_rate}} | {{delivery_terms}} |",
  ].join("\n"));
  try {
    const { service, state } = harness();
    state.projects.find((project) => project.id === "prj_a").path = root;
    Object.assign(state.workflowSources.find((source) => source.id === "wfs_a"), {
      relativePath: "commercial",
      readMode: "supported_text",
    });
    const templateFingerprint = workflowArtifactFingerprint(templateRelativePath, templatePath);
    state.workflowArtifacts.push({
      id: "wfa_template",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      availability: "available",
      fingerprint: templateFingerprint,
      relativePath: templateRelativePath,
      name: "quotation-template.md",
      extension: "md",
    });
    const { entity, businessCase } = createCaseAndDefinition(service);
    Object.assign(entity.fields, {
      customer: "Acme Original",
      product: "Controller",
      currency: "USD",
    });
    state.businessDocumentClassifications.push({
      id: "bdc_inquiry_conflict",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      artifactId: "wfa_inquiry",
      artifactFingerprint: "a".repeat(64),
      documentType: "inquiry",
      confirmationState: "confirmed",
      fieldProposals: [{
        key: "customer",
        value: "Acme Updated",
        normalizedValue: "Acme Updated",
        evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "field", field: "customer" }],
      }],
    });
    let definition = service.createRoutineDefinition({
      projectId: "prj_a",
      sourceId: "wfs_a",
      name: "Confirmed template quotation",
      triggerDocumentTypes: ["inquiry"],
      steps: [
        {
          key: "quotation",
          kind: "generate",
          label: "Prepare quotation",
          configuration: {
            executorId: "local.confirmed-template-quotation.v2",
            templateArtifactIds: ["wfa_template"],
          },
        },
        {
          key: "approval",
          kind: "human_approval",
          label: "Approve quotation",
          dependsOn: ["quotation"],
        },
      ],
      evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "historical_case" }],
      confidence: 0.9,
    }, ACTOR_A).body.routineDefinition;
    definition = service.transitionRoutineDefinition({
      routineDefinitionId: definition.id,
      expectedRevision: definition.revision,
      action: "review",
    }, ACTOR_A).body.routineDefinition;
    definition = service.publishRoutineDefinition({
      routineDefinitionId: definition.id,
      expectedRevision: definition.revision,
      confirmed: true,
    }, ACTOR_A).body.routineDefinition;
    const materialized = service.materializeRoutineIssue({
      routineDefinitionId: definition.id,
      businessCaseId: businessCase.id,
      triggerArtifactIds: ["wfa_inquiry"],
    }, ACTOR_A).body;
    let execution = service.startRoutineWorkItem({
      workItemId: materialized.workItem.id,
      expectedRevision: materialized.execution.run.revision,
      idempotencyKey: "start-confirmed-template",
    }, ACTOR_A).body.execution;

    execution = service.executeRoutineStep({
      workItemId: materialized.workItem.id,
      stepKey: "quotation",
      expectedRevision: execution.run.revision,
      idempotencyKey: "inspect-confirmed-template-inputs",
    }, ACTOR_A).body.execution;
    const review = execution.steps.find((step) => step.key === "quotation").run.quotationReview;
    assert.equal(review.status, "needs_input");
    assert.equal(review.fields.find((field) => field.key === "customer").state, "conflict");
    assert.equal(review.fields.find((field) => field.key === "unit_price").state, "missing");
    assert.equal(review.templateOptions[0].supported, true);
    assert.equal(review.templateOptions[0].fingerprint, undefined);

    assert.equal(service.confirmQuotationInputs({
      workItemId: materialized.workItem.id,
      stepKey: "quotation",
      expectedRevision: execution.run.revision,
      idempotencyKey: "reject-formula-answer",
      templateArtifactId: "wfa_template",
      answers: { unit_price: "=2+2" },
      confirmed: true,
    }, ACTOR_A).body.error, "routine_quotation_answers_invalid");
    const confirmedAnswers = {
      customer: "Acme Updated",
      unit_price: "25.00",
      tax_rate: "10%",
      delivery_terms: "15 days after order",
    };
    const confirmed = service.confirmQuotationInputs({
      workItemId: materialized.workItem.id,
      stepKey: "quotation",
      expectedRevision: execution.run.revision,
      idempotencyKey: "confirm-quotation-inputs",
      templateArtifactId: "wfa_template",
      answers: confirmedAnswers,
      confirmed: true,
    }, ACTOR_A);
    execution = confirmed.body.execution;
    assert.equal(
      execution.steps.find((step) => step.key === "quotation").run.quotationReview.status,
      "ready",
    );
    assert.equal(service.confirmQuotationInputs({
      workItemId: materialized.workItem.id,
      stepKey: "quotation",
      expectedRevision: 1,
      idempotencyKey: "confirm-quotation-inputs",
      templateArtifactId: "wfa_template",
      answers: confirmedAnswers,
      confirmed: true,
    }, ACTOR_A).body.replayed, true);
    assert.equal(service.confirmQuotationInputs({
      workItemId: materialized.workItem.id,
      stepKey: "quotation",
      expectedRevision: 1,
      idempotencyKey: "confirm-quotation-inputs",
      templateArtifactId: "wfa_template",
      answers: { ...confirmedAnswers, unit_price: "99.00" },
      confirmed: true,
    }, ACTOR_A).body.error, "routine_action_idempotency_conflict");

    execution = service.executeRoutineStep({
      workItemId: materialized.workItem.id,
      stepKey: "quotation",
      expectedRevision: execution.run.revision,
      idempotencyKey: "generate-confirmed-template",
    }, ACTOR_A).body.execution;
    const quotationStep = execution.steps.find((step) => step.key === "quotation");
    assert.equal(quotationStep.run.quotationReview.status, "generated");
    assert.match(quotationStep.run.quotationReview.draftPreview, /Acme Updated/);
    assert.equal(execution.run.status, "awaiting_approval");
    const output = quotationStep.run.outputRefs.find((row) => row.kind === "file");
    assert.match(output.relativePath, /quotation-RFQ-2026-001-r1-d1-[a-f0-9]{8}\.md$/);
    const content = readFileSync(join(root, output.relativePath), "utf8");
    assert.match(content, /Acme Updated/);
    assert.match(content, /15 days after order/);
    assert.doesNotMatch(content, /\{\{/);
    execution = service.decideRoutineApproval({
      workItemId: materialized.workItem.id,
      stepKey: "approval",
      expectedRevision: execution.run.revision,
      idempotencyKey: "reject-confirmed-template-draft",
      approved: false,
    }, ACTOR_A).body.execution;
    assert.equal(execution.run.status, "failed");
    assert.equal(
      execution.steps.find((step) => step.key === "approval").run.errorCode,
      "routine_approval_rejected",
    );
    assert.equal(state.workItems.filter((item) => item.parentId === materialized.workItem.id).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("quotation template inspection refuses drift, active Markdown, links, and invalid Office packages", () => {
  const root = join(tmpdir(), `myagenttool-quotation-template-safety-${Date.now()}`);
  const sourceRoot = join(root, "commercial");
  mkdirSync(join(sourceRoot, "templates"), { recursive: true });
  const markdownPath = join(sourceRoot, "templates", "quotation.md");
  writeFileSync(markdownPath, "# Quote\n\n{{customer}}\n");
  const relativeTemplatePath = "templates/quotation.md";
  try {
    assert.equal(inspectLocalQuotationTemplate({
      projectPath: root,
      sourceRelativePath: "commercial",
      templateRelativePath: relativeTemplatePath,
      expectedFingerprint: "0".repeat(64),
    }).error, "routine_template_drifted");
    assert.equal(inspectLocalQuotationTemplate({
      projectPath: root,
      sourceRelativePath: "commercial",
      templateRelativePath: relativeTemplatePath,
      sourceReadMode: "metadata_only",
    }).error, "routine_template_content_access_not_authorized");
    writeFileSync(markdownPath, "# Quote\n\n<script>alert(1)</script>\n{{customer}}\n");
    assert.equal(inspectLocalQuotationTemplate({
      projectPath: root,
      sourceRelativePath: "commercial",
      templateRelativePath: relativeTemplatePath,
    }).error, "routine_template_content_unsafe");
    writeFileSync(markdownPath, "# Quote\n\n[Customer]({{customer}})\n");
    assert.equal(inspectLocalQuotationTemplate({
      projectPath: root,
      sourceRelativePath: "commercial",
      templateRelativePath: relativeTemplatePath,
    }).error, "routine_template_content_unsafe");
    writeFileSync(markdownPath, "# Quote\n\n<a href=\"{{customer}}\">Customer</a>\n");
    assert.equal(inspectLocalQuotationTemplate({
      projectPath: root,
      sourceRelativePath: "commercial",
      templateRelativePath: relativeTemplatePath,
    }).error, "routine_template_content_unsafe");
    const docxPath = join(sourceRoot, "templates", "quotation.docx");
    writeFileSync(docxPath, "not a verified office template");
    assert.deepEqual(inspectLocalQuotationTemplate({
      projectPath: root,
      sourceRelativePath: "commercial",
      templateRelativePath: "templates/quotation.docx",
    }), {
      ok: false,
      error: "routine_office_template_invalid",
      format: "docx",
    });
    const outside = join(root, "outside.md");
    writeFileSync(outside, "{{customer}}\n");
    symlinkSync(outside, join(sourceRoot, "templates", "linked.md"));
    assert.equal(inspectLocalQuotationTemplate({
      projectPath: root,
      sourceRelativePath: "commercial",
      templateRelativePath: "templates/linked.md",
    }).error, "routine_template_link_not_allowed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("routine executor contracts reject unknown adapters, traversal, and escaping output links", () => {
  const { service } = harness();
  assert.equal(service.createRoutineDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Unsafe executor",
    triggerDocumentTypes: ["inquiry"],
    steps: [{
      key: "quotation",
      kind: "generate",
      label: "Prepare quotation",
      configuration: { executorId: "external.unreviewed.v1" },
    }],
    evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "historical_case" }],
    confidence: 0.9,
  }, ACTOR_A).body.error, "routine_step_executor_not_allowed");
  assert.equal(service.createRoutineDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Traversal output",
    triggerDocumentTypes: ["inquiry"],
    steps: [{
      key: "quotation",
      kind: "generate",
      label: "Prepare quotation",
      configuration: { outputDirectory: "../outside" },
    }],
    evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "historical_case" }],
    confidence: 0.9,
  }, ACTOR_A).body.error, "routine_output_directory_invalid");

  const root = join(tmpdir(), `myagenttool-routine-link-${Date.now()}`);
  const sourceRoot = join(root, "commercial");
  const outside = join(root, "outside");
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(sourceRoot, "outputs"));
  try {
    const executionHarness = harness();
    executionHarness.state.projects.find((project) => project.id === "prj_a").path = root;
    executionHarness.state.workflowSources.find((source) => source.id === "wfs_a").relativePath = "commercial";
    const { businessCase, definition } = createCaseAndDefinition(executionHarness.service);
    const materialized = executionHarness.service.materializeRoutineIssue({
      routineDefinitionId: definition.id,
      businessCaseId: businessCase.id,
      triggerArtifactIds: ["wfa_inquiry"],
    }, ACTOR_A).body;
    let execution = executionHarness.service.startRoutineWorkItem({
      workItemId: materialized.workItem.id,
      expectedRevision: materialized.execution.run.revision,
      idempotencyKey: "start-link-test",
    }, ACTOR_A).body.execution;
    execution = executionHarness.service.completeRoutineStep({
      workItemId: materialized.workItem.id,
      stepKey: "extract",
      expectedRevision: execution.run.revision,
      idempotencyKey: "complete-link-extract",
    }, ACTOR_A).body.execution;
    const result = executionHarness.service.executeRoutineStep({
      workItemId: materialized.workItem.id,
      stepKey: "quote",
      expectedRevision: execution.run.revision,
      idempotencyKey: "execute-link-quotation",
    }, ACTOR_A);
    assert.equal(
      result.body.execution.steps.find((step) => step.key === "quote").run.errorCode,
      "routine_output_link_escapes_source",
    );
    assert.deepEqual(readdirSync(outside), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("quotation draft executor never overwrites an existing file with different content", () => {
  const root = join(tmpdir(), `myagenttool-routine-conflict-${Date.now()}`);
  const sourceRoot = join(root, "commercial");
  mkdirSync(sourceRoot, { recursive: true });
  try {
    const input = {
      projectPath: root,
      sourceRelativePath: "commercial",
      outputDirectory: "outputs/quotations",
      businessKey: "RFQ-2026-009",
      routineVersion: 1,
      executionSuffix: "1234abcd",
      fields: { inquiry_number: "RFQ-2026-009" },
      evidencePaths: ["inquiries/RFQ-2026-009.md"],
    };
    const created = writeLocalQuotationDraft(input);
    assert.equal(created.ok, true);
    const target = join(root, created.relativePath);
    writeFileSync(target, "user-owned content\n", "utf8");

    assert.deepEqual(writeLocalQuotationDraft(input), {
      ok: false,
      error: "routine_output_conflict",
    });
    assert.equal(readFileSync(target, "utf8"), "user-owned content\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("learned template output executor copies the confirmed sample without modifying it", () => {
  const root = join(tmpdir(), `myagenttool-learned-output-${Date.now()}`);
  const sourceRoot = join(root, "templates");
  const templatePath = join(sourceRoot, "cases", "case-1", "raw", "outputs", "采购清单.txt");
  mkdirSync(join(sourceRoot, "cases", "case-1", "raw", "outputs"), { recursive: true });
  writeFileSync(templatePath, "序号 | 型号 | 报价单价\n", "utf8");
  try {
    const result = copyLocalLearnedTemplateOutput({
      projectPath: root,
      sourceRelativePath: "templates",
      templateRelativePath: "cases/case-1/raw/outputs/采购清单.txt",
      outputFileName: "采购清单.txt",
      businessKey: "NEW-001",
      executionSuffix: "1234abcd",
    });
    assert.equal(result.ok, true);
    assert.equal(readFileSync(templatePath, "utf8"), "序号 | 型号 | 报价单价\n");
    assert.equal(readFileSync(join(root, result.relativePath), "utf8"), "序号 | 型号 | 报价单价\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("routine Issue identity follows the business-case source fingerprint", () => {
  const { service, state } = harness();
  const { businessCase, definition } = createCaseAndDefinition(service);
  const first = service.materializeRoutineIssue({
    routineDefinitionId: definition.id,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A).body;
  let alternateDefinition = service.createRoutineDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Updated inquiry handling",
    triggerDocumentTypes: ["inquiry"],
    steps: [{ key: "extract", kind: "extract", label: "Extract updated inquiry" }],
    evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "historical_case" }],
    confidence: 0.9,
  }, ACTOR_A).body.routineDefinition;
  alternateDefinition = service.transitionRoutineDefinition({
    routineDefinitionId: alternateDefinition.id,
    expectedRevision: alternateDefinition.revision,
    action: "review",
  }, ACTOR_A).body.routineDefinition;
  alternateDefinition = service.publishRoutineDefinition({
    routineDefinitionId: alternateDefinition.id,
    expectedRevision: alternateDefinition.revision,
    confirmed: true,
  }, ACTOR_A).body.routineDefinition;
  const sameInquiry = service.materializeRoutineIssue({
    routineDefinitionId: alternateDefinition.id,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A);
  assert.equal(sameInquiry.status, 200);
  assert.equal(sameInquiry.body.workItem.id, first.workItem.id);
  assert.equal(sameInquiry.body.execution.definition.id, definition.id);

  state.workflowArtifacts.find((artifact) => artifact.id === "wfa_inquiry").fingerprint = "e".repeat(64);
  businessCase.artifactFingerprints.wfa_inquiry = "e".repeat(64);
  const changed = service.materializeRoutineIssue({
    routineDefinitionId: definition.id,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A);

  assert.equal(changed.status, 201);
  assert.notEqual(changed.body.workItem.id, first.workItem.id);
  assert.equal(state.workItems.filter((item) =>
    item.businessCaseId === businessCase.id && !item.parentId).length, 2);
});

test("a confirmed order condition creates one traceable child Issue and cancellation is terminal", () => {
  const { service, state, releasedReservations } = harness();
  const { businessCase } = createCaseAndDefinition(service);
  state.businessDocumentClassifications.push({
    id: "bdc_order",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    sourceId: "wfs_a",
    artifactId: "wfa_order",
    artifactFingerprint: "d".repeat(64),
    documentType: "order",
    confirmationState: "confirmed",
  });
  let definition = service.createRoutineDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Order-aware inquiry",
    description: "Create an order follow-up only for a confirmed order.",
    triggerDocumentTypes: ["inquiry"],
    steps: [
      {
        key: "order_signal",
        kind: "condition",
        label: "Check whether an order was received",
        required: false,
        configuration: { condition: "A confirmed order was received." },
      },
      {
        key: "order_handoff",
        kind: "create_issue",
        label: "Create order follow-up",
        required: false,
        dependsOn: ["order_signal"],
      },
    ],
    evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "historical_case" }],
    confidence: 0.9,
  }, ACTOR_A).body.routineDefinition;
  definition = service.transitionRoutineDefinition({
    routineDefinitionId: definition.id,
    expectedRevision: definition.revision,
    action: "review",
  }, ACTOR_A).body.routineDefinition;
  definition = service.publishRoutineDefinition({
    routineDefinitionId: definition.id,
    expectedRevision: definition.revision,
    confirmed: true,
  }, ACTOR_A).body.routineDefinition;
  const materialized = service.materializeRoutineIssue({
    routineDefinitionId: definition.id,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A).body;
  let execution = service.startRoutineWorkItem({
    workItemId: materialized.workItem.id,
    expectedRevision: materialized.execution.run.revision,
    idempotencyKey: "start-order-check",
  }, ACTOR_A).body.execution;
  const decided = service.decideRoutineCondition({
    workItemId: materialized.workItem.id,
    stepKey: "order_signal",
    expectedRevision: execution.run.revision,
    idempotencyKey: "order-confirmed",
    outcome: true,
    triggerArtifactIds: ["wfa_order"],
  }, ACTOR_A);
  assert.equal(decided.status, 200);
  assert.equal(decided.body.childWorkItem.parentId, materialized.workItem.id);
  assert.equal(decided.body.childWorkItem.businessCaseId, businessCase.id);
  assert.equal(state.workItems.filter((row) => row.parentId === materialized.workItem.id).length, 1);
  assert.equal(service.decideRoutineCondition({
    workItemId: materialized.workItem.id,
    stepKey: "order_signal",
    expectedRevision: 1,
    idempotencyKey: "order-confirmed",
    outcome: true,
    triggerArtifactIds: ["wfa_order"],
  }, ACTOR_A).body.replayed, true);

  const secondCase = service.createBusinessCase({
    projectId: "prj_a",
    sourceId: "wfs_a",
    businessKey: "RFQ-2026-002",
    state: "confirmed",
    entityIds: [],
    artifactBindings: [{ artifactId: "wfa_inquiry", documentType: "inquiry", roles: ["trigger"] }],
    evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "business_key" }],
    confidence: 0.9,
  }, ACTOR_A).body.businessCase;
  const second = service.materializeRoutineIssue({
    routineDefinitionId: definition.id,
    businessCaseId: secondCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A).body;
  execution = service.startRoutineWorkItem({
    workItemId: second.workItem.id,
    expectedRevision: second.execution.run.revision,
    idempotencyKey: "start-cancel",
  }, ACTOR_A).body.execution;
  const cancelled = service.cancelRoutineWorkItem({
    workItemId: second.workItem.id,
    expectedRevision: execution.run.revision,
    idempotencyKey: "cancel-run",
  }, ACTOR_A);
  assert.equal(cancelled.body.execution.run.status, "cancelled");
  assert.deepEqual(releasedReservations, [{ routineRunId: cancelled.body.execution.run.id }]);
  assert.equal(service.startRoutineWorkItem({
    workItemId: second.workItem.id,
    expectedRevision: cancelled.body.execution.run.revision,
    idempotencyKey: "restart-cancelled",
  }, ACTOR_A).body.error, "routine_run_not_startable");
});

test("an interrupted running step is recovered as an explicit retry after service restart", () => {
  const { service, state, recreateService } = harness();
  const { businessCase, definition } = createCaseAndDefinition(service);
  const materialized = service.materializeRoutineIssue({
    routineDefinitionId: definition.id,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A).body;
  const started = service.startRoutineWorkItem({
    workItemId: materialized.workItem.id,
    expectedRevision: materialized.execution.run.revision,
    idempotencyKey: "start-before-restart",
  }, ACTOR_A).body.execution;
  assert.equal(started.steps.find((step) => step.key === "extract").run.state, "running");

  const restartedService = recreateService();
  const recovered = restartedService.getRoutineWorkItemExecution({
    workItemId: materialized.workItem.id,
  }, ACTOR_A).body.execution;
  assert.equal(recovered.run.status, "failed");
  assert.equal(recovered.run.waitingReason, "routine_step_interrupted");
  assert.equal(recovered.steps.find((step) => step.key === "extract").run.errorCode, "routine_step_interrupted");

  const retried = restartedService.retryRoutineStep({
    workItemId: materialized.workItem.id,
    stepKey: "extract",
    expectedRevision: recovered.run.revision,
    idempotencyKey: "retry-after-restart",
  }, ACTOR_A).body.execution;
  assert.equal(retried.steps.find((step) => step.key === "extract").run.state, "running");
  assert.equal(retried.steps.find((step) => step.key === "extract").run.attempts, 2);
  assert.deepEqual(
    state.routineRuns.find((run) => run.id === retried.run.id).recoveryReceipts,
    [{
      kind: "step_retry",
      stepKey: "extract",
      previousErrorCode: "routine_step_interrupted",
      retriedAt: "2026-07-29T00:00:00.000Z",
    }],
  );
});

test("device concurrency limits independent read steps across routine Issues", () => {
  const { service, state } = harness();
  const { businessCase } = createCaseAndDefinition(service);
  let definition = service.createRoutineDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Concurrent inquiry reading",
    triggerDocumentTypes: ["inquiry"],
    steps: [
      { key: "extract", kind: "extract", label: "Extract inquiry" },
      { key: "references", kind: "retrieve", label: "Retrieve references" },
    ],
    evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "historical_case" }],
    confidence: 0.9,
  }, ACTOR_A).body.routineDefinition;
  definition = service.transitionRoutineDefinition({
    routineDefinitionId: definition.id,
    expectedRevision: definition.revision,
    action: "review",
  }, ACTOR_A).body.routineDefinition;
  definition = service.publishRoutineDefinition({
    routineDefinitionId: definition.id,
    expectedRevision: definition.revision,
    confirmed: true,
  }, ACTOR_A).body.routineDefinition;
  const secondCase = service.createBusinessCase({
    projectId: "prj_a",
    sourceId: "wfs_a",
    businessKey: "RFQ-2026-003",
    state: "confirmed",
    entityIds: [],
    artifactBindings: [{ artifactId: "wfa_inquiry", documentType: "inquiry", roles: ["trigger"] }],
    evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "business_key" }],
    confidence: 0.9,
  }, ACTOR_A).body.businessCase;
  const first = service.materializeRoutineIssue({
    routineDefinitionId: definition.id,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A).body;
  const second = service.materializeRoutineIssue({
    routineDefinitionId: definition.id,
    businessCaseId: secondCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A).body;

  let firstExecution = service.startRoutineWorkItem({
    workItemId: first.workItem.id,
    expectedRevision: first.execution.run.revision,
    idempotencyKey: "start-first-concurrent",
  }, ACTOR_A).body.execution;
  assert.equal(firstExecution.steps.filter((step) => step.run.state === "running").length, 2);
  let secondExecution = service.startRoutineWorkItem({
    workItemId: second.workItem.id,
    expectedRevision: second.execution.run.revision,
    idempotencyKey: "start-second-capacity",
  }, ACTOR_A).body.execution;
  assert.equal(secondExecution.steps.filter((step) => step.run.state === "running").length, 0);
  assert.equal(secondExecution.run.waitingReason, "device_capacity");

  firstExecution = service.completeRoutineStep({
    workItemId: first.workItem.id,
    stepKey: "extract",
    expectedRevision: firstExecution.run.revision,
    idempotencyKey: "free-one-device-slot",
  }, ACTOR_A).body.execution;
  assert.equal(firstExecution.steps.filter((step) => step.run.state === "running").length, 1);
  secondExecution = service.getRoutineWorkItemExecution({
    workItemId: second.workItem.id,
  }, ACTOR_A).body.execution;
  assert.equal(secondExecution.steps.filter((step) => step.run.state === "running").length, 1);
  assert.equal(secondExecution.run.waitingReason, null);
  assert.equal(secondExecution.run.capacity.active, 2);
  assert.deepEqual(
    state.routineRuns.find((run) => run.id === secondExecution.run.id).recoveryReceipts,
    [{
      kind: "device_capacity",
      queuedAt: "2026-07-29T00:00:00.000Z",
      releasedAt: "2026-07-29T00:00:00.000Z",
      startedStepKeys: ["extract"],
    }],
  );
});

test("five inquiry runs wait fairly, expose queue positions, release on cancel, and recover after restart", () => {
  const { service, state, recreateService } = harness();
  const { businessCase } = createCaseAndDefinition(service);
  let definition = service.createRoutineDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Five inquiry batch",
    triggerDocumentTypes: ["inquiry"],
    steps: [
      { key: "extract", kind: "extract", label: "Extract inquiry" },
      { key: "references", kind: "retrieve", label: "Retrieve references" },
    ],
    evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "historical_case" }],
    confidence: 0.9,
  }, ACTOR_A).body.routineDefinition;
  definition = service.transitionRoutineDefinition({
    routineDefinitionId: definition.id,
    expectedRevision: definition.revision,
    action: "review",
  }, ACTOR_A).body.routineDefinition;
  definition = service.publishRoutineDefinition({
    routineDefinitionId: definition.id,
    expectedRevision: definition.revision,
    confirmed: true,
  }, ACTOR_A).body.routineDefinition;
  const cases = [businessCase];
  for (let index = 2; index <= 5; index += 1) {
    cases.push(service.createBusinessCase({
      projectId: "prj_a",
      sourceId: "wfs_a",
      businessKey: `RFQ-2026-00${index}`,
      state: "confirmed",
      entityIds: [],
      artifactBindings: [{ artifactId: "wfa_inquiry", documentType: "inquiry", roles: ["trigger"] }],
      evidenceRefs: [{ artifactId: "wfa_inquiry", kind: "business_key" }],
      confidence: 0.9,
    }, ACTOR_A).body.businessCase);
  }
  const materialized = cases.map((candidate) => service.materializeRoutineIssue({
    routineDefinitionId: definition.id,
    businessCaseId: candidate.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A).body);
  const executions = materialized.map((entry, index) => service.startRoutineWorkItem({
    workItemId: entry.workItem.id,
    expectedRevision: entry.execution.run.revision,
    idempotencyKey: `start-five-${index}`,
  }, ACTOR_A).body.execution);

  assert.equal(state.routineRuns.flatMap((run) => run.stepRuns)
    .filter((step) => step.state === "running").length, 2);
  assert.deepEqual(executions.slice(1).map((execution) => execution.run.capacity.position), [1, 2, 3, 4]);

  const firstCompleted = service.completeRoutineStep({
    workItemId: materialized[0].workItem.id,
    stepKey: "extract",
    expectedRevision: executions[0].run.revision,
    idempotencyKey: "five-free-first",
  }, ACTOR_A);
  assert.deepEqual(firstCompleted.body.awakenedRuns[0], {
    routineRunId: state.routineRuns[1].id,
    startedStepKeys: ["extract"],
  });

  const firstCurrent = service.getRoutineWorkItemExecution({
    workItemId: materialized[0].workItem.id,
  }, ACTOR_A).body.execution;
  service.cancelRoutineWorkItem({
    workItemId: materialized[0].workItem.id,
    expectedRevision: firstCurrent.run.revision,
    idempotencyKey: "five-cancel-first",
  }, ACTOR_A);
  const third = service.getRoutineWorkItemExecution({
    workItemId: materialized[2].workItem.id,
  }, ACTOR_A).body.execution;
  assert.equal(third.steps.filter((step) => step.run.state === "running").length, 1);
  assert.equal(state.routineRuns.flatMap((run) => run.stepRuns)
    .filter((step) => step.state === "running").length, 2);

  const restarted = recreateService();
  const fourth = restarted.getRoutineWorkItemExecution({
    workItemId: materialized[3].workItem.id,
  }, ACTOR_A).body.execution;
  const fifth = restarted.getRoutineWorkItemExecution({
    workItemId: materialized[4].workItem.id,
  }, ACTOR_A).body.execution;
  assert.equal([
    ...fourth.steps,
    ...fifth.steps,
  ].filter((step) => step.run.state === "running").length, 2);
  const queue = restarted.listRoutineWorkQueue({ projectId: "prj_a" }, ACTOR_A);
  assert.equal(queue.status, 200);
  assert.equal(queue.body.items.length, 4);
  assert.ok(queue.body.items.every((item) => item.businessKey && item.progress.total === 2));
});

test("source revocation blocks new routine work but still allows disabling definitions", () => {
  const { service, state } = harness();
  const { businessCase, definition } = createCaseAndDefinition(service);
  state.workflowSources[0].state = "revoked";
  assert.equal(service.createRoutineRun({
    routineDefinitionId: definition.id,
    routineVersion: definition.version,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A).body.error, "routine_run_source_revoked");
  assert.equal(service.transitionRoutineDefinition({
    routineDefinitionId: definition.id,
    expectedRevision: definition.revision,
    action: "disable",
  }, ACTOR_A).status, 200);
});

test("ledger definitions reject absolute paths and sensitive field mappings", () => {
  const { service } = harness();
  assert.equal(service.createLedgerDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Inquiry ledger",
    format: "xlsx",
    relativePath: "/Users/example/inquiry.xlsx",
    businessKeyField: "inquiry_number",
    fieldMappings: { inquiry_number: "A" },
  }, ACTOR_A).body.error, "invalid_ledger_definition");
  assert.equal(service.createLedgerDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Disabled ledger",
    state: "disabled",
    format: "xlsx",
    relativePath: "ledgers/inquiry.xlsx",
    businessKeyField: "inquiry_number",
    fieldMappings: { inquiry_number: "A" },
  }, ACTOR_A).body.error, "invalid_ledger_definition");
  assert.equal(service.createLedgerDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Sensitive key ledger",
    format: "xlsx",
    relativePath: "ledgers/inquiry.xlsx",
    businessKeyField: "access_token",
    fieldMappings: { inquiry_number: "A" },
  }, ACTOR_A).body.error, "invalid_ledger_definition");
  assert.equal(service.createLedgerDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "CSV ledger",
    format: "csv",
    relativePath: "ledgers/inquiry.csv",
    sheet: "Inquiry",
    businessKeyField: "inquiry_number",
    fieldMappings: { inquiry_number: "A" },
  }, ACTOR_A).body.error, "invalid_ledger_definition");
  assert.equal(service.createLedgerDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Inquiry ledger",
    format: "xlsx",
    relativePath: "ledgers/inquiry.xlsx",
    sheet: "Inquiry",
    businessKeyField: "inquiry_number",
    fieldMappings: { inquiry_number: "A", token: "B" },
  }, ACTOR_A).body.error, "invalid_ledger_definition");
  assert.equal(service.createLedgerDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Inquiry ledger",
    format: "xlsx",
    relativePath: "ledgers/inquiry.xlsx",
    sheet: "Inquiry",
    businessKeyField: "inquiry_number",
    fieldMappings: { inquiry_number: "A", customer: "B" },
  }, ACTOR_A).status, 201);
});

test("routine ledger steps cannot bypass a previewed and audited mutation", () => {
  const { service, state } = harness();
  const { businessCase, definition } = createCaseAndDefinition(service);
  const ledgerDefinition = service.createLedgerDefinition({
    projectId: "prj_a",
    sourceId: "wfs_a",
    name: "Inquiry ledger",
    format: "csv",
    relativePath: "ledgers/inquiry.csv",
    businessKeyField: "inquiry_number",
    fieldMappings: { inquiry_number: "Inquiry No", customer: "Customer" },
  }, ACTOR_A).body.ledgerDefinition;
  definition.steps = [{
    key: "register",
    kind: "ledger_upsert",
    label: "Register inquiry",
    required: true,
    dependsOn: [],
    configuration: { ledgerDefinitionId: ledgerDefinition.id },
  }];
  const materialized = service.materializeRoutineIssue({
    routineDefinitionId: definition.id,
    businessCaseId: businessCase.id,
    triggerArtifactIds: ["wfa_inquiry"],
  }, ACTOR_A).body;
  const started = service.startRoutineWorkItem({
    workItemId: materialized.workItem.id,
    expectedRevision: materialized.execution.run.revision,
    idempotencyKey: "start-ledger",
  }, ACTOR_A).body.execution;
  assert.equal(service.completeRoutineStep({
    workItemId: materialized.workItem.id,
    stepKey: "register",
    expectedRevision: started.run.revision,
    idempotencyKey: "manual-bypass",
  }, ACTOR_A).body.error, "ledger_step_requires_previewed_mutation");

  state.ledgerMutationAudits.push({
    id: "lma_approved",
    ownerTeamId: ACTOR_A.teamId,
    projectId: "prj_a",
    sourceId: "wfs_a",
    ledgerDefinitionId: ledgerDefinition.id,
    routineRunId: started.run.id,
    routineStepKey: "register",
    businessKey: businessCase.businessKey,
    action: "insert",
  });
  const completed = service.completeRoutineLedgerStep({
    routineRunId: started.run.id,
    stepKey: "register",
    ledgerDefinitionId: ledgerDefinition.id,
    mutation: state.ledgerMutationAudits[0],
    expectedRunRevision: started.run.revision,
  }, ACTOR_A);
  assert.equal(completed.ok, true);
  assert.equal(completed.execution.run.status, "succeeded");
});

test("V1.4 collections, V1.7 pilot orchestration, and V1.11 assistance survive persistence", () => {
  const root = join(tmpdir(), `business-routine-persistence-${Date.now()}`);
  const projectPath = join(root, "project");
  const statePath = join(root, "state.json");
  mkdirSync(projectPath, { recursive: true });
  const now = () => "2026-07-29T00:00:00.000Z";
  try {
    const first = createServerState({ defaultProjectPath: projectPath, now });
    first.state.workflowSources.push({ id: "wfs_old", ownerTeamId: "team_local", projectId: first.defaultProject.id });
    first.state.workflowProfiles.push({ id: "wfp_old", ownerTeamId: "team_local", projectId: first.defaultProject.id });
    first.state.workItems.push({
      id: "lwi_old",
      ownerTeamId: "team_local",
      projectId: first.defaultProject.id,
      title: "Existing V1.3 local Issue",
    });
    first.state.businessPilotEvidenceReceipts.push({
      id: "bper_persisted",
      ownerTeamId: "team_local",
      manifestDigest: "a".repeat(64),
      collectedAt: now(),
    });
    first.state.businessPilotDrafts.push({
      id: "bpd_persisted",
      ownerTeamId: "team_local",
      projectId: first.defaultProject.id,
      spec: { pilotId: "pilot-persisted" },
      revision: 2,
      lastCollectionDigest: "b".repeat(64),
      lastCollection: { evidence: { state: "incomplete" } },
      updatedAt: now(),
    });
    first.state.businessPilotCollections.push({
      id: "bpc_persisted",
      ownerTeamId: "team_local",
      projectId: first.defaultProject.id,
      pilotId: "pilot-persisted",
      draftRevision: 2,
      evidenceReceiptId: "bper_persisted",
      collectedAt: now(),
      collection: { evidence: { state: "incomplete" } },
      revokedAt: null,
    });
    first.state.businessPilotRollouts.push({
      id: "bpro_persisted",
      ownerTeamId: "team_local",
      projectId: first.defaultProject.id,
      mode: "shadow",
      revision: 1,
      updatedAt: now(),
    });
    first.state.workflowAdaptivePolicies.push({
      id: "awp_persisted",
      ownerTeamId: "team_local",
      projectId: first.defaultProject.id,
      mode: "assist",
      revision: 1,
    });
    first.state.workflowAdaptiveFeedback.push({
      id: "awf_persisted",
      ownerTeamId: "team_local",
      projectId: first.defaultProject.id,
      sourceId: "wfs_old",
      suggestionId: "aws_old",
      decision: "accepted",
    });
    for (const [index, key] of [
      "workflowAdaptiveMonitors",
      "workflowAdaptiveOutcomes",
      "workflowAdaptiveLearningDrafts",
      "workflowAdaptiveRules",
      "workflowAdaptiveNotifications",
    ].entries()) {
      first.state[key].push({
        id: `adaptive_v11_${index}`,
        ownerTeamId: "team_local",
        projectId: first.defaultProject.id,
        sourceId: "wfs_old",
      });
    }
    for (const [index, key] of businessRoutineCollectionKeys.entries()) {
      first.state[key].push({
        id: `v14_${index}`,
        schemaVersion: 1,
        ownerTeamId: "team_local",
        projectId: first.defaultProject.id,
        sourceId: "wfs_old",
      });
    }
    createPersistenceRuntime({
      state: first.state,
      enabled: true,
      stateStorePath: statePath,
      schemaVersion: 1,
      now,
      defaultProject: first.defaultProject,
      sameProjectPath,
    }).savePersistentState();

    const second = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({
      state: second.state,
      enabled: true,
      stateStorePath: statePath,
      schemaVersion: 1,
      now,
      defaultProject: second.defaultProject,
      sameProjectPath,
    }).restorePersistentState();
    assert.equal(second.state.workflowProfiles[0].id, "wfp_old");
    assert.equal(second.state.workItems[0].id, "lwi_old");
    assert.equal(second.state.businessPilotEvidenceReceipts[0].id, "bper_persisted");
    assert.equal(second.state.businessPilotDrafts[0].id, "bpd_persisted");
    assert.equal(second.state.businessPilotDrafts[0].lastCollection.evidence.state, "incomplete");
    assert.equal(second.state.businessPilotCollections[0].id, "bpc_persisted");
    assert.equal(second.state.businessPilotRollouts[0].mode, "shadow");
    assert.equal(second.state.workflowAdaptivePolicies[0].mode, "assist");
    assert.equal(second.state.workflowAdaptiveFeedback[0].decision, "accepted");
    for (const [index, key] of [
      "workflowAdaptiveMonitors",
      "workflowAdaptiveOutcomes",
      "workflowAdaptiveLearningDrafts",
      "workflowAdaptiveRules",
      "workflowAdaptiveNotifications",
    ].entries()) {
      assert.equal(second.state[key][0].id, `adaptive_v11_${index}`, `${key} restores`);
    }
    for (const [index, key] of businessRoutineCollectionKeys.entries()) {
      assert.equal(second.state[key][0].id, `v14_${index}`, `${key} restores`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("idempotency keys differ by scope and never reveal the business key", () => {
  const first = routineIdempotencyKeys({
    ownerTeamId: "team_a",
    routineDefinitionId: "rtd_1",
    routineVersion: 1,
    businessKey: "RFQ-SECRET-001",
    stepKey: "extract",
    ledgerDefinitionId: "ldg_1",
  });
  const second = routineIdempotencyKeys({
    ownerTeamId: "team_a",
    routineDefinitionId: "rtd_1",
    routineVersion: 1,
    businessKey: "RFQ-SECRET-002",
    stepKey: "extract",
    ledgerDefinitionId: "ldg_1",
  });
  assert.notEqual(first.issue, second.issue);
  assert.notEqual(first.step, first.ledgerUpsert);
  assert.ok(Object.values(first).filter(Boolean).every((key) => !key.includes("SECRET")));
});
