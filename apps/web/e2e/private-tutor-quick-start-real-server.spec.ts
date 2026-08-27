import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "playwright/test";

let apiBase = "";
let root = "";
let server: Server | null = null;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "myagenttool-private-tutor-quick-start-"));
  const { createServerState } = await import("../../server/src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../server/src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../server/src/runtime/http-server.mjs");
  const now = () => new Date().toISOString();
  const { defaultProject, state } = createServerState({ defaultProjectPath: root, now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "private-tutor-quick-start-e2e",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: root,
    persistenceEnabled: false,
    stateStorePath: join(root, "unused.json"),
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: "private-tutor-quick-start-e2e",
    protocolVersion: "0.0.0",
    ...httpDependencies,
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("private tutor server address unavailable");
  apiBase = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(resolve));
  if (root) rmSync(root, { recursive: true, force: true });
});

test("a learner reaches a five-minute lesson and starts an evidence-only fourteen-day trial", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const login = await page.context().request.post(`${apiBase}/api/session`, { data: { mode: "local" } });
  expect(login.ok()).toBe(true);

  await page.goto(`/?section=privateTutor&api=${encodeURIComponent(apiBase)}`);
  await page.getByLabel("私教怎么称呼你").fill("快速试学");
  await page.getByLabel("当前学习阶段").selectOption({ label: "中学课程" });
  await page.getByRole("button", { name: "开始我的学习" }).click();
  await page.getByRole("button", { name: /快速学一个知识点/ }).click();

  await expect(page.getByRole("heading", { name: "选择一个知识点，3 题后开始学" })).toBeVisible();
  await page.getByRole("button", { name: /等式两边同乘同除/ }).click();
  await page.getByRole("button", { name: "开始 3 题快速摸底" }).click();

  for (let index = 1; index <= 3; index += 1) {
    await expect(page.getByText(`第 ${index} 题 · 共 3 题`)).toBeVisible();
    await expect(page.getByText("等式平衡", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "我暂时不会" }).click();
  }

  await expect(page.getByRole("heading", { name: "3 题快速摸底完成" })).toBeVisible();
  const beforeLesson = await page.context().request.get(`${apiBase}/api/private-tutor/profile/snapshot`);
  expect(beforeLesson.ok()).toBe(true);
  const beforeBody = await beforeLesson.json() as {
    snapshot: { knowledge: Array<{ id: string; mastery: number | null; level: string }> };
    strategyDecision: { targetKnowledgeId: string };
  };
  expect(beforeBody.snapshot.knowledge.find((item) => item.id === "balance")).toMatchObject({ mastery: 0.35, level: "needs_support" });
  expect(beforeBody.snapshot.knowledge.filter((item) => item.id !== "balance").every((item) => item.level === "unknown")).toBe(true);
  expect(beforeBody.strategyDecision.targetKnowledgeId).toBe("balance");

  await page.getByRole("button", { name: "开始 5 分钟私教" }).click();
  await expect(page.getByText("回想一下 · 约 1 分钟")).toBeVisible();
  await expect(page.getByRole("heading", { name: "等式两边同乘同除" })).toBeVisible();
  await expect(page.getByText("2x = 10，x 是多少？")).toBeVisible();

  const currentSession = await page.context().request.get(`${apiBase}/api/private-tutor/profile/tutoring-sessions/current`);
  expect(currentSession.ok()).toBe(true);
  const sessionBody = await currentSession.json() as { session: { pace: string; plannedMinutes: number; targetKnowledgeId: string } };
  expect(sessionBody.session).toMatchObject({ pace: "easy", plannedMinutes: 5, targetKnowledgeId: "balance" });

  await page.getByRole("button", { name: "我的成长" }).click();
  await expect(page.getByRole("heading", { name: /验证次日还能不能想起/ })).toBeVisible();
  await page.getByLabel("试学目标").fill("验证我能否真正掌握方程平衡");
  await page.getByRole("button", { name: "开始 14 天试学" }).click();
  await expect(page.getByText("试学中 · 第 1/14 天")).toBeVisible();
  await expect(page.getByText("自动化测试只验证记录是否正确；只有你真实学习产生的样本，才会进入这里的结果。")).toBeVisible();
  const trial = await page.context().request.get(`${apiBase}/api/private-tutor/profile/learning-trial`);
  expect(trial.ok()).toBe(true);
  const trialBody = await trial.json() as { trial: { durationDays: number; status: string; metrics: { nextDayRecall: { retentionRate: number | null } } } };
  expect(trialBody.trial).toMatchObject({ durationDays: 14, status: "active" });
  expect(trialBody.trial.metrics.nextDayRecall.retentionRate).toBeNull();
  await testInfo.attach("private-tutor-fourteen-day-trial", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
