// Math subject plugin: deterministic grading of rational expressions and
// multiple choice. The plugin owns the expression parser (BigInt rationals so
// "1/2", "0.5", "2/4" grade equal) and declares its capability boundary —
// no speech evaluation. Multi-step answers are checked against immutable,
// author-reviewed checkpoints; arbitrary symbolic code is never evaluated.

export const MATH_SUBJECT_ID = "math";
export const MATH_STEP_EVALUATOR_VERSION = "linear-equation-v2";

const CHOICE_ID_PATTERN = /^[a-z0-9]{1,12}$/;

export const mathSubjectPlugin = Object.freeze({
  subjectId: MATH_SUBJECT_ID,
  version: "2.0.0",
  visualTemplates: [
    "number_line",
    "fraction_strip",
    "equation_balance",
    "bar_model",
    "coordinate_plane",
    "comparison",
  ],
  getCapabilities() {
    return {
      deterministicGrading: true,
      stepEvaluation: true,
      stepEvaluationProfile: MATH_STEP_EVALUATOR_VERSION,
      speechEvaluation: false,
      visualInteractions: true,
    };
  },
  normalizer(input, { kind = "numeric", allowVariableAssignment = false } = {}) {
    if (kind === "choice") {
      const normalized = String(input ?? "").trim().toLowerCase();
      return CHOICE_ID_PATTERN.test(normalized) ? normalized : null;
    }
    const parsed = parseRationalAnswer(input, { allowVariableAssignment });
    return parsed ? rationalText(parsed) : null;
  },
  evaluator({ rawAnswer, responseKind = "answer" }, question) {
    if (responseKind === "dont_know") {
      return { accepted: true, correct: false, responseKind, normalizedAnswer: null, reason: "dont_know" };
    }
    if (responseKind !== "answer") {
      return { accepted: false, error: "invalid_private_tutor_response_kind" };
    }
    if (question.kind === "choice") {
      const normalizedAnswer = this.normalizer(rawAnswer, { kind: "choice" });
      if (!normalizedAnswer || !question.options.some((option) => option.id === normalizedAnswer)) {
        return { accepted: false, error: "invalid_private_tutor_answer_format" };
      }
      return {
        accepted: true,
        correct: normalizedAnswer === question.expectedChoice,
        responseKind,
        normalizedAnswer,
        reason: normalizedAnswer === question.expectedChoice ? "exact_choice" : "different_choice",
      };
    }
    if (question.kind === "math_steps") return evaluateMathSteps(rawAnswer, question);
    const parsed = parseRationalAnswer(rawAnswer, { allowVariableAssignment: question.allowVariableAssignment });
    if (!parsed) return { accepted: false, error: "invalid_private_tutor_answer_format" };
    const correct = rationalEquals(parsed, question.expectedRational);
    return {
      accepted: true,
      correct,
      responseKind,
      normalizedAnswer: rationalText(parsed),
      reason: correct ? "equivalent_value" : "different_value",
    };
  },
});

export function evaluateMathSteps(rawAnswer, question) {
  const submitted = String(rawAnswer ?? "")
    .split(/\r?\n|=>|→/)
    .map(normalizeMathStep)
    .filter(Boolean)
    .slice(0, 20);
  if (question.mathContract?.profile === MATH_STEP_EVALUATOR_VERSION) {
    return evaluateLinearEquationSteps(submitted, question);
  }
  return evaluateAuthoredMathSteps(submitted, question);
}

function evaluateAuthoredMathSteps(submitted, question) {
  const checkpoints = Array.isArray(question.expectedSteps) ? question.expectedSteps.slice(0, 20) : [];
  if (!submitted.length || !checkpoints.length) return { accepted: false, error: "invalid_private_tutor_answer_format" };
  const stepResults = checkpoints.map((checkpoint, index) => {
    const acceptedForms = (checkpoint.acceptedForms ?? []).map(normalizeMathStep).filter(Boolean);
    const actual = submitted[index] ?? null;
    return {
      index,
      id: checkpoint.id ?? `step-${index + 1}`,
      correct: Boolean(actual && acceptedForms.includes(actual)),
      actual,
      feedback: actual && acceptedForms.includes(actual) ? "步骤成立" : checkpoint.feedback ?? "请检查这一步的等式变形。",
    };
  });
  const correct = submitted.length === checkpoints.length && stepResults.every((item) => item.correct);
  return {
    accepted: true,
    correct,
    responseKind: "answer",
    normalizedAnswer: submitted.join("\n"),
    reason: correct ? "all_authored_steps_valid" : "math_step_mismatch",
    evidenceEligible: true,
    evidenceTier: "deterministic_steps",
    evaluation: {
      passedCount: stepResults.filter((item) => item.correct).length,
      totalCount: checkpoints.length,
      firstIncorrectStep: stepResults.find((item) => !item.correct)?.index ?? null,
      steps: stepResults,
    },
  };
}

