import { expect, test, type Page } from "playwright/test";

const STATE = {
  device: { id: "device-1", name: "Synthetic computer", status: "online", platform: "windows", architecture: "x64" },
  projects: [{ id: "project_1", name: "客户交付", status: "active", color: "blue", ownerTeamId: "team_local", budgetPoolId: null, defaultAgentId: null, isolation: "shared", createdAt: "2026-08-01T00:00:00.000Z" }], worktrees: [], projectTargets: [], pendingDecisions: [], evidenceLedger: [], invocations: [], events: [],
};

const ARCHIVE_REF = `mailarc_${"a".repeat(24)}_${"b".repeat(40)}`;

const MAILBOX = {
  accounts: [{
    id: "app_163_mail_v2", provider: "netease", name: "163 Mail", status: "connected", statusDetail: "ready",
    canReceive: true, canSend: true, canOrganize: true, readApplicationId: "app_163_mail_v2", sendApplicationId: "app_163_mail_send", organizeApplicationId: "app_163_mail_organize",
    fetchCapability: "app.app_163_mail_v2.fetch",
  }],
  connection: { status: "connected", message: "163 Mail" },
  sync: { status: "idle", invocationId: null, lastCompletedAt: null, lastSucceededAt: "2026-08-13T02:00:00.000Z" },
  folders: [{ id: "inbox", name: "收件箱", kind: "provider", specialUse: "\\Inbox", count: 2, unread: 2 }, { id: "drafts", count: 1 }, { id: "sent", count: 0 }, { id: "outbox", count: 0 }],
  messages: [
    { id: "m1", messageId: "m1", from: "示例客户 <customer@example.com>", subject: "确认交付范围", date: "2026-08-13T02:00:00.000Z", body: "你好，请确认本周交付范围。详情：https://example.com/delivery", bodyHtml: '<p>你好，请确认本周交付范围。<a href="https://example.com/delivery">查看详情</a></p><img src="https://images.example.com/tracker.png" alt="交付示意图"><script>alert(1)</script>', hasHtml: true, bodyTruncated: false, bodyContentVersion: 2, preview: "你好，请确认本周交付范围。", unread: true, fetched: true, inReplyTo: null, references: [], attachments: [{ id: "attachment-1", name: "范围说明.txt", contentType: "text/plain", size: 24, previewable: true, localAvailable: true }], attachmentMetadataLoaded: true, archive: { version: 1, ref: ARCHIVE_REF, availability: "available", sha256: "c".repeat(64), size: 4096, archivedAt: "2026-08-13T02:00:00.000Z" }, applicationId: "app_163_mail_v2", issueNumber: null, task: null, createdAt: "2026-08-13T02:00:00.000Z", classification: { attention: "action_required", mailType: "customer_or_project", suggestedAction: "reply", label: "待处理", explanation: "主题包含明确的确认、提交或处理要求。", uncertain: false, confirmationState: "proposed", revision: 1 } },
    { id: "m2", messageId: "m2", from: "产品周刊 <news@example.com>", subject: "本周产品周刊", date: "2026-08-12T02:00:00.000Z", body: null, preview: "", unread: true, fetched: false, inReplyTo: null, references: [], attachments: [], attachmentMetadataLoaded: false, applicationId: "app_163_mail_v2", issueNumber: null, task: null, createdAt: "2026-08-12T02:00:00.000Z", classification: { attention: "low_value", mailType: "newsletter", suggestedAction: "archive_candidate", label: "订阅", explanation: "邮件头显示这是一封订阅邮件。", uncertain: false, confirmationState: "proposed", revision: 1 } },
  ],
  selectedView: "all",
  classificationSummary: { counts: { all: 2, needs_attention: 1, important: 0, notifications: 0, subscriptions: 1, other: 0 }, classified: 2, pending: 0, classifierVersion: 1 },
  pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1, hasPrevious: false, hasNext: false },
  drafts: [{ id: "d1", status: "draft", revision: 1, origin: "user", to: "buyer@example.com", subject: "报价说明", body: "您好，附件是报价说明。", inReplyTo: null, references: [], createdAt: "2026-08-13T01:00:00.000Z", updatedAt: "2026-08-13T01:00:00.000Z", sentAt: null, sendError: null, approvalTarget: "d1@1" }],
  updatedAt: "2026-08-13T02:00:00.000Z",
};

