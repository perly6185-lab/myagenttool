import { privateTutorQuestion, publicQuestion } from "./private-tutor-assessment.mjs";
import { activePrivateTutorQuestionRevision } from "./private-tutor-content.mjs";
import { privateTutorLearningPreferences } from "./private-tutor-learning-preferences.mjs";
import { privateTutorPackageRegistryFromState } from "./private-tutor-package-registry.mjs";
import { buildPrivateTutorVisualScene } from "./private-tutor-visual-scene.mjs";

export const PRIVATE_TUTOR_SESSION_PACES = {
  easy: { totalMinutes: 5, budgets: [1, 1, 1, 1, 1] },
  standard: { totalMinutes: 20, budgets: [2, 5, 7, 4, 2] },
  review: { totalMinutes: 10, budgets: [2, 1, 2, 3, 2] },
};

export const PRIVATE_TUTOR_FOLLOW_UP_MODES = ["question", "explain_again", "source_example"];

const ACTIVITY_KINDS = ["recall", "explain", "guided_practice", "independent_check", "summary"];
const KNOWLEDGE_CONTENT = {
  integer: content("有理数运算", "int", "先在数轴上看方向，再把符号和距离分开。", [
    "先找到起点，再看向左还是向右。",
    "减去一个负数，可以想成向相反方向移动。",
    "把移动后的落点写成答案。",
  ]),
  "equation-meaning": content("等式与方程", "eqm", "先认出未知数和相等关系，再决定怎样让未知数单独留下。", [
    "先找等号两边分别是什么。",
    "想一想要去掉未知数旁边的哪个数。",
    "等式两边做同样的运算。",
  ]),
  balance: content("等式两边同乘同除", "bal", "把方程想成平衡的天平，两边始终做同样的事情。", [
    "先看未知数旁边多了什么。",
    "在等式两边同时去掉相同的部分。",
    "检查代回原方程后两边是否一样。",
  ]),
  "word-problem": content("一元一次方程应用", "word", "先把文字里的数量关系说清楚，再用方程表示。", [
    "先说出不知道的量是什么。",
    "找到题目里的总量关系。",
    "用一个方程写出这句话，再求未知数。",
  ]),
};

export function createPrivateTutorSession({ id, ownerTeamId, learnerId, plan, decision, pace, now, state, contentPackageId = null, activationId = null, targetMinutes = null, teachingPolicy = null }) {
  const planDayIndex = selectPlanDayIndex(plan);
  const planDay = plan?.days?.[planDayIndex] ?? null;
  const paceDefinition = sessionPaceDefinition(pace, planDay?.minutes ?? targetMinutes);
  if (!paceDefinition) return null;
  const targetKnowledgeId = planDay?.knowledgeId ?? decision?.targetKnowledgeId;
  const runtime = contentPackageId ? sessionRuntime(state, contentPackageId, targetKnowledgeId) : null;
  const target = runtime?.content ?? KNOWLEDGE_CONTENT[targetKnowledgeId];
  if (!target) return null;
  const startedAt = now();
  const activities = ACTIVITY_KINDS.map((kind, index) => ({
    kind,
    budgetMinutes: paceDefinition.budgets[index],
    status: index === 0 ? "active" : "pending",
    questionRevisionId: activeQuestionRevisionId(
      state,
      runtime ? runtimeQuestionId(runtime.knowledge, kind, teachingPolicy?.questionDifficulty) : questionId(target.questionPrefix, kind),
    ),
    hintLevel: 0,
    followUpCount: 0,
    attemptCount: 0,
    incorrectCount: 0,
    startedAt: index === 0 ? startedAt : null,
    completedAt: null,
  }));
  if (activities.some((activity) => ["recall", "guided_practice", "independent_check"].includes(activity.kind) && !activity.questionRevisionId)) return null;
  const session = {
    id,
    ownerTeamId,
    learnerId,
    contentPackageId: runtime?.package.id ?? null,
    contentPackageVersion: runtime?.package.version ?? null,
    subjectId: runtime?.package.subjectId ?? "math",
    planId: plan?.id ?? null,
    decisionId: decision?.id ?? null,
    activationId,
    activationStatus: "active",
    targetKnowledgeId,
    targetTitle: target.title,
    strategy: planDay?.strategy ?? decision?.strategy,
    pace,
    plannedMinutes: paceDefinition.totalMinutes,
    status: "active",
    revision: 1,
    currentActivityIndex: 0,
    activities,
    consecutiveIncorrect: 0,
    methodSwitchCount: 0,
    teachingMethod: teachingPolicy?.explanationMode ?? initialMethod(decision?.strategy),
    teachingPolicy,
    teachingStrategyDecisionId: null,
    intervention: null,
    evidenceAttemptIds: [],
    practiceAttemptIds: [],
    followUps: [],
    planDayIndex: planDay ? planDay.dayIndex : null,
    startedAt,
    pausedAt: null,
    completedAt: null,
    updatedAt: startedAt,
    summary: null,
  };
  if (planDay) {
    planDay.status = "in_progress";
    planDay.startedAt ??= startedAt;
    plan.updatedAt = startedAt;
  }
  return session;
}

