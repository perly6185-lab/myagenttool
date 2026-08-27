import { conceptualSourceReasoningPackage } from "../packages/conceptual-source-reasoning.mjs";

export const CONCEPTUAL_ANCHORED_RUBRIC_GOLDEN_SET_VERSION = "1.0.0";

const question = conceptualSourceReasoningPackage.knowledgeComponents[0].dailyQuestions[0];

export const conceptualAnchoredRubricGoldenCases = Object.freeze([
  fixture("proficient-grounded-zh", "[ref:chapter-1] 形成性反馈能发现差距并及时纠正，从而调整学习策略。", true, "proficient", 1, false),
  fixture("proficient-reordered-zh", "学习者可依据 [ref:chapter-1] 调整学习策略；形成性反馈让其及时纠正并发现差距。", true, "proficient", 1, false),
  fixture("proficient-grounded-en", "Formative feedback can identify learning gaps and adapt learning strategies. [ref:chapter-1]", true, "proficient", 1, false),
  fixture("developing-missing-source", "形成性反馈能发现差距并及时纠正，从而调整学习策略。", false, "developing", 0.85, true, "missing_required_source"),
  fixture("developing-boundary-review", "[ref:chapter-1] 形成性反馈能发现差距。", false, "developing", 0.75, true, "score_near_proficiency_boundary"),
  fixture("developing-concept-application", "[ref:chapter-1] 形成性反馈可以改善学习。", false, "developing", 0.525, false),
  fixture("insufficient-partial-criteria", "[ref:chapter-1] 反馈能帮助改进。", false, "insufficient", 0.4, false),
  fixture("insufficient-source-only", "相关依据见 [ref:chapter-1]。", false, "insufficient", 0.15, false),
  fixture("insufficient-irrelevant", "香蕉是黄色的。", false, "insufficient", 0, false),
  fixture("developing-unknown-source", "[ref:fake] 形成性反馈能发现差距并及时纠正，从而调整学习策略。", false, "developing", 0.85, true, "unknown_source_reference"),
  fixture("proficient-score-unknown-extra-source", "[ref:chapter-1] [ref:fake] 形成性反馈能发现差距并及时纠正，从而调整学习策略。", false, "proficient", 1, true, "unknown_source_reference"),
]);

function fixture(id, answer, correct, scoreBand, score, requiresReview, reviewReason = null) {
  const reason = correct
    ? "anchored_rubric_proficient"
    : requiresReview ? "anchored_rubric_review_required" : "anchored_rubric_incomplete";
  return {
    id,
    question,
    input: { rawAnswer: answer, responseKind: "answer", source: "screen" },
    expected: {
      accepted: true,
      correct,
      evidenceEligible: correct,
      reason,
      scoreBand,
      anchorId: `anchor-${scoreBand}-v1`,
      score,
      requiresReview,
      reviewReason,
    },
  };
}
