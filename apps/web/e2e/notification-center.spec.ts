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

const staleWorkItems = [
  {
    id: "lwi-stale-1", localRef: "LOCAL-21", projectId: "project-1", title: "Customer brief",
    body: "Confirm the latest customer profile.", type: "task", status: "ready", priority: "p1",
    state: "open", labels: [], assigneeIds: [], requesterRelation: "customer", requesterName: "Example customer",
    requesterOrganization: null, requesterUserId: null, intakeChannel: "manual", externalReference: null,
    waitingOn: "me", commitmentDate: null, nextFollowUpAt: null, lastProgressAt: null, lastProgressSummary: null,
    acceptanceCriteria: [], dueDate: null, plannedDate: null, milestone: "", estimatePoints: 0,
    revision: 7, archivedAt: null, updatedAt: "2026-08-26T01:00:00.000Z",
    executionState: "blocked", executionBindings: [], recordBindings: [],
  },
  {
    id: "lwi-stale-2", localRef: "LOCAL-22", projectId: "project-1", title: "Order summary",
    body: "Confirm the latest order totals.", type: "task", status: "ready", priority: "p1",
    state: "open", labels: [], assigneeIds: [], requesterRelation: "customer", requesterName: "Example customer",
    requesterOrganization: null, requesterUserId: null, intakeChannel: "manual", externalReference: null,
    waitingOn: "me", commitmentDate: null, nextFollowUpAt: null, lastProgressAt: null, lastProgressSummary: null,
    acceptanceCriteria: [], dueDate: null, plannedDate: null, milestone: "", estimatePoints: 0,
    revision: 4, archivedAt: null, updatedAt: "2026-08-26T01:01:00.000Z",
    executionState: "blocked", executionBindings: [], recordBindings: [],
  },
];

function staleAttention(items = staleWorkItems) {
  return items.map((item, index) => ({
    id: `record_binding_stale:${item.id}`,
    kind: "record_binding_stale",
    severity: "high",
    workItemId: item.id,
    localRef: item.localRef,
    title: item.title,
    createdAt: "2026-08-26T01:05:00.000Z",
    updatedAt: "2026-08-26T01:05:00.000Z",
    dueAt: "2026-08-26T05:05:00.000Z",
    slaStatus: "within_sla",
    history: [], handling: null, resolution: null,
    details: {
      workItemRevision: item.revision,
      bindingIds: [`binding-${index + 1}`],
      bindingCount: 1,
      states: ["stale"],
      executionBlocked: true,
      postingBlocked: true,
      refreshable: true,
    },
  }));
}

function withStaleRecordBinding<T extends (typeof staleWorkItems)[number]>(item: T, index: number) {
  return {
    ...item,
    recordBindings: [{
      id: `binding-${index + 1}`, slotKey: "customer", direction: "input", role: "required",
      ledgerDefinitionId: "ledger-customers",
      record: {
        ledgerDefinitionId: "ledger-customers", recordId: `record-${index + 1}`, recordType: "customer",
        businessKey: item.localRef, title: item.title, revision: 2, fingerprint: `old-${index + 1}`,
        observedAt: "2026-08-25T01:00:00.000Z",
      },
      selection: { fieldKeys: ["name", "status"], queryId: null, rowLimit: 1 },
      snapshot: {
        revision: 1, fingerprint: `old-${index + 1}`, capturedAt: "2026-08-25T01:00:00.000Z", evidenceRefs: [],
      },
      resolution: { source: "explicit_user", confidence: 1, state: "stale", reasons: ["business_record_changed"] },
    }],
  };
}

async function routeStaleRecordFlow(page: Page, options: { count?: number; failFirstRefresh?: boolean } = {}) {
  let workItems = staleWorkItems.slice(0, options.count ?? 2).map(withStaleRecordBinding);
  let attention = staleAttention(workItems);
  let refreshAttempts = 0;
  const batchBodies: unknown[] = [];
  await page.route("http://127.0.0.1:5001/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/state") return route.fulfill({ json: {
      projects: [{ id: "project-1", name: "Example project" }], currentProjectId: "project-1",
      projectTargets: [], worktrees: [], agents: [], events: [], pendingDecisions: [], evidenceLedger: [], invocations: [],
      device: { id: "device-1", name: "Local computer", status: "online" }, workBoard: board(),
    } });
    if (path === "/api/work-items/attention") return route.fulfill({ json: {
      items: attention,
      metrics: { backlog: attention.length, breached: 0, claimed: 0, pendingApprovals: 0, staleRecords: attention.length, oldestAgeSeconds: 0 },
      nextCursor: null,
    } });
    if (path === "/api/work-items" && request.method() === "GET") {
      return route.fulfill({ json: { workItems, count: workItems.length, hasMore: false, nextCursor: null } });
    }
    if (path === "/api/work-items/record-bindings/refresh" && request.method() === "POST") {
      refreshAttempts += 1;
      batchBodies.push(request.postDataJSON());
      if (options.failFirstRefresh && refreshAttempts === 1) {
        return route.fulfill({ status: 409, json: {
          error: "work_item_revision_conflict",
          message: "Materials changed again before refresh. Reload and try again.",
        } });
      }
      const refreshedCount = attention.length;
      attention = [];
      return route.fulfill({ json: { refreshedCount, workItems } });
    }
    const singleRefreshIndex = workItems.findIndex((item) =>
      path === `/api/work-items/${item.id}/record-bindings/${item.recordBindings[0].id}/refresh`);
    if (singleRefreshIndex >= 0 && request.method() === "POST") {
      refreshAttempts += 1;
      if (options.failFirstRefresh && refreshAttempts === 1) {
        return route.fulfill({ status: 409, json: {
          error: "work_item_revision_conflict",
          message: "Materials changed again before refresh. Reload and try again.",
        } });
      }
      const current = workItems[singleRefreshIndex];
      const refreshed = {
        ...current,
        revision: current.revision + 1,
        recordBindings: current.recordBindings.map((binding) => ({
          ...binding,
          resolution: { ...binding.resolution, state: "resolved", reasons: ["business_record_refreshed_and_confirmed"] },
        })),
      };
      workItems = workItems.map((item, index) => index === singleRefreshIndex ? refreshed : item);
      attention = attention.filter((item) => item.workItemId !== current.id);
      return route.fulfill({ json: { workItem: refreshed } });
    }
    const detail = workItems.find((item) => path === `/api/work-items/${item.id}`);
    if (detail && request.method() === "GET") return route.fulfill({ json: { workItem: detail, observability: null } });
    if (workItems.some((item) => path === `/api/work-items/${item.id}/comments`)) return route.fulfill({ json: { comments: [] } });
    if (path === "/api/work-items/external-funnel") return route.fulfill({ json: {
      metrics: { total: 0, notStarted: 0, running: 0, review: 0, completed: 0, stalled: 0 }, stalls: [],
    } });
    if (path === "/api/planning-projects") return route.fulfill({ json: { projects: [] } });
    if (path === "/api/work-items/my-template-learning") return route.fulfill({ json: { tasks: [] } });
    if (/^\/api\/projects\/[^/]+\/auto-run-readiness$/.test(path)) {
      return route.fulfill({ json: { readiness: { ready: false, checks: [] } } });
    }
    return route.fulfill({ json: {} });
  });
  return { batchBodies, getRefreshAttempts: () => refreshAttempts };
}

