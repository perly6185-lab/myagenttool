import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import {
  businessRoutineCollectionKeys,
  createBusinessRoutineService,
  routineIdempotencyKeys,
} from "../src/services/business-routines.mjs";
import { sameProjectPath } from "../src/services/projects.mjs";

const ACTOR_A = { userId: "usr_a", teamId: "team_a" };
const ACTOR_B = { userId: "usr_b", teamId: "team_b" };

function harness() {
  let id = 0;
  const events = [];
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
        availability: "available", fingerprint: "a".repeat(64),
      },
      {
        id: "wfa_quote", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_a",
        availability: "available", fingerprint: "b".repeat(64),
      },
      {
        id: "wfa_foreign", ownerTeamId: "team_b", projectId: "prj_b", sourceId: "wfs_b",
        availability: "available", fingerprint: "c".repeat(64),
      },
    ],
  };
  const service = createBusinessRoutineService({
    state,
    now: () => "2026-07-29T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent: (event) => events.push(event),
  });
  return { state, events, service };
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

test("all V1.4 collections survive persistence alongside V1.3 records", () => {
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
