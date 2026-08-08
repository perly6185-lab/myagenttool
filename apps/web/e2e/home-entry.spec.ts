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
  await page.route("**/api/**", (route) => route.request().url().endsWith("/api/state")
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
  { name: "desktop-en", locale: "en-US" as const, viewport: { width: 1366, height: 768 }, task: "Create a task", run: "Create and let AI work", details: "Add completion criteria or references" },
  { name: "desktop-zh", locale: "zh-CN" as const, viewport: { width: 1366, height: 768 }, task: "创建一个任务", run: "创建并交给 AI", details: "补充完成标准或参考资料" },
  { name: "mobile-zh", locale: "zh-CN" as const, viewport: { width: 390, height: 844 }, task: "创建一个任务", run: "创建并交给 AI", details: "补充完成标准或参考资料" },
]) {
  test(`keeps the ${fixture.name} tracked-task composer usable without horizontal overflow`, async ({ page }, testInfo) => {
    await page.setViewportSize(fixture.viewport);
    await mockReadyHome(page, fixture.locale);
    await page.goto("/?section=dashboard");

    const input = page.getByRole("textbox", { name: fixture.task });
    const action = page.getByRole("button", { name: fixture.run });
    await expect(input).toBeVisible({ timeout: 15_000 });
    await expect(action).toBeVisible();
    await expect(action).toBeDisabled();
    await input.fill(fixture.locale === "zh-CN" ? "整理客户反馈并输出建议" : "Summarize customer feedback and recommend next steps");
    await expect(action).toBeEnabled();

    await page.screenshot({ path: testInfo.outputPath(`${fixture.name}.png`), fullPage: true });

    await expect(page.getByRole("navigation", { name: fixture.locale === "zh-CN" ? "任务流程" : "Task journey" })).toHaveCount(0);
    await expect(page.getByText(fixture.locale === "zh-CN" ? "任务动态" : "Activity", { exact: true })).toHaveCount(0);

    const details = page.locator("details").filter({ hasText: fixture.details }).first();
    await expect(details).not.toHaveAttribute("open", "");
    await details.locator("summary").click();
    await expect(page.getByText(fixture.locale === "zh-CN" ? "完成标准（可选）" : "Definition of done (optional)")).toBeVisible();

    const width = await page.evaluate(() => ({
      viewport: window.innerWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
  });
}

test("creates a Home Local Issue first, then starts AI from simple details", async ({ page }) => {
  let createdPayload: Record<string, unknown> | null = null;
  let workItem: Record<string, unknown> | null = null;
  let started = false;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/state") return route.fulfill({ json: READY_STATE });
    if (/^\/api\/projects\/[^/]+\/auto-run-readiness$/.test(pathname)) {
      return route.fulfill({ json: { readiness: { ready: true, checks: [] } } });
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
    if (pathname === "/api/work-items/lwi_home/auto-runs" && request.method() === "POST") {
      started = true;
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
          latestRun: started ? { id: "aur_home", status: "running", updatedAt: "2026-08-06T00:01:00.000Z" } : null,
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
  await page.getByRole("button", { name: "Create task only" }).click();

  await expect(page.getByText("Task created and added to your boards.")).toBeVisible();
  expect(createdPayload).toEqual(expect.objectContaining({
    projectId: "project-1",
    title: "Prepare the weekly customer update",
    waitingOn: "none",
    plannedDate: null,
  }));
  expect(started).toBe(false);
  await page.getByRole("button", { name: "View task" }).click();

  const detail = page.getByRole("dialog", { name: "Task details" });
  await expect(detail.getByRole("heading", { name: "Prepare the weekly customer update" })).toBeVisible();
  await detail.getByRole("button", { name: "Let AI start" }).click();
  await expect(detail.getByText(/understanding the task and establishing the execution and acceptance basis/i)).toBeVisible();
  expect(started).toBe(true);
  await expect(detail.getByText("AI working", { exact: true })).toBeVisible();
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
  await page.route("**/api/**", async (route) => {
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
  await page.route("**/api/**", (route) => {
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
    en: "Create and let AI work",
    zh: "创建并交给 AI",
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
    en: "Create and let AI work",
    zh: "创建并交给 AI",
    destination: null,
  },
  {
    state: "terminal-succeeded",
    expectedState: "idle",
    status: "succeeded",
    en: "Create and let AI work",
    zh: "创建并交给 AI",
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
      await page.route("**/api/**", (route) => route.request().url().endsWith("/api/state")
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
