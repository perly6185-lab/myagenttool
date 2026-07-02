// Smoke coverage for ccusage governance:
// fixed report registrations, low-risk read-only metadata, custom registration
// notes, disable lifecycle, no task-template injection in argv, and the Phase 2
// wrapper RESULT output contract.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  CCUSAGE_REPORT_SPECS,
  CCUSAGE_VERSION,
  createCcusageAgentRegistration,
  createCcusageAgentRegistrations,
  createCcusageLifecycleRecipeInput,
} from "../../apps/server/src/services/ccusage-agent.mjs";
import { createAgentService } from "../../apps/server/src/services/agents.mjs";
import { createCcusageImportService } from "../../apps/server/src/services/ccusage-imports.mjs";
import { createInvocationCompletionRuntime } from "../../apps/server/src/services/invocations/completion.mjs";
import { createM3Service } from "../../apps/server/src/services/m3.mjs";

let passed = 0;
const ok = (msg) => { passed += 1; console.log(`  ok - ${msg}`); };

const cliScriptPath = process.platform === "win32"
  ? "C:\\Users\\demo\\AppData\\Roaming\\npm\\node_modules\\ccusage\\src\\cli.js"
  : "/usr/local/lib/node_modules/ccusage/src/cli.js";
const wrapperScriptPath = "tools/agents/ccusage-wrapper.mjs";

{
  const daily = createCcusageAgentRegistration({ cliScriptPath });
  assert.equal(daily.id, "agt_ccusage_daily");
  assert.equal(daily.command, "node");
  assert.deepEqual(daily.args, [wrapperScriptPath, "--ccusage-cli", cliScriptPath, "--report", "daily"]);
  assert.equal(daily.riskLevel, "low");
  assert.deepEqual(daily.riskTags, ["read_only", "read_local", "shell_exec"]);
  assert.equal(daily.economicModel, "free");
  assert.ok(!daily.args.some((arg) => String(arg).includes("{{task}}") || String(arg).includes("{{payloadJson}}")),
    "ccusage fixed report args must not render prompt text");
  ok("registration spec: daily fixed args + low-risk metadata");
}

{
  assert.throws(() => createCcusageAgentRegistration({ reportId: "custom_flags", cliScriptPath }), /Unsupported ccusage report id/);
  assert.throws(() => createCcusageAgentRegistration({ reportId: "daily" }), /cliScriptPath is required/);
  assert.throws(() => createCcusageAgentRegistration({ reportId: "daily", cliScriptPath, wrapperScriptPath: "" }), /wrapperScriptPath is required/);
  ok("registration spec: rejects unsupported report id and missing paths");
}

{
  const all = createCcusageAgentRegistrations({ cliScriptPath, costOwner: "team_finops" });
  assert.equal(all.length, CCUSAGE_REPORT_SPECS.length);
  assert.deepEqual(all.map((item) => item.id), CCUSAGE_REPORT_SPECS.map((item) => item.agentId));
  assert.ok(all.every((item) => item.costOwner === "team_finops"));
  assert.ok(all.some((item) => item.id === "agt_ccusage_codex_daily" && item.args.includes("codex_daily")));
  assert.ok(all.some((item) => item.id === "agt_ccusage_claude_daily" && item.args.includes("claude_daily")));
  ok("registration spec: creates all recommended report agents");
}

{
  const state = { device: { id: "dev_local_001", status: "online" }, agents: [], lifecycleAuditRecords: [] };
  let n = 0;
  const svc = createAgentService({
    state,
    now: () => "2026-07-02T00:00:00Z",
    nextId: (p) => `${p}_${++n}`,
    appendEvent: () => {},
  });
  const agent = svc.registerAgent(createCcusageAgentRegistration({ reportId: "monthly", cliScriptPath, costOwner: "team_finops" }));
  assert.equal(agent.id, "agt_ccusage_monthly");
  assert.equal(agent.adapter.command, "node");
  assert.deepEqual(agent.adapter.args, [wrapperScriptPath, "--ccusage-cli", cliScriptPath, "--report", "monthly"]);
  assert.equal(agent.adapter.outputFormat, "plain_result");
  assert.equal(agent.capabilities[0].riskLevel, "low");
  assert.deepEqual(agent.capabilities[0].riskTags, ["read_only", "read_local", "shell_exec"]);
  assert.equal(agent.economics.model, "free");
  assert.equal(agent.economics.costOwner, "team_finops");
  assert.ok(agent.registrationNotes.risk.includes("fixed ccusage report command"));
  const disabled = svc.disableAgent(agent);
  assert.equal(disabled.status, "succeeded");
  assert.equal(agent.status, "disabled");
  ok("agent service: registers ccusage agent and preserves governance metadata");
}

