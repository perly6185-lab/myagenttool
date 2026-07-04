import {
  cancellationTextForAdapter,
  codexCliArgs,
  codexRiskTags,
  isCodexCliCommand,
  normalizeCliOutputFormat,
  normalizeStringArray,
  sanitizeAgentId,
} from "../agents.mjs";
import { capLifecycleAuditRecords } from "../retention.mjs";
import { conservativeRiskHints } from "./helpers.mjs";

export function createDiscoveryRuntime({
  state,
  now,
  nextId,
  appendEvent,
  disableAgent,
  registerAgent,
  persistStateSoon = () => {},
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
      requestedBy: body.requestedBy ?? "usr_local",
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
      requestedBy: body.requestedBy ?? "usr_local",
      operation: "discover",
      status: discoveryRun.status,
      reason: "Conservative local agent discovery requested.",
      message: discoveryRun.message,
      createdAt,
      completedAt: discoveryRun.completedAt,
    });
    capLifecycleAuditRecords(state);
    appendEvent({
      invocationId: null,
      type: "lifecycle_requested",
      level: discoveryRun.status === "failed" ? "warn" : "info",
      message: discoveryRun.message,
      data: { operationId: discoveryRun.id, operation: "discover", deviceId: state.device.id },
    });
    persistStateSoon();
    return discoveryRun;
  }

  function nextBridgeDiscoveryRun() {
    return state.discoveryRuns.find(
      (item) => item.status === "queued" && item.deviceId === state.device.id,
    );
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
    persistStateSoon();
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
    persistStateSoon();
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
    persistStateSoon();
    return agent;
  }

  function findDiscoveryRun(id) {
    return state.discoveryRuns.find((item) => item.id === id);
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

  function updateLifecycleAudit(id, patch) {
    const record = state.lifecycleAuditRecords.find((item) => item.id === id);
    if (record) {
      Object.assign(record, patch);
    }
  }

  return {
    completeDiscoveryRun,
    createDiscoveryRun,
    findDiscoveryRun,
    markDiscoveryStarted,
    nextBridgeDiscoveryRun,
    registerDiscoveredCandidate,
  };
}
