import { expect, test, type Page, type Route } from "playwright/test";

const READY_STATE = {
  device: {
    id: "device-1",
    name: "Synthetic computer",
    status: "online",
    platform: "windows",
    architecture: "x64",
  },
  projects: [{ id: "project-1", name: "Example project" }],
  projectTargets: [{ id: "target-1", projectId: "project-1", state: "ready" }],
  worktrees: [],
  agents: [{
    id: "agent-1",
    name: "Local runner",
    status: "enabled",
    health: { status: "healthy" },
    location: { type: "local_device", deviceId: "device-1" },
    adapter: { type: "cli", command: "codex" },
  }],
  events: [],
  invocations: [],
  approvalRequests: [],
  auditSummaries: [],
  troubleshootingReports: [],
  agentUsageSummaries: [],
  pendingDecisions: [],
  evidenceLedger: [],
};

const EMPTY_HOME_WORKBENCH = {
  generatedAt: "2026-08-06T00:00:00.000Z",
  horizon: { today: "2026-08-06", tomorrow: "2026-08-07" },
  summary: {
    total: 0, needsAttention: 0, waitingMe: 0, approvals: 0, aiFailed: 0, dueToday: 0, reviewReady: 0,
    byRelation: { boss: 0, manager: 0, customer: 0, child: 0, colleague: 0, self: 0, unknown: 0 },
    byWaitingOn: { me: 0, requester: 0, internal: 0, ai: 0, none: 0 },
  },
  items: [],
};

const POPULATED_HOME_ITEMS = [
  {
    id: "task-customer",
    localRef: "TASK-101",
    projectId: "project-1",
    title: "回复客户并确认交付范围",
    body: "",
    type: "task",
    status: "ready",
    priority: "p1",
    state: "open",
    labels: [],
    assigneeIds: ["usr_local"],
    requesterRelation: "customer",
    requesterName: "示例客户",
    requesterOrganization: null,
    requesterUserId: null,
    intakeChannel: "manual",
    externalReference: null,
    waitingOn: "me",
    commitmentDate: null,
    nextFollowUpAt: null,
    lastProgressAt: null,
    lastProgressSummary: null,
    acceptanceCriteria: [],
    dueDate: "2026-08-06",
    plannedDate: "2026-08-06",
    milestone: "",
    estimatePoints: 0,
    revision: 1,
    archivedAt: null,
    updatedAt: "2026-08-06T01:00:00.000Z",
  },
  {
    id: "task-ai",
    localRef: "TASK-102",
    projectId: "project-1",
    title: "整理本周反馈摘要",
    body: "",
    type: "task",
    status: "in_progress",
    priority: "p2",
    state: "open",
    labels: [],
    assigneeIds: ["usr_local"],
    requesterRelation: "self",
    requesterName: null,
    requesterOrganization: null,
    requesterUserId: null,
    intakeChannel: "manual",
    externalReference: null,
    waitingOn: "ai",
    commitmentDate: null,
    nextFollowUpAt: null,
    lastProgressAt: null,
    lastProgressSummary: null,
    acceptanceCriteria: [],
    dueDate: "2026-08-06",
    plannedDate: "2026-08-06",
    milestone: "",
    estimatePoints: 0,
    revision: 1,
    archivedAt: null,
    updatedAt: "2026-08-06T01:30:00.000Z",
  },
];

const POPULATED_HOME_WORKBENCH = {
  ...EMPTY_HOME_WORKBENCH,
  summary: {
    ...EMPTY_HOME_WORKBENCH.summary,
    total: 2,
    needsAttention: 1,
    waitingMe: 1,
    dueToday: 2,
    byRelation: { boss: 0, manager: 0, customer: 1, child: 0, colleague: 0, self: 1, unknown: 0 },
    byWaitingOn: { me: 1, requester: 0, internal: 0, ai: 1, none: 0 },
  },
  items: [
    {
      workItemId: "task-customer", localRef: "TASK-101", title: "回复客户并确认交付范围", projectId: "project-1",
      revision: 1, priority: "p1", assignees: [{ id: "usr_local", name: "我" }],
      requester: { relation: "customer", name: "示例客户", organization: null },
      planningStatus: "ready", executionState: "unclaimed", waitingOn: "me", executionKind: null, executionUpdatedAt: null,
      attentionReason: "user_action_required", secondaryReasons: [], needsAttention: true,
      dueDate: "2026-08-06", plannedDate: "2026-08-06", commitmentDate: null, nextFollowUpAt: null, report: null,
      nextAction: { kind: "open_issue", label: "open_issue", targetId: "task-customer", section: "task" }, ai: null,
    },
    {
      workItemId: "task-ai", localRef: "TASK-102", title: "整理本周反馈摘要", projectId: "project-1",
      revision: 1, priority: "p2", assignees: [{ id: "usr_local", name: "我" }],
      requester: { relation: "self", name: null, organization: null },
      planningStatus: "in_progress", executionState: "running", waitingOn: "ai", executionKind: "auto_run", executionUpdatedAt: "2026-08-06T01:30:00.000Z",
      attentionReason: "ai_running", secondaryReasons: [], needsAttention: false, userStatus: "ai_working",
      dueDate: "2026-08-06", plannedDate: "2026-08-06", commitmentDate: null, nextFollowUpAt: null, report: null,
      nextAction: { kind: "open_run", label: "open_run", targetId: "run-ai", section: "invocations" },
      ai: { autoRunId: "auto-ai", invocationId: "run-ai", agentId: "agent-1", agentName: "Local runner", status: "running", updatedAt: "2026-08-06T01:30:00.000Z" },
    },
  ],
};

