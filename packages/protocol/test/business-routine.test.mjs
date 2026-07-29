import assert from "node:assert/strict";
import test from "node:test";

import {
  businessDocumentTypes,
  businessRoutineSchemaVersion,
  normalizeBusinessFieldProposals,
  normalizeBusinessDocumentClassification,
  normalizeLocalIssueRoutineBinding,
  normalizeRoutineEvidenceRefs,
  normalizeRoutineSteps,
  routineArtifactRoles,
  routineStepKinds,
} from "@myagenttool/protocol/business-routine";

test("business routine vocabulary keeps document type separate from contextual role", () => {
  assert.equal(businessRoutineSchemaVersion, 1);
  assert.ok(businessDocumentTypes.includes("quotation"));
  assert.deepEqual(routineArtifactRoles, ["trigger", "input", "output", "reference"]);
  assert.deepEqual(routineStepKinds, [
    "extract",
    "retrieve",
    "generate",
    "ledger_upsert",
    "human_approval",
    "condition",
    "create_issue",
  ]);
});

test("routine steps validate dependencies and reject cycles", () => {
  const result = normalizeRoutineSteps([
    { key: "extract", kind: "extract", label: "Extract inquiry", configuration: {} },
    {
      key: "quote",
      kind: "generate",
      label: "Generate quotation",
      dependsOn: ["extract"],
      evidenceRefs: [{ artifactId: "wfa_1", kind: "historical_case", location: "blocks/2" }],
      configuration: { outputTemplate: "quotation-{businessKey}.md" },
    },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.value[1].dependsOn[0], "extract");

  assert.deepEqual(normalizeRoutineSteps([
    { key: "a", kind: "extract", label: "A", dependsOn: ["b"] },
    { key: "b", kind: "retrieve", label: "B", dependsOn: ["a"] },
  ]), { ok: false, error: "routine_step_dependency_cycle" });
});

test("contracts strip raw evidence and reject absolute local paths", () => {
  assert.deepEqual(normalizeRoutineEvidenceRefs([{
    artifactId: "wfa_1",
    kind: "cell",
    field: "amount",
    location: "Sheet1/B2",
    content: "must not survive",
    absolutePath: "/Users/example/private.xlsx",
  }]), [{
    artifactId: "wfa_1",
    kind: "cell",
    field: "amount",
    location: "Sheet1/B2",
  }]);
  assert.equal(normalizeRoutineEvidenceRefs([{
    artifactId: "wfa_1",
    kind: "cell",
    location: "/Users/example/private.xlsx",
  }]), null);
  assert.equal(normalizeRoutineEvidenceRefs([{
    artifactId: "wfa_1",
    kind: "cell",
    location: "\\\\server\\share\\private.xlsx",
  }]), null);
  assert.equal(normalizeRoutineSteps([{
    key: "write",
    kind: "ledger_upsert",
    label: "Update ledger",
    configuration: { absolutePath: "/tmp/private.xlsx" },
  }]).ok, false);
  assert.equal(normalizeRoutineSteps([{
    key: "write",
    kind: "generate",
    label: "Generate",
    configuration: { accessToken: "must-not-persist" },
  }]).ok, false);
  assert.equal(normalizeRoutineSteps([{
    key: "write",
    kind: "generate",
    label: "Generate",
    configuration: { userPrompt: "must-not-persist" },
  }]).ok, false);
});

test("business classification is bounded, versioned, and evidence-backed", () => {
  const result = normalizeBusinessDocumentClassification({
    artifactId: "wfa_1",
    artifactFingerprint: "a".repeat(64),
    documentType: "quotation",
    confidence: 0.92,
    reasons: ["Contains a quotation number"],
    evidenceRefs: [{ artifactId: "wfa_1", kind: "field", field: "quotation_number" }],
    fieldProposals: [{
      key: "quotation_number",
      value: "QT-001",
      confidence: 0.97,
      evidenceRefs: [{
        artifactId: "wfa_1",
        kind: "field",
        field: "quotation_number",
        location: "page/1",
      }],
    }],
    riskSignals: [],
    confirmationState: "confirmed",
    classifierVersion: 2,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.schemaVersion, 1);
  assert.equal(result.value.documentType, "quotation");
  assert.equal(result.value.confidence, 0.92);
  assert.equal(result.value.fieldProposals[0].key, "quotation_number");
  assert.equal(result.value.analysisState, "deterministic");
  assert.equal(normalizeBusinessDocumentClassification({
    artifactId: "wfa_1",
    artifactFingerprint: "b".repeat(64),
    documentType: "quotation",
    confidence: 1.2,
  }).ok, false);
});

test("business field proposals reject unsupported, duplicate, and evidence-free values", () => {
  const evidenceRefs = [{ artifactId: "wfa_1", kind: "field", field: "amount", location: "row/2" }];
  assert.equal(normalizeBusinessFieldProposals([{
    key: "amount",
    value: "1200.00",
    normalizedValue: "1200.00",
    confidence: 0.9,
    evidenceRefs,
  }])[0].key, "amount");
  assert.equal(normalizeBusinessFieldProposals([{
    key: "api_token",
    value: "secret",
    confidence: 0.9,
    evidenceRefs,
  }]), null);
  assert.equal(normalizeBusinessFieldProposals([{
    key: "amount",
    value: "1200",
    confidence: 0.9,
    evidenceRefs,
  }, {
    key: "amount",
    value: "1300",
    confidence: 0.9,
    evidenceRefs,
  }]), null);
});

test("local Issue routine binding requires a complete immutable pin", () => {
  assert.deepEqual(normalizeLocalIssueRoutineBinding({
    routineDefinitionId: "rtd_1",
    routineVersion: 3,
    businessCaseId: "bcs_1",
    businessKey: "RFQ-2026-001",
    triggerArtifactIds: ["wfa_1"],
  }), {
    ok: true,
    value: {
      schemaVersion: 1,
      routineDefinitionId: "rtd_1",
      routineVersion: 3,
      businessCaseId: "bcs_1",
      businessKey: "RFQ-2026-001",
      triggerArtifactIds: ["wfa_1"],
    },
  });
  assert.equal(normalizeLocalIssueRoutineBinding({
    routineDefinitionId: "rtd_1",
    routineVersion: 3,
    businessCaseId: "bcs_1",
    businessKey: "RFQ-2026-001",
    triggerArtifactIds: [],
  }).ok, false);
});
