import assert from "node:assert/strict";
import { test } from "node:test";

import { createInquiryIntakeTriggerService } from "../src/services/inquiry-intake-triggers.mjs";

const ACTOR = { userId: "usr_a", teamId: "team_a" };
const FOREIGN_ACTOR = { userId: "usr_b", teamId: "team_b" };

function harness({
  readMode = "supported_text",
  observationState = "ready",
  existingCase = null,
  withSupportingEvidence = false,
  supportingSourceId = "wfs_a",
} = {}) {
  let id = 0;
  const calls = { analyze: 0, confirm: 0, createCase: 0, materialize: 0 };
  const state = {
    projects: [{ id: "prj_a", ownerTeamId: "team_a" }],
    workflowSources: [{
      id: "wfs_a",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      state: "active",
      readMode,
    }, ...(supportingSourceId !== "wfs_a" ? [{
      id: supportingSourceId,
      ownerTeamId: "team_a",
      projectId: "prj_a",
      state: "active",
      readMode,
    }] : [])],
    workflowArtifacts: [{
      id: "wfa_a",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      availability: "available",
      exclusion: false,
      fingerprint: "a".repeat(64),
    }, ...(withSupportingEvidence ? [{
      id: "wfa_support",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: supportingSourceId,
      availability: "available",
      exclusion: false,
      fingerprint: "b".repeat(64),
    name: "spec.docx",
    family: "document",
    extension: "docx",
    extraction: { state: "ready" },
    }] : [])],
    workflowIntakeObservations: [{
      id: "wio_a",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      artifactId: "wfa_a",
      canonicalArtifactId: "wfa_a",
      contentIdentity: "c".repeat(64),
      relativePath: "inquiries/RFQ-2026-101.md",
      state: observationState,
      reason: null,
      revision: 3,
    }, ...(withSupportingEvidence ? [{
      id: "wio_support",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: supportingSourceId,
      artifactId: "wfa_support",
      canonicalArtifactId: "wfa_support",
      contentIdentity: "d".repeat(64),
      relativePath: "inquiries/spec.docx",
      state: "ready",
      reason: null,
      revision: 2,
    }] : [])],
    workflowIntakeReceipts: [],
    businessCases: existingCase ? [existingCase] : [],
  };
  const classification = {
    id: "bdc_a",
    revision: 1,
    artifactId: "wfa_a",
    artifactFingerprint: "a".repeat(64),
    documentType: "inquiry",
    confirmationState: "proposed",
    confidence: 0.96,
    fieldProposals: [{
      key: "inquiry_number",
      value: "RFQ-2026-101",
      evidenceRefs: [{ artifactId: "wfa_a", kind: "field", field: "inquiry_number" }],
    }],
  };
  const supportingClassification = {
    id: "bdc_support",
    revision: 1,
    artifactId: "wfa_support",
    artifactFingerprint: "b".repeat(64),
    documentType: "unknown",
    confirmationState: "proposed",
    confidence: 0.55,
    fieldProposals: [],
  };
  const definition = {
    id: "brd_a",
    name: "Inquiry to quotation",
    description: "Prepare and register a quotation.",
    version: 4,
    state: "published",
    triggerDocumentTypes: ["inquiry"],
    evidenceHealth: { state: "valid" },
  };
  const createBusinessCase = (input) => {
    calls.createCase += 1;
    const replay = state.businessCases.find((row) => row.businessKey === input.businessKey);
    if (replay) return { status: 200, body: { businessCase: replay, replayed: true } };
    const businessCase = {
      id: "bcs_a",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      businessKey: input.businessKey,
      artifactBindings: input.artifactBindings,
      evidenceRefs: input.evidenceRefs,
      artifactFingerprints: Object.fromEntries(input.artifactBindings.map((binding) => [
        binding.artifactId,
        state.workflowArtifacts.find((artifact) => artifact.id === binding.artifactId)?.fingerprint,
      ])),
    };
    state.businessCases.push(businessCase);
    return { status: 201, body: { businessCase, replayed: false } };
  };
  const service = createInquiryIntakeTriggerService({
    state,
    now: () => "2026-07-29T12:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++id}`,
    analyzeArtifact: async ({ artifactId }) => {
      calls.analyze += 1;
      return {
        status: 200,
        body: {
          classification: artifactId === "wfa_support" ? supportingClassification : classification,
          replayed: calls.analyze > 1,
        },
      };
    },
    confirmClassification: (input) => {
      calls.confirm += 1;
      return {
        status: 200,
        body: {
          classification: {
            ...(input.classificationId === "bdc_support" ? supportingClassification : classification),
            revision: (input.classificationId === "bdc_support"
              ? supportingClassification
              : classification).revision + 1,
            documentType: input.documentType,
            confirmationState: "confirmed",
          },
          entity: input.documentType === "inquiry_ledger" ? null : {
            id: "bent_a",
            entityType: "inquiry",
            businessKey: input.fieldCorrections?.inquiry_number ?? "RFQ-2026-101",
          },
        },
      };
    },
    createBusinessCase,
    listRoutineDefinitions: () => ({
      status: 200,
      body: { routineDefinitions: [definition] },
    }),
    materializeRoutineIssue: () => {
      calls.materialize += 1;
      return {
        status: calls.materialize === 1 ? 201 : 200,
        body: {
          workItem: { id: "lwi_a", localRef: "LOCAL-101" },
          execution: { run: { id: "rrn_a" } },
          replayed: calls.materialize > 1,
        },
      };
    },
  });
  return { state, service, calls, definition, classification };
}