function dashboardFallback(pathname: string) {
  if (pathname === "/api/work-items/home-workbench") return EMPTY_HOME_WORKBENCH;
  if (pathname === "/api/work-items") return { workItems: [], count: 0, hasMore: false, nextCursor: null };
  if (/^\/api\/projects\/[^/]+\/auto-run-readiness$/.test(pathname)) return { readiness: { ready: true, checks: [] } };
  if (pathname === "/api/local-schedule/capacity") return {
    terminal: { bridgeAvailable: true },
    capacity: { maxConcurrency: 1, availableSlots: 1, queueDepth: 0, worktreeLocks: 0 },
  };
  if (pathname === "/api/local-schedule/preview") return { planRevision: "0123456789abcdef01234567", days: [], attention: [], unscheduled: [] };
  if (pathname === "/api/local-schedule/rollover-preview") return { rolloverRevision: "0123456789abcdef01234567", moves: [], confirmationRequired: [], unscheduled: [] };
  if (pathname === "/api/local-schedule/urgent-preview") return { urgentRevision: "0123456789abcdef01234567", insertions: [], displacements: [], confirmationRequired: [], unscheduled: [] };
  return {};
}

function fulfillDashboardFallback(route: Route) {
  return route.fulfill({ json: dashboardFallback(new URL(route.request().url()).pathname) });
}

async function mockReadyHome(page: Page, locale: "en-US" | "zh-CN") {
  await page.route("http://127.0.0.1:5001/api/**", (route) => route.request().url().endsWith("/api/state")
    ? route.fulfill({ json: READY_STATE })
    : fulfillDashboardFallback(route));
  await page.addInitScript(({ language }) => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: {
        section: "dashboard",
        locale: language,
        selectedAgentId: "agent-1",
        selectedProjectId: "project-1",
      },
    }));
  }, { language: locale });
}

