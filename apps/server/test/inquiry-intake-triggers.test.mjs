import assert from "node:assert/strict";
import { test } from "node:test";

import { createInquiryIntakeTriggerService } from "../src/services/inquiry-intake-triggers.mjs";

const ACTOR = { userId: "usr_a", teamId: "team_a" };
const FOREIGN_ACTOR = { userId: "usr_b", teamId: "team_b" };

function harness({
  readMode = "supported_text",
  observationState = "ready",
  existingCase = null,
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
    }],
    workflowArtifacts: [{
      id: "wfa_a",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      availability: "available",
      exclusion: false,
      fingerprint: "a".repeat(64),
    }],
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
    }],
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
      artifactFingerprints: { wfa_a: "a".repeat(64) },
    };
    state.businessCases.push(businessCase);
    return { status: 201, body: { businessCase, replayed: false } };
  };
  const service = createInquiryIntakeTriggerService({
    state,
    now: () => "2026-07-29T12:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++id}`,
    analyzeArtifact: async () => {
      calls.analyze += 1;
      return { status: 200, body: { classification, replayed: calls.analyze > 1 } };
    },
    confirmClassification: (input) => {
      calls.confirm += 1;
      return {
        status: 200,
        body: {
          classification: {
            ...classification,
            revision: classification.revision + 1,
            documentType: input.documentType,
            confirmationState: "confirmed",
          },
          entity: {
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
