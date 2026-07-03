import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
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
    upgradePath: "Install Playwright or Puppeteer to attach desktop and mobile screenshots.",
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
  console.error(`[visual-qa] failed: ${failed.map((item) => item.name).join(", ")}`);
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
  try {
    const puppeteer = await import("puppeteer");
    return {
      status: "available",
      driver: { name: "puppeteer", module: puppeteer.default ?? puppeteer },
      reason: "puppeteer is installed. Screenshot automation is available."
    };
  } catch {
    // Fall through to not configured.
  }
  return {
    status: "not_configured",
    driver: null,
    reason: "No browser automation dependency is installed in this workspace."
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
  const target = pathToFileURL(distIndex).href;
  try {
    if (driver.name === "playwright") {
      const browser = await driver.module.chromium.launch();
      const page = await browser.newPage();
      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(target);
        const path = resolve(screenshotDir, `${viewport.name}.png`);
        await page.screenshot({ path, fullPage: true });
        screenshots.push({ viewport: viewport.name, path: relativeArtifactPath(path) });
      }
      await browser.close();
      return { status: "captured", screenshots, reason: "Captured screenshots with Playwright." };
    }
    if (driver.name === "puppeteer") {
      const browser = await driver.module.launch();
      const page = await browser.newPage();
      for (const viewport of viewports) {
        await page.setViewport({ width: viewport.width, height: viewport.height });
        await page.goto(target);
        const path = resolve(screenshotDir, `${viewport.name}.png`);
        await page.screenshot({ path, fullPage: true });
        screenshots.push({ viewport: viewport.name, path: relativeArtifactPath(path) });
      }
      await browser.close();
      return { status: "captured", screenshots, reason: "Captured screenshots with Puppeteer." };
    }
  } catch (error) {
    return { status: "failed", screenshots, reason: error instanceof Error ? error.message : String(error) };
  }
  return { status: "failed", screenshots, reason: `Unsupported browser driver: ${driver.name}` };
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
        ? report.screenshotAutomation.screenshots.map((item) => `- ${item.viewport}: ${item.path}`)
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
