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
    "agent_not_governed",
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
  const hasToolContract = agent.toolContract?.name === CODEX_REVIEW_TOOL_CONTRACT.name;
  const hasReviewCapability = (agent.capabilities ?? []).some((capability) => capability?.name === "code_review");
  const adapterArgs = Array.isArray(agent.adapter?.args) ? agent.adapter.args.map(String) : [];
  const usesWrapper = adapterArgs.some((arg) => arg.endsWith("codex-review-wrapper.mjs"));
  const fixedMode = adapterArgs.includes("--mode") && adapterArgs.includes("diff-review");
  return hasId && hasToolContract && hasReviewCapability && usesWrapper && fixedMode;
}
