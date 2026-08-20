const KNOWLEDGE_ORDER = ["integer", "equation-meaning", "balance", "word-problem"];
const PREREQUISITE = {
  "equation-meaning": "integer",
  balance: "equation-meaning",
  "word-problem": "balance",
};

export const DIAGNOSTIC_MIN_QUESTIONS = 12;
export const DIAGNOSTIC_MAX_QUESTIONS = 18;
export const DIAGNOSTIC_TARGET_SECONDS = 10 * 60;

const DIAGNOSTIC_QUESTIONS = [
  numericQuestion("diag-int-01-v1", "integer", 1, "6 - 9 = ?", "-3"),
  numericQuestion("diag-int-02-v1", "integer", 2, "-4 + 7 = ?", "3"),
  numericQuestion("diag-int-03-v1", "integer", 3, "8 - (-5) = ?", "13"),
  choiceQuestion("diag-eqm-01-v1", "equation-meaning", 1, "下面哪一个是方程？", [
    { id: "a", label: "3 + 5 = 8" },
    { id: "b", label: "x + 3 = 8" },
    { id: "c", label: "7 > 4" },
  ], "b"),
  numericQuestion("diag-eqm-02-v1", "equation-meaning", 2, "x + 4 = 9，x 是多少？", "5", { allowVariableAssignment: true }),
  numericQuestion("diag-eqm-03-v1", "equation-meaning", 3, "3x = 12，x 是多少？", "4", { allowVariableAssignment: true }),
  choiceQuestion("diag-bal-01-v1", "balance", 1, "x + 3 = 8。为了保持等式平衡，下一步应该怎么做？", [
    { id: "a", label: "只把左边减 3" },
    { id: "b", label: "两边同时减 3" },
    { id: "c", label: "两边同时加 3" },
  ], "b"),
  numericQuestion("diag-bal-02-v1", "balance", 2, "2x = 10，x 是多少？", "5", { allowVariableAssignment: true }),
  numericQuestion("diag-bal-03-v1", "balance", 3, "2(x + 1) = 8，x 是多少？", "3", { allowVariableAssignment: true }),
  numericQuestion("diag-word-01-v1", "word-problem", 1, "一个数加 3 等于 8，这个数是多少？", "5"),
  numericQuestion("diag-word-02-v1", "word-problem", 2, "3 支相同的铅笔一共 12 元，每支多少元？", "4"),
  numericQuestion("diag-word-03-v1", "word-problem", 3, "长方形的长比宽多 3，周长是 18。宽是多少？", "3"),
];

const DAILY_QUESTIONS = [
  numericQuestion("demo-balance-001-v1", "balance", 2, "x + 3 = 8，x 是多少？", "5", { allowVariableAssignment: true }),
];

const TUTORING_QUESTIONS = [
  numericQuestion("tutor-int-recall-001-v1", "integer", 1, "4 - 7 = ?", "-3"),
  numericQuestion("tutor-int-guided-001-v1", "integer", 2, "-5 + 9 = ?", "4"),
  numericQuestion("tutor-int-transfer-001-v1", "integer", 3, "12 - (-4) = ?", "16"),
  choiceQuestion("tutor-eqm-recall-001-v1", "equation-meaning", 1, "下面哪一个含有未知数并且是等式？", [
    { id: "a", label: "6 + 2 = 8" },
    { id: "b", label: "x + 2 = 8" },
    { id: "c", label: "9 > 3" },
  ], "b"),
  numericQuestion("tutor-eqm-guided-001-v1", "equation-meaning", 2, "x + 6 = 11，x 是多少？", "5", { allowVariableAssignment: true }),
  numericQuestion("tutor-eqm-transfer-001-v1", "equation-meaning", 3, "4x = 28，x 是多少？", "7", { allowVariableAssignment: true }),
  numericQuestion("tutor-bal-recall-001-v1", "balance", 1, "2x = 10，x 是多少？", "5", { allowVariableAssignment: true }),
  numericQuestion("tutor-bal-guided-001-v1", "balance", 2, "x + 3 = 8，x 是多少？", "5", { allowVariableAssignment: true }),
  numericQuestion("tutor-bal-transfer-001-v1", "balance", 3, "3x + 2 = 17，x 是多少？", "5", { allowVariableAssignment: true }),
  numericQuestion("tutor-word-recall-001-v1", "word-problem", 1, "一个数加 4 等于 9，这个数是多少？", "5"),
  numericQuestion("tutor-word-guided-001-v1", "word-problem", 2, "3 本相同的练习册共 18 元，每本多少元？", "6"),
  numericQuestion("tutor-word-transfer-001-v1", "word-problem", 3, "一个数的 2 倍再加 3 等于 17，这个数是多少？", "7"),
];

