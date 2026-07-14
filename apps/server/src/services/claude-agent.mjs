import { isGovernedWrapperAgent } from "./governed-agent.mjs";

export const CLAUDE_REVIEW_TOOL_CONTRACT = {
  name: "claude.review.diff",
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
      collection: "claudeReviewFindings",
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

export function createClaudeReviewAgentRegistration({
  wrapperScriptPath = "tools/agents/claude-review-wrapper.mjs",
  costOwner = "usr_local",
  currency = "USD",
} = {}) {
  const wrapperPath = String(wrapperScriptPath ?? "").trim();
  if (!wrapperPath) {
    throw new Error("claude review wrapperScriptPath is required.");
  }
  return {
    id: "agt_claude_review_diff",
    type: "cli",
    name: "Claude Diff Review",
    description: "Runs a governed read-only Claude review over a project worktree diff.",
    command: "node",
    args: [wrapperPath, "--mode", "diff-review"],
    timeoutSeconds: 180,
    outputFormat: "plain_result",
    toolContract: CLAUDE_REVIEW_TOOL_CONTRACT,
    capabilityName: "code_review",
    capabilityDescription: "Review a worktree diff with Claude and return structured findings.",
    riskLevel: "low",
    riskTags: ["read_only", "read_project", "code_review", "local_agent"],
    economicModel: "external_billed",
    pricingDimensions: [],
    currency,
    costOwner,
    unknownCostPolicy: "warn",
    registrationNotes: {
      risk: "Runs a fixed Claude diff-review wrapper in plan mode. External callers cannot choose cwd, shell args, permission mode, or edit/apply behavior.",
      data: "Reads the selected project worktree diff and stores structured review findings.",
      cost: "Claude usage is externally billed by the configured Anthropic/Claude account and may be reported by Claude stream-json result events.",
      cancellation: "The Desktop Bridge attempts to terminate the Claude review process tree when cancellation is requested.",
    },
  };
}

export function isGovernedClaudeReviewAgent(agent) {
  return isGovernedWrapperAgent(agent, {
    id: "agt_claude_review_diff",
    toolName: CLAUDE_REVIEW_TOOL_CONTRACT.name,
    capabilityName: "code_review",
    wrapper: "claude-review-wrapper.mjs",
    mode: "diff-review",
  });
}
