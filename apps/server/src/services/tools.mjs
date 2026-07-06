import {
  CCUSAGE_REPORT_SPECS,
  CCUSAGE_TOOL_CONTRACT,
} from "./ccusage-agent.mjs";
import { describeMcpToolCall } from "@myagenttool/adapters/mcp";
import { CCUSAGE_APPLICATION_ID } from "./ccusage-application.mjs";
import {
  CODEX_REVIEW_TOOL_CONTRACT,
  isGovernedCodexReviewAgent,
} from "./codex-agent.mjs";
import {
  CLAUDE_REVIEW_TOOL_CONTRACT,
  isGovernedClaudeReviewAgent,
} from "./claude-agent.mjs";
import { agentVisibleToActor, teamOf } from "../runtime/auth.mjs";

const CCUSAGE_APPROVAL_REQUIRED_REPORTS = new Set(["session"]);
const MCP_TOOL_CONTROL_FIELDS = new Set([
  "arguments",
  "approvalToken",
  "idempotencyKey",
  "projectId",
  "timeoutSeconds",
  "toolArguments",
]);

export function createToolService({
  state,
  now,
  appendEvent,
  createInvocation,
  startInvocationIfAllowed,
  findApplication,
  findAgent,
  planApplicationWrapperInvocation,
}) {
  function listTools(actor = null) {
    return discoverTools(actor);
  }

  function getTool(name, actor = null) {
    return discoverTools(actor).find((tool) => tool.name === name) ?? null;
  }

  function createToolInvocation(name, input = {}, actor = null) {
    if (name === CCUSAGE_TOOL_CONTRACT.name) {
      return createCcusageToolInvocation(input, actor);
    }
    if (name === CODEX_REVIEW_TOOL_CONTRACT.name) {
      return createReviewInvocation({
        input,
        actor,
        contract: CODEX_REVIEW_TOOL_CONTRACT,
        selectAgent: selectCodexReviewAgent,
        buildTask: buildCodexReviewTask,
        outputCollection: "codexReviewFindings",
        agentLabel: "Codex",
      });
    }
    if (name === CLAUDE_REVIEW_TOOL_CONTRACT.name) {
      return createReviewInvocation({
        input,
        actor,
        contract: CLAUDE_REVIEW_TOOL_CONTRACT,
        selectAgent: selectClaudeReviewAgent,
        buildTask: buildClaudeReviewTask,
        outputCollection: "claudeReviewFindings",
        agentLabel: "Claude",
      });
    }
    const mcpTool = findMcpToolDescriptor(name, actor);
    if (mcpTool) {
      return createMcpToolInvocation(mcpTool, input, actor);
    }
    return { status: 404, body: { error: "tool_not_found" } };
  }

  function createCcusageToolInvocation(input, actor) {
    const validation = validateCcusageReportInput(input);
    if (!validation.ok) {
      return { status: validation.status, body: validation.body };
    }
    const value = validation.value;
    // Backed by the ccusage Application capability path (#355 full unification),
    // not bespoke agents. The ccusage app is a platform-shared asset and this tool
    // is the platform-wide authorization boundary, so we plan in platform context
    // (actor: null for the app tenancy gate) — ccusage reports are non-team-scoped
    // local usage data. The real caller is still recorded via requestedBy.
    const application = resolveCcusageApp();
    if (!application || !["registered", "active"].includes(application.status)) {
      return { status: 409, body: { error: "application_not_available", message: "The ccusage application is not registered. Run `pnpm ccusage:register-app`." } };
    }
    const runner = findAgent("agt_platform_application_wrapper");
    if (!runner || runner.status === "disabled") {
      return { status: 409, body: { error: "agent_not_available", message: "The platform Application Wrapper Runner agent is not available." } };
    }
    const project = resolveToolProjectId(value.projectId, actor);
    if (!project.ok) {
      return { status: project.status, body: project.body };
    }
    const projectId = project.value;
    const planned = planApplicationWrapperInvocation({
      applicationId: application.id,
      commandId: value.report,
      input: { since: value.since, until: value.until, timezone: value.timezone },
      actor: null,
    });
    if (!planned.ok) {
      return { status: planned.status, body: planned.body };
    }
    const invocation = createInvocation(buildCcusageTask(value), runner, {
      actor,
      requestedBy: actor?.userId,
      metadata: {
        tool: CCUSAGE_TOOL_CONTRACT.name,
        toolVersion: CCUSAGE_TOOL_CONTRACT.version,
        capability: planned.wrapper.capability,
        providerType: "application",
        applicationId: application.id,
        applicationPath: planned.wrapper.applicationPath ?? null,
        applicationWrapper: planned.wrapper,
        report: value.report,
        filters: {
          since: value.since ?? null,
          until: value.until ?? null,
          timezone: value.timezone ?? null,
          offline: value.offline,
        },
        projectId,
      },
      timeoutSeconds: planned.timeoutSeconds ?? 60,
    });
    startInvocationIfAllowed(invocation, runner);
    appendEvent({
      invocationId: invocation.id,
      type: "tool_invocation_created",
      level: "info",
      message: `Tool ${CCUSAGE_TOOL_CONTRACT.name} created ${value.report} invocation.`,
      data: {
        tool: CCUSAGE_TOOL_CONTRACT.name,
        version: CCUSAGE_TOOL_CONTRACT.version,
        report: value.report,
        agentId: runner.id,
      },
    });
    return {
      status: 201,
      body: {
        tool: CCUSAGE_TOOL_CONTRACT.name,
        invocationId: invocation.id,
        agentId: runner.id,
        status: invocation.status,
        outputCollection: "importedUsageEstimates",
        invocation,
      },
    };
  }

  function createReviewInvocation({ input, actor, contract, selectAgent, buildTask, outputCollection, agentLabel }) {
    const validation = validateReviewInput(input);
    if (!validation.ok) {
      return { status: validation.status, body: validation.body };
    }
    const value = validation.value;
    const project = resolveToolProjectId(value.projectId, actor);
    if (!project.ok) {
      return { status: project.status, body: project.body };
    }
    const projectId = project.value;
    const worktree = findToolWorktree(value.worktreeId, projectId);
    if (!worktree) {
      return { status: 404, body: { error: "worktree_not_found" } };
    }
    const agent = selectAgent(actor);
    if (!agent) {
      return { status: 409, body: { error: "agent_not_available", message: `No governed ${agentLabel} diff review agent is available.` } };
    }
    if (agent.status === "disabled") {
      return { status: 409, body: { error: "agent_not_available", message: `The governed ${agentLabel} diff review agent is disabled.`, agentId: agent.id } };
    }
    if (agent.health?.status === "unhealthy") {
      return { status: 409, body: { error: "agent_not_available", message: agent.health.message ?? `The governed ${agentLabel} diff review agent is unhealthy.`, agentId: agent.id } };
    }
    if (agent.location?.type === "local_device" && state.device?.unlinkState === "unlinked") {
      return { status: 409, body: { error: "agent_not_available", message: "The local device is unlinked.", agentId: agent.id } };
    }
    const invocation = createInvocation(buildTask(value), agent, {
      actor,
      requestedBy: actor?.userId,
      metadata: {
        tool: contract.name,
        toolVersion: contract.version,
        projectId,
        worktreeId: worktree.id,
        severityFloor: value.severityFloor,
        instruction: value.instruction,
      },
      timeoutSeconds: 120,
    });
    startInvocationIfAllowed(invocation, agent);
    appendEvent({
      invocationId: invocation.id,
      type: "tool_invocation_created",
      level: "info",
      message: `Tool ${contract.name} created diff review invocation.`,
      data: {
        tool: contract.name,
        version: contract.version,
        agentId: agent.id,
        worktreeId: worktree.id,
      },
    });
    return {
      status: 201,
      body: {
        tool: contract.name,
        invocationId: invocation.id,
        agentId: agent.id,
        status: invocation.status,
        outputCollection,
        invocation,
      },
    };
  }

  function createMcpToolInvocation(tool, input, actor) {
    const validation = validateMcpToolInput(input);
    if (!validation.ok) {
      return { status: validation.status, body: validation.body };
    }
    const value = validation.value;
    const agent = findAgent(tool.mcp.agentId);
    if (!agent) {
      return { status: 409, body: { error: "agent_not_available", message: "The registered MCP agent is not available." } };
    }
    if (agent.status === "disabled") {
      return { status: 409, body: { error: "agent_disabled", agentId: agent.id } };
    }
    if (agent.health?.status === "unhealthy") {
      return { status: 409, body: { error: "agent_unhealthy", message: agent.health.message, agentId: agent.id } };
    }
    if (agent.location?.type === "local_device" && state.device?.unlinkState === "unlinked") {
      return { status: 409, body: { error: "device_unlinked", agentId: agent.id } };
    }
    const project = resolveToolProjectId(value.projectId, actor);
    if (!project.ok) {
      return { status: project.status, body: project.body };
    }
    const projectId = project.value;
    try {
      describeMcpToolCall(agent.adapter, tool.mcp.toolName, value.toolArguments);
    } catch (error) {
      return {
        status: /allowed tools/i.test(error?.message ?? "") ? 409 : 400,
        body: {
          error: /allowed tools/i.test(error?.message ?? "") ? "mcp_tool_not_allowed" : "invalid_mcp_tool_call",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    const timeoutSeconds = value.timeoutSeconds ?? Math.ceil(Number(agent.adapter?.timeoutMs ?? 60_000) / 1000);
    const application = agent.sourceApplicationId ? findApplication?.(agent.sourceApplicationId) ?? null : null;
    const invocation = createInvocation(value.task ?? `Call MCP tool ${tool.mcp.toolName} via ${agent.name}.`, agent, {
      actor,
      requestedBy: actor?.userId,
      toolName: tool.mcp.toolName,
      toolArguments: value.toolArguments,
      timeoutSeconds,
      metadata: {
        tool: tool.name,
        toolVersion: tool.version,
        providerType: "mcp",
        mcpAgentId: agent.id,
        mcpToolName: tool.mcp.toolName,
        capability: tool.name,
        applicationId: application?.id ?? agent.sourceApplicationId ?? null,
        applicationName: application?.name ?? null,
        applicationAction: "mcp_tool_call",
        outputCollection: "invocations",
        projectId,
      },
    });
    startInvocationIfAllowed(invocation, agent);
    appendEvent({
      invocationId: invocation.id,
      type: "tool_invocation_created",
      level: "info",
      message: `Tool ${tool.name} created MCP invocation ${tool.mcp.toolName}.`,
      data: {
        tool: tool.name,
        version: tool.version,
        agentId: agent.id,
        mcpToolName: tool.mcp.toolName,
      },
    });
    return {
      status: 201,
      body: {
        tool: tool.name,
        invocationId: invocation.id,
        agentId: agent.id,
        status: invocation.status,
        outputCollection: "invocations",
        invocation,
      },
    };
  }

  // The ccusage app backs the tool; when the app service isn't wired (review-only
  // harnesses) the tool is simply absent.
  function resolveCcusageApp() {
    return typeof findApplication === "function" ? findApplication(CCUSAGE_APPLICATION_ID) : null;
  }

  function discoverTools(actor = null) {
    const ccusageApp = resolveCcusageApp();
    const ccusageAvailable = ccusageApp && ["registered", "active"].includes(ccusageApp.status);
    const codexReviewAgents = (state.agents ?? []).filter((agent) => isGovernedCodexReviewAgent(agent) && agentVisibleToActor(state, agent, actor));
    const claudeReviewAgents = (state.agents ?? []).filter((agent) => isGovernedClaudeReviewAgent(agent) && agentVisibleToActor(state, agent, actor));
    const mcpAgents = (state.agents ?? []).filter((agent) => agentVisibleToActor(state, agent, actor));
    const builtinNames = new Set([
      ...(ccusageAvailable ? [CCUSAGE_TOOL_CONTRACT.name] : []),
      ...(codexReviewAgents.length ? [CODEX_REVIEW_TOOL_CONTRACT.name] : []),
      ...(claudeReviewAgents.length ? [CLAUDE_REVIEW_TOOL_CONTRACT.name] : []),
    ]);
    return [
      ...(ccusageAvailable ? [buildCcusageToolDescriptor(ccusageApp)] : []),
      ...(codexReviewAgents.length ? [buildCodexReviewToolDescriptor(codexReviewAgents)] : []),
      ...(claudeReviewAgents.length ? [buildClaudeReviewToolDescriptor(claudeReviewAgents)] : []),
      ...buildMcpToolDescriptors({ agents: mcpAgents, usedNames: builtinNames }),
    ];
  }

  function findMcpToolDescriptor(name, actor = null) {
    const mcpAgents = (state.agents ?? []).filter((agent) => agentVisibleToActor(state, agent, actor));
    return buildMcpToolDescriptors({ agents: mcpAgents, usedNames: new Set([
      CCUSAGE_TOOL_CONTRACT.name,
      CODEX_REVIEW_TOOL_CONTRACT.name,
      CLAUDE_REVIEW_TOOL_CONTRACT.name,
    ]) }).find((tool) => tool.name === name) ?? null;
  }

  function selectCodexReviewAgent(actor = null) {
    return (state.agents ?? []).find((agent) => isGovernedCodexReviewAgent(agent) && agentVisibleToActor(state, agent, actor)) ?? null;
  }

  function selectClaudeReviewAgent(actor = null) {
    return (state.agents ?? []).find((agent) => isGovernedClaudeReviewAgent(agent) && agentVisibleToActor(state, agent, actor)) ?? null;
  }

  function resolveToolProjectId(projectId, actor) {
    if (projectId) {
      const project = (state.projects ?? []).find((item) => item.id === projectId);
      if (!project || (actor?.teamId && teamOf(project) !== actor.teamId)) {
        return { ok: false, status: 404, body: { error: "project_not_found" } };
      }
      return { ok: true, value: project.id };
    }
    if (!actor?.teamId) {
      const defaultProjectId = state.currentProjectId ?? state.projects?.[0]?.id ?? null;
      return defaultProjectId
        ? { ok: true, value: defaultProjectId }
        : { ok: false, status: 400, body: { error: "project_required", message: "A projectId is required when no actor-owned default project is available." } };
    }
    const ownedProjectId = (state.projects ?? []).find((project) => teamOf(project) === actor.teamId)?.id ?? null;
    return ownedProjectId
      ? { ok: true, value: ownedProjectId }
      : { ok: false, status: 400, body: { error: "project_required", message: "A projectId is required when no actor-owned default project is available." } };
  }

  function findToolWorktree(worktreeId, projectId) {
    const worktree = (state.worktrees ?? []).find((item) => item.id === worktreeId);
    if (!worktree) {
      return null;
    }
    return worktree.projectId === projectId || worktree.workspaceProjectId === projectId
      ? worktree
      : null;
  }

  return {
    createToolInvocation,
    getTool,
    listTools,
    validateCodexReviewInput,
    validateClaudeReviewInput,
    validateCcusageReportInput,
  };
}

function buildMcpToolDescriptors({ agents, usedNames }) {
  const tools = [];
  for (const agent of agents ?? []) {
    if (agent?.adapter?.type !== "mcp") continue;
    const allowedTools = normalizeStringList(agent.adapter.allowedTools);
    if (allowedTools.length === 0) continue;
    const namespace = mcpToolNamespace(agent);
    for (const toolName of allowedTools) {
      const baseName = `${namespace}.${slugifyToolSegment(toolName)}`;
      const name = uniqueCapabilityName(baseName, usedNames);
      tools.push(buildMcpToolDescriptor({ name, agent, toolName }));
    }
  }
  return tools;
}

function buildMcpToolDescriptor({ name, agent, toolName }) {
  const riskLevel = highestRiskLevel((agent.capabilities ?? []).map((capability) => capability?.riskLevel));
  const riskTags = uniqueStrings([
    "mcp",
    agent.adapter?.transport === "http" ? "mcp_http" : "mcp_stdio",
    ...(agent.capabilities ?? []).flatMap((capability) => capability?.riskTags ?? []),
  ]);
  return {
    name,
    version: "1",
    displayName: toolName,
    description: `Call MCP tool ${toolName} exposed by ${agent.name}.`,
    riskLevel,
    riskTags,
    requiresLocalDevice: agent.location?.type === "local_device",
    inputSchema: mcpToolInputSchema(),
    outputSchema: {
      type: "object",
      additionalProperties: true,
      description: "MCP tool result stored on the invocation.",
    },
    agents: [{
      id: agent.id,
      name: agent.name,
      status: agent.health?.status === "unhealthy" ? "unhealthy" : agent.status,
      transport: agent.adapter?.transport ?? "stdio",
      toolName,
    }],
    approvalPolicy: {
      defaultAllowedTools: "allowed",
      unknownTool: "blocked",
    },
    authoritativeBilling: false,
    outputCollection: "invocations",
    source: "mcp_agent",
    metadata: {
      readiness: {
        state: agent.status === "disabled" ? "disabled" : agent.health?.status === "unhealthy" ? "needs_setup" : "ready",
        reason: "mcp_agent_registered",
        executionMode: agent.adapter?.transport === "http" ? "mcp_http" : "mcp_stdio",
      },
      resultPath: {
        outputCollection: "invocations",
        evidenceCenter: true,
      },
      mcp: {
        agentId: agent.id,
        toolName,
      },
    },
    application: agent.sourceApplicationId ? { id: agent.sourceApplicationId } : null,
    mcp: {
      agentId: agent.id,
      toolName,
      transport: agent.adapter?.transport ?? "stdio",
    },
  };
}

function mcpToolInputSchema() {
  return {
    type: "object",
    additionalProperties: true,
    properties: {
      projectId: { type: "string" },
      toolArguments: {
        type: "object",
        additionalProperties: true,
        description: "Arguments passed to the MCP tool. If omitted, non-control top-level fields become tool arguments.",
      },
      timeoutSeconds: { type: "number" },
    },
  };
}

function mcpToolNamespace(agent) {
  const explicit =
    stringOrNull(agent.toolNamespace) ??
    stringOrNull(agent.capabilityPrefix) ??
    stringOrNull(agent.adapter?.toolNamespace) ??
    stringOrNull(agent.adapter?.capabilityPrefix);
  const raw = explicit ?? stringOrNull(agent.id) ?? stringOrNull(agent.name) ?? "mcp";
  const normalized = slugifyToolSegment(raw)
    .replace(/^agt_/, "")
    .replace(/_mcp$/, "");
  return normalized || "mcp";
}

function slugifyToolSegment(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return text || "tool";
}

function uniqueCapabilityName(baseName, usedNames) {
  let name = baseName;
  let suffix = 2;
  while (usedNames.has(name)) {
    name = `${baseName}_${suffix}`;
    suffix += 1;
  }
  usedNames.add(name);
  return name;
}

function buildCcusageToolDescriptor(app) {
  // Derived from the ccusage Application (#355 full unification): one descriptor
  // entry per report capability, so /api/tools survives the bespoke agents'
  // retirement. Execution runs via the platform Application Wrapper Runner.
  const status = app.status === "active" ? "available" : "registered";
  return {
    name: CCUSAGE_TOOL_CONTRACT.name,
    version: CCUSAGE_TOOL_CONTRACT.version,
    displayName: "ccusage Usage Report",
    description: "Generate governed local usage and cost reports from ccusage.",
    riskLevel: "low",
    riskTags: ["read_only", "read_local", "shell_exec"],
    requiresLocalDevice: true,
    inputSchema: CCUSAGE_TOOL_CONTRACT.inputSchema,
    outputSchema: CCUSAGE_TOOL_CONTRACT.outputSchema,
    agents: CCUSAGE_REPORT_SPECS.map((spec) => ({
      id: `app.${app.id}.wrapper.${spec.id}`,
      name: spec.name,
      status,
      report: spec.id,
    })),
    approvalPolicy: {
      defaultOfflineReports: "allowed",
      session: "approval_required",
      online: "approval_required",
      rawExport: "approval_required",
    },
    authoritativeBilling: false,
    outputCollection: "importedUsageEstimates",
  };
}

function buildCodexReviewToolDescriptor(agents) {
  return {
    name: CODEX_REVIEW_TOOL_CONTRACT.name,
    version: CODEX_REVIEW_TOOL_CONTRACT.version,
    displayName: "Codex Diff Review",
    description: "Run a governed read-only Codex review over a project worktree diff.",
    riskLevel: "low",
    riskTags: ["read_only", "read_project", "code_review", "local_agent"],
    requiresLocalDevice: true,
    inputSchema: CODEX_REVIEW_TOOL_CONTRACT.inputSchema,
    outputSchema: CODEX_REVIEW_TOOL_CONTRACT.outputSchema,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      mode: "diff-review",
    })),
    approvalPolicy: {
      defaultReadOnlyReview: "allowed",
      patchProposal: "approval_required",
      applyPatch: "approval_required",
    },
    authoritativeBilling: false,
    outputCollection: "codexReviewFindings",
  };
}

