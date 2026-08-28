import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateTutorView } from "@/features/private-tutor/private-tutor-view";

const apiMocks = vi.hoisted(() => ({ answer: vi.fn(), correctDiagnosis: vi.fn() }));

vi.mock("@/hooks/use-session-user", () => ({
  useSessionUser: () => ({ role: "viewer" }),
}));

const learner = { id: "lrn_review", displayName: "小满", grade: "七年级", curriculumEditionId: null, status: "active", createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" } as const;
const snapshot = {
  id: "pts_review", learnerId: learner.id, revision: 4, dailyMinutes: 20, completedSessions: 1, independentAnswers: 2,
  diagnosticCompletedAt: "2026-08-20T00:00:00.000Z", latestAssessmentId: "pas_done",
  knowledge: [
    { id: "integer", mastery: 0.7, level: "learning", evidenceCount: 3 },
    { id: "equation-meaning", mastery: 0.7, level: "learning", evidenceCount: 3 },
    { id: "balance", mastery: 0.4, level: "needs_support", evidenceCount: 4 },
    { id: "word-problem", mastery: null, level: "unknown", evidenceCount: 0 },
  ], updatedAt: "2026-08-20T00:00:00.000Z",
} as const;
const completedAssessment = { id: "pas_done", learnerId: learner.id, status: "completed", revision: 13, startedAt: "2026-08-20T00:00:00.000Z", pausedAt: null, completedAt: "2026-08-20T00:10:00.000Z", activeSeconds: 600, targetSeconds: 600, minQuestions: 12, maxQuestions: 18, answeredCount: 12, currentQuestion: null, result: { knowledge: [], strengths: [], focus: ["balance"], answeredCount: 12 }, updatedAt: "2026-08-20T00:10:00.000Z" } as const;
const reviewBook = {
  learnerId: learner.id,
  counts: { challengeToday: 1, working: 0, mastered: 0 },
  themes: [{
    id: "theme_1", learnerId: learner.id, knowledgeId: "balance", title: "等式两边同乘同除", misconception: "等式变形正确，但计算还不稳定", learnerDiagnosisCorrection: null,
    strategy: "fluency_practice", status: "challenge_today", occurrenceCount: 1, reopenedCount: 0,
    latestQuestion: { revisionId: "tutor-bal-guided-001-v1", knowledgeId: "balance", difficulty: 2, kind: "numeric", prompt: "3x = 15，x 是多少？", options: null },
    latestAnswer: { normalizedAnswer: "4", responseKind: "answer", source: "screen", recognitionConfidence: null, usedHint: false, independent: false },
    schedule: { id: "schedule_1", phase: "correction", dueAt: "2026-08-20T00:00:00.000Z", due: true, completedAt: null, question: { revisionId: "tutor-bal-guided-001-v1", knowledgeId: "balance", difficulty: 2, kind: "numeric", prompt: "3x = 15，x 是多少？", options: null } },
    masteredAt: null, updatedAt: "2026-08-20T00:00:00.000Z",
  }],
} as const;

vi.mock("@/features/private-tutor/private-tutor-api", () => ({
  getPrivateTutorProfile: () => Promise.resolve({ profile: learner, migrationRequired: false }),
  getPrivateTutorSnapshot: () => Promise.resolve({ learner, profile: learner, snapshot, learnerModel: null, strategyDecision: null, learningPlan: null }),
  getPrivateTutorRoadmapLedger: () => Promise.resolve(null),
  getCurrentPrivateTutorAssessment: () => Promise.resolve(completedAssessment),
  getCurrentPrivateTutorSession: () => Promise.resolve(null),
  getPrivateTutorReviewBook: () => Promise.resolve(reviewBook),
  getPrivateTutorLearningPreferences: () => Promise.reject(new Error("not used")),
  updatePrivateTutorLearningPreferences: () => Promise.reject(new Error("not used")),
  answerPrivateTutorReview: apiMocks.answer,
  correctPrivateTutorReviewDiagnosis: apiMocks.correctDiagnosis,
  rebalancePrivateTutorLearningPlan: () => Promise.reject(new Error("not used")),
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

describe("My private tutor review book", () => {
  beforeEach(() => {
    window.localStorage.clear();
    apiMocks.answer.mockResolvedValue({ reviewBook: { ...reviewBook, counts: { challengeToday: 0, working: 1, mastered: 0 } }, snapshot, replayed: false });
    apiMocks.correctDiagnosis.mockResolvedValue(reviewBook);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("submits raw review evidence and lets the learner correct the diagnosed cause", async () => {
    render(<PrivateTutorView />);
    fireEvent.click(await screen.findByRole("button", { name: "我的错题本" }));
    expect(await screen.findByText("真正的错因：等式变形正确，但计算还不稳定")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "开始纠正" }));
    fireEvent.change(screen.getByLabelText("复习答案"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "提交答案" }));
    await waitFor(() => expect(apiMocks.answer).toHaveBeenCalled());
    expect(apiMocks.answer.mock.calls[0][1]).toMatchObject({ questionRevisionId: "tutor-bal-guided-001-v1", rawAnswer: "5", responseKind: "answer", source: "screen" });
    expect(apiMocks.answer.mock.calls[0][1]).not.toHaveProperty("correct");

    fireEvent.change(screen.getByPlaceholderText("例如：方法会了，只是刚才算错了"), { target: { value: "方法会了，只是刚才算错了" } });
    fireEvent.click(screen.getByRole("button", { name: "修正错因" }));
    await waitFor(() => expect(apiMocks.correctDiagnosis).toHaveBeenCalledWith("theme_1", "方法会了，只是刚才算错了"));
  });
});
