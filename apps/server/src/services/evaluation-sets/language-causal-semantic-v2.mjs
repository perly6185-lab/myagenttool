import { languageCausalExplanationsPackage } from "../packages/language-causal-explanations.mjs";

export const LANGUAGE_CAUSAL_SEMANTIC_GOLDEN_SET_VERSION = "1.0.0";

const question = languageCausalExplanationsPackage.knowledgeComponents[0].dailyQuestions[0];

export const languageCausalSemanticGoldenCases = Object.freeze([
  correctCase("because-standard", "Plants grow because sunlight supplies energy."),
  correctCase("because-leading", "Because sunlight supplies energy, plants grow."),
  correctCase("result-so", "Sunlight supplies energy, so plants grow."),
  correctCase("reason-due-to", "Plants grow due to energy from sunlight."),
  correctCase("paraphrase-helps", "Sunlight helps plants grow by giving them energy."),
  correctCase("paraphrase-gives", "Sunlight gives plants the energy they need to grow."),
  correctCase("paraphrase-provides", "Sunlight provides plants with energy and enables them to grow."),
  correctCase("solar-therefore", "Solar light gives energy; therefore, plant growth occurs."),
  incorrectCase("negated-claim", "Plants do not grow because sunlight does not supply energy.", "semantic_contradiction", "contradicted", false),
  incorrectCase("reversed-causality", "Sunlight supplies energy because plants grow.", "semantic_contradiction", "causal_direction_reversed", false),
  incorrectCase("conflicting-connectors", "Sunlight supplies energy because plants grow, so plants grow.", "semantic_contradiction", "causal_direction_reversed", false),
  incorrectCase("missing-cause", "Plants grow because of water.", "semantic_review_required", "borderline_review", true),
  incorrectCase("missing-effect", "Sunlight provides energy because it is bright.", "semantic_review_required", "borderline_review", true),
  incorrectCase("disconnected-statements", "Sunlight supplies energy. Plants grow.", "semantic_review_required", "borderline_review", true),
  incorrectCase("disconnected-forward-verb", "Sunlight gives energy and helps. Plants grow.", "semantic_contradiction", "causal_relation_disconnected", false),
  incorrectCase("keyword-salad", "Sunlight energy plants grow.", "semantic_incomplete", "incomplete", false),
  incorrectCase("irrelevant", "Bananas are yellow.", "semantic_incomplete", "incomplete", false),
  correctCase("high-confidence-voice", "Plants grow because sunlight supplies energy.", {
    source: "voice_confirmed",
    recognitionConfidence: 0.96,
    confidenceAtLeast: 0.95,
  }),
  {
    id: "low-confidence-voice-review",
    question,
    input: {
      rawAnswer: "Plants grow because sunlight supplies energy.",
      responseKind: "answer",
      source: "voice_confirmed",
      recognitionConfidence: 0.8,
    },
    expected: {
      accepted: true,
      correct: true,
      evidenceEligible: false,
      reason: "semantic_speech_review_required",
      semanticStatus: "complete_review_required",
      requiresReview: true,
      confidenceAtMost: 0.8,
    },
  },
]);

function correctCase(id, answer, options = {}) {
  return {
    id,
    question,
    input: {
      rawAnswer: answer,
      responseKind: "answer",
      source: options.source ?? "screen",
      ...(options.recognitionConfidence === undefined ? {} : { recognitionConfidence: options.recognitionConfidence }),
    },
    expected: {
      accepted: true,
      correct: true,
      evidenceEligible: true,
      reason: "semantic_complete_calibrated",
      semanticStatus: "complete_high_confidence",
      requiresReview: false,
      confidenceAtLeast: options.confidenceAtLeast ?? 0.88,
    },
  };
}

function incorrectCase(id, answer, reason, semanticStatus, requiresReview) {
  return {
    id,
    question,
    input: { rawAnswer: answer, responseKind: "answer", source: "screen" },
    expected: {
      accepted: true,
      correct: false,
      evidenceEligible: false,
      reason,
      semanticStatus,
      requiresReview,
    },
  };
}
