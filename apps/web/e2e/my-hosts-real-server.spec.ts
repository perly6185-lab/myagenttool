import type { Server } from "node:http";
import https from "node:https";
import { createHash, generateKeyPairSync, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "playwright/test";

type Flow = "complete" | "safe_abort";

let apiBase = "";
let root = "";
let server: Server | null = null;
let sshServer: Server | null = null;
let httpsServer: Server | null = null;
let runtime: { httpDependencies: { persistStateNow: () => unknown } } | null = null;
let remoteFixtures: Awaited<ReturnType<typeof startRemoteFixtures>> | null = null;
const previousCredentialToken = process.env.MYAGENT_DESKTOP_CREDENTIAL_TOKEN;
const visualQaDir = join(fileURLToPath(new URL(".", import.meta.url)), "../../../docs/engineering/visual-qa/my-hosts-operations-pilot");

test.describe.configure({ mode: "serial" });

async function startRemoteFixtures({ root: fixtureRoot, flow, ssh2, createSshHostConnector, createPinnedWebsiteHealthChecker, sshHostFingerprint }: { root: string; flow: Flow; ssh2: any; createSshHostConnector: (options: any) => any; createPinnedWebsiteHealthChecker: (options: any) => any; sshHostFingerprint: (key: Buffer) => string }) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" } });
  const parsedKey = ssh2.utils.parseKey(privateKey);
  const fingerprint = sshHostFingerprint(parsedKey.getPublicSSH());
  const websiteHostname = "site.real-e2e.example.com";
  const websiteBody = "real myagenttool website\n";
  const keyPath = join(fixtureRoot, "website-key.pem");
  const certPath = join(fixtureRoot, "website-cert.pem");
  const configPath = join(fixtureRoot, "website-openssl.cnf");
  writeFileSync(configPath, `[req]\ndistinguished_name = dn\nx509_extensions = ext\nprompt = no\n[dn]\nCN = ${websiteHostname}\n[ext]\nsubjectAltName = DNS:${websiteHostname}\nextendedKeyUsage = serverAuth\n`);
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", keyPath, "-out", certPath, "-config", configPath], { stdio: "ignore" });
  const certificatePem = readFileSync(certPath, "utf8");
  const certificateFingerprint = createHash("sha256").update(new X509Certificate(certificatePem).raw).digest("hex");
  let websiteHealthy = false;

  httpsServer = https.createServer({ key: readFileSync(keyPath), cert: certificatePem }, (_request, response) => {
    const body = Buffer.from(websiteBody);
    response.writeHead(websiteHealthy ? 200 : 503, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": body.length });
    response.end(body);
  });
  await new Promise<void>((resolve) => httpsServer!.listen(0, "127.0.0.1", resolve));
  const httpsAddress = httpsServer.address();
  if (!httpsAddress || typeof httpsAddress === "string") throw new Error("real website server address unavailable");

  sshServer = new ssh2.Server({ hostKeys: [privateKey] }, (client: any) => {
    client.on("error", () => {});
    client.on("authentication", (context: any) => {
      if (context.method === "password" && context.username === "deploy" && context.password === "test-password") context.accept();
      else context.reject();
    });
    client.on("ready", () => client.on("session", (acceptSession: any) => {
      const session = acceptSession();
      session.on("exec", (acceptExec: any, _rejectExec: any, info: { command: string }) => {
        const stream = acceptExec();
        const command = info.command;
        if (flow === "safe_abort" && command.startsWith("docker exec") && command.includes("nginx -t")) {
          stream.exit(1);
          stream.end();
          return;
        }
        if (command.startsWith("docker kill --signal=HUP")) websiteHealthy = true;
        const output = command.startsWith("docker inspect") ? "true\n"
          : command.startsWith("systemctl --failed") ? "nginx.service loaded failed failed Nginx is unhealthy\n"
            : command.startsWith("docker ps") ? "site-nginx\tUp 1 minute\n"
              : command.startsWith("ss -lntup") ? "State Recv-Q Send-Q Local Address:Port Peer Address:Port\nLISTEN 0 128 0.0.0.0:443 0.0.0.0:*\n"
                : command.startsWith("ip -brief") ? "eth0 UP 10.20.30.40\n" : "ok\n";
        stream.write(output);
        stream.exit(0);
        stream.end();
      });
      session.on("sftp", (acceptSftp: any) => {
        const sftp = acceptSftp();
        const attrs = { mode: 0o040755, uid: 1000, gid: 1000, size: 0, atime: 1_700_000_000, mtime: 1_700_000_000 };
        const readDirectoryHandles = new Set<string>();
        sftp.on("LSTAT", (requestId: number, path: string) => {
          if (path === "/srv/www/site/index.html") sftp.attrs(requestId, { ...attrs, mode: 0o100644, size: Buffer.byteLength(websiteBody) });
          else if (["/srv", "/srv/www", "/srv/www/site"].includes(path)) sftp.attrs(requestId, attrs);
          else sftp.status(requestId, 2);
        });
        sftp.on("REALPATH", (requestId: number, path: string) => sftp.name(requestId, [{ filename: path, longname: path, attrs }]));
        sftp.on("OPENDIR", (requestId: number, path: string) => { sftp.handle(requestId, Buffer.from(path)); });
        sftp.on("READDIR", (requestId: number, handle: Buffer) => {
          const directory = handle.toString();
          if (directory !== "/srv/www/site" || readDirectoryHandles.has(directory)) return sftp.status(requestId, 1);
          readDirectoryHandles.add(directory);
          sftp.name(requestId, [
            { filename: "docs", longname: "drwxr-xr-x docs", attrs },
            { filename: "index.html", longname: "-rw-r--r-- index.html", attrs: { ...attrs, mode: 0o100644, size: Buffer.byteLength(websiteBody) } },
          ]);
        });
        sftp.on("CLOSE", (requestId: number, handle: Buffer) => {
          readDirectoryHandles.delete(handle.toString());
          sftp.status(requestId, 0);
        });
      });
    }));
  });
  await new Promise<void>((resolve, reject) => {
    sshServer!.once("error", reject);
    sshServer!.listen(0, "127.0.0.1", resolve);
  });
  const sshAddress = sshServer.address();
  if (!sshAddress || typeof sshAddress === "string") throw new Error("real SSH server address unavailable");

  const connector = createSshHostConnector({ resolveAddress: async () => ({ address: "127.0.0.1", family: 4, resolvedAddresses: ["127.0.0.1"] }), timeoutMs: 5_000 });
  const healthChecker = createPinnedWebsiteHealthChecker({
    stagingCaPem: certificatePem,
    httpsRequestImpl: (options: any, callback: any) => https.request({ ...options, hostname: "127.0.0.1", port: httpsAddress.port, servername: websiteHostname, ca: certificatePem }, callback),
  });
  return { connector, healthChecker, sshPort: sshAddress.port, sshFingerprint: fingerprint, websiteHostname, websiteBody, certificateFingerprint, websiteAddress: "127.0.0.1" };
}

async function startServer(flow: Flow) {
  const { createServerState } = await import("../../server/src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../server/src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../server/src/runtime/http-server.mjs");
  const now = () => new Date().toISOString();
  const { defaultProject, state } = createServerState({ defaultProjectPath: root, now });
  if (!remoteFixtures) {
    const { createPinnedWebsiteHealthChecker } = await import("../../server/src/services/host-website-health.mjs");
    const { createSshHostConnector, sshHostFingerprint } = await import("../../server/src/services/ssh-host-connector.mjs");
    const ssh2 = (await import("../../server/node_modules/ssh2/lib/index.js")).default;
    remoteFixtures = await startRemoteFixtures({ root, flow, ssh2, createSshHostConnector, createPinnedWebsiteHealthChecker, sshHostFingerprint });
  }
  const remote = remoteFixtures;
  seedHostScenario(state, remote);
  const { httpDependencies } = createServerRuntimeServices({
    namespace: `my-hosts-real-server-${flow}`,
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: root,
    persistenceEnabled: true,
    stateStorePath: join(root, "state.json"),
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
    sshHostConnector: remote.connector,
    hostWebsiteHealthChecker: remote.healthChecker,
  });
  runtime = { httpDependencies };
  server = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: `my-hosts-real-server-${flow}`,
    protocolVersion: "0.0.0",
    ...httpDependencies,
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("real host server address unavailable");
  apiBase = `http://127.0.0.1:${address.port}`;

  const provision = await fetch(`${apiBase}/api/internal/site-credentials`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Desktop-Credential-Token": "my-hosts-real-e2e-token" },
    body: JSON.stringify({ reference: "credential://ssh/ssh_target_real_e2e", provider: "ssh", credential: { authMethod: "password_ref", password: "test-password" } }),
  });
  if (!provision.ok) throw new Error(`real host credential provisioning failed: ${provision.status} ${await provision.text()}`);
}

