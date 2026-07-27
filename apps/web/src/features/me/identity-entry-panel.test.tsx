import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { IdentityEntryPanel } from "./identity-entry-panel";

const api = vi.hoisted(() => ({
  getIdentityOptions: vi.fn(),
  loginLocal: vi.fn(),
  loginWithCredentials: vi.fn(),
  completePasswordRecovery: vi.fn(),
  ApiError: Error,
  beginIdentityChallenge: vi.fn(),
  getIdentityChallenge: vi.fn(),
  cancelIdentityChallenge: vi.fn(),
  getCurrentSession: vi.fn(),
}));

vi.mock("@/lib/api-client", () => api);

const provider = { provider: "feishu" as const, label: "飞书", authorization: "redirect" as const };
const challenge = (state: "pending" | "authorized" | "expired" | "rejected") => ({
  challenge: {
    id: "idc_test",
    provider: "feishu" as const,
    state,
    createdAt: "2026-07-27T00:00:00.000Z",
    expiresAt: "2026-07-27T00:02:00.000Z",
  },
  authorizationUri: "https://identity.example.test/start",
});

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  api.getIdentityOptions.mockResolvedValue({
    protocolVersion: 1,
    localMode: true,
    passwordMode: true,
    providers: [],
  });
  api.loginLocal.mockResolvedValue({ id: "usr_local", name: "本地用户", teamId: "team_local", role: "owner" });
  api.completePasswordRecovery.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("IdentityEntryPanel", () => {
  it("keeps local and team entry distinct and reports unavailable providers honestly", async () => {
    const onSignedIn = vi.fn();
    render(<IdentityEntryPanel onSignedIn={onSignedIn} />);
    expect(await screen.findByRole("button", { name: /在这台电脑上使用/ })).toBeTruthy();
    expect(screen.getByText("登录团队")).toBeTruthy();
    expect(screen.getByText("此服务端尚未启用企业登录方式。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /在这台电脑上使用/ }));
    await waitFor(() => expect(api.loginLocal).toHaveBeenCalledOnce());
    expect(onSignedIn).toHaveBeenCalledWith(expect.objectContaining({ id: "usr_local" }));
  });

  it("keeps the Me surface usable when identity options cannot be loaded", async () => {
    api.getIdentityOptions.mockRejectedValue(new Error("invalid options"));
    render(<IdentityEntryPanel />);
    expect(await screen.findByText("暂时无法获取登录方式。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });

  it("shows a browser-bound provider wait without rendering a QR artifact or personal details", async () => {
    api.getIdentityOptions.mockResolvedValue({
      protocolVersion: 1,
      localMode: false,
      passwordMode: true,
      providers: [provider],
    });
    api.beginIdentityChallenge.mockResolvedValue(challenge("pending"));
    const { container } = render(<IdentityEntryPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "飞书" }));

    expect(await screen.findByText("请确认本次登录请求")).toBeTruthy();
    expect(screen.getByRole("link", { name: /前往飞书继续/ }).getAttribute("href")).toBe("https://identity.example.test/start");
    expect(container.querySelector("img, canvas, [data-qr]")).toBeNull();
    expect(container.textContent).not.toContain("张三");
    expect(container.textContent).not.toContain("研发团队");
  });

  it("recovers expired and rejected provider requests without claiming a session", async () => {
    api.getIdentityOptions.mockResolvedValue({
      protocolVersion: 1,
      localMode: false,
      passwordMode: true,
      providers: [provider],
    });
    api.beginIdentityChallenge.mockResolvedValueOnce(challenge("expired")).mockResolvedValueOnce(challenge("rejected"));
    render(<IdentityEntryPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "飞书" }));
    expect(await screen.findByText("登录请求已过期")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "刷新登录请求" }));
    expect(await screen.findByText("登录未获确认")).toBeTruthy();
    expect(api.getCurrentSession).not.toHaveBeenCalled();
  });

  it("keeps administrator recovery separate from password sign-in", async () => {
    render(<IdentityEntryPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /使用账号密码/ }));
    fireEvent.click(screen.getByRole("button", { name: "无法登录？" }));
    expect(screen.getByText("请联系团队管理员")).toBeTruthy();
    expect(screen.getByText(/不会通过网页创建所有者/)).toBeTruthy();
  });

  it("uses tenant-aware password sign-in and does not auto-login after recovery", async () => {
    const onSignedIn = vi.fn();
    api.loginWithCredentials.mockResolvedValue({
      id: "usr_a",
      teamId: "team_a",
      role: "operator",
    });
    render(<IdentityEntryPanel onSignedIn={onSignedIn} />);
    fireEvent.click(await screen.findByRole("button", { name: /使用账号密码/ }));
    fireEvent.change(screen.getByLabelText("团队编号"), { target: { value: "team_a" } });
    fireEvent.change(screen.getByLabelText("用户 ID"), { target: { value: "usr_a" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    await waitFor(() => expect(api.loginWithCredentials).toHaveBeenCalledWith(
      "team_a",
      "usr_a",
      "correct horse battery",
    ));

    fireEvent.click(screen.getByRole("button", { name: "无法登录？" }));
    fireEvent.change(screen.getByLabelText("一次性恢复码"), { target: { value: "rgr_secret" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "replacement passphrase" } });
    fireEvent.change(screen.getByLabelText("再次输入新密码"), { target: { value: "replacement passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "设置新密码" }));
    await waitFor(() => expect(api.completePasswordRecovery).toHaveBeenCalledWith({
      teamId: "team_a",
      userId: "usr_a",
      recoveryToken: "rgr_secret",
      newPassword: "replacement passphrase",
    }));
    expect(screen.getByText("密码已更新")).toBeTruthy();
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });
});