test("inspection proposes classification and a published inquiry routine without creating work", async () => {
  const { service, calls } = harness();
  const result = await service.inspect({ observationId: "wio_a" }, ACTOR);
  assert.equal(result.status, 200);
  assert.equal(result.body.state, "needs_confirmation");
  assert.equal(result.body.observation.relativePath, "inquiries/RFQ-2026-101.md");
  assert.equal(result.body.routines[0].version, 4);
  assert.equal(calls.analyze, 1);
  assert.equal(calls.confirm, 0);
  assert.equal(calls.createCase, 0);
  assert.equal(calls.materialize, 0);
});

test("explicit acceptance creates one confirmed case, pinned routine task, and safe receipt", async () => {
  const { state, service, calls } = harness();
  const result = await service.accept({
    observationId: "wio_a",
    expectedRevision: 3,
    idempotencyKey: "accept-wio-a",
    routineDefinitionId: "brd_a",
    confirmed: true,
    fieldCorrections: { inquiry_number: "RFQ-2026-101" },
  }, ACTOR);
  assert.equal(result.status, 201);
  assert.equal(result.body.receipt.workItemLocalRef, "LOCAL-101");
  assert.equal(result.body.receipt.routineVersion, 4);
  assert.equal(result.body.receipt.contentIdentity, undefined);
  assert.equal(result.body.receipt.requestKey, undefined);
  assert.equal(state.workflowIntakeObservations[0].state, "triggered");
  assert.equal(state.workflowIntakeReceipts.length, 1);
  assert.deepEqual(calls, { analyze: 1, confirm: 1, createCase: 1, materialize: 1 });
});

test("one primary inquiry binds supporting files to the same case and one local Issue", async () => {
  const { state, service, calls } = harness({ withSupportingEvidence: true });
  const inspection = await service.inspect({
    observationId: "wio_a",
    supportingObservationIds: ["wio_support"],
  }, ACTOR);
  assert.equal(inspection.status, 200);
  assert.deepEqual(inspection.body.observation.supportingObservations, [{
    id: "wio_support",
    artifactId: "wfa_support",
    relativePath: "inquiries/spec.docx",
    name: "spec.docx",
    family: "document",
    extractionState: "ready",
    role: "reference",
    documentType: "other_reference",
    pairingEvidence: [],
  }]);

  const result = await service.accept({
    observationId: "wio_a",
    supportingObservationIds: ["wio_support"],
    expectedRevision: 3,
    idempotencyKey: "accept-case-bundle",
    routineDefinitionId: "brd_a",
    confirmed: true,
  }, ACTOR);
  assert.equal(result.status, 201);
  assert.deepEqual(result.body.receipt.supportingArtifactIds, ["wfa_support"]);
  assert.deepEqual(state.businessCases[0].artifactBindings, [
    { artifactId: "wfa_a", documentType: "inquiry", roles: ["trigger", "input"] },
    { artifactId: "wfa_support", documentType: "other_reference", roles: ["reference"] },
  ]);
  assert.equal(state.workflowIntakeObservations[0].state, "triggered");
  assert.equal(state.workflowIntakeObservations[1].state, "triggered");
  assert.equal(state.workflowIntakeObservations[1].receiptId, result.body.receipt.id);
  assert.equal(state.workflowIntakeReceipts.length, 1);
  assert.equal(calls.materialize, 1);
});

