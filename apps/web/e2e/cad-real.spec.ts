import { expect, test } from "playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?api=http%3A%2F%2F127.0.0.1%3A5011&section=documents");
  await expect(page.getByRole("heading", { name: "Assets" })).toBeVisible();
});

test("browser renders through the production service and pinned ezdxf worker", async ({ page }) => {
  await page.getByRole("button", { name: "deterministic.dxf" }).click();
  await expect(page.getByText(/Version: AC\d+/)).toBeVisible();
  await expect(page.locator('iframe[title="CAD layout Model"]')).toBeVisible();
});

test("classifies corrupt, entity-limit, timeout, and malicious SVG failures", async ({ page }) => {
  for (const [file, code] of [["corrupt.dxf", /corrupt|failed/i], ["over-limit.dxf", /too many entities|limit/i], ["timeout.dxf", /timed out/i], ["malicious.dxf", /safety policy/i]] as const) {
    await page.getByRole("button", { name: file }).click();
    await expect(page.getByText(code).first()).toBeVisible({ timeout: 30_000 });
  }
});

test("switching files aborts the old render and leaves no worker snapshot", async ({ page, request }) => {
  const cancelledBefore = await request.get("http://127.0.0.1:5011/api/e2e/cad-metrics").then((response) => response.json()).then((value) => value.cancelled as number);
  await page.getByRole("button", { name: "over-limit.dxf" }).click();
  await expect.poll(async () => (await request.get("http://127.0.0.1:5011/api/e2e/cad-metrics")).json().then((value) => value.active)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "deterministic.dxf" }).click();
  await expect(page.locator('iframe[title="CAD layout Model"]')).toBeVisible();
  await expect.poll(async () => (await request.get("http://127.0.0.1:5011/api/e2e/cad-metrics")).json()).toMatchObject({ active: 0, cancelled: cancelledBefore + 1, privateTemps: 0 });
});
