import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// M0 visual QA for the React + Vite Web Console. Lightweight structural checks
// (per docs/engineering/VISUAL_QA.md) until a browser automation dependency is
// added; screenshots attach automatically when Playwright/Puppeteer is present.
const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const webRoot = resolve(repoRoot, "apps/web");
const srcRoot = resolve(webRoot, "src");
const artifactDir = resolve(repoRoot, ".myagenttool/visual-qa");
const distIndex = resolve(webRoot, "dist/index.html");
const requireBrowser = process.argv.includes("--require-browser");
const scenarioFilter = process.argv.find((argument) => argument.startsWith("--scenario="))?.slice("--scenario=".length) ?? null;

const indexHtml = readIfExists(resolve(webRoot, "index.html"));
const sections = readIfExists(resolve(srcRoot, "app/sections.ts"));
const routes = readIfExists(resolve(srcRoot, "app/routes.tsx"));
const consoleState = readIfExists(resolve(srcRoot, "lib/console-state.ts"));
const useConsoleState = readIfExists(resolve(srcRoot, "data/use-console-state.ts"));
const apiClient = readIfExists(resolve(srcRoot, "lib/api-client.ts"));
const src = existsSync(srcRoot) ? collectSource(srcRoot) : "";

const browserAutomation = await detectBrowserAutomation();

const viewports = [
  { name: "desktop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 }
];
const screenshotResult = browserAutomation.driver
  ? await captureScreenshots(browserAutomation.driver)
  : { status: "skipped", screenshots: [], reason: browserAutomation.reason };

// Top-level nav surfaces (stable keys) the console must expose. Labels are
// localized and therefore no longer live as English literals in sections.ts.
const NAV_SURFACES = [
  "dashboard", "projects", "task", "externalWork", "automation", "agentSkills", "invocations",
  "agents", "devices", "discovery", "integrations", "tools", "review",
  "applications", "economics", "audit"
];
// Feature views that must exist as screens (task, result, and governed surfaces).
const FEATURE_VIEWS = ["dashboard", "invocations", "economics", "tools", "review", "applications"];

const checks = [
  check(
    "web console entry serves",
    () => Boolean(indexHtml) && indexHtml.includes("/src/main.tsx"),
    "Vite entry HTML exists and mounts the React app."
  ),
  check(
    "navigation surfaces present",
    () => NAV_SURFACES.every((key) => sections.includes(`key: "${key}"`)),
    "All top-level nav surfaces are registered in sections.ts."
  ),
  check(
    "section views wired",
    () => FEATURE_VIEWS.every((key) => new RegExp(`\\b${key}:\\s*\\w`).test(routes)),
    "Each section maps to a screen in SECTION_VIEWS."
  ),
  check(
    "task workspace feature views exist",
    () => FEATURE_VIEWS.every((key) => existsSync(featureViewPath(key))),
    "Task, result, economics, tools, review, and applications surfaces exist as feature views."
  ),
  check(
    "mobile responsive layout",
    () => /\bsm:/.test(src) && /\bxl:/.test(src) && src.includes("xl:block"),
    "Responsive breakpoints and the mobile inspector collapse are present."
  ),
  check(
    "long text overflow guards",
    () => src.includes("[overflow-wrap:anywhere]") && /overflow-(?:x|y)-auto|overflow-hidden/.test(src),
    "Long-text overflow guards exist."
  ),
  check(
    "state and event mappers",
    () => Boolean(consoleState)
      && consoleState.includes("ConsoleSnapshot")
      && useConsoleState.includes("fetchState")
      && /request<ConsoleSnapshot>\("GET", "\/api\/state"/.test(apiClient),
    "User-facing state snapshot type and the /api/state polling mapper exist."
  )
];

const findings = checks.map((item) => item());
const artifact = {
  generatedAt: new Date().toISOString(),
  tool: "tools/dev/visual-qa.mjs",
  console: "react-vite",
  screenshotAutomation: {
    status: browserAutomation.status,
    reason: browserAutomation.reason,
    upgradePath: "Run `pnpm visual:qa:browser` after building the Web Console.",
    screenshotStatus: screenshotResult.status,
    screenshots: screenshotResult.screenshots,
    screenshotReason: screenshotResult.reason
  },
  viewports,
  navSurfaces: NAV_SURFACES,
  findings,
  artifactPaths: {
    json: ".myagenttool/visual-qa/latest.json",
    markdown: ".myagenttool/visual-qa/latest.md"
  }
};

mkdirSync(artifactDir, { recursive: true });
writeFileSync(resolve(artifactDir, "latest.json"), `${JSON.stringify(artifact, null, 2)}\n`);
writeFileSync(resolve(artifactDir, "latest.md"), markdownReport(artifact));

const failed = findings.filter((item) => item.status !== "pass");
if (requireBrowser && browserAutomation.status !== "available") {
  failed.push({ name: "browser screenshot automation", status: "fail", detail: browserAutomation.reason });
}
if (requireBrowser && screenshotResult.status !== "captured") {
  failed.push({ name: "browser screenshots captured", status: "fail", detail: screenshotResult.reason });
}

if (failed.length > 0) {
  console.error(`[visual-qa] failed:\n${failed.map((item) => `  - ${item.name}: ${item.detail}`).join("\n")}`);
  process.exit(1);
}

console.log("[visual-qa] report written to .myagenttool/visual-qa/latest.json and latest.md");

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function collectSource(dir) {
  let text = "";
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      text += collectSource(full);
    } else if (/\.(ts|tsx|css)$/.test(entry.name)) {
      text += `${readFileSync(full, "utf8")}\n`;
    }
  }
  return text;
}

function featureViewPath(key) {
  return resolve(srcRoot, "features", key, `${key}-view.tsx`);
}

function check(name, run, detail) {
  return () => ({ name, status: run() ? "pass" : "fail", detail });
}

async function detectBrowserAutomation() {
  try {
    const playwright = await import("playwright");
    return {
      status: "available",
      driver: { name: "playwright", module: playwright },
      reason: "playwright is installed. Screenshot automation is available."
    };
  } catch {
    // Try Puppeteer next.
  }
  return {
    status: "not_configured",
    driver: null,
    reason: "The project-managed Playwright dependency is unavailable. Run `pnpm install`."
  };
}

