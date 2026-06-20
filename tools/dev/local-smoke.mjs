import { spawn } from "node:child_process";
import http from "node:http";

const serverPort = 3211;
const httpAgentPort = 3212;
const serverUrl = `http://127.0.0.1:${serverPort}`;
const httpAgentUrl = `http://127.0.0.1:${httpAgentPort}`;
const children = [];
let httpAgentServer = null;

try {
  httpAgentServer = await startHttpAgent();
  start("server", process.execPath, ["apps/server/src/index.mjs"], {
    SERVER_PORT: String(serverPort)
  });

  await waitFor(async () => {
    const health = await request("GET", "/health");
    return health.status === "ok";
  }, "server health");

  const offlineCreated = await request("POST", "/api/invocations", {
    task: "Run the M0 offline queue smoke test."
  });
  const offlineInvocationId = offlineCreated.invocation.id;
  const queuedState = await request("GET", "/api/state");
  const queuedInvocation = queuedState.invocations.find((item) => item.id === offlineInvocationId);
  assert(queuedInvocation?.status === "queued", "offline invocation should be queued before bridge registration");
  assert(queuedInvocation?.delivery.state === "queued", "offline delivery should be queued before bridge registration");

  start("desktop", process.execPath, ["apps/desktop/src/index.mjs"], {
    BRIDGE_SERVER_URL: serverUrl,
    BRIDGE_POLL_INTERVAL_MS: "100",
    MYAGENTTOOL_CODEX_COMMAND: "fixture"
  });

  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    return state.device.status === "online" && state.agent.status === "available" && state.agents.length >= 1;
  }, "desktop bridge registration");

  const discoveryCreated = await request("POST", "/api/discovery", {
    scope: [
      "known_command_allowlist",
      "known_local_endpoint",
      "user_provided_path",
      "user_provided_endpoint",
      "bridge_managed_config"
    ],
    userProvidedPaths: ["demo-agent"],
    userProvidedEndpoints: [httpAgentUrl]
  });
  const discoveryRunId = discoveryCreated.discoveryRun.id;
  const discoveryState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const run = state.discoveryRuns.find((item) => item.id === discoveryRunId);
    return run?.status === "succeeded" ? state : false;
  }, "conservative agent discovery");
  const discoveryRun = discoveryState.discoveryRuns.find((item) => item.id === discoveryRunId);
  assert(discoveryRun.candidates.length >= 2, "discovery should return conservative candidates");
  assert(discoveryRun.candidates.some((item) => item.source === "known_command_allowlist"), "discovery should include known command allowlist candidate");
  assert(discoveryRun.candidates.some((item) => item.source === "user_provided_path"), "discovery should include user-provided CLI path candidate");
  assert(discoveryRun.candidates.some((item) => item.source === "user_provided_endpoint"), "discovery should include user-provided endpoint candidate");
  assert(discoveryRun.candidates.every((item) => item.registration.status === "candidate"), "discovery candidates should not auto-register");
  assert(!discoveryState.agents.some((agent) => agent.discovery?.runId === discoveryRunId), "discovery should not auto-register agents");

  const candidateToRegister = discoveryRun.candidates.find((item) => item.source === "known_command_allowlist") ?? discoveryRun.candidates[0];
  const registeredDiscovered = await request("POST", `/api/discovery/${discoveryRunId}/candidates/${candidateToRegister.id}/register`);
  assert(registeredDiscovered.agent.status === "disabled", "registered discovery candidate should stay disabled");
  assert(registeredDiscovered.candidate.registration.status === "registered", "registered discovery candidate should update candidate status");

  const codexDiscoveryCreated = await request("POST", "/api/discovery", {
    scope: ["user_provided_path"],
    userProvidedPaths: ["codex"]
  });
  const codexDiscoveryId = codexDiscoveryCreated.discoveryRun.id;
  const codexDiscoveryState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const run = state.discoveryRuns.find((item) => item.id === codexDiscoveryId);
    return run?.status === "succeeded" ? state : false;
  }, "explicit Codex CLI discovery");
  const codexRun = codexDiscoveryState.discoveryRuns.find((item) => item.id === codexDiscoveryId);
  const codexCandidate = codexRun.candidates.find((item) => item.adapter.command === "codex");
  assert(codexCandidate, "explicit Codex command should appear as a candidate");
  assert(codexCandidate.riskLevel === "high", "explicit Codex candidate should be high risk");
  assert(codexCandidate.riskTags.includes("shell_exec"), "explicit Codex candidate should include shell execution risk");
  assert(codexCandidate.riskTags.includes("repo_context"), "explicit Codex candidate should include repository context risk");
  assert(codexCandidate.adapter.args.includes("--json"), "explicit Codex candidate should use JSONL output");
  assert(codexCandidate.adapter.args.includes("read-only"), "explicit Codex candidate should default to read-only sandbox");
  assert(codexCandidate.adapter.outputFormat === "codex_jsonl", "explicit Codex candidate should mark Codex JSONL output");
  const registeredCodex = await request("POST", `/api/discovery/${codexDiscoveryId}/candidates/${codexCandidate.id}/register`);
  assert(registeredCodex.agent.status === "disabled", "registered Codex candidate should remain disabled");
  assert(registeredCodex.agent.adapter.outputFormat === "codex_jsonl", "registered Codex candidate should preserve JSONL output config");
  const codexRegisteredState = await request("GET", "/api/state");
  const registeredCodexAgent = codexRegisteredState.agents.find((item) => item.id === registeredCodex.agent.id);
  assert(registeredCodexAgent?.status === "disabled", "guided Codex entry should keep registered agent disabled");
  assert(registeredCodexAgent?.registrationNotes?.risk?.includes("Codex CLI"), "registered Codex agent should expose Codex review notes");
  const enabledCodexDiscovery = await request("POST", `/api/agents/${registeredCodex.agent.id}/enable`);
  assert(enabledCodexDiscovery.agent.status === "available", "explicitly enabled Codex discovery agent should become selectable");

  const codexDraftIntegration = await request("POST", "/api/integration-artifacts", {
    artifactType: "integration_plan",
    reviewState: "draft",
    generatedByAi: false,
    targetType: "cli",
    title: "Codex CLI Pilot Agent",
    description: "Connect Codex CLI for a read-only repository summary pilot.",
    command: "codex",
    cancellation: "supported",
    environmentNeeds: "Use existing local Codex authentication.",
    costOwner: "team_smoke_ops",
    economicModel: "unknown"
  });
  const codexGenerated = await request("POST", `/api/integration-artifacts/${codexDraftIntegration.artifact.id}/generate`);
  const codexAdapterArtifact = codexGenerated.artifacts.find((item) => item.artifactType === "adapter_config");
  assert(codexAdapterArtifact?.payload.adapterConfig.outputFormat === "codex_jsonl", "Codex adapter artifact should declare JSONL output");
  assert(codexAdapterArtifact.payload.adapterConfig.args.includes("--json"), "Codex adapter artifact should use JSONL args");
  assert(codexAdapterArtifact.payload.adapterConfig.args.includes("read-only"), "Codex adapter artifact should default to read-only sandbox");
  assert(codexAdapterArtifact.governance.riskTags.includes("repo_context"), "Codex adapter artifact should record repo context risk");
  const approvedCodexAdapter = await request("POST", `/api/integration-artifacts/${codexAdapterArtifact.id}/approve`);
  assert(approvedCodexAdapter.artifact.reviewState === "approved", "Codex adapter config should approve for probe");
  const codexProbeCreated = await request("POST", `/api/integration-artifacts/${codexAdapterArtifact.id}/probe`);
  assert(codexProbeCreated.probeRun.status === "queued", "Codex CLI probe should queue for Desktop Bridge");
  const codexProbeState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const probe = state.integrationProbeRuns.find((item) => item.id === codexProbeCreated.probeRun.id);
    return probe?.status === "succeeded" ? state : false;
  }, "restricted Codex CLI probe");
  const testedCodexArtifact = codexProbeState.integrationArtifacts.find((item) => item.id === codexAdapterArtifact.id);
  const codexProbe = codexProbeState.integrationProbeRuns.find((item) => item.id === codexProbeCreated.probeRun.id);
  assert(testedCodexArtifact.reviewState === "tested", "passing Codex probe should mark adapter config tested");
  assert(codexProbe.details.some((item) => item.includes("codex exec --help")), "Codex probe should only use help surface");
  const registeredCodexIntegration = await request("POST", `/api/integration-artifacts/${codexAdapterArtifact.id}/register`);
  assert(registeredCodexIntegration.agent.status === "disabled", "registered Codex integration should stay disabled");
  assert(registeredCodexIntegration.agent.adapter.outputFormat === "codex_jsonl", "registered Codex integration should preserve JSONL output");
  const enabledCodexIntegration = await request("POST", `/api/agents/${registeredCodexIntegration.agent.id}/enable`);
  assert(enabledCodexIntegration.agent.status === "available", "enabled Codex integration should become available while bridge is online");
  const codexApprovalRun = await request("POST", "/api/invocations", {
    task: "Summarize repository readiness without editing files.",
    agentId: registeredCodexIntegration.agent.id
  });
  assert(codexApprovalRun.invocation.status === "waiting_for_local_approval", "Codex invocation should require local approval before dispatch");
  await request("POST", `/api/approvals/${codexApprovalRun.invocation.approvalRequestId}/approve`);
  const codexFinalState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === codexApprovalRun.invocation.id);
    if (invocation?.status === "succeeded") {
      return state;
    }
    if (["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation?.status)) {
      throw new Error(`Codex fixture invocation ended unexpectedly: ${invocation.status}`);
    }
    return false;
  }, "approved Codex fixture invocation");
  const codexFinal = codexFinalState.invocations.find((item) => item.id === codexApprovalRun.invocation.id);
  const codexEvents = codexFinalState.events.filter((item) => item.invocationId === codexFinal.id);
  const codexAudit = codexFinalState.auditSummaries.find((item) => item.invocationId === codexFinal.id);
  assert(codexFinal.result?.summary?.includes("Codex"), "Codex fixture invocation should produce a Codex summary");
  assert(codexEvents.some((item) => item.type === "agent_output" && item.data?.source === "codex_jsonl"), "Codex fixture invocation should record JSONL evidence");
  assert(codexAudit?.permissionDecision === "allowed", "approved Codex fixture invocation should audit allowed permission");

  const codexCancelRun = await request("POST", "/api/invocations", {
    task: "Run a cancellable Codex fixture task.",
    agentId: registeredCodexIntegration.agent.id
  });
  await request("POST", `/api/approvals/${codexCancelRun.invocation.approvalRequestId}/approve`);
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === codexCancelRun.invocation.id);
    return invocation?.status === "running";
  }, "running Codex fixture invocation before cancellation");
  await request("POST", `/api/invocations/${codexCancelRun.invocation.id}/cancel`);
  const codexCancelState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === codexCancelRun.invocation.id);
    if (invocation?.status === "cancelled") {
      return state;
    }
    if (["failed", "succeeded", "timed_out", "expired"].includes(invocation?.status)) {
      throw new Error(`Codex fixture cancellation ended unexpectedly: ${invocation.status}`);
    }
    return false;
  }, "running Codex fixture cancellation");
  const codexCancelled = codexCancelState.invocations.find((item) => item.id === codexCancelRun.invocation.id);
  const codexCancelEvents = codexCancelState.events.filter((item) => item.invocationId === codexCancelRun.invocation.id);
  assert(codexCancelled.cancellation.state === "applied", "Codex fixture cancellation should be applied");
  assert(codexCancelEvents.some((item) => item.type === "cancel_dispatched"), "Codex fixture cancellation should dispatch to bridge");

  const draftIntegration = await request("POST", "/api/integration-artifacts", {
    artifactType: "integration_plan",
    reviewState: "draft",
    generatedByAi: false,
    targetType: "cli",
    title: "Smoke Integration Agent",
    description: "I have an unsupported CLI agent that accepts task JSON.",
    command: "demo-agent",
    cancellation: "supported",
    environmentNeeds: "No secrets required.",
    costOwner: "team_smoke_ops",
    economicModel: "unknown"
  });
  assert(draftIntegration.artifact.reviewState === "draft", "integration intake should create draft artifact");
  assert(draftIntegration.artifact.generatedByAi === false, "integration intake draft should not be AI-generated");
  assert(draftIntegration.artifact.payload.structuredHints.command === "demo-agent", "integration intake should keep command hint");

  const generatedIntegration = await request("POST", `/api/integration-artifacts/${draftIntegration.artifact.id}/generate`);
  const generatedArtifacts = generatedIntegration.artifacts;
  const adapterArtifact = generatedArtifacts.find((item) => item.artifactType === "adapter_config");
  assert(adapterArtifact?.generatedByAi === true, "adapter config should be marked generated by AI");
  assert(adapterArtifact.reviewState === "needs_review", "generated adapter config should need review");
  assert(generatedArtifacts.some((item) => item.artifactType === "schema"), "generated set should include schema");
  assert(generatedArtifacts.some((item) => item.artifactType === "redaction_policy"), "generated set should include redaction policy");
  assert(generatedArtifacts.some((item) => item.artifactType === "test_case"), "generated set should include test case");

  const approvedAdapter = await request("POST", `/api/integration-artifacts/${adapterArtifact.id}/approve`);
  assert(approvedAdapter.artifact.reviewState === "approved", "adapter config should approve for probe");
  const probeCreated = await request("POST", `/api/integration-artifacts/${adapterArtifact.id}/probe`);
  assert(probeCreated.probeRun.status === "queued", "CLI integration probe should queue for Desktop Bridge");
  const probeState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const probe = state.integrationProbeRuns.find((item) => item.id === probeCreated.probeRun.id);
    return probe?.status === "succeeded" ? state : false;
  }, "successful integration probe");
  const testedArtifact = probeState.integrationArtifacts.find((item) => item.id === adapterArtifact.id);
  assert(testedArtifact.reviewState === "tested", "passing probe should mark adapter config tested");
  const registeredIntegration = await request("POST", `/api/integration-artifacts/${adapterArtifact.id}/register`);
  assert(registeredIntegration.agent.status === "disabled", "registered integration agent should stay disabled");
  assert(registeredIntegration.artifact.reviewState === "enabled", "explicit registration should record enabled artifact state");
  assert(probeState.quotaDecisionRecords.some((item) => item.artifactId === draftIntegration.artifact.id), "integration flow should record quota decision");

  const builderDraft = await request("POST", "/api/integration-builder/draft", {
    targetType: "http",
    description: "I have an unsupported HTTP agent for smoke testing.",
    baseUrl: httpAgentUrl,
    cancellation: "supported",
    costOwner: "team_smoke_ops",
    economicModel: "external_billed"
  });
  assert(builderDraft.artifact.generatedByAi === true, "platform Integration Builder should mark draft as AI-generated");
  assert(builderDraft.artifact.reviewState === "draft", "platform Integration Builder should only draft");
  assert(builderDraft.invocation.agentId === "agt_platform_integration_builder", "platform Integration Builder should use platform agent invocation path");
  const builderState = await request("GET", "/api/state");
  assert(builderState.agents.some((item) => item.id === "agt_platform_integration_builder"), "Integration Builder platform agent should be registered");
  assert(builderState.auditSummaries.some((item) => item.agentId === "agt_platform_integration_builder"), "Integration Builder platform agent should write audit");

  const retentionUpdated = await request("PATCH", "/api/integration-retention", {
    logsDays: 7,
    promptsDays: 14,
    responsesDays: 14,
    artifactsDays: 60
  });
  assert(retentionUpdated.retentionSettings.logsDays === 7, "retention settings should update logs days");
  assert(retentionUpdated.retentionSettings.artifactsDays === 60, "retention settings should update artifact days");

  const registeredCli = await request("POST", "/api/agents", {
    id: "agt_smoke_cli",
    type: "cli",
    name: "Smoke CLI Agent",
    command: "demo-agent",
    args: ["{{payloadJson}}"],
    timeoutSeconds: 30,
    costOwner: "team_smoke_ops"
  });
  assert(registeredCli.agent.adapter.command === "demo-agent", "registered CLI agent should keep command");
  assert(registeredCli.agent.adapter.args[0] === "{{payloadJson}}", "registered CLI agent should keep structured argv");
  assert(registeredCli.agent.economics.costOwner === "team_smoke_ops", "registered CLI agent should keep cost owner metadata");

  const registeredHttp = await request("POST", "/api/agents", {
    id: "agt_smoke_http",
    type: "http",
    name: "Smoke HTTP Agent",
    baseUrl: httpAgentUrl,
    requestPath: "/invoke",
    healthPath: "/health",
    timeoutSeconds: 5,
    cancellation: "supported"
  });
  assert(registeredHttp.agent.adapter.baseUrl === httpAgentUrl, "registered HTTP agent should keep baseUrl");

  const registeredRisky = await request("POST", "/api/agents", {
    id: "agt_smoke_risky",
    type: "cli",
    name: "Smoke High Risk CLI Agent",
    command: "demo-agent",
    args: ["{{payloadJson}}"],
    timeoutSeconds: 30,
    riskLevel: "high",
    riskTags: ["read_local", "shell_exec", "destructive"]
  });
  assert(registeredRisky.agent.capabilities[0].riskLevel === "high", "registered high-risk agent should keep risk level");
  assert(registeredRisky.agent.capabilities[0].riskTags.includes("destructive"), "registered high-risk agent should keep risk tags");

  await request("POST", "/api/agents/agt_smoke_cli/health-check");
  const cliHealthState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const agent = state.agents.find((item) => item.id === "agt_smoke_cli");
    return agent?.health?.status === "healthy" ? state : false;
  }, "healthy CLI agent check");
  assert(cliHealthState.lifecycleAuditRecords.some((item) => item.agentId === "agt_smoke_cli" && item.operation === "health_check" && item.status === "succeeded"), "CLI health check should record lifecycle audit");

  await request("POST", "/api/agents/agt_smoke_http/health-check");
  const httpHealthState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const agent = state.agents.find((item) => item.id === "agt_smoke_http");
    return agent?.health?.status === "healthy" ? state : false;
  }, "healthy HTTP agent check");
  assert(httpHealthState.lifecycleAuditRecords.some((item) => item.agentId === "agt_smoke_http" && item.operation === "health_check" && item.status === "succeeded"), "HTTP health check should record lifecycle audit");

  const disabled = await request("POST", "/api/agents/agt_smoke_cli/disable");
  assert(disabled.agent.status === "disabled", "disabled agent should report disabled");
  assert(disabled.operation.status === "succeeded", "disable operation should succeed");

  const disabledRun = await requestAllowError("POST", "/api/invocations", {
    task: "This should not run while disabled.",
    agentId: "agt_smoke_cli"
  });
  assert(disabledRun.status === 409 && disabledRun.data.error === "agent_disabled", "disabled agent should block new invocations");

  const enabled = await request("POST", "/api/agents/agt_smoke_cli/enable");
  assert(enabled.agent.status === "available", "enabled online CLI agent should become available");
  assert(enabled.operation.status === "succeeded", "enable operation should succeed");

  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === offlineInvocationId);
    if (invocation?.status === "succeeded") {
      return state;
    }
    if (["failed", "cancelled", "timed_out", "expired"].includes(invocation?.status)) {
      throw new Error(`Offline invocation ended unexpectedly: ${invocation.status}`);
    }
    return false;
  }, "offline queued invocation dispatch after reconnect");

  const created = await request("POST", "/api/invocations", {
    task: "Run the M0 local smoke test.",
    agentId: "agt_smoke_cli"
  });
  const invocationId = created.invocation.id;

  const finalState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === invocationId);
    if (invocation?.status === "succeeded") {
      return state;
    }
    if (["failed", "cancelled", "timed_out", "expired"].includes(invocation?.status)) {
      throw new Error(`Invocation ended unexpectedly: ${invocation.status}`);
    }
    return false;
  }, "successful invocation");

  const invocation = finalState.invocations.find((item) => item.id === invocationId);
  const audit = finalState.auditSummaries.find((item) => item.invocationId === invocationId);
  const logEvents = finalState.events.filter((item) => item.invocationId === invocationId && item.type === "log");
  const trace = finalState.traces.find((item) => item.id === invocation.traceId);
  const span = finalState.spans.find((item) => item.id === invocation.rootSpanId);

  assert(invocation.result?.touchedUserFiles === false, "demo agent must not touch user files");
  assert(invocation.delivery.state === "acknowledged", "expected acknowledged delivery");
  assert(invocation.delivery.dispatchAttempts >= 1, "expected dispatch attempts");
  assert(logEvents.length >= 5, "expected progress log events");
  assert(audit?.permissionDecision === "allowed", "expected allowed audit summary");
  assert(audit?.traceId === invocation.traceId, "expected audit summary to reference trace");
  assert(trace?.subjectId === invocationId, "expected invocation trace");
  assert(span?.status === "succeeded", "expected completed root span");
  assert(audit?.costSummary?.includes("unknown"), "expected unknown cost summary");

  const riskyCreated = await request("POST", "/api/invocations", {
    task: "Run the high-risk local approval smoke test.",
    agentId: "agt_smoke_risky"
  });
  const riskyInvocationId = riskyCreated.invocation.id;
  const riskyApprovalId = riskyCreated.invocation.approvalRequestId;
  assert(riskyCreated.invocation.status === "waiting_for_local_approval", "high-risk invocation should wait for approval");
  assert(riskyApprovalId, "high-risk invocation should include approval request id");
  await sleep(350);
  const riskyWaitingState = await request("GET", "/api/state");
  const riskyWaiting = riskyWaitingState.invocations.find((item) => item.id === riskyInvocationId);
  const riskyApproval = riskyWaitingState.approvalRequests.find((item) => item.id === riskyApprovalId);
  const riskyPolicy = riskyWaitingState.policyDecisionRecords.find((item) => item.id === riskyWaiting.policyDecisionId);
  assert(riskyWaiting.status === "waiting_for_local_approval", "high-risk invocation should not dispatch before approval");
  assert(riskyApproval?.status === "pending", "approval request should stay pending before decision");
  assert(riskyApproval.summary.risk && riskyApproval.summary.data && riskyApproval.summary.cost && riskyApproval.summary.cancellation, "approval request should include plain-language summary");
  assert(riskyPolicy?.decision === "requires_local_approval", "policy decision should require local approval");
  assert(riskyPolicy.riskTags.includes("destructive"), "policy decision should record risk tags");

  await request("POST", `/api/approvals/${riskyApprovalId}/approve`);
  const riskyFinalState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === riskyInvocationId);
    if (invocation?.status === "succeeded") {
      return state;
    }
    if (["failed", "cancelled", "timed_out", "expired", "rejected"].includes(invocation?.status)) {
      throw new Error(`High-risk approved invocation ended unexpectedly: ${invocation.status}`);
    }
    return false;
  }, "approved high-risk invocation");
  const riskyFinal = riskyFinalState.invocations.find((item) => item.id === riskyInvocationId);
  const approvedRequest = riskyFinalState.approvalRequests.find((item) => item.id === riskyApprovalId);
  assert(approvedRequest?.status === "approved", "approval request should be approved");
  assert(riskyFinal.delivery.dispatchAttempts >= 1, "approved high-risk invocation should dispatch");
  assert(riskyFinalState.events.some((item) => item.invocationId === riskyInvocationId && item.type === "local_approval_granted"), "approved high-risk invocation should emit granted event");

  const deniedCreated = await request("POST", "/api/invocations", {
    task: "Run the high-risk local approval denial smoke test.",
    agentId: "agt_smoke_risky"
  });
  const deniedInvocationId = deniedCreated.invocation.id;
  const deniedApprovalId = deniedCreated.invocation.approvalRequestId;
  await request("POST", `/api/approvals/${deniedApprovalId}/deny`);
  const deniedState = await request("GET", "/api/state");
  const deniedInvocation = deniedState.invocations.find((item) => item.id === deniedInvocationId);
  const deniedRequest = deniedState.approvalRequests.find((item) => item.id === deniedApprovalId);
  const deniedAudit = deniedState.auditSummaries.find((item) => item.invocationId === deniedInvocationId);
  assert(deniedRequest?.status === "denied", "approval request should be denied");
  assert(deniedInvocation?.status === "rejected", "denied high-risk invocation should be rejected");
  assert(deniedInvocation.delivery.dispatchAttempts === 0, "denied high-risk invocation should not dispatch");
  assert(deniedAudit?.permissionDecision === "denied", "denied high-risk invocation should audit denied permission");
  assert(deniedState.events.some((item) => item.invocationId === deniedInvocationId && item.type === "local_approval_denied"), "denied high-risk invocation should emit denied event");

  const httpCreated = await request("POST", "/api/invocations", {
    task: "Run the M0 HTTP smoke test.",
    agentId: "agt_smoke_http"
  });
  const httpInvocationId = httpCreated.invocation.id;
  const httpFinalState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === httpInvocationId);
    if (invocation?.status === "succeeded") {
      return state;
    }
    if (["failed", "cancelled", "timed_out", "expired"].includes(invocation?.status)) {
      throw new Error(`HTTP invocation ended unexpectedly: ${invocation.status}`);
    }
    return false;
  }, "successful HTTP invocation");
  const httpInvocation = httpFinalState.invocations.find((item) => item.id === httpInvocationId);
  assert(httpInvocation.delivery.state === "not_required", "HTTP agent should not require bridge delivery");
  assert(httpInvocation.result?.summary?.includes("HTTP Agent completed"), "HTTP agent should return result summary");

  const httpFailureCreated = await request("POST", "/api/invocations", {
    task: "fail-http",
    agentId: "agt_smoke_http"
  });
  const httpFailureInvocationId = httpFailureCreated.invocation.id;
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === httpFailureInvocationId);
    return invocation?.status === "failed" ? state : false;
  }, "failed HTTP invocation");
  const troubleshootCreated = await request("POST", `/api/invocations/${httpFailureInvocationId}/troubleshoot`);
  assert(troubleshootCreated.report.invocationId === httpFailureInvocationId, "troubleshooter should target failed invocation");
  assert(troubleshootCreated.report.adapterError?.includes("HTTP Agent failed"), "troubleshooter should summarize HTTP failure");
  assert(troubleshootCreated.report.remediationRequiresApproval === true, "troubleshooter remediation should require approval");
  const troubleshootingState = await request("GET", "/api/state");
  const platformInvocation = troubleshootingState.invocations.find((item) => item.agentId === "agt_platform_troubleshooter" && item.status === "succeeded");
  const platformAudit = troubleshootingState.auditSummaries.find((item) => item.agentId === "agt_platform_troubleshooter");
  assert(platformInvocation, "troubleshooter should use normal invocation path");
  assert(platformAudit, "troubleshooter should record audit");
  assert(troubleshootingState.troubleshootingReports.some((item) => item.invocationId === httpFailureInvocationId), "troubleshooter report should be visible in state");
  assert(troubleshootingState.agentUsageSummaries.find((item) => item.agentId === "agt_smoke_cli")?.costOwner === "team_smoke_ops", "usage summary should expose cost owner");
  assert(troubleshootingState.agentUsageSummaries.find((item) => item.agentId === "agt_smoke_cli")?.succeededCount >= 1, "CLI usage should count successful invocations");
  assert(troubleshootingState.agentUsageSummaries.find((item) => item.agentId === "agt_smoke_http")?.failedCount >= 1, "HTTP usage should count failed invocation");
  assert(troubleshootingState.agentUsageSummaries.find((item) => item.agentId === "agt_platform_troubleshooter")?.succeededCount >= 1, "platform agent usage should be counted");

  const cancelCreated = await request("POST", "/api/invocations", {
    task: "Run the M0 cancellation smoke test.",
    agentId: "agt_smoke_cli"
  });
  const cancelInvocationId = cancelCreated.invocation.id;
  await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === cancelInvocationId);
    return invocation?.status === "running";
  }, "running invocation before cancellation");
  await request("POST", `/api/invocations/${cancelInvocationId}/cancel`);
  const cancelledState = await waitFor(async () => {
    const state = await request("GET", "/api/state");
    const invocation = state.invocations.find((item) => item.id === cancelInvocationId);
    if (invocation?.status === "cancelled") {
      return state;
    }
    if (["failed", "succeeded", "timed_out", "expired"].includes(invocation?.status)) {
      throw new Error(`Cancellation invocation ended unexpectedly: ${invocation.status}`);
    }
    return false;
  }, "running CLI cancellation");
  const cancelledInvocation = cancelledState.invocations.find((item) => item.id === cancelInvocationId);
  const cancelEvents = cancelledState.events.filter((item) => item.invocationId === cancelInvocationId);
  assert(cancelledInvocation.cancellation.state === "applied", "running cancellation should be applied");
  assert(cancelEvents.some((item) => item.type === "cancel_dispatched"), "running cancellation should dispatch to bridge");
  assert(cancelEvents.some((item) => item.type === "cancel_applied"), "running cancellation should be visible as applied");

  console.log("[smoke] M0 local invocation loop OK");
  console.log(`[smoke] offlineInvocation=${offlineInvocationId} cliInvocation=${invocationId} riskyInvocation=${riskyInvocationId} deniedInvocation=${deniedInvocationId} httpInvocation=${httpInvocationId} cancelledInvocation=${cancelInvocationId} logs=${logEvents.length} status=${invocation.status}`);
} finally {
  stopChildren();
  if (httpAgentServer) {
    await new Promise((resolve) => httpAgentServer.close(resolve));
  }
}

function startHttpAgent() {
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", message: "Smoke HTTP Agent healthy." }));
      return;
    }

    if (req.method !== "POST" || req.url !== "/invoke") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const body = await readRequestJson(req);
    if (body.task === "fail-http") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ summary: "HTTP Agent failed by request." }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      summary: `HTTP Agent completed: ${body.task}`,
      touchedUserFiles: false,
      cost: { model: "unknown", billable: false }
    }));
  });

  return new Promise((resolve) => {
    server.listen(httpAgentPort, "127.0.0.1", () => resolve(server));
  });
}

function start(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);
  child.stdout.on("data", (chunk) => prefix(name, chunk));
  child.stderr.on("data", (chunk) => prefix(name, chunk));
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
  });
}

async function waitFor(check, label) {
  let lastError = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const result = await check();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError?.message ?? "no result"}`);
}

async function request(method, path, body) {
  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.status === 204) {
    return null;
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${JSON.stringify(data)}`);
  }
  return data;
}

async function requestAllowError(method, path, body) {
  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data };
}

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function prefix(name, chunk) {
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    if (line.trim()) {
      console.log(`[${name}] ${line}`);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopChildren() {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}
