import { expect, test, type Page } from "playwright/test";

const host = {
  id: "ssh_target_ordinary",
  name: "网站主机",
  host: "10.10.10.222",
  port: 22,
  user: "deploy",
  authMethod: "password_ref",
  credentialRef: "credential://ssh/ssh_target_ordinary",
  purposes: ["file_transfer", "site_publish"],
  networkPolicy: "allow_private_network",
  knownHostFingerprint: "SHA256:ordinary-host-fixture",
  observedFingerprint: "SHA256:ordinary-host-fixture",
  connectionStatus: "ready",
  capabilities: { sftp: true, sftpVersion: 3, posixRename: true, symlink: true },
  lastConnectionError: null,
  verifiedAt: "2026-08-27T00:00:00.000Z",
  revision: 4,
};

const scope = {
  id: "hfs_ordinary",
  sshTargetId: host.id,
  label: "网站文件",
  purpose: "site_publish",
  rootPath: "/srv/www/site",
  resolvedRootPath: "/srv/www/site",
  permissions: ["list", "upload", "download"],
  status: "ready",
  revision: 1,
  lastVerifiedAt: "2026-08-27T00:00:00.000Z",
};

type HostFixture = Omit<typeof host, "connectionStatus" | "lastConnectionError"> & {
  connectionStatus: string;
  lastConnectionError: null | { code: string; at: string };
};

async function mockOrdinaryHostApi(page: Page, fixture: { host?: HostFixture; scope?: typeof scope | null } = {}) {
  const currentHost = fixture.host ?? host;
  const currentScope = fixture.scope === undefined ? scope : fixture.scope;
  await page.route("http://127.0.0.1:5001/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/session") return route.fulfill({ json: { user: { id: "usr_owner", name: "Owner", teamId: "team_local", role: "owner" } } });
    if (path === "/api/state") return route.fulfill({ json: {
      projects: [], worktrees: [], projectTargets: [], pendingDecisions: [], evidenceLedger: [], invocations: [], events: [],
    } });
    if (path === "/api/hosts") return route.fulfill({ json: { hosts: [currentHost], count: 1 } });
    if (path === `/api/hosts/${currentHost.id}/file-scopes`) return route.fulfill({ json: { scopes: currentScope ? [currentScope] : [], count: currentScope ? 1 : 0 } });
    if (path === "/api/work-items") return route.fulfill({ json: { workItems: [], count: 0, hasMore: false, nextCursor: null } });
    if (path === "/api/work-items/attention") return route.fulfill({ json: { items: [], metrics: null, nextCursor: null } });
    if (path === "/api/planning-projects") return route.fulfill({ json: { projects: [] } });
    if (path === "/api/auto-runs") return route.fulfill({ json: { autoRuns: [] } });
    return route.fulfill({ json: {} });
  });
}

test("ordinary owners use My Hosts directly on desktop and mobile without professional metadata", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("myagenttool-ui", JSON.stringify({
      state: { locale: "zh-CN", section: "myHosts", experienceMode: "ordinary" },
      version: 1,
    }));
  });
  await mockOrdinaryHostApi(page);
  await page.goto("/?section=myHosts");

  await expect(page.getByRole("heading", { name: "连接和使用我的设备" })).toBeVisible();
  await expect(page.getByText("网站主机").first()).toBeVisible();
  await expect(page.getByText("允许访问的文件夹")).toBeVisible();
  await expect(page.getByRole("button", { name: "远程文件" })).toBeVisible();
  await expect(page.getByRole("button", { name: "传输任务" })).toBeVisible();
  await expect(page.getByRole("button", { name: "设置", exact: true })).toHaveCount(0);
  await expect(page.getByText("deploy@10.10.10.222:22")).toHaveCount(0);
  await expect(page.getByText("10.10.10.222", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("my-hosts-ordinary-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "连接和使用我的设备" })).toBeVisible();
  await expect(page.getByRole("button", { name: "远程文件" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("my-hosts-ordinary-mobile.png"), fullPage: true });
});

test("ordinary setup explains local-network permission before connecting", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("myagenttool-ui", JSON.stringify({
      state: { locale: "zh-CN", section: "myHosts", experienceMode: "ordinary" },
      version: 1,
    }));
  });
  await mockOrdinaryHostApi(page);
  await page.goto("/?section=myHosts");

  await page.getByRole("button", { name: "连接设备" }).first().click();
  await expect(page.getByRole("heading", { name: "连接我的设备" })).toBeVisible();
  await page.getByLabel("设备地址").fill("10.10.10.222");
  const consent = page.getByLabel(/允许连接我的局域网设备/);
  await expect(consent).toBeVisible();
  await expect(consent).not.toBeChecked();
  await page.getByRole("button", { name: "连接这台设备" }).click();
  await expect(page.getByRole("alert")).toContainText("请先确认允许连接这台局域网设备");
  await expect(page.getByText("1. 连接设备")).toBeVisible();
  await expect(page.getByText("2. 确认是我的")).toBeVisible();
  await expect(page.getByText("3. 允许文件夹")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("my-hosts-local-permission.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("ordinary recovery stays actionable at a 320 px viewport without exposing the error code", async ({ page }, testInfo) => {
  const failedHost = {
    ...host,
    name: "家庭资料服务器——需要重新登录的超长设备名称",
    connectionStatus: "error",
    lastConnectionError: { code: "ssh_authentication_failed", at: "2026-08-27T00:00:00.000Z" },
  };
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    localStorage.setItem("myagenttool-ui", JSON.stringify({
      state: { locale: "zh-CN", section: "myHosts", experienceMode: "ordinary" },
      version: 1,
    }));
  });
  await mockOrdinaryHostApi(page, { host: failedHost, scope: null });
  await page.goto("/?section=myHosts");

  await expect(page.getByText("需要处理").first()).toBeVisible();
  await expect(page.getByText("登录信息需要更新")).toBeVisible();
  const recovery = page.getByRole("button", { name: "重新输入登录信息" });
  await expect(recovery).toBeVisible();
  await expect(page.getByText("ssh_authentication_failed")).toHaveCount(0);
  await recovery.click();
  await expect(page.getByRole("heading", { name: "连接我的设备" })).toBeVisible();
  await expect(page.getByPlaceholder("留空则使用已安全保存的密码")).toHaveCount(0);
  await page.getByRole("button", { name: "连接这台设备" }).click();
  await expect(page.getByRole("alert")).toContainText("请输入登录密码");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("my-hosts-ordinary-recovery-320.png"), fullPage: true });
});
