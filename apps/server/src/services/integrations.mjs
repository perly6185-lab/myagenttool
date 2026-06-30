import {
  cancellationTextForAdapter,
  codexCliArgs,
  codexRiskTags,
  defaultRiskTags,
  isAgentDisabled,
  isCodexCliCommand,
  normalizeCliOutputFormat,
  normalizeEconomicModel,
  normalizeRiskLevel,
  normalizeRiskTags,
  normalizeStringArray,
  normalizeUnknownCostPolicy,
  sanitizeAgentId,
} from "./agents.mjs";

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
  function createDiscoveryRun(body = {}) {
    const allowedScope = [
      "known_command_allowlist",
      "user_provided_path",
      "known_local_endpoint",
      "user_provided_endpoint",
      "bridge_managed_config",
    ];
    const scope = Array.isArray(body.scope)
      ? body.scope.filter((item) => allowedScope.includes(item))
      : allowedScope;
    const createdAt = now();
    const discoveryRun = {
      id: nextId("lco_demo"),
      deviceId: state.device.id,
      requestedBy: "usr_local",
      status: state.device.status === "online" && state.device.unlinkState === "linked" ? "queued" : "failed",
      scope,
      options: {
        userProvidedPaths: normalizeStringArray(body.userProvidedPaths),
        userProvidedEndpoints: normalizeStringArray(body.userProvidedEndpoints),
      },
      message: "Conservative discovery checks known commands, known endpoints, user-provided entries, and bridge-managed config only.",
      candidates: [],
      createdAt,
      completedAt: state.device.status === "online" && state.device.unlinkState === "linked" ? null : createdAt,
    };
    if (discoveryRun.status === "failed") {
      discoveryRun.message = "Desktop Bridge is offline. Start the bridge before discovery.";
    }
    state.discoveryRuns.unshift(discoveryRun);
    state.discoveryRuns = state.discoveryRuns.slice(0, 20);
    state.lifecycleAuditRecords.unshift({
      id: discoveryRun.id,
      agentId: "agt_demo_cli",
      deviceId: state.device.id,
      requestedBy: "usr_local",
      operation: "discover",
      status: discoveryRun.status,
      reason: "Conservative local agent discovery requested.",
      message: discoveryRun.message,
      createdAt,
      completedAt: discoveryRun.completedAt,
    });
    state.lifecycleAuditRecords = state.lifecycleAuditRecords.slice(0, 100);
    appendEvent({
      invocationId: null,
      type: "lifecycle_requested",
      level: discoveryRun.status === "failed" ? "warn" : "info",
      message: discoveryRun.message,
      data: { operationId: discoveryRun.id, operation: "discover", deviceId: state.device.id },
    });
    return discoveryRun;
  }

  function nextBridgeDiscoveryRun() {
    return state.discoveryRuns.find((item) => item.status === "queued");
  }

  function markDiscoveryStarted(discoveryRun) {
    if (discoveryRun.status !== "queued") {
      return;
    }
    discoveryRun.status = "running";
    discoveryRun.message = "Desktop Bridge is checking conservative discovery sources.";
    updateLifecycleAudit(discoveryRun.id, {
      status: "running",
      message: discoveryRun.message,
    });
    appendEvent({
      invocationId: null,
      type: "lifecycle_started",
      level: "info",
      message: discoveryRun.message,
      data: { operationId: discoveryRun.id, operation: "discover", deviceId: discoveryRun.deviceId },
    });
  }

  function completeDiscoveryRun(discoveryRun, body) {
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    discoveryRun.candidates = candidates.map((candidate, index) => normalizeDiscoveryCandidate(candidate, index));
    discoveryRun.status = body.status === "failed" ? "failed" : "succeeded";
    discoveryRun.message = body.message ?? `Discovery found ${discoveryRun.candidates.length} conservative candidate(s).`;
    discoveryRun.completedAt = now();
    updateLifecycleAudit(discoveryRun.id, {
      status: discoveryRun.status,
      message: discoveryRun.message,
      completedAt: discoveryRun.completedAt,
    });
    appendEvent({
      invocationId: null,
      type: discoveryRun.status === "succeeded" ? "lifecycle_completed" : "lifecycle_failed",
      level: discoveryRun.status === "succeeded" ? "info" : "warn",
      message: discoveryRun.message,
      data: {
        operationId: discoveryRun.id,
        operation: "discover",
        deviceId: discoveryRun.deviceId,
        candidateCount: discoveryRun.candidates.length,
      },
    });
  }

  function normalizeDiscoveryCandidate(candidate, index) {
    const adapterType = candidate.adapter?.type === "http" ? "http" : "cli";
    const source = [
      "known_command_allowlist",
      "user_provided_path",
      "known_local_endpoint",
      "user_provided_endpoint",
      "bridge_managed_config",
    ].includes(candidate.source)
      ? candidate.source
      : "known_command_allowlist";
    const agentId = sanitizeAgentId(candidate.registration?.agentId ?? candidate.agentId ?? candidate.id ?? `discovered_${index + 1}`);
    const command = String(candidate.adapter?.command ?? candidate.command ?? "demo-agent");
    const codexCommand = adapterType === "cli" && isCodexCliCommand(command);
    const adapter = adapterType === "http"
      ? {
          type: "http",
          baseUrl: String(candidate.adapter?.baseUrl ?? candidate.baseUrl ?? "http://127.0.0.1:3212"),
          authMode: "none",
          requestPath: String(candidate.adapter?.requestPath ?? candidate.requestPath ?? "/invoke"),
          healthPath: String(candidate.adapter?.healthPath ?? candidate.healthPath ?? "/health"),
          method: "POST",
          payloadShape: { task: "string" },
          timeoutSeconds: Number(candidate.adapter?.timeoutSeconds ?? 30),
          streaming: false,
          cancellation: candidate.adapter?.cancellation ?? "supported",
        }
      : {
          type: "cli",
          command,
          args: Array.isArray(candidate.adapter?.args ?? candidate.args) ? (candidate.adapter?.args ?? candidate.args).map(String) : codexCommand ? codexCliArgs() : ["{{payloadJson}}"],
          workingDirectoryPolicy: "bridge_default",
          environmentPolicy: "inherit_safe",
          timeoutSeconds: Number(candidate.adapter?.timeoutSeconds ?? (codexCommand ? 120 : 30)),
          cancellation: candidate.adapter?.cancellation ?? "supported",
          outputFormat: normalizeCliOutputFormat(candidate.adapter?.outputFormat, command),
          sandbox: candidate.adapter?.sandbox ?? null,
        };
    return {
      id: String(candidate.id ?? `cand_${index + 1}`),
      name: String(candidate.name ?? (adapterType === "http" ? "Discovered HTTP Agent" : "Discovered CLI Agent")),
      description: String(candidate.description ?? "Candidate found by conservative local discovery."),
      adapter,
      source,
      confidence: ["low", "medium", "high"].includes(candidate.confidence) ? candidate.confidence : "medium",
      riskLevel: ["low", "medium", "high", "critical"].includes(candidate.riskLevel) ? candidate.riskLevel : codexCommand ? "high" : adapterType === "http" ? "medium" : "low",
      riskTags: Array.isArray(candidate.riskTags) ? candidate.riskTags.map(String) : adapterType === "http" ? ["network_access", "external_data_transfer"] : codexCommand ? codexRiskTags() : ["read_only"],
      riskHints: Array.isArray(candidate.riskHints) ? candidate.riskHints.map(String) : conservativeRiskHints(source, adapterType),
      healthProbeAvailable: Boolean(candidate.healthProbeAvailable ?? true),
      healthPath: adapterType === "http" ? adapter.healthPath : null,
      registration: {
        agentId,
        status: "candidate",
        registeredAgentId: null,
      },
      createdAt: now(),
    };
  }

  function registerDiscoveredCandidate(discoveryRun, candidate) {
    const agent = registerAgent({
      id: candidate.registration.agentId,
      type: candidate.adapter.type,
      name: candidate.name,
      description: candidate.description,
      command: candidate.adapter.type === "cli" ? candidate.adapter.command : undefined,
      args: candidate.adapter.type === "cli" ? candidate.adapter.args : undefined,
      outputFormat: candidate.adapter.type === "cli" ? candidate.adapter.outputFormat : undefined,
      sandbox: candidate.adapter.type === "cli" ? candidate.adapter.sandbox : undefined,
      baseUrl: candidate.adapter.type === "http" ? candidate.adapter.baseUrl : undefined,
      requestPath: candidate.adapter.type === "http" ? candidate.adapter.requestPath : undefined,
      healthPath: candidate.adapter.type === "http" ? candidate.adapter.healthPath : undefined,
      timeoutSeconds: candidate.adapter.timeoutSeconds,
      cancellation: candidate.adapter.cancellation,
      capabilityName: "discovered_task",
      capabilityDescription: candidate.description,
      riskLevel: candidate.riskLevel,
    });
    agent.capabilities[0].riskTags = candidate.riskTags;
    agent.registrationNotes = {
      risk: candidate.riskHints.join(" "),
      data: candidate.adapter.type === "http"
        ? "Task input may be sent to the configured local HTTP endpoint."
        : "Task input and command output are streamed through the Desktop Bridge.",
      cost: "Cost is unknown unless this discovered agent reports it.",
      cancellation: cancellationTextForAdapter(candidate.adapter),
    };
    agent.discovery = {
      runId: discoveryRun.id,
      candidateId: candidate.id,
      source: candidate.source,
      confidence: candidate.confidence,
    };
    if (!isCodexCliCommand(agent.adapter?.command)) {
      disableAgent(agent);
    }
    candidate.registration.status = "registered";
    candidate.registration.registeredAgentId = agent.id;
    discoveryRun.updatedAt = now();
    appendEvent({
      invocationId: null,
      type: "lifecycle_completed",
      level: "info",
      message: isCodexCliCommand(agent.adapter?.command)
        ? `${candidate.name} was registered from discovery and is available through Codex CLI native controls.`
        : `${candidate.name} was registered from discovery and left disabled for review.`,
      data: { operationId: discoveryRun.id, operation: "discover", agentId: agent.id, candidateId: candidate.id },
    });
    return agent;
  }

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

  function createIntegrationProbeRun(artifact) {
    if (artifact.artifactType !== "adapter_config") {
      throw new Error("Only adapter config artifacts can be probed.");
    }
    if (artifact.reviewState !== "approved" && artifact.reviewState !== "tested") {
      throw new Error("Approve the adapter config before probing.");
    }
    const adapter = adapterFromArtifact(artifact);
    if (adapter.type === "cli" && (state.device.status !== "online" || state.device.unlinkState !== "linked")) {
      throw new Error("Desktop Bridge must be online before CLI probe.");
    }
    const createdAt = now();
    const probeRun = {
      id: nextId("lco_demo"),
      artifactId: artifact.id,
      deviceId: adapter.type === "cli" ? state.device.id : null,
      requestedBy: "usr_local",
      status: adapter.type === "cli" ? "queued" : "running",
      adapter,
      summary: "Probe requested after explicit review action.",
      details: [
        "No install scripts are run.",
        "Probe uses the reviewed adapter config only.",
        "Passing probe marks the artifact tested but does not enable an agent.",
      ],
      createdAt,
      completedAt: null,
    };
    state.integrationProbeRuns.unshift(probeRun);
    state.integrationProbeRuns = state.integrationProbeRuns.slice(0, 100);
    appendEvent({
      invocationId: null,
      type: "integration_tested",
      level: "info",
      message: `Probe queued for ${artifact.summary}.`,
      data: { probeRunId: probeRun.id, artifactId: artifact.id },
    });
    if (adapter.type === "http") {
      queueMicrotask(() => runHttpIntegrationProbe(probeRun).catch((error) => {
        completeIntegrationProbeRun(probeRun, {
          status: "failed",
          summary: `HTTP probe failed: ${error instanceof Error ? error.message : String(error)}`,
          details: ["HTTP probe failed before completion."],
        });
      }));
    }
    return probeRun;
  }

  function nextBridgeProbeRun() {
    return state.integrationProbeRuns.find((item) => item.status === "queued" && item.adapter?.type === "cli");
  }

  function markIntegrationProbeStarted(probeRun) {
    if (probeRun.status !== "queued") {
      return;
    }
    probeRun.status = "running";
    probeRun.summary = "Desktop Bridge is running a restricted adapter probe.";
    probeRun.updatedAt = now();
    appendEvent({
      invocationId: null,
      type: "integration_tested",
      level: "info",
      message: probeRun.summary,
      data: { probeRunId: probeRun.id, artifactId: probeRun.artifactId },
    });
  }

  function completeIntegrationProbeRun(probeRun, body = {}) {
    const succeeded = ["ok", "healthy", "succeeded"].includes(body.status) || body.status === true;
    probeRun.status = body.status === "failed" || !succeeded ? "failed" : "succeeded";
    probeRun.summary = String(body.summary ?? body.message ?? (succeeded ? "Probe passed." : "Probe failed."));
    probeRun.details = normalizeStringArray(body.details).length > 0 ? normalizeStringArray(body.details) : probeRun.details;
    probeRun.completedAt = now();
    probeRun.updatedAt = probeRun.completedAt;
    const artifact = findIntegrationArtifact(probeRun.artifactId);
    if (artifact && probeRun.status === "succeeded") {
      artifact.reviewState = "tested";
      artifact.updatedAt = now();
    }
    appendEvent({
      invocationId: null,
      type: "integration_tested",
      level: probeRun.status === "succeeded" ? "info" : "warn",
      message: `${probeRun.summary} Registration remains explicit.`,
      data: { probeRunId: probeRun.id, artifactId: probeRun.artifactId, status: probeRun.status },
    });
  }

  async function runHttpIntegrationProbe(probeRun) {
    const adapter = probeRun.adapter;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(adapter.timeoutSeconds ?? 30) * 1000);
    try {
      const url = new URL(adapter.healthPath ?? "/health", adapter.baseUrl);
      const response = await fetch(url, { method: "GET", signal: controller.signal });
      const text = await response.text();
      completeIntegrationProbeRun(probeRun, {
        status: response.ok ? "succeeded" : "failed",
        summary: response.ok ? "HTTP probe passed." : `HTTP probe returned ${response.status}.`,
        details: [
          `Checked ${url.toString()}`,
          text ? `Response: ${text.slice(0, 160)}` : "No response body recorded.",
        ],
      });
    } finally {
      clearTimeout(timeout);
    }
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

  function updateLifecycleAudit(id, patch) {
    const record = state.lifecycleAuditRecords.find((item) => item.id === id);
    if (record) {
      Object.assign(record, patch);
    }
  }

  function findDiscoveryRun(id) {
    return state.discoveryRuns.find((item) => item.id === id);
  }

  function findIntegrationArtifact(id) {
    return state.integrationArtifacts.find((item) => item.id === id);
  }

  function findIntegrationProbeRun(id) {
    return state.integrationProbeRuns.find((item) => item.id === id);
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

function guessAdapterType(body = {}) {
  if (body.targetType === "http" || body.adapterType === "http" || body.baseUrl || body.url) {
    return "http";
  }
  return "cli";
}

function normalizeTargetType(value) {
  return value === "http" ? "http" : "cli";
}

function normalizeIntegrationArtifactType(value) {
  const allowed = [
    "integration_plan",
    "adapter_config",
    "install_recipe",
    "health_check",
    "schema",
    "redaction_policy",
    "permission_policy",
    "test_case",
    "adapter_plugin",
  ];
  const normalized = String(value ?? "integration_plan");
  return allowed.includes(normalized) ? normalized : "integration_plan";
}

function normalizeIntegrationReviewState(value, fallback = "draft") {
  const normalized = String(value ?? fallback);
  return ["draft", "generated", "needs_review", "approved", "tested", "enabled", "rejected", "archived"].includes(normalized) ? normalized : fallback;
}

function normalizeCancellation(value) {
  const normalized = String(value ?? "unknown");
  return ["supported", "unsupported", "unknown"].includes(normalized) ? normalized : "unknown";
}

function normalizeRetentionDays(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1 || number > 3650) {
    return fallback;
  }
  return Math.round(number);
}

