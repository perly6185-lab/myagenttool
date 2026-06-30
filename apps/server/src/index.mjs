import { resolve } from "node:path";
import { createEventLogRuntime } from "./runtime/event-log.mjs";
import { createHttpServer } from "./runtime/http-server.mjs";
import { createPersistenceRuntime } from "./runtime/persistence.mjs";
import { createReadModelRuntime } from "./runtime/read-models.mjs";
import { createServerState, resetStateForSelfCheck } from "./runtime/state-factory.mjs";
import {
  codexCliResumeArgs,
  createAgentService,
  isAgentDisabled,
  normalizeStringArray,
} from "./services/agents.mjs";
import { createCodexService } from "./services/codex.mjs";
import { createIntegrationService } from "./services/integrations.mjs";
import { createInvocationService } from "./services/invocations.mjs";
import { createProjectService, sameProjectPath } from "./services/projects.mjs";
import { createTerminalService } from "./services/terminal.mjs";

const namespace = "com.myagenttool";
const protocolVersion = "0.0.0";
const host = process.env.SERVER_HOST ?? "127.0.0.1";
const port = Number(process.env.SERVER_PORT ?? 5001);
const dispatchLeaseMs = Number(process.env.SERVER_DISPATCH_LEASE_MS ?? 30_000);
const isSelfCheck = process.argv.includes("--check");
const persistenceEnabled = !isSelfCheck && process.env.MYAGENTTOOL_STATE_DISABLED !== "1";
const stateStorePath = resolve(process.env.MYAGENTTOOL_STATE_PATH ?? ".myagenttool/state/local-demo-state.json");
const stateSchemaVersion = 1;
const defaultProjectPath = resolve(process.env.MYAGENTTOOL_PROJECT_PATH ?? process.cwd());
const { defaultProject, state } = createServerState({ defaultProjectPath, now });

let idCounter = 1;
let invocationService = null;
let codexEventHandlers = {
  createCodexEvidenceRecord: () => null,
  updateCodexSessionFromEvent: () => null,
};
const {
  persistStateSoon,
  restorePersistentState,
  savePersistentState,
} = createPersistenceRuntime({
  state,
  enabled: persistenceEnabled,
  stateStorePath,
  schemaVersion: stateSchemaVersion,
  now,
  defaultProject,
  sameProjectPath,
});
restorePersistentState();
const { appendEvent } = createEventLogRuntime({
  state,
  now,
  nextId,
  persistStateSoon,
  getCodexEventHandlers: () => codexEventHandlers,
});

const {
  addProject,
  cloneProject,
  createBlankProject,
  createWorktree,
  currentProject,
  gitProjectSummary,
  projectForInvocation,
  readProjectTree,
  removeProject,
  searchProjectContent,
  selectProject,
  worktreeForProject,
} = createProjectService({ state, now, nextId, appendEvent, persistStateSoon });

const {
  completeHealthCheck,
  createAgentHealthCheck,
  disableAgent,
  enableAgent,
  findAgent,
  markHealthCheckStarted,
  nextBridgeHealthCheck,
  registerAgent,
} = createAgentService({ state, now, nextId, appendEvent });

const {
  closeCodexSession,
  codexApprovalQueue,
  codexSessionForInvocation,
  codexWorkspaceForSession,
  createCodexChangeReview,
  createCodexEvidenceRecord,
  createCodexImportedEvidenceRecord,
  createManagedCodexSession,
  createManagedCodexWorkspace,
  expireCodexApprovalBrokerRequests,
  normalizeCodexApprovalMode,
  normalizeCodexSessionMode,
  normalizeCodexWorkspacePolicy,
  recordCodexHookEvent,
  repoPathForEvidence,
  resolveCodexApprovalBrokerRequest,
  updateCodexSessionFromEvent,
} = createCodexService({
  state,
  now,
  nextId,
  appendEvent,
  currentProject,
  findInvocation,
  persistStateSoon,
  uniqueStrings,
  worktreeForProject,
});
codexEventHandlers = {
  createCodexEvidenceRecord,
  updateCodexSessionFromEvent,
};

const {
  createManagedTerminalSession,
  createSshConnectionTest,
  createSshTarget,
  nextTerminalBridgeAction,
  queueTerminalBridgeAction,
  recordTerminalBridgeEvent,
  recordTerminalEvidence,
} = createTerminalService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon,
  summarizeText,
  uniqueStrings,
  codexSessionForInvocation,
});

invocationService = createInvocationService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon,
  dispatchLeaseMs,
  namespace,
  protocolVersion,
  findAgent,
  currentProject,
  worktreeForProject,
  uniqueStrings,
  normalizeCodexApprovalMode,
  normalizeCodexSessionMode,
  normalizeCodexWorkspacePolicy,
  createManagedCodexWorkspace,
  createManagedCodexSession,
  closeCodexSession,
});

