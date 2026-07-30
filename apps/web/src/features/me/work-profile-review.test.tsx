import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18n } from "@/lib/i18n";
import { WorkProfileReview } from "./work-profile-review";

const mocks = vi.hoisted(() => ({
  state: {
    workProfileInferences: [{
      id: "wpi_1",
      userId: "usr_a",
      ownerTeamId: "team_a",
      category: "work_type",
      value: "software_development",
      confidence: 0.86,
      status: "pending",
      evidence: [{
        projectId: "prj_a",
        projectName: "Alpha",
        authorizedDirectory: "D:\\work\\alpha",
      }],
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    }],
    workProfileAuditEvents: [{
      id: "wpa_1",
      inferenceId: "wpi_deleted",
      actorId: "usr_a",
      action: "deleted",
      before: {
        category: "skill",
        value: "Legacy skill",
        status: "pending",
        evidence: [],
      },
      after: null,
      at: "2026-07-29T00:30:00.000Z",
    }],
  },
  refresh: vi.fn(),
  confirm: vi.fn(),
  update: vi.fn(),
  reject: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/data/use-console-state", () => ({
  useConsoleState: () => ({ data: mocks.state }),
  useRefreshConsoleState: () => mocks.refresh,
}));

vi.mock("./work-profile-api", () => ({
  workProfileApi: {
    confirm: mocks.confirm,
    update: mocks.update,
    reject: mocks.reject,
    delete: mocks.delete,
  },
}));

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  mocks.refresh.mockResolvedValue(undefined);
  mocks.confirm.mockResolvedValue({});
  mocks.update.mockResolvedValue({});
  mocks.reject.mockResolvedValue({});
  mocks.delete.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkProfileReview", () => {
  it("shows the system understanding and its authorized-directory evidence", () => {
    render(<WorkProfileReview />);
    expect(screen.getByText("系统理解")).toBeTruthy();
    expect(screen.getByText(/工作类型 · 软件开发/)).toBeTruthy();
    expect(screen.getByText("D:\\work\\alpha")).toBeTruthy();
    expect(screen.getByText("来源：已授权的项目目录")).toBeTruthy();
    expect(screen.getByText("已删除")).toBeTruthy();
  });

  it("lets the user correct a wrong classification", async () => {
    render(<WorkProfileReview />);
    fireEvent.click(screen.getByRole("button", { name: "修改" }));
    fireEvent.change(screen.getByLabelText("分类"), { target: { value: "role" } });
    fireEvent.change(screen.getByLabelText("理解内容"), { target: { value: "技术负责人" } });
    fireEvent.click(screen.getByRole("button", { name: "保存纠正" }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("wpi_1", {
      category: "role",
      value: "技术负责人",
      reason: "用户纠正了系统分类。",
    }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("supports confirm, reject, and audited deletion actions", async () => {
    render(<WorkProfileReview />);

    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith("wpi_1"));

    fireEvent.click(screen.getByRole("button", { name: "否定" }));
    await waitFor(() => expect(mocks.reject).toHaveBeenCalledWith("wpi_1", "用户否定了此推断。"));

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    const deleteButtons = screen.getAllByRole("button", { name: "删除" });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith("wpi_1", "用户删除了此推断。"));
  });
});
