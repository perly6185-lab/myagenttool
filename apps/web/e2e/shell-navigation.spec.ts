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
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
});

test("offers short mobile Entry plus explicit Settings and Trace shortcuts", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const selector = page.getByLabel("Section", { exact: true });
  await expect(selector.locator("option")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Open Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Trace" })).toBeVisible();

  await page.getByRole("button", { name: "Open Trace" }).click();
  await expect(page).toHaveURL(/section=invocations/);
  await page.getByRole("button", { name: "Return to Home" }).click();
  await expect(page).toHaveURL(/section=dashboard/);
});
