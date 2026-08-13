import { expect, test, type Page } from "playwright/test";

const STATE = {
  device: { id: "device-1", name: "Synthetic computer", status: "online", platform: "windows", architecture: "x64" },
  projects: [], worktrees: [], projectTargets: [], pendingDecisions: [], evidenceLedger: [], invocations: [], events: [],
};

const MAILBOX = {
  accounts: [{
    id: "app_163_mail_v2", provider: "netease", name: "163 Mail", status: "connected", statusDetail: "ready",
    canReceive: true, canSend: false, readApplicationId: "app_163_mail_v2", sendApplicationId: null,
    fetchCapability: "app.app_163_mail_v2.fetch",
  }],
  connection: { status: "connected", message: "163 Mail" },
  sync: { status: "idle", invocationId: null, lastCompletedAt: null, lastSucceededAt: "2026-08-13T02:00:00.000Z" },
  folders: [{ id: "inbox", count: 2, unread: 2 }, { id: "drafts", count: 1 }, { id: "sent", count: 0 }, { id: "outbox", count: 0 }],
  messages: [
    { id: "m1", messageId: "m1", from: "示例客户 <customer@example.com>", subject: "确认交付范围", date: "2026-08-13T02:00:00.000Z", body: "你好，请确认本周交付范围。", preview: "你好，请确认本周交付范围。", unread: true, fetched: true, inReplyTo: null, references: [], attachments: [{ id: "attachment-1", name: "范围说明.txt", contentType: "text/plain", size: 24, previewable: true }], attachmentMetadataLoaded: true, applicationId: "app_163_mail_v2", issueNumber: null, createdAt: "2026-08-13T02:00:00.000Z" },
    { id: "m2", messageId: "m2", from: "同事 <team@example.com>", subject: "周会资料", date: "2026-08-12T02:00:00.000Z", body: null, preview: "", unread: true, fetched: false, inReplyTo: null, references: [], attachments: [], attachmentMetadataLoaded: false, applicationId: "app_163_mail_v2", issueNumber: null, createdAt: "2026-08-12T02:00:00.000Z" },
  ],
  pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1, hasPrevious: false, hasNext: false },
  drafts: [{ id: "d1", status: "draft", revision: 1, origin: "user", to: "buyer@example.com", subject: "报价说明", body: "您好，附件是报价说明。", inReplyTo: null, references: [], createdAt: "2026-08-13T01:00:00.000Z", updatedAt: "2026-08-13T01:00:00.000Z", sentAt: null, sendError: null, approvalTarget: "d1@1" }],
  updatedAt: "2026-08-13T02:00:00.000Z",
};

async function mockMail(page: Page) {
  let syncing = false;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/state") return route.fulfill({ json: STATE });
    if (path === "/api/mailbox/sync") {
      syncing = true;
      return route.fulfill({ json: { sync: { status: "syncing", invocationId: "inv_sync", lastCompletedAt: null, lastSucceededAt: MAILBOX.sync.lastSucceededAt }, reused: false } });
    }
    if (path.endsWith("/read")) return route.fulfill({ json: { messageId: "m1", unread: false } });
    if (path === "/api/mailbox") {
      if (!syncing) return route.fulfill({ json: MAILBOX });
      syncing = false;
      return route.fulfill({ json: { ...MAILBOX, sync: { status: "succeeded", invocationId: "inv_sync", lastCompletedAt: "2026-08-13T03:00:00.000Z", lastSucceededAt: "2026-08-13T03:00:00.000Z" } } });
    }
    return route.fulfill({ json: {} });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({ version: 1, state: { section: "mail", locale: "zh-CN" } }));
  });
}

for (const fixture of [
  { name: "desktop", viewport: { width: 1366, height: 768 } },
  { name: "mobile", viewport: { width: 390, height: 844 } },
]) {
  test(`keeps the ${fixture.name} ordinary-user mailbox readable and usable`, async ({ page }, testInfo) => {
    await page.setViewportSize(fixture.viewport);
    await mockMail(page);
    await page.goto("/?section=mail");

    await expect(page.getByRole("heading", { name: "我的邮箱" })).toBeVisible();
    await expect(page.getByText("确认交付范围", { exact: true })).toBeVisible();
    await expect(page.getByText("发件尚未连接")).toBeVisible();
    await page.getByRole("button", { name: "收取新邮件" }).click();
    await expect(page.getByText("收取完成，收件箱已更新。")).toBeVisible();
    await page.getByText("确认交付范围", { exact: true }).click();
    await expect(page.getByLabel("确认交付范围").getByText("你好，请确认本周交付范围。")).toBeVisible();
    await expect(page.getByText(/系统只把它当作内容展示/)).toBeVisible();

    await page.getByRole("button", { name: "写邮件" }).click();
    const dialog = page.getByRole("dialog", { name: "写邮件" });
    await expect(dialog.getByLabel("收件人")).toBeVisible();
    await expect(dialog.getByText(/连接发件权限后才能发送/)).toBeVisible();
    await dialog.getByRole("button", { name: "关闭" }).click();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`${fixture.name}-mailbox.png`), fullPage: true });
  });
}

test("connects 163 Mail through the ordinary-user desktop assistant", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 820 });
  await mockMail(page);
  await page.addInitScript(() => {
    (window as any).myagenttoolDesktop = {
      getMailConnectorStatus: async () => ({ desktop: true, providers: [
        { id: "netease_163", name: "163 邮箱", available: true, connected: false, account: null },
        { id: "gmail", name: "Gmail", available: false, connected: false, account: null },
      ] }),
      connect163Mail: async ({ email }: { email: string }) => ({ ok: true, account: { provider: "netease", email, canReceive: true, canSend: false } }),
    };
  });
  await page.goto("/?section=mail");
  await page.getByRole("button", { name: "管理邮箱连接" }).click();
  const dialog = page.getByRole("dialog", { name: "连接邮箱" });
  await expect(dialog.getByText("Gmail")).toBeVisible();
  await expect(dialog.getByText("即将支持")).toBeVisible();
  await dialog.getByLabel("163 邮箱地址").fill("user@163.com");
  await dialog.getByLabel("客户端授权码").fill("local-only-code");
  await dialog.getByRole("button", { name: "连接并测试收件" }).click();
  await expect(dialog.getByText("收件连接成功")).toBeVisible();
  await expect(dialog.getByText(/发件权限仍保持关闭/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mail-connection-success.png"), fullPage: true });
});
