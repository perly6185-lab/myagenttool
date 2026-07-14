import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildEvidenceCenterRecords } from "../src/read-models/evidence-center.mjs";
import { buildPublicState } from "../src/read-models/state.mjs";
import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerRuntimeServices } from "../src/runtime/service-composer.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createAgentService } from "../src/services/agents.mjs";
import { createApplicationResultImportService } from "../src/services/application-results.mjs";
import { CCUSAGE_VERSION } from "../src/services/ccusage-agent.mjs";
import { createCcusageImportService } from "../src/services/ccusage-imports.mjs";
import { createInvocationCompletionRuntime } from "../src/services/invocations/completion.mjs";
import { createClaudeReviewImportService } from "../src/services/claude-review-imports.mjs";
import { createCodexReviewImportService } from "../src/services/codex-review-imports.mjs";
import { createCodexService } from "../src/services/codex.mjs";
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

test("persistence restores lifecycle recovery evidence and ledger spend across runtime restart", () => {
  const root = join(tmpdir(), `myagenttool-persistence-evidence-test-${Date.now()}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });

  try {
    const first = createServerState({ defaultProjectPath: projectPath, now });
    const m3 = m3ServiceFor(first.state);
    const projectId = first.defaultProject.id;
    m3.upsertBudget({ projectId, limitUsd: 2, policy: "block" });
    const catalog = m3.createPrivateCatalogEntry({ packageName: "demo-agent", version: "1.2.3" });
    m3.createSignedBundleManifest({
      catalogEntryId: catalog.id,
      packageName: "demo-agent",
      version: "1.2.3",
      signatureStatus: "not_required",
    });
    const recipe = m3.createLifecycleRecipe({
      action: "update",
      name: "Durable evidence update",
      catalogEntryId: catalog.id,
      source: {
        type: "manual_entry",
        uri: "manual://demo-agent",
        author: "test",
        version: "1.2.3",
        signatureStatus: "not_required",
      },
      supportedPlatforms: [first.state.device.platform],
      expectedBinary: "demo-agent",
      rollback: { available: true, strategy: "previous_version", summary: "Restore demo-agent 1.2.2." },
      command: {
        summary: "Update demo agent.",
        commandId: "demo_agent_update",
        executable: "demo-agent",
        args: ["--self-check-update"],
        shell: false,
      },
    });
    m3.transitionLifecycleRecipe(recipe, "approve");
    assert.equal(m3.evaluateLifecyclePolicy(recipe).decision, "allowed");
    const queued = m3.queueLifecycleAction(recipe);
    m3.markLifecycleActionStarted(queued);
    m3.completeLifecycleAction(queued, {
      status: "failed",
      summary: "Bridge update failed during restart test.",
      exitCode: 42,
      stderr: "permission denied",
      rollbackAvailable: true,
    });
    const ledger = m3.recordInvocationLedgerEntry({
      invocation: {
        id: "inv_restart_cost",
        agentId: "agt_demo_cli",
        requestedBy: "usr_local",
        projectId,
        input: { metadata: { projectId } },
      },
      cost: { amountUsd: 2.5, currency: "USD", model: "gpt-restart", billable: true },
      agent: first.state.agents.find((agent) => agent.id === "agt_demo_cli"),
    });
    assert(ledger, "test setup should create a spend-bearing ledger entry");

    saveState(first, { stateStorePath });

    const second = createServerState({ defaultProjectPath: projectPath, now });
    restoreState(second, { stateStorePath });
    const restoredM3 = m3ServiceFor(second.state);
    const audit = second.state.lifecycleAuditRecords.find((item) => item.id === queued.id);
    const rollback = second.state.lifecycleRollbackRequests.find((item) => item.failedActionId === queued.id);

    assert.equal(audit?.status, "failed");
    assert.equal(audit?.message, "Bridge update failed during restart test.");
    assert.equal(audit?.result?.exitCode, 42);
    assert.equal(audit?.result?.rollbackAvailable, true);
    assert.equal(audit?.rollback?.strategy, "previous_version");
    assert.equal(rollback?.status, "available");
    assert.equal(rollback?.queuedActionId, null);
    assert.match(rollback?.summary ?? "", /Restore demo-agent 1\.2\.2/);
    assert.equal(second.state.lifecycleQueuedActions.find((item) => item.id === queued.id)?.result?.summary, "Bridge update failed during restart test.");

    const restoredLedger = second.state.ledgerEntries.find((item) => item.id === ledger.id);
    assert.equal(restoredLedger?.amountUsd, 2.5);
    assert.equal(restoredLedger?.sourceRecordId, "inv_restart_cost");
    const budget = restoredM3.budgetStatusFor(projectId);
    assert.equal(budget.finalizedUsd, 2.5);
    assert.equal(budget.spentUsd, 2.5);
    assert.equal(budget.over, true);
    assert.equal(restoredM3.ledgerSummary().totalCostUsd, 2.5);

    restoredM3.updatePrivateDeploymentConfig({ mode: "private_deployment", auditExportEnabled: true });
    const exportRequest = restoredM3.createAuditExportRequest({ subjects: ["lifecycle", "ledger"], dryRun: false });
    assert.equal(exportRequest.status, "exported");
    assert(exportRequest.manifest.recordRefs.some((ref) => ref.subject === "lifecycle" && ref.id === queued.id), "lifecycle audit record should remain exportable after restore");
    assert(exportRequest.manifest.recordRefs.some((ref) => ref.subject === "lifecycle" && ref.id === rollback.id), "rollback request should remain exportable after restore");
    assert(exportRequest.manifest.recordRefs.some((ref) => ref.subject === "ledger" && ref.id === ledger.id), "ledger entry should remain exportable after restore");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistence restores imported usage and review evidence across runtime restart", () => {
  const root = join(tmpdir(), `myagenttool-persistence-imported-evidence-test-${Date.now()}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });

  try {
    const first = createServerState({ defaultProjectPath: projectPath, now });
    const projectId = first.defaultProject.id;
    first.state.invocations.push(
      { id: "inv_ccusage_restore", projectId, requestedBy: "usr_local", agentId: "agt_ccusage_daily", status: "succeeded" },
      { id: "inv_codex_restore", projectId, requestedBy: "usr_local", agentId: "agt_codex_review_diff", status: "succeeded" },
      { id: "inv_claude_restore", projectId, requestedBy: "usr_local", agentId: "agt_claude_review_diff", status: "succeeded" },
    );
    const imports = importServicesFor(first.state);
    const usage = imports.ccusage.recordCcusageImportedEstimates({
      invocation: {
        id: "inv_ccusage_restore",
        projectId,
        requestedBy: "usr_local",
        agentId: "agt_ccusage_daily",
        options: { metadata: { projectId } },
      },
      result: {
        output: {
          source: "ccusage",
          reportId: "daily",
          offline: true,
          filters: { since: "2026-07-01", timezone: "Asia/Shanghai" },
          report: [{
            provider: "codex",
            model: "gpt-restart",
            sessionId: "sess_restore",
            inputTokens: 100,
            outputTokens: 25,
            totalCostUsd: 1.75,
            rawLocalPath: "server-only-usage-detail",
          }],
        },
      },
      agent: governedCcusageAgent(),
    });
    const codexFindings = imports.codex.recordCodexReviewFindings({
      invocation: { id: "inv_codex_restore", projectId, requestedBy: "usr_local", agentId: "agt_codex_review_diff" },
      result: {
        output: {
          source: "codex",
          tool: "codex.review.diff",
          summary: "Codex found restore evidence.",
          findings: [{
            severity: "high",
            file: "apps/server/src/services/persistence.mjs",
            line: 12,
            message: "Preserve imported usage evidence after restore.",
            suggestion: "Assert public read models after restart.",
            rawLocalPath: "server-only-codex-detail",
          }],
        },
      },
      agent: governedReviewAgent({ id: "agt_codex_review_diff", tool: "codex.review.diff", wrapper: "codex-review-wrapper.mjs" }),
    });
    const claudeFindings = imports.claude.recordClaudeReviewFindings({
      invocation: { id: "inv_claude_restore", projectId, requestedBy: "usr_local", agentId: "agt_claude_review_diff" },
      result: {
        output: {
          source: "claude",
          tool: "claude.review.diff",
          summary: "Claude found restore evidence.",
          findings: [{
            severity: "medium",
            file: "apps/server/test/persistence.test.mjs",
            line: 123,
            message: "Keep normalized review evidence readable after restore.",
            suggestion: "Check unified reviewFindings.",
            rawLocalPath: "server-only-claude-detail",
          }],
        },
      },
      agent: governedReviewAgent({ id: "agt_claude_review_diff", tool: "claude.review.diff", wrapper: "claude-review-wrapper.mjs" }),
    });
    assert.equal(usage.length, 1);
    assert.equal(codexFindings.length, 1);
    assert.equal(claudeFindings.length, 1);

    saveState(first, { stateStorePath });

    const second = createServerState({ defaultProjectPath: projectPath, now });
    restoreState(second, { stateStorePath });
    const publicState = publicStateFor(second.state, { defaultProjectPath: projectPath });
    const restoredUsage = second.state.importedUsageEstimates.find((item) => item.id === usage[0].id);
    const publicUsage = publicState.importedUsageEstimates.find((item) => item.id === usage[0].id);
    const publicCodex = publicState.reviewFindings.find((item) => item.id === codexFindings[0].id);
    const publicClaude = publicState.reviewFindings.find((item) => item.id === claudeFindings[0].id);

    assert.equal(restoredUsage?.estimatedCostUsd, 1.75);
    assert.equal(restoredUsage?.filters?.timezone, "Asia/Shanghai");
    assert.equal(restoredUsage?.raw?.rawLocalPath, "server-only-usage-detail");
    assert.equal(publicUsage?.estimatedCostUsd, 1.75);
    assert.ok(!("raw" in publicUsage), "public imported usage rows must not expose raw payloads after restore");
    assert.equal(second.state.codexReviewFindings.find((item) => item.id === codexFindings[0].id)?.raw.rawLocalPath, "server-only-codex-detail");
    assert.equal(second.state.claudeReviewFindings.find((item) => item.id === claudeFindings[0].id)?.raw.rawLocalPath, "server-only-claude-detail");
    assert.equal(publicCodex?.source, "codex");
    assert.equal(publicCodex?.severity, "high");
    assert.equal(publicCodex?.message, "Preserve imported usage evidence after restore.");
    assert.ok(!("raw" in publicCodex), "public Codex review finding must not expose raw payloads after restore");
    assert.equal(publicClaude?.source, "claude");
    assert.equal(publicClaude?.severity, "medium");
    assert.equal(publicClaude?.message, "Keep normalized review evidence readable after restore.");
    assert.ok(!("raw" in publicClaude), "public Claude review finding must not expose raw payloads after restore");

    const restoredM3 = m3ServiceFor(second.state);
    restoredM3.updatePrivateDeploymentConfig({ mode: "private_deployment", auditExportEnabled: true });
    const exportRequest = restoredM3.createAuditExportRequest({ subjects: ["usage"], dryRun: false });
    assert.equal(exportRequest.status, "exported");
    assert(exportRequest.manifest.recordRefs.some((ref) => ref.subject === "usage" && ref.id === usage[0].id), "imported usage estimate should remain exportable after restore");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Gap closed here: `state.applicationResults` is on `persistedArrayKeys`, but no
// test proved the whole Application-result LINK CHAIN survives a restart. A row
// on disk is not the same as an explainable result: completion writes the link
// to five places (invocation.result, invocation.metadata, audit summary,
// application.latestResult, and an `application_result_recorded` event), and two
// read models (public state, Evidence Center) recompute from those. This drives
// the generic `resultImport` importer (git repo_state) through the real
// completion runtime, restarts, and re-checks every link and both read models.
test("persistence restores application result links across runtime restart", () => {
  const root = join(tmpdir(), `myagenttool-persistence-app-result-test-${Date.now()}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });

  try {
    const first = createServerState({ defaultProjectPath: projectPath, now });
    const projectId = first.defaultProject.id;
    // A registered git Application so `application.latestResult` has something to
    // attach to and the imported row resolves an owning team (not the fallback).
    first.state.applications.push({
      id: "app_git",
      name: "Managed Git",
      source: { kind: "git" },
      ownerTeamId: "team_local",
      ownerUserId: "usr_local",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    });
    const invocation = {
      id: "inv_app_git_restore",
      agentId: "agt_platform_application_wrapper",
      requestedBy: "usr_local",
      projectId,
      status: "running",
      input: { task: "Run application capability app.app_git.wrapper.status." },
      options: {
        metadata: {
          providerType: "application",
          applicationId: "app_git",
          capability: "app.app_git.wrapper.status",
          applicationWrapper: {
            capability: "app.app_git.wrapper.status",
            resultImport: { source: "git", kind: "repo_state" },
            outputCollection: "applicationResults",
          },
        },
      },
      delivery: { deviceId: first.state.device.id },
      cancellation: { state: "none" },
      createdAt: now(),
    };
    first.state.invocations.push(invocation);

    let id = 0;
    const nextId = (prefix) => `${prefix}_${++id}`;
    const appendEvent = (event) => first.state.events.unshift({ id: nextId("evt"), createdAt: now(), ...event });
    const { recordApplicationResult } = createApplicationResultImportService({
      state: first.state,
      now,
      nextId,
      appendEvent,
    });
    const completion = createInvocationCompletionRuntime({
      state: first.state,
      now,
      appendEvent,
      persistStateSoon: () => {},
      namespace: "test",
      protocolVersion: "0",
      findAgent: (agentId) => first.state.agents.find((agent) => agent.id === agentId) ?? null,
      findInvocation: (invocationId) => first.state.invocations.find((item) => item.id === invocationId) ?? null,
      closeCodexSession: () => {},
      isTerminal: (status) => ["succeeded", "failed", "cancelled", "timed_out", "expired", "rejected"].includes(status),
      recordInvocationLedgerEntry: () => null,
      recordApplicationResult,
    });

    completion.completeInvocation(invocation, {
      status: "succeeded",
      summary: "Managed git status completed.",
      result: {
        output: {
          source: "application",
          capability: "app.app_git.wrapper.status",
          report: { text: "# branch.head main" },
        },
      },
    });

    // Live linkage before persisting — the chain must exist to be worth restoring.
    const importedId = first.state.applicationResults[0]?.id;
    assert.ok(importedId, "completion should import the git application result row");
    assert.equal(first.state.applicationResults[0].data.branch.name, "main");
    assert.deepEqual(invocation.result.applicationResult.importedRecordIds, [importedId]);
    assert.equal(invocation.options.metadata.applicationResult.importedRecordIds[0], importedId);
    assert.equal(first.state.applications.find((app) => app.id === "app_git").latestResult.importedRecordIds[0], importedId);
    assert.ok(first.state.auditSummaries.some((summary) => summary.applicationResult?.importedRecordIds?.[0] === importedId));
    assert.ok(first.state.events.some((event) => event.type === "application_result_recorded"));

    saveState(first, { stateStorePath });

    const second = createServerState({ defaultProjectPath: projectPath, now });
    restoreState(second, { stateStorePath });

    // 1. The ledger row survives with its parsed body intact.
    const restoredRow = second.state.applicationResults.find((row) => row.id === importedId);
    assert.equal(restoredRow?.status, "parsed", "parsed git repo_state row survives restart");
    assert.equal(restoredRow?.data?.branch?.name, "main", "parsed data survives restart");

    // 2-4. The link on the invocation, audit summary, and application all survive.
    const restoredInvocation = second.state.invocations.find((item) => item.id === invocation.id);
    assert.deepEqual(
      restoredInvocation?.result?.applicationResult?.importedRecordIds,
      [importedId],
      "invocation result link survives restart",
    );
    assert.equal(
      restoredInvocation?.options?.metadata?.applicationResult?.importedRecordIds?.[0],
      importedId,
      "invocation metadata link survives restart",
    );
    assert.ok(
      second.state.auditSummaries.some((summary) => summary.applicationResult?.importedRecordIds?.[0] === importedId),
      "audit summary application-result link survives restart",
    );
    const restoredApp = second.state.applications.find((app) => app.id === "app_git");
    assert.equal(
      restoredApp?.latestResult?.importedRecordIds?.[0],
      importedId,
      "application latestResult link survives restart",
    );

    // 5. The lineage event survives.
    assert.ok(
      second.state.events.some((event) => event.type === "application_result_recorded"),
      "application_result_recorded event survives restart",
    );

    // Both read models rebuild purely from the restored durable rows.
    const publicState = publicStateFor(second.state, { defaultProjectPath: projectPath });
    assert.ok(
      publicState.applicationResults.some((row) => row.id === importedId),
      "public applicationResults projects the restored row",
    );
    assert.equal(
      publicState.applications.find((app) => app.id === "app_git")?.latestResult?.importedRecordIds?.[0],
      importedId,
      "public application latestResult survives restart",
    );
    assert.ok(
      publicState.evidenceCenterRecords.some((record) => record.id === importedId && record.type === "application_result"),
      "Evidence Center rebuilds the application result row after restart",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The tenancy boundary is a read-model property, so it has to hold on RESTORED
// rows too — a snapshot round-trip must not turn a scoped row into a global one.
// The existing tenancy tests run with persistence disabled; this one writes two
// teams' evidence, restarts, and proves each team's public read models, Evidence
// Center rows, and budgets still hide the other team after restore.
test("persistence keeps tenancy scoping across runtime restart for two teams", () => {
  const root = join(tmpdir(), `myagenttool-persistence-tenancy-test-${Date.now()}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  const TEAM_A = "team_a";
  const TEAM_B = "team_b";
  // restore drops projects whose path no longer exists on disk (persistence.mjs),
  // so a project row must point at a real directory to survive the round-trip —
  // otherwise its rows would look "orphaned" and hide under scoping for a reason
  // unrelated to tenancy.
  const projectPathA = `${projectPath}-a`;
  const projectPathB = `${projectPath}-b`;
  mkdirSync(projectPathA, { recursive: true });
  mkdirSync(projectPathB, { recursive: true });

  try {
    const first = createServerState({ defaultProjectPath: projectPath, now });
    first.state.teams.push({ id: TEAM_A, name: "Team A", slug: "a", createdAt: now() }, { id: TEAM_B, name: "Team B", slug: "b", createdAt: now() });
    first.state.users.push(
      { id: "usr_a", name: "User A", email: null, teamId: TEAM_A, role: "owner", createdAt: now() },
      { id: "usr_b", name: "User B", email: null, teamId: TEAM_B, role: "owner", createdAt: now() },
    );
    first.state.projects.push(
      { id: "prj_a", name: "Project A", path: projectPathA, source: "local", ownerTeamId: TEAM_A },
      { id: "prj_b", name: "Project B", path: projectPathB, source: "local", ownerTeamId: TEAM_B },
    );
    // Per-team evidence across every surface the closeout names: invocation,
    // application result (project-scoped), imported usage (invocation-scoped),
    // and a project budget row.
    const seedTeam = (suffix, teamId, projectId) => {
      first.state.applications.push({ id: `app_${suffix}`, name: `Git ${suffix}`, projectId, ownerTeamId: teamId, status: "active", createdAt: now(), updatedAt: now() });
      first.state.invocations.push({ id: `inv_${suffix}`, projectId, requestedBy: `usr_${suffix}`, agentId: "agt_platform_application_wrapper", status: "succeeded", createdAt: now() });
      first.state.applicationResults.push({
        id: `res_${suffix}`, source: "git", kind: "repo_state", applicationId: `app_${suffix}`,
        capability: "app.app_git.wrapper.status", invocationId: `inv_${suffix}`, projectId, ownerTeamId: teamId,
        status: "parsed", truncated: false, data: { branch: { name: `main-${suffix}` } }, text: "# branch.head main", createdAt: now(),
      });
      first.state.importedUsageEstimates.push({ id: `usage_${suffix}`, invocationId: `inv_${suffix}`, estimatedCostUsd: 1, source: "ccusage" });
      first.state.budgets.push({ id: `bud_${suffix}`, projectId, limitUsd: 100, createdAt: now() });
    };
    seedTeam("a", TEAM_A, "prj_a");
    seedTeam("b", TEAM_B, "prj_b");

    saveState(first, { stateStorePath });

    const second = createServerState({ defaultProjectPath: projectPath, now });
    restoreState(second, { stateStorePath });

    const idsOf = (rows) => (rows ?? []).map((row) => row.id).sort();
    const forTeam = (teamId) => publicStateFor(second.state, { defaultProjectPath: projectPath, actor: { teamId } });

    const a = forTeam(TEAM_A);
    const b = forTeam(TEAM_B);

    // Each durable surface scopes to the owning team after restore — no leaks.
    assert.deepEqual(idsOf(a.applicationResults), ["res_a"], "team A sees only its own restored application result");
    assert.deepEqual(idsOf(b.applicationResults), ["res_b"], "team B sees only its own restored application result");
    assert.deepEqual(idsOf(a.importedUsageEstimates), ["usage_a"], "imported usage scopes by invocation after restore");
    assert.deepEqual(idsOf(b.importedUsageEstimates), ["usage_b"]);
    assert.deepEqual(idsOf(a.invocations), ["inv_a"], "invocations scope by project after restore");
    assert.deepEqual(idsOf(b.invocations), ["inv_b"]);
    assert.deepEqual(idsOf(a.budgets), ["bud_a"], "project budgets scope by project after restore");
    assert.deepEqual(idsOf(b.budgets), ["bud_b"]);
    assert.deepEqual(idsOf(a.applications.filter((app) => app.id.startsWith("app_"))), ["app_a"], "applications scope by team after restore");
    assert.deepEqual(idsOf(b.applications.filter((app) => app.id.startsWith("app_"))), ["app_b"]);

    // Evidence Center application-result rows scope by their invocation's project.
    const ecAppResultIds = (publicState) => idsOf(publicState.evidenceCenterRecords.filter((record) => record.type === "application_result"));
    assert.deepEqual(ecAppResultIds(a), ["res_a"], "team A's Evidence Center hides team B's application result after restore");
    assert.deepEqual(ecAppResultIds(b), ["res_b"], "team B's Evidence Center hides team A's application result after restore");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistence restores terminal and Codex evidence center linkage across runtime restart", () => {
  const root = join(tmpdir(), `myagenttool-persistence-terminal-codex-test-${Date.now()}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });

  try {
    const first = createServerState({ defaultProjectPath: projectPath, now });
    const projectId = first.defaultProject.id;
    const invocation = {
      id: "inv_codex_terminal_restore",
      projectId,
      requestedBy: "usr_local",
      agentId: "agt_codex_cli",
      input: { task: "Update durable evidence tests." },
      options: { metadata: { projectId } },
      status: "running",
      createdAt: now(),
    };
    first.state.invocations.unshift(invocation);
    const codex = codexServiceFor(first.state, { defaultProject: first.defaultProject });
    const codexAgent = first.state.agents.find((agent) => agent.id === "agt_codex_cli");
    const workspace = codex.createManagedCodexWorkspace({ invocationId: invocation.id, agent: codexAgent, workspacePolicy: "current_repo" });
    const session = codex.createManagedCodexSession({
      invocationId: invocation.id,
      agent: codexAgent,
      codexSessionMode: "new",
      workspace,
      actor: { userId: "usr_local" },
    });
    const codexEvent = {
      id: "evt_codex_restore_file_change",
      invocationId: invocation.id,
      type: "agent_output",
      message: "Codex edited a persistence test.",
      data: {
        source: "codex_jsonl",
        eventType: "item.completed",
        itemType: "file_change",
        threadId: "thread_restore",
        sessionId: "provider_session_restore",
        fileChangeSummary: "Edited persistence restart coverage.",
        fileChangePath: "apps/server/test/persistence.test.mjs",
        fileChangeAction: "modify",
        diffPreview: "@@ restart coverage @@",
        changeRisk: "medium",
      },
      createdAt: now(),
    };
    codex.updateCodexSessionFromEvent(codexEvent);
    const codexEvidence = codex.createCodexEvidenceRecord(codexEvent);
    const changeReview = codex.createCodexChangeReview({
      evidenceId: codexEvidence.id,
      decision: "approved",
      comment: "Restart evidence remains readable.",
    });

    const terminal = terminalServiceFor(first.state, { codexSessionForInvocation: codex.codexSessionForInvocation });
    const terminalSession = terminal.createManagedTerminalSession({
      ownerInvocationId: invocation.id,
      ownerCodexSessionId: session.id,
      userId: "usr_local",
      cwd: projectPath,
      shell: first.state.terminalRuntimeCapability.defaultShell,
    });
    const action = terminal.nextTerminalBridgeAction();
    terminal.recordTerminalBridgeEvent({
      terminalSessionId: terminalSession.terminalSessionId,
      actionId: action.id,
      type: "terminal.session.attached",
      summary: "Managed terminal attached for restore test.",
    });
    terminal.recordTerminalBridgeEvent({
      terminalSessionId: terminalSession.terminalSessionId,
      type: "terminal.output.chunk",
      summary: "Terminal produced restart evidence.",
      output: "durable terminal output",
      byteCount: 23,
    });

    saveState(first, { stateStorePath });

    const second = createServerState({ defaultProjectPath: projectPath, now });
    restoreState(second, { stateStorePath });
    const publicState = publicStateFor(second.state, { defaultProjectPath: projectPath });
    const restoredSession = second.state.codexSessions.find((item) => item.id === session.id);
    const restoredTerminal = second.state.terminalSessions.find((item) => item.terminalSessionId === terminalSession.terminalSessionId);
    const restoredAction = second.state.terminalBridgeActions.find((item) => item.id === action.id);
    const codexCenter = publicState.evidenceCenterRecords.find((item) => item.id === codexEvidence.id);
    const reviewCenter = publicState.evidenceCenterRecords.find((item) => item.id === changeReview.id);
    const terminalCenters = publicState.evidenceCenterRecords.filter((item) => item.source === "managed_terminal_runtime" && item.codexSessionRegistryId === session.id);

    assert.equal(restoredSession?.codexSessionId, "provider_session_restore");
    assert.equal(restoredSession?.codexThreadId, "thread_restore");
    assert(restoredSession?.evidenceIds.includes(codexEvidence.id), "restored Codex session should retain evidence linkage");
    assert.equal(second.state.codexEvidenceRecords.find((item) => item.id === codexEvidence.id)?.fileChangeSummary, "Edited persistence restart coverage.");
    assert.equal(second.state.codexChangeReviews.find((item) => item.id === changeReview.id)?.codexSessionRegistryId, session.id);
    assert.equal(restoredTerminal?.ownerCodexSessionId, session.id);
    assert(restoredTerminal?.evidenceIds.length >= 2, "restored terminal session should retain evidence ids");
    assert.equal(restoredAction?.status, "completed");

    assert.equal(codexCenter?.source, "managed_codex_jsonl");
    assert.equal(codexCenter?.repoPath, projectPath);
    assert.equal(codexCenter?.summary, "Edited persistence restart coverage.");
    assert.equal(reviewCenter?.source, "managed_codex_review");
    assert.equal(reviewCenter?.codexSessionRegistryId, session.id);
    assert(terminalCenters.some((item) => item.summary === "Terminal produced restart evidence."), "Evidence Center should retain terminal output summary after restore");
    assert(terminalCenters.every((item) => item.invocationId === invocation.id), "terminal evidence should retain owner invocation linkage");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistence restores policy and approval evidence across runtime restart", () => {
  const root = join(tmpdir(), `myagenttool-persistence-policy-approval-test-${Date.now()}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });

  try {
    const first = createServerState({ defaultProjectPath: projectPath, now });
    const { httpDependencies: api } = createServerRuntimeServices({
      namespace: "test",
      protocolVersion: "0.0.0",
      state: first.state,
      defaultProject: first.defaultProject,
      defaultProjectPath: projectPath,
      persistenceEnabled: false,
      stateStorePath,
      stateSchemaVersion: 1,
      dispatchLeaseMs: 30_000,
      now,
    });

    const demoAgent = first.state.agents.find((agent) => agent.id === "agt_demo_cli");
    const approvalInvocation = api.createInvocation("Run high-risk approval restore evidence.", demoAgent, {
      requireLocalApproval: true,
      actor: { userId: "usr_local", teamId: "team_local" },
    });
    const approval = api.findApprovalRequest(approvalInvocation.approvalRequestId);
    assert(approval, "test setup should create an invocation approval request");
    api.denyInvocation(approval, approvalInvocation, { userId: "usr_reviewer" });
    const invocationPolicy = first.state.policyDecisionRecords.find((item) => item.id === approvalInvocation.policyDecisionId);
    assert.equal(invocationPolicy?.decision, "denied");
    assert.equal(approval.status, "denied");

    const codexAgent = first.state.agents.find((agent) => agent.id === "agt_codex_cli");
    const codexInvocation = api.createInvocation("Capture Codex broker approval restore evidence.", codexAgent, {
      metadata: { permissionMode: "ask" },
      actor: { userId: "usr_local", teamId: "team_local" },
    });
    const hook = api.recordCodexHookEvent({
      invocationId: codexInvocation.id,
      eventName: "PermissionRequest",
      toolName: "shell_command",
      summary: "Codex asks to run pnpm test for durable-state evidence.",
      timeoutSeconds: 120,
    });
    assert.equal(hook.brokerRequest?.status, "pending");

    const recipe = api.createLifecycleRecipe({
      action: "update",
      name: "Durable policy update",
      source: {
        type: "manual_entry",
        uri: "manual://durable-policy-update",
        author: "test",
        version: "1.0.0",
        signatureStatus: "not_required",
      },
      supportedPlatforms: [first.state.device.platform],
      expectedBinary: "demo-agent",
      riskLevel: "high",
      rollback: { available: true, strategy: "previous_version", summary: "Restore demo-agent 0.9.0." },
      command: {
        summary: "Update demo agent.",
        commandId: "demo_agent_update",
        executable: "demo-agent",
        args: ["--self-check-update"],
        shell: false,
      },
    });
    api.transitionLifecycleRecipe(recipe, "approve");
    const lifecyclePolicy = api.evaluateLifecyclePolicy(recipe);
    assert.equal(lifecyclePolicy.decision, "requires_local_approval");

    api.updatePrivateDeploymentConfig({ mode: "private_deployment", auditExportEnabled: true });
    const originalExport = api.createAuditExportRequest({ subjects: ["policy", "audit"], dryRun: false });
    assert.equal(originalExport.status, "exported");

    saveState(first, { stateStorePath });

    const second = createServerState({ defaultProjectPath: projectPath, now });
    restoreState(second, { stateStorePath });
    const publicState = publicStateFor(second.state, { defaultProjectPath: projectPath });

    const restoredApproval = second.state.approvalRequests.find((item) => item.id === approval.id);
    const publicApproval = publicState.approvalRequests.find((item) => item.id === approval.id);
    const restoredInvocationPolicy = second.state.policyDecisionRecords.find((item) => item.id === invocationPolicy.id);
    const publicInvocationPolicy = publicState.policyDecisionRecords.find((item) => item.id === invocationPolicy.id);
    const restoredLifecyclePolicy = second.state.lifecyclePolicyDecisions.find((item) => item.id === lifecyclePolicy.id);
    const restoredBroker = second.state.codexApprovalBrokerRequests.find((item) => item.id === hook.brokerRequest.id);
    const publicBroker = publicState.codexApprovalBrokerRequests.find((item) => item.id === hook.brokerRequest.id);
    const brokerEvidence = publicState.evidenceCenterRecords.find((item) => item.id === hook.brokerRequest.id);
    const restoredOriginalExport = second.state.auditExportRequests.find((item) => item.id === originalExport.id);

    assert.equal(restoredApproval?.status, "denied");
    assert.equal(restoredApproval?.decidedBy, "usr_reviewer");
    assert.equal(publicApproval?.status, "denied");
    assert.equal(restoredInvocationPolicy?.decision, "denied");
    assert.equal(restoredInvocationPolicy?.approver, "usr_reviewer");
    assert.equal(publicInvocationPolicy?.reason, "Local approval denied by user.");
    assert.equal(restoredLifecyclePolicy?.decision, "requires_local_approval");
    assert(publicState.lifecyclePolicyDecisions.some((item) => item.id === lifecyclePolicy.id), "lifecycle policy should remain visible after restore");
    assert.equal(restoredBroker?.status, "pending");
    assert.equal(restoredBroker?.toolName, "shell_command");
    assert.equal(publicBroker?.summary, "Codex asks to run pnpm test for durable-state evidence.");
    assert.equal(brokerEvidence?.source, "managed_codex_approval_broker");
    assert.equal(brokerEvidence?.summary, "pending: shell_command");
    assert.equal(restoredOriginalExport?.status, "exported");
    assert(restoredOriginalExport?.manifest?.recordRefs.some((ref) => ref.subject === "policy" && ref.id === approval.id), "restored export request should retain approval refs");

    const restoredM3 = m3ServiceFor(second.state);
    const exportAfterRestore = restoredM3.createAuditExportRequest({ subjects: ["policy", "audit"], dryRun: false });
    assert.equal(exportAfterRestore.status, "exported");
    assert(exportAfterRestore.manifest.recordRefs.some((ref) => ref.subject === "policy" && ref.id === invocationPolicy.id), "invocation policy decision should remain exportable after restore");
    assert(exportAfterRestore.manifest.recordRefs.some((ref) => ref.subject === "policy" && ref.id === lifecyclePolicy.id), "lifecycle policy decision should remain exportable after restore");
    assert(exportAfterRestore.manifest.recordRefs.some((ref) => ref.subject === "policy" && ref.id === approval.id), "approval request should remain exportable after restore");
    assert(exportAfterRestore.manifest.recordRefs.some((ref) => ref.subject === "policy" && ref.id === hook.brokerRequest.id), "Codex broker approval should remain exportable after restore");
    assert(exportAfterRestore.manifest.recordRefs.some((ref) => ref.subject === "audit" && ref.id === approvalInvocation.id), "denied invocation audit summary should remain exportable after restore");
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

function saveState(runtimeState, { stateStorePath }) {
  createPersistenceRuntime({
    state: runtimeState.state,
    enabled: true,
    stateStorePath,
    schemaVersion: 1,
    now,
    defaultProject: runtimeState.defaultProject,
    sameProjectPath,
  }).savePersistentState();
}

function restoreState(runtimeState, { stateStorePath }) {
  createPersistenceRuntime({
    state: runtimeState.state,
    enabled: true,
    stateStorePath,
    schemaVersion: 1,
    now,
    defaultProject: runtimeState.defaultProject,
    sameProjectPath,
  }).restorePersistentState();
}

function m3ServiceFor(state) {
  let id = 0;
  return createM3Service({
    state,
    now,
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent: () => {},
    findAgent: (agentId) => state.agents.find((agent) => agent.id === agentId) ?? null,
  });
}

function importServicesFor(state) {
  let id = 0;
  const nextId = (prefix) => `${prefix}_${++id}`;
  return {
    ccusage: createCcusageImportService({ state, now, nextId, appendEvent: () => {} }),
    codex: createCodexReviewImportService({ state, now, nextId, appendEvent: () => {} }),
    claude: createClaudeReviewImportService({ state, now, nextId, appendEvent: () => {} }),
  };
}

function publicStateFor(state, { defaultProjectPath, actor = null }) {
  const currentProject = () => state.projects.find((item) => item.id === state.currentProjectId) ?? state.projects[0] ?? null;
  const m3 = m3ServiceFor(state);
  const findInvocation = (invocationId) => state.invocations.find((item) => item.id === invocationId) ?? null;
  const codexSessionForInvocation = (invocationId) => state.codexSessions.find((session) => session.invocationId === invocationId) ?? null;
  const repoPathForEvidence = (codexSessionRegistryId) => {
    const session = state.codexSessions.find((item) => item.id === codexSessionRegistryId);
    const workspace = session?.workspaceId ? state.codexWorkspaces.find((item) => item.id === session.workspaceId) : null;
    return workspace?.repoPath ?? session?.repoPath ?? null;
  };
  return buildPublicState({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProjectPath,
    currentProject,
    defaultAgent: () => state.agents[0] ?? null,
    loopRoutineReadModel: () => [],
    codexApprovalQueue: () => [],
    evidenceCenterRecords: () => buildEvidenceCenterRecords({ state, findInvocation, codexSessionForInvocation, repoPathForEvidence }),
    ledgerSummary: () => m3.ledgerSummary(),
    budgetStatuses: () => m3.budgetStatuses(),
    teamBudgetStatuses: () => m3.teamBudgetStatuses(),
    actor,
  });
}

function codexServiceFor(state, { defaultProject }) {
  let id = 0;
  const currentProject = () => state.projects.find((item) => item.id === state.currentProjectId) ?? defaultProject;
  return createCodexService({
    state,
    now,
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent: () => {},
    currentProject,
    findInvocation: (invocationId) => state.invocations.find((item) => item.id === invocationId) ?? null,
    persistStateSoon: () => {},
    uniqueStrings: (items) => [...new Set(items)],
    worktreeForProject: () => null,
  });
}

function terminalServiceFor(state, { codexSessionForInvocation }) {
  let id = 0;
  return createTerminalService({
    state,
    now,
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    summarizeText: (text) => String(text),
    uniqueStrings: (items) => [...new Set(items)],
    codexSessionForInvocation,
  });
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

// --- WS2: durable snapshot writes (atomic tmp+fsync+rename) + a synchronous
// barrier so an accepted invocation cannot be lost in the debounce window. ---

let durabilityCounter = 0;
function durabilityRuntime() {
  const root = join(tmpdir(), `myagenttool-durability-${Date.now()}-${process.pid}-${++durabilityCounter}`);
  const stateStorePath = join(root, "state", "snapshot.json");
  const defaultProject = { id: "prj_default", path: join(root, "project") };
  mkdirSync(defaultProject.path, { recursive: true });
  const state = {
    projects: [defaultProject],
    currentProjectId: defaultProject.id,
    worktrees: [],
    invocations: [],
    device: { id: "dev_1", status: "online" },
  };
  const rt = createPersistenceRuntime({
    state,
    enabled: true,
    stateStorePath,
    schemaVersion: 1,
    now: () => "2026-07-04T00:00:00.000Z",
    defaultProject,
    sameProjectPath,
  });
  return { root, stateStorePath, state, rt };
}

test("persistStateNow: flushes synchronously, valid JSON, no leftover temp file", () => {
  const { root, stateStorePath, state, rt } = durabilityRuntime();
  try {
    state.invocations.push({ id: "inv_1", status: "queued" });
    rt.persistStateNow();
    assert.ok(existsSync(stateStorePath), "the snapshot exists immediately (no debounce wait)");
    assert.ok(!existsSync(`${stateStorePath}.tmp`), "the atomic temp file was renamed away, not left behind");
    const snapshot = JSON.parse(readFileSync(stateStorePath, "utf8")); // throws if torn
    assert.equal(snapshot.invocations[0].id, "inv_1");
    assert.equal(snapshot.schemaVersion, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistStateSoon: does NOT write synchronously (debounced)", () => {
  const { root, stateStorePath, state, rt } = durabilityRuntime();
  try {
    state.invocations.push({ id: "inv_1", status: "queued" });
    rt.persistStateSoon();
    assert.ok(!existsSync(stateStorePath), "the debounced path defers the write");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("durable write round-trips through restore", () => {
  const { root, stateStorePath, state, rt } = durabilityRuntime();
  try {
    state.invocations.push({ id: "inv_keep", status: "queued", idempotencyKey: "k1", requestedBy: "u1" });
    rt.persistStateNow();
    // Fresh state + a runtime pointed at the same file restores the record.
    const restored = {
      projects: [state.projects[0]],
      currentProjectId: null,
      worktrees: [],
      invocations: [],
      device: { id: "dev_1", status: "online" },
    };
    createPersistenceRuntime({
      state: restored,
      enabled: true,
      stateStorePath,
      schemaVersion: 1,
      now: () => "t",
      defaultProject: state.projects[0],
      sameProjectPath,
    }).restorePersistentState();
    assert.equal(restored.invocations.length, 1);
    assert.equal(restored.invocations[0].id, "inv_keep");
    assert.equal(restored.invocations[0].idempotencyKey, "k1", "the idempotency key survives restart");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a persistence write failure is logged, not fatal", () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-persist-fail-"));
  try {
    // Put a FILE where the state directory needs to be, so mkdir/write fails.
    writeFileSync(join(root, "blocker"), "x");
    const rt = createPersistenceRuntime({
      state: { projects: [], currentProjectId: null, worktrees: [], invocations: [{ id: "inv_1" }], device: { id: "d" } },
      enabled: true,
      stateStorePath: join(root, "blocker", "state.json"), // parent is a file → write fails
      schemaVersion: 1,
      now: () => "t",
      defaultProject: { id: "prj", path: root },
      sameProjectPath,
    });
    assert.doesNotThrow(() => rt.persistStateNow(), "a failed persist must not crash the control plane");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("completeLifecycleAction records structured refusal evidence (WS3)", () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-lifecycle-refusal-"));
  const projectPath = join(root, "project");
  mkdirSync(projectPath, { recursive: true });
  try {
    const first = createServerState({ defaultProjectPath: projectPath, now });
    const m3 = m3ServiceFor(first.state);
    const action = { id: "lca_refused", recipeId: null, status: "running", createdAt: now() };
    first.state.lifecycleQueuedActions.push(action);

    m3.completeLifecycleAction(action, {
      status: "failed",
      summary: "Lifecycle command is not allowlisted for this Desktop Bridge build.",
      policyDecision: "local_execution_refused",
      refusal: {
        gate: "lifecycle_allowlist",
        commandId: "not_allowlisted",
        executable: "demo-agent",
        executionEnabled: true,
        reason: "not allowlisted",
      },
    });

    assert.equal(action.result.policyDecision, "local_execution_refused");
    assert.equal(action.result.refusal.gate, "lifecycle_allowlist");
    assert.equal(action.result.refusal.commandId, "not_allowlisted");
    assert.equal(action.result.refusal.executable, "demo-agent");
    // A normal completion carries no refusal (null, not undefined).
    const ok = { id: "lca_ok", recipeId: null, status: "running", createdAt: now() };
    first.state.lifecycleQueuedActions.push(ok);
    m3.completeLifecycleAction(ok, { status: "succeeded", summary: "done" });
    assert.equal(ok.result.policyDecision, null);
    assert.equal(ok.result.refusal, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistence restores the auto-run brakes across restart (kill switch + open breaker survive)", () => {
  const root = join(tmpdir(), `myagenttool-persist-brakes-${Date.now()}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  try {
    const first = createServerState({ defaultProjectPath: projectPath, now });
    // Operator engages the emergency brakes + saves a knob.
    first.state.autoRunSettings = { autonomyKillSwitch: true, requireChecksGreenToMerge: true, autoMergeMaxDiffLines: 250 };
    first.state.autoRunBreaker = { consecutiveFailures: 3, openUntil: "2999-01-01T00:00:00.000Z" };
    createPersistenceRuntime({ state: first.state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject: first.defaultProject, sameProjectPath }).savePersistentState();

    const second = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({ state: second.state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject: second.defaultProject, sameProjectPath }).restorePersistentState();

    // Regression for the audit HIGH: these OBJECTS were in persistedArrayKeys, so
    // restore's Array.isArray guard silently dropped them → every brake un-armed
    // on restart.
    assert.equal(second.state.autoRunSettings.autonomyKillSwitch, true, "kill switch survives restart");
    assert.equal(second.state.autoRunSettings.requireChecksGreenToMerge, true, "require-green survives");
    assert.equal(second.state.autoRunSettings.autoMergeMaxDiffLines, 250, "saved knob survives");
    assert.equal(second.state.autoRunBreaker.openUntil, "2999-01-01T00:00:00.000Z", "open breaker survives restart");
    assert.equal(second.state.autoRunBreaker.consecutiveFailures, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
