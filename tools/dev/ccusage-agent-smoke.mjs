// Smoke coverage for ccusage governance (post full-unification, ADR 0007):
// the wrapper RESULT output contract, the pinned-install lifecycle recipe,
// estimate import (non-authoritative, raw-omitted), and the ccusage.report tool
// discovering + executing via the ccusage Application capability path.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  CCUSAGE_TOOL_CONTRACT,
  CCUSAGE_VERSION,
  createCcusageLifecycleRecipeInput,
} from "../../apps/server/src/services/ccusage-agent.mjs";
import {
  CODEX_REVIEW_TOOL_CONTRACT,
  createCodexReviewAgentRegistration,
} from "../../apps/server/src/services/codex-agent.mjs";
import { createCodexReviewImportService } from "../../apps/server/src/services/codex-review-imports.mjs";
import { createCcusageImportService } from "../../apps/server/src/services/ccusage-imports.mjs";
import { createInvocationCompletionRuntime } from "../../apps/server/src/services/invocations/completion.mjs";
import { createM3Service } from "../../apps/server/src/services/m3.mjs";
import { buildPublicState } from "../../apps/server/src/read-models/state.mjs";
import { createToolService } from "../../apps/server/src/services/tools.mjs";
import { createApplicationService } from "../../apps/server/src/services/applications.mjs";
import { createCcusageApplicationRegistration } from "../../apps/server/src/services/ccusage-application.mjs";

let passed = 0;
const ok = (msg) => { passed += 1; console.log(`  ok - ${msg}`); };

const cliScriptPath = process.platform === "win32"
  ? "C:\\Users\\demo\\AppData\\Roaming\\npm\\node_modules\\ccusage\\src\\cli.js"
  : "/usr/local/lib/node_modules/ccusage/src/cli.js";
const wrapperScriptPath = "tools/agents/ccusage-wrapper.mjs";

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
  const fixtureDir = join(tmpdir(), `codex-review-wrapper-smoke-${process.pid}`);
  rmSync(fixtureDir, { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });
  const fixture = join(fixtureDir, "codex-fixture.mjs");
  writeFileSync(fixture, [
    "const prompt = process.argv.at(-1) ?? '';",
    "if (!process.argv.includes('exec')) { console.error('missing exec'); process.exit(3); }",
    "if (!process.argv.includes('--json')) { console.error('missing json'); process.exit(4); }",
    "if (!prompt.includes('Review the current worktree diff')) { console.error('missing fixed prompt'); process.exit(5); }",
    "console.log(JSON.stringify({ summary: 'Review found 1 issue.', findings: [{ severity: 'high', file: 'apps/server/src/routes/tools.mjs', line: 34, message: 'Guard project before invocation.', suggestion: 'Resolve project through facade.', confidence: 'medium' }] }));",
  ].join("\n"));
  const wrapper = resolve("tools/agents/codex-review-wrapper.mjs");
  const fixtureRun = execFileSync(process.execPath, [wrapper, "--codex-cli", fixture, "--cwd", fixtureDir, "--severity-floor", "medium"], {
    encoding: "utf8",
  });
  const resultLine = fixtureRun.split(/\r?\n/).find((line) => line.startsWith("RESULT "));
  assert.ok(resultLine, "Codex review wrapper emits RESULT line");
  const result = JSON.parse(resultLine.slice("RESULT ".length));
  assert.equal(result.summary, "Review found 1 issue.");
  assert.equal(result.touchedUserFiles, false);
  assert.equal(result.output.source, "codex");
  assert.equal(result.output.tool, "codex.review.diff");
  assert.equal(result.output.findings.length, 1);
  assert.equal(result.output.findings[0].severity, "high");
  assert.equal(result.output.findings[0].file, "apps/server/src/routes/tools.mjs");
  assert.equal(result.cost.amountSource, "external_codex_usage");
  rmSync(fixtureDir, { recursive: true, force: true });
  ok("wrapper: emits structured RESULT for valid Codex review JSON");
}

