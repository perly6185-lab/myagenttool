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

export function createPrivateTutorSession({ id, ownerTeamId, learnerId, plan, decision, pace, now, state, contentPackageId = null }) {
  const paceDefinition = PRIVATE_TUTOR_SESSION_PACES[pace];
  if (!paceDefinition) return null;
  const targetKnowledgeId = plan?.days?.[0]?.knowledgeId ?? decision?.targetKnowledgeId;
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
      runtime ? runtimeQuestionId(runtime.knowledge, kind) : questionId(target.questionPrefix, kind),
    ),
    hintLevel: 0,
    attemptCount: 0,
    incorrectCount: 0,
    startedAt: index === 0 ? startedAt : null,
    completedAt: null,
  }));
  if (activities.some((activity) => ["recall", "guided_practice", "independent_check"].includes(activity.kind) && !activity.questionRevisionId)) return null;
  return {
    id,
    ownerTeamId,
    learnerId,
    contentPackageId: runtime?.package.id ?? null,
    contentPackageVersion: runtime?.package.version ?? null,
    subjectId: runtime?.package.subjectId ?? "math",
    planId: plan?.id ?? null,
    decisionId: decision?.id ?? null,
    targetKnowledgeId,
    targetTitle: target.title,
    strategy: decision?.strategy ?? plan.days[0].strategy,
    pace,
    plannedMinutes: paceDefinition.totalMinutes,
    status: "active",
    revision: 1,
    currentActivityIndex: 0,
    activities,
    consecutiveIncorrect: 0,
    methodSwitchCount: 0,
    teachingMethod: initialMethod(decision?.strategy),
    intervention: null,
    evidenceAttemptIds: [],
    startedAt,
    pausedAt: null,
    completedAt: null,
    updatedAt: startedAt,
    summary: null,
  };
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
      attemptCount: activity.attemptCount,
      instruction: instructionFor(activity.kind, contentDefinition, session.teachingMethod, preferences),
      question,
      hint: activity.hintLevel ? contentDefinition.hints[Math.min(activity.hintLevel, contentDefinition.hints.length) - 1] : null,
      visualScene: runtime?.capabilities.visualInteractions === false ? null : buildPrivateTutorVisualScene({
        knowledgeId: session.targetKnowledgeId,
        activityKind: activity.kind,
        teachingMethod: session.teachingMethod,
        questionRevisionId: activity.questionRevisionId,
      }),
    } : null,
    teachingMethod: session.teachingMethod,
    teachingPreferences: preferences ? {
      teacherStyle: preferences.teacherStyle,
      explanationDepth: preferences.explanationDepth,
      followUpStyle: preferences.followUpStyle,
    } : null,
    subjectCapabilities: runtime?.capabilities ?? null,
    methodSwitchCount: session.methodSwitchCount,
    intervention: session.intervention,
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

export function recordPrivateTutorSessionAnswer(session, { correct, attemptId, now }) {
  const activity = currentActivity(session);
  if (!activity?.questionRevisionId) return { ok: false, error: "private_tutor_answer_not_available" };
  activity.attemptCount += 1;
  session.evidenceAttemptIds.push(attemptId);
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
  if (!pkg || !knowledge) return null;
  const teaching = knowledge.teachingContent ?? {};
  return {
    package: pkg,
    knowledge,
    capabilities: registry.getSubjectPlugin(pkg.subjectId)?.getCapabilities?.() ?? {
      deterministicGrading: false,
      stepEvaluation: false,
      speechEvaluation: false,
      visualInteractions: false,
    },
    content: {
      title: knowledge.name ?? knowledge.id,
      explanation: teaching.coreConcept ?? knowledge.shortDescription ?? "先理解核心概念，再用练习确认。",
      hints: teaching.keyPoints?.length ? teaching.keyPoints : ["回到定义，逐项检查条件。"],
    },
  };
}

function runtimeQuestionId(knowledge, kind) {
  const questions = knowledge.tutoringQuestions ?? [];
  if (!questions.length) return null;
  if (kind === "recall") return questions[0]?.id ?? null;
  if (kind === "guided_practice") return questions[1]?.id ?? questions[0]?.id ?? null;
  if (kind === "independent_check") return questions[2]?.id ?? questions.at(-1)?.id ?? null;
  return null;
}

function instructionFor(kind, contentDefinition, teachingMethod, preferences = null) {
  const styleFrame = preferences ? styleFraming(preferences) : null;
  const depthFrame = preferences ? depthFraming(preferences.explanationDepth) : null;
  if (kind === "recall") return `先回想一下“${contentDefinition.title}”，看看昨天的理解还在不在。`;
  if (kind === "explain") {
    const base = `${contentDefinition.explanation} 当前讲法：${methodLabel(teachingMethod)}。`;
    return `${base}${styleFrame ?? ""}${depthFrame ?? ""}`;
  }
  if (kind === "guided_practice") {
    const base = "我会陪你做这一步；需要时可以逐级看提示。";
    return `${base}${styleFrame ?? ""}`;
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
  const reviewAt = new Date(completedAt);
  reviewAt.setUTCDate(reviewAt.getUTCDate() + 1);
  return {
    learned: `今天完成了“${session.targetTitle}”的回想、理解和练习。`,
    independentCompleted: Boolean(independent?.completedAt && independent.hintLevel === 0),
    hintedActivities,
    methodSwitchCount: session.methodSwitchCount,
    evidenceCount: session.evidenceAttemptIds.length,
    reviewAt: reviewAt.toISOString(),
    nextStep: independent?.completedAt && independent.hintLevel === 0
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
