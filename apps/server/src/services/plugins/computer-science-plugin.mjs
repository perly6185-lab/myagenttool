// Computer-science foundations currently use deterministic multiple-choice
// evaluation. The explicit plugin boundary prevents unsupported code, speech,
// or free-form semantic answers from being treated as mastery evidence.

export const COMPUTER_SCIENCE_SUBJECT_ID = "computer_science";

const CHOICE_ID_PATTERN = /^[a-z0-9]{1,12}$/;

export const computerScienceSubjectPlugin = Object.freeze({
  subjectId: COMPUTER_SCIENCE_SUBJECT_ID,
  version: "1.0.0",
  visualTemplates: [],
  getCapabilities() {
    return {
      deterministicGrading: true,
      stepEvaluation: false,
      speechEvaluation: false,
      visualInteractions: false,
      supportedQuestionKinds: ["choice"],
    };
  },
  normalizer(input, { kind = "choice" } = {}) {
    if (kind !== "choice") return null;
    const normalized = String(input ?? "").trim().toLowerCase();
    return CHOICE_ID_PATTERN.test(normalized) ? normalized : null;
  },
  evaluator({ rawAnswer, responseKind = "answer" }, question) {
    if (responseKind === "dont_know") {
      return { accepted: true, correct: false, responseKind, normalizedAnswer: null, reason: "dont_know" };
    }
    if (responseKind !== "answer") {
      return { accepted: false, error: "invalid_private_tutor_response_kind" };
    }
    if (question.kind !== "choice" || !Array.isArray(question.options)) {
      return { accepted: false, error: "private_tutor_question_kind_unsupported" };
    }
    const normalizedAnswer = this.normalizer(rawAnswer, { kind: question.kind });
    if (!normalizedAnswer || !question.options.some((option) => option.id === normalizedAnswer)) {
      return { accepted: false, error: "invalid_private_tutor_answer_format" };
    }
    const correct = normalizedAnswer === question.expectedChoice;
    return {
      accepted: true,
      correct,
      responseKind,
      normalizedAnswer,
      reason: correct ? "exact_choice" : "different_choice",
    };
  },
});
