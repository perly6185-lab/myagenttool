import { privateTutorPackageRegistryFromState } from "./private-tutor-package-registry.mjs";
import { finalizePrivateTutorEvaluation } from "./private-tutor-evaluation-contract.mjs";
import {
  applyPrivateTutorRuntimeEvidencePolicy,
  privateTutorRuntimeValidation,
} from "./private-tutor-adaptive-runtime.mjs";

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

const REVIEW_QUESTIONS = [
  numericQuestion("review-int-similar-001-v1", "integer", 2, "-3 + 8 = ?", "5"),
  numericQuestion("review-int-variation-001-v1", "integer", 3, "15 - (-6) = ?", "21"),
  choiceQuestion("review-eqm-similar-001-v1", "equation-meaning", 2, "下面哪一个是含未知数的等式？", [
    { id: "a", label: "4 + 5 = 9" },
    { id: "b", label: "y - 2 = 6" },
    { id: "c", label: "10 > 7" },
  ], "b"),
  numericQuestion("review-eqm-variation-001-v1", "equation-meaning", 3, "3y = 24，y 是多少？", "8", { allowVariableAssignment: true }),
  numericQuestion("review-bal-similar-001-v1", "balance", 2, "x + 7 = 12，x 是多少？", "5", { allowVariableAssignment: true }),
  numericQuestion("review-bal-variation-001-v1", "balance", 3, "4x - 3 = 17，x 是多少？", "5", { allowVariableAssignment: true }),
  numericQuestion("review-word-similar-001-v1", "word-problem", 2, "4 本相同的本子共 28 元，每本多少元？", "7"),
  numericQuestion("review-word-variation-001-v1", "word-problem", 3, "一个数的 3 倍加 2 等于 23，这个数是多少？", "7"),
];

const QUESTION_BY_ID = new Map([
  ...DIAGNOSTIC_QUESTIONS.map((question) => ({ ...question, context: "diagnostic" })),
  ...DAILY_QUESTIONS.map((question) => ({ ...question, context: "practice" })),
  ...TUTORING_QUESTIONS.map((question) => ({ ...question, context: "tutoring" })),
  ...REVIEW_QUESTIONS.map((question) => ({ ...question, context: "review" })),
].map((question) => [question.id, question]));

export function privateTutorQuestion(revisionId, state, packageId = null) {
  if (packageId && state) return runtimeQuestion(revisionId, state, packageId);
  if (state?.privateTutorQuestionRevisions) {
    const revision = state.privateTutorQuestionRevisions.find((row) => row.id === revisionId);
    return revision && isPrivateTutorQuestionRevisionUsable(state, revision.id) ? questionFromRevision(revision) : null;
  }
  return QUESTION_BY_ID.get(revisionId) ?? null;
}

export function privateTutorReviewQuestion(knowledgeId, phase, state, packageId = null) {
  if (packageId && state) {
    const runtime = packageRuntime(state, packageId);
    const knowledge = runtime?.knowledge.find((item) => item.id === knowledgeId);
    if (!knowledge) return null;
    const questions = knowledge.reviewQuestions ?? [];
    const index = phase === "variation" || phase === "delayed" ? 1 : 0;
    return publicQuestion(resolveRuntimeCatalogQuestion(questions[index] ?? questions.at(-1), state, runtime));
  }
  const suffix = phase === "variation" || phase === "delayed" ? "variation" : "similar";
  const prefix = {
    integer: "int",
    "equation-meaning": "eqm",
    balance: "bal",
    "word-problem": "word",
  }[knowledgeId];
  return prefix ? publicQuestion(resolveCatalogQuestion(QUESTION_BY_ID.get(`review-${prefix}-${suffix}-001-v1`), state)) : null;
}

export function initialDiagnosticQuestion(state, packageId = null) {
  if (packageId && state) {
    const runtime = packageRuntime(state, packageId);
    if (!runtime) return null;
    const anchorKnowledge = runtime.knowledge[1] ?? runtime.knowledge[0];
    const candidates = runtimeDiagnosticCandidates(runtime, anchorKnowledge?.id, new Set(), state);
    candidates.sort((left, right) => Math.abs(left.difficulty - 2) - Math.abs(right.difficulty - 2));
    return publicQuestion(candidates[0] ?? null);
  }
  return publicQuestion(resolveCatalogQuestion(QUESTION_BY_ID.get("diag-eqm-02-v1"), state));
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
    ...(Array.isArray(question.requiredSourceRefs) && question.requiredSourceRefs.length > 0
      ? { requiredSourceRefs: [...question.requiredSourceRefs] }
      : {}),
    ...(Array.isArray(question.sourceRefs) && question.sourceRefs.length > 0
      ? {
          sourceRefs: question.sourceRefs.map((ref) => ({
            sectionId: ref.sectionId,
            pageNumber: ref.pageNumber ?? null,
            origin: ref.origin ?? null,
          })),
        }
      : {}),
    contentPackageId: question.contentPackageId ?? null,
    contentPackageVersion: question.contentPackageVersion ?? null,
    subjectId: question.subjectId ?? null,
  };
}

