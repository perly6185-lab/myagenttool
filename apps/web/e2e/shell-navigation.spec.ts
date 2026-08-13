import { expect, test, type Page } from "playwright/test";

async function mockShellApi(page: Page, role?: "owner" | "admin" | "operator" | "viewer") {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path === "/api/session" && role
      ? { user: { id: `usr_${role}`, name: role, teamId: "team_local", role } }
      : path === "/api/state"
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
        : path === "/api/work-items"
          ? { workItems: [], count: 0, nextCursor: null, hasMore: false }
          : path === "/api/work-items/attention"
            ? { items: [], metrics: null, nextCursor: null }
            : path === "/api/planning-projects"
              ? { projects: [] }
              : path === "/api/auto-runs"
                ? { autoRuns: [] }
                : {};
    return route.fulfill({ json });
  });
}

test.beforeEach(async ({ page }) => {
  await mockShellApi(page);
  await page.goto("/?section=dashboard");
});

test("keeps ordinary desktop navigation concise and nests professional capabilities under Me", async ({ page }) => {
  const navigation = page.getByRole("navigation", { name: "Control plane sections" });
  for (const destination of ["My home", "My email", "My tasks", "My projects", "My settings"]) {
    await expect(navigation.getByRole("button", { name: destination, exact: true })).toBeVisible();
  }
  await expect(navigation.getByRole("button", { name: /^Needs me/ })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Queue", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Needs attention", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "External work", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Trace", exact: true })).toHaveCount(0);
  await expect(navigation.getByText("Documents", { exact: true })).toBeHidden();

  await navigation.getByRole("button", { name: "My tasks", exact: true }).click();
  await page.getByText("More task tools", { exact: true }).click();
  await page.getByRole("button", { name: "Task status", exact: true }).click();
  await expect(page).toHaveURL(/section=workBoard/);
  await expect(page.getByRole("heading", { name: "Task status", exact: true }).last()).toBeVisible();
  await expect(page.getByText("Pending decision", { exact: true })).toBeVisible();
  await navigation.getByRole("button", { name: "My home", exact: true }).click();
  await expect(page).toHaveURL(/section=dashboard/);

  await navigation.getByRole("button", { name: "My settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "My settings" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: /Apps & connections/ }).click();
  await settings.locator("#settings-subnav-connections").getByRole("button", { name: "Applications", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Apps & connections", exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/section=dashboard/);

  await navigation.getByRole("button", { name: "My settings", exact: true }).click();
  await settings.getByRole("button", { name: /Records & diagnostics/ }).click();
  await settings.locator("#settings-subnav-diagnostics").getByRole("button", { name: "Invocations", exact: true }).click();
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/section=dashboard/);
});

test("defaults to a simple task surface and restores professional navigation on demand", async ({ page }) => {
  const navigation = page.getByRole("navigation", { name: "Control plane sections" });
  await navigation.getByRole("button", { name: "My tasks", exact: true }).click();

  await expect(page.getByRole("tablist", { name: "Task sections" })).toHaveCount(0);
  await expect(page.getByText("More task tools", { exact: true })).toBeVisible();
  await page.getByText("More task tools", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Task status", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Planning projects", exact: true })).toHaveCount(0);

  await navigation.getByRole("button", { name: "My settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "My settings" });
  const professionalView = settings.getByRole("switch", { name: "Professional task view" });
  await expect(professionalView).toHaveAttribute("aria-checked", "false");
  await professionalView.click();
  await expect(professionalView).toHaveAttribute("aria-checked", "true");
  await settings.getByRole("button", { name: "Close" }).click();

  await expect(page).toHaveURL(/section=task/);
  await expect(page.getByRole("tablist", { name: "Task sections" })).toBeVisible();
  await expect(page.getByText("More task tools", { exact: true })).toBeVisible();
});

test("restores professional settings context and keeps favorites within My settings", async ({ page }) => {
  await page.goto("/?section=settings");
  const settings = page.getByRole("dialog", { name: "My settings" });
  await page.getByRole("button", { name: /Records & diagnostics/ }).click();
  await page.getByRole("button", { name: "Favorite Invocations" }).click();
  await settings.locator("#settings-subnav-diagnostics").getByRole("button", { name: "Invocations", exact: true }).click();
  await expect(page).toHaveURL(/section=invocations/);

  await page.getByRole("button", { name: "Records & diagnostics", exact: true }).click();
  await page.getByRole("button", { name: "Professional overview" }).click();
  await expect(page.getByLabel("Favorites and recent").getByRole("button", { name: "Invocations", exact: true })).toBeVisible();

  await page.goto("/?section=settings&settingsCategory=diagnostics&settingsQuery=run%20record");
  await expect(page.getByLabel("Search settings", { exact: true })).toHaveValue("run record");
  await expect(settings.locator("section").getByText("Invocations", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Search settings", { exact: true })).toHaveValue("run record");
});

test("supports keyboard navigation and direct legacy section bookmarks", async ({ page }) => {
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog");
  await palette.getByRole("combobox").fill("Applications");
  await expect(palette.getByRole("option", { name: /Applications/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/section=applications/);
  await expect(page.getByRole("dialog", { name: "My settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apps & connections", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/section=dashboard/);

  await page.goto("/?section=documents");
  await expect(page).toHaveURL(/section=documents/);
  await expect(page.getByRole("heading", { name: "Assets" })).toBeVisible();
});

test("offers five mobile destinations and keeps task status as a secondary task tool", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  for (const destination of ["My home", "My email", "My tasks", "My projects", "My settings"]) {
    await expect(navigation.getByRole("button", { name: destination, exact: true })).toBeVisible();
  }
  await expect(navigation.getByRole("button", { name: /^Needs me/ })).toHaveCount(0);

  await navigation.getByRole("button", { name: "My tasks", exact: true }).click();
  await page.getByText("More task tools", { exact: true }).click();
  await page.getByRole("button", { name: "Task status", exact: true }).click();
  await expect(page).toHaveURL(/section=workBoard/);
  await expect(page.getByRole("button", { name: /2\s*Queued \/ running/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /3\s*Needs attention/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-todo-running-pending.png"), fullPage: true });

  await navigation.getByRole("button", { name: "My settings", exact: true }).click();
  await expect(page).toHaveURL(/section=me/);
  const settings = page.getByRole("dialog", { name: "My settings" });
  await expect(settings.getByRole("heading", { name: "Identity and session" })).toBeVisible();
  await expect(settings.getByRole("switch", { name: "Professional task view" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-me.png"), fullPage: true });
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/section=workBoard/);

  await navigation.getByRole("button", { name: "My settings", exact: true }).click();
  await settings.getByLabel("Settings area", { exact: true }).selectOption("diagnostics");
  await settings.getByLabel("Capability", { exact: true }).selectOption("invocations");
  await expect(page).toHaveURL(/section=invocations/);
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/section=workBoard/);
});

test("uses the verified session role to limit professional discovery", async ({ page }) => {
  await page.unroute("**/api/**");
  await mockShellApi(page, "viewer");
  await page.goto("/?section=settings");

  await expect(page.getByRole("status")).toContainText("Viewer access");
  await page.getByRole("button", { name: /Records & diagnostics/ }).click();
  await expect(page.locator("#settings-subnav-diagnostics").getByRole("button", { name: "Invocations", exact: true })).toBeVisible();
  await expect(page.getByText("Agents", { exact: true })).toHaveCount(0);
  await expect(page.getByText("External issue project controls", { exact: true })).toHaveCount(0);

  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog");
  await palette.getByRole("combobox").fill("Agents");
  await expect(palette.getByRole("option")).toHaveCount(0);
  await palette.getByRole("combobox").fill("Invocations");
  await expect(palette.getByRole("option", { name: /Invocations/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/?section=agents");
  await expect(page.getByRole("dialog", { name: "My settings" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Unavailable for this role");
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
    for (const destination of ["我的首页", "我的任务", "我的项目", "我的设置"]) {
      await expect(navigation.getByRole("button", { name: destination, exact: true })).toBeVisible();
    }
    await expect(navigation.getByRole("button", { name: /^待我处理/ })).toHaveCount(0);
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
  await page.goto("/?section=workBoard");
  await expect(page.getByText("No task status yet")).toBeVisible();
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