function sessionPaceDefinition(pace, targetMinutes) {
  const base = PRIVATE_TUTOR_SESSION_PACES[pace];
  if (!base || pace !== "standard" || targetMinutes == null) return base;
  const totalMinutes = Math.max(5, Math.min(180, Math.round(Number(targetMinutes) || base.totalMinutes)));
  if (totalMinutes === base.totalMinutes) return base;
  const minimum = Array(base.budgets.length).fill(1);
  let remaining = totalMinutes - minimum.length;
  const weightTotal = base.budgets.reduce((sum, value) => sum + value, 0);
  const additions = base.budgets.map((weight) => Math.floor((remaining * weight) / weightTotal));
  let assigned = additions.reduce((sum, value) => sum + value, 0);
  for (let index = 0; assigned < remaining; index = (index + 1) % additions.length) {
    additions[index] += 1;
    assigned += 1;
  }
  return { totalMinutes, budgets: minimum.map((value, index) => value + additions[index]) };
}

export function privateTutorSessionView(session, state) {
  if (!session) return null;
  const runtime = session.contentPackageId ? sessionRuntime(state, session.contentPackageId, session.targetKnowledgeId) : null;
  const contentDefinition = runtime?.content ?? KNOWLEDGE_CONTENT[session.targetKnowledgeId];
  if (!contentDefinition) return null;
  const activity = session.activities[session.currentActivityIndex] ?? null;
  const question = activity?.questionRevisionId
    ? publicQuestion(privateTutorQuestion(activity.questionRevisionId, state, session.contentPackageId))
    : null;
  // Preferences shape HOW content is explained (style/depth framing) but are
  // never read by grading or mastery-evidence paths — see M4 exit criteria.
  const preferences = state?.privateTutorLearningPreferences
    ? privateTutorLearningPreferences(state, session.learnerId)
    : null;
  return {
    id: session.id,
    learnerId: session.learnerId,
    contentPackageId: session.contentPackageId ?? null,
    contentPackageVersion: session.contentPackageVersion ?? null,
    subjectId: session.subjectId ?? "math",
    planId: session.planId,
    decisionId: session.decisionId,
    activationId: session.activationId ?? null,
    planDayIndex: session.planDayIndex ?? null,
    targetKnowledgeId: session.targetKnowledgeId,
    targetTitle: session.targetTitle,
    strategy: session.strategy,
    pace: session.pace,
    plannedMinutes: session.plannedMinutes,
    status: session.status,
    revision: session.revision,
    currentActivityIndex: session.currentActivityIndex,
    progress: session.activities.map(({ kind, budgetMinutes, status }) => ({ kind, budgetMinutes, status })),
    currentActivity: activity ? {
      kind: activity.kind,
      budgetMinutes: activity.budgetMinutes,
      hintLevel: activity.hintLevel,
      followUpCount: activity.followUpCount ?? 0,
      attemptCount: activity.attemptCount,
      instruction: instructionFor(activity.kind, contentDefinition, session.teachingMethod, preferences),
      question,
      hint: activity.hintLevel ? personalizedHint(contentDefinition.hints, activity.hintLevel, session.teachingPolicy?.hintGranularity) : null,
      visualScene: runtime?.capabilities.visualInteractions === false ? null : buildPrivateTutorVisualScene({
        knowledgeId: session.targetKnowledgeId,
        activityKind: activity.kind,
        teachingMethod: session.teachingMethod,
        questionRevisionId: activity.questionRevisionId,
      }),
    } : null,
    teachingMethod: session.teachingMethod,
    teachingPolicy: session.teachingPolicy ?? null,
    teachingStrategyDecisionId: session.teachingStrategyDecisionId ?? null,
    teachingPreferences: preferences ? {
      teacherStyle: preferences.teacherStyle,
      explanationDepth: preferences.explanationDepth,
      followUpStyle: preferences.followUpStyle,
    } : null,
    subjectCapabilities: runtime?.capabilities ?? null,
    methodSwitchCount: session.methodSwitchCount,
    intervention: session.intervention,
    followUps: (session.followUps ?? []).slice(-12).map((item) => ({
      id: item.id,
      activityKind: item.activityKind,
      mode: item.mode,
      question: item.question,
      response: item.response,
      grounding: item.grounding,
      sourceRefs: item.sourceRefs.map((ref) => ({ ...ref })),
      evidenceEligible: false,
      resolution: item.resolution ?? null,
      resolutionRecordedAt: item.resolutionRecordedAt ?? null,
      createdAt: item.createdAt,
    })),
    pausedAt: session.pausedAt,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    updatedAt: session.updatedAt,
    summary: session.summary,
  };
}

