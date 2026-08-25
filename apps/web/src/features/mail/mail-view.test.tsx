import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailView } from "@/features/mail/mail-view";
import { i18n } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  getMailbox: vi.fn(),
  syncMailbox: vi.fn(),
  setMailMessageRead: vi.fn(),
  prioritizeBodyPrefetch: vi.fn(),
  classifyMailbox: vi.fn(),
  getSemanticPreview: vi.fn(),
  startDeepOrganize: vi.fn(),
  getClassificationJob: vi.fn(),
  cancelClassificationJob: vi.fn(),
  correctClassification: vi.fn(),
  getClassificationRules: vi.fn(),
  getClassificationQuality: vi.fn(),
  createClassificationRule: vi.fn(),
  updateClassificationRule: vi.fn(),
  getFolderSuggestions: vi.fn(),
  createFolderMovePreview: vi.fn(),
  startFolderMove: vi.fn(),
  getFolderMoveJob: vi.fn(),
  getFolderMoveJobs: vi.fn(),
  reconcileFolderMoveJob: vi.fn(),
  createFolderRecoveryPreview: vi.fn(),
  createFolderAutomationPreview: vi.fn(),
  enableFolderAutomation: vi.fn(),
  getFolderAutomations: vi.fn(),
  updateFolderAutomation: vi.fn(),
  dryRunFolderAutomation: vi.fn(),
  invokeCapability: vi.fn(),
  createMailDraft: vi.fn(),
  updateMailDraft: vi.fn(),
  deleteMailDraft: vi.fn(),
  issueApprovalGrant: vi.fn(),
  sendMailDraft: vi.fn(),
  getMailConnectorStatus: vi.fn(),
  connect163Mail: vi.fn(),
  connect163MailSend: vi.fn(),
  connect163MailOrganize: vi.fn(),
  createMailTask: vi.fn(),
  createTaskMaterialDraft: vi.fn(),
  uploadTaskMaterialFile: vi.fn(),
}));
const session = vi.hoisted(() => ({ role: undefined as "owner" | "admin" | "operator" | "viewer" | undefined }));

const archiveRef = `mailarc_${"a".repeat(24)}_${"b".repeat(40)}`;

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: mocks };
});

vi.mock("@/features/mail/mail-api", () => ({
  mailApi: {
    getMailbox: mocks.getMailbox,
    setMessageRead: mocks.setMailMessageRead,
    prioritizeBodyPrefetch: mocks.prioritizeBodyPrefetch,
    classifyMailbox: mocks.classifyMailbox,
    getSemanticPreview: mocks.getSemanticPreview,
    startDeepOrganize: mocks.startDeepOrganize,
    getClassificationJob: mocks.getClassificationJob,
    cancelClassificationJob: mocks.cancelClassificationJob,
    correctClassification: mocks.correctClassification,
    getClassificationRules: mocks.getClassificationRules,
    getClassificationQuality: mocks.getClassificationQuality,
    createClassificationRule: mocks.createClassificationRule,
    updateClassificationRule: mocks.updateClassificationRule,
    getFolderSuggestions: mocks.getFolderSuggestions,
    createFolderMovePreview: mocks.createFolderMovePreview,
    startFolderMove: mocks.startFolderMove,
    getFolderMoveJob: mocks.getFolderMoveJob,
    getFolderMoveJobs: mocks.getFolderMoveJobs,
    reconcileFolderMoveJob: mocks.reconcileFolderMoveJob,
    createFolderRecoveryPreview: mocks.createFolderRecoveryPreview,
    createFolderAutomationPreview: mocks.createFolderAutomationPreview,
    enableFolderAutomation: mocks.enableFolderAutomation,
    getFolderAutomations: mocks.getFolderAutomations,
    updateFolderAutomation: mocks.updateFolderAutomation,
    dryRunFolderAutomation: mocks.dryRunFolderAutomation,
  },
}));

vi.mock("@/data/use-console-state", () => ({
  useConsoleState: () => ({ data: { projects: [{ id: "project_1", name: "客户项目", status: "active" }] } }),
}));
vi.mock("@/hooks/use-session-user", () => ({
  useSessionUser: () => ({ id: "usr_test", role: session.role }),
}));

const connectedMailbox = {
  accounts: [{
    id: "app_163_mail_v2", provider: "netease", name: "163 Mail", status: "connected", statusDetail: "ready",
    canReceive: true, canSend: true, canOrganize: true, readApplicationId: "app_163_mail_v2", sendApplicationId: "app_gmail_send",
    fetchCapability: "app.app_163_mail_v2.fetch", incrementalSync: true, providerReadState: true,
  }],
  connection: { status: "connected", message: "163 Mail" },
  sync: { status: "idle", invocationId: null, lastCompletedAt: null, lastSucceededAt: null },
  folders: [{ id: "inbox", name: "Inbox", kind: "provider", specialUse: "\\Inbox", count: 1, unread: 1 }, { id: "drafts", count: 0 }, { id: "sent", count: 0 }, { id: "outbox", count: 0 }],
  messages: [{
    id: "<one@example.com>", messageId: "<one@example.com>", from: "Alice <alice@example.com>", subject: "Project update",
    date: "2026-08-13T01:00:00.000Z", body: "The latest project update is attached.", preview: "The latest project update is attached.",
    unread: true, folderId: "inbox", folderPath: "INBOX", fetched: true, bodyContentVersion: 2, inReplyTo: null, references: [], attachments: [{ id: "attachment-1", name: "notes.txt", contentType: "text/plain", size: 5, sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", previewable: true, localAvailable: true }], attachmentMetadataLoaded: true, archive: { version: 1, ref: archiveRef, availability: "available", sha256: "c".repeat(64), size: 4096, archivedAt: "2026-08-13T01:00:00.000Z" }, applicationId: "app_163_mail_v2", issueNumber: null, task: null, createdAt: "2026-08-13T01:00:00.000Z", classification: { attention: "action_required", mailType: "customer_or_project", suggestedAction: "reply", label: "待处理", explanation: "主题包含明确的处理要求。", uncertain: false, confirmationState: "proposed", revision: 1 },
  }],
  query: "",
  selectedFolder: "inbox",
  selectedView: "all",
  classificationSummary: { counts: { all: 1, needs_attention: 1, important: 0, notifications: 0, subscriptions: 0, other: 0 }, classified: 1, pending: 0, classifierVersion: 1 },
  pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1, hasPrevious: false, hasNext: false },
  drafts: [],
  updatedAt: "2026-08-13T01:00:00.000Z",
};

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MailView /></QueryClientProvider>);
}