test("an explicitly identified historical workbook is paired as the inquiry ledger output", async () => {
  const { state, service, calls } = harness({ withSupportingEvidence: true });
  Object.assign(state.workflowArtifacts[0], {
    name: "97-动态热机械分析仪DMA.pdf",
    family: "document",
    extraction: {
      state: "ready",
      ocr: { providerId: "macos-vision" },
      blocks: [{
        text: "动态热机械分析仪技术协议 设备型号 DMA850",
        confidence: 0.91,
        location: { kind: "page", index: 1 },
        evidence: [{ text: "设备型号 DMA850" }],
      }],
    },
  });
  Object.assign(state.workflowArtifacts[1], {
    name: "97-动态热机械分析仪DMA-信息汇总.xlsx",
    family: "spreadsheet",
    extension: "xlsx",
    extraction: {
      state: "ready",
      blocks: [{
        text: "PDF文件名称：97-动态热机械分析仪DMA.pdf",
        location: { kind: "sheet_row", sheet: 1, row: 2 },
      }],
    },
  });

  const inspection = await service.inspect({
    observationId: "wio_a",
    supportingObservationIds: ["wio_support"],
    supportingObservationRoles: { wio_support: "historical_output" },
  }, ACTOR);
  assert.equal(inspection.status, 200);
  assert.deepEqual(inspection.body.observation.ocrEvidence, [{
    page: 1,
    kind: "page",
    width: null,
    height: null,
    confidence: 0.91,
    lineCount: 1,
    preview: "动态热机械分析仪技术协议 设备型号 DMA850",
  }]);
  assert.deepEqual(inspection.body.observation.supportingObservations[0], {
    id: "wio_support",
    artifactId: "wfa_support",
    relativePath: "inquiries/spec.docx",
    name: "97-动态热机械分析仪DMA-信息汇总.xlsx",
    family: "spreadsheet",
    extractionState: "ready",
    role: "historical_output",
    documentType: "inquiry_ledger",
    pairingEvidence: [
      { kind: "shared_filename_case_key", value: "97" },
      { kind: "output_references_input", value: "97-动态热机械分析仪DMA.pdf" },
    ],
    classification: {
      id: "bdc_support",
      artifactId: "wfa_support",
      documentType: "unknown",
      confidence: 0.55,
      confirmationState: "proposed",
      analysisState: undefined,
      riskSignals: undefined,
      fieldProposals: [],
      revision: 1,
    },
  });

  const result = await service.accept({
    observationId: "wio_a",
    supportingObservationIds: ["wio_support"],
    supportingObservationRoles: { wio_support: "historical_output" },
    expectedRevision: 3,
    idempotencyKey: "accept-real-pdf-xlsx-pair",
    routineDefinitionId: "brd_a",
    confirmed: true,
  }, ACTOR);
  assert.equal(result.status, 201);
  assert.deepEqual(state.businessCases[0].artifactBindings, [
    { artifactId: "wfa_a", documentType: "inquiry", roles: ["trigger", "input"] },
    { artifactId: "wfa_support", documentType: "inquiry_ledger", roles: ["output"] },
  ]);
  assert.deepEqual(state.businessCases[0].evidenceRefs.slice(-2), [
    {
      artifactId: "wfa_support",
      kind: "shared_filename_case_key",
      field: null,
      location: null,
    },
    {
      artifactId: "wfa_support",
      kind: "output_references_input",
      field: null,
      location: null,
    },
  ]);
  assert.equal(result.body.receipt.supportingBindings[0].role, "historical_output");
  assert.equal(result.body.receipt.supportingBindings[0].pairingEvidence.length, 2);
  assert.equal(state.workflowIntakeReceipts.length, 1);
  assert.equal(calls.materialize, 1);
  assert.equal(calls.confirm, 2);
  const mismatchedReplay = await service.accept({
    observationId: "wio_a",
    supportingObservationIds: [],
    supportingObservationRoles: {},
    expectedRevision: state.workflowIntakeObservations[0].revision,
    idempotencyKey: "changed-real-pdf-xlsx-pair",
    routineDefinitionId: "brd_a",
    confirmed: true,
  }, ACTOR);
  assert.equal(mismatchedReplay.status, 409);
  assert.equal(mismatchedReplay.body.error, "workflow_intake_replay_support_conflict");
  assert.equal(state.workflowIntakeReceipts.length, 1);
});

