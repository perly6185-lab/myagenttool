import { expect, test, type Page } from "playwright/test";

const contentId = `lc_${"1".repeat(32)}`;

async function mockLocalLibraryApi(page: Page, writes: Array<{ path: string; body: unknown }>) {
  await page.route("http://127.0.0.1:5001/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() !== "GET") writes.push({ path, body: request.postDataJSON() });
    if (path === "/api/session") return route.fulfill({ json: { user: { id: "usr_owner", name: "Owner", teamId: "team_local", role: "owner" } } });
    if (path === "/api/state") return route.fulfill({ json: {
      projects: [{ id: "project-a", name: "示例项目" }], worktrees: [], projectTargets: [],
      pendingDecisions: [], evidenceLedger: [], invocations: [], events: [],
    } });
    if (path === "/api/local-content/stats") return route.fulfill({ json: { catalog: {
      schemaVersion: 1, total: 1, available: 1, byKind: { article: { count: 1, available: 1 } },
      facets: {
        projects: [{ value: "project-a", count: 1 }], workItems: [],
        sources: [{ value: "article_import", count: 1 }], months: [{ value: "2026-08", count: 1 }],
        availability: [{ value: "available", count: 1 }], indexStatuses: [{ value: "ready", count: 1 }],
        coverage: {},
      },
      lastRebuiltAt: "2026-08-15T08:00:00.000Z", rebuildable: true,
    } } });
    if (path === "/api/local-content") return route.fulfill({ json: {
      results: [{
        id: contentId, kind: "article", title: "本地架构说明", summary: "原件只保存一份，任务只记录引用。",
        projectId: "project-a", workItemId: null, storageMode: "referenced",
        root: { kind: "project", id: "project-a" }, relativePath: "docs/brief.md", stateLocator: null,
        mimeType: "text/markdown", size: 100, source: { type: "article_import", id: "article-1" },
        sourceLabel: "示例项目", matchSnippet: null, occurredAt: null, importedAt: null, modifiedAt: null,
        original: { available: true, reason: null }, indexStatus: "ready", metadata: {}, relations: [],
      }],
      count: 1, query: "", limit: 30, offset: 0, hasMore: false, nextCursor: null,
      retrieval: { mode: "metadata_recent", offline: true },
    } });
    if (path === "/api/work-items" && request.method() === "GET") {
      return route.fulfill({ json: { workItems: [], count: 0, hasMore: false, nextCursor: null } });
    }
    if (path === "/api/work-items" && request.method() === "POST") return route.fulfill({ json: { workItem: {
      id: "created-a", projectId: "project-a", title: "处理：本地架构说明", state: "open", status: "backlog", revision: 1,
    } } });
    if (path === "/api/work-items/created-a/content-references") return route.fulfill({ json: { workItem: {
      id: "created-a", projectId: "project-a", title: "处理：本地架构说明", state: "open", status: "backlog", revision: 2,
    } } });
    if (path === "/api/work-items/attention") return route.fulfill({ json: { items: [], metrics: null, nextCursor: null } });
    if (path === "/api/planning-projects") return route.fulfill({ json: { projects: [] } });
    if (path === "/api/auto-runs") return route.fulfill({ json: { autoRuns: [] } });
    return route.fulfill({ json: {} });
  });
}

test("completes the Chinese mobile no-task flow without horizontal overflow", async ({ page }, testInfo) => {
  const writes: Array<{ path: string; body: unknown }> = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("myagenttool-ui", JSON.stringify({
      state: { locale: "zh-CN", section: "localLibrary" }, version: 1,
    }));
  });
  await mockLocalLibraryApi(page, writes);
  await page.goto("/?section=localLibrary");

  await expect(page.getByRole("heading", { name: "本地资料库" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "关联任务" })).toHaveCount(0);
  await page.getByRole("button", { name: "更多筛选" }).click();
  await expect(page.getByRole("combobox", { name: "关联任务" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.getByRole("button", { name: "添加到任务" }).click();
  const dialog = page.getByRole("dialog", { name: "添加资料引用" });
  await expect(dialog.getByText(/没有可添加资料的未完成任务/)).toBeVisible();
  await dialog.getByRole("combobox", { name: /^使用方式/ }).selectOption("reference");
  await dialog.getByRole("button", { name: "创建任务并添加" }).click();
  await expect(dialog.getByText(/原件位置未改变/)).toBeVisible();

  expect(writes.find((entry) => entry.path === "/api/work-items")?.body).toMatchObject({
    projectId: "project-a", title: "处理：本地架构说明", executionPolicy: "manual",
  });
  expect(writes.find((entry) => entry.path.endsWith("/content-references"))?.body).toMatchObject({
    contentId, purpose: "reference", expectedRevision: 1,
  });
  await page.screenshot({ path: testInfo.outputPath("local-library-mobile-zh.png"), fullPage: true });
});
