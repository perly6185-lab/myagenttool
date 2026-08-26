export const CONCEPTUAL_SOURCE_REASONING_PACKAGE_ID = "conceptual-source-reasoning-v1";

export const conceptualSourceReasoningPackage = Object.freeze({
  id: CONCEPTUAL_SOURCE_REASONING_PACKAGE_ID,
  name: "概念学习：来源支撑的解释",
  subjectId: "conceptual_studies",
  domain: "general_studies",
  sourceType: "university_course",
  version: "1.0.0",
  license: "CC-BY-4.0",
  targetAudience: { stage: "university", description: "练习用来源和案例解释概念", prerequisites: [] },
  evaluationCapabilities: { deterministicGrading: true, semanticEvaluation: true, sourceGrounding: true, stepEvaluation: false, speechEvaluation: false, visualInteractions: false },
  modules: [{ id: "mod-source-reasoning", name: "证据与解释", description: "用概念、机制、案例和来源构成解释。", orderIndex: 1, topics: [{ id: "top-source-reasoning", name: "来源支撑", description: "区分观点与来源证据。", orderIndex: 1, knowledgeComponentIds: ["source-grounded-explanation"] }] }],
  knowledgeComponents: [{
    id: "source-grounded-explanation",
    name: "来源支撑的概念解释",
    shortDescription: "引用指定来源并覆盖评分维度",
    topicId: "top-source-reasoning",
    orderIndex: 1,
    prerequisiteKnowledgeIds: [],
    downstreamImpact: 4,
    learningObjectives: ["说明核心概念", "引用来源并给出案例"],
    misconceptions: [{ id: "unsupported_claim", label: "结论没有来源或机制支撑", recommendedStrategy: "concept_rebuild" }],
    teachingContent: { questionPrefix: "source-reasoning", coreConcept: "高质量解释需要概念、机制、案例和可核对来源。", keyPoints: ["明确核心概念。", "说明机制并给出案例。", "引用指定来源。"], hints: ["先写出核心概念。", "加入 [ref:chapter-1] 来源标记。"], methods: { default: "claim-evidence-reasoning" } },
    diagnosticQuestions: [
      choice("diag-concept-source-01-v1", "哪种回答更可核对？", [{ id: "a", label: "只给结论" }, { id: "b", label: "结论、机制和来源" }], "b"),
      choice("diag-concept-source-02-v1", "案例在概念解释中的主要作用是什么？", [{ id: "a", label: "展示概念如何应用" }, { id: "b", label: "替代所有证据" }], "a"),
    ],
    dailyQuestions: [rubric("practice-concept-source-001-v1")],
    tutoringQuestions: [
      choice("tutor-concept-source-recall-001-v1", "可核对来源标记的作用是什么？", [{ id: "a", label: "定位证据" }, { id: "b", label: "增加字数" }], "a"),
      rubric("tutor-concept-source-guided-001-v1"),
      rubric("tutor-concept-source-transfer-001-v1"),
    ],
    reviewQuestions: [
      choice("review-concept-source-similar-001-v1", "完整解释至少需要什么？", [{ id: "a", label: "概念、机制与证据" }, { id: "b", label: "个人偏好" }], "a"),
      choice("review-concept-source-variation-001-v1", "缺少来源的开放回答应如何处理？", [{ id: "a", label: "要求补充来源，不进入高置信掌握" }, { id: "b", label: "直接满分" }], "a"),
    ],
  }],
});

function choice(id, prompt, options, expectedChoice) {
  return { id, questionId: id.replace(/-v\d+$/, ""), knowledgeId: "source-grounded-explanation", difficulty: 2, kind: "choice", prompt, options, expectedChoice };
}

function rubric(id) {
  return {
    id,
    questionId: id.replace(/-v\d+$/, ""),
    knowledgeId: "source-grounded-explanation",
    difficulty: 2,
    kind: "rubric_response",
    prompt: "解释为什么形成性反馈能改善学习，并引用 chapter-1。格式示例：[ref:chapter-1]",
    requiredSourceRefs: ["chapter-1"],
    rubric: { criteria: [
      { id: "concept", label: "指出形成性反馈", acceptedPhrases: ["形成性反馈", "formative feedback"], sourceRef: "chapter-1" },
      { id: "mechanism", label: "说明及时纠正差距", acceptedPhrases: ["及时纠正", "发现差距", "close learning gaps"], sourceRef: "chapter-1" },
      { id: "application", label: "给出调整学习策略", acceptedPhrases: ["调整学习策略", "改进下一步", "adjust the next step"], sourceRef: "chapter-1" },
    ] },
  };
}