async function captureScreenshots(driver) {
  const screenshots = [];
  if (!existsSync(distIndex)) {
    return {
      status: "skipped",
      screenshots,
      reason: "No built console (run `pnpm --filter @myagenttool/web build`) to screenshot."
    };
  }
  const screenshotDir = resolve(artifactDir, "screenshots");
  mkdirSync(screenshotDir, { recursive: true });
  if (driver.name !== "playwright") {
    return { status: "failed", screenshots, reason: `Unsupported browser driver: ${driver.name}` };
  }
  const apiPort = await availablePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const server = spawn(process.execPath, ["apps/server/src/index.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SERVER_PORT: String(apiPort),
      MYAGENTTOOL_STATE_PATH: resolve(artifactDir, "visual-qa-state.json"),
      MYAGENTTOOL_STATE_LOCK: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const web = startWebServer();
  try {
    const webUrl = await web.ready;
    await waitForApi(apiUrl);
    const baseline = await fetchJson(`${apiUrl}/api/state`);
    const browser = await driver.module.chromium.launch();
    try {
      for (const viewport of viewports) {
        const scenarios = visualScenarios(baseline);
        const selectedScenarios = scenarioFilter
          ? scenarios.filter((scenario) => scenario.name === scenarioFilter)
          : scenarios;
        if (scenarioFilter && selectedScenarios.length === 0) {
          throw new Error(`Unknown visual QA scenario: ${scenarioFilter}`);
        }
        for (const scenario of selectedScenarios) {
          const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
          await page.route("**/api/state", (route) => {
            if (scenario.disconnected) {
              return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "offline" }) });
            }
            return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(scenario.state) });
          });
          if (scenario.homeFixture) {
            await page.route("**/api/work-items**", (route) => {
              const path = new URL(route.request().url()).pathname;
              const workItemId = path.match(/^\/api\/work-items\/([^/]+)$/)?.[1];
              const body = path.endsWith("/home-workbench")
                ? scenario.homeFixture.workbench
                : path.endsWith("/attention")
                  ? { items: [], metrics: null, nextCursor: null }
                  : path.endsWith("/external-funnel")
                    ? { metrics: { total: 0, notStarted: 0, running: 0, review: 0, completed: 0, stalled: 0 }, stalls: [] }
                : path.endsWith("/comments")
                  ? { comments: [] }
                  : workItemId
                    ? (() => {
                        const decodedId = decodeURIComponent(workItemId);
                        const workItem = scenario.homeFixture.workItems.find((item) => item.id === decodedId);
                        const homeItem = scenario.homeFixture.workbench.items.find((item) => item.workItemId === decodedId);
                        const retryable = homeItem?.executionState === "failed" && homeItem.nextAction.kind === "retry";
                        return {
                          workItem: retryable ? { ...workItem, executionState: "failed" } : workItem,
                          observability: retryable
                            ? { latestRun: { id: homeItem.nextAction.targetId, status: "failed" } }
                            : null,
                        };
                      })()
                    : { workItems: scenario.homeFixture.workItems, count: scenario.homeFixture.workItems.length, hasMore: false, nextCursor: null };
              return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
            });
          }
          if (scenario.externalFixture) {
            await page.route(/\/api\/projects\/[^/]+\/github(?:\?.*)?$/, (route) => route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                available: true,
                message: "",
                items: [
                  { type: "issue", number: 42, title: "Investigate the authentication regression", headRefName: null, author: "alex", url: "https://example.test/issues/42", state: "open" },
                  { type: "pr", number: 43, title: "Harden authentication boundaries", headRefName: "fix/auth-boundary", author: "alex", url: "https://example.test/pulls/43", state: "open" },
                ],
              }),
            }));
          }
          if (scenario.startConfirmation) {
            await page.route(/\/api\/projects\/[^/]+\/auto-run-readiness$/, (route) => route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                readiness: {
                  ready: true,
                  checks: [
                    { key: "agent", label: "Coding agent", status: "ok", detail: "Task assistant is healthy." },
                    { key: "verify", label: "Verification", status: "warn", detail: "No verify command is configured." },
                  ],
                },
              }),
            }));
          }
          if (scenario.reportFixture) {
            await page.route(/\/api\/work-items(?:[/?].*)?$/, (route) => fulfillReportFixture(route, scenario.reportFixture));
          }
          await page.addInitScript((selection) => {
            window.localStorage.setItem("myagenttool-ui", JSON.stringify({ state: selection, version: 1 }));
          }, scenario.selection);
          // The console intentionally polls /api/state, so networkidle may never
          // occur. DOM readiness plus the scenario assertions is the stable gate.
          await page.goto(`${webUrl}/?api=${encodeURIComponent(apiUrl)}`, { waitUntil: "domcontentloaded" });
          await assertVisualState(page, scenario);
          if (scenario.name === "execution-start-queued") {
            await page.locator('[data-testid="execution-start-status"]:visible').scrollIntoViewIfNeeded();
          }
          const filePath = resolve(screenshotDir, `${scenario.name}-${viewport.name}.png`);
          await page.screenshot({ path: filePath, fullPage: true });
          const layout = await page.evaluate(() => ({
            viewportWidth: window.innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            textLength: document.body.innerText.trim().length,
          }));
          if (layout.documentWidth > layout.viewportWidth + 1 || layout.bodyWidth > layout.viewportWidth + 1) {
            throw new Error(`${scenario.name}/${viewport.name} has horizontal overflow (${Math.max(layout.documentWidth, layout.bodyWidth)} > ${layout.viewportWidth})`);
          }
          if (layout.textLength < 40) throw new Error(`${scenario.name}/${viewport.name} rendered an unexpectedly blank page`);
          screenshots.push({
            scenario: scenario.name,
            viewport: viewport.name,
            path: relativeArtifactPath(filePath),
            assertions: { noHorizontalOverflow: true, nonBlank: true, keyPanelsVisible: !scenario.disconnected },
          });
          if (["ready", "home-workbench"].includes(scenario.name)) {
            const board = page.locator('[data-testid="daily-work-board"]:visible');
            await board.waitFor({ timeout: 15_000 });
            await board.scrollIntoViewIfNeeded();
            const boardBox = await board.boundingBox();
            if (!boardBox || boardBox.width > viewport.width + 1) {
              throw new Error(`daily-work-board/${viewport.name} exceeds its viewport width`);
            }
            const boardName = scenario.name === "home-workbench" ? "home-workbench-board" : "daily-work-board";
            const boardPath = resolve(screenshotDir, `${boardName}-${viewport.name}.png`);
            await board.screenshot({ path: boardPath });
            screenshots.push({
              scenario: boardName,
              viewport: viewport.name,
              path: relativeArtifactPath(boardPath),
              assertions: { noHorizontalOverflow: true, nonBlank: true, keyPanelsVisible: true },
            });
          }
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
    return { status: "captured", screenshots, reason: `Captured ${screenshots.length} state/viewport screenshots with Playwright.` };
  } catch (error) {
    return { status: "failed", screenshots, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    server.kill();
    web.close();
  }
}

