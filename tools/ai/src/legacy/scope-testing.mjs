import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const scopeTestingContext = {
  repoRoot: null,
  commandOutput: null,
  fail: null,
  option: null,
  writeOrPrint: null,
};

export function configureScopeTestingCommandsContext(context) {
  scopeTestingContext.repoRoot = context.repoRoot;
  scopeTestingContext.commandOutput = context.commandOutput;
  scopeTestingContext.fail = context.fail;
  scopeTestingContext.option = context.option;
  scopeTestingContext.writeOrPrint = context.writeOrPrint;
}

function requireContext(name) {
  const value = scopeTestingContext[name];
  if (!value) throw new Error(`Scope/testing context ${name} has not been configured.`);
  return value;
}

function repoRoot() {
  return requireContext("repoRoot");
}

function commandOutput(command, args) {
  return requireContext("commandOutput")(command, args);
}

function fail(message) {
  return requireContext("fail")(message);
}

function option(args, name) {
  return requireContext("option")(args, name);
}

function writeOrPrint(content, out) {
  return requireContext("writeOrPrint")(content, out);
}

export function scopeCheck(args) {
  const planFile = option(args, "--plan-file");
  const plan = planFile ? JSON.parse(readFileSync(resolve(repoRoot(), planFile), "utf8")) : undefined;
  const base = option(args, "--base") ?? "HEAD";
  const allowDrift = option(args, "--allow-drift") ?? "";
  const result = buildScopeCheckResult({ plan, planFile: planFile ?? "", base, allowDrift });
  const content = args.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : formatScopeCheck(result);
  writeOrPrint(content, option(args, "--out"));
  if (!result.allowed) {
    fail("Scope or Product Flow drift is not allowed. Provide concrete Product Flow coverage or reduce the diff.");
  }
}

export function testingPlan(args) {
  const change = option(args, "--change") ?? "docs";
  const changes = parseChangeList(option(args, "--changes"));
  const risk = option(args, "--risk") ?? "medium";
  const plan = testingPlanFor({ change, changes, risk });
  const content = args.includes("--json") ? `${JSON.stringify(plan, null, 2)}\n` : formatTestingPlan(plan);
  writeOrPrint(content, option(args, "--out"));
}

export function formatScopeCheck(result) {
  return `# AI Scope Check

Base: ${result.base}
Plan file: ${result.planFile || "not provided"}
Drift level: ${result.driftLevel}
Allowed: ${result.allowed ? "yes" : "no"}
Policy action: ${result.policyAction ?? "pass"}
Override: ${result.allowDrift || "none"}

## Changed Files

${list(result.changedFiles)}

## Declared Files

${list(result.declaredFiles)}

## Undeclared Files

${list(result.undeclaredFiles)}

## Product Flow Gaps

${list(result.productFlowGaps)}

## Summary

${result.summary}
`;
}

export function formatTestingPlan(plan) {
  return `# AI Testing Skills Plan

Matched change types: ${plan.changes?.join(", ") ?? plan.change}
Risk: ${plan.risk}

## Required Evidence

${list(plan.requiredEvidence)}

## Recommended Commands

${list(plan.commands)}

## Manual Evidence

${list(plan.manualEvidence)}

## Skill Guidance

${list(plan.skillGuidance)}
`;
}

function changedFilesSince(base) {
  const diffFiles = lines(commandOutput("git", ["diff", "--name-only", base, "--"]));
  const statusFiles = commandOutput("git", ["status", "--short"])
    .split(/\r?\n/)
    .map(statusPath)
    .filter(Boolean);
  return [...new Set([...diffFiles, ...statusFiles])];
}

