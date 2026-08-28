import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PRIVATE_TUTOR_MATERIAL_MAX_FILE_BYTES,
  parseMaterialDocument,
  parseUploadedMaterialDocument,
  parseMarkdownSections,
  parsePdfTextSections,
  parsePlainTextSections,
} from "../src/services/private-tutor-material-parser.mjs";
import {
  confirmKnowledgeMapDraft,
  generateKnowledgeMapDraft,
  knowledgeMapDraftFingerprint,
  publishKnowledgeMapDraft,
  updateKnowledgeMapDraft,
  validateDraft,
} from "../src/services/private-tutor-graph-extractor.mjs";
import {
  confirmAuthoredContentVersion,
  generateAuthoredContentVersion,
} from "../src/services/private-tutor-content-authoring.mjs";
import {
  activatePrivateTutorPackageRuntime,
  validatePrivateTutorPackageRuntime,
} from "../src/services/private-tutor-adaptive-runtime.mjs";

const unavailableOcr = {
  readiness: () => ({ state: "unavailable", providerId: null, reason: "test_local_ocr_unavailable" }),
};

function minimalPdf(text = "") {
  const escaped = text.replace(/[()\\]/g, "\\$&");
  const stream = text
    ? `BT\n/F1 18 Tf\n72 720 Td\n(${escaped}) Tj\n0 -28 Td\n(This chapter explains feedback and evidence for learning.) Tj\nET`
    : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, "ascii");
}