const {
  acknowledgeInvocation,
  approveInvocation,
  cancelInvocation,
  cancelInvocationsForDeviceUnlink,
  completeInvocation,
  createCompareRun,
  createInvocation,
  createTroubleshootingReport,
  denyInvocation,
  getAgentUsageSummary,
  isTerminal,
  markDispatched,
  nextDispatchableInvocation,
  redeliverExpiredDispatches,
  startInvocationIfAllowed,
} = invocationService;

const {
  completeDiscoveryRun,
  completeIntegrationProbeRun,
  createDiscoveryRun,
  createIntegrationArtifact,
  createIntegrationProbeRun,
  draftIntegrationWithPlatformAgent,
  findDiscoveryRun,
  findIntegrationArtifact,
  findIntegrationProbeRun,
  generateIntegrationArtifacts,
  markDiscoveryStarted,
  markIntegrationProbeStarted,
  nextBridgeDiscoveryRun,
  nextBridgeProbeRun,
  registerDiscoveredCandidate,
  registerIntegrationArtifact,
  transitionIntegrationArtifact,
  updateIntegrationRetentionSettings,
} = createIntegrationService({
  state,
  now,
  nextId,
  appendEvent,
  completeInvocation,
  createInvocation,
  disableAgent,
  findAgent,
  registerAgent,
});

const {
  currentLoopRoutineProjectContext,
  evidenceCenterRecords,
  publicState,
} = createReadModelRuntime({
  namespace,
  protocolVersion,
  state,
  defaultProjectPath,
  currentProject,
  defaultAgent,
  codexApprovalQueue,
  codexSessionForInvocation,
  findInvocation,
  repoPathForEvidence,
  expireCodexApprovalBrokerRequests,
});

if (isSelfCheck) {
  runProtocolSelfCheck();
  console.log("[server:check] local demo server check OK");
  process.exit(0);
}

const server = createHttpServer({
  host,
  port,
  namespace,
  protocolVersion,
  state,
  now,
  publicState,
  currentLoopRoutineProjectContext,
  currentProject,
  addProject,
  cloneProject,
  createBlankProject,
  createWorktree,
  selectProject,
  removeProject,
  readProjectTree,
  searchProjectContent,
  gitProjectSummary,
  createSshTarget,
  createSshConnectionTest,
  createManagedTerminalSession,
  queueTerminalBridgeAction,
  nextTerminalBridgeAction,
  recordTerminalBridgeEvent,
  recordTerminalEvidence,
  summarizeText,
  appendEvent,
  isAgentDisabled,
  redeliverExpiredDispatches,
  registerAgent,
  findAgent,
  disableAgent,
  enableAgent,
  createAgentHealthCheck,
  unlinkDevice,
  recordCodexHookEvent,
  expireCodexApprovalBrokerRequests,
  resolveCodexApprovalBrokerRequest,
  createCodexImportedEvidenceRecord,
  createCodexChangeReview,
  createDiscoveryRun,
  createIntegrationArtifact,
  findIntegrationArtifact,
  generateIntegrationArtifacts,
  createIntegrationProbeRun,
  registerIntegrationArtifact,
  transitionIntegrationArtifact,
  updateIntegrationRetentionSettings,
  draftIntegrationWithPlatformAgent,
  findDiscoveryRun,
  registerDiscoveredCandidate,
  nextDispatchableInvocation,
  markDispatched,
  projectForInvocation,
  nextBridgeHealthCheck,
  markHealthCheckStarted,
  completeHealthCheck,
  nextBridgeDiscoveryRun,
  markDiscoveryStarted,
  normalizeStringArray,
  completeDiscoveryRun,
  nextBridgeProbeRun,
  markIntegrationProbeStarted,
  findIntegrationProbeRun,
  completeIntegrationProbeRun,
  findInvocation,
  acknowledgeInvocation,
  completeInvocation,
  findApprovalRequest,
  approveInvocation,
  denyInvocation,
  defaultAgent,
  createInvocation,
  startInvocationIfAllowed,
  createCompareRun,
  cancelInvocation,
  createTroubleshootingReport,
});

server.listen(port, host, () => {
  console.log(`[server] http://${host}:${port}`);
});

process.on("SIGINT", () => {
  savePersistentState();
  process.exit(0);
});
process.on("SIGTERM", () => {
  savePersistentState();
  process.exit(0);
});

function now() {
  return new Date().toISOString();
}

function nextId(prefix) {
  const id = `${prefix}_${String(idCounter).padStart(4, "0")}`;
  idCounter += 1;
  return id;
}

function findInvocation(id) {
  return invocationService?.findInvocation(id) ?? state.invocations.find((item) => item.id === id);
}

function findApprovalRequest(id) {
  return invocationService?.findApprovalRequest(id) ?? state.approvalRequests.find((item) => item.id === id);
}

function defaultAgent() {
  return invocationService?.defaultAgent() ?? state.agents.find((item) => item.id === "agt_demo_cli") ?? state.agents.find((item) => item.adapter.type !== "platform") ?? state.agents[0] ?? null;
}

function uniqueStrings(values) {
  return [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))];
}

