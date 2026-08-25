import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "playwright/test";

let apiBase = "";
let workspaceRoot = "";
let server: Server | null = null;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "myagenttool-my-site-"));
  const { createServerState } = await import("../../server/src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../server/src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../server/src/runtime/http-server.mjs");
  const now = () => new Date().toISOString();
  const { defaultProject, state } = createServerState({ defaultProjectPath: workspaceRoot, now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "my-site-real-e2e",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: workspaceRoot,
    persistenceEnabled: false,
    stateStorePath: join(workspaceRoot, "state.json"),
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: "my-site-real-e2e",
    protocolVersion: "0.0.0",
    ...httpDependencies,
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("real site server address unavailable");
  apiBase = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  rmSync(workspaceRoot, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: { locale: "zh-CN", section: "mySite", experienceMode: "ordinary" },
    }));
  });
});

test("ordinary user can republish a title-only edit and restore a local release", async ({ page }) => {
  await page.goto(`/?section=mySite&api=${encodeURIComponent(apiBase)}`);

  await page.getByLabel("站点名称").fill("青屿设计工作室");
  await page.getByLabel("一句话介绍").fill("让复杂产品更容易被理解");
  await page.getByRole("button", { name: "创建站点" }).click();
  await expect(page.getByText("网站初稿有 5 项内容等待首次发布")).toBeVisible();
  await expect(page.getByText("/ · 页面")).toHaveCount(0);
  await expect(page.getByText("网站发布进度")).toBeVisible();
  await expect(page.getByRole("button", { name: "先预览网站" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const publishButtonBox = await page.getByRole("button", { name: "发布网站" }).boundingBox();
  expect(publishButtonBox).not.toBeNull();
  expect((publishButtonBox?.x ?? 0) + (publishButtonBox?.width ?? 0)).toBeLessThanOrEqual(390);
  const guideToggle = page.getByRole("button", { name: "收起步骤" });
  await guideToggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /查看步骤 1\/4/ })).toBeVisible();
  await page.getByRole("button", { name: /查看步骤 1\/4/ }).click();
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole("button", { name: "预览", exact: true }).click();
  const previewDialog = page.getByRole("dialog", { name: "网站预览" });
  const frame = previewDialog.getByTitle("网站草稿预览");
  await previewDialog.getByRole("button", { name: "手机预览" }).click();
  await expect.poll(async () => Math.round((await frame.boundingBox())?.width ?? 0)).toBe(390);
  await previewDialog.getByRole("button", { name: "关闭" }).click();

  await page.getByRole("tab", { name: "站点样式" }).click();
  await expect(page.getByLabel("已选择的站点标志")).toBeVisible();
  await expect(page.getByLabel("上传新标志")).toHaveCount(1);
  await page.getByRole("tab", { name: "页面与文章" }).click();

  await page.getByRole("button", { name: "发布网站" }).click();
  await page.getByRole("dialog", { name: "确认发布网站？" }).getByRole("button", { name: "确认发布" }).click();
  await expect(page.getByText("本地版本 v1")).toBeVisible();

  await page.getByRole("button", { name: "编辑：首页" }).click();
  await page.getByLabel("页面标题").fill("欢迎来到青屿设计工作室");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByText("1 项未发布修改", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "发布网站" })).toBeEnabled();

  await page.getByRole("button", { name: "发布网站" }).click();
  const secondPublish = page.getByRole("dialog", { name: "确认发布网站？" });
  await expect(secondPublish.getByText("欢迎来到青屿设计工作室")).toBeVisible();
  await secondPublish.getByRole("button", { name: "确认发布" }).click();
  await expect(page.getByText("本地版本 v2")).toBeVisible();

  await page.getByRole("button", { name: "恢复上一版本" }).click();
  const restore = page.getByRole("dialog", { name: "恢复上一版本？" });
  await expect(restore.getByText(/已生成的网站版本会恢复到版本 1/)).toBeVisible();
  await expect(restore.getByText(/线上网站会立即恢复/)).toHaveCount(0);
  await restore.getByRole("button", { name: "恢复上一版本" }).click();
  await expect(page.getByRole("status")).toContainText("已恢复上一版本");
});

