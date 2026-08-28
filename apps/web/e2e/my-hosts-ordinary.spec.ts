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

async function mockOrdinaryHostApi(page: Page, fixture: { host?: HostFixture; scope?: typeof scope | null; transfers?: Array<Record<string, unknown>> } = {}) {
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
    if (currentScope && path === `/api/host-file-scopes/${currentScope.id}/entries`) return route.fulfill({ json: { scope: currentScope, path: "", count: 2, entries: [
      { name: "docs", path: "docs", type: "directory", accessible: true, size: null, modifiedAt: null },
      { name: "index.html", path: "index.html", type: "file", accessible: true, size: 1200, modifiedAt: null },
    ] } });
    if (currentScope && path === `/api/host-file-scopes/${currentScope.id}/search`) return route.fulfill({ json: {
      scopeId: currentScope.id, scopeRevision: currentScope.revision, count: 2, contentSearchEnabled: true,
      results: [
        { name: "部署说明.md", path: "docs/部署说明.md", type: "file", accessible: true, size: 1600, modifiedAt: null, matchKind: "content", previewKind: "text", restricted: false },
        { name: ".env", path: ".env", type: "file", accessible: true, size: 24, modifiedAt: null, matchKind: "name", previewKind: null, restricted: true },
      ],
      boundaries: { scannedEntries: 32, scannedTextFiles: 4, readBytes: 2048, skippedEntries: 1, truncated: false, maxDepth: 5, maxEntries: 500, maxResults: 50 },
    } });
    if (currentScope && path === `/api/host-file-scopes/${currentScope.id}/preview`) return route.fulfill({
      body: "这是限量读取的安全文本预览。",
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Host-Preview-Kind": "text", "Access-Control-Expose-Headers": "X-Host-Preview-Kind", "Cache-Control": "no-store" },
    });
    if (path === `/api/hosts/${currentHost.id}/file-transfers`) return route.fulfill({ json: { transfers: fixture.transfers ?? [], count: fixture.transfers?.length ?? 0 } });
    if (path === `/api/hosts/${currentHost.id}/assistant/plan`) return route.fulfill({ json: { plan: { action: "disk_usage", command: "df -h", risk: "read_only" } } });
    if (path === `/api/hosts/${currentHost.id}/diagnostics`) {
      const action = (route.request().postDataJSON() as { action?: string } | null)?.action;
      if (action === "ssh_login_audit") return route.fulfill({ json: { result: {
        action,
        command: "journalctl --since '-24 hours' -u ssh.service",
        output: [
          "2026-08-28T08:10:00+08:00 server sshd[101]: Accepted password for devagent from 10.10.10.5 port 51000 ssh2",
          "2026-08-28T08:20:00+08:00 server sshd[102]: Failed password for admin from 198.51.100.20 port 42000 ssh2",
        ].join("\n"),
        resolvedAddress: "10.10.10.222",
        summary: { version: 1, severity: "warning", finding: "ssh_login_audit_failures_found", impact: "login_attempts_need_review", nextAction: "review_login_audit_evidence", facts: [
          { key: "ssh_login_audit_success_count", value: "1", severity: "info" },
          { key: "ssh_login_audit_failure_count", value: "1", severity: "warning" },
        ] },
      } } });
      return route.fulfill({ json: { result: {
        action: "disk_usage",
        command: "df -h",
        output: "Filesystem\n/dev/private-volume 20G 19G 1G 95% /private/path",
        resolvedAddress: "10.10.10.222",
        summary: { version: 1, severity: "critical", finding: "disk_capacity_critical", impact: "file_operations_may_fail", nextAction: "free_device_space", facts: [{ key: "disk_used_percent", value: "95%", severity: "critical" }] },
      } } });
    }
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

  await expect(page.getByRole("heading", { name: "我的主机" })).toBeVisible();
  await expect(page.getByText("网站主机").first()).toBeVisible();
  await expect(page.getByText("我的文件夹")).toBeVisible();
  await expect(page.getByRole("button", { name: "文件", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "最近活动" })).toBeVisible();
  await expect(page.getByRole("button", { name: "设置", exact: true })).toHaveCount(0);
  await expect(page.getByText("deploy@10.10.10.222:22")).toHaveCount(0);
  await expect(page.getByText("10.10.10.222", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("my-hosts-ordinary-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "我的主机" })).toBeVisible();
  await expect(page.getByRole("button", { name: "文件", exact: true })).toBeVisible();
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

  await page.getByRole("button", { name: "添加设备" }).first().click();
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
  await expect(page.getByRole("heading", { name: "更新登录信息" })).toBeVisible();
  await expect(page.getByPlaceholder("留空则使用已安全保存的密码")).toHaveCount(0);
  await page.getByRole("button", { name: "保存并重新连接" }).click();
  await expect(page.getByRole("alert")).toContainText("请输入登录密码");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("my-hosts-ordinary-recovery-320.png"), fullPage: true });
});

