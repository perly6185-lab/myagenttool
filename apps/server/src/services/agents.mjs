import { normalizeA2aAdapterConfig } from "@myagenttool/adapters/a2a";
import { normalizeContainerAdapterConfig } from "@myagenttool/adapters/container";
import { normalizeMcpAdapterConfig } from "@myagenttool/adapters/mcp";

import { capLifecycleAuditRecords } from "./retention.mjs";

export function createAgentService({ state, now, nextId, appendEvent, persistStateSoon = () => {} }) {
  const AGENT_FACTORIES = {
    cli: (body) => createCliAgent(body),
    http: (body) => createHttpAgent(body),
    mcp: (body) => createMcpAgent(body),
    a2a: (body) => createA2aAgent(body),
    container: (body) => createContainerAgent(body),
  };

  function registerAgent(body, actor = null) {
    const type = body.type ?? body.adapter?.type;
    const factory = AGENT_FACTORIES[type];
    if (!factory) {
      throw new Error("Manual registration supports cli, http, mcp, a2a, and container agents.");
    }

    const agent = factory(body);
    if (actor?.userId) agent.ownerUserId = actor.userId; // register under the acting user
    const existingIndex = state.agents.findIndex((item) => item.id === agent.id);
    if (existingIndex >= 0) {
      const existing = state.agents[existingIndex];
      const merged = {
        ...existing,
        ...agent,
        health: existing.health ?? agent.health,
        updatedAt: now(),
      };
      if (isAgentDisabled(existing)) {
        merged.lifecycle = { ...agent.lifecycle, state: "disabled" };
        merged.status = "disabled";
      }
      state.agents[existingIndex] = merged;
      persistStateSoon();
      return merged;
    }
    state.agents.push(agent);
    persistStateSoon();
    return agent;
  }

  function createCliAgent(body) {
    const command = String(body.command ?? body.adapter?.command ?? "").trim();
    if (!command) {
      throw new Error("CLI agent command is required.");
    }
    const args = Array.isArray(body.args ?? body.adapter?.args) ? (body.args ?? body.adapter.args).map(String) : [];
    const codexCommand = isCodexCliCommand(command);
    const claudeCommand = isClaudeCliCommand(command);
    const codingAgent = codexCommand || claudeCommand;
    // Claude's permission mode is the analog of Codex's sandbox; accept either key.
    const claudeMode = claudeCommand
      ? normalizeClaudePermissionMode(body.permissionMode ?? body.adapter?.permissionMode ?? body.sandbox)
      : null;
    // A registered Claude agent gets a deterministic id per permission mode so
    // re-registering the same mode upserts in place (the web card's Update state
    // assumes this) while a different mode stays a distinct agent. Codex and
    // other CLI agents keep their existing generated ids; an explicit body.id
    // always wins.
    const id = sanitizeAgentId(body.id ?? (claudeCommand ? `agt_claude_${claudeMode}` : nextId("agt_cli")));
    const defaultCodingArgs = codexCommand ? codexCliArgs() : claudeCommand ? claudeCliArgs(claudeMode) : [];
    const normalizedArgs = args.length > 0 ? args : defaultCodingArgs;
    return baseAgent({
      id,
      type: "cli",
      name: body.name ?? "Manual CLI Agent",
      description: body.description ?? "Manually registered CLI agent.",
      location: { type: "local_device", deviceId: state.device.id },
      adapter: {
        type: "cli",
        command,
        args: normalizedArgs,
        workingDirectory: body.workingDirectory ?? null,
        workingDirectoryPolicy: body.workingDirectory ? "explicit" : "bridge_default",
        environmentPolicy: body.env ? "explicit_only" : "inherit_safe",
        env: normalizeEnv(body.env),
        timeoutSeconds: Number(body.timeoutSeconds ?? (claudeCommand ? 180 : codexCommand ? 120 : 30)),
        cancellation: "supported",
        outputFormat: normalizeCliOutputFormat(body.outputFormat ?? body.adapter?.outputFormat, command),
        sandbox: body.sandbox ?? body.adapter?.sandbox ?? null,
        permissionMode: claudeCommand ? claudeMode : null,
      },
      capabilities: [
        {
          name: body.capabilityName ?? "manual_cli_task",
          description: body.capabilityDescription ?? "Runs a manually registered local CLI command.",
          riskLevel: normalizeRiskLevel(body.riskLevel, codingAgent ? "high" : "medium"),
          riskTags: normalizeRiskTags(
            body.riskTags ?? body.capabilityRiskTags,
            codexCommand ? codexRiskTags() : claudeCommand ? claudeRiskTags() : ["read_local", "shell_exec"],
          ),
        },
      ],
      status: state.device.status === "online" ? "available" : "unavailable",
      registrationNotes: normalizeRegistrationNotes(body.registrationNotes, codexCommand
        ? codexRegistrationNotes()
        : claudeCommand
          ? claudeRegistrationNotes()
          : {
              risk: "Runs a local command with structured argv. Review the command, arguments, working directory, and environment before invoking.",
              data: "Task input and command output are streamed to the local demo server as invocation events.",
              cost: "Cost is external or unknown unless the registered command reports it.",
              cancellation: "The Desktop Bridge attempts to terminate the process tree when cancellation is requested.",
            }),
      economics: normalizeAgentEconomics(body),
      toolContract: normalizeToolContract(body.toolContract ?? body.adapter?.toolContract),
    });
  }

  function createMcpAgent(body) {
    // Validation lives in the shared adapter slice, so the server registers
    // exactly what the bridge will execute. Invalid config throws with a
    // plain-language message the route surfaces as a 400.
    const config = normalizeMcpAdapterConfig(body.adapter ?? body);
    // Both transports run their *client* on this device's bridge (stdio spawns
    // the server locally; http reaches a remote endpoint — kept on the bridge
    // so servers on networks only the user's device can reach stay usable).
    const id = sanitizeAgentId(body.id ?? nextId("agt_mcp"));
    const agent = baseAgent({
      id,
      type: "mcp",
      name: body.name ?? "MCP Server Agent",
      description: body.description ?? "Manually registered MCP server (stdio).",
      location: { type: "local_device", deviceId: state.device.id },
      // The slice config uses `kind`; the control plane dispatches on
      // `adapter.type`, so carry both.
      adapter: { type: "mcp", ...config, cancellation: "supported", streaming: true },
      capabilities: [
        {
          name: body.capabilityName ?? "mcp_tool_call",
          description: body.capabilityDescription ?? "Calls a tool exposed by the MCP server.",
          riskLevel: normalizeRiskLevel(body.riskLevel, "medium"),
          riskTags: normalizeRiskTags(body.riskTags ?? body.capabilityRiskTags, ["local_execution"]),
        },
      ],
      status: "available",
      registrationNotes: {
        risk: "Runs the configured MCP server command on this device and calls its tools.",
        data: "Task input is sent to the MCP server as tool arguments; tool output is stored as the result.",
        cost: "Cost is external or unknown unless the server reports it.",
        cancellation: "The bridge sends notifications/cancelled and stops the server process.",
      },
      economics: normalizeAgentEconomics(body),
      toolContract: normalizeToolContract(body.toolContract ?? body.adapter?.toolContract),
    });
    const toolNamespace = String(body.toolNamespace ?? body.adapter?.toolNamespace ?? "").trim();
    if (toolNamespace) agent.toolNamespace = toolNamespace;
    const sourceApplicationId = String(body.sourceApplicationId ?? body.applicationId ?? "").trim();
    if (sourceApplicationId) agent.sourceApplicationId = sourceApplicationId;
    return agent;
  }

  function createA2aAgent(body) {
    const config = normalizeA2aAdapterConfig(body.adapter ?? body);
    const id = sanitizeAgentId(body.id ?? nextId("agt_a2a"));
    return baseAgent({
      id,
      type: "a2a",
      name: body.name ?? "A2A Remote Agent",
      description: body.description ?? "Manually registered A2A agent.",
      // The remote agent runs elsewhere, but the *client* runs on this device's
      // bridge (so agents reachable only from the user's network stay usable).
      location: { type: "local_device", deviceId: state.device.id },
      adapter: { type: "a2a", ...config, cancellation: "supported", streaming: true },
      capabilities: [
        {
          name: body.capabilityName ?? "a2a_task",
          description: body.capabilityDescription ?? "Delegates a task to a remote A2A agent.",
          riskLevel: normalizeRiskLevel(body.riskLevel, "medium"),
          riskTags: normalizeRiskTags(body.riskTags ?? body.capabilityRiskTags, ["network_access", "external_data_transfer"]),
        },
      ],
      status: "available",
      registrationNotes: {
        risk: "Sends task input to the configured remote A2A agent.",
        data: "Task input leaves this device; the remote agent's reply is stored as the result.",
        cost: "Cost is external or unknown unless the remote agent reports it.",
        cancellation: "The bridge sends tasks/cancel to the remote agent.",
      },
      economics: normalizeAgentEconomics(body),
      toolContract: normalizeToolContract(body.toolContract ?? body.adapter?.toolContract),
    });
  }

  function createContainerAgent(body) {
    const config = normalizeContainerAdapterConfig(body.adapter ?? body);
    const id = sanitizeAgentId(body.id ?? nextId("agt_ctr"));
    return baseAgent({
      id,
      type: "container",
      name: body.name ?? "Container Agent",
      description: body.description ?? "Manually registered containerized agent.",
      location: { type: "local_device", deviceId: state.device.id },
      adapter: { type: "container", ...config, cancellation: "supported", streaming: true },
      capabilities: [
        {
          name: body.capabilityName ?? "container_run",
          description: body.capabilityDescription ?? "Runs a governed one-shot container for each task.",
          riskLevel: normalizeRiskLevel(body.riskLevel, "medium"),
          riskTags: normalizeRiskTags(body.riskTags ?? body.capabilityRiskTags, ["local_execution"]),
        },
      ],
      status: "available",
      registrationNotes: {
        risk: "Runs the configured container image on this device for each invocation.",
        data: "Task input enters the container as the TASK environment variable; container output is stored as the result.",
        cost: "Local compute; image cost is external or unknown.",
        cancellation: "The bridge stops the container and removes it (one-shot --rm run).",
      },
      economics: normalizeAgentEconomics(body),
      toolContract: normalizeToolContract(body.toolContract ?? body.adapter?.toolContract),
    });
  }

  function createHttpAgent(body) {
    const id = sanitizeAgentId(body.id ?? nextId("agt_http"));
    const baseUrl = String(body.baseUrl ?? body.adapter?.baseUrl ?? "").trim();
    if (!baseUrl) {
      throw new Error("HTTP agent baseUrl is required.");
    }
    const requestPath = String(body.requestPath ?? body.adapter?.requestPath ?? "/invoke");
    const healthPath = String(body.healthPath ?? body.adapter?.healthPath ?? "/health");
    return baseAgent({
      id,
      type: "http",
      name: body.name ?? "Manual HTTP Agent",
      description: body.description ?? "Manually registered HTTP agent.",
      location: { type: "remote_http", baseUrl },
      adapter: {
        type: "http",
        baseUrl,
        authMode: body.authMode ?? body.adapter?.authMode ?? "none",
        requestPath,
        healthPath,
        method: "POST",
        payloadShape: body.payloadShape ?? { task: "string" },
        timeoutSeconds: Number(body.timeoutSeconds ?? 30),
        streaming: Boolean(body.streaming ?? false),
        cancellation: body.cancellation ?? "supported",
      },
      capabilities: [
        {
          name: body.capabilityName ?? "manual_http_task",
          description: body.capabilityDescription ?? "Runs a manually registered HTTP endpoint.",
          riskLevel: normalizeRiskLevel(body.riskLevel, "medium"),
          riskTags: normalizeRiskTags(body.riskTags ?? body.capabilityRiskTags, ["network_access", "external_data_transfer"]),
        },
      ],
      status: "available",
      registrationNotes: normalizeRegistrationNotes(body.registrationNotes, {
        risk: "Sends invocation input to the configured HTTP endpoint.",
        data: "Task input leaves the local demo server and endpoint response is stored as the result.",
        cost: "Cost is external or unknown unless the endpoint reports it.",
        cancellation: "The server aborts the HTTP request when supported; otherwise cancellation is recorded as not supported or unknown.",
      }),
      economics: normalizeAgentEconomics(body),
      toolContract: normalizeToolContract(body.toolContract ?? body.adapter?.toolContract),
    });
  }

  function baseAgent({ id, name, description, location, adapter, capabilities, status, registrationNotes, economics = {}, toolContract = null }) {
    const createdAt = now();
    const agent = {
      id,
      name: String(name),
      description: String(description),
      ownerUserId: "usr_local",
      location,
      adapter,
      lifecycle: {
        state: "enabled",
        installState: "installed",
        version: "0.0.0",
        managedBy: adapter.type === "http" ? "external" : adapter.type === "platform" ? "platform" : "bridge",
      },
      economics: {
        model: normalizeEconomicModel(economics.model, "unknown"),
        pricingDimensions: normalizeStringArray(economics.pricingDimensions),
        currency: String(economics.currency ?? "USD"),
        costOwner: String(economics.costOwner ?? "usr_local"),
        budgetPoolId: economics.budgetPoolId ?? null,
        revenueOwner: economics.revenueOwner ?? null,
        unknownCostPolicy: normalizeUnknownCostPolicy(economics.unknownCostPolicy, "warn"),
      },
      capabilities,
      status,
      health: {
        status: "unknown",
        checkedAt: null,
        message: "Health has not been checked yet.",
        nextAction: "Run a health check before relying on this agent.",
      },
      registrationNotes,
      createdAt,
      updatedAt: createdAt,
    };
    if (toolContract) {
      agent.toolContract = toolContract;
    }
    return agent;
  }

  function disableAgent(agent, actor = null) {
    const operation = createLifecycleOperation(agent, "disable", "Disabled from Web Console.", actor);
    startLifecycleOperation(operation, `Disabling ${agent.name}.`);
    agent.lifecycle = { ...agent.lifecycle, state: "disabled" };
    agent.status = "disabled";
    agent.updatedAt = now();
    finishLifecycleOperation(operation, "succeeded", `${agent.name} is disabled. New invocations are blocked.`);
    persistStateSoon();
    return operation;
  }

  function enableAgent(agent, actor = null) {
    const operation = createLifecycleOperation(agent, "enable", "Enabled from Web Console.", actor);
    startLifecycleOperation(operation, `Enabling ${agent.name}.`);
    agent.lifecycle = { ...agent.lifecycle, state: "enabled" };
    agent.status = enabledAgentStatus(agent);
    agent.updatedAt = now();
    finishLifecycleOperation(operation, "succeeded", `${agent.name} is enabled.`);
    persistStateSoon();
    return operation;
  }

  function createAgentHealthCheck(agent, actor = null) {
    const operation = createLifecycleOperation(agent, "health_check", "Health check requested from Web Console.", actor);
    state.healthChecks.unshift(operation);
    state.healthChecks = state.healthChecks.slice(0, 50);
    agent.health = {
      status: "checking",
      checkedAt: null,
      message: "Health check requested.",
      nextAction: "Wait for the health result.",
    };
    agent.updatedAt = now();
    persistStateSoon();

    if (agent.adapter.type === "http" && agent.location.type === "remote_http") {
      queueMicrotask(() => runHttpHealthCheck(operation, agent).catch((error) => {
        completeHealthCheck(operation, {
          status: "unhealthy",
          message: `HTTP health check failed: ${error instanceof Error ? error.message : String(error)}`,
          nextAction: "Verify the HTTP agent health endpoint.",
        });
      }));
      return operation;
    }

    if (agent.adapter.type === "cli" && agent.location.type === "local_device") {
      if (state.device.status !== "online" || state.device.unlinkState !== "linked") {
        completeHealthCheck(operation, {
          status: "unhealthy",
          message: "Desktop Bridge is not online for this local agent.",
          nextAction: "Start Desktop Bridge and retry the health check.",
        });
      }
      return operation;
    }

    completeHealthCheck(operation, {
      status: "unhealthy",
      message: "This demo cannot health-check the selected adapter type yet.",
      nextAction: "Use a CLI or HTTP demo agent.",
    });
    return operation;
  }

  function createLifecycleOperation(agent, operation, reason, actor = null) {
    const createdAt = now();
    const record = {
      id: nextId("lco_demo"),
      agentId: agent.id,
      deviceId: agent.location.type === "local_device" ? agent.location.deviceId : undefined,
      requestedBy: actor?.userId ?? "usr_local",
      operation,
      status: "queued",
      reason,
      message: `${operation.replaceAll("_", " ")} queued for ${agent.name}.`,
      createdAt,
      completedAt: null,
    };
    state.lifecycleAuditRecords.unshift(record);
    capLifecycleAuditRecords(state);
    appendEvent({
      invocationId: null,
      type: "lifecycle_requested",
      level: "info",
      message: record.message,
      data: { operationId: record.id, agentId: agent.id, operation },
    });
    return record;
  }

  function startLifecycleOperation(operation, message) {
    if (operation.status !== "queued") {
      return;
    }
    operation.status = "running";
    operation.message = message;
    appendEvent({
      invocationId: null,
      type: "lifecycle_started",
      level: "info",
      message,
      data: { operationId: operation.id, agentId: operation.agentId, operation: operation.operation },
    });
  }

  function finishLifecycleOperation(operation, status, message) {
    operation.status = status;
    operation.message = message;
    operation.completedAt = now();
    appendEvent({
      invocationId: null,
      type: status === "succeeded" ? "lifecycle_completed" : "lifecycle_failed",
      level: status === "succeeded" ? "info" : "warn",
      message,
      data: { operationId: operation.id, agentId: operation.agentId, operation: operation.operation },
    });
  }

  function nextBridgeHealthCheck() {
    return state.healthChecks.find((operation) => {
      if (operation.status !== "queued") {
        return false;
      }
      const agent = findAgent(operation.agentId);
      const operationDeviceId = operation.deviceId ?? agent?.location?.deviceId ?? null;
      return (
        agent?.adapter.type === "cli" &&
        agent.location.type === "local_device" &&
        operationDeviceId === state.device.id
      );
    });
  }

  function markHealthCheckStarted(operation) {
    const agent = findAgent(operation.agentId);
    if (agent) {
      agent.health = {
        status: "checking",
        checkedAt: null,
        message: "Desktop Bridge is checking this agent.",
        nextAction: "Wait for the health result.",
      };
      agent.updatedAt = now();
    }
    startLifecycleOperation(operation, `Health check started for ${agent?.name ?? operation.agentId}.`);
    persistStateSoon();
  }

  async function runHttpHealthCheck(operation, agent) {
    markHealthCheckStarted(operation);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(agent.adapter.timeoutSeconds ?? 10) * 1000);
    try {
      const url = new URL(agent.adapter.healthPath ?? "/health", agent.adapter.baseUrl);
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = { message: text };
      }
      completeHealthCheck(operation, {
        status: response.ok ? "healthy" : "unhealthy",
        message: payload?.message ?? payload?.status ?? `HTTP health endpoint returned ${response.status}.`,
        nextAction: response.ok ? null : "Inspect the HTTP agent health endpoint.",
      });
    } catch (error) {
      completeHealthCheck(operation, {
        status: "unhealthy",
        message: `HTTP health check failed: ${error instanceof Error ? error.message : String(error)}`,
        nextAction: "Verify that the HTTP agent is reachable.",
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  function completeHealthCheck(operation, result) {
    const agent = findAgent(operation.agentId);
    const healthy = result.status === "healthy" || result.status === "ok" || result.status === "succeeded";
    const message = String(result.message ?? (healthy ? "Agent health check passed." : "Agent health check failed."));
    const nextAction = result.nextAction === undefined
      ? healthy ? null : "Review the agent setup, then run another health check."
      : result.nextAction;

    finishLifecycleOperation(operation, healthy ? "succeeded" : "failed", message);
    if (!agent) {
      return;
    }

    agent.health = {
      status: healthy ? "healthy" : "unhealthy",
      checkedAt: now(),
      message,
      nextAction,
    };
    agent.updatedAt = now();
    persistStateSoon();
  }

  function enabledAgentStatus(agent) {
    if (agent.location.type === "local_device") {
      return state.device.status === "online" && state.device.unlinkState === "linked" ? "available" : "unavailable";
    }
    if (agent.location.type === "remote_http") {
      return "available";
    }
    return "unknown";
  }

  function findAgent(id) {
    return state.agents.find((agent) => agent.id === id);
  }

  return {
    completeHealthCheck,
    createAgentHealthCheck,
    disableAgent,
    enableAgent,
    findAgent,
    isAgentDisabled,
    markHealthCheckStarted,
    nextBridgeHealthCheck,
    registerAgent,
  };
}

export function defaultRiskTags(targetType, command) {
  if (targetType === "cli" && isCodexCliCommand(command)) {
    return codexRiskTags();
  }
  if (targetType === "cli" && isClaudeCliCommand(command)) {
    return claudeRiskTags();
  }
  return targetType === "http" ? ["network_access", "external_data_transfer"] : ["read_local", "shell_exec", "generated_code"];
}

export function isCodexCliCommand(command) {
  const normalized = String(command ?? "").trim().toLowerCase();
  return ["codex", "codex.cmd", "codex.ps1", "codex.exe"].some((name) => normalized === name || normalized.endsWith(`/${name}`) || normalized.endsWith(`\\${name}`));
}

export function codexCliArgs() {
  return ["exec", "--skip-git-repo-check", "--json", "{{task}}"];
}

export function codexCliResumeArgs() {
  return ["exec", "resume", "--last", "--skip-git-repo-check", "--json", "{{task}}"];
}

export function codexRiskTags() {
  return ["read_local", "write_local", "shell_exec", "network_access", "repo_context", "code_change"];
}

export function normalizeCliOutputFormat(value, command) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "codex_jsonl") return "codex_jsonl";
  if (normalized === "claude_jsonl") return "claude_jsonl";
  if (isCodexCliCommand(command)) return "codex_jsonl";
  if (isClaudeCliCommand(command)) return "claude_jsonl";
  return "plain_result";
}

