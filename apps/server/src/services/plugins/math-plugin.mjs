// Math subject plugin: deterministic grading of rational expressions and
// multiple choice. The plugin owns the expression parser (BigInt rationals so
// "1/2", "0.5", "2/4" grade equal) and declares its capability boundary —
// no speech evaluation. Multi-step answers are checked against immutable,
// author-reviewed checkpoints; arbitrary symbolic code is never evaluated.

export const MATH_SUBJECT_ID = "math";

const CHOICE_ID_PATTERN = /^[a-z0-9]{1,12}$/;

export const mathSubjectPlugin = Object.freeze({
  subjectId: MATH_SUBJECT_ID,
  version: "1.1.0",
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
