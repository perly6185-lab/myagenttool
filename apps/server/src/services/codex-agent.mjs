export const CODEX_REVIEW_TOOL_CONTRACT = {
  name: "codex.review.diff",
  version: "1",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["worktreeId"],
    properties: {
      projectId: { type: "string" },
      worktreeId: { type: "string" },
      instruction: { type: "string", maxLength: 1200 },
      severityFloor: { enum: ["low", "medium", "high"] },
    },
  },
  outputSchema: {
    structuredResult: true,
    imports: {
      collection: "codexReviewFindings",
      authoritative: false,
    },
    finding: {
      severity: { enum: ["low", "medium", "high"] },
      file: { type: "string" },
      line: { type: "number" },
      message: { type: "string" },
      suggestion: { type: "string" },
      confidence: { enum: ["low", "medium", "high"] },
    },
  },
  errorCodes: [
    "invalid_input",
    "unknown_field",
    "project_required",
    "worktree_required",
    "worktree_not_found",
    "invalid_severity_floor",
    "instruction_too_long",
    "agent_not_available",
  ],
};

export function createCodexReviewAgentRegistration({
  wrapperScriptPath = "tools/agents/codex-review-wrapper.mjs",
  costOwner = "usr_local",
  currency = "USD",
} = {}) {
  const wrapperPath = String(wrapperScriptPath ?? "").trim();
  if (!wrapperPath) {
    throw new Error("codex review wrapperScriptPath is required.");
  }
  return {
    id: "agt_codex_review_diff",
    type: "cli",
    name: "Codex Diff Review",
    description: "Runs a governed read-only Codex review over a project worktree diff.",
    command: "node",
    args: [wrapperPath, "--mode", "diff-review"],
    timeoutSeconds: 120,
    outputFormat: "plain_result",
    toolContract: CODEX_REVIEW_TOOL_CONTRACT,
    capabilityName: "code_review",
    capabilityDescription: "Review a worktree diff and return structured findings.",
    riskLevel: "low",
    riskTags: ["read_only", "read_project", "code_review", "local_agent"],
    economicModel: "external_billed",
    pricingDimensions: [],
    currency,
    costOwner,
    unknownCostPolicy: "warn",
    registrationNotes: {
      risk: "Runs a fixed Codex diff-review wrapper. External callers cannot choose cwd, shell args, sandbox, or permission flags.",
      data: "Reads the selected project worktree diff and stores structured review findings.",
      cost: "Codex usage is externally billed by the configured Codex/OpenAI account and should be reported separately from platform charges.",
      cancellation: "The Desktop Bridge attempts to terminate the Codex review process tree when cancellation is requested.",
    },
  };
}

export function isGovernedCodexReviewAgent(agent) {
  if (!agent) {
    return false;
  }
  const hasId = agent.id === "agt_codex_review_diff";
  const hasCliAdapter = agent.adapter?.type === "cli";
  const hasNodeCommand = String(agent.adapter?.command ?? "") === "node";
  const hasPlainResultOutput = agent.adapter?.outputFormat === "plain_result";
  const hasToolContract = agent.toolContract?.name === CODEX_REVIEW_TOOL_CONTRACT.name;
  const hasReviewCapability = (agent.capabilities ?? []).some((capability) => capability?.name === "code_review");
  const adapterArgs = Array.isArray(agent.adapter?.args) ? agent.adapter.args.map(String) : [];
  const fixedWrapperArgs = isExactGovernedReviewWrapperArgs(adapterArgs, "codex-review-wrapper.mjs");
  return hasId && hasCliAdapter && hasNodeCommand && hasPlainResultOutput && hasToolContract && hasReviewCapability && fixedWrapperArgs;
}

function isExactGovernedReviewWrapperArgs(args, wrapperName) {
  if (args.length !== 3) {
    return false;
  }
  // Require the full canonical directory segment, not just the basename. A
  // bare-basename match (`endsWith(wrapperName)`) would also accept an
  // attacker-controlled script at an arbitrary location whose filename ends
  // with the wrapper name (e.g. /tmp/evil/codex-review-wrapper.mjs), which a
  // forged/overriding agent registration could point the governed tool at —
  // turning the "governed" facade into arbitrary local execution. The wrapper
  // is registered as an absolute path, so match the trailing repo path.
  return args[0].replaceAll("\\", "/").endsWith(`tools/agents/${wrapperName}`)
    && args[1] === "--mode"
    && args[2] === "diff-review";
}
