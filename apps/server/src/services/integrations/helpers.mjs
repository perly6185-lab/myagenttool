import {
  codexCliArgs,
  isCodexCliCommand,
  normalizeCliOutputFormat,
  normalizeEconomicModel,
  normalizeStringArray,
  sanitizeAgentId,
} from "../agents.mjs";

export function guessAdapterType(body = {}) {
  if (body.targetType === "http" || body.adapterType === "http" || body.baseUrl || body.url) {
    return "http";
  }
  return "cli";
}

export function normalizeTargetType(value) {
  return value === "http" ? "http" : "cli";
}

export function normalizeIntegrationArtifactType(value) {
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

export function normalizeIntegrationReviewState(value, fallback = "draft") {
  const normalized = String(value ?? fallback);
  return ["draft", "generated", "needs_review", "approved", "tested", "enabled", "rejected", "archived"].includes(normalized) ? normalized : fallback;
}

export function normalizeCancellation(value) {
  const normalized = String(value ?? "unknown");
  return ["supported", "unsupported", "unknown"].includes(normalized) ? normalized : "unknown";
}

export function normalizeRetentionDays(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1 || number > 3650) {
    return fallback;
  }
  return Math.round(number);
}

export function buildAdapterConfig(targetType, options) {
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

export function adapterFromArtifact(artifact) {
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

export function adapterGuidance(targetType) {
  return targetType === "http"
    ? "This looks like an agent exposed through a local or remote HTTP endpoint. Review the URL, request path, health path, data sent, and cost owner before enabling."
    : "This looks like a local command-line agent. Review the command, arguments, working directory, data access, and cancellation behavior before enabling.";
}

export function riskNotesForIntegration(targetType, body = {}) {
  if (targetType === "cli" && isCodexCliCommand(body.command ?? body.adapter?.command)) {
    return "Codex CLI can inspect repository context and may propose code changes. MyAgentTool records JSONL evidence and defers execution permissions to Codex CLI native controls.";
  }
  return targetType === "http"
    ? "HTTP integrations can send task data to the configured endpoint. Keep the endpoint local or trusted before enabling."
    : "CLI integrations can execute local commands. This is high risk until reviewed, probed, and explicitly enabled.";
}

export function dataNotesForIntegration(targetType) {
  return targetType === "http"
    ? "Task input, endpoint response, logs, generated artifacts, and review events are recorded."
    : "Task input, command output, logs, generated artifacts, and review events are recorded.";
}

export function costNotesForIntegration(body = {}) {
  const model = normalizeEconomicModel(body.economicModel ?? body.economics?.model, "unknown");
  const owner = String(body.costOwner ?? body.economics?.costOwner ?? "usr_local");
  return model === "unknown"
    ? `Cost is unknown and remains visible for ${owner}.`
    : `Economic model ${model} is assigned to ${owner}.`;
}

export function cancellationNotesForIntegration(body = {}) {
  const cancellation = normalizeCancellation(body.cancellation);
  if (cancellation === "supported") return "The adapter declares cancellation support, but behavior must be verified by probe or real invocation.";
  if (cancellation === "unsupported") return "The adapter declares cancellation is unsupported.";
  return "Cancellation behavior is unknown until reviewed or tested.";
}

export function integrationArtifactSummary(artifactType, targetType, payload) {
  const title = payload?.title ? `${payload.title}: ` : "";
  return `${title}${artifactType.replaceAll("_", " ")} for ${targetType.toUpperCase()} integration`;
}

export function suggestedAgentId(artifact) {
  const title = String(artifact.payload?.title ?? artifact.id).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitizeAgentId(title || artifact.id);
}

export function conservativeRiskHints(source, adapterType) {
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
