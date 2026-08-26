export const LANGUAGE_CAUSAL_EXPLANATIONS_PACKAGE_ID = "language-causal-explanations-v1";

export const languageCausalExplanationsPackage = Object.freeze({
  id: LANGUAGE_CAUSAL_EXPLANATIONS_PACKAGE_ID,
  name: "英语表达：因果解释",
  subjectId: "language_learning",
  domain: "english",
  sourceType: "professional_skill",
  version: "2.0.0",
  license: "CC-BY-4.0",
  targetAudience: { stage: "general", description: "练习用完整句表达原因与结果", prerequisites: [] },
  evaluationCapabilities: { deterministicGrading: true, semanticEvaluation: "causal-semantic-v2", stepEvaluation: false, speechEvaluation: true, visualInteractions: false },
  modules: [{ id: "mod-language-cause", name: "因果表达", description: "识别并组织原因和结果。", orderIndex: 1, topics: [{ id: "top-language-cause", name: "原因与结果", description: "使用 because、due to 和 so。", orderIndex: 1, knowledgeComponentIds: ["language-cause-effect"] }] }],
  knowledgeComponents: [{
    id: "language-cause-effect",
    name: "英语因果解释",
    shortDescription: "用完整表达连接原因和结果",
    topicId: "top-language-cause",
    orderIndex: 1,
    prerequisiteKnowledgeIds: [],
    downstreamImpact: 3,
    learningObjectives: ["识别原因和结果", "用完整句解释因果关系"],
    misconceptions: [{ id: "missing_causal_link", label: "只陈述事实，没有说明因果关系", recommendedStrategy: "concept_rebuild" }],
    teachingContent: { questionPrefix: "language-cause", coreConcept: "因果解释必须同时出现原因、结果和连接关系。", keyPoints: ["先明确结果。", "再用 because、due to 或 so 连接原因。"], hints: ["找出哪件事是原因。", "检查回答中是否同时包含原因和结果。"], methods: { default: "causal-frame" } },
    diagnosticQuestions: [
      choice("diag-language-cause-01-v1", "下面哪句清楚表达了因果？", [{ id: "a", label: "It rained. The road was wet." }, { id: "b", label: "The road was wet because it rained." }], "b"),
      choice("diag-language-cause-02-v1", "选择合适的连接词：Plants grow ___ sunlight provides energy.", [{ id: "a", label: "because" }, { id: "b", label: "but" }], "a"),
    ],
    dailyQuestions: [semantic("practice-language-cause-001-v2", "用一句英语解释为什么阳光能帮助植物生长。")],
    tutoringQuestions: [
      choice("tutor-language-cause-recall-001-v1", "哪一个词通常引出原因？", [{ id: "a", label: "because" }, { id: "b", label: "although" }], "a"),
      semantic("tutor-language-cause-guided-001-v2", "用一句英语说明：植物生长，因为阳光提供能量。"),
      semantic("tutor-language-cause-transfer-001-v2", "用一句英语解释为什么阳光能帮助植物生长。"),
    ],
    reviewQuestions: [
      choice("review-language-cause-similar-001-v1", "哪句包含完整因果？", [{ id: "a", label: "Sunlight and plants." }, { id: "b", label: "Plants grow because sunlight supplies energy." }], "b"),
      choice("review-language-cause-variation-001-v1", "选择结果连接词：Sunlight provides energy, ___ plants grow.", [{ id: "a", label: "so" }, { id: "b", label: "unless" }], "a"),
    ],
  }],
});

function choice(id, prompt, options, expectedChoice) {
  return { id, questionId: id.replace(/-v\d+$/, ""), knowledgeId: "language-cause-effect", difficulty: 2, kind: "choice", prompt, options, expectedChoice };
}

function semantic(id, prompt) {
  return {
    id,
    questionId: id.replace(/-v\d+$/, ""),
    knowledgeId: "language-cause-effect",
    difficulty: 2,
    kind: "semantic_response",
    prompt,
    rubric: {
      version: "2.0.0",
      profile: "causal-semantic-v2",
      evidenceThreshold: 0.88,
      reviewThreshold: 0.65,
      voiceEvidenceThreshold: 0.9,
      relation: {
        causeAnchors: ["sunlight", "sun", "solar", "light", "energy"],
        effectAnchors: ["grow", "grows", "growth", "develop", "development"],
        reasonConnectors: ["because", "since", "due to"],
        resultConnectors: ["so", "therefore", "thus"],
        forwardVerbs: ["helps", "enables", "allows", "supports", "need", "needs"],
      },
      criteria: [
        {
          id: "cause",
          label: "说明阳光提供能量",
          acceptedPhrases: ["sunlight provides energy", "sunlight supplies energy", "energy from sunlight", "light provides energy"],
          conceptGroups: [["sunlight", "sun", "solar", "light"], ["energy"], ["provide", "provides", "providing", "supply", "supplies", "supplying", "give", "gives", "giving"]],
        },
        {
          id: "effect",
          label: "说明植物生长",
          acceptedPhrases: ["plants grow", "plant growth", "plants can grow"],
          conceptGroups: [["plant", "plants"], ["grow", "grows", "growth", "develop", "development"]],
        },
        {
          id: "link",
          label: "使用因果连接",
          detectNegation: false,
          acceptedPhrases: ["because", "so", "due to", "since", "therefore", "helps", "enables", "allows", "supports", "need", "needs"],
          conceptGroups: [["because", "so", "due to", "since", "therefore", "helps", "enables", "allows", "supports", "need", "needs"]],
        },
      ],
    },
  };
}
