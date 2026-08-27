import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateTutorView } from "@/features/private-tutor/private-tutor-view";

const apiMocks = vi.hoisted(() => ({
  start: vi.fn(),
  answer: vi.fn(),
}));

vi.mock("@/hooks/use-session-user", () => ({
  useSessionUser: () => ({ role: "viewer" }),
}));

const profile = { id: "lrn_new", displayName: "小满", grade: "七年级", curriculumEditionId: null, status: "active", createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" };
const snapshot = {
  id: "pts_new",
  learnerId: "lrn_new",
  revision: 1,
  dailyMinutes: 0,
  completedSessions: 0,
  independentAnswers: 0,
  diagnosticCompletedAt: null,
  latestAssessmentId: null,
  knowledge: ["integer", "equation-meaning", "balance", "word-problem"].map((id) => ({ id, mastery: null, level: "unknown", evidenceCount: 0 })),
  updatedAt: "2026-08-20T00:00:00.000Z",
};
const activeAssessment = {
  id: "pas_1",
  learnerId: "lrn_new",
  status: "active",
  revision: 1,
  startedAt: "2026-08-20T00:00:00.000Z",
  pausedAt: null,
  completedAt: null,
  activeSeconds: 0,
  targetSeconds: 600,
  minQuestions: 12,
  maxQuestions: 18,
  answeredCount: 0,
  currentQuestion: { revisionId: "diag-eqm-02-v1", knowledgeId: "equation-meaning", difficulty: 2, kind: "numeric", prompt: "x + 4 = 9，x 是多少？", options: null },
  result: null,
  updatedAt: "2026-08-20T00:00:00.000Z",
} as const;

vi.mock("@/features/private-tutor/private-tutor-api", () => ({
  getPrivateTutorProfile: () => Promise.resolve({ profile, migrationRequired: false }),
  getPrivateTutorSnapshot: () => Promise.resolve({ learner: profile, profile, snapshot }),
  getCurrentPrivateTutorAssessment: () => Promise.resolve(null),
  getCurrentPrivateTutorSession: () => Promise.resolve(null),
  getPrivateTutorReviewBook: () => Promise.resolve({ learnerId: profile.id, counts: { challengeToday: 0, working: 0, mastered: 0 }, themes: [] }),
  startPrivateTutorAssessment: apiMocks.start,
  answerPrivateTutorAssessment: apiMocks.answer,
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
  rebalancePrivateTutorLearningPlan: () => Promise.reject(new Error("not used")),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("My private tutor adaptive diagnostic", () => {
  it("starts with a low-pressure explanation and submits raw math for server grading", async () => {
    apiMocks.start.mockResolvedValue(activeAssessment);
    apiMocks.answer.mockResolvedValue({ ...activeAssessment, revision: 2, answeredCount: 1 });
    render(<PrivateTutorView />);

    fireEvent.click(await screen.findByRole("button", { name: /^用当前内容开始摸底/ }));
    expect(await screen.findByText("先让我认识一下你会什么")).toBeTruthy();
    expect(screen.getByText(/没有排名/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "开始摸底" }));
    expect(await screen.findByText("x + 4 = 9，x 是多少？")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("写下答案"), { target: { value: "x=5" } });
    fireEvent.click(screen.getByRole("button", { name: "提交并看下一题" }));

    await waitFor(() => expect(apiMocks.answer).toHaveBeenCalled());
    const input = apiMocks.answer.mock.calls[0][1];
    expect(input.rawAnswer).toBe("x=5");
    expect(input.responseKind).toBe("answer");
    expect(input).not.toHaveProperty("correct");
  });
});
