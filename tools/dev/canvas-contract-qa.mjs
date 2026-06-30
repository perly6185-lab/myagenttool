import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const artifactDir = resolve(repoRoot, ".myagenttool/prototype-qa");
const canvasRoot = resolve(repoRoot, "docs/design/prototypes/canvas");
const schemaPath = resolve(canvasRoot, "scene-graph.schema.json");
const scenePath = resolve(canvasRoot, "managed-session-history.scene.json");
const importedScenePath = resolve(canvasRoot, "managed-session-history.imported.scene.json");
const agentWorkspaceScenePath = resolve(canvasRoot, "agent-workspace.scene.json");
const agentWorkspaceImportedScenePath = resolve(canvasRoot, "agent-workspace.imported.scene.json");
const canvasHtmlPath = resolve(canvasRoot, "prototype-canvas.html");
const canvasCssPath = resolve(canvasRoot, "prototype-canvas.css");
const canvasJsPath = resolve(canvasRoot, "prototype-canvas.js");
const exportedHtmlPath = resolve(canvasRoot, "managed-session-history.export.html");
const visualQaJsonPath = resolve(canvasRoot, "managed-session-history.visual-qa.json");
const visualQaMdPath = resolve(canvasRoot, "managed-session-history.visual-qa.md");
const agentWorkspaceExportedHtmlPath = resolve(canvasRoot, "agent-workspace.export.html");
const agentWorkspaceVisualQaJsonPath = resolve(canvasRoot, "agent-workspace.visual-qa.json");
const agentWorkspaceVisualQaMdPath = resolve(canvasRoot, "agent-workspace.visual-qa.md");

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const scene = JSON.parse(readFileSync(scenePath, "utf8"));
const importedScene = existsSync(importedScenePath) ? JSON.parse(readFileSync(importedScenePath, "utf8")) : null;
const agentWorkspaceScene = existsSync(agentWorkspaceScenePath) ? JSON.parse(readFileSync(agentWorkspaceScenePath, "utf8")) : null;
const agentWorkspaceImportedScene = existsSync(agentWorkspaceImportedScenePath) ? JSON.parse(readFileSync(agentWorkspaceImportedScenePath, "utf8")) : null;
const canvasHtml = existsSync(canvasHtmlPath) ? readFileSync(canvasHtmlPath, "utf8") : "";
const canvasCss = existsSync(canvasCssPath) ? readFileSync(canvasCssPath, "utf8") : "";
const canvasJs = existsSync(canvasJsPath) ? readFileSync(canvasJsPath, "utf8") : "";
const exportedHtml = existsSync(exportedHtmlPath) ? readFileSync(exportedHtmlPath, "utf8") : "";
const visualQa = existsSync(visualQaJsonPath) ? JSON.parse(readFileSync(visualQaJsonPath, "utf8")) : null;
const visualQaMd = existsSync(visualQaMdPath) ? readFileSync(visualQaMdPath, "utf8") : "";
const agentWorkspaceExportedHtml = existsSync(agentWorkspaceExportedHtmlPath) ? readFileSync(agentWorkspaceExportedHtmlPath, "utf8") : "";
const agentWorkspaceVisualQa = existsSync(agentWorkspaceVisualQaJsonPath) ? JSON.parse(readFileSync(agentWorkspaceVisualQaJsonPath, "utf8")) : null;
const agentWorkspaceVisualQaMd = existsSync(agentWorkspaceVisualQaMdPath) ? readFileSync(agentWorkspaceVisualQaMdPath, "utf8") : "";