function visualScenarios(baseline) {
  const now = new Date().toISOString();
  const base = structuredClone(baseline);
  const originalAgent = base.agents?.[0] ?? {};
  const codexAgent = {
    ...originalAgent,
    id: "agt_visual_codex",
    name: "Codex CLI",
    status: "enabled",
    health: { status: "healthy", checkedAt: now },
    adapter: { ...(originalAgent.adapter ?? {}), type: "cli", command: "codex" },
    location: { type: "local_device", deviceId: base.device?.id ?? "dev_visual" },
    economics: { costModel: "unknown" },
    registrationNotes: {
      risk: "Runs in the selected local project under Codex CLI settings.",
      data: "Task input, activity, and result are recorded for audit.",
      cost: "Cost is unknown until the provider reports usage.",
    },
  };
  const ready = {
    ...base,
    device: { ...(base.device ?? {}), id: base.device?.id ?? "dev_visual", name: "Development laptop", status: "online", unlinkState: "linked" },
    agents: [codexAgent],
    invocations: [],
    events: [],
    pendingDecisions: [],
  };
  const invocation = (status, result = null) => ({
    id: `inv_visual_${status}`,
    status,
    agentId: codexAgent.id,
    input: { task: "Review the authentication flow and summarize the safest next change." },
    result,
    createdAt: now,
    updatedAt: now,
    options: { metadata: { projectId: ready.projects?.[0]?.id ?? null, codexSessionMode: "new" } },
  });
  const withRun = (status, result = null) => {
    const run = invocation(status, result);
    return {
      ...structuredClone(ready),
      invocations: [run],
      events: [{ id: `evt_${status}`, invocationId: run.id, type: "log", level: status === "failed" ? "error" : "info", message: status === "running" ? "Inspecting the authentication boundary." : "Run reached its final state.", data: { agentId: codexAgent.id }, createdAt: now }],
    };
  };
  const homeFixture = homeWorkbenchFixture(ready.projects?.[0]?.id ?? null);
  const homeState = {
    ...structuredClone(ready),
    workItemSummary: {
      total: homeFixture.workItems.length,
      open: homeFixture.workItems.length,
      blocked: 0,
      activeExecutions: 4,
      updatedAt: homeFixture.workbench.generatedAt,
      homeWorkbenchUpdatedAt: homeFixture.workbench.generatedAt,
    },
  };
  const scenarios = [
    { name: "empty", state: { ...structuredClone(ready), agents: [], device: { ...ready.device, status: "offline" } }, invocationId: null },
    { name: "ready", state: structuredClone(ready), invocationId: null },
    {
      name: "home-workbench",
      state: structuredClone(homeState),
      invocationId: null,
      homeFixture,
    },
    {
      name: "local-task-center",
      state: structuredClone(homeState),
      invocationId: null,
      section: "task",
      homeFixture,
    },
    {
      name: "external-work",
      state: {
        ...structuredClone(homeState),
        projectTargets: [{ projectId: ready.projects?.[0]?.id ?? "prj_visual", state: "ready" }],
      },
      invocationId: null,
      section: "externalWork",
      homeFixture,
      externalFixture: true,
    },
    { name: "work-item-summary-review", state: structuredClone(homeState), invocationId: null, homeFixture, workItemId: "lwi_visual_review" },
    { name: "work-item-summary-completed", state: structuredClone(homeState), invocationId: null, homeFixture, workItemId: "lwi_visual_completed" },
    { name: "work-item-summary-failed", state: structuredClone(homeState), invocationId: null, homeFixture, workItemId: "lwi_visual_failed" },
    { name: "execution-start-confirmation", state: structuredClone(homeState), invocationId: null, homeFixture, workItemId: "lwi_visual_start", startConfirmation: true },
    { name: "execution-start-queued", state: structuredClone(homeState), invocationId: null, homeFixture, workItemId: "lwi_visual_start_queued" },
    { name: "running", state: withRun("running"), invocationId: "inv_visual_running" },
    { name: "succeeded", state: withRun("succeeded", { summary: "Authentication boundaries reviewed; no unsafe write was performed." }), invocationId: "inv_visual_succeeded" },
    {
      name: "approval",
      state: {
        ...withRun("waiting_for_local_approval"),
        pendingDecisions: [{
          id: "apr_visual",
          kind: "invocation_approval",
          title: "Approve the visual run",
          section: "approvals",
          ref: { invocationId: "inv_visual_waiting_for_local_approval" },
        }],
      },
      invocationId: "inv_visual_waiting_for_local_approval",
    },
    { name: "runtime-health", state: structuredClone(ready), invocationId: null, section: "devices" },
    ...["draft", "stale", "confirmed", "delivery"].map((reportStatus) => ({
      name: `report-${reportStatus}`,
      state: reportStatus === "delivery"
        ? {
            ...structuredClone(ready),
            channelOperations: [{
              id: "chn_visual_report",
              provider: "wecom",
              name: "Customer updates",
              status: "enabled",
              readiness: { callback_token: true, encoding_aes_key: true, corp_secret: true },
              ready: true,
              health: "ok",
              capabilityAllowlist: [],
              counts: { identities: 1, conversations: 1, events: 1, deliveries: 1, failedDeliveries: 0, injectionFlagged: 0 },
            }],
            channelConversations: [{ id: "cnv_visual_report", channelId: "chn_visual_report", externalUserId: "alex.external" }],
          }
        : structuredClone(ready),
      invocationId: null,
      section: "task",
      reportFixture: reportVisualFixture(reportStatus, ready.projects?.[0]?.id ?? "prj_visual"),
    })),
    {
      name: "follow-up-reminder",
      section: "workBoard",
      invocationId: null,
      state: {
        ...structuredClone(ready),
        workReport: null,
        reportSchedule: null,
        workBoard: {
          generatedAt: Date.now(),
          states: {
            pending_decision: { count: 0, items: [] },
            follow_up: {
              count: 1,
              items: [{
                id: "followup:wfr_visual",
                state: "follow_up",
                kind: "work_item_follow_up_reminder",
                title: "Update the customer launch owner",
                subtitle: "Follow-up due · LOCAL-77",
                section: "task",
                targetId: "lwi_visual_follow_up",
                projectId: ready.projects?.[0]?.id ?? null,
                updatedAt: now,
                reason: "scheduled stakeholder follow-up is due",
              }],
            },
            in_progress: { count: 0, items: [] },
            waiting: { count: 0, items: [] },
            failed: { count: 0, items: [] },
            done: { count: 0, items: [] },
          },
        },
      },
    },
    {
      name: "channel-task-failed",
      section: "channels",
      invocationId: null,
      state: {
        ...structuredClone(ready),
        channelOperations: [{ id: "chn_visual", provider: "wecom", name: "Operations", status: "enabled", readiness: { callback_token: true, encoding_aes_key: true, corp_secret: true }, ready: true, health: "attention", capabilityAllowlist: [], taskProjectId: ready.projects?.[0]?.id ?? null, counts: { identities: 1, conversations: 1, events: 3, deliveries: 1, failedDeliveries: 1, injectionFlagged: 0 } }],
        channelDeliveries: [],
        channelTaskRequests: [{ id: "ctr_visual", channelId: "chn_visual", projectId: ready.projects?.[0]?.id ?? "prj_visual", issueNumber: 42, issueUrl: "https://example.test/issues/42", title: "Repair the failed deployment workflow", status: "routed", stage: "run_failed", autoRunId: "run_visual", runStatus: "failed", invocationId: "inv_visual_failed", invocationStatus: "failed", resultSummary: "The bridge disconnected before the result was delivered.", deliveryStatus: "failed_terminal", actions: { retry: true, reroute: true, takeover: true } }],
      },
    },
    { name: "disconnected", disconnected: true, state: null, invocationId: null },
  ];
  return scenarios.map((scenario) => ({
    ...scenario,
    selection: {
      section: scenario.section ?? "dashboard",
      selectedAgentId: scenario.name === "empty" || scenario.disconnected ? null : codexAgent.id,
      selectedInvocationId: scenario.invocationId,
      selectedProjectId: ready.projects?.[0]?.id ?? null,
      selectedWorkItemId: scenario.workItemId ?? scenario.reportFixture?.workItem.id ?? null,
      selectedWorkItemMode: scenario.reportFixture ? "expert" : "summary",
      workItemDetailPreference: "summary",
      selectedWorkItemSection: scenario.reportFixture ? "report" : "overview",
      collapsedNavGroups: ["configure", "ledgers"],
      locale: "en-US",
    },
  }));
}

