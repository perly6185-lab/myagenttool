export const CONCEPTUAL_SOURCE_REASONING_PACKAGE_ID = "conceptual-source-reasoning-v1";

export const conceptualSourceReasoningPackage = Object.freeze({
  id: CONCEPTUAL_SOURCE_REASONING_PACKAGE_ID,
  name: "概念学习：来源支撑的解释",
  subjectId: "conceptual_studies",
  domain: "general_studies",
  sourceType: "university_course",
  version: "2.0.0",
  license: "CC-BY-4.0",
  targetAudience: { stage: "university", description: "练习用来源和案例解释概念", prerequisites: [] },
  evaluationCapabilities: { deterministicGrading: true, semanticEvaluation: "anchored-concept-rubric-v2", sourceGrounding: true, stepEvaluation: false, speechEvaluation: false, visualInteractions: false },
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
    dailyQuestions: [rubric("practice-concept-source-001-v2")],
    tutoringQuestions: [
      choice("tutor-concept-source-recall-001-v1", "可核对来源标记的作用是什么？", [{ id: "a", label: "定位证据" }, { id: "b", label: "增加字数" }], "a"),
      rubric("tutor-concept-source-guided-001-v2"),
      rubric("tutor-concept-source-transfer-001-v2"),
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
    rubric: {
      version: "2.0.0",
      profile: "anchored-concept-rubric-v2",
      passBand: "proficient",
      reviewThreshold: 0.75,
      sourceWeight: 0.15,
      requiredSourceRefs: ["chapter-1"],
      availableSourceRefs: ["chapter-1"],
      bands: [
        { id: "insufficient", minScore: 0, maxScore: 0.49 },
        { id: "developing", minScore: 0.5, maxScore: 0.89 },
        { id: "proficient", minScore: 0.9, maxScore: 1 },
      ],
      anchors: [
        { id: "anchor-insufficient-v1", band: "insufficient", description: "只有结论或来源，缺少机制与应用。", sample: "形成性反馈很有用。" },
        { id: "anchor-developing-v1", band: "developing", description: "覆盖部分机制，但仍缺一个关键维度或可核对来源。", sample: "[ref:chapter-1] 形成性反馈能发现差距。" },
        { id: "anchor-proficient-v1", band: "proficient", description: "概念、机制、应用和来源完整且相互支撑。", sample: "[ref:chapter-1] 形成性反馈能发现差距并及时纠正，从而调整学习策略。" },
      ],
      criteria: [
        { id: "concept", label: "指出形成性反馈", weight: 0.25, acceptedPhrases: ["形成性反馈", "formative feedback"], partialPhrases: ["反馈"], sourceRef: "chapter-1" },
        { id: "mechanism", label: "说明发现并纠正差距", weight: 0.35, acceptedPhrases: ["及时纠正", "发现差距", "识别差距", "close learning gaps", "identify learning gaps"], partialPhrases: ["发现问题", "知道哪里不会"], sourceRef: "chapter-1" },
        { id: "application", label: "说明如何调整学习", weight: 0.25, acceptedPhrases: ["调整学习策略", "改进下一步", "调整下一步", "adjust the next step", "adapt learning strategies"], partialPhrases: ["帮助改进", "改善学习"], sourceRef: "chapter-1" },
      ],
    },
  };
}
