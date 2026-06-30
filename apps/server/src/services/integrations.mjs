import {
  cancellationTextForAdapter,
  defaultRiskTags,
  isAgentDisabled,
  isCodexCliCommand,
  normalizeEconomicModel,
  normalizeRiskLevel,
  normalizeRiskTags,
  normalizeUnknownCostPolicy,
} from "./agents.mjs";
import { createIntegrationArtifactRuntime } from "./integrations/artifacts.mjs";
import { createDiscoveryRuntime } from "./integrations/discovery.mjs";
import {
  adapterFromArtifact,
  dataNotesForIntegration,
  normalizeRetentionDays,
  suggestedAgentId,
} from "./integrations/helpers.mjs";
import { createIntegrationProbeRuntime } from "./integrations/probes.mjs";

export function createIntegrationService({
  state,
  now,
  nextId,
  appendEvent,
  completeInvocation,
  createInvocation,
  disableAgent,
  findAgent,
  registerAgent,
}) {
  const {
    completeDiscoveryRun,
    createDiscoveryRun,
    findDiscoveryRun,
    markDiscoveryStarted,
    nextBridgeDiscoveryRun,
    registerDiscoveredCandidate,
  } = createDiscoveryRuntime({
    state,
    now,
    nextId,
    appendEvent,
    disableAgent,
    registerAgent,
  });

  const {
    createIntegrationArtifact,
    findIntegrationArtifact,
    generateIntegrationArtifacts,
    transitionIntegrationArtifact,
  } = createIntegrationArtifactRuntime({
    state,
    now,
    nextId,
    appendEvent,
    buildIntegrationGovernance,
    recordQuotaDecision,
  });

  const {
    completeIntegrationProbeRun,
    createIntegrationProbeRun,
    findIntegrationProbeRun,
    markIntegrationProbeStarted,
    nextBridgeProbeRun,
  } = createIntegrationProbeRuntime({
    state,
    now,
    nextId,
    appendEvent,
    findIntegrationArtifact,
  });

  function registerIntegrationArtifact(artifact) {
    if (artifact.artifactType !== "adapter_config") {
      throw new Error("Only adapter config artifacts can register an agent.");
    }
    if (artifact.reviewState !== "tested") {
      throw new Error("Run and pass a probe before registering this integration.");
    }
    const adapter = adapterFromArtifact(artifact);
    const agent = registerAgent({
      id: suggestedAgentId(artifact),
      type: adapter.type,
      name: artifact.payload?.title ?? "Generated Integration Agent",
      description: artifact.payload?.description ?? artifact.summary,
      command: adapter.type === "cli" ? adapter.command : undefined,
      args: adapter.type === "cli" ? adapter.args : undefined,
      outputFormat: adapter.type === "cli" ? adapter.outputFormat : undefined,
      sandbox: adapter.type === "cli" ? adapter.sandbox : undefined,
      baseUrl: adapter.type === "http" ? adapter.baseUrl : undefined,
      requestPath: adapter.type === "http" ? adapter.requestPath : undefined,
      healthPath: adapter.type === "http" ? adapter.healthPath : undefined,
      timeoutSeconds: adapter.timeoutSeconds,
      cancellation: adapter.cancellation,
      riskLevel: artifact.governance?.riskLevel ?? "medium",
      riskTags: artifact.governance?.riskTags ?? defaultRiskTags(adapter.type),
      economicModel: artifact.governance?.economics?.model ?? "unknown",
      costOwner: artifact.governance?.economics?.costOwner ?? "usr_local",
      unknownCostPolicy: artifact.governance?.economics?.unknownCostPolicy ?? "warn",
    });
    agent.registrationNotes = {
      risk: artifact.payload?.riskNotes ?? "Generated integration requires review before use.",
      data: artifact.payload?.dataNotes ?? dataNotesForIntegration(adapter.type),
      cost: artifact.payload?.costNotes ?? "Cost is unknown.",
      cancellation: artifact.payload?.cancellationNotes ?? cancellationTextForAdapter(adapter),
    };
    agent.integrationArtifactId = artifact.id;
    if (!isCodexCliCommand(agent.adapter?.command)) {
      disableAgent(agent);
    }
    artifact.reviewState = "enabled";
    artifact.enabledAgentId = agent.id;
    artifact.updatedAt = now();
    appendEvent({
      invocationId: null,
      type: "integration_enabled",
      level: "info",
      message: isCodexCliCommand(agent.adapter?.command)
        ? `${agent.name} registered from tested artifact and is available through Codex CLI native controls.`
        : `${agent.name} registered from tested artifact and left disabled.`,
      data: { artifactId: artifact.id, agentId: agent.id, disabled: isAgentDisabled(agent) },
    });
    return agent;
  }

  function updateIntegrationRetentionSettings(body = {}) {
    state.retentionSettings = {
      ...state.retentionSettings,
      logsDays: normalizeRetentionDays(body.logsDays, state.retentionSettings.logsDays),
      promptsDays: normalizeRetentionDays(body.promptsDays, state.retentionSettings.promptsDays),
      responsesDays: normalizeRetentionDays(body.responsesDays, state.retentionSettings.responsesDays),
      artifactsDays: normalizeRetentionDays(body.artifactsDays, state.retentionSettings.artifactsDays),
      updatedAt: now(),
    };
    appendEvent({
      invocationId: null,
      type: "integration_reviewed",
      level: "info",
      message: "Integration data retention settings updated.",
      data: state.retentionSettings,
    });
    return state.retentionSettings;
  }

  function draftIntegrationWithPlatformAgent(body = {}) {
    const platformAgent = findAgent("agt_platform_integration_builder");
    if (!platformAgent) {
      throw new Error("Integration Builder platform agent is not registered.");
    }
    const description = String(body.description ?? body.intent ?? "").trim();
    if (!description) {
      throw new Error("Integration intent is required.");
    }
    const platformInvocation = createInvocation(`Draft integration plan: ${description}`, platformAgent, {
      metadata: { integrationBuilder: true, advisoryOnly: true },
    });
    appendEvent({
      invocationId: platformInvocation.id,
      type: "platform_agent_started",
      level: "info",
      message: "Integration Builder started an advisory draft.",
      data: { advisoryOnly: true },
    });
    const artifact = createIntegrationArtifact({
      ...body,
      artifactType: "integration_plan",
      reviewState: "draft",
      generatedByAi: true,
      description,
      summary: "Integration Builder draft plan",
    });
    appendEvent({
      invocationId: platformInvocation.id,
      type: "platform_agent_recommended",
      level: "info",
      message: "Integration Builder drafted a reviewable plan. It cannot enable the integration.",
      data: { artifactId: artifact.id, advisoryOnly: true },
    });
    appendEvent({
      invocationId: platformInvocation.id,
      type: "platform_agent_action_requested",
      level: "info",
      message: "Review, approve, probe, and registration remain explicit user actions.",
      data: { artifactId: artifact.id },
    });
    completeInvocation(platformInvocation, {
      status: "succeeded",
      summary: "Integration Builder drafted a reviewable integration plan.",
      result: {
        summary: "Integration Builder drafted a reviewable integration plan.",
        output: { artifactId: artifact.id, advisoryOnly: true },
        touchedUserFiles: false,
        cost: { model: platformAgent.economics.model, billable: false },
      },
    });
    return { invocation: platformInvocation, artifact };
  }

  function buildIntegrationGovernance(body, payload) {
    const targetType = payload.adapterConfig?.type ?? body.targetType ?? "cli";
    const command = payload.adapterConfig?.command ?? body.command ?? body.adapter?.command;
    return {
      riskLevel: normalizeRiskLevel(body.riskLevel, targetType === "cli" ? "high" : "medium"),
      riskTags: normalizeRiskTags(body.riskTags, defaultRiskTags(targetType, command)),
      economics: {
        model: normalizeEconomicModel(body.economicModel ?? body.economics?.model, "unknown"),
        costOwner: String(body.costOwner ?? body.economics?.costOwner ?? "usr_local"),
        currency: String(body.currency ?? body.economics?.currency ?? "USD"),
        unknownCostPolicy: normalizeUnknownCostPolicy(body.unknownCostPolicy ?? body.economics?.unknownCostPolicy, "warn"),
      },
      quota: {
        decision: "record_only",
        limit: Number(body.quotaLimit ?? 0),
        period: String(body.quotaPeriod ?? "unset"),
        enforcement: "placeholder",
      },
      retention: { ...state.retentionSettings },
      platformAgentAdvisoryOnly: true,
    };
  }

  function recordQuotaDecision(artifact, action) {
    const record = {
      id: nextId("qtd_demo"),
      artifactId: artifact.id,
      action,
      decision: "record_only",
      reason: "M2 records quota decisions without enterprise policy enforcement.",
      createdAt: now(),
    };
    state.quotaDecisionRecords.unshift(record);
    state.quotaDecisionRecords = state.quotaDecisionRecords.slice(0, 100);
    appendEvent({
      invocationId: null,
      type: "quota_checked",
      level: "info",
      message: "Quota decision recorded for integration artifact.",
      data: record,
    });
    return record;
  }

  return {
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
  };
}
