import { evaluateAuthoredRubric } from "./authored-rubric.mjs";
import { evaluateLanguageSemanticResponse, LANGUAGE_SEMANTIC_EVALUATOR_VERSION } from "./language-semantic-evaluator.mjs";

export const LANGUAGE_SUBJECT_ID = "language_learning";

export const languageSubjectPlugin = Object.freeze({
  subjectId: LANGUAGE_SUBJECT_ID,
  version: "2.0.0",
  visualTemplates: [],
  getCapabilities() {
    return {
      deterministicGrading: true,
      stepEvaluation: false,
      speechEvaluation: true,
      semanticEvaluation: LANGUAGE_SEMANTIC_EVALUATOR_VERSION,
      visualInteractions: false,
      supportedQuestionKinds: ["choice", "semantic_response"],
    };
  },
  evaluator(input, question) {
    if (input.responseKind === "dont_know") {
      return { accepted: true, correct: false, responseKind: "dont_know", normalizedAnswer: null, reason: "dont_know", evidenceEligible: true, evidenceTier: "deterministic" };
    }
    if (input.responseKind !== "answer") return { accepted: false, error: "invalid_private_tutor_response_kind" };
    if (question.kind === "choice") return evaluateChoice(input, question);
    if (question.kind !== "semantic_response") return { accepted: false, error: "private_tutor_question_kind_unsupported" };
    if (question.rubric?.profile === LANGUAGE_SEMANTIC_EVALUATOR_VERSION) {
      return evaluateLanguageSemanticResponse(input, question);
    }
    const result = evaluateAuthoredRubric(input.rawAnswer, question.rubric);
    if (!result.accepted) return result;
    const speechConfidence = input.source === "voice_confirmed" ? Number(input.recognitionConfidence) : null;
    if (speechConfidence !== null && (!Number.isFinite(speechConfidence) || speechConfidence < 0.85)) {
      return {
        ...result,
        correct: false,
        reason: "semantic_speech_review_required",
        evidenceEligible: false,
        evidenceTier: "practice_only",
        evaluation: { ...result.evaluation, speechConfidence, requiresReview: true },
      };
    }
    return result;
  },
});

function evaluateChoice(input, question) {
  const normalized = String(input.rawAnswer ?? "").trim().toLowerCase();
  if (input.responseKind !== "answer" || !question.options?.some((item) => item.id === normalized)) {
    return { accepted: false, error: "invalid_private_tutor_answer_format" };
  }
  const correct = normalized === question.expectedChoice;
  return { accepted: true, correct, responseKind: "answer", normalizedAnswer: normalized, reason: correct ? "exact_choice" : "different_choice", evidenceEligible: true, evidenceTier: "deterministic" };
}
