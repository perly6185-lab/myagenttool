import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkflowMemoryPackage,
  calculateWorkflowMemoryHealth,
  createWorkflowMemoryInsightsService,
  deriveWorkflowPathGraph,
  diffWorkflowMemoryPackages,
} from "../src/services/workflow-memory-insights.mjs";

function fixture() {
  const artifact = (id, relativePath, fingerprint) => ({
    id,
    ownerTeamId: "team_a",
    projectId: "prj_a",
    sourceId: "wfs_a",
    relativePath,
    fingerprint,
    availability: "available",
  });
  return {
    workflowSources: [{
      id: "wfs_a",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      relativePath: "commercial",
      state: "active",
      revision: 4,
    }],
    workflowArtifacts: [
      artifact("inquiry", "incoming/RFQ-100.md", "a".repeat(64)),
      artifact("price", "references/prices.xlsx", "b".repeat(64)),
      artifact("quote", "deliveries/RFQ-100-quote.md", "c".repeat(64)),
      artifact("ledger", "ledgers/inquiries.xlsx", "d".repeat(64)),
    ],
    businessCases: [{
      id: "case_100",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      state: "confirmed",
      artifactBindings: [
        { artifactId: "inquiry", documentType: "inquiry", roles: ["trigger", "input"] },
        { artifactId: "price", documentType: "price_list", roles: ["reference"] },
        { artifactId: "quote", documentType: "quotation", roles: ["output"] },
        { artifactId: "ledger", documentType: "inquiry_ledger", roles: ["output"] },
      ],
      artifactFingerprints: {
        inquiry: "a".repeat(64),
        price: "b".repeat(64),
        quote: "c".repeat(64),
        ledger: "d".repeat(64),
      },
    }],
    routineDefinitions: [{
      id: "routine_1",
      familyId: "routine_family",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      state: "published",
      version: 3,
      triggerDocumentTypes: ["inquiry"],
      steps: [{ key: "extract", kind: "extract", label: "Extract inquiry", required: true }, {
        key: "reference",
        kind: "retrieve",
        label: "Find approved price",
        required: true,
      }, {
        key: "draft",
        kind: "generate",
        label: "Generate quotation draft",
        required: true,
        configuration: {
          outputDirectory: "working/quotation-drafts",
          requiredFields: ["customer", "currency"],
        },
      }, {
        key: "approve",
        kind: "human_approval",
        label: "Approve quotation",
        required: true,
      }, {
        key: "register",
        kind: "ledger_upsert",
        label: "Register inquiry",
        required: true,
      }],
    }],
    ledgerDefinitions: [{
      id: "ledger_def",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      state: "active",
      relativePath: "ledgers/inquiries.xlsx",
      revision: 2,
    }],
    workflowProfiles: [{
      id: "profile_1",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      sourceId: "wfs_a",
      profileVersion: 2,
      state: "established",
      outcomeSpec: {
        observedDirectories: ["deliveries"],
        pathTemplate: "deliveries/{requirement-stem}-quote.md",
        overwritePolicy: "never",
        requiredSections: [{ key: "price", label: "Price", required: true }],
        requiredFields: [{ key: "currency", label: "Currency", required: true }],
      },
    }],
    workflowIntakeObservations: [{
      id: "obs_1", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_a",
      state: "triggered", createdAt: "2026-08-01T00:00:00.000Z",
    }, {
      id: "obs_2", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_a",
      state: "duplicate", createdAt: "2026-08-02T00:00:00.000Z",
    }, {
      id: "obs_3", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_a",
      state: "needs_review", createdAt: "2026-08-03T00:00:00.000Z",
    }],
    workflowAdaptiveFeedback: [{
      id: "feedback_1", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_a",
      suggestionId: "suggestion_1", decision: "accepted", createdAt: "2026-08-01T12:00:00.000Z",
    }, {
      id: "feedback_2", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_a",
      suggestionId: "suggestion_2", decision: "rejected", correctionConfirmed: true,
      createdAt: "2026-08-03T12:00:00.000Z",
    }],
    workflowAdaptiveOutcomes: [{
      id: "outcome_1", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_a",
      workItemId: "work_1", status: "completed", createdAt: "2026-08-02T12:00:00.000Z",
      outputAssets: [{ id: "asset_1", path: "deliveries/RFQ-100-quote.md" }],
      verification: [{ id: "verify_1", status: "passed" }],
    }, {
      id: "outcome_2", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_a",
      workItemId: "work_2", status: "blocked", createdAt: "2026-08-04T12:00:00.000Z",
      outputAssets: [], verification: [{ id: "verify_2", status: "failed" }],
    }],
  };
}