async function assertVisualState(page, scenario) {
  if (scenario.disconnected) {
    // Offline boot can keep the shell in its loading boundary while the
    // transport retry is pending; screenshot-level non-blank checks remain
    // the stable assertion for this state.
    return;
  }
  if (scenario.name === "runtime-health") {
    await page.locator('input[type="number"]:visible').waitFor({ timeout: 15_000 });
    return;
  }
  if (scenario.name === "channel-task-failed") {
    await page.locator('[data-testid="channel-task-operations"]:visible').waitFor({ timeout: 15_000 });
    for (const label of ["Retry", "Take over"]) await page.getByRole("button", { name: label, exact: true }).waitFor();
    await page.getByRole("button", { name: /^(Advanced info|高级信息)$/ }).click();
    await page.getByRole("link", { name: "Issue #42", exact: true }).waitFor();
    await page.getByRole("button", { name: "Reroute", exact: true }).waitFor();
    return;
  }
  if (scenario.name === "follow-up-reminder") {
    await page.getByText("Update the customer launch owner", { exact: true }).waitFor({ timeout: 15_000 });
    await page.locator('button[aria-controls="notification-center"]').click();
    await page.getByText("Follow-ups due", { exact: true }).waitFor();
    await page.getByText("Stakeholder work ready for progress or rescheduling", { exact: true }).waitFor();
    return;
  }

  if (scenario.name === "local-task-center") {
    await page.getByRole("heading", { name: "Tasks", exact: true }).waitFor({ timeout: 15_000 });
    await page
      .getByText("Confirm the overdue customer launch commitment and publish the recovery timeline", { exact: true })
      .filter({ visible: true })
      .first()
      .waitFor();
    if (await page.getByRole("tab", { name: /Issue inbox/ }).count()) {
      throw new Error("local task center exposes the external Issue inbox");
    }
    return;
  }
  if (scenario.name === "external-work") {
    await page.getByRole("heading", { name: "External work", exact: true }).waitFor({ timeout: 15_000 });
    await page.getByRole("tab", { name: /Issue inbox/ }).waitFor();
    await page
      .getByText("Investigate the authentication regression", { exact: true })
      .filter({ visible: true })
      .first()
      .waitFor();
    return;
  }
  if (scenario.reportFixture) {
    // The task center renders the expert report in its local issue detail
    // surface; it is not the summary modal used by Home.
    const reportDetail = page.getByRole("dialog", { name: "Local issue details" });
    try {
      await reportDetail.waitFor({ timeout: 15_000 });
    } catch {
      throw new Error(`report fixture did not open task details: ${await page.locator("body").innerText()}`);
    }
    await page.getByRole("tab", { name: "Report" }).waitFor();
    await page.getByText("Stakeholder report", { exact: true }).waitFor();
    const expected = scenario.name === "report-stale"
      ? "Source progress changed"
      : scenario.name === "report-delivery"
        ? "Delivery receipt"
        : scenario.name === "report-confirmed"
          ? "Confirmed means reviewed. It has not been sent and the task has not been closed."
          : "Confirm report";
    await page.getByText(expected, { exact: scenario.name !== "report-draft" }).first().waitFor();
    if (scenario.name === "report-delivery") {
      await page.getByTestId("report-delivery-preview").scrollIntoViewIfNeeded();
    }
    if (scenario.name === "report-stale") {
      const reportPanel = page.locator(`[id="work-item-report-${scenario.reportFixture.workItem.id}"]`);
      const controls = reportPanel.locator("select, input, textarea");
      if (await controls.count() !== 5) {
        throw new Error(`report-stale expected 5 report editor controls, found ${await controls.count()}`);
      }
      if (await reportPanel.locator("select:enabled, input:enabled, textarea:enabled").count()) {
        throw new Error("report-stale unexpectedly leaves report editor controls enabled");
      }
      if (await reportPanel.getByRole("button", { name: "Confirm report" }).count()) {
        throw new Error("report-stale unexpectedly exposes confirmation");
      }
    }
    return;
  }
  if (["empty", "ready"].includes(scenario.name)) {
    await page.getByRole("button", { name: "Create task", exact: true }).waitFor({ timeout: 15_000 });
    return;
  }
  if (scenario.name === "work-item-summary-review") {
    const detail = page.getByRole("dialog", { name: "Task details" });
    await detail.locator('[data-testid="work-item-summary-view"]').waitFor({ timeout: 15_000 });
    const reviewResultButton = detail.getByRole("button", { name: "Review result" });
    if (await reviewResultButton.count() === 1) {
      await reviewResultButton.click();
    } else if (await detail.getByRole("button", { name: "Hide result" }).count() !== 1) {
      throw new Error(`review-ready task has no review action: ${await detail.innerText()}`);
    }
    await detail.getByText(/^(Delivered result|What AI delivered)$/, { exact: true }).waitFor();
    await detail.getByRole("button", { name: "Ask AI to revise" }).waitFor();
    await detail.getByRole("button", { name: /^(Confirm result and complete|Approve and complete task)$/ }).waitFor();
    if (await detail.getByText("People and AI coordination", { exact: true }).count()) {
      throw new Error("simple review details repeat the removed coordination card");
    }
    if (await detail.getByPlaceholder("Add context, a decision, or something others should know…").count()) {
      throw new Error("simple review details expose the comment composer before discussion is expanded");
    }
    return;
  }
  if (scenario.name === "work-item-summary-completed") {
    const detail = page.getByRole("dialog", { name: "Task details" });
    await detail.locator('[data-testid="work-item-summary-view"]').waitFor({ timeout: 15_000 });
    await detail.getByText("Review the final result and your confirmation", { exact: true }).waitFor();
    await detail.getByRole("status", { name: "This work is complete" }).waitFor();
    if (await detail.getByText("Current progress", { exact: true }).count()) {
      throw new Error("completed simple details repeat the generic progress card");
    }
    const resultActions = detail.getByRole("button", { name: "View result" });
    if (await resultActions.count() !== 1) {
      throw new Error(`completed simple details expected one result action, found ${await resultActions.count()}`);
    }
    await resultActions.click();
    await detail.getByText(/^(Delivered result|What AI delivered)$/, { exact: true }).waitFor();
    await detail.getByRole("button", { name: "Hide result" }).waitFor();
    return;
  }
  if (scenario.name === "work-item-summary-failed") {
    const detail = page.getByRole("dialog", { name: "Task details" });
    await detail.locator('[data-testid="work-item-summary-view"]').waitFor({ timeout: 15_000 });
    await detail.getByRole("button", { name: "Retry AI work" }).click();
    await page.getByRole("dialog", { name: "Retry AI work?" }).waitFor();
    await page.getByText(/additional run time and cost/).waitFor();
    return;
  }
  if (scenario.name === "execution-start-confirmation") {
    const detail = page.getByRole("dialog", { name: "Task details" });
    await detail.locator('[data-testid="work-item-summary-view"]').waitFor({ timeout: 15_000 });
    await detail.getByRole("button", { name: "Review and start AI" }).click();
    const confirmation = page.getByRole("dialog", { name: "Confirm AI start" });
    await confirmation.waitFor();
    await confirmation.getByText("Goal", { exact: true }).waitFor();
    await confirmation.getByText("Done when", { exact: true }).waitFor();
    await confirmation.getByText("What AI may use", { exact: true }).waitFor();
    await confirmation.getByRole("button", { name: "Confirm and start AI" }).waitFor();
    return;
  }
  if (scenario.name === "execution-start-queued") {
    const detail = page.getByRole("dialog", { name: "Task details" });
    await detail.locator('[data-testid="execution-start-status"]').waitFor({ timeout: 15_000 });
    await detail.getByText("AI accepted the task and is queued", { exact: true }).waitFor();
    await detail.getByText(/scheduler will use priority and deadline risk/i).waitFor();
    await detail.getByRole("button", { name: "Cancel this start" }).waitFor();
    if (await detail.getByRole("button", { name: "Review and start AI" }).count()) {
      throw new Error("queued start repeats the AI start action");
    }
    return;
  }
  const homeComposer = page.locator('[data-testid="home-task-composer"] textarea[aria-label="Create a task"]:visible');
  const homeComposerCard = page.locator('[data-testid="home-task-composer"]');
  await homeComposerCard.waitFor({ timeout: 15_000 });
  if (await homeComposer.count() !== 1) {
    const expandComposer = page.locator('button[aria-controls="home-task-composer-fields"]:visible');
    if (await expandComposer.count() === 1) await expandComposer.click();
  }
  if (await homeComposer.count() !== 1 && await page.locator('[data-testid="home-task-composer"]').count() !== 1) {
    throw new Error(`${scenario.name} did not render the Home task composer: ${await page.locator("body").innerText()}`);
  }
  if (scenario.name === "home-workbench") {
    const myWork = page.locator('[data-testid="my-work-section"]');
    const aiWork = page.locator('[data-testid="ai-work-section"]');
    await myWork.waitFor({ timeout: 15_000 });
    await aiWork.waitFor({ state: "attached", timeout: 15_000 });
    const actionQueue = page.locator('[data-testid="unified-action-queue"]:visible');
    const dailyBrief = page.locator('[data-testid="daily-coordination-brief"]:visible');
    await dailyBrief.getByText("Today's coordination brief", { exact: true }).waitFor();
    if (await actionQueue.count()) throw new Error("home-workbench repeats the action queue before the user requests today's plan");
    const [briefBox, composerBox] = await Promise.all([
      dailyBrief.boundingBox(),
      page.locator('[data-testid="home-task-composer"]:visible').boundingBox(),
    ]);
    // Desktop uses a two-column first viewport (same top edge); mobile stacks
    // the brief above the composer. Only flag an actual inversion.
    if (!briefBox || !composerBox || briefBox.y > composerBox.y + 1) {
      throw new Error("home-workbench coordination brief is rendered after the task composer");
    }
    const firstActionButton = dailyBrief.getByRole("button", { name: "Start first action" });
    if (await firstActionButton.count() === 0) {
      throw new Error(`home-workbench coordination brief has no first action: ${await dailyBrief.innerText()}`);
    }
    await firstActionButton.click();
    const focusSession = page.getByRole("dialog", { name: "Focus session" });
    await focusSession.waitFor();
    await focusSession.getByText(/Item 1 of \d+/).waitFor();
    await page.keyboard.press("Escape");
    await dailyBrief.getByRole("button", { name: "Review needs my action" }).click();
    await actionQueue.waitFor({ timeout: 15_000 });
    await actionQueue.getByText("Needs my action", { exact: true }).waitFor();
    await actionQueue.getByRole("dialog").getByRole("button", { name: "Show fewer" }).click();
    await actionQueue.waitFor({ state: "hidden", timeout: 15_000 });
    // The workbench keeps one board panel visible at a time. Exercise both
    // tabs explicitly so the assertions match the accessible interaction
    // model rather than relying on hidden duplicate DOM.
    await page.locator('[data-testid="my-work-status-cards"]:visible').waitFor({ timeout: 15_000 });
    await page.locator('[data-testid="other-completion-column"]:visible').waitFor({ timeout: 15_000 });
    await page.getByRole("tab", { name: "AI execution" }).click();
    await page.locator('[data-testid="ai-work-status-cards"]:visible').waitFor({ timeout: 15_000 });
    await page.locator('[data-testid="active-ai-work"]:visible').waitFor({ timeout: 15_000 });
    await page.locator('[data-testid="other-execution-column"]:visible').waitFor({ timeout: 15_000 });
    await page.getByRole("tab", { name: "My schedule" }).click();
    // Open the fixture that deliberately has an AI execution date after its
    // expected completion date. Do not depend on the order of action buttons:
    // the first available action may be "View run" or an approval action.
    const viewTaskButton = page.locator('[data-work-item-id="lwi_visual_overdue"] button').first();
    await viewTaskButton.click();
    const taskDetail = page.getByRole("dialog", { name: "Task details" });
    await taskDetail.locator('[data-testid="work-item-summary-view"]').waitFor({ timeout: 15_000 });
    await taskDetail.getByRole("button", { name: "Technical and audit details" }).waitFor();
    const collaborationPath = taskDetail.locator('[data-testid="work-item-collaboration-path"]');
    await collaborationPath.waitFor();
    const collaborationText = await collaborationPath.innerText();
    if (!["My plan", "AI execution", "AI review and my confirmation"].every((label) => collaborationText.includes(label))) {
      throw new Error("ordinary task detail does not explain the personal-to-AI collaboration handoff");
    }
    await taskDetail.getByText("Both views represent this same task.", { exact: false }).waitFor();
    await taskDetail.getByText("AI execution is scheduled after the expected completion date and may delay delivery.", { exact: true }).waitFor();
    if (new URL(page.url()).searchParams.get("section") !== "dashboard") {
      throw new Error("home-workbench replaces Home with the task list before opening task details");
    }
    if ((await taskDetail.innerText()).includes("Task cockpit") || (await taskDetail.innerText()).includes("Revision")) {
      throw new Error("home-workbench exposes expert audit content in the ordinary task detail");
    }
    await taskDetail.getByRole("button", { name: "Close" }).click();
    await taskDetail.waitFor({ state: "hidden" });
    if (!await viewTaskButton.evaluate((element) => document.activeElement === element)) {
      throw new Error("ordinary task detail does not restore focus to the action that opened it");
    }
    const reviewCard = myWork.locator('[data-work-item-id="lwi_visual_review"][data-work-view="my"]');
    await reviewCard.getByRole("button", { name: "Review a completed AI result before reporting it to leadership" }).click();
    await taskDetail.locator('[data-testid="work-item-summary-view"]').waitFor({ timeout: 15_000 });
    const reviewResultButton = taskDetail.getByRole("button", { name: "Review result" });
    const hideResultButton = taskDetail.getByRole("button", { name: "Hide result" });
    if (await reviewResultButton.count() === 1) {
      await reviewResultButton.click();
    } else if (await hideResultButton.count() !== 1) {
      throw new Error(`review-ready task has no Review result action: ${await taskDetail.innerText()}`);
    }
    if (!await taskDetail.getByText(/^(Delivered result|What AI delivered)$/, { exact: true }).count()) {
      throw new Error(`review-ready task did not render the simple delivery preview: ${await taskDetail.innerText()}`);
    }
    await taskDetail.getByText("2 passed · 0 need review", { exact: true }).waitFor();
    await taskDetail.getByText("leadership-update.md", { exact: true }).waitFor();
    if (new URL(page.url()).searchParams.get("section") !== "dashboard") {
      throw new Error("reviewing a delivered result unexpectedly leaves Home");
    }
    await taskDetail.getByRole("button", { name: "Close" }).click();
    await page.getByRole("heading", { name: "Later / unscheduled", exact: true }).first().waitFor();
    if (await page.getByText("Expected completion · Yesterday / Today / Tomorrow / Later / unscheduled", { exact: true }).count() === 0) {
      throw new Error("home-workbench does not expose the completion-date navigation label");
    }
    await page.getByRole("tab", { name: "AI execution" }).click();
    await page.getByRole("heading", { name: "Later / unscheduled", exact: true }).first().waitFor();
    await page.getByRole("tab", { name: "My schedule" }).click();
    if (await page.getByText("Arrange tasks by owner and expected completion date", { exact: false }).count() === 0) {
      throw new Error("home-workbench does not expose the My schedule description");
    }
    await page.getByRole("tab", { name: "AI execution" }).click();
    await page.getByText("See tasks handed to AI and their execution dates; every task still remains in My tasks", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "My schedule" }).click();
    if (await page.getByText("Automated execution is after expected completion", { exact: true }).count() < 2) {
      throw new Error("home-workbench does not surface the schedule conflict in both Issue views");
    }
    const dateNavigationLabels = await page.locator('[data-testid$="-date-navigation"]').evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")));
    if (dateNavigationLabels.length !== 2 || dateNavigationLabels.some((label) => !label)) {
      throw new Error(`home-workbench does not expose a horizontal navigation cue for both four-column boards: ${JSON.stringify(dateNavigationLabels)}`);
    }
    if (await page.evaluate(() => window.innerWidth < 1024)) {
      await page.getByRole("tab", { name: "My schedule" }).click();
      const myScroll = await page.locator('[data-testid="my-date-columns"]:visible').evaluate((element) => ({ left: element.scrollLeft, width: element.scrollWidth, client: element.clientWidth }));
      const myToday = await page.locator('[data-testid="today-completion-column"]:visible').boundingBox();
      await page.getByRole("tab", { name: "AI execution" }).click();
      await page.waitForTimeout(250);
      const aiScroll = await page.locator('[data-testid="ai-date-columns"]:visible').evaluate((element) => ({ left: element.scrollLeft, width: element.scrollWidth, client: element.clientWidth }));
      const aiToday = await page.locator('[data-testid="today-execution-column"]:visible').boundingBox();
      if (!myToday || !aiToday) {
        throw new Error(`home-workbench mobile boards did not render Today columns (scroll ${myScroll.left}/${aiScroll.left})`);
      }
      await page.getByRole("tab", { name: "My schedule" }).click();
    }
    const assertChronological = async (tabName, testIds) => {
      await page.getByRole("tab", { name: tabName }).click();
      const leftEdges = await Promise.all(testIds.map(async (testId) => {
        const box = await page.locator(`[data-testid="${testId}"]:visible`).boundingBox();
        return box?.x ?? Number.NaN;
      }));
      if (leftEdges.some((left, index) => index > 0 && left <= leftEdges[index - 1])) {
        throw new Error(`home-workbench columns are not chronological: ${testIds.join(", ")}`);
      }
    };
    await assertChronological("My schedule", ["yesterday-completion-column", "today-completion-column", "tomorrow-completion-column", "other-completion-column"]);
    await assertChronological("AI execution", ["yesterday-execution-column", "today-execution-column", "tomorrow-execution-column", "other-execution-column"]);
    await page.getByRole("tab", { name: "My schedule" }).click();
    for (const label of ["My schedule", "AI execution", "Child learning"]) {
      await page.getByText(label, { exact: true }).first().waitFor();
    }
    await page.getByRole("tab", { name: "AI execution" }).click();
    for (const label of ["Automated execution date", "Awaiting approval", "Ready for review", "Execution failed"]) {
      await page.getByText(label, { exact: true }).first().waitFor();
    }
    await page.getByRole("tab", { name: "My schedule" }).click();
    if (await page.getByText("Expected completion", { exact: false }).count() === 0) {
      throw new Error("home-workbench does not expose expected completion labels");
    }
    if ((await myWork.innerText()).includes("Codex")) {
      throw new Error("home-workbench mixes the AI agent status into My work");
    }
    if (!(await aiWork.innerText()).includes("Codex")) {
      throw new Error("home-workbench does not expose the AI agent inside AI work");
    }
    await dailyBrief.getByRole("button", { name: "Review needs my action" }).click();
    await actionQueue.waitFor({ timeout: 15_000 });
    const adjustExecution = actionQueue.getByRole("dialog").getByRole("button", { name: "Adjust execution date" });
    if (await adjustExecution.count() !== 1) {
      throw new Error(`home-workbench action queue has no schedule action: ${await actionQueue.innerText()}`);
    }
    await adjustExecution.click();
    await page.getByRole("dialog", { name: "Schedule AI execution" }).waitFor();
    await page.keyboard.press("Escape");
    if (await actionQueue.isVisible()) {
      await actionQueue.getByRole("dialog").getByRole("button", { name: "Show fewer" }).click();
      await actionQueue.waitFor({ state: "hidden", timeout: 15_000 });
    }
    const myApproval = myWork.locator('[data-work-view="my"][data-work-item-id="lwi_visual_approval"]');
    await page.getByRole("tab", { name: "AI execution" }).click();
    const runningFilter = aiWork.getByRole("button", { name: /Running$/ }).first();
    await runningFilter.click();
    if (await aiWork.locator('[data-work-view="ai"][data-work-item-id="lwi_visual_approval"]').count()) {
      throw new Error("home-workbench AI filter did not hide the approval card before cross-board location");
    }
    await page.getByRole("tab", { name: "My schedule" }).click();
    await myApproval.waitFor({ timeout: 15_000 });
    await myApproval.getByRole("button", { name: "Locate in automated work" }).click();
    const aiApproval = aiWork.locator('[data-work-view="ai"][data-work-item-id="lwi_visual_approval"]');
    await page.waitForFunction((id) => document.querySelector(`[data-work-view="ai"][data-work-item-id="${id}"]`)?.className.includes("ring-primary/35"), "lwi_visual_approval");
    if (await runningFilter.getAttribute("aria-pressed") !== "true") {
      throw new Error("home-workbench cross-board location cleared the active AI filter");
    }
    await aiWork.getByText("Temporarily showing this task without changing your filter", { exact: true }).waitFor();
    await aiApproval.getByRole("button", { name: "Locate in My schedule" }).click();
    await page.waitForFunction((id) => document.querySelector(`[data-work-view="my"][data-work-item-id="${id}"]`)?.className.includes("ring-primary/35"), "lwi_visual_approval");
    const body = await page.locator("body").innerText();
    for (const internal of ["waiting_for_local_approval", "report_posted"]) {
      if (body.includes(internal)) throw new Error(`home-workbench exposes internal status ${internal}`);
    }
  }

  const expectedHomeState = {
    empty: "idle",
    ready: "idle",
    running: "running",
    // Completed invocations remain available in history, but Home intentionally
    // returns to the idle composer instead of keeping a stale result banner.
    succeeded: "idle",
    // Approval is represented by the compact approval card on Home; the
    // generic work-state banner is intentionally suppressed.
    approval: null,
  }[scenario.name];
  if (expectedHomeState) {
    if (expectedHomeState === "idle") {
      await page.locator('[data-home-create-action="create-ai"]:visible').waitFor();
      if (await page.locator("[data-home-work-state]:visible").count() !== 0) {
        throw new Error(`${scenario.name} renders a work-state banner while idle`);
      }
    } else {
      await page.locator(`[data-home-work-state="${expectedHomeState}"]:visible`).waitFor();
    }
  }
  const primaryAction = expectedHomeState && expectedHomeState !== "idle"
    ? page.locator(`[data-home-work-state="${expectedHomeState}"] [data-home-primary-action]:visible`)
    : page.locator('[data-home-create-action="create-ai"]:visible');
  await primaryAction.waitFor();
  const actionBox = await primaryAction.boundingBox();
  if (!actionBox || (expectedHomeState && expectedHomeState !== "idle" && actionBox.y + actionBox.height > page.viewportSize().height)) {
    throw new Error(`${scenario.name} hides the primary task action below the viewport`);
  }
  if (scenario.name === "approval") {
    await page.getByTestId("ai-approval-card").waitFor({ timeout: 15_000 });
    if (await page.locator("[data-home-work-state]:visible").count() !== 0) {
      throw new Error("approval renders a duplicate Home work-state banner alongside the approval card");
    }
  }
  // The Home composer exposes optional project/date/criteria context under a
  // plain-language progressive disclosure. Keep this assertion tied to the
  // current entry surface instead of a retired workspace-only wording.
  const contextSummary = page.getByText("More options", { exact: true });
  if (await contextSummary.count() === 1) {
    if (await contextSummary.locator("xpath=ancestor::details[1]").getAttribute("open") !== null) {
      throw new Error(`${scenario.name} opens task context/material controls on the ordinary Home surface`);
    }
  }
}