const QUESTION_BY_ID = new Map([
  ...DIAGNOSTIC_QUESTIONS.map((question) => ({ ...question, context: "diagnostic" })),
  ...DAILY_QUESTIONS.map((question) => ({ ...question, context: "practice" })),
  ...TUTORING_QUESTIONS.map((question) => ({ ...question, context: "tutoring" })),
].map((question) => [question.id, question]));

export function privateTutorQuestion(revisionId) {
  return QUESTION_BY_ID.get(revisionId) ?? null;
}

export function initialDiagnosticQuestion() {
  return publicQuestion(QUESTION_BY_ID.get("diag-eqm-02-v1"));
}

export function publicQuestion(question) {
  if (!question) return null;
  return {
    revisionId: question.id,
    knowledgeId: question.knowledgeId,
    difficulty: question.difficulty,
    kind: question.kind,
    prompt: question.prompt,
    options: question.options?.map(({ id, label }) => ({ id, label })) ?? null,
  };
}

export function judgePrivateTutorAnswer(questionRevisionId, { rawAnswer, responseKind = "answer" } = {}) {
  const question = privateTutorQuestion(questionRevisionId);
  if (!question) return { accepted: false, error: "private_tutor_question_revision_not_found" };
  if (responseKind === "dont_know") {
    return { accepted: true, correct: false, responseKind, normalizedAnswer: null, reason: "dont_know" };
  }
  if (responseKind !== "answer") return { accepted: false, error: "invalid_private_tutor_response_kind" };
  if (question.kind === "choice") {
    const normalizedAnswer = String(rawAnswer ?? "").trim().toLowerCase();
    if (!question.options.some((option) => option.id === normalizedAnswer)) {
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
}

export function selectNextDiagnosticQuestion(answerSummaries) {
  const answeredIds = new Set(answerSummaries.map((answer) => answer.questionRevisionId));
  if (answerSummaries.length >= DIAGNOSTIC_MAX_QUESTIONS) return null;
  const last = answerSummaries.at(-1);
  if (last && !last.correct) {
    const prerequisiteId = PREREQUISITE[last.knowledgeId];
    const prerequisite = diagnosticCandidates(prerequisiteId, answeredIds)
      .sort((a, b) => a.difficulty - b.difficulty)[0];
    if (prerequisite) return publicQuestion(prerequisite);
    const easierSame = diagnosticCandidates(last.knowledgeId, answeredIds)
      .filter((question) => question.difficulty <= last.difficulty)
      .sort((a, b) => a.difficulty - b.difficulty)[0];
    if (easierSame) return publicQuestion(easierSame);
  }

  const counts = diagnosticCounts(answerSummaries);
  const unmeasured = KNOWLEDGE_ORDER.find((knowledgeId) => counts.get(knowledgeId).attempts === 0);
  if (unmeasured) return publicQuestion(anchorQuestion(unmeasured, answeredIds));

  if (answerSummaries.length >= DIAGNOSTIC_MIN_QUESTIONS
    && KNOWLEDGE_ORDER.every((knowledgeId) => counts.get(knowledgeId).attempts >= 2)) return null;

  const rankedKnowledge = [...KNOWLEDGE_ORDER].sort((left, right) => {
    const a = counts.get(left);
    const b = counts.get(right);
    if (a.attempts !== b.attempts) return a.attempts - b.attempts;
    const uncertaintyA = Math.abs((a.correct / a.attempts) - 0.5);
    const uncertaintyB = Math.abs((b.correct / b.attempts) - 0.5);
    return uncertaintyA - uncertaintyB;
  });
  for (const knowledgeId of rankedKnowledge) {
    const candidates = diagnosticCandidates(knowledgeId, answeredIds);
    if (!candidates.length) continue;
    const summary = counts.get(knowledgeId);
    const targetDifficulty = summary.correct === summary.attempts ? 3 : summary.correct === 0 ? 1 : 2;
    candidates.sort((a, b) => Math.abs(a.difficulty - targetDifficulty) - Math.abs(b.difficulty - targetDifficulty));
    return publicQuestion(candidates[0]);
  }
  return null;
}

export function buildDiagnosticResult(answerSummaries) {
  const knowledge = KNOWLEDGE_ORDER.map((knowledgeId) => {
    const answers = answerSummaries.filter((answer) => answer.knowledgeId === knowledgeId);
    if (!answers.length) return { knowledgeId, mastery: null, level: "unknown", evidenceCount: 0, correctCount: 0, dontKnowCount: 0 };
    const correctCount = answers.filter((answer) => answer.correct).length;
    const dontKnowCount = answers.filter((answer) => answer.responseKind === "dont_know").length;
    const averageDifficulty = answers.reduce((sum, answer) => sum + answer.difficulty, 0) / answers.length;
    const mastery = clamp(Number((0.35 + 0.5 * (correctCount / answers.length) + 0.05 * (averageDifficulty - 2)).toFixed(2)), 0.2, 0.95);
    const level = mastery >= 0.8 ? "mastered" : mastery >= 0.5 ? "learning" : "needs_support";
    return { knowledgeId, mastery, level, evidenceCount: answers.length, correctCount, dontKnowCount };
  });
  return {
    knowledge,
    strengths: knowledge.filter((item) => item.level === "mastered").map((item) => item.knowledgeId),
    focus: knowledge.filter((item) => item.level === "needs_support").map((item) => item.knowledgeId),
    answeredCount: answerSummaries.length,
  };
}

function numericQuestion(id, knowledgeId, difficulty, prompt, expected, options = {}) {
  return { id, knowledgeId, difficulty, prompt, kind: "numeric", expectedRational: parseRationalAnswer(expected), ...options };
}

function choiceQuestion(id, knowledgeId, difficulty, prompt, options, expectedChoice) {
  return { id, knowledgeId, difficulty, prompt, kind: "choice", options, expectedChoice };
}

function diagnosticCandidates(knowledgeId, answeredIds) {
  if (!knowledgeId) return [];
  return DIAGNOSTIC_QUESTIONS.filter((question) => question.knowledgeId === knowledgeId && !answeredIds.has(question.id));
}

function anchorQuestion(knowledgeId, answeredIds) {
  return diagnosticCandidates(knowledgeId, answeredIds).sort((a, b) => Math.abs(a.difficulty - 2) - Math.abs(b.difficulty - 2))[0] ?? null;
}

function diagnosticCounts(answers) {
  return new Map(KNOWLEDGE_ORDER.map((knowledgeId) => {
    const matching = answers.filter((answer) => answer.knowledgeId === knowledgeId);
    return [knowledgeId, { attempts: matching.length, correct: matching.filter((answer) => answer.correct).length }];
  }));
}

function parseRationalAnswer(value, { allowVariableAssignment = false } = {}) {
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

function rationalEquals(left, right) {
  return left.numerator === right.numerator && left.denominator === right.denominator;
}

function rationalText(value) {
  return value.denominator === 1n ? String(value.numerator) : `${value.numerator}/${value.denominator}`;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
