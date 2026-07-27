import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "playwright/test";

const prototypeUrl = pathToFileURL(
  resolve(process.cwd(), "docs/design/prototypes/china-identity-entry.html"),
).href;

const states = [
  ["入口", "entry", "选择本地使用或团队登录"],
  ["等待确认", "waiting_confirmation", "请在手机上核对并确认"],
  ["选择团队", "tenant_selection", "确认要进入的团队"],
  ["已过期", "expired", "登录码已过期"],
  ["已拒绝", "rejected", "登录未获确认"],
  ["找回账号", "recovery", "使用账号密码或申请恢复"],
  ["已登录", "signed_in", "查看当前团队和登录设备"],
  ["退出", "logout", "确认退出范围"],
] as const;

test("prototypes every zh-CN identity state without a fake QR or secret", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(prototypeUrl);

  await expect(page.getByRole("heading", { name: "选择使用方式" })).toBeVisible();
  await expect(page.getByRole("button", { name: "在这台电脑上使用" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "在这台电脑上使用" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "登录团队" })).toBeVisible();
  expect(await page.locator("img, svg, canvas").count()).toBe(0);
  await expect(page.locator("body")).not.toContainText(/client_secret|access_token|refresh_token|authorization_code/i);
  await page.screenshot({ path: testInfo.outputPath("desktop-zh-entry.png"), fullPage: true });

  for (const [tab, state, heading] of states) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await expect(page.locator(".stage")).toHaveAttribute("data-current-state", state);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("keeps expiry recovery and logout usable on a narrow mobile screen", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(prototypeUrl);

  for (const state of ["已过期", "已拒绝", "找回账号", "退出"]) {
    await page.getByRole("button", { name: state, exact: true }).click();
    const primary = page.locator("[data-state-body] button").first();
    await expect(primary).toBeVisible();
    const box = await primary.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  await page.screenshot({ path: testInfo.outputPath("mobile-zh-logout.png"), fullPage: true });
});
