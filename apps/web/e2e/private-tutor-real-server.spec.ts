import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "playwright/test";

const diagnosticAnswers: Record<string, string> = {
  "diag-int-01-v1": "-3",
  "diag-int-02-v1": "3",
  "diag-int-03-v1": "13",
  "diag-eqm-01-v1": "b",
  "diag-eqm-02-v1": "5",
  "diag-eqm-03-v1": "4",
  "diag-bal-01-v1": "b",
  "diag-bal-02-v1": "5",
  "diag-bal-03-v1": "3",
  "diag-word-01-v1": "5",
  "diag-word-02-v1": "4",
  "diag-word-03-v1": "3",
};

let apiBase = "";
let root = "";
let server: Server | null = null;

async function openPrivateTutor(page: Page) {
  await page.goto(`/?section=privateTutor&api=${encodeURIComponent(apiBase)}`);
}

async function csrfHeaders(page: Page) {
  const csrf = (await page.context().cookies(apiBase)).find((cookie) => cookie.name === "myagenttool_csrf")?.value;
  if (!csrf) throw new Error("CSRF cookie unavailable");
  return { "X-CSRF-Token": csrf };
}

async function assertVisibleControlsHaveNames(page: Page) {
  const unnamed = await page.locator("button:visible, input:visible, select:visible, textarea:visible").evaluateAll((elements) =>
    elements
      .filter((element) => {
        const html = element as HTMLElement;
        const labelledBy = html.getAttribute("aria-labelledby");
        const label = html.getAttribute("aria-label")
          || (labelledBy ? document.getElementById(labelledBy)?.textContent : "")
          || html.closest("label")?.textContent
          || html.textContent
          || (html instanceof HTMLInputElement ? html.placeholder : "");
        return !label?.trim();
      })
      .map((element) => element.outerHTML),
  );
  expect(unnamed, `visible controls without an accessible name: ${unnamed.join("\n")}`).toEqual([]);
}

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "myagenttool-private-tutor-browser-"));
  const { createServerState } = await import("../../server/src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../server/src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../server/src/runtime/http-server.mjs");
  const now = () => new Date().toISOString();
  const { defaultProject, state } = createServerState({ defaultProjectPath: root, now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "private-tutor-e2e",
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
    namespace: "private-tutor-e2e",
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

test("a signed-in learner keeps one personal profile and never sees family handoff UI", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const login = await page.context().request.post(`${apiBase}/api/session`, {
    data: { mode: "local" },
  });
  expect(login.ok()).toBe(true);

  await openPrivateTutor(page);
  await expect(page.getByRole("heading", { name: "为我建立一份长期学习档案" })).toBeVisible();
  await expect(page.getByText("选择孩子")).toHaveCount(0);
  await expect(page.getByLabel("家长 PIN")).toHaveCount(0);

  await page.getByLabel("私教怎么称呼你").fill("小禾");
  await page.getByLabel("当前学习阶段").selectOption({ label: "大学课程" });
  await assertVisibleControlsHaveNames(page);
  await page.getByRole("button", { name: "开始我的学习" }).click();

  await expect(page.getByRole("heading", { name: "先选择这次想学什么" })).toBeVisible();
  await expect(page.getByRole("button", { name: "家长入口" })).toHaveCount(0);
  await testInfo.attach("private-tutor-learner-profile", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  const profile = await page.context().request.get(`${apiBase}/api/private-tutor/profile`);
  expect(profile.ok()).toBe(true);
  const profileBody = await profile.json() as { profile: { id: string; displayName: string } | null; migrationRequired: boolean };
  expect(profileBody.profile?.displayName).toBe("小禾");
  expect(profileBody.migrationRequired).toBe(false);

  await page.reload();
  await expect(page.getByRole("heading", { name: "先选择这次想学什么" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "为我建立一份长期学习档案" })).toHaveCount(0);

  const snapshot = await page.context().request.get(`${apiBase}/api/private-tutor/profile/snapshot`);
  expect(snapshot.ok()).toBe(true);
  const snapshotBody = await snapshot.json() as { profile: { id: string }; snapshot: { learnerId: string } };
  expect(snapshotBody.snapshot.learnerId).toBe(profileBody.profile?.id);

  await page.route(`**/api/private-tutor/profile/snapshot`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "injected_snapshot_outage" }),
    });
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "学习空间暂时没有准备好" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("避免显示错误或演示数据");
  await expect(page.getByRole("button", { name: "今日学习" })).toHaveCount(0);
  await page.unroute(`**/api/private-tutor/profile/snapshot`);
  await page.getByRole("button", { name: "重新读取" }).click();
  await expect(page.getByRole("heading", { name: "先选择这次想学什么" })).toBeVisible();

  await page.getByRole("button", { name: /选择课程或导入我的教材/ }).click();
  await expect(page.getByRole("heading", { name: "我的设置" })).toBeVisible();
  await expect(page.getByText("选择学习内容")).toBeVisible();
  await page.getByRole("button", { name: "返回开始方式" }).click();
  await page.getByRole("button", { name: /用当前内容开始摸底/ }).click();
  await expect(page.getByRole("heading", { name: "先让我认识一下你会什么" })).toBeVisible();
  await page.getByRole("button", { name: "开始摸底" }).click();
  await expect(page.getByLabel("写下答案")).toBeVisible();

  let assessment = await page.context().request.get(`${apiBase}/api/private-tutor/profile/assessments/current`).then((response) => response.json()) as {
    assessment: { id: string; status: string; revision: number; currentQuestion: { revisionId: string } | null };
  };
  let answerIndex = 0;
  while (assessment.assessment.status !== "completed") {
    const revisionId = assessment.assessment.currentQuestion?.revisionId;
    if (!revisionId || !diagnosticAnswers[revisionId]) throw new Error(`unexpected diagnostic question: ${revisionId ?? "none"}`);
    const answerResponse = await page.context().request.post(`${apiBase}/api/private-tutor/profile/assessments/${assessment.assessment.id}/answers`, {
      headers: await csrfHeaders(page),
      data: {
        idempotencyKey: `browser-diagnostic-${answerIndex++}`,
        questionRevisionId: revisionId,
        rawAnswer: diagnosticAnswers[revisionId],
        responseKind: "answer",
        source: "screen",
        durationSeconds: 1,
      },
    });
    const answerBody = await answerResponse.json() as typeof assessment & { error?: string };
    expect(answerResponse.ok(), `${answerResponse.status()} ${answerBody.error ?? "unknown error"} for ${revisionId}`).toBe(true);
    assessment = answerBody;
  }

  await page.reload();
  await expect(page.getByRole("button", { name: "今日学习" })).toBeVisible();
  await page.getByRole("button", { name: "我的设置", exact: true }).click();
  await page.getByLabel("每天可用时间").fill("25");
  await expect(page.getByRole("status")).toContainText("每日学习时长已保存");
  await page.getByRole("button", { name: /AI 私教/ }).click();
  await page.getByLabel("老师的讲解方式").selectOption("case_driven");
  await expect(page.getByRole("status")).toContainText("学习偏好已保存");
  await page.getByLabel("追问方式").selectOption("direct_check");
  await expect(page.getByRole("status")).toContainText("学习偏好已保存");

  const preferences = await page.context().request.get(`${apiBase}/api/private-tutor/profile/preferences`);
  expect(preferences.ok()).toBe(true);
  const preferencesBody = await preferences.json() as { preferences: { dailyMinutes: number; teacherStyle: string; followUpStyle: string } };
  expect(preferencesBody.preferences).toMatchObject({ dailyMinutes: 25, teacherStyle: "case_driven", followUpStyle: "direct_check" });
  await testInfo.attach("private-tutor-persisted-preferences", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  await page.getByRole("button", { name: "今日学习" }).click();
  await expect(page.getByRole("button", { name: "按我的设置 25 分钟" })).toBeVisible();
  await page.getByRole("button", { name: /开始今天的学习/ }).click();
  await page.getByLabel("写下答案").fill("5");
  await page.getByRole("button", { name: "提交答案" }).click();
  await expect(page.getByText(/私教讲解 · 约/)).toBeVisible();

  await page.getByLabel("向私教追问").fill("为什么两边要做相同操作？");
  await page.getByRole("button", { name: "基于资料回答" }).click();
  await expect(page.getByText("依据审核课程内容")).toBeVisible();
  await expect(page.getByText(/不会读取题目答案，也不会改变掌握度/)).toBeVisible();
  await expect(page.getByText("本次追问不产生练习证据。")).toBeVisible();
  await assertVisibleControlsHaveNames(page);
  await testInfo.attach("private-tutor-grounded-follow-up", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
