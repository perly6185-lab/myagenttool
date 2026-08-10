import { expect, test, type Page } from "playwright/test";

type State = Record<string, unknown>;

const board = ({
  failed = 0,
  done = 0,
  failureId = "failed-1",
  completionId = "done-1",
}: {
  failed?: number;
  done?: number;
  failureId?: string;
  completionId?: string;
} = {}) => ({
  generatedAt: 1,
  states: {
    pending_decision: { count: 0, items: [] },
    follow_up: { count: 0, items: [] },
    in_progress: { count: 0, items: [] },
    waiting: { count: 0, items: [] },
    failed: {
      count: failed,
      items: failed ? [{ id: failureId, title: "Sensitive failure title", section: "autoRuns" }] : [],
    },
    done: {
      count: done,
      items: done ? [{ id: completionId, title: "Sensitive completed task", section: "autoRuns" }] : [],
    },
  },
});

async function routeState(page: Page, read: () => State) {
  await page.route("**/api/**", (route) => route.fulfill({
    json: route.request().url().endsWith("/api/state")
      ? {
          projects: [],
          projectTargets: [],
          worktrees: [],
          agents: [],
          events: [],
          pendingDecisions: [],
          evidenceLedger: [],
          invocations: [],
          ...read(),
        }
      : {},
  }));
}

