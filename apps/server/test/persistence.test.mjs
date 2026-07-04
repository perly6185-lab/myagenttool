import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerRuntimeServices } from "../src/runtime/service-composer.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createAgentService } from "../src/services/agents.mjs";
import { CCUSAGE_VERSION } from "../src/services/ccusage-agent.mjs";
import { createCcusageImportService } from "../src/services/ccusage-imports.mjs";
import { createClaudeReviewImportService } from "../src/services/claude-review-imports.mjs";
import { createCodexReviewImportService } from "../src/services/codex-review-imports.mjs";
import { createIntegrationService } from "../src/services/integrations.mjs";
import { createM3Service } from "../src/services/m3.mjs";
import { sameProjectPath } from "../src/services/projects.mjs";
import { createTerminalService } from "../src/services/terminal.mjs";

test("persistence restores active control-plane records across runtime restart", () => {
  const root = join(tmpdir(), `myagenttool-persistence-test-${Date.now()}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });

  try {
    const first = createServerState({ defaultProjectPath: projectPath, now });
    const customAgent = {
      id: "agt_custom_persisted",
      name: "Persisted Agent",
      description: "A registered agent that should survive restart.",
      ownerUserId: "usr_local",
      location: { type: "local_device", deviceId: first.state.device.id },
      adapter: { type: "cli", command: "node", args: ["--version"] },
      lifecycle: { state: "enabled", installState: "installed", version: "1.0.0", managedBy: "bridge" },
      economics: { model: "unknown", pricingDimensions: [], currency: "USD", costOwner: "usr_local", budgetPoolId: null },
      capabilities: [{ name: "persisted_task", description: "Test", riskLevel: "low", riskTags: [] }],
      status: "available",
      health: { status: "healthy", checkedAt: now(), message: "OK", nextAction: null },
      registrationNotes: { risk: "low", data: "test", cost: "unknown", cancellation: "supported" },
      createdAt: now(),
      updatedAt: now(),
    };

    first.state.device.status = "online";
    first.state.device.lastSeenAt = now();
    first.state.agents.push(customAgent);
    first.state.healthChecks.push({ id: "chk_1", agentId: customAgent.id, status: "succeeded" });
    first.state.lifecycleAuditRecords.push({ id: "lco_1", agentId: customAgent.id, operation: "enable", status: "succeeded" });
    first.state.discoveryRuns.push({ id: "dis_1", status: "completed" });
    first.state.integrationArtifacts.push({ id: "art_1", reviewState: "approved" });
    first.state.integrationProbeRuns.push({ id: "probe_1", artifactId: "art_1", status: "succeeded" });
    first.state.terminalSessions.push({ id: "term_1", status: "running" });
    first.state.terminalEvidenceRecords.push({ id: "tev_1", terminalSessionId: "term_1" });
    first.state.terminalBridgeActions.push({ id: "tba_1", status: "queued" });
    first.state.sshTargets.push({ id: "ssh_1", name: "Persisted SSH target" });
    first.state.sshConnectionTests.push({ id: "ssh_test_1", targetId: "ssh_1", status: "succeeded" });
    first.state.ledgerEntries.push({ id: "led_1", amount: "1.00", sourceRecordId: "usage_1" });
    first.state.retentionSettings.logsDays = 99;

    createPersistenceRuntime({
      state: first.state,
      enabled: true,
      stateStorePath,
      schemaVersion: 1,
      now,
      defaultProject: first.defaultProject,
      sameProjectPath,
    }).savePersistentState();

    const second = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({
      state: second.state,
      enabled: true,
      stateStorePath,
      schemaVersion: 1,
      now,
      defaultProject: second.defaultProject,
      sameProjectPath,
    }).restorePersistentState();

    assert.equal(second.state.device.status, "offline");
    assert.equal(second.state.device.lastSeenAt, "2026-07-04T00:00:00.000Z");
    assert(second.state.agents.some((agent) => agent.id === customAgent.id), "custom registered agent should restore");
    assert(second.state.agents.some((agent) => agent.id === "agt_platform_application_control"), "new/default agents should remain available");
    assert(second.state.healthChecks.some((item) => item.id === "chk_1"), "health checks should restore");
    assert(second.state.lifecycleAuditRecords.some((item) => item.id === "lco_1"), "lifecycle audit records should restore");
    assert(second.state.discoveryRuns.some((item) => item.id === "dis_1"), "discovery runs should restore");
    assert(second.state.integrationArtifacts.some((item) => item.id === "art_1"), "integration artifacts should restore");
    assert(second.state.integrationProbeRuns.some((item) => item.id === "probe_1"), "integration probe runs should restore");
    assert(second.state.terminalSessions.some((item) => item.id === "term_1"), "terminal sessions should restore");
    assert(second.state.terminalEvidenceRecords.some((item) => item.id === "tev_1"), "terminal evidence should restore");
    assert(second.state.terminalBridgeActions.some((item) => item.id === "tba_1"), "terminal bridge actions should restore");
    assert(second.state.sshTargets.some((item) => item.id === "ssh_1"), "SSH targets should restore");
    assert(second.state.sshConnectionTests.some((item) => item.id === "ssh_test_1"), "SSH connection tests should restore");
    assert(second.state.ledgerEntries.some((item) => item.id === "led_1"), "ledger entries should restore");
    assert.equal(second.state.retentionSettings.logsDays, 99);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime ids continue after restoring persisted state", () => {
  const root = join(tmpdir(), `myagenttool-persistence-id-test-${Date.now()}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });

  try {
    const first = createServerState({ defaultProjectPath: projectPath, now });
    first.state.invocations.unshift({ id: "inv_demo_0042", status: "succeeded" });
    first.state.codexApprovalBrokerRequests.unshift({ id: "cdx_appr_0100", invocationId: "inv_demo_0042", status: "approved" });
    createPersistenceRuntime({
      state: first.state,
      enabled: true,
      stateStorePath,
      schemaVersion: 1,
      now,
      defaultProject: first.defaultProject,
      sameProjectPath,
    }).savePersistentState();

    const second = createServerState({ defaultProjectPath: projectPath, now });
    const { httpDependencies } = createServerRuntimeServices({
      namespace: "test",
      protocolVersion: "0.0.0",
      state: second.state,
      defaultProject: second.defaultProject,
      defaultProjectPath: projectPath,
      persistenceEnabled: true,
      stateStorePath,
      stateSchemaVersion: 1,
      dispatchLeaseMs: 30_000,
      now,
    });

    const invocation = httpDependencies.createInvocation("fresh invocation after restore");
    assert.equal(invocation.id, "inv_demo_0101");
    assert(!second.state.invocations.slice(1).some((item) => item.id === invocation.id), "new invocation id should not collide with restored rows");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("agent mutations request persistence directly", () => {
  const projectPath = join(tmpdir(), `myagenttool-agent-persist-test-${Date.now()}`);
  mkdirSync(projectPath, { recursive: true });
  const { state } = createServerState({ defaultProjectPath: projectPath, now });
  let persistCount = 0;
  let id = 0;
  const service = createAgentService({
    state,
    now,
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent: () => {},
    persistStateSoon: () => {
      persistCount += 1;
    },
  });

  const agent = service.registerAgent({ type: "cli", command: "node", args: ["--version"], name: "Persist Me" });
  assert.equal(persistCount, 1, "registerAgent should persist");

  service.disableAgent(agent);
  assert.equal(persistCount, 2, "disableAgent should persist");

  service.enableAgent(agent);
  assert.equal(persistCount, 3, "enableAgent should persist");

  const health = service.createAgentHealthCheck(agent);
  assert(persistCount >= 4, "createAgentHealthCheck should persist the queued/checking state");

  service.markHealthCheckStarted(health);
  const afterStarted = persistCount;
  assert(afterStarted >= 5, "markHealthCheckStarted should persist the running state");

  service.completeHealthCheck(health, { status: "healthy", message: "OK", nextAction: null });
  assert(persistCount > afterStarted, "completeHealthCheck should persist the final health state");
});

test("m3 lifecycle and billing mutations request persistence directly", () => {
  const projectPath = join(tmpdir(), `myagenttool-m3-persist-test-${Date.now()}`);
  mkdirSync(projectPath, { recursive: true });
  const { defaultProject, state } = createServerState({ defaultProjectPath: projectPath, now });
  let persistCount = 0;
  let id = 0;
  const m3 = createM3Service({
    state,
    now,
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent: () => {},
    findAgent: (agentId) => state.agents.find((agent) => agent.id === agentId) ?? null,
    persistStateSoon: () => {
      persistCount += 1;
    },
  });

  const beforeCatalog = persistCount;
  const catalog = m3.createPrivateCatalogEntry({ packageName: "ccusage", version: CCUSAGE_VERSION });
  assert(persistCount > beforeCatalog, "private catalog creation should persist");

  const beforeBundle = persistCount;
  m3.createSignedBundleManifest({
    catalogEntryId: catalog.id,
    packageName: "ccusage",
    version: CCUSAGE_VERSION,
    signatureStatus: "not_required",
  });
  assert(persistCount > beforeBundle, "signed bundle creation should persist");

  const beforeRecipe = persistCount;
  const recipe = m3.createLifecycleRecipe({
    action: "update",
    name: "Demo lifecycle update",
    catalogEntryId: catalog.id,
    source: {
      type: "manual_entry",
      uri: "manual://demo-agent",
      author: "test",
      version: "1.0.0",
      signatureStatus: "not_required",
    },
    supportedPlatforms: [state.device.platform],
    expectedBinary: "demo-agent",
    rollback: { available: true, strategy: "manual", summary: "Manual rollback is documented." },
    command: {
      summary: "Update demo agent.",
      commandId: "demo_agent_update",
      executable: "demo-agent",
      args: ["--self-check-update"],
      shell: false,
    },
  });
  assert(persistCount > beforeRecipe, "lifecycle recipe creation should persist");

  const beforeTransition = persistCount;
  m3.transitionLifecycleRecipe(recipe, "approve");
  assert(persistCount > beforeTransition, "lifecycle review transition should persist");

  const beforePolicy = persistCount;
  const policy = m3.evaluateLifecyclePolicy(recipe);
  assert.equal(policy.decision, "allowed");
  assert(persistCount > beforePolicy, "lifecycle policy evaluation should persist");

  const beforeQueue = persistCount;
  const queued = m3.queueLifecycleAction(recipe);
  assert(persistCount > beforeQueue, "lifecycle queueing should persist");

  const beforeStart = persistCount;
  m3.markLifecycleActionStarted(queued);
  assert(persistCount > beforeStart, "lifecycle start should persist");

  const beforeComplete = persistCount;
  m3.completeLifecycleAction(queued, { status: "failed", summary: "Failed in test.", rollbackAvailable: true });
  assert(persistCount > beforeComplete, "lifecycle completion should persist");
  assert(state.lifecycleRollbackRequests.some((item) => item.failedActionId === queued.id), "failed action should create rollback evidence");

  const beforeQuota = persistCount;
  m3.createQuotaPolicy({ subjectId: "usr_local", provider: "openai", model: "gpt-persist", limit: 2 });
  assert(persistCount > beforeQuota, "quota policy creation should persist");

  const beforeUsage = persistCount;
  const usage = m3.recordAiUsage({
    userId: "usr_local",
    provider: "openai",
    model: "gpt-persist",
    providerMode: "platform_managed",
    estimatedCost: "0.01",
    projectId: defaultProject.id,
  });
  assert.equal(usage.blocked, false);
  assert(persistCount > beforeUsage, "allowed AI usage should persist");

  const beforeBlockedUsage = persistCount;
  const blocked = m3.recordAiUsage({
    userId: "usr_local",
    provider: "openai",
    model: "gpt-no-policy",
    providerMode: "platform_managed",
    estimatedCost: "0.01",
    projectId: defaultProject.id,
  });
  assert.equal(blocked.blocked, true);
  assert(persistCount > beforeBlockedUsage, "blocked AI quota decisions should persist");

  const beforeInvocationLedger = persistCount;
  m3.recordInvocationLedgerEntry({
    invocation: {
      id: "inv_persist",
      agentId: "agt_demo_cli",
      requestedBy: "usr_local",
      projectId: defaultProject.id,
      input: { metadata: { projectId: defaultProject.id } },
    },
    cost: { amountUsd: 1.25, currency: "USD", model: "demo", billable: true },
    agent: state.agents.find((agent) => agent.id === "agt_demo_cli"),
  });
  assert(persistCount > beforeInvocationLedger, "invocation ledger entries should persist");

  const beforeDeployment = persistCount;
  m3.updatePrivateDeploymentConfig({ mode: "private_deployment", auditExportEnabled: true });
  assert(persistCount > beforeDeployment, "private deployment config updates should persist");

  const beforeExport = persistCount;
  m3.createAuditExportRequest({ subjects: ["ledger", "quota"], dryRun: true });
  assert(persistCount > beforeExport, "audit export requests should persist");

  const beforeBudget = persistCount;
  m3.upsertBudget({ projectId: defaultProject.id, limitUsd: 10, policy: "warn" });
  assert(persistCount > beforeBudget, "budget upsert should persist");
});

test("integration and terminal mutations request persistence directly", () => {
  const projectPath = join(tmpdir(), `myagenttool-integration-persist-test-${Date.now()}`);
  mkdirSync(projectPath, { recursive: true });
  const { state } = createServerState({ defaultProjectPath: projectPath, now });
  state.device.status = "online";
  let persistCount = 0;
  let id = 0;
  const persistStateSoon = () => {
    persistCount += 1;
  };
  const appendEvent = () => {};
  const agentService = createAgentService({
    state,
    now,
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent,
    persistStateSoon,
  });
  const integrations = createIntegrationService({
    state,
    now,
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent,
    completeInvocation: () => {},
    createInvocation: () => ({ id: `inv_${++id}` }),
    disableAgent: agentService.disableAgent,
    findAgent: agentService.findAgent,
    registerAgent: agentService.registerAgent,
    persistStateSoon,
  });

  const beforeDiscovery = persistCount;
  const discovery = integrations.createDiscoveryRun({ requestedBy: "usr_local" });
  assert(persistCount > beforeDiscovery, "discovery run creation should persist");

  const beforeDiscoveryStart = persistCount;
  integrations.markDiscoveryStarted(discovery);
  assert(persistCount > beforeDiscoveryStart, "discovery start should persist");

  const beforeDiscoveryComplete = persistCount;
  integrations.completeDiscoveryRun(discovery, {
    candidates: [{
      id: "cand_node",
      name: "Node Candidate",
      adapter: { type: "cli", command: "node", args: ["--version"], outputFormat: "plain_text" },
    }],
  });
  assert(persistCount > beforeDiscoveryComplete, "discovery completion should persist");

  const beforeRegisterCandidate = persistCount;
  integrations.registerDiscoveredCandidate(discovery, discovery.candidates[0]);
  assert(persistCount > beforeRegisterCandidate, "discovered candidate registration should persist");

  const beforeArtifact = persistCount;
  const plan = integrations.createIntegrationArtifact({
    artifactType: "integration_plan",
    targetType: "cli",
    command: "node",
    args: ["--version"],
  });
  assert(persistCount > beforeArtifact, "integration artifact creation should persist");

  const beforeGenerate = persistCount;
  const generated = integrations.generateIntegrationArtifacts(plan);
  assert(persistCount > beforeGenerate, "integration artifact generation should persist");

  const adapterArtifact = generated.find((artifact) => artifact.artifactType === "adapter_config");
  const beforeTransition = persistCount;
  integrations.transitionIntegrationArtifact(adapterArtifact, "approve");
  assert(persistCount > beforeTransition, "integration artifact transition should persist");

  const beforeProbe = persistCount;
  const probe = integrations.createIntegrationProbeRun(adapterArtifact);
  assert(persistCount > beforeProbe, "integration probe creation should persist");

  const beforeProbeStart = persistCount;
  integrations.markIntegrationProbeStarted(probe);
  assert(persistCount > beforeProbeStart, "integration probe start should persist");

  const beforeProbeComplete = persistCount;
  integrations.completeIntegrationProbeRun(probe, { status: "succeeded", summary: "Probe passed." });
  assert(persistCount > beforeProbeComplete, "integration probe completion should persist");

  const beforeRegisterArtifact = persistCount;
  integrations.registerIntegrationArtifact(adapterArtifact);
  assert(persistCount > beforeRegisterArtifact, "tested integration registration should persist");

  const beforeRetention = persistCount;
  integrations.updateIntegrationRetentionSettings({ logsDays: 21 });
  assert(persistCount > beforeRetention, "integration retention settings should persist");

  const terminal = createTerminalService({
    state,
    now,
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent,
    persistStateSoon,
    summarizeText: (text) => String(text),
    uniqueStrings: (items) => [...new Set(items)],
    codexSessionForInvocation: () => null,
  });

  const beforeSshTarget = persistCount;
  const target = terminal.createSshTarget({
    host: "example.internal",
    user: "dev",
    workspaceRoot: "/srv/app",
    knownHostPolicy: "manual_fingerprint",
    knownHostFingerprint: "SHA256:test",
  });
  assert(persistCount > beforeSshTarget, "SSH target registration should persist");

  const beforeSshTest = persistCount;
  terminal.createSshConnectionTest(target);
  assert(persistCount > beforeSshTest, "SSH connection preflight should persist");
});

test("review and usage import mutations request persistence directly", () => {
  const state = {
    codexReviewFindings: [],
    claudeReviewFindings: [],
    importedUsageEstimates: [],
  };
  let persistCount = 0;
  let id = 0;
  const persistStateSoon = () => {
    persistCount += 1;
  };
  const nextId = (prefix) => `${prefix}_${++id}`;

  const codex = createCodexReviewImportService({ state, now, nextId, appendEvent: () => {}, persistStateSoon });
  const beforeCodex = persistCount;
  codex.recordCodexReviewFindings({
    invocation: { id: "inv_codex", projectId: "proj_a", requestedBy: "usr_local", agentId: "agt_codex_review_diff" },
    result: { output: { source: "codex", tool: "codex.review.diff", findings: [{ severity: "high", file: "a.ts", message: "Bug" }] } },
    agent: governedReviewAgent({ id: "agt_codex_review_diff", tool: "codex.review.diff", wrapper: "codex-review-wrapper.mjs" }),
  });
  assert(persistCount > beforeCodex, "Codex review imports should persist");

  const claude = createClaudeReviewImportService({ state, now, nextId, appendEvent: () => {}, persistStateSoon });
  const beforeClaude = persistCount;
  claude.recordClaudeReviewFindings({
    invocation: { id: "inv_claude", projectId: "proj_a", requestedBy: "usr_local", agentId: "agt_claude_review_diff" },
    result: { output: { source: "claude", tool: "claude.review.diff", findings: [{ severity: "medium", file: "b.ts", message: "Issue" }] } },
    agent: governedReviewAgent({ id: "agt_claude_review_diff", tool: "claude.review.diff", wrapper: "claude-review-wrapper.mjs" }),
  });
  assert(persistCount > beforeClaude, "Claude review imports should persist");

  const ccusage = createCcusageImportService({ state, now, nextId, appendEvent: () => {}, persistStateSoon });
  const beforeCcusage = persistCount;
  ccusage.recordCcusageImportedEstimates({
    invocation: { id: "inv_ccusage", options: { metadata: { projectId: "proj_a" } }, agentId: "agt_ccusage_daily" },
    result: { output: { source: "ccusage", reportId: "daily", report: [{ provider: "codex", model: "gpt", totalCostUsd: 1.25 }] } },
    agent: governedCcusageAgent(),
  });
  assert(persistCount > beforeCcusage, "ccusage estimate imports should persist");
});

function now() {
  return "2026-07-04T00:00:00.000Z";
}

function governedReviewAgent({ id, tool, wrapper }) {
  return {
    id,
    name: `${id} agent`,
    adapter: {
      type: "cli",
      command: "node",
      args: [`/opt/myagenttool/tools/agents/${wrapper}`, "--mode", "diff-review"],
      outputFormat: "plain_result",
    },
    toolContract: { name: tool },
    capabilities: [{ name: "code_review" }],
  };
}

function governedCcusageAgent() {
  return {
    id: "agt_ccusage_daily",
    name: "ccusage Daily Report",
    adapter: {
      type: "cli",
      command: "node",
      args: ["/opt/myagenttool/tools/agents/ccusage-wrapper.mjs", "--report", "daily"],
      outputFormat: "plain_result",
    },
    toolContract: { name: "ccusage.report" },
    capabilities: [{ name: "usage_cost_report" }],
  };
}
