import assert from "node:assert/strict";
import test from "node:test";

import {
  createBusinessCaseDiscoveryService,
  deriveRoutineCandidateFromCases,
  scoreBusinessDocumentLink,
} from "../src/services/business-case-discovery.mjs";
import { createBusinessRoutineService } from "../src/services/business-routines.mjs";

const ACTOR = { teamId: "team_local", userId: "user_local" };

function field(artifactId, key, value) {
  return {
    key,
    value,
    normalizedValue: value,
    confidence: 0.95,
    evidenceRefs: [{ artifactId, kind: "field", field: key, location: "line/1" }],
    confirmationState: "confirmed",
  };
}

function fixture() {
  let id = 0;
  const state = {
    projects: [{ id: "project_1", teamId: ACTOR.teamId }],
    workflowSources: [{
      id: "source_1",
      ownerTeamId: ACTOR.teamId,
      projectId: "project_1",
      state: "active",
    }],
    workflowArtifacts: [],
    businessDocumentClassifications: [],
    businessDocumentAnalysisJobs: [],
    businessEntities: [],
    businessCaseCandidates: [],
    businessCases: [],
    routineDiscoveryCandidates: [],
    routineDefinitions: [],
    routineRuns: [],
    ledgerDefinitions: [],
  };
  const nextId = (prefix) => `${prefix}_${++id}`;
  const addDocument = (caseNumber, type, fields, suffix = "") => {
    const artifactId = `artifact_${caseNumber}_${type}${suffix}`;
    const fingerprint = String(id + 1).padStart(64, "a").slice(-64);
    state.workflowArtifacts.push({
      id: artifactId,
      ownerTeamId: ACTOR.teamId,
      projectId: "project_1",
      sourceId: "source_1",
      relativePath: `commercial/${caseNumber}/${type}${suffix}.md`,
      fingerprint,
      availability: "available",
      exclusion: null,
    });
    state.businessDocumentClassifications.push({
      id: `classification_${artifactId}`,
      ownerTeamId: ACTOR.teamId,
      projectId: "project_1",
      sourceId: "source_1",
      artifactId,
      artifactFingerprint: fingerprint,
      documentType: type,
      confirmationState: "confirmed",
      fieldProposals: Object.entries(fields).map(([key, value]) => field(artifactId, key, value)),
      revision: 1,
    });
    return artifactId;
  };

  const sharedPrice = addDocument("shared", "price_list", {
    customer: "ACME",
    product: "WIDGET",
  });
  for (const caseNumber of ["001", "002", "003"]) {
    const inquiryNumber = `INQ-${caseNumber}`;
    const quotationNumber = `QUO-${caseNumber}`;
    addDocument(caseNumber, "inquiry", {
      inquiry_number: inquiryNumber,
      customer: "ACME",
      product: "WIDGET",
      document_date: `2026-07-0${caseNumber}`,
    });
    addDocument(caseNumber, "inquiry_ledger", {
      inquiry_number: inquiryNumber,
      customer: "ACME",
      product: "WIDGET",
    });
    addDocument(caseNumber, "quotation", {
      inquiry_number: inquiryNumber,
      quotation_number: quotationNumber,
      customer: "ACME",
      product: "WIDGET",
      document_date: `2026-07-0${Number(caseNumber) + 1}`,
    });
    if (caseNumber === "001") {
      addDocument(caseNumber, "quotation", {
        inquiry_number: inquiryNumber,
        quotation_number: `${quotationNumber}-ALT`,
        customer: "ACME",
        product: "WIDGET",
        document_date: "2026-07-02",
      }, "_alternate");
    }
    addDocument(caseNumber, "quotation_ledger", {
      quotation_number: quotationNumber,
      customer: "ACME",
      product: "WIDGET",
    });
    if (caseNumber !== "003") {
      const orderNumber = `ORD-${caseNumber}`;
      addDocument(caseNumber, "order", {
        quotation_number: quotationNumber,
        order_number: orderNumber,
        customer: "ACME",
        product: "WIDGET",
      });
      addDocument(caseNumber, "order_ledger", {
        order_number: orderNumber,
        customer: "ACME",
        product: "WIDGET",
      });
      if (caseNumber === "001") {
        addDocument(caseNumber, "order", {
          quotation_number: quotationNumber,
          order_number: `${orderNumber}-B`,
          customer: "ACME",
          product: "WIDGET",
        }, "_second");
      }
    }
  }
  addDocument("unmatched", "quotation", {
    quotation_number: "QUO-NO-MATCH",
    customer: "OTHER",
    product: "OTHER",
  });

  const routineService = createBusinessRoutineService({ state, nextId });
  const service = createBusinessCaseDiscoveryService({
    state,
    nextId,
    createBusinessCase: routineService.createBusinessCase,
  });
  return { state, service, sharedPrice };
}

