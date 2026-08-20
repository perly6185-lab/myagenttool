import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateTutorView } from "@/features/private-tutor/private-tutor-view";

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  start: vi.fn(),
}));

vi.mock("@/hooks/use-session-user", () => ({
  useSessionUser: () => ({ id: "usr_parent", role: "viewer", privateTutorChildMode: null }),
}));

vi.mock("@/features/private-tutor/private-tutor-api", () => ({
  listPrivateTutorLearners: apiMocks.list,
  createPrivateTutorLearner: apiMocks.create,
  startPrivateTutorChildMode: apiMocks.start,
  exitPrivateTutorChildMode: () => Promise.reject(new Error("not used")),
  getPrivateTutorSnapshot: () => Promise.reject(new Error("not used")),
  getCurrentPrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  getCurrentPrivateTutorSession: () => Promise.resolve(null),
  startPrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  answerPrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  pausePrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  resumePrivateTutorAssessment: () => Promise.reject(new Error("not used")),
  recordPrivateTutorAttempt: () => Promise.reject(new Error("not used")),
  rebalancePrivateTutorLearningPlan: () => Promise.reject(new Error("not used")),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("My private tutor parent handoff", () => {
  it("lets the signed-in parent choose a child and set a PIN before child capabilities appear", async () => {
    apiMocks.list.mockResolvedValue([{ id: "lrn_xiaohe", displayName: "小禾", grade: "七年级", curriculumEditionId: null, status: "active", createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" }]);
    apiMocks.start.mockResolvedValue({ user: { privateTutorChildMode: { learnerId: "lrn_xiaohe" } } });
    render(<PrivateTutorView />);

    expect(await screen.findByText("家长准备好，再交给孩子")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "今日学习" })).toBeNull();
    fireEvent.change(screen.getByLabelText("家长 PIN"), { target: { value: "618520" } });
    fireEvent.click(screen.getByRole("button", { name: "进入儿童模式" }));

    await waitFor(() => expect(apiMocks.start).toHaveBeenCalledWith("lrn_xiaohe", "618520"));
  });

  it("does not accept a short handoff PIN", async () => {
    apiMocks.list.mockResolvedValue([{ id: "lrn_xiaohe", displayName: "小禾", grade: "七年级", curriculumEditionId: null, status: "active", createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" }]);
    render(<PrivateTutorView />);
    await screen.findByText("小禾");
    fireEvent.change(screen.getByLabelText("家长 PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "进入儿童模式" }));

    expect((await screen.findByRole("alert")).textContent).toContain("6–12 位数字家长 PIN");
    expect(apiMocks.start).not.toHaveBeenCalled();
  });
});