const scope = (state, extra = {}) => ({
  state,
  ownerTeamId: "team_a",
  projectId: "prj_a",
  sourceId: "wfs_a",
  ...extra,
});

test("derives an evidence-backed five-stage work path without reading raw content", () => {
  const state = fixture();
  const before = JSON.stringify(state);
  const result = deriveWorkflowPathGraph(scope(state));
  assert.equal(result.ok, true);
  assert.deepEqual(
    Object.fromEntries(result.graph.nodes.map((node) => [node.kind, node.state])),
    { entry: "confirmed", reference: "confirmed", intermediate: "confirmed", final: "confirmed", ledger: "confirmed" },
  );
  assert.deepEqual(result.graph.nodes.find((node) => node.kind === "entry").paths.map((row) => row.path), ["incoming"]);
  assert.deepEqual(result.graph.nodes.find((node) => node.kind === "intermediate").paths.map((row) => row.path), [
    "working/quotation-drafts",
  ]);
  assert.ok(result.graph.nodes.every((node) => node.paths.every((path) => path.evidence.length > 0)));
  assert.equal(result.graph.edges.length, 4);
  assert.equal(JSON.stringify(state), before, "insight derivation is pure");
});

test("marks unsupported path roles unknown and rejects stale evidence", () => {
  const state = fixture();
  state.businessCases[0].artifactFingerprints.inquiry = "stale";
  state.businessCases[0].artifactBindings = state.businessCases[0].artifactBindings
    .filter((binding) => binding.artifactId === "inquiry");
  state.routineDefinitions = [];
  state.ledgerDefinitions = [];
  state.workflowAdaptiveOutcomes = [];
  const result = deriveWorkflowPathGraph(scope(state));
  assert.equal(result.ok, true);
  assert.deepEqual(result.graph.unknownKinds, ["entry", "reference", "intermediate", "final", "ledger"]);
  assert.deepEqual(result.graph.edges, []);
});

test("derives historical requirement, reference, draft, and delivery paths from confirmed delivery cases", () => {
  const state = fixture();
  state.businessCases = [];
  state.routineDefinitions = [];
  state.ledgerDefinitions = [];
  state.workflowAdaptiveOutcomes = [];
  state.deliveryCases = [{
    id: "delivery_case_1",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    sourceId: "wfs_a",
    state: "confirmed",
    requirementArtifactIds: ["inquiry"],
    referenceArtifactIds: ["price"],
    draftArtifactIds: ["ledger"],
    deliveryArtifactIds: ["quote"],
    evidenceSnapshots: [{ artifactId: "inquiry", role: "requirement", fingerprint: "a".repeat(64) }, {
      artifactId: "price", role: "reference", fingerprint: "b".repeat(64),
    }, {
      artifactId: "ledger", role: "draft", fingerprint: "d".repeat(64),
    }, {
      artifactId: "quote", role: "delivery", fingerprint: "c".repeat(64),
    }],
  }];
  const result = deriveWorkflowPathGraph(scope(state));
  assert.deepEqual(result.graph.unknownKinds, ["ledger"]);
  assert.deepEqual(result.graph.nodes.find((node) => node.kind === "entry").paths[0].evidence[0], {
    kind: "delivery_case",
    id: "delivery_case_1",
    artifactId: "inquiry",
    role: "requirement",
    fingerprint: "a".repeat(64),
  });
});