export function judgePrivateTutorAnswer(questionRevisionId, input = {}, state, packageId = null) {
  const { rawAnswer, responseKind = "answer" } = input;
  const question = privateTutorQuestion(questionRevisionId, state, packageId);
  if (!question) return { accepted: false, error: "private_tutor_question_revision_not_found" };
  if (packageId && state) {
    const runtime = packageRuntime(state, packageId);
    if (!runtime?.plugin || runtime.plugin.getCapabilities?.().deterministicGrading !== true) {
      return { accepted: false, error: "private_tutor_subject_plugin_unavailable" };
    }
    try {
      const result = runtime.plugin.evaluator({ ...input, rawAnswer, responseKind }, question);
      return finalizePrivateTutorEvaluation({ result, plugin: runtime.plugin, question });
    } catch {
      return { accepted: false, error: "private_tutor_subject_plugin_failed" };
    }
  }
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

export function selectNextDiagnosticQuestion(answerSummaries, state, packageId = null) {
  if (packageId && state) return selectNextRuntimeDiagnosticQuestion(answerSummaries, state, packageId);
  const answeredIds = new Set(answerSummaries.map((answer) => answer.questionRevisionId));
  if (answerSummaries.length >= DIAGNOSTIC_MAX_QUESTIONS) return null;
  const last = answerSummaries.at(-1);
  if (last && !last.correct) {
    const prerequisiteId = PREREQUISITE[last.knowledgeId];
    const prerequisite = diagnosticCandidates(prerequisiteId, answeredIds, state)
      .sort((a, b) => a.difficulty - b.difficulty)[0];
    if (prerequisite) return publicQuestion(prerequisite);
    const easierSame = diagnosticCandidates(last.knowledgeId, answeredIds, state)
      .filter((question) => question.difficulty <= last.difficulty)
      .sort((a, b) => a.difficulty - b.difficulty)[0];
    if (easierSame) return publicQuestion(easierSame);
  }

  const counts = diagnosticCounts(answerSummaries);
  const unmeasured = KNOWLEDGE_ORDER.find((knowledgeId) => counts.get(knowledgeId).attempts === 0);
  if (unmeasured) return publicQuestion(anchorQuestion(unmeasured, answeredIds, state));

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
    const candidates = diagnosticCandidates(knowledgeId, answeredIds, state);
    if (!candidates.length) continue;
    const summary = counts.get(knowledgeId);
    const targetDifficulty = summary.correct === summary.attempts ? 3 : summary.correct === 0 ? 1 : 2;
    candidates.sort((a, b) => Math.abs(a.difficulty - targetDifficulty) - Math.abs(b.difficulty - targetDifficulty));
    return publicQuestion(candidates[0]);
  }
  return null;
}

export function buildDiagnosticResult(answerSummaries, state = null, packageId = null) {
  if (packageId && state) {
    const runtime = packageRuntime(state, packageId);
    if (!runtime) return { knowledge: [], strengths: [], focus: [], answeredCount: answerSummaries.length };
    return diagnosticResultForKnowledge(answerSummaries, runtime.knowledge.map((item) => item.id));
  }
  return diagnosticResultForKnowledge(answerSummaries, KNOWLEDGE_ORDER);
}

export function privateTutorDiagnosticConfig(state, packageId) {
  const runtime = packageRuntime(state, packageId);
  if (!runtime) return null;
  const questionCount = runtime.knowledge.reduce((total, item) => total + (item.diagnosticQuestions?.length ?? 0), 0);
  const runtimeValidated = runtime.package.sourceType === "user_material"
    && Boolean(privateTutorRuntimeValidation(state, runtime.package.id, runtime.package.version));
  if (!questionCount
    || (!runtimeValidated && runtime.package.evaluationCapabilities?.deterministicGrading !== true)
    || !runtime.plugin) return null;
  return {
    minQuestions: questionCount,
    maxQuestions: questionCount,
    targetSeconds: Math.max(120, Math.min(DIAGNOSTIC_TARGET_SECONDS, questionCount * 45)),
  };
}

