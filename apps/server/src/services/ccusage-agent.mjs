export const CCUSAGE_VERSION = "20.0.14";

export const CCUSAGE_REPORT_SPECS = [
  {
    id: "daily",
    agentId: "agt_ccusage_daily",
    name: "ccusage Daily Report",
    description: "Reads local coding-agent usage data and reports daily token/cost usage.",
    args: ["daily"],
  },
  {
    id: "weekly",
    agentId: "agt_ccusage_weekly",
    name: "ccusage Weekly Report",
    description: "Reads local coding-agent usage data and reports weekly token/cost usage.",
    args: ["weekly"],
  },
  {
    id: "monthly",
    agentId: "agt_ccusage_monthly",
    name: "ccusage Monthly Report",
    description: "Reads local coding-agent usage data and reports monthly token/cost usage.",
    args: ["monthly"],
  },
  {
    id: "session",
    agentId: "agt_ccusage_session",
    name: "ccusage Session Report",
    description: "Reads local coding-agent usage data and reports session-level token/cost usage.",
    args: ["session"],
  },
  {
    id: "codex_daily",
    agentId: "agt_ccusage_codex_daily",
    name: "ccusage Codex Daily Report",
    description: "Reads local Codex usage data and reports daily token/cost usage.",
    args: ["codex", "daily"],
  },
  {
    id: "claude_daily",
    agentId: "agt_ccusage_claude_daily",
    name: "ccusage Claude Daily Report",
    description: "Reads local Claude Code usage data and reports daily token/cost usage.",
    args: ["claude", "daily"],
  },
];

export const CCUSAGE_TOOL_CONTRACT = {
  name: "ccusage.report",
  version: "1",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["report"],
    properties: {
      report: { enum: CCUSAGE_REPORT_SPECS.map((spec) => spec.id) },
      source: { enum: ["all", "codex", "claude"] },
      since: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      until: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      timezone: { type: "string", maxLength: 64 },
      offline: { const: true },
      projectId: { type: "string" },
    },
  },
  outputSchema: {
    source: "ccusage",
    structuredResult: true,
    imports: {
      collection: "importedUsageEstimates",
      amountSource: "imported_ccusage_report",
      economicModel: "external_billed",
      authoritative: false,
    },
  },
  errorCodes: [
    "invalid_input",
    "unknown_field",
    "project_required",
    "unsupported_report",
    "unsupported_source",
    "source_report_mismatch",
    "invalid_date_filter",
    "invalid_timezone",
    "approval_required",
    "agent_not_available",
  ],
};

export function createCcusageAgentRegistration({
  reportId = "daily",
  cliScriptPath,
  wrapperScriptPath = "tools/agents/ccusage-wrapper.mjs",
  costOwner = "usr_local",
  currency = "USD",
} = {}) {
  const spec = CCUSAGE_REPORT_SPECS.find((item) => item.id === reportId);
  if (!spec) {
    throw new Error(`Unsupported ccusage report id: ${reportId}`);
  }
  const scriptPath = String(cliScriptPath ?? "").trim();
  if (!scriptPath) {
    throw new Error("ccusage cliScriptPath is required.");
  }
  const wrapperPath = String(wrapperScriptPath ?? "").trim();
  if (!wrapperPath) {
    throw new Error("ccusage wrapperScriptPath is required.");
  }
  return {
    id: spec.agentId,
    type: "cli",
    name: spec.name,
    description: spec.description,
    command: "node",
    args: [wrapperPath, "--ccusage-cli", scriptPath, "--report", spec.id],
    timeoutSeconds: 60,
    outputFormat: "plain_result",
    toolContract: CCUSAGE_TOOL_CONTRACT,
    capabilityName: "usage_cost_report",
    capabilityDescription: "Generate a read-only local usage and cost report from ccusage.",
    riskLevel: "low",
    riskTags: ["read_only", "read_local", "shell_exec"],
    economicModel: "free",
    pricingDimensions: [],
    currency,
    costOwner,
    unknownCostPolicy: "warn",
    registrationNotes: {
      risk: "Runs a fixed ccusage report command. User prompt text is not rendered into CLI arguments.",
      data: "Reads local coding-agent usage records and stores command output in invocation events/results.",
      cost: "ccusage is treated as a free local reporting tool; reported provider costs are external estimates.",
      cancellation: "The Desktop Bridge attempts to terminate the ccusage process tree when cancellation is requested.",
    },
  };
}

