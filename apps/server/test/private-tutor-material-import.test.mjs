import assert from "node:assert/strict";
import test from "node:test";
import {
  parseMaterialDocument,
  parseMarkdownSections,
  parsePdfTextSections,
  parsePlainTextSections,
} from "../src/services/private-tutor-material-parser.mjs";
import {
  generateKnowledgeMapDraft,
  publishKnowledgeMapDraft,
  validateDraft,
} from "../src/services/private-tutor-graph-extractor.mjs";

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
