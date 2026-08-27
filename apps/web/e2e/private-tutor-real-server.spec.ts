import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "playwright/test";

let apiBase = "";
let root = "";
let server: Server | null = null;

async function openPrivateTutor(page: Page) {
  await page.goto(`/?section=privateTutor&api=${encodeURIComponent(apiBase)}`);
}

async function assertVisibleControlsHaveNames(page: Page) {
  const unnamed = await page.locator("button:visible, input:visible, select:visible, textarea:visible").evaluateAll((elements) =>
    elements
      .filter((element) => {
        const html = element as HTMLElement;
        const labelledBy = html.getAttribute("aria-labelledby");
        const label = html.getAttribute("aria-label")
          || (labelledBy ? document.getElementById(labelledBy)?.textContent : "")
          || html.closest("label")?.textContent
          || html.textContent
          || (html instanceof HTMLInputElement ? html.placeholder : "");
        return !label?.trim();
      })
      .map((element) => element.outerHTML),
  );
  expect(unnamed, `visible controls without an accessible name: ${unnamed.join("\n")}`).toEqual([]);
}

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "myagenttool-private-tutor-browser-"));
  const { createServerState } = await import("../../server/src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../server/src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../server/src/runtime/http-server.mjs");
  const now = () => new Date().toISOString();
  const { defaultProject, state } = createServerState({ defaultProjectPath: root, now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "private-tutor-e2e",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: root,
    persistenceEnabled: false,
    stateStorePath: join(root, "unused.json"),
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: "private-tutor-e2e",
    protocolVersion: "0.0.0",
    ...httpDependencies,
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("private tutor server address unavailable");
  apiBase = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(resolve));
  if (root) rmSync(root, { recursive: true, force: true });
});

test("a signed-in learner keeps one personal profile and never sees family handoff UI", async ({ page }, testInfo) => {
  const login = await page.context().request.post(`${apiBase}/api/session`, {
    data: { mode: "local" },
  });
  expect(login.ok()).toBe(true);

  await openPrivateTutor(page);
  await expect(page.getByRole("heading", { name: "为我建立一份长期学习档案" })).toBeVisible();
  await expect(page.getByText("选择孩子")).toHaveCount(0);
  await expect(page.getByLabel("家长 PIN")).toHaveCount(0);

  await page.getByLabel("私教怎么称呼你").fill("小禾");
  await page.getByLabel("当前学习阶段").selectOption({ label: "大学课程" });
  await assertVisibleControlsHaveNames(page);
  await page.getByRole("button", { name: "开始我的学习" }).click();

  await expect(page.getByRole("heading", { name: "先选择这次想学什么" })).toBeVisible();
  await expect(page.getByRole("button", { name: "家长入口" })).toHaveCount(0);
  await testInfo.attach("private-tutor-learner-profile", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  const profile = await page.context().request.get(`${apiBase}/api/private-tutor/profile`);
  expect(profile.ok()).toBe(true);
  const profileBody = await profile.json() as { profile: { id: string; displayName: string } | null; migrationRequired: boolean };
  expect(profileBody.profile?.displayName).toBe("小禾");
  expect(profileBody.migrationRequired).toBe(false);

  await page.reload();
  await expect(page.getByRole("heading", { name: "先选择这次想学什么" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "为我建立一份长期学习档案" })).toHaveCount(0);

  const snapshot = await page.context().request.get(`${apiBase}/api/private-tutor/profile/snapshot`);
  expect(snapshot.ok()).toBe(true);
  const snapshotBody = await snapshot.json() as { profile: { id: string }; snapshot: { learnerId: string } };
  expect(snapshotBody.snapshot.learnerId).toBe(profileBody.profile?.id);

  await page.route(`**/api/private-tutor/profile/snapshot`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "injected_snapshot_outage" }),
    });
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "学习空间暂时没有准备好" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("避免显示错误或演示数据");
  await expect(page.getByRole("button", { name: "今日学习" })).toHaveCount(0);
  await page.unroute(`**/api/private-tutor/profile/snapshot`);
  await page.getByRole("button", { name: "重新读取" }).click();
  await expect(page.getByRole("heading", { name: "先选择这次想学什么" })).toBeVisible();

  await page.getByRole("button", { name: /选择课程或导入我的教材/ }).click();
  await expect(page.getByRole("heading", { name: "我的设置" })).toBeVisible();
  await expect(page.getByText("选择学习内容")).toBeVisible();
  await page.getByRole("button", { name: "返回开始方式" }).click();
  await page.getByRole("button", { name: /用当前内容开始摸底/ }).click();
  await expect(page.getByRole("heading", { name: "先让我认识一下你会什么" })).toBeVisible();
});
