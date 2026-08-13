import { expect, test, type Page } from "playwright/test";

const STATE = {
  device: { id: "device-1", name: "Synthetic computer", status: "online", platform: "windows", architecture: "x64" },
  projects: [], worktrees: [], projectTargets: [], pendingDecisions: [], evidenceLedger: [], invocations: [], events: [],
};

const MAILBOX = {
  accounts: [{
    id: "app_163_mail_v2", provider: "netease", name: "163 Mail", status: "connected", statusDetail: "ready",
    canReceive: true, canSend: false, readApplicationId: "app_163_mail_v2", sendApplicationId: null,
    syncCapability: "app.app_163_mail_v2.list_unread", fetchCapability: "app.app_163_mail_v2.fetch",
  }],
  connection: { status: "connected", message: "163 Mail" },
  folders: [{ id: "inbox", count: 2, unread: 2 }, { id: "drafts", count: 1 }, { id: "sent", count: 0 }, { id: "outbox", count: 0 }],
  messages: [
    { id: "m1", messageId: "m1", from: "示例客户 <customer@example.com>", subject: "确认交付范围", date: "2026-08-13T02:00:00.000Z", body: "你好，请确认本周交付范围。", preview: "你好，请确认本周交付范围。", unread: true, fetched: true, inReplyTo: null, references: [], applicationId: "app_163_mail_v2", issueNumber: null, createdAt: "2026-08-13T02:00:00.000Z" },
    { id: "m2", messageId: "m2", from: "同事 <team@example.com>", subject: "周会资料", date: "2026-08-12T02:00:00.000Z", body: null, preview: "", unread: true, fetched: false, inReplyTo: null, references: [], applicationId: "app_163_mail_v2", issueNumber: null, createdAt: "2026-08-12T02:00:00.000Z" },
  ],
  drafts: [{ id: "d1", status: "draft", revision: 1, origin: "user", to: "buyer@example.com", subject: "报价说明", body: "您好，附件是报价说明。", inReplyTo: null, references: [], createdAt: "2026-08-13T01:00:00.000Z", updatedAt: "2026-08-13T01:00:00.000Z", sentAt: null, sendError: null, approvalTarget: "d1@1" }],
  updatedAt: "2026-08-13T02:00:00.000Z",
};

async function mockMail(page: Page) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/state") return route.fulfill({ json: STATE });
    if (path === "/api/mailbox") return route.fulfill({ json: MAILBOX });
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
    await expect(page.getByText("当前可收件；发件权限尚未连接")).toBeVisible();
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