export function evaluateLinearEquationSteps(submitted, question) {
  const contract = question.mathContract ?? {};
  const variable = String(contract.variable ?? "x").trim().toLowerCase();
  const expectedSolution = parseRationalAnswer(contract.expectedSolution, { allowVariableAssignment: false });
  const initial = parseLinearEquation(contract.initialEquation, { variable });
  if (!submitted.length) return { accepted: false, error: "invalid_private_tutor_answer_format" };
  if (!/^[a-z]$/.test(variable) || !expectedSolution || !initial.ok || !equationHasUniqueSolution(initial)) {
    return { accepted: false, error: "private_tutor_math_contract_invalid" };
  }

  const checkpoints = Array.isArray(question.expectedSteps) ? question.expectedSteps.slice(0, 20) : [];
  const parsedSteps = submitted.map((actual) => parseLinearEquation(actual, { variable }));
  const stepResults = [];
  let hasUnsupportedStep = false;
  let previous = initial;
  for (let index = 0; index < parsedSteps.length; index += 1) {
    const current = parsedSteps[index];
    if (!current.ok) {
      hasUnsupportedStep = true;
      stepResults.push(stepResult({
        index,
        checkpoint: checkpoints[index],
        actual: submitted[index],
        correct: false,
        classification: current.classification,
        normalizedEquation: current.normalized,
      }));
      continue;
    }
    const equivalent = equivalentLinearEquations(previous, current);
    const solved = equivalent && isSolvedEquation(current, variable, expectedSolution);
    const classification = equivalent
      ? solved ? "solution_reached" : "equivalent_transformation"
      : classifyInvalidTransformation(previous, current, expectedSolution);
    stepResults.push(stepResult({
      index,
      checkpoint: checkpoints[index],
      actual: submitted[index],
      correct: equivalent,
      classification,
      normalizedEquation: current.normalized,
    }));
    previous = current;
  }

  const firstIncorrectStep = stepResults.find((step) => !step.correct)?.index ?? null;
  if (hasUnsupportedStep) {
    return mathStepDecision({
      submitted,
      correct: false,
      evidenceEligible: false,
      reason: "math_step_parse_failed",
      firstIncorrectStep,
      steps: stepResults,
      explanation: feedbackForClassification(stepResults[firstIncorrectStep]?.classification),
      initialEquation: contract.initialEquation,
      expectedSolution: rationalText(expectedSolution),
    });
  }
  const finalSolved = firstIncorrectStep === null
    && isSolvedEquation(parsedSteps.at(-1), variable, expectedSolution);
  const correct = firstIncorrectStep === null && finalSolved;
  const classification = firstIncorrectStep === null
    ? finalSolved ? "solution_reached" : "solution_not_isolated"
    : stepResults[firstIncorrectStep].classification;
  return mathStepDecision({
    submitted,
    checkpoints,
    correct,
    evidenceEligible: true,
    reason: correct ? "semantic_steps_valid" : firstIncorrectStep === null ? "math_solution_incomplete" : "math_step_invalid_transformation",
    firstIncorrectStep,
    steps: stepResults,
    explanation: correct ? "每一步都与原方程等价，且最终解正确。" : feedbackForClassification(classification),
    initialEquation: contract.initialEquation,
    expectedSolution: rationalText(expectedSolution),
  });
}

