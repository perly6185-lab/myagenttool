import { expect, test, type Page } from "playwright/test";

async function mockShellApi(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({
    json: route.request().url().endsWith("/api/state")
      ? {
          projects: [],
          worktrees: [],
          projectTargets: [],
          pendingDecisions: [],
          evidenceLedger: [],
          invocations: [],
          workBoard: {
            generatedAt: 1,
            states: {
              pending_decision: { count: 2, items: [] },
              follow_up: { count: 1, items: [] },
              in_progress: { count: 1, items: [] },
              waiting: { count: 1, items: [] },
              done: { count: 0, items: [] },
              failed: { count: 0, items: [] },
            },
          },
        }
      : {},
  }));
}

test.beforeEach(async ({ page }) => {
  await mockShellApi(page);
  await page.goto("/?section=dashboard");
});

test("keeps ordinary desktop Entry concise and returns from Settings and Trace", async ({ page }) => {
  const navigation = page.getByRole("navigation", { name: "Control plane sections" });
  for (const destination of ["Home", "Tasks", "Projects", "Queue", "Needs attention"]) {
    await expect(navigation.getByRole("button", { name: destination, exact: true })).toBeVisible();
  }
  await expect(navigation.getByText("Documents", { exact: true })).toBeHidden();

  await navigation.getByRole("button", { name: "Settings", exact: true }).click();
  await navigation.getByRole("button", { name: "Applications", exact: true }).click();
  await page.getByRole("button", { name: "Return to Home" }).click();
  await expect(page).toHaveURL(/section=dashboard/);

  await navigation.getByRole("button", { name: "Trace", exact: true }).click();
  await navigation.getByRole("button", { name: "Invocations", exact: true }).click();
  await page.getByRole("button", { name: "Return to Home" }).click();
  await expect(page).toHaveURL(/section=dashboard/);
});

test("supports keyboard navigation and direct legacy section bookmarks", async ({ page }) => {
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog");
  await palette.getByRole("combobox").fill("Applications");
  await expect(palette.getByRole("option", { name: /Applications/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/section=applications/);
  await expect(page.getByRole("button", { name: "Return to Home" })).toBeVisible();

  await page.goto("/?section=documents");
  await expect(page).toHaveURL(/section=documents/);
  await expect(page.getByRole("heading", { name: "Assets" })).toBeVisible();
});

test("offers five mobile destinations, separate To-do counts, and contextual Settings/Trace return", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  for (const destination of ["Home", "Tasks", "Projects", "Me"]) {
    await expect(navigation.getByRole("button", { name: destination, exact: true })).toBeVisible();
  }
  await expect(navigation.getByRole("button", { name: "To-do: 2 queued or running, 3 need attention" })).toBeVisible();

  await navigation.getByRole("button", { name: /^To-do:/ }).click();
  await expect(page).toHaveURL(/section=workBoard/);
  await expect(page.getByRole("button", { name: /2\s*Queued \/ running/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /3\s*Needs attention/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-todo-running-pending.png"), fullPage: true });

  await navigation.getByRole("button", { name: "Me", exact: true }).click();
  await expect(page).toHaveURL(/section=me/);
  await expect(page.getByText("Your account, active team, device session, and preferences.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-me.png"), fullPage: true });
  await page.getByRole("button", { name: /Settings/ }).click();
  await expect(page).toHaveURL(/section=settings/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/section=me/);

  await page.getByRole("button", { name: /Trace/ }).click();
  await expect(page).toHaveURL(/section=invocations/);
  await page.getByRole("button", { name: "Return to Me" }).click();
  await expect(page).toHaveURL(/section=me/);
});

for (const width of [320, 390, 430]) {
  test(`keeps Chinese mobile navigation visible without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("myagenttool-ui", JSON.stringify({
        state: { locale: "zh-CN", section: "dashboard" },
        version: 1,
      }));
    });
    await page.reload();
    const navigation = page.getByRole("navigation", { name: "主导航" });
    for (const destination of ["首页", "任务", "项目", "我的"]) {
      await expect(navigation.getByRole("button", { name: destination, exact: true })).toBeVisible();
    }
    await expect(navigation.getByRole("button", { name: /^待办：/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (width === 320) {
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
  });
}

test("keeps the mobile destination model available when work is empty or the server is offline", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.unroute("**/api/**");
  await page.route("**/api/**", (route) => route.fulfill({
    json: route.request().url().endsWith("/api/state")
      ? { projects: [], invocations: [], pendingDecisions: [], evidenceLedger: [] }
      : {},
  }));
  await page.reload();
  await page.getByRole("button", { name: "To-do: 0 queued or running, 0 need attention" }).click();
  await expect(page.getByText("Nothing tracked yet")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-empty.png"), fullPage: true });

  await page.unroute("**/api/**");
  await page.route("**/api/**", (route) => route.abort("failed"));
  await page.reload();
  await page.getByRole("button", { name: /Notifications: 1 require action/ }).click();
  await expect(page.getByRole("button", { name: /Execution disconnected/ })).toBeVisible();
  await expect(page.getByText("Offline", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-offline.png"), fullPage: true });
});
