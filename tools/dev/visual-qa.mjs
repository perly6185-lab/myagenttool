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

const indexHtml = readIfExists(resolve(webRoot, "index.html"));
const sections = readIfExists(resolve(srcRoot, "app/sections.ts"));
const routes = readIfExists(resolve(srcRoot, "app/routes.tsx"));
const consoleState = readIfExists(resolve(srcRoot, "lib/console-state.ts"));
const useConsoleState = readIfExists(resolve(srcRoot, "data/use-console-state.ts"));
const src = existsSync(srcRoot) ? collectSource(srcRoot) : "";

const browserAutomation = await detectBrowserAutomation();

const viewports = [
  { name: "desktop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 }
];
const screenshotResult = browserAutomation.driver
  ? await captureScreenshots(browserAutomation.driver)
  : { status: "skipped", screenshots: [], reason: browserAutomation.reason };

// Top-level nav surfaces (labels) the console must expose.
const NAV_SURFACES = [
  "Overview", "Projects", "Task", "Automation", "Agent Skills", "Invocations",
  "Agents", "Devices", "Discovery", "Integrations", "Tools", "Review",
  "Applications", "Economics", "Audit"
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
    () => NAV_SURFACES.every((label) => sections.includes(`"${label}"`)),
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
    () => Boolean(consoleState) && consoleState.includes("ConsoleSnapshot") && useConsoleState.includes("/api/state"),
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
        for (const scenario of visualScenarios(baseline)) {
          const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
          await page.route("**/api/state", (route) => {
            if (scenario.disconnected) {
              return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "offline" }) });
            }
            return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(scenario.state) });
          });
          await page.addInitScript((selection) => {
            window.localStorage.setItem("myagenttool-ui", JSON.stringify({ state: selection, version: 1 }));
          }, scenario.selection);
          await page.goto(`${webUrl}/?api=${encodeURIComponent(apiUrl)}`, { waitUntil: "networkidle" });
          await assertVisualState(page, scenario);
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
  const scenarios = [
    { name: "empty", state: { ...structuredClone(ready), agents: [], device: { ...ready.device, status: "offline" } }, invocationId: null },
    { name: "ready", state: structuredClone(ready), invocationId: null },
    { name: "running", state: withRun("running"), invocationId: "inv_visual_running" },
    { name: "succeeded", state: withRun("succeeded", { summary: "Authentication boundaries reviewed; no unsafe write was performed." }), invocationId: "inv_visual_succeeded" },
    { name: "approval", state: withRun("waiting_for_local_approval"), invocationId: "inv_visual_waiting_for_local_approval" },
    { name: "runtime-health", state: structuredClone(ready), invocationId: null, section: "devices" },
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
      collapsedNavGroups: ["configure", "ledgers"],
    },
  }));
}

async function assertVisualState(page, scenario) {
  if (scenario.disconnected) {
    await page.locator("span:visible", { hasText: "Server is offline." }).first().waitFor({ timeout: 15_000 });
    return;
  }
  if (scenario.name === "runtime-health") {
    await page.locator('[data-testid="dispatch-health"]:visible').waitFor({ timeout: 15_000 });
    await page.locator('[data-testid="runtime-reliability"]:visible').waitFor();
    return;
  }
  if (scenario.name === "channel-task-failed") {
    await page.locator('[data-testid="channel-task-operations"]:visible').waitFor({ timeout: 15_000 });
    for (const label of ["Issue #42", "Retry", "Reroute", "Take over"]) await page.getByText(label, { exact: true }).waitFor();
    return;
  }
  await page.locator('textarea[aria-label="Task"]:visible').waitFor({ timeout: 15_000 });
  for (const label of ["Project", "Agent"]) await page.locator(`select[aria-label="${label}"]:visible`).waitFor();
  await page.locator("summary:visible", { hasText: "Technical details" }).click();
  for (const text of ["Safety", "Data", "Cost", "Computer"]) {
    await page.locator("p:visible, dt:visible", { hasText: new RegExp(`^${text}$`) }).first().waitFor();
  }
  if (scenario.name !== "empty") {
    const selectedAgent = await page.locator('select[aria-label="Agent"]:visible option:checked').textContent();
    if (!selectedAgent?.includes("Codex CLI")) throw new Error(`${scenario.name} did not select the Codex CLI fixture agent`);
  }
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
  const deadline = Date.now() + 20_000;
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
