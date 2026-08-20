import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateTutorView } from "@/features/private-tutor/private-tutor-view";

vi.mock("@/hooks/use-session-user", () => ({
  useSessionUser: () => ({ role: "viewer" }),
}));

describe("My private tutor student information architecture", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => cleanup());

  it("keeps the five child capabilities at level one", () => {
    render(<PrivateTutorView />);

    for (const label of ["今日学习", "知识地图", "我的错题本", "我的成长", "我的设置"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("does not disclose guardian or professional spaces to an unverified student", () => {
    render(<PrivateTutorView />);
    fireEvent.click(screen.getByRole("button", { name: "我的设置" }));

    expect(screen.getByRole("button", { name: /我的偏好/ })).toBeTruthy();
    expect(screen.queryByText("家庭与监护")).toBeNull();
    expect(screen.queryByText("教学内容与策略")).toBeNull();
    expect(screen.queryByText("系统与 AI")).toBeNull();
  });

  it("shows unknown knowledge as unmeasured instead of weak", () => {
    render(<PrivateTutorView />);
    fireEvent.click(screen.getByRole("button", { name: "知识地图" }));

    expect(screen.getAllByText("尚未测到").length).toBeGreaterThan(0);
    expect(screen.getByText("等待后续学习证据")).toBeTruthy();
  });
});