function buildClaudeReviewToolDescriptor(agents) {
  return {
    name: CLAUDE_REVIEW_TOOL_CONTRACT.name,
    version: CLAUDE_REVIEW_TOOL_CONTRACT.version,
    displayName: "Claude Diff Review",
    description: "Run a governed read-only Claude review over a project worktree diff.",
    riskLevel: "low",
    riskTags: ["read_only", "read_project", "code_review", "local_agent"],
    requiresLocalDevice: true,
    inputSchema: CLAUDE_REVIEW_TOOL_CONTRACT.inputSchema,
    outputSchema: CLAUDE_REVIEW_TOOL_CONTRACT.outputSchema,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      mode: "diff-review",
    })),
    approvalPolicy: {
      defaultReadOnlyReview: "allowed",
      patchProposal: "approval_required",
      applyPatch: "approval_required",
    },
    authoritativeBilling: false,
    outputCollection: "claudeReviewFindings",
  };
}

function validateCcusageReportInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, body: { error: "invalid_input", message: "Tool input must be an object." } };
  }
  const allowed = new Set(["report", "source", "since", "until", "timezone", "offline", "projectId"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) {
    return { ok: false, status: 400, body: { error: "unknown_field", fields: unknown } };
  }
  const report = String(input.report ?? "").trim();
  if (!CCUSAGE_REPORT_SPECS.some((spec) => spec.id === report)) {
    return { ok: false, status: 400, body: { error: "unsupported_report" } };
  }
  if (CCUSAGE_APPROVAL_REQUIRED_REPORTS.has(report)) {
    return { ok: false, status: 409, body: { error: "approval_required", reason: "Session-level ccusage reports require explicit approval." } };
  }
  const offline = input.offline === undefined ? true : input.offline;
  if (offline !== true) {
    return { ok: false, status: 409, body: { error: "approval_required", reason: "Online ccusage reports require explicit approval." } };
  }
  const source = input.source === undefined ? "all" : String(input.source);
  if (!["all", "codex", "claude"].includes(source)) {
    return { ok: false, status: 400, body: { error: "unsupported_source" } };
  }
  if ((source === "codex" && !report.startsWith("codex_")) || (source === "claude" && !report.startsWith("claude_"))) {
    return { ok: false, status: 400, body: { error: "source_report_mismatch" } };
  }
  const since = optionalDate(input.since, "since");
  if (!since.ok) return since;
  const until = optionalDate(input.until, "until");
  if (!until.ok) return until;
  const timezone = optionalTimezone(input.timezone);
  if (!timezone.ok) return timezone;
  return {
    ok: true,
    value: {
      report,
      source,
      since: since.value,
      until: until.value,
      timezone: timezone.value,
      offline: true,
      projectId: stringOrNull(input.projectId),
    },
  };
}