test("an unreadable or unpaired file cannot be promoted to a historical inquiry ledger", async () => {
  const { state, service, calls } = harness({ withSupportingEvidence: true });
  const image = await service.inspect({
    observationId: "wio_a",
    supportingObservationIds: ["wio_support"],
    supportingObservationRoles: { wio_support: "historical_output" },
  }, ACTOR);
  assert.equal(image.status, 409);
  assert.equal(image.body.error, "workflow_intake_historical_output_not_supported");
  assert.equal(calls.analyze, 0);

  Object.assign(state.workflowArtifacts[1], {
    name: "unrelated.xlsx",
    family: "spreadsheet",
    extension: "xlsx",
    extraction: { state: "ready", blocks: [{ text: "unrelated output" }] },
  });
  const unpaired = await service.inspect({
    observationId: "wio_a",
    supportingObservationIds: ["wio_support"],
    supportingObservationRoles: { wio_support: "historical_output" },
  }, ACTOR);
  assert.equal(unpaired.status, 409);
  assert.equal(unpaired.body.error, "workflow_intake_historical_output_unpaired");
  assert.equal(calls.analyze, 0);
});

test("supporting files from another Workflow Memory source fail closed", async () => {
  const { service, calls } = harness({
    withSupportingEvidence: true,
    supportingSourceId: "wfs_other",
  });
  const inspection = await service.inspect({
    observationId: "wio_a",
    supportingObservationIds: ["wio_support"],
  }, ACTOR);
  assert.equal(inspection.status, 409);
  assert.equal(inspection.body.error, "workflow_intake_supporting_observation_not_ready");
  assert.deepEqual(calls, { analyze: 0, confirm: 0, createCase: 0, materialize: 0 });
});

test("an existing case cannot claim newly supplied supporting evidence without binding it", async () => {
  const { state, service } = harness({
    withSupportingEvidence: true,
    existingCase: {
      id: "bcs_existing",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      businessKey: "RFQ-2026-101",
      artifactBindings: [{
        artifactId: "wfa_a",
        documentType: "inquiry",
        roles: ["trigger", "input"],
      }],
      artifactFingerprints: { wfa_a: "a".repeat(64) },
    },
  });
  const result = await service.accept({
    observationId: "wio_a",
    supportingObservationIds: ["wio_support"],
    expectedRevision: 3,
    idempotencyKey: "support-conflict",
    routineDefinitionId: "brd_a",
    confirmed: true,
  }, ACTOR);
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "workflow_intake_business_case_support_conflict");
  assert.equal(state.workflowIntakeObservations[1].state, "ready");
  assert.equal(state.workflowIntakeReceipts.length, 0);
});

test("same request replays and changed payload under the same key conflicts", async () => {
  const { state, service, calls } = harness();
  const input = {
    observationId: "wio_a",
    expectedRevision: 3,
    idempotencyKey: "accept-wio-a",
    routineDefinitionId: "brd_a",
    confirmed: true,
  };
  assert.equal((await service.accept(input, ACTOR)).status, 201);
  const replay = await service.accept(input, ACTOR);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  const conflict = await service.accept({
    ...input,
    fieldCorrections: { inquiry_number: "RFQ-CHANGED" },
  }, ACTOR);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "workflow_intake_idempotency_conflict");
  assert.equal(state.workflowIntakeReceipts.length, 1);
  assert.equal(calls.materialize, 1);
});