async function routeState(page: Page, read: () => State) {
  await page.route("http://127.0.0.1:5001/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/state") return route.fulfill({ json: {
          projects: [],
          projectTargets: [],
          worktrees: [],
          agents: [],
          events: [],
          pendingDecisions: [],
          evidenceLedger: [],
          invocations: [],
          ...read(),
        } });
    if (path === "/api/local-schedule/preview") return route.fulfill({ json: { planRevision: "e2e", days: [], attention: [], unscheduled: [] } });
    if (path === "/api/local-schedule/rollover-preview") return route.fulfill({ json: { rolloverRevision: "e2e", moves: [], confirmationRequired: [], unscheduled: [] } });
    if (path === "/api/local-schedule/urgent-preview") return route.fulfill({ json: { urgentRevision: "e2e", insertions: [], displacements: [], confirmationRequired: [] } });
    if (path === "/api/local-schedule/capacity") return route.fulfill({ json: { terminal: { bridgeAvailable: true }, capacity: { maxConcurrency: 1, availableSlots: 1, queueDepth: 0, worktreeLocks: 0 } } });
    return route.fulfill({ json: {} });
  });
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

test("refreshes stale business materials in a batch and clears their notifications", async ({ page }) => {
  const flow = await routeStaleRecordFlow(page);
  await page.goto("/?section=dashboard");

  const trigger = page.getByRole("button", { name: "Notifications: 2 require action, 0 unread" });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const center = page.getByRole("dialog", { name: "Notifications" });
  await expect(center.getByRole("button", { name: "Customer brief", exact: true })).toBeVisible();
  await center.getByRole("button", { name: "Customer brief", exact: true }).click();

  await expect(page).toHaveURL(/section=task.*task=lwi-stale-1/);
  await expect(page.getByRole("dialog", { name: "Local issue details" })).toContainText("Customer brief");
  await page.keyboard.press("Escape");

  const attentionSection = page.getByRole("region", { name: "Stale business material batch actions" });
  await expect(attentionSection.getByText("2 task(s) have changed materials. Refresh them before continuing.", { exact: true })).toBeVisible();
  await attentionSection.getByRole("button", { name: "Refresh and confirm all", exact: true }).click();

  await expect(page.getByText("Refreshed and confirmed business materials for 2 task(s).", { exact: true })).toBeVisible();
  expect(flow.batchBodies).toEqual([{ items: [
    { id: "lwi-stale-1", expectedRevision: 7, bindingIds: ["binding-1"] },
    { id: "lwi-stale-2", expectedRevision: 4, bindingIds: ["binding-2"] },
  ] }]);
  await expect(page.getByRole("button", { name: "Notifications: 0 require action, 0 unread" })).toBeVisible();
  await expect(attentionSection).toBeHidden();
});

test("keeps stale material attention recoverable after a refresh conflict on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const flow = await routeStaleRecordFlow(page, { count: 1, failFirstRefresh: true });
  await page.addInitScript(() => {
    localStorage.setItem("myagenttool-ui", JSON.stringify({ state: { locale: "zh-CN", section: "dashboard" }, version: 1 }));
  });
  await page.goto("/?section=dashboard");
  await page.getByRole("button", { name: "通知：1 项需要处理，0 项未读" }).click();
  await page.getByRole("dialog", { name: "通知" }).getByRole("button", { name: "Customer brief", exact: true }).click();
  const taskDetails = page.getByRole("dialog", { name: "任务详情" });
  await expect(taskDetails).toBeVisible();
  await taskDetails.getByRole("button", { name: "刷新并确认", exact: true }).click();
  await expect(taskDetails.getByText("业务资料暂时无法刷新，请稍后重试。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "通知：1 项需要处理，0 项未读" })).toBeVisible();

  await taskDetails.getByRole("button", { name: "刷新并确认", exact: true }).click();
  await expect(taskDetails.getByText("业务资料已刷新并确认，任务将使用当前记录版本。", { exact: true })).toBeVisible();
  expect(flow.getRefreshAttempts()).toBe(2);
  await expect(page.getByRole("button", { name: "通知：0 项需要处理，0 项未读" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
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