export function revealPrivateTutorHint(session, now) {
  const activity = currentActivity(session);
  if (!activity || !activity.questionRevisionId) return { ok: false, error: "private_tutor_hint_not_available" };
  activity.hintLevel = Math.min(3, activity.hintLevel + 1);
  session.intervention = null;
  touch(session, now);
  return { ok: true };
}

export function answerPrivateTutorFollowUp(session, { mode, question, state, now, nextId }) {
  const activity = currentActivity(session);
  if (!activity) return { ok: false, error: "private_tutor_follow_up_not_available" };
  if (!PRIVATE_TUTOR_FOLLOW_UP_MODES.includes(mode)) return { ok: false, error: "invalid_private_tutor_follow_up_mode" };
  const normalizedQuestion = String(question ?? "").replace(/\s+/g, " ").trim();
  if (mode === "question" && (!normalizedQuestion || normalizedQuestion.length > 500)) {
    return { ok: false, error: "invalid_private_tutor_follow_up_question" };
  }
  if (normalizedQuestion.length > 500) return { ok: false, error: "invalid_private_tutor_follow_up_question" };

  const runtime = session.contentPackageId ? sessionRuntime(state, session.contentPackageId, session.targetKnowledgeId) : null;
  const contentDefinition = runtime?.content ?? KNOWLEDGE_CONTENT[session.targetKnowledgeId];
  if (!contentDefinition) return { ok: false, error: "private_tutor_follow_up_not_available" };
  if (mode === "explain_again") {
    session.teachingMethod = alternateMethod(session.teachingMethod);
    session.methodSwitchCount += 1;
    session.intervention = null;
  }

  const sourceRefs = groundedSourceRefs(runtime?.knowledge);
  const grounding = sourceRefs.length ? "source_excerpt" : "reviewed_curriculum";
  const response = groundedFollowUpResponse({
    mode,
    question: normalizedQuestion,
    contentDefinition,
    teachingMethod: session.teachingMethod,
    sourceRefs,
  });
  const createdAt = now();
  const followUp = {
    id: nextId("ptfu"),
    activityKind: activity.kind,
    mode,
    question: normalizedQuestion || (mode === "explain_again" ? "请换一种讲法" : "请给一个资料内的例子"),
    response,
    grounding,
    sourceRefs,
    evidenceEligible: false,
    createdAt,
  };
  activity.followUpCount = (activity.followUpCount ?? 0) + 1;
  session.followUps ??= [];
  session.followUps.push(followUp);
  if (session.followUps.length > 12) session.followUps.splice(0, session.followUps.length - 12);
  touch(session, () => createdAt);
  return { ok: true, followUp: { ...followUp, sourceRefs: followUp.sourceRefs.map((ref) => ({ ...ref })) } };
}

export function completePrivateTutorActivity(session, now) {
  const activity = currentActivity(session);
  if (!activity) return { completed: session.status === "completed" };
  const at = now();
  activity.status = "completed";
  activity.completedAt = at;
  const nextIndex = session.currentActivityIndex + 1;
  if (nextIndex >= session.activities.length) {
    session.status = "completed";
    session.completedAt = at;
    session.currentActivityIndex = session.activities.length;
    session.summary = buildSummary(session, at);
  } else {
    session.currentActivityIndex = nextIndex;
    session.activities[nextIndex].status = "active";
    session.activities[nextIndex].startedAt = at;
  }
  session.intervention = null;
  touch(session, () => at);
  return { completed: session.status === "completed" };
}