function homeWorkbenchFixture(projectId) {
  const now = new Date();
  const date = (offset) => {
    const value = new Date(now);
    value.setHours(12, 0, 0, 0);
    value.setDate(value.getDate() + offset);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  };
  const generatedAt = now.toISOString();
  const baseItem = (id, localRef, title, overrides = {}) => ({
    id, localRef, projectId, title, body: "", type: "task", status: "ready", priority: "p2", state: "open",
    labels: [], assigneeIds: ["usr_local"], requesterRelation: "customer", requesterName: "Alex Morgan",
    requesterOrganization: "Acme", requesterUserId: null, intakeChannel: "meeting", externalReference: null,
    waitingOn: "none", commitmentDate: null, nextFollowUpAt: null, lastProgressAt: null, lastProgressSummary: null,
    acceptanceCriteria: [], dueDate: date(0), milestone: "", estimatePoints: 1, revision: 1, archivedAt: null,
    plannedDate: date(0), updatedAt: generatedAt, ...overrides,
  });
  const rows = [
    baseItem("lwi_visual_overdue", "LOCAL-101", "Confirm the overdue customer launch commitment and publish the recovery timeline", { priority: "p0", dueDate: date(-1), plannedDate: date(0), executionState: "running", commitmentDate: new Date(now.getTime() - 86_400_000).toISOString(), waitingOn: "me" }),
    baseItem("lwi_visual_approval", "LOCAL-102", "Approve the governed production verification step", { priority: "p1", plannedDate: date(1), waitingOn: "me" }),
    baseItem("lwi_visual_failed", "LOCAL-103", "Repair the failed child learning summary generation", { status: "blocked", executionState: "failed", plannedDate: date(-1), requesterRelation: "child", requesterName: null, requesterOrganization: null, waitingOn: "ai" }),
    baseItem("lwi_visual_review", "LOCAL-104", "Review a completed AI result before reporting it to leadership", {
      status: "review", executionState: "completed", dueDate: date(1), waitingOn: "me",
      lastProgressSummary: "AI prepared the leadership update and verified the launch facts.",
      acceptanceCriteria: ["Leadership-ready summary", "Launch facts verified"],
      acceptanceResults: [
        { criterion: "Leadership-ready summary", status: "passed", note: "Ready for review", verificationId: "ver_visual_1" },
        { criterion: "Launch facts verified", status: "passed", note: "Facts checked", verificationId: "ver_visual_2" },
      ],
      outputAssets: [{ id: "asset_visual_report", path: "reports/leadership-update.md", family: "markdown", terminalId: "local", hash: null, version: null, capabilities: ["asset.read"], readiness: { state: "ready", reason: "ready" } }],
    }),
    baseItem("lwi_visual_completed", "LOCAL-106", "Share the approved leadership update with the launch team", {
      status: "completed", state: "closed", executionState: "completed", dueDate: date(0), waitingOn: "none",
      lastProgressSummary: "The leadership update was approved and the task was completed.",
      acceptanceCriteria: ["Leadership-ready summary", "Launch facts verified"],
      acceptanceResults: [
        { criterion: "Leadership-ready summary", status: "passed", note: "Approved", verificationId: "ver_visual_3" },
        { criterion: "Launch facts verified", status: "passed", note: "Facts checked", verificationId: "ver_visual_4" },
      ],
      outputAssets: [{ id: "asset_visual_completed_report", path: "reports/approved-leadership-update.md", family: "markdown", terminalId: "local", hash: null, version: null, capabilities: ["asset.read"], readiness: { state: "ready", reason: "ready" } }],
    }),
    baseItem("lwi_visual_long", "LOCAL-105", "Coordinate an unusually long cross-organization delivery commitment without losing the meaningful end of this title on a narrow mobile screen", { dueDate: date(2), plannedDate: date(3), requesterName: "A requester with a very long organization-facing display name", requesterRelation: "manager" }),
    baseItem("lwi_visual_start", "LOCAL-107", "Prepare the customer launch risk update", {
      status: "backlog", executionState: "unclaimed", plannedDate: null, waitingOn: "none",
      body: "Summarize the current launch risks for the customer and keep the result concise.",
      intentStatement: "Prepare a customer-ready launch risk update",
      acceptanceCriteria: ["The update covers every open launch risk", "The wording is suitable for the customer"],
      verificationSop: ["Compare the update with the launch risk register", "Review the final wording before delivery"],
      executionContractSource: "assisted", executionContractConfirmedAt: null,
      executionContractGate: { ready: false, missing: ["confirmation"], source: "assisted", confirmedAt: null },
      inputAssets: [{ id: "asset_visual_risks", originalName: "launch-risks.xlsx", path: "/workspace/launch-risks.xlsx", family: "spreadsheet", terminalId: "local", hash: null, version: "3", capabilities: ["asset.read"], readiness: { state: "ready", reason: "ready" } }],
      localContentRefs: [{ id: "wcr_visual_notes", contentId: "lc_visual_notes", purpose: "reference", title: "Customer communication notes", kind: "material", addedBy: "usr_local", createdAt: generatedAt, fingerprintPinned: true }],
      taskResourceRefs: [{ id: "wrr_visual_crm", resourceId: "wr_visual_crm", purpose: "query_source", title: "CRM launch accounts", resourceKind: "table", businessRole: "customer", locality: "remote", sourceLabel: "CRM", addedBy: "usr_local", createdAt: generatedAt, versionPinned: true }],
      myTemplateBinding: { schemaVersion: 1, definitionId: "rtd_visual_update", familyId: "family_visual_update", version: 2, name: "Customer launch update", expectedOutput: "A concise customer-ready risk update", matchReasons: ["The expected result matches"], snapshot: { name: "Customer launch update", description: "Prepare a concise update", expectedOutput: "A concise customer-ready risk update", steps: [] }, snapshotHash: "visual-template-hash", matchedAt: generatedAt },
    }),
    baseItem("lwi_visual_start_queued", "LOCAL-108", "Prepare the queued customer launch update", {
      status: "ready", executionState: "unclaimed", plannedDate: null, waitingOn: "ai", executionPolicy: "auto",
      body: "Prepare the customer launch update after higher-priority work.",
      intentStatement: "Prepare a customer-ready launch update",
      acceptanceCriteria: ["The update is customer-ready"],
      verificationSop: ["Review the final update"],
      executionContractSource: "assisted", executionContractConfirmedAt: generatedAt,
      executionContractGate: { ready: true, missing: [], source: "assisted", confirmedAt: generatedAt },
      executionStartReceipt: {
        schemaVersion: 1, id: "wsr_visual_queued", status: "queued", requestedAt: generatedAt, requestedBy: "usr_local",
        confirmedRevision: 3, contractDigest: "visual-start-digest", updatedAt: generatedAt, startedAt: null,
        executionKind: null, targetId: null, agentId: "agt_visual_codex", phase: null,
        reasonCode: "waiting_for_turn", reasonDetail: null, cancelledAt: null, cancelledBy: null, canCancel: true,
      },
    }),
  ];
  const home = ({ id, executionState, attentionReason, waitingOn, nextAction, ai, secondaryReasons = [] }) => {
    const item = rows.find((candidate) => candidate.id === id);
    return {
      workItemId: item.id, localRef: item.localRef, title: item.title, projectId, revision: item.revision,
      priority: item.priority, assignees: [{ id: "usr_local", name: "Me" }],
      requester: { relation: item.requesterRelation, name: item.requesterName, organization: item.requesterOrganization },
      planningStatus: item.status, executionState, waitingOn, attentionReason, secondaryReasons,
      needsAttention: ["overdue", "approval_required", "ai_failed", "review_ready"].includes(attentionReason),
      dueDate: item.dueDate, plannedDate: item.plannedDate, commitmentDate: item.commitmentDate, nextFollowUpAt: item.nextFollowUpAt,
      nextAction, ai,
    };
  };
  const ai = (status, id) => ({ autoRunId: id.startsWith("aur") ? id : null, invocationId: id.startsWith("inv") ? id : `inv_${id}`, agentId: "agt_visual_codex", agentName: "Codex CLI", status, updatedAt: generatedAt });
  const items = [
    home({ id: "lwi_visual_overdue", executionState: "running", attentionReason: "overdue", waitingOn: "me", secondaryReasons: ["ai_running"], nextAction: { kind: "open_run", label: "open_run", targetId: "aur_overdue", section: "autoRuns" }, ai: ai("running", "aur_overdue") }),
    home({ id: "lwi_visual_approval", executionState: "awaiting_approval", attentionReason: "approval_required", waitingOn: "me", nextAction: { kind: "open_approval", label: "review_approval", targetId: "apr_visual", section: "approvals" }, ai: ai("waiting_for_local_approval", "inv_approval") }),
    home({ id: "lwi_visual_failed", executionState: "failed", attentionReason: "ai_failed", waitingOn: "ai", nextAction: { kind: "retry", label: "retry", targetId: "aur_failed", section: "autoRuns" }, ai: ai("failed", "aur_failed") }),
    home({ id: "lwi_visual_review", executionState: "completed", attentionReason: "review_ready", waitingOn: "me", nextAction: { kind: "review_result", label: "review_result", targetId: "aur_review", section: "autoRuns" }, ai: ai("report_posted", "aur_review") }),
    home({ id: "lwi_visual_long", executionState: "unclaimed", attentionReason: "planned", waitingOn: "none", nextAction: { kind: "open_issue", label: "open_issue", targetId: "lwi_visual_long", section: "task" }, ai: ai("scheduled", "aur_long") }),
  ];
  return {
    workItems: rows,
    workbench: {
      generatedAt, horizon: { today: date(0), tomorrow: date(1) },
      summary: {
        total: items.length, needsAttention: 4, waitingMe: 3, approvals: 1, aiFailed: 1, dueToday: 2, reviewReady: 1,
        byRelation: { boss: 0, manager: 1, customer: 3, child: 1, colleague: 0, self: 0, unknown: 0 },
        byWaitingOn: { me: 3, requester: 0, internal: 0, ai: 1, none: 1 },
      },
      items,
    },
  };
}

