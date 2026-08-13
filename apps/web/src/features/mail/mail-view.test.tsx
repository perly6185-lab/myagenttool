import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailView } from "@/features/mail/mail-view";
import { i18n } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  getMailbox: vi.fn(),
  syncMailbox: vi.fn(),
  setMailMessageRead: vi.fn(),
  invokeCapability: vi.fn(),
  createMailDraft: vi.fn(),
  updateMailDraft: vi.fn(),
  deleteMailDraft: vi.fn(),
  issueApprovalGrant: vi.fn(),
  sendMailDraft: vi.fn(),
  getMailConnectorStatus: vi.fn(),
  connect163Mail: vi.fn(),
  connect163MailSend: vi.fn(),
  createMailTask: vi.fn(),
  createTaskMaterialDraft: vi.fn(),
  uploadTaskMaterialFile: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: mocks };
});

vi.mock("@/features/mail/mail-api", () => ({
  mailApi: { getMailbox: mocks.getMailbox, setMessageRead: mocks.setMailMessageRead },
}));

vi.mock("@/data/use-console-state", () => ({
  useConsoleState: () => ({ data: { projects: [{ id: "project_1", name: "客户项目", status: "active" }] } }),
}));

const connectedMailbox = {
  accounts: [{
    id: "app_163_mail_v2", provider: "netease", name: "163 Mail", status: "connected", statusDetail: "ready",
    canReceive: true, canSend: true, readApplicationId: "app_163_mail_v2", sendApplicationId: "app_gmail_send",
    fetchCapability: "app.app_163_mail_v2.fetch", incrementalSync: true, providerReadState: true,
  }],
  connection: { status: "connected", message: "163 Mail" },
  sync: { status: "idle", invocationId: null, lastCompletedAt: null, lastSucceededAt: null },
  folders: [{ id: "inbox", name: "Inbox", kind: "provider", specialUse: "\\Inbox", count: 1, unread: 1 }, { id: "drafts", count: 0 }, { id: "sent", count: 0 }, { id: "outbox", count: 0 }],
  messages: [{
    id: "<one@example.com>", messageId: "<one@example.com>", from: "Alice <alice@example.com>", subject: "Project update",
    date: "2026-08-13T01:00:00.000Z", body: "The latest project update is attached.", preview: "The latest project update is attached.",
    unread: true, folderId: "inbox", folderPath: "INBOX", fetched: true, inReplyTo: null, references: [], attachments: [{ id: "attachment-1", name: "notes.txt", contentType: "text/plain", size: 5, sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", previewable: true }], attachmentMetadataLoaded: true, applicationId: "app_163_mail_v2", issueNumber: null, task: null, createdAt: "2026-08-13T01:00:00.000Z",
  }],
  query: "",
  selectedFolder: "inbox",
  pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1, hasPrevious: false, hasNext: false },
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
  mocks.syncMailbox.mockResolvedValue({ sync: { status: "syncing", invocationId: "inv_sync", lastCompletedAt: null, lastSucceededAt: null }, reused: false });
  mocks.setMailMessageRead.mockResolvedValue({ messageId: "<one@example.com>", unread: false });
  mocks.invokeCapability.mockResolvedValue({ invocationId: "inv_1", status: "queued" });
  mocks.createMailDraft.mockResolvedValue({ draft: {
    id: "maildraft_1", status: "draft", revision: 1, origin: "user", to: "bob@example.com", subject: "Hello", body: "Message body",
    inReplyTo: null, references: [], attachments: [], createdAt: "2026-08-13T02:00:00.000Z", updatedAt: "2026-08-13T02:00:00.000Z", sentAt: null, sendError: null, approvalTarget: "maildraft_1@1",
  } });
  mocks.issueApprovalGrant.mockResolvedValue({ token: "grant_1", grantId: "grant_1", expiresAt: "later" });
  mocks.sendMailDraft.mockResolvedValue({ status: "sending", draftId: "maildraft_1", sendInvocationId: "inv_send" });
  mocks.createMailTask.mockResolvedValue({ task: { id: "lwi_42", localRef: "LOCAL-42", title: "Project update", projectId: "project_1" }, replayed: false });
  mocks.createTaskMaterialDraft.mockResolvedValue({ draft: { id: "tmd_1", revision: 0, assets: [] } });
  mocks.uploadTaskMaterialFile.mockResolvedValue({ draft: { id: "tmd_1", revision: 1, assets: [] }, asset: {} });
  delete window.myagenttoolDesktop;
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("MailView ordinary-user flow", () => {
  it("shows a first-class inbox and reads external content as plain text", async () => {
    renderView();
    expect(await screen.findByText("Project update")).toBeTruthy();
    fireEvent.click(screen.getByText("Project update"));
    await waitFor(() => expect(mocks.setMailMessageRead).toHaveBeenCalledWith("<one@example.com>", true));
    expect(screen.getAllByText("The latest project update is attached.").length).toBeGreaterThan(1);
    expect(screen.getByText(/系统只把它当作内容展示/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "回复" }));
    expect(screen.getByRole("dialog", { name: "写邮件" })).toBeTruthy();
    expect((screen.getByLabelText("收件人") as HTMLInputElement).value).toBe("Alice <alice@example.com>");
  });

  it("previews and downloads attachment content only through the desktop bridge", async () => {
    const previewMailAttachment = vi.fn().mockResolvedValue({ ok: true, preview: { id: "attachment-1", name: "notes.txt", contentType: "text/plain", size: 5, kind: "text", text: "hello" } });
    const downloadMailAttachment = vi.fn().mockResolvedValue({ ok: true, saved: true, name: "notes.txt" });
    window.myagenttoolDesktop = { previewMailAttachment, downloadMailAttachment };
    renderView();
    fireEvent.click(await screen.findByText("Project update"));
    fireEvent.click(await screen.findByRole("button", { name: "预览" }));
    expect(await screen.findByRole("dialog", { name: "附件预览" })).toBeTruthy();
    expect(screen.getByText("hello")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "关闭" }).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "下载" }));
    await waitFor(() => expect(downloadMailAttachment).toHaveBeenCalledWith({ messageId: "<one@example.com>", folderPath: "INBOX", attachmentId: "attachment-1" }));
    expect(await screen.findByText("附件已保存：notes.txt")).toBeTruthy();
  });

  it("reviews an email as a manual local task and keeps attachments opt-in", async () => {
    renderView();
    fireEvent.click(await screen.findByText("Project update"));
    fireEvent.click(screen.getByRole("button", { name: "转为任务" }));
    expect(await screen.findByRole("dialog", { name: "确认任务内容" })).toBeTruthy();
    expect((screen.getByLabelText("所属项目") as HTMLSelectElement).value).toBe("project_1");
    expect((screen.getByLabelText(/notes\.txt/) as HTMLInputElement).checked).toBe(false);
    fireEvent.change(screen.getByLabelText("任务标题"), { target: { value: "跟进项目更新" } });
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(mocks.createMailTask).toHaveBeenCalledWith("<one@example.com>", expect.objectContaining({
      projectId: "project_1",
      title: "跟进项目更新",
      attachmentIds: [],
    })));
    expect(mocks.createTaskMaterialDraft).not.toHaveBeenCalled();
    expect(await screen.findByText("任务 LOCAL-42 已创建。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看任务" })).toBeTruthy();
  });

  it("skips an attachment whose provider bytes no longer match and still creates the task", async () => {
    const readMailAttachmentForTask = vi.fn().mockResolvedValue({ ok: true, attachment: {
      id: "attachment-1", name: "notes.txt", contentType: "text/plain", size: 4,
      sha256: "0".repeat(64), data: new TextEncoder().encode("oops").buffer,
    } });
    window.myagenttoolDesktop = { readMailAttachmentForTask };
    renderView();
    fireEvent.click(await screen.findByText("Project update"));
    fireEvent.click(screen.getByRole("button", { name: "转为任务" }));
    fireEvent.click(screen.getByLabelText(/notes\.txt/));
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(mocks.createMailTask).toHaveBeenCalledWith("<one@example.com>", expect.objectContaining({ attachmentIds: [] })));
    expect(mocks.uploadTaskMaterialFile).not.toHaveBeenCalled();
    expect(await screen.findByText(/1 个附件未能添加/)).toBeTruthy();
  });

  it("shows the task action only on the task-created notice", async () => {
    const downloadMailAttachment = vi.fn().mockResolvedValue({ ok: true, saved: true, name: "notes.txt" });
    window.myagenttoolDesktop = { downloadMailAttachment };
    renderView();
    fireEvent.click(await screen.findByText("Project update"));
    fireEvent.click(screen.getByRole("button", { name: "转为任务" }));
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    expect(await screen.findByRole("button", { name: "查看任务" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下载" }));
    expect(await screen.findByText("附件已保存：notes.txt")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "查看任务" })).toBeNull();
  });

  it("moves between bounded inbox pages without making users change a page size", async () => {
    const secondPage = {
      ...connectedMailbox,
      messages: [{
        ...connectedMailbox.messages[0],
        id: "<two@example.com>",
        messageId: "<two@example.com>",
        subject: "Second page message",
      }],
      pagination: { page: 2, pageSize: 25, total: 26, totalPages: 2, hasPrevious: true, hasNext: false },
    };
    mocks.getMailbox.mockImplementation((page = 1) => Promise.resolve(page === 2 ? secondPage : {
      ...connectedMailbox,
      pagination: { page: 1, pageSize: 25, total: 26, totalPages: 2, hasPrevious: false, hasNext: true },
    }));
    renderView();
    await screen.findByText("Project update");
    expect(screen.getByText("第 1 / 2 页")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByText("Second page message")).toBeTruthy();
    expect(mocks.getMailbox).toHaveBeenCalledWith(2, "inbox", "");
    expect((screen.getByRole("button", { name: "上一页" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps one-click receiving busy until the real sync completes", async () => {
    const completed = {
      ...connectedMailbox,
      sync: {
        status: "succeeded",
        invocationId: "inv_sync",
        lastCompletedAt: "2026-08-13T03:00:00.000Z",
        lastSucceededAt: "2026-08-13T03:00:00.000Z",
      },
    };
    mocks.getMailbox.mockResolvedValueOnce(connectedMailbox).mockResolvedValue(completed);
    renderView();
    await screen.findByText("Project update");
    fireEvent.click(screen.getByRole("button", { name: "收取新邮件" }));
    await waitFor(() => expect(mocks.syncMailbox).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("收取完成，收件箱已更新。")).toBeTruthy();
    expect(screen.getByText(/上次收取：/)).toBeTruthy();
    expect(mocks.invokeCapability).not.toHaveBeenCalled();
  });

  it("searches the whole local folder before pagination and opens provider folders", async () => {
    const withFolder = { ...connectedMailbox, folders: [...connectedMailbox.folders, { id: "provider-sent", name: "服务商已发送", kind: "provider", specialUse: "\\Sent", count: 3, unread: 0 }] };
    mocks.getMailbox.mockResolvedValue(withFolder);
    renderView();
    await screen.findByText("Project update");
    fireEvent.change(screen.getByPlaceholderText("搜索此文件夹内已收取的邮件"), { target: { value: "quarterly" } });
    await waitFor(() => expect(mocks.getMailbox).toHaveBeenCalledWith(1, "inbox", "quarterly"));
    fireEvent.click(await screen.findByRole("button", { name: /服务商已发送/ }));
    await waitFor(() => expect(mocks.getMailbox).toHaveBeenCalledWith(1, "provider-sent", "quarterly"));
  });

  it("adds outbound attachments beside the editor through picker or paste", async () => {
    const picked = { ref: "mailatt_12345678-1234-1234-1234-123456789abc", name: "report.pdf", contentType: "application/pdf", size: 1200 };
    const pasted = { ref: "mailatt_22345678-1234-1234-1234-123456789abc", name: "notes.txt", contentType: "text/plain", size: 5 };
    const pickOutboundMailAttachments = vi.fn().mockResolvedValue({ ok: true, attachments: [picked] });
    const stagePastedMailAttachments = vi.fn().mockResolvedValue({ ok: true, attachments: [pasted] });
    window.myagenttoolDesktop = { pickOutboundMailAttachments, stagePastedMailAttachments };
    renderView();
    await screen.findByText("Project update");
    fireEvent.click(screen.getByRole("button", { name: "写邮件" }));
    fireEvent.click(screen.getByRole("button", { name: "添加附件" }));
    expect(await screen.findByText("report.pdf")).toBeTruthy();
    fireEvent.paste(screen.getByLabelText("正文"), { clipboardData: { files: [{ name: "notes.txt", type: "text/plain", arrayBuffer: async () => new TextEncoder().encode("hello").buffer }] } });
    expect(await screen.findByText("notes.txt")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("收件人"), { target: { value: "bob@example.com" } });
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "See attached" } });
    fireEvent.click(screen.getByRole("button", { name: /保存草稿/ }));
    await waitFor(() => expect(mocks.createMailDraft).toHaveBeenCalledWith(expect.objectContaining({ attachments: [picked, pasted] })));
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

  it("gives browser users an understandable desktop connection path instead of protocol fields", async () => {
    mocks.getMailbox.mockResolvedValueOnce({ ...connectedMailbox, accounts: [], connection: { status: "not_connected", message: "" }, messages: [], folders: connectedMailbox.folders.map((folder) => ({ ...folder, count: 0 })) });
    renderView();
    expect(await screen.findByText("连接你的邮箱")).toBeTruthy();
    expect(screen.getByText(/不需要在这里填写 IMAP、SMTP/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "打开邮箱连接设置" }));
    expect(screen.getByRole("dialog", { name: "连接邮箱" })).toBeTruthy();
    expect(screen.getByText(/请在 MyAgentTool 桌面版中连接邮箱/)).toBeTruthy();
  });

  it("guides a desktop user through local 163 verification and reports receive/send separately", async () => {
    mocks.getMailConnectorStatus.mockResolvedValue({ desktop: true, providers: [
      { id: "netease_163", name: "163 邮箱", available: true, connected: false, account: null },
      { id: "gmail", name: "Gmail", available: false, connected: false, account: null },
    ] });
    mocks.connect163Mail.mockResolvedValue({ ok: true, account: { provider: "netease", email: "user@163.com", canReceive: true, canSend: false } });
    window.myagenttoolDesktop = { getMailConnectorStatus: mocks.getMailConnectorStatus, connect163Mail: mocks.connect163Mail };
    mocks.getMailbox.mockResolvedValue({ ...connectedMailbox, accounts: [], connection: { status: "not_connected", message: "" }, messages: [], folders: connectedMailbox.folders.map((folder) => ({ ...folder, count: 0 })) });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "打开邮箱连接设置" }));
    expect(await screen.findByText("即将支持")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("163 邮箱地址"), { target: { value: "user@163.com" } });
    fireEvent.change(screen.getByLabelText("客户端授权码"), { target: { value: "local-code" } });
    fireEvent.click(screen.getByRole("button", { name: "连接并测试收件" }));
    expect(await screen.findByText("收件连接成功")).toBeTruthy();
    expect(screen.getByText(/发件授权与收件分开保存/)).toBeTruthy();
    expect(mocks.connect163Mail).toHaveBeenCalledWith({ email: "user@163.com", authorizationCode: "local-code" });
  });

  it("explains legacy connection upgrades and offers one clear reauthorization action", async () => {
    mocks.getMailConnectorStatus.mockResolvedValue({ desktop: true, providers: [
      { id: "netease_163", name: "163 邮箱", available: true, connected: false, upgradeNeeded: true, sendConnected: false, account: "legacy@163.com" },
      { id: "gmail", name: "Gmail", available: false, connected: false, account: null },
    ] });
    window.myagenttoolDesktop = { getMailConnectorStatus: mocks.getMailConnectorStatus };
    renderView();
    await screen.findByText("Project update");
    fireEvent.click(screen.getByRole("button", { name: "管理邮箱连接" }));
    expect(await screen.findByText("升级现有邮箱连接")).toBeTruthy();
    expect(screen.getByText(/原有邮件和草稿不会丢失/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "升级并测试收件" })).toBeTruthy();
    expect((screen.getByLabelText("163 邮箱地址") as HTMLInputElement).value).toBe("legacy@163.com");
  });
});