export function recordPrivateTutorSessionAnswer(session, { correct, attemptId, evidenceEligible = true, now }) {
  const activity = currentActivity(session);
  if (!activity?.questionRevisionId) return { ok: false, error: "private_tutor_answer_not_available" };
  activity.attemptCount += 1;
  session.practiceAttemptIds ??= [];
  session.practiceAttemptIds.push(attemptId);
  if (evidenceEligible) session.evidenceAttemptIds.push(attemptId);
  if (correct) {
    session.consecutiveIncorrect = 0;
    session.intervention = null;
    completePrivateTutorActivity(session, now);
    return { ok: true, advanced: true };
  }
  activity.incorrectCount += 1;
  session.consecutiveIncorrect += 1;
  if (session.consecutiveIncorrect >= 2) {
    session.methodSwitchCount += 1;
    session.consecutiveIncorrect = 0;
    session.teachingMethod = alternateMethod(session.teachingMethod);
    session.intervention = {
      type: session.strategy === "prerequisite_repair" ? "prerequisite_reset" : "method_switch",
      message: session.strategy === "prerequisite_repair"
        ? "先退回前面最小的一步，弄稳以后再回来。"
        : "刚才的方法没有帮上忙，我们换一种讲法，不继续堆题。",
    };
    if (activity.kind === "recall") {
      const intervention = session.intervention;
      completePrivateTutorActivity(session, now);
      session.intervention = intervention;
      return { ok: true, advanced: true };
    }
  } else {
    session.intervention = { type: "gentle_hint", message: "没关系，先看一个小提示，再自己试一次。" };
  }
  touch(session, now);
  return { ok: true, advanced: false };
}

export function pausePrivateTutorSession(session, now) {
  if (session.status !== "active") return false;
  session.status = "paused";
  session.pausedAt = now();
  touch(session, now);
  return true;
}

export function resumePrivateTutorSession(session, now) {
  if (session.status !== "paused") return false;
  session.status = "active";
  session.pausedAt = null;
  const activity = currentActivity(session);
  if (activity) activity.startedAt = now();
  touch(session, now);
  return true;
}

export function currentPrivateTutorActivity(session) {
  return currentActivity(session);
}

export function completePrivateTutorPlanDay(plan, session, at) {
  if (!plan || !session || session.status !== "completed" || !session.planDayIndex) return false;
  const day = plan.days?.find((item) => item.dayIndex === session.planDayIndex);
  if (!day) return false;
  day.status = "completed";
  day.completedAt = at;
  plan.status = plan.days.every((item) => ["completed", "rest", "rescheduled"].includes(item.status)) ? "completed" : "active";
  plan.updatedAt = at;
  return true;
}

function content(title, questionPrefix, explanation, hints) {
  return { title, questionPrefix, explanation, hints };
}

function questionId(prefix, kind) {
  if (kind === "recall") return `tutor-${prefix}-recall-001-v1`;
  if (kind === "guided_practice") return `tutor-${prefix}-guided-001-v1`;
  if (kind === "independent_check") return `tutor-${prefix}-transfer-001-v1`;
  return null;
}

function activeQuestionRevisionId(state, fallbackRevisionId) {
  if (!fallbackRevisionId) return null;
  if (!state?.privateTutorQuestionRevisions) return fallbackRevisionId;
  const questionId = fallbackRevisionId.replace(/-v\d+$/, "");
  if (!state.privateTutorQuestionRevisions.some((row) => row.questionId === questionId)) return fallbackRevisionId;
  return activePrivateTutorQuestionRevision(state, questionId)?.id ?? null;
}

function sessionRuntime(state, contentPackageId, knowledgeId) {
  if (!state || !contentPackageId) return null;
  const registry = privateTutorPackageRegistryFromState(state);
  const pkg = registry.getPackage(contentPackageId);
  const knowledge = pkg?.knowledgeComponents?.find((item) => item.id === knowledgeId);
  if (!pkg || (pkg.status != null && pkg.status !== "published") || !knowledge) return null;
  const teaching = knowledge.teachingContent ?? {};
  return {
    package: pkg,
    knowledge,
    capabilities: registry.getSubjectPlugin(pkg.evaluationSubjectId ?? pkg.subjectId)?.getCapabilities?.() ?? {
      deterministicGrading: false,
      stepEvaluation: false,
      speechEvaluation: false,
      visualInteractions: false,
    },
    content: {
      title: knowledge.name ?? knowledge.id,
      explanation: teaching.explanation ?? teaching.guidance ?? teaching.coreConcept ?? knowledge.shortDescription ?? "先理解核心概念，再用练习确认。",
      hints: teaching.keyPoints?.length ? teaching.keyPoints : ["回到定义，逐项检查条件。"],
    },
  };
}