function diagnosticResultForKnowledge(answerSummaries, knowledgeOrder) {
  const knowledge = knowledgeOrder.map((knowledgeId) => {
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

function packageRuntime(state, packageId) {
  const registry = privateTutorPackageRegistryFromState(state);
  const pkg = registry.getPackage(packageId);
  if (!pkg || (pkg.status != null && pkg.status !== "published")) return null;
  return {
    package: pkg,
    plugin: registry.getSubjectPlugin(pkg.evaluationSubjectId ?? pkg.subjectId),
    knowledge: pkg.knowledgeComponents ?? [],
  };
}

function runtimeQuestion(revisionId, state, packageId) {
  const runtime = packageRuntime(state, packageId);
  if (!runtime) return null;
  const governedRevision = state.privateTutorQuestionRevisions?.find((row) => row.id === revisionId);
  if (governedRevision && !isPrivateTutorQuestionRevisionUsable(state, governedRevision.id)) return null;
  const questionId = governedRevision?.questionId ?? revisionId;
  for (const knowledge of runtime.knowledge) {
    for (const [context, questions] of [
      ["diagnostic", knowledge.diagnosticQuestions],
      ["practice", knowledge.dailyQuestions],
      ["tutoring", knowledge.tutoringQuestions],
      ["review", knowledge.reviewQuestions],
    ]) {
      const question = (questions ?? []).find((item) => item.id === revisionId || item.questionId === questionId);
      if (!question) continue;
      const resolved = resolveRuntimeCatalogQuestion({ ...question, context }, state, runtime);
      return applyPrivateTutorRuntimeEvidencePolicy(state, runtime.package, resolved);
    }
  }
  return null;
}

function resolveRuntimeCatalogQuestion(question, state, runtime) {
  if (!question) return null;
  const hasGovernedRevision = state.privateTutorQuestionRevisions?.some((row) => row.questionId === question.questionId);
  const resolved = hasGovernedRevision ? resolveCatalogQuestion(question, state) : question;
  const materialized = resolved ? {
    ...resolved,
    context: question.context ?? resolved.context,
    contentPackageId: runtime.package.id,
    contentPackageVersion: runtime.package.version,
    subjectId: runtime.package.subjectId,
  } : null;
  return materialized ? applyPrivateTutorRuntimeEvidencePolicy(state, runtime.package, materialized) : null;
}

function runtimeDiagnosticCandidates(runtime, knowledgeId, answeredIds, state) {
  if (!knowledgeId) return [];
  const knowledge = runtime.knowledge.find((item) => item.id === knowledgeId);
  return (knowledge?.diagnosticQuestions ?? [])
    .map((question) => resolveRuntimeCatalogQuestion({ ...question, context: "diagnostic" }, state, runtime))
    .filter((question) => question && !answeredIds.has(question.id));
}

function selectNextRuntimeDiagnosticQuestion(answerSummaries, state, packageId) {
  const runtime = packageRuntime(state, packageId);
  if (!runtime) return null;
  const answeredIds = new Set(answerSummaries.map((answer) => answer.questionRevisionId));
  const availableCount = runtime.knowledge.reduce((total, item) => total + (item.diagnosticQuestions?.length ?? 0), 0);
  if (answerSummaries.length >= availableCount) return null;

  const last = answerSummaries.at(-1);
  if (last && !last.correct) {
    const current = runtime.knowledge.find((item) => item.id === last.knowledgeId);
    for (const prerequisiteId of current?.prerequisiteKnowledgeIds ?? []) {
      const prerequisite = runtimeDiagnosticCandidates(runtime, prerequisiteId, answeredIds, state)
        .sort((left, right) => left.difficulty - right.difficulty)[0];
      if (prerequisite) return publicQuestion(prerequisite);
    }
    const easierSame = runtimeDiagnosticCandidates(runtime, last.knowledgeId, answeredIds, state)
      .filter((question) => question.difficulty <= last.difficulty)
      .sort((left, right) => left.difficulty - right.difficulty)[0];
    if (easierSame) return publicQuestion(easierSame);
  }

  const counts = diagnosticCountsFor(answerSummaries, runtime.knowledge.map((item) => item.id));
  const unmeasured = runtime.knowledge.find((item) => counts.get(item.id).attempts === 0);
  if (unmeasured) {
    const candidate = runtimeDiagnosticCandidates(runtime, unmeasured.id, answeredIds, state)
      .sort((left, right) => Math.abs(left.difficulty - 2) - Math.abs(right.difficulty - 2))[0];
    if (candidate) return publicQuestion(candidate);
  }

  const ranked = [...runtime.knowledge].sort((left, right) => counts.get(left.id).attempts - counts.get(right.id).attempts);
  for (const knowledge of ranked) {
    const candidates = runtimeDiagnosticCandidates(runtime, knowledge.id, answeredIds, state);
    if (!candidates.length) continue;
    const summary = counts.get(knowledge.id);
    const targetDifficulty = summary.correct === summary.attempts ? 3 : summary.correct === 0 ? 1 : 2;
    candidates.sort((left, right) => Math.abs(left.difficulty - targetDifficulty) - Math.abs(right.difficulty - targetDifficulty));
    return publicQuestion(candidates[0]);
  }
  return null;
}

function diagnosticCountsFor(answers, knowledgeIds) {
  const counts = new Map(knowledgeIds.map((id) => [id, { attempts: 0, correct: 0 }]));
  for (const answer of answers) {
    if (!counts.has(answer.knowledgeId)) continue;
    const summary = counts.get(answer.knowledgeId);
    summary.attempts += 1;
    if (answer.correct) summary.correct += 1;
  }
  return counts;
}

function numericQuestion(id, knowledgeId, difficulty, prompt, expected, options = {}) {
  return { id, questionId: questionIdFromRevisionId(id), knowledgeId, difficulty, prompt, kind: "numeric", expectedAnswer: expected, expectedRational: parseRationalAnswer(expected), ...options };
}

function choiceQuestion(id, knowledgeId, difficulty, prompt, options, expectedChoice) {
  return { id, questionId: questionIdFromRevisionId(id), knowledgeId, difficulty, prompt, kind: "choice", options, expectedChoice };
}

function diagnosticCandidates(knowledgeId, answeredIds, state) {
  if (!knowledgeId) return [];
  return DIAGNOSTIC_QUESTIONS
    .filter((question) => question.knowledgeId === knowledgeId)
    .map((question) => resolveCatalogQuestion(question, state))
    .filter((question) => question && !answeredIds.has(question.id));
}

function anchorQuestion(knowledgeId, answeredIds, state) {
  return diagnosticCandidates(knowledgeId, answeredIds, state).sort((a, b) => Math.abs(a.difficulty - 2) - Math.abs(b.difficulty - 2))[0] ?? null;
}

export function privateTutorSeedQuestionRevisions(at) {
  return [...QUESTION_BY_ID.values()].map((question) => {
    const content = {
      questionId: question.questionId,
      context: question.context,
      knowledgeId: question.knowledgeId,
      difficulty: question.difficulty,
      kind: question.kind,
      prompt: question.prompt,
      options: question.options?.map((row) => ({ ...row })) ?? null,
      expectedChoice: question.expectedChoice ?? null,
      expectedAnswer: question.expectedAnswer ?? null,
      allowVariableAssignment: question.allowVariableAssignment === true,
    };
    return {
      id: question.id,
      version: 1,
      ...content,
      contentChecksum: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      createdBy: "system_seed",
      createdAt: at,
    };
  });
}

function resolveCatalogQuestion(question, state) {
  if (!question || !state?.privateTutorQuestionRevisions) return question ?? null;
  const active = activePrivateTutorQuestionRevision(state, question.questionId);
  return active ? questionFromRevision(active) : null;
}

function questionFromRevision(revision) {
  return {
    id: revision.id,
    questionId: revision.questionId,
    context: revision.context,
    knowledgeId: revision.knowledgeId,
    difficulty: revision.difficulty,
    kind: revision.kind,
    prompt: revision.prompt,
    options: revision.options?.map((row) => ({ ...row })) ?? null,
    expectedChoice: revision.expectedChoice ?? null,
    expectedRational: revision.kind === "numeric" ? parseRationalAnswer(revision.expectedAnswer) : null,
    allowVariableAssignment: revision.allowVariableAssignment === true,
  };
}

function questionIdFromRevisionId(revisionId) {
  return revisionId.replace(/-v\d+$/, "");
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
import { createHash } from "node:crypto";
import {
  activePrivateTutorQuestionRevision,
  isPrivateTutorQuestionRevisionUsable,
} from "./private-tutor-content.mjs";