export function buildScopeCheckResult({ plan, planFile, base, allowDrift }) {
  const changedFiles = changedFilesSince(base);
  const hasPlan = Boolean(plan);
  const declaredFiles = new Set((plan?.filesToTouch ?? []).map(normalizePath));
  const undeclaredFiles = hasPlan ? changedFiles.filter((file) => !declaredFiles.has(normalizePath(file))) : [];
  const driftLevel = classifyScopeDrift({ changedFiles, undeclaredFiles, allowDrift });
  const productFlowGaps = hasPlan ? productFlowPlanGaps(plan) : [];
  const allowed = (driftLevel !== "high" || Boolean(allowDrift)) && productFlowGaps.length === 0;
  return {
    base,
    planFile,
    hasPlan,
    changedFiles,
    declaredFiles: [...declaredFiles],
    undeclaredFiles,
    productFlowGaps,
    driftLevel,
    allowed,
    policyAction: productFlowGaps.length > 0 ? "fail" : scopeDriftAction(driftLevel, allowDrift),
    allowDrift,
    summary: scopeDriftSummary({ changedFiles, undeclaredFiles, driftLevel, allowDrift, hasPlan, productFlowGaps }),
  };
}

export function classifyScopeDrift({ changedFiles, undeclaredFiles, allowDrift }) {
  if (changedFiles.length === 0 || undeclaredFiles.length === 0) return "none";
  if (allowDrift) return "overridden";
  if (undeclaredFiles.length <= 2 && undeclaredFiles.every((file) => /^docs\/|^\.github\//.test(normalizePath(file)))) return "low";
  if (undeclaredFiles.length <= 4) return "medium";
  return "high";
}

function scopeDriftSummary({ changedFiles, undeclaredFiles, driftLevel, allowDrift, hasPlan = true, productFlowGaps = [] }) {
  if (productFlowGaps.length > 0) return `Product Flow plan gaps: ${productFlowGaps.join("; ")}`;
  if (changedFiles.length === 0) return "No changed files detected.";
  if (!hasPlan) return "No plan file was provided; changed files are listed without drift classification.";
  if (undeclaredFiles.length === 0) return "All changed files were declared in the code plan.";
  if (allowDrift) return `Scope drift was explicitly allowed: ${allowDrift}`;
  return `${undeclaredFiles.length} changed file(s) were not declared in the code plan.`;
}

function scopeDriftAction(driftLevel, allowDrift) {
  if (driftLevel === "high" && !allowDrift) return "fail";
  if (["low", "medium", "overridden"].includes(driftLevel)) return "warn";
  return "pass";
}

export function productFlowPlanGaps(plan) {
  const plannedFiles = (plan?.filesToTouch ?? []).map(normalizePath);
  if (!plannedFiles.some(isProductFacingPlanFile)) return [];

  const gaps = [];
  if (!hasConcreteProductFlow(plan.productFlow)) {
    gaps.push("productFlow must use concrete role, scenario, owner surface, usability task, and what-not-to-show values");
  }
  if (!stringArrayOr(plan.affectedSurfaces, []).some((item) => !isPlaceholderProductFlowValue(item))) {
    gaps.push("affectedSurfaces must name the Product Flow owner surface");
  }
  if (!stringArrayOr(plan.prototypeStates, []).some((item) => !isPlaceholderProductFlowValue(item))) {
    gaps.push("prototypeStates must list the UI states being verified");
  }
  if (!stringArrayOr(plan.whatNotToShow, []).some((item) => !isPlaceholderProductFlowValue(item))) {
    gaps.push("whatNotToShow must list content that stays out of the owner surface");
  }
  if (!stringArrayOr(plan.visualQaTasks, []).some((item) => !isPlaceholderProductFlowValue(item))) {
    gaps.push("visualQaTasks must list Product Flow visual checks");
  }
  return gaps;
}

function isProductFacingPlanFile(file) {
  return file.startsWith("apps/web/")
    || file === "DESIGN.md"
    || file.startsWith("docs/design/")
    || file === "docs/engineering/VISUAL_QA.md";
}

export function testingPlanFor({ change, changes, risk }) {
  const normalizedChanges = normalizeChangeTypes(changes ?? [change ?? "docs"]);
  const normalizedRisk = normalizeLabelValue(risk);
  const base = {
    change: normalizedChanges.join("+"),
    changes: normalizedChanges,
    risk: normalizedRisk,
    requiredEvidence: ["PR lists automated checks run.", "PR lists manual verification or states why it is not needed."],
    commands: ["pnpm docs:check", "pnpm repo:check", "pnpm typecheck", "pnpm test"],
    manualEvidence: [],
    skillGuidance: ["Use Testing skills as guidance; generated tests remain repository-owned and reviewable."],
  };

  if (normalizedChanges.length === 1 && normalizedChanges.includes("docs")) {
    base.commands = ["pnpm docs:check", "pnpm repo:check"];
    base.requiredEvidence.push("Documentation links and source docs are checked.");
  }
  if (normalizedChanges.includes("docs")) {
    base.requiredEvidence.push("Documentation links and source docs are checked.");
  }
  if (normalizedChanges.includes("web")) {
    base.requiredEvidence.push("Visual QA evidence for desktop and mobile viewports.");
    base.requiredEvidence.push("Product Flow evidence for role, owner surface, prototype states, and what-not-to-show checks.");
    base.manualEvidence.push("Screenshot or artifact paths for UI changes.");
    base.manualEvidence.push("Role-specific usability task result from docs/design/PRODUCT_FLOWS.md.");
    base.commands.push("pnpm smoke:local");
    base.commands.push("pnpm visual:qa", "pnpm visual:qa:browser");
  }
  if (normalizedChanges.includes("server")) {
    base.requiredEvidence.push("Integration evidence for API, queue, audit, or persistence behavior.");
  }
  if (normalizedChanges.includes("desktop")) {
    base.requiredEvidence.push("Cross-platform process execution and cancellation evidence.");
    base.manualEvidence.push("Windows/macOS/Linux evidence or explicit gap.");
  }
  if (normalizedChanges.includes("protocol")) {
    base.requiredEvidence.push("State-machine or schema compatibility evidence.");
  }
  if (normalizedChanges.includes("security")) {
    base.requiredEvidence.push("Security review evidence for auth, credentials, data, and local execution.");
    base.skillGuidance.push("Use secure-app-builder style review before merge.");
  }
  if (normalizedChanges.includes("release")) {
    base.requiredEvidence.push("Release, rollback, and deployment preflight evidence.");
    base.commands.push("pnpm release:check", "pnpm deploy:check");
  }
  if (normalizedChanges.includes("adapter")) {
    base.requiredEvidence.push("Adapter contract evidence for success, failure, and cancellation paths.");
  }
  if (["high", "critical"].includes(normalizedRisk)) {
    base.requiredEvidence.push("Residual risks and missing test gaps are recorded.");
    base.commands.push("pnpm github:check:issues");
  }
  return {
    ...base,
    requiredEvidence: uniqueStrings(base.requiredEvidence),
    commands: uniqueStrings(base.commands),
    manualEvidence: uniqueStrings(base.manualEvidence),
    skillGuidance: uniqueStrings(base.skillGuidance),
  };
}

export function inferChangeType(files) {
  return inferChangeTypes(files)[0] ?? "docs";
}

export function inferChangeTypes(files) {
  const normalizedFiles = (files ?? []).map((file) => normalizePath(file).toLowerCase());
  const changes = [];
  const add = (change) => {
    if (!changes.includes(change)) changes.push(change);
  };
  if (normalizedFiles.some((file) => file.startsWith("apps/web/"))) add("web");
  if (normalizedFiles.some((file) => file.startsWith("apps/desktop/") || file.includes("desktop") || file.includes("local-execution"))) add("desktop");
  if (normalizedFiles.some((file) => file.startsWith("apps/server/"))) add("server");
  if (normalizedFiles.some((file) => file.startsWith("packages/protocol/") || file.includes("state-machine") || file.includes("schema") || file.includes("protocol"))) add("protocol");
  if (normalizedFiles.some((file) => /security|auth|credential|secret|privacy|data-governance|data-retention|billing|cost|quota/.test(file))) add("security");
  if (normalizedFiles.some((file) => file.startsWith("tools/release/") || file.startsWith("tools/deploy/") || file.includes("release") || file.includes("deploy") || file.includes("rollback"))) add("release");
  if (normalizedFiles.some((file) => file.startsWith("packages/adapters/") || file.includes("adapter") || file.includes("coding-wrapper"))) add("adapter");
  if (normalizedFiles.length === 0 || normalizedFiles.some((file) => file.startsWith("docs/") || file.startsWith(".github/"))) add("docs");
  return normalizeChangeTypes(changes);
}

function normalizeChangeTypes(changes) {
  const order = ["docs", "web", "server", "desktop", "protocol", "security", "release", "adapter"];
  const normalized = uniqueStrings((changes ?? []).map((change) => normalizeLabelValue(change)).filter(Boolean));
  const known = order.filter((change) => normalized.includes(change));
  const unknown = normalized.filter((change) => !order.includes(change));
  return [...known, ...unknown].length > 0 ? [...known, ...unknown] : ["docs"];
}

function parseChangeList(value) {
  if (!value) return undefined;
  return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
}

export function uniqueStrings(items) {
  return [...new Set(items.filter(Boolean))];
}

export function inferRiskLevel(plan) {
  const text = `${plan?.summary ?? ""}\n${(plan?.risks ?? []).join("\n")}\n${(plan?.steps ?? []).join("\n")}`.toLowerCase();
  if (/critical|production|billing|credential|secret|security|local execution|delete|destructive/.test(text)) return "high";
  if (/risk|permission|data|deploy|release|desktop|adapter|migration/.test(text)) return "medium";
  return "low";
}

function hasConcreteProductFlow(productFlow) {
  const flow = normalizeProductFlow(productFlow);
  return [
    flow.roleFlow,
    flow.scenario,
    flow.frequency,
    flow.ownerSurface,
    flow.usabilityTask,
    flow.whatNotToShow,
    flow.partialAcceptanceOrFollowUp,
  ].every((value) => !isPlaceholderProductFlowValue(value));
}

function normalizeProductFlow(productFlow) {
  return {
    roleFlow: productFlow?.roleFlow ?? "Requires Product Flow triage.",
    scenario: productFlow?.scenario ?? "Requires Product Flow triage.",
    frequency: productFlow?.frequency ?? "Requires Product Flow triage.",
    ownerSurface: productFlow?.ownerSurface ?? "Requires Product Flow triage.",
    usabilityTask: productFlow?.usabilityTask ?? "Requires Product Flow triage.",
    whatNotToShow: productFlow?.whatNotToShow ?? "Requires Product Flow triage.",
    partialAcceptanceOrFollowUp: productFlow?.partialAcceptanceOrFollowUp ?? "Requires Product Flow triage.",
  };
}

function isPlaceholderProductFlowValue(value) {
  return /not applicable|requires product-flow triage|update if|must cite docs\/design\/product_flows|todo|n\/a/i.test(String(value ?? ""));
}

function stringArrayOr(value, fallback) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : fallback;
}

function normalizeLabelValue(value) {
  return String(value ?? "unspecified").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unspecified";
}

function normalizePath(path) {
  return path.replace(/\\/g, "/");
}

function lines(output) {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function statusPath(line) {
  const path = line.replace(/^.{1,2}\s+/, "").trim();
  const rename = path.match(/^.+\s+->\s+(.+)$/);
  return rename?.[1] ?? path;
}

function list(items) {
  if (!items || items.length === 0) return "- None.";
  return items.map((item) => `- ${item}`).join("\n");
}