{
  const fixtureDir = join(tmpdir(), `codex-review-wrapper-bad-${process.pid}`);
  rmSync(fixtureDir, { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });
  const malformed = join(fixtureDir, "malformed-codex.mjs");
  writeFileSync(malformed, "console.log('not json');\n");
  const failing = join(fixtureDir, "failing-codex.mjs");
  writeFileSync(failing, "console.error('boom'); process.exit(7);\n");
  const wrapper = resolve("tools/agents/codex-review-wrapper.mjs");
  const badFlag = spawnSync(process.execPath, [wrapper, "--mode", "diff-review", "--raw-shell"], { encoding: "utf8" });
  assert.notEqual(badFlag.status, 0);
  assert.ok(badFlag.stdout.includes("Unsupported Codex review wrapper argument"));
  const badJson = spawnSync(process.execPath, [wrapper, "--codex-cli", malformed, "--cwd", fixtureDir], { encoding: "utf8" });
  assert.notEqual(badJson.status, 0);
  assert.ok(badJson.stdout.includes("Codex produced malformed review JSON"));
  const failed = spawnSync(process.execPath, [wrapper, "--codex-cli", failing, "--cwd", fixtureDir], { encoding: "utf8" });
  assert.notEqual(failed.status, 0);
  assert.ok(failed.stdout.includes("Codex exited with code 7"));
  rmSync(fixtureDir, { recursive: true, force: true });
  ok("wrapper: blocks unsupported Codex flags and normalizes failed output");
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
  // A minimal managed agent record — the ccusage install lifecycle recipe only
  // needs an agent id in state (the bespoke registration factory is retired).
  const agent = { id: "agt_ccusage_install", name: "ccusage installer", status: "available", lifecycle: { managedBy: "bridge" } };
  state.agents.push(agent);
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
        toolContract: CCUSAGE_TOOL_CONTRACT,
        adapter: { type: "cli", args: [wrapperScriptPath, "--ccusage-cli", cliScriptPath, "--report", "daily"] },
        capabilities: [{ name: "usage_cost_report" }],
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

{
  let n = 0;
  const state = { importedUsageEstimates: [], events: [] };
  const { recordCcusageImportedEstimates } = createCcusageImportService({
    state,
    now: () => "2026-07-02T00:00:00Z",
    nextId: (p) => `${p}_${++n}`,
    appendEvent: (event) => state.events.push(event),
  });
  const rows = Array.from({ length: 1005 }, (_, index) => ({ date: "2026-07-02", totalCost: index / 100 }));
  const imported = recordCcusageImportedEstimates({
    invocation: {
      id: "inv_spoofed",
      agentId: "agt_random",
      requestedBy: "usr_local",
      projectId: "prj_ccusage",
      input: {},
    },
    agent: { id: "agt_random", capabilities: [{ name: "manual_cli_task" }] },
    result: { output: { source: "ccusage", reportId: "daily", report: rows } },
  });
  assert.equal(imported.length, 0);
  assert.equal(state.importedUsageEstimates.length, 0);
  const contractOnly = recordCcusageImportedEstimates({
    invocation: {
      id: "inv_contract_only",
      agentId: "agt_random",
      requestedBy: "usr_local",
      projectId: "prj_ccusage",
      input: {},
    },
    agent: { id: "agt_random", toolContract: CCUSAGE_TOOL_CONTRACT, capabilities: [{ name: "usage_cost_report" }] },
    result: { output: { source: "ccusage", reportId: "daily", report: rows } },
  });
  assert.equal(contractOnly.length, 0);
  assert.equal(state.importedUsageEstimates.length, 0);

  const governed = recordCcusageImportedEstimates({
    invocation: {
      id: "inv_governed",
      agentId: "agt_ccusage_daily",
      requestedBy: "usr_local",
      projectId: "prj_ccusage",
      input: {},
    },
    agent: {
      id: "agt_ccusage_daily",
      toolContract: CCUSAGE_TOOL_CONTRACT,
      adapter: { type: "cli", args: [wrapperScriptPath, "--ccusage-cli", cliScriptPath, "--report", "daily"] },
      capabilities: [{ name: "usage_cost_report" }],
    },
    result: { output: { source: "ccusage", reportId: "daily", report: rows } },
  });
  assert.equal(governed.length, 1000);
  assert.equal(state.importedUsageEstimates.length, 1000);
  const event = state.events.find((item) => item.type === "ccusage_imported_estimates_recorded");
  assert.equal(event.data.droppedRowCount, 5);
  ok("import hardening: rejects spoofed agents and caps large ccusage reports");
}

{
  const publicState = buildPublicState({
    namespace: "smoke",
    protocolVersion: "0",
    state: {
      projects: [{ id: "prj_ccusage", ownerTeamId: "team_local" }],
      invocations: [{ id: "inv_ccusage", projectId: "prj_ccusage" }],
      importedUsageEstimates: [
        {
          id: "ccu_1",
          invocationId: "inv_ccusage",
          projectId: "prj_ccusage",
          source: "ccusage",
          reportInvocationId: "inv_ccusage",
          reportId: "daily",
          rowIndex: 0,
          amountSource: "imported_ccusage_report",
          economicModel: "external_billed",
          authoritative: false,
          raw: { localPath: "C:\\Users\\demo\\.claude\\secret.jsonl" },
          createdAt: "2026-07-02T00:00:00Z",
        },
      ],
    },
    defaultProjectPath: "D:\\repo",
    currentProject: () => null,
    defaultAgent: () => null,
    loopRoutineReadModel: () => [],
    codexApprovalQueue: () => [],
    evidenceCenterRecords: () => [],
    ledgerSummary: () => null,
    budgetStatuses: () => [],
  });
  assert.equal(publicState.importedUsageEstimates.length, 1);
  assert.ok(!("raw" in publicState.importedUsageEstimates[0]));
  ok("read model: imported ccusage estimates omit raw rows from public state");
}

{
  let n = 0;
  const now = () => "2026-07-02T00:00:00Z";
  const state = {
    device: { id: "dev_local_001", unlinkState: "linked" },
    projects: [{ id: "prj_ccusage", ownerTeamId: "team_local" }],
    currentProjectId: "prj_ccusage",
    applications: [],
    agents: [
      {
        id: "agt_platform_application_wrapper",
        name: "Application Wrapper Runner",
        status: "available",
        adapter: { type: "cli", command: "node", args: ["tools/agents/application-wrapper.mjs"] },
        location: { type: "local_device", deviceId: "dev_local_001" },
        economics: { model: "free", costOwner: "usr_local", currency: "USD", budgetPoolId: null },
      },
    ],
    invocations: [],
    events: [],
  };
  // ccusage.report is backed by the ccusage Application capability path now.
  const appSvc = createApplicationService({
    state,
    now,
    nextId: (p) => `${p}_${++n}`,
    appendEvent: (event) => state.events.push(event),
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/ccusage-smoke",
  });
  appSvc.registerApplication(createCcusageApplicationRegistration());
  const findAgent = (id) => state.agents.find((agent) => agent.id === id) ?? null;
  const createInvocation = (task, agent, options = {}) => {
    const invocation = {
      id: `inv_tool_${++n}`,
      agentId: agent.id,
      requestedBy: options.requestedBy ?? options.actor?.userId ?? "usr_local",
      projectId: options.metadata?.projectId ?? null,
      status: "queued",
      input: { task },
      options: { metadata: options.metadata ?? {} },
      createdAt: now(),
    };
    state.invocations.unshift(invocation);
    return invocation;
  };
  const tools = createToolService({
    state,
    now,
    appendEvent: (event) => state.events.push(event),
    createInvocation,
    startInvocationIfAllowed: () => {},
    findApplication: appSvc.findApplication,
    findAgent,
    planApplicationWrapperInvocation: appSvc.planApplicationWrapperInvocation,
  });
  const list = tools.listTools();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "ccusage.report");
  assert.equal(list[0].authoritativeBilling, false);
  assert.ok(!JSON.stringify(list[0]).includes("ccusage-wrapper.mjs"), "tool registry must not expose adapter argv");
  const invalid = tools.createToolInvocation("ccusage.report", { report: "daily", rawShell: true }, { userId: "usr_local", teamId: "team_local" });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, "unknown_field");
  const online = tools.createToolInvocation("ccusage.report", { report: "daily", offline: false }, { userId: "usr_local", teamId: "team_local" });
  assert.equal(online.status, 409);
  assert.equal(online.body.error, "approval_required");
  const session = tools.createToolInvocation("ccusage.report", { report: "session" }, { userId: "usr_local", teamId: "team_local" });
  assert.equal(session.status, 409);
  assert.equal(session.body.error, "approval_required");
  const created = tools.createToolInvocation("ccusage.report", {
    report: "daily",
    since: "2026-07-01",
    until: "2026-07-02",
    timezone: "Asia/Shanghai",
    projectId: "prj_ccusage",
  }, { userId: "usr_local", teamId: "team_local" });
  assert.equal(created.status, 201);
  assert.equal(created.body.agentId, "agt_platform_application_wrapper"); // executes via the app capability path now
  assert.equal(created.body.outputCollection, "importedUsageEstimates");
  assert.equal(state.invocations[0].options.metadata.tool, "ccusage.report");
  assert.equal(state.invocations[0].options.metadata.report, "daily");
  assert.ok(state.events.some((event) => event.type === "tool_invocation_created"));
  ok("tool registry: discovers ccusage.report and creates governed invocations");
}