async function stopServer() {
  const closing = server;
  server = null;
  if (!closing) return;
  closing.closeAllConnections?.();
  await new Promise<void>((resolve) => closing.close(() => resolve()));
  closing.closeIdleConnections?.();
}

async function stopRemoteFixtures() {
  const closingSsh = sshServer;
  const closingHttps = httpsServer;
  sshServer = null;
  httpsServer = null;
  closingSsh?.closeAllConnections?.();
  closingHttps?.closeAllConnections?.();
  if (closingSsh) await new Promise<void>((resolve) => closingSsh.close(() => resolve()));
  if (closingHttps) await new Promise<void>((resolve) => closingHttps.close(() => resolve()));
  remoteFixtures = null;
}

async function restartServer(flow: Flow) {
  await stopServer();
  await startServer(flow);
}

test.beforeEach(async () => {
  process.env.MYAGENT_DESKTOP_CREDENTIAL_TOKEN = "my-hosts-real-e2e-token";
  root = mkdtempSync(join(tmpdir(), "myagenttool-my-hosts-real-"));
});

test.afterEach(async () => {
  try {
    await stopServer();
    await stopRemoteFixtures();
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
    runtime = null;
  } finally {
    if (previousCredentialToken === undefined) delete process.env.MYAGENT_DESKTOP_CREDENTIAL_TOKEN;
    else process.env.MYAGENT_DESKTOP_CREDENTIAL_TOKEN = previousCredentialToken;
  }
});

