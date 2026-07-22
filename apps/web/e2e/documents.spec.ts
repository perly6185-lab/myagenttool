import { expect, test, type Page } from "playwright/test";

const state = {
  currentProjectId: "prj_1",
  projects: [{ id: "prj_1", name: "E2E Project" }],
  worktrees: [{ id: "wt_1", projectId: "prj_1", branchName: "documents-e2e" }],
  device: { id: "dev_1", name: "Test device", status: "online" },
};

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/state") return route.fulfill({ json: state });
    if (url.pathname.endsWith("/documents")) return route.fulfill({ json: { projectId: "prj_1", worktreeId: url.searchParams.get("worktree"), truncated: false, scanned: 1, documents: [{ projectId: "prj_1", worktreeId: url.searchParams.get("worktree"), name: "report.docx", path: "docs/report.docx", type: "docx", gitStatus: "clean" }] } });
    if (url.pathname.endsWith("/officecli-preview")) return route.fulfill({ json: { path: "docs/report.docx", content: "<h1>Quarterly report</h1>", mime: "text/html", encoding: "utf8", bytes: 25 } });
    if (url.pathname === "/api/approvals/grants") return route.fulfill({ json: { grantId: "grant_1", token: "token_1", expiresAt: "2099-01-01" } });
    if (url.pathname.includes("/capabilities/") && url.pathname.endsWith("/invocations")) return route.fulfill({ json: { capability: "app.app_officecli.apply.create", invocationId: "inv_1", status: "queued" } });
    return route.fulfill({ json: {} });
  });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto("/?section=documents");
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
});

test("discovers and previews a document through the real route", async ({ page }) => {
  await page.getByRole("button", { name: "report.docx" }).click();
  await expect(page.locator('iframe[title="docs/report.docx"]')).toBeVisible();
  await expect(page).toHaveURL(/section=documents.*document=docs%2Freport.docx/);
});

test("creates an Excel document through the governed capability flow", async ({ page }) => {
  const capabilityRequest = page.waitForRequest((request) => request.url().includes("app.app_officecli.apply.create") && request.method() === "POST");
  await page.getByRole("button", { name: "New" }).click();
  const dialog = page.getByRole("dialog", { name: "New Office document" });
  await dialog.getByLabel("Document type").selectOption("xlsx");
  await dialog.getByLabel("Destination in worktree").fill("docs/forecast");
  await dialog.getByRole("button", { name: "Create document" }).click();
  const request = await capabilityRequest;
  expect(await request.postDataJSON()).toMatchObject({ projectId: "prj_1", worktreeId: "wt_1", file: "docs/forecast.xlsx", approvalToken: "token_1" });
  await expect(dialog).toBeHidden();
});