{
  let n = 0;
  const now = () => "2026-07-02T00:00:00Z";
  const codexRegistration = createCodexReviewAgentRegistration();
  const state = {
    device: { id: "dev_local_001", unlinkState: "linked" },
    projects: [{ id: "prj_codex", ownerTeamId: "team_local" }],
    worktrees: [{
      id: "wtr_codex",
      projectId: "prj_codex",
      workspaceProjectId: "prj_codex",
      worktreePath: "D:\\repo-wt",
      branchName: "feature/codex",
    }],
    agents: [
      {
        id: codexRegistration.id,
        name: codexRegistration.name,
        status: "available",
        health: { status: "healthy" },
        toolContract: CODEX_REVIEW_TOOL_CONTRACT,
        adapter: {
          type: "cli",
          command: codexRegistration.command,
          args: codexRegistration.args,
          outputFormat: codexRegistration.outputFormat,
        },
        capabilities: [{ name: codexRegistration.capabilityName }],
        location: { type: "local_device", deviceId: "dev_local_001" },
        economics: { model: codexRegistration.economicModel, costOwner: "team_eng", currency: "USD", budgetPoolId: null },
      },
    ],
    invocations: [],
    events: [],
  };
  const createInvocation = (task, agent, options = {}) => {
    const invocation = {
      id: `inv_codex_tool_${++n}`,
      agentId: agent.id,
      requestedBy: options.requestedBy ?? options.actor?.userId ?? "usr_local",
      projectId: options.metadata?.projectId ?? null,
      worktreeId: options.metadata?.worktreeId ?? null,
      status: "queued",
      input: { task },
      options: { metadata: options.metadata ?? {} },
      createdAt: now(),
    };
    state.invocations.unshift(invocation);
    return invocation;
  };
  const tools = createToolService({
    state,
    now,
    appendEvent: (event) => state.events.push(event),
    createInvocation,
    startInvocationIfAllowed: () => {},
  });
  const list = tools.listTools();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "codex.review.diff");
  assert.equal(list[0].outputCollection, "codexReviewFindings");
  assert.ok(!JSON.stringify(list[0]).includes("codex-review-wrapper.mjs"), "tool registry must not expose Codex wrapper argv");
  const invalid = tools.createToolInvocation("codex.review.diff", { projectId: "prj_codex", shell: true }, { userId: "usr_local", teamId: "team_local" });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, "unknown_field");
  const created = tools.createToolInvocation("codex.review.diff", {
    projectId: "prj_codex",
    worktreeId: "wtr_codex",
    instruction: "Focus on correctness.",
    severityFloor: "medium",
  }, { userId: "usr_local", teamId: "team_local" });
  assert.equal(created.status, 201);
  assert.equal(created.body.agentId, "agt_codex_review_diff");
  assert.equal(created.body.outputCollection, "codexReviewFindings");
  assert.equal(state.invocations[0].options.metadata.tool, "codex.review.diff");
  assert.equal(state.invocations[0].options.metadata.worktreeId, "wtr_codex");
  assert.ok(state.events.some((event) => event.type === "tool_invocation_created"));
  ok("tool registry: discovers codex.review.diff and creates governed invocations");
}