for (const fixture of [
  { name: "desktop-en", locale: "en-US" as const, viewport: { width: 1366, height: 768 }, task: "Create a task", run: "Let AI handle it", details: "More options", attachments: "Attachments (optional)", paste: "You can also paste files or screenshots" },
  { name: "desktop-zh", locale: "zh-CN" as const, viewport: { width: 1366, height: 768 }, task: "创建一个任务", run: "交给 AI", details: "更多选项", attachments: "附件（可选）", paste: "也可以直接粘贴文件或截图" },
  { name: "mobile-zh", locale: "zh-CN" as const, viewport: { width: 390, height: 844 }, task: "创建一个任务", run: "交给 AI", details: "更多选项", attachments: "附件（可选）", paste: "也可以直接粘贴文件或截图" },
]) {
  test(`keeps the ${fixture.name} tracked-task composer usable without horizontal overflow`, async ({ page }, testInfo) => {
    await page.setViewportSize(fixture.viewport);
    await mockReadyHome(page, fixture.locale);
    await page.goto("/?section=dashboard");

    if (fixture.viewport.width < 640) {
      const briefBox = await page.getByTestId("daily-coordination-brief").boundingBox();
      const boardBox = await page.getByTestId("daily-work-board").boundingBox();
      const composerBox = await page.getByTestId("home-task-composer-inline").boundingBox();
      expect(briefBox).not.toBeNull();
      expect(boardBox).not.toBeNull();
      expect(composerBox).not.toBeNull();
      expect(briefBox!.y).toBeLessThan(boardBox!.y);
      expect(composerBox!.y).toBeLessThan(boardBox!.y);
      await page.getByRole("button", { name: fixture.locale === "zh-CN" ? "展开任务创建" : "Expand task creation" }).click();
    }

    const input = page.getByRole("textbox", { name: fixture.task });
    const action = page.getByRole("button", { name: fixture.run });
    await expect(input).toBeVisible({ timeout: 15_000 });
    await expect(action).toBeVisible();
    await expect(page.getByLabel(fixture.attachments)).toBeAttached();
    await expect(page.getByText(fixture.paste, { exact: true })).toBeVisible();
    await expect(page.getByTestId("home-task-composer").getByText("Example project", { exact: true })).toBeVisible();
    await expect(page.getByText(fixture.locale === "zh-CN"
      ? "调度范围：所有项目"
      : "Schedule scope: All projects")).toBeVisible();
    await expect(action).toBeDisabled();
    await input.fill(fixture.locale === "zh-CN" ? "整理客户反馈并输出建议" : "Summarize customer feedback and recommend next steps");
    await expect(action).toBeEnabled();
    const taskOnlyAction = page.getByRole("button", { name: fixture.locale === "zh-CN" ? "仅保存" : "Save only", exact: true });
    const [taskOnlyBox, aiActionBox] = await Promise.all([taskOnlyAction.boundingBox(), action.boundingBox()]);
    expect(taskOnlyBox).not.toBeNull();
    expect(aiActionBox).not.toBeNull();
    const actionsAreSeparated = taskOnlyBox!.x + taskOnlyBox!.width <= aiActionBox!.x
      || aiActionBox!.x + aiActionBox!.width <= taskOnlyBox!.x
      || taskOnlyBox!.y + taskOnlyBox!.height <= aiActionBox!.y
      || aiActionBox!.y + aiActionBox!.height <= taskOnlyBox!.y;
    expect(actionsAreSeparated).toBe(true);

    await page.screenshot({ path: testInfo.outputPath(`${fixture.name}.png`), fullPage: true });

    await expect(page.getByRole("navigation", { name: fixture.locale === "zh-CN" ? "任务流程" : "Task journey" })).toHaveCount(0);
    await expect(page.getByText(fixture.locale === "zh-CN" ? "任务动态" : "Activity", { exact: true })).toHaveCount(0);

    const details = page.locator("details").filter({ hasText: fixture.details }).first();
    await expect(details).not.toHaveAttribute("open", "");
    await expect(page.getByText(fixture.paste, { exact: true })).toBeVisible();
    await details.locator("summary").click();
    await expect(page.getByText(fixture.locale === "zh-CN" ? "完成标准（可选）" : "Definition of done (optional)")).toBeVisible();

    if (fixture.viewport.width < 1024) {
      await expect(page.getByTestId("my-work-empty-state")).toBeVisible();
      await expect(page.getByTestId("my-date-navigation")).toHaveCount(0);
    }

    const width = await page.evaluate(() => ({
      viewport: window.innerWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
  });
}

test("keeps a populated mobile schedule ahead of the collapsed creator", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date("2026-08-06T12:00:00+08:00"));
  await page.route("http://127.0.0.1:5001/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/state") return route.fulfill({ json: READY_STATE });
    if (pathname === "/api/work-items/home-workbench") return route.fulfill({ json: POPULATED_HOME_WORKBENCH });
    if (pathname === "/api/work-items") return route.fulfill({ json: { workItems: POPULATED_HOME_ITEMS, count: 2, hasMore: false, nextCursor: null } });
    return fulfillDashboardFallback(route);
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: { section: "dashboard", locale: "zh-CN", selectedAgentId: "agent-1", selectedProjectId: "project-1" },
    }));
  });

  await page.goto("/?section=dashboard");

  await expect(page.getByRole("tab", { name: /^我的安排 2$/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /TASK-101 · 回复客户并确认交付范围/ })).toBeVisible();
  const dateNavigation = page.getByTestId("my-date-navigation");
  await expect(page.getByRole("button", { name: "快速创建任务" })).toBeVisible();
  await expect(page.getByRole("button", { name: "展开任务创建" })).toBeVisible();
  const boardBox = await page.getByTestId("daily-work-board").boundingBox();
  const composerBox = await page.getByTestId("home-task-composer-inline").boundingBox();
  expect(boardBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(composerBox!.y).toBeLessThan(boardBox!.y);
  await page.evaluate(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
  });
  await page.screenshot({ path: testInfo.outputPath("mobile-populated-schedule.png"), fullPage: true });

  await page.getByTestId("my-date-columns").evaluate((container) => {
    const target = container.querySelector<HTMLElement>('[data-testid="other-completion-column"]');
    container.scrollTo({ left: target?.offsetLeft ?? container.scrollWidth });
    container.dispatchEvent(new Event("scroll"));
  });
  await expect(dateNavigation.getByRole("button", { name: "稍后 / 未排期" })).toHaveAttribute("aria-pressed", "true");
  await dateNavigation.getByRole("button", { name: "今天" }).click();
  await expect(dateNavigation.getByRole("button", { name: "今天" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("tab", { name: /^AI 执行 1$/ }).click();
  await expect(page.getByRole("button", { name: /TASK-102 整理本周反馈摘要/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-populated-ai.png"), fullPage: true });
});

test("keeps the desktop brief and task creation together above the full-width schedule", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.clock.setFixedTime(new Date("2026-08-06T12:00:00+08:00"));
  await page.route("http://127.0.0.1:5001/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/state") return route.fulfill({ json: READY_STATE });
    if (pathname === "/api/work-items/home-workbench") return route.fulfill({ json: POPULATED_HOME_WORKBENCH });
    if (pathname === "/api/work-items") return route.fulfill({ json: { workItems: POPULATED_HOME_ITEMS, count: 2, hasMore: false, nextCursor: null } });
    return fulfillDashboardFallback(route);
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: { section: "dashboard", locale: "zh-CN", selectedAgentId: "agent-1", selectedProjectId: "project-1" },
    }));
  });

  await page.goto("/?section=dashboard");
  await expect(page.getByRole("tab", { name: /^我的安排 2$/ })).toBeVisible({ timeout: 15_000 });
  const createColumn = page.getByTestId("home-create-column");
  const [briefBox, createBox, boardBox, composerBox] = await Promise.all([
    page.getByTestId("daily-coordination-brief").boundingBox(),
    createColumn.boundingBox(),
    page.getByTestId("daily-work-board").boundingBox(),
    page.getByTestId("home-task-composer-inline").boundingBox(),
  ]);
  expect(briefBox).not.toBeNull();
  expect(createBox).not.toBeNull();
  expect(boardBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(briefBox!.x + briefBox!.width).toBeLessThanOrEqual(createBox!.x);
  expect(Math.abs(briefBox!.y - composerBox!.y)).toBeLessThanOrEqual(2);
  expect(boardBox!.y).toBeGreaterThanOrEqual(Math.max(briefBox!.y + briefBox!.height, composerBox!.y + composerBox!.height));
  await expect(page.getByText("调度范围：所有项目")).toBeVisible();
  await expect(page.getByTestId("home-task-composer").getByText("Example project", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-populated-schedule.png"), fullPage: true });
});

test("creates a Home task, reviews its plan, then schedules AI from simple details", async ({ page }) => {
  let createdPayload: Record<string, unknown> | null = null;
  let workItem: Record<string, unknown> | null = null;
  let scheduled = false;
  await page.route("http://127.0.0.1:5001/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/state") return route.fulfill({ json: READY_STATE });
    if (/^\/api\/projects\/[^/]+\/auto-run-readiness$/.test(pathname)) {
      return route.fulfill({ json: { readiness: { ready: true, checks: [] } } });
    }
    if (pathname === "/api/work-items/assist/intent-plan" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      return route.fulfill({ json: {
        plan: {
          tasks: [{
            key: "general", kind: "general", title: body.title,
            outcome: "Produce a reviewable customer update", requires: [], approvalRequired: false,
          }],
          clarification: null,
        },
        summary: {
          taskCount: 1, requiresRepository: false, approvalTaskCount: 0,
          canCommit: true, canStartAi: true,
          nextStep: "The task plan is ready. Confirm to save it.",
        },
      } });
    }
    if (pathname === "/api/work-items/assist/intent-plan/commit" && request.method() === "POST") {
      createdPayload = request.postDataJSON() as Record<string, unknown>;
      workItem = {
        id: "lwi_home", localRef: "LOCAL-1", projectId: "project-1",
        title: createdPayload.title, body: createdPayload.body, type: "task", priority: "p2",
        status: "backlog", state: "open", labels: [], assigneeIds: [],
        acceptanceCriteria: createdPayload.acceptanceCriteria ?? [], verificationSop: createdPayload.verificationSop ?? [],
        waitingOn: "none", plannedDate: null, dueDate: createdPayload.dueDate ?? null,
        executionState: "unclaimed", executionBindings: [], revision: 1, archivedAt: null,
        updatedAt: "2026-08-06T00:00:00.000Z",
      };
      return route.fulfill({ status: 201, json: { workItems: [workItem] } });
    }
    if (pathname === "/api/work-items" && request.method() === "POST") {
      createdPayload = request.postDataJSON() as Record<string, unknown>;
      workItem = {
        id: "lwi_home", localRef: "LOCAL-1", projectId: "project-1",
        title: createdPayload.title, body: createdPayload.body, type: "task", priority: "p2",
        status: "backlog", state: "open", labels: [], assigneeIds: [], acceptanceCriteria: [],
        waitingOn: createdPayload.waitingOn, plannedDate: createdPayload.plannedDate, dueDate: createdPayload.dueDate,
        executionState: "unclaimed", executionBindings: [], revision: 1, archivedAt: null,
        updatedAt: "2026-08-06T00:00:00.000Z",
      };
      return route.fulfill({ status: 201, json: { workItem } });
    }
    if (pathname === "/api/work-items/assist/draft" && request.method() === "POST") {
      return route.fulfill({ json: {
        draft: {
          acceptanceCriteria: ["Customer-ready weekly update"],
          verificationSop: ["Review the update for accuracy and plain language"],
        },
      } });
    }
    if (pathname === "/api/work-items/lwi_home" && request.method() === "PATCH") {
      const changes = request.postDataJSON() as Record<string, unknown>;
      if (Array.isArray(changes.acceptanceCriteria)) {
        workItem = {
          ...workItem,
          acceptanceCriteria: changes.acceptanceCriteria,
          verificationSop: changes.verificationSop,
          executionContractSource: "assisted",
          executionContractConfirmedAt: "2026-08-06T00:01:00.000Z",
          executionContractGate: { ready: true, missing: [], source: "assisted", confirmedAt: "2026-08-06T00:01:00.000Z" },
          revision: 2,
        };
      } else {
        scheduled = true;
        workItem = {
          ...workItem,
          ...changes,
          revision: 3,
        };
      }
      return route.fulfill({ json: { workItem } });
    }
    if (pathname === "/api/work-items/lwi_home/execution-contract/confirm" && request.method() === "POST") {
      scheduled = true;
      workItem = {
        ...workItem,
        executionPolicy: "auto", status: "ready", waitingOn: "ai", executionState: "queued",
        executionContractSource: "assisted",
        executionContractConfirmedAt: "2026-08-06T00:01:00.000Z",
        executionContractGate: { ready: true, missing: [], source: "assisted", confirmedAt: "2026-08-06T00:01:00.000Z" },
        revision: Number(workItem?.revision ?? 0) + 1,
      };
      return route.fulfill({ json: { workItem } });
    }
    if (pathname === "/api/work-items/lwi_home/auto-runs" && request.method() === "POST") {
      workItem = {
        ...workItem,
        waitingOn: "ai",
        executionState: "running",
        executionBindings: [{ kind: "auto_run", targetId: "aur_home", worktreeId: "wt_home", createdAt: "2026-08-06T00:01:00.000Z" }],
        revision: 2,
      };
      return route.fulfill({ status: 201, json: { autoRun: { id: "aur_home", status: "queued", worktreeId: "wt_home" } } });
    }
    if (pathname === "/api/work-items/lwi_home" && request.method() === "GET") {
      return route.fulfill({ json: {
        workItem,
        observability: {
          latestRun: null,
          delivery: null,
        },
      } });
    }
    if (pathname === "/api/work-items/lwi_home/comments") return route.fulfill({ json: { comments: [] } });
    if (pathname === "/api/work-items" && request.method() === "GET") {
      return route.fulfill({ json: { workItems: workItem ? [workItem] : [], count: workItem ? 1 : 0, hasMore: false, nextCursor: null } });
    }
    return fulfillDashboardFallback(route);
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: { section: "dashboard", locale: "en-US", selectedProjectId: "project-1" },
    }));
  });
  await page.goto("/?section=dashboard");

  await page.getByRole("textbox", { name: "Create a task" }).fill("Prepare the weekly customer update");
  await page.getByRole("button", { name: "Save only" }).click();
  await expect(page.getByTestId("home-intent-task-plan")).toBeVisible();
  await page.getByRole("button", { name: "Confirm and save" }).click();

  await expect(page.getByText("Task created and added to your boards.")).toBeVisible();
  expect(createdPayload).toEqual(expect.objectContaining({
    projectId: "project-1",
    title: "Prepare the weekly customer update",
    mode: "task",
    dueDate: null,
  }));
  expect(scheduled).toBe(false);
  await page.getByRole("button", { name: "View task" }).click();

  const detail = page.getByRole("dialog", { name: "Task details" });
  await expect(detail.getByRole("heading", { name: "Prepare the weekly customer update" })).toBeVisible();
  await detail.getByTestId("review-and-start-ai").click();
  expect(scheduled).toBe(false);
  await expect(detail.getByTestId("work-item-intent-summary").getByText("Customer-ready weekly update")).toBeVisible();

  await page.getByRole("dialog", { name: "Confirm AI start" })
    .getByRole("button", { name: "Confirm and start AI" }).click();
  await expect(detail.getByText(/AI accepted the task/i)).toBeVisible();
  expect(scheduled).toBe(true);
});