test("keeps the ordinary desktop header quiet and centralizes actionable work", async ({ page }, testInfo) => {
  const state = {
    projects: [{ id: "project-1", name: "Current project" }],
    currentProjectId: "project-1",
    device: { id: "device-1", name: "Private workstation", status: "offline" },
    pendingDecisions: [{ id: "approval-1", title: "Sensitive approval", section: "approvals" }],
    evidenceLedger: [],
    invocations: [],
    workBoard: board({ failed: 2, done: 1 }),
  };
  await routeState(page, () => state);
  await page.addInitScript(() => {
    localStorage.setItem("myagenttool-notification-completions-seen-v1", JSON.stringify([]));
  });
  await page.goto("/?section=dashboard");
  await expect(page.getByRole("textbox", { name: "Task" })).toBeVisible();

  const header = page.getByRole("banner");
  await expect.poll(() => header.evaluate((element) => getComputedStyle(element).zIndex)).toBe("40");
  await expect(header.getByLabel("Current project")).toBeVisible();
  const trigger = header.getByRole("button", { name: "Notifications: 4 require action, 1 unread" });
  await expect(trigger).toBeVisible();
  await expect(header.getByText("Live", { exact: true })).toHaveCount(0);
  await expect(header.getByText("Polling fallback", { exact: true })).toHaveCount(0);
  await expect(header.getByText("Private workstation", { exact: false })).toHaveCount(0);
  await expect(header.getByLabel("Language")).toHaveCount(0);
  await expect(header.getByLabel("Skin")).toHaveCount(0);

  await trigger.click();
  const center = page.getByRole("dialog", { name: "Notifications" });
  await expect(center).toHaveAttribute("aria-modal", "true");
  await expect(center.getByRole("button", { name: "Close notifications" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await center.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await expect(center.getByText("4 require action")).toBeVisible();
  await expect(center.getByText("1 unread result")).toBeVisible();
  await expect(center.getByRole("button", { name: /Approvals/ })).toBeVisible();
  await expect(center.getByRole("button", { name: /Failed runs/ })).toBeVisible();
  await expect(center.getByRole("button", { name: /Execution disconnected/ })).toBeVisible();
  await expect(center.getByRole("button", { name: /New results/ })).toBeVisible();
  await expect(center.getByText("Status center")).toBeVisible();
  await expect(center.getByText("Periodic refresh", { exact: true })).toBeVisible();
  await expect(center.getByText(/counts only—never task text/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-notification-center.png") });

  await page.keyboard.press("Escape");
  await expect(center).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await center.getByRole("button", { name: /Approvals/ }).click();
  await expect(page).toHaveURL(/section=approvals/);
  await page.goBack();
  await expect(page).toHaveURL(/section=dashboard/);
});

test("does not invent completion unread items after refresh", async ({ page }) => {
  const state = {
    device: { id: "device-1", name: "Workstation", status: "online" },
    pendingDecisions: [],
    evidenceLedger: [],
    invocations: [],
    workBoard: board({ done: 1, completionId: "done-current" }),
  };
  await routeState(page, () => state);
  await page.addInitScript(() => {
    localStorage.setItem(
      "myagenttool-notification-completions-seen-v1",
      JSON.stringify(["done-current"]),
    );
  });
  await page.goto("/?section=dashboard");
  await expect(page.getByRole("button", { name: "Notifications: 0 require action, 0 unread" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Notifications: 0 require action, 0 unread" })).toBeVisible();

  await page.getByRole("button", { name: "Notifications: 0 require action, 0 unread" }).click();
  await expect(page.getByRole("dialog", { name: "Notifications" }).getByText("Periodic refresh", { exact: true }).first()).toBeVisible();
});

test("opens the exact failed task from its notification title", async ({ page }) => {
  await routeState(page, () => ({
    device: { id: "device-1", name: "Workstation", status: "online" },
    pendingDecisions: [],
    evidenceLedger: [],
    invocations: [],
    workBoard: board({ failed: 1, failureId: "failed-direct" }),
  }));
  await page.goto("/?section=dashboard");

  await page.getByRole("button", { name: /Notifications:/ }).click();
  await page.getByRole("dialog", { name: "Notifications" })
    .getByRole("button", { name: "Sensitive failure title", exact: true })
    .click();

  await expect(page).toHaveURL(/section=task/);
  await expect(page).toHaveURL(/task=failed-direct/);
});

test("browser delivery is explicit, disableable, and privacy-safe", async ({ page }) => {
  let currentState: State = {
    device: { id: "device-1", name: "Workstation", status: "online" },
    pendingDecisions: [],
    evidenceLedger: [],
    invocations: [],
    workBoard: board(),
  };
  await routeState(page, () => currentState);
  await page.addInitScript(() => {
    const delivered: Array<{ title: string; body: string }> = [];
    Object.defineProperty(window, "__deliveredNotifications", { value: delivered, configurable: true });
    class FakeNotification {
      static permission = "granted";
      static requestPermission = async () => "granted";
      onclick: (() => void) | null = null;
      constructor(title: string, options?: NotificationOptions) {
        delivered.push({ title, body: options?.body ?? "" });
      }
      close() {}
    }
    Object.defineProperty(window, "Notification", { value: FakeNotification, configurable: true });
  });
  await page.goto("/?section=dashboard");
  await page.getByRole("button", { name: /Notifications:/ }).click();
  await page.getByRole("button", { name: "Enable", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("myagenttool-browser-notifications-v1"))).toBe("true");
  expect(await page.evaluate(() => (window as unknown as { __deliveredNotifications: unknown[] }).__deliveredNotifications.length)).toBe(0);

  currentState = {
    ...currentState,
    workBoard: board({ done: 1, completionId: "done-private" }),
  };
  await page.reload();
  await expect(page.getByRole("button", { name: /1 unread/ })).toBeVisible();
  const delivered = await page.evaluate(
    () => (window as unknown as { __deliveredNotifications: Array<{ title: string; body: string }> }).__deliveredNotifications,
  );
  expect(delivered).toHaveLength(1);
  expect(delivered[0].body).toContain("1 new status");
  expect(delivered[0].body).not.toContain("Sensitive completed task");
  expect(delivered[0].body).not.toContain("done-private");

  await page.getByRole("button", { name: /Notifications:/ }).click();
  await page.getByRole("button", { name: "Disable", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("myagenttool-browser-notifications-v1"))).toBe("false");
});

test("covers the Chinese mobile notification state without exposing header internals", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = {
    device: { id: "device-1", name: "本地电脑", status: "online" },
    pendingDecisions: [{ id: "approval-zh", title: "审批", section: "approvals" }],
    evidenceLedger: [],
    invocations: [],
    workBoard: board({ failed: 1 }),
  };
  await routeState(page, () => state);
  await page.addInitScript(() => {
    localStorage.setItem("myagenttool-ui", JSON.stringify({
      state: { locale: "zh-CN", section: "dashboard" },
      version: 1,
    }));
  });
  await page.goto("/?section=dashboard");
  const header = page.getByRole("banner");
  await expect(header.getByText("实时更新", { exact: true })).toHaveCount(0);
  await expect(header.getByText("定时刷新", { exact: true })).toHaveCount(0);
  await header.getByRole("button", { name: "通知：2 项需要处理，0 项未读" }).click();
  const center = page.getByRole("dialog", { name: "通知" });
  await expect(center.getByRole("button", { name: /待审批/ })).toBeVisible();
  await expect(center.getByRole("button", { name: /运行失败/ })).toBeVisible();
  await expect(center.getByText("状态中心")).toBeVisible();
  await expect(center.getByText("定时刷新", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-zh-notifications.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
