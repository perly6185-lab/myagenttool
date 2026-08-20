import { privateTutorQuestion, publicQuestion } from "./private-tutor-assessment.mjs";
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

export function createPrivateTutorSession({ id, ownerTeamId, learnerId, plan, decision, pace, now }) {
  const paceDefinition = PRIVATE_TUTOR_SESSION_PACES[pace];
  if (!paceDefinition) return null;
  const targetKnowledgeId = plan?.days?.[0]?.knowledgeId ?? decision?.targetKnowledgeId;
  const target = KNOWLEDGE_CONTENT[targetKnowledgeId];
  if (!target) return null;
  const startedAt = now();
  return {
    id,
    ownerTeamId,
    learnerId,
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
    activities: ACTIVITY_KINDS.map((kind, index) => ({
      kind,
      budgetMinutes: paceDefinition.budgets[index],
      status: index === 0 ? "active" : "pending",
      questionRevisionId: questionId(target.questionPrefix, kind),
      hintLevel: 0,
      attemptCount: 0,
      incorrectCount: 0,
      startedAt: index === 0 ? startedAt : null,
      completedAt: null,
    })),
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

export function privateTutorSessionView(session) {
  if (!session) return null;
  const contentDefinition = KNOWLEDGE_CONTENT[session.targetKnowledgeId];
  const activity = session.activities[session.currentActivityIndex] ?? null;
  const question = activity?.questionRevisionId ? publicQuestion(privateTutorQuestion(activity.questionRevisionId)) : null;
  return {
    id: session.id,
    learnerId: session.learnerId,
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
      instruction: instructionFor(activity.kind, contentDefinition, session.teachingMethod),
      question,
      hint: activity.hintLevel ? contentDefinition.hints[Math.min(activity.hintLevel, contentDefinition.hints.length) - 1] : null,
      visualScene: buildPrivateTutorVisualScene({
        knowledgeId: session.targetKnowledgeId,
        activityKind: activity.kind,
        teachingMethod: session.teachingMethod,
        questionRevisionId: activity.questionRevisionId,
      }),
    } : null,
    teachingMethod: session.teachingMethod,
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

function instructionFor(kind, contentDefinition, teachingMethod) {
  if (kind === "recall") return `先回想一下“${contentDefinition.title}”，看看昨天的理解还在不在。`;
  if (kind === "explain") return `${contentDefinition.explanation} 当前讲法：${methodLabel(teachingMethod)}。`;
  if (kind === "guided_practice") return "我会陪你做这一步；需要时可以逐级看提示。";
  if (kind === "independent_check") return "这是一道没见过的新题。先不看提示，自己验证能不能迁移。";
  return "看看今天学会了什么，以及下一次什么时候回来复习。";
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
