import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const artifactDir = resolve(repoRoot, ".myagenttool/prototype-qa");
const prototypeRoot = resolve(repoRoot, "docs/design/prototypes");
const htmlPath = resolve(prototypeRoot, "managed-session-context-rail.html");
const cssPath = resolve(prototypeRoot, "managed-session-context-rail.css");
const jsPath = resolve(prototypeRoot, "managed-session-context-rail.js");
const specPath = resolve(prototypeRoot, "managed-session-context-rail.spec.json");

const html = readFileSync(htmlPath, "utf8");
const css = readFileSync(cssPath, "utf8");
const js = readFileSync(jsPath, "utf8");
const spec = JSON.parse(readFileSync(specPath, "utf8"));

const findings = [
  check("prototype files exist", () => [htmlPath, cssPath, jsPath, specPath].every(existsSync), "HTML, CSS, JS, and spec files are present."),
  check("state tabs exist", () => ["ready", "running", "approval", "succeeded"].every((state) => html.includes(`data-state=\"${state}\"`)), "Ready, running, approval, and succeeded states are selectable."),
  check("right rail owns latest session", () => contextPanel().includes("Latest Managed Codex Session") && !taskPanel().includes("Latest Managed Codex Session"), "Latest session appears in the context rail, not the task composer."),
  check("session detail is opened from right rail", () => sessionDetail().includes("data-session-detail") && sessionDetail().includes("hidden") && contextPanel().includes("data-open-session-button") && contextPanel().includes('aria-expanded="false"'), "Full session detail is hidden by default and opened from the context rail."),
  check("session detail owns follow-up turns", () => sessionDetail().includes("Session turns") && sessionDetail().includes("Add follow-up") && !taskPanel().includes("Add follow-up"), "Follow-up turns appear in session detail, not the task composer."),
  check("task composer excludes advanced evidence terms", () => !forbiddenTerms().some((term) => taskPanel().toLowerCase().includes(term)), "Task composer stays focused on task intent and run controls."),
  check("mobile responsive rule exists", () => css.includes("@media (max-width: 760px)") && css.includes("grid-template-columns: 1fr"), "Prototype includes mobile stacking CSS."),
  check("spec includes Product Flow owner surface", () => spec.ownerSurface?.toLowerCase().includes("right rail"), "Spec preserves Product Flow owner surface."),
  check("script drives prototype states", () => ["ready", "running", "approval", "succeeded"].every((state) => js.includes(`${state}:`)), "Prototype state script covers all expected states."),
  check("script toggles session detail", () => js.includes("toggleSessionDetail") && js.includes("aria-expanded") && js.includes("Close session"), "Prototype JS opens and closes session detail from the right rail."),
];

const report = {
  generatedAt: new Date().toISOString(),
  prototype: "docs/design/prototypes/managed-session-context-rail.html",
  findings: findings.map((item) => item()),
};

mkdirSync(artifactDir, { recursive: true });
writeFileSync(resolve(artifactDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(resolve(artifactDir, "latest.md"), markdownReport(report));

const failed = report.findings.filter((item) => item.status !== "pass");
if (failed.length > 0) {
  console.error(`[prototype-qa] failed: ${failed.map((item) => item.name).join(", ")}`);
  process.exit(1);
}

console.log("[prototype-qa] report written to .myagenttool/prototype-qa/latest.json and latest.md");

function check(name, run, detail) {
  return () => ({
    name,
    status: run() ? "pass" : "fail",
    detail,
  });
}

function taskPanel() {
  return between(html, '<section class="panel task-panel"', '<section class="panel execution-panel"');
}

function contextPanel() {
  return between(html, '<aside class="panel context-panel"', "</aside>");
}

function sessionDetail() {
  return elementByMarker(html, "data-session-detail");
}

function forbiddenTerms() {
  return [
    "evidence center",
    "import evidence",
    "jsonl",
    "hook names",
    "hook event",
    "integration builder",
    "add follow-up",
    "session turns",
  ];
}

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = source.indexOf(end, startIndex + start.length);
  return endIndex < 0 ? source.slice(startIndex) : source.slice(startIndex, endIndex);
}

function elementByMarker(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return "";
  const startIndex = source.lastIndexOf("<section", markerIndex);
  if (startIndex < 0) return "";
  const endIndex = source.indexOf("</section>", markerIndex);
  return endIndex < 0 ? source.slice(startIndex) : source.slice(startIndex, endIndex);
}

function markdownReport(report) {
  return [
    "# Prototype QA Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Prototype: ${report.prototype}`,
    "",
    "## Findings",
    "",
    ...report.findings.map((item) => `- ${item.status.toUpperCase()} - ${item.name}: ${item.detail}`),
    "",
  ].join("\n");
}