function optionalDate(value, field) {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? { ok: true, value: text }
    : { ok: false, status: 400, body: { error: "invalid_date_filter", field } };
}

function optionalTimezone(value) {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  const text = String(value).trim();
  // No leading "-": aligns with the wrapper capability's `token` validator so a
  // timezone that would be dropped downstream is rejected here with a clear error
  // instead of silently ignored.
  return /^[A-Za-z0-9_+/:.][A-Za-z0-9_+\-/:.]{0,63}$/.test(text)
    ? { ok: true, value: text }
    : { ok: false, status: 400, body: { error: "invalid_timezone" } };
}

function validateReviewInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, body: { error: "invalid_input", message: "Tool input must be an object." } };
  }
  const allowed = new Set(["projectId", "worktreeId", "instruction", "severityFloor"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) {
    return { ok: false, status: 400, body: { error: "unknown_field", fields: unknown } };
  }
  const worktreeId = stringOrNull(input.worktreeId);
  if (!worktreeId) {
    return { ok: false, status: 400, body: { error: "worktree_required" } };
  }
  const severityFloor = input.severityFloor === undefined ? "low" : String(input.severityFloor);
  if (!["low", "medium", "high"].includes(severityFloor)) {
    return { ok: false, status: 400, body: { error: "invalid_severity_floor" } };
  }
  const instruction = input.instruction === undefined || input.instruction === null
    ? null
    : String(input.instruction).trim();
  if (instruction && instruction.length > 1200) {
    return { ok: false, status: 400, body: { error: "instruction_too_long", maxLength: 1200 } };
  }
  return {
    ok: true,
    value: {
      projectId: stringOrNull(input.projectId),
      worktreeId,
      instruction,
      severityFloor,
    },
  };
}

function validateMcpToolInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, body: { error: "invalid_input", message: "Tool input must be an object." } };
  }
  const explicitArguments = input.toolArguments ?? input.arguments;
  let toolArguments = null;
  if (explicitArguments !== undefined) {
    if (!explicitArguments || typeof explicitArguments !== "object" || Array.isArray(explicitArguments)) {
      return { ok: false, status: 400, body: { error: "invalid_tool_arguments", message: "MCP tool arguments must be an object." } };
    }
    toolArguments = { ...explicitArguments };
  } else {
    toolArguments = Object.fromEntries(
      Object.entries(input).filter(([key]) => !MCP_TOOL_CONTROL_FIELDS.has(key)),
    );
  }
  const timeoutSeconds = optionalPositiveSeconds(input.timeoutSeconds);
  if (!timeoutSeconds.ok) return timeoutSeconds;
  return {
    ok: true,
    value: {
      projectId: stringOrNull(input.projectId),
      task: stringOrNull(input.task),
      timeoutSeconds: timeoutSeconds.value,
      toolArguments,
    },
  };
}

function validateCodexReviewInput(input = {}) {
  return validateReviewInput(input);
}

function validateClaudeReviewInput(input = {}) {
  return validateReviewInput(input);
}

function buildCcusageTask(value) {
  const filters = [
    value.since ? `since ${value.since}` : null,
    value.until ? `until ${value.until}` : null,
    value.timezone ? `timezone ${value.timezone}` : null,
  ].filter(Boolean);
  return filters.length
    ? `Generate ccusage ${value.report.replaceAll("_", " ")} report (${filters.join(", ")}).`
    : `Generate ccusage ${value.report.replaceAll("_", " ")} report.`;
}

function buildCodexReviewTask(value) {
  const suffix = value.instruction ? ` Instruction: ${value.instruction}` : "";
  return `Review the selected worktree diff with Codex. Severity floor: ${value.severityFloor}.${suffix}`;
}

function buildClaudeReviewTask(value) {
  const suffix = value.instruction ? ` Instruction: ${value.instruction}` : "";
  return `Review the selected worktree diff with Claude. Severity floor: ${value.severityFloor}.${suffix}`;
}

function optionalPositiveSeconds(value) {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return { ok: false, status: 400, body: { error: "invalid_timeout_seconds" } };
  }
  return { ok: true, value: Math.ceil(number) };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function highestRiskLevel(values) {
  const order = new Map(["low", "medium", "high", "critical"].map((level, index) => [level, index]));
  let highest = null;
  for (const value of values ?? []) {
    const level = order.has(value) ? value : "medium";
    if (!highest || order.get(level) > order.get(highest)) highest = level;
  }
  return highest ?? "medium";
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}
