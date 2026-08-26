import { evaluateAuthoredRubric } from "./authored-rubric.mjs";

export const CONCEPTUAL_SUBJECT_ID = "conceptual_studies";

export const conceptualSubjectPlugin = Object.freeze({
  subjectId: CONCEPTUAL_SUBJECT_ID,
  version: "1.0.0",
  visualTemplates: [],
  getCapabilities() {
    return {
      deterministicGrading: true,
      stepEvaluation: false,
      speechEvaluation: false,
      semanticEvaluation: "source_grounded_rubric",
      sourceGrounding: true,
      visualInteractions: false,
      supportedQuestionKinds: ["choice", "rubric_response"],
    };
  },
  evaluator(input, question) {
    if (input.responseKind === "dont_know") {
      return { accepted: true, correct: false, responseKind: "dont_know", normalizedAnswer: null, reason: "dont_know", evidenceEligible: true, evidenceTier: "deterministic" };
    }
    if (input.responseKind !== "answer") return { accepted: false, error: "invalid_private_tutor_response_kind" };
    if (question.kind === "choice") return evaluateChoice(input, question);
    if (question.kind !== "rubric_response") return { accepted: false, error: "private_tutor_question_kind_unsupported" };
    return evaluateAuthoredRubric(input.rawAnswer, question.rubric, { requiredSourceRefs: question.requiredSourceRefs ?? [] });
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
