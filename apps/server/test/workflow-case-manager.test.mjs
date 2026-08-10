import assert from "node:assert/strict";
import test from "node:test";

import { createWorkflowCaseManager } from "../src/services/workflow-case-manager.mjs";

function createFixture() {
  const source = { id: "source-1", ownerTeamId: "team-1", projectId: "project-1" };
  const state = {
    workflowArtifacts: [
      {
        id: "requirement-1",
        sourceId: source.id,
        relativePath: "requirements/request.md",
        fingerprint: "requirement-fingerprint",
        modifiedAt: "2026-01-01T00:00:00.000Z",
        size: 100,
        role: "requirement",
        availability: "available",
        confirmationState: "proposed",
        revision: 1,
      },
      {
        id: "delivery-1",
        sourceId: source.id,
        relativePath: "deliveries/result.md",
        fingerprint: "delivery-fingerprint",
        modifiedAt: "2026-01-01T00:00:00.000Z",
        size: 200,
        role: "delivery",
        availability: "available",
        confirmationState: "proposed",
        revision: 1,
      },
    ],
    deliveryCases: [],
    workflowProfiles: [],
  };
  let id = 0;
  const access = {
    actorUser: () => "user-1",
    findArtifact: (artifactId) =>
      state.workflowArtifacts.find((artifact) => artifact.id === artifactId) ?? null,
    findSource: (sourceId) => sourceId === source.id ? source : null,
    visible: () => true,
  };
  const runtime = {
    appendEvent: () => {},
    nextId: (prefix) => `${prefix}-${++id}`,
    now: () => "2026-01-02T00:00:00.000Z",
    runTx: (operation) => operation(),
    state,
  };
  const manager = createWorkflowCaseManager({
    access,
    caseView: (deliveryCase) => deliveryCase,
    effectiveRole: (artifact) => artifact.role,
    normalizeIdList: (value) => Array.isArray(value) ? [...new Set(value)] : null,
    runtime,
    scoreWorkflowPair: () => ({ score: 0.8, reasons: ["same_directory"] }),
  });
  return { manager, state };
}

test("case manager proposes, confirms, archives, and restores a delivery case", () => {
  const { manager, state } = createFixture();

  const proposals = manager.pairProposals({ sourceId: "source-1" });
  assert.equal(proposals.status, 200);
  assert.equal(proposals.body.proposals[0].candidates[0].score, 0.8);

  const created = manager.createCase({
    sourceId: "source-1",
    requirementArtifactIds: ["requirement-1"],
    deliveryArtifactIds: ["delivery-1"],
  });
  assert.equal(created.status, 201);
  assert.equal(state.deliveryCases.length, 1);
  assert.ok(state.workflowArtifacts.every((artifact) =>
    artifact.confirmationState === "confirmed"));

  const deliveryCase = created.body.deliveryCase;
  const missingReason = manager.changeCaseState({
    caseId: deliveryCase.id,
    expectedRevision: deliveryCase.revision,
    action: "archive",
  });
  assert.equal(missingReason.status, 400);

  const archived = manager.changeCaseState({
    caseId: deliveryCase.id,
    expectedRevision: deliveryCase.revision,
    action: "archive",
    reason: "Superseded by a corrected example.",
  });
  assert.equal(archived.status, 200);
  assert.equal(deliveryCase.state, "archived");

  const restored = manager.changeCaseState({
    caseId: deliveryCase.id,
    expectedRevision: deliveryCase.revision,
    action: "restore",
  });
  assert.equal(restored.status, 200);
  assert.equal(deliveryCase.state, "confirmed");
});
