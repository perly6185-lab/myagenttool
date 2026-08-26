export const PROGRAMMING_SUBJECT_ID = "programming";

const MAX_SOURCE_LENGTH = 1_000;
const MAX_AST_NODES = 128;
const MAX_TESTS = 20;

export const programmingSubjectPlugin = Object.freeze({
  subjectId: PROGRAMMING_SUBJECT_ID,
  version: "1.0.0",
  visualTemplates: [],
  getCapabilities() {
    return {
      deterministicGrading: true,
      stepEvaluation: false,
      speechEvaluation: false,
      codeExecution: true,
      sandboxProfile: "restricted_expression_v1",
      visualInteractions: false,
      supportedQuestionKinds: ["choice", "code"],
    };
  },
  evaluator(input, question) {
    if (input.responseKind === "dont_know") {
      return { accepted: true, correct: false, responseKind: "dont_know", normalizedAnswer: null, reason: "dont_know", evidenceEligible: true, evidenceTier: "deterministic" };
    }
    if (question.kind === "choice") return evaluateChoice(input, question);
    if (question.kind !== "code") return { accepted: false, error: "private_tutor_question_kind_unsupported" };
    if (input.responseKind !== "answer") return { accepted: false, error: "invalid_private_tutor_response_kind" };
    return evaluateRestrictedCode(input.rawAnswer, question);
  },
});

export function evaluateRestrictedCode(rawSource, question) {
  const source = String(rawSource ?? "").trim();
  if (!source || source.length > MAX_SOURCE_LENGTH) return { accepted: false, error: "private_tutor_code_sandbox_rejected" };
  const parameters = Array.isArray(question.parameters) ? question.parameters : [];
  if (!parameters.length || parameters.some((item) => !/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(item))) {
    return { accepted: false, error: "private_tutor_code_contract_invalid" };
  }
  const expression = extractReturnExpression(source, question.functionName, parameters);
  if (!expression) return { accepted: false, error: "private_tutor_code_sandbox_rejected" };

  let ast;
  try {
    ast = parseExpression(expression, new Set(parameters));
  } catch {
    return { accepted: false, error: "private_tutor_code_sandbox_rejected" };
  }
  const tests = Array.isArray(question.tests) ? question.tests.slice(0, MAX_TESTS) : [];
  if (!tests.length) return { accepted: false, error: "private_tutor_code_contract_invalid" };
  const results = tests.map((testCase, index) => {
    const scope = Object.fromEntries(parameters.map((name, parameterIndex) => [name, Number(testCase.args?.[parameterIndex])]));
    try {
      const actual = evaluateAst(ast, scope);
      const expected = Number(testCase.expected);
      const passed = Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) < 1e-9;
      return { index, passed, args: parameters.map((name) => scope[name]), expected, actual };
    } catch (error) {
      return { index, passed: false, args: parameters.map((name) => scope[name]), expected: Number(testCase.expected), actual: null, error: error.message };
    }
  });
  const passedCount = results.filter((item) => item.passed).length;
  const correct = passedCount === results.length;
  return {
    accepted: true,
    correct,
    responseKind: "answer",
    normalizedAnswer: source,
    reason: correct ? "all_sandbox_tests_passed" : "sandbox_tests_failed",
    evidenceEligible: true,
    evidenceTier: "deterministic_sandbox",
    evaluation: {
      sandboxProfile: "restricted_expression_v1",
      passedCount,
      totalCount: results.length,
      tests: results,
      explanation: correct ? "全部受限沙箱测试通过。" : `有 ${results.length - passedCount} 个测试未通过，请检查返回表达式。`,
    },
  };
}

function extractReturnExpression(source, functionName, parameters) {
  const escapedName = String(functionName ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declared = source.match(new RegExp(`^function\\s+${escapedName}\\s*\\(([^)]*)\\)\\s*\\{\\s*return\\s+([^;{}]+);?\\s*\\}$`));
  if (declared) {
    const declaredParameters = declared[1].split(",").map((item) => item.trim()).filter(Boolean);
    return sameArray(declaredParameters, parameters) ? declared[2].trim() : null;
  }
  const returned = source.match(/^return\s+([^;{}]+);?$/);
  return returned ? returned[1].trim() : null;
}

function parseExpression(source, allowedIdentifiers) {
  const tokens = source.match(/\d+(?:\.\d+)?|[a-zA-Z][a-zA-Z0-9_]*|[()+\-*/%]/g) ?? [];
  if (tokens.join("") !== source.replace(/\s+/g, "")) throw new Error("invalid_token");
  let cursor = 0;
  let nodeCount = 0;
  const node = (value) => {
    nodeCount += 1;
    if (nodeCount > MAX_AST_NODES) throw new Error("expression_too_complex");
    return value;
  };
  const expression = () => {
    let left = term();
    while (tokens[cursor] === "+" || tokens[cursor] === "-") left = node({ type: "binary", operator: tokens[cursor++], left, right: term() });
    return left;
  };
  const term = () => {
    let left = factor();
    while (["*", "/", "%"].includes(tokens[cursor])) left = node({ type: "binary", operator: tokens[cursor++], left, right: factor() });
    return left;
  };
  const factor = () => {
    if (tokens[cursor] === "+" || tokens[cursor] === "-") return node({ type: "unary", operator: tokens[cursor++], value: factor() });
    if (tokens[cursor] === "(") {
      cursor += 1;
      const value = expression();
      if (tokens[cursor++] !== ")") throw new Error("unclosed_parenthesis");
      return value;
    }
    const token = tokens[cursor++];
    if (/^\d/.test(token ?? "")) return node({ type: "number", value: Number(token) });
    if (allowedIdentifiers.has(token)) return node({ type: "identifier", name: token });
    throw new Error("unknown_identifier");
  };
  const ast = expression();
  if (cursor !== tokens.length) throw new Error("unexpected_token");
  return ast;
}

function evaluateAst(ast, scope) {
  if (ast.type === "number") return ast.value;
  if (ast.type === "identifier") return boundedNumber(scope[ast.name]);
  if (ast.type === "unary") return boundedNumber(ast.operator === "-" ? -evaluateAst(ast.value, scope) : evaluateAst(ast.value, scope));
  const left = evaluateAst(ast.left, scope);
  const right = evaluateAst(ast.right, scope);
  if ((ast.operator === "/" || ast.operator === "%") && right === 0) throw new Error("division_by_zero");
  if (ast.operator === "+") return boundedNumber(left + right);
  if (ast.operator === "-") return boundedNumber(left - right);
  if (ast.operator === "*") return boundedNumber(left * right);
  if (ast.operator === "/") return boundedNumber(left / right);
  return boundedNumber(left % right);
}

function boundedNumber(value) {
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000) throw new Error("numeric_limit_exceeded");
  return value;
}

function evaluateChoice(input, question) {
  const normalized = String(input.rawAnswer ?? "").trim().toLowerCase();
  if (input.responseKind !== "answer" || !question.options?.some((item) => item.id === normalized)) return { accepted: false, error: "invalid_private_tutor_answer_format" };
  const correct = normalized === question.expectedChoice;
  return { accepted: true, correct, responseKind: "answer", normalizedAnswer: normalized, reason: correct ? "exact_choice" : "different_choice", evidenceEligible: true, evidenceTier: "deterministic" };
}

function sameArray(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