function runtimeQuestionId(knowledge, kind, difficulty = "core") {
  const questions = knowledge.tutoringQuestions ?? [];
  if (!questions.length) return null;
  const ranked = [...questions].sort((left, right) => difficultyRank(left?.difficulty) - difficultyRank(right?.difficulty));
  const preferred = difficulty === "support" ? ranked[0] : difficulty === "challenge" ? ranked.at(-1) : ranked[Math.floor((ranked.length - 1) / 2)];
  if (kind === "recall") return ranked[0]?.id ?? null;
  if (kind === "guided_practice") return preferred?.id ?? ranked[0]?.id ?? null;
  if (kind === "independent_check") return difficulty === "support"
    ? ranked[Math.min(1, ranked.length - 1)]?.id ?? preferred?.id ?? null
    : ranked.at(-1)?.id ?? null;
  return null;
}

function difficultyRank(value) {
  return { easy: 0, support: 0, medium: 1, core: 1, hard: 2, challenge: 2 }[value] ?? 1;
}

function personalizedHint(hints, level, granularity = "progressive") {
  if (!hints?.length) return null;
  if (granularity === "minimal" && level === 1) return "先重新读一遍条件，找出最关键的关系。";
  if (granularity === "retrieval_cue" && level === 1) return `先回想这条规则解决的是什么关系：${hints[0]}`;
  if (granularity === "fading" && level === 1) return "先说出你最确定的一步，再对照提示检查。";
  if (granularity === "micro_steps") {
    const hint = hints[Math.min(level, hints.length) - 1];
    return `只看这一小步：${hint}`;
  }
  return hints[Math.min(level, hints.length) - 1];
}

