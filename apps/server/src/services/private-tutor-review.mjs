import { privateTutorQuestion, privateTutorReviewQuestion, publicQuestion } from "./private-tutor-assessment.mjs";
import { privateTutorPackageRegistryFromState } from "./private-tutor-package-registry.mjs";

export const PRIVATE_TUTOR_REVIEW_PHASES = ["correction", "similar", "variation", "delayed"];

const KNOWLEDGE_TITLES = {
  integer: "有理数运算",
  "equation-meaning": "等式与方程",
  balance: "等式两边同乘同除",
  "word-problem": "一元一次方程应用",
};

const MISCONCEPTIONS = {
  single_side_change: { label: "只改变了等式一边", strategy: "concept_rebuild" },
  division_fluency: { label: "等式变形正确，但计算还不稳定", strategy: "fluency_practice" },
  negative_subtraction: { label: "减去负数时符号关系还没站稳", strategy: "prerequisite_repair" },
  equation_definition: { label: "还没有区分等式和方程", strategy: "concept_rebuild" },
  variable_isolation: { label: "还不清楚怎样让未知数单独留下", strategy: "concept_rebuild" },
  equation_translation: { label: "文字关系还没有稳定转换为方程", strategy: "concept_rebuild" },
  unresolved_method: { label: "当前方法还没有形成稳定证据", strategy: "concept_rebuild" },
};