test("preserves reviewed source and per-task edits while the user configures a capability", async ({ page }) => {
  await page.route("http://127.0.0.1:5001/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/state") return route.fulfill({ json: READY_STATE });
    if (pathname === "/api/work-items/assist/intent-plan" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      const selected = body.sourceWorkItemId === "source-1";
      const excluded = new Set(Array.isArray(body.excludeTaskKeys) ? body.excludeTaskKeys : []);
      const tasks = [
        { key: "content_image", kind: "content_image", title: "Product images", outcome: "Create reviewable images", requires: [], approvalRequired: false, ...(selected ? { externalSource: { workItemId: "source-1", localRef: "LOCAL-8", title: "Approved product analysis", artifactKinds: ["analysis_report"] } } : {}) },
        { key: "content_comic", kind: "content_comic", title: "Product comic", outcome: "Create a reviewable comic", requires: [], approvalRequired: false },
      ].filter((task) => !excluded.has(task.key));
      return route.fulfill({ json: {
        plan: {
          tasks,
          clarification: null,
          excludedTaskKeys: [...excluded],
          sourceSelection: {
            required: !selected,
            selected: selected ? { workItemId: "source-1", localRef: "LOCAL-8", title: "Approved product analysis", completedAt: "2026-08-05T00:00:00.000Z", artifactKinds: ["analysis_report"], outputCount: 1 } : null,
            candidates: [{ workItemId: "source-1", localRef: "LOCAL-8", title: "Approved product analysis", completedAt: "2026-08-05T00:00:00.000Z", artifactKinds: ["analysis_report"], outputCount: 1 }],
            unavailable: false,
          },
        },
        summary: {
          taskCount: tasks.length,
          requiresRepository: false,
          approvalTaskCount: 0,
          canCommit: selected,
          canStartAi: false,
          capabilityBlockers: [{ taskKind: "content_image", requiredCapability: "Image generation", reason: "specialized_capability_unavailable", setupSection: "applications" }],
          nextStep: selected ? "Set up image generation before AI starts." : "Choose an existing result.",
        },
      } });
    }
    return fulfillDashboardFallback(route);
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: { section: "dashboard", locale: "en-US", selectedProjectId: "project-1" },
    }));
  });
  await page.goto("/?section=dashboard");
  await page.getByRole("textbox", { name: "Create a task" }).fill("Based on the approved analysis, create product images and a comic");
  await page.getByRole("button", { name: "Save only" }).click();
  await page.getByRole("button", { name: /Approved product analysis/ }).click();
  await expect(page.getByText(/Will use: Approved product analysis/)).toBeVisible();
  await page.getByRole("button", { name: "Remove Product comic" }).click();
  await expect(page.getByRole("button", { name: "Restore Product comic" })).toBeVisible();
  await page.getByRole("button", { name: "Set up capability" }).click();
  await expect(page).toHaveURL(/section=applications/);

  await page.goto("/?section=dashboard");
  await expect(page.getByTestId("home-intent-task-plan")).toBeVisible();
  await expect(page.getByText(/Will use: Approved product analysis/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore Product comic" })).toBeVisible();
  await expect(page.getByTestId("home-intent-task-plan").getByText("Product images", { exact: true })).toBeVisible();
});

