import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateTutorView } from "@/features/private-tutor/private-tutor-view";

const apiMocks = vi.hoisted(() => ({ rebalance: vi.fn() }));

vi.mock("@/hooks/use-session-user", () => ({
  useSessionUser: () => ({
    role: "viewer",
    privateTutorChildMode: { learnerId: "lrn_plan", enteredAt: "2026-08-20T00:00:00.000Z" },
  }),
}));

const learner = { id: "lrn_plan", displayName: "小满", grade: "七年级", curriculumEditionId: null, status: "active", createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" } as const;
const snapshot = {
  id: "pts_plan", learnerId: learner.id, revision: 3, dailyMinutes: 0, completedSessions: 0, independentAnswers: 0,
  diagnosticCompletedAt: "2026-08-20T00:10:00.000Z", latestAssessmentId: "pas_done",
  knowledge: [
    { id: "integer", mastery: 0.35, level: "needs_support", evidenceCount: 3 },
    { id: "equation-meaning", mastery: 0.62, level: "learning", evidenceCount: 3 },
    { id: "balance", mastery: 0.4, level: "needs_support", evidenceCount: 4 },
    { id: "word-problem", mastery: null, level: "unknown", evidenceCount: 0 },
  ], updatedAt: "2026-08-20T00:10:00.000Z",
} as const;
const learnerModel = {
  id: "ptm_1", learnerId: learner.id, revision: 1, sourceSnapshotRevision: 3, reason: "diagnostic_completed",
  knowledge: snapshot.knowledge.map((item) => ({
    ...item, title: item.id === "balance" ? "等式两边同乘同除" : item.id, confidence: item.evidenceCount ? 0.75 : 0,
    independentCorrect: 1, hintedCorrect: 0, incorrect: item.evidenceCount ? 2 : 0, hintDependency: 0,
    latestEvidenceAt: item.evidenceCount ? "2026-08-20T00:09:00.000Z" : null, forgettingRisk: 0,
    misconception: item.id === "balance" ? { id: "single_side_change", label: "只改变了等式一边", evidenceCount: 2 } : null,
    prerequisiteId: item.id === "balance" ? "integer" : null, prerequisiteGap: item.id === "balance",
  })), updatedAt: "2026-08-20T00:10:00.000Z",
} as const;
const strategyDecision = {
  id: "ptd_1", learnerId: learner.id, modelId: learnerModel.id, targetKnowledgeId: "integer", targetTitle: "有理数运算",
  strategy: "prerequisite_repair", reasonCode: "prerequisite_gap", studentReason: "先补稳有理数运算，后面的方程会更容易。",
  misconception: null, exitConditions: ["前置新题独立通过"], createdAt: "2026-08-20T00:10:00.000Z",
} as const;
const learningPlan = {
  id: "ptp_1", learnerId: learner.id, revision: 1, status: "active", reason: "diagnostic_completed",
  studentReason: strategyDecision.studentReason, generatedAt: "2026-08-20T00:10:00.000Z",
  days: Array.from({ length: 7 }, (_, index) => ({
    dayIndex: index + 1, date: `2026-08-${21 + index}`, status: "planned", knowledgeId: "integer", knowledgeTitle: "有理数运算",
    activity: index === 6 ? "review" : "practice", title: index === 0 ? "补稳正负数运算" : `第 ${index + 1} 步`, minutes: 20,
    strategy: "prerequisite_repair", rationale: "先补稳前置知识",
  })), updatedAt: "2026-08-20T00:10:00.000Z",
} as const;

vi.mock("@/features/private-tutor/private-tutor-api", () => ({
  getPrivateTutorSnapshot: () => Promise.resolve({ learner, snapshot, learnerModel, strategyDecision, learningPlan }),
  getCurrentPrivateTutorAssessment: () => Promise.resolve({ id: "pas_done", learnerId: learner.id, status: "completed", revision: 13, startedAt: "2026-08-20T00:00:00.000Z", pausedAt: null, completedAt: "2026-08-20T00:10:00.000Z", activeSeconds: 600, targetSeconds: 600, minQuestions: 12, maxQuestions: 18, answeredCount: 12, currentQuestion: null, result: { knowledge: [], strengths: [], focus: ["balance"], answeredCount: 12 }, updatedAt: "2026-08-20T00:10:00.000Z" }),
  getCurrentPrivateTutorSession: () => Promise.resolve(null),
  rebalancePrivateTutorLearningPlan: apiMocks.rebalance,
  startPrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  answerPrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  pausePrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  resumePrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  listPrivateTutorLearners: () => Promise.resolve([]),
  createPrivateTutorLearner: () => Promise.reject(new Error("not used")),
  startPrivateTutorChildMode: () => Promise.reject(new Error("not used")),
  exitPrivateTutorChildMode: () => Promise.reject(new Error("not used")),
  recordPrivateTutorAttempt: () => Promise.reject(new Error("not used")),
}));

describe("My private tutor personalized learning plan", () => {
  beforeEach(() => {
    window.localStorage.clear();
    apiMocks.rebalance.mockResolvedValue({ learnerModel, strategyDecision, learningPlan: { ...learningPlan, revision: 2, reason: "missed_day_rescheduled" } });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("explains the seven-day plan and reschedules a missed day without blame", async () => {
    render(<PrivateTutorView />);
    expect(await screen.findByText("我的 7 天计划")).toBeTruthy();
    expect(screen.getAllByText(strategyDecision.studentReason)).toHaveLength(3);
    expect(screen.getAllByText("20 分钟")).toHaveLength(7);

    fireEvent.click(screen.getByRole("button", { name: "今天来不及，帮我顺延" }));
    await waitFor(() => expect(apiMocks.rebalance).toHaveBeenCalledWith(learner.id, 1));
    expect(await screen.findByText(/今天没有失败/)).toBeTruthy();
  });

  it("shows child-friendly evidence and keeps unknown knowledge unjudged", async () => {
    render(<PrivateTutorView />);
    fireEvent.click(await screen.findByRole("button", { name: "知识地图" }));

    expect(screen.getByText("最近卡在：只改变了等式一边")).toBeTruthy();
    expect(screen.getByText("先补稳前面的知识，后面会更容易。")).toBeTruthy();
    expect(screen.getAllByText(/证据把握 75%/)).toHaveLength(3);
    expect(screen.getAllByText("尚未测到").length).toBeGreaterThan(0);
  });
});
