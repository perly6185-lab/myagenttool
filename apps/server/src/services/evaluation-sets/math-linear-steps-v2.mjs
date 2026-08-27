import { MATH_STEP_EVALUATOR_VERSION } from "../plugins/math-plugin.mjs";

export const MATH_LINEAR_STEPS_GOLDEN_SET_VERSION = "1.0.0";

export const mathLinearStepsGoldenCases = Object.freeze([
  correctCase("subtract-both-sides", "x+3=8", "5", "x+3-3=8-3\nx=5"),
  correctCase("alternative-subtraction", "x+3=8", "5", "x=8-3\nx=5"),
  correctCase("valid-direct-jump", "x+3=8", "5", "x=5"),
  correctCase("expand-parentheses", "2(x+1)=8", "3", "2x+2=8\n2x=6\nx=3"),
  correctCase("collect-and-divide", "3x+2=17", "5", "3x=15\nx=5"),
  correctCase("fraction-coefficient", "x/2+3=7", "8", "x/2=4\nx=8"),
  incorrectCase("single-side-change", "x+3=8", "5", "x+3-3=8\nx=5", "single_side_change", true),
  incorrectCase("sign-error", "x+5=0", "-5", "x=5", "sign_error", true),
  incorrectCase("arithmetic-error", "x+3=8", "5", "x=8+3\nx=11", "arithmetic_error", true),
  incorrectCase("non-equivalent", "2x=10", "5", "3x=12\nx=4", "non_equivalent_transformation", true),
  incorrectCase("nonlinear-answer", "x+3=8", "5", "x*x=25\nx=5", "nonlinear_expression", false),
  incorrectCase("earlier-error-before-unsupported-step", "x+3=8", "5", "x+3=9\nx*x=25", "single_side_change", false),
  incorrectCase("unknown-variable", "x+3=8", "5", "y+3=8\ny=5", "unknown_variable", false),
  {
    id: "solution-not-isolated",
    question: question("x+3=8", "5"),
    answer: "x+3=8",
    expected: { accepted: true, correct: false, evidenceEligible: true, reason: "math_solution_incomplete" },
  },
]);

function correctCase(id, initialEquation, expectedSolution, answer) {
  return {
    id,
    question: question(initialEquation, expectedSolution),
    answer,
    expected: { accepted: true, correct: true, evidenceEligible: true, reason: "semantic_steps_valid" },
  };
}

function incorrectCase(id, initialEquation, expectedSolution, answer, firstIncorrectClassification, evidenceEligible) {
  return {
    id,
    question: question(initialEquation, expectedSolution),
    answer,
    expected: {
      accepted: true,
      correct: false,
      evidenceEligible,
      firstIncorrectClassification,
    },
  };
}

function question(initialEquation, expectedSolution) {
  return {
    id: `golden-${initialEquation.replace(/[^a-z0-9]/gi, "-")}-v1`,
    kind: "math_steps",
    mathContract: {
      version: "1.0.0",
      profile: MATH_STEP_EVALUATOR_VERSION,
      variable: "x",
      initialEquation,
      expectedSolution,
    },
    expectedSteps: [],
  };
}
