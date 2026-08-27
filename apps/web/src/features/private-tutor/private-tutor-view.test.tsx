import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatPrivateTutorEvaluationFeedback, PrivateTutorView } from "@/features/private-tutor/private-tutor-view";
import { ApiError } from "@/lib/api/request";

const apiMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  createProfile: vi.fn(),
  migrationReport: vi.fn(),
  confirmMigration: vi.fn(),
  snapshot: vi.fn(),
  currentAssessment: vi.fn(),
  startAssessment: vi.fn(),
  answerAssessment: vi.fn(),
  startSession: vi.fn(),
  activePackage: vi.fn(),
  listPackages: vi.fn(),
  getPackage: vi.fn(),
  activatePackage: vi.fn(),
  learningHistory: vi.fn(),
  learningTrial: vi.fn(),
  startLearningTrial: vi.fn(),
  stopLearningTrial: vi.fn(),
  learningPreferences: vi.fn(),
  updateLearningPreferences: vi.fn(),
}));

const sessionUser = { role: "viewer" } as const;

vi.mock("@/hooks/use-session-user", () => ({
  useSessionUser: () => sessionUser,
}));

const activeProfile = { id: "lrn_personal", displayName: "小林", grade: "大学课程", curriculumEditionId: "demo-math-foundations-v1", status: "active", createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z" } as const;

const freshSnapshot = {
  id: "pts_personal",
  learnerId: activeProfile.id,
  revision: 1,
  dailyMinutes: 0,
  completedSessions: 0,
  independentAnswers: 0,
  diagnosticCompletedAt: "2026-08-24T00:00:00.000Z",
  latestAssessmentId: "pas_done",
  knowledge: [
    { id: "integer", mastery: null, level: "unknown", evidenceCount: 0 },
    { id: "equation-meaning", mastery: null, level: "unknown", evidenceCount: 0 },
    { id: "balance", mastery: null, level: "unknown", evidenceCount: 0 },
    { id: "word-problem", mastery: null, level: "unknown", evidenceCount: 0 },
  ],
  updatedAt: "2026-08-24T00:00:00.000Z",
} as const;

const completedAssessment = {
  id: "pas_done",
  learnerId: activeProfile.id,
  status: "completed",
  revision: 13,
  startedAt: "2026-08-24T00:00:00.000Z",
  pausedAt: null,
  completedAt: "2026-08-24T00:10:00.000Z",
  activeSeconds: 600,
  targetSeconds: 600,
  minQuestions: 12,
  maxQuestions: 18,
  answeredCount: 12,
  currentQuestion: null,
  result: { knowledge: [], strengths: [], focus: ["balance"], answeredCount: 12 },
  updatedAt: "2026-08-24T00:10:00.000Z",
} as const;

const emptyReviewBook = { learnerId: activeProfile.id, counts: { challengeToday: 0, working: 0, mastered: 0 }, themes: [] } as const;
const learningPreferences = {
  learnerId: activeProfile.id, captions: true, reducedMotion: false, dailyMinutes: 20, planIntensity: "standard",
  teacherStyle: "heuristic_guidance", explanationDepth: "concise_then_expand", followUpStyle: "gentle_probe", voicePreference: "push_to_talk",
  learningGoal: null, deactivatedPackageIds: [], revision: 1, schemaVersion: 1, updatedAt: "2026-08-24T00:00:00.000Z",
} as const;

vi.mock("@/features/private-tutor/private-tutor-api", () => ({
  getPrivateTutorProfile: apiMocks.getProfile,
  createPrivateTutorProfile: apiMocks.createProfile,
  getPrivateTutorProfileMigrationReport: apiMocks.migrationReport,
  confirmPrivateTutorProfileMigration: apiMocks.confirmMigration,
  getPrivateTutorSnapshot: apiMocks.snapshot,
  getCurrentPrivateTutorAssessment: apiMocks.currentAssessment,
  getCurrentPrivateTutorSession: () => Promise.resolve(null),
  getPrivateTutorReviewBook: () => Promise.resolve(emptyReviewBook),
  getPrivateTutorLearningHistory: apiMocks.learningHistory,
  getPrivateTutorLearningTrial: apiMocks.learningTrial,
  startPrivateTutorLearningTrial: apiMocks.startLearningTrial,
  stopPrivateTutorLearningTrial: apiMocks.stopLearningTrial,
  getPrivateTutorLearningPreferences: apiMocks.learningPreferences,
  updatePrivateTutorLearningPreferences: apiMocks.updateLearningPreferences,
  getPrivateTutorWeeklyReport: () => Promise.reject(new Error("not used")),
  getPrivateTutorDataPolicy: () => Promise.reject(new Error("not used")),
  updatePrivateTutorDataPolicy: () => Promise.reject(new Error("not used")),
  exportPrivateTutorLearnerData: () => Promise.reject(new Error("not used")),
  previewPrivateTutorLearnerDeletion: () => Promise.reject(new Error("not used")),
  deletePrivateTutorProfile: () => Promise.reject(new Error("not used")),
  listPrivateTutorDeletionJobs: () => Promise.resolve([]),
  retryPrivateTutorLearnerDeletion: () => Promise.reject(new Error("not used")),
  startPrivateTutorAssessment: apiMocks.startAssessment,
  answerPrivateTutorAssessment: apiMocks.answerAssessment,
  pausePrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  resumePrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  startPrivateTutorSession: apiMocks.startSession,
  pausePrivateTutorSession: () => Promise.reject(new Error("not used")),
  resumePrivateTutorSession: () => Promise.reject(new Error("not used")),
  actOnPrivateTutorSession: () => Promise.reject(new Error("not used")),
  createPrivateTutorVoiceTurn: () => Promise.reject(new Error("not used")),
  recordPrivateTutorVoiceEvent: () => Promise.reject(new Error("not used")),
  answerPrivateTutorReview: () => Promise.reject(new Error("not used")),
  correctPrivateTutorReviewDiagnosis: () => Promise.reject(new Error("not used")),
  rebalancePrivateTutorLearningPlan: () => Promise.reject(new Error("not used")),
  listPrivateTutorContentPackages: apiMocks.listPackages,
  getPrivateTutorContentPackage: apiMocks.getPackage,
  activatePrivateTutorContentPackage: apiMocks.activatePackage,
  getPrivateTutorActiveContentPackage: apiMocks.activePackage,
  listPrivateTutorMaterials: () => Promise.resolve([]),
  uploadPrivateTutorMaterial: () => Promise.reject(new Error("not used")),
  generatePrivateTutorKnowledgeMapDraft: () => Promise.reject(new Error("not used")),
  getPrivateTutorKnowledgeMapDraft: () => Promise.reject(new Error("not used")),
  updatePrivateTutorKnowledgeMapDraft: () => Promise.reject(new Error("not used")),
  publishPrivateTutorKnowledgeMapDraft: () => Promise.reject(new Error("not used")),
  listPrivateTutorContentMigrationCandidates: () => Promise.resolve([]),
  createPrivateTutorContentMigrationPreview: () => Promise.reject(new Error("not used")),
  updatePrivateTutorContentMigrationMapping: () => Promise.reject(new Error("not used")),
  confirmPrivateTutorContentMigration: () => Promise.reject(new Error("not used")),
  applyPrivateTutorContentMigration: () => Promise.reject(new Error("not used")),
  rollbackPrivateTutorContentMigration: () => Promise.reject(new Error("not used")),
}));

const migrationReportFixture = {
  migrationRequired: true,
  profileCount: 2,
  recommendedKeepLearnerId: "lrn_keep",
  candidates: [
    { learnerId: "lrn_keep", displayName: "小林", grade: "大学课程", createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z", evidence: { attempts: 8, assessments: 1, tutoringSessions: 2, reviewSchedules: 3, auditEvents: 12 }, evidenceTotal: 26 },
    { learnerId: "lrn_legacy", displayName: "旧档案", grade: "七年级", createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z", evidence: { attempts: 2, assessments: 0, tutoringSessions: 0, reviewSchedules: 1, auditEvents: 4 }, evidenceTotal: 7 },
  ],
} as const;

describe("My private tutor personal learning information architecture", () => {
  beforeEach(() => {
    window.localStorage.clear();
    apiMocks.getProfile.mockReset().mockResolvedValue({ profile: null, migrationRequired: false });
    apiMocks.createProfile.mockReset().mockRejectedValue(new Error("not used"));
    apiMocks.migrationReport.mockReset().mockRejectedValue(new Error("not used"));
    apiMocks.confirmMigration.mockReset().mockRejectedValue(new Error("not used"));
    apiMocks.snapshot.mockReset().mockResolvedValue({ learner: activeProfile, profile: activeProfile, snapshot: freshSnapshot, learnerModel: null, strategyDecision: null, learningPlan: null });
    apiMocks.currentAssessment.mockReset().mockResolvedValue(completedAssessment);
    apiMocks.startAssessment.mockReset().mockRejectedValue(new Error("not used"));
    apiMocks.answerAssessment.mockReset().mockRejectedValue(new Error("not used"));
    apiMocks.startSession.mockReset().mockRejectedValue(new Error("not used"));
    apiMocks.activePackage.mockReset().mockResolvedValue({
      id: "demo-math-foundations-v1",
      name: "初中数学基础：一元一次方程",
      subjectId: "math",
      domain: "math",
      sourceType: "textbook",
      version: "1.0.0",
      targetAudience: { stage: "初中/通用基础" },
      evaluationCapabilities: { deterministicGrading: true },
      knowledgeComponents: [
        { id: "integer", name: "有理数运算", shortDescription: "正负数加减" },
        { id: "balance", name: "等式两边同乘同除", shortDescription: "保持等式平衡" },
      ],
    });
    apiMocks.listPackages.mockReset().mockResolvedValue([{
      id: "demo-math-foundations-v1",
      name: "初中数学基础：一元一次方程",
      subjectId: "math",
      domain: "math",
      sourceType: "textbook",
      version: "1.0.0",
      targetAudience: { stage: "初中/通用基础" },
      evaluationCapabilities: { deterministicGrading: true },
    }]);
    apiMocks.getPackage.mockReset().mockRejectedValue(new Error("not used"));
    apiMocks.activatePackage.mockReset().mockRejectedValue(new Error("not used"));
    apiMocks.learningHistory.mockReset().mockResolvedValue({
      schemaVersion: 1,
      learnerId: activeProfile.id,
      generatedAt: "2026-08-26T08:00:00.000Z",
      definitions: {},
      summary: {
        packageCount: 1, chapterCount: 1, sessionCount: 2, completedSessionCount: 2,
        startedPlanDayCount: 2, completedPlanDayCount: 1, planDayCompletionRate: 0.5,
        practiceAttemptCount: 6, eligibleEvidenceCount: 4, evidenceEligibilityRate: 0.6667,
        independentAttemptCount: 3, independentCorrectCount: 2, independentCorrectRate: 0.6667,
        scheduledReviewCount: 2, completedReviewCount: 1, dueReviewCount: 1, upcomingReviewCount: 0,
        sourceRubricAttemptCount: 3, sourceRubricRequiredReviewCount: 1, sourceRubricCompletedReviewCount: 1,
        sourceRubricReviewCompletionRate: 1,
      },
      packages: [{
        packageId: "demo-math-foundations-v1", packageVersion: "1.0.0", packageName: "初中数学基础：一元一次方程",
        sourceType: "textbook", packageStatus: "published", contentDefinitionAvailable: true,
        firstActivityAt: "2026-08-20T08:00:00.000Z", lastActivityAt: "2026-08-26T08:00:00.000Z",
        activationCount: 1, assessmentCount: 1, completedAssessmentCount: 1,
        summary: {
          sessionCount: 2, completedSessionCount: 2, startedPlanDayCount: 2, completedPlanDayCount: 1,
          planDayCompletionRate: 0.5, currentPlan: { planId: "plan-1", status: "active", scheduledDays: 7, completedDays: 1, inProgressDays: 1 },
          practiceAttemptCount: 6, eligibleEvidenceCount: 4, evidenceEligibilityRate: 0.6667,
          independentAttemptCount: 3, independentCorrectCount: 2, independentCorrectRate: 0.6667,
          review: { scheduledCount: 2, completedCount: 1, dueCount: 1, upcomingCount: 0 },
          sourceRubric: { attemptCount: 3, requiredReviewCount: 1, completedReviewCount: 1, pendingReviewCount: 0, reviewCompletionRate: 1 },
        },
        chapters: [{
          moduleId: "mod-equations", moduleName: "一元一次方程与等式性质", orderIndex: 1, knowledgeCount: 4,
          firstActivityAt: "2026-08-20T08:00:00.000Z", lastActivityAt: "2026-08-26T08:00:00.000Z",
          summary: {
            sessionCount: 2, completedSessionCount: 2, startedPlanDayCount: 2, completedPlanDayCount: 1,
            planDayCompletionRate: 0.5, currentPlan: { planId: "plan-1", status: "active", scheduledDays: 7, completedDays: 1, inProgressDays: 1 },
            practiceAttemptCount: 6, eligibleEvidenceCount: 4, evidenceEligibilityRate: 0.6667,
            independentAttemptCount: 3, independentCorrectCount: 2, independentCorrectRate: 0.6667,
            review: { scheduledCount: 2, completedCount: 1, dueCount: 1, upcomingCount: 0 },
            sourceRubric: { attemptCount: 3, requiredReviewCount: 1, completedReviewCount: 1, pendingReviewCount: 0, reviewCompletionRate: 1 },
          },
          topics: [{ topicId: "top-foundations", topicName: "运算与方程基础", knowledgeIds: ["integer"] }],
        }],
        recentSessions: [{ id: "session-1", status: "completed", moduleId: "mod-equations", moduleName: "一元一次方程与等式性质", knowledgeId: "integer", knowledgeTitle: "有理数运算", planId: "plan-1", planDayIndex: 1, practiceCount: 3, evidenceCount: 2, startedAt: "2026-08-25T08:00:00.000Z", completedAt: "2026-08-25T08:20:00.000Z", reviewAt: "2026-08-26T08:20:00.000Z" }],
      }],
    });
    apiMocks.learningTrial.mockReset().mockResolvedValue(null);
    apiMocks.startLearningTrial.mockReset().mockRejectedValue(new Error("not used"));
    apiMocks.stopLearningTrial.mockReset().mockRejectedValue(new Error("not used"));
    apiMocks.learningPreferences.mockReset().mockResolvedValue(learningPreferences);
    apiMocks.updateLearningPreferences.mockReset().mockImplementation(async (patch) => ({ ...learningPreferences, ...patch, revision: 2 }));
  });
  afterEach(() => cleanup());

  it("starts a signed-in user with one personal learning profile instead of a family handoff", async () => {
    render(<PrivateTutorView />);

    expect(await screen.findByRole("heading", { name: "为我建立一份长期学习档案" })).toBeTruthy();
    expect(screen.getByText(/未来也可以接入大学教材、专业课程或你自己的资料/)).toBeTruthy();
    expect(screen.queryByText("选择孩子")).toBeNull();
    expect(screen.queryByText("家长 PIN")).toBeNull();
  });

  it("creates the current account profile through the single-profile contract", async () => {
    apiMocks.createProfile.mockResolvedValue({ profile: activeProfile, created: true, migrationRequired: false });
    apiMocks.currentAssessment.mockResolvedValue(null);
    render(<PrivateTutorView />);

    fireEvent.change(await screen.findByLabelText("私教怎么称呼你"), { target: { value: "小林" } });
    fireEvent.change(screen.getByLabelText("当前学习阶段"), { target: { value: "大学课程" } });
    fireEvent.click(screen.getByRole("button", { name: "开始我的学习" }));

    expect(apiMocks.createProfile).toHaveBeenCalledWith({
      displayName: "小林",
      grade: "大学课程",
      curriculumEditionId: "demo-math-foundations-v1",
    });
    expect(await screen.findByRole("heading", { name: "先选择这次想学什么" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /快速学一个知识点/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /用当前内容开始摸底/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /选择课程或导入我的教材/ })).toBeTruthy();
  });

  it("starts a three-question diagnostic for one learner-selected knowledge point", async () => {
    apiMocks.getProfile.mockResolvedValue({ profile: activeProfile, migrationRequired: false });
    apiMocks.currentAssessment.mockResolvedValue(null);
    apiMocks.startAssessment.mockResolvedValue({
      id: "pas_quick",
      learnerId: activeProfile.id,
      mode: "quick",
      targetKnowledgeId: "balance",
      status: "active",
      revision: 1,
      startedAt: "2026-08-27T00:00:00.000Z",
      pausedAt: null,
      completedAt: null,
      activeSeconds: 0,
      targetSeconds: 135,
      minQuestions: 3,
      maxQuestions: 3,
      answeredCount: 0,
      currentQuestion: { revisionId: "diag-bal-01-v1", knowledgeId: "balance", difficulty: 1, kind: "choice", prompt: "为了保持等式平衡，下一步应该怎么做？", options: [{ id: "a", label: "只改左边" }, { id: "b", label: "两边相同操作" }] },
      result: null,
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    render(<PrivateTutorView />);

    fireEvent.click(await screen.findByRole("button", { name: /快速学一个知识点/ }));
    expect(await screen.findByRole("heading", { name: "选择一个知识点，3 题后开始学" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /等式两边同乘同除/ }));
    fireEvent.click(screen.getByRole("button", { name: "开始 3 题快速摸底" }));

    await waitFor(() => expect(apiMocks.startAssessment).toHaveBeenCalledWith({ mode: "quick", targetKnowledgeId: "balance" }));
    expect(await screen.findByText("为了保持等式平衡，下一步应该怎么做？")).toBeTruthy();
    expect(screen.getByText("第 1 题 · 共 3 题")).toBeTruthy();
  });

  it("moves a completed quick diagnostic directly into a five-minute lesson", async () => {
    const activeQuickAssessment = {
      id: "pas_quick",
      learnerId: activeProfile.id,
      mode: "quick",
      targetKnowledgeId: "balance",
      status: "active",
      revision: 3,
      startedAt: "2026-08-27T00:00:00.000Z",
      pausedAt: null,
      completedAt: null,
      activeSeconds: 80,
      targetSeconds: 135,
      minQuestions: 3,
      maxQuestions: 3,
      answeredCount: 2,
      currentQuestion: { revisionId: "diag-bal-03-v1", knowledgeId: "balance", difficulty: 3, kind: "numeric", prompt: "2(x + 1) = 8，x 是多少？", options: null },
      result: null,
      updatedAt: "2026-08-27T00:01:20.000Z",
    } as const;
    apiMocks.getProfile.mockResolvedValue({ profile: activeProfile, migrationRequired: false });
    apiMocks.currentAssessment.mockResolvedValue(activeQuickAssessment);
    apiMocks.answerAssessment.mockResolvedValue({
      ...activeQuickAssessment,
      status: "completed",
      revision: 4,
      completedAt: "2026-08-27T00:02:00.000Z",
      answeredCount: 3,
      currentQuestion: null,
      result: { knowledge: [{ knowledgeId: "balance", mastery: 0.85, level: "mastered", evidenceCount: 3, correctCount: 3, dontKnowCount: 0 }], strengths: ["balance"], focus: [], answeredCount: 3 },
    });
    apiMocks.startSession.mockResolvedValue({ session: null, resumedExisting: false });
    render(<PrivateTutorView />);

    fireEvent.change(await screen.findByLabelText("写下答案"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "提交并看下一题" }));
    expect(await screen.findByRole("heading", { name: "3 题快速摸底完成" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "开始 5 分钟私教" }));

    await waitFor(() => expect(apiMocks.startSession).toHaveBeenCalledWith("easy"));
  });

  it("lets a new learner manage content before starting a diagnostic", async () => {
    apiMocks.getProfile.mockResolvedValue({ profile: activeProfile, migrationRequired: false });
    apiMocks.currentAssessment.mockResolvedValue(null);
    render(<PrivateTutorView />);

    fireEvent.click(await screen.findByRole("button", { name: /选择课程或导入我的教材/ }));

    expect(await screen.findByRole("heading", { name: "我的设置" })).toBeTruthy();
    expect(screen.getByText("选择学习内容")).toBeTruthy();
    expect(screen.getByRole("button", { name: "导入我的资料" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "返回开始方式" }));
    fireEvent.click(screen.getByRole("button", { name: /用当前内容开始摸底/ }));
    expect(await screen.findByRole("heading", { name: "先让我认识一下你会什么" })).toBeTruthy();
  });

  it("keeps the five personal learning capabilities at level one", async () => {
    apiMocks.getProfile.mockResolvedValue({ profile: activeProfile, migrationRequired: false });
    render(<PrivateTutorView />);

    for (const label of ["今日学习", "知识地图", "我的错题本", "我的成长", "我的设置"]) {
      expect(await screen.findByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("keeps learning content and the AI teacher inside my settings", async () => {
    apiMocks.getProfile.mockResolvedValue({ profile: activeProfile, migrationRequired: false });
    render(<PrivateTutorView />);
    fireEvent.click(await screen.findByRole("button", { name: "我的设置" }));

    expect(screen.getByRole("button", { name: /学习偏好/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /学习内容/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /AI 私教/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /学习数据/ })).toBeTruthy();
    expect(screen.queryByText("家庭与监护")).toBeNull();
    expect(screen.queryByText("家长入口")).toBeNull();
  });

  it("persists AI teacher and daily-plan preferences through the profile contract", async () => {
    apiMocks.getProfile.mockResolvedValue({ profile: activeProfile, migrationRequired: false });
    render(<PrivateTutorView />);
    fireEvent.click(await screen.findByRole("button", { name: "我的设置" }));

    fireEvent.change(screen.getByLabelText("每天可用时间"), { target: { value: "35" } });
    await waitFor(() => expect(apiMocks.updateLearningPreferences).toHaveBeenCalledWith({ dailyMinutes: 35 }));

    fireEvent.click(screen.getByRole("button", { name: /AI 私教/ }));
    fireEvent.change(screen.getByLabelText("老师的讲解方式"), { target: { value: "socratic_questioning" } });
    await waitFor(() => expect(apiMocks.updateLearningPreferences).toHaveBeenCalledWith({ teacherStyle: "socratic_questioning" }));
  });

  it("shows versioned chapter history and real long-term quality metrics", async () => {
    apiMocks.getProfile.mockResolvedValue({ profile: activeProfile, migrationRequired: false });
    render(<PrivateTutorView />);
    fireEvent.click(await screen.findByRole("button", { name: "我的成长" }));

    expect(await screen.findByText("已完成 1/2 个开始过的计划日")).toBeTruthy();
    expect(screen.getByText("一元一次方程与等式性质")).toBeTruthy();
    expect(screen.getByText("当前计划：完成 1/7 天，进行中 1 天。")).toBeTruthy();
    expect(screen.getByText("有理数运算")).toBeTruthy();
    expect(apiMocks.learningHistory).toHaveBeenCalledTimes(1);
  });

  it("starts a fourteen-day real-course trial without inventing early results", async () => {
    apiMocks.getProfile.mockResolvedValue({ profile: activeProfile, migrationRequired: false });
    apiMocks.startLearningTrial.mockResolvedValue({
      id: "ptlt_1", learnerId: activeProfile.id, contentPackageId: "demo-math-foundations-v1", contentPackageVersion: "1.0.0",
      contentPackageName: "初中数学基础：一元一次方程", goal: "验证方程学习效果", durationDays: 14, status: "active",
      startedAt: "2026-08-27T00:00:00.000Z", endsAt: "2026-09-10T00:00:00.000Z", stoppedAt: null, completedAt: null,
      progress: { dayIndex: 1, activeDayCount: 0, daysRemaining: 13, completedSessionCount: 0 },
      metrics: {
        planDays: { startedCount: 0, completedCount: 0, completionRate: null },
        nextDayRecall: { opportunityCount: 0, attemptedCount: 0, correctCount: 0, retentionRate: null },
        delayedReview: { opportunityCount: 0, attemptedCount: 0, correctCount: 0, retentionRate: null },
        followUps: { askedCount: 0, feedbackCount: 0, resolvedCount: 0, resolutionRate: null, feedbackCoverageRate: null },
      },
      readiness: { minimumSampleCount: 3, nextDayRecallReady: false, delayedReviewReady: false, followUpResolutionReady: false },
      generatedAt: "2026-08-27T00:00:00.000Z",
    });
    render(<PrivateTutorView />);
    fireEvent.click(await screen.findByRole("button", { name: "我的成长" }));

    expect(await screen.findByRole("heading", { name: /验证次日还能不能想起/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("试学目标"), { target: { value: "验证方程学习效果" } });
    fireEvent.click(screen.getByRole("button", { name: "开始 14 天试学" }));

    await waitFor(() => expect(apiMocks.startLearningTrial).toHaveBeenCalledWith("验证方程学习效果"));
    expect(await screen.findByText("试学中 · 第 1/14 天")).toBeTruthy();
    expect(screen.getAllByText("暂无").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText(/· 样本不足$/).length).toBe(3);
  });

  it("chooses diagnostic or a concrete chapter before activating personal material", async () => {
    const personalPackage = {
      id: "pkg-user-feedback",
      name: "形成性反馈",
      subjectId: "general",
      domain: "education",
      sourceType: "user_material",
      version: "1.0.0",
      targetAudience: { stage: "custom" },
      evaluationCapabilities: { deterministicGrading: false, sourceGrounding: true },
      modules: [{ id: "mod-feedback", name: "第一章 学习证据", description: "", orderIndex: 1, topics: [] }],
      knowledgeComponents: [],
    } as const;
    apiMocks.getProfile.mockResolvedValue({ profile: activeProfile, migrationRequired: false });
    apiMocks.listPackages.mockResolvedValue([personalPackage]);
    apiMocks.getPackage.mockResolvedValue(personalPackage);
    apiMocks.activatePackage.mockResolvedValue({
      activePackage: personalPackage,
      snapshot: freshSnapshot,
      activation: { id: "ptact_1", entryMode: "chapter", startModuleId: "mod-feedback", status: "active" },
      runtimeValidation: { id: "ptrv_1", status: "passed" },
      learnerModel: null,
      strategyDecision: null,
      learningPlan: null,
    });
    render(<PrivateTutorView />);
    fireEvent.click(await screen.findByRole("button", { name: "我的设置" }));
    fireEvent.click(screen.getByRole("button", { name: /学习内容/ }));
    fireEvent.click(await screen.findByRole("button", { name: "选择开始方式" }));

    expect(await screen.findByText(/如何开始“形成性反馈”/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/从指定章节开始/));
    expect((screen.getByLabelText("开始章节") as HTMLSelectElement).value).toBe("mod-feedback");
    fireEvent.click(screen.getByRole("button", { name: "校准并开始" }));

    await waitFor(() => expect(apiMocks.activatePackage).toHaveBeenCalledWith({
      packageId: "pkg-user-feedback",
      entryMode: "chapter",
      startModuleId: "mod-feedback",
    }));
  });

  it("shows unknown knowledge as unmeasured instead of weak", async () => {
    apiMocks.getProfile.mockResolvedValue({ profile: activeProfile, migrationRequired: false });
    render(<PrivateTutorView />);
    fireEvent.click(await screen.findByRole("button", { name: "知识地图" }));

    expect(screen.getAllByText("尚未测到").length).toBeGreaterThan(0);
    expect(screen.getAllByText("等待后续学习证据").length).toBeGreaterThan(0);
  });

  it("stops safely instead of substituting demo data when a real learner cannot load", async () => {
    apiMocks.getProfile.mockResolvedValue({ profile: activeProfile, migrationRequired: false });
    apiMocks.snapshot.mockRejectedValue(new Error("offline test fixture"));
    render(<PrivateTutorView />);

    expect(await screen.findByText("学习空间暂时没有准备好")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("避免显示错误或演示数据");
    expect(screen.queryByText("我的学习")).toBeNull();
    expect(screen.queryByText("自主学习")).toBeNull();
    expect(screen.getByRole("button", { name: "重新读取" })).toBeTruthy();
  });

  it("gates learning behind a report-first migration when the account still owns multiple profiles", async () => {
    apiMocks.getProfile.mockRejectedValue(new ApiError("private_tutor_profile_migration_required", "这个账号存在多份学习档案，需要先完成迁移。", 409, { profileCount: 2 }));
    apiMocks.migrationReport.mockResolvedValue(migrationReportFixture);
    apiMocks.confirmMigration.mockResolvedValue({
      merged: true,
      dryRun: false,
      plan: { keepLearnerId: "lrn_keep", discardLearnerIds: ["lrn_legacy"], dryRun: false, rewrites: { privateTutorAttempts: 2 }, rewrittenTotal: 7, cohortRewrites: 0, childModeSessionRewrites: 0, discardedProfileCount: 1 },
      rollbackReceipt: { id: "ptmr_1", keepLearnerId: "lrn_keep", discardLearnerIds: ["lrn_legacy"], appliedAt: "2026-08-24T01:00:00.000Z", rewrittenTotal: 7, rollbackCheck: { residualDiscardReferences: 1, expectedResidualDiscardReferences: 1 } },
    });
    render(<PrivateTutorView />);

    expect(await screen.findByRole("heading", { name: "这个账号还保留着多份历史学习档案" })).toBeTruthy();
    expect(await screen.findByText("旧档案 · 七年级")).toBeTruthy();
    expect(screen.getByText("建议保留")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "今日学习" })).toBeNull();

    apiMocks.getProfile.mockResolvedValue({ profile: activeProfile, migrationRequired: false });
    fireEvent.click(screen.getByRole("button", { name: "保留这一份并合并其余档案" }));

    await waitFor(() => expect(apiMocks.confirmMigration).toHaveBeenCalledWith({ keepLearnerId: "lrn_keep", discardLearnerIds: ["lrn_legacy"] }));
    expect(await screen.findByRole("button", { name: "今日学习" })).toBeTruthy();
  });

  it("keeps history untouched when the migration rollback check fails", async () => {
    apiMocks.getProfile.mockRejectedValue(new ApiError("private_tutor_profile_migration_required", "这个账号存在多份学习档案，需要先完成迁移。", 409, { profileCount: 2 }));
    apiMocks.migrationReport.mockResolvedValue(migrationReportFixture);
    apiMocks.confirmMigration.mockResolvedValue({
      merged: true,
      dryRun: false,
      plan: { keepLearnerId: "lrn_keep", discardLearnerIds: ["lrn_legacy"], dryRun: false, rewrites: {}, rewrittenTotal: 7, cohortRewrites: 0, childModeSessionRewrites: 0, discardedProfileCount: 1 },
      rollbackReceipt: { id: "ptmr_1", keepLearnerId: "lrn_keep", discardLearnerIds: ["lrn_legacy"], appliedAt: "2026-08-24T01:00:00.000Z", rewrittenTotal: 7, rollbackCheck: { residualDiscardReferences: 4, expectedResidualDiscardReferences: 1 } },
    });
    render(<PrivateTutorView />);

    fireEvent.click(await screen.findByRole("button", { name: "保留这一份并合并其余档案" }));

    expect((await screen.findByRole("alert")).textContent).toContain("迁移校验没有完全通过");
    expect(apiMocks.getProfile).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "今日学习" })).toBeNull();
  });
});

describe("private tutor evaluation feedback", () => {
  it("surfaces the first incorrect math step before the general explanation", () => {
    expect(formatPrivateTutorEvaluationFeedback({
      firstIncorrectStep: 1,
      explanation: "请检查整个解题过程。",
      steps: [
        { correct: true, feedback: "这一步正确。" },
        { correct: false, feedback: "只改变等式一边会破坏平衡。" },
      ],
    })).toBe("第 2 步：只改变等式一边会破坏平衡。");
  });

  it("surfaces calibrated semantic-review feedback", () => {
    expect(formatPrivateTutorEvaluationFeedback({
      semanticStatus: "complete_review_required",
      requiresReview: true,
      explanation: "表达完整，但当前语音置信度不足。",
    })).toBe("表达完整，但当前语音置信度不足。");
  });

  it("surfaces conceptual anchor-review feedback", () => {
    expect(formatPrivateTutorEvaluationFeedback({
      score: 0.75,
      scoreBand: "developing",
      anchorId: "anchor-developing-v1",
      reviewReason: "score_near_proficiency_boundary",
      requiresReview: true,
      explanation: "回答接近熟练锚点，建议复核：说明如何调整学习。",
    })).toBe("回答接近熟练锚点，建议复核：说明如何调整学习。");
  });
});