export function parseLinearEquation(value, { variable = "x" } = {}) {
  const normalized = normalizeMathStep(value);
  const parts = normalized.split("=");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, classification: "equation_expected", normalized };
  }
  try {
    const left = parseLinearExpression(parts[0], variable);
    const right = parseLinearExpression(parts[1], variable);
    const difference = subtractPolynomial(left, right);
    if (isZeroRational(difference.coefficient)) {
      return { ok: false, classification: "degenerate_equation", normalized };
    }
    return { ok: true, normalized, left, right, difference };
  } catch (error) {
    return { ok: false, classification: error?.code ?? "invalid_expression", normalized };
  }
}

function parseLinearExpression(source, variable) {
  const tokens = algebraTokens(source);
  let cursor = 0;
  const expression = () => {
    let value = term();
    while (tokens[cursor] === "+" || tokens[cursor] === "-") {
      const operator = tokens[cursor++];
      value = operator === "+" ? addPolynomial(value, term()) : subtractPolynomial(value, term());
    }
    return value;
  };
  const term = () => {
    let value = factor();
    while (["*", "/"].includes(tokens[cursor])) {
      const operator = tokens[cursor++];
      value = operator === "*" ? multiplyPolynomial(value, factor()) : dividePolynomial(value, factor());
    }
    return value;
  };
  const factor = () => {
    if (tokens[cursor] === "+") { cursor += 1; return factor(); }
    if (tokens[cursor] === "-") { cursor += 1; return scalePolynomial(factor(), { numerator: -1n, denominator: 1n }); }
    if (tokens[cursor] === "(") {
      cursor += 1;
      const value = expression();
      if (tokens[cursor++] !== ")") throw mathParseError("unclosed_parenthesis");
      return value;
    }
    const token = tokens[cursor++];
    if (/^\d+(?:\.\d+)?$/.test(token ?? "")) return constantPolynomial(decimalRational(token));
    if (/^[a-z]+$/.test(token ?? "")) {
      if (token !== variable) throw mathParseError("unknown_variable");
      return variablePolynomial();
    }
    throw mathParseError("invalid_expression");
  };
  const result = expression();
  if (cursor !== tokens.length) throw mathParseError("unexpected_token");
  return result;
}

function algebraTokens(source) {
  const compact = String(source ?? "").replace(/\s+/g, "");
  const raw = compact.match(/\d+(?:\.\d+)?|[a-z]+|[()+\-*/]/g) ?? [];
  if (!compact || raw.join("") !== compact) throw mathParseError("invalid_expression");
  const tokens = [];
  for (const token of raw) {
    const previous = tokens.at(-1);
    const previousCanMultiply = previous && (/^\d/.test(previous) || /^[a-z]+$/.test(previous) || previous === ")");
    const nextCanMultiply = /^\d/.test(token) || /^[a-z]+$/.test(token) || token === "(";
    if (previousCanMultiply && nextCanMultiply) tokens.push("*");
    tokens.push(token);
  }
  return tokens;
}

function equivalentLinearEquations(left, right) {
  if (!equationHasUniqueSolution(left) || !equationHasUniqueSolution(right)) return false;
  const a = left.difference;
  const b = right.difference;
  return rationalEquals(
    multiplyRational(a.coefficient, b.constant),
    multiplyRational(b.coefficient, a.constant),
  );
}

function equationHasUniqueSolution(equation) {
  return equation?.ok === true && !isZeroRational(equation.difference.coefficient);
}

function equationSolution(equation) {
  return divideRational(negateRational(equation.difference.constant), equation.difference.coefficient);
}

function isSolvedEquation(equation, variable, expectedSolution) {
  if (!equationHasUniqueSolution(equation) || !rationalEquals(equationSolution(equation), expectedSolution)) return false;
  const variableSide = (side) => rationalEquals(side.coefficient, { numerator: 1n, denominator: 1n }) && isZeroRational(side.constant);
  const constantSide = (side) => isZeroRational(side.coefficient) && rationalEquals(side.constant, expectedSolution);
  return (variableSide(equation.left) && constantSide(equation.right))
    || (constantSide(equation.left) && variableSide(equation.right));
}