function summarizeText(value, maxLength = 160) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function unlinkDevice() {
  state.device.status = "offline";
  state.device.unlinkState = "unlinked";
  state.device.credentialRevokedAt = now();
  state.device.updatedAt = now();
  for (const agent of state.agents.filter((item) => item.location.type === "local_device")) {
    if (isAgentDisabled(agent)) {
      agent.updatedAt = now();
      continue;
    }
    agent.status = "unavailable";
    agent.updatedAt = now();
  }
  cancelInvocationsForDeviceUnlink();
  appendEvent({
    invocationId: null,
    type: "device_unlinked",
    level: "info",
    message: "Desktop Bridge device credentials were revoked for unlink."
  });
}

function runProtocolSelfCheck() {
  resetDemoStateForCheck();
  const defaultCodexAgent = findAgent("agt_codex_cli");
  assert(defaultCodexAgent?.status === "unavailable", "default Codex CLI agent should be registered enabled but unavailable while bridge is offline");
  assert(defaultCodexAgent.lifecycle.state === "enabled", "default Codex CLI agent should use the local CLI's native authorization");
  assert(defaultCodexAgent.adapter.outputFormat === "codex_jsonl", "default Codex CLI agent should use JSONL output");
  assert(defaultCodexAgent.adapter.sandbox === null, "default Codex CLI agent should not impose a Web Console sandbox");
  assert(!defaultCodexAgent.adapter.args.includes("--ephemeral"), "default Codex CLI agent should persist sessions for optional resume");
  assert(codexCliResumeArgs().includes("resume"), "Codex CLI resume args should be available for continuation");
  assert(!defaultCodexAgent.adapter.args.includes("read-only"), "default Codex CLI agent should defer sandboxing to Codex CLI");
  assert(defaultCodexAgent.capabilities[0].riskLevel === "high", "default Codex CLI agent should stay high risk");
  assert(defaultCodexAgent.registrationNotes.risk.includes("Codex CLI"), "default Codex CLI agent should expose Codex review notes");
  assert(state.terminalRuntimeCapability.localPty.available === true, "terminal runtime should report local PTY support");
  assert(state.terminalRuntimeCapability.contract.includes("MANAGED_TERMINAL_JOIN_CONTRACT"), "terminal capability should reference the join contract");
  const terminalSession = createManagedTerminalSession({ shell: state.terminalRuntimeCapability.defaultShell });
  assert(terminalSession.terminalSessionId.startsWith("term_"), "terminal session registry should allocate terminal session ids");
  assert(terminalSession.cwd && terminalSession.shell, "terminal session registry should record cwd and shell");
  assert(terminalSession.status === "attaching", "terminal session should wait for Desktop Bridge attach event");
  assert(terminalSession.evidenceIds.length > 0, "terminal session registry should create summary evidence");
  const terminalAction = nextTerminalBridgeAction();
  assert(terminalAction?.actionType === "create", "terminal create action should be bridge-visible");
  assert(recordTerminalBridgeEvent({ terminalSessionId: terminalSession.terminalSessionId, actionId: terminalAction.id, type: "terminal.session.attached", summary: "self-check attached" }).ok, "terminal attach event should update session");
  assert(terminalSession.status === "attached", "terminal attach event should mark session attached");
  const inputAction = queueTerminalBridgeAction(terminalSession, "input", { input: "echo self-check\r" });
  assert(nextTerminalBridgeAction()?.id === inputAction.id, "terminal input action should be bridge-visible");
  assert(recordTerminalBridgeEvent({ terminalSessionId: terminalSession.terminalSessionId, actionId: inputAction.id, type: "terminal.output.chunk", output: "self-check", byteCount: 10, summary: "Terminal output: self-check" }).ok, "terminal output event should create evidence");
  const resizeAction = queueTerminalBridgeAction(terminalSession, "resize", { cols: 100, rows: 30 });
  assert(nextTerminalBridgeAction()?.id === resizeAction.id, "terminal resize action should be bridge-visible");
  assert(recordTerminalBridgeEvent({ terminalSessionId: terminalSession.terminalSessionId, actionId: resizeAction.id, type: "terminal.resize", cols: 100, rows: 30, summary: "self-check resized" }).ok, "terminal resize event should create evidence");
  assert(recordTerminalBridgeEvent({ terminalSessionId: terminalSession.terminalSessionId, type: "terminal.exit", exitCode: 0, summary: "self-check exited" }).ok, "terminal exit event should close lifecycle");
  assert(evidenceCenterRecords().some((record) => record.source === "managed_terminal_runtime"), "Evidence Center should include managed terminal evidence summaries");
  const codexWorkspace = createManagedCodexWorkspace({ invocationId: "inv_self_codex_terminal", agent: defaultCodexAgent, workspacePolicy: "current_repo" });
  const codexSession = createManagedCodexSession({ invocationId: "inv_self_codex_terminal", agent: defaultCodexAgent, codexSessionMode: "continue_last", workspace: codexWorkspace });
  const codexTerminal = createManagedTerminalSession({ ownerCodexSessionId: codexSession.id, ownerInvocationId: "inv_self_codex_terminal", shell: state.terminalRuntimeCapability.defaultShell });
  assert(codexTerminal.ownerCodexSessionId === codexSession.id, "Codex terminal session should link to managed Codex session registry");
  const codexTerminalAction = nextTerminalBridgeAction();
  assert(codexTerminalAction?.terminalSessionId === codexTerminal.terminalSessionId, "Codex terminal create action should be bridge-visible");
  assert(recordTerminalBridgeEvent({ terminalSessionId: codexTerminal.terminalSessionId, actionId: codexTerminalAction.id, type: "terminal.session.attached", summary: "self-check Codex terminal attached" }).ok, "Codex terminal attach event should update session");
  assert(evidenceCenterRecords().some((record) => record.source === "managed_terminal_runtime" && record.codexSessionRegistryId === codexSession.id), "Codex terminal evidence should preserve Codex session linkage");
  const sshTarget = createSshTarget({
    name: "Self-check SSH target",
    host: "example.internal",
    port: 22,
    user: "dev",
    authMethod: "private_key_ref",
    credentialRef: "external-secret:ssh/self-check",
    knownHostPolicy: "pinned_fingerprint",
    knownHostFingerprint: "SHA256:selfcheck",
    workspaceRoot: "/srv/myagenttool",
    platformHint: "linux",
    agentForwarding: false,
    keySelection: "explicit_key_ref"
  });
  assert(sshTarget.id.startsWith("ssh_target_"), "SSH target registry should allocate target ids");
  assert(sshTarget.credentialStorage === "external_reference_only", "SSH target should store credential references only");
  assert(sshTarget.remoteRelayEnabled === false, "SSH target design should not enable remote relay PTY");
  const sshTest = createSshConnectionTest(sshTarget);
  assert(sshTest.status === "ready_for_manual_test", "SSH preflight should pass with explicit credential and pinned host");
  assert(sshTest.auth.plaintextStored === false, "SSH test report should not store plaintext credentials");
  const remoteTerminal = createManagedTerminalSession({
    runtimeKind: "remote_ssh_relay",
    targetId: sshTarget.id,
    shell: "bash",
    cwd: "/srv/myagenttool"
  });
  assert(remoteTerminal.runtimeKind === "remote_ssh_relay", "remote relay terminal session should preserve runtime kind");
  assert(remoteTerminal.remoteHost === sshTarget.host, "remote relay terminal session should record remote host");
  const remoteAction = nextTerminalBridgeAction();
  assert(remoteAction?.session?.runtimeKind === "remote_ssh_relay", "remote relay create action should be bridge-visible");
  assert(recordTerminalBridgeEvent({ terminalSessionId: remoteTerminal.terminalSessionId, actionId: remoteAction.id, type: "terminal.session.attached", summary: "self-check remote relay attached" }).ok, "remote relay attach event should update session");
  assert(recordTerminalBridgeEvent({ terminalSessionId: remoteTerminal.terminalSessionId, type: "terminal.output.chunk", output: "remote self-check", byteCount: 17, summary: "Terminal output: remote self-check" }).ok, "remote relay output event should create evidence");
  assert(evidenceCenterRecords().some((record) => record.source === "managed_terminal_runtime" && record.detail.includes("remote self-check")), "Evidence Center should include remote relay terminal output summaries");
  const blockedSshTarget = createSshTarget({
    host: "blocked.example.internal",
    user: "dev",
    authMethod: "private_key_ref",
    knownHostPolicy: "manual_review",
    workspaceRoot: "/srv/myagenttool"
  });
  const blockedSshTest = createSshConnectionTest(blockedSshTarget);
  assert(blockedSshTest.status === "blocked", "SSH preflight should block missing external credential reference");
  const cliAgent = registerAgent({
    id: "agt_self_cli",
    type: "cli",
    name: "Self-check CLI",
    command: "demo-agent",
    args: ["{{payloadJson}}"],
    timeoutSeconds: 10
  });
  assert(cliAgent.adapter.type === "cli", "CLI agent should register");
  assert(cliAgent.adapter.args[0] === "{{payloadJson}}", "CLI agent should keep structured argv template");

  state.device.status = "online";
  const discoveryRun = createDiscoveryRun({
    scope: ["known_command_allowlist", "known_local_endpoint"],
    userProvidedPaths: ["demo-agent"],
    userProvidedEndpoints: ["http://127.0.0.1:3212"]
  });
  assert(discoveryRun.status === "queued", "online discovery should queue");
  assert(nextBridgeDiscoveryRun()?.id === discoveryRun.id, "queued discovery should be bridge-visible");
  markDiscoveryStarted(discoveryRun);
  completeDiscoveryRun(discoveryRun, {
    candidates: [
      {
        id: "cand_self_demo",
        name: "Self-check Discovered Demo Agent",
        adapter: { type: "cli", command: "demo-agent", args: ["{{payloadJson}}"] },
        source: "known_command_allowlist",
        confidence: "high",
        riskLevel: "low",
        riskTags: ["read_only"],
        healthProbeAvailable: true
      }
    ]
  });
  assert(discoveryRun.status === "succeeded", "discovery should complete");
  assert(discoveryRun.candidates.length === 1, "discovery should keep candidates");
  assert(!state.agents.some((agent) => agent.id === discoveryRun.candidates[0].registration.agentId), "discovery should not auto-register candidates");
  const discoveredAgent = registerDiscoveredCandidate(discoveryRun, discoveryRun.candidates[0]);
  assert(discoveredAgent.status === "disabled", "registered discovery candidate should stay disabled");
  assert(discoveryRun.candidates[0].registration.status === "registered", "candidate registration status should update");

  const codexDiscovery = createDiscoveryRun({
    scope: ["user_provided_path"],
    userProvidedPaths: ["codex"]
  });
  markDiscoveryStarted(codexDiscovery);
  completeDiscoveryRun(codexDiscovery, {
    candidates: [
      {
        id: "cand_self_codex",
        name: "Codex CLI",
        adapter: { type: "cli", command: "codex" },
        source: "user_provided_path",
        confidence: "medium",
        riskLevel: "high",
        healthProbeAvailable: true
      }
    ]
  });
  assert(codexDiscovery.candidates[0].adapter.command === "codex", "user-provided Codex CLI should be discoverable when explicit");
  assert(codexDiscovery.candidates[0].riskLevel === "high", "Codex-like CLI discovery should be high risk");
  assert(codexDiscovery.candidates[0].adapter.args.includes("--json"), "Codex discovery should use JSONL output");
  assert(!codexDiscovery.candidates[0].adapter.args.includes("read-only"), "Codex discovery should defer sandboxing to Codex CLI");
  assert(codexDiscovery.candidates[0].adapter.outputFormat === "codex_jsonl", "Codex discovery should mark JSONL output");
  assert(codexDiscovery.candidates[0].riskTags.includes("repo_context"), "Codex discovery should include repository context risk");
  const codexAgent = registerDiscoveredCandidate(codexDiscovery, codexDiscovery.candidates[0]);
  assert(codexAgent.status === "available", "explicit Codex discovery registration should be available when bridge is online");
  assert(codexAgent.adapter.outputFormat === "codex_jsonl", "registered Codex candidate should preserve JSONL output config");
  const managedCodexInvocation = createInvocation("self-check managed Codex session", codexAgent, { codexSessionMode: "continue_last" });
  const managedCodexSession = codexSessionForInvocation(managedCodexInvocation.id);
  assert(managedCodexInvocation.options.metadata.managedCodexSessionId === managedCodexSession?.id, "Codex invocation should link to managed session registry");
  assert(managedCodexSession.sessionMode === "continue_last", "managed Codex registry should record session mode");
  assert(managedCodexSession.workspaceId, "managed Codex registry should link a workspace registry record");
  const managedCodexWorkspace = state.codexWorkspaces.find((item) => item.id === managedCodexSession.workspaceId);
  assert(managedCodexWorkspace?.policy === "current_repo", "managed Codex workspace should default to current repo policy");
  appendEvent({
    invocationId: managedCodexInvocation.id,
    type: "execution_preview",
    level: "info",
    message: "Execution preview: codex exec --json <task>",
    data: {
      workspace: {
        repoPath: "/tmp/myagenttool",
        branchName: "main",
        dirtyState: "clean",
        lastCommit: "abc1234",
        status: "observed"
      }
    }
  });
  assert(managedCodexWorkspace.branchName === "main", "managed Codex workspace should learn branch from execution preview");
  assert(managedCodexWorkspace.dirtyState === "clean", "managed Codex workspace should learn dirty state from execution preview");
  appendEvent({
    invocationId: managedCodexInvocation.id,
    type: "agent_output",
    level: "info",
    message: "Codex thread started: self_check_thread.",
    data: { source: "codex_jsonl", eventType: "thread.started", threadId: "self_check_thread" }
  });
  appendEvent({
    invocationId: managedCodexInvocation.id,
    type: "agent_output",
    level: "info",
    message: "modified: docs/engineering/CODEX_FIXTURE_REVIEW.md",
    data: {
      source: "codex_jsonl",
      eventType: "item.completed",
      itemType: "file_change",
      fileChangeSummary: "modified: docs/engineering/CODEX_FIXTURE_REVIEW.md",
      fileChangePath: "docs/engineering/CODEX_FIXTURE_REVIEW.md",
      fileChangeAction: "modified",
      diffPreview: "diff --git a/docs/engineering/CODEX_FIXTURE_REVIEW.md b/docs/engineering/CODEX_FIXTURE_REVIEW.md",
      changeRisk: "medium"
    }
  });
  assert(managedCodexSession.codexThreadId === "self_check_thread", "managed Codex registry should learn thread id from JSONL events");
  assert(state.codexEvidenceRecords.some((item) => item.codexSessionRegistryId === managedCodexSession.id), "Codex JSONL events should create evidence records");
  const selfCheckChangeEvidence = state.codexEvidenceRecords.find((item) => item.codexSessionRegistryId === managedCodexSession.id && item.fileChangeSummary);
  assert(selfCheckChangeEvidence?.diffPreview, "Codex file-change evidence should retain a redacted diff preview");
  const selfCheckChangeReview = createCodexChangeReview({
    evidenceId: selfCheckChangeEvidence.id,
    decision: "feedback",
    comment: "Please tighten the wording before adopting this change."
  });
  assert(selfCheckChangeReview.followUpPrompt?.includes(selfCheckChangeEvidence.id), "Codex change feedback should preserve evidence linkage");
  const hookRecord = recordCodexHookEvent({
    invocationId: managedCodexInvocation.id,
    eventName: "UserPromptSubmit",
    summary: "Please do not paste ~/.codex/auth.json."
  });
  assert(hookRecord.policyDecision === "blocked", "Codex hook policy should flag credential-looking prompt content");
  recordCodexHookEvent({
    invocationId: managedCodexInvocation.id,
    eventName: "PermissionRequest",
    toolName: "Bash",
    summary: "Self-check permission request"
  });
  const brokerRequest = state.codexApprovalBrokerRequests.find((item) => item.invocationId === managedCodexInvocation.id);
  assert(brokerRequest?.status === "pending", "Codex PermissionRequest hook should create a broker request");
  resolveCodexApprovalBrokerRequest(brokerRequest, "approve");
  assert(brokerRequest.status === "approved", "Codex approval broker should resolve approval");
  recordCodexHookEvent({
    invocationId: managedCodexInvocation.id,
    eventName: "PermissionRequest",
    toolName: "Bash",
    summary: "Self-check expiring permission request",
    timeoutSeconds: 1
  });
  const expiringBrokerRequest = state.codexApprovalBrokerRequests.find((item) => item.summary === "Self-check expiring permission request");
  expiringBrokerRequest.timeoutAt = new Date(Date.now() - 1).toISOString();
  expireCodexApprovalBrokerRequests();
  assert(expiringBrokerRequest.status === "timed_out", "Codex approval broker should deterministically time out pending requests");
  assert(state.events.some((item) => item.type === "codex_approval_timed_out" && item.data?.approvalBrokerRequestId === expiringBrokerRequest.id), "Codex approval timeout should be audited");
  const importedEvidence = createCodexImportedEvidenceRecord({
    summary: "Self-check imported Codex evidence summary.",
    source: "user_selected_local_preview"
  });
  assert(importedEvidence.marker === "imported_after_the_fact", "imported Codex evidence should be marked after the fact");
  assert(!state.codexSessions.some((item) => item.id === importedEvidence.id), "imported evidence must not become a managed session");
  const compareRun = createCompareRun("self-check compare run", [cliAgent, codexAgent], { codexWorkspacePolicy: "current_repo" });
  assert(compareRun.childInvocationIds.length === 2, "compare run should create child invocations");
  assert(compareRun.childInvocationIds.every((id) => findInvocation(id)?.compareRunId === compareRun.id), "compare child invocations should link to parent compare run");

  const draftArtifact = createIntegrationArtifact({
    targetType: "cli",
    title: "Self-check integration",
    description: "I have an unsupported local CLI agent.",
    command: "demo-agent",
    cancellation: "supported",
    environmentNeeds: "No secrets required."
  });
  assert(draftArtifact.reviewState === "draft", "intake should record a draft integration artifact");
  assert(draftArtifact.generatedByAi === false, "intake draft should not be marked AI-generated");
  const generatedArtifacts = generateIntegrationArtifacts(draftArtifact);
  const adapterArtifact = generatedArtifacts.find((item) => item.artifactType === "adapter_config");
  assert(adapterArtifact?.generatedByAi === true, "generated adapter config should record AI metadata");
  assert(adapterArtifact.reviewState === "needs_review", "generated adapter config should need review");
  const codexDraftArtifact = createIntegrationArtifact({
    targetType: "cli",
    title: "Self-check Codex integration",
    description: "I want to connect Codex CLI for repository review tasks.",
    command: "codex",
    cancellation: "supported",
    environmentNeeds: "Use existing local Codex authentication."
  });
  const codexAdapterArtifact = generateIntegrationArtifacts(codexDraftArtifact).find((item) => item.artifactType === "adapter_config");
  assert(codexAdapterArtifact.payload.adapterConfig.args.includes("--json"), "Codex adapter config should request JSONL output");
  assert(!codexAdapterArtifact.payload.adapterConfig.args.includes("read-only"), "Codex adapter config should defer sandboxing to Codex CLI");
  assert(codexAdapterArtifact.payload.adapterConfig.outputFormat === "codex_jsonl", "Codex adapter config should declare JSONL output");
  assert(codexAdapterArtifact.governance.riskTags.includes("repo_context"), "Codex adapter config should record repo context risk");
  transitionIntegrationArtifact(adapterArtifact, "approve");
  const probeRun = createIntegrationProbeRun(adapterArtifact);
  assert(probeRun.status === "queued", "CLI probe should queue for Desktop Bridge");
  markIntegrationProbeStarted(probeRun);
  completeIntegrationProbeRun(probeRun, {
    status: "succeeded",
    summary: "Self-check probe passed.",
    details: ["Restricted CLI probe completed."]
  });
  assert(adapterArtifact.reviewState === "tested", "passing probe should mark adapter artifact tested");
  const generatedAgent = registerIntegrationArtifact(adapterArtifact);
  assert(generatedAgent.status === "disabled", "registered integration artifact should create disabled agent");
  assert(adapterArtifact.reviewState === "enabled", "explicit registration should record enabled artifact state");
  assert(state.quotaDecisionRecords.some((item) => item.artifactId === draftArtifact.id), "integration artifact should record quota decision");
  state.device.status = "offline";

  const httpAgent = registerAgent({
    id: "agt_self_http",
    type: "http",
    name: "Self-check HTTP",
    baseUrl: "http://127.0.0.1:1",
    requestPath: "/invoke",
    timeoutSeconds: 10,
    cancellation: "supported"
  });
  assert(httpAgent.adapter.type === "http", "HTTP agent should register");
  assert(httpAgent.adapter.baseUrl === "http://127.0.0.1:1", "HTTP agent should keep base URL");
  assert(httpAgent.adapter.healthPath === "/health", "HTTP agent should default health path");
  assert(findAgent("agt_platform_troubleshooter")?.adapter.type === "platform", "platform troubleshooter should be registered");

  const disableOperation = disableAgent(cliAgent);
  assert(cliAgent.status === "disabled", "disabled CLI agent should report disabled");
  assert(disableOperation.status === "succeeded", "disable operation should complete");

  const disabledInvocation = createInvocation("disabled dispatch should wait", cliAgent);
  assert(nextDispatchableInvocation()?.id !== disabledInvocation.id, "disabled agent work should not dispatch");

  const enableOperation = enableAgent(cliAgent);
  assert(enableOperation.status === "succeeded", "enable operation should complete");
  assert(cliAgent.status === "unavailable", "enabled offline CLI agent should be unavailable");

  state.device.status = "online";
  const healthOperation = createAgentHealthCheck(cliAgent);
  assert(healthOperation.status === "queued", "CLI health check should queue for Desktop Bridge");
  assert(nextBridgeHealthCheck()?.id === healthOperation.id, "queued CLI health check should be bridge-visible");
  markHealthCheckStarted(healthOperation);
  completeHealthCheck(healthOperation, {
    status: "healthy",
    message: "Self-check CLI health passed.",
    nextAction: null
  });
  assert(cliAgent.health?.status === "healthy", "completed CLI health should mark agent healthy");
  assert(state.lifecycleAuditRecords.some((item) => item.id === healthOperation.id && item.status === "succeeded"), "health should record lifecycle audit");
  state.device.status = "offline";

  const traceCountBeforeInvocation = state.traces.length;
  const spanCountBeforeInvocation = state.spans.length;
  const invocation = createInvocation("self-check invocation", cliAgent);
  assert(invocation.status === "queued", "created invocation should be queued");
  assert(invocation.delivery.state === "queued", "created delivery should be queued");
  assert(invocation.agentId === cliAgent.id, "created invocation should reference selected CLI agent");
  assert(state.traces.length === traceCountBeforeInvocation + 1 && state.spans.length === spanCountBeforeInvocation + 1, "trace and root span should be created");

  markDispatched(invocation);
  assert(invocation.status === "dispatching", "dispatched invocation should be dispatching");
  assert(invocation.delivery.state === "dispatching", "delivery should be dispatching");
  assert(invocation.delivery.dispatchAttempts === 1, "dispatch attempts should increment");

  invocation.delivery.leaseExpiresAt = new Date(Date.now() - 1000).toISOString();
  redeliverExpiredDispatches();
  assert(invocation.status === "queued", "expired dispatch lease should return invocation to queued");
  assert(invocation.delivery.state === "redelivering", "expired dispatch lease should mark redelivering");

  const redelivery = nextDispatchableInvocation();
  assert(redelivery?.id === invocation.id, "redelivering invocation should be dispatchable");
  markDispatched(invocation);
  assert(invocation.delivery.dispatchAttempts === 2, "redelivery should increment attempts");

  acknowledgeInvocation(invocation);
  acknowledgeInvocation(invocation);
  assert(invocation.status === "running", "acknowledged invocation should be running");
  assert(invocation.delivery.state === "acknowledged", "delivery should be acknowledged");
  assert(invocation.delivery.leaseExpiresAt === null, "acknowledgement should clear lease");

  completeInvocation(invocation, {
    status: "succeeded",
    summary: "Self-check completed.",
    result: { touchedUserFiles: false }
  });
  assert(invocation.status === "succeeded", "completed invocation should succeed");
  assert(state.auditSummaries.some((item) => item.invocationId === invocation.id && item.traceId === invocation.traceId), "audit summary should reference trace");
  assert(state.spans.find((item) => item.id === invocation.rootSpanId)?.status === "succeeded", "root span should complete");
  assert(getAgentUsageSummary(cliAgent.id).succeededCount === 1, "successful invocation should increment agent usage");

  const failedForTroubleshooting = createInvocation("self-check failed invocation", cliAgent);
  completeInvocation(failedForTroubleshooting, {
    status: "failed",
    summary: "Self-check adapter failure.",
    result: null
  });
  const report = createTroubleshootingReport(failedForTroubleshooting);
  assert(report.invocationId === failedForTroubleshooting.id, "troubleshooter report should target failed invocation");
  assert(report.adapterError?.includes("Self-check adapter failure"), "troubleshooter should summarize adapter error");
  assert(report.suggestedFixes.some((item) => item.includes("approved workflow")), "troubleshooter should not remediate automatically");
  assert(state.invocations.some((item) => item.agentId === "agt_platform_troubleshooter" && item.status === "succeeded"), "troubleshooter should use normal invocation path");
  assert(state.auditSummaries.some((item) => item.agentId === "agt_platform_troubleshooter"), "troubleshooter should write audit through invocation completion");
  assert(getAgentUsageSummary("agt_platform_troubleshooter").succeededCount === 1, "platform agent usage should be counted");

  const highRiskAgent = registerAgent({
    id: "agt_self_high_risk",
    type: "cli",
    name: "Self-check High Risk CLI",
    command: "demo-agent",
    args: ["{{payloadJson}}"],
    riskLevel: "high",
    riskTags: ["read_local", "shell_exec", "destructive"]
  });
  const approvalInvocation = createInvocation("high-risk invocation approval path", highRiskAgent);
  assert(approvalInvocation.status === "waiting_for_local_approval", "high-risk invocation should wait for local approval");
  assert(approvalInvocation.delivery.dispatchAttempts === 0, "approval-gated invocation should not dispatch");
  assert(nextDispatchableInvocation()?.id !== approvalInvocation.id, "approval-gated invocation should not be dispatchable");
  const approval = findApprovalRequest(approvalInvocation.approvalRequestId);
  assert(approval?.status === "pending", "approval request should be pending");
  assert(approval.summary.risk && approval.summary.data && approval.summary.cost && approval.summary.cancellation, "approval request should include plain-language summary");
  const policyRecord = state.policyDecisionRecords.find((item) => item.id === approvalInvocation.policyDecisionId);
  assert(policyRecord?.decision === "requires_local_approval", "policy should require approval");
  assert(policyRecord.riskTags.includes("destructive"), "policy should record risk tags");
  approveInvocation(approval, approvalInvocation);
  assert(approval.status === "approved", "approval should be granted");
  assert(approvalInvocation.status === "queued", "approved local invocation should enter queue");
  assert(nextDispatchableInvocation()?.id === approvalInvocation.id, "approved local invocation should become dispatchable");
  cancelInvocation(approvalInvocation);
  assert(approvalInvocation.status === "cancelled", "approved self-check invocation should be cancellable before dispatch");

  const deniedInvocation = createInvocation("high-risk invocation denial path", highRiskAgent);
  const deniedApproval = findApprovalRequest(deniedInvocation.approvalRequestId);
  denyInvocation(deniedApproval, deniedInvocation);
  assert(deniedApproval.status === "denied", "approval should be denied");
  assert(deniedInvocation.status === "rejected", "denied approval should reject invocation");
  assert(state.auditSummaries.some((item) => item.invocationId === deniedInvocation.id && item.permissionDecision === "denied"), "denied approval should be audited");
  assert(state.events.some((item) => item.invocationId === deniedInvocation.id && item.type === "local_approval_denied"), "denied approval should emit an event");
  assert(getAgentUsageSummary(highRiskAgent.id).failedCount >= 1, "denied invocation should increment failed usage count");

  const queuedCancel = createInvocation("queued cancellation");
  cancelInvocation(queuedCancel);
  assert(queuedCancel.status === "cancelled", "queued cancellation should cancel invocation");
  assert(queuedCancel.cancellation.state === "queued_cancelled", "queued cancellation state should be queued_cancelled");

  const unlinkQueued = createInvocation("unlink cancellation", cliAgent);
  unlinkDevice();
  assert(state.device.unlinkState === "unlinked", "unlink should mark device unlinked");
  assert(Boolean(state.device.credentialRevokedAt), "unlink should revoke device credentials");
  assert(unlinkQueued.status === "cancelled", "unlink should cancel queued local invocations");
  assert(state.auditSummaries.some((item) => item.invocationId === unlinkQueued.id && item.errorSummary?.includes("Device unlink")), "unlink should audit queued cleanup");

  resetDemoStateForCheck();
  const runningCancelAgent = registerAgent({
    id: "agt_running_cancel",
    type: "cli",
    name: "Running cancel CLI",
    command: "demo-agent"
  });
  const runningCancel = createInvocation("running unlink cancellation", runningCancelAgent);
  markDispatched(runningCancel);
  acknowledgeInvocation(runningCancel);
  unlinkDevice();
  assert(runningCancel.status === "cancelling", "unlink should request cancellation for running local invocations");
  assert(runningCancel.cancellation.state === "requested", "running unlink cancellation should be requested");
}

function resetDemoStateForCheck() {
  resetStateForSelfCheck({ state, now });
  idCounter = 1;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