test("ordinary extreme transfer states stay safe and readable at 320 px", async ({ page }, testInfo) => {
  const baseTransfer = {
    sshTargetId: host.id, scopeId: scope.id, direction: "upload", remoteDirectory: "reports", bytesTotal: 1200, bytesTransferred: 400,
    progress: 33, conflictPolicy: "rename", attempt: 1, maxAttempts: 3, retryOf: null, createdAt: "2026-08-27T00:00:00.000Z",
  };
  const transfers = [
    { ...baseTransfer, id: "hft_space", status: "failed", remotePath: "reports/archive.zip", fileName: "archive.zip", errorCode: "ssh_sftp_no_space", completedAt: "2026-08-27T00:00:01.000Z" },
    { ...baseTransfer, id: "hft_interrupted", status: "failed", remotePath: "reports/report.pdf", fileName: "report.pdf", errorCode: "host_file_transfer_interrupted", completedAt: "2026-08-27T00:00:01.000Z" },
    { ...baseTransfer, id: "hft_long", status: "running", remotePath: "reports/video.mp4", fileName: "video.mp4", errorCode: null, startedAt: new Date(Date.now() - 60_000).toISOString(), completedAt: null },
  ];
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    localStorage.setItem("myagenttool-ui", JSON.stringify({
      state: { locale: "zh-CN", section: "myHosts", experienceMode: "ordinary" },
      version: 1,
    }));
  });
  await mockOrdinaryHostApi(page, { transfers });
  await page.goto("/?section=myHosts");
  await page.getByRole("button", { name: "最近活动" }).click();

  await expect(page.getByText(/设备空间不足.*文件结果可能不完整/)).toBeVisible();
  await expect(page.getByRole("button", { name: "检查设备空间" })).toBeVisible();
  await expect(page.getByText(/无法判断传输是否完成/)).toBeVisible();
  await expect(page.getByRole("button", { name: "核对文件" })).toBeVisible();
  await expect(page.getByText("耗时较长")).toBeVisible();
  await expect(page.getByText(/请等待最终结果.*无法确认设备上的文件状态/)).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" })).toHaveCount(0);
  await expect(page.getByText("ssh_sftp_no_space")).toHaveCount(0);
  await expect(page.getByText("host_file_transfer_interrupted")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByText(/设备空间不足.*文件结果可能不完整/).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("my-hosts-extreme-transfers-320.png") });
});

test("ordinary host diagnosis runs directly and hides technical evidence at 320 px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    localStorage.setItem("myagenttool-ui", JSON.stringify({
      state: { locale: "zh-CN", section: "myHosts", experienceMode: "ordinary" },
      version: 1,
    }));
  });
  await mockOrdinaryHostApi(page);
  await page.goto("/?section=myHosts");

  await page.getByRole("button", { name: "磁盘空间" }).click();
  await expect(page.getByRole("button", { name: "确认检查" })).toHaveCount(0);

  await expect(page.getByText("设备空间严重不足")).toBeVisible();
  await expect(page.getByText(/上传、保存或发布文件可能失败/)).toBeVisible();
  await expect(page.getByText(/先清理一些设备空间，然后重试/)).toBeVisible();
  await expect(page.getByTestId("diagnostic-summary").getByText("95%", { exact: true })).toBeVisible();
  await expect(page.getByText("技术证据")).toHaveCount(0);
  await expect(page.getByText("df -h")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByText("设备空间严重不足").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("my-hosts-ai-diagnosis-320.png") });
});

test("ordinary owners see recent sign-ins as readable activity at 320 px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("myagenttool-ui", JSON.stringify({
      state: { locale: "zh-CN", section: "myHosts", experienceMode: "ordinary" },
      version: 1,
    }));
  });
  await mockOrdinaryHostApi(page);
  await page.goto("/?section=myHosts");

  await page.getByRole("button", { name: "最近登录", exact: true }).click();

  await expect(page.getByText("最近登录记录")).toBeVisible();
  await expect(page.getByText("devagent")).toBeVisible();
  await expect(page.getByText("来源: 10.10.10.5")).toBeVisible();
  await expect(page.getByText("admin")).toBeVisible();
  await expect(page.getByText("来源: 198.51.100.20")).toBeVisible();
  await expect(page.getByText("技术证据")).toHaveCount(0);
  await expect(page.getByText(/journalctl/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByTestId("login-audit-events").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("my-hosts-login-activity-320.png") });
});

test("ordinary approved-folder search and safe preview stay usable at 320 px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("myagenttool-ui", JSON.stringify({
      state: { locale: "zh-CN", section: "myHosts", experienceMode: "ordinary" },
      version: 1,
    }));
  });
  await mockOrdinaryHostApi(page);
  await page.goto("/?section=myHosts");
  await page.getByRole("button", { name: "文件", exact: true }).click();

  await expect(page.getByText("AI 文件助手")).toBeVisible();
  await page.getByPlaceholder("例如：部署说明，或 mytoolagent.com").fill("mytoolagent.com");
  await page.getByRole("button", { name: "查找文件" }).click();
  await expect(page.getByText("找到 2 个文件")).toBeVisible();
  await expect(page.getByText("部署说明.md")).toBeVisible();
  await expect(page.getByText("敏感文件，已限制")).toBeVisible();
  await expect(page.getByText(/SECRET=/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.getByRole("button", { name: "安全预览" }).click();
  await expect(page.getByText("预览：部署说明.md")).toBeVisible();
  await expect(page.getByText("这是限量读取的安全文本预览。")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("my-hosts-file-search-preview-320.png"), fullPage: true });
});
