import assert from "node:assert/strict";
import test from "node:test";
import { createPrivateTutorPackageRegistry } from "../src/services/private-tutor-package-registry.mjs";
import { mathSubjectPlugin } from "../src/services/plugins/math-plugin.mjs";
import { GRADE_4_MATH_UPPER_PACKAGE_ID } from "../src/services/packages/grade-4-math-upper-2022-standard.mjs";
import { GRADE_8_MATH_UPPER_PACKAGE_ID } from "../src/services/packages/grade-8-math-upper-2022-standard.mjs";

const PACKAGE_CASES = [
  { id: GRADE_4_MATH_UPPER_PACKAGE_ID, grade: 4, knowledgeCount: 8, moduleCount: 2 },
  { id: GRADE_8_MATH_UPPER_PACKAGE_ID, grade: 8, knowledgeCount: 8, moduleCount: 3 },
];

test("built-in school math curricula are original, versioned, and complete", () => {
  const registry = createPrivateTutorPackageRegistry();
  const allQuestionIds = new Set();
  for (const expected of PACKAGE_CASES) {
    const pkg = registry.getPackage(expected.id);
    assert.ok(pkg);
    assert.equal(pkg.sourceType, "curriculum");
    assert.equal(pkg.curriculumStandardVersion, "2022");
    assert.equal(pkg.grade, expected.grade);
    assert.equal(pkg.semester, "upper");
    assert.equal(pkg.rightsStatus, "original");
    assert.equal(pkg.officialPublisherProduct, false);
    assert.equal(pkg.publisherAlignment.status, "none");
    assert.match(pkg.contentNotice, /非出版社官方教材/);
    assert.doesNotMatch(JSON.stringify(pkg), /download\.pep|教材第\d+页|官方电子版/);
    assert.equal(pkg.modules.length, expected.moduleCount);
    assert.equal(pkg.knowledgeComponents.length, expected.knowledgeCount);

    const graph = registry.knowledgeGraph(expected.id);
    assert.equal(graph.knowledge.length, expected.knowledgeCount);
    const knowledgeIds = new Set(graph.knowledge.map((item) => item.id));
    assert.equal(knowledgeIds.size, expected.knowledgeCount);
    const moduleKnowledgeIds = pkg.modules.flatMap((module) => module.topics.flatMap((topic) => topic.knowledgeComponentIds));
    assert.equal(new Set(moduleKnowledgeIds).size, expected.knowledgeCount);
    assert.deepEqual(new Set(moduleKnowledgeIds), knowledgeIds);
    for (const knowledge of pkg.knowledgeComponents) {
      assert.equal(knowledge.prerequisiteKnowledgeIds.every((id) => knowledgeIds.has(id)), true);
      assert.ok(knowledge.learningObjectives.length >= 2);
      assert.ok(knowledge.misconceptions.length >= 1);
      assert.ok(knowledge.diagnosticQuestions.length >= 2);
      assert.ok(knowledge.dailyQuestions.length >= 1);
      assert.ok(knowledge.tutoringQuestions.length >= 3);
      assert.ok(knowledge.reviewQuestions.length >= 2);
      for (const key of ["diagnosticQuestions", "dailyQuestions", "tutoringQuestions", "reviewQuestions"]) {
        for (const question of knowledge[key]) {
          assert.equal(question.knowledgeId, knowledge.id);
          assert.equal(allQuestionIds.has(question.id), false, `duplicate question id: ${question.id}`);
          allQuestionIds.add(question.id);
        }
      }
    }
  }
});

test("every original curriculum question accepts its author-reviewed answer", () => {
  const registry = createPrivateTutorPackageRegistry();
  for (const { id } of PACKAGE_CASES) {
    const pkg = registry.getPackage(id);
    for (const knowledge of pkg.knowledgeComponents) {
      for (const key of ["diagnosticQuestions", "dailyQuestions", "tutoringQuestions", "reviewQuestions"]) {
        for (const question of knowledge[key]) {
          const rawAnswer = question.kind === "choice" ? question.expectedChoice : question.expectedAnswer;
          const result = mathSubjectPlugin.evaluator({ rawAnswer, responseKind: "answer" }, question);
          assert.equal(result.accepted, true, question.id);
          assert.equal(result.correct, true, question.id);
        }
      }
    }
  }
});

test("representative Grade 4 and Grade 8 questions grade deterministically", () => {
  const registry = createPrivateTutorPackageRegistry();
  const grade4 = registry.getPackage(GRADE_4_MATH_UPPER_PACKAGE_ID);
  const multiplication = grade4.knowledgeComponents.find((item) => item.id === "g4-multiply-multidigit").dailyQuestions[0];
  assert.equal(mathSubjectPlugin.evaluator({ rawAnswer: "7344" }, multiplication).correct, true);
  assert.equal(mathSubjectPlugin.evaluator({ rawAnswer: "7443" }, multiplication).correct, false);

  const grade8 = registry.getPackage(GRADE_8_MATH_UPPER_PACKAGE_ID);
  const equation = grade8.knowledgeComponents.find((item) => item.id === "g8-equation-bridge").dailyQuestions[0];
  assert.equal(mathSubjectPlugin.evaluator({ rawAnswer: "x=6" }, equation).correct, true);
  const factorization = grade8.knowledgeComponents.find((item) => item.id === "g8-factorization").dailyQuestions[0];
  assert.equal(mathSubjectPlugin.evaluator({ rawAnswer: "a" }, factorization).correct, true);
});