const findings = [
  check("canvas contract files exist", () => [schemaPath, scenePath].every(existsSync), "Scene graph schema and managed session fixture exist."),
  check("schema requires Product Flow metadata", () => schemaRequires(["productFlow", "prototypeStates", "acceptanceSignals", "whatNotToShow"]), "Schema requires Product Flow, states, acceptance signals, and what-not-to-show metadata."),
  check("scene source is current ASCII prototype", () => scene.source?.type === "ascii" && scene.source?.path === ".myagenttool/runs/flow-validation-managed-session-history/ascii-prototype.md", "Scene graph points at the current ASCII prototype source."),
  check("scene has home and session detail surfaces", () => hasSurface("home-workspace") && hasSurface("session-detail"), "Scene graph separates home workspace from session detail."),
  check("home surface has three column regions", () => ["task-composer", "execution-status", "context-rail"].every((id) => hasRegion(id)), "Home surface models task composer, execution status, and context rail."),
  check("top-level regions carry Product Flow metadata", () => allRegions().every(hasProductFlowMetadata), "Every region carries role, owner surface, prototype states, acceptance signals, and what-not-to-show."),
  check("task composer keeps advanced concepts out", () => !containsForbidden(taskComposerText(), taskComposerForbiddenTerms()), "Task composer scene elements do not contain advanced evidence/session-detail concepts."),
  check("session detail owns follow-up controls", () => regionText("follow-up-composer").toLowerCase().includes("send follow-up") && !taskComposerText().toLowerCase().includes("send follow-up"), "Follow-up controls live in session detail, not the task composer."),
  check("context rail opens session detail", () => regionElements("context-rail").some((element) => element.interaction?.type === "open_surface" && element.interaction?.target === "session-detail"), "Context rail has an explicit Open session interaction."),
  check("imported scene exists", () => Boolean(importedScene), "ASCII import writes a managed-session-history imported scene graph."),
  check("imported scene source is current ASCII prototype", () => importedScene?.source?.type === "ascii" && importedScene?.source?.path === ".myagenttool/runs/flow-validation-managed-session-history/ascii-prototype.md", "Imported scene points at the current ASCII prototype source."),
  check("imported scene preserves owner regions", () => ["task-composer", "execution-status", "context-rail", "session-turns", "follow-up-composer"].every((id) => hasRegion(id, importedScene)), "Imported scene preserves task, execution, context, session turns, and follow-up regions."),
  check("imported task composer excludes cross-surface actions", () => !containsForbidden(regionText("task-composer", importedScene), [...taskComposerForbiddenTerms(), "continue result", "open session", "latest managed codex", "needs attention"]), "Imported task composer does not absorb right-rail or session-detail actions."),
  check("imported context rail opens session detail", () => regionElements("context-rail", importedScene).some((element) => element.interaction?.type === "open_surface" && element.interaction?.target === "session-detail"), "Imported context rail preserves Open session interaction."),
  check("canvas preview files exist", () => [canvasHtmlPath, canvasCssPath, canvasJsPath].every(existsSync), "Prototype Canvas HTML, CSS, and JS files exist."),
  check("canvas preview loads imported scene", () => canvasJs.includes("managed-session-history.imported.scene.json") && canvasHtml.includes("prototype-canvas.js"), "Canvas preview reads the imported scene graph."),
  check("canvas supports pan zoom drag", () => ["setZoom", "startPan", "draggingRegion", "movePointer"].every((marker) => canvasJs.includes(marker)), "Canvas JS supports zoom, panning, and region dragging."),
  check("canvas supports label editing", () => canvasHtml.includes("data-label-input") && canvasJs.includes("updateSelectedLabel"), "Canvas inspector can edit region and element labels."),
  check("canvas protects task composer boundary", () => ["Blocked boundary", "task-composer", "evidence center", "open session", "send follow-up"].every((marker) => canvasJs.toLowerCase().includes(marker.toLowerCase())), "Canvas editor validates forbidden cross-surface labels."),
  check("canvas has responsive shell", () => canvasCss.includes("@media (max-width: 980px)") && canvasCss.includes("grid-template-columns: 1fr"), "Canvas preview includes mobile stacking for review."),
  check("exported prototype files exist", () => [exportedHtmlPath, visualQaJsonPath, visualQaMdPath].every(existsSync), "Canvas export writes standalone HTML and Visual QA checklist artifacts."),
  check("exported HTML is standalone", () => exportedHtml.includes("<!doctype html>") && exportedHtml.includes("Exported from Prototype Canvas") && !exportedHtml.includes("fetch("), "Exported HTML can be opened without loading the scene JSON."),
  check("exported HTML preserves surfaces", () => ["Home Workspace", "Session Detail", "Current Task Intent", "Context, History, Governance"].every((marker) => exportedHtml.includes(marker)), "Exported HTML preserves home, session detail, task, and context surfaces."),
  check("Visual QA checklist has role and viewport coverage", () => visualQa?.productFlow?.roleFlow && visualQa?.viewports?.some((item) => item.name === "desktop") && visualQa?.viewports?.some((item) => item.name === "mobile"), "Visual QA checklist includes Product Flow and desktop/mobile viewports."),
  check("Visual QA checklist includes what-not-to-show tasks", () => visualQaMd.includes("What not to show") || visualQaMd.includes("Confirm \"Evidence Center\" is not shown in Current Task Intent."), "Visual QA checklist includes forbidden-content review tasks."),
  check("agent workspace contract scene exists", () => Boolean(agentWorkspaceScene), "Agent Workspace has a scene graph contract fixture."),
  check("agent workspace contract source is Phase B ASCII", () => agentWorkspaceScene?.source?.type === "ascii" && agentWorkspaceScene?.source?.path === ".myagenttool/runs/orca-inspired-agent-workspace-ui/agent-workspace-ascii-prototype.md", "Agent Workspace contract points at the Phase B ASCII source."),
  check("agent workspace imported scene exists", () => Boolean(agentWorkspaceImportedScene), "ASCII import writes an Agent Workspace imported scene graph."),
  check("agent workspace imported source is Phase B ASCII", () => agentWorkspaceImportedScene?.source?.type === "ascii" && agentWorkspaceImportedScene?.source?.path === ".myagenttool/runs/orca-inspired-agent-workspace-ui/agent-workspace-ascii-prototype.md", "Imported Agent Workspace scene points at the Phase B ASCII source."),
  check("agent workspace has required surfaces", () => ["run-workspace", "session-surface", "diff-surface", "terminal-surface", "evidence-surface", "approval-surface", "setup-surface", "mobile-task-first"].every((id) => hasSurface(id, agentWorkspaceImportedScene)), "Agent Workspace separates Run, Session, Diff, Terminal, Evidence, Approval, Setup, and mobile surfaces."),
  check("agent workspace run has owned regions", () => ["workspace-nav", "run-composer", "run-status", "workspace-context-rail"].every((id) => hasRegion(id, agentWorkspaceImportedScene)), "Run workspace has navigation, composer, status/result, and context rail regions."),
  check("agent workspace run composer excludes advanced surfaces", () => !containsForbidden(regionText("run-composer", agentWorkspaceImportedScene), ["terminal", "evidence", "approval", "setup", "raw jsonl", "hook names", "session turns", "private codex files"]), "Run composer does not absorb Terminal, Evidence, Approval, Setup, raw events, or private Codex concepts."),
  check("agent workspace nav exposes separate surfaces", () => ["Run", "Session", "Diff", "Terminal", "Evidence", "Approval", "Setup"].every((label) => regionText("workspace-nav", agentWorkspaceImportedScene).includes(label)), "Workspace navigation exposes role-owned surfaces separately."),
  check("agent workspace terminal is placeholder", () => regionText("terminal-surface-main", agentWorkspaceImportedScene).toLowerCase().includes("not connected yet") && regionText("terminal-surface-context", agentWorkspaceImportedScene).toLowerCase().includes("not governed yet"), "Terminal surface is clearly a managed-runtime placeholder."),
  check("agent workspace evidence preserves managed/imported distinction", () => surfaceText("evidence-surface", agentWorkspaceImportedScene).toLowerCase().includes("imported evidence is shown separately") && surfaceText("evidence-surface", agentWorkspaceImportedScene).toLowerCase().includes("export summary"), "Evidence surface distinguishes managed and imported evidence."),
  check("agent workspace approval has consequence context", () => regionText("approval-surface-context", agentWorkspaceImportedScene).toLowerCase().includes("audit") && regionText("approval-surface-main", agentWorkspaceImportedScene).toLowerCase().includes("risk"), "Approval surface includes risk and audit consequence context."),
  check("agent workspace setup prevents auto-enable", () => regionText("setup-surface-context", agentWorkspaceImportedScene).toLowerCase().includes("review setup") && allRegions(agentWorkspaceImportedScene).find((region) => region.id === "setup-surface-context")?.whatNotToShow?.some((item) => item.toLowerCase().includes("auto-enabled")), "Setup surface keeps agent connection reviewable."),
  check("canvas preview can switch imported scenes", () => canvasHtml.includes("agent-workspace.imported.scene.json") && canvasJs.includes("scenePicker") && canvasJs.includes("state.sceneUrl"), "Canvas preview can switch between managed session history and Agent Workspace scenes."),
  check("canvas boundary protects run composer", () => ["run-composer", "terminal", "approval inbox", "raw jsonl"].every((marker) => canvasJs.toLowerCase().includes(marker.toLowerCase())), "Canvas editor validates Agent Workspace Run composer forbidden labels."),
  check("agent workspace exported prototype files exist", () => [agentWorkspaceExportedHtmlPath, agentWorkspaceVisualQaJsonPath, agentWorkspaceVisualQaMdPath].every(existsSync), "Agent Workspace export writes standalone HTML and Visual QA checklist artifacts."),
  check("agent workspace exported HTML preserves surfaces", () => ["Run Workspace", "Session Surface", "Diff Surface", "Terminal Surface Placeholder", "Evidence Surface", "Approval Surface", "Setup Surface"].every((marker) => agentWorkspaceExportedHtml.includes(marker)), "Agent Workspace exported HTML preserves all role-owned surfaces."),
  check("agent workspace Visual QA has role coverage", () => agentWorkspaceVisualQa?.productFlow?.roleFlow?.includes("ordinary developer") && agentWorkspaceVisualQa?.productFlow?.roleFlow?.includes("auditor") && agentWorkspaceVisualQa?.viewports?.some((item) => item.name === "mobile"), "Agent Workspace Visual QA checklist includes cross-role Product Flow and mobile viewport coverage."),
  check("agent workspace Visual QA includes forbidden surface tasks", () => agentWorkspaceVisualQaMd.includes("Confirm \"raw terminal\" is not shown in Run Task Composer.") && agentWorkspaceVisualQaMd.includes("Confirm \"auto-enabled agents\" is not shown in Setup Surface Context."), "Agent Workspace Visual QA includes what-not-to-show checks for Run and Setup."),
];