{
  const fixtureDir = join(tmpdir(), `ccusage-wrapper-smoke-${process.pid}`);
  rmSync(fixtureDir, { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });
  const fixture = join(fixtureDir, "ccusage-fixture.mjs");
  writeFileSync(fixture, [
    "const args = process.argv.slice(2);",
    "if (!args.includes('--json')) { console.error('missing json'); process.exit(3); }",
    "if (!args.includes('--offline')) { console.error('missing offline'); process.exit(4); }",
    "console.log(JSON.stringify([{ date: '2026-07-02', totalTokens: 42, totalCost: 0.12, args }]));",
  ].join("\n"));
  const wrapper = resolve("tools/agents/ccusage-wrapper.mjs");
  const output = execFileSync(process.execPath, [wrapper, "--ccusage-cli", fixture, "--report", "codex_daily"], {
    encoding: "utf8",
  });
  const resultLine = output.split(/\r?\n/).find((line) => line.startsWith("RESULT "));
  assert.ok(resultLine, "wrapper emits RESULT line");
  const result = JSON.parse(resultLine.slice("RESULT ".length));
  assert.equal(result.summary, "ccusage codex daily report generated with 1 row(s).");
  assert.equal(result.touchedUserFiles, false);
  assert.equal(result.output.source, "ccusage");
  assert.equal(result.output.reportId, "codex_daily");
  assert.equal(result.output.offline, true);
  assert.equal(result.output.report[0].totalTokens, 42);
  assert.equal(result.cost.amountSource, "free_local_tool");
  rmSync(fixtureDir, { recursive: true, force: true });
  ok("wrapper: emits structured RESULT for valid ccusage JSON");
}

{
  const wrapper = resolve("tools/agents/ccusage-wrapper.mjs");
  const badReport = spawnSync(process.execPath, [wrapper, "--ccusage-cli", cliScriptPath, "--report", "arbitrary"], {
    encoding: "utf8",
  });
  assert.notEqual(badReport.status, 0);
  assert.ok(badReport.stdout.includes("Unsupported ccusage report"));
  const badFlag = spawnSync(process.execPath, [wrapper, "--ccusage-cli", cliScriptPath, "--report", "daily", "--raw-shell"], {
    encoding: "utf8",
  });
  assert.notEqual(badFlag.status, 0);
  assert.ok(badFlag.stdout.includes("Unsupported ccusage wrapper argument"));
  ok("wrapper: blocks unsupported report ids and flags before spawning");
}

{
  const state = {
    device: { id: "dev_local_001", platform: "windows" },
    agents: [],
    lifecycleRecipes: [],
    lifecyclePolicyDecisions: [],
    lifecycleLocalApprovals: [],
    lifecycleQueuedActions: [],
    lifecycleAuditRecords: [],
    lifecycleRollbackRequests: [],
    privateCatalogEntries: [],
    signedBundleManifests: [],
    events: [],
  };
  let n = 0;
  const now = () => "2026-07-02T00:00:00Z";
  const agentSvc = createAgentService({ state, now, nextId: (p) => `${p}_${++n}`, appendEvent: () => {} });
  const agent = agentSvc.registerAgent(createCcusageAgentRegistration({ cliScriptPath }));
  agent.lifecycle.managedBy = "bridge";
  const m3 = createM3Service({
    state,
    now,
    nextId: (p) => `${p}_${++n}`,
    appendEvent: (event) => state.events.push(event),
    findAgent: (id) => state.agents.find((item) => item.id === id),
  });
  const recipe = m3.createLifecycleRecipe(createCcusageLifecycleRecipeInput({ action: "install", agentId: agent.id }));
  assert.equal(recipe.source.version, CCUSAGE_VERSION);
  m3.transitionLifecycleRecipe(recipe, "review");
  m3.transitionLifecycleRecipe(recipe, "approve");
  const approval = m3.requestLifecycleLocalApproval(recipe);
  m3.decideLifecycleLocalApproval(approval, "approve");
  const queued = m3.queueLifecycleAction(recipe);
  assert.equal(queued.executionEnabled, true);
  assert.equal(queued.command.commandId, "npm_global_install_pinned");
  assert.deepEqual(queued.command.args, ["install", "-g", `ccusage@${CCUSAGE_VERSION}`]);

  const unpinned = m3.createLifecycleRecipe({
    ...createCcusageLifecycleRecipeInput({ action: "install", agentId: agent.id }),
    source: {
      type: "manual_entry",
      uri: "npm://ccusage@latest",
      author: "myagenttool",
      version: "latest",
      signatureStatus: "not_required",
    },
    recipeCommand: {
      commandId: "npm_global_install_pinned",
      executable: "npm",
      args: ["install", "-g", "ccusage@latest"],
    },
  });
  m3.transitionLifecycleRecipe(unpinned, "review");
  m3.transitionLifecycleRecipe(unpinned, "approve");
  const unpinnedApproval = m3.requestLifecycleLocalApproval(unpinned);
  m3.decideLifecycleLocalApproval(unpinnedApproval, "approve");
  const blocked = m3.queueLifecycleAction(unpinned);
  assert.equal(blocked.executionEnabled, false);
  assert.equal(blocked.command, null);
  ok("lifecycle recipe: pinned ccusage install exposes only allowlisted command");
}