test("ordinary go-live choices hand off an empty Alibaba Cloud checklist to a technical user", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?section=mySite&api=${encodeURIComponent(apiBase)}`);
  await expect(page.getByText("本地版本 v1")).toBeVisible();
  await page.getByRole("button", { name: "完成上线设置", exact: true }).click();

  const guide = page.getByRole("dialog", { name: "让访客可以打开网站" });
  await guide.getByRole("button", { name: "主要面向中国大陆访客" }).click();
  await expect(guide.getByText(/ICP 备案/)).toBeVisible();
  await guide.getByRole("button", { name: "下一步" }).click();
  await guide.getByRole("button", { name: "使用自己的域名" }).click();
  await guide.getByRole("button", { name: "下一步" }).click();
  await guide.getByRole("button", { name: "交给技术人员配置" }).click();
  await expect(guide.getByText(/真实资料尚未填写/)).toBeVisible();
  await guide.getByRole("button", { name: "打开配置页面" }).click();

  await expect(page.getByRole("heading", { name: "站点专业设置" })).toBeVisible();
  await expect(page.getByText("已从上线向导带入选择")).toBeVisible();
  await expect(page.getByLabel("托管方式")).toHaveValue("aliyun_oss_cdn");
  await expect(page.getByLabel("OSS Bucket")).toHaveValue("");
  await expect(page.getByLabel("自定义域名")).toHaveValue("");
  const handoff = await page.evaluate(() => window.sessionStorage.getItem("myagenttool-site-go-live-handoff"));
  expect(handoff).toContain('"audience":"mainland"');
  expect(handoff).not.toContain("AccessKey");
});

test("controlled pilot records status understanding without changing the ordinary workflow", async ({ page }) => {
  const createdCampaign = await page.request.post(`${apiBase}/api/site-pilot/campaigns`, { data: { quotas: { first_setup: 1, content_maintenance: 1, status_understanding: 1 } } });
  expect(createdCampaign.ok()).toBe(true);
  const campaign = (await createdCampaign.json()).campaign;
  const generatedInvitation = await page.request.post(`${apiBase}/api/site-pilot/campaigns/${campaign.id}/invitations`, { data: { scenario: "status_understanding" } });
  expect(generatedInvitation.ok()).toBe(true);
  const invitation = (await generatedInvitation.json()).invitation;
  await page.goto(`/?section=mySite&sitePilot=${encodeURIComponent(invitation.inviteCode)}&pilotTask=status_understanding&api=${encodeURIComponent(apiBase)}`);
  await expect(page.getByText("真实用户试用")).toBeVisible();
  await expect(page.getByText(/独立的.*临时站点/)).toBeVisible();
  await expect(page.getByText("试用示例官网")).toBeVisible();
  await expect(page.getByText("青屿设计工作室")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发布网站" })).toHaveCount(0);
  await expect(page.getByText(/不采集页面正文、自由文本、账号或云平台凭据/)).toBeVisible();
  await expect(page.getByLabel("本次任务", { exact: true })).toBeDisabled();
  await expect(page.getByText(/任务已由邀请链接分配/)).toBeVisible();
  await page.getByLabel("我已了解并同意记录本次任务步骤").check();
  await page.getByRole("button", { name: "开始试用任务" }).click();
  await expect(page.getByText(/试用记录中：判断网站是否真正上线/)).toBeVisible();
  await page.getByLabel("你认为网站目前是什么状态？").selectOption("local");
  await page.getByRole("button", { name: "完成并提交" }).click();
  await expect(page.getByText(/试用记录中：/)).toHaveCount(0);

  const summary = await page.request.get(`${apiBase}/api/site-pilot/summary`);
  expect(summary.ok()).toBe(true);
  expect((await summary.json()).summary.metrics.statusUnderstanding).toEqual({ numerator: 1, denominator: 1, rate: 1 });
  const campaigns = await page.request.get(`${apiBase}/api/site-pilot/campaigns`);
  const campaignResult = (await campaigns.json()).campaigns[0];
  expect(campaignResult.summary.metrics.statusUnderstanding).toEqual({ numerator: 1, denominator: 1, rate: 1 });
  expect(campaignResult.invitationCounts.status_understanding.completed).toBe(1);
  const productionSites = await page.request.get(`${apiBase}/api/sites`);
  expect((await productionSites.json()).sites[0].name).toBe("青屿设计工作室");

  await page.reload();
  await expect(page.getByText(/一次性邀请链接已经使用/)).toBeVisible();
  await expect(page.getByRole("button", { name: "开始试用任务" })).toBeDisabled();
  expect((await page.request.delete(`${apiBase}/api/site-pilot/campaigns/${campaign.id}`)).ok()).toBe(true);
});

test("maintenance pilot starts from a clean baseline and guides the user back to submit", async ({ page }) => {
  const productionBefore = await (await page.request.get(`${apiBase}/api/sites`)).json();
  const productionSite = productionBefore.sites[0];
  const createdCampaign = await page.request.post(`${apiBase}/api/site-pilot/campaigns`, { data: {} });
  expect(createdCampaign.ok()).toBe(true);
  const campaign = (await createdCampaign.json()).campaign;
  const generatedInvitation = await page.request.post(`${apiBase}/api/site-pilot/campaigns/${campaign.id}/invitations`, { data: { scenario: "content_maintenance" } });
  expect(generatedInvitation.ok()).toBe(true);
  const invitation = (await generatedInvitation.json()).invitation;

  await page.goto(`/?section=mySite&sitePilot=${encodeURIComponent(invitation.inviteCode)}&pilotTask=content_maintenance&api=${encodeURIComponent(apiBase)}`);
  await expect(page.getByRole("region", { name: "任务说明" })).toContainText("将页面标题改为“欢迎了解山岚工作室”");
  await expect(page.getByText("所有修改均已发布")).toBeVisible();
  await expect(page.getByText("本地版本 v1")).toBeVisible();
  await page.getByLabel("我已了解并同意记录本次任务步骤").check();
  await page.getByRole("button", { name: "开始试用任务" }).click();
  await page.getByRole("button", { name: "编辑：首页" }).click();
  await page.getByLabel("页面标题").fill("欢迎了解山岚工作室");
  await page.getByRole("button", { name: "保存修改" }).click();

  await expect(page.getByText("1 项未发布修改", { exact: true })).toBeVisible();
  await expect(page.getByText("修改已保存，本次任务不需要发布。")).toBeVisible();
  await page.getByRole("button", { name: "提交体验结果" }).click();
  await expect(page.getByRole("button", { name: "完成并提交" })).toBeVisible();
  await page.getByRole("button", { name: "完成并提交" }).click();
  await expect(page.getByText("本次试用已提交，感谢参与。")).toBeVisible();

  const productionAfter = await (await page.request.get(`${apiBase}/api/sites`)).json();
  expect(productionAfter.sites[0].id).toBe(productionSite.id);
  expect(productionAfter.sites[0].name).toBe(productionSite.name);
  expect(productionAfter.sites[0].revision).toBe(productionSite.revision);
  expect((await page.request.delete(`${apiBase}/api/site-pilot/campaigns/${campaign.id}`)).ok()).toBe(true);
});

test("ordinary user can create, preview, and publish a case through the guided flow", async ({ page }) => {
  await page.goto(`/?section=mySite&api=${encodeURIComponent(apiBase)}`);
  await page.getByRole("button", { name: "添加案例" }).click();
  const wizard = page.getByRole("dialog", { name: "添加客户案例" });
  await wizard.getByLabel("案例名称").fill("山岚品牌咨询转化提升");
  await wizard.getByLabel("一句话成果").fill("重新组织官网信息后，访客更容易完成咨询。");
  await wizard.getByLabel("客户或项目名称（可选）").fill("山岚工作室");
  await wizard.getByRole("button", { name: "下一步" }).click();
  await wizard.getByLabel("当时遇到什么问题？").fill("原有网站无法清楚说明服务价值，访客不知道下一步应该做什么。");
  await wizard.getByLabel("你是怎么解决的？").fill("重新组织首页信息，并缩短从服务介绍到咨询入口的路径。");
  await wizard.getByLabel("最终取得了什么成果？").fill("服务价值更容易理解。\n咨询入口更容易找到。");
  await wizard.getByRole("button", { name: "下一步" }).click();
  await expect(wizard.getByText(/首页会自动出现“精选案例”/)).toBeVisible();
  await wizard.getByRole("button", { name: "保存并预览" }).click();

  const preview = page.getByRole("dialog", { name: "网站预览" });
  await expect(preview).toBeVisible();
  await expect(page.frameLocator('iframe[title="网站草稿预览"]').getByText("山岚品牌咨询转化提升")).toBeVisible();
  await preview.getByRole("button", { name: "关闭" }).click();
  await expect(page.getByText("案例草稿已保存，并已加入当前语言的首页案例展示。发布后访客即可看到。")).toBeVisible();
  await expect(page.getByText("山岚品牌咨询转化提升", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "发布网站" }).click();
  const publication = page.getByRole("dialog", { name: "确认发布网站？" });
  await expect(publication.getByRole("listitem").filter({ hasText: "山岚品牌咨询转化提升" })).toBeVisible();
  await publication.getByRole("button", { name: "确认发布" }).click();
  await expect(page.getByText("所有修改均已发布")).toBeVisible();
});

test("ordinary user can create and publish an isolated English home page", async ({ page }) => {
  const currentResponse = await page.request.get(`${apiBase}/api/sites`);
  expect(currentResponse.ok()).toBe(true);
  const currentSite = (await currentResponse.json()).sites[0];
  const home = currentSite.entries.find((entry: { slug: string; locale?: string }) => entry.slug === "home" && (entry.locale ?? currentSite.defaultLocale) === currentSite.defaultLocale);
  expect(home).toBeTruthy();
  const enabled = await page.request.patch(`${apiBase}/api/sites/${currentSite.id}`, {
    data: { expectedRevision: currentSite.revision, settings: { ...currentSite.settings, supportedLocales: ["zh-CN", "en-US"] } },
  });
  expect(enabled.ok()).toBe(true);

  await page.goto(`/?section=mySite&api=${encodeURIComponent(apiBase)}`);
  await page.getByLabel("内容语言").selectOption("en-US");
  await expect(page.getByText("未翻译").first()).toBeVisible();
  await page.getByRole("button", { name: `创建英文版：${home.title}` }).click();
  const translation = page.getByRole("dialog", { name: "创建英文翻译草稿" });
  await expect(translation.getByText(/图片和安全链接会保留/)).toBeVisible();
  await translation.getByLabel("英文标题").fill("Home");
  await translation.getByLabel("英文摘要").fill("Clear product stories for growing teams.");
  await translation.getByRole("button", { name: "创建并继续翻译" }).click();

  const editor = page.getByRole("dialog", { name: "Home" });
  await expect(editor.getByLabel("页面标题")).toHaveValue("Home");
  await editor.getByRole("button", { name: "取消" }).click();
  await expect(page.getByText("翻译草稿已创建，请继续翻译页面中的可见文字。")).toBeVisible();
  await page.getByRole("button", { name: "预览页面：Home" }).click();
  const preview = page.getByRole("dialog", { name: "网站预览" });
  await expect(page.frameLocator('iframe[title="网站草稿预览"]').getByRole("heading", { name: "Home" })).toBeVisible();
  await preview.getByRole("button", { name: "关闭" }).click();

  await page.getByRole("button", { name: "发布网站" }).click();
  await page.getByRole("dialog", { name: "确认发布网站？" }).getByRole("button", { name: "确认发布" }).click();
  await expect(page.getByText("所有修改均已发布")).toBeVisible();
  const englishPreview = await page.request.get(`${apiBase}/api/sites/${currentSite.id}/preview?path=en%2Findex.html`);
  expect(englishPreview.ok()).toBe(true);
  const html = (await englishPreview.json()).preview.html as string;
  expect(html).toContain('<html lang="en-US">');
  expect(html).toContain('hreflang="zh-CN"');
  expect(html).not.toContain('href="/contact/"');
});
