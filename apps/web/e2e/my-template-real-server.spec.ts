import { execFileSync } from "node:child_process";
import type { Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "playwright/test";

let apiBase = "";
let workspaceRoot = "";
let historyPath = "";
let server: Server | null = null;

async function call(path: string, options: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

test.beforeAll(async () => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "myagenttool-my-template-"));
  historyPath = join(workspaceRoot, "客户询价历史");
  mkdirSync(historyPath, { recursive: true });

  for (const number of ["001", "002", "003"]) {
    writeFileSync(join(historyPath, `询价单-RFQ-${number}.md`), [
      "# 客户询价单",
      `询价编号：RFQ-${number}`,
      `客户：测试客户${number}`,
      "产品：工业控制器",
      `数量：${Number(number) + 10}`,
      "币种：CNY",
      "日期：2026-08-01",
    ].join("\n"));
    writeFileSync(join(historyPath, `报价单-RFQ-${number}.md`), [
      "# 客户报价单",
      `报价编号：RFQ-${number}`,
      `客户：测试客户${number}`,
      "产品：工业控制器",
      `数量：${Number(number) + 10}`,
      "单价：1280",
      "币种：CNY",
      "总金额：15360",
      "报价日期：2026-08-02",
    ].join("\n"));
  }

  execFileSync("git", ["init", "-b", "main", workspaceRoot]);
  execFileSync("git", ["-C", workspaceRoot, "config", "user.email", "template@example.test"]);
  execFileSync("git", ["-C", workspaceRoot, "config", "user.name", "Template Test"]);
  execFileSync("git", ["-C", workspaceRoot, "add", "."]);
  execFileSync("git", ["-C", workspaceRoot, "commit", "-m", "historical input and result fixtures"]);

  const { createServerState } = await import("../../server/src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../server/src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../server/src/runtime/http-server.mjs");
  const now = () => new Date().toISOString();
  const { defaultProject, state } = createServerState({ defaultProjectPath: workspaceRoot, now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "my-template-real-e2e",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: workspaceRoot,
    persistenceEnabled: false,
    stateStorePath: join(workspaceRoot, "unused.json"),
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: "my-template-real-e2e",
    protocolVersion: "0.0.0",
    ...httpDependencies,
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("real template server address unavailable");
  apiBase = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  rmSync(workspaceRoot, { recursive: true, force: true });
});

test("learns one real input-result pair and automatically matches a Chinese local Issue", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: { locale: "zh-CN", section: "workflowMemory" },
    }));
  });
  await page.goto(`/?section=workflowMemory&api=${encodeURIComponent(apiBase)}`);

  await expect(page.getByRole("heading", { name: "我的模板" })).toBeVisible();
  await page.getByRole("button", { name: /创建我的模板/ }).first().click();
  await page.getByLabel("案例 1 的历史输入").setInputFiles(join(historyPath, "询价单-RFQ-001.md"));
  await page.getByLabel("案例 1 的最终输出").setInputFiles(join(historyPath, "报价单-RFQ-001.md"));
  await page.getByRole("button", { name: "开始学习" }).click();

  await expect(page.getByText(/系统正在后台整理/)).toBeVisible();
  await expect(page.getByRole("button", { name: /通知：.*需要处理/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /通知：.*需要处理/ }).click();
  await expect(page.getByText("模板已整理，等待检查")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "客户询价报价", exact: true }).click();
  await expect(page.getByLabel("模板名称")).toHaveValue("客户询价报价");
  await expect(page.getByLabel(/第 .* 步/).first()).toBeVisible();
  await page.getByRole("button", { name: "保存并启用这个模板" }).click();
  await expect(page.getByRole("heading", { name: "这个模板已经可以使用" })).toBeVisible();

  const learningTasks = await call("/api/workflow-memory/template-learning");
  expect(learningTasks.tasks).toHaveLength(1);
  expect(learningTasks.tasks[0]).toMatchObject({ stage: "completed", progress: 100 });

  const state = await call("/api/state");
  expect(state.projects).toHaveLength(1);
  const trackedWork = await call("/api/work-items");
  const learningWorkItem = trackedWork.workItems.find(
    (item: { id: string }) => item.id === learningTasks.tasks[0].workItemId,
  );
  expect(learningWorkItem).toMatchObject({ status: "done", waitingOn: "none" });
  expect(learningWorkItem.body).toContain("原始文件不会被修改");
  const projectId = state.currentProjectId ?? state.projects[0].id;
  const assisted = await call("/api/work-items/assist/draft", {
    method: "POST",
    body: {
      projectId,
      title: "根据客户询价生成报价单",
      body: "使用客户询价资料，最终生成可以交付的报价单。",
    },
  });
  expect(assisted.draft.templateMatch.state).toBe("matched");
  expect(assisted.draft.templateMatch.selected.name).toBe("客户询价报价");

  const selected = assisted.draft.templateMatch.selected;
  const created = await call("/api/work-items", {
    method: "POST",
    body: {
      projectId,
      title: "根据客户询价生成报价单",
      body: "使用客户询价资料，最终生成可以交付的报价单。",
      acceptanceCriteria: assisted.draft.acceptanceCriteria,
      verificationSop: assisted.draft.verificationSop,
    },
  });
  expect(created.workItem.myTemplateBinding.definitionId).toBe(selected.definitionId);
  expect(created.workItem.myTemplateBinding.name).toBe(selected.name);
  expect(created.workItem.myTemplateBinding.version).toBe(1);
  expect(created.workItem.myTemplateBinding.snapshot.steps.map((step: { key: string }) => step.key))
    .toContain("generate_output");
});