test("link scoring prefers business identifiers and retains source evidence", () => {
  const fromArtifact = { id: "inquiry", relativePath: "sales/one/inquiry.md" };
  const toArtifact = { id: "quote", relativePath: "sales/one/quote.md" };
  const fromClassification = {
    artifactId: "inquiry",
    documentType: "inquiry",
    fieldProposals: [
      field("inquiry", "inquiry_number", "INQ-1"),
      field("inquiry", "customer", "ACME"),
    ],
  };
  const toClassification = {
    artifactId: "quote",
    documentType: "quotation",
    fieldProposals: [
      field("quote", "inquiry_number", "INQ-1"),
      field("quote", "customer", "ACME"),
    ],
  };
  const result = scoreBusinessDocumentLink({
    fromClassification,
    toClassification,
    fromArtifact,
    toArtifact,
  });
  assert.equal(result.relationship, "precedes");
  assert.ok(result.score >= 0.8);
  assert.match(result.reasons.join(" "), /document number matches/i);
  assert.deepEqual(new Set(result.evidenceRefs.map((ref) => ref.artifactId)), new Set(["inquiry", "quote"]));
});

test("case discovery supports staged, one-to-many and shared-reference relationships", () => {
  const { service, sharedPrice } = fixture();
  const result = service.discoverBusinessCases({ sourceId: "source_1" }, ACTOR);
  assert.equal(result.status, 200);
  assert.equal(result.body.count, 3);
  const first = result.body.candidates.find((candidate) => candidate.businessKey === "INQ-001");
  assert.ok(first);
  assert.equal(first.evidenceHealth.state, "valid");
  const quotationLinks = first.links.filter((link) => link.relationship === "precedes");
  assert.ok(quotationLinks.length >= 2);
  assert.ok(quotationLinks.some((link) => link.alternatives.length >= 1));
  assert.ok(first.links.some((link) => link.relationship === "handoff"));
  assert.ok(first.artifactBindings.some((binding) => binding.artifactId === sharedPrice));
  assert.ok(first.artifactBindings.filter((binding) => binding.documentType === "order").length >= 2);
  assert.ok(first.links.every((link) =>
    typeof link.score === "number"
    && link.reasons.length
    && Array.isArray(link.alternatives)));
  assert.ok(result.body.candidates.every((candidate) =>
    candidate.artifactBindings.some((binding) => binding.artifactId === sharedPrice)));
  assert.ok(result.body.candidates.every((candidate) =>
    !candidate.artifactBindings.some((binding) => binding.artifactId.includes("unmatched"))));
});

test("candidate corrections create history and changed evidence blocks confirmation", () => {
  const { state, service } = fixture();
  const discovered = service.discoverBusinessCases({ sourceId: "source_1" }, ACTOR);
  const original = discovered.body.candidates.find((candidate) => candidate.businessKey === "INQ-001");
  const retained = original.artifactBindings
    .filter((binding) => !binding.artifactId.endsWith("_second"))
    .map((binding) => binding.artifactId);
  const corrected = service.reviewBusinessCaseCandidate({
    candidateId: original.id,
    expectedRevision: original.revision,
    action: "correct",
    artifactIds: retained,
    correctionReason: "The second order belongs to a separate shipment.",
  }, ACTOR);
  assert.equal(corrected.status, 201);
  assert.equal(corrected.body.candidate.version, 2);
  assert.equal(corrected.body.candidate.supersedesId, original.id);
  assert.equal(state.businessCaseCandidates.find((row) => row.id === original.id).state, "superseded");

  const changedArtifact = state.workflowArtifacts.find((row) =>
    row.id === corrected.body.candidate.anchorArtifactId);
  changedArtifact.fingerprint = "f".repeat(64);
  const blocked = service.reviewBusinessCaseCandidate({
    candidateId: corrected.body.candidate.id,
    expectedRevision: corrected.body.candidate.revision,
    action: "confirm",
  }, ACTOR);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.evidenceHealth.state, "downgraded");
});