async function mockMail(page: Page, options: { qualityHealthy?: boolean; recovery?: boolean } = {}) {
  let syncing = false;
  let folderRuleEnabled = false;
  let automationEnabled = false;
  await page.route("http://127.0.0.1:5001/api/**", (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;
    if (path === "/api/state") return route.fulfill({ json: STATE });
    if (path === "/api/mailbox/sync") {
      syncing = true;
      return route.fulfill({ json: { sync: { status: "syncing", invocationId: "inv_sync", lastCompletedAt: null, lastSucceededAt: MAILBOX.sync.lastSucceededAt }, reused: false } });
    }
    if (path.endsWith("/read")) return route.fulfill({ json: { messageId: "m1", unread: false } });
    if (path.endsWith("/task")) return route.fulfill({ json: { task: { id: "lwi_42", localRef: "LOCAL-42", title: "确认交付范围", projectId: "project_1" }, replayed: false } });
    if (path === "/api/mailbox/semantic-classification-preview") return route.fulfill({ json: { preview: { available: true, reason: null, eligible: 1, pending: 1, limit: 20, newestDate: MAILBOX.messages[0].date, oldestDate: MAILBOX.messages[0].date, readsUnopenedBodies: false, externalModel: false, provider: "local_http", model: "mail-local-v1", circuitRemainingMs: 0 } } });
    if (path === "/api/mailbox/classification-rules" && route.request().method() === "GET") return route.fulfill({ json: {
      suggestions: [{ id: "mailrulesug_1", accountId: "app_163_mail_v2", matchKind: "sender", matchValue: "news@example.com", target: { attention: "low_value", mailType: "newsletter", suggestedAction: "archive_candidate" }, evidenceCount: 2, affectedCount: 1, samples: [{ messageId: "m2", from: MAILBOX.messages[1].from, subject: MAILBOX.messages[1].subject, date: MAILBOX.messages[1].date }] }],
      rules: [],
    } });
    if (path === "/api/mailbox/classification-quality") return route.fulfill({ json: { quality: {
      status: options.qualityHealthy ? "healthy" : "collecting", generatedAt: "2026-08-17T11:00:00.000Z", sampleSize: options.qualityHealthy ? 80 : 2, minimumSample: 50, signals: options.qualityHealthy ? [] : ["insufficient_sample"],
      metrics: {
        coverage: { numerator: 2, denominator: 2, value: 1, target: 0.9, direction: "at_least" },
        unknown: { numerator: 0, denominator: 2, value: 0, target: 0.35, direction: "at_most" },
        corrections: { numerator: 0, denominator: 2, value: 0, target: 0.15, direction: "at_most" },
        jobFailures: { numerator: 0, denominator: 2, value: 0, target: 0.05, direction: "at_most" },
        semantic: { count: 0 }, stale: { count: 0 },
      },
      organization: { status: options.qualityHealthy ? "healthy" : "collecting", completedBatches: options.qualityHealthy ? 10 : 0, unconfirmedBatches: 0, unconfirmedRate: options.qualityHealthy ? 0 : null, minimumSample: 10 },
      privacy: { localOnly: true, includesMessageContent: false, includesSenderIdentity: false },
    } } });
    if (path === "/api/mailbox/classification-rules" && route.request().method() === "POST") {
      folderRuleEnabled = true;
      return route.fulfill({ status: 201, json: { rule: { id: "mailclsrule_1", accountId: "app_163_mail_v2", status: "active", matchKind: "sender", matchValue: "news@example.com", target: { attention: "low_value", mailType: "newsletter", suggestedAction: "archive_candidate" }, revision: 1 } } });
    }
    if (path === "/api/mailbox/folder-suggestions") return route.fulfill({ json: { movesSupported: true, automationSupported: true, suggestions: folderRuleEnabled ? [{
      id: "mailfoldersug_1", accountId: "app_163_mail_v2", classificationRuleId: "mailclsrule_1", classificationRuleRevision: 1,
      matchKind: "sender", matchValue: "news@example.com", destinationCategory: "subscriptions", affectedCount: 1, protectedCount: 0,
      proposedDestination: { kind: "new", folderId: null, folderPath: null, name: "订阅与推广", category: "subscriptions" }, folderOptions: [],
      samples: [{ messageId: "m2", from: MAILBOX.messages[1].from, subject: MAILBOX.messages[1].subject, date: MAILBOX.messages[1].date, folderId: "inbox" }],
    }] : [] } });
    if (path === "/api/mailbox/folder-move-previews" && route.request().method() === "POST") return route.fulfill({ status: 201, json: { preview: {
      id: "mailfolderpreview_1", accountId: "app_163_mail_v2", suggestionId: "mailfoldersug_1",
      destination: { kind: "new", folderId: null, folderPath: null, name: "订阅与推广", category: "subscriptions" },
      totalMatched: 1, selectedCount: 1, remainingCount: 0, status: "previewed", revision: 1,
      expiresAt: "2026-08-13T03:30:00.000Z", approvalTarget: "mailfolderpreview_1@1:fingerprint", movesSupported: true,
      samples: [{ messageId: "m2", from: MAILBOX.messages[1].from, subject: MAILBOX.messages[1].subject, date: MAILBOX.messages[1].date, folderId: "inbox" }],
    } } });
    if (path === "/api/mailbox/folder-automation-previews" && route.request().method() === "POST") return route.fulfill({ status: 201, json: { preview: {
      id: "mailfolderautopreview_1", accountId: "app_163_mail_v2", suggestionId: "mailfoldersug_1", purpose: "automatic",
      destination: { kind: "new", folderId: null, folderPath: null, name: "订阅与推广", category: "subscriptions" },
      totalMatched: 1, selectedCount: 1, remainingCount: 0, status: "previewed", revision: 1,
      expiresAt: "2026-08-13T03:30:00.000Z", approvalTarget: "mailfolderautopreview_1@1:fingerprint", movesSupported: true, samples: [],
    } } });
    if (path === "/api/mailbox/folder-automations" && route.request().method() === "POST") {
      automationEnabled = true;
      return route.fulfill({ status: 201, json: { automation: {
        id: "mailfolderauto_1", accountId: "app_163_mail_v2", classificationRuleId: "mailclsrule_1", classificationRuleRevision: 1,
        suggestionId: "mailfoldersug_1", destination: { kind: "new", folderId: null, folderPath: null, name: "订阅与推广", category: "subscriptions" },
        status: "active", pauseReason: null, batchSize: 10, revision: 1, enabledAt: "2026-08-17T01:00:00.000Z",
        lastRunAt: null, lastJobId: null, lastSuccessfulAt: null, consecutiveSuccessfulBatches: 0, lastCheckedAt: null,
        nextAction: "none", createdAt: "2026-08-17T01:00:00.000Z", updatedAt: "2026-08-17T01:00:00.000Z",
      } } });
    }
    if (path === "/api/mailbox/folder-automations" && route.request().method() === "GET") return route.fulfill({ json: { automations: automationEnabled ? [{
      id: "mailfolderauto_1", accountId: "app_163_mail_v2", classificationRuleId: "mailclsrule_1", classificationRuleRevision: 1,
      suggestionId: "mailfoldersug_1", destination: { kind: "new", folderId: null, folderPath: null, name: "订阅与推广", category: "subscriptions" },
      status: "active", pauseReason: null, batchSize: 10, revision: 1, enabledAt: "2026-08-17T01:00:00.000Z",
      lastRunAt: null, lastJobId: null, lastSuccessfulAt: null, consecutiveSuccessfulBatches: 0, lastCheckedAt: null,
      nextAction: "none", createdAt: "2026-08-17T01:00:00.000Z", updatedAt: "2026-08-17T01:00:00.000Z",
    }] : [] } });
    if (path === "/api/approvals/grants" && route.request().method() === "POST") return route.fulfill({ status: 201, json: { token: "folder-grant", grantId: "grant_1", expiresAt: "2026-08-13T03:10:00.000Z" } });
    if (path === "/api/mailbox/folder-move-jobs" && route.request().method() === "POST") return route.fulfill({ status: 202, json: { job: {
      id: "mailfolderjob_1", accountId: "app_163_mail_v2", previewId: "mailfolderpreview_1",
      destination: { kind: "new", folderId: null, folderPath: null, name: "订阅与推广", category: "subscriptions" },
      requestedCount: 1, movedCount: 0, missingCount: 0, status: "moving", revision: 1, error: null,
      createdAt: "2026-08-13T03:00:00.000Z", updatedAt: "2026-08-13T03:00:00.000Z", completedAt: null,
    } } });
    if (path === "/api/mailbox/folder-move-jobs" && route.request().method() === "GET") return route.fulfill({ json: { jobs: options.recovery ? [{
      id: "mailfolderjob_recovery", accountId: "app_163_mail_v2", previewId: "mailfolderpreview_1",
      destination: { kind: "new", folderId: null, folderPath: "Subscriptions", name: "订阅与推广", category: "subscriptions" },
      requestedCount: 1, movedCount: 0, missingCount: 0, conflictCount: 0, pendingCount: 0, unknownCount: 1,
      mode: "manual", automationId: null, recoveryOfJobId: null, status: "unconfirmed", conflictType: "partial_receipt", revision: 2,
      error: "partial_or_missing_receipt", items: [{ messageId: "m2", sourceFolderPath: "INBOX", status: "unknown", reason: "receipt_missing" }],
      createdAt: "2026-08-17T02:00:00.000Z", updatedAt: "2026-08-17T02:01:00.000Z", completedAt: "2026-08-17T02:01:00.000Z",
    }] : [] } });
    if (path === "/api/mailbox/folder-move-jobs/mailfolderjob_recovery/reconcile" && route.request().method() === "POST") return route.fulfill({ json: { job: { id: "mailfolderjob_recovery", status: "recoverable", pendingCount: 1 } } });
    if (path === "/api/mailbox/folder-move-jobs/mailfolderjob_recovery/recovery-preview" && route.request().method() === "POST") return route.fulfill({ status: 201, json: { preview: {
      id: "recovery_preview", accountId: "app_163_mail_v2", suggestionId: "mailfoldersug_1", purpose: "recovery", recoveryOfJobId: "mailfolderjob_recovery",
      destination: { kind: "new", folderId: null, folderPath: "Subscriptions", name: "订阅与推广", category: "subscriptions" },
      totalMatched: 1, selectedCount: 1, remainingCount: 0, status: "previewed", revision: 1,
      expiresAt: "2026-08-17T03:30:00.000Z", approvalTarget: "recovery_preview@1:fingerprint", movesSupported: true, samples: [],
    } } });
    if (/^\/api\/mailbox\/folder-move-jobs\/[^/]+$/.test(path)) return route.fulfill({ json: { job: {
      id: "mailfolderjob_1", accountId: "app_163_mail_v2", previewId: "mailfolderpreview_1",
      destination: { kind: "new", folderId: null, folderPath: "Subscriptions", name: "订阅与推广", category: "subscriptions" },
      requestedCount: 1, movedCount: 1, missingCount: 0, status: "succeeded", revision: 1, error: null,
      createdAt: "2026-08-13T03:00:00.000Z", updatedAt: "2026-08-13T03:01:00.000Z", completedAt: "2026-08-13T03:01:00.000Z",
    } } });
    if (/^\/api\/mailbox\/classification-jobs\/[^/]+$/.test(path)) return route.fulfill({ json: { job: { id: "mailclsjob_deep", scope: "recent", mode: "semantic", status: "succeeded", total: 1, processed: 1, classified: 1, failed: 0 } } });
    if (path === "/api/mailbox/classification-jobs") {
      const body = route.request().postDataJSON();
      return route.fulfill({ json: body?.mode === "semantic"
        ? { job: { id: "mailclsjob_deep", scope: "recent", mode: "semantic", status: "queued", total: 1, processed: 0, classified: 0, failed: 0 } }
        : { job: { id: "mailclsjob_1", mode: "header", status: "succeeded", total: 2, processed: 2, classified: 0, replayed: 2, failed: 0 } } });
    }
    if (path.endsWith("/classification")) return route.fulfill({ json: { classification: { attention: "routine", mailType: "other", suggestedAction: "none", label: "其他", explanation: "你已手动调整这封邮件的分类。", uncertain: false, confirmationState: "corrected", revision: 2 } } });
    if (path === "/api/mailbox") {
      const view = requestUrl.searchParams.get("view") ?? "all";
      const messages = view === "subscriptions" ? [MAILBOX.messages[1]] : view === "needs_attention" ? [MAILBOX.messages[0]] : MAILBOX.messages;
      const response = { ...MAILBOX, selectedView: view, messages, pagination: { ...MAILBOX.pagination, total: messages.length } };
      if (!syncing) return route.fulfill({ json: response });
      syncing = false;
      return route.fulfill({ json: { ...response, sync: { status: "succeeded", invocationId: "inv_sync", lastCompletedAt: "2026-08-13T03:00:00.000Z", lastSucceededAt: "2026-08-13T03:00:00.000Z" } } });
    }
    return route.fulfill({ json: {} });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({ version: 1, state: { section: "mail", locale: "zh-CN" } }));
  });
}