function pdfUpload(bytes, overrides = {}) {
  return {
    learningProfileId: "learner_pdf",
    fileName: "learning-systems.pdf",
    fileType: "pdf",
    fileContent: bytes.toString("base64"),
    fileEncoding: "base64",
    fileSize: bytes.length,
    now: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

test("parses a markdown document into a structured hierarchy of sections", () => {
  const markdownText = `# Introduction to Physics
This is the root intro.
## Chapter 1: Mechanics
Content of chapter 1.
### Section 1.1: Kinematics
Details about speed.
## Chapter 2: Thermodynamics
Content of chapter 2.
`;

  const doc = parseMaterialDocument({
    learningProfileId: "learner_123",
    fileName: "physics-notes.md",
    fileType: "markdown",
    fileContent: markdownText,
  });

  assert.equal(doc.learningProfileId, "learner_123");
  assert.equal(doc.fileName, "physics-notes.md");
  assert.equal(doc.fileType, "markdown");
  assert.equal(doc.status, "parsed");
  assert.ok(doc.sourceHash.length > 0);
  assert.equal(doc.sections.length, 4);

  assert.deepEqual(doc.sections[0], {
    id: "sec_1",
    title: "Introduction to Physics",
    level: 1,
    pageNumber: 1,
    lineStart: 1,
    lineEnd: 2,
    content: "This is the root intro.",
  });

  assert.deepEqual(doc.sections[1], {
    id: "sec_2",
    title: "Chapter 1: Mechanics",
    level: 2,
    pageNumber: 1,
    lineStart: 3,
    lineEnd: 4,
    content: "Content of chapter 1.",
  });

  assert.deepEqual(doc.sections[2], {
    id: "sec_3",
    title: "Section 1.1: Kinematics",
    level: 3,
    pageNumber: 1,
    lineStart: 5,
    lineEnd: 6,
    content: "Details about speed.",
  });

  assert.deepEqual(doc.sections[3], {
    id: "sec_4",
    title: "Chapter 2: Thermodynamics",
    level: 2,
    pageNumber: 1,
    lineStart: 7,
    lineEnd: 9,
    content: "Content of chapter 2.",
  });
});

test("parses plain text with Chinese chapter markers into sections", () => {
  const text = `第一章 绪论
这是第一章的内容。
第二章 概率论基础
这是第二章的内容。
第一节 基本概念
这是第一节的内容。
`;

  const doc = parseMaterialDocument({
    learningProfileId: "learner_123",
    fileName: "stats.txt",
    fileType: "plain_text",
    fileContent: text,
  });

  assert.equal(doc.fileType, "plain_text");
  assert.equal(doc.sections.length, 3);

  assert.equal(doc.sections[0].title, "第一章 绪论");
  assert.equal(doc.sections[0].level, 1);
  assert.equal(doc.sections[0].content, "这是第一章的内容。");

  assert.equal(doc.sections[1].title, "第二章 概率论基础");
  assert.equal(doc.sections[1].level, 1);

  assert.equal(doc.sections[2].title, "第一节 基本概念");
  assert.equal(doc.sections[2].level, 2);
  assert.equal(doc.sections[2].content, "这是第一节的内容。");
});

test("parses structured PDF text chunks preserving page numbers", () => {
  const pdfText = `--- Page 1 ---
# Chapter 1: Algebra
Basics of variables.
--- Page 2 ---
# Chapter 2: Geometry
Properties of shapes.
`;

  const doc = parseMaterialDocument({
    learningProfileId: "learner_123",
    fileName: "math-book.pdf",
    fileType: "pdf",
    fileContent: pdfText,
  });

  assert.equal(doc.fileType, "pdf");
  assert.equal(doc.sections.length, 2);

  assert.equal(doc.sections[0].title, "Chapter 1: Algebra");
  assert.equal(doc.sections[0].pageNumber, 1);
  assert.equal(doc.sections[0].content, "Basics of variables.");

  assert.equal(doc.sections[1].title, "Chapter 2: Geometry");
  assert.equal(doc.sections[1].pageNumber, 2);
  assert.equal(doc.sections[1].content, "Properties of shapes.");
});

test("recognizes textbook unit and lesson headings across PDF pages", () => {
  const sections = parsePdfTextSections(`--- Page 1 ---
第一单元 大数的认识
本单元学习大数。
--- Page 2 ---
第一课 亿以内数的认识
学习计数单位。
--- Page 3 ---
第二单元 公顷和平方千米
学习面积单位。`);
  assert.deepEqual(sections.map((section) => [section.title, section.level, section.pageNumber]), [
    ["第一单元 大数的认识", 1, 1],
    ["第一课 亿以内数的认识", 2, 2],
    ["第二单元 公顷和平方千米", 1, 3],
  ]);
});

test("aggregates numbered OCR textbook opener headings as sequential units", () => {
  const pageTexts = [
    "1 大数的认识\n1 亿以内数的认识\n学习计数单位和大数读写。",
    "2 解答下面的问题。\n练习题不能抢占第二单元编号。",
    "2 公顷和平方千米\n1 认识公顷\n边长100米的正方形面积是1公顷。",
  ];
  const sections = parsePdfTextSections(pageTexts.map((text, offset) => `--- Page ${offset + 1} ---\n${text}`).join("\n"));
  const materialDocument = {
    id: "mat_numbered_units",
    learningProfileId: "learner_pdf",
    fileName: "四年级数学上册.pdf",
    fileType: "pdf",
    sourceHash: "numbered-units-source",
    status: "parsed",
    pages: pageTexts.map((text, offset) => ({
      pageNumber: offset + 1,
      text,
      blocks: [
        { order: 1, type: "heading", text: text.split("\n")[0] },
        { order: 2, type: "heading", text: text.split("\n")[1] },
      ],
    })),
    sections,
    extraction: { parserVersion: 2, pageCount: 3 },
  };

  const draft = generateKnowledgeMapDraft({ materialDocument, packageName: "四年级数学上册", subjectId: "auto" });
  assert.equal(draft.aggregation.strategy, "textbook_units_v1");
  assert.equal(draft.aggregation.detectedUnitCount, 2);
  assert.deepEqual(draft.draftModules.map((module) => module.name), ["1 大数的认识", "2 公顷和平方千米"]);
  assert.equal(draft.evaluationSubjectId, "math");
});

test("extracts real PDF bytes page by page without persisting binary text", async () => {
  const bytes = minimalPdf("Chapter 1: Learning Systems");
  const doc = await parseUploadedMaterialDocument(pdfUpload(bytes), { ocrAdapter: unavailableOcr });

  assert.equal(doc.status, "parsed");
  assert.equal(doc.fileSize, bytes.length);
  assert.equal(doc.extraction.parserVersion, 2);
  assert.equal(doc.extraction.method, "pdf_text");
  assert.equal(doc.extraction.pageCount, 1);
  assert.equal(doc.extraction.needsOcr, false);
  assert.match(doc.pages[0].text, /Chapter 1: Learning Systems/);
  assert.doesNotMatch(doc.pages[0].text, /%PDF-|endstream|xref/);
  assert.equal("rawText" in doc, false);
  assert.equal(doc.sections[0].pageNumber, 1);
});

test("accepts private tutor PDF uploads above the former 10 MiB limit and caps them at 100 MiB", async () => {
  const bytes = Buffer.alloc(10 * 1024 * 1024 + 1);
  Buffer.from("%PDF-").copy(bytes);
  const doc = await parseUploadedMaterialDocument(pdfUpload(bytes), {
    ocrAdapter: unavailableOcr,
    extractPdf: async () => ({
      pages: [{ pageNumber: 1, text: "Chapter 1: Whole textbook material with enough meaningful content for parsing.", source: "pdf_text" }],
      pageCount: 1,
      warnings: [],
      truncated: false,
      truncatedPages: false,
    }),
  });

  assert.equal(doc.status, "parsed");
  assert.equal(doc.fileSize, bytes.length);
  assert.equal(PRIVATE_TUTOR_MATERIAL_MAX_FILE_BYTES, 100 * 1024 * 1024);

  await assert.rejects(
    () => parseUploadedMaterialDocument(pdfUpload(minimalPdf(), {
      fileSize: PRIVATE_TUTOR_MATERIAL_MAX_FILE_BYTES + 1,
    }), { ocrAdapter: unavailableOcr }),
    (error) => error.code === "file_size_exceeds_limit" && /100 MB/.test(error.message),
  );
});

test("parses the tracked Chinese textbook PDF with stable page sources", async () => {
  const bytes = readTrackedPdf("../../../docs/Loop-Engineering-IEEE-中文版-优化版.pdf");
  const doc = await parseUploadedMaterialDocument(pdfUpload(bytes, { fileName: "loop-engineering.pdf" }), { ocrAdapter: unavailableOcr });

  assert.equal(doc.status, "parsed");
  assert.equal(doc.extraction.pageCount, 16);
  assert.equal(doc.extraction.textPageCount, 16);
  assert.ok(doc.extraction.characterCount > 10_000);
  assert.match(doc.pages[0].text, /循环工程/);
  assert.equal(doc.pages.every((page) => page.pageNumber >= 1 && page.source === "pdf_text"), true);
  assert.equal(doc.pages.some((page) => /%PDF-|endstream|xref/.test(page.text)), false);
  const runtime = completeLearningRuntime(doc, "tracked-pdf");
  assert.equal(runtime.validation.status, "passed");
  assert.equal(runtime.activation.entryMode, "chapter");
  assert.equal(runtime.learningPlan.days.length, 7);
});

test("detects a tracked scanned PDF and degrades without generating binary sections", async () => {
  const bytes = readTrackedPdf("../../../demos/pdfcli/97-动态热机械分析仪DMA.pdf");
  const doc = await parseUploadedMaterialDocument(pdfUpload(bytes, { fileName: "scanned-manual.pdf" }), { ocrAdapter: unavailableOcr });

  assert.equal(doc.status, "needs_ocr");
  assert.equal(doc.extraction.pageCount, 6);
  assert.equal(doc.extraction.textPageCount, 0);
  assert.equal(doc.extraction.ocr.state, "unavailable");
  assert.equal(doc.extraction.ocr.reason, "test_local_ocr_unavailable");
  assert.deepEqual(doc.sections, []);
  assert.equal(doc.extraction.warnings.some((warning) => warning.code === "local_ocr_unavailable"), true);
});

test("uses an available local OCR adapter for a scanned PDF", async () => {
  const bytes = readTrackedPdf("../../../demos/pdfcli/97-动态热机械分析仪DMA.pdf");
  const doc = await parseUploadedMaterialDocument(pdfUpload(bytes), {
    ocrAdapter: {
      providerId: "test-local-ocr",
      readiness: () => ({ state: "ready", providerId: "test-local-ocr", reason: null }),
      recognizePdf: async ({ path }) => {
        assert.match(path, /source\.pdf$/);
        return {
          providerId: "test-local-ocr",
          pages: Array.from({ length: 6 }, (_, index) => ({
            index: index + 1,
            text: `Chapter ${index + 1}: OCR Learning\nEvidence, calibration, and practice guidance from scanned page ${index + 1}.`,
            confidence: 0.92,
          })),
        };
      },
    },
  });

  assert.equal(doc.status, "parsed");
  assert.equal(doc.pages[0].source, "local_ocr");
  assert.equal(doc.pages[0].confidence, 0.92);
  assert.equal(doc.extraction.method, "pdf_text_with_local_ocr");
  assert.equal(doc.extraction.ocr.state, "completed");
  assert.match(doc.sections[0].title, /OCR Learning/);
  const runtime = completeLearningRuntime(doc, "ocr-pdf");
  assert.equal(runtime.validation.status, "passed");
  assert.equal(runtime.activation.runtimeValidationId, runtime.validation.id);
});

function completeLearningRuntime(doc, suffix) {
  let sequence = 0;
  const nextId = (prefix) => `${prefix}_${suffix}_${++sequence}`;
  const now = () => "2026-08-27T06:00:00.000Z";
  const draft = generateKnowledgeMapDraft({
    materialDocument: doc,
    packageName: `Runtime ${suffix}`,
    subjectId: "general",
    domain: "uploaded_material",
  });
  const learner = { id: `learner_${suffix}`, ownerTeamId: "team_pdf", status: "active" };
  const state = {
    privateTutorMaterialDocuments: [doc],
    privateTutorKnowledgeMapDrafts: [draft],
    privateTutorContentPackages: [],
    privateTutorModules: [],
    privateTutorTopics: [],
    privateTutorKnowledgeComponents: [],
    privateTutorSubjectPlugins: [],
    privateTutorRuntimeValidations: [],
    privateTutorPackageActivations: [],
    privateTutorLearnerModels: [],
    privateTutorStrategyDecisions: [],
    privateTutorLearningPlans: [],
    privateTutorAssessments: [],
    privateTutorSessions: [],
    privateTutorSnapshots: [{ id: `snapshot_${suffix}`, learnerId: learner.id, revision: 1, knowledge: [] }],
  };
  confirmKnowledgeMapDraft(state, draft.id, {
    actorId: doc.learningProfileId,
    expectedRevision: draft.revision,
    acknowledgeSourceReview: true,
  });
  const content = generateAuthoredContentVersion(state, draft.id, { actorId: doc.learningProfileId });
  confirmAuthoredContentVersion(state, draft.id, {
    actorId: doc.learningProfileId,
    expectedRevision: content.revision,
    acknowledgeContentReview: true,
  });
  const packageId = publishKnowledgeMapDraft(state, draft.id, now());
  const pkg = state.privateTutorContentPackages.find((item) => item.id === packageId);
  const validation = validatePrivateTutorPackageRuntime(state, packageId, {
    actorId: doc.learningProfileId,
    learnerId: learner.id,
    now: now(),
    nextId,
  });
  const activated = activatePrivateTutorPackageRuntime(state, {
    learner,
    pkg,
    actorId: doc.learningProfileId,
    entryMode: "chapter",
    startModuleId: pkg.modules[0].id,
    now,
    nextId,
  });
  return { validation, ...activated };
}

test("rejects corrupted or text-decoded PDF uploads before persistence", async () => {
  const invalid = Buffer.from("%PDF-this-is-not-a-document", "utf8");
  await assert.rejects(
    () => parseUploadedMaterialDocument(pdfUpload(invalid), { ocrAdapter: unavailableOcr }),
    (error) => error.code === "invalid_pdf" || error.code === "pdf_parse_failed",
  );
  await assert.rejects(
    () => parseUploadedMaterialDocument({ ...pdfUpload(minimalPdf()), fileContent: "%PDF-1.4 raw text", fileEncoding: "utf8" }, { ocrAdapter: unavailableOcr }),
    (error) => error.code === "pdf_binary_required",
  );
});

function readTrackedPdf(relativeUrl) {
  return readFileSync(new URL(relativeUrl, import.meta.url));
}

test("falls back to a single root section when no headers are found", () => {
  const text = "This is just a bunch of notes\nwithout any explicit headers.";

  const doc = parseMaterialDocument({
    learningProfileId: "learner_123",
    fileName: "notes.txt",
    fileType: "plain_text",
    fileContent: text,
  });

  assert.equal(doc.sections.length, 1);
  assert.equal(doc.sections[0].title, "notes");
  assert.equal(doc.sections[0].content, text);
});

test("rejects unsupported or oversized files gracefully", () => {
  assert.throws(
    () => parseMaterialDocument({ learningProfileId: "l1", fileName: "test.exe", fileType: "binary", fileContent: "MZ" }),
    /unsupported_file_type/,
  );

  const largeContent = "a".repeat(501_000);
  assert.throws(
    () => parseMaterialDocument({ learningProfileId: "l1", fileName: "huge.md", fileType: "markdown", fileContent: largeContent }),
    /file_size_exceeds_limit/,
  );
});

test("generates a valid Knowledge Map Draft from a parsed markdown document", () => {
  const markdownText = `# Chapter 1: Basics
Intro to basics.
## Section 1.1: Variables
Learn about variables.
### Concept: Assignment
- 目标: Understand how to assign values.
- 问题: What is assignment?
`;

  const doc = parseMaterialDocument({
    learningProfileId: "learner_123",
    fileName: "programming.md",
    fileType: "markdown",
    fileContent: markdownText,
  });

  const draft = generateKnowledgeMapDraft({
    materialDocument: doc,
    packageName: "Programming Basics",
    subjectId: "computer_science",
    domain: "programming",
  });

  assert.equal(draft.packageName, "Programming Basics");
  assert.equal(draft.status, "in_review");
  assert.equal(draft.draftModules.length, 1);
  assert.equal(draft.draftTopics.length, 2);
  assert.equal(draft.schemaVersion, 2);
  assert.equal(draft.revision, 1);
  assert.equal(draft.confirmation, null);
  assert.equal(draft.draftKnowledgeComponents.length, 3);

  const kc = draft.draftKnowledgeComponents.find((item) => item.name === "Concept: Assignment");
  assert.ok(kc);
  assert.equal(kc.name, "Concept: Assignment");
  assert.deepEqual(kc.learningObjectives, ["Understand how to assign values."]);
  assert.equal(kc.candidateQuestions.length, 1);
  assert.equal(kc.candidateQuestions[0].prompt, "What is assignment?");
  assert.equal(kc.sourceRefs[0].sourceHash, doc.sourceHash);
  assert.equal(kc.sourceRefs[0].sectionId, "sec_3");
});

test("builds a non-empty page-grounded map from the tracked Chinese textbook", async () => {
  const bytes = readTrackedPdf("../../../docs/Loop-Engineering-IEEE-中文版-优化版.pdf");
  const doc = await parseUploadedMaterialDocument(pdfUpload(bytes, { fileName: "loop-engineering.pdf" }), { ocrAdapter: unavailableOcr });
  const draft = generateKnowledgeMapDraft({ materialDocument: doc, packageName: "循环工程学习地图" });

  assert.ok(doc.sections.some((section) => /^IV\./.test(section.title)));
  assert.ok(doc.sections.some((section) => /^A\./.test(section.title) && section.level === 2));
  assert.ok(draft.draftModules.length > 5);
  assert.ok(draft.draftTopics.length > 5);
  assert.ok(draft.draftKnowledgeComponents.length > 10);
  assert.equal(draft.draftKnowledgeComponents.every((item) => item.sourceRefs.length >= 1), true);
  assert.equal(draft.draftKnowledgeComponents.every((item) => item.sourceRefs.every((ref) => ref.pageNumber >= 1)), true);
  assert.equal(draft.validationIssues.some((issue) => issue.severity === "error"), false);
});

test("requires explicit source confirmation and invalidates it after every edit", () => {
  const doc = parseMaterialDocument({
    learningProfileId: "learner_confirm",
    fileName: "confirm.md",
    fileType: "markdown",
    fileContent: "# Module\n## Topic\n### Evidence\nGrounded source content.",
  });
  const draft = generateKnowledgeMapDraft({ materialDocument: doc, packageName: "Confirm Package" });
  const state = {
    privateTutorMaterialDocuments: [doc],
    privateTutorKnowledgeMapDrafts: [draft],
    privateTutorContentPackages: [],
    privateTutorModules: [],
    privateTutorTopics: [],
    privateTutorKnowledgeComponents: [],
  };

  assert.throws(() => publishKnowledgeMapDraft(state, draft.id), /draft_confirmation_required/);
  assert.throws(() => confirmKnowledgeMapDraft(state, draft.id, {
    actorId: "usr_confirm",
    expectedRevision: 99,
    acknowledgeSourceReview: true,
  }), /draft_revision_conflict/);

  const confirmed = confirmKnowledgeMapDraft(state, draft.id, {
    actorId: "usr_confirm",
    expectedRevision: draft.revision,
    acknowledgeSourceReview: true,
    now: "2026-08-27T01:00:00.000Z",
  });
  assert.equal(confirmed.confirmation.fingerprint, knowledgeMapDraftFingerprint(confirmed));
  assert.equal(confirmed.status, "confirmed");

  const updated = updateKnowledgeMapDraft(state, draft.id, { packageName: "Edited Package" }, "2026-08-27T01:01:00.000Z");
  assert.equal(updated.revision, 2);
  assert.equal(updated.confirmation, null);
  assert.equal(updated.status, "in_review");
  assert.throws(() => publishKnowledgeMapDraft(state, draft.id), /draft_confirmation_required/);
});

test("blocks empty, binary, and unknown-source knowledge maps from confirmation", () => {
  const doc = parseMaterialDocument({
    learningProfileId: "learner_invalid",
    fileName: "invalid.md",
    fileType: "markdown",
    fileContent: "# Module\n## Topic\n### Evidence\nGrounded source content.",
  });
  const draft = generateKnowledgeMapDraft({ materialDocument: doc, packageName: "Invalid Package" });
  const state = { privateTutorMaterialDocuments: [doc], privateTutorKnowledgeMapDrafts: [draft] };
  const validKnowledge = structuredClone(draft.draftKnowledgeComponents);

  const withoutSource = structuredClone(draft.draftKnowledgeComponents);
  withoutSource[0].sourceRef = undefined;
  withoutSource[0].sourceRefs = [];
  withoutSource[0].shortDescription = "%PDF-1.4 endstream xref";
  updateKnowledgeMapDraft(state, draft.id, { draftKnowledgeComponents: withoutSource });
  assert.equal(draft.validationIssues.some((issue) => issue.type === "missing_source_reference"), true);
  assert.equal(draft.validationIssues.some((issue) => issue.type === "binary_text_detected"), true);
  assert.throws(() => confirmKnowledgeMapDraft(state, draft.id, {
    actorId: "usr_invalid",
    expectedRevision: draft.revision,
    acknowledgeSourceReview: true,
  }), /draft_has_validation_errors/);

  const tamperedModules = structuredClone(draft.draftModules);
  tamperedModules[0].sourceRef.excerpt = "This sentence was never in the uploaded material.";
  updateKnowledgeMapDraft(state, draft.id, {
    draftModules: tamperedModules,
    draftKnowledgeComponents: validKnowledge,
  });
  assert.equal(draft.validationIssues.some((issue) => issue.type === "invalid_source_excerpt"), true);

  updateKnowledgeMapDraft(state, draft.id, { draftKnowledgeComponents: [] });
  assert.equal(draft.validationIssues.some((issue) => issue.type === "empty_knowledge_map"), true);
});

test("publishes a draft into a standard LearningContentPackage and registers it in state", () => {
  const markdownText = `# Module 1
## Topic 1
### KC 1
Content of KC 1.
### KC 2
Content of KC 2.
`;

  const doc = parseMaterialDocument({
    learningProfileId: "learner_123",
    fileName: "test.md",
    fileType: "markdown",
    fileContent: markdownText,
  });

  const draft = generateKnowledgeMapDraft({
    materialDocument: doc,
    packageName: "Test Package",
    subjectId: "general",
    domain: "general",
  });

  // Simulate state
  const state = {
    privateTutorKnowledgeMapDrafts: [draft],
    privateTutorMaterialDocuments: [doc],
    privateTutorContentPackages: [],
    privateTutorModules: [],
    privateTutorTopics: [],
    privateTutorKnowledgeComponents: [],
  };

  const confirmed = confirmKnowledgeMapDraft(state, draft.id, {
    actorId: "usr_learner",
    expectedRevision: draft.revision,
    acknowledgeSourceReview: true,
  });
  assert.equal(confirmed.status, "confirmed");

  const authored = generateAuthoredContentVersion(state, draft.id, { actorId: "usr_learner" });
  confirmAuthoredContentVersion(state, draft.id, {
    actorId: "usr_learner",
    expectedRevision: authored.revision,
    acknowledgeContentReview: true,
  });

  const packageId = publishKnowledgeMapDraft(state, draft.id);

  assert.ok(packageId.startsWith("pkg-user-"));
  assert.equal(state.privateTutorContentPackages.length, 1);
  assert.equal(state.privateTutorContentPackages[0].sourceType, "user_material");
  assert.equal(state.privateTutorContentPackages[0].evaluationCapabilities.deterministicGrading, false);
  assert.equal(state.privateTutorContentPackages[0].evaluationCapabilities.semanticEvaluation, "source_grounded_rubric");
  assert.equal(state.privateTutorContentPackages[0].evaluationCapabilities.sourceGrounding, true);
  assert.equal(state.privateTutorContentPackages[0].source.sourceHash, doc.sourceHash);

  assert.equal(state.privateTutorModules.length, 1);
  assert.equal(state.privateTutorTopics.length, 1);
  assert.equal(state.privateTutorKnowledgeComponents.length, 2);

  const updatedDraft = state.privateTutorKnowledgeMapDrafts[0];
  assert.equal(updatedDraft.status, "published");
  assert.equal(updatedDraft.publishedPackageId, packageId);
});

test("detects validation errors and prevents publishing a draft with cycles", () => {
  const markdownText = `# Mod 1
## Top 1
### KC A
### KC B
`;
  const doc = parseMaterialDocument({
    learningProfileId: "learner_123",
    fileName: "cycle.md",
    fileType: "markdown",
    fileContent: markdownText,
  });

  const draft = generateKnowledgeMapDraft({
    materialDocument: doc,
    packageName: "Cycle Package",
    subjectId: "general",
    domain: "general",
  });

  // Introduce a cycle manually: KC B depends on KC A, and KC A depends on KC B
  draft.draftKnowledgeComponents[0].prerequisiteDraftIds = [draft.draftKnowledgeComponents[1].id];
  draft.draftKnowledgeComponents[1].prerequisiteDraftIds = [draft.draftKnowledgeComponents[0].id];

  // Re-validate
  draft.validationIssues = validateDraft(draft.draftKnowledgeComponents);

  assert.ok(draft.validationIssues.some((issue) => issue.type === "cycle"));

  const state = {
    privateTutorKnowledgeMapDrafts: [draft],
    privateTutorMaterialDocuments: [doc],
    privateTutorContentPackages: [],
    privateTutorModules: [],
    privateTutorTopics: [],
    privateTutorKnowledgeComponents: [],
  };

  assert.throws(() => publishKnowledgeMapDraft(state, draft.id), /draft_has_validation_errors/);
});
