export type TutorTab = "today" | "map" | "errors" | "growth" | "settings";

export type TutorSettingsSpace = "student" | "guardian" | "educator" | "safety" | "system";

export type MasteryLevel = "mastered" | "learning" | "needs_support" | "unknown";

export type TeachingStrategy =
  | "prerequisite_repair"
  | "concept_rebuild"
  | "fluency_practice"
  | "transfer_challenge";

export interface LearnerProfile {
  id: string;
  displayName: string;
  grade: string;
  curriculum: string;
  avatar: string;
}

export interface KnowledgeNode {
  id: string;
  title: string;
  mastery: number | null;
  level: MasteryLevel;
  evidence: string;
}

export interface ErrorCase {
  id: string;
  learnerId: string;
  knowledgeId: string;
  title: string;
  misconception: string;
  status: "challenge_today" | "working" | "mastered";
  nextReview: string;
  strategy: TeachingStrategy;
}

export interface LearnerTutorState {
  learner: LearnerProfile;
  dailyMinutes: number;
  streakDays: number;
  completedSessions: number;
  independentAnswers: number;
  knowledge: KnowledgeNode[];
  errors: ErrorCase[];
}

export const DEMO_LEARNERS: LearnerProfile[] = [
  { id: "learner-xiaohe", displayName: "小禾", grade: "七年级", curriculum: "演示课程 · 方程基础", avatar: "禾" },
  { id: "learner-anran", displayName: "安然", grade: "七年级", curriculum: "演示课程 · 方程基础", avatar: "安" },
];

const KNOWLEDGE_TEMPLATE: KnowledgeNode[] = [
  { id: "integer", title: "有理数运算", mastery: 0.86, level: "mastered", evidence: "3 次独立答对" },
  { id: "equation-meaning", title: "等式与方程", mastery: 0.68, level: "learning", evidence: "会列式，移项含义待巩固" },
  { id: "balance", title: "等式两边同乘同除", mastery: 0.42, level: "needs_support", evidence: "2 次忘记同时处理等式两边" },
  { id: "word-problem", title: "一元一次方程应用", mastery: null, level: "unknown", evidence: "尚未测到" },
];

export function createInitialLearnerState(learner: LearnerProfile): LearnerTutorState {
  const isSecondDemoLearner = learner.id === "learner-anran";
  const knowledge = KNOWLEDGE_TEMPLATE.map((node) => isSecondDemoLearner && node.id === "balance"
    ? { ...node, mastery: 0.73, level: "learning" as const, evidence: "图形理解稳定，计算速度待提升" }
    : { ...node });
  return {
    learner,
    dailyMinutes: isSecondDemoLearner ? 11 : 6,
    streakDays: isSecondDemoLearner ? 5 : 3,
    completedSessions: isSecondDemoLearner ? 9 : 6,
    independentAnswers: isSecondDemoLearner ? 24 : 17,
    knowledge,
    errors: [
      {
        id: `${learner.id}-balance-sign`,
        learnerId: learner.id,
        knowledgeId: "balance",
        title: isSecondDemoLearner ? "解方程时计算不够熟练" : "等式两边要做同样的事",
        misconception: isSecondDemoLearner ? "概念正确，但符号计算速度慢" : "只处理了等式的一边",
        status: isSecondDemoLearner ? "working" : "challenge_today",
        nextReview: isSecondDemoLearner ? "明天" : "今天",
        strategy: isSecondDemoLearner ? "fluency_practice" : "concept_rebuild",
      },
      {
        id: `${learner.id}-negative-number`,
        learnerId: learner.id,
        knowledgeId: "integer",
        title: "负数减法",
        misconception: "把减去负数当成继续相减",
        status: "mastered",
        nextReview: "3 天后复测",
        strategy: "transfer_challenge",
      },
    ],
  };
}

export function strategyLabel(strategy: TeachingStrategy) {
  return {
    prerequisite_repair: "回到前置知识",
    concept_rebuild: "用天平重新理解",
    fluency_practice: "短组流畅度练习",
    transfer_challenge: "换一道新题验证",
  }[strategy];
}

export function completeIndependentCheck(state: LearnerTutorState): LearnerTutorState {
  return {
    ...state,
    dailyMinutes: Math.min(20, state.dailyMinutes + 4),
    independentAnswers: state.independentAnswers + 1,
    knowledge: state.knowledge.map((node) => node.id === "balance"
      ? {
          ...node,
          mastery: Math.min(1, (node.mastery ?? 0) + 0.12),
          level: "learning",
          evidence: "刚刚独立答对一题，等待延迟复测",
        }
      : node),
    errors: state.errors.map((item) => item.knowledgeId === "balance"
      ? { ...item, status: "working", nextReview: "明天" }
      : item),
  };
}

export function assertLearnerBoundary(state: LearnerTutorState, learnerId: string) {
  return state.learner.id === learnerId && state.errors.every((item) => item.learnerId === learnerId);
}