async function openClassificationSettings(page: Page, mobile: boolean) {
  if (mobile) {
    await page.getByRole("button", { name: "智能分类", exact: true }).click();
    await page.getByRole("dialog", { name: "智能分类" }).getByRole("button", { name: /智能分类设置/ }).click();
  } else {
    await page.getByRole("button", { name: "智能分类设置" }).click();
  }
  return page.getByRole("dialog", { name: "智能分类与邮箱目录" });
}

async function expectNoCriticalAccessibilityViolations(page: Page) {
  const violations = await page.evaluate(() => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const named = (element: Element) => {
      const labelledBy = element.getAttribute("aria-labelledby")?.split(/\s+/).filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
      return Boolean(element.getAttribute("aria-label")?.trim() || labelledBy || element.getAttribute("title")?.trim() || element.textContent?.trim());
    };
    const issues: string[] = [];
    const ids = new Map<string, number>();
    for (const element of document.querySelectorAll<HTMLElement>("[id]")) {
      const id = element.id.trim();
      if (id) ids.set(id, (ids.get(id) ?? 0) + 1);
    }
    for (const [id, count] of ids) if (count > 1) issues.push(`#${id}:duplicate-id`);
    for (const element of document.querySelectorAll<HTMLElement>("[aria-labelledby], [aria-describedby]")) {
      for (const attribute of ["aria-labelledby", "aria-describedby"] as const) {
        for (const id of element.getAttribute(attribute)?.split(/\s+/).filter(Boolean) ?? []) {
          if (!document.getElementById(id)) issues.push(`${element.tagName.toLowerCase()}:${attribute}-missing-${id}`);
        }
      }
    }
    for (const element of document.querySelectorAll("button, a[href]")) {
      if (visible(element) && !named(element)) issues.push(`${element.tagName.toLowerCase()}:missing-name`);
    }
    for (const element of document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea")) {
      if (visible(element) && !element.labels?.length && !element.getAttribute("aria-label") && !element.getAttribute("aria-labelledby")) issues.push(`${element.tagName.toLowerCase()}:missing-label`);
    }
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      if (visible(dialog) && (dialog.getAttribute("aria-modal") !== "true" || !named(dialog))) issues.push("dialog:missing-modal-name");
    }
    for (const image of document.querySelectorAll<HTMLImageElement>("img")) {
      if (visible(image) && !image.hasAttribute("alt")) issues.push("img:missing-alt");
    }
    if (!document.documentElement.lang.trim()) issues.push("html:missing-lang");
    return issues;
  });
  expect(violations).toEqual([]);
}

