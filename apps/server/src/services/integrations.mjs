import {
  cancellationTextForAdapter,
  codexCliArgs,
  defaultRiskTags,
  isAgentDisabled,
  isCodexCliCommand,
  normalizeCliOutputFormat,
  normalizeEconomicModel,
  normalizeRiskLevel,
  normalizeRiskTags,
  normalizeStringArray,
  normalizeUnknownCostPolicy,
} from "./agents.mjs";
import { createDiscoveryRuntime } from "./integrations/discovery.mjs";
import {
  adapterGuidance,
  buildAdapterConfig,
  cancellationNotesForIntegration,
  costNotesForIntegration,
  dataNotesForIntegration,
  guessAdapterType,
  integrationArtifactSummary,
  normalizeCancellation,
  normalizeIntegrationArtifactType,
  normalizeIntegrationReviewState,
  normalizeRetentionDays,
  normalizeTargetType,
  riskNotesForIntegration,
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
    adapterFromArtifact,
    findIntegrationArtifact,
  });

  function createIntegrationArtifact(body = {}) {
    const targetType = normalizeTargetType(body.targetType ?? body.adapterType ?? guessAdapterType(body));
    const artifactType = normalizeIntegrationArtifactType(body.artifactType ?? "integration_plan");
    const reviewState = normalizeIntegrationReviewState(body.reviewState ?? (artifactType === "integration_plan" ? "draft" : "generated"), artifactType === "integration_plan" ? "draft" : "generated");
    const createdAt = now();
    const payload = buildIntegrationArtifactPayload({
      ...body,
      targetType,
      artifactType,
    });
    const artifact = {
      id: nextId("itg_demo"),
      requestedBy: "usr_local",
      targetType,
      artifactType,
      reviewState,
      generatedByAi: Boolean(body.generatedByAi ?? artifactType !== "integration_plan"),
      summary: String(body.summary ?? integrationArtifactSummary(artifactType, targetType, payload)),
      sourceArtifactId: body.sourceArtifactId ?? null,
      payload,
      governance: buildIntegrationGovernance(body, payload),
      createdAt,
      updatedAt: createdAt,
    };
    state.integrationArtifacts.unshift(artifact);
    state.integrationArtifacts = state.integrationArtifacts.slice(0, 100);
    recordQuotaDecision(artifact, "create_artifact");
    appendEvent({
      invocationId: null,
      type: artifactType === "integration_plan" ? "artifact_created" : "integration_generated",
      level: "info",
      message: `${artifact.summary} It is reviewable and not enabled.`,
      data: { artifactId: artifact.id, artifactType: artifact.artifactType, reviewState: artifact.reviewState },
    });
    return artifact;
  }

  function buildIntegrationArtifactPayload(body) {
    const targetType = body.targetType;
    const description = String(body.description ?? body.intent ?? "").trim();
    const command = String(body.command ?? body.adapter?.command ?? "").trim();
    const baseUrl = String(body.baseUrl ?? body.url ?? body.adapter?.baseUrl ?? "").trim();
    const requestPath = String(body.requestPath ?? body.adapter?.requestPath ?? "/invoke").trim() || "/invoke";
    const healthPath = String(body.healthPath ?? body.adapter?.healthPath ?? "/health").trim() || "/health";
    const args = normalizeStringArray(body.args).length > 0
      ? normalizeStringArray(body.args)
      : isCodexCliCommand(command)
        ? codexCliArgs()
        : command
          ? ["{{payloadJson}}"]
          : [];
    const payload = {
      title: String(body.title ?? body.name ?? "Unsupported agent integration"),
      description: description || "User described an unsupported agent for integration.",
      adapterGuidance: adapterGuidance(targetType),
      structuredHints: {
        command,
        baseUrl,
        requestPath,
        healthPath,
        workingDirectory: String(body.workingDirectory ?? "").trim(),
        environmentNeeds: String(body.environmentNeeds ?? "").trim(),
        outputFormat: normalizeCliOutputFormat(body.outputFormat ?? body.adapter?.outputFormat, command),
        sandbox: body.sandbox ?? body.adapter?.sandbox ?? null,
        streaming: Boolean(body.streaming ?? false),
        cancellation: normalizeCancellation(body.cancellation),
        args,
      },
      adapterConfig: buildAdapterConfig(targetType, {
        command,
        args,
        workingDirectory: String(body.workingDirectory ?? "").trim(),
        baseUrl,
        requestPath,
        healthPath,
        streaming: Boolean(body.streaming ?? false),
        cancellation: normalizeCancellation(body.cancellation),
        timeoutSeconds: body.timeoutSeconds === undefined ? undefined : Number(body.timeoutSeconds),
        outputFormat: body.outputFormat ?? body.adapter?.outputFormat,
        sandbox: body.sandbox ?? body.adapter?.sandbox,
      }),
      riskNotes: riskNotesForIntegration(targetType, body),
      dataNotes: dataNotesForIntegration(targetType),
      costNotes: costNotesForIntegration(body),
      cancellationNotes: cancellationNotesForIntegration(body),
      probe: {
        explicitUserActionRequired: true,
        installScriptsAllowed: false,
        broadScanningAllowed: false,
        summary: "Probe can be run only after explicit review action.",
      },
    };
    if (body.artifactType === "schema") {
      payload.schema = {
        input: { task: "string" },
        output: { summary: "string", touchedUserFiles: "boolean", cost: "object?" },
      };
    }
    if (body.artifactType === "redaction_policy") {
      payload.redactionPolicy = {
        redactPatterns: ["api_key", "authorization", "password", "secret", "token"],
        appliesTo: ["logs", "prompts", "responses", "generated_artifacts"],
      };
    }
    if (body.artifactType === "test_case") {
      payload.testCase = {
        name: "basic safe task",
        input: { task: "Say hello and report readiness." },
        expected: ["non-empty summary", "no install scripts", "no automatic enablement"],
      };
    }
    if (body.artifactType === "health_check") {
      payload.healthCheck = targetType === "http"
        ? { method: "GET", path: healthPath, timeoutSeconds: Number(body.timeoutSeconds ?? 30) }
        : { command, args: ["--version"], timeoutSeconds: Number(body.timeoutSeconds ?? 30), shell: false };
    }
    return payload;
  }

  function generateIntegrationArtifacts(sourceArtifact) {
    if (!sourceArtifact || sourceArtifact.artifactType !== "integration_plan") {
      throw new Error("Only integration plan drafts can generate artifact sets.");
    }
    if (sourceArtifact.reviewState === "archived" || sourceArtifact.reviewState === "rejected") {
      throw new Error("Archived or rejected plans cannot generate artifacts.");
    }
    const hints = sourceArtifact.payload?.structuredHints ?? {};
    const generatedSpecs = [
      ["adapter_config", "needs_review"],
      ["health_check", "needs_review"],
      ["schema", "needs_review"],
      ["redaction_policy", "needs_review"],
      ["test_case", "needs_review"],
    ];
    const generated = generatedSpecs.map(([artifactType, reviewState]) => createIntegrationArtifact({
      artifactType,
      reviewState,
      targetType: sourceArtifact.targetType,
      generatedByAi: true,
      sourceArtifactId: sourceArtifact.id,
      title: sourceArtifact.payload?.title,
      description: sourceArtifact.payload?.description,
      command: hints.command,
      args: hints.args,
      baseUrl: hints.baseUrl,
      requestPath: hints.requestPath,
      healthPath: hints.healthPath,
      workingDirectory: hints.workingDirectory,
      environmentNeeds: hints.environmentNeeds,
      streaming: hints.streaming,
      cancellation: hints.cancellation,
      economicModel: sourceArtifact.governance?.economics?.model,
      costOwner: sourceArtifact.governance?.economics?.costOwner,
      unknownCostPolicy: sourceArtifact.governance?.economics?.unknownCostPolicy,
    }));
    sourceArtifact.reviewState = "generated";
    sourceArtifact.updatedAt = now();
    appendEvent({
      invocationId: null,
      type: "integration_generated",
      level: "info",
      message: `Generated ${generated.length} reviewable integration artifact(s) from ${sourceArtifact.id}.`,
      data: { sourceArtifactId: sourceArtifact.id, artifactIds: generated.map((item) => item.id) },
    });
    return generated;
  }

  function transitionIntegrationArtifact(artifact, action) {
    const nextState = {
      approve: "approved",
      reject: "rejected",
      archive: "archived",
      review: "needs_review",
    }[action];
    if (!nextState) {
      throw new Error(`Unsupported artifact action: ${action}`);
    }
    artifact.reviewState = nextState;
    artifact.updatedAt = now();
    appendEvent({
      invocationId: null,
      type: "integration_reviewed",
      level: nextState === "rejected" ? "warn" : "info",
      message: `${artifact.summary} moved to ${nextState}. No integration was enabled automatically.`,
      data: { artifactId: artifact.id, reviewState: nextState },
    });
    return artifact;
  }

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

  function adapterFromArtifact(artifact) {
    const adapter = artifact.payload?.adapterConfig;
    if (adapter?.type === "http") {
      return {
        type: "http",
        baseUrl: String(adapter.baseUrl ?? "http://127.0.0.1:3212"),
        authMode: "none",
        requestPath: String(adapter.requestPath ?? "/invoke"),
        healthPath: String(adapter.healthPath ?? "/health"),
        method: "POST",
        payloadShape: { task: "string" },
        timeoutSeconds: Number(adapter.timeoutSeconds ?? 30),
        streaming: Boolean(adapter.streaming ?? false),
        cancellation: normalizeCancellation(adapter.cancellation),
      };
    }
    return {
      type: "cli",
      command: String(adapter?.command ?? artifact.payload?.structuredHints?.command ?? "demo-agent"),
      args: normalizeStringArray(adapter?.args).length > 0 ? normalizeStringArray(adapter.args) : isCodexCliCommand(adapter?.command ?? artifact.payload?.structuredHints?.command) ? codexCliArgs() : ["{{payloadJson}}"],
      workingDirectory: adapter?.workingDirectory ?? null,
      workingDirectoryPolicy: adapter?.workingDirectory ? "explicit" : "bridge_default",
      environmentPolicy: "inherit_safe",
      timeoutSeconds: Number(adapter?.timeoutSeconds ?? 30),
      cancellation: normalizeCancellation(adapter?.cancellation),
      outputFormat: normalizeCliOutputFormat(adapter?.outputFormat, adapter?.command ?? artifact.payload?.structuredHints?.command),
      sandbox: adapter?.sandbox ?? null,
    };
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

  function findIntegrationArtifact(id) {
    return state.integrationArtifacts.find((item) => item.id === id);
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