export function recordPrivateTutorErrorEvidence({ state, learner, attempt, now, nextId }) {
  if (!attempt || attempt.evidenceEligible === false || attempt.correct || !privateTutorQuestion(attempt.questionRevisionId, state, attempt.contentPackageId)) return null;
  const misconceptionId = misconceptionFor(attempt);
  const definition = misconceptionDefinition(state, attempt, misconceptionId);
  const createdAt = now();
  const question = privateTutorQuestion(attempt.questionRevisionId, state, attempt.contentPackageId);
  const errorCase = {
    id: nextId("ptec"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    contentPackageId: attempt.contentPackageId ?? null,
    contentPackageVersion: attempt.contentPackageVersion ?? null,
    subjectId: attempt.subjectId ?? "math",
    attemptId: attempt.id,
    knowledgeId: attempt.knowledgeId,
    questionRevisionId: attempt.questionRevisionId,
    questionSnapshot: publicQuestion(question),
    answerSnapshot: {
      normalizedAnswer: attempt.normalizedAnswer,
      responseKind: attempt.responseKind,
      source: attempt.source,
      recognitionConfidence: attempt.recognitionConfidence,
      usedHint: attempt.usedHint,
      independent: attempt.independent,
    },
    misconceptionId,
    strategy: definition.strategy,
    createdAt,
  };
  state.privateTutorErrorCases.unshift(errorCase);

  let theme = state.privateTutorErrorThemes.find((row) =>
    row.learnerId === learner.id
    && row.knowledgeId === attempt.knowledgeId
    && row.misconceptionId === misconceptionId
    && samePackage(row.contentPackageId, attempt.contentPackageId));
  if (!theme) {
    theme = {
      id: nextId("ptet"),
      ownerTeamId: learner.ownerTeamId,
      learnerId: learner.id,
      contentPackageId: attempt.contentPackageId ?? null,
      contentPackageVersion: attempt.contentPackageVersion ?? null,
      subjectId: attempt.subjectId ?? "math",
      knowledgeId: attempt.knowledgeId,
      title: knowledgeTitle(state, attempt) ?? KNOWLEDGE_TITLES[attempt.knowledgeId] ?? attempt.knowledgeId,
      misconceptionId,
      misconception: definition.label,
      strategy: definition.strategy,
      status: "challenge_today",
      occurrenceCount: 0,
      reopenedCount: 0,
      errorCaseIds: [],
      learnerDiagnosisCorrection: null,
      firstSeenAt: createdAt,
      lastSeenAt: createdAt,
      masteredAt: null,
      updatedAt: createdAt,
    };
    state.privateTutorErrorThemes.unshift(theme);
  } else if (theme.status === "mastered") {
    theme.status = "challenge_today";
    theme.reopenedCount += 1;
    theme.masteredAt = null;
  }
  theme.occurrenceCount += 1;
  theme.errorCaseIds.unshift(errorCase.id);
  theme.lastSeenAt = createdAt;
  theme.updatedAt = createdAt;

  let schedule = state.privateTutorReviewSchedules.find((row) => row.themeId === theme.id && row.status === "active");
  if (!schedule) {
    schedule = {
      id: nextId("ptrs"),
      ownerTeamId: learner.ownerTeamId,
      learnerId: learner.id,
      contentPackageId: attempt.contentPackageId ?? null,
      contentPackageVersion: attempt.contentPackageVersion ?? null,
      subjectId: attempt.subjectId ?? "math",
      themeId: theme.id,
      phase: "correction",
      status: "active",
      dueAt: createdAt,
      attemptIds: [],
      phaseEvidence: [],
      revision: 1,
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
    };
    state.privateTutorReviewSchedules.unshift(schedule);
  } else {
    schedule.phase = "correction";
    schedule.dueAt = createdAt;
    schedule.revision += 1;
    schedule.updatedAt = createdAt;
  }
  theme.currentScheduleId = schedule.id;
  return { errorCase, theme, schedule };
}

export function privateTutorReviewBook(state, learnerId, at, contentPackageId = null) {
  const themes = state.privateTutorErrorThemes
    .filter((row) => row.learnerId === learnerId && (!contentPackageId || samePackage(row.contentPackageId, contentPackageId)))
    .sort((left, right) => String(right.lastSeenAt).localeCompare(String(left.lastSeenAt)))
    .map((theme) => {
      const schedule = state.privateTutorReviewSchedules.find((row) => row.id === theme.currentScheduleId) ?? null;
      const latestCase = state.privateTutorErrorCases.find((row) => row.id === theme.errorCaseIds[0]) ?? null;
      const view = themeView(theme, schedule, latestCase, at);
      if (view.schedule) view.schedule.question = currentPrivateTutorReviewQuestion(state, schedule);
      return view;
    });
  return {
    learnerId,
    counts: {
      challengeToday: themes.filter((row) => row.status === "challenge_today").length,
      working: themes.filter((row) => row.status === "working").length,
      mastered: themes.filter((row) => row.status === "mastered").length,
    },
    themes,
  };
}

export function currentPrivateTutorReviewQuestion(state, schedule) {
  const theme = state.privateTutorErrorThemes.find((row) => row.id === schedule.themeId && row.learnerId === schedule.learnerId);
  if (!theme) return null;
  if (schedule.phase === "correction") {
    const latestCase = state.privateTutorErrorCases.find((row) => row.id === theme.errorCaseIds[0]);
    const question = latestCase?.questionRevisionId
      ? privateTutorQuestion(latestCase.questionRevisionId, state, schedule.contentPackageId)
      : null;
    return question ? publicQuestion(question) : null;
  }
  return privateTutorReviewQuestion(theme.knowledgeId, schedule.phase, state, schedule.contentPackageId);
}

export function recordPrivateTutorReviewResult({ state, schedule, attempt, now }) {
  const theme = state.privateTutorErrorThemes.find((row) => row.id === schedule.themeId && row.learnerId === schedule.learnerId);
  if (!theme) return { ok: false, error: "private_tutor_error_theme_not_found" };
  if (attempt.evidenceEligible === false) return { ok: true, theme, schedule, evidenceRecorded: false };
  const at = now();
  schedule.attemptIds.unshift(attempt.id);
  schedule.phaseEvidence.push({ phase: schedule.phase, attemptId: attempt.id, correct: attempt.correct, at });
  if (!attempt.correct) {
    schedule.phase = "correction";
    schedule.dueAt = at;
    theme.status = "challenge_today";
    theme.masteredAt = null;
  } else if (schedule.phase === "correction") {
    schedule.phase = "similar";
    schedule.dueAt = at;
    theme.status = "working";
  } else if (schedule.phase === "similar") {
    schedule.phase = "variation";
    schedule.dueAt = at;
    theme.status = "working";
  } else if (schedule.phase === "variation") {
    schedule.phase = "delayed";
    schedule.dueAt = addHours(at, 24);
    theme.status = "working";
  } else {
    schedule.status = "completed";
    schedule.completedAt = at;
    schedule.dueAt = null;
    theme.status = "mastered";
    theme.masteredAt = at;
  }
  schedule.revision += 1;
  schedule.updatedAt = at;
  theme.updatedAt = at;
  return { ok: true, theme, schedule, evidenceRecorded: true };
}

export function correctPrivateTutorDiagnosis(theme, correction, at) {
  const value = String(correction ?? "").trim().slice(0, 240);
  if (!value) return false;
  theme.learnerDiagnosisCorrection = value;
  theme.updatedAt = at;
  return true;
}

export function privateTutorReviewScheduleView(state, schedule, at) {
  const theme = state.privateTutorErrorThemes.find((row) => row.id === schedule.themeId && row.learnerId === schedule.learnerId);
  const latestCase = theme ? state.privateTutorErrorCases.find((row) => row.id === theme.errorCaseIds[0]) : null;
  return {
    id: schedule.id,
    learnerId: schedule.learnerId,
    themeId: schedule.themeId,
    phase: schedule.phase,
    status: schedule.status,
    dueAt: schedule.dueAt,
    due: schedule.status === "active" && Date.parse(schedule.dueAt) <= Date.parse(at),
    revision: schedule.revision,
    question: currentPrivateTutorReviewQuestion(state, schedule),
    theme: theme ? themeView(theme, schedule, latestCase, at) : null,
  };
}

function themeView(theme, schedule, latestCase, at) {
  const due = schedule?.status === "active" && Date.parse(schedule.dueAt) <= Date.parse(at);
  const status = theme.status === "mastered" ? "mastered" : due ? "challenge_today" : "working";
  return {
    id: theme.id,
    learnerId: theme.learnerId,
    contentPackageId: theme.contentPackageId ?? null,
    contentPackageVersion: theme.contentPackageVersion ?? null,
    subjectId: theme.subjectId ?? "math",
    knowledgeId: theme.knowledgeId,
    title: theme.title,
    misconception: theme.misconception,
    learnerDiagnosisCorrection: theme.learnerDiagnosisCorrection,
    strategy: theme.strategy,
    status,
    occurrenceCount: theme.occurrenceCount,
    reopenedCount: theme.reopenedCount,
    latestQuestion: latestCase?.questionSnapshot ?? null,
    latestAnswer: latestCase?.answerSnapshot ?? null,
    schedule: schedule ? {
      id: schedule.id,
      phase: schedule.phase,
      dueAt: schedule.dueAt,
      due,
      completedAt: schedule.completedAt,
    } : null,
    masteredAt: theme.masteredAt,
    updatedAt: theme.updatedAt,
  };
}

function misconceptionFor(attempt) {
  if (attempt.questionRevisionId === "diag-bal-01-v1") return "single_side_change";
  if (attempt.knowledgeId === "integer") return "negative_subtraction";
  if (attempt.knowledgeId === "equation-meaning") return attempt.normalizedAnswer === "a" ? "equation_definition" : "variable_isolation";
  if (attempt.knowledgeId === "word-problem") return "equation_translation";
  if (attempt.knowledgeId === "balance") return ["8", "10", "17"].includes(attempt.normalizedAnswer) ? "variable_isolation" : "division_fluency";
  return "unresolved_method";
}

function knowledgeTitle(state, attempt) {
  if (!attempt.contentPackageId) return null;
  const pkg = privateTutorPackageRegistryFromState(state).getPackage(attempt.contentPackageId);
  return pkg?.knowledgeComponents?.find((item) => item.id === attempt.knowledgeId)?.name ?? null;
}

function misconceptionDefinition(state, attempt, misconceptionId) {
  if (MISCONCEPTIONS[misconceptionId]) return MISCONCEPTIONS[misconceptionId];
  if (attempt.contentPackageId) {
    const pkg = privateTutorPackageRegistryFromState(state).getPackage(attempt.contentPackageId);
    const item = pkg?.knowledgeComponents?.find((knowledge) => knowledge.id === attempt.knowledgeId)?.misconceptions?.[0];
    if (item) return { label: item.label, strategy: item.recommendedStrategy ?? "concept_rebuild" };
  }
  return MISCONCEPTIONS.unresolved_method;
}

function samePackage(left, right) {
  return (left || "demo-math-foundations-v1") === (right || "demo-math-foundations-v1");
}

function addHours(iso, hours) {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}