function reportVisualFixture(status, projectId) {
  const now = "2026-08-03T12:00:00.000Z";
  const workItem = {
    id: "lwi_visual_report",
    localRef: "LOCAL-77",
    projectId,
    title: "Confirm the customer launch plan",
    body: "Prepare a concise update after review.",
    type: "task",
    status: "review",
    priority: "p1",
    state: "open",
    businessState: "open",
    planningStatus: "review",
    executionState: "completed",
    labels: [],
    assigneeIds: [],
    followUpSchemaVersion: 1,
    requesterRelation: "customer",
    requesterName: "Alex",
    requesterOrganization: "Acme",
    requesterUserId: null,
    intakeChannel: "meeting",
    externalReference: null,
    waitingOn: "me",
    commitmentDate: "2026-08-05T09:00:00.000Z",
    nextFollowUpAt: "2026-08-04T09:00:00.000Z",
    lastProgressAt: "2026-08-03T11:00:00.000Z",
    lastProgressSummary: "QA and release checks passed.",
    acceptanceCriteria: [],
    dueDate: null,
    plannedDate: "2026-08-03",
    milestone: "Launch",
    estimatePoints: 2,
    revision: status === "stale" ? 5 : 4,
    archivedAt: null,
    updatedAt: now,
  };
  const reportDraft = {
    id: "wrd_visual_report",
    schemaVersion: 1,
    workItemId: workItem.id,
    status: status === "confirmed" || status === "delivery" ? "confirmed" : "draft",
    revision: status === "confirmed" || status === "delivery" ? 3 : 2,
    audience: { relation: "customer", name: "Alex", organization: "Acme", userId: null },
    tone: "concise",
    content: "Alex update — Confirm the customer launch plan\n\nCurrent progress: QA and release checks passed.\nWaiting on: our next action.",
    stale: status === "stale",
    canEdit: status === "draft",
    canConfirm: status === "draft",
    source: {
      workItemRevision: 4,
      capturedAt: now,
      contextDigest: "visual-context",
      progressActivities: [{ activityId: "wia_visual", summary: "QA and release checks passed.", createdAt: "2026-08-03T11:00:00.000Z" }],
      executionResults: [{ kind: "auto_run", id: "aur_visual", status: "completed", summary: "All governed checks passed.", updatedAt: "2026-08-03T11:30:00.000Z" }],
    },
    generation: { generator: "structured", policyVersion: "work-item-report-v1", modelVersion: null, locale: "en-US", inputDigest: "visual-input" },
    createdBy: "usr_visual",
    updatedBy: "usr_visual",
    createdAt: now,
    updatedAt: now,
    confirmedAt: status === "confirmed" || status === "delivery" ? now : null,
    confirmedBy: status === "confirmed" || status === "delivery" ? "usr_visual" : null,
    confirmedSnapshot: status === "confirmed" || status === "delivery" ? {
      revision: 3,
      audience: { relation: "customer", name: "Alex", organization: "Acme", userId: null },
      tone: "concise",
      content: "Alex update — Confirm the customer launch plan\n\nCurrent progress: QA and release checks passed.\nWaiting on: our next action.",
      source: null,
      contentDigest: "visual-report-content",
      confirmedAt: now,
      confirmedBy: "usr_visual",
    } : null,
  };
  if (reportDraft.confirmedSnapshot) reportDraft.confirmedSnapshot.source = structuredClone(reportDraft.source);
  const reportDelivery = status === "delivery" ? {
    id: "wrdl_visual_report",
    schemaVersion: 1,
    workItemId: workItem.id,
    reportDraftId: reportDraft.id,
    status: "delivered",
    revision: 2,
    confirmedReportRevision: 3,
    content: reportDraft.content,
    contentDigest: "visual-report-content",
    chunkCount: 1,
    target: {
      channelId: "chn_visual_report",
      channelName: "Customer updates",
      provider: "wecom",
      conversationId: "cnv_visual_report",
      recipientId: "alex.external",
    },
    canSend: false,
    channelDeliveryIds: ["cdl_visual_report"],
    createdBy: "usr_visual",
    createdAt: now,
    sentBy: "usr_visual",
    sentAt: now,
    receipt: {
      status: "delivered",
      channelDeliveryIds: ["cdl_visual_report"],
      deliveredChunks: 1,
      failedChunks: 0,
      attempts: 1,
      providerReceiptIds: ["wecom-visual-receipt-77"],
      lastErrorCodes: [],
      updatedAt: now,
    },
  } : null;
  return { workItem, reportDraft, reportDelivery };
}