test("real server persists an ordinary website case across refresh and server restart", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("myagenttool-ui", JSON.stringify({ state: { locale: "zh-CN", section: "myHosts", experienceMode: "ordinary" }, version: 1 }));
  });
  await startServer("complete");
  await page.goto(`/?section=myHosts&api=${encodeURIComponent(apiBase)}`);
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("combobox", { name: "选择允许的文件夹" }).selectOption({ label: "网站文件" });
  await expect(page.getByText("index.html")).toBeVisible();
  await page.getByRole("button", { name: "主页", exact: true }).click();

  await page.getByPlaceholder("例如：最近有谁登录过？").fill("网站打不开");
  await page.getByRole("button", { name: "查看" }).click();
  await expect(page.getByText("这件事已有检查结果")).toBeVisible();
  await expect(page.getByText("完整时间线 · 2 个节点")).toBeVisible();

  await page.reload();
  await expect(page.getByText("这件事已有检查结果")).toBeVisible();
  await runtime?.httpDependencies.persistStateNow();
  await restartServer("complete");
  await page.goto(`/?section=myHosts&api=${encodeURIComponent(apiBase)}`);
  await expect(page.getByText("这件事已有检查结果")).toBeVisible();
  await expect(page.getByText("完整时间线 · 2 个节点")).toBeVisible();

  await page.getByRole("button", { name: "继续检查网站" }).click();
  await page.getByTestId("host-remediation-offer").getByRole("button", { name: "检查网站", exact: true }).click();
  await expect(page.getByTestId("host-remediation-plan")).toBeVisible();
  await page.getByRole("button", { name: "确认并处理" }).click();
  await expect(page.getByText("网站已经恢复访问")).toBeVisible();

  const cases = await page.request.get(`${apiBase}/api/hosts/ssh_target_real_e2e/assistant/cases`);
  expect(cases.ok()).toBe(true);
  const caseBody = await cases.json() as { cases: Array<{ status: string; deviceChanged: boolean; timeline: unknown[] }> };
  expect(caseBody.cases[0]).toMatchObject({ status: "recovered", deviceChanged: true });
  expect(caseBody.cases[0].timeline).toHaveLength(4);

  const metrics = await page.request.get(`${apiBase}/api/hosts/ssh_target_real_e2e/assistant/metrics`);
  expect(metrics.ok()).toBe(true);
  const metricBody = await metrics.json() as { metrics: { cases: { total: number; recovered: number; changed: number }; remediation: { total: number; completed: number } } };
  expect(metricBody.metrics).toMatchObject({ cases: { total: 1, recovered: 1, changed: 1 }, remediation: { total: 1, completed: 1 } });
});

