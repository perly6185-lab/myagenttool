import assert from "node:assert/strict";
import test from "node:test";
import {
  createPrivateTutorPackageRegistry,
  privateTutorPackageRegistryFromState,
  seedPrivateTutorContentPackages,
} from "../src/services/private-tutor-package-registry.mjs";
import { mathSubjectPlugin } from "../src/services/plugins/math-plugin.mjs";
import { computerScienceSubjectPlugin } from "../src/services/plugins/computer-science-plugin.mjs";
import { languageSubjectPlugin } from "../src/services/plugins/language-plugin.mjs";
import { programmingSubjectPlugin } from "../src/services/plugins/programming-plugin.mjs";
import { conceptualSubjectPlugin } from "../src/services/plugins/conceptual-plugin.mjs";
import { judgePrivateTutorAnswer } from "../src/services/private-tutor-assessment.mjs";
import { DEMO_MATH_FOUNDATIONS_PACKAGE_ID } from "../src/services/packages/demo-math-foundations.mjs";
import { CS_LOGIC_FOUNDATIONS_PACKAGE_ID } from "../src/services/packages/cs-logic-foundations.mjs";

test("content package registry initializes all built-in M5 subject packages", () => {
  const registry = createPrivateTutorPackageRegistry();
  const packages = registry.listPackages();
  assert.equal(packages.length, 5);
  const mathSummary = packages.find((p) => p.id === DEMO_MATH_FOUNDATIONS_PACKAGE_ID);
  assert.ok(mathSummary);
  assert.equal(mathSummary.subjectId, "math");
  assert.equal(mathSummary.sourceType, "textbook");
  assert.equal(mathSummary.evaluationCapabilities.deterministicGrading, true);

  const csSummary = packages.find((p) => p.id === CS_LOGIC_FOUNDATIONS_PACKAGE_ID);
  assert.ok(csSummary);
  assert.equal(csSummary.subjectId, "computer_science");
  assert.equal(csSummary.domain, "computer_science");
  assert.equal(csSummary.sourceType, "university_course");

  const pkg = registry.getPackage(DEMO_MATH_FOUNDATIONS_PACKAGE_ID);
  assert.ok(pkg);
  assert.equal(pkg.modules.length, 1);
  assert.equal(pkg.knowledgeComponents.length, 4);

  const graph = registry.knowledgeGraph(DEMO_MATH_FOUNDATIONS_PACKAGE_ID);
  assert.ok(graph);
  assert.deepEqual(graph.knowledge.map((k) => k.id), ["integer", "equation-meaning", "balance", "word-problem"]);
  assert.equal(graph.edges.length, 3);

  const csGraph = registry.knowledgeGraph(CS_LOGIC_FOUNDATIONS_PACKAGE_ID);
  assert.ok(csGraph);
  assert.deepEqual(csGraph.knowledge.map((k) => k.id), ["proposition", "logic-connectives"]);
});

test("M6 advanced evaluators expose explainable results and conservative evidence gates", () => {
  const registry = createPrivateTutorPackageRegistry();
  const mathQuestion = registry.getPackage(DEMO_MATH_FOUNDATIONS_PACKAGE_ID).knowledgeComponents
    .find((item) => item.id === "balance").dailyQuestions.find((item) => item.kind === "math_steps");
  const math = mathSubjectPlugin.evaluator({ rawAnswer: "x + 3 - 3 = 8 - 3\nx = 5", responseKind: "answer" }, mathQuestion);
  assert.equal(math.correct, true);
  assert.equal(math.evaluation.passedCount, 2);
  assert.equal(math.evidenceTier, "deterministic_math_steps_v2");

  const languageQuestion = registry.getPackage("language-causal-explanations-v1").knowledgeComponents[0].dailyQuestions[0];
  const language = languageSubjectPlugin.evaluator({ rawAnswer: "Plants grow because sunlight supplies energy.", responseKind: "answer", source: "screen" }, languageQuestion);
  assert.equal(language.correct, true);
  assert.equal(language.evidenceEligible, true);
  const lowConfidenceSpeech = languageSubjectPlugin.evaluator({ rawAnswer: "Plants grow because sunlight supplies energy.", responseKind: "answer", source: "voice_confirmed", recognitionConfidence: 0.8 }, languageQuestion);
  assert.equal(lowConfidenceSpeech.evidenceEligible, false);
  assert.equal(lowConfidenceSpeech.evaluation.requiresReview, true);

  const codeQuestion = registry.getPackage("programming-functions-v1").knowledgeComponents[0].dailyQuestions[0];
  const code = programmingSubjectPlugin.evaluator({ rawAnswer: "function double(n) { return n * 2; }", responseKind: "answer" }, codeQuestion);
  assert.equal(code.correct, true);
  assert.equal(code.evaluation.passedCount, 3);
  assert.deepEqual(
    programmingSubjectPlugin.evaluator({ rawAnswer: "return process.exit();", responseKind: "answer" }, codeQuestion),
    { accepted: false, error: "private_tutor_code_sandbox_rejected" },
  );

  const conceptQuestion = registry.getPackage("conceptual-source-reasoning-v1").knowledgeComponents[0].dailyQuestions[0];
  const concept = conceptualSubjectPlugin.evaluator({ rawAnswer: "[ref:chapter-1] 形成性反馈可以发现差距并及时纠正，从而调整学习策略。", responseKind: "answer" }, conceptQuestion);
  assert.equal(concept.correct, true);
  assert.equal(concept.evaluation.missingSourceRefs.length, 0);
  const missingCitation = conceptualSubjectPlugin.evaluator({ rawAnswer: "形成性反馈可以发现差距并及时纠正，从而调整学习策略。", responseKind: "answer" }, conceptQuestion);
  assert.equal(missingCitation.evidenceEligible, false);
  assert.deepEqual(missingCitation.evaluation.missingSourceRefs, ["chapter-1"]);
});