test("candidate correction rejects a disconnected but otherwise confirmed document", () => {
  const { service } = fixture();
  const discovered = service.discoverBusinessCases({ sourceId: "source_1" }, ACTOR);
  const original = discovered.body.candidates.find((candidate) => candidate.businessKey === "INQ-001");
  const disconnected = service.reviewBusinessCaseCandidate({
    candidateId: original.id,
    expectedRevision: original.revision,
    action: "correct",
    artifactIds: [
      ...original.artifactBindings.map((binding) => binding.artifactId),
      "artifact_unmatched_quotation",
    ],
    correctionReason: "Try to include an unrelated quotation.",
  }, ACTOR);
  assert.equal(disconnected.status, 400);
  assert.equal(disconnected.body.error, "business_case_candidate_contains_disconnected_artifacts");
});

test("confirmed candidates materialize cases and routine discovery explains mandatory and conditional steps", () => {
  const { state, service } = fixture();
  const discovered = service.discoverBusinessCases({ sourceId: "source_1" }, ACTOR);
  for (const candidate of discovered.body.candidates) {
    const confirmed = service.reviewBusinessCaseCandidate({
      candidateId: candidate.id,
      expectedRevision: candidate.revision,
      action: "confirm",
    }, ACTOR);
    assert.equal(confirmed.status, 200);
  }
  assert.equal(state.businessCases.length, 3);

  const result = service.discoverRoutine({ sourceId: "source_1" }, ACTOR);
  assert.equal(result.status, 201);
  assert.deepEqual(result.body.candidate.steps.map((step) => step.key), [
    "inquiry_registration",
    "reference_retrieval",
    "quotation_generation",
    "quotation_approval",
    "quotation_registration",
    "order_signal",
    "order_handoff",
    "order_registration",
  ]);
  for (const key of [
    "inquiry_registration",
    "reference_retrieval",
    "quotation_generation",
    "quotation_approval",
    "quotation_registration",
  ]) {
    assert.equal(result.body.candidate.steps.find((step) => step.key === key).requirement, "mandatory");
  }
  for (const key of ["order_signal", "order_handoff", "order_registration"]) {
    const step = result.body.candidate.steps.find((row) => row.key === key);
    assert.equal(step.requirement, "conditional");
    assert.ok(step.exceptionCaseIds.length);
  }

  const changedInquiry = state.workflowArtifacts.find((artifact) =>
    artifact.id === "artifact_003_inquiry");
  changedInquiry.fingerprint = "e".repeat(64);
  const staleEvidence = service.discoverRoutine({ sourceId: "source_1" }, ACTOR);
  assert.equal(staleEvidence.status, 409);
  assert.equal(staleEvidence.body.confirmedCaseCount, 2);
  const listed = service.listRoutineDiscoveryCandidates({ sourceId: "source_1" }, ACTOR);
  assert.equal(listed.body.candidates[0].evidenceHealth.state, "blocked");
  assert.equal(listed.body.candidates[0].evidenceHealth.healthyCaseCount, 2);
});

test("fewer than three cases cannot establish a routine and an anomaly cannot become mandatory", () => {
  const insufficient = deriveRoutineCandidateFromCases([
    { id: "one", artifactBindings: [{ artifactId: "a", documentType: "inquiry" }] },
    { id: "two", artifactBindings: [{ artifactId: "b", documentType: "inquiry" }] },
  ]);
  assert.equal(insufficient.ok, false);
  assert.equal(insufficient.minimumCaseCount, 3);

  const derived = deriveRoutineCandidateFromCases([
    {
      id: "one",
      artifactBindings: [
        { artifactId: "a", documentType: "inquiry" },
        { artifactId: "ledger", documentType: "inquiry_ledger" },
        { artifactId: "quote-1", documentType: "quotation" },
      ],
    },
    {
      id: "two",
      artifactBindings: [
        { artifactId: "b", documentType: "inquiry" },
        { artifactId: "quote-2", documentType: "quotation" },
      ],
    },
    {
      id: "three",
      artifactBindings: [
        { artifactId: "c", documentType: "inquiry" },
        { artifactId: "quote-3", documentType: "quotation" },
      ],
    },
  ]);
  assert.equal(derived.ok, true);
  const inquiryRegistration = derived.steps.find((step) => step.key === "inquiry_registration");
  assert.equal(inquiryRegistration.requirement, "conditional");
  assert.equal(inquiryRegistration.supportCaseIds.length, 1);
});