test("real server records a safe abort without changing the host", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("myagenttool-ui", JSON.stringify({ state: { locale: "zh-CN", section: "myHosts", experienceMode: "ordinary" }, version: 1 }));
  });
  await startServer("safe_abort");
  await page.goto(`/?section=myHosts&api=${encodeURIComponent(apiBase)}`);

  await page.getByPlaceholder("例如：最近有谁登录过？").fill("网站打不开");
  await page.getByRole("button", { name: "查看" }).click();
  await page.getByTestId("host-remediation-offer").getByRole("button", { name: "检查网站", exact: true }).click();
  await page.getByRole("button", { name: "确认并处理" }).click();
  await expect(page.getByTestId("host-remediation-result")).toContainText("检查未通过，设备没有被修改");
  await expect(page.getByText("系统在变更前安全停止")).toBeVisible();

  const cases = await page.request.get(`${apiBase}/api/hosts/ssh_target_real_e2e/assistant/cases`);
  expect(cases.ok()).toBe(true);
  const caseBody = await cases.json() as { cases: Array<{ status: string; deviceChanged: boolean; nextStep: string; timeline: unknown[] }> };
  expect(caseBody.cases[0]).toMatchObject({ status: "needs_help", deviceChanged: false, nextStep: "review_manual_handoff" });
  expect(caseBody.cases[0].timeline).toHaveLength(4);

  const metrics = await page.request.get(`${apiBase}/api/hosts/ssh_target_real_e2e/assistant/metrics`);
  expect(metrics.ok()).toBe(true);
  const metricBody = await metrics.json() as { metrics: { cases: { total: number; unresolved: number; changed: number }; remediation: { total: number; safeAbort: number } } };
  expect(metricBody.metrics).toMatchObject({ cases: { total: 1, unresolved: 1, changed: 0 }, remediation: { total: 1, safeAbort: 1 } });
});

test("real server closes an explicitly consented operations pilot and exports anonymous evidence", async ({ page }) => {
  await page.addInitScript(() => {
    const experienceMode = sessionStorage.getItem("host-pilot-mode") === "professional" ? "professional" : "ordinary";
    localStorage.setItem("myagenttool-ui", JSON.stringify({ state: { locale: "zh-CN", section: "myHosts", experienceMode }, version: 1 }));
  });
  await startServer("complete");
  const created = await page.request.post(`${apiBase}/api/host-operations-pilot/campaigns`, { data: { label: "真实主机处置试用" } });
  expect(created.ok()).toBe(true);
  const campaign = (await created.json()).campaign as { id: string; inviteCode: string; revision: number };

  await page.goto(`/?section=myHosts&hostPilot=${encodeURIComponent(campaign.inviteCode)}&api=${encodeURIComponent(apiBase)}`);
  await expect(page.getByText("真实主机处置试用")).toBeVisible();
  await expect(page.getByText(/不记录问题原话、设备地址、命令、输出、凭据或自由文本/)).toBeVisible();
  await page.getByRole("button", { name: "同意并开始试用" }).click();
  await expect(page.getByText("请使用设备助手描述并处理一个真实问题。")).toBeVisible();

  await page.getByPlaceholder("例如：最近有谁登录过？").fill("网站打不开");
  await page.getByRole("button", { name: "查看" }).click();
  await page.getByRole("button", { name: "继续检查网站" }).click();
  await page.getByTestId("host-remediation-offer").getByRole("button", { name: "检查网站", exact: true }).click();
  await page.getByRole("button", { name: "确认并处理" }).click();
  await expect(page.getByText("网站已经恢复访问")).toBeVisible();
  await expect(page.getByText("处置已结束，请完成两项反馈")).toBeVisible({ timeout: 10_000 });
  if (process.env.CAPTURE_VISUAL_QA === "true") {
    mkdirSync(visualQaDir, { recursive: true });
    await page.getByTestId("host-operations-pilot-participant").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(visualQaDir, "participant-feedback-1280w.png"), fullPage: true });
  }
  await page.getByRole("button", { name: "清楚", exact: true }).click();
  await page.getByRole("combobox", { name: "整体容易程度" }).selectOption("5");
  await page.getByRole("button", { name: "完成并提交" }).click();
  await expect(page.getByText("本次处置试用已提交")).toBeVisible();

  await runtime?.httpDependencies.persistStateNow();
  await restartServer("complete");
  await page.evaluate(() => sessionStorage.setItem("host-pilot-mode", "professional"));
  await page.goto(`/?section=myHosts&api=${encodeURIComponent(apiBase)}`);
  const workbench = page.getByTestId("host-operations-pilot-workbench");
  await expect(workbench.getByText("处置试用闭环")).toBeVisible();
  await expect(workbench.getByText("真实主机处置试用")).toBeVisible();
  await expect(workbench.getByText("100%", { exact: true })).toBeVisible();
  await expect(workbench.getByText("5/5", { exact: true })).toBeVisible();
  if (process.env.CAPTURE_VISUAL_QA === "true") {
    mkdirSync(visualQaDir, { recursive: true });
    await workbench.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(visualQaDir, "professional-workbench-1280w.png"), fullPage: true });
  }

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出匿名证据" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const evidenceText = readFileSync(downloadPath!, "utf8");
  const evidence = JSON.parse(evidenceText) as { sha256: string; evidence: { samples: Array<{ caseRef: string; hostRef: string }> } };
  expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(evidence.evidence.samples[0].caseRef).toMatch(/^case_[a-f0-9]{12}$/);
  expect(evidence.evidence.samples[0].hostRef).toMatch(/^hst_[a-f0-9]{12}$/);
  expect(evidenceText).not.toContain("ssh_target_real_e2e");
  expect(evidenceText).not.toContain("网站打不开");
  expect(evidenceText).not.toContain("test-password");

  await page.getByRole("button", { name: "结束本轮" }).click();
  await expect(page.getByText("本轮已结束，证据仍可导出")).toBeVisible();
});