const report = {
  generatedAt: new Date().toISOString(),
  contract: "docs/design/prototypes/canvas/managed-session-history.scene.json",
  findings: findings.map((item) => item()),
};

mkdirSync(artifactDir, { recursive: true });
writeFileSync(resolve(artifactDir, "canvas-contract-latest.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(resolve(artifactDir, "canvas-contract-latest.md"), markdownReport(report));

const failed = report.findings.filter((item) => item.status !== "pass");
if (failed.length > 0) {
  console.error(`[canvas-contract-qa] failed: ${failed.map((item) => item.name).join(", ")}`);
  process.exit(1);
}

console.log("[canvas-contract-qa] report written to .myagenttool/prototype-qa/canvas-contract-latest.json and canvas-contract-latest.md");

function check(name, run, detail) {
  return () => ({
    name,
    status: run() ? "pass" : "fail",
    detail,
  });
}

function schemaRequires(requiredKeys) {
  const serialized = JSON.stringify(schema);
  return requiredKeys.every((key) => serialized.includes(`"${key}"`));
}

function hasSurface(id, targetScene = scene) {
  return targetScene?.surfaces?.some((surface) => surface.id === id);
}

function hasRegion(id, targetScene = scene) {
  return allRegions(targetScene).some((region) => region.id === id);
}

function allRegions(targetScene = scene) {
  return targetScene?.surfaces?.flatMap((surface) => surface.regions ?? []) ?? [];
}

function hasProductFlowMetadata(region) {
  return Boolean(
    region.role &&
      region.ownerSurface &&
      region.productFlow?.roleFlow &&
      region.productFlow?.scenario &&
      region.productFlow?.ownerSurface &&
      region.prototypeStates?.length &&
      region.acceptanceSignals?.length &&
      region.whatNotToShow?.length,
  );
}

function regionElements(regionId, targetScene = scene) {
  return allRegions(targetScene).find((region) => region.id === regionId)?.elements ?? [];
}

function regionText(regionId, targetScene = scene) {
  return regionElements(regionId, targetScene)
    .map((element) => element.label ?? "")
    .join("\n");
}

function surfaceText(surfaceId, targetScene = scene) {
  return targetScene?.surfaces
    ?.find((surface) => surface.id === surfaceId)
    ?.regions?.flatMap((region) => region.elements ?? [])
    ?.map((element) => element.label ?? "")
    ?.join("\n") ?? "";
}

function taskComposerText() {
  return regionText("task-composer");
}

function taskComposerForbiddenTerms() {
  return [
    "evidence center",
    "import evidence",
    "raw jsonl",
    "hook names",
    "hook event",
    "integration builder",
    "session turns",
    "add follow-up",
    "send follow-up",
  ];
}

function containsForbidden(value, terms) {
  const lower = String(value).toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function markdownReport(report) {
  return [
    "# Canvas Contract QA Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Contract: ${report.contract}`,
    "",
    "## Findings",
    "",
    ...report.findings.map((item) => `- ${item.status.toUpperCase()} - ${item.name}: ${item.detail}`),
    "",
  ].join("\n");
}
