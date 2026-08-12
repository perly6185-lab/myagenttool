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
  return { state, service, routineService, sharedPrice };
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

test("template learning preserves user-declared input/output pairs when business numbers differ", () => {
  const { state, service } = fixture();
  state.templateLearningTasks = [{
    id: "learning_1",
    sourceId: "source_1",
    ownerTeamId: ACTOR.teamId,
    cases: ["001", "002", "003"].map((number) => ({
      id: `case-${number}`,
      files: [
        { role: "input", relativePath: `commercial/${number}/inquiry.md` },
        { role: "output", relativePath: `commercial/${number}/quotation.md` },
      ],
    })),
  }];
  for (const classification of state.businessDocumentClassifications.filter((row) =>
    /^artifact_(001|002|003)_quotation$/.test(row.artifactId))) {
    classification.fieldProposals = classification.fieldProposals
      .filter((proposal) => proposal.key !== "inquiry_number");
  }

  const result = service.discoverBusinessCases({ sourceId: "source_1" }, ACTOR);
  assert.equal(result.status, 200);
  assert.equal(result.body.pairingMode, "user_declared_template_cases");
  assert.equal(result.body.count, 3);
  assert.ok(result.body.candidates.every((candidate) => candidate.confidence === 1));
  assert.ok(result.body.candidates.every((candidate) =>
    candidate.artifactBindings.some((binding) => binding.roles.includes("input"))
    && candidate.artifactBindings.some((binding) => binding.roles.includes("output"))));
  assert.ok(result.body.candidates.every((candidate) =>
    candidate.links.every((link) => link.evidenceRefs.every((ref) => ref.kind === "template_learning_pair"))));
});

test("one explicit template-learning case creates a routine ready for recommendation", () => {
  const { state, service } = fixture();
  state.workflowSources.find((source) => source.id === "source_1").purpose = "template_learning";
  state.templateLearningTasks = [{
    id: "learning_trial",
    sourceId: "source_1",
    ownerTeamId: ACTOR.teamId,
    cases: [{
      id: "case-trial",
      files: [
        { role: "input", relativePath: "commercial/001/inquiry.md" },
        { role: "output", relativePath: "commercial/001/quotation.md" },
      ],
    }],
  }];
  const discovered = service.discoverBusinessCases({ sourceId: "source_1" }, ACTOR);
  assert.equal(discovered.body.count, 1);
  const candidate = discovered.body.candidates[0];
  assert.equal(service.reviewBusinessCaseCandidate({
    candidateId: candidate.id,
    expectedRevision: candidate.revision,
    action: "confirm",
  }, ACTOR).status, 200);
  const routine = service.discoverRoutine({ sourceId: "source_1" }, ACTOR);
  assert.equal(routine.status, 201);
  assert.equal(routine.body.candidate.minimumCaseCount, 1);
  assert.equal(routine.body.candidate.templateMaturity, "stable");
});

test("one explicit template case may use reference documents as its declared input", () => {
  const { state, service } = fixture();
  state.workflowSources.find((source) => source.id === "source_1").purpose = "template_learning";
  state.templateLearningTasks = [{
    id: "learning_reference_input",
    sourceId: "source_1",
    ownerTeamId: ACTOR.teamId,
    cases: [{
      id: "case-reference",
      files: [
        { role: "input", relativePath: "commercial/001/inquiry.md" },
        { role: "output", relativePath: "commercial/001/quotation.md" },
      ],
    }],
  }];
  const inputClassification = state.businessDocumentClassifications.find((row) =>
    row.artifactId === "artifact_001_inquiry");
  inputClassification.documentType = "other_reference";

  const discovered = service.discoverBusinessCases({ sourceId: "source_1" }, ACTOR);
  const candidate = discovered.body.candidates[0];
  assert.ok(candidate.artifactBindings.some((binding) =>
    binding.documentType === "other_reference" && binding.roles.includes("input")));
  assert.equal(service.reviewBusinessCaseCandidate({
    candidateId: candidate.id,
    expectedRevision: candidate.revision,
    action: "confirm",
  }, ACTOR).status, 200);
  const routine = service.discoverRoutine({ sourceId: "source_1" }, ACTOR);
  assert.equal(routine.status, 201);
  assert.equal(routine.body.candidate.minimumCaseCount, 1);
});