{
  const now = () => "2026-07-02T00:00:00Z";
  let n = 0;
  const state = {
    projects: [{ id: "prj_ccusage", ownerTeamId: "team_local" }],
    currentProjectId: "prj_ccusage",
    agents: [
      {
        id: "agt_ccusage_daily",
        name: "ccusage Daily Report",
        economics: { model: "free", costOwner: "team_finops", currency: "USD", budgetPoolId: null },
        location: { type: "local_device", deviceId: "dev_local_001" },
      },
    ],
    invocations: [],
    compareRuns: [],
    events: [],
    spans: [],
    auditSummaries: [],
    agentUsageSummaries: [],
    importedUsageEstimates: [],
    ledgerEntries: [],
  };
  const invocation = {
    id: "inv_ccusage_report",
    agentId: "agt_ccusage_daily",
    requestedBy: "usr_local",
    projectId: "prj_ccusage",
    worktreeId: null,
    status: "running",
    input: { metadata: { projectId: "prj_ccusage" } },
    delivery: { deviceId: "dev_local_001" },
    cancellation: { state: "none" },
    createdAt: now(),
  };
  state.invocations.push(invocation);
  const m3 = createM3Service({
    state,
    now,
    nextId: (p) => `${p}_${++n}`,
    appendEvent: (event) => state.events.push(event),
    findAgent: (id) => state.agents.find((item) => item.id === id),
  });
  const { recordCcusageImportedEstimates } = createCcusageImportService({
    state,
    now,
    nextId: (p) => `${p}_${++n}`,
    appendEvent: (event) => state.events.push(event),
  });
  const completion = createInvocationCompletionRuntime({
    state,
    now,
    appendEvent: (event) => state.events.push(event),
    persistStateSoon: () => {},
    namespace: "smoke",
    protocolVersion: "0",
    findAgent: (id) => state.agents.find((item) => item.id === id),
    findInvocation: (id) => state.invocations.find((item) => item.id === id),
    closeCodexSession: () => {},
    isTerminal: (status) => ["succeeded", "failed", "cancelled", "timed_out", "expired", "rejected"].includes(status),
    recordInvocationLedgerEntry: m3.recordInvocationLedgerEntry,
    recordCcusageImportedEstimates,
  });
  completion.completeInvocation(invocation, {
    status: "succeeded",
    summary: "ccusage daily report generated with 2 row(s).",
    result: {
      output: {
        source: "ccusage",
        reportId: "daily",
        offline: true,
        filters: { since: "2026-07-01", until: "2026-07-02", timezone: "Asia/Shanghai" },
        report: [
          { date: "2026-07-01", provider: "openai", model: "gpt-5", inputTokens: 100, outputTokens: 20, totalCost: 0.1234567 },
          { date: "2026-07-02", source: "anthropic", modelName: "claude", total_tokens: 42, totalCostUSD: 0.42 },
        ],
      },
      cost: { model: "ccusage", billable: false, unknown: false, amountUsd: 0, amountSource: "free_local_tool" },
    },
  });
  assert.equal(state.importedUsageEstimates.length, 2);
  assert.equal(state.ledgerEntries.length, 0);
  assert.ok(state.importedUsageEstimates.every((item) => item.authoritative === false));
  assert.ok(state.importedUsageEstimates.every((item) => item.amountSource === "imported_ccusage_report"));
  assert.ok(state.importedUsageEstimates.every((item) => item.economicModel === "external_billed"));
  assert.equal(state.importedUsageEstimates[0].estimatedCostUsd, 0.123457);
  assert.equal(state.importedUsageEstimates[0].inputTokens, 100);
  assert.equal(state.importedUsageEstimates[1].estimatedCostUsd, 0.42);
  assert.ok(state.events.some((event) => event.type === "ccusage_imported_estimates_recorded"));
  ok("completion: imports ccusage estimates without creating authoritative ledger entries");
}

console.log(`\nccusage-agent-smoke: ${passed} checks passed`);