function buildAdapterConfig(targetType, options) {
  if (targetType === "http") {
    return {
      type: "http",
      baseUrl: options.baseUrl || "http://127.0.0.1:3212",
      requestPath: options.requestPath || "/invoke",
      healthPath: options.healthPath || "/health",
      method: "POST",
      payloadShape: { task: "string" },
      timeoutSeconds: options.timeoutSeconds,
      streaming: Boolean(options.streaming),
      cancellation: options.cancellation,
    };
  }
  if (isCodexCliCommand(options.command)) {
    return {
      type: "cli",
      command: options.command || "codex",
      args: options.args?.length ? options.args : codexCliArgs(),
      workingDirectory: options.workingDirectory || null,
      workingDirectoryPolicy: options.workingDirectory ? "explicit" : "bridge_default",
      environmentPolicy: "inherit_safe",
      timeoutSeconds: Number(options.timeoutSeconds ?? 120),
      cancellation: options.cancellation,
      outputFormat: "codex_jsonl",
      sandbox: options.sandbox ?? null,
    };
  }
  return {
    type: "cli",
    command: options.command || "demo-agent",
    args: options.args?.length ? options.args : ["{{payloadJson}}"],
    workingDirectory: options.workingDirectory || null,
    workingDirectoryPolicy: options.workingDirectory ? "explicit" : "bridge_default",
    environmentPolicy: "inherit_safe",
    timeoutSeconds: options.timeoutSeconds,
    cancellation: options.cancellation,
    outputFormat: normalizeCliOutputFormat(options.outputFormat, options.command),
    sandbox: options.sandbox ?? null,
  };
}

