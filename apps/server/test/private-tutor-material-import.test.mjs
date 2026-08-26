import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  parseMaterialDocument,
  parseUploadedMaterialDocument,
  parseMarkdownSections,
  parsePdfTextSections,
  parsePlainTextSections,
} from "../src/services/private-tutor-material-parser.mjs";
import {
  generateKnowledgeMapDraft,
  publishKnowledgeMapDraft,
  validateDraft,
} from "../src/services/private-tutor-graph-extractor.mjs";

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
  const bytes = minimalPdf();
  const doc = await parseUploadedMaterialDocument(pdfUpload(bytes), {
    ocrAdapter: {
      providerId: "test-local-ocr",
      readiness: () => ({ state: "ready", providerId: "test-local-ocr", reason: null }),
      recognizePdf: async ({ path }) => {
        assert.match(path, /source\.pdf$/);
        return {
          providerId: "test-local-ocr",
          pages: [{ index: 1, text: "Chapter 1: OCR Learning\nEvidence from the scanned page.", confidence: 0.92 }],
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
});

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
  assert.equal(draft.draftTopics.length, 1);
  assert.equal(draft.draftKnowledgeComponents.length, 1);

  const kc = draft.draftKnowledgeComponents[0];
  assert.equal(kc.name, "Concept: Assignment");
  assert.deepEqual(kc.learningObjectives, ["Understand how to assign values."]);
  assert.equal(kc.candidateQuestions.length, 1);
  assert.equal(kc.candidateQuestions[0].prompt, "What is assignment?");
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
    privateTutorContentPackages: [],
    privateTutorModules: [],
    privateTutorTopics: [],
    privateTutorKnowledgeComponents: [],
  };

  const packageId = publishKnowledgeMapDraft(state, draft.id);

  assert.ok(packageId.startsWith("pkg-user-"));
  assert.equal(state.privateTutorContentPackages.length, 1);
  assert.equal(state.privateTutorContentPackages[0].sourceType, "user_material");
  assert.equal(state.privateTutorContentPackages[0].evaluationCapabilities.deterministicGrading, false);
  assert.equal(state.privateTutorContentPackages[0].evaluationCapabilities.semanticEvaluation, true);

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
    privateTutorContentPackages: [],
    privateTutorModules: [],
    privateTutorTopics: [],
    privateTutorKnowledgeComponents: [],
  };

  assert.throws(() => publishKnowledgeMapDraft(state, draft.id), /draft_has_validation_errors/);
});