function fulfillReportFixture(route, fixture) {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const itemPath = `/api/work-items/${fixture.workItem.id}`;
  let body = null;
  if (path === "/api/work-items") {
    body = { workItems: [fixture.workItem], count: 1, hasMore: false, nextCursor: null };
  } else if (path === itemPath) {
    body = { workItem: fixture.workItem, observability: null };
  } else if (path === `${itemPath}/comments`) {
    body = { comments: [] };
  } else if (path === `${itemPath}/activity`) {
    body = { activities: [] };
  } else if (path === `${itemPath}/report-drafts`) {
    body = { reportDrafts: [fixture.reportDraft], count: 1 };
  } else if (path === `${itemPath}/report-drafts/${fixture.reportDraft.id}/deliveries`) {
    const reportDeliveries = fixture.reportDelivery ? [fixture.reportDelivery] : [];
    body = { reportDeliveries, count: reportDeliveries.length };
  }
  return body
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
    : route.continue();
}

function startWebServer() {
  let resolveReady;
  const ready = new Promise((resolvePromise) => { resolveReady = resolvePromise; });
  const distDir = resolve(webRoot, "dist");
  const server = createServer((req, res) => {
    const rel = (req.url ?? "/").split("?")[0];
    const file = resolve(distDir, `.${rel}`);
    if (rel !== "/" && file.startsWith(distDir) && existsSync(file) && extname(file)) {
      res.writeHead(200, { "content-type": contentType(extname(file)) });
      res.end(readFileSync(file));
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(readFileSync(distIndex));
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolveReady(`http://127.0.0.1:${address.port}`);
  });
  return { ready, close: () => server.close() };
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : null;
      probe.close((error) => {
        if (error) reject(error);
        else if (port == null) reject(new Error("Could not allocate a visual QA API port"));
        else resolvePort(port);
      });
    });
  });
}