export function codexRegistrationNotes() {
  return {
    risk: "Runs Codex CLI in non-interactive mode. Repository access, sandbox, approvals, and file-change permissions are governed by Codex CLI native controls.",
    data: "Task input, Codex JSONL events, command output, trace, and result summary are recorded by the local demo server.",
    cost: "Codex cost is external or unknown to the demo server and remains visible for review.",
    cancellation: "The Desktop Bridge attempts to terminate the Codex process tree when cancellation is requested.",
  };
}

export function isClaudeCliCommand(command) {
  const normalized = String(command ?? "").trim().toLowerCase();
  return ["claude", "claude.cmd", "claude.ps1", "claude.exe"].some((name) => normalized === name || normalized.endsWith(`/${name}`) || normalized.endsWith(`\\${name}`));
}

// Claude Code runs non-interactively via `claude -p` with stream-json events.
// `plan` is the safe default (no edits); `acceptEdits` and `bypassPermissions`
// are writable opt-ins. "default"/"auto" are excluded — they block on
// interactive prompts in a headless bridge. This is Claude's analog of Codex's
// sandbox mode.
export function normalizeClaudePermissionMode(value) {
  const normalized = String(value ?? "").trim();
  return ["plan", "acceptEdits", "bypassPermissions"].includes(normalized) ? normalized : "plan";
}