test("concurrent accepts converge on one case, task identity, run, and receipt", async () => {
  const { state, service } = harness();
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => service.accept({
    observationId: "wio_a",
    expectedRevision: 3,
    idempotencyKey: `parallel-${index}`,
    routineDefinitionId: "brd_a",
    confirmed: true,
  }, ACTOR)));
  assert.equal(results.filter((result) => result.status === 201).length, 1);
  assert.equal(results.filter((result) => result.status === 200).length, 19);
  assert.deepEqual(new Set(results.map((result) => result.body.receipt.workItemId)), new Set(["lwi_a"]));
  assert.deepEqual(new Set(results.map((result) => result.body.receipt.routineRunId)), new Set(["rrn_a"]));
  assert.equal(state.businessCases.length, 1);
  assert.equal(state.workflowIntakeReceipts.length, 1);
});

test("a renamed observation with the same content identity converges on the prior receipt", async () => {
  const { state, service, calls } = harness();
  await service.accept({
    observationId: "wio_a",
    expectedRevision: 3,
    idempotencyKey: "accept-wio-a",
    routineDefinitionId: "brd_a",
    confirmed: true,
  }, ACTOR);
  state.workflowIntakeObservations.push({
    ...state.workflowIntakeObservations[0],
    id: "wio_renamed",
    relativePath: "renamed/RFQ-2026-101.md",
    state: "ready",
    receiptId: null,
    revision: 1,
  });
  const replay = await service.accept({
    observationId: "wio_renamed",
    expectedRevision: 1,
    idempotencyKey: "accept-renamed",
    routineDefinitionId: "brd_a",
    confirmed: true,
  }, ACTOR);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(state.workflowIntakeObservations[1].state, "triggered");
  assert.equal(state.workflowIntakeReceipts.length, 1);
  assert.equal(calls.materialize, 1);
});

test("recovery after work creation but before receipt converges through downstream idempotency", async () => {
  const { state, service, calls } = harness();
  state.businessCases.push({
    id: "bcs_a",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    sourceId: "wfs_a",
    businessKey: "RFQ-2026-101",
    artifactBindings: [{ artifactId: "wfa_a", roles: ["trigger", "input"] }],
    artifactFingerprints: { wfa_a: "a".repeat(64) },
  });
  const result = await service.accept({
    observationId: "wio_a",
    expectedRevision: 3,
    idempotencyKey: "recover-wio-a",
    routineDefinitionId: "brd_a",
    confirmed: true,
  }, ACTOR);
  assert.equal(result.status, 201);
  assert.equal(state.workflowIntakeReceipts.length, 1);
  assert.equal(calls.createCase, 0);
  assert.equal(calls.materialize, 1);
});

test("conflicting business identity pauses for review instead of merging evidence", async () => {
  const { state, service, calls } = harness({
    existingCase: {
      id: "bcs_old",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      businessKey: "RFQ-2026-101",
      artifactBindings: [{ artifactId: "wfa_old", roles: ["trigger"] }],
      artifactFingerprints: { wfa_old: "b".repeat(64) },
    },
  });
  const result = await service.accept({
    observationId: "wio_a",
    expectedRevision: 3,
    idempotencyKey: "accept-conflict",
    routineDefinitionId: "brd_a",
    confirmed: true,
  }, ACTOR);
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "workflow_intake_business_identity_conflict");
  assert.equal(state.workflowIntakeObservations[0].state, "needs_review");
  assert.equal(calls.createCase, 0);
  assert.equal(calls.materialize, 0);
});

test("metadata-only and foreign observations fail closed", async () => {
  const metadata = harness({ readMode: "metadata" });
  const denied = await metadata.service.inspect({ observationId: "wio_a" }, ACTOR);
  assert.equal(denied.status, 409);
  assert.equal(denied.body.error, "workflow_intake_text_access_required");
  assert.equal(metadata.state.workflowIntakeObservations[0].state, "needs_review");

  const foreign = harness();
  const hidden = await foreign.service.inspect({ observationId: "wio_a" }, FOREIGN_ACTOR);
  assert.equal(hidden.status, 404);
});