function groundedSourceRefs(knowledge) {
  const refs = Array.isArray(knowledge?.sourceRefs) ? knowledge.sourceRefs : knowledge?.sourceRef ? [knowledge.sourceRef] : [];
  const seen = new Set();
  return refs.flatMap((ref) => {
    const excerpt = String(ref?.excerpt ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
    const sectionId = String(ref?.sectionId ?? "").trim();
    if (!excerpt || !sectionId) return [];
    const key = `${sectionId}:${ref?.pageNumber ?? ""}:${excerpt}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ sectionId, pageNumber: ref?.pageNumber ?? null, excerpt }];
  }).slice(0, 4);
}

function groundedFollowUpResponse({ mode, question, contentDefinition, teachingMethod, sourceRefs }) {
  const sourceText = sourceRefs.map((ref) => ref.excerpt).join(" ").slice(0, 1_200);
  const groundedText = sourceText || contentDefinition.explanation;
  const points = (contentDefinition.hints ?? []).filter(Boolean).slice(0, 3);
  const sourceLimit = sourceRefs.length
    ? "这段回答只依据下方教材摘录；资料没有覆盖的结论，我不会补写。"
    : "这段回答只依据当前审核课程内容，不会读取题目答案，也不会改变掌握度。";

  if (mode === "explain_again") {
    const steps = points.length ? `可以拆成：${points.map((point, index) => `${index + 1}. ${point}`).join(" ")}` : groundedText;
    return `换成“${methodLabel(teachingMethod)}”来讲：${steps} ${sourceLimit}`;
  }
  if (mode === "source_example") {
    return sourceRefs.length
      ? `用资料里的原句作例子：“${groundedText}”先指出它描述的核心关系，再用自己的话复述。${sourceLimit}`
      : `用当前课程内容作例子：${groundedText} ${points[0] ?? "先找出核心条件，再按规则检查。"} ${sourceLimit}`;
  }
  return `关于“${question}”，当前资料能确认的是：${groundedText} ${sourceLimit}`;
}

function instructionFor(kind, contentDefinition, teachingMethod, preferences = null) {
  const styleFrame = preferences ? styleFraming(preferences) : null;
  const depthFrame = preferences ? depthFraming(preferences.explanationDepth) : null;
  const followUpFrame = preferences ? followUpFraming(preferences.followUpStyle) : null;
  if (kind === "recall") return `先回想一下“${contentDefinition.title}”，看看昨天的理解还在不在。`;
  if (kind === "explain") {
    const base = `${contentDefinition.explanation} 当前讲法：${methodLabel(teachingMethod)}。`;
    return `${base}${styleFrame ?? ""}${depthFrame ?? ""}${followUpFrame ?? ""}`;
  }
  if (kind === "guided_practice") {
    const base = "我会陪你做这一步；需要时可以逐级看提示。";
    return `${base}${styleFrame ?? ""}${followUpFrame ?? ""}`;
  }
  if (kind === "independent_check") return "这是一道没见过的新题。先不看提示，自己验证能不能迁移。";
  return "看看今天学会了什么，以及下一次什么时候回来复习。";
}

// Style/depth frames only reframe the explanation copy. They never change the
// question, the hints, or the answer key — deterministic grading is untouched.
function styleFraming(preferences) {
  const frames = {
    heuristic_guidance: " 讲解方式：先抛出问题，引导你自己想出下一步。",
    direct_concept: " 讲解方式：直接讲清概念和规则，再示范一次。",
    case_driven: " 讲解方式：先看一个具体例子，从例子里归纳规则。",
    socratic_questioning: " 讲解方式：用连续追问帮你检验每一步的理由。",
  };
  return frames[preferences.teacherStyle] ?? null;
}

function depthFraming(depth) {
  const frames = {
    concise_then_expand: " 深度：先给简洁版本，确认理解后再展开细节。",
    from_foundations: " 深度：从最基础的概念完整讲起，不跳过前置知识。",
    key_difficulties_only: " 深度：只聚焦关键难点，已掌握的部分快速带过。",
    professional_depth: " 深度：按专业标准深入，包含严格的定义和边界条件。",
  };
  return frames[depth] ?? null;
}

function followUpFraming(style) {
  const frames = {
    gentle_probe: " 追问：先请你说出最确定的一点，再温和补问理由。",
    direct_check: " 追问：直接用一个检查问题确认是否理解。",
    none: " 追问：不额外追问，由你主动继续。",
  };
  return frames[style] ?? null;
}

function initialMethod(strategy) {
  return {
    prerequisite_repair: "small_step",
    concept_rebuild: "visual_model",
    fluency_practice: "worked_example",
    transfer_challenge: "contrast_case",
  }[strategy] ?? "visual_model";
}

function alternateMethod(method) {
  return {
    small_step: "visual_model",
    visual_model: "worked_example",
    worked_example: "contrast_case",
    contrast_case: "small_step",
  }[method] ?? "small_step";
}

function methodLabel(method) {
  return {
    small_step: "拆成更小的一步",
    visual_model: "用图形和具体表示",
    worked_example: "看完整例题再模仿",
    contrast_case: "对比两个容易混淆的情况",
  }[method] ?? "换一种讲法";
}

function buildSummary(session, completedAt) {
  const independent = session.activities.find((item) => item.kind === "independent_check");
  const hintedActivities = session.activities.filter((item) => item.hintLevel > 0).map((item) => item.kind);
  const independentWithoutHelp = Boolean(independent?.completedAt && independent.hintLevel === 0 && (independent.followUpCount ?? 0) === 0);
  const reviewAt = new Date(completedAt);
  reviewAt.setUTCHours(reviewAt.getUTCHours() + Math.max(1, Number(session.teachingPolicy?.reviewIntervalHours ?? 24)));
  return {
    learned: `今天完成了“${session.targetTitle}”的回想、理解和练习。`,
    independentCompleted: independentWithoutHelp,
    hintedActivities,
    methodSwitchCount: session.methodSwitchCount,
    evidenceCount: session.evidenceAttemptIds.length,
    practiceCount: session.practiceAttemptIds?.length ?? session.evidenceAttemptIds.length,
    reviewAt: reviewAt.toISOString(),
    nextStep: independentWithoutHelp
      ? "明天用另一道题快速回想，确认还能独立做到。"
      : "明天先从一个小提示开始，再用新题独立验证。",
  };
}

function currentActivity(session) {
  return session.activities[session.currentActivityIndex] ?? null;
}

function touch(session, now) {
  session.revision += 1;
  session.updatedAt = now();
}

function selectPlanDayIndex(plan) {
  const days = Array.isArray(plan?.days) ? plan.days : [];
  return days.findIndex((item) => item.status === "in_progress" || item.status === "planned");
}
