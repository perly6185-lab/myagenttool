import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateTutorView } from "@/features/private-tutor/private-tutor-view";

const apiMocks = vi.hoisted(() => ({ rebalance: vi.fn(), previewCatchUp: vi.fn(), confirmCatchUp: vi.fn() }));

vi.mock("@/hooks/use-session-user", () => ({
  useSessionUser: () => ({ role: "viewer" }),
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
  weeklyMinutes: 140,
  goalRoadmap: {
    schemaVersion: 2, generatedAt: "2026-08-20T00:10:00.000Z", currentWeekIndex: 2, estimatedWeekCount: 3, projectedFinalWeekIndex: 4, scopeKnowledgeCount: 4, completedKnowledgeCount: 1, targetDate: "2026-09-10", status: "at_risk", hiddenMilestoneCount: 0,
    milestones: [
      { weekIndex: 2, startDate: "2026-08-20", endDate: "2026-08-26", status: "current", plannedMinutes: 140, cumulativePlannedMinutes: 140, expectedCompletedKnowledgeCount: 2, knowledgeGoals: [{ knowledgeId: "integer", title: "有理数运算", plannedMinutes: 60, expectedComplete: true }] },
      { weekIndex: 3, startDate: "2026-08-27", endDate: "2026-09-02", status: "upcoming", plannedMinutes: 140, cumulativePlannedMinutes: 280, expectedCompletedKnowledgeCount: 3, knowledgeGoals: [{ knowledgeId: "balance", title: "等式两边同乘同除", plannedMinutes: 75, expectedComplete: true }] },
    ],
  },
  progressSignal: { schemaVersion: 1, calculatedAt: "2026-08-24T08:00:00.000Z", status: "attention", scheduledElapsedMinutes: 40, completedElapsedMinutes: 20, behindMinutes: 20, overdueDayCount: 1, overdueDayIndexes: [2], recoverableDayCount: 1, catchUpAvailable: true, nextPlannedDate: "2026-08-24" },
  goalForecast: { schemaVersion: 1, assumptionVersion: "knowledge-effort-v1", generatedAt: "2026-08-20T00:10:00.000Z", status: "at_risk", reasonCode: "capacity_has_little_buffer", targetDate: "2026-09-10", scopeKnowledgeCount: 4, masteredKnowledgeCount: 1, remainingKnowledgeCount: 3, estimatedRemainingMinutes: 280, weeklyCapacityMinutes: 140, estimatedWeekCount: 2, projectedCompletionDate: "2026-09-03", daysRemaining: 21, availableMinutesUntilTarget: 440, requiredWeeklyMinutes: 94 },
  days: Array.from({ length: 7 }, (_, index) => ({
    dayIndex: index + 1, date: `2026-08-${21 + index}`, status: index === 0 ? "completed" : "planned", knowledgeId: "integer", knowledgeTitle: "有理数运算",
    activity: index === 6 ? "review" : "practice", title: index === 0 ? "补稳正负数运算" : `第 ${index + 1} 步`, minutes: 20,
    strategy: "prerequisite_repair", rationale: "先补稳前置知识",
  })), updatedAt: "2026-08-20T00:10:00.000Z",
} as const;

const roadmapLedger = {
  schemaVersion: 1, id: "ptrl_1", learnerId: learner.id, contentPackageId: "demo-math-foundations-v1", contentPackageVersion: "1.0.0", status: "active", revision: 3,
  learningGoal: { contentPackageId: "demo-math-foundations-v1", targetTopicIds: ["topic-balance"], weeklyMinutes: 140, targetDate: "2026-09-10", note: "掌握方程" }, scopeKnowledgeIds: ["integer", "balance"],
  baseline: { recordedAt: "2026-08-20T00:10:00.000Z", planId: learningPlan.id, planRevision: 1, weekIndex: 2, weeklyMinutes: 140, targetDate: "2026-09-10", completionWindow: { optimistic: "2026-08-31", likely: "2026-09-03", conservative: "2026-09-07" }, projectedCompletionDate: "2026-09-03", estimatedRemainingMinutes: 280, estimatedWeekCount: 2, milestones: learningPlan.goalRoadmap.milestones },
  currentReview: { weekIndex: 2, startDate: "2026-08-21", endDate: "2026-08-27", fullWeekPlannedMinutes: 140, plannedToDateMinutes: 40, completedToDateMinutes: 20, deviationMinutes: -20, overdueDayCount: 1, status: "behind", reasonCodes: ["missed_learning_days"], nextAction: { type: "continue_plan", dayIndex: 2, date: "2026-08-22", knowledgeId: "integer", label: "继续“有理数运算”" }, calculatedAt: "2026-08-24T08:00:00.000Z" },
  weeklyReviews: [{ id: "ptrw_1", weekIndex: 1, startDate: "2026-08-14", endDate: "2026-08-20", plannedMinutes: 140, completedMinutes: 120, deviationMinutes: -20, completionRate: 0.8571, status: "partial", reasonCodes: ["missed_learning_days"], completedKnowledgeIds: ["integer"], nextAction: { type: "continue_plan", dayIndex: 1, date: "2026-08-21", knowledgeId: "balance", label: "继续“等式平衡”" }, closedAt: "2026-08-21T00:00:00.000Z" }],
  routeVersions: [{ id: "ptrs_1", recordedAt: "2026-08-20T00:10:00.000Z", reason: "diagnostic_completed", planId: learningPlan.id, planRevision: 1, weekIndex: 2, forecastStatus: "at_risk", projectedCompletionDate: "2026-09-03", estimatedRemainingMinutes: 280, completedDayCount: 1, rescheduledDayCount: 0 }],
  createdAt: "2026-08-20T00:10:00.000Z", updatedAt: "2026-08-24T08:00:00.000Z",
} as const;

vi.mock("@/features/private-tutor/private-tutor-api", () => ({
  getPrivateTutorProfile: () => Promise.resolve({ profile: learner, migrationRequired: false }),
  getPrivateTutorSnapshot: () => Promise.resolve({ learner, profile: learner, snapshot, learnerModel, strategyDecision, learningPlan }),
  getPrivateTutorRoadmapLedger: () => Promise.resolve(roadmapLedger),
  getCurrentPrivateTutorAssessment: () => Promise.resolve({ id: "pas_done", learnerId: learner.id, status: "completed", revision: 13, startedAt: "2026-08-20T00:00:00.000Z", pausedAt: null, completedAt: "2026-08-20T00:10:00.000Z", activeSeconds: 600, targetSeconds: 600, minQuestions: 12, maxQuestions: 18, answeredCount: 12, currentQuestion: null, result: { knowledge: [], strengths: [], focus: ["balance"], answeredCount: 12 }, updatedAt: "2026-08-20T00:10:00.000Z" }),
  getCurrentPrivateTutorSession: () => Promise.resolve(null),
  getPrivateTutorReviewBook: () => Promise.resolve({ learnerId: learner.id, counts: { challengeToday: 0, working: 0, mastered: 0 }, themes: [] }),
  getPrivateTutorLearningPreferences: () => Promise.reject(new Error("not used")),
  updatePrivateTutorLearningPreferences: () => Promise.reject(new Error("not used")),
  rebalancePrivateTutorLearningPlan: apiMocks.rebalance,
  previewPrivateTutorCatchUp: apiMocks.previewCatchUp,
  confirmPrivateTutorCatchUp: apiMocks.confirmCatchUp,
  startPrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  answerPrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  pausePrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  resumePrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  startPrivateTutorSession: () => Promise.reject(new Error("not used")),
  pausePrivateTutorSession: () => Promise.reject(new Error("not used")),
  resumePrivateTutorSession: () => Promise.reject(new Error("not used")),
  actOnPrivateTutorSession: () => Promise.reject(new Error("not used")),
  createPrivateTutorVoiceTurn: () => Promise.reject(new Error("not used")),
  recordPrivateTutorVoiceEvent: () => Promise.reject(new Error("not used")),
  answerPrivateTutorReview: () => Promise.reject(new Error("not used")),
  correctPrivateTutorReviewDiagnosis: () => Promise.reject(new Error("not used")),
  getPrivateTutorWeeklyReport: () => Promise.reject(new Error("not used")),
  getPrivateTutorDataPolicy: () => Promise.reject(new Error("not used")),
  updatePrivateTutorDataPolicy: () => Promise.reject(new Error("not used")),
  exportPrivateTutorLearnerData: () => Promise.reject(new Error("not used")),
  previewPrivateTutorLearnerDeletion: () => Promise.reject(new Error("not used")),
  deletePrivateTutorProfile: () => Promise.reject(new Error("not used")),
  listPrivateTutorDeletionJobs: () => Promise.resolve([]),
  retryPrivateTutorLearnerDeletion: () => Promise.reject(new Error("not used")),
  getPrivateTutorProfileMigrationReport: () => Promise.reject(new Error("not used")),
  confirmPrivateTutorProfileMigration: () => Promise.reject(new Error("not used")),
  createPrivateTutorProfile: () => Promise.reject(new Error("not used")),
}));

describe("My private tutor personalized learning plan", () => {
  beforeEach(() => {
    window.localStorage.clear();
    apiMocks.rebalance.mockResolvedValue({ learnerModel, strategyDecision, learningPlan: { ...learningPlan, revision: 2, reason: "missed_day_rescheduled" } });
    const catchUpPreview = { schemaVersion: 1, planId: learningPlan.id, expectedPlanRevision: 1, generatedAt: "2026-08-24T08:00:00.000Z", fingerprint: "catch-up-fingerprint", requiresConfirmation: true, progress: learningPlan.progressSignal, assignments: [{ sourceDayIndex: 2, sourceDate: "2026-08-22", targetDayIndex: 6, targetDate: "2026-08-26", minutes: 20, knowledgeId: "integer", knowledgeTitle: "有理数运算", title: "第 2 步" }], recoveredMinutes: 20, remainingBehindMinutes: 0, canConfirm: true } as const;
    apiMocks.previewCatchUp.mockResolvedValue(catchUpPreview);
    apiMocks.confirmCatchUp.mockResolvedValue({ preview: catchUpPreview, learnerModel, strategyDecision, learningPlan: { ...learningPlan, revision: 2, reason: "catch_up_confirmed", progressSignal: { ...learningPlan.progressSignal, status: "on_track", behindMinutes: 0, overdueDayCount: 0, catchUpAvailable: false } } });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("explains the seven-day plan and reschedules a missed day without blame", async () => {
    render(<PrivateTutorView />);
    expect(await screen.findByText("我的 7 天计划")).toBeTruthy();
    expect(screen.getAllByText(strategyDecision.studentReason)).toHaveLength(3);
    expect(screen.getAllByText("20 分钟").length).toBeGreaterThanOrEqual(7);
    expect(screen.getByText("长期路线第 2 周 · 当前范围 4 个知识点")).toBeTruthy();
    expect(screen.getByText("可以尝试，但缓冲时间很少")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "今天来不及，帮我顺延" }));
    await waitFor(() => expect(apiMocks.rebalance).toHaveBeenCalledWith(2));
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

  it("shows cross-week milestones and requires confirmation before using a buffer day", async () => {
    render(<PrivateTutorView />);
    expect(await screen.findByText("跨周路线图")).toBeTruthy();
    expect(await screen.findByText("长期路线账本")).toBeTruthy();
    expect(screen.getByText("唯一下一步：继续“有理数运算”")).toBeTruthy();
    expect(screen.getByText("第 1 周 · 部分完成")).toBeTruthy();
    expect(screen.getByText("有一小段进度待补上")).toBeTruthy();
    expect(screen.getByText(/第 2 周 · 140 分钟/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "查看机动日追赶安排" }));
    await waitFor(() => expect(apiMocks.previewCatchUp).toHaveBeenCalledWith(1));
    expect(screen.getByText(/第 2 天 → 2026-08-26 机动日/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认使用机动日" }));
    await waitFor(() => expect(apiMocks.confirmCatchUp).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/其他课程和历史证据都没有变化/)).toBeTruthy();
  });
});