export function createCcusageAgentRegistrations(options = {}) {
  return CCUSAGE_REPORT_SPECS.map((spec) => createCcusageAgentRegistration({ ...options, reportId: spec.id }));
}

export function isGovernedCcusageAgent(agent) {
  if (!agent) {
    return false;
  }
  const hasCcusageId = CCUSAGE_REPORT_SPECS.some((spec) => spec.agentId === agent.id);
  const hasToolContract = agent.toolContract?.name === CCUSAGE_TOOL_CONTRACT.name;
  const hasReportCapability = (agent.capabilities ?? []).some((capability) => capability?.name === "usage_cost_report");
  const adapterArgs = Array.isArray(agent.adapter?.args) ? agent.adapter.args.map(String) : [];
  const usesWrapper = adapterArgs.some((arg) => arg.endsWith("ccusage-wrapper.mjs"));
  return hasCcusageId && hasToolContract && hasReportCapability && usesWrapper;
}

export function createCcusageLifecycleRecipeInput({
  action = "install",
  agentId = "agt_ccusage_daily",
  requestedBy = "usr_local",
} = {}) {
  const normalized = String(action ?? "install");
  if (!["install", "update", "uninstall"].includes(normalized)) {
    throw new Error(`Unsupported ccusage lifecycle action: ${normalized}`);
  }
  const command = normalized === "uninstall"
    ? {
        summary: "Uninstall the pinned ccusage package from the global npm prefix.",
        commandId: "npm_global_uninstall_package",
        executable: "npm",
        args: ["uninstall", "-g", "ccusage"],
      }
    : {
        summary: "Install the pinned ccusage package into the global npm prefix.",
        commandId: "npm_global_install_pinned",
        executable: "npm",
        args: ["install", "-g", `ccusage@${CCUSAGE_VERSION}`],
      };
  return {
    agentId,
    action: normalized,
    name: `${titleCase(normalized)} ccusage ${normalized === "uninstall" ? "" : CCUSAGE_VERSION}`.trim(),
    description: "Pinned ccusage lifecycle recipe. Package-manager execution remains gated by review and local approval.",
    source: {
      type: "manual_entry",
      uri: `npm://ccusage@${CCUSAGE_VERSION}`,
      author: "myagenttool",
      version: CCUSAGE_VERSION,
      signatureStatus: "not_required",
      compatibilityRange: `=${CCUSAGE_VERSION}`,
    },
    requestedBy,
    supportedPlatforms: ["windows", "macos", "linux"],
    expectedBinary: "ccusage",
    requiredPermissions: ["npm_global_package_write"],
    riskLevel: "high",
    riskTags: normalized === "uninstall"
      ? ["write_local", "shell_exec", "destructive"]
      : ["write_local", "network_access", "shell_exec"],
    recipeCommand: command,
    healthCheck: {
      type: "cli",
      summary: "ccusage --version should succeed after lifecycle execution.",
      command: {
        commandId: "ccusage_version",
        executable: "ccusage",
        args: ["--version"],
      },
    },
    rollback: {
      available: false,
      strategy: "manual",
      summary: "Rollback is manual: uninstall ccusage or install a previously approved pinned version.",
    },
    uninstall: normalized === "uninstall"
      ? {
          bridgeManagedOnly: true,
          deletesUnderlyingSoftware: true,
          requiresExtraConfirmation: true,
          manualAgentRegistryOnly: false,
          summary: "Uninstall removes the bridge-managed global ccusage package after explicit local approval.",
        }
      : undefined,
  };
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\w\S*/g, (word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`);
}