test("builds a deterministic versioned memory package with explainable rules and gates", () => {
  const state = fixture();
  const first = buildWorkflowMemoryPackage(scope(state, {
    version: 4,
    routineDefinitionId: "routine_1",
    generatedAt: "2026-08-05T00:00:00.000Z",
  }));
  const replay = buildWorkflowMemoryPackage(scope(state, {
    version: 4,
    routineDefinitionId: "routine_1",
    generatedAt: "2026-08-06T00:00:00.000Z",
  }));
  assert.equal(first.ok, true);
  assert.equal(first.memoryPackage.version, 4);
  assert.equal(first.memoryPackage.contentHash, replay.memoryPackage.contentHash);
  assert.equal(first.memoryPackage.packageId, replay.memoryPackage.packageId);
  assert.deepEqual(first.memoryPackage.summary.trigger.value.documentTypes, ["inquiry"]);
  assert.equal(first.memoryPackage.summary.naming.value.pathTemplate, "deliveries/{requirement-stem}-quote.md");
  assert.ok(first.memoryPackage.summary.acceptance.value.some((row) => row.key === "currency"));
  assert.deepEqual(
    first.memoryPackage.summary.humanGates.value.map((gate) => gate.kind),
    ["human_approval", "ledger_upsert", "input_confirmation"],
  );
  assert.ok(Object.values(first.memoryPackage.summary).every((item) =>
    item.state === "unknown" || item.evidence.length > 0));
});

test("computes bounded health, duplicate and correction rates, and anomaly trends", () => {
  const result = calculateWorkflowMemoryHealth(scope(fixture()));
  assert.equal(result.ok, true);
  assert.equal(result.health.representative, true);
  assert.equal(result.health.metrics.duplicateRate, 1 / 3);
  assert.equal(result.health.metrics.manualCorrectionRate, 1 / 2);
  assert.equal(result.health.metrics.completionRate, 1 / 2);
  assert.equal(result.health.metrics.verificationPassRate, 1 / 2);
  assert.equal(result.health.metrics.anomalyCount, 2);
  assert.ok(result.health.score >= 0 && result.health.score <= 100);
  assert.equal(result.health.status, "at_risk");
  assert.ok(result.health.scoreBreakdown.totalPenalty > 0);
  assert.ok(result.health.reasons.includes("manual_correction_rate_high"));
  assert.equal(result.health.trends.manualCorrectionRate.direction, "worsening");
});

test("overview combines the current and previous package, suggestions, and safe rollback target", () => {
  const state = fixture();
  state.routineDefinitions[0].familyId = "family_1";
  state.routineDefinitions.push({
    ...structuredClone(state.routineDefinitions[0]),
    id: "routine_previous",
    version: 2,
    state: "superseded",
    steps: state.routineDefinitions[0].steps.filter((step) => step.key !== "register"),
  });
  state.workflowAdaptiveRules = [{
    id: "rule_2", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_a",
    version: 2, revision: 3, status: "active", previousRuleId: "rule_1",
    configuration: { documentTypes: [{ documentType: "inquiry", actions: ["read"], confidenceThreshold: 0.95 }] },
  }];
  state.workflowAdaptiveLearningDrafts = [{
    id: "draft_3", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_a",
    version: 3, revision: 1, status: "shadow", evidenceIds: ["one", "two", "three"],
    configuration: { documentTypes: [{ documentType: "inquiry", actions: ["read", "check"], confidenceThreshold: 0.9 }] },
    evaluation: { passed: true },
  }];
  const result = createWorkflowMemoryInsightsService({ state }).getOverview({
    projectId: "prj_a",
    sourceId: "wfs_a",
  }, { teamId: "team_a" });
  assert.equal(result.status, 200);
  assert.equal(result.body.routineSelection.state, "matched");
  assert.equal(result.body.memoryPackage.version, 3);
  assert.equal(result.body.previousMemoryPackage.version, 2);
  assert.equal(result.body.packageDiff.changed, true);
  assert.equal(result.body.resultSuggestions[0].changes.added[0], "check");
  assert.deepEqual(result.body.rollback, { available: true, ruleId: "rule_2", expectedRevision: 3 });
});