function adapterGuidance(targetType) {
  return targetType === "http"
    ? "This looks like an agent exposed through a local or remote HTTP endpoint. Review the URL, request path, health path, data sent, and cost owner before enabling."
    : "This looks like a local command-line agent. Review the command, arguments, working directory, data access, and cancellation behavior before enabling.";
}

function riskNotesForIntegration(targetType, body = {}) {
  if (targetType === "cli" && isCodexCliCommand(body.command ?? body.adapter?.command)) {
    return "Codex CLI can inspect repository context and may propose code changes. MyAgentTool records JSONL evidence and defers execution permissions to Codex CLI native controls.";
  }
  return targetType === "http"
    ? "HTTP integrations can send task data to the configured endpoint. Keep the endpoint local or trusted before enabling."
    : "CLI integrations can execute local commands. This is high risk until reviewed, probed, and explicitly enabled.";
}

function dataNotesForIntegration(targetType) {
  return targetType === "http"
    ? "Task input, endpoint response, logs, generated artifacts, and review events are recorded."
    : "Task input, command output, logs, generated artifacts, and review events are recorded.";
}

function costNotesForIntegration(body = {}) {
  const model = normalizeEconomicModel(body.economicModel ?? body.economics?.model, "unknown");
  const owner = String(body.costOwner ?? body.economics?.costOwner ?? "usr_local");
  return model === "unknown"
    ? `Cost is unknown and remains visible for ${owner}.`
    : `Economic model ${model} is assigned to ${owner}.`;
}

