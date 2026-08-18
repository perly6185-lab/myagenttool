import assert from "node:assert/strict";
import test from "node:test";

import { createWorkflowProfileManager } from "../src/services/workflow-profile-manager.mjs";

function createFixture() {
  const source = { id: "source-1", ownerTeamId: "team-1", projectId: "project-1" };
  const artifact = {
    id: "requirement-1",
    sourceId: source.id,
    availability: "available",
    fingerprint: "fingerprint-1",
  };
  const deliveryCase = {
    id: "case-1",
    ownerTeamId: "team-1",
    projectId: "project-1",
    sourceId: source.id,
    state: "confirmed",
    workflowProfileId: "profile-1",
    evidenceSnapshots: [{ artifactId: artifact.id, fingerprint: artifact.fingerprint }],
  };
  const profile = {
    id: "profile-1",
    familyId: "profile-1",
    ownerTeamId: "team-1",
    projectId: "project-1",
    sourceId: source.id,
    name: "Base profile",
    profileVersion: 1,
    revision: 1,
    state: "trial",
    evidenceCaseIds: [deliveryCase.id],
    requirementSpec: { fields: [] },
    outcomeSpec: { outputs: [] },
    transformationMap: { mappings: [] },
    taskRecipe: { steps: ["Review requirement"] },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const state = {
    deliveryCases: [deliveryCase],
    workflowArtifacts: [artifact],
    workflowProfileDrafts: [],
    workflowProfiles: [profile],
  };
  let id = 0;
  const access = {
    actorUser: () => "user-1",
    findSource: (sourceId) => sourceId === source.id ? source : null,
    visible: () => true,
  };
  const runtime = {
    appendEvent: () => {},
    errorResult: (error) => ({ status: error.status ?? 400, body: { error: error.code } }),
    nextId: (prefix) => `${prefix}-${++id}`,
    now: () => "2026-01-02T00:00:00.000Z",
    runTx: (operation) => operation(),
    state,
  };
  const manager = createWorkflowProfileManager({
    access,
    assessDeliveryCaseQuality: () => ({ status: "trusted" }),
    boundedObject: (value) => structuredClone(value),
    commonPathPrefix: () => "",
    deriveFieldSpec: () => [],
    deriveProfileSpecs: () => ({
      requirementSpec: { fields: [{ key: "customer", required: true }] },
      outcomeSpec: { outputs: [{ family: "document", extension: "md" }] },
      transformationMap: { mappings: [{ requirementField: "customer" }] },
    }),
    listInbox: () => ({ body: { count: 2 } }),
    maxProfileCases: 100,
    normalizeIdList: (value) => Array.isArray(value) ? [...new Set(value)] : null,
    profileChangeSummary: () => ({ outputs: { added: ["document:md:1"], removed: [] } }),
    profileStates: new Set(["trial", "established", "disabled", "archived"]),
    profileView: (value) => value,
    qualityForCase: () => ({ status: "trusted" }),
    runtime,
    summarizeDeliveryCaseQualities: (values) => ({
      trustedCaseCount: values.length,
      reviewedCaseCount: values.length,
    }),
  });
  return { manager, profile, state };
}

test("profile manager creates and publishes an evidence-backed draft", () => {
  const { manager, profile, state } = createFixture();

  const created = manager.createProfileDraft({
    profileId: profile.id,
    expectedRevision: profile.revision,
    name: "Updated profile",
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.draft.impact.pendingRequirementCount, 2);
  assert.equal(state.workflowProfileDrafts.length, 1);

  const draft = created.body.draft;
  const published = manager.publishProfileDraft({
    draftId: draft.id,
    expectedRevision: draft.revision,
  });
  assert.equal(published.status, 201);
  assert.equal(draft.state, "published");
  assert.equal(published.body.profile.profileVersion, 2);
  assert.equal(profile.state, "archived");

  const replay = manager.publishProfileDraft({
    draftId: draft.id,
    expectedRevision: draft.revision,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
});