function classifyInvalidTransformation(previous, current, expectedSolution) {
  const sameLeft = samePolynomial(previous.left, current.left);
  const sameRight = samePolynomial(previous.right, current.right);
  if (sameLeft !== sameRight) return "single_side_change";
  const currentSolution = equationSolution(current);
  if (rationalEquals(currentSolution, negateRational(expectedSolution))) return "sign_error";
  if (rationalEquals(previous.difference.coefficient, current.difference.coefficient)) return "arithmetic_error";
  return "non_equivalent_transformation";
}

function mathStepDecision({ submitted, correct, evidenceEligible, reason, firstIncorrectStep, steps, explanation, initialEquation, expectedSolution }) {
  return {
    accepted: true,
    correct,
    responseKind: "answer",
    normalizedAnswer: submitted.join("\n"),
    reason,
    evidenceEligible,
    evidenceTier: evidenceEligible ? "deterministic_math_steps_v2" : "practice_only",
    confidence: evidenceEligible ? 1 : 0,
    evaluation: {
      profile: MATH_STEP_EVALUATOR_VERSION,
      passedCount: steps.filter((item) => item.correct).length,
      totalCount: steps.length,
      firstIncorrectStep,
      initialEquation: normalizeMathStep(initialEquation),
      expectedSolution,
      steps,
      explanation,
      requiresReview: !evidenceEligible,
    },
  };
}

function stepResult({ index, checkpoint, actual, correct, classification, normalizedEquation = null }) {
  return {
    index,
    displayIndex: index + 1,
    id: checkpoint?.id ?? `step-${index + 1}`,
    correct,
    actual,
    normalizedEquation: normalizedEquation ?? actual,
    classification,
    matchedAuthoredForm: (checkpoint?.acceptedForms ?? []).map(normalizeMathStep).includes(actual),
    feedback: correct ? "这一步与前一步等价。" : feedbackForClassification(classification, checkpoint?.feedback),
  };
}

function feedbackForClassification(classification, fallback = null) {
  return {
    equation_expected: "每一步都需要写成一个等式。",
    invalid_expression: "这一步包含当前判题器不支持的数学表达式。",
    unknown_variable: "这一步引入了题目中没有的未知数。",
    nonlinear_expression: "当前步骤判题只支持单变量一次方程。",
    division_by_zero: "等式变形不能除以零。",
    degenerate_equation: "这一步丢失了原方程的唯一解。",
    single_side_change: "只改变等式一边会破坏平衡；两边必须进行等价操作。",
    sign_error: "请检查移项或去括号时的符号变化。",
    arithmetic_error: "等式结构接近，但常数运算结果不一致。",
    non_equivalent_transformation: fallback ?? "这一步与前一个等式不等价。",
    solution_not_isolated: "过程目前等价，但还需要把未知数单独写在等号一边。",
  }[classification] ?? fallback ?? "请检查这一步的等式变形。";
}

function constantPolynomial(constant) {
  return { coefficient: { numerator: 0n, denominator: 1n }, constant };
}

function variablePolynomial() {
  return { coefficient: { numerator: 1n, denominator: 1n }, constant: { numerator: 0n, denominator: 1n } };
}

function addPolynomial(left, right) {
  return { coefficient: addRational(left.coefficient, right.coefficient), constant: addRational(left.constant, right.constant) };
}

function subtractPolynomial(left, right) {
  return { coefficient: subtractRational(left.coefficient, right.coefficient), constant: subtractRational(left.constant, right.constant) };
}

function multiplyPolynomial(left, right) {
  if (!isZeroRational(left.coefficient) && !isZeroRational(right.coefficient)) throw mathParseError("nonlinear_expression");
  return {
    coefficient: addRational(multiplyRational(left.coefficient, right.constant), multiplyRational(right.coefficient, left.constant)),
    constant: multiplyRational(left.constant, right.constant),
  };
}

function dividePolynomial(left, right) {
  if (!isZeroRational(right.coefficient)) throw mathParseError("nonlinear_expression");
  if (isZeroRational(right.constant)) throw mathParseError("division_by_zero");
  return scalePolynomial(left, divideRational({ numerator: 1n, denominator: 1n }, right.constant));
}

function scalePolynomial(value, scalar) {
  return { coefficient: multiplyRational(value.coefficient, scalar), constant: multiplyRational(value.constant, scalar) };
}

function samePolynomial(left, right) {
  return rationalEquals(left.coefficient, right.coefficient) && rationalEquals(left.constant, right.constant);
}

