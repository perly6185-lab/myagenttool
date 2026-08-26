export const CS_LOGIC_FOUNDATIONS_PACKAGE_ID = "cs-logic-foundations-v1";

function choiceQuestion(id, knowledgeId, difficulty, prompt, options, expectedChoice) {
  return {
    id,
    questionId: id.replace(/-v\d+$/, ""),
    knowledgeId,
    difficulty,
    prompt,
    kind: "choice",
    options,
    expectedChoice,
  };
}

export const csLogicFoundationsPackage = Object.freeze({
  id: CS_LOGIC_FOUNDATIONS_PACKAGE_ID,
  name: "计算机科学：数理逻辑与布尔代数基础",
  subjectId: "computer_science",
  domain: "computer_science",
  sourceType: "university_course",
  version: "1.0.0",
  license: "MIT",
  targetAudience: {
    stage: "university-undergraduate",
    description: "适合计算机、软件工程专业本科生或逻辑学入门学习者",
    prerequisites: ["离散数学基础概念"],
  },
  evaluationCapabilities: {
    deterministicGrading: true,
    stepEvaluation: false,
    speechEvaluation: false,
    visualInteractions: true,
  },
  modules: [
    {
      id: "mod-propositional-logic",
      name: "命题逻辑与联结词",
      description: "掌握命题真值、合取析取条件联结词与等价变换。",
      orderIndex: 1,
      topics: [
        {
          id: "top-connectives",
          name: "命题与逻辑联结词",
          description: "命题判断与基本逻辑门运算。",
          orderIndex: 1,
          knowledgeComponentIds: ["proposition", "logic-connectives"],
        },
      ],
    },
  ],
  knowledgeComponents: [
    {
      id: "proposition",
      name: "命题与真值判断",
      shortDescription: "陈述句与命题真假值的形式化判定",
      topicId: "top-connectives",
      orderIndex: 1,
      prerequisiteKnowledgeIds: [],
      downstreamImpact: 3,
      learningObjectives: [
        "能辨析陈述句与非陈述句，判定语句是否为命题",
        "理解命题真值（True / False）的二值特性",
      ],
      misconceptions: [
        { id: "syntax_vs_truth", label: "混淆了语法疑问句与命题真值", recommendedStrategy: "concept_rebuild" },
      ],
      teachingContent: {
        questionPrefix: "prop",
        coreConcept: "只有能够明确判断真假的陈述句才是命题。",
        keyPoints: [
          "疑问句、祈使句、感叹句通常不是命题。",
          "真值在客观上有确定真或假的陈述句是命题，即使我们当下不知道事实真假。",
        ],
      },
      diagnosticQuestions: [
        choiceQuestion("diag-prop-01-v1", "proposition", 1, "下面哪一句话是命题？", [
          { id: "a", label: "请把门关上。" },
          { id: "b", label: "太阳从东边升起。" },
          { id: "c", label: "今天天气好吗？" },
        ], "b"),
        choiceQuestion("diag-prop-02-v1", "proposition", 2, "下面哪一句虽然暂时不知道真假，但仍然是命题？", [
          { id: "a", label: "请计算这个表达式。" },
          { id: "b", label: "宇宙中存在其他智慧生命。" },
          { id: "c", label: "这段代码漂亮吗？" },
        ], "b"),
      ],
      tutoringQuestions: [
        choiceQuestion("tutor-prop-recall-001-v1", "proposition", 1, "下面哪项是具有明确真值的命题？", [
          { id: "a", label: "x 大于 5。" },
          { id: "b", label: "2 是质数。" },
          { id: "c", label: "这朵花真漂亮！" },
        ], "b"),
        choiceQuestion("tutor-prop-guided-001-v1", "proposition", 2, "判断语句“7 是偶数”的类型。", [
          { id: "a", label: "是真命题" },
          { id: "b", label: "是假命题" },
          { id: "c", label: "不是命题" },
        ], "b"),
        choiceQuestion("tutor-prop-transfer-001-v1", "proposition", 3, "下面哪项不是命题？", [
          { id: "a", label: "存在最大的质数。" },
          { id: "b", label: "把变量 x 的值打印出来。" },
          { id: "c", label: "所有偶数都能被 2 整除。" },
        ], "b"),
      ],
      reviewQuestions: [
        choiceQuestion("review-prop-similar-001-v1", "proposition", 1, "下面哪一句属于命题？", [
          { id: "a", label: "地球是圆的。" },
          { id: "b", label: "严禁吸烟！" },
          { id: "c", label: "明天会下雨吗？" },
        ], "a"),
        choiceQuestion("review-prop-variation-001-v1", "proposition", 2, "下面哪项具有确定真值？", [
          { id: "a", label: "请提交作业。" },
          { id: "b", label: "5 大于 9。" },
          { id: "c", label: "这个算法好吗？" },
        ], "b"),
      ],
    },
    {
      id: "logic-connectives",
      name: "逻辑联结词与真值表",
      shortDescription: "合取（AND）、析取（OR）、非（NOT）与条件命题",
      topicId: "top-connectives",
      orderIndex: 2,
      prerequisiteKnowledgeIds: ["proposition"],
      downstreamImpact: 4,
      learningObjectives: [
        "熟练掌握非、合取、析取的真值表规律",
        "理解蕴含式（P -> Q）在前提为假时为真的定义",
      ],
      misconceptions: [
        { id: "implication_false_premise", label: "误以为前提为假时蕴含式也为假", recommendedStrategy: "concept_rebuild" },
      ],
      teachingContent: {
        questionPrefix: "conn",
        coreConcept: "复合命题的真值由各组成命题的真值和联结词运算规则唯一确定。",
        keyPoints: [
          "P 且 Q：两者皆真才为真。",
          "P 或 Q：至少一个为真即为真。",
          "非 P：真假反转。",
        ],
      },
      diagnosticQuestions: [
        choiceQuestion("diag-conn-01-v1", "logic-connectives", 1, "设 P 为真命题，Q 为假命题，则 P AND Q 的真值是？", [
          { id: "a", label: "真 (True)" },
          { id: "b", label: "假 (False)" },
          { id: "c", label: "不确定" },
        ], "b"),
        choiceQuestion("diag-conn-02-v1", "logic-connectives", 2, "设 P 为假命题，则 NOT P 的真值是？", [
          { id: "a", label: "真 (True)" },
          { id: "b", label: "假 (False)" },
        ], "a"),
      ],
      tutoringQuestions: [
        choiceQuestion("tutor-conn-recall-001-v1", "logic-connectives", 1, "设 P 为真，Q 为假，则 P OR Q 的真值是？", [
          { id: "a", label: "真 (True)" },
          { id: "b", label: "假 (False)" },
        ], "a"),
        choiceQuestion("tutor-conn-guided-001-v1", "logic-connectives", 2, "设 P 为假，Q 为假，则 P AND Q 的真值是？", [
          { id: "a", label: "真 (True)" },
          { id: "b", label: "假 (False)" },
        ], "b"),
        choiceQuestion("tutor-conn-transfer-001-v1", "logic-connectives", 3, "设 P 为假，Q 为真，则 NOT P AND Q 的真值是？", [
          { id: "a", label: "真 (True)" },
          { id: "b", label: "假 (False)" },
        ], "a"),
      ],
      reviewQuestions: [
        choiceQuestion("review-conn-similar-001-v1", "logic-connectives", 1, "NOT (False) 的结果是？", [
          { id: "a", label: "True" },
          { id: "b", label: "False" },
        ], "a"),
        choiceQuestion("review-conn-variation-001-v1", "logic-connectives", 2, "True AND NOT (True) 的结果是？", [
          { id: "a", label: "True" },
          { id: "b", label: "False" },
        ], "b"),
      ],
    },
  ],
});