export function claudeCliArgs(permissionMode = "plan") {
  return ["-p", "{{task}}", "--output-format", "stream-json", "--verbose", "--permission-mode", normalizeClaudePermissionMode(permissionMode)];
}

export function claudeRiskTags() {
  return ["read_local", "write_local", "shell_exec", "network_access", "repo_context", "code_change"];
}

export function claudeRegistrationNotes() {
  return {
    risk: "Runs Claude Code non-interactively (claude -p). Review repository access, permission mode, tool use, and proposed file changes before invoking.",
    data: "Task input, Claude stream-json events, result text, trace, and result summary are recorded by the local demo server.",
    cost: "Claude cost is external or unknown to the demo server and remains visible for review.",
    cancellation: "The Desktop Bridge attempts to terminate the Claude process tree when cancellation is requested.",
  };
}

export function cancellationTextForAdapter(adapter) {
  if (adapter.cancellation === "supported") {
    return "Can request stop.";
  }
  if (adapter.cancellation === "unsupported") {
    return "Stop is not supported by this agent.";
  }
  return "Stop behavior is unknown.";
}

export function normalizeEnv(env) {
  if (!env || typeof env !== "object" || Array.isArray(env)) return {};
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [String(key), String(value)]));
}

export function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

export function normalizeRiskLevel(value, fallback = "medium") {
  const normalized = String(value ?? fallback).trim();
  return ["low", "medium", "high", "critical"].includes(normalized) ? normalized : fallback;
}