test("submits one Worktree snapshot with matching attachment and invocation idempotency", async ({ page }) => {
  let uploadBody: Record<string, unknown> | null = null;
  let invocationBody: Record<string, unknown> | null = null;
  const worktree = {
    id: "worktree-1",
    projectId: "project-1",
    targetId: "target-1",
    branch: "feat/worktree-submit",
    path: "D:\\repo-worktree",
    isMain: false,
    agentId: "agent-1",
    createdAt: "2026-08-03T00:00:00.000Z",
  };
  const state = {
    ...READY_STATE,
    worktrees: [worktree],
    agents: [{
      ...READY_STATE.agents[0],
      adapter: {
        type: "cli",
        command: "codex",
        permissionMode: "auto",
        models: ["gpt-5.6-sol", "gpt-5.6-terra"],
        defaultModel: "gpt-5.6-terra",
      },
    }],
  };
  await page.route("http://127.0.0.1:5001/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/state") return route.fulfill({ json: state });
    if (pathname === "/api/worktrees/worktree-1/files") return route.fulfill({ json: { tree: [] } });
    if (pathname === "/api/worktrees/worktree-1/git") {
      return route.fulfill({ json: { branch: worktree.branch, upstream: null, ahead: 0, behind: 0, changedFiles: 0, hasUpstream: false } });
    }
    if (pathname === "/api/worktrees/worktree-1/diff") {
      return route.fulfill({ json: { files: [], base: "main", diff: "", truncated: false } });
    }
    if (pathname === "/api/worktrees/worktree-1/attachments") {
      uploadBody = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 201,
        json: {
          batchId: "stable-worktree-batch",
          attachments: [{
            name: "context.txt",
            path: ".myagenttool/attachments/stable-worktree-batch/context.txt",
            bytes: 7,
          }],
          skipped: [],
        },
      });
    }
    if (pathname === "/api/invocations") {
      invocationBody = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 201,
        json: {
          invocation: {
            id: "inv-worktree-browser-submit",
            status: "queued",
            projectId: "project-1",
            worktreeId: "worktree-1",
            agentId: "agent-1",
            input: { task: invocationBody.task },
          },
        },
      });
    }
    return fulfillDashboardFallback(route);
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: {
        section: "projects",
        locale: "en-US",
        selectedAgentId: "agent-1",
        selectedProjectId: "project-1",
        selectedWorktreeId: "worktree-1",
      },
    }));
  });
  await page.goto("/?section=projects");

  await page.locator('input[type="file"]').setInputFiles({
    name: "context.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("context"),
  });
  await page.getByRole("textbox", { name: "Task" }).fill("Review this worktree");
  await page.getByRole("combobox", { name: "Model" }).selectOption("gpt-5.6-sol");
  await page.getByRole("combobox", { name: "Permission level" }).selectOption("full");
  await page.getByRole("button", { name: "Run in this worktree" }).click();

  await expect.poll(() => invocationBody).not.toBeNull();
  expect(uploadBody).toEqual({
    files: [{ name: "context.txt", dataBase64: "Y29udGV4dA==" }],
    batchId: expect.any(String),
  });
  expect(invocationBody).toEqual({
    task: "Review this worktree\n\nAttached files (in the worktree):\n- .myagenttool/attachments/stable-worktree-batch/context.txt",
    agentId: "agent-1",
    projectId: "project-1",
    worktreeId: "worktree-1",
    options: { permissionLevel: "full", model: "gpt-5.6-sol" },
    idempotencyKey: uploadBody?.batchId,
  });
});

