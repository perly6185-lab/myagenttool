import http from "node:http";
import { codexCliResumeArgs } from "../services/agents.mjs";
import { resetStateForSelfCheck } from "./state-factory.mjs";

export async function runProtocolSelfCheck(deps) {
  const {
  appendEvent,
  approveInvocation,
  cancelInvocation,
  completeDiscoveryRun,
  completeHealthCheck,
  completeIntegrationProbeRun,
  completeInvocation,
  codexSessionForInvocation,
  createAgentHealthCheck,
  createCodexChangeReview,
  createCodexImportedEvidenceRecord,
  createCompareRun,
  createDiscoveryRun,
  createIntegrationArtifact,
  createIntegrationProbeRun,
  createInvocation,
  createLifecycleRecipe,
  createPrivateCatalogEntry,
  createSignedBundleManifest,
  createManagedCodexSession,
  createManagedCodexWorkspace,
  createManagedTerminalSession,
  createQuotaPolicy,
  createSshConnectionTest,
  createSshTarget,
  createAuditExportRequest,
  completeLifecycleAction,
  defaultAgent,
  disableAgent,
  denyInvocation,
  enableAgent,
  evidenceCenterRecords,
  expireCodexApprovalBrokerRequests,
  findAgent,
  findApprovalRequest,
  findInvocation,
  findLifecycleLocalApproval,
  findLifecycleRollbackRequest,
  findLifecycleRecipe,
  generateIntegrationArtifacts,
  getAgentUsageSummary,
  chargebackExport,
  decideLifecycleLocalApproval,
  evaluateLifecyclePolicy,
  markDispatched,
  markDiscoveryStarted,
  markHealthCheckStarted,
  markIntegrationProbeStarted,
  markLifecycleActionStarted,
  nextBridgeDiscoveryRun,
  nextBridgeHealthCheck,
  nextBridgeLifecycleAction,
  nextDispatchableInvocation,
  nextTerminalBridgeAction,
  queueTerminalBridgeAction,
  recordCodexHookEvent,
  recordTerminalBridgeEvent,
  redeliverExpiredDispatches,
  registerAgent,
  registerDiscoveredCandidate,
  registerIntegrationArtifact,
  queueLifecycleAction,
  queueRollbackAction,
  recordAiUsage,
  requestLifecycleLocalApproval,
  resolveCodexApprovalBrokerRequest,
  state,
  startInvocationIfAllowed,
  transitionIntegrationArtifact,
  transitionLifecycleRecipe,
  updatePrivateDeploymentConfig,
  unlinkDevice,
  acknowledgeInvocation,
  createTroubleshootingReport,
  now,
  resetIdCounter,
  } = deps;

  function resetDemoStateForCheck() {
    resetStateForSelfCheck({ state, now });
    resetIdCounter();
  }

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
  assert("codexResumeSessionId" in managedCodexInvocation.options, "continue_last invocation should thread a codexResumeSessionId for true resume (#163)");
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

  const catalogEntry = createPrivateCatalogEntry({
    packageName: "demo-agent",
    displayName: "Self-check Demo Agent",
    version: "0.0.1",
    channel: "stable",
    agentId: cliAgent.id,
    status: "published"
  });
  assert(catalogEntry.id.startsWith("cat_"), "private catalog entry should allocate catalog ids");
  const signedBundle = createSignedBundleManifest({
    catalogEntryId: catalogEntry.id,
    packageName: "demo-agent",
    version: "0.0.1",
    channel: "stable",
    sourceUri: "bundle://self-check/demo-agent",
    checksum: "sha256:selfcheck",
    signatureStatus: "signed_verified",
    provenance: {
      builder: "self-check",
      sourceCommit: "self-check",
      generatedByAi: false
    }
  });
  assert(signedBundle.policy.decision === "allowed", "signed bundle metadata should pass policy");
  assert(state.privateCatalogEntries.find((item) => item.id === catalogEntry.id)?.bundleIds.includes(signedBundle.id), "signed bundle should link to private catalog entry");

  const updateRecipe = createLifecycleRecipe({
    agentId: cliAgent.id,
    catalogEntryId: catalogEntry.id,
    bundleId: signedBundle.id,
    action: "update",
    name: "Self-check lifecycle update",
    source: {
      type: "private_catalog",
      uri: "catalog://self-check/demo-agent",
      author: "myagenttool",
      version: "0.0.1",
      checksum: "sha256:selfcheck",
      signatureStatus: "signed_verified",
      compatibilityRange: ">=0.0.0"
    },
    supportedPlatforms: [state.device.platform],
    expectedBinary: "demo-agent",
    requiredPermissions: ["run reviewed update command"],
    riskLevel: "high",
    riskTags: ["shell_exec", "write_local"],
    rollback: {
      available: true,
      strategy: "previous_version",
      previousVersion: "0.0.0",
      summary: "Rollback can restore the previous demo-agent version."
    },
    recipeCommand: {
      executable: "demo-agent",
      args: ["--self-check-update"],
      commandId: "demo_agent_update"
    },
    healthCheck: {
      type: "cli",
      summary: "demo-agent --version should succeed.",
      command: { executable: "demo-agent", args: ["--version"], commandId: "demo_agent_version" }
    }
  });
  assert(updateRecipe.reviewState === "draft", "lifecycle recipe should be created as draft");
  assert(updateRecipe.recipeCommand?.shell === false, "lifecycle recipe command should be structured and shell-free");
  assert(state.privateCatalogEntries.find((item) => item.id === catalogEntry.id)?.recipeIds.includes(updateRecipe.id), "lifecycle recipe should link back to private catalog entry");
  assert(updateRecipe.summary.localApproval.includes("Local approval"), "lifecycle recipe should include plain-language local approval summary");
  assert(findLifecycleRecipe(updateRecipe.id)?.id === updateRecipe.id, "lifecycle recipe should be discoverable");
  transitionLifecycleRecipe(updateRecipe, "review");
  transitionLifecycleRecipe(updateRecipe, "approve");
  const lifecyclePolicy = evaluateLifecyclePolicy(updateRecipe);
  assert(lifecyclePolicy.decision === "requires_local_approval", "high-risk lifecycle recipe should require local approval");
  const lifecycleApproval = requestLifecycleLocalApproval(updateRecipe);
  assert(lifecycleApproval.status === "pending", "lifecycle local approval should be pending");
  assert(findLifecycleLocalApproval(lifecycleApproval.id)?.recipeId === updateRecipe.id, "lifecycle approval should be discoverable");
  decideLifecycleLocalApproval(lifecycleApproval, "approve");
  assert(lifecycleApproval.status === "approved", "lifecycle local approval should be approvable");
  const queuedLifecycleAction = queueLifecycleAction(updateRecipe);
  assert(queuedLifecycleAction.executionEnabled === true, "allowlisted lifecycle queue should enable Desktop Bridge execution");
  assert(queuedLifecycleAction.command?.commandId === "demo_agent_update", "allowlisted lifecycle queue should expose only a canonical command descriptor");
  assert(queuedLifecycleAction.command.executable === "demo-agent", "allowlisted lifecycle command should be canonicalized");
  let earlyLifecycleCompletionError = null;
  try {
    completeLifecycleAction(queuedLifecycleAction, {
      status: "succeeded",
      summary: "This should not complete before bridge start."
    });
  } catch (error) {
    earlyLifecycleCompletionError = error;
  }
  assert(earlyLifecycleCompletionError, "queued lifecycle action should not complete before Desktop Bridge starts it");
  const bridgeLifecycleAction = nextBridgeLifecycleAction();
  assert(bridgeLifecycleAction?.id === queuedLifecycleAction.id, "queued executable lifecycle action should be bridge-visible");
  markLifecycleActionStarted(bridgeLifecycleAction);
  assert(queuedLifecycleAction.status === "running", "started lifecycle action should stop repeated bridge dispatch");
  assert(updateRecipe.queueState === "running", "started lifecycle action should update recipe queue state");
  completeLifecycleAction(queuedLifecycleAction, {
    status: "succeeded",
    summary: "Self-check lifecycle execution passed.",
    exitCode: "not-a-number",
    stdout: "demo-agent self-check update completed",
    stderr: "",
    durationMs: "not-a-number",
    healthStatus: "healthy"
  });
  assert(queuedLifecycleAction.status === "succeeded", "completed lifecycle action should succeed");
  assert(updateRecipe.queueState === "succeeded", "completed lifecycle action should update recipe queue state");
  assert(queuedLifecycleAction.result?.exitCode === null, "invalid lifecycle exit code should normalize to null");
  assert(queuedLifecycleAction.result?.durationMs === null, "invalid lifecycle duration should normalize to null");
  assert(queuedLifecycleAction.result?.rollbackAvailable === true, "completed lifecycle action should retain rollback availability");
  assert(state.lifecycleAuditRecords.some((item) => item.id === queuedLifecycleAction.id && item.status === "succeeded"), "lifecycle completion should update audit records");

  const failedLifecycleAction = queueLifecycleAction(updateRecipe);
  markLifecycleActionStarted(failedLifecycleAction);
  completeLifecycleAction(failedLifecycleAction, {
    status: "failed",
    summary: "Self-check lifecycle execution failed for rollback.",
    exitCode: 1,
    stdout: "",
    stderr: "simulated failure",
    durationMs: 5,
    healthStatus: "unhealthy"
  });
  const rollbackRequest = state.lifecycleRollbackRequests.find((item) => item.failedActionId === failedLifecycleAction.id);
  assert(rollbackRequest?.status === "available", "failed lifecycle action should create an available rollback request");
  assert(findLifecycleRollbackRequest(rollbackRequest.id)?.id === rollbackRequest.id, "rollback request should be discoverable");
  const rollbackQueuedAction = queueRollbackAction(rollbackRequest);
  assert(rollbackQueuedAction.action === "rollback", "rollback queue should create rollback lifecycle action");
  assert(rollbackQueuedAction.command?.commandId === "demo_agent_rollback", "rollback queue should use canonical rollback command");
  markLifecycleActionStarted(rollbackQueuedAction);
  completeLifecycleAction(rollbackQueuedAction, {
    status: "succeeded",
    summary: "Self-check rollback completed.",
    exitCode: 0,
    stdout: "demo-agent self-check rollback completed",
    stderr: "",
    durationMs: 8,
    healthStatus: "healthy"
  });
  assert(rollbackRequest.status === "succeeded", "rollback request should complete with queued action");

  const blockedRecipe = createLifecycleRecipe({
    agentId: cliAgent.id,
    action: "install",
    name: "Self-check non-allowlisted lifecycle install",
    source: {
      type: "manual_entry",
      author: "self-check",
      version: "0.0.1",
      signatureStatus: "not_required"
    },
    supportedPlatforms: [state.device.platform],
    riskLevel: "medium",
    recipeCommand: {
      executable: "not-demo-agent",
      args: ["install"],
      commandId: "not_allowlisted"
    }
  });
  transitionLifecycleRecipe(blockedRecipe, "review");
  transitionLifecycleRecipe(blockedRecipe, "approve");
  const blockedQueuedLifecycleAction = queueLifecycleAction(blockedRecipe);
  assert(blockedQueuedLifecycleAction.executionEnabled === false, "non-allowlisted lifecycle queue must not enable execution");
  assert(blockedQueuedLifecycleAction.command === null, "non-allowlisted lifecycle queue must not expose commands to bridge");
  assert(nextBridgeLifecycleAction()?.id !== blockedQueuedLifecycleAction.id, "non-allowlisted lifecycle action should not be bridge-dispatched");

  const blockedUninstallAgent = registerAgent({
    id: "agt_self_external_uninstall",
    type: "http",
    name: "Self-check external uninstall target",
    baseUrl: "http://127.0.0.1:65535"
  });
  let blockedUninstallError = null;
  try {
    createLifecycleRecipe({
      agentId: blockedUninstallAgent.id,
      action: "uninstall",
      name: "Unsafe external uninstall",
      source: {
        type: "manual_entry",
        author: "self-check",
        version: "0.0.1",
        signatureStatus: "unsigned"
      },
      supportedPlatforms: [state.device.platform],
      uninstall: {
        bridgeManagedOnly: false,
        deletesUnderlyingSoftware: true,
        requiresExtraConfirmation: false,
        manualAgentRegistryOnly: false
      }
    });
  } catch (error) {
    blockedUninstallError = error;
  }
  assert(blockedUninstallError, "unsafe uninstall recipe should be rejected before execution");

  const quotaPolicy = createQuotaPolicy({
    name: "Self-check platform AI quota",
    provider: "openai",
    model: "gpt-self-check",
    limit: 1,
    subjectId: "usr_local",
    costOwner: "team_self_check",
    teamId: "team_self_check"
  });
  assert(quotaPolicy.providerMode === "platform_managed", "quota policy should default to platform-managed mode");
  const usageResult = recordAiUsage({
    userId: "usr_local",
    teamId: "team_self_check",
    agentId: "agt_platform_integration_builder",
    provider: "openai",
    model: "gpt-self-check",
    providerMode: "platform_managed",
    inputTokens: 12,
    outputTokens: 8,
    requestCount: 1,
    estimatedCost: "0.0004",
    costOwner: "team_self_check"
  });
  assert(usageResult.quotaDecision.decision === "allowed", "platform-managed AI call should pass quota when under limit");
  assert(usageResult.usageRecord?.ledgerEntryIds.length === 1, "allowed AI usage should create a ledger entry");
  const blockedUsageResult = recordAiUsage({
    userId: "usr_local",
    provider: "openai",
    model: "gpt-self-check",
    providerMode: "platform_managed",
    requestCount: 1,
    estimatedCost: "0.0004"
  });
  assert(blockedUsageResult.blocked === true, "platform-managed AI call should be blocked when quota is exceeded");
  assert(blockedUsageResult.usageRecord === null, "blocked AI usage should not create a usage record");
  createQuotaPolicy({
    name: "Self-check invocation quota block",
    provider: "openai",
    model: "gpt-blocked-invocation",
    limit: 0,
    subjectId: "usr_local",
    costOwner: "team_self_check",
    teamId: "team_self_check"
  });
  const usageCountBeforeQuotaBlockedInvocation = state.aiUsageRecords.length;
  const quotaBlockedInvocation = createInvocation("platform-managed quota should block this invocation", findAgent("agt_platform_integration_builder"), {
    metadata: {
      platformManagedAi: true,
      provider: "openai",
      model: "gpt-blocked-invocation",
      estimatedCost: "0.001",
      teamId: "team_self_check",
      costOwner: "team_self_check"
    }
  });
  assert(quotaBlockedInvocation.status === "rejected", "platform-managed quota should reject invocation before execution");
  assert(state.aiUsageRecords.length === usageCountBeforeQuotaBlockedInvocation, "quota-blocked invocation should not create billable usage");
  const byokUsageResult = recordAiUsage({
    userId: "usr_local",
    provider: "openai",
    model: "gpt-self-check",
    providerMode: "byok",
    requestCount: 1,
    estimatedCost: "unknown"
  });
  assert(byokUsageResult.blocked === false, "BYOK usage should remain attributable without SaaS billing enforcement");
  assert(chargebackExport().rows.some((row) => row.costOwner === "team_self_check" && row.quotaDecision), "chargeback export should include cost owner and quota outcome rows");

  const privateDeploymentConfig = updatePrivateDeploymentConfig({
    mode: "private_deployment",
    auditExportEnabled: true,
    immutableAuditOption: "configured",
    capabilities: {
      privateCatalog: true,
      signedBundles: true,
      auditExport: true,
      siemExport: true,
      immutableAudit: true,
      platformManagedAi: true
    },
    auditSinks: [
      {
        id: "sink_self_check_immutable",
        type: "immutable_store",
        enabled: true,
        displayName: "Self-check immutable audit sink",
        destinationRef: "external:immutable/self-check",
        immutable: true,
        externalDeliveryEnabled: false,
        retentionDays: 3650
      }
    ],
    alertSinks: [
      {
        id: "alert_self_check_siem",
        type: "siem",
        enabled: true,
        destinationRef: "external:siem/self-check",
        severityThreshold: "warn",
        externalDeliveryEnabled: false
      }
    ]
  });
  assert(privateDeploymentConfig.entitlementPolicy.canDeleteUserData === false, "private deployment entitlements must not delete user data");
  assert(privateDeploymentConfig.entitlementPolicy.canRemoveLocalSoftware === false, "private deployment entitlements must not remove local software");
  const auditExportRequest = createAuditExportRequest({
    subjects: ["invocation", "lifecycle", "quota", "usage", "ledger", "policy", "audit", "catalog", "bundle"],
    sinkId: "sink_self_check_immutable",
    dryRun: true
  });
  assert(auditExportRequest.status === "validated", "audit export dry run should validate with configured sink");
  assert(auditExportRequest.recordCounts.lifecycle >= 1, "audit export should count lifecycle evidence");
  assert(auditExportRequest.recordCounts.catalog >= 1, "audit export should count private catalog records");
  assert(auditExportRequest.recordCounts.bundle >= 1, "audit export should count signed bundle records");
  const exportedAuditRequest = createAuditExportRequest({
    subjects: ["lifecycle", "catalog", "bundle"],
    sinkId: "sink_self_check_immutable",
    dryRun: false
  });
  assert(exportedAuditRequest.status === "exported", "audit export should generate manifest when not a dry run");
  assert(exportedAuditRequest.manifest?.recordRefs.some((ref) => ref.subject === "catalog" && ref.id === catalogEntry.id), "audit export manifest should reference catalog records");
  assert(exportedAuditRequest.manifest?.recordRefs.some((ref) => ref.subject === "bundle" && ref.id === signedBundle.id), "audit export manifest should reference signed bundle records");
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
  await assertDirectHttpCancellation({
    cancelInvocation,
    createInvocation,
    findAgent,
    registerAgent,
    startInvocationIfAllowed,
    state,
  });

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
  assert(queuedCancel.cancellation.appliedAt === queuedCancel.completedAt, "queued cancellation should timestamp applied cancellation at completion");
  assert(state.events.some((item) => item.invocationId === queuedCancel.id && item.type === "cancel_applied" && item.message === queuedCancel.cancellation.message), "queued cancellation should expose its applied event message");

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

async function assertDirectHttpCancellation({
  cancelInvocation,
  createInvocation,
  findAgent,
  registerAgent,
  startInvocationIfAllowed,
  state,
}) {
  const serverState = {
    requestStarted: false,
    responseClosed: false,
  };
  let resolveRequestStarted = null;
  const requestStarted = new Promise((resolve) => {
    resolveRequestStarted = resolve;
  });
  const server = http.createServer((req, res) => {
    if (req.url !== "/invoke") {
      res.writeHead(404);
      res.end();
      return;
    }
    serverState.requestStarted = true;
    resolveRequestStarted();
    res.on("close", () => {
      serverState.responseClosed = true;
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : null;
    assert(port, "HTTP cancellation fixture should bind a local port");
    const directHttpAgent = registerAgent({
      id: "agt_self_http_cancel",
      type: "http",
      name: "Self-check HTTP cancellation",
      baseUrl: `http://127.0.0.1:${port}`,
      requestPath: "/invoke",
      timeoutSeconds: 30,
      cancellation: "supported"
    });
    const invocation = createInvocation("self-check direct HTTP cancellation", directHttpAgent, { timeoutSeconds: 30 });
    assert(invocation.status === "running", "direct HTTP invocation should start in running state");
    startInvocationIfAllowed(invocation, findAgent(directHttpAgent.id));
    // Generous bounds (10s): these gate a real localhost socket, so a loaded CI
    // machine can be slow to schedule — a tight 2s bound was the one residual
    // flake vector. The happy path returns in milliseconds regardless.
    await withTimeout(requestStarted, 10_000, "direct HTTP cancellation fixture should receive request");
    cancelInvocation(invocation);
    await waitFor(() => invocation.status === "cancelled", 10_000, "direct HTTP cancellation should complete as cancelled");
    const events = state.events.filter((item) => item.invocationId === invocation.id);
    assert(events.some((item) => item.type === "cancel_dispatched"), "direct HTTP cancellation should dispatch abort");
    assert(events.some((item) => item.type === "cancel_applied"), "direct HTTP cancellation should complete through invocation completion");
    assert(invocation.cancellation.state === "applied", "direct HTTP cancellation should mark cancellation applied");
    assert(serverState.requestStarted, "direct HTTP cancellation fixture should observe the request");
    assert(serverState.responseClosed, "direct HTTP cancellation should close the in-flight response");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function waitFor(predicate, timeoutMs, message) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
  ]);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
