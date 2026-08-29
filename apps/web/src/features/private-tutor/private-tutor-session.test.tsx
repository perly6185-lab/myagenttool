import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateTutorView } from "@/features/private-tutor/private-tutor-view";

const apiMocks = vi.hoisted(() => ({
  currentSession: vi.fn(),
  startSession: vi.fn(),
  pauseSession: vi.fn(),
  resumeSession: vi.fn(),
  action: vi.fn(),
  createVoiceTurn: vi.fn(),
  voiceEvent: vi.fn(),
}));

vi.mock("@/hooks/use-session-user", () => ({
  useSessionUser: () => ({ role: "viewer" }),
}));

const learner = { id: "lrn_session", displayName: "小满", grade: "七年级", curriculumEditionId: null, status: "active", createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:10:00.000Z" } as const;
const snapshot = {
  id: "pts_session", learnerId: learner.id, revision: 3, dailyMinutes: 0, completedSessions: 0, independentAnswers: 0,
  diagnosticCompletedAt: "2026-08-20T00:10:00.000Z", latestAssessmentId: "pas_done",
  knowledge: [
    { id: "integer", mastery: 0.7, level: "learning", evidenceCount: 3 },
    { id: "equation-meaning", mastery: 0.7, level: "learning", evidenceCount: 3 },
    { id: "balance", mastery: 0.4, level: "needs_support", evidenceCount: 3 },
    { id: "word-problem", mastery: null, level: "unknown", evidenceCount: 0 },
  ], updatedAt: "2026-08-20T00:10:00.000Z",
} as const;
const strategyDecision = { id: "ptd_1", learnerId: learner.id, modelId: "ptm_1", targetKnowledgeId: "balance", targetTitle: "等式两边同乘同除", strategy: "concept_rebuild", reasonCode: "concept_not_stable", studentReason: "这次用天平重新理解，不继续刷同类题。", misconception: null, exitConditions: ["独立完成一道新题"], createdAt: "2026-08-20T00:10:00.000Z" } as const;
const learningPlan = {
  id: "ptp_1", learnerId: learner.id, revision: 1, status: "active", reason: "diagnostic_completed", studentReason: strategyDecision.studentReason, generatedAt: "2026-08-20T00:10:00.000Z",
  days: Array.from({ length: 7 }, (_, index) => ({ dayIndex: index + 1, date: `2026-08-${21 + index}`, status: "planned", knowledgeId: "balance", knowledgeTitle: "等式两边同乘同除", activity: "practice", title: index === 0 ? "弄懂等式平衡" : `第 ${index + 1} 步`, minutes: 20, strategy: "concept_rebuild", rationale: "重建概念" })),
  updatedAt: "2026-08-20T00:10:00.000Z",
} as const;
const completedAssessment = { id: "pas_done", learnerId: learner.id, status: "completed", revision: 13, startedAt: "2026-08-20T00:00:00.000Z", pausedAt: null, completedAt: "2026-08-20T00:10:00.000Z", activeSeconds: 600, targetSeconds: 600, minQuestions: 12, maxQuestions: 18, answeredCount: 12, currentQuestion: null, result: { knowledge: [], strengths: [], focus: ["balance"], answeredCount: 12 }, updatedAt: "2026-08-20T00:10:00.000Z" } as const;
const balanceScene = {
  schemaVersion: 1, revisionId: "balance-recall-v1", template: "equation_balance", title: "等式是一架平衡的天平", ariaLabel: "2x 等于 10",
  parameters: { initialLeft: "2x", initialRight: "10", states: [{ narration: "先看两边", left: "2x", right: "10" }, { narration: "两边同时除以二", left: "x", right: "5" }] },
  steps: [{ id: "s1", index: 0, startMs: 0, durationMs: 2_400, narration: "先看两边", stateIndex: 0 }, { id: "s2", index: 1, startMs: 2_400, durationMs: 2_400, narration: "两边同时除以二", stateIndex: 1 }],
  interaction: { kind: "select_value", prompt: "选择 x", choices: [{ id: "c1", label: "4", value: "4" }, { id: "c2", label: "5", value: "5" }, { id: "c3", label: "6", value: "6" }] },
  publication: { status: "engineering_preview", contentVersion: "p7.1", mathValidated: true, reviewedAt: null },
} as const;

function sessionAt(kind: "recall" | "explain" | "guided_practice" | "independent_check" | "summary", status: "active" | "paused" = "active") {
  const kinds = ["recall", "explain", "guided_practice", "independent_check", "summary"] as const;
  const index = kinds.indexOf(kind);
  const question = kind === "recall" ? { revisionId: "tutor-bal-recall-001-v1", knowledgeId: "balance", difficulty: 1, kind: "numeric", prompt: "2x = 10，x 是多少？", options: null } : null;
  return {
    id: "ptsess_1", learnerId: learner.id, planId: learningPlan.id, decisionId: strategyDecision.id, targetKnowledgeId: "balance", targetTitle: "等式两边同乘同除", strategy: "concept_rebuild", pace: "standard", plannedMinutes: 20,
    status, revision: index + 1, currentActivityIndex: index,
    progress: kinds.map((item, itemIndex) => ({ kind: item, budgetMinutes: [2, 5, 7, 4, 2][itemIndex], status: itemIndex < index ? "completed" : itemIndex === index ? "active" : "pending" })),
    currentActivity: { kind, budgetMinutes: [2, 5, 7, 4, 2][index], hintLevel: 0, attemptCount: 0, instruction: kind === "explain" ? "把方程想成平衡的天平。" : "先回想一下。", question, hint: null, visualScene: question ? balanceScene : null },
    teachingMethod: "visual_model", methodSwitchCount: 0, intervention: null, pausedAt: status === "paused" ? "2026-08-20T00:12:00.000Z" : null,
    startedAt: "2026-08-20T00:11:00.000Z", completedAt: null, updatedAt: "2026-08-20T00:12:00.000Z", summary: null,
  } as const;
}

vi.mock("@/features/private-tutor/private-tutor-api", () => ({
  getPrivateTutorProfile: () => Promise.resolve({ profile: learner, migrationRequired: false }),
  getPrivateTutorSnapshot: () => Promise.resolve({ learner, profile: learner, snapshot, learnerModel: null, strategyDecision, learningPlan }),
  getPrivateTutorRoadmapLedger: () => Promise.resolve(null),
  getCurrentPrivateTutorAssessment: () => Promise.resolve(completedAssessment),
  getCurrentPrivateTutorSession: apiMocks.currentSession,
  getPrivateTutorReviewBook: () => Promise.resolve({ learnerId: learner.id, counts: { challengeToday: 0, working: 0, mastered: 0 }, themes: [] }),
  getPrivateTutorLearningPreferences: () => Promise.reject(new Error("not used")),
  updatePrivateTutorLearningPreferences: () => Promise.reject(new Error("not used")),
  startPrivateTutorSession: apiMocks.startSession,
  pausePrivateTutorSession: apiMocks.pauseSession,
  resumePrivateTutorSession: apiMocks.resumeSession,
  actOnPrivateTutorSession: apiMocks.action,
  createPrivateTutorVoiceTurn: apiMocks.createVoiceTurn,
  recordPrivateTutorVoiceEvent: apiMocks.voiceEvent,
  rebalancePrivateTutorLearningPlan: () => Promise.reject(new Error("not used")),
  startPrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  answerPrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  pausePrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  resumePrivateTutorAssessment: () => Promise.reject(new Error("not used")),
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

describe("My private tutor resumable daily session", () => {
  beforeEach(() => {
    window.localStorage.clear();
    apiMocks.currentSession.mockResolvedValue(null);
    apiMocks.voiceEvent.mockResolvedValue({ event: { id: "event_1", type: "recognition_started", createdAt: "2026-08-20T00:00:00.000Z" } });
  });
  afterEach(() => {
    cleanup();
    delete (window as typeof window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    vi.clearAllMocks();
  });

  it("starts in one click and sends only the raw answer for server judging", async () => {
    const recall = sessionAt("recall");
    apiMocks.startSession.mockResolvedValue({ session: recall, resumedExisting: false });
    apiMocks.action.mockResolvedValue({ session: sessionAt("explain"), snapshot, answer: { correct: true, independent: false, usedHint: false } });
    render(<PrivateTutorView />);

    fireEvent.click(await screen.findByRole("button", { name: /开始今天的学习/ }));
    expect(await screen.findByText("2x = 10，x 是多少？")).toBeTruthy();
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText("写下答案"), { target: { value: "x=5" } });
    const submitButton = screen.getByRole("button", { name: "提交答案" });
    await waitFor(() => expect((submitButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submitButton);

    await waitFor(() => expect(apiMocks.action).toHaveBeenCalled());
    const input = apiMocks.action.mock.calls[0][1];
    expect(input.rawAnswer).toBe("x=5");
    expect(input).not.toHaveProperty("correct");
    expect(await screen.findByText("把方程想成平衡的天平。")).toBeTruthy();
  });

  it("restores a paused lesson at the same step", async () => {
    const paused = sessionAt("guided_practice", "paused");
    apiMocks.currentSession.mockResolvedValue(paused);
    apiMocks.resumeSession.mockResolvedValue({ session: { ...paused, status: "active", pausedAt: null } });
    render(<PrivateTutorView />);

    expect(await screen.findByText("课程停在原来的位置")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "从这里继续" }));
    await waitFor(() => expect(apiMocks.resumeSession).toHaveBeenCalledWith(paused.id));
  });

  it("submits a whiteboard selection as explicit visual evidence for server judging", async () => {
    const recall = sessionAt("recall");
    apiMocks.currentSession.mockResolvedValue(recall);
    apiMocks.action.mockResolvedValue({ session: sessionAt("explain"), snapshot, answer: { correct: true, independent: false, usedHint: false } });
    render(<PrivateTutorView />);

    fireEvent.click(await screen.findByRole("button", { name: "5" }));
    await waitFor(() => expect(apiMocks.action).toHaveBeenCalled());
    expect(apiMocks.action.mock.calls[0][1]).toMatchObject({ rawAnswer: "5", source: "visual" });
  });

  it("keeps low-confidence speech out of grading until the child confirms the normalized math", async () => {
    const recall = sessionAt("recall");
    apiMocks.currentSession.mockResolvedValue(recall);
    apiMocks.createVoiceTurn.mockResolvedValue({
      replayed: false,
      voiceTurn: {
        id: "ptvt_1", learnerId: learner.id, sessionId: recall.id,
        questionRevisionId: recall.currentActivity.question?.revisionId,
        mode: "push_to_talk", provider: "browser_web_speech", transcript: "x 等于 五",
        normalizedExpression: "x=5", confidence: 0.54, status: "confirmation_required",
        requiresConfirmation: true, reasonCodes: ["low_confidence"], attemptId: null,
        createdAt: "2026-08-20T00:00:00.000Z", confirmedAt: null,
      },
    });
    apiMocks.action.mockResolvedValue({ session: sessionAt("explain"), snapshot, answer: { correct: true, independent: false, usedHint: false } });

    class MockRecognition {
      static latest: MockRecognition;
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((event: never) => void) | null = null;
      onerror = null;
      onend: (() => void) | null = null;
      constructor() { MockRecognition.latest = this; }
      start() {}
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    (window as typeof window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = MockRecognition;

    render(<PrivateTutorView />);
    fireEvent.click(await screen.findByRole("button", { name: "开始说话" }));
    MockRecognition.latest.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: "x 等于 五", confidence: 0.54 } } },
    } as never);

    expect(await screen.findByText("数学表达：x=5")).toBeTruthy();
    expect(apiMocks.action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /就是这个/ }));
    await waitFor(() => expect(apiMocks.action).toHaveBeenCalled());
    expect(apiMocks.action.mock.calls[0][1]).toMatchObject({ source: "voice_confirmed", voiceTurnId: "ptvt_1", rawAnswer: "" });
  });

  it("asks the active material and shows source-bounded feedback outside mastery evidence", async () => {
    const explain = sessionAt("explain");
    apiMocks.currentSession.mockResolvedValue(explain);
    apiMocks.action.mockResolvedValue({
      session: {
        ...explain,
        revision: explain.revision + 1,
        followUps: [{
          id: "ptfu_1",
          activityKind: "explain",
          mode: "question",
          question: "为什么两边要做相同操作？",
          response: "当前资料能确认的是：等式两边始终做相同的事情。资料没有覆盖的结论，我不会补写。",
          grounding: "source_excerpt",
          sourceRefs: [{ sectionId: "sec_2", pageNumber: 7, excerpt: "等式两边始终做相同的事情。" }],
          evidenceEligible: false,
          createdAt: "2026-08-20T00:13:00.000Z",
        }],
      },
    });
    render(<PrivateTutorView />);

    fireEvent.change(await screen.findByLabelText("向私教追问"), { target: { value: "为什么两边要做相同操作？" } });
    fireEvent.click(screen.getByRole("button", { name: "基于资料回答" }));

    await waitFor(() => expect(apiMocks.action).toHaveBeenCalledWith(explain.id, {
      action: "follow_up",
      mode: "question",
      question: "为什么两边要做相同操作？",
    }));
    expect(await screen.findByText(/当前资料能确认的是/)).toBeTruthy();
    expect(screen.getByText("等式两边始终做相同的事情。")).toBeTruthy();
    expect(screen.getByText("sec_2 · 第 7 页")).toBeTruthy();
    expect(screen.getByText("本次追问不产生练习证据。")).toBeTruthy();
    expect(screen.getByText("这次回答解决你的问题了吗？")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "解决了" }));
    await waitFor(() => expect(apiMocks.action).toHaveBeenLastCalledWith(explain.id, {
      action: "follow_up_feedback",
      followUpId: "ptfu_1",
      resolution: "resolved",
    }));
  });

  it("summarizes independent completion, help used, and the next review without ranking", async () => {
    const activeSummary = sessionAt("summary");
    apiMocks.currentSession.mockResolvedValue({
      ...activeSummary,
      status: "completed",
      currentActivityIndex: 5,
      currentActivity: null,
      progress: activeSummary.progress.map((item) => ({ ...item, status: "completed" })),
      completedAt: "2026-08-20T00:20:00.000Z",
      summary: {
        learned: "今天完成了“等式两边同乘同除”的回想、理解和练习。",
        independentCompleted: true,
        hintedActivities: ["guided_practice"],
        methodSwitchCount: 1,
        evidenceCount: 4,
        reviewAt: "2026-08-21T00:20:00.000Z",
        nextStep: "明天用另一道题快速回想，确认还能独立做到。",
      },
    });
    render(<PrivateTutorView />);

    expect(await screen.findByText("今天这一小步完成了")).toBeTruthy();
    expect(screen.getByText("独立完成")).toBeTruthy();
    expect(screen.getByText("明天用另一道题快速回想，确认还能独立做到。")).toBeTruthy();
    expect(screen.queryByText(/排名/)).toBeNull();
  });
});