export function normalizeRiskTags(value, fallback) {
  const tags = normalizeStringArray(value);
  return tags.length ? tags : fallback;
}

export function normalizeAgentEconomics(body = {}) {
  const economics = body.economics && typeof body.economics === "object" && !Array.isArray(body.economics)
    ? body.economics
    : {};
  return {
    model: normalizeEconomicModel(body.economicModel ?? economics.model, "unknown"),
    pricingDimensions: normalizeStringArray(body.pricingDimensions ?? economics.pricingDimensions),
    currency: String(body.currency ?? economics.currency ?? "USD"),
    costOwner: String(body.costOwner ?? economics.costOwner ?? "usr_local"),
    budgetPoolId: body.budgetPoolId ?? economics.budgetPoolId ?? null,
    revenueOwner: body.revenueOwner ?? economics.revenueOwner ?? null,
    unknownCostPolicy: normalizeUnknownCostPolicy(body.unknownCostPolicy ?? economics.unknownCostPolicy, "warn"),
  };
}

export function normalizeRegistrationNotes(value, fallback) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  return {
    risk: String(value.risk ?? fallback.risk),
    data: String(value.data ?? fallback.data),
    cost: String(value.cost ?? fallback.cost),
    cancellation: String(value.cancellation ?? fallback.cancellation),
  };
}

export function normalizeToolContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

export function normalizeEconomicModel(value, fallback = "unknown") {
  const normalized = String(value ?? fallback).trim();
  return ["free", "external_billed", "platform_billed", "internal_chargeback", "revenue_generating", "rev_share", "unknown"].includes(normalized)
    ? normalized
    : fallback;
}

export function normalizeUnknownCostPolicy(value, fallback = "warn") {
  const normalized = String(value ?? fallback).trim();
  return ["warn", "require_approval", "block"].includes(normalized) ? normalized : fallback;
}

export function sanitizeAgentId(id) {
  const raw = String(id).trim();
  const withPrefix = raw.startsWith("agt_") ? raw : `agt_${raw}`;
  return withPrefix.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function isAgentDisabled(agent) {
  return agent?.status === "disabled" || agent?.lifecycle?.state === "disabled";
}
