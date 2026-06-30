export function createAgentService({ state, now, nextId, appendEvent }) {
  function registerAgent(body) {
    const type = body.type ?? body.adapter?.type;
    if (!["cli", "http"].includes(type)) {
      throw new Error("M0 supports manual cli and http agent registration only.");
    }

    const agent = type === "cli" ? createCliAgent(body) : createHttpAgent(body);
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
      return merged;
    }
    state.agents.push(agent);
    return agent;
  }

  function createCliAgent(body) {
    const id = sanitizeAgentId(body.id ?? nextId("agt_cli"));
    const command = String(body.command ?? body.adapter?.command ?? "").trim();
    if (!command) {
      throw new Error("CLI agent command is required.");
    }
    const args = Array.isArray(body.args ?? body.adapter?.args) ? (body.args ?? body.adapter.args).map(String) : [];
    const codexCommand = isCodexCliCommand(command);
    const normalizedArgs = args.length > 0 ? args : codexCommand ? codexCliArgs() : [];
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
        timeoutSeconds: Number(body.timeoutSeconds ?? (codexCommand ? 120 : 30)),
        cancellation: "supported",
        outputFormat: normalizeCliOutputFormat(body.outputFormat ?? body.adapter?.outputFormat, command),
        sandbox: body.sandbox ?? body.adapter?.sandbox ?? null,
      },
      capabilities: [
        {
          name: body.capabilityName ?? "manual_cli_task",
          description: body.capabilityDescription ?? "Runs a manually registered local CLI command.",
          riskLevel: normalizeRiskLevel(body.riskLevel, codexCommand ? "high" : "medium"),
          riskTags: normalizeRiskTags(body.riskTags ?? body.capabilityRiskTags, codexCommand ? codexRiskTags() : ["read_local", "shell_exec"]),
        },
      ],
      status: state.device.status === "online" ? "available" : "unavailable",
      registrationNotes: codexCommand ? codexRegistrationNotes() : {
        risk: "Runs a local command with structured argv. Review the command, arguments, working directory, and environment before invoking.",
        data: "Task input and command output are streamed to the local demo server as invocation events.",
        cost: "Cost is external or unknown unless the registered command reports it.",
        cancellation: "The Desktop Bridge attempts to terminate the process tree when cancellation is requested.",
      },
      economics: normalizeAgentEconomics(body),
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
      registrationNotes: {
        risk: "Sends invocation input to the configured HTTP endpoint.",
        data: "Task input leaves the local demo server and endpoint response is stored as the result.",
        cost: "Cost is external or unknown unless the endpoint reports it.",
        cancellation: "The server aborts the HTTP request when supported; otherwise cancellation is recorded as not supported or unknown.",
      },
      economics: normalizeAgentEconomics(body),
    });
  }

  function baseAgent({ id, name, description, location, adapter, capabilities, status, registrationNotes, economics = {} }) {
    const createdAt = now();
    return {
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
  }

  function disableAgent(agent) {
    const operation = createLifecycleOperation(agent, "disable", "Disabled from Web Console.");
    startLifecycleOperation(operation, `Disabling ${agent.name}.`);
    agent.lifecycle = { ...agent.lifecycle, state: "disabled" };
    agent.status = "disabled";
    agent.updatedAt = now();
    finishLifecycleOperation(operation, "succeeded", `${agent.name} is disabled. New invocations are blocked.`);
    return operation;
  }

  function enableAgent(agent) {
    const operation = createLifecycleOperation(agent, "enable", "Enabled from Web Console.");
    startLifecycleOperation(operation, `Enabling ${agent.name}.`);
    agent.lifecycle = { ...agent.lifecycle, state: "enabled" };
    agent.status = enabledAgentStatus(agent);
    agent.updatedAt = now();
    finishLifecycleOperation(operation, "succeeded", `${agent.name} is enabled.`);
    return operation;
  }

  function createAgentHealthCheck(agent) {
    const operation = createLifecycleOperation(agent, "health_check", "Health check requested from Web Console.");
    state.healthChecks.unshift(operation);
    state.healthChecks = state.healthChecks.slice(0, 50);
    agent.health = {
      status: "checking",
      checkedAt: null,
      message: "Health check requested.",
      nextAction: "Wait for the health result.",
    };
    agent.updatedAt = now();

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

  function createLifecycleOperation(agent, operation, reason) {
    const createdAt = now();
    const record = {
      id: nextId("lco_demo"),
      agentId: agent.id,
      deviceId: agent.location.type === "local_device" ? agent.location.deviceId : undefined,
      requestedBy: "usr_local",
      operation,
      status: "queued",
      reason,
      message: `${operation.replaceAll("_", " ")} queued for ${agent.name}.`,
      createdAt,
      completedAt: null,
    };
    state.lifecycleAuditRecords.unshift(record);
    state.lifecycleAuditRecords = state.lifecycleAuditRecords.slice(0, 100);
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
      return agent?.adapter.type === "cli" && agent.location.type === "local_device";
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
  return isCodexCliCommand(command) ? "codex_jsonl" : "plain_result";
}

export function codexRegistrationNotes() {
  return {
    risk: "Runs Codex CLI in non-interactive mode. Repository access, sandbox, approvals, and file-change permissions are governed by Codex CLI native controls.",
    data: "Task input, Codex JSONL events, command output, trace, and result summary are recorded by the local demo server.",
    cost: "Codex cost is external or unknown to the demo server and remains visible for review.",
    cancellation: "The Desktop Bridge attempts to terminate the Codex process tree when cancellation is requested.",
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