function seedHostScenario(state: Record<string, any>, remote: Awaited<ReturnType<typeof startRemoteFixtures>>) {
  if (state.sshTargets?.length) return;
  const hostId = "ssh_target_real_e2e";
  const ownerTeamId = "team_local";
  const address = remote.websiteAddress;
  const target = {
    id: hostId, name: "真实服务主机", createdByUserId: "usr_local", ownerTeamId, host: "isolated.invalid", port: remote.sshPort, user: "deploy", authMethod: "password_ref",
    credentialRef: `credential://ssh/${hostId}`, credentialStorage: "external_reference_only", knownHostPolicy: "pinned_fingerprint", knownHostFingerprint: remote.sshFingerprint, observedFingerprint: remote.sshFingerprint,
    networkPolicy: "public_only", agentForwarding: false, keySelection: null, status: "verified", trustStatus: "pinned", connectionStatus: "ready",
    capabilities: { sftp: true, sftpVersion: 3, posixRename: true, symlink: true }, lastConnectionError: null, verifiedAt: "2026-08-31T07:00:00.000Z", lastConnectedAt: "2026-08-31T07:00:00.000Z", lastResolvedAddress: address,
    revision: 4, remoteRelayEnabled: false, evidencePolicy: "not_managed_terminal_evidence_until_relay_registered", riskSummary: {}, redactionRules: {}, createdAt: "2026-08-31T07:00:00.000Z", updatedAt: "2026-08-31T07:00:00.000Z", lastTestId: null,
    purposes: ["file_transfer", "site_publish"],
  };
  const tlsScope = { id: "hfs_real_tls", ownerTeamId, sshTargetId: hostId, label: "HTTPS 证书", purpose: "tls_certificate", rootPath: "/srv/certs", resolvedRootPath: "/srv/certs", lastResolvedAddress: address, permissions: ["list"], status: "ready", revision: 2, lastVerifiedAt: target.verifiedAt };
  const publishScope = { id: "hfs_real_publish", ownerTeamId, sshTargetId: hostId, label: "网站文件", purpose: "site_publish", rootPath: "/srv/www/site", resolvedRootPath: "/srv/www/site", lastResolvedAddress: address, permissions: ["list", "upload", "download"], status: "ready", revision: 1, lastVerifiedAt: target.verifiedAt };
  const profile = { id: "htp_real_e2e", ownerTeamId, sshTargetId: hostId, certificateScopeId: tlsScope.id, label: "真实网站服务", type: "docker_nginx", containerName: "site-nginx", status: "ready", lastVerifiedAt: target.verifiedAt, revision: 2 };
  const binding = { id: "stb_real_e2e", ownerTeamId, siteId: "site_real_e2e", deploymentTargetId: "sdt_real_e2e", hostname: remote.websiteHostname, certificateScopeId: tlsScope.id, activationProfileId: profile.id, status: "active", certificateEnvironment: "staging", certificateFingerprint: remote.certificateFingerprint, revision: 2 };
  const publication = { id: "spb_real_e2e", ownerTeamId, siteId: "site_real_e2e", status: "active", remoteDeployment: { provider: "ssh_static", verification: { contentHash: createHash("sha256").update(remote.websiteBody).digest("hex"), contentBytes: Buffer.byteLength(remote.websiteBody) } } };
  state.sshTargets.push(target);
  state.hostFileScopes = [tlsScope, publishScope];
  state.hostTlsActivationProfiles = [profile];
  state.siteDomainTlsBindings = [binding];
  state.siteDeploymentTargets = [{ id: "sdt_real_e2e", ownerTeamId, kind: "ssh_static", customDomain: binding.hostname, remoteProjectRef: publishScope.id }];
  state.sites = [{ id: "site_real_e2e", ownerTeamId, activePublicationId: publication.id, name: "真实测试站点" }];
  state.sitePublications = [publication];
}
