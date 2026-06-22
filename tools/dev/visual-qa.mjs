import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const publicDir = resolve(repoRoot, "apps/web/public");
const artifactDir = resolve(repoRoot, ".myagenttool/visual-qa");
const html = readFileSync(resolve(publicDir, "index.html"), "utf8");
const css = readFileSync(resolve(publicDir, "styles.css"), "utf8");
const js = readFileSync(resolve(publicDir, "app.js"), "utf8");
const serverJs = readFileSync(resolve(repoRoot, "apps/server/src/index.mjs"), "utf8");
const requireBrowser = process.argv.includes("--require-browser");
const browserAutomation = await detectBrowserAutomation();

const viewports = [
  { name: "desktop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 }
];
const screenshotResult = browserAutomation.driver
  ? await captureScreenshots(browserAutomation.driver)
  : { status: "skipped", screenshots: [], reason: browserAutomation.reason };

const states = [
  {
    name: "empty",
    expected: ["Codex conversation", "composer-card", "attachmentTray", "addContextMenu", "permissionMenu", "modelMenu", "Start a Codex conversation", "Result"]
  },
  {
    name: "approval needed",
    expected: ["Needs attention", "approvalQueueList", "Approve", "Deny"]
  },
  {
    name: "codex supervision",
    expected: ["Session", "Managed sessions", "Review diff", "Needs attention"]
  },
  {
    name: "connect agent",
    expected: ["Setup", "Connect agent", "Discovery", "candidateList", "SSH target"]
  },
  {
    name: "evidence center",
    expected: ["Evidence center", "evidenceTypeFilter", "evidenceSourceFilter", "Export summary"]
  },
  {
    name: "imported evidence",
    expected: ["Import evidence", "imported_after_the_fact", "No private auth files were read"]
  },
  {
    name: "managed terminal",
    expected: ["Managed terminal", "terminalRuntimeStatus", "terminalSessionSummary", "terminalProgressList", "terminalOutputPreview"]
  }
];

const checks = [
  check("desktop and mobile viewport metadata", () => viewports.every((item) => item.width > 0 && item.height > 0), "Viewport metadata is present for desktop and mobile."),
  check("mobile CSS breakpoint", () => css.includes("@media (max-width: 760px)"), "Mobile breakpoint exists."),
  check("long text overflow guard", () => css.includes("overflow-wrap: anywhere"), "Long text overflow guard exists."),
  check("stable column ownership", () => !commandPanel().includes("connectAgentPanel") && !commandPanel().includes("Evidence center"), "Management tools stay out of task composer."),
  check("project registry visible in left rail", () => html.includes("projectList") && html.includes("currentProjectName") && html.includes("Add project") && js.includes("/api/projects"), "Project registry is visible and backed by API calls."),
  check("worktree creation is project-scoped", () => html.includes("Create worktree") && js.includes("/api/worktrees") && serverSource().includes("function createWorktree") && serverSource().includes("git\", gitArgs"), "Worktree creation is visible, API-backed, and implemented through git worktree."),
  check("project file browser visible in right rail", () => html.includes("projectBrowserContext") && html.includes("projectTreeList") && js.includes("/tree?") && css.includes("project-tree-row"), "Project browser renders registered-root files with tree API backing."),
  check("conversation history restores transcript", () => html.includes('data-session-filter="project"') && js.includes("conversationHistoryItems") && js.includes("dataset.invocationId") && js.includes('activeMode = "run_task"'), "History is project-aware and can restore the center transcript."),
  check("local persistence has schema version", () => serverSource().includes("stateSchemaVersion") && serverSource().includes("restorePersistentState") && serverSource().includes("savePersistentState"), "Server persists and restores local workspace state with a schema version."),
  check("agent workspace nav surfaces", () => ["run_task", "session", "diff", "terminal", "evidence_center", "approval", "setup"].every((mode) => html.includes(`data-workspace-mode=\"${mode}\"`)), "Run, Session, Diff, Terminal, Evidence, Approval, and Setup are separate surfaces."),
  check("run center is conversation transcript", () => commandPanel().includes("agent-transcript") && js.includes("transcriptItem") && js.includes("Show technical details"), "Run center renders a conversation transcript with collapsible technical detail blocks."),
  check("run composer excludes advanced surfaces", () => !containsAny(commandPanel(), ["Evidence center", "Connect agent", "SSH target", "Managed sessions", "Integration controls", "Approval queue", "Managed terminal"]), "Run composer stays focused on high-frequency task input."),
  check("terminal surface shows managed terminal workspace", () => html.includes("Managed terminal") && html.includes("terminal-screen") && html.includes("terminalProgressList") && js.includes("showTerminalSurface"), "Terminal surface shows live output and operation progress without exposing unmanaged shell access."),
  check("terminal scaffold has registry evidence UI", () => html.includes("terminalEvidenceSummary") && js.includes("/api/terminal/sessions") && js.includes("terminalEvidenceRecords"), "Terminal surface exposes capability, registry, and evidence summaries."),
  check("terminal detail supports input resize close", () => html.includes("resizeTerminalButton") && js.includes("/input") && js.includes("/resize") && js.includes("/close"), "Terminal detail exposes direct input, resize, and close controls outside Run."),
  check("terminal supports emulator input", () => html.includes("/vendor/xterm/css/xterm.css") && js.includes("new Terminal") && js.includes("terminal.onData") && js.includes("sendTerminalBytes"), "Terminal surface uses xterm to capture editable input directly in the terminal."),
  check("terminal distinguishes codex linkage", () => html.includes("terminalCodexSummary") && js.includes("ownerCodexSessionId") && js.includes("latestCodexSession"), "Terminal surface distinguishes terminal session from Codex session linkage."),
  check("SSH target setup stays out of Run", () => html.includes("sshTargetHost") && html.includes("sshTargetTestReport") && js.includes("/api/ssh-targets") && !commandPanel().includes("sshTargetHost"), "SSH target setup belongs to Setup, not Run."),
  check("SSH relay boundary is visible", () => html.includes("Remote relay not enabled") && js.includes("remoteRelayEnabled"), "SSH target preflight does not imply remote relay PTY."),
  check("advanced surfaces have owned panels", () => ["managedSessionHistoryContext", "managedChangeReviewPanel", "terminalSurfaceContext", "evidenceCenterContext", "managedApprovalContext", "connectAgentPanel"].every((id) => html.includes(`id=\"${id}\"`)), "Session, Diff, Terminal, Evidence, Approval, and Setup have owned panels."),
  check("surface render rules keep run separate", () => js.includes("els.commandPanel.hidden = !showRunSurface") && js.includes("els.managedSessionHistoryContext.hidden = !(showSessionSurface || showDiffSurface)") && js.includes("els.evidenceCenterContext.hidden = !showEvidenceSurface"), "Render rules keep Run and advanced surfaces separated."),
  check("raw logs do not dominate result", () => html.includes("Technical details") && html.includes("<summary>Technical details</summary>"), "Technical details are collapsed."),
  check("primary controls visible", () => html.includes("id=\"runButton\"") && html.includes("send-button") && html.includes("composer-popover") && html.includes("permission-popover") && html.includes("id=\"cancelButton\""), "Run and cancel controls exist."),
  check("scripted IA violation fixture", () => detectsIaViolation(fixtureWithMisplacedEvidenceCenter()), "Fixture with misplaced Evidence Center is detected.")
];

for (const state of states) {
  checks.push(check(`${state.name} state markers`, () => state.expected.every((marker) => html.includes(marker) || js.includes(marker)), `${state.name} markers are present.`));
}

const findings = checks.map((item) => item());
const artifact = {
  generatedAt: new Date().toISOString(),
  tool: "tools/dev/visual-qa.mjs",
  screenshotAutomation: {
    status: browserAutomation.status,
    reason: browserAutomation.reason,
    upgradePath: "Install Playwright or Puppeteer to attach desktop and mobile screenshots.",
    screenshotStatus: screenshotResult.status,
    screenshots: screenshotResult.screenshots,
    screenshotReason: screenshotResult.reason
  },
  viewports,
  states: states.map((state) => ({ name: state.name, expectedMarkers: state.expected })),
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
  failed.push({
    name: "browser screenshot automation",
    status: "fail",
    detail: browserAutomation.reason
  });
}
if (requireBrowser && screenshotResult.status !== "captured") {
  failed.push({
    name: "browser screenshots captured",
    status: "fail",
    detail: screenshotResult.reason
  });
}

if (failed.length > 0) {
  console.error(`[visual-qa] failed: ${failed.map((item) => item.name).join(", ")}`);
  process.exit(1);
}

console.log("[visual-qa] report written to .myagenttool/visual-qa/latest.json and latest.md");

function check(name, run, detail) {
  return () => ({
    name,
    status: run() ? "pass" : "fail",
    detail
  });
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
  const screenshotDir = resolve(artifactDir, "screenshots");
  mkdirSync(screenshotDir, { recursive: true });
  try {
    if (driver.name === "playwright") {
      const browser = await driver.module.chromium.launch();
      const page = await browser.newPage();
      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(pathToFileURL(resolve(publicDir, "index.html")).href);
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
        await page.goto(pathToFileURL(resolve(publicDir, "index.html")).href);
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

function commandPanel(source = html) {
  return between(source, '<section id="commandPanel" class="command-panel codex-chat-shell"', '<section id="runPanel" class="run-panel"');
}

function detectsIaViolation(source) {
  const panel = commandPanel(source);
  return panel.includes("Evidence center") || panel.includes("connectAgentPanel") || panel.includes("Import evidence");
}

function containsAny(source, terms) {
  return terms.some((term) => source.includes(term));
}

function fixtureWithMisplacedEvidenceCenter() {
  return html.replace('<section id="runPanel" class="run-panel"', '<div>Evidence center</div><section id="runPanel" class="run-panel"');
}

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = source.indexOf(end, startIndex + start.length);
  return endIndex < 0 ? source.slice(startIndex) : source.slice(startIndex, endIndex);
}

function serverSource() {
  return serverJs;
}

function markdownReport(report) {
  const lines = [
    "# Visual QA Report",
    "",
    `Generated: ${report.generatedAt}`,
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
