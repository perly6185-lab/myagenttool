import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailView } from "@/features/mail/mail-view";
import { i18n } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  getMailbox: vi.fn(),
  invokeCapability: vi.fn(),
  createMailDraft: vi.fn(),
  updateMailDraft: vi.fn(),
  deleteMailDraft: vi.fn(),
  issueApprovalGrant: vi.fn(),
  sendMailDraft: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: mocks };
});
vi.mock("@/hooks/use-page-navigation", () => ({ usePageNavigation: () => mocks.navigate }));

const connectedMailbox = {
  accounts: [{
    id: "app_163_mail_v2", provider: "netease", name: "163 Mail", status: "connected", statusDetail: "ready",
    canReceive: true, canSend: true, readApplicationId: "app_163_mail_v2", sendApplicationId: "app_gmail_send",
    syncCapability: "app.app_163_mail_v2.list_unread", fetchCapability: "app.app_163_mail_v2.fetch",
  }],
  connection: { status: "connected", message: "163 Mail" },
  folders: [{ id: "inbox", count: 1, unread: 1 }, { id: "drafts", count: 0 }, { id: "sent", count: 0 }, { id: "outbox", count: 0 }],
  messages: [{
    id: "<one@example.com>", messageId: "<one@example.com>", from: "Alice <alice@example.com>", subject: "Project update",
    date: "2026-08-13T01:00:00.000Z", body: "The latest project update is attached.", preview: "The latest project update is attached.",
    unread: true, fetched: true, inReplyTo: null, references: [], applicationId: "app_163_mail_v2", issueNumber: null, createdAt: "2026-08-13T01:00:00.000Z",
  }],
  drafts: [],
  updatedAt: "2026-08-13T01:00:00.000Z",
};

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MailView /></QueryClientProvider>);
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  mocks.getMailbox.mockResolvedValue(connectedMailbox);
  mocks.invokeCapability.mockResolvedValue({ invocationId: "inv_1", status: "queued" });
  mocks.createMailDraft.mockResolvedValue({ draft: {
    id: "maildraft_1", status: "draft", revision: 1, origin: "user", to: "bob@example.com", subject: "Hello", body: "Message body",
    inReplyTo: null, references: [], createdAt: "2026-08-13T02:00:00.000Z", updatedAt: "2026-08-13T02:00:00.000Z", sentAt: null, sendError: null, approvalTarget: "maildraft_1@1",
  } });
  mocks.issueApprovalGrant.mockResolvedValue({ token: "grant_1", grantId: "grant_1", expiresAt: "later" });
  mocks.sendMailDraft.mockResolvedValue({ status: "sending", draftId: "maildraft_1", sendInvocationId: "inv_send" });
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("MailView ordinary-user flow", () => {
  it("shows a first-class inbox and reads external content as plain text", async () => {
    renderView();
    expect(await screen.findByText("Project update")).toBeTruthy();
    fireEvent.click(screen.getByText("Project update"));
    expect(screen.getAllByText("The latest project update is attached.").length).toBeGreaterThan(1);
    expect(screen.getByText(/系统只把它当作内容展示/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "回复" }));
    expect(screen.getByRole("dialog", { name: "写邮件" })).toBeTruthy();
    expect((screen.getByLabelText("收件人") as HTMLInputElement).value).toBe("Alice <alice@example.com>");
  });

  it("saves a user draft, reviews exact content, then uses a revision-bound send grant", async () => {
    renderView();
    await screen.findByText("Project update");
    fireEvent.click(screen.getByRole("button", { name: "写邮件" }));
    fireEvent.change(screen.getByLabelText("收件人"), { target: { value: "bob@example.com" } });
    fireEvent.change(screen.getByLabelText("主题"), { target: { value: "Hello" } });
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "Message body" } });
    fireEvent.click(screen.getByRole("button", { name: /检查并发送/ }));
    expect(await screen.findByRole("dialog", { name: "发送前请确认" })).toBeTruthy();
    expect(mocks.createMailDraft).toHaveBeenCalledWith(expect.objectContaining({ to: "bob@example.com", subject: "Hello", body: "Message body" }));
    fireEvent.click(screen.getByRole("button", { name: /确认发送/ }));
    await waitFor(() => expect(mocks.issueApprovalGrant).toHaveBeenCalledWith("mail.send", "maildraft_1@1"));
    expect(mocks.sendMailDraft).toHaveBeenCalledWith("maildraft_1", "grant_1");
  });

  it("gives an understandable connection path instead of protocol fields", async () => {
    mocks.getMailbox.mockResolvedValueOnce({ ...connectedMailbox, accounts: [], connection: { status: "not_connected", message: "" }, messages: [], folders: connectedMailbox.folders.map((folder) => ({ ...folder, count: 0 })) });
    renderView();
    expect(await screen.findByText("连接你的邮箱")).toBeTruthy();
    expect(screen.getByText(/不需要在这里填写 IMAP、SMTP/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "打开邮箱连接设置" }));
    expect(mocks.navigate).toHaveBeenCalledWith("applications");
  });
});