beforeEach(async () => {
  session.role = undefined;
  await i18n.changeLanguage("zh-CN");
  mocks.getMailbox.mockResolvedValue(connectedMailbox);
  mocks.syncMailbox.mockResolvedValue({ sync: { status: "syncing", invocationId: "inv_sync", lastCompletedAt: null, lastSucceededAt: null }, reused: false });
  mocks.setMailMessageRead.mockResolvedValue({ messageId: "<one@example.com>", unread: false });
  mocks.prioritizeBodyPrefetch.mockResolvedValue({ messageId: "<one@example.com>", bodyFetch: { status: "queued", priority: "user", attempt: 0, lastError: null } });
  mocks.classifyMailbox.mockResolvedValue({ job: { id: "mailclsjob_1", status: "succeeded", total: 1, processed: 1, classified: 0, replayed: 1, failed: 0 } });
  mocks.getSemanticPreview.mockResolvedValue({ preview: {
    available: true, reason: null, eligible: 1, pending: 1, limit: 20,
    newestDate: "2026-08-13T01:00:00.000Z", oldestDate: "2026-08-13T01:00:00.000Z",
    readsUnopenedBodies: false, externalModel: false, provider: "local_http", model: "mail-local-v1", circuitRemainingMs: 0,
  } });
  mocks.startDeepOrganize.mockResolvedValue({ job: { id: "mailclsjob_deep", scope: "recent", mode: "semantic", status: "queued", total: 1, processed: 0, classified: 0, failed: 0 } });
  mocks.getClassificationJob.mockResolvedValue({ job: { id: "mailclsjob_deep", scope: "recent", mode: "semantic", status: "succeeded", total: 1, processed: 1, classified: 1, failed: 0 } });
  mocks.cancelClassificationJob.mockResolvedValue({ job: { id: "mailclsjob_deep", scope: "recent", mode: "semantic", status: "cancelling", total: 1, processed: 0, classified: 0, failed: 0 } });
  mocks.correctClassification.mockResolvedValue({ classification: { ...connectedMailbox.messages[0].classification, attention: "routine", mailType: "other", suggestedAction: "none", label: "其他", confirmationState: "corrected", revision: 2 } });
  mocks.getClassificationRules.mockResolvedValue({
    suggestions: [{
      id: "mailrulesug_1", accountId: "app_163_mail_v2", matchKind: "sender", matchValue: "alice@example.com",
      target: { attention: "important", mailType: "personal", suggestedAction: "read" },
      evidenceCount: 2, affectedCount: 1,
      samples: [{ messageId: "<one@example.com>", from: "Alice <alice@example.com>", subject: "Project update", date: "2026-08-13T01:00:00.000Z" }],
    }],
    rules: [{
      id: "mailclsrule_1", accountId: "app_163_mail_v2", status: "active", matchKind: "domain", matchValue: "project.example",
      target: { attention: "important", mailType: "customer_or_project", suggestedAction: "read" },
      revision: 1, createdAt: "2026-08-13T01:00:00.000Z", updatedAt: "2026-08-13T01:00:00.000Z",
    }],
  });
  mocks.getClassificationQuality.mockResolvedValue({ quality: {
    status: "collecting", generatedAt: "2026-08-17T11:00:00.000Z", sampleSize: 1, minimumSample: 50,
    signals: ["insufficient_sample"],
    metrics: {
      coverage: { numerator: 1, denominator: 1, value: 1, target: 0.9, direction: "at_least" },
      unknown: { numerator: 0, denominator: 1, value: 0, target: 0.35, direction: "at_most" },
      corrections: { numerator: 0, denominator: 1, value: 0, target: 0.15, direction: "at_most" },
      jobFailures: { numerator: 0, denominator: 1, value: 0, target: 0.05, direction: "at_most" },
      semantic: { count: 0 }, stale: { count: 0 },
    },
    organization: { status: "collecting", completedBatches: 0, unconfirmedBatches: 0, unconfirmedRate: null, minimumSample: 10 },
    privacy: { localOnly: true, includesMessageContent: false, includesSenderIdentity: false },
  } });
  mocks.createClassificationRule.mockResolvedValue({ rule: { id: "mailclsrule_2", status: "active", revision: 1 } });
  mocks.updateClassificationRule.mockResolvedValue({ rule: { id: "mailclsrule_1", status: "paused", revision: 2 } });
  mocks.getFolderSuggestions.mockResolvedValue({ suggestions: [], movesSupported: false });
  mocks.createFolderMovePreview.mockResolvedValue({ preview: {
    id: "mailfolderpreview_1", accountId: "app_163_mail_v2", suggestionId: "mailfoldersug_1",
    destination: { kind: "existing", folderId: "provider-news", folderPath: "INBOX/News", name: "News", category: "subscriptions" },
    totalMatched: 61, selectedCount: 50, remainingCount: 11, status: "previewed", revision: 1,
    expiresAt: "2026-08-13T03:30:00.000Z", approvalTarget: "mailfolderpreview_1@1:fingerprint", movesSupported: false,
    samples: [{ messageId: "<news@example.com>", from: "News <news@example.com>", subject: "Weekly digest", date: "2026-08-13T01:00:00.000Z", folderId: "inbox" }],
  } });
  mocks.startFolderMove.mockResolvedValue({ job: { id: "mailfolderjob_1", accountId: "app_163_mail_v2", previewId: "mailfolderpreview_1", destination: { kind: "existing", folderId: "provider-news", folderPath: "INBOX/News", name: "News", category: "subscriptions" }, requestedCount: 50, movedCount: 0, missingCount: 0, status: "moving", revision: 1, error: null, createdAt: "2026-08-13T03:00:00.000Z", updatedAt: "2026-08-13T03:00:00.000Z", completedAt: null } });
  mocks.getFolderMoveJob.mockResolvedValue({ job: { id: "mailfolderjob_1", accountId: "app_163_mail_v2", previewId: "mailfolderpreview_1", destination: { kind: "existing", folderId: "provider-news", folderPath: "INBOX/News", name: "News", category: "subscriptions" }, requestedCount: 50, movedCount: 50, missingCount: 0, status: "succeeded", revision: 1, error: null, createdAt: "2026-08-13T03:00:00.000Z", updatedAt: "2026-08-13T03:01:00.000Z", completedAt: "2026-08-13T03:01:00.000Z" } });
  mocks.getFolderMoveJobs.mockResolvedValue({ jobs: [] });
  mocks.getFolderAutomations.mockResolvedValue({ automations: [] });
  mocks.reconcileFolderMoveJob.mockResolvedValue({ job: { id: "mailfolderjob_1", status: "recoverable", pendingCount: 1 } });
  mocks.createFolderRecoveryPreview.mockResolvedValue({ preview: {
    id: "recovery_preview", accountId: "app_163_mail_v2", suggestionId: "mailfoldersug_1", purpose: "recovery", recoveryOfJobId: "mailfolderjob_1",
    destination: { kind: "existing", folderId: "provider-news", folderPath: "INBOX/News", name: "News", category: "subscriptions" },
    totalMatched: 1, selectedCount: 1, remainingCount: 0, status: "previewed", revision: 1,
    expiresAt: "2026-08-13T03:30:00.000Z", approvalTarget: "recovery_preview@1:fingerprint", movesSupported: true, samples: [],
  } });
  mocks.createFolderAutomationPreview.mockResolvedValue({ preview: {
    id: "mailfolderautopreview_1", accountId: "app_163_mail_v2", suggestionId: "mailfoldersug_1", purpose: "automatic",
    destination: { kind: "existing", folderId: "provider-news", folderPath: "INBOX/News", name: "News", category: "subscriptions" },
    totalMatched: 10, selectedCount: 10, remainingCount: 0, status: "previewed", revision: 1,
    expiresAt: "2026-08-13T03:30:00.000Z", approvalTarget: "mailfolderautopreview_1@1:fingerprint", movesSupported: true, samples: [],
  } });
  mocks.enableFolderAutomation.mockResolvedValue({ automation: { id: "mailfolderauto_1", status: "active", revision: 1 } });
  mocks.updateFolderAutomation.mockResolvedValue({ automation: { id: "mailfolderauto_1", status: "paused", revision: 2 } });
  mocks.dryRunFolderAutomation.mockResolvedValue({ dryRun: { automationId: "mailfolderauto_1", checkedAt: "2026-08-17T02:00:00.000Z", providerCalled: false, successCountersChanged: false, selectedCount: 7, matchedCount: 9, excludedCount: 2, exclusionReasons: ["protected_message"] } });
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
  window.history.replaceState({}, "", "/");
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("MailView ordinary-user flow", () => {
  it("hides the professional mail AI console from viewers", async () => {
    session.role = "viewer";
    renderView();
    await screen.findByText("Project update");
    expect(screen.queryByRole("button", { name: "AI 处理台" })).toBeNull();
  });

  it("keeps the mail AI console discoverable for operators", async () => {
    session.role = "operator";
    renderView();
    await screen.findByText("Project update");
    expect(screen.getByRole("button", { name: "AI 处理台" })).toBeTruthy();
  });
  it("shows a first-class inbox and reads external content as plain text", async () => {
    renderView();
    expect(await screen.findByText("Project update")).toBeTruthy();
    fireEvent.click(screen.getByText("Project update"));
    await waitFor(() => expect(mocks.setMailMessageRead).toHaveBeenCalledWith("<one@example.com>", true));
    expect(screen.getAllByText("The latest project update is attached.").length).toBeGreaterThan(1);
    expect(screen.getByText(/系统只把它当作内容展示/)).toBeTruthy();
    expect(screen.getByText(/原始邮件和附件已安全保存在本机/)).toBeTruthy();
    expect(screen.getByText(/本机可用/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "回复" }));
    expect(screen.getByRole("dialog", { name: "写邮件" })).toBeTruthy();
    expect((screen.getByLabelText("收件人") as HTMLInputElement).value).toBe("Alice <alice@example.com>");
  });

  it("organizes mail into additive smart views and lets the user correct a suggestion", async () => {
    renderView();
    const smartViews = await screen.findByRole("navigation", { name: "智能分类" });
    expect(within(smartViews).getByText("待处理")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "智能分类" })[0]);
    await waitFor(() => expect(mocks.classifyMailbox).toHaveBeenCalledWith("new_mail"));
    expect(await screen.findByText(/智能分类已完成/)).toBeTruthy();

    fireEvent.click(screen.getByText("Project update"));
    expect(await screen.findByText(/分类建议：主题包含明确的处理要求/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "分类不对" }));
    const dialog = screen.getByRole("dialog", { name: "调整邮件分类" });
    fireEvent.keyDown(within(dialog).getByLabelText("放到"), { key: "End" });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存调整" }));
    await waitFor(() => expect(mocks.correctClassification).toHaveBeenCalledWith("<one@example.com>", {
      folderId: "inbox",
      expectedRevision: 1,
      attention: "routine",
      mailType: "other",
      suggestedAction: "none",
    }));
  });

  it("confirms the local cached-body boundary before deep organization", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "深度整理" }));
    const dialog = await screen.findByRole("dialog", { name: "深度整理最近邮件" });
    expect(await within(dialog).findByText(/将处理 1 封已打开且正文已缓存/)).toBeTruthy();
    expect(within(dialog).getByText(/正文只发送到本机模型/)).toBeTruthy();
    expect(within(dialog).getByText(/只分析后台已下载的正文/)).toBeTruthy();
    expect(within(dialog).getByText(/不会移动、删除、回复或创建任务/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "确认并开始" }));
    await waitFor(() => expect(mocks.startDeepOrganize).toHaveBeenCalledWith(20));
    await waitFor(() => expect(mocks.getClassificationJob).toHaveBeenCalledWith("mailclsjob_deep"));
    expect((await screen.findAllByText(/深度整理完成，新的分类建议已更新/)).length).toBeGreaterThan(0);
  });

  it("previews suggested personal rules and keeps enable pause and edit explicit", async () => {
    renderView();
    expect(await screen.findByText("发现 1 条可复用的分类习惯")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "智能分类设置" }));
    const dialog = await screen.findByRole("dialog", { name: "智能分类与邮箱目录" });
    expect(await within(dialog).findByText("正在积累本地样本")).toBeTruthy();
    expect(within(dialog).getByText("1 / 50")).toBeTruthy();
    expect(within(dialog).getByText("只在本机汇总数量，不包含邮件主题、发件人或正文。")).toBeTruthy();
    expect(mocks.getClassificationQuality).toHaveBeenCalledTimes(1);
    expect(await within(dialog).findByText("发件人 alice@example.com")).toBeTruthy();
    expect(within(dialog).getAllByText("邮箱：163 Mail").length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/基于 2 次一致调整/)).toBeTruthy();
    expect(within(dialog).getByText(/当前将影响 1 封邮件/)).toBeTruthy();
    expect(within(dialog).getByText(/Alice <alice@example.com>/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "启用规则" }));
    await waitFor(() => expect(mocks.createClassificationRule).toHaveBeenCalledWith("mailrulesug_1"));
    expect(await within(dialog).findByText(/规则已启用/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "暂停" }));
    await waitFor(() => expect(mocks.updateClassificationRule).toHaveBeenCalledWith("mailclsrule_1", { expectedRevision: 1, action: "pause" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "修改分类" }));
    const edit = await screen.findByRole("dialog", { name: "修改分类" });
    expect(within(edit).getByText("正在修改：域名 project.example")).toBeTruthy();
    expect(within(edit).getByText("邮箱：163 Mail")).toBeTruthy();
    fireEvent.change(within(edit).getByLabelText("放到"), { target: { value: "subscriptions" } });
    fireEvent.click(within(edit).getByRole("button", { name: "保存规则" }));
    await waitFor(() => expect(mocks.updateClassificationRule).toHaveBeenCalledWith("mailclsrule_1", {
      expectedRevision: 1, attention: "low_value", mailType: "newsletter", suggestedAction: "archive_candidate",
    }));
  });

  it("keeps rule mutation failures visible in the active dialog", async () => {
    mocks.createClassificationRule.mockRejectedValueOnce(new Error("offline"));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "智能分类设置" }));
    const dialog = await screen.findByRole("dialog", { name: "智能分类与邮箱目录" });
    fireEvent.click(within(dialog).getByRole("button", { name: "启用规则" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("暂时无法读取或更新智能分类设置，请重试。");
  });

  it("explains folder suggestions and builds a read-only server preview without a move action", async () => {
    mocks.getFolderSuggestions.mockResolvedValueOnce({ suggestions: [{
      id: "mailfoldersug_1", accountId: "app_163_mail_v2", classificationRuleId: "mailclsrule_news", classificationRuleRevision: 2,
      matchKind: "sender", matchValue: "news@example.com", destinationCategory: "subscriptions", affectedCount: 61, protectedCount: 2,
      proposedDestination: { kind: "new", folderId: null, folderPath: null, name: "订阅", category: "subscriptions" },
      folderOptions: [{ kind: "existing", folderId: "provider-news", folderPath: "INBOX/News", name: "News", category: "subscriptions" }],
      samples: [{ messageId: "<news@example.com>", from: "News <news@example.com>", subject: "Weekly digest", date: "2026-08-13T01:00:00.000Z", folderId: "inbox" }],
    }], movesSupported: false });
    renderView();
    expect(await screen.findByText("发现 1 条邮箱目录建议")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "查看建议" }).at(-1)!);
    const rules = await screen.findByRole("dialog", { name: "智能分类与邮箱目录" });
    expect(within(rules).getByText("建议新目录：订阅")).toBeTruthy();
    expect(within(rules).getByText("61 封邮件符合条件")).toBeTruthy();
    expect(within(rules).getByText("另有 2 封重要或待处理邮件已自动排除")).toBeTruthy();
    fireEvent.change(within(rules).getByLabelText("预览目标目录"), { target: { value: "provider-news" } });
    fireEvent.click(within(rules).getByRole("button", { name: "预览邮件" }));
    await waitFor(() => expect(mocks.createFolderMovePreview).toHaveBeenCalledWith("mailfoldersug_1", "provider-news"));
    const preview = await screen.findByRole("dialog", { name: "邮箱目录预览" });
    expect(within(preview).getByText("本次预览 50 封，共匹配 61 封")).toBeTruthy();
    expect(within(preview).getByText(/当前不会移动任何邮件/)).toBeTruthy();
    expect(within(preview).getByText("Weekly digest")).toBeTruthy();
    expect(within(preview).queryByRole("button", { name: /移动/ })).toBeNull();
  });

  it("keeps folder preview failures beside the suggestion", async () => {
    mocks.getFolderSuggestions.mockResolvedValueOnce({ suggestions: [{
      id: "mailfoldersug_1", accountId: "app_163_mail_v2", classificationRuleId: "mailclsrule_news", classificationRuleRevision: 2,
      matchKind: "sender", matchValue: "news@example.com", destinationCategory: "subscriptions", affectedCount: 3, protectedCount: 0,
      proposedDestination: { kind: "new", folderId: null, folderPath: null, name: "订阅", category: "subscriptions" }, folderOptions: [], samples: [],
    }], movesSupported: false });
    mocks.createFolderMovePreview.mockRejectedValueOnce(new Error("offline"));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "智能分类设置" }));
    const rules = await screen.findByRole("dialog", { name: "智能分类与邮箱目录" });
    fireEvent.click(within(rules).getByRole("button", { name: "预览邮件" }));
    expect((await within(rules).findByRole("alert")).textContent).toContain("暂时无法读取或预览目录建议，请重试。");
  });

  it("requires a fresh approval grant before moving a supported batch and shows the provider result", async () => {
    mocks.getFolderSuggestions.mockResolvedValueOnce({ suggestions: [{
      id: "mailfoldersug_1", accountId: "app_163_mail_v2", classificationRuleId: "mailclsrule_news", classificationRuleRevision: 2,
      matchKind: "sender", matchValue: "news@example.com", destinationCategory: "subscriptions", affectedCount: 50, protectedCount: 1,
      proposedDestination: { kind: "existing", folderId: "provider-news", folderPath: "INBOX/News", name: "News", category: "subscriptions" },
      folderOptions: [{ kind: "existing", folderId: "provider-news", folderPath: "INBOX/News", name: "News", category: "subscriptions" }], samples: [],
    }], movesSupported: true, automationSupported: true });
    mocks.createFolderMovePreview.mockResolvedValueOnce({ preview: {
      id: "mailfolderpreview_1", accountId: "app_163_mail_v2", suggestionId: "mailfoldersug_1",
      destination: { kind: "existing", folderId: "provider-news", folderPath: "INBOX/News", name: "News", category: "subscriptions" },
      totalMatched: 50, selectedCount: 50, remainingCount: 0, status: "previewed", revision: 1,
      expiresAt: "2026-08-13T03:30:00.000Z", approvalTarget: "mailfolderpreview_1@1:fingerprint", movesSupported: true,
      samples: [{ messageId: "m-news", from: "News <news@example.com>", subject: "Weekly digest", date: "2026-08-13T01:00:00.000Z", folderId: "inbox" }],
    } });
    renderView();
    fireEvent.click((await screen.findAllByRole("button", { name: "查看建议" })).at(-1)!);
    const rules = await screen.findByRole("dialog", { name: "智能分类与邮箱目录" });
    fireEvent.click(within(rules).getByRole("button", { name: "预览邮件" }));
    const preview = await screen.findByRole("dialog", { name: "邮箱目录预览" });
    fireEvent.click(within(preview).getByRole("button", { name: "确认并移动 50 封" }));
    await waitFor(() => expect(mocks.issueApprovalGrant).toHaveBeenCalledWith("mail.organize", "mailfolderpreview_1@1:fingerprint"));
    await waitFor(() => expect(mocks.startFolderMove).toHaveBeenCalledWith("mailfolderpreview_1", "grant_1"));
    expect(await within(preview).findByText("已将 50 封邮件移入目标目录。")).toBeTruthy();
    expect(within(preview).getByRole("button", { name: "收取新邮件" })).toBeTruthy();
  });

  it("enables a bounded automatic rule only after stable local quality and explicit standing consent", async () => {
    mocks.getClassificationQuality.mockResolvedValueOnce({ quality: {
      status: "healthy", generatedAt: "2026-08-17T11:00:00.000Z", sampleSize: 80, minimumSample: 50, signals: [],
      metrics: {
        coverage: { numerator: 80, denominator: 80, value: 1, target: 0.9, direction: "at_least" },
        unknown: { numerator: 1, denominator: 80, value: 0.0125, target: 0.35, direction: "at_most" },
        corrections: { numerator: 2, denominator: 80, value: 0.025, target: 0.15, direction: "at_most" },
        jobFailures: { numerator: 0, denominator: 80, value: 0, target: 0.05, direction: "at_most" },
        semantic: { count: 0 }, stale: { count: 0 },
      },
      organization: { status: "healthy", completedBatches: 10, unconfirmedBatches: 0, unconfirmedRate: 0, minimumSample: 10 },
      privacy: { localOnly: true, includesMessageContent: false, includesSenderIdentity: false },
    } });
    mocks.getFolderSuggestions.mockResolvedValueOnce({ suggestions: [{
      id: "mailfoldersug_1", accountId: "app_163_mail_v2", classificationRuleId: "mailclsrule_news", classificationRuleRevision: 2,
      matchKind: "sender", matchValue: "news@example.com", destinationCategory: "subscriptions", affectedCount: 12, protectedCount: 1,
      proposedDestination: { kind: "existing", folderId: "provider-news", folderPath: "INBOX/News", name: "News", category: "subscriptions" },
      folderOptions: [{ kind: "existing", folderId: "provider-news", folderPath: "INBOX/News", name: "News", category: "subscriptions" }], samples: [],
    }], movesSupported: true, automationSupported: true });
    renderView();
    fireEvent.click((await screen.findAllByRole("button", { name: "查看建议" })).at(-1)!);
    const rules = await screen.findByRole("dialog", { name: "智能分类与邮箱目录" });
    const enable = await within(rules).findByRole("button", { name: "启用自动整理" });
    expect((enable as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(enable);
    const confirmation = await screen.findByRole("dialog", { name: "确认自动整理" });
    expect(within(confirmation).getByText(/匹配邮件不再逐批询问/)).toBeTruthy();
    expect(within(confirmation).getByText(/结果不确定时规则会立即暂停/)).toBeTruthy();
    mocks.enableFolderAutomation.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(within(confirmation).getByRole("button", { name: "确认并启用" }));
    await waitFor(() => expect(mocks.issueApprovalGrant).toHaveBeenCalledWith("mail.organize.auto", "mailfolderautopreview_1@1:fingerprint"));
    expect((await within(confirmation).findByRole("alert")).textContent).toContain("暂时无法启用或更新自动整理");
    fireEvent.click(within(confirmation).getByRole("button", { name: "确认并启用" }));
    await waitFor(() => expect(mocks.enableFolderAutomation).toHaveBeenCalledWith("mailfolderautopreview_1", "grant_1"));
  });

  it("reconciles an uncertain move before offering an explicit recovery batch", async () => {
    mocks.getFolderMoveJobs.mockReset().mockResolvedValue({ jobs: [{
      id: "mailfolderjob_1", accountId: "app_163_mail_v2", previewId: "mailfolderpreview_1",
      destination: { kind: "existing", folderId: "provider-news", folderPath: "INBOX/News", name: "News", category: "subscriptions" },
      requestedCount: 1, movedCount: 0, missingCount: 0, conflictCount: 0, pendingCount: 0, unknownCount: 1,
      mode: "manual", automationId: null, recoveryOfJobId: null, status: "unconfirmed", conflictType: "partial_receipt", revision: 2,
      error: "partial_or_missing_receipt", items: [{ messageId: "<news@example.com>", sourceFolderPath: "INBOX", status: "unknown", reason: "receipt_missing" }],
      createdAt: "2026-08-17T02:00:00.000Z", updatedAt: "2026-08-17T02:01:00.000Z", completedAt: "2026-08-17T02:01:00.000Z",
    }] });
    renderView();
    expect(await screen.findByText("有一批邮箱目录结果需要核对")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看状态" }));
    const recovery = await screen.findByRole("dialog", { name: "有一批邮箱目录结果需要核对" });
    expect(within(recovery).getAllByText(/系统不会自动重试/).length).toBeGreaterThan(0);
    fireEvent.click(within(recovery).getByRole("button", { name: "核对同步结果" }));
    await waitFor(() => expect(mocks.reconcileFolderMoveJob).toHaveBeenCalledWith("mailfolderjob_1"));
    await waitFor(() => expect(mocks.createFolderRecoveryPreview).toHaveBeenCalledWith("mailfolderjob_1"));
    const preview = await screen.findByRole("dialog", { name: "邮箱目录预览" });
    fireEvent.click(within(preview).getByRole("button", { name: "确认并移动 1 封" }));
    await waitFor(() => expect(mocks.issueApprovalGrant).toHaveBeenCalledWith("mail.organize", "recovery_preview@1:fingerprint"));
  });

  it("shows automatic rules and folder operation history in ordinary language", async () => {
    mocks.getFolderAutomations.mockReset().mockResolvedValue({ automations: [{
      id: "mailfolderauto_1", accountId: "app_163_mail_v2", classificationRuleId: "rule_1", classificationRuleRevision: 1,
      suggestionId: "suggestion_1", destination: { kind: "existing", folderId: "news", folderPath: "INBOX/News", name: "News", category: "subscriptions" },
      status: "paused", pauseReason: "provider_conflict", batchSize: 10, revision: 2, enabledAt: "2026-08-17T01:00:00.000Z",
      lastRunAt: "2026-08-17T02:00:00.000Z", lastJobId: "job_1", lastSuccessfulAt: "2026-08-16T02:00:00.000Z",
      consecutiveSuccessfulBatches: 0, lastCheckedAt: "2026-08-17T02:01:00.000Z", nextAction: "sync_and_review",
      createdAt: "2026-08-17T01:00:00.000Z", updatedAt: "2026-08-17T02:00:00.000Z",
    }] });
    mocks.getFolderMoveJobs.mockReset().mockResolvedValue({ jobs: [{
      id: "job_1", accountId: "app_163_mail_v2", previewId: "preview_1", destination: { kind: "existing", folderId: "news", folderPath: "INBOX/News", name: "News", category: "subscriptions" },
      requestedCount: 10, movedCount: 8, missingCount: 0, conflictCount: 2, pendingCount: 0, unknownCount: 0,
      mode: "automatic", automationId: "mailfolderauto_1", recoveryOfJobId: null, status: "conflict", conflictType: "provider_conflict", revision: 2, error: "manual_review_required", items: [],
      createdAt: "2026-08-17T02:00:00.000Z", updatedAt: "2026-08-17T02:01:00.000Z", completedAt: "2026-08-17T02:01:00.000Z",
    }] });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "智能分类设置" }));
    await screen.findByRole("dialog", { name: "智能分类与邮箱目录" });
    await waitFor(() => expect(mocks.getFolderAutomations).toHaveBeenCalled());
    expect(await screen.findByText(/自动整理已暂停/)).toBeTruthy();
    expect(screen.getByText(/请先收取新邮件并查看实际位置/)).toBeTruthy();
    expect(screen.getByText(/自动规则/)).toBeTruthy();
    expect(screen.getByText("待核对")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "试运行" }));
    await waitFor(() => expect(mocks.dryRunFolderAutomation).toHaveBeenCalledWith("mailfolderauto_1"));
    expect(await screen.findByText(/本批将整理 7 封，排除 2 封/)).toBeTruthy();
  });

  it("uses distinct empty states for suggestions and created rules", async () => {
    mocks.getClassificationRules.mockResolvedValueOnce({ suggestions: [], rules: [] });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "智能分类设置" }));
    const dialog = await screen.findByRole("dialog", { name: "智能分类与邮箱目录" });
    expect(await within(dialog).findByText(/暂无新建议/)).toBeTruthy();
    expect(within(dialog).getByText("尚未启用任何个人智能分类规则。")).toBeTruthy();
  });

  it("shows loading only on the suggestion being enabled", async () => {
    let finish!: (value: unknown) => void;
    mocks.getClassificationRules.mockResolvedValueOnce({
      rules: [],
      suggestions: [
        { id: "suggestion_a", accountId: "app_163_mail_v2", matchKind: "sender", matchValue: "a@example.com", target: { attention: "important", mailType: "personal", suggestedAction: "read" }, evidenceCount: 2, affectedCount: 0, samples: [] },
        { id: "suggestion_b", accountId: "app_163_mail_v2", matchKind: "sender", matchValue: "a-very-long-sender-address-for-mobile-layout@example.com", target: { attention: "low_value", mailType: "newsletter", suggestedAction: "archive_candidate" }, evidenceCount: 3, affectedCount: 1, samples: [] },
      ],
    });
    mocks.createClassificationRule.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "智能分类设置" }));
    const dialog = await screen.findByRole("dialog", { name: "智能分类与邮箱目录" });
    const enableButtons = within(dialog).getAllByRole("button", { name: "启用规则" });
    fireEvent.click(enableButtons[0]);
    expect(await within(dialog).findByRole("button", { name: "正在启用…" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "启用规则" })).toBeTruthy();
    finish({ rule: { id: "rule_a" } });
    expect(await within(dialog).findByText(/规则已启用/)).toBeTruthy();
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
    await waitFor(() => expect(downloadMailAttachment).toHaveBeenCalledWith({ messageId: "<one@example.com>", folderPath: "INBOX", attachmentId: "attachment-1", archiveRef }));
    expect(await screen.findByText("附件已保存：notes.txt")).toBeTruthy();
  });

  it("reviews an email as a manual local task and keeps attachments opt-in", async () => {
    renderView();
    fireEvent.click(await screen.findByText("Project update"));
    fireEvent.click(screen.getByRole("button", { name: "交给 AI 处理" }));
    expect(await screen.findByRole("dialog", { name: "确认任务内容" })).toBeTruthy();
    expect((screen.getByLabelText("所属项目") as HTMLSelectElement).value).toBe("project_1");
    expect((screen.getByLabelText(/notes\.txt/) as HTMLInputElement).checked).toBe(false);
    fireEvent.change(screen.getByLabelText("任务标题"), { target: { value: "跟进项目更新" } });
    fireEvent.click(screen.getByRole("button", { name: "只创建任务" }));
    await waitFor(() => expect(mocks.createMailTask).toHaveBeenCalledWith("<one@example.com>", expect.objectContaining({
      projectId: "project_1",
      title: "跟进项目更新",
      attachmentIds: [],
      executionMode: "manual",
    })));
    expect(mocks.createTaskMaterialDraft).not.toHaveBeenCalled();
    expect(await screen.findByText("任务 LOCAL-42 已创建。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看任务" })).toBeTruthy();
  });

  it("creates an AI-ready task from the same review without a separate start call", async () => {
    renderView();
    fireEvent.click(await screen.findByText("Project update"));
    fireEvent.click(screen.getByRole("button", { name: "交给 AI 处理" }));
    fireEvent.click(await screen.findByRole("button", { name: "创建并让 AI 处理" }));
    await waitFor(() => expect(mocks.createMailTask).toHaveBeenCalledWith("<one@example.com>", expect.objectContaining({
      projectId: "project_1",
      executionMode: "auto",
    })));
  });

  it("prioritizes a legacy body through the server queue instead of dispatching Bridge work from the click", async () => {
    mocks.getMailbox.mockResolvedValue({
      ...connectedMailbox,
      messages: [{ ...connectedMailbox.messages[0], bodyContentVersion: 1 }],
    });
    renderView();
    fireEvent.click(await screen.findByText("Project update"));
    await waitFor(() => expect(mocks.prioritizeBodyPrefetch).toHaveBeenCalledWith("<one@example.com>"));
    expect(mocks.invokeCapability).not.toHaveBeenCalled();
  });

  it("linkifies safe URLs and renders HTML only in the user-controlled isolated preview", async () => {
    const previewMailAttachment = vi.fn().mockResolvedValue({ ok: true, preview: {
      id: "attachment-2", name: "logo.png", contentType: "image/png", size: 4, kind: "image", dataBase64: "c2FmZQ==",
    } });
    window.myagenttoolDesktop = { previewMailAttachment };
    mocks.getMailbox.mockResolvedValue({
      ...connectedMailbox,
      messages: [{
        ...connectedMailbox.messages[0],
        body: "Open https://example.com/path for details.",
        bodyHtml: '<p>Open <a href="https://example.com/path">details</a></p><img src="https://tracker.example/pixel.png" alt="Tracker"><img src="cid:logo%40mail" alt="Logo"><script>alert(1)</script>',
        hasHtml: true,
        bodyTruncated: true,
        attachments: [{ id: "attachment-2", name: "logo.png", contentType: "image/png", size: 4, sha256: "a".repeat(64), previewable: true, contentId: "logo@mail" }],
      }],
    });
    renderView();
    fireEvent.click(await screen.findByText("Project update"));
    const link = await screen.findByRole("link", { name: "https://example.com/path" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText(/当前正文并不完整/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看安全排版" }));
    const frame = await screen.findByTitle("安全邮件内容");
    await waitFor(() => expect(frame.getAttribute("srcdoc")).toContain("data:image/png;base64,c2FmZQ=="));
    expect(frame.getAttribute("srcdoc")).not.toContain("<script");
    expect(frame.getAttribute("srcdoc")).not.toContain("https://tracker.example/pixel.png");
    expect(previewMailAttachment).toHaveBeenCalledWith({ messageId: "<one@example.com>", folderPath: "INBOX", attachmentId: "attachment-2", archiveRef });
    fireEvent.click(screen.getByRole("button", { name: "加载远程图片" }));
    await waitFor(() => expect(frame.getAttribute("srcdoc")).toContain("https://tracker.example/pixel.png"));
    expect(screen.getByText(/发件方可能获知/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "返回纯文本" }));
    expect(screen.queryByTitle("安全邮件内容")).toBeNull();
  });

  it("skips an attachment whose provider bytes no longer match and still creates the task", async () => {
    const readMailAttachmentForTask = vi.fn().mockResolvedValue({ ok: true, attachment: {
      id: "attachment-1", name: "notes.txt", contentType: "text/plain", size: 4,
      sha256: "0".repeat(64), data: new TextEncoder().encode("oops").buffer,
    } });
    window.myagenttoolDesktop = { readMailAttachmentForTask };
    renderView();
    fireEvent.click(await screen.findByText("Project update"));
    fireEvent.click(screen.getByRole("button", { name: "交给 AI 处理" }));
    fireEvent.click(screen.getByLabelText(/notes\.txt/));
    fireEvent.click(screen.getByRole("button", { name: "只创建任务" }));
    await waitFor(() => expect(mocks.createMailTask).toHaveBeenCalledWith("<one@example.com>", expect.objectContaining({ attachmentIds: [] })));
    expect(mocks.uploadTaskMaterialFile).not.toHaveBeenCalled();
    expect(await screen.findByText(/1 个附件未能添加/)).toBeTruthy();
  });

  it("shows the task action only on the task-created notice", async () => {
    const downloadMailAttachment = vi.fn().mockResolvedValue({ ok: true, saved: true, name: "notes.txt" });
    window.myagenttoolDesktop = { downloadMailAttachment };
    renderView();
    fireEvent.click(await screen.findByText("Project update"));
    fireEvent.click(screen.getByRole("button", { name: "交给 AI 处理" }));
    fireEvent.click(screen.getByRole("button", { name: "只创建任务" }));
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
    expect(mocks.getMailbox).toHaveBeenCalledWith(2, "inbox", "", "all");
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
    fireEvent.change(screen.getByPlaceholderText("搜索此邮箱目录内已收取的邮件"), { target: { value: "quarterly" } });
    await waitFor(() => expect(mocks.getMailbox).toHaveBeenCalledWith(1, "inbox", "quarterly", "all"));
    fireEvent.click(await screen.findByRole("button", { name: /服务商已发送/ }));
    await waitFor(() => expect(mocks.getMailbox).toHaveBeenCalledWith(1, "provider-sent", "quarterly", "all"));
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
    expect(screen.getByText(/这一步需要在 MyAgentTool 桌面版完成/)).toBeTruthy();
    const desktopLink = screen.getByRole("link", { name: "在桌面版继续" });
    expect(desktopLink.getAttribute("href")).toBe("myagenttool://mail/connect?intent=manage");
  });

  it("preserves the selected authorization step when handing off from browser to desktop", async () => {
    window.history.replaceState({}, "", "/?section=mail&mailConnect=organize");
    renderView();
    const dialog = await screen.findByRole("dialog", { name: "连接邮箱" });
    expect(within(dialog).getByRole("link", { name: "在桌面版继续" }).getAttribute("href")).toBe("myagenttool://mail/connect?intent=organize");
    expect(new URLSearchParams(window.location.search).get("mailConnect")).toBeNull();
  });

  it("connects receiving, folder organization, and sending with one local authorization", async () => {
    mocks.getMailConnectorStatus.mockResolvedValue({ desktop: true, providers: [
      { id: "netease_163", name: "163 邮箱", available: true, connected: false, account: null },
      { id: "gmail", name: "Gmail", available: false, connected: false, account: null },
    ] });
    mocks.connect163Mail.mockResolvedValue({ ok: true, account: { provider: "netease", email: "user@163.com", canReceive: true, canSend: true, canOrganize: true } });
    window.myagenttoolDesktop = { getMailConnectorStatus: mocks.getMailConnectorStatus, connect163Mail: mocks.connect163Mail };
    mocks.getMailbox.mockResolvedValue({ ...connectedMailbox, accounts: [], connection: { status: "not_connected", message: "" }, messages: [], folders: connectedMailbox.folders.map((folder) => ({ ...folder, count: 0 })) });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "打开邮箱连接设置" }));
    expect(await screen.findByText("即将支持")).toBeTruthy();
    expect(screen.getByText("可连接")).toBeTruthy();
    expect(screen.queryByText("收件已连接")).toBeNull();
    fireEvent.change(screen.getByLabelText("163 邮箱地址"), { target: { value: "user@163.com" } });
    fireEvent.change(screen.getByLabelText("客户端授权码"), { target: { value: "local-code" } });
    fireEvent.click(screen.getByRole("button", { name: "连接并测试邮箱" }));
    expect(await screen.findByText("邮箱连接成功")).toBeTruthy();
    expect(screen.getByText("收件已连接")).toBeTruthy();
    expect(screen.getByText("目录整理已连接")).toBeTruthy();
    expect(screen.getByText("发件已连接")).toBeTruthy();
    expect(screen.queryByLabelText("客户端授权码")).toBeNull();
    expect(mocks.connect163Mail).toHaveBeenCalledWith({ email: "user@163.com", authorizationCode: "local-code" });
  });

  it("upgrades an existing receiving connection without asking for authorization again", async () => {
    mocks.getMailConnectorStatus.mockResolvedValue({ desktop: true, providers: [
      { id: "netease_163", name: "163 邮箱", available: true, connected: true, upgradeNeeded: true, sendConnected: true, organizeConnected: true, account: "legacy@163.com" },
      { id: "gmail", name: "Gmail", available: false, connected: false, account: null },
    ] });
    window.myagenttoolDesktop = { getMailConnectorStatus: mocks.getMailConnectorStatus };
    renderView();
    await screen.findByText("Project update");
    fireEvent.click(screen.getByRole("button", { name: "管理邮箱连接" }));
    expect(await screen.findByText("升级现有邮箱连接")).toBeTruthy();
    expect(screen.getByText(/不需要再次输入授权码/)).toBeTruthy();
    expect(screen.queryByLabelText("客户端授权码")).toBeNull();
    expect(screen.getByText("legacy@163.com")).toBeTruthy();
  });

  it("does not expose a second authorization flow for folder organization or sending", async () => {
    mocks.getMailConnectorStatus.mockResolvedValue({ desktop: true, providers: [
      { id: "netease_163", name: "163 邮箱", available: true, connected: true, sendConnected: false, organizeConnected: false, account: "user@163.com" },
      { id: "gmail", name: "Gmail", available: false, connected: false, account: null },
    ] });
    window.myagenttoolDesktop = { getMailConnectorStatus: mocks.getMailConnectorStatus, connect163MailOrganize: mocks.connect163MailOrganize };
    mocks.getMailbox.mockResolvedValue({
      ...connectedMailbox,
      accounts: connectedMailbox.accounts.map((account) => ({ ...account, canSend: false, canOrganize: false })),
    });
    renderView();
    expect(await screen.findByRole("button", { name: "管理邮箱连接" })).toBeTruthy();
    expect(screen.queryByText(/还有 2 项功能可启用/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "管理邮箱连接" }));
    const dialog = await screen.findByRole("dialog", { name: "连接邮箱" });
    expect(within(dialog).getByText("目录整理已连接")).toBeTruthy();
    expect(within(dialog).getByText("发件已连接")).toBeTruthy();
    expect(within(dialog).queryByLabelText("客户端授权码")).toBeNull();
    expect(mocks.connect163MailOrganize).not.toHaveBeenCalled();
  });

  it("disconnects the unified mailbox authorization only after confirmation", async () => {
    const disconnect163Mail = vi.fn().mockResolvedValue({ ok: true, disconnected: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.getMailConnectorStatus.mockResolvedValue({ desktop: true, providers: [
      { id: "netease_163", name: "163 邮箱", available: true, connected: true, sendConnected: true, organizeConnected: true, account: "user@163.com" },
      { id: "gmail", name: "Gmail", available: false, connected: false, account: null },
    ] });
    window.myagenttoolDesktop = { getMailConnectorStatus: mocks.getMailConnectorStatus, disconnect163Mail };
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "管理邮箱连接" }));
    fireEvent.click(await screen.findByRole("button", { name: "断开邮箱" }));
    await waitFor(() => expect(disconnect163Mail).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it("shows a retryable mailbox error instead of pretending the account is disconnected", async () => {
    mocks.getMailbox.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(connectedMailbox);
    renderView();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("邮箱暂时无法加载");
    expect(screen.queryByText("连接你的邮箱")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByText("Project update")).toBeTruthy();
  });

  it("asks before discarding an unsaved email", async () => {
    renderView();
    await screen.findByText("Project update");
    fireEvent.click(screen.getByRole("button", { name: "写邮件" }));
    const composeDialog = screen.getByRole("dialog", { name: "写邮件" });
    fireEvent.change(within(composeDialog).getByLabelText("正文"), { target: { value: "不要丢失这段内容" } });
    fireEvent.click(within(composeDialog).getByRole("button", { name: "关闭" }));
    const confirm = await screen.findByRole("dialog", { name: "放弃未保存的邮件？" });
    fireEvent.click(within(confirm).getByRole("button", { name: "取消" }));
    expect(screen.getByRole("dialog", { name: "写邮件" })).toBeTruthy();
  });

  it("opens an unconfirmed outbox item with its failure reason and duplicate-send guidance", async () => {
    const draft = {
      id: "maildraft_uncertain", status: "send_unconfirmed", revision: 2, origin: "user",
      to: "buyer@example.com", subject: "报价说明", body: "请查收报价。", attachments: [],
      inReplyTo: null, references: [], createdAt: "2026-08-13T02:00:00.000Z", updatedAt: "2026-08-13T02:05:00.000Z",
      sentAt: null, sendError: "provider receipt was not returned", approvalTarget: "maildraft_uncertain@2",
    };
    mocks.getMailbox.mockResolvedValue({
      ...connectedMailbox,
      folders: connectedMailbox.folders.map((folder) => folder.id === "outbox" ? { ...folder, count: 1 } : folder),
      drafts: [draft],
    });
    renderView();
    await screen.findByText("Project update");
    fireEvent.click(screen.getByRole("button", { name: /发件箱/ }));
    fireEvent.click(await screen.findByRole("button", { name: /报价说明/ }));
    const detail = screen.getByRole("dialog", { name: "邮件详情" });
    expect(within(detail).getByText("provider receipt was not returned")).toBeTruthy();
    expect(within(detail).getByText(/避免收件人收到重复邮件/)).toBeTruthy();
  });
});