test("resumes the zh-CN guided setup on mobile after refresh", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = {
    device: { id: "device-1", name: "这台电脑", status: "offline" },
    projects: [],
    projectTargets: [],
    worktrees: [],
    agents: [],
    events: [],
    invocations: [],
    pendingDecisions: [],
    evidenceLedger: [],
    guidedSetup: {
      version: 1,
      status: "action_required",
      currentStep: "computer",
      reason: "computer_offline",
      action: { kind: "open_section", section: "devices" },
      runId: null,
      completedCount: 0,
      totalCount: 3,
      steps: [
        { key: "computer", state: "current" },
        { key: "workspace", state: "pending" },
        { key: "execution", state: "pending" },
      ],
    },
  };
  await page.route("http://127.0.0.1:5001/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/state") return route.fulfill({ json: state });
    if (pathname === "/api/guided-setup/start") {
      state.guidedSetup = {
        ...state.guidedSetup,
        runId: "gsr-browser",
        updatedAt: "2026-07-27T00:00:01.000Z",
      };
      return route.fulfill({ status: 201, json: { guidedSetup: state.guidedSetup } });
    }
    if (pathname === "/api/guided-setup/cancel") {
      state.guidedSetup = {
        ...state.guidedSetup,
        status: "cancelled",
        reason: "setup_cancelled",
        action: null,
        updatedAt: "2026-07-27T00:00:02.000Z",
        steps: [
          { key: "computer", state: "cancelled" },
          { key: "workspace", state: "pending" },
          { key: "execution", state: "pending" },
        ],
      };
      return route.fulfill({ json: { guidedSetup: state.guidedSetup } });
    }
    if (pathname === "/api/guided-setup/resume") {
      state.guidedSetup = {
        ...state.guidedSetup,
        status: "action_required",
        reason: "computer_offline",
        action: { kind: "open_section", section: "devices" },
        updatedAt: "2026-07-27T00:00:03.000Z",
        steps: [
          { key: "computer", state: "current" },
          { key: "workspace", state: "pending" },
          { key: "execution", state: "pending" },
        ],
      };
      return route.fulfill({ json: { guidedSetup: state.guidedSetup } });
    }
    return fulfillDashboardFallback(route);
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: { section: "dashboard", locale: "zh-CN" },
    }));
  });
  await page.goto("/?section=dashboard");

  const start = page.getByRole("button", { name: "开始配置" });
  await expect(start).toBeVisible();
  const startBox = await start.boundingBox();
  expect((startBox?.y ?? Infinity) + (startBox?.height ?? 0)).toBeLessThanOrEqual(844);
  await start.click();
  await expect(page.getByText("0/3")).toBeVisible();
  const recovery = page.getByRole("button", { name: "打开连接帮助" });
  await expect(recovery).toBeVisible();
  await page.locator("main").evaluate((element) => element.scrollTo({ top: 0 }));
  const recoveryBox = await recovery.boundingBox();
  expect((recoveryBox?.y ?? Infinity) + (recoveryBox?.height ?? 0)).toBeLessThanOrEqual(844);
  await page.screenshot({ path: testInfo.outputPath("mobile-zh-guided-setup.png"), fullPage: true });

  await page.reload();
  await expect(page.getByText("0/3")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始配置" })).toHaveCount(0);
  await expect(page.getByText("这台电脑尚未连接。")).toBeVisible();

  await page.getByRole("button", { name: "停止配置引导" }).click();
  await expect(page.getByRole("button", { name: "继续配置" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("你已停止配置引导。")).toBeVisible();
  await page.getByRole("button", { name: "继续配置" }).click();
  await expect(page.getByRole("button", { name: "打开连接帮助" })).toBeVisible();
});

const HOME_ACTION_MATRIX = [
  {
    state: "idle",
    expectedState: "idle",
    status: null,
    en: "Let AI handle it",
    zh: "交给 AI",
    destination: null,
  },
  {
    state: "running",
    expectedState: "running",
    status: "running",
    en: "View progress",
    zh: "查看执行进度",
    destination: "invocations",
  },
  {
    state: "approval",
    expectedState: "approval",
    status: "waiting_for_local_approval",
    en: "AI approvals: Synthetic approval",
    zh: "AI 待审批: Synthetic approval",
    destination: "approvals",
  },
  {
    state: "terminal-failed",
    expectedState: "idle",
    status: "failed",
    en: "Let AI handle it",
    zh: "交给 AI",
    destination: null,
  },
  {
    state: "terminal-succeeded",
    expectedState: "idle",
    status: "succeeded",
    en: "Let AI handle it",
    zh: "交给 AI",
    destination: null,
  },
] as const;

for (const locale of ["en-US", "zh-CN"] as const) {
  for (const fixture of HOME_ACTION_MATRIX) {
    test(`shows one ${locale} Home action for ${fixture.state}`, async ({ page }, testInfo) => {
      const invocation = fixture.status
        ? [{
            id: "run-matrix",
            projectId: "project-1",
            agentId: "agent-1",
            status: fixture.status,
            createdAt: "2026-07-27T00:00:00.000Z",
            input: { task: "Synthetic matrix task" },
            result: fixture.status === "succeeded" ? { summary: "Synthetic result" } : undefined,
          }]
        : [];
      const state = {
        ...READY_STATE,
        invocations: invocation,
        pendingDecisions: fixture.state === "approval"
          ? [{
              id: "decision-matrix",
              kind: "invocation_approval",
              title: "Synthetic approval",
              section: "approvals",
              ref: { invocationId: "run-matrix" },
            }]
          : [],
      };
      await page.route("http://127.0.0.1:5001/api/**", (route) => route.request().url().endsWith("/api/state")
        ? route.fulfill({ json: state })
        : fulfillDashboardFallback(route));
      await page.addInitScript(({ language }) => {
        window.localStorage.setItem("myagenttool-ui", JSON.stringify({
          version: 1,
          state: {
            section: "dashboard",
            locale: language,
            selectedAgentId: "agent-1",
            selectedProjectId: "project-1",
          },
        }));
      }, { language: locale });
      await page.goto("/?section=dashboard");

      const primary = fixture.expectedState === "idle"
        ? page.getByRole("button", { name: locale === "zh-CN" ? fixture.zh : fixture.en })
        : fixture.expectedState === "approval"
          ? page.getByRole("button", { name: locale === "zh-CN" ? fixture.zh : fixture.en })
          : page.locator(`[data-home-work-state="${fixture.expectedState}"] [data-home-primary-action]`);
      await expect(primary).toHaveCount(1);
      await expect(primary).toHaveAccessibleName(locale === "zh-CN" ? fixture.zh : fixture.en);
      if (locale === "zh-CN") {
        for (const accidentalStatus of [
          "Needs approval",
          "Running",
          "Failed",
          "Done",
          "This run's agent did not emit a transcript.",
        ]) {
          await expect(page.getByText(accidentalStatus, { exact: true })).toHaveCount(0);
        }
      }
      if (fixture.expectedState === "idle") {
        await page.getByRole("textbox", { name: locale === "zh-CN" ? "创建一个任务" : "Create a task" }).fill("Safe synthetic task");
        await expect(primary).toBeEnabled();
      }
      if (fixture.state.startsWith("terminal-")) {
        await expect(page.getByText(locale === "zh-CN" ? "任务动态" : "Activity", { exact: true })).toHaveCount(0);
        await expect(page.getByText("Synthetic matrix task", { exact: true })).toHaveCount(0);
      }
      await page.screenshot({
        path: testInfo.outputPath(`home-${locale}-${fixture.state}.png`),
        fullPage: true,
      });

      if (fixture.destination) {
        await primary.click();
        await expect(page).toHaveURL(new RegExp(`section=${fixture.destination}`));
      }
    });
  }
}
