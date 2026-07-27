import { expect, test, type Page } from "playwright/test";

const STATE = {
  projects: [],
  worktrees: [],
  projectTargets: [],
  pendingDecisions: [],
  evidenceLedger: [],
  invocations: [],
};

async function mockIdentityApi(page: Page) {
  let signedIn = false;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/state") {
      await route.fulfill({ json: STATE });
      return;
    }
    if (url.pathname === "/api/identity/options") {
      await route.fulfill({ json: { protocolVersion: 1, localMode: true, passwordMode: true, providers: [] } });
      return;
    }
    if (url.pathname === "/api/session" && request.method() === "POST") {
      signedIn = true;
      await route.fulfill({ json: {
        user: { id: "usr_local", name: "本地用户", teamId: "team_local", role: "owner" },
        expiresAt: "2026-07-27T12:00:00.000Z",
      } });
      return;
    }
    if (url.pathname === "/api/session" && request.method() === "GET") {
      await route.fulfill(signedIn ? { json: {
        user: { id: "usr_local", name: "本地用户", teamId: "team_local", role: "owner" },
        session: {
          id: "ids_local",
          mode: "local",
          createdAt: "2026-07-27T00:00:00.000Z",
          lastSeenAt: "2026-07-27T00:01:00.000Z",
          idleExpiresAt: "2026-07-27T00:31:00.000Z",
          absoluteExpiresAt: "2026-07-27T12:00:00.000Z",
          currentDevice: true,
        },
      } } : { status: 401, json: { error: "unauthenticated" } });
      return;
    }
    if ((url.pathname === "/api/session" || url.pathname === "/api/sessions") && request.method() === "DELETE") {
      signedIn = false;
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

test("opens the same explicit identity choices from the desktop top bar", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: { section: "dashboard", locale: "zh-CN" },
    }));
  });
  await mockIdentityApi(page);
  await page.goto("/?section=dashboard");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "选择如何使用 MyAgentTool" })).toBeVisible();
  await expect(page.getByRole("button", { name: /在这台电脑上使用/ })).toBeVisible();
  await expect(page.getByText("登录团队", { exact: true })).toBeVisible();
  expect(await page.locator("[data-identity-stage] img, [data-identity-stage] canvas, [data-qr]").count()).toBe(0);
});

test("uses explicit Chinese local/team entry and manages the current session on mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: { section: "me", locale: "zh-CN" },
    }));
  });
  await mockIdentityApi(page);
  await page.goto("/?section=me");

  await expect(page.getByRole("heading", { name: "选择如何使用 MyAgentTool" })).toBeVisible();
  await expect(page.getByRole("button", { name: /在这台电脑上使用/ })).toBeVisible();
  await expect(page.getByText("登录团队", { exact: true })).toBeVisible();
  await expect(page.getByText("此服务端尚未启用企业登录方式。")).toBeVisible();
  expect(await page.locator("main img, main canvas, main [data-qr]").count()).toBe(0);

  await page.getByRole("button", { name: /在这台电脑上使用/ }).click();
  const account = page.getByRole("main");
  await expect(account.getByText("本地用户")).toBeVisible();
  await expect(account.getByText("team_local")).toBeVisible();
  await expect(account.getByText("这台电脑", { exact: true })).toBeVisible();
  await expect(account.getByText("本地使用", { exact: true })).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath("mobile-zh-identity-session.png"), fullPage: true });

  await page.getByRole("button", { name: "退出所有设备" }).click();
  const confirmations = page.getByRole("button", { name: "退出所有设备" });
  await confirmations.last().click();
  await expect(page.getByRole("heading", { name: "选择如何使用 MyAgentTool" })).toBeVisible();

  const width = await page.evaluate(() => ({
    viewport: window.innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
});
