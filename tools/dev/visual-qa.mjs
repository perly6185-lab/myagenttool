import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const publicDir = resolve(repoRoot, "apps/web/public");
const artifactDir = resolve(repoRoot, ".myagenttool/visual-qa");
const html = readFileSync(resolve(publicDir, "index.html"), "utf8");
const css = readFileSync(resolve(publicDir, "styles.css"), "utf8");
const js = readFileSync(resolve(publicDir, "app.js"), "utf8");
const requireBrowser = process.argv.includes("--require-browser");
const browserAutomation = await detectBrowserAutomation();

const viewports = [
  { name: "desktop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 }
];

const states = [
  {
    name: "empty",
    expected: ["What should your computer do?", "Run on this computer", "Activity", "Result"]
  },
  {
    name: "approval needed",
    expected: ["Needs attention", "approvalQueueList", "Approve", "Deny"]
  },
  {
    name: "codex supervision",
    expected: ["Codex supervision", "Managed sessions", "Review diff", "Needs attention"]
  },
  {
    name: "connect agent",
    expected: ["Connect agent", "Discovery", "Integration controls", "candidateList"]
  },
  {
    name: "evidence center",
    expected: ["Evidence center", "evidenceTypeFilter", "evidenceSourceFilter", "Export summary"]
  },
  {
    name: "imported evidence",
    expected: ["Import evidence", "imported_after_the_fact", "No private auth files were read"]
  }
];

const checks = [
  check("desktop and mobile viewport metadata", () => viewports.every((item) => item.width > 0 && item.height > 0), "Viewport metadata is present for desktop and mobile."),
  check("mobile CSS breakpoint", () => css.includes("@media (max-width: 760px)"), "Mobile breakpoint exists."),
  check("long text overflow guard", () => css.includes("overflow-wrap: anywhere"), "Long text overflow guard exists."),
  check("stable column ownership", () => !commandPanel().includes("connectAgentPanel") && !commandPanel().includes("Evidence center"), "Management tools stay out of task composer."),
  check("raw logs do not dominate result", () => html.includes("Technical details") && html.includes("<summary>Technical details</summary>"), "Technical details are collapsed."),
  check("primary controls visible", () => html.includes("id=\"runButton\"") && html.includes("id=\"cancelButton\""), "Run and cancel controls exist."),
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
    upgradePath: "Install Playwright or Puppeteer and extend this tool to attach screenshots."
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
  for (const packageName of ["playwright", "puppeteer"]) {
    try {
      await import(packageName);
      return {
        status: "available",
        reason: `${packageName} is installed. Screenshot automation can be enabled in this tool.`
      };
    } catch {
      // Try the next supported package.
    }
  }
  return {
    status: "not_configured",
    reason: "No browser automation dependency is installed in this workspace."
  };
}

function commandPanel(source = html) {
  return between(source, '<section class="command-panel">', '<section class="run-panel"');
}

function detectsIaViolation(source) {
  const panel = commandPanel(source);
  return panel.includes("Evidence center") || panel.includes("connectAgentPanel") || panel.includes("Import evidence");
}

function fixtureWithMisplacedEvidenceCenter() {
  return html.replace('<section class="run-panel"', '<div>Evidence center</div><section class="run-panel"');
}

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = source.indexOf(end, startIndex + start.length);
  return endIndex < 0 ? source.slice(startIndex) : source.slice(startIndex, endIndex);
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