for (const fixture of [
  { name: "desktop", viewport: { width: 1366, height: 768 } },
  { name: "mobile", viewport: { width: 390, height: 844 } },
]) {
  test(`keeps the ${fixture.name} ordinary-user mailbox readable and usable`, async ({ page }, testInfo) => {
    testInfo.setTimeout(60_000);
    await page.setViewportSize(fixture.viewport);
    await mockMail(page);
    await page.goto("/?section=mail");

    await expect(page.getByRole("heading", { name: "我的邮箱" })).toBeAttached();
    await expect(page.getByText("确认交付范围", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "管理邮箱连接" })).toBeVisible();
    await expect(page.getByText(/还有 \d+ 项功能可启用/)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "智能分类" })).toBeVisible();
    if (fixture.name === "mobile") {
      await page.getByRole("button", { name: "智能分类", exact: true }).click();
      await page.getByRole("dialog", { name: "智能分类" }).getByRole("button", { name: /^智能分类 使用邮件头/ }).click();
    } else {
      await page.getByRole("button", { name: "智能分类", exact: true }).click();
    }
    await expect(page.getByText("智能分类已完成。你可以通过智能分类视图快速查看。")).toBeVisible();
    if (fixture.name === "mobile") {
      await page.getByRole("button", { name: "智能分类", exact: true }).click();
      await page.getByRole("dialog", { name: "智能分类" }).getByRole("button", { name: /深度整理/ }).click();
    } else {
      await page.getByRole("button", { name: "深度整理" }).click();
    }
    const deepDialog = page.getByRole("dialog", { name: "深度整理最近邮件" });
    await expect(deepDialog.getByText(/将处理 1 封已打开且正文已缓存/)).toBeVisible();
    await expect(deepDialog.getByText(/正文只发送到本机模型/)).toBeVisible();
    await deepDialog.getByRole("button", { name: "确认并开始" }).click();
    await expect(deepDialog.getByText(/深度整理完成/)).toBeVisible();
    await deepDialog.getByText("关闭", { exact: true }).click();
    if (fixture.name === "mobile") {
      await page.getByRole("button", { name: "智能分类", exact: true }).click();
      await page.getByRole("dialog", { name: "智能分类" }).getByRole("button", { name: /智能分类设置/ }).click();
    } else {
      await page.getByRole("button", { name: "智能分类设置" }).click();
    }
    const rulesDialog = page.getByRole("dialog", { name: "智能分类与邮箱目录" });
    await expect(rulesDialog.getByText("正在积累本地样本")).toBeVisible();
    await expect(rulesDialog.getByText("只在本机汇总数量，不包含邮件主题、发件人或正文。")).toBeVisible();
    await expect(rulesDialog.getByText("发件人 news@example.com")).toBeVisible();
    await expect(rulesDialog.getByText(/当前将影响 1 封邮件/)).toBeVisible();
    await rulesDialog.getByRole("button", { name: "启用规则" }).click();
    await expect(rulesDialog.getByRole("paragraph").filter({ hasText: "建议新目录：订阅与推广" })).toBeVisible();
    await rulesDialog.getByRole("button", { name: "预览邮件" }).click();
    const folderPreview = page.getByRole("dialog", { name: "邮箱目录预览" });
    await expect(folderPreview.getByText("本次预览 1 封，共匹配 1 封")).toBeVisible();
    await expect(folderPreview.getByText(/当前不会移动任何邮件/)).toBeVisible();
    await folderPreview.getByRole("button", { name: "确认并移动 1 封" }).click();
    await expect(folderPreview.getByText("已将 1 封邮件移入目标目录。")).toBeVisible();
    await expect(folderPreview.getByRole("button", { name: "收取新邮件" })).toBeVisible();
    await folderPreview.getByText("关闭", { exact: true }).click();
    await rulesDialog.getByText("关闭", { exact: true }).click();
    await page.getByRole("navigation", { name: "智能分类" }).getByRole("button", { name: /订阅与推广/ }).click();
    await expect(page.getByText("本周产品周刊", { exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "智能分类" }).getByRole("button", { name: /全部/ }).click();
    await page.getByRole("button", { name: "收取新邮件" }).click();
    await expect(page.getByText("收取完成，收件箱已更新。")).toBeVisible();
    if (fixture.name === "mobile") await expect(page.getByText("确认交付范围", { exact: true })).toBeInViewport({ ratio: 0.5 });
    await page.screenshot({ path: testInfo.outputPath(`${fixture.name}-mail-list.png`), fullPage: true });
    await page.getByText("确认交付范围", { exact: true }).click();
    await expect(page.getByLabel("确认交付范围").getByText("你好，请确认本周交付范围。详情：https://example.com/delivery")).toBeVisible();
    await expect(page.getByRole("link", { name: "https://example.com/delivery" })).toHaveAttribute("rel", /noopener/);
    await expect(page.getByText(/2026年8月13日/)).toBeVisible();
    await expect(page.getByRole("button", { name: "回复" })).toBeVisible();
    await page.getByText("安全显示 · 已保存在本机").click();
    await expect(page.getByText(/系统只把它当作内容展示/)).toBeVisible();
    await expect(page.getByText(/原始邮件和附件已安全保存在本机/)).toBeVisible();
    await page.getByText("安全显示 · 已保存在本机").click();
    await expect(page.getByText(/分类建议：主题包含明确的确认、提交或处理要求/)).toBeVisible();
    await expect(page.getByText(/本机可用/)).toBeVisible();
    await page.getByRole("button", { name: "查看安全排版" }).click();
    const safeFrame = page.getByTitle("安全邮件内容");
    await expect(safeFrame).toBeVisible();
    await expect(safeFrame).not.toHaveAttribute("srcdoc", /<script/);
    await expect(safeFrame).not.toHaveAttribute("srcdoc", /images\.example\.com\/tracker/);
    await page.getByRole("button", { name: "加载远程图片" }).click();
    await expect(safeFrame).toHaveAttribute("srcdoc", /images\.example\.com\/tracker/);
    await page.getByRole("button", { name: "返回纯文本" }).click();

    await page.getByRole("button", { name: "转为任务" }).click();
    const taskDialog = page.getByRole("dialog", { name: "确认任务内容" });
    await expect(taskDialog.getByLabel("所属项目")).toHaveValue("project_1");
    await expect(taskDialog.getByLabel(/范围说明\.txt/)).not.toBeChecked();
    await taskDialog.getByText("关闭", { exact: true }).click();

    await page.getByRole("button", { name: "写邮件" }).click();
    const dialog = page.getByRole("dialog", { name: "写邮件" });
    await expect(dialog.getByLabel("收件人")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "检查并发送" })).toBeEnabled();
    await dialog.getByRole("button", { name: "关闭" }).click();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expectNoCriticalAccessibilityViolations(page);
    await page.screenshot({ path: testInfo.outputPath(`${fixture.name}-mailbox.png`), fullPage: true });
  });

  test(`corrects smart classification with keyboard-safe controls on ${fixture.name}`, async ({ page }) => {
    await page.setViewportSize(fixture.viewport);
    await mockMail(page);
    await page.goto("/?section=mail");
    await page.getByText("确认交付范围", { exact: true }).click();
    const correctionTrigger = page.getByRole("button", { name: "分类不对" });
    await correctionTrigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "调整邮件分类" });
    await expect(dialog).toBeVisible();
    const classificationSelect = dialog.getByLabel("放到");
    await classificationSelect.focus();
    await page.keyboard.press("End");
    const request = page.waitForRequest((value) => value.url().endsWith("/classification") && value.method() === "PATCH");
    const save = dialog.getByRole("button", { name: "保存调整" });
    await save.focus();
    await page.keyboard.press("Enter");
    expect((await request).postDataJSON()).toMatchObject({ attention: "routine", mailType: "other", suggestedAction: "none" });
    await expect(dialog).toBeHidden();
    await expectNoCriticalAccessibilityViolations(page);
  });

  test(`enables bounded automatic organization explicitly on ${fixture.name}`, async ({ page }) => {
    await page.setViewportSize(fixture.viewport);
    await mockMail(page, { qualityHealthy: true });
    await page.goto("/?section=mail");
    const rules = await openClassificationSettings(page, fixture.name === "mobile");
    const enableRule = rules.getByRole("button", { name: "启用规则" });
    await enableRule.focus();
    await page.keyboard.press("Enter");
    const enable = rules.getByRole("button", { name: "启用自动整理" });
    await expect(enable).toBeEnabled();
    await enable.focus();
    await page.keyboard.press("Enter");
    const confirmation = page.getByRole("dialog", { name: "确认自动整理" });
    await expect(confirmation.getByText(/匹配邮件不再逐批询问/)).toBeVisible();
    await expect(confirmation.getByText(/结果不确定时规则会立即暂停/)).toBeVisible();
    const confirm = confirmation.getByRole("button", { name: "确认并启用" });
    await confirm.focus();
    await page.keyboard.press("Enter");
    await expect(rules.getByText("自动整理已启用", { exact: false }).first()).toBeVisible();
    await expectNoCriticalAccessibilityViolations(page);
  });

  test(`recovers an unconfirmed move without automatic replay on ${fixture.name}`, async ({ page }) => {
    await page.setViewportSize(fixture.viewport);
    await mockMail(page, { recovery: true });
    await page.goto("/?section=mail");
    await expect(page.getByText("有一批邮箱目录结果需要核对")).toBeVisible();
    const review = page.getByRole("button", { name: "查看状态" });
    await review.focus();
    await page.keyboard.press("Enter");
    const recovery = page.getByRole("dialog", { name: "有一批邮箱目录结果需要核对" });
    await expect(recovery.getByText(/系统不会自动重试/).first()).toBeVisible();
    const reconcile = recovery.getByRole("button", { name: "核对同步结果" });
    await reconcile.focus();
    await page.keyboard.press("Enter");
    const preview = page.getByRole("dialog", { name: "邮箱目录预览" });
    await expect(preview.getByText(/当前不会移动任何邮件/)).toBeVisible();
    await expect(preview.getByRole("button", { name: "确认并移动 1 封" })).toBeVisible();
    await expectNoCriticalAccessibilityViolations(page);
  });
}

