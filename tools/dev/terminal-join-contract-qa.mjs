import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const artifactDir = resolve(repoRoot, ".myagenttool/terminal-join-contract-qa");
const contractPath = resolve(repoRoot, "docs/engineering/MANAGED_TERMINAL_JOIN_CONTRACT.md");
const htmlPath = resolve(repoRoot, "apps/web/public/index.html");
const jsPath = resolve(repoRoot, "apps/web/public/app.js");

const contract = readFileSync(contractPath, "utf8");
const html = readFileSync(htmlPath, "utf8");
const js = readFileSync(jsPath, "utf8");

const findings = [
  check("contract defines Product Flow", () => includesAll(contract, ["Role flow", "Scenario", "Owner surface", "What not to show"]), "Contract includes role, scenario, owner surface, and exclusions."),
  check("contract defines UI ownership", () => includesAll(contract, ["The Terminal workspace surface owns", "Run owns none of the terminal controls", "Evidence owns terminal proof", "Approval owns pending terminal permission", "Setup owns runtime target configuration"]), "Contract separates Terminal, Run, Evidence, Approval, and Setup ownership."),
  check("contract defines blocked states", () => includesAll(contract, ["unavailable", "blocked_unmanaged", "blocked_policy", "approval_required", "attaching", "attached", "detached", "exited", "error"]), "Contract covers available, blocked, attached, detached, exit, and error states."),
  check("contract defines registry fields", () => includesAll(contract, ["terminalSessionId", "ownerInvocationId", "deviceId", "repoPath", "cwd", "shell", "runtimeKind", "status", "policyProfile", "evidenceIds"]), "Contract defines managed terminal session registry fields."),
  check("contract defines protocol events", () => includesAll(contract, ["terminal.session.create", "terminal.input.submit", "terminal.output.chunk", "terminal.resize", "terminal.permission.request", "terminal.permission.resolved", "terminal.exit", "terminal.policy.blocked"]), "Contract defines terminal lifecycle, IO, resize, permission, exit, and policy events."),
  check("contract defines evidence model", () => includesAll(contract, ["terminal_session_start", "terminal_input", "terminal_output_chunk", "terminal_command_summary", "terminal_permission", "terminal_exit", "terminal_policy_event"]), "Contract distinguishes terminal evidence record types."),
  check("contract defines approval join", () => includesAll(contract, ["approvalRequestId", "requestedAction", "riskLevel", "commandSummary", "consequence", "timeoutAt"]), "Contract defines fields required by approval UI."),
  check("contract maps runtime issues", () => includesAll(contract, ["#145", "#146", "#147", "#148", "#149", "#150", "#157"]), "Contract maps UI/runtime join to runtime issues."),
  check("web terminal placeholder references contract", () => html.includes("terminalSurfaceContext") && html.includes("MANAGED_TERMINAL_JOIN_CONTRACT.md"), "Web Console Terminal surface points to the join contract."),
  check("web render rules keep terminal separate", () => js.includes("showTerminalSurface") && js.includes("els.terminalSurfaceContext.hidden = !showTerminalSurface") && js.includes("els.commandPanel.hidden = !showRunSurface"), "Web Console renders Terminal as its own surface and keeps Run separate."),
  check("run composer excludes terminal controls", () => !commandPanel().toLowerCase().includes("terminal") && !commandPanel().toLowerCase().includes("pty") && !commandPanel().toLowerCase().includes("ssh"), "Run composer does not contain terminal, PTY, or SSH controls."),
  check("terminal placeholder blocks unmanaged proof", () => html.includes("does not treat an unmanaged local shell as governed evidence") && html.includes("Do not present unmanaged terminal output as managed proof"), "Terminal placeholder states unmanaged shells are not managed proof."),
];

const report = {
  generatedAt: new Date().toISOString(),
  contract: "docs/engineering/MANAGED_TERMINAL_JOIN_CONTRACT.md",
  findings: findings.map((item) => item()),
};

mkdirSync(artifactDir, { recursive: true });
writeFileSync(resolve(artifactDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(resolve(artifactDir, "latest.md"), markdownReport(report));

const failed = report.findings.filter((item) => item.status !== "pass");
if (failed.length > 0) {
  console.error(`[terminal-join-contract-qa] failed: ${failed.map((item) => item.name).join(", ")}`);
  process.exit(1);
}

console.log("[terminal-join-contract-qa] report written to .myagenttool/terminal-join-contract-qa/latest.json and latest.md");

function check(name, run, detail) {
  return () => ({
    name,
    status: run() ? "pass" : "fail",
    detail,
  });
}

function includesAll(source, markers) {
  return markers.every((marker) => source.includes(marker));
}

function commandPanel() {
  return between(html, '<section id="commandPanel" class="command-panel">', '<section id="runPanel" class="run-panel"');
}

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = source.indexOf(end, startIndex + start.length);
  return endIndex < 0 ? source.slice(startIndex) : source.slice(startIndex, endIndex);
}

function markdownReport(report) {
  return [
    "# Terminal Join Contract QA Report",
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
