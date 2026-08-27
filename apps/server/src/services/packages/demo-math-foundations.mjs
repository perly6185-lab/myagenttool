import { parseRationalAnswer, rationalToJSON } from "../plugins/math-plugin.mjs";

function numericQuestion(id, knowledgeId, difficulty, prompt, expected, options = {}) {
  const rational = parseRationalAnswer(expected);
  return {
    id,
    questionId: questionIdFromRevisionId(id),
    knowledgeId,
    difficulty,
    prompt,
    kind: "numeric",
    expectedAnswer: expected,
    expectedRational: rationalToJSON(rational),
    ...options,
  };
}

function choiceQuestion(id, knowledgeId, difficulty, prompt, options, expectedChoice) {
  return {
    id,
    questionId: questionIdFromRevisionId(id),
    knowledgeId,
    difficulty,
    prompt,
    kind: "choice",
    options,
    expectedChoice,
  };
}

function questionIdFromRevisionId(revisionId) {
  return revisionId.replace(/-v\d+$/, "");
}

export const DEMO_MATH_FOUNDATIONS_PACKAGE_ID = "demo-math-foundations-v1";

export const demoMathFoundationsPackage = Object.freeze({
  id: DEMO_MATH_FOUNDATIONS_PACKAGE_ID,
  name: "初中数学基础：一元一次方程",
  subjectId: "math",
  domain: "math",
  sourceType: "textbook",
  version: "1.0.0",
  license: "CC-BY-4.0",
  targetAudience: {
    stage: "grade-7",
    description: "适合初中七年级或需要补稳一元一次方程基础的学习者",
    prerequisites: ["小学四则运算基础"],
  },
  evaluationCapabilities: {
    deterministicGrading: true,
    stepEvaluation: true,
    stepEvaluationProfile: "linear-equation-v2",
    speechEvaluation: false,
    visualInteractions: true,
  },
  modules: [
    {
      id: "mod-equations",
      name: "一元一次方程与等式性质",
      description: "掌握正负数运算、等式平衡模型及简单一元一次方程应用题建模。",
      orderIndex: 1,
      topics: [
        {
          id: "top-foundations",
          name: "运算与方程基础",
          description: "从有理数四则运算到含未知数的等式概念建立。",
          orderIndex: 1,
          knowledgeComponentIds: ["integer", "equation-meaning"],
        },
        {
          id: "top-balance-and-apps",
          name: "等式性质与应用",
          description: "利用天平平衡模型解方程并建立文字题建模能力。",
          orderIndex: 2,
          knowledgeComponentIds: ["balance", "word-problem"],
        },
      ],
    },
  ],
  knowledgeComponents: [
    {
      id: "integer",
      name: "有理数运算",
      shortDescription: "正负数加减运算与数轴方向距离",
      topicId: "top-foundations",
      orderIndex: 1,
      prerequisiteKnowledgeIds: [],
      downstreamImpact: 4,
      learningObjectives: [
        "能利用数轴理解正负数的方向与距离",
        "熟练掌握有理数减法（减去负数相当于加上正数）",
      ],
      misconceptions: [
        { id: "negative_subtraction", label: "减去负数时符号关系未站稳", recommendedStrategy: "prerequisite_repair" },
      ],
      teachingContent: {
        questionPrefix: "int",
        coreConcept: "先在数轴上看方向，再把符号和距离分开。",
        keyPoints: [
          "先找到起点，再看向左还是向右。",
          "减去一个负数，可以想成向相反方向移动。",
          "把移动后的落点写成答案。",
        ],
      },
      diagnosticQuestions: [
        numericQuestion("diag-int-01-v1", "integer", 1, "6 - 9 = ?", "-3"),
        numericQuestion("diag-int-02-v1", "integer", 2, "-4 + 7 = ?", "3"),
        numericQuestion("diag-int-03-v1", "integer", 3, "8 - (-5) = ?", "13"),
      ],
      tutoringQuestions: [
        numericQuestion("tutor-int-recall-001-v1", "integer", 1, "4 - 7 = ?", "-3"),
        numericQuestion("tutor-int-guided-001-v1", "integer", 2, "-5 + 9 = ?", "4"),
        numericQuestion("tutor-int-transfer-001-v1", "integer", 3, "12 - (-4) = ?", "16"),
      ],
      reviewQuestions: [
        numericQuestion("review-int-similar-001-v1", "integer", 2, "-3 + 8 = ?", "5"),
        numericQuestion("review-int-variation-001-v1", "integer", 3, "15 - (-6) = ?", "21"),
      ],
    },
    {
      id: "equation-meaning",
      name: "等式与方程",
      shortDescription: "等式的概念与含未知数方程的辨析",
      topicId: "top-foundations",
      orderIndex: 2,
      prerequisiteKnowledgeIds: ["integer"],
      downstreamImpact: 3,
      learningObjectives: [
        "能区分普通等式与含有未知数的方程",
        "理解使方程左右两边相等的未知数的值",
      ],
      misconceptions: [
        { id: "equation_definition", label: "还没有区分等式和含未知数的方程", recommendedStrategy: "concept_rebuild" },
        { id: "variable_isolation", label: "还不清楚怎样让未知数单独留下", recommendedStrategy: "concept_rebuild" },
      ],
      teachingContent: {
        questionPrefix: "eqm",
        coreConcept: "先认出未知数和相等关系，再决定怎样让未知数单独留下。",
        keyPoints: [
          "先找等号两边分别是什么。",
          "想一想要去掉未知数旁边的哪个数。",
          "等式两边做同样的运算。",
        ],
      },
      diagnosticQuestions: [
        choiceQuestion("diag-eqm-01-v1", "equation-meaning", 1, "下面哪一个是方程？", [
          { id: "a", label: "3 + 5 = 8" },
          { id: "b", label: "x + 3 = 8" },
          { id: "c", label: "7 > 4" },
        ], "b"),
        numericQuestion("diag-eqm-02-v1", "equation-meaning", 2, "x + 4 = 9，x 是多少？", "5", { allowVariableAssignment: true }),
        numericQuestion("diag-eqm-03-v1", "equation-meaning", 3, "3x = 12，x 是多少？", "4", { allowVariableAssignment: true }),
      ],
      tutoringQuestions: [
        choiceQuestion("tutor-eqm-recall-001-v1", "equation-meaning", 1, "下面哪一个含有未知数并且是等式？", [
          { id: "a", label: "6 + 2 = 8" },
          { id: "b", label: "x + 2 = 8" },
          { id: "c", label: "9 > 3" },
        ], "b"),
        numericQuestion("tutor-eqm-guided-001-v1", "equation-meaning", 2, "x + 6 = 11，x 是多少？", "5", { allowVariableAssignment: true }),
        numericQuestion("tutor-eqm-transfer-001-v1", "equation-meaning", 3, "4x = 28，x 是多少？", "7", { allowVariableAssignment: true }),
      ],
      reviewQuestions: [
        choiceQuestion("review-eqm-similar-001-v1", "equation-meaning", 2, "下面哪一个是含未知数的等式？", [
          { id: "a", label: "4 + 5 = 9" },
          { id: "b", label: "y - 2 = 6" },
          { id: "c", label: "10 > 7" },
        ], "b"),
        numericQuestion("review-eqm-variation-001-v1", "equation-meaning", 3, "3y = 24，y 是多少？", "8", { allowVariableAssignment: true }),
      ],
    },
    {
      id: "balance",
      name: "等式两边同乘同除",
      shortDescription: "天平平衡模型与等式两边同加减同乘除的性质",
      topicId: "top-balance-and-apps",
      orderIndex: 3,
      prerequisiteKnowledgeIds: ["equation-meaning"],
      downstreamImpact: 5,
      learningObjectives: [
        "掌握等式两边同时加减相同数保持平衡的性质",
        "掌握等式两边同时乘除相同非零数解方程的方法",
      ],
      misconceptions: [
        { id: "single_side_change", label: "只改变了等式一边", recommendedStrategy: "concept_rebuild" },
        { id: "division_fluency", label: "等式变形正确，但除法结果不稳定", recommendedStrategy: "fluency_practice" },
      ],
      teachingContent: {
        questionPrefix: "bal",
        coreConcept: "把方程想成平衡的天平，两边始终做同样的事情。",
        keyPoints: [
          "先看未知数旁边多了什么。",
          "在等式两边同时去掉相同的部分。",
          "检查代回原方程后两边是否一样。",
        ],
      },
      diagnosticQuestions: [
        choiceQuestion("diag-bal-01-v1", "balance", 1, "x + 3 = 8。为了保持等式平衡，下一步应该怎么做？", [
          { id: "a", label: "只把左边减 3" },
          { id: "b", label: "两边同时减 3" },
          { id: "c", label: "两边同时加 3" },
        ], "b"),
        numericQuestion("diag-bal-02-v1", "balance", 2, "2x = 10，x 是多少？", "5", { allowVariableAssignment: true }),
        numericQuestion("diag-bal-03-v1", "balance", 3, "2(x + 1) = 8，x 是多少？", "3", { allowVariableAssignment: true }),
      ],
      dailyQuestions: [
        numericQuestion("demo-balance-001-v1", "balance", 2, "x + 3 = 8，x 是多少？", "5", { allowVariableAssignment: true }),
        {
          id: "practice-balance-steps-001-v1",
          questionId: "practice-balance-steps-001",
          knowledgeId: "balance",
          difficulty: 2,
          kind: "math_steps",
          prompt: "分步骤解方程 x + 3 = 8。每行写一个等式。",
          mathContract: {
            version: "1.0.0",
            profile: "linear-equation-v2",
            variable: "x",
            initialEquation: "x + 3 = 8",
            expectedSolution: "5",
          },
          expectedSteps: [
            { id: "subtract-both-sides", acceptedForms: ["x+3-3=8-3"], feedback: "第一步应在等式两边同时减 3。" },
            { id: "simplify", acceptedForms: ["x=5"], feedback: "第二步应化简得到 x=5。" },
          ],
        },
      ],
      tutoringQuestions: [
        numericQuestion("tutor-bal-recall-001-v1", "balance", 1, "2x = 10，x 是多少？", "5", { allowVariableAssignment: true }),
        numericQuestion("tutor-bal-guided-001-v1", "balance", 2, "x + 3 = 8，x 是多少？", "5", { allowVariableAssignment: true }),
        numericQuestion("tutor-bal-transfer-001-v1", "balance", 3, "3x + 2 = 17，x 是多少？", "5", { allowVariableAssignment: true }),
      ],
      reviewQuestions: [
        numericQuestion("review-bal-similar-001-v1", "balance", 2, "x + 7 = 12，x 是多少？", "5", { allowVariableAssignment: true }),
        numericQuestion("review-bal-variation-001-v1", "balance", 3, "4x - 3 = 17，x 是多少？", "5", { allowVariableAssignment: true }),
      ],
    },
    {
      id: "word-problem",
      name: "一元一次方程应用",
      shortDescription: "利用线段图与文字关系建立一元一次方程模型",
      topicId: "top-balance-and-apps",
      orderIndex: 4,
      prerequisiteKnowledgeIds: ["balance"],
      downstreamImpact: 5,
      learningObjectives: [
        "能把实际问题中的文字关系翻译为数学等式",
        "掌握线段图分析总量与等量关系的方法",
      ],
      misconceptions: [
        { id: "equation_translation", label: "文字关系还没有稳定转换为方程", recommendedStrategy: "concept_rebuild" },
      ],
      teachingContent: {
        questionPrefix: "word",
        coreConcept: "先把文字里的数量关系说清楚，再用方程表示。",
        keyPoints: [
          "先说出不知道的量是什么。",
          "找到题目里的总量关系。",
          "用一个方程写出这句话，再求未知数。",
        ],
      },
      diagnosticQuestions: [
        numericQuestion("diag-word-01-v1", "word-problem", 1, "一个数加 3 等于 8，这个数是多少？", "5"),
        numericQuestion("diag-word-02-v1", "word-problem", 2, "3 支相同的铅笔一共 12 元，每支多少元？", "4"),
        numericQuestion("diag-word-03-v1", "word-problem", 3, "长方形的长比宽多 3，周长是 18。宽是多少？", "3"),
      ],
      tutoringQuestions: [
        numericQuestion("tutor-word-recall-001-v1", "word-problem", 1, "一个数加 4 等于 9，这个数是多少？", "5"),
        numericQuestion("tutor-word-guided-001-v1", "word-problem", 2, "3 本相同的练习册共 18 元，每本多少元？", "6"),
        numericQuestion("tutor-word-transfer-001-v1", "word-problem", 3, "一个数的 2 倍再加 3 等于 17，这个数是多少？", "7"),
      ],
      reviewQuestions: [
        numericQuestion("review-word-similar-001-v1", "word-problem", 2, "4 本相同的本子共 28 元，每本多少元？", "7"),
        numericQuestion("review-word-variation-001-v1", "word-problem", 3, "一个数的 3 倍加 2 等于 23，这个数是多少？", "7"),
      ],
    },
  ],
});