test("overview selects an explicitly requested Routine when one source has several work types", () => {
  const state = fixture();
  state.routineDefinitions.push({
    ...structuredClone(state.routineDefinitions[0]),
    id: "routine_contract",
    familyId: "family_contract",
    triggerDocumentTypes: ["contract_review"],
  });
  const service = createWorkflowMemoryInsightsService({ state });
  assert.equal(service.getOverview({ projectId: "prj_a", sourceId: "wfs_a" }, { teamId: "team_a" })
    .body.routineSelection.state, "conflict");
  const selected = service.getOverview({
    projectId: "prj_a",
    sourceId: "wfs_a",
    routineDefinitionId: "routine_contract",
  }, { teamId: "team_a" });
  assert.equal(selected.body.routineSelection.state, "matched");
  assert.equal(selected.body.memoryPackage.basis.routineDefinitionId, "routine_contract");
  assert.equal(selected.body.pathGraph.edges.length, 4);
});

test("diffs two versions structurally and ignores generated identity fields", () => {
  const first = buildWorkflowMemoryPackage(scope(fixture(), { version: 1 })).memoryPackage;
  const second = structuredClone(first);
  second.version = 2;
  second.packageId = "different-generated-id";
  second.contentHash = "different-generated-hash";
  second.generatedAt = "2026-08-07T00:00:00.000Z";
  second.summary.naming.value.pathTemplate = "deliveries/{business-key}.md";
  second.summary.humanGates.value.push({
    key: "send",
    kind: "human_approval",
    label: "Approve sending",
    evidence: [{ kind: "routine_step", id: "routine_1", version: 4, stepKey: "send" }],
  });
  const result = diffWorkflowMemoryPackages(first, second);
  assert.equal(result.ok, true);
  assert.equal(result.diff.fromVersion, 1);
  assert.equal(result.diff.toVersion, 2);
  assert.equal(result.diff.changed, true);
  assert.ok(result.diff.changes.some((change) => change.path === "/summary/naming/value/pathTemplate"));
  assert.ok(result.diff.changes.some((change) => change.path === "/summary/humanGates/value"));
  assert.equal(result.diff.changes.some((change) => change.path.includes("packageId")), false);
});

test("fails closed for missing tenant scope, revoked sources, invalid versions, and cross-family diffs", () => {
  const state = fixture();
  assert.equal(deriveWorkflowPathGraph({ state, projectId: "prj_a", sourceId: "wfs_a" }).error,
    "workflow_memory_insights_scope_required");
  assert.equal(deriveWorkflowPathGraph(scope(state, { ownerTeamId: "team_b" })).error,
    "workflow_memory_insights_source_not_found");
  state.workflowSources[0].state = "revoked";
  assert.equal(calculateWorkflowMemoryHealth(scope(state)).error,
    "workflow_memory_insights_source_not_active");
  state.workflowSources[0].state = "active";
  assert.equal(buildWorkflowMemoryPackage(scope(state)).error,
    "workflow_memory_package_version_required");
  assert.equal(buildWorkflowMemoryPackage(scope(state, {
    version: 1, routineDefinitionId: "missing",
  })).error, "workflow_memory_package_routine_not_found");
  const first = buildWorkflowMemoryPackage(scope(state, { version: 1 })).memoryPackage;
  assert.equal(diffWorkflowMemoryPackages(first, { ...first, familyId: "other", version: 2 }).error,
    "workflow_memory_package_diff_invalid");
});