for (const fixture of [
  { name: "desktop", viewport: { width: 1366, height: 768 } },
  { name: "mobile", viewport: { width: 390, height: 844 } },
]) {
  test(`connects 163 Mail through the ordinary-user assistant on ${fixture.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(fixture.viewport);
    await mockMail(page);
    await page.addInitScript(() => {
      (window as any).myagenttoolDesktop = {
        getMailConnectorStatus: async () => ({ desktop: true, providers: [
          { id: "netease_163", name: "163 邮箱", available: true, connected: false, account: null },
          { id: "gmail", name: "Gmail", available: false, connected: false, account: null },
        ] }),
        connect163Mail: async ({ email }: { email: string }) => ({ ok: true, account: { provider: "netease", email, canReceive: true, canSend: true, canOrganize: true } }),
      };
    });
    await page.goto("/?section=mail");
    const trigger = page.getByRole("button", { name: "管理邮箱连接" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    let dialog = page.getByRole("dialog", { name: "连接邮箱" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    dialog = page.getByRole("dialog", { name: "连接邮箱" });
    await expect(dialog.getByText("Gmail")).toBeVisible();
    await expect(dialog.getByText("即将支持")).toBeVisible();
    await dialog.getByLabel("163 邮箱地址").fill("user@163.com");
    await dialog.getByLabel("客户端授权码").fill("local-only-code");
    await dialog.getByRole("button", { name: "连接并测试邮箱" }).click();
    await expect(dialog.getByText("邮箱连接成功")).toBeVisible();
    await expect(dialog.getByText("收件已连接")).toBeVisible();
    await expect(dialog.getByText("目录整理已连接")).toBeVisible();
    await expect(dialog.getByText("发件已连接")).toBeVisible();
    await expect(dialog.getByLabel("客户端授权码")).toHaveCount(0);
    await expectNoCriticalAccessibilityViolations(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`${fixture.name}-mail-connection-success.png`), fullPage: true });
  });
}
