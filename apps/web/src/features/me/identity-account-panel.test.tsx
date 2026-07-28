import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { IdentityAccountPanel } from "./identity-account-panel";

const api = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getIdentitySecurityAlerts: vi.fn(),
  issuePasswordRecovery: vi.fn(),
  logout: vi.fn(),
  logoutAllSessions: vi.fn(),
}));

vi.mock("@/lib/api-client", () => api);

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  api.getCurrentSession.mockResolvedValue({
    user: { id: "usr_a", name: "测试用户", teamId: "team_a", role: "admin" },
    session: {
      id: "ids_a",
      mode: "enterprise",
      createdAt: "2026-07-27T00:00:00.000Z",
      lastSeenAt: "2026-07-27T00:01:00.000Z",
      idleExpiresAt: "2026-07-27T00:31:00.000Z",
      absoluteExpiresAt: "2026-07-27T12:00:00.000Z",
      currentDevice: true,
    },
  });
  api.logout.mockResolvedValue(undefined);
  api.logoutAllSessions.mockResolvedValue(undefined);
  api.getIdentitySecurityAlerts.mockResolvedValue([]);
  api.issuePasswordRecovery.mockResolvedValue({
    recoveryToken: "rgr_one_time",
    grant: {
      id: "irg_a",
      purpose: "password_reset",
      teamId: "team_a",
      userId: "usr_member",
      createdAt: "2026-07-27T00:00:00.000Z",
      expiresAt: "2026-07-27T00:15:00.000Z",
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("IdentityAccountPanel", () => {
  it("shows the active team, current device, server role, and session method", async () => {
    render(<IdentityAccountPanel user={{ id: "usr_a", name: "测试用户", teamId: "team_a", role: "admin" }} />);
    expect(screen.getByText("team_a")).toBeTruthy();
    expect(screen.getByText("这台电脑")).toBeTruthy();
    expect(screen.getByText("管理员")).toBeTruthy();
    expect(await screen.findByText("企业身份")).toBeTruthy();
  });

  it("confirms and revokes only the current device", async () => {
    const onSignedOut = vi.fn();
    render(<IdentityAccountPanel user={{ id: "usr_a", teamId: "team_a", role: "admin" }} onSignedOut={onSignedOut} />);
    fireEvent.click(screen.getByRole("button", { name: "退出这台设备" }));
    const buttons = screen.getAllByRole("button", { name: "退出这台设备" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(api.logout).toHaveBeenCalledOnce());
    expect(api.logoutAllSessions).not.toHaveBeenCalled();
    expect(onSignedOut).toHaveBeenCalledOnce();
  });

  it("uses the distinct all-device revocation action", async () => {
    render(<IdentityAccountPanel user={{ id: "usr_a", teamId: "team_a", role: "admin" }} />);
    fireEvent.click(screen.getByRole("button", { name: "退出所有设备" }));
    const buttons = screen.getAllByRole("button", { name: "退出所有设备" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(api.logoutAllSessions).toHaveBeenCalledOnce());
    expect(api.logout).not.toHaveBeenCalled();
  });

  it("lets a team administrator issue a one-time recovery code without browser persistence", async () => {
    render(<IdentityAccountPanel user={{ id: "usr_a", teamId: "team_a", role: "admin" }} />);
    fireEvent.change(screen.getByLabelText("成员账号编号"), { target: { value: "usr_member" } });
    fireEvent.click(screen.getByRole("button", { name: "授权恢复" }));
    await waitFor(() => expect(api.issuePasswordRecovery).toHaveBeenCalledWith("usr_member"));
    expect(screen.getByText("rgr_one_time")).toBeTruthy();
    expect(localStorage.getItem("recoveryToken")).toBeNull();
  });
});
