import assert from "node:assert/strict";
import test from "node:test";

import { createWorkflowRetrievalService } from "../src/services/workflow-retrieval-service.mjs";

function createFixture() {
  const source = {
    id: "source-1",
    ownerTeamId: "team-1",
    projectId: "project-1",
    state: "active",
  };
  const query = {
    id: "requirement-new",
    ownerTeamId: "team-1",
    sourceId: source.id,
    relativePath: "requests/acme-monthly.md",
    extension: "md",
    role: "requirement",
    availability: "available",
  };
  const historical = {
    id: "requirement-history",
    ownerTeamId: "team-1",
    sourceId: source.id,
    relativePath: "history/acme-monthly.md",
    extension: "md",
    role: "requirement",
    availability: "available",
  };
  const deliveryCase = {
    id: "case-1",
    ownerTeamId: "team-1",
    sourceId: source.id,
    state: "confirmed",
    requirementArtifactIds: [historical.id],
    deliveryArtifactIds: ["delivery-1"],
    workflowProfileId: "profile-1",
  };
  const profile = {
    id: "profile-1",
    familyId: "profile-family-1",
    ownerTeamId: "team-1",
    sourceId: source.id,
    name: "Acme monthly report",
    state: "established",
    evidenceCaseIds: [deliveryCase.id],
    requirementSpec: {
      acceptedExtensions: ["md"],
      fields: [{ key: "customer", label: "Customer", required: true }],
    },
    outcomeSpec: {
      outputs: [{ family: "document", extension: "md" }],
      pathTemplate: "deliveries/{requirement-stem}",
    },
  };
  const state = {
    deliveryCases: [deliveryCase],
    workflowArtifacts: [query, historical],
    workflowProfiles: [profile],
    workflowRuns: [{
      id: "run-1",
      ownerTeamId: "team-1",
      feedback: { deliveryCaseId: deliveryCase.id, state: "accepted" },
    }],
  };
  const contentByArtifactId = new Map([
    [query.id, "customer: Acme\nCreate the monthly performance report"],
    [historical.id, "customer: Acme\nCreate the monthly performance report"],
  ]);
  const visible = (record, actor) => record.ownerTeamId === (actor?.teamId ?? "team-1");
  const access = {
    findArtifact: (artifactId, actor) =>
      state.workflowArtifacts.find((artifact) =>
        artifact.id === artifactId && visible(artifact, actor)) ?? null,
    findSource: (sourceId, actor) =>
      source.id === sourceId && visible(source, actor) ? source : null,
    visible,
  };
  const embeddingRecords = new Map([
    [query.id, { vector: [1, 0] }],
    [historical.id, { vector: [1, 0] }],
  ]);
  const service = createWorkflowRetrievalService({
    access,
    effectiveRole: (artifact) => artifact.role,
    embeddingAdapter: {
      providerId: "local-test",
      model: "test-embedding",
      modelVersion: "1",
      rolloutPercent: 100,
    },
    files: {
      readArtifactText: (_state, _source, artifact) =>
        contentByArtifactId.get(artifact.id) ?? "",
    },
    quality: {
      caseHasExcludedEvidence: () => false,
      profileHasExcludedEvidence: () => false,
      qualityForCase: () => ({ status: "trusted" }),
    },
    retrievalVersion: 2,
    runtime: { state },
    scoring: {
      cosineSimilarity: () => 1,
      embeddingRecordFor: (artifact) => embeddingRecords.get(artifact.id) ?? null,
      extractStructuredFields: () => [{ key: "customer", value: "Acme" }],
      normalizedFieldLabel: (value) => String(value).toLowerCase(),
      rolloutEnabledFor: () => true,
      similarityTokens: (value) => new Set(String(value).toLowerCase().split(/\W+/).filter(Boolean)),
      summarizeWorkflowRetrievalRanks: (ranks) => ({
        sampleCount: ranks.length,
        top1: ranks.filter((rank) => rank === 1).length,
        top5: ranks.filter((rank) => rank > 0 && rank <= 5).length,
        mrr: ranks.length
          ? ranks.reduce((sum, rank) => sum + (rank > 0 ? 1 / rank : 0), 0) / ranks.length
          : 0,
      }),
      tokenSimilarity: () => 1,
    },
    views: {
      caseView: (value) => value,
      profileView: (value) => ({
        ...value,
        learningQuality: { status: "trusted" },
      }),
    },
  });
  return { query, service };
}

test("retrieval service ranks evidence, matches a profile, and inspects required fields", () => {
  const { query, service } = createFixture();

  const similar = service.findSimilarCases({ artifactId: query.id });
  assert.equal(similar.status, 200);
  assert.equal(similar.body.count, 1);
  assert.equal(similar.body.retrieval.vector.used, true);
  assert.equal(similar.body.cases[0].profileFamilyId, "profile-family-1");
  assert.ok(similar.body.cases[0].scoreBreakdown.vector > 0);

  const matches = service.matchProfiles({ artifactId: query.id });
  assert.equal(matches.status, 200);
  assert.equal(matches.body.matches[0].profile.id, "profile-1");
  assert.ok(matches.body.matches[0].reasons.includes("similar_confirmed_cases"));

  const inspection = service.inspectRequirement({
    artifactId: query.id,
    profileId: "profile-1",
  });
  assert.equal(inspection.status, 200);
  assert.equal(inspection.body.fields[0].value, "Acme");
  assert.equal(inspection.body.executionReady, true);
});

test("retrieval service does not expose another team's requirement", () => {
  const { query, service } = createFixture();
  const result = service.findSimilarCases(
    { artifactId: query.id },
    { teamId: "team-2" },
  );
  assert.equal(result.status, 404);
  assert.equal(result.body.error, "workflow_requirement_not_found");
});