test("template learning derives a generic input-output contract instead of forcing inquiry and quotation", () => {
  const { state, service, routineService } = fixture();
  const source = state.workflowSources.find((row) => row.id === "source_1");
  source.purpose = "template_learning";
  const input = state.workflowArtifacts.find((row) => row.id === "artifact_001_inquiry");
  Object.assign(input, {
    name: "气体腐蚀试验箱技术协议.pdf",
    extension: "pdf",
    relativePath: "cases/case-1/raw/inputs/气体腐蚀试验箱技术协议.pdf",
    extraction: { blocks: [{ kind: "heading", text: "气体腐蚀试验箱技术协议" }, { kind: "text", text: "生产厂家：南京五和\n设备型号：WHQ-2000B\n数量：1套\n保修期1年\n第三方校准" }] },
  });
  const output = state.workflowArtifacts.find((row) => row.id === "artifact_001_quotation");
  Object.assign(output, {
    name: "采购清单.xlsx",
    extension: "xlsx",
    relativePath: "cases/case-1/raw/outputs/采购清单.xlsx",
    extraction: { blocks: [{ kind: "row", text: "A: 序号 | B: 文件名 | C: 品牌/厂家 | D: 产品名利 | E: 型号 | F: 报价单价 | G: 报价总价" }] },
  });
  state.businessDocumentClassifications.find((row) => row.artifactId === input.id).documentType = "other_reference";
  state.templateLearningTasks = [{
    id: "learning_contract",
    sourceId: source.id,
    ownerTeamId: ACTOR.teamId,
    cases: [{
      id: "case-1",
      files: [
        { role: "input", relativePath: input.relativePath },
        { role: "output", relativePath: output.relativePath },
      ],
    }],
  }];

  const discovered = service.discoverBusinessCases({ sourceId: source.id }, ACTOR);
  const caseCandidate = discovered.body.candidates[0];
  assert.equal(service.reviewBusinessCaseCandidate({
    candidateId: caseCandidate.id,
    expectedRevision: caseCandidate.revision,
    action: "confirm",
  }, ACTOR).status, 200);
  const routine = service.discoverRoutine({ sourceId: source.id }, ACTOR);

  assert.equal(routine.status, 201);
  assert.equal(routine.body.candidate.name, "设备技术协议生成采购清单");
  assert.equal(routine.body.candidate.description, "收到：设备技术协议 PDF\n得到：采购清单 Excel");
  assert.deepEqual(routine.body.candidate.steps.map((step) => step.key), [
    "read_inputs", "map_output_fields", "generate_output", "review_output",
  ]);
  assert.deepEqual(routine.body.candidate.templateContract.outputColumns, [
    "序号", "文件名", "品牌/厂家", "产品名称", "型号", "报价单价", "报价总价",
  ]);
  assert.deepEqual(routine.body.candidate.templateContract.uncertainFields, ["报价单价", "报价总价"]);
  const draft = routineService.createRoutineDraftFromDiscovery({
    discoveryCandidateId: routine.body.candidate.id,
  }, ACTOR);
  assert.equal(draft.status, 201);
  assert.equal(draft.body.routineDefinition.name, "设备技术协议生成采购清单");
  assert.deepEqual(draft.body.routineDefinition.templateContract.outputColumns,
    routine.body.candidate.templateContract.outputColumns);
  const listedDraft = routineService.listRoutineDefinitions({ sourceId: source.id }, ACTOR)
    .body.routineDefinitions.find((definition) => definition.id === draft.body.routineDefinition.id);
  assert.equal(listedDraft.evidenceHealth.state, "valid");
  const published = routineService.publishRoutineDefinition({
    routineDefinitionId: draft.body.routineDefinition.id,
    expectedRevision: draft.body.routineDefinition.revision,
    confirmed: true,
  }, ACTOR);
  assert.equal(published.status, 200);
  assert.equal(published.body.routineDefinition.state, "published");
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