{
  let n = 0;
  const now = () => "2026-07-02T00:00:00Z";
  const codexRegistration = createCodexReviewAgentRegistration();
  const state = {
    device: { id: "dev_local_001", unlinkState: "linked" },
    projects: [{ id: "prj_codex", ownerTeamId: "team_local" }],
    worktrees: [{
      id: "wtr_codex",
      projectId: "prj_codex",
      workspaceProjectId: "prj_codex",
      worktreePath: "D:\\repo-wt",
      branchName: "feature/codex",
    }],
    agents: [
      {
        id: codexRegistration.id,
        name: codexRegistration.name,
        status: "available",
        health: { status: "healthy" },
        toolContract: CODEX_REVIEW_TOOL_CONTRACT,
        adapter: {
          type: "cli",
          command: codexRegistration.command,
          args: codexRegistration.args,
          outputFormat: codexRegistration.outputFormat,
        },
        capabilities: [{ name: codexRegistration.capabilityName }],
        location: { type: "local_device", deviceId: "dev_local_001" },
        economics: { model: codexRegistration.economicModel, costOwner: "team_eng", currency: "USD", budgetPoolId: null },
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
    codexReviewFindings: [],
  };
  const createInvocation = (task, agent, options = {}) => {
    const invocation = {
      id: `inv_codex_review_${++n}`,
      agentId: agent.id,
      requestedBy: options.requestedBy ?? options.actor?.userId ?? "usr_local",
      projectId: options.metadata?.projectId ?? null,
      worktreeId: options.metadata?.worktreeId ?? null,
      status: "queued",
      input: { task },
      options: { metadata: options.metadata ?? {} },
      delivery: { deviceId: "dev_local_001" },
      cancellation: { state: "none" },
      createdAt: now(),
      rootSpanId: `spn_${n}`,
    };
    state.spans.push({ id: invocation.rootSpanId, status: "started" });
    state.invocations.unshift(invocation);
    return invocation;
  };
  const tools = createToolService({
    state,
    now,
    appendEvent: (event) => state.events.push(event),
    createInvocation,
    startInvocationIfAllowed: (invocation) => {
      invocation.status = "running";
    },
  });
  const { recordCodexReviewFindings } = createCodexReviewImportService({
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
    recordInvocationLedgerEntry: () => null,
    recordCcusageImportedEstimates: () => [],
    recordCodexReviewFindings,
  });
  const spoofed = recordCodexReviewFindings({
    invocation: { id: "inv_spoofed", agentId: "agt_random", requestedBy: "usr_local", projectId: "prj_codex", worktreeId: "wtr_codex" },
    agent: { id: "agt_random", toolContract: CODEX_REVIEW_TOOL_CONTRACT, capabilities: [{ name: "code_review" }] },
    result: { output: { source: "codex", tool: "codex.review.diff", findings: [{ file: "x.js", message: "fake" }] } },
  });
  assert.equal(spoofed.length, 0);
  const created = tools.createToolInvocation("codex.review.diff", {
    projectId: "prj_codex",
    worktreeId: "wtr_codex",
    severityFloor: "low",
  }, { userId: "usr_local", teamId: "team_local" });
  assert.equal(created.status, 201);
  const invocation = state.invocations.find((item) => item.id === created.body.invocationId);
  completion.completeInvocation(invocation, {
    status: "succeeded",
    summary: "Review found 1 issue.",
    result: {
      output: {
        source: "codex",
        tool: "codex.review.diff",
        mode: "diff-review",
        severityFloor: "low",
        summary: "Review found 1 issue.",
        findings: [
          {
            severity: "high",
            file: "apps/server/src/routes/tools.mjs",
            line: 34,
            message: "Guard project before invocation.",
            suggestion: "Resolve project through facade.",
            confidence: "medium",
            localPath: "D:\\repo\\secret",
          },
        ],
      },
    },
  });
  assert.equal(state.codexReviewFindings.length, 1);
  assert.equal(state.codexReviewFindings[0].reviewInvocationId, invocation.id);
  assert.equal(state.codexReviewFindings[0].projectId, "prj_codex");
  assert.equal(state.codexReviewFindings[0].worktreeId, "wtr_codex");
  assert.equal(state.codexReviewFindings[0].severity, "high");
  assert.ok(state.codexReviewFindings[0].raw.localPath, "raw finding is retained server-side");
  const publicState = buildPublicState({
    namespace: "smoke",
    protocolVersion: "0",
    state,
    defaultProjectPath: "D:\\repo",
    currentProject: () => null,
    defaultAgent: () => null,
    loopRoutineReadModel: () => [],
    codexApprovalQueue: () => [],
    evidenceCenterRecords: () => [],
    ledgerSummary: () => null,
    budgetStatuses: () => [],
  });
  assert.equal(publicState.codexReviewFindings.length, 1);
  assert.ok(!("raw" in publicState.codexReviewFindings[0]));
  assert.ok(state.events.some((event) => event.type === "codex_review_findings_recorded"));
  ok("completion: imports Codex review findings and keeps public raw clean");
}

{
  let n = 0;
  const now = () => "2026-07-02T00:00:00Z";
  const state = {
    device: { id: "dev_local_001", unlinkState: "linked" },
    projects: [{ id: "prj_ccusage", ownerTeamId: "team_local" }],
    currentProjectId: "prj_ccusage",
    applications: [],
    agents: [
      {
        id: "agt_platform_application_wrapper",
        name: "Application Wrapper Runner",
        status: "available",
        health: { status: "healthy" },
        adapter: { type: "cli", command: "node", args: ["tools/agents/application-wrapper.mjs"] },
        location: { type: "local_device", deviceId: "dev_local_001" },
        economics: { model: "free", costOwner: "usr_local", currency: "USD", budgetPoolId: null },
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
  const createInvocation = (task, agent, options = {}) => {
    const invocation = {
      id: `inv_tool_loop_${++n}`,
      agentId: agent.id,
      requestedBy: options.requestedBy ?? options.actor?.userId ?? "usr_local",
      projectId: options.metadata?.projectId ?? null,
      status: "queued",
      input: { task },
      options: { metadata: options.metadata ?? {} },
      delivery: { deviceId: "dev_local_001" },
      cancellation: { state: "none" },
      createdAt: now(),
    };
    state.invocations.unshift(invocation);
    return invocation;
  };
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
  const loopAppSvc = createApplicationService({
    state,
    now,
    nextId: (p) => `${p}_${++n}`,
    appendEvent: (event) => state.events.push(event),
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/ccusage-smoke-loop",
  });
  loopAppSvc.registerApplication(createCcusageApplicationRegistration());
  const tools = createToolService({
    state,
    now,
    appendEvent: (event) => state.events.push(event),
    createInvocation,
    startInvocationIfAllowed: (invocation) => {
      invocation.status = "running";
    },
    findApplication: loopAppSvc.findApplication,
    findAgent: (id) => state.agents.find((item) => item.id === id) ?? null,
    planApplicationWrapperInvocation: loopAppSvc.planApplicationWrapperInvocation,
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
  const created = tools.createToolInvocation("ccusage.report", {
    report: "daily",
    since: "2026-07-01",
    projectId: "prj_ccusage",
  }, { userId: "usr_local", teamId: "team_local" });
  assert.equal(created.status, 201);
  const invocation = state.invocations.find((item) => item.id === created.body.invocationId);
  completion.completeInvocation(invocation, {
    status: "succeeded",
    summary: "ccusage daily report generated with 1 row(s).",
    result: {
      output: {
        source: "ccusage",
        reportId: "daily",
        offline: true,
        filters: { since: "2026-07-01", until: null, timezone: null },
        report: [{ date: "2026-07-01", provider: "openai", model: "gpt-5", totalTokens: 123, totalCost: 0.5, localPath: "C:\\secret" }],
      },
      cost: { model: "ccusage", billable: false, amountUsd: 0, amountSource: "free_local_tool" },
    },
  });
  assert.equal(state.importedUsageEstimates.length, 1);
  assert.equal(state.importedUsageEstimates[0].reportInvocationId, invocation.id);
  assert.equal(state.ledgerEntries.length, 0);
  const publicState = buildPublicState({
    namespace: "smoke",
    protocolVersion: "0",
    state,
    defaultProjectPath: "D:\\repo",
    currentProject: () => null,
    defaultAgent: () => null,
    loopRoutineReadModel: () => [],
    codexApprovalQueue: () => [],
    evidenceCenterRecords: () => [],
    ledgerSummary: () => null,
    budgetStatuses: () => [],
  });
  assert.equal(publicState.importedUsageEstimates.length, 1);
  assert.ok(!("raw" in publicState.importedUsageEstimates[0]));
  ok("tool facade loop: creates invocation, imports estimates, and keeps ledger/public raw clean");
}

console.log(`\nccusage-agent-smoke: ${passed} checks passed`);
