import { conceptualSourceReasoningPackage } from "../packages/conceptual-source-reasoning.mjs";
import { languageCausalExplanationsPackage } from "../packages/language-causal-explanations.mjs";

export const PRIVATE_TUTOR_DOUBLE_ANNOTATION_SET_VERSION = "1.0.0";
export const PRIVATE_TUTOR_DOUBLE_ANNOTATION_PROTOCOL = Object.freeze({
  protocol: "independent_double_annotation_with_adjudication",
  annotationSchemaVersion: 1,
  provenance: "repository_seed_annotation_corpus",
  containsAccountIdentifiers: false,
  minimumIndependentAnnotations: 2,
});

const languageQuestion = languageCausalExplanationsPackage.knowledgeComponents[0].dailyQuestions[0];
const conceptualQuestion = conceptualSourceReasoningPackage.knowledgeComponents[0].dailyQuestions[0];

export const privateTutorDoubleAnnotationCases = Object.freeze([
  language("lang-natural-because", "Plants grow because sunlight supplies energy.", pair(true, true), adjudication(true, true, false, "semantic_complete_calibrated", "complete_high_confidence")),
  language("lang-natural-leading", "Because sunlight supplies energy, plants grow.", pair(true, true), adjudication(true, true, false, "semantic_complete_calibrated", "complete_high_confidence")),
  language("lang-reversed-relation", "Sunlight supplies energy because plants grow.", pair(false, false), adjudication(false, false, false, "semantic_contradiction", "causal_direction_reversed")),
  language("lang-disconnected-claims", "Sunlight supplies energy. Plants grow.", pair(false, false), adjudication(false, false, true, "semantic_review_required", "borderline_review")),
  language("lang-alternate-cause", "Plants grow because of water.", pair(false, true), adjudication(false, false, true, "semantic_review_required", "borderline_review")),
  language("lang-low-confidence-transcript", "Plants grow because sunlight supplies energy.", pair(true, true), adjudication(true, false, true, "semantic_speech_review_required", "complete_review_required"), {
    source: "voice_confirmed",
    recognitionConfidence: 0.8,
  }),
  conceptual("concept-grounded-complete", "[ref:chapter-1] 形成性反馈能发现差距并及时纠正，从而调整学习策略。", pair(true, true, "proficient", "proficient"), adjudication(true, true, false, "anchored_rubric_proficient", null, "proficient", 1)),
  conceptual("concept-grounded-reordered", "学习者可依据 [ref:chapter-1] 调整学习策略；形成性反馈让其及时纠正并发现差距。", pair(true, true, "proficient", "proficient"), adjudication(true, true, false, "anchored_rubric_proficient", null, "proficient", 1)),
  conceptual("concept-source-omitted", "形成性反馈能发现差距并及时纠正，从而调整学习策略。", pair(false, false, "developing", "developing"), adjudication(false, false, true, "anchored_rubric_review_required", null, "developing", 0.85, "missing_required_source")),
  conceptual("concept-proficiency-boundary", "[ref:chapter-1] 形成性反馈能发现差距。", pair(true, false, "developing", "developing"), adjudication(false, false, true, "anchored_rubric_review_required", null, "developing", 0.75, "score_near_proficiency_boundary")),
  conceptual("concept-partial-mechanism", "[ref:chapter-1] 反馈能帮助改进。", pair(false, false, "insufficient", "insufficient"), adjudication(false, false, false, "anchored_rubric_incomplete", null, "insufficient", 0.4)),
  conceptual("concept-irrelevant", "香蕉是黄色的。", pair(false, false, "insufficient", "insufficient"), adjudication(false, false, false, "anchored_rubric_incomplete", null, "insufficient", 0)),
]);

function language(id, answer, annotations, final, input = {}) {
  return {
    id,
    subject: "language",
    question: languageQuestion,
    input: { rawAnswer: answer, responseKind: "answer", source: "screen", ...input },
    annotations,
    adjudication: final,
  };
}

function conceptual(id, answer, annotations, final) {
  return {
    id,
    subject: "conceptual",
    question: conceptualQuestion,
    input: { rawAnswer: answer, responseKind: "answer", source: "screen" },
    annotations,
    adjudication: final,
  };
}

function pair(firstCorrect, secondCorrect, firstScoreBand = null, secondScoreBand = null) {
  return [
    { annotatorId: "annotator-7f3a", correct: firstCorrect, scoreBand: firstScoreBand },
    { annotatorId: "annotator-c91d", correct: secondCorrect, scoreBand: secondScoreBand },
  ];
}

function adjudication(correct, evidenceEligible, requiresReview, reason, semanticStatus = null, scoreBand = null, score = null, reviewReason = null) {
  return {
    adjudicatorId: "adjudicator-2b18",
    correct,
    evidenceEligible,
    requiresReview,
    reason,
    semanticStatus,
    scoreBand,
    score,
    reviewReason,
  };
}