function contentType(extension) {
  return { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" }[extension] ?? "application/octet-stream";
}

async function waitForApi(apiUrl) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      await fetchJson(`${apiUrl}/health`);
      return;
    } catch {
      await sleep(150);
    }
  }
  throw new Error("Visual QA server did not start");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function relativeArtifactPath(path) {
  return path.replace(repoRoot, "").replace(/^[/\\]/, "").replace(/\\/g, "/");
}

function markdownReport(report) {
  const lines = [
    "# Visual QA Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Console: ${report.console}`,
    "",
    "## Screenshot Automation",
    "",
    `Status: ${report.screenshotAutomation.status}`,
    `Reason: ${report.screenshotAutomation.reason}`,
    `Screenshot status: ${report.screenshotAutomation.screenshotStatus}`,
    `Screenshot reason: ${report.screenshotAutomation.screenshotReason}`,
    "",
    "Screenshots:",
    ...(
      report.screenshotAutomation.screenshots.length > 0
        ? report.screenshotAutomation.screenshots.map((item) => `- ${item.scenario ?? "default"} / ${item.viewport}: ${item.path}`)
        : ["- None."]
    ),
    "",
    "## Viewports",
    "",
    ...report.viewports.map((item) => `- ${item.name}: ${item.width} x ${item.height}`),
    "",
    "## Findings",
    "",
    ...report.findings.map((item) => `- ${item.status.toUpperCase()} - ${item.name}: ${item.detail}`)
  ];
  return `${lines.join("\n")}\n`;
}