test("computer-science plugin grades supported choices and fails closed for unsupported answers", () => {
  const question = {
    kind: "choice",
    options: [{ id: "a", label: "True" }, { id: "b", label: "False" }],
    expectedChoice: "a",
  };
  assert.equal(computerScienceSubjectPlugin.evaluator({ rawAnswer: "A" }, question).correct, true);
  assert.deepEqual(
    computerScienceSubjectPlugin.evaluator({ rawAnswer: "true" }, question),
    { accepted: false, error: "invalid_private_tutor_answer_format" },
  );
  assert.deepEqual(
    computerScienceSubjectPlugin.evaluator({ rawAnswer: "print(true)" }, { kind: "code" }),
    { accepted: false, error: "private_tutor_question_kind_unsupported" },
  );
});

test("a throwing subject plugin fails closed before an answer can become mastery evidence", () => {
  const state = {};
  seedPrivateTutorContentPackages(state, "2026-08-25T00:00:00.000Z");
  state.privateTutorContentPackages.push({
    id: "unstable-subject-package-v1",
    name: "Unstable subject fixture",
    subjectId: "unstable_subject",
    domain: "testing",
    sourceType: "professional_skill",
    version: "1.0.0",
    license: "internal-test",
    targetAudience: {},
    evaluationCapabilities: { deterministicGrading: true },
    modules: [],
    knowledgeComponents: [{
      id: "unstable-kc",
      name: "Unstable knowledge",
      prerequisiteKnowledgeIds: [],
      dailyQuestions: [{
        id: "unstable-question-v1",
        questionId: "unstable-question",
        knowledgeId: "unstable-kc",
        difficulty: 1,
        kind: "choice",
        prompt: "This evaluator throws",
        options: [{ id: "a", label: "A" }],
        expectedChoice: "a",
      }],
    }],
  });
  state.privateTutorSubjectPlugins.push({
    subjectId: "unstable_subject",
    version: "1.0.0",
    visualTemplates: [],
    getCapabilities: () => ({ deterministicGrading: true }),
    evaluator: () => { throw new Error("simulated plugin failure"); },
  });

  assert.deepEqual(
    judgePrivateTutorAnswer(
      "unstable-question-v1",
      { rawAnswer: "a", responseKind: "answer" },
      state,
      "unstable-subject-package-v1",
    ),
    { accepted: false, error: "private_tutor_subject_plugin_failed" },
  );
});

test("math subject plugin evaluates rational expressions and multiple choice deterministically", () => {
  const math = mathSubjectPlugin;
  assert.equal(math.subjectId, "math");
  assert.equal(math.getCapabilities().deterministicGrading, true);

  // Choice question grading
  const choiceQ = {
    kind: "choice",
    options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    expectedChoice: "b",
  };
  const choiceRes = math.evaluator({ rawAnswer: "b", responseKind: "answer" }, choiceQ);
  assert.equal(choiceRes.accepted, true);
  assert.equal(choiceRes.correct, true);

  // Numeric rational evaluation with variable assignment
  const numericQ = {
    kind: "numeric",
    expectedRational: { numerator: 5n, denominator: 1n },
    allowVariableAssignment: true,
  };
  const numRes = math.evaluator({ rawAnswer: "x = 10 / 2", responseKind: "answer" }, numericQ);
  assert.equal(numRes.accepted, true);
  assert.equal(numRes.correct, true);
  assert.equal(numRes.normalizedAnswer, "5");
});

test("seedPrivateTutorContentPackages populates state idempotently", () => {
  const state = {};
  const at = "2026-08-25T00:00:00.000Z";
  assert.equal(seedPrivateTutorContentPackages(state, at), true);
  assert.equal(state.privateTutorContentPackages.length, 5);
  assert.equal(state.privateTutorKnowledgeComponents.length, 9);
  assert.equal(state.privateTutorSubjectPlugins.length, 5);
  assert.equal(seedPrivateTutorContentPackages(state, at), false, "second seed call must be idempotent");

  const registry = privateTutorPackageRegistryFromState(state);
  const pkg = registry.getPackage(DEMO_MATH_FOUNDATIONS_PACKAGE_ID);
  assert.equal(pkg.name, "初中数学基础：一元一次方程");
  const csPkg = registry.getPackage(CS_LOGIC_FOUNDATIONS_PACKAGE_ID);
  assert.equal(csPkg.name, "计算机科学：数理逻辑与布尔代数基础");
});