function addRational(left, right) { return calculate(left, right, "+"); }
function subtractRational(left, right) { return calculate(left, right, "-"); }
function multiplyRational(left, right) { return calculate(left, right, "*"); }
function divideRational(left, right) { return calculate(left, right, "/"); }
function negateRational(value) { return normalizeRational(-value.numerator, value.denominator); }
function isZeroRational(value) { return value.numerator === 0n; }

function mathParseError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function parseRationalAnswer(value, { allowVariableAssignment = false } = {}) {
  let input = String(value ?? "")
    .trim()
    .replace(/[−–—]/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, "");
  if (allowVariableAssignment) {
    const match = input.match(/^[xXｘ]=(.+)$/);
    if (match) input = match[1];
  }
  if (!input || /[^0-9+\-*/().]/.test(input)) return null;
  try {
    const tokens = tokenize(input);
    let cursor = 0;
    const parseExpression = () => {
      let value = parseTerm();
      while (tokens[cursor] === "+" || tokens[cursor] === "-") {
        const operator = tokens[cursor++];
        value = calculate(value, parseTerm(), operator);
      }
      return value;
    };
    const parseTerm = () => {
      let value = parseFactor();
      while (tokens[cursor] === "*" || tokens[cursor] === "/") {
        const operator = tokens[cursor++];
        value = calculate(value, parseFactor(), operator);
      }
      return value;
    };
    const parseFactor = () => {
      if (tokens[cursor] === "+") { cursor += 1; return parseFactor(); }
      if (tokens[cursor] === "-") { cursor += 1; return calculate({ numerator: 0n, denominator: 1n }, parseFactor(), "-"); }
      if (tokens[cursor] === "(") {
        cursor += 1;
        const value = parseExpression();
        if (tokens[cursor++] !== ")") throw new Error("unclosed_parenthesis");
        return value;
      }
      const token = tokens[cursor++];
      if (!/^\d+(?:\.\d+)?$/.test(token ?? "")) throw new Error("number_expected");
      return decimalRational(token);
    };
    const result = parseExpression();
    if (cursor !== tokens.length) return null;
    return normalizeRational(result.numerator, result.denominator);
  } catch {
    return null;
  }
}

export function rationalText(value) {
  return value.denominator === 1n ? String(value.numerator) : `${value.numerator}/${value.denominator}`;
}

export function rationalEquals(left, right) {
  const a = coerceRational(left);
  const b = coerceRational(right);
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

export function rationalToJSON(value) {
  return { numerator: String(value.numerator), denominator: String(value.denominator) };
}

function coerceRational(value) {
  if (!value || typeof value !== "object") return { numerator: 0n, denominator: 1n };
  return {
    numerator: typeof value.numerator === "bigint" ? value.numerator : BigInt(value.numerator ?? 0),
    denominator: typeof value.denominator === "bigint" ? value.denominator : BigInt(value.denominator ?? 1),
  };
}

function tokenize(input) {
  const tokens = input.match(/\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
  if (tokens.join("") !== input) throw new Error("invalid_token");
  return tokens;
}

function decimalRational(token) {
  const [whole, decimal = ""] = token.split(".");
  const denominator = 10n ** BigInt(decimal.length);
  return normalizeRational(BigInt(`${whole}${decimal}`), denominator);
}

function calculate(left, right, operator) {
  if (operator === "+") return normalizeRational(left.numerator * right.denominator + right.numerator * left.denominator, left.denominator * right.denominator);
  if (operator === "-") return normalizeRational(left.numerator * right.denominator - right.numerator * left.denominator, left.denominator * right.denominator);
  if (operator === "*") return normalizeRational(left.numerator * right.numerator, left.denominator * right.denominator);
  if (right.numerator === 0n) throw new Error("division_by_zero");
  return normalizeRational(left.numerator * right.denominator, left.denominator * right.numerator);
}

function normalizeRational(numerator, denominator) {
  if (denominator === 0n) throw new Error("division_by_zero");
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: (numerator / divisor) * sign, denominator: (denominator / divisor) * sign };
}

function greatestCommonDivisor(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

function normalizeMathStep(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[−–—]/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/\s+/g, "");
}
