import { expect, test, type Page } from "playwright/test";

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

async function mockReadyHome(page: Page, locale: "en-US" | "zh-CN") {
  await page.route("**/api/**", (route) => route.fulfill({
    json: route.request().url().endsWith("/api/state") ? READY_STATE : {},
  }));
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
  { name: "desktop-en", locale: "en-US" as const, viewport: { width: 1366, height: 768 }, task: "Task", run: "Run on this computer", starter: "Inspect this project", details: "What to know before running" },
  { name: "desktop-zh", locale: "zh-CN" as const, viewport: { width: 1366, height: 768 }, task: "任务", run: "在此电脑上运行", starter: "检查项目", details: "运行前须知" },
  { name: "mobile-zh", locale: "zh-CN" as const, viewport: { width: 390, height: 844 }, task: "任务", run: "在此电脑上运行", starter: "检查项目", details: "运行前须知" },
]) {
  test(`keeps the ${fixture.name} Home composer and primary action above the fold`, async ({ page }, testInfo) => {
    await page.setViewportSize(fixture.viewport);
    await mockReadyHome(page, fixture.locale);
    await page.goto("/?section=dashboard");

    const input = page.getByRole("textbox", { name: fixture.task });
    const action = page.getByRole("button", { name: fixture.run });
    const model = page.getByRole("combobox", { name: fixture.locale === "zh-CN" ? "模型" : "Model" });
    await expect(input).toBeVisible({ timeout: 15_000 });
    await expect(action).toBeVisible();
    await expect(model).toBeVisible();
    await model.selectOption("gpt-5.6-sol");
    await expect(model).toHaveValue("gpt-5.6-sol");
    for (const locator of [input, action]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect((box?.y ?? Infinity) + (box?.height ?? 0)).toBeLessThanOrEqual(fixture.viewport.height);
    }

    await page.getByRole("combobox", {
      name: fixture.locale === "zh-CN" ? "首次任务模板" : "First task templates",
    }).selectOption({ label: fixture.starter });
    await expect(action).toBeEnabled();

    await page.screenshot({ path: testInfo.outputPath(`${fixture.name}.png`), fullPage: true });

    await expect(page.getByRole("navigation", { name: fixture.locale === "zh-CN" ? "任务流程" : "Task journey" })).toHaveCount(0);
    await expect(page.getByText(fixture.locale === "zh-CN" ? "任务动态" : "Activity", { exact: true })).toHaveCount(0);

    const details = page.locator("details").filter({ hasText: fixture.details }).first();
    await expect(details).not.toHaveAttribute("open", "");
    await details.locator("summary").click();
    await expect(page.getByRole("combobox", {
      name: fixture.locale === "zh-CN" ? "项目" : "Project",
      exact: true,
    })).toBeVisible();
    if (fixture.locale === "zh-CN") {
      const assistantPicker = page.getByRole("combobox", { name: "任务助手" });
      await expect(assistantPicker).toBeVisible();
      await expect(page.getByText("追踪编号（Trace ID）")).toBeVisible();
      await expect(assistantPicker).toContainText("Local runner");
    }

    const width = await page.evaluate(() => ({
      viewport: window.innerWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
  });
}

test("submits one explicit-worktree Home snapshot with matching attachment and invocation idempotency", async ({ page }) => {
  let uploadBody: Record<string, unknown> | null = null;
  let invocationBody: Record<string, unknown> | null = null;
  const state = {
    ...READY_STATE,
    worktrees: [{
      id: "worktree-1",
      projectId: "project-1",
      targetId: "target-1",
      branch: "feat/home-submit",
      path: "D:\\repo-worktree",
      isMain: false,
      agentId: "agent-1",
      createdAt: "2026-08-03T00:00:00.000Z",
    }],
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
    if (pathname === "/api/worktrees/worktree-1/attachments") {
      uploadBody = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 201,
        json: {
          batchId: "stable-batch",
          attachments: [{
            name: "notes.txt",
            path: ".myagenttool/attachments/stable-batch/notes.txt",
            bytes: 5,
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
            id: "inv-browser-submit",
            status: "queued",
            projectId: "project-1",
            worktreeId: "worktree-1",
            agentId: "agent-1",
            input: { task: invocationBody.task },
          },
        },
      });
    }
    return route.fulfill({ json: {} });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: {
        section: "dashboard",
        locale: "en-US",
        selectedAgentId: "agent-1",
        selectedProjectId: "project-1",
        selectedWorktreeId: "worktree-1",
      },
    }));
  });
  await page.goto("/?section=dashboard");

  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await page.getByRole("textbox", { name: "Task" }).fill("Review the current change");
  await page.getByRole("combobox", { name: "Model" }).selectOption("gpt-5.6-sol");
  await page.getByRole("combobox", { name: "Permission level" }).selectOption("full");
  await page.getByRole("button", { name: "Run on this computer" }).click();

  await expect.poll(() => invocationBody).not.toBeNull();
  expect(uploadBody).toEqual({
    files: [{ name: "notes.txt", dataBase64: "aGVsbG8=" }],
    batchId: expect.any(String),
  });
  expect(invocationBody).toEqual({
    task: "Review the current change\n\nAttached files (in the worktree):\n- .myagenttool/attachments/stable-batch/notes.txt",
    agentId: "agent-1",
    projectId: "project-1",
    worktreeId: "worktree-1",
    options: { permissionLevel: "full", model: "gpt-5.6-sol" },
    idempotencyKey: uploadBody?.batchId,
  });
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
    return route.fulfill({ json: {} });
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
    return route.fulfill({ json: {} });
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
    en: "Run on this computer",
    zh: "在此电脑上运行",
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
    en: "Handle approval",
    zh: "处理审批",
    destination: "approvals",
  },
  {
    state: "terminal-failed",
    expectedState: "idle",
    status: "failed",
    en: "Run on this computer",
    zh: "在此电脑上运行",
    destination: null,
  },
  {
    state: "terminal-succeeded",
    expectedState: "idle",
    status: "succeeded",
    en: "Run on this computer",
    zh: "在此电脑上运行",
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
      await page.route("**/api/**", (route) => route.fulfill({
        json: route.request().url().endsWith("/api/state") ? state : {},
      }));
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
        ? page.locator('[data-home-primary-action="run"]')
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
        await page.getByRole("textbox", { name: locale === "zh-CN" ? "任务" : "Task" }).fill("Safe synthetic task");
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
