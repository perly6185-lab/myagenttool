export const PROGRAMMING_FUNCTIONS_PACKAGE_ID = "programming-functions-v1";

export const programmingFunctionsPackage = Object.freeze({
  id: PROGRAMMING_FUNCTIONS_PACKAGE_ID,
  name: "编程基础：纯函数与测试",
  subjectId: "programming",
  domain: "computer_science",
  sourceType: "professional_skill",
  version: "1.0.0",
  license: "MIT",
  targetAudience: { stage: "beginner", description: "使用受限表达式练习纯函数", prerequisites: [] },
  evaluationCapabilities: { deterministicGrading: true, codeExecution: true, stepEvaluation: false, speechEvaluation: false, visualInteractions: false },
  modules: [{ id: "mod-pure-functions", name: "纯函数", description: "根据输入返回确定输出。", orderIndex: 1, topics: [{ id: "top-pure-functions", name: "参数与返回值", description: "编写可测试的纯表达式函数。", orderIndex: 1, knowledgeComponentIds: ["pure-function-return"] }] }],
  knowledgeComponents: [{
    id: "pure-function-return",
    name: "纯函数返回表达式",
    shortDescription: "根据参数计算返回值",
    topicId: "top-pure-functions",
    orderIndex: 1,
    prerequisiteKnowledgeIds: [],
    downstreamImpact: 4,
    learningObjectives: ["理解参数和返回值", "通过测试验证纯函数"],
    misconceptions: [{ id: "hardcoded_output", label: "写死输出而没有使用参数", recommendedStrategy: "concept_rebuild" }],
    teachingContent: { questionPrefix: "pure-function", coreConcept: "纯函数只依赖参数并返回结果。", keyPoints: ["返回表达式必须使用参数。", "用多个测试避免写死答案。"], hints: ["目标输出是输入的两倍。", "尝试 return n * 2;"], methods: { default: "test-first" } },
    diagnosticQuestions: [
      choice("diag-code-function-01-v1", "函数参数的作用是什么？", [{ id: "a", label: "接收输入" }, { id: "b", label: "隐藏错误" }], "a"),
      choice("diag-code-function-02-v1", "纯函数应当具有什么性质？", [{ id: "a", label: "相同输入得到相同输出" }, { id: "b", label: "随机修改外部状态" }], "a"),
    ],
    dailyQuestions: [code("practice-code-double-001-v1")],
    tutoringQuestions: [
      choice("tutor-code-function-recall-001-v1", "return 的作用是什么？", [{ id: "a", label: "返回计算结果" }, { id: "b", label: "重复运行程序" }], "a"),
      code("tutor-code-function-guided-001-v1"),
      code("tutor-code-function-transfer-001-v1"),
    ],
    reviewQuestions: [
      choice("review-code-function-similar-001-v1", "哪个表达式把 n 翻倍？", [{ id: "a", label: "n * 2" }, { id: "b", label: "n + 1" }], "a"),
      choice("review-code-function-variation-001-v1", "为什么需要多个测试输入？", [{ id: "a", label: "防止写死单个答案" }, { id: "b", label: "让代码更长" }], "a"),
    ],
  }],
});

function choice(id, prompt, options, expectedChoice) {
  return { id, questionId: id.replace(/-v\d+$/, ""), knowledgeId: "pure-function-return", difficulty: 2, kind: "choice", prompt, options, expectedChoice };
}

function code(id) {
  return { id, questionId: id.replace(/-v\d+$/, ""), knowledgeId: "pure-function-return", difficulty: 2, kind: "code", prompt: "实现 double(n)，返回 n 的两倍。仅允许纯算术返回表达式。", functionName: "double", parameters: ["n"], tests: [{ args: [0], expected: 0 }, { args: [2], expected: 4 }, { args: [-3], expected: -6 }] };
}
