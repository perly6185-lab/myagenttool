import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateTutorView } from "@/features/private-tutor/private-tutor-view";

const apiMocks = vi.hoisted(() => ({
  start: vi.fn(),
  answer: vi.fn(),
}));

vi.mock("@/hooks/use-session-user", () => ({
  useSessionUser: () => ({
    role: "viewer",
    privateTutorChildMode: { learnerId: "lrn_new", enteredAt: "2026-08-20T00:00:00.000Z" },
  }),
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
  getPrivateTutorSnapshot: () => Promise.resolve({ learner: profile, snapshot }),
  getCurrentPrivateTutorAssessment: () => Promise.resolve(null),
  startPrivateTutorAssessment: apiMocks.start,
  answerPrivateTutorAssessment: apiMocks.answer,
  pausePrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  resumePrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  listPrivateTutorLearners: () => Promise.resolve([]),
  createPrivateTutorLearner: () => Promise.reject(new Error("not used")),
  startPrivateTutorChildMode: () => Promise.reject(new Error("not used")),
  exitPrivateTutorChildMode: () => Promise.reject(new Error("not used")),
  recordPrivateTutorAttempt: () => Promise.reject(new Error("not used")),
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

    expect(await screen.findByText("先让我认识一下你会什么")).toBeTruthy();
    expect(screen.getByText(/没有排名/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "开始摸底" }));
    expect(await screen.findByText("x + 4 = 9，x 是多少？")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("写下答案"), { target: { value: "x=5" } });
    fireEvent.click(screen.getByRole("button", { name: "提交并看下一题" }));

    await waitFor(() => expect(apiMocks.answer).toHaveBeenCalled());
    const input = apiMocks.answer.mock.calls[0][2];
    expect(input.rawAnswer).toBe("x=5");
    expect(input.responseKind).toBe("answer");
    expect(input).not.toHaveProperty("correct");
  });
});