function cancellationNotesForIntegration(body = {}) {
  const cancellation = normalizeCancellation(body.cancellation);
  if (cancellation === "supported") return "The adapter declares cancellation support, but behavior must be verified by probe or real invocation.";
  if (cancellation === "unsupported") return "The adapter declares cancellation is unsupported.";
  return "Cancellation behavior is unknown until reviewed or tested.";
}

function integrationArtifactSummary(artifactType, targetType, payload) {
  const title = payload?.title ? `${payload.title}: ` : "";
  return `${title}${artifactType.replaceAll("_", " ")} for ${targetType.toUpperCase()} integration`;
}

function suggestedAgentId(artifact) {
  const title = String(artifact.payload?.title ?? artifact.id).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitizeAgentId(title || artifact.id);
}

function conservativeRiskHints(source, adapterType) {
  const hints = ["Discovery is conservative and did not scan the full operating system."];
  if (source === "known_command_allowlist") {
    hints.push("Candidate came from a known command allowlist.");
  }
  if (source === "known_local_endpoint") {
    hints.push("Candidate came from a known local endpoint.");
  }
  if (source === "user_provided_path" || source === "user_provided_endpoint") {
    hints.push("Candidate came from user-provided input.");
  }
  hints.push(adapterType === "http" ? "Review data sent to this endpoint before enabling." : "Review the command before enabling.");
  return hints;
}
